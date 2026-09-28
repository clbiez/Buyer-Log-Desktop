'use strict';

/* Ön Ayar Paylaşımı — kullanıcı başka bir kullanıcının kişisel görünüm
 * ayarlarını (Horizon, Focus/Extended, sütun düzeni, oluşturulan sütunlar,
 * kayıtlı görünümler) KENDİ çalışma alanına alır. Kaynak kaydı değişmez,
 * seçilmeyen alanlara dokunulmaz ve son aktarım geri alınabilir. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-preset-share-'));
process.env.BUYER_LOG_SERVER_DATA_ROOT = path.join(root, 'server-data');
process.env.BUYER_LOG_DATA_ROOT = path.join(root, 'app-data');
process.env.BUYER_LOG_LOCAL_DATA_ROOT = path.join(root, 'local-data');
process.env.BUYER_LOG_CONFIG_PATH = path.join(root, 'config.json');

const prefs = require('../server/lib/user-preferences');
const { createPresetShare, SHARE_ITEMS } = require('../server/lib/preset-share');
const read = rel => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

test.after(() => fs.rmSync(root, { recursive: true, force: true }));

function memoryProfiles() {
  const stores = new Map();
  return {
    stores,
    loadProfiles: id => ({ views: stores.get(`${id}:views`) || { items: [] }, filters: stores.get(`${id}:filters`) || { items: [] } }),
    restoreProfiles: (id, next) => { for (const [kind, store] of Object.entries(next)) stores.set(`${id}:${kind}`, JSON.parse(JSON.stringify(store))); },
  };
}
function seed(userId, values) {
  const stamp = new Date(Date.now() - 60000).toISOString();
  prefs.merge(userId, Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { value: typeof value === 'string' ? value : JSON.stringify(value), updatedAt: stamp }])));
}
const value = (userId, key) => { const entry = prefs.load(userId).entries[key]; return entry ? JSON.parse(entry.value) : undefined; };
const horizonKey = module => prefs.horizonKey(module);

test('Focus / Extended ön ayarı sunucu whitelist\'inde: hesapla taşınır ve paylaşılabilir', () => {
  assert.equal(prefs.isSyncedKey('lcw.tableViewFocus.v1'), true);
  assert.equal(prefs.categoryForKey('lcw.tableViewFocus.v1'), 'columns');
  const saved = prefs.merge('whitelist-user', { 'lcw.tableViewFocus.v1': { value: '{"cp":{"focus":["PLM ID"]}}' } });
  assert.deepEqual(saved.rejected, []);
});

test('MERGE sayfa bazlıdır: kaynağın sayfaları alınır, talep edenin diğer sayfaları ve seçilmeyen alanları korunur', () => {
  const profiles = memoryProfiles(), share = createPresetShare(profiles);
  seed('src-merge', {
    'lcw.tableViewFocus.v1': { cp: { focus: ['PLM ID', 'Buyer'], extended: ['PLM ID', 'Buyer', 'STATUS'] } },
    'lcw.table.columnState.v1': { cp: { order: ['Buyer', 'PLM ID'], hidden: [], widthPx: { Buyer: 180 } } },
    'bl.formulaColumns.cp.v1': [{ id: 'f-src', label: 'Kâr', formula: '[FOB ($)]*2' }],
    [horizonKey('cp')]: { version: 1, byConnection: { asas: { table: 'ASAS_30', seasons: ['SS27'] } } },
    'lcw.corePageFilters.auto.v1': { cp: { Buyer: ['A'] } },
  });
  seed('dst-merge', {
    'lcw.tableViewFocus.v1': { cp: { focus: ['Buyer'] }, orders: { focus: ['Order Code'] } },
    'lcw.table.columnState.v1': { orders: { order: ['Order Code'], hidden: [], widthPx: { 'Order Code': 90 } } },
    'bl.formulaColumns.cp.v1': [{ id: 'f-own', label: 'Benim', formula: '1' }],
    [horizonKey('cp')]: { version: 1, byConnection: { ias: { table: 'IAS_1', seasons: ['AW26'] } } },
    'lcw.corePageFilters.auto.v1': { orders: { Buyer: ['B'] } },
  });
  const sourceBefore = JSON.stringify(prefs.load('src-merge').entries);

  const result = share.apply({ sourceUserId: 'src-merge', targetUserId: 'dst-merge', items: ['tablePresets', 'columnLayout', 'customColumns', 'horizon'], mode: 'MERGE' });
  assert.equal(result.changed, true);

  assert.deepEqual(value('dst-merge', 'lcw.tableViewFocus.v1'), { cp: { focus: ['PLM ID', 'Buyer'], extended: ['PLM ID', 'Buyer', 'STATUS'] }, orders: { focus: ['Order Code'] } });
  assert.deepEqual(Object.keys(value('dst-merge', 'lcw.table.columnState.v1')).sort(), ['cp', 'orders']);
  assert.deepEqual(value('dst-merge', 'bl.formulaColumns.cp.v1').map(column => column.id), ['f-src', 'f-own']);
  assert.deepEqual(Object.keys(value('dst-merge', horizonKey('cp')).byConnection).sort(), ['asas', 'ias']);
  // Filtreler seçilmedi: talep edenin filtresi olduğu gibi kalır.
  assert.deepEqual(value('dst-merge', 'lcw.corePageFilters.auto.v1'), { orders: { Buyer: ['B'] } });
  // Kaynak kullanıcının kaydına hiç yazılmaz.
  assert.equal(JSON.stringify(prefs.load('src-merge').entries), sourceBefore);
});

test('REPLACE seçili alanda talep edenin kaydını bire bir kaynağınkiyle değiştirir; Geri Al önceki hâli döndürür', () => {
  const profiles = memoryProfiles(), share = createPresetShare(profiles);
  seed('src-replace', { [horizonKey('cp')]: { table: 'ASAS_30', seasons: ['SS27'] } });
  seed('dst-replace', {
    [horizonKey('cp')]: { table: 'ASAS_30', seasons: ['AW25'] },
    [horizonKey('orders')]: { table: 'ASAS_30', seasons: ['AW24'] },
    'lcw.tableViewFocus.v1': { cp: { focus: ['Buyer'] } },
  });
  const before = JSON.parse(JSON.stringify(prefs.load('dst-replace').entries));

  share.apply({ sourceUserId: 'src-replace', targetUserId: 'dst-replace', items: ['horizon'], mode: 'REPLACE' });
  assert.deepEqual(value('dst-replace', horizonKey('cp')), { table: 'ASAS_30', seasons: ['SS27'] });
  assert.equal(value('dst-replace', horizonKey('orders')), undefined, 'kaynakta olmayan Horizon REPLACE ile kalkar');
  assert.ok(prefs.load('dst-replace').deletions[horizonKey('orders')], 'silme mezar taşı bırakır; tarayıcı kopyası geri getiremez');
  assert.deepEqual(value('dst-replace', 'lcw.tableViewFocus.v1'), { cp: { focus: ['Buyer'] } }, 'seçilmeyen alan korunur');
  assert.equal(share.undoInfo('dst-replace').available, true);

  share.undo('dst-replace');
  const after = prefs.load('dst-replace').entries;
  for (const key of Object.keys(before)) assert.equal(after[key] && after[key].value, before[key].value, key);
  assert.equal(share.undoInfo('dst-replace').available, false);
  assert.throws(() => share.undo('dst-replace'), error => error.code === 'PRESET_SHARE_UNDO_EMPTY');
});

test('Kayıtlı görünümler: MERGE aynı sayfa+adı günceller, diğer görünümleri korur, kaynağın favorisini alır; geri alınabilir', () => {
  const profiles = memoryProfiles(), share = createPresetShare(profiles);
  profiles.stores.set('src-views:views', { items: [{ id: 'p1', name: 'Günlük', tableId: 'cp', data: { cols: ['a'] } }], favoriteByPage: { cp: 'p1' } });
  profiles.stores.set('dst-views:views', { items: [{ id: 'p9', name: 'günlük', tableId: 'cp', data: { cols: ['old'] } }, { id: 'p8', name: 'Kendi', tableId: 'orders', data: {} }], favoriteByPage: { orders: 'p8' } });
  seed('src-views', { lcw_view_favorite_cp: 'p1' });

  share.apply({ sourceUserId: 'src-views', targetUserId: 'dst-views', items: ['views'], mode: 'MERGE' });
  const views = profiles.stores.get('dst-views:views');
  assert.deepEqual(views.items.map(item => item.id).sort(), ['p1', 'p8']);
  assert.deepEqual(views.favoriteByPage, { orders: 'p8', cp: 'p1' });
  assert.equal(prefs.load('dst-views').entries.lcw_view_favorite_cp.value, 'p1');

  share.undo('dst-views');
  assert.deepEqual(profiles.stores.get('dst-views:views').items.map(item => item.id), ['p9', 'p8']);
  assert.equal(prefs.load('dst-views').entries.lcw_view_favorite_cp, undefined);
});

test('önizleme alan başına sayı ve sayfa listesi döner; uygulanmış Horizon hiçbir alana girmez', () => {
  const share = createPresetShare(memoryProfiles());
  seed('src-preview', {
    'lcw.tableViewFocus.v1': { cp: { focus: ['A'] }, koleksiyon: { focus: ['B'] } },
    [horizonKey('backlog')]: { table: 'T' },
    [prefs.appliedHorizonKey('backlog')]: { table: 'T' },
  });
  const items = Object.fromEntries(share.preview('src-preview').map(item => [item.id, item]));
  assert.deepEqual(Object.keys(items), SHARE_ITEMS.map(item => item.id));
  assert.deepEqual(items.tablePresets.pages, ['cp', 'koleksiyon']);
  assert.equal(items.tablePresets.count, 2);
  assert.deepEqual(items.horizon.pages, ['backlog']);
  assert.equal(items.horizon.count, 1, 'applied-horizon cihaz anlık görüntüsüdür, paylaşılmaz');
});

test('kendine aktarım ve boş seçim reddedilir', () => {
  const share = createPresetShare(memoryProfiles());
  assert.throws(() => share.apply({ sourceUserId: 'u', targetUserId: 'u', items: ['horizon'] }), error => error.code === 'PRESET_SHARE_SELF');
  assert.throws(() => share.apply({ sourceUserId: 'a', targetUserId: 'b', items: ['password', 'permissions'] }), error => error.code === 'PRESET_SHARE_ITEM_REQUIRED');
});

test('kullanıcı menüsü Ön Ayar Paylaşımı düğmesini sunar ve istemci modülü lazy yüklenir', () => {
  const ui = read('public/user-access-ui.js'), perf = read('public/perf-runtime.js'), client = read('public/preset-share.js'), server = read('server/server.js');
  assert.match(ui, /data-preset-share/);
  assert.match(ui, /Ön Ayar Paylaşımı/);
  assert.match(ui, /ensureFeature\('presetShare'\)/);
  assert.match(perf, /presetShare:\['preset-share\.js/);
  assert.match(client, /\/api\/preset-share\/users/);
  assert.match(client, /\/api\/preset-share\/apply/);
  assert.match(client, /\/api\/preset-share\/undo/);
  assert.match(server, /require\('\.\/routes\/preset-share-routes'\)/);
});

test('yazma başarısız olursa önceki geri alma kaydı korunur ve kullanıcının ayarı değişmez', () => {
  const share = createPresetShare(memoryProfiles());
  seed('src-big', { 'lcw.tableViewFocus.v1': { cp: { focus: ['A'] } } });
  seed('dst-big', { 'lcw.tableViewFocus.v1': { orders: { focus: ['B'] } } });
  const original = prefs.applyEntryChanges;
  prefs.applyEntryChanges = () => { throw Object.assign(new Error('limit'), { statusCode: 413, code: 'USER_PREFS_TOO_LARGE' }); };
  try {
    assert.throws(() => share.apply({ sourceUserId: 'src-big', targetUserId: 'dst-big', items: ['tablePresets'] }), error => error.code === 'USER_PREFS_TOO_LARGE');
  } finally { prefs.applyEntryChanges = original; }
  assert.equal(share.undoInfo('dst-big').available, false);
  assert.deepEqual(value('dst-big', 'lcw.tableViewFocus.v1'), { orders: { focus: ['B'] } });
});
