'use strict';

/* v10.84 — CP/ORDERS: KULLANICI TANIMLI BOŞ NOT SÜTUNLARI (Packet 9).
 *
 * Collection'da (kolCustomCols/kolAddCustomColumn) bu özellik zaten vardı.
 * CP/Orders'ta yoktu: DB-bağlı "Add Column" (openCpModelColumnModal) yalnız
 * ASAS/IAS'tan salt-okunur sütun getirebiliyordu. Bu paket, notesmap ile
 * AYNI desende ("sipariş+model+renk anahtarı, ham ASAS'a yazma yok") ikinci
 * bir depo (overrides.noteColumnDefs/noteColumnValues) ekler; hücreler
 * mevcut genel CP metin hücresi/commitCpEditor yolunu OLDUĞU GİBİ kullanır.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
const APP = read('public/app-main.js');
const SERVER = require('./helpers/server-source')();

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-note-columns-'));
process.env.BUYER_LOG_SERVER_DATA_ROOT = path.join(root, 'server');
process.env.BUYER_LOG_DATA_ROOT = path.join(root, 'app');
process.env.BUYER_LOG_LOCAL_DATA_ROOT = path.join(root, 'local');
process.env.BUYER_LOG_CONFIG_PATH = path.join(root, 'config.json');
const db = require('../server/db');
const parseLib = require('../server/lib/parse');
test.after(() => fs.rmSync(root, { recursive: true, force: true }));

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}`);
  assert.ok(start >= 0, `${name} bulunmalı`);
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  assert.fail(`${name} kapanmıyor`);
}

/* ------------------------------------------------------- 1) SUNUCU: TANIMLAR */

test('normalizeNoteColumnDefs: id temizlenir, ad/id çakışması elenir, 40 ile sınırlanır', () => {
  const out = db.normalizeNoteColumnDefs([
    { id: 'a 1!', label: '  Kalite Notu  ' },
    { id: 'a1', label: 'kalite notu' }, // aynı ad (normalize edilince) — elenir
    { id: '', label: 'İkinci Sütun' },
    { label: '' }, // etiketsiz — elenir
  ]);
  assert.equal(out.length, 2);
  assert.equal(out[0].id, 'a1');
  assert.equal(out[0].label, 'Kalite Notu');
  assert.ok(out[1].id, 'etiketsiz id otomatik üretilir');
});

test('replaceNoteColumnDefs: revizyon kontrolü yapar, kaydeder, silinen sütunun değerlerini temizler', () => {
  const userId = 'note-col-user';
  const first = db.replaceNoteColumnDefs([{ id: 'q1', label: 'Kalite' }], null);
  assert.equal(first.revision, 1);
  assert.deepEqual(first.columns.map(c => c.id), ['q1']);

  // Eski revizyonla yazmak reddedilmeli.
  assert.throws(() => db.replaceNoteColumnDefs([{ id: 'q1', label: 'Kalite' }], 0));

  // Bir değer yaz, sonra sütunu kaldır: değer de gitmeli (hayalet veri kalmamalı).
  db.patchOrderOverride(100, { noteColumns: { q1: 'iyi' } }, null, null);
  let ov = db.loadOverrides();
  assert.equal(ov.noteColumnValues['100'] && ov.noteColumnValues['100'].q1, 'iyi');

  const second = db.replaceNoteColumnDefs([], first.revision);
  assert.equal(second.columns.length, 0);
  ov = db.loadOverrides();
  assert.ok(!ov.noteColumnValues['100'], 'sütun silinince değeri de silinmeli');
});

/* ------------------------------------------------------ 2) SUNUCU: DEĞERLER */

test('patchOrderOverride: noteColumns notesmap ile aynı anahtar/seed desenini kullanır', () => {
  db.replaceNoteColumnDefs([{ id: 'risk', label: 'Risk' }], null);
  const saved = db.patchOrderOverride(200, { noteColumns: { risk: 'yüksek' } }, null, null);
  assert.equal(saved.overrides.noteColumnValues['200'].risk, 'yüksek');
  // Bilinmeyen/silinmiş bir id sessizce yok sayılır.
  const saved2 = db.patchOrderOverride(200, { noteColumns: { risk: 'düşük', hayalet: 'x' } }, saved.revision, null);
  assert.equal(saved2.overrides.noteColumnValues['200'].risk, 'düşük');
  assert.ok(!('hayalet' in saved2.overrides.noteColumnValues['200']));
  // Boş metin, notesmap'teki alan silme davranışıyla tutarlı: kayıt temizlenir.
  const saved3 = db.patchOrderOverride(200, { noteColumns: { risk: '' } }, saved2.revision, null);
  assert.ok(!saved3.overrides.noteColumnValues['200'] || !('risk' in saved3.overrides.noteColumnValues['200']));
});

test('buildOrderRowsFromASAS: not sütunu değeri satıra yazılır, ham ASAS alanları bozulmaz', () => {
  db.replaceNoteColumnDefs([{ id: 'kalite', label: 'Kalite' }], null);
  db.patchOrderOverride(300, { noteColumns: { kalite: 'A sınıfı' } }, null, null);
  const overrides = db.loadOverrides();
  const asasOrders = [{ ocode: 300, kalan: 10, model: 'Model X', ccode: 'C1', fob: 5, season: '26S', countryRaw: 'Türkiye' }];
  const rows = parseLib.buildCPRowsFromASAS(asasOrders, {}, overrides);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kalite, 'A sınıfı');
  assert.equal(rows[0]['Order Code'], 300, 'ham ASAS alanı etkilenmemeli');
});

/* --------------------------------------------------------------- 3) SUNUCU ROTALARI */

test('rotalar tanımlı: GET/PUT /api/note-columns, uygun alan yetkisiyle', () => {
  assert.match(SERVER, /app\.get\('\/api\/note-columns', userAccess\.requireAnyArea\('cp', 'orders'\)/);
  assert.match(SERVER, /app\.put\('\/api\/note-columns', userAccess\.requireArea\('cp'\)/);
});

test('artımlı proje önbelleği yaması noteColumns alanını da uyguluyor', () => {
  assert.match(SERVER, /'imageRef','noteColumns'\]\);/, 'ROW_PATCH_INCREMENTAL_KEYS noteColumns içermeli');
  const fn = extractFunction(SERVER, 'applyIncrementalProjectionPatch');
  assert.match(fn, /if \(patch\.noteColumns && typeof patch\.noteColumns === 'object'\) \{/);
  assert.match(fn, /row\[id\] = value == null \? '' : String\(value\);/);
});

test('başlangıç yükü not sütunu tanımlarını ve revizyonunu taşıyor', () => {
  assert.match(SERVER, /noteColumns: Array\.isArray\(overrides\.noteColumnDefs\) \? overrides\.noteColumnDefs : \[\],/);
  assert.match(SERVER, /noteColumnDefs: Number\(overrides\._revisions&&overrides\._revisions\.noteColumnDefs\)\|\|0/);
});

/* ------------------------------------------------------------- 4) İSTEMCİ */

test('syncCpNoteColumns: CP_COLS içine dinamik metin sütunu ekler, Orders\'a miras bırakır', () => {
  const fn = extractFunction(APP, 'syncCpNoteColumns');
  assert.match(fn, /type:'text'/);
  assert.match(fn, /noteCustom:true/);
  assert.match(fn, /syncOrdersColumnsFromCp\(\);/);
});

test('addCpNoteColumn/renameCpNoteColumn/removeCpNoteColumn mevcut PUT akışını kullanır, ikinci bir sistem kurmaz', () => {
  assert.match(APP, /fetch\('\/api\/note-columns',\{method:'PUT'/);
  const add = extractFunction(APP, 'addCpNoteColumn');
  assert.doesNotMatch(add, /\b(?:window\.)?prompt\s*\(/);
  // v7.0.175: EN/TR başlık diyaloğu da uygulama içi modaldır (yerel prompt yok).
  assert.match(add, /await promptBilingualColumnName\(/);
  assert.match(add, /saveCpNoteColumnDefs\(/);
  const remove = extractFunction(APP, 'removeCpNoteColumn');
  assert.match(remove, /Values entered in this column will be lost/);
});

test('renderColPanel: Add Note Column düğmesi CP ve Orders panelinde basılıyor, rename/drop bağlanıyor', () => {
  const fn = extractFunction(APP, 'renderColPanel');
  assert.match(fn, /\(tableKey==='cp'\|\|tableKey==='orders'\)\?`<button type="button" class="colPanelAdd" id="cpAddNoteColumnBtn">/);
  assert.match(fn, /c\.noteCustom\) return `<div class="colPanelItem isCustomCol">/);
  assert.match(fn, /addCpNoteColumn\(refreshCpPanel\)/);
  assert.match(fn, /renameCpNoteColumn\(btn\.dataset\.noteColEdit,refreshCpPanel\)/);
  assert.match(fn, /removeCpNoteColumn\(btn\.dataset\.noteColDrop,refreshCpPanel\)/);
});

test('syncOverridesFromRow: not sütunu değerleri notesmap ile aynı anahtarla tutulur', () => {
  const fn = extractFunction(APP, 'syncOverridesFromRow');
  assert.match(fn, /if\(CP_NOTE_COLUMN_DEFS\.length\)\{/);
  assert.match(fn, /state\.overrides\.noteColumnValues\[key\]=bucket;/);
});

test('syncOverrideToServer: noteColumns yalnız tanımlı sütun varsa gövdeye eklenir', () => {
  const fn = extractFunction(APP, 'syncOverrideToServer');
  assert.match(fn, /if\(CP_NOTE_COLUMN_DEFS\.length\)\{/);
  assert.match(fn, /body\.noteColumns=noteBucket;/);
});

test('hücre düzenleme ikinci bir yol açmıyor: type:\'text\' zaten genel editCell/commitCpEditor akışını kullanıyor', () => {
  // v10.9 notu: yeni sütun türü cellHtml/case \'text\' dalına EK bir kod
  // eklemeden çalışır — bu, hiçbir yeni özel-durum dalının eklenmediğini çivi.
  const cellHtml = extractFunction(APP, 'cellHtml');
  assert.ok(!cellHtml.includes('noteCustom'), 'cellHtml sütun türüne özel dallanmamalı; mevcut type:\'text\' dalı yeterli');
});
