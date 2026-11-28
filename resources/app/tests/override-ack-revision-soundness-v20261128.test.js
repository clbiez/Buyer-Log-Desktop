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
  own.context.window.adoptAckRevision('orders', 11, { ownBump: 1 });
  own.context.window.adoptAckRevision('suppFob', 4, { ownBump: 0 });
  assert.deepEqual(own.rev(), { orders: 11, suppFob: 4 });
  const gap = client({ orders: 10, suppFob: 4 });
  gap.context.window.adoptAckRevision('orders', 12, { ownBump: 1 }); // B'nin görülmemiş yazması + bizimki
  gap.context.window.adoptAckRevision('suppFob', 5, { ownBump: 0 }); // B'nin görülmemiş Supp. FOB'u
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
  assert.match(send, /window\.adoptAckRevision\?\.\(name,value,\{ownBump:name==='orders'&&\(data\.applied\|\|\[\]\)\.some\(item=>item&&item\.noop===false\)\?1:0\}\)/);
  assert.doesNotMatch(fs.readFileSync(path.join(__dirname, '..', 'server', 'lib', 'read-model', 'cp-row-save.js'), 'utf8'), /res\.json\(\{ok:true,[^\n]*\bupdated\b/, 'row-save response has no updated field');
  assert.doesNotMatch(send, /state\.storeRevisions\[name\]=Number\(value\)/);
  assert.doesNotMatch(SYNC, /state\.storeRevisions\[key\]=Number\(value\);\}\);/, 'legacy ack no longer copies every returned revision');
});
