'use strict';

// v5.97 — Koleksiyon geri dönüşüm kutusu (30 gün).
//
// Kullanıcı: "Herhangi bir aşamada silinen kayıt 30 gün saklansın. Modele dair
// TÜM kayıtlar saklansın; Pricing History ve confirmed price/supplier verileri
// çok önemli." Çakışma durumunda ENGELLEME değil UYARI istendi.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
process.env.BUYER_LOG_SERVER_DATA_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'bl-bin-'));
const bin = require('../server/lib/collection-recycle-bin');
const APP = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');
const HTML = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const SERVER = fs.readFileSync(path.join(ROOT, 'server', 'server.js'), 'utf8');

test.after(() => fs.rmSync(process.env.BUYER_LOG_SERVER_DATA_ROOT, { recursive: true, force: true }));

const RICH_ROW = {
  id: 42, plmId: 'PLM-1', modelName: 'TSHIRT A', season: '26SS',
  confirmedSupplier: 'ACME', confirmedFob: 4.25, targetPrice: 3.9,
  notes: 'elle girilen not', customCol7: 'x', img: 'data:image/png;base64,AAA',
};

test('v5.97 silinen satır TÜM alanlarıyla saklanıyor', () => {
  const now = Date.parse('2026-08-13T00:00:00.000Z');
  bin.addEntries('owner-a', [{ rowId: 42, plmId: 'PLM-1', modelName: 'TSHIRT A', season: '26SS', row: RICH_ROW }], { deletedBy: 'u1', deletedByName: 'Gökberk' }, now);
  const entry = bin.loadBin('owner-a', now).entries[0];
  // Alan seçmek, ileride eklenen bir alanın sessizce kaybolması demekti.
  assert.deepEqual(entry.row, RICH_ROW);
  assert.equal(entry.row.confirmedFob, 4.25, 'confirmed FOB korunmalı');
  assert.equal(entry.row.confirmedSupplier, 'ACME');
  assert.equal(entry.rowId, 42, 'Pricing History bağı satır kimliğinden gelir');
  assert.equal(entry.deletedByName, 'Gökberk');
  assert.ok(entry.entryId, 'her silme ayrı bir kayıt kimliği almalı');
});

test('v5.97 kayıt kimliği satır kimliğinden ayrı', () => {
  const now = Date.parse('2026-08-13T00:00:00.000Z');
  bin.addEntries('owner-dup', [{ rowId: 7, row: { id: 7 } }], {}, now);
  bin.addEntries('owner-dup', [{ rowId: 7, row: { id: 7 } }], {}, now + 1000);
  const entries = bin.loadBin('owner-dup', now + 2000).entries;
  // Aynı satır silinip geri yüklendikten sonra tekrar silinebilir.
  assert.equal(entries.length, 2);
  assert.notEqual(entries[0].entryId, entries[1].entryId);
});

test('v5.97 30 günü geçen kayıt okuma anında düşüyor', () => {
  const now = Date.parse('2026-08-13T00:00:00.000Z');
  const owner = 'owner-b';
  bin.addEntries(owner, [{ rowId: 1, plmId: 'ESKI', row: { id: 1 } }], {}, now - 31 * 86400000);
  bin.addEntries(owner, [{ rowId: 2, plmId: 'YENI', row: { id: 2 } }], {}, now - 29 * 86400000);
  const result = bin.loadBin(owner, now);
  assert.deepEqual(result.entries.map(e => e.plmId), ['YENI']);
  assert.equal(result.purged, 1);
  assert.equal(result.retentionDays, 30);
  // Temizlik kalıcı olmalı: ikinci okumada tekrar düşürülecek bir şey kalmaz.
  assert.equal(bin.loadBin(owner, now).purged, 0);
});

test('v5.97 sınır tam 30 günde henüz dolmuyor', () => {
  const now = Date.parse('2026-08-13T00:00:00.000Z');
  assert.equal(bin.isExpired({ deletedAt: new Date(now - 30 * 86400000).toISOString() }, now), false);
  assert.equal(bin.isExpired({ deletedAt: new Date(now - 30 * 86400000 - 1000).toISOString() }, now), true);
  // Bozuk tarih kaydı silinmemeli: veri kaybı, fazladan saklamaktan kötüdür.
  assert.equal(bin.isExpired({ deletedAt: 'bozuk' }, now), false);
});

test('v5.97 en son silinen en üstte listeleniyor', () => {
  const now = Date.parse('2026-08-13T00:00:00.000Z');
  const owner = 'owner-c';
  bin.addEntries(owner, [{ rowId: 1, plmId: 'ILK', row: {} }], {}, now - 5000);
  bin.addEntries(owner, [{ rowId: 2, plmId: 'SON', row: {} }], {}, now - 1000);
  assert.deepEqual(bin.loadBin(owner, now).entries.map(e => e.plmId), ['SON', 'ILK']);
});

test('v5.97 geri yükleme kaydı kutudan çıkarıyor ve içeriği döndürüyor', () => {
  const now = Date.parse('2026-08-13T00:00:00.000Z');
  const owner = 'owner-d';
  bin.addEntries(owner, [{ rowId: 9, plmId: 'A', row: { id: 9, confirmedFob: 1.5 } }, { rowId: 10, plmId: 'B', row: { id: 10 } }], {}, now);
  const ids = bin.loadBin(owner, now).entries.map(e => e.entryId);
  const result = bin.takeEntries(owner, [ids[0]], now);
  assert.equal(result.taken.length, 1);
  assert.equal(result.taken[0].row.confirmedFob !== undefined || result.taken[0].row.id !== undefined, true);
  assert.equal(result.bin.entries.length, 1, 'geri yüklenen kayıt kutuda kalmamalı');
  // Bilinmeyen kimlik hiçbir şeyi silmemeli.
  assert.equal(bin.takeEntries(owner, ['yok'], now).bin.entries.length, 1);
  assert.deepEqual(bin.takeEntries(owner, [], now).taken, []);
});

test('v5.97 kutular sahibe göre ayrı', () => {
  const now = Date.parse('2026-08-13T00:00:00.000Z');
  bin.addEntries('owner-x', [{ rowId: 1, plmId: 'X', row: {} }], {}, now);
  assert.equal(bin.loadBin('owner-y', now).entries.length, 0);
  assert.equal(bin.loadBin('owner-x', now).entries.length, 1);
});

test('v5.97 silme yalnız geri dönüşüm kaydı güvenceye alındıktan sonra tamamlanıyor', () => {
  const block = APP.slice(APP.indexOf('async function kolArchiveDeletedRows'), APP.indexOf('function kolBinDaysLeft'));
  // Sessizce kaybetmek en kötüsü: hata yutulmuyor, kullanıcıya söyleniyor.
  assert.match(block, /geri dönüşüm kutusuna alınamadı/);
  assert.match(block, /return false;/);
  const deleteStart = APP.indexOf("document.getElementById('kolDelRowBtn')?.addEventListener");
  const deleteBlock = APP.slice(deleteStart, APP.indexOf("['kolSearch']", deleteStart));
  // Kutuya alma başarısızsa satır ve dosyalar yerinde kalmalı.
  assert.match(deleteBlock, /const archived=await kolArchiveDeletedRows\(removedRows,'manual'\);/);
  assert.match(deleteBlock, /if\(!archived\)throw new Error/);
  assert.ok(deleteBlock.indexOf('kolArchiveDeletedRows') < deleteBlock.indexOf('kolRows=kolRows.filter'));
  // Yardımcı dosya temizliği ancak geri alınabilir kayıt ve yerel satır silme
  // kesinleştikten sonra yapılmalı.
  assert.ok(deleteBlock.indexOf('kolRows=kolRows.filter') < deleteBlock.indexOf('kolPurgeStoredModelFiles'));
});

test('v5.97 çakışmada engelleme değil UYARI var', () => {
  const start = APP.indexOf("restoreBtn.addEventListener('click'");
  const block = APP.slice(start, APP.indexOf('  load();', start));
  // Aynı PLM ID meşru şekilde iki satırda bulunabilir; karar kullanıcının.
  assert.match(block, /const clashing=picked\.filter\(entry=>entry\.plmId&&livePlm\.has/);
  assert.match(block, /window\.confirm\(message\)/);
  assert.match(block, /ikinci bir satır oluşturur/);
  // Geri yüklenen satır YENİ kimlik almalı: eski kimlik başka satıra verilmiş olabilir.
  assert.match(block, /row\.id=kolNextId\+\+;/);
  // Geri alma zincirine girmeli ki kullanıcı vazgeçebilsin.
  assert.match(block, /kolPushUndo\(\);/);
  // Listede çakışan satır ayrıca işaretlenmeli.
  assert.match(APP, /kolBinConflict/);
  assert.match(APP, /Bu PLM ID ile hâlâ bir model var/);
});

test('v5.97 uç noktalar ve düğme yerinde', () => {
  assert.match(SERVER, /app\.get\('\/api\/collection-recycle-bin\/:ownerId'/);
  assert.match(SERVER, /app\.post\('\/api\/collection-recycle-bin\/:ownerId\/restore'/);
  assert.match(SERVER, /app\.post\('\/api\/collection-recycle-bin\/:ownerId\/purge'/);
  // Okumak için erişim, geri yüklemek için DÜZENLEME yetkisi.
  assert.match(SERVER, /collectionBinAccess\(req, res, false\)/);
  assert.match(SERVER, /collectionBinAccess\(req, res, true\)/);
  assert.match(HTML, /id="kolRecycleBinBtn"/);
});
