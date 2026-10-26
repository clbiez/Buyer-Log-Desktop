'use strict';

/* v7.0.175 — SÜTUN EN/TR GÖRÜNEN ADLARI + VERİ KAYNAĞI.
 *
 * Kullanıcı isteği: CP / Orders / Koleksiyon'da sistemden gelen sütunların
 * adını kullanıcı dilerse değiştirebilsin (ör. "In Store" → "MB Month"),
 * verinin veri tabanındaki hangi sütundan geldiğini görebilsin; eski (sistem)
 * sütunlar da sonradan eklenenler gibi Columns panelinden düzenlenebilsin.
 * Adlar EN ve TR olarak girilir; sonradan eklenen sütunlarda da.
 *
 * Korunan kusurlar:
 *  1) Ad YALNIZ GÖRÜNÜMDÜR: veri anahtarı, filtre, formül referansı değişmez.
 *  2) Kişisel ad başka kullanıcıyı etkilemez (kullanıcı kapsamlı depo).
 *  3) Kanonik etiket katmanı kullanıcının verdiği adı ezmez.
 *  4) Sonradan eklenen sütunun EN/TR adı sunucuda düşmez.
 *  5) Kaynak kataloğu CP sütun listesinin gerisinde kalmaz.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
const APP = read('public/app-main.js');
const names = require('../public/column-display-names.js');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-column-names-'));
process.env.BUYER_LOG_SERVER_DATA_ROOT = path.join(root, 'server');
process.env.BUYER_LOG_DATA_ROOT = path.join(root, 'app');
process.env.BUYER_LOG_LOCAL_DATA_ROOT = path.join(root, 'local');
process.env.BUYER_LOG_CONFIG_PATH = path.join(root, 'config.json');
const db = require('../server/db');
const writer = require('../server/lib/data-domain/source-writer');
test.after(() => fs.rmSync(root, { recursive: true, force: true }));

function memoryStorage() {
  const map = new Map();
  return { getItem: key => (map.has(key) ? map.get(key) : null), setItem: (key, value) => map.set(key, String(value)), map };
}
function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} bulunmalı`);
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    if (source[i] === '}') { depth -= 1; if (depth === 0) return source.slice(start, i + 1); }
  }
  assert.fail(`${name} kapanmıyor`);
}

/* ------------------------------------------------ 1) KİŞİSEL AD DEPOSU */

test('kişisel ad EN/TR ayrı saklanır ve yalnız o dilde sistem adının önüne geçer', () => {
  const storage = memoryStorage();
  const store = names.createStore(storage);
  store.set('koleksiyon', 'inStore', { en: 'MB Month', tr: '' }, { en: 'In Store', tr: 'Mağazaya Giriş' });
  assert.equal(store.resolve('koleksiyon', 'inStore', 'en', 'In Store'), 'MB Month');
  assert.equal(store.resolve('koleksiyon', 'inStore', 'tr', 'Mağazaya Giriş'), 'Mağazaya Giriş',
    'boş bırakılan dil sistem adını göstermeli');
  // Kullanıcı kapsamlı ve hesapla senkron önek: lcw.table.columnState.
  assert.equal(names.STORAGE_KEY.indexOf('lcw.table.columnState.'), 0);
  assert.deepEqual(JSON.parse(storage.map.get(names.STORAGE_KEY)), { koleksiyon: { inStore: { en: 'MB Month', tr: '' } } });
});

test('sistem adıyla aynı yazılan dil saklanmaz; ikisi de aynıysa kayıt silinir', () => {
  const store = names.createStore(memoryStorage());
  const defaults = { en: 'MB', tr: 'Model Bütçe' };
  store.set('cp', 'In-Store (Model Budget)', { en: 'MB', tr: 'Model Bütçe' }, defaults);
  assert.equal(store.has('cp', 'In-Store (Model Budget)'), false);
  store.set('cp', 'In-Store (Model Budget)', { en: 'MB Month', tr: 'Model Bütçe' }, defaults);
  assert.deepEqual(store.get('cp', 'In-Store (Model Budget)'), { en: 'MB Month', tr: '' });
  store.clear('cp', 'In-Store (Model Budget)');
  assert.equal(store.resolve('cp', 'In-Store (Model Budget)', 'en', 'MB'), 'MB');
});

test('tablolar birbirinden bağımsızdır; tanımsız tablo ve bozuk kayıt yok sayılır', () => {
  const storage = memoryStorage();
  storage.setItem(names.STORAGE_KEY, JSON.stringify({ cp: { Season: { en: '  Sezon X ', tr: '' }, Bad: 'x' }, ship: { a: { en: 'y' } } }));
  const store = names.createStore(storage);
  assert.equal(store.resolve('cp', 'Season', 'en', 'Season'), 'Sezon X');
  assert.equal(store.resolve('orders', 'Season', 'en', 'Season'), 'Season');
  assert.equal(store.get('cp', 'Bad'), null);
  assert.equal(store.set('ship', 'a', { en: 'z' }), null, 'yalnız CP / Orders / Koleksiyon');
});

test('depo dışarıdan (hesap eşitlemesi) değişince yeni değer okunur', () => {
  const storage = memoryStorage();
  const store = names.createStore(storage);
  assert.equal(store.resolve('cp', 'Buyer', 'tr', 'Buyer'), 'Buyer');
  storage.setItem(names.STORAGE_KEY, JSON.stringify({ cp: { Buyer: { tr: 'Alıcı' } } }));
  assert.equal(store.resolve('cp', 'Buyer', 'tr', 'Buyer'), 'Alıcı');
});

/* ---------------------------------- 2) SONRADAN EKLENEN SÜTUN TANIMLARI */

test('ortak tanım EN/TR taşır; label geriye dönük kimlik olarak TR (yoksa EN) olur', () => {
  const def = names.withDefinitionLabels({ id: 'n1', label: 'Eski' }, { en: 'Quality', tr: 'Kalite' });
  assert.equal(def.label, 'Kalite');
  assert.equal(names.definitionLabel(def, 'en'), 'Quality');
  assert.equal(names.definitionLabel(def, 'tr'), 'Kalite');
  const enOnly = names.withDefinitionLabels({ id: 'n2' }, { en: 'Risk', tr: '' });
  assert.equal(enOnly.label, 'Risk');
  assert.equal(names.definitionLabel(enOnly, 'tr'), 'Risk', 'boş dil diğer dile düşer');
  assert.equal(names.definitionLabel({ label: 'Legacy' }, 'en'), 'Legacy', 'eski kayıtlar label ile çalışır');
});

test('sunucu: not sütunu ve DB sütunu EN/TR adlarını kaydeder', () => {
  const notes = db.normalizeNoteColumnDefs([{ id: 'q1', label: 'Kalite', labelEn: ' Quality ', labelTr: 'Kalite' }, { id: 'q2', label: 'Risk' }]);
  assert.equal(notes[0].labelEn, 'Quality');
  assert.equal(notes[0].labelTr, 'Kalite');
  assert.ok(!('labelEn' in notes[1]), 'boş dil kaydedilmez');

  const items = db.replaceModelConnections([
    { id: 'mc_asas', name: 'ASAS', server: 's', catalog: 'a', role: 'asas', refreshEnabled: true,
      scopes: [{ id: 'sc_a', targets: ['cp'], enabled: true, horizon: {} }],
      cpColumns: [{ id: 'cpx1', label: 'Statü', table: 'ASAS', name: 'STATU', kind: 'column' }] },
  ], null).items;
  const added = writer.planCpColumn(items, {
    sourceId: 'mc_asas', op: 'add', label: 'Fabrika', labelEn: 'Factory', labelTr: 'Fabrika',
    entry: { kind: 'column', table: 'ASAS', name: 'FABRIKA' },
  });
  assert.equal(added.ok, true, added.message);
  const savedItems = db.replaceModelConnections(added.items, null).items;
  let saved = savedItems.find(item => item.id === 'mc_asas');
  const column = saved.cpColumns.find(item => item.label === 'Fabrika');
  assert.equal(column.labelEn, 'Factory');
  assert.equal(column.labelTr, 'Fabrika');

  // Veri Yönetimi ekranı labelEn/labelTr göndermeden günceller: mevcut adlar korunur.
  const updated = writer.planCpColumn(savedItems, { sourceId: 'mc_asas', op: 'update', id: column.id, label: 'Fabrika', group: 'ASAS' });
  assert.equal(updated.ok, true, updated.message);
  saved = db.replaceModelConnections(updated.items, null).items.find(item => item.id === 'mc_asas');
  assert.equal(saved.cpColumns.find(item => item.id === column.id).labelEn, 'Factory');
});

test('PATCH ucu cpColumn.labelEn/labelTr alanlarını yazıcıya geçirir', () => {
  const server = read('server/server.js');
  assert.match(server, /labelEn: body\.cpColumn\.labelEn,\s*labelTr: body\.cpColumn\.labelTr,/);
});

/* --------------------------------------------------- 3) VERİ KAYNAĞI */

test('"In Store" (MB) sütununun ASAS alanı ve Veri Yönetimi eşlemesindeki fiziksel sütunu gösterilir', () => {
  const info = names.sourceFor('cp', { k: 'In-Store (Model Budget)' });
  assert.equal(info.kind, 'asas');
  assert.equal(info.field, 'Model Bütçe Tarih Yıl Ay Gün');
  const rows = names.describeSource(info, 'tr', { mapping: { 'Model Bütçe Tarih Yıl Ay Gün': { table: 'Sipariş', name: 'MB_TARIH', kind: 'column' } } });
  assert.deepEqual(rows.map(row => row.value), ['ASAS (Data Model)', 'Model Bütçe Tarih Yıl Ay Gün', "'Sipariş'[MB_TARIH]"]);
});

test('DB sütunu, Koleksiyon alanı ve formül sütunu kendi kaynağını anlatır', () => {
  const db = names.describeSource(names.sourceFor('cp', { k: '__CPX_x', modelCustom: true, sourceTable: 'ASAS', sourceName: 'FABRIKA', role: 'asas', connectionName: 'Main' }), 'en');
  assert.ok(db.some(row => row.value === "'ASAS'[FABRIKA]"));
  const kol = names.describeSource(names.sourceFor('koleksiyon', { k: 'inStore' }), 'en');
  assert.ok(kol.some(row => row.value === 'inStore'));
  const formula = names.describeSource(names.sourceFor('cp', { k: '__f_1', formulaCustom: true, formulaDef: { formula: '[OPD]-[Ex-factory]' } }), 'tr');
  assert.ok(formula.some(row => row.value === '[OPD]-[Ex-factory]'));
});

test('kaynak kataloğu CP sistem sütunlarının tamamını kapsar', () => {
  const block = APP.slice(APP.indexOf('const CP_COLS = ['), APP.indexOf('const ORDERS_COLS'));
  const keys = [...block.matchAll(/\{k:'([^']+)'/g)].map(match => match[1]);
  assert.ok(keys.length > 40);
  keys.filter(key => key !== '__personalOrderNote').concat(['Active/Inactive']).forEach(key => assert.ok(names.CP_SOURCES[key], `${key} için kaynak tanımı yok`));
  // Private notes are virtual/account-private fields, not an ASAS source mapping.
  // Protect both the classification and bilingual privacy explanation instead.
  assert.ok(keys.includes('__personalOrderNote'), 'CP personal note column must remain in the schema');
  const personal = names.sourceFor('cp', { k: '__personalOrderNote', personalNote: true });
  assert.equal(personal.kind, 'buyerlog');
  assert.match(personal.note.tr, /kişisel|size ait/i);
  assert.match(personal.note.en, /personal|owned by you/i);
});

/* ----------------------------------------- 4) ARAYÜZ BAĞLANTILARI */

test('CP/Orders başlığı kişisel adı ve sonradan eklenen sütunun EN/TR adını kullanır', () => {
  const label = extractFunction(APP, 'tableColumnLabel');
  assert.match(label, /BLColumnNames\.resolve\(tableKey,c\.k,appLang,fallback\)/);
  const defaults = extractFunction(APP, 'tableColumnDefaultLabel');
  assert.match(defaults, /c\.modelCustom\|\|c\.noteCustom\|\|c\.personalNote\|\|c\.formulaCustom/);
  assert.match(defaults, /BLColumnNames\.definitionLabel\(def,appLang\)/);
});

test('Columns paneli: sistem sütunları kalem düğmesiyle düzenlenir (CP/Orders ve Koleksiyon)', () => {
  const cp = extractFunction(APP, 'renderColPanel');
  assert.match(cp, /data-col-label-edit="\$\{escapeHtml\(c\.k\)\}"/);
  assert.match(cp, /editSystemColumnLabel\(tableKey,c,\{onChange:refreshCpPanel\}\)/);
  const kol = extractFunction(APP, 'renderKolColumnPanel');
  assert.match(kol, /data-label-edit="\$\{escapeHtml\(c\.k\)\}"/);
  assert.match(kol, /editSystemColumnLabel\('koleksiyon',col,/);
  // Özel sütunun yeniden adlandırılması da EN/TR ve ortak kayıt (v7.0.229: panel ve
  // Alanlar çekmecesi aynı kolRenameCustomColumn yolunu kullanır).
  const rename = extractFunction(APP, 'kolRenameCustomColumn');
  assert.match(rename, /promptBilingualColumnName\(/);
  assert.match(rename, /kolQueueWorkspaceSave\(\)/);
  const drawer = extractFunction(APP, 'tableFieldsRenameColumn');
  assert.match(drawer, /editSystemColumnLabel\('koleksiyon',meta\.col,/);
  assert.match(drawer, /void editSystemColumnLabel\(tableKey,meta\.col,\{onChange:done\}\)/);
});

test('sonradan eklenen sütunlar EN/TR adla oluşturulur', () => {
  assert.match(extractFunction(APP, 'kolAddCustomColumn'), /promptBilingualColumnName\(/);
  assert.match(extractFunction(APP, 'addCpNoteColumn'), /BLColumnNames\.withDefinitionLabels\(\{id\},pair\)/);
  assert.match(extractFunction(APP, 'openCpModelColumnModal'), /op:'add',label,labelEn,labelTr,group,entry/);
  const formula = read('public/formula-columns.js');
  assert.match(formula, /data-fc-label-en/);
  assert.match(formula, /labelEn: clean\(labelEnInput\.value\)/);
  assert.match(APP, /\.\.\.\(entry\.labelEn\?\{labelEn:/, 'Koleksiyon özel sütun normalizasyonu EN adı düşürmemeli');
});

test('kanonik etiket katmanı kullanıcı adlı başlığı yeniden yazmaz', () => {
  const labels = read('public/canonical-column-labels.js');
  assert.match(labels, /header\.closest\('\[data-bl-user-label\]'\)\)return 0;/);
  assert.match(APP, /tableColumnHasUserLabel\(tableKey,c\)\?' data-bl-user-label="1"':''/);
  assert.match(APP, /const userLabelAttr=kolColumnHasUserLabel\(d\.col\)\?' data-bl-user-label="1"':'';/);
});

test('modül app-main.js\'ten önce yüklenir', () => {
  const html = read('public/index.html');
  const at = html.indexOf('src="column-display-names.js');
  assert.ok(at > 0);
  assert.ok(at < html.indexOf('src="app-main.js'));
});
