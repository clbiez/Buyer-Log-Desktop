'use strict';

/* ÇOK PROFİLLİ CoreNectum — PROFİL SAHİPLİĞİ (AFFINITY) — v11.11
 *
 * KÖK NEDEN (gerçek Edge + iki gerçek BrowserContext ile kanıtlandı):
 *
 *  1) Motor katmanında profil MODELLENMİYORDU: `contexts()` tek bir düz
 *     bağlam döndürür ve `pages()` BÜTÜN Edge profillerinin sekmelerini bir
 *     arada verir. Sahiplik yalnız her sayfadaki `browserContextId` ile
 *     ayırt edilebilir.
 *
 *  2) O kimlik GÜVENİLİR DEĞİLDİ: `Target.createTarget` yanıtı
 *     browserContextId taşımaz, bu yüzden Buyer Log'un KENDİ açtığı sekme
 *     BOŞ kimlikle doğuyordu. `Target.getTargets` sonradan gerçek kimliği
 *     getirse de sayfa "zaten var" diye erken dönüldüğü için değer hiç
 *     yazılmıyordu. Sonuç: aynı profildeki iki sekme farklı kimlik taşıyor,
 *     profil bazlı her karşılaştırma yanlış sonuç veriyordu.
 *
 *  3) Sahiplik HER ÇAĞRIDA yeniden türetiliyordu: ikinci bir profil CoreNectum
 *     açtığında aynı işin ortasında başka profile geçilebiliyordu.
 *
 * Korunan davranış: sahiplik bir kez SABİTLENİR; sonradan açılan profiller,
 * öne gelen pencereler, daha yeni CDP hedefleri ve aynı adresi açan başka
 * sekmeler bunu değiştiremez. Sabitlenen profil kaybolursa BAŞKA profile
 * atlanmaz.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const connector = require(path.join(ROOT, 'server/lib/agent-browser-connector.js'));

const CORENECTUM = 'https://corenectum.lcwaikiki.com/models-options/style-list';
const BUYER_LOG = 'http://localhost:6194/';
const CTX_A = 'CTX-A-BUYERLOG';
const CTX_B = 'CTX-B-DIGER';

/* `pages()` düz bir liste döndürür — gerçek motor davranışı budur. */
function fakeContext(tabs, { extraBrowserContextIds = [CTX_B] } = {}) {
  const context = {
    extraBrowserContextIds,
    pages: () => context._pages,
  };
  context._pages = tabs.map(tab => ({
    url: () => tab.url,
    isClosed: () => Boolean(tab.closed),
    browserContextId: tab.ctx,
  }));
  return context;
}

test('A ve B aynı anda CoreNectum açıkken VARSAYILAN profil (Buyer Log’unki) seçilir', () => {
  // B ÖNCE listelenir: sıra seçim sonucunu değiştirmemeli.
  const context = fakeContext([
    { url: CORENECTUM, ctx: CTX_B },
    { url: CORENECTUM, ctx: CTX_A },
  ]);
  const binding = connector.coreNectumProfileBinding(context);
  assert.equal(binding.bound, true);
  assert.equal(binding.browserContextId, CTX_A, 'ikinci profil seçilmemeli');
  assert.equal(binding.source, 'default-profile-corenectum-tab');
});

test('sahiplik SABİTLENİR: B sonradan CoreNectum açsa da profil değişmez', () => {
  const context = fakeContext([{ url: CORENECTUM, ctx: CTX_A }], { extraBrowserContextIds: [] });
  const first = connector.coreNectumProfileBinding(context);
  assert.equal(first.browserContextId, CTX_A);

  // B sonradan açılır ve CoreNectum'a girer.
  context.extraBrowserContextIds = [CTX_B];
  context._pages.unshift({ url: () => CORENECTUM, isClosed: () => false, browserContextId: CTX_B });

  const second = connector.coreNectumProfileBinding(context);
  assert.equal(second.browserContextId, CTX_A, 'sonradan açılan profil sahipliği çalamaz');
  assert.equal(second.pinned, true);
  assert.match(second.source, /^pinned:/);
});

test('B daha YENİ hedef açsa da sabit profil korunur', () => {
  const context = fakeContext([{ url: CORENECTUM, ctx: CTX_A }], { extraBrowserContextIds: [] });
  connector.coreNectumProfileBinding(context);
  context.extraBrowserContextIds = [CTX_B];
  // B iki yeni sekme açar; ikisi de listenin SONUNDA, yani "en yeni".
  context._pages.push({ url: () => CORENECTUM, isClosed: () => false, browserContextId: CTX_B });
  context._pages.push({ url: () => CORENECTUM, isClosed: () => false, browserContextId: CTX_B });
  assert.equal(connector.coreNectumProfileBinding(context).browserContextId, CTX_A);
});

test('sabitlenen profilin CoreNectum sekmesi kapanırsa AYNI profilde kalınır', () => {
  const context = fakeContext([
    { url: BUYER_LOG, ctx: CTX_A },
    { url: CORENECTUM, ctx: CTX_A },
  ], { extraBrowserContextIds: [CTX_B] });
  const first = connector.coreNectumProfileBinding(context);
  assert.equal(first.browserContextId, CTX_A);

  // A'nın CoreNectum sekmesi kapanır, B'ninki açılır.
  context._pages = [
    { url: () => BUYER_LOG, isClosed: () => false, browserContextId: CTX_A },
    { url: () => CORENECTUM, isClosed: () => false, browserContextId: CTX_B },
  ];
  const second = connector.coreNectumProfileBinding(context);
  assert.equal(second.bound, true);
  assert.equal(second.browserContextId, CTX_A, 'B’nin sekmesine ATLANMAMALI');
  // Sekme yoksa CoreNectum sayfası O profilde açılacak; referans A’dan gelir.
  assert.equal(second.page.url(), BUYER_LOG);
});

test('sabitlenen profil tamamen kapanırsa BAŞKA profile geçilmez, açıkça bildirilir', () => {
  const context = fakeContext([{ url: CORENECTUM, ctx: CTX_A }], { extraBrowserContextIds: [] });
  connector.coreNectumProfileBinding(context);
  context.extraBrowserContextIds = [CTX_B];
  context._pages = [{ url: () => CORENECTUM, isClosed: () => false, browserContextId: CTX_B }];

  const binding = connector.coreNectumProfileBinding(context);
  assert.equal(binding.bound, false, 'başka kullanıcının profiline atlanmamalı');
  assert.equal(binding.source, 'pinned-profile-unavailable');
});

test('sayfa filtresi sabit profile bağlıdır', () => {
  const context = fakeContext([{ url: CORENECTUM, ctx: CTX_A }], { extraBrowserContextIds: [CTX_B] });
  const binding = connector.coreNectumProfileBinding(context);
  const foreign = { url: () => CORENECTUM, isClosed: () => false, browserContextId: CTX_B };
  const own = { url: () => CORENECTUM, isClosed: () => false, browserContextId: CTX_A };
  assert.equal(connector.pageIsInBoundProfile(foreign, binding), false);
  assert.equal(connector.pageIsInBoundProfile(own, binding), true);
});

test('varsayılan bağlam, EK bağlam listesinin dışında kalan tek kimliktir', () => {
  const pages = [
    { browserContextId: CTX_A }, { browserContextId: CTX_B }, { browserContextId: CTX_A },
  ];
  assert.equal(connector.defaultBrowserContextIdOf({ extraBrowserContextIds: [CTX_B] }, pages), CTX_A);
  // Ek bağlam bilinmiyorsa tahmin YÜRÜTÜLMEZ.
  assert.equal(connector.defaultBrowserContextIdOf({ extraBrowserContextIds: [] }, pages), null);
  // Birden çok aday varsa da tahmin yürütülmez.
  assert.equal(connector.defaultBrowserContextIdOf({ extraBrowserContextIds: ['CTX-C'] }, pages), null);
});

test('motor, kendi açtığı sekmenin GERÇEK profil kimliğini sonradan uzlaştırır', () => {
  const fs = require('node:fs');
  const source = fs.readFileSync(path.join(ROOT, 'server/lib/portable-web-engine.js'), 'utf8');
  // Boş doğan kimlik, keşifte gelen gerçek kimlikle doldurulur.
  assert.match(source, /if \(discovered && !existing\.browserContextId\) existing\.browserContextId = discovered;/);
  // Varsayılan bağlamı ayırt etmek için ek bağlam listesi okunur.
  assert.match(source, /Target\.getBrowserContexts/);
});

/* ÖLÇÜLEN GERÇEK: `Target.getBrowserContexts` yalnız CDP ile OLUŞTURULAN
   bağlamları döndürür. Kullanıcının profil değiştiriciyle açtığı ikinci Edge
   profili o listede GÖRÜNMEZ — yani "ek listede olmayan tek kimlik" çıkarımı
   gerçek topolojide tek başına yetmez. Asıl dayanak, Buyer Log'un tarayıcıyı
   kendisi başlatıp İLK bağlanan taraf olmasıdır. */
test('bağlanma anında açık olan tek profil, Buyer Log’un profili olarak sabitlenir', () => {
  const context = fakeContext([
    { url: BUYER_LOG, ctx: CTX_A },
    { url: CORENECTUM, ctx: CTX_A },
  ], { extraBrowserContextIds: [] });

  connector.pinProfileAffinity(context, { bound: true, hasContext: true, browserContextId: CTX_A, source: 'connect-time-profile' });

  // Kullanıcı SONRADAN ikinci profili açar ve orada da CoreNectum'a girer.
  context._pages.push({ url: () => CORENECTUM, isClosed: () => false, browserContextId: CTX_B });
  const binding = connector.coreNectumProfileBinding(context);
  assert.equal(binding.browserContextId, CTX_A);
  assert.equal(binding.source, 'pinned:connect-time-profile');
  assert.equal(binding.page.url(), CORENECTUM);
  assert.equal(connector.pageIsInBoundProfile(context._pages[2], binding), false, 'ikinci profilin sekmesi kullanılmamalı');
});

test('bağlanma anında birden çok profil açıksa körlemesine sabitleme YAPILMAZ', () => {
  const context = fakeContext([
    { url: CORENECTUM, ctx: CTX_A },
    { url: CORENECTUM, ctx: CTX_B },
  ], { extraBrowserContextIds: [] });
  const startup = [...new Set(context.pages().map(p => p.browserContextId))];
  assert.equal(startup.length, 2, 'iki profil açıkken tek aday yoktur');
  assert.equal(connector.pinnedProfileAffinity(context), null, 'tahminle sabitlenmemeli');
});

test('bağlantı düşünce sahiplik temizlenir (yeni oturum yeniden karar verir)', () => {
  const fs = require('node:fs');
  const source = fs.readFileSync(path.join(ROOT, 'server/lib/agent-browser-connector.js'), 'utf8');
  assert.match(source, /const cleanup=\(\)=>\{entry\.closed=true;clearProfileAffinity\(context\);/);
});
