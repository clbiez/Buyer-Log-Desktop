'use strict';

/* P1 · REVİZYON BELİRTECİ YALNIZ GÖRÜLEN YAZMALARLA İLERLER (2026-11-28)
 *
 * Eski kayıt yollarının (PATCH /api/overrides/:kod, /batch, /batch-suppfob) tek koruması istemcinin "depoyu bu
 * sürüme kadar gördüm" belirteciyle yaptığı global CAS'tır. Her onay belirteci sunucunun döndürdüğü değere taşıyordu:
 * satır kaydı (POST /rows, global CAS kullanmaz) ya da başka bir yazmanın onayı, araya giren başka oturumun
 * değişikliğini "görülmüş" sayıyordu. Gerçek iki istemci (3/3): A'nın canlı kanalı gecikmişken B Supp. FOB'u / notu
 * değiştirir, A başka satırda satır kaydı yapar, sonra aynı alanı bayat görüntüden yazar → 200, B sessizce ezilir.
 *
 * Kural: bir anahtar ancak sunucu bu istekte onu doğruladıysa (CAS) ya da yeni değer yalnız bu yazmanın kendi
 * artışıysa ilerler. Aksi hâlde belirteç bayat kalır ve sıradaki eski yol yazması mevcut çakışma yoluna düşer
 * (409 → uyarı + yeniden yükleme). Satır kaydı alan bazlı base karşılaştırmasını kullandığı için etkilenmez.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const SYNC = fs.readFileSync(path.join(__dirname, '..', 'public', 'override-sync.js'), 'utf8');
const APP = fs.readFileSync(path.join(__dirname, '..', 'public', 'app-main.js'), 'utf8');

function client(revisions, reply) {
  const sent = [];
  const context = { window: {}, state: { storeRevisions: { ...revisions } }, appLang: 'en', showToast() {}, loadFromServer: async () => {}, fetchJSON: async (url, opts) => { sent.push({ url, opts }); return reply; } };
  vm.createContext(context);
  vm.runInContext(SYNC, context);
  return { context, sent, rev: () => ({ ...context.state.storeRevisions }) };
}

test('eski PATCH (CAS doğrulandı): orders ilerler; dokunulmayan suppFob başkasının artışıyla ilerlemez', async () => {
  const c = client({ orders: 10, suppFob: 4 }, { revision: 11, revisions: { orders: 11, suppFob: 5 } });
  await c.context.window.enqueueOverrideMutation('orders', '/api/overrides/1', { method: 'PATCH', body: JSON.stringify({ model: 'M', ccode: 'C', notes: { Notes: 'x' } }) });
  assert.equal(c.sent[0].opts.expectedRevision, 10);
  assert.equal(c.rev().orders, 11, 'server verified orders 10 → own write 11');
  assert.equal(c.rev().suppFob, 4, 'suppFob 5 is someone else\'s unseen write: stays stale');
});

test('eski PATCH Supp. FOB ile (iki anahtar da doğrulandı): ikisi de ilerler', async () => {
  const c = client({ orders: 10, suppFob: 4 }, { revision: 11, revisions: { orders: 11, suppFob: 5 } });
  await c.context.window.enqueueOverrideMutation('orders', '/api/overrides/1', { method: 'PATCH', body: JSON.stringify({ model: 'M', ccode: 'C', suppFob: 9, suppFobMeta: { source: 'manual' } }) });
  assert.deepEqual(c.rev(), { orders: 11, suppFob: 5 });
});

test('satır kaydı onayı: orders yalnız kendi tek artışıyla ilerler; araya başka yazma girdiyse bayat kalır', () => {
  const own = client({ orders: 10, suppFob: 4 });
  own.context.window.adoptAckRevision('orders', 11, { own: true });
  own.context.window.adoptAckRevision('suppFob', 4, {});
  assert.deepEqual(own.rev(), { orders: 11, suppFob: 4 });
  const gap = client({ orders: 10, suppFob: 4 });
  gap.context.window.adoptAckRevision('orders', 12, { own: true }); // B'nin görülmemiş yazması + bizimki
  gap.context.window.adoptAckRevision('suppFob', 5, {}); // B'nin görülmemiş Supp. FOB'u
  assert.deepEqual(gap.rev(), { orders: 10, suppFob: 4 }, 'unseen writes keep the token stale → next legacy write conflicts');
  const stale = client({ orders: 10 });
  stale.context.window.adoptAckRevision('orders', 9, { verified: true });
  assert.equal(stale.rev().orders, 10, 'an older value never moves the token back');
});

test('bayat belirteçle sonraki eski yol yazması mevcut çakışma yoluna düşer (sunucu 409 → belirteç güncellenir, yeniden yüklenir)', async () => {
  let loads = 0;
  const c = client({ orders: 10, suppFob: 4 });
  c.context.loadFromServer = async () => { loads++; };
  c.context.fetchJSON = async () => { throw Object.assign(new Error('conflict'), { code: 'REVISION_CONFLICT', currentRevision: 12 }); };
  await assert.rejects(c.context.window.enqueueOverrideMutation('orders', '/api/overrides/1', { method: 'PATCH', body: '{}' }), error => error.code === 'REVISION_CONFLICT');
  assert.equal(c.rev().orders, 12);
  assert.equal(loads, 1);
});

test('kaynak sözleşmesi: satır kaydı onayı revizyonları yalnız adoptAckRevision ile ilerletir', () => {
  const send = APP.slice(APP.indexOf('function cpRowSaveSend('), APP.indexOf('function cpRowSaveSettled('));
  // POST /rows yanıtı `updated` taşımaz (cp-row-save.js): kendi artış applied[].noop'tan çıkarılır.
  assert.match(send, /window\.adoptAckRevision\?\.\(name,value,\{own:name==='orders'&&\(data\.applied\|\|\[\]\)\.some\(item=>item&&item\.noop===false\)\}\)/);
  assert.doesNotMatch(fs.readFileSync(path.join(__dirname, '..', 'server', 'lib', 'read-model', 'cp-row-save.js'), 'utf8'), /res\.json\(\{ok:true,[^\n]*\bupdated\b/, 'row-save response has no updated field');
  assert.doesNotMatch(send, /state\.storeRevisions\[name\]=Number\(value\)/);
  assert.doesNotMatch(SYNC, /state\.storeRevisions\[key\]=Number\(value\);\}\);/, 'legacy ack no longer copies every returned revision');
});

test('sırasız onay: kendi satır kaydı onayı (T+2) eski yol onayından (T+1) önce gelse de belirteç kendi yazmaları boyunca ilerler', () => {
  const c = client({ orders: 10 });
  c.context.window.adoptAckRevision('orders', 12, { own: true });       // satır kaydı R (sunucuda ikinci)
  assert.equal(c.rev().orders, 10, 'T+1 not yet known');
  c.context.window.adoptAckRevision('orders', 11, { verified: true });  // eski yol L (CAS doğruladı)
  assert.equal(c.rev().orders, 12, 'own revisions 11 and 12 are consecutive → token 12');
  c.context.window.adoptAckRevision('orders', 13, { own: true });
  assert.equal(c.rev().orders, 13, 'keeps tracking afterwards (no false 409 loop)');
  const foreign = client({ orders: 10 });
  foreign.context.window.adoptAckRevision('orders', 12, { own: true });  // 11 başkasının
  assert.equal(foreign.rev().orders, 10, 'a foreign revision in between keeps the token stale');
});

test('tam yükleme belirteci geri götürmez (yanıt kendi onayımızdan eskiyse)', () => {
  const merge = APP.slice(APP.indexOf('state.storeRevisions=mergeStoreRevisions('), APP.indexOf('state.storeRevisions=mergeStoreRevisions(') + 80);
  assert.ok(merge.length > 0, 'loadFromServer merges revisions through mergeStoreRevisions');
  const { loadAppMainFunctions } = require('./helpers/app-main-functions');
  const { mergeStoreRevisions } = loadAppMainFunctions(['mergeStoreRevisions'], {});
  const merged = mergeStoreRevisions({ orders: 12, suppFob: 3, pricingRules: 5 }, { orders: 11, suppFob: 4, pricingRules: 4 });
  assert.deepEqual(JSON.parse(JSON.stringify(merged)), { orders: 12, suppFob: 4, pricingRules: 4 }, 'only CAS tokens are max-merged; other keys keep the incoming value');
});

test('eski yol gövdesi kuyrukta, gönderimden hemen önce kurulur (önceki onay kayıtlı değeri güncellemiş olur)', async () => {
  const order = [];
  const c = client({ orders: 10 }, { revision: 11 });
  c.context.fetchJSON = async (url, opts) => { order.push(['send', opts.body]); return { revision: 11 + order.length }; };
  let stored = 'A';
  const first = c.context.window.enqueueOverrideMutation('orders', '/api/overrides/1', { method: 'PATCH', body: () => { order.push(['build1']); return JSON.stringify({ licensor: 'B' }); } });
  const second = c.context.window.enqueueOverrideMutation('orders', '/api/overrides/1', { method: 'PATCH', body: () => { order.push(['build2', stored]); return JSON.stringify(stored === 'A' ? {} : { licensor: 'A' }); } });
  stored = 'B'; // birinci kaydın onayı kayıtlı değeri B yapar (gerçekte cpRowLegacyAcked)
  await Promise.all([first, second]);
  assert.deepEqual(order.map(item => item[0]), ['build1', 'send', 'build2', 'send']);
  assert.equal(order[3][1], JSON.stringify({ licensor: 'A' }), 'revert A→B→A is sent because the base is the acknowledged B');
});
