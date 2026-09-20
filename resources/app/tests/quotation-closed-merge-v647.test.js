'use strict';

/* v6.47 — KAPALI QUOTATION KAYITLARI ARTIK SÜRÜKLENEBİLİYOR VE BİRLEŞTİRİLEBİLİYOR.
 *
 * Kullanıcı isteği: "kapalı quotation kayıtlarını tutup sürükleyerek
 * birleştiremiyorum" → kullanıcı kararıyla kural tamamen kaldırıldı: kapalı
 * kayıt hem kaynak (silinen) hem hedef (korunan) olabilir.
 *
 * Kritik ayrım: bu değişiklik kapalı kaydın KENDİ İÇERİĞİNİ düzenleme iznini
 * (contentCanEdit — fiyat girişi, onay kutusu) DEĞİŞTİRMEMELİ; yalnız
 * sürükleme/birleştirme yetkisi ayrıldı ve sunucudaki canManageAccess ile
 * aynı kurala (qCanManageAccess) bağlandı.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-quotation-merge-v647-'));
process.env.BUYER_LOG_SERVER_DATA_ROOT = path.join(tmpRoot, 'server-data');
test.after(() => fs.rmSync(tmpRoot, { recursive: true, force: true }));

const store = require(path.join(ROOT, 'server', 'lib', 'quotations-store.js'));
const UI = fs.readFileSync(path.join(ROOT, 'public', 'quotations.js'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'public', 'app.css'), 'utf8');

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

function makePair() {
  const openReq = store.createRequest(profile, {
    source: 'collection', manufacturers: [{ name: 'A', email: 'a@x.com' }],
    items: [{ modelKey: 'M1', manufacturer: 'A', orderCode: '1' }],
  });
  const closedReq = store.createRequest(profile, {
    source: 'collection', manufacturers: [{ name: 'B', email: 'b@x.com' }],
    items: [{ modelKey: 'M2', manufacturer: 'B', orderCode: '2' }],
  });
  store.setStatus(profile, closedReq.id, 'closed');
  return { openReq, closedReq };
}

/* --------------------------------------------------------- 1) SUNUCU DAVRANIŞI */

test('v6.47 kapalı kayıt HEDEF olarak birleşebiliyor ve kapalı kalıyor', () => {
  const { openReq, closedReq } = makePair();
  const result = store.mergeRequests(profile, openReq.id, closedReq.id);
  assert.equal(result.request.status, 'closed', 'hedef kapalıysa birleşme sonrası da kapalı kalmalı');
  assert.equal(result.request.items.length, 2, 'iki kaydın satırları birleşmeli');
  assert.equal(result.removedId, openReq.id);
});

test('v7.12 kapalı kayıt KAYNAK olarak birleşebiliyor ve retention için arşivleniyor', () => {
  const { openReq, closedReq } = makePair();
  const result = store.mergeRequests(profile, closedReq.id, openReq.id);
  assert.equal(result.request.status, 'active', 'hedef açıksa açık kalmalı');
  assert.equal(result.request.items.length, 2);
  assert.equal(result.removedId, closedReq.id);
  const remaining = store.loadStore().requests;
  const archived=remaining.find(r=>r.id===closedReq.id);
  assert.equal(Boolean(archived), true, 'kaynak retention süresince saklanmalı');
  assert.equal(archived.archived, true);
  assert.equal(archived.mergedIntoId, openReq.id);
  assert.equal(remaining.some(r => r.id === openReq.id), true, 'açık hedef kalmalı');
});

test('v6.47 iki kapalı kayıt da birleşebiliyor', () => {
  const a = store.createRequest(profile, { source: 'collection', manufacturers: [{ name: 'C', email: 'c@x.com' }], items: [{ modelKey: 'M3', manufacturer: 'C', orderCode: '3' }] });
  const b = store.createRequest(profile, { source: 'collection', manufacturers: [{ name: 'D', email: 'd@x.com' }], items: [{ modelKey: 'M4', manufacturer: 'D', orderCode: '4' }] });
  store.setStatus(profile, a.id, 'closed');
  store.setStatus(profile, b.id, 'closed');
  const result = store.mergeRequests(profile, a.id, b.id);
  assert.equal(result.request.status, 'closed');
  assert.equal(result.request.items.length, 2);
});

test('v6.47 kaynak koduna eski QUOTATION_MERGE_CLOSED reddi kalmamış', () => {
  const src = fs.readFileSync(path.join(ROOT, 'server', 'lib', 'quotations-store.js'), 'utf8');
  assert.doesNotMatch(src, /QUOTATION_MERGE_CLOSED/);
  assert.doesNotMatch(src, /Kapalı quotation kayıtları birleştirilemez/);
});

test('v6.47 sahiplik/erişim kontrolü hâlâ geçerli (yalnız statü kısıtlaması kalktı)', () => {
  // Kullanıcı "tam serbest" dedi ama bu yetki kontrolünü DEĞİL, statü
  // kısıtlamasını hedef alıyordu; sahiplik kontrolü hâlâ çalışmalı.
  const other = { id: 'u2', role: 'user', displayName: 'Other User' };
  const mine = store.createRequest(profile, { source: 'collection', manufacturers: [{ name: 'E', email: 'e@x.com' }], items: [] });
  const theirs = store.createRequest(other, { source: 'collection', manufacturers: [{ name: 'F', email: 'f@x.com' }], items: [] });
  assert.throws(() => store.mergeRequests(profile, mine.id, theirs.id), /QUOTATION_MERGE_DENIED|sahibi/);
});

/* --------------------------------------------------------- 2) İSTEMCİ ARAYÜZÜ */

test('v6.47 sürükleme yetkisi statüden bağımsız, erişim yetkisine bağlı', () => {
  assert.match(UI, /const canDrag=qCanManageAccess\(req\);/);
  // Eski, statüye bağlı draggable ifadesi kalmamalı.
  assert.doesNotMatch(UI, /draggable="\$\{contentCanEdit\?/);
  assert.match(UI, /draggable="\$\{canDrag\?/);
});

test('v6.47/v6.51 kapalı kaydın içerik düzenleme kilidi kaldırıldı', () => {
  // v6.47'de yalnız SÜRÜKLEME statüden ayrılmıştı, içerik düzenleme
  // (contentCanEdit) hâlâ status!=='closed' şartı taşıyordu. v6.51'de
  // kullanıcı kararıyla o kilit de kaldırıldı — fiyat girişi/onay kutusu
  // artık kapalı kayıtta da açık, yalnız sahiplik/erişim kontrolü geçerli.
  assert.doesNotMatch(UI, /contentCanEdit=req\.status!=='closed'&&canEdit/);
  assert.match(UI, /contentCanEdit=canEdit;/);
  assert.match(UI, /\$\{contentCanEdit\?'':'disabled'\}/);
});

test('v6.47 sürükleme tutamacı (grip) artık kapalı-ama-yetkili kayıtlarda da görünüyor', () => {
  assert.match(UI, /\$\{canDrag\?'<span class="navDragGrip"/);
});

/* ------------------------------------------------------------------ 3) CSS */

test('v6.47 kapalı-ama-sürüklenebilir kayıtlarda imleç grab kalıyor', () => {
  // .quotationNavItem.isClosed{cursor:default} iki sınıflı olduğu için
  // .navSortableItem{cursor:grab}'i (tek sınıf) özgüllükte ezip YANLIŞ bir
  // "tıklanamaz" imleci gösteriyordu.
  assert.match(CSS, /\.quotationNavItem\.isClosed:not\(\.navSortableItem\)\{cursor:default;\}/);
  assert.doesNotMatch(CSS, /\.quotationNavItem\.isClosed\{cursor:default;\}/);
});
