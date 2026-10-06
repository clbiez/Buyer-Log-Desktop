'use strict';

/* v7.0.229 — Alanlar (ana başlık) katmanı, CP/Orders/Koleksiyon ana başlık
   düzeni ve Koleksiyon Checklist.
   Korunan davranışlar:
   - CP / Orders / Koleksiyon sütunları kullanıcının verdiği ana başlık ve sıra
     düzeninde tanımlıdır; Sipariş Tipi ve Buying Numunesi Koleksiyon
     tablosunda sütun değildir (satırdaki alan yaşar).
   - Kayıtlı sütun sırası sürüm geçişinde korunur; yeni varsayılan yalnız daha
     önce kişisel yerleşim kaydı olmayan kullanıcıya uygulanır.
   - Alanlar katmanı Odak / Genişletilmiş tanımlarını değiştirmez; döngü
     Preset → Tümü → Gizli → Preset şeklindedir.
   - Koleksiyon Checklist maddesi yoksa Checklist başlığı oluşmaz. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
const APP = read('public/app-main.js');
const INDEX = read('public/index.html');
const plain = value => JSON.parse(JSON.stringify(value));

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} bulunmalı`);
  const open = source.indexOf('{', source.indexOf(')', start));
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
function extractConst(source, name) {
  const start = source.indexOf(`const ${name} =`) >= 0 ? source.indexOf(`const ${name} =`) : source.indexOf(`const ${name}=`);
  assert.ok(start >= 0, `${name} bulunmalı`);
  const end = source.indexOf(';\n', start);
  return source.slice(start, end + 1);
}
function columnBlock(startMarker, endMarker) {
  const block = APP.slice(APP.indexOf(startMarker), APP.indexOf(endMarker));
  return [...block.matchAll(/\{k:'([^']+)'[^\n]*?group:'([^']+)'/g)].map(match => [match[1], match[2]]);
}

test('CP ana başlıkları ve varsayılan sıra kullanıcı düzeniyle birebir', () => {
  const cols = columnBlock('const CP_COLS = [', 'const ORDERS_STATUS_COL');
  assert.deepEqual(cols, [
    ['Priority', 'Öncelik'],
    ['PLM Numune', 'PLM Numune'],
    ['Merch Marka Yaş Grup Kod', 'Marka Detayları'], ['Merch Alt Grup Kod', 'Marka Detayları'], ['Buyer Grup (TR)', 'Marka Detayları'], ['Buyer', 'Marka Detayları'],
    ['__picture', 'Model Detayları'], ['Line', 'Model Detayları'], ['Ürün Tanım', 'Model Detayları'], ['Category', 'Model Detayları'], ['PLM ID', 'Model Detayları'], ['Model Name', 'Model Detayları'], ['C.Code', 'Model Detayları'], ['Colour', 'Model Detayları'], ['Special Code', 'Model Detayları'],
    ['Season', 'Sipariş Detayları'], ['Country', 'Sipariş Detayları'], ['Manufacturer', 'Sipariş Detayları'], ['Sub-Manufacturer', 'Sipariş Detayları'], ['Order Code', 'Sipariş Detayları'], ['FOB ($)', 'Sipariş Detayları'], ['Supp. FOB', 'Sipariş Detayları'], ['Order Quantity', 'Sipariş Detayları'], ['Shipment Quantity', 'Sipariş Detayları'], ['Remaining Units', 'Sipariş Detayları'], ['%', 'Sipariş Detayları'],
    ['Licensor', 'Lisans Detayları'], ['License', 'Lisans Detayları'],
    ['Original Ex-factory', 'Tarihler'], ['OPD', 'Tarihler'], ['Ex-factory', 'Tarihler'], ['LT', 'Tarihler'], ['Retail Date', 'Tarihler'], ['Ex→Retail', 'Tarihler'], ['In-Store (Model Budget)', 'Tarihler'],
    ['Kumaş Tipi', 'Kumaş Detayları'], ['Kumaş Kategorisi', 'Kumaş Detayları'], ['Kumaşçı Ülkesi', 'Kumaş Detayları'], ['Kumaşçı', 'Kumaş Detayları'], ['Karışım', 'Kumaş Detayları'], ['İplik No', 'Kumaş Detayları'], ['Gramaj', 'Kumaş Detayları'],
    ['Del. Type', 'Lojistik'], ['STATUS', 'Lojistik'], ['Buying Son Onay Tarihi', 'Lojistik'], ['HANDOVER Tarihi', 'Lojistik'], ['Ant. Arrival', 'Lojistik'],
    ['Notes', 'Notlar'], ['Ek Not', 'Notlar'],
  ]);
  // Original Ex-F. revizyondan etkilenmeyen ASAS değeridir; iki satır üreticisi de yazar.
  assert.equal((APP.match(/'Original Ex-factory':o\.ex, 'Ex-factory':o\.ex/g) || []).length, 2);
});

test('Orders Sipariş Durumu Sipariş Detayları başlığının başında durur', () => {
  const context = { ORDERS_STATUS_COL: { k: 'Active/Inactive', group: 'Sipariş Detayları' } };
  vm.runInNewContext(`${extractFunction(APP, 'ordersColumnsFromCp')};this.fn=ordersColumnsFromCp;`, context);
  const out = context.fn([{ k: 'Priority' }, { k: 'Buyer' }, { k: 'Season' }, { k: 'Country' }]);
  assert.deepEqual(plain(out.map(c => c.k)), ['Buyer', 'Active/Inactive', 'Season', 'Country']);
});

test('Koleksiyon ana başlıkları; Sipariş Tipi ve Buying Numunesi tabloda yok, alan satırda yaşar', () => {
  const cols = columnBlock('const KOL_COLS = [', 'let kolCustomCols');
  const keys = cols.map(([key]) => key);
  assert.ok(!keys.includes('mbOrderType'));
  assert.ok(!keys.includes('buyingSampleManufacturer'));
  const groups = Object.fromEntries(cols);
  assert.deepEqual(['mag', 'mmyg', 'buyingGroup', 'buyer'].map(k => groups[k]), Array(4).fill('Marka Detayları'));
  assert.equal(groups.not, 'Notlar');
  assert.deepEqual(['licensor', 'lisans', 'royalty', 'hologramCost'].map(k => groups[k]), Array(4).fill('Lisans Detayları'));
  assert.deepEqual(['country', 'delType', 'exFactory', 'retail', 'exToRetail', 'inStore'].map(k => groups[k]), Array(6).fill('Tarihler & Sevkiyat'));
  assert.deepEqual(['targetPrice', 'fob'].map(k => groups[k]), ['Fiyatlandırma', 'Fiyatlandırma']);
  assert.deepEqual(['endeksmatik', 'ydLanded', 'trLanded'].map(k => groups[k]), Array(3).fill('Endeksmatik & Avantaj'));
  const migrate = extractFunction(APP, 'migrateKolRow');
  assert.match(migrate, /'mbOrderType'/);
  assert.match(migrate, /'buyingSampleManufacturer'/);
  // Onaylı Fiyat → Onaylı Üretici Fiyatı
  assert.match(APP, /__confirmedPrice__:\{kind:'confirmedPrice',label:'Approved Mfr\. Price',group:'Fiyatlandırma'\}/);
  assert.match(APP, /'Approved Mfr\. Price':'Onaylı Üretici Fiyatı'/);
});

test('Koleksiyon varsayılan sırası kullanıcı düzenini izler; checklist maddeleri Tarihler ile Fiyatlandırma arasındadır', () => {
  const fn = extractFunction(APP, 'kolDefaultDisplayOrder');
  const preferred = fn.slice(fn.indexOf('const preferred=['), fn.indexOf('];', fn.indexOf('const preferred=[')));
  const keys = [...preferred.matchAll(/'([^']+)'|\.\.\.checklistKeys/g)].map(match => match[1] || '...checklist');
  assert.deepEqual(keys, [
    'mag', 'mmyg', 'buyingGroup', 'buyer',
    'season', 'inStoreWeek', 'inStoreMonth', 'durum', 'productMainDefinition', 'urunTipi', 'plmId', 'modelKod', 'colourCode', 'colour', 'specialCode', 'line', 'artworkDetail', 'fabric', 'assortment', 'fit', 'quantity',
    'not',
    'licensor', 'lisans', 'royalty', 'hologramCost',
    'country', 'delType', 'exFactory', 'retail', 'exToRetail', 'inStore',
    '...checklist',
    'targetPrice', '__bestPrice__', '__confirmedName__', '__confirmedPrice__', 'fob',
    'endeksmatik', 'ydLanded', 'trLanded',
  ]);
});

test('CP / Orders layout migrasyonu kayıtlı kullanıcı sırasına dokunmaz ve yalnız sürüm damgasını yazar', () => {
  const context = {
    COLS_BY_TABLE: { cp: [{ k: 'A' }, { k: 'B' }, { k: 'C' }], orders: [{ k: 'S' }, { k: 'A' }] },
  };
  vm.runInNewContext(`${extractConst(APP, 'CP_ORDERS_COLUMN_LAYOUT_VERSION')}const COLUMN_LAYOUT_REGROUP=new Set();${extractFunction(APP, 'migrateCpOrdersColumnLayout')};this.fn=migrateCpOrdersColumnLayout;this.regroup=COLUMN_LAYOUT_REGROUP;this.version=CP_ORDERS_COLUMN_LAYOUT_VERSION;`, context);
  const saved = {
    cp: { order: ['C', '__db_1', 'A', 'B', '__f_1'], hidden: ['B'], widthPx: { A: 120 } },
    orders: { order: ['A', 'S'], hidden: [], widthPx: {} },
  };
  const before = plain({ cp: saved.cp, orders: saved.orders });
  assert.equal(context.fn(saved), true);
  assert.deepEqual(plain(saved.cp), before.cp);
  assert.deepEqual(plain(saved.orders), before.orders);
  assert.equal(saved._layout.cpOrders, context.version);
  assert.equal(context.regroup.size, 0);
  saved.cp.order = ['B', 'A', 'C'];
  assert.equal(context.fn(saved), false);
  assert.deepEqual(plain(saved.cp.order), ['B', 'A', 'C']);
  assert.match(extractFunction(APP, 'loadAutoTableColumnState'), /if\(migrateCpOrdersColumnLayout\(saved\)\)writeAutoTableColumnStateSnapshot\(\);/);
});

test('Koleksiyon layout migrasyonu kayıtlı sırayı yeni varsayılana zorla sıfırlamaz', () => {
  const load = extractFunction(APP, 'loadKolColState');
  assert.match(APP, /const KOL_COL_LAYOUT_VERSION = 7;/);
  assert.doesNotMatch(load, /kolResetDisplayOrderKeepingCustom/);
  assert.match(load, /kolColOrder = kolNormalizeDisplayOrder\(obj\.order\)/);
  assert.match(load, /obj\.layoutVersion=KOL_COL_LAYOUT_VERSION/);
});

test('eski başlık adları yeni kanonik başlığa katılır; görünen ad TR/EN', () => {
  const context = { appLang: 'en', L: value => value };
  vm.runInNewContext(`${extractConst(APP, 'TABLE_COLUMN_GROUP_LABELS')}${extractConst(APP, 'LEGACY_COLUMN_GROUP_ALIASES')}${extractFunction(APP, 'canonicalColumnGroup')}${extractFunction(APP, 'tableColumnGroupLabel')};this.canonical=canonicalColumnGroup;this.label=tableColumnGroupLabel;this.setLang=v=>{appLang=v;};`, context);
  assert.equal(context.canonical('Order Info'), 'Sipariş Detayları');
  assert.equal(context.canonical('  kumaş '), 'Kumaş Detayları');
  assert.equal(context.canonical('Database'), 'Database');
  assert.equal(context.label('Marka Detayları'), 'Brand Details');
  context.setLang('tr');
  assert.equal(context.label('Order Info'), 'Sipariş Detayları');
});

function fieldsHarness(options = {}) {
  const store = {};
  const context = {
    appLang: 'tr',
    BLStorage: { getItem: key => store[key] ?? null, setItem: (key, value) => { store[key] = value; } },
    catalog: options.catalog || [
      { group: 'Model Detayları', keys: ['PLM ID', 'Model Name'] },
      { group: 'Kumaş Detayları', keys: ['Kumaş Tipi', 'Gramaj'] },
    ],
    presets: options.presets || { focus: ['PLM ID', 'Model Name'], extended: ['PLM ID', 'Model Name', 'Gramaj'], all: ['PLM ID', 'Model Name', 'Kumaş Tipi', 'Gramaj'] },
    toasts: [],
  };
  vm.runInNewContext(`
    const LEGACY_COLUMN_GROUP_ALIASES={};
    ${extractFunction(APP, 'canonicalColumnGroup')}
    const tableViewLastAppliedPreset=Object.create(null);
    let hidden=new Set();
    function tableViewAllKeys(){return ['PLM ID','Model Name','Kumaş Tipi','Gramaj'];}
    function tableViewGroupCatalog(){return catalog;}
    function tableViewPresetKeys(tableKey,preset){return presets[preset];}
    function tableViewHiddenKeys(){return hidden;}
    function showToast(message){toasts.push(message);}
    function tableViewApplyVisibility(tableKey,visible){hidden=new Set(tableViewAllKeys().filter(key=>!visible.has(key)));return true;}
    function renderTableViewContext(){}
    ${extractConst(APP, 'TABLE_GROUP_OVERRIDES_KEY')}
    ${extractFunction(APP, 'tableGroupOverridesStored')}
    ${extractFunction(APP, 'tableGroupOverrides')}
    ${extractFunction(APP, 'saveTableGroupOverride')}
    ${extractFunction(APP, 'tableViewApplyGroupOverrides')}
    ${extractFunction(APP, 'tableViewEffectiveKeys')}
    ${extractFunction(APP, 'tableViewPresetState')}
    ${extractFunction(APP, 'tableGroupMode')}
    ${extractFunction(APP, 'tableViewBasePreset')}
    ${extractFunction(APP, 'tableViewPresetName')}
    ${extractFunction(APP, 'tableGroupModeLabel')}
    ${extractFunction(APP, 'tableGroupNextMode')}
    ${extractFunction(APP, 'cycleTableGroupMode')}
    function applyTableViewPreset(tableKey,preset){tableViewLastAppliedPreset[tableKey]=preset;return tableViewApplyVisibility(tableKey,new Set(tableViewEffectiveKeys(tableKey,preset)));}
    ${extractFunction(APP, 'resetTableGroupOverrides')}
    this.api={applyTableViewPreset,cycleTableGroupMode,tableGroupModeLabel,tableViewPresetState,tableViewEffectiveKeys,resetTableGroupOverrides,visible:()=>tableViewAllKeys().filter(key=>!hidden.has(key))};
  `, context);
  return { ...context.api, store, toasts: context.toasts };
}

test('Alanlar: Odak → Kumaş: Odak → Tümü → Gizli → Odak; Odak tanımı değişmez', () => {
  const api = fieldsHarness();
  api.applyTableViewPreset('cp', 'focus');
  assert.equal(api.tableGroupModeLabel('cp', 'Kumaş Detayları'), 'Odak');
  api.cycleTableGroupMode('cp', 'Kumaş Detayları');
  assert.equal(api.tableGroupModeLabel('cp', 'Kumaş Detayları'), 'Tümü');
  assert.deepEqual(plain(api.visible()), ['PLM ID', 'Model Name', 'Kumaş Tipi', 'Gramaj']);
  // Görünüm hâlâ Odak sayılır (Odak + Alanlar katmanı); Odak'ın kendi tanımı aynıdır.
  assert.equal(api.tableViewPresetState('cp'), 'focus');
  assert.ok(!Object.keys(api.store).some(key => key.startsWith('lcw.tableViewFocus')));
  api.cycleTableGroupMode('cp', 'Kumaş Detayları');
  assert.equal(api.tableGroupModeLabel('cp', 'Kumaş Detayları'), 'Gizli');
  assert.deepEqual(plain(api.visible()), ['PLM ID', 'Model Name']);
  api.cycleTableGroupMode('cp', 'Kumaş Detayları');
  assert.equal(api.tableGroupModeLabel('cp', 'Kumaş Detayları'), 'Odak');
  assert.deepEqual(api.store['lcw.tableGroupOverrides.v1'], '{}');
});

test('Alanlar katmanı preset değişiminde korunur; Tümü görünümünde ara Tümü adımı atlanır', () => {
  const api = fieldsHarness();
  api.applyTableViewPreset('cp', 'focus');
  api.cycleTableGroupMode('cp', 'Kumaş Detayları');
  api.applyTableViewPreset('cp', 'extended');
  assert.deepEqual(plain(api.visible()), ['PLM ID', 'Model Name', 'Kumaş Tipi', 'Gramaj']);
  api.resetTableGroupOverrides('cp');
  assert.deepEqual(plain(api.visible()), ['PLM ID', 'Model Name', 'Gramaj']);
  api.applyTableViewPreset('cp', 'all');
  api.cycleTableGroupMode('cp', 'Model Detayları');
  assert.equal(api.tableGroupModeLabel('cp', 'Model Detayları'), 'Gizli');
  api.cycleTableGroupMode('cp', 'Model Detayları');
  assert.equal(api.tableGroupModeLabel('cp', 'Model Detayları'), 'Tümü');
});

test('Alanlar son görünür başlığı gizlemez', () => {
  const api = fieldsHarness();
  api.applyTableViewPreset('cp', 'focus');
  assert.equal(api.cycleTableGroupMode('cp', 'Model Detayları'), true); // → Tümü
  api.cycleTableGroupMode('cp', 'Model Detayları'); // → Gizli: hiç sütun kalmaz
  assert.equal(api.toasts.length, 1);
  assert.deepEqual(plain(api.visible()), ['PLM ID', 'Model Name']);
});

test('Alanlar butonu üç tabloda Tümü düğmesinin hemen sağında ve TR/EN', () => {
  for (const key of ['cp', 'orders', 'koleksiyon']) {
    assert.match(INDEX, new RegExp(`data-table-view-preset="all" data-table-key="${key}"[^\\n]*</button>\\n\\s*<button type="button" class="tableViewPreset tableFieldsBtn" data-table-fields="${key}"[^\\n]*data-i18n-tr="Alanlar" data-i18n-en="Fields"`));
  }
  assert.match(APP, /document\.addEventListener\('click',event=>\{\s*const button=event\.target\.closest\?\.\('\[data-table-fields\]'\)/);
  assert.match(read('public/user-storage.js'), /'lcw\.tableGroupOverrides\.'/);
  assert.match(read('server/lib/user-preferences.js'), /'lcw\.tableGroupOverrides\.'/);
});

test('Koleksiyon Checklist: dört durum, ortak özel sütun bayrağı, madde yoksa başlık yok', () => {
  const context = { appLang: 'tr' };
  vm.runInNewContext(`${extractConst(APP, 'KOL_CHECKLIST_STATUSES')}${extractFunction(APP, 'kolChecklistStatus')}${extractFunction(APP, 'kolChecklistStatusLabel')};this.status=kolChecklistStatus;this.label=kolChecklistStatusLabel;`, context);
  assert.equal(context.status('approved'), 'approved');
  assert.equal(context.status(''), 'open');
  assert.equal(context.status('serbest metin'), 'open');
  assert.equal(context.label('rejected'), 'Reddedildi');
  assert.match(extractFunction(APP, 'kolNormalizeCustomCols'), /entry\.checklist===true\?\{checklist:true\}/);
  assert.match(APP, /\}else if\(c\.checklist\)\{html\+=kolChecklistCellHtml\(r,c,val,rc\);\s*\}else if\(c\.custom\)\{/);
  const group = extractFunction(APP, 'kolColumnGroupFor');
  assert.match(group, /if\(def&&def\.checklist\)return 'Checklist';/);
  // Checklist başlığı yalnız checklist sütunu varsa oluşur: katalog boş başlık üretmez.
  assert.match(extractFunction(APP, 'tableViewGroupCatalog'), /groups\.get\(group\)\.keys\.push\(key\)/);
  const meta = extractFunction(APP, 'kolSpreadsheetColumnMeta');
  assert.match(meta, /if\(c\.checklist\)return \{[^}]*editable:false/);
  assert.match(extractFunction(APP, 'kolSetChecklistStatus'), /kolWriteGroupedStorageValue\(row,key,status==='open'\?'':status\)/);
});

test('Alanlar çekmecesi: Tümü de tiklenir; hariç tutulanlar ayrı saklanır, yeni sütunlar Tümü\'ye girer', () => {
  const store = {};
  const context = { BLStorage: { getItem: key => store[key] ?? null, setItem: (key, value) => { store[key] = value; } }, allKeys: ['A', 'B', 'C'] };
  vm.runInNewContext(`
    ${extractConst(APP, 'TABLE_VIEW_FOCUS_KEY')}
    ${extractConst(APP, 'TABLE_VIEW_EDITABLE_PRESETS')}
    function tableViewAllKeys(){return allKeys;}
    function tableViewFocusKeys(){return ['A'];}
    function tableViewDefaultExtendedKeys(){return ['A','B'];}
    ${extractFunction(APP, 'tableViewPresetStored')}
    ${extractFunction(APP, 'tableViewSavedPresetKeys')}
    ${extractFunction(APP, 'tableViewAllHiddenKeys')}
    ${extractFunction(APP, 'tableViewPresetKeys')}
    ${extractFunction(APP, 'saveTableViewPreset')}
    this.keys=tableViewPresetKeys;this.save=saveTableViewPreset;`, context);
  assert.equal(context.save('cp', 'all', ['A', 'C']), true);
  assert.deepEqual(plain(context.keys('cp', 'all')), ['A', 'C']);
  assert.deepEqual(JSON.parse(store['lcw.tableViewFocus.v1']).cp, { allHidden: ['B'] });
  context.allKeys.push('D');
  assert.deepEqual(plain(context.keys('cp', 'all')), ['A', 'C', 'D']);
  assert.equal(context.save('cp', 'focus', ['C']), true);
  assert.deepEqual(plain(context.keys('cp', 'focus')), ['C']);
  assert.equal(context.save('cp', 'extended', []), false);
});

test('Alanlar çekmecesi: başlık açılır, tikler, düzenle / formül / sil ve ekleme komutları; sıralama başlık içinde', () => {
  const fn = extractFunction(APP, 'renderTableFieldsMenu');
  assert.match(fn, /data-table-fields-toggle=/);
  assert.match(fn, /data-table-fields-preset="\$\{preset\}"/);
  assert.match(fn, /data-table-fields-group-preset=/);
  assert.match(fn, /data-table-fields-formula=/);
  assert.match(fn, /data-table-fields-rename=/);
  assert.match(fn, /data-table-fields-delete=/);
  assert.match(fn, /dragged\.dataset\.group===row\.dataset\.group/);
  assert.doesNotMatch(fn, /<section/, 'section öğeleri sayfa görünümü kuralıyla gizlenir');
  const move = extractFunction(APP, 'tableFieldsMoveColumn');
  assert.match(move, /if\(key==='__picture__'\|\|targetKey==='__picture__'\)return false;/);
  assert.match(move, /cs\.order=order;saveAutoTableColumnState\(\);/);
  assert.match(move, /kolColOrder=kolNormalizeDisplayOrder\(order\);saveKolColState\(\);/);
  const del = extractFunction(APP, 'tableFieldsDeleteColumn');
  assert.match(del, /removeFormulaColumn\(/);
  assert.match(del, /removeCpModelColumn\(/);
  assert.match(del, /removeCpNoteColumn\(/);
  assert.match(del, /kolRemoveCustomColumn\(key,done\)/);
  // Çekmeceden açılan diyaloglar çekmeceyi kapatmaz.
  assert.match(extractFunction(APP, 'openTableFieldsMenu'), /\.warnOverlay,\.modalCard,\[aria-modal="true"\]/);
});
