'use strict';

/* EDGE PROFİL BAĞLAMASI — v11.11
 *
 * Korunan regresyon: Buyer Log, MEVCUT KULLANICININ Edge profilinde çalışır.
 *
 * Makinede ikinci bir Edge profili açıkken CoreNectum sekmesi o profile ait
 * olabilir. Eski sıra "önce herhangi bir CoreNectum sekmesi" dediği için iş
 * sessizce yabancı profilde çalışıyor, o profilde oturum olmadığından
 * GetStyleList isteği hiç doğmuyor ve kullanıcıya ham CDP metni
 * ("No resource with given identifier found") gösteriliyordu.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const connector = require(path.join(ROOT, 'server/lib/agent-browser-connector.js'));
const SOURCE = fs.readFileSync(path.join(ROOT, 'server/lib/agent-browser-connector.js'), 'utf8');

function fakeContext(tabs) {
  const pages = tabs.map(tab => ({
    url: () => tab.url,
    isClosed: () => Boolean(tab.closed),
    browserContextId: tab.profile || '',
  }));
  return { pages: () => pages };
}

const BUYER_LOG = 'http://localhost:6194/';
const CORENECTUM = 'https://corenectum.lcwaikiki.com/models-options/style-list';

test('Buyer Log sekmesinin profili, yabancı profildeki CoreNectum sekmesine TERCİH edilir', () => {
  const binding = connector.coreNectumProfileBinding(fakeContext([
    { url: CORENECTUM, profile: 'profil-B' },
    { url: BUYER_LOG, profile: 'profil-A' },
  ]));
  assert.equal(binding.bound, true);
  assert.equal(binding.browserContextId, 'profil-A', 'iş, uygulamayı kullanan kişinin profilinde çalışmalı');
  assert.equal(binding.source, 'buyer-log-tab');
});

test('CoreNectum sekmesi AYNI profildeyse referans sekme odur', () => {
  const binding = connector.coreNectumProfileBinding(fakeContext([
    { url: BUYER_LOG, profile: 'profil-A' },
    { url: CORENECTUM, profile: 'profil-A' },
  ]));
  assert.equal(binding.browserContextId, 'profil-A');
  assert.equal(binding.source, 'buyer-log-profile-corenectum-tab');
  assert.equal(binding.page.url(), CORENECTUM);
});

test('Buyer Log sekmesi yokken (masaüstü sürümü) CoreNectum sekmesi bağlar', () => {
  const binding = connector.coreNectumProfileBinding(fakeContext([
    { url: 'https://www.bing.com/', profile: 'profil-B' },
    { url: CORENECTUM, profile: 'profil-B' },
  ]));
  assert.equal(binding.source, 'corenectum-tab');
  assert.equal(binding.browserContextId, 'profil-B');
});

test('Buyer Log sekmesi yokken İKİ AYRI profilde CoreNectum açıksa rastgele seçilmez', () => {
  const binding = connector.coreNectumProfileBinding(fakeContext([
    { url: CORENECTUM, profile: 'profil-A' },
    { url: CORENECTUM, profile: 'profil-B' },
  ]));
  assert.equal(binding.bound, false, 'başkasının oturumunda çalışmaktansa sorulmalı');
  assert.equal(binding.source, 'ambiguous-corenectum-profiles');
});

test('birden çok profil açık ve dayanak yoksa bağlama YAPILMAZ', () => {
  const binding = connector.coreNectumProfileBinding(fakeContext([
    { url: 'https://www.bing.com/', profile: 'profil-A' },
    { url: 'https://example.com/', profile: 'profil-B' },
  ]));
  assert.equal(binding.bound, false);
  assert.equal(binding.source, 'ambiguous');
});

test('tek profil açıksa belirsizlik yoktur', () => {
  const binding = connector.coreNectumProfileBinding(fakeContext([
    { url: 'https://www.bing.com/', profile: 'profil-A' },
    { url: 'https://example.com/', profile: 'profil-A' },
  ]));
  assert.equal(binding.bound, true);
  assert.equal(binding.source, 'single-open-profile');
});

test('sekme profil filtresi: yabancı profil elenir, dayanaksız bağlamada ayrım yapılmaz', () => {
  const foreign = { url: () => CORENECTUM, isClosed: () => false, browserContextId: 'profil-B' };
  const own = { url: () => CORENECTUM, isClosed: () => false, browserContextId: 'profil-A' };
  assert.equal(connector.pageIsInBoundProfile(foreign, { browserContextId: 'profil-A', hasContext: true }), false);
  assert.equal(connector.pageIsInBoundProfile(own, { browserContextId: 'profil-A', hasContext: true }), true);
  assert.equal(connector.pageIsInBoundProfile(foreign, { browserContextId: '', hasContext: false }), true);
});

/* Tarayıcının AÇILDIĞI profil Chromium'da "varsayılan bağlam"dır ve
   browserContextId TAŞIMAZ. Kullanıcı varsayılan profildeyken ikinci profil
   açıldığında filtre etkisiz kalmamalı — asıl şikâyet edilen durum budur. */
test('varsayılan bağlam (boş kimlik) da gerçek bir profildir; ikinci profil elenir', () => {
  const binding = connector.coreNectumProfileBinding(fakeContext([
    { url: BUYER_LOG, profile: '' },
    { url: CORENECTUM, profile: 'ikinci-profil' },
  ]));
  assert.equal(binding.browserContextId, '');
  assert.equal(binding.hasContext, true, 'boş kimlik "fikrim yok" değil, varsayılan profil demektir');
  const foreignTab = { url: () => CORENECTUM, isClosed: () => false, browserContextId: 'ikinci-profil' };
  const ownTab = { url: () => BUYER_LOG, isClosed: () => false, browserContextId: '' };
  assert.equal(connector.pageIsInBoundProfile(foreignTab, binding), false, 'ikinci profilin sekmesi kullanılmamalı');
  assert.equal(connector.pageIsInBoundProfile(ownTab, binding), true);
});

test('Style List sekmesinin yeniden kullanımı profil filtresinden geçer', () => {
  assert.match(SOURCE, /let page=context\.pages\(\)\.find\(candidate=>isStyleListTab\(candidate\)&&pageIsInBoundProfile\(candidate,binding\)\);/);
  assert.match(SOURCE, /CORENECTUM_STYLE_LIST_TAB_OTHER_PROFILE/);
});

test('atılmış yanıt gövdesi kullanıcıya SEBEP olarak gösterilmez', () => {
  assert.match(SOURCE, /no resource with given identifier\|no data found for resource/i);
  assert.match(SOURCE, /const detail=\(capture\.errors\|\|\[\]\)\.find\(item=>item&&!item\.evicted\)\?\.error;/);
});

test('CoreNectum sekmesi arayan diğer yollar da profile bağlıdır', () => {
  const hits = SOURCE.match(/coreNectumPageUrl\(candidate\.url\(\)\)&&pageIsInBoundProfile\(candidate,binding\)/g) || [];
  assert.equal(hits.length, 2, 'rapor ve API yolları da yabancı profilde çalışmamalı');
  // Yeni sekme varsayılan profile düşmemeli.
  assert.match(SOURCE, /return \{page:await pageInBoundProfile\(context,CORENECTUM_STYLE_LIST_URL,binding\),ownsPage:true\};/);
});
