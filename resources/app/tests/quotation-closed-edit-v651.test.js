'use strict';

/* v6.51 — KAPALI QUOTATION KAYITLARINA İÇERİK DÜZENLEME YASAĞI KALDIRILDI.
 *
 * Kullanıcı isteği: "kapalı quotation'lara edit yasağı koyma."
 *
 * Kapsam: SADECE statü temelli kilit kaldırıldı. Sahiplik/erişim kontrolü
 * (qCanEditRequest / canEdit(profile,request)) HİÇ DEĞİŞMEDİ — kapalı bir
 * kayıt artık başkasının kaydı olmaya devam ediyorsa yine düzenlenemez.
 *
 * v6.47 ile bağlantı: o turda sürükleme (draggable) ve sunucudaki
 * mergeRequests açılmıştı, ama qMergeRequest içindeki AYRI bir istemci
 * ön-kontrolü (drop sonrası, sunucuya istek gitmeden önce) gözden kaçmıştı —
 * kapalı kayıt sürüklenebiliyordu ama bırakıldığında sessizce reddediliyordu.
 * Bu tur o kaçırılan noktayı da kapatıyor.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-quotation-edit-v651-'));
process.env.BUYER_LOG_SERVER_DATA_ROOT = path.join(tmpRoot, 'server-data');
test.after(() => fs.rmSync(tmpRoot, { recursive: true, force: true }));

const store = require(path.join(ROOT, 'server', 'lib', 'quotations-store.js'));
const UI = fs.readFileSync(path.join(ROOT, 'public', 'quotations.js'), 'utf8');
const SERVER_STORE = fs.readFileSync(path.join(ROOT, 'server', 'lib', 'quotations-store.js'), 'utf8');

function bodyOf(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} bulunmalı`);
  let paren = 0, i = source.indexOf('(', start);
  for (; i < source.length; i++) {
    if (source[i] === '(') paren++;
    else if (source[i] === ')' && --paren === 0) break;
  }
  const open = source.indexOf('{', i);
  let depth = 0;
  for (let j = open; j < source.length; j++) {
    if (source[j] === '{') depth++;
    else if (source[j] === '}' && --depth === 0) return source.slice(open + 1, j);
  }
  throw new Error(`${name} ayrıştırılamadı`);
}

const profile = { id: 'u1', role: 'user', displayName: 'Test User' };
const other = { id: 'u2', role: 'user', displayName: 'Other User' };

/* --------------------------------------------------------- 1) SUNUCU DAVRANIŞI */

test('v6.51 kapalı kaydın içeriği sunucuda güncellenebiliyor', () => {
  const req = store.createRequest(profile, {
    source: 'collection', manufacturers: [{ name: 'A', email: 'a@x.com' }],
    items: [{ modelKey: 'M1', manufacturer: 'A', orderCode: '1', price: '10.00' }],
  });
  store.setStatus(profile, req.id, 'closed');
  const closed = store.loadStore().requests.find(r => r.id === req.id);
  assert.equal(closed.status, 'closed');

  const updated = store.updateRequest(profile, req.id, {
    ...closed, items: closed.items.map(it => ({ ...it, price: '99.00' })),
  });
  assert.equal(updated.items[0].price, '99.00');
  assert.equal(updated.status, 'closed', 'güncelleme statüyü değiştirmemeli');
});

test('v6.51 eski QUOTATION_CLOSED reddi sunucu kodunda kalmamış', () => {
  assert.doesNotMatch(SERVER_STORE, /QUOTATION_CLOSED/);
  assert.doesNotMatch(SERVER_STORE, /Kapalı quotation içeriği düzenlenemez/);
});

test('v6.51 sahiplik/erişim kontrolü hâlâ geçerli — statü değil yetki kontrol ediyor', () => {
  const mine = store.createRequest(profile, { source: 'collection', manufacturers: [{ name: 'B', email: 'b@x.com' }], items: [] });
  const theirs = store.createRequest(other, { source: 'collection', manufacturers: [{ name: 'C', email: 'c@x.com' }], items: [] });
  store.setStatus(other, theirs.id, 'closed');
  assert.throws(() => store.updateRequest(profile, theirs.id, { ...theirs, note: 'x' }),
    /QUOTATION_EDIT_DENIED|yetkiniz/, 'başkasının kaydı hâlâ düzenlenemez');
  // Kendi kapalı kaydımı düzenleyebilmeliyim.
  store.setStatus(profile, mine.id, 'closed');
  assert.doesNotThrow(() => store.updateRequest(profile, mine.id, { ...store.loadStore().requests.find(r => r.id === mine.id), note: 'ok' }));
});

/* --------------------------------------------------------- 2) İSTEMCİ DAVRANIŞI */

test('v6.51 qCanEditLine artık statüye bakmıyor', () => {
  const body = bodyOf(UI, 'qCanEditLine');
  assert.doesNotMatch(body, /status!=='closed'/);
  assert.match(body, /qCanEditRequest\(req\)/, 'sahiplik kontrolü korunmalı');
});

test('v6.51 qMergeRequest içindeki kaçırılan client-side guard kaldırıldı', () => {
  // v6.47'de sunucu ve draggable açılmıştı ama BU kontrol unutulmuştu.
  const body = bodyOf(UI, 'qMergeRequest');
  assert.doesNotMatch(body, /status==='closed'\|\|target\.status==='closed'/);
  assert.match(body, /qCanDeleteRequest\(source\)/, 'sahiplik/erişim kontrolü korunmalı');
});

test('v6.51 not editörü artık kapalı kayıtta da yazılabilir', () => {
  const body = bodyOf(UI, 'qOpenQuotationNote');
  assert.doesNotMatch(body, /qCanEditRequest\(req\)&&req\.status!=='closed'/);
  assert.match(body, /const editable=qCanEditRequest\(req\);/);
});

test('v6.51 nav liste ve detay panelindeki contentCanEdit statüden bağımsız', () => {
  const matches = UI.match(/contentCanEdit=req\.status!=='closed'&&/g) || [];
  assert.equal(matches.length, 0, 'eski statü bağımlı contentCanEdit ataması kalmamalı');
  assert.match(UI, /contentCanEdit=canEdit;/);
  assert.match(UI, /contentCanEdit=requestCanEdit,canManageAccess/);
});

test('v6.51 "kapalı ve kilitli" bildirimi kaldırıldı (artık yanlış bilgi olurdu)', () => {
  assert.doesNotMatch(UI, /quotationClosedNotice/);
  assert.doesNotMatch(UI, /içerik düzenlemeye karşı kilitlidir/);
});

test('v6.51 findCollectionLine artık kapalı kayıtları arama kapsamından atlamıyor', () => {
  // v6.34'ün çözdüğü "çift kayıt" sorunu, kapalı kayıtlar atlandığı için
  // kapalı kayıtlarda yeniden ortaya çıkabilirdi.
  const body = bodyOf(UI, 'findCollectionLine');
  assert.doesNotMatch(body, /if\(req\.status==='closed'\) return;/);
});

/* --------------------------------------------------- 3) DURUM GÖSTERGESİ KORUNUYOR */

test('v6.51 "Kapandı" durumu hâlâ görünür — yalnız düzenleme kısıtlaması kalktı', () => {
  // Bu tur yalnız EDİT YASAĞINI kaldırdı; durumun kendisi (rozet, seçici,
  // sayaç) hâlâ görünür ve anlamlı kalmalı.
  assert.match(UI, /isClosed/);
  assert.match(UI, /qStatusLabel/);
  assert.match(UI, /data-quotation-status/);
});
