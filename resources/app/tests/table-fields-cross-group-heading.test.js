'use strict';

/* Alanlar çekmecesi — sütunu başka ana başlığa sürükle-bırak.
   Korunan davranışlar:
   - CP / Orders'ta her sütun (sabit görsel ve checklist hariç) başka başlığa
     taşınabilir. Başlık KİŞİSEL yerleşim tercihidir: lcw.table.columnState.v1
     içinde `groups` olarak saklanır, paylaşılan sütun tanımı değişmez.
   - Etkin başlık sütun nesnesinin group alanına yazılır, tanım başlığı baseGroup'ta
     kalır; sütun listesi yeniden kurulunca (invalidateColumnIndex) yeniden uygulanır.
   - Tanımın başlığına açıkça yeniden yerleştirilen sütunun eşlemesi düşer.
   - Koleksiyon sistem sütunu kolColGroupOverrides ile taşınır; serbest sütun
     başlığını yine soldaki komşusundan alır. Fiyat / Endeksmatik / Checklist
     sütunları taşınmaz; Checklist ve Endeksmatik başlığı hedef olamaz.
   - "Alanları sıfırla" taşınan sütunları tanımdaki başlığın sonuna geri koyar. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(ROOT, 'public/app-main.js'), 'utf8');
const FORMULA = fs.readFileSync(path.join(ROOT, 'public/formula-columns.js'), 'utf8');
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
  // Parantez derinliği 0'daki ilk ';' ifadenin sonudur (satır sonu yorumları hariç).
  let depth = 0;
  for (let i = start; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '(' || ch === '[' || ch === '{') depth += 1;
    else if (ch === ')' || ch === ']' || ch === '}') depth -= 1;
    else if (ch === ';' && depth === 0) return source.slice(start, i + 1);
  }
  assert.fail(`${name} kapanmıyor`);
}
const fns = names => names.map(name => extractFunction(APP, name)).join('\n');

function cpHarness() {
  const store = {};
  const context = {
    toasts: [],
    appLang: 'tr',
    BLStorage: { getItem: key => (key in store ? store[key] : null), setItem: (key, value) => { store[key] = value; } },
    showToast: message => context.toasts.push(message),
    tableFieldsRerender: () => {},
  };
  vm.runInNewContext(`
    ${extractConst(APP, 'groupKey')}
    ${extractConst(APP, 'LEGACY_COLUMN_GROUP_ALIASES')}
    ${extractConst(APP, 'AUTO_TABLE_COL_STATE_KEY')}
    ${extractConst(APP, 'TABLE_FIELDS_LOCKED_GROUPS')}
    const _colIndexCache=new Map();
    let autoTableColumnStateSnapshot=null;
    const COLS_BY_TABLE={cp:[
      {k:'__picture',group:'Model Detayları',type:'cpImage'},
      {k:'Line',group:'Model Detayları'},{k:'Ürün Tanım',group:'Model Detayları'},{k:'Category',group:'Model Detayları'},
      {k:'Season',group:'Sipariş Detayları'},{k:'Country',group:'Sipariş Detayları'},
      {k:'chk_1',group:'Checklist',checklistSupplierColumn:true},
    ]};
    const colmgr={cp:{order:COLS_BY_TABLE.cp.map(c=>c.k),hidden:new Set(),widthPx:{}}};
    function tableFieldsColumn(tableKey,key){
      const col=COLS_BY_TABLE[tableKey].find(c=>c.k===key);
      return {key,col,kind:col&&col.checklistSupplierColumn?'cpChecklist':'system',fixed:col&&col.type==='cpImage'};
    }
    function hideUnseenDefaultHiddenColumns(){}
    ${fns(['canonicalColumnGroup', 'placeColumnInGroup', 'tableColumnBaseGroup', 'applyColumnGroupOverrides',
      'normalizeColumnGroupOverrides', 'setColumnGroupOverride', 'invalidateColumnIndex', 'tableViewColumnGroup',
      'tableFieldsCanChangeGroup', 'tableFieldsGroupAccepts', 'tableFieldsMoveColumn', 'normalizedColumnOrder',
      'mergeDeferredColumnOrder', 'readAutoTableColumnState', 'autoTableSavedEntry', 'savedColumnOrderKeys',
      'saveAutoTableColumnState', 'restoreLateManagedColumnState', 'tableColumnGroupOverrideKeys',
      'resetTableColumnGroupOverrides'])}
    applyColumnGroupOverrides('cp');
    this.api={COLS_BY_TABLE,colmgr,move:tableFieldsMoveColumn,can:tableFieldsCanChangeGroup,group:key=>tableViewColumnGroup('cp',key),
      invalidate:invalidateColumnIndex,place:placeColumnInGroup,reset:resetTableColumnGroupOverrides,restoreLate:restoreLateManagedColumnState,
      resetSnapshot:()=>{autoTableColumnStateSnapshot=null;}};
  `, context);
  return { ...context.api, store, toasts: context.toasts };
}

test('CP: sistem sütunu başka başlığa sürüklenir; başlık kişisel kayıtta, tanım değişmez', () => {
  const api = cpHarness();
  assert.equal(api.can('cp', 'Ürün Tanım'), true);
  assert.equal(api.can('cp', '__picture'), false, 'sabit görsel sütunu başlık değiştirmez');
  assert.equal(api.can('cp', 'chk_1'), false, 'checklist maddesi kendi başlığına aittir');
  // Ürün Tanım, Sipariş Detayları'nın ilk sütunu Season'ın önüne bırakılır.
  assert.equal(api.move('cp', 'Ürün Tanım', 'Season', false, 'Sipariş Detayları'), true);
  assert.deepEqual(plain(api.colmgr.cp.order), ['__picture', 'Line', 'Category', 'Ürün Tanım', 'Season', 'Country', 'chk_1']);
  assert.equal(api.group('Ürün Tanım'), 'Sipariş Detayları');
  const column = api.COLS_BY_TABLE.cp.find(c => c.k === 'Ürün Tanım');
  assert.equal(column.group, 'Sipariş Detayları', 'tablo bantları / sunum / dışa aktarım aynı başlığı okur');
  assert.equal(column.baseGroup, 'Model Detayları', 'tanımdaki başlık korunur');
  const saved = JSON.parse(api.store['lcw.table.columnState.v1']).cp;
  assert.deepEqual(saved.groups, { 'Ürün Tanım': 'Sipariş Detayları' });
  // Checklist hedef olamaz; reddedilen taşıma sırayı ve kaydı değiştirmez.
  assert.equal(api.move('cp', 'Line', 'chk_1', false, 'Checklist'), false);
  assert.equal(api.toasts.length, 1);
  assert.equal(api.group('Line'), 'Model Detayları');
  // Kendi başlığına geri taşınan sütunun eşlemesi silinir.
  assert.equal(api.move('cp', 'Ürün Tanım', 'Line', true, 'Model Detayları'), true);
  assert.equal(api.group('Ürün Tanım'), 'Model Detayları');
  assert.equal(JSON.parse(api.store['lcw.table.columnState.v1']).cp.groups, undefined);
});

test('CP: sütun listesi yeniden kurulunca başlık yeniden uygulanır; kayıttan geri yüklenir', () => {
  const api = cpHarness();
  api.move('cp', 'Category', 'Country', true, 'Sipariş Detayları');
  // Dinamik sütun eşitlemesi gibi: aynı anahtarlarla yeni nesneler kurulur.
  const fresh = api.COLS_BY_TABLE.cp.map(c => ({ k: c.k, group: c.baseGroup, type: c.type, checklistSupplierColumn: c.checklistSupplierColumn }));
  api.COLS_BY_TABLE.cp.splice(0, api.COLS_BY_TABLE.cp.length, ...fresh);
  api.invalidate('cp');
  assert.equal(api.group('Category'), 'Sipariş Detayları');
  // Bellekteki eşleme silinse bile kalıcı kayıttan geri gelir (hesap tercihi hidrasyonu).
  api.colmgr.cp.groups = {};
  api.resetSnapshot();
  api.restoreLate('cp');
  assert.equal(api.group('Category'), 'Sipariş Detayları');
  // Siparişler CP sütunlarının kopyasıdır: kopya tanım başlığını taşır, CP eşlemesini değil.
  const copy = { ...api.COLS_BY_TABLE.cp.find(c => c.k === 'Category') };
  assert.equal(Object.prototype.hasOwnProperty.call(copy, 'baseGroup') ? copy.baseGroup : copy.group, 'Model Detayları');
});

test('CP: tanım başlığına açıkça yerleştirilen sütunun eşlemesi düşer; sıfırla geri taşır', () => {
  const api = cpHarness();
  api.move('cp', 'Line', 'Country', true, 'Sipariş Detayları');
  api.place('cp', 'Line', 'Model Detayları');
  assert.equal(api.group('Line'), 'Model Detayları');
  assert.deepEqual(plain(api.colmgr.cp.groups), {});
  api.move('cp', 'Ürün Tanım', 'Country', true, 'Sipariş Detayları');
  assert.equal(api.reset('cp'), true);
  assert.equal(api.group('Ürün Tanım'), 'Model Detayları');
  const order = plain(api.colmgr.cp.order);
  assert.ok(order.indexOf('Ürün Tanım') < order.indexOf('Season'), 'tanım başlığının sonuna döner');
  assert.ok(order.indexOf('Ürün Tanım') > order.indexOf('Line'));
  assert.equal(api.reset('cp'), false);
});

test('Hesaplanan / veritabanı sütunu yerleşimi tanım başlığına göre karar verir', () => {
  // Kişisel başlık col.group'a yazıldığı için karşılaştırma baseGroup ile yapılmalı;
  // aksi halde her eşitlemede sütun eşlenen başlığa "yeniden yerleştirilir".
  assert.match(FORMULA, /const definitionGroup = Object\.prototype\.hasOwnProperty\.call\(col, 'baseGroup'\) \? col\.baseGroup : col\.group;/);
  assert.match(FORMULA, /nameKey\(placed\) !== nameKey\(definitionGroup\)/);
  const model = extractFunction(APP, 'syncCpModelColumns');
  assert.match(model, /const definitionGroup=tableColumnBaseGroup\(c\);/);
  assert.match(model, /placeColumnInGroup\('cp',c\.k,definitionGroup\)/);
  assert.match(extractFunction(APP, 'regroupDynamicColumnsAfterLayoutReset'), /tableColumnBaseGroup\(c\)/);
  // Görünümü sistem varsayılanına döndürmek başlık eşlemesini de temizler.
  const resetView = extractFunction(APP, 'resetViewToSystemDefault');
  assert.match(resetView, /kolColGroupOverrides=\{\}/);
  assert.match(resetView, /colmgr\[page\]=initColState\(COLS_BY_TABLE\[page\]\|\|\[\]\);\s*applyColumnGroupOverrides\(page\);/);
});

function kolHarness() {
  const saved = [];
  const context = {
    appLang: 'tr', toasts: [], saved,
    showToast: message => context.toasts.push(message),
    tableFieldsRerender: () => {},
  };
  vm.runInNewContext(`
    ${extractConst(APP, 'groupKey')}
    ${extractConst(APP, 'LEGACY_COLUMN_GROUP_ALIASES')}
    ${extractConst(APP, 'TABLE_FIELDS_LOCKED_GROUPS')}
    ${extractConst(APP, 'KOL_FIELDS_LOCKED_SOURCE_GROUPS')}
    const KOL_SYNTHETIC_COL_META={},KOL_PRICE_VIEW_COLS={},KOL_PRICE_DETAIL_BY_KEY={};
    const DEFS=[{k:'line',group:'Model Detayları'},{k:'desc',group:'Model Detayları'},{k:'x'},
      {k:'season',group:'Sipariş Detayları'},{k:'country',group:'Sipariş Detayları'},
      {k:'fob',group:'Fiyatlandırma'},{k:'endeksmatik',group:'Endeksmatik & Avantaj'}];
    function kolColDefs(){return DEFS;}
    function kolDefaultDisplayOrder(){return DEFS.map(d=>d.k);}
    function kolNormalizeDisplayOrder(order){return [...order.filter(k=>k!=='endeksmatik'),'endeksmatik'];}
    let kolColOrder=DEFS.map(d=>d.k);
    let kolColGroupOverrides={};
    function saveKolColState(){saved.push({order:kolColOrder.slice(),groups:{...kolColGroupOverrides}});}
    function tableFieldsColumn(tableKey,key){return {key,kind:DEFS.find(d=>d.k===key)?.group?'system':'custom'};}
    ${fns(['canonicalColumnGroup', 'kolColumnGroupOverride', 'kolColumnGroupFor', 'tableFieldsKolSystemMovable',
      'tableFieldsCanChangeGroup', 'tableFieldsGroupAccepts', 'kolSetColumnGroupOverride', 'tableFieldsKolPlan',
      'tableFieldsMoveColumn', 'tableColumnGroupOverrideKeys', 'resetTableColumnGroupOverrides'])}
    this.api={move:tableFieldsMoveColumn,can:tableFieldsCanChangeGroup,plan:tableFieldsKolPlan,reset:resetTableColumnGroupOverrides,
      group:key=>kolColumnGroupFor(key,kolColOrder),order:()=>kolColOrder.slice(),overrides:()=>({...kolColGroupOverrides})};
  `, context);
  return { ...context.api, saved, toasts: context.toasts };
}

test('Koleksiyon: sistem sütunu başka başlığa taşınır; arkasındaki serbest sütun onu izler', () => {
  const api = kolHarness();
  assert.equal(api.can('koleksiyon', 'desc'), true);
  assert.equal(api.can('koleksiyon', 'x'), true, 'serbest sütun eskisi gibi taşınır');
  assert.equal(api.can('koleksiyon', 'fob'), false, 'fiyat sütunu yerleşimi fiyat görünümüne bağlı');
  assert.equal(api.can('koleksiyon', 'endeksmatik'), false);
  // desc, Sipariş Detayları'nın son sütununun ardına bırakılır.
  assert.equal(api.move('koleksiyon', 'desc', 'country', true, 'Sipariş Detayları'), true);
  assert.deepEqual(plain(api.order()), ['line', 'x', 'season', 'country', 'desc', 'fob', 'endeksmatik']);
  assert.equal(api.group('desc'), 'Sipariş Detayları');
  assert.equal(api.group('x'), 'Model Detayları', 'serbest sütun soldaki komşusunun başlığında kalır');
  assert.deepEqual(plain(api.saved.at(-1).groups), { desc: 'Sipariş Detayları' });
  // Serbest sütun, taşınmış sistem sütununun ardına bırakılınca onun kişisel başlığını alır.
  assert.equal(api.move('koleksiyon', 'x', 'desc', true, 'Sipariş Detayları'), true);
  assert.equal(api.group('x'), 'Sipariş Detayları');
  // Endeksmatik ve Checklist hedef olamaz.
  assert.equal(api.plan('line', 'endeksmatik', false, 'Endeksmatik & Avantaj'), null);
  assert.equal(api.move('koleksiyon', 'line', 'endeksmatik', false, 'Endeksmatik & Avantaj'), false);
  assert.equal(api.toasts.length, 1);
  // Sıfırla: desc tanımdaki Model Detayları'nın sonuna döner.
  assert.equal(api.reset('koleksiyon'), true);
  assert.deepEqual(plain(api.overrides()), {});
  assert.equal(api.group('desc'), 'Model Detayları');
  const order = plain(api.order());
  assert.equal(order.indexOf('desc'), order.indexOf('line') + 1);
  assert.equal(api.reset('koleksiyon'), false);
});

test('Koleksiyon başlık eşlemesi kişisel sütun durumunda saklanır ve yüklenir', () => {
  assert.match(extractFunction(APP, 'saveKolColState'), /order:kolColOrder, groups:kolColGroupOverrides,/);
  assert.match(extractFunction(APP, 'loadKolColState'), /kolColGroupOverrides = normalizeColumnGroupOverrides\(obj\.groups\);/);
  const group = extractFunction(APP, 'kolColumnGroupFor');
  assert.match(group, /const own=useOverrides\?kolColumnGroupOverride\(key\):'';/);
  assert.match(group, /const leftOwn=useOverrides\?kolColumnGroupOverride\(left\):'';/);
  // Sıfırla düğmesi yalnız başlık taşıması varken de etkin olur.
  assert.match(extractFunction(APP, 'renderTableFieldsMenu'), /tableColumnGroupOverrideKeys\(tableKey\)\.length\?'':'disabled'/);
});
