'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createTableSearch } = require('./helpers/bl-table-search');

const root = path.join(__dirname, '..');

function loadQuotationTestApi() {
  let source = fs.readFileSync(path.join(root, 'public', 'quotations.js'), 'utf8');
  source = source.replace(
    /window\.BL_QUOTATIONS=.*?;\n/,
    'window.BL_QUOTATIONS={recordRequest,open:openModal,save:qSave,renameManufacturer,setPrice,toggleApproval,moveRequest:qMoveRequest,deleteRequest:qDeleteRequest,_test:{qTableState,qVisibleTableItems,qItemFabric,qItemCategory,qItemDropped,qItemTargetPrice,qTargetDelta,qBestForModel,qBestMarkup,qUpdateModelPricingCells,qBuildExportRows,qToggleDrop,qLoadColumnWidths,qSetColumnWidth,qColumnTotalWidth,qTableCols,qCommitPriceInput}};\n'
  );
  const storage = new Map();
  // v6.52: quotations.js paylaşımlı/sunucu-destekli depoya taşındı (qApi -> fetch).
  // Sunucusuz sanal alanda /api/quotations uçlarını taklit eden minimal bir bellek-içi
  // mağaza: POST/PUT gönderilen kaydı aynen geri yansıtır (gerçek sunucu doğrulaması yok).
  const serverStore = new Map();
  async function fetchMock(url, options = {}) {
    const method = (options.method || 'GET').toUpperCase();
    const json = async () => body;
    let body = {};
    if (url === '/api/quotations' && method === 'GET') {
      body = { requests: [...serverStore.values()], profiles: [] };
    } else if (url === '/api/quotations' && method === 'POST') {
      const req = JSON.parse(options.body);
      serverStore.set(req.id, req);
      body = { request: req };
    } else {
      const putMatch = /^\/api\/quotations\/([^/]+)$/.exec(url);
      if (putMatch && method === 'PUT') {
        const req = JSON.parse(options.body);
        serverStore.set(decodeURIComponent(putMatch[1]), req);
        body = { request: req };
      }
    }
    return { ok: true, status: 200, json };
  }
  const context = {
    // quotations.js ortak tablo aramasını globalThis üzerinden okur; vm
    // bağlamında globalThis bu nesnedir. Gerçek uygulama kaynağından besleniyor.
    BLTableSearch: createTableSearch(),
    console,
    window: {},
    document: { getElementById: () => null, body: { dataset: {} }, addEventListener() {}, removeEventListener() {} },
    localStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) },
    BLStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) },
    fetch: fetchMock,
    appLang: 'tr',
    state: { cp: { rows: [{ 'Order Code': 'CP-1', 'Kumaş Tipi': 'Jersey', 'Karışım': '95% Pamuk', 'Gramaj': '180' }] } },
    kolRows: [{ id: 7, modelKod: 'KMODEL', fabric: 'Interlock', img: '' }],
    setTimeout,
    clearTimeout,
    confirm: () => true,
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  return context.window.BL_QUOTATIONS;
}

test('Quotation tables preserve per-request sorting/filtering and show fabric for new and legacy records', async () => {
  const api = loadQuotationTestApi();
  const request = await api.recordRequest('collection', [
    { id: 7, modelKod: 'KMODEL', fabric: 'Interlock', targetPrice: '5.00', pricing: { A: '6.00' } },
    { id: 8, modelKod: 'BMODEL', fabric: 'Rib', targetPrice: '4.00', pricing: { A: '3.00' } },
  ], [{ name: 'A' }, { name: 'B' }]);

  assert.equal(request.items.length, 4);
  assert.ok(request.items.every(item => ['Interlock', 'Rib'].includes(item.fabric)));

  const state = api._test.qTableState(request);
  state.sort = { key: 'target', dir: 1 };
  assert.equal(api._test.qVisibleTableItems(request)[0].targetPrice, '4.00');

  state.filters.manufacturer = new Set(['B']);
  const visible = api._test.qVisibleTableItems(request);
  assert.equal(visible.length, 2);
  assert.ok(visible.every(item => item.manufacturer === 'B'));

  assert.equal(api._test.qItemFabric({ source: 'collection' }, { rowId: 7, fabric: '' }), 'Interlock');
  assert.equal(api._test.qItemFabric({ source: 'cp' }, { orderCode: 'CP-1', fabric: '' }), 'Jersey · 95% Pamuk · 180');
});

test('Quotation tables include Category after Model and persist clamped column widths', async () => {
  const api = loadQuotationTestApi();
  const cols = api._test.qTableCols.map(col => col.key);
  assert.deepEqual(Array.from(cols.slice(0, 3)), ['model', 'category', 'manufacturer']);

  const request = await api.recordRequest('collection', [
    { id: 7, modelKod: 'KMODEL', urunTipi: 'Sweatshirt', fabric: 'Interlock' },
  ], [{ name: 'A' }]);
  assert.equal(request.items[0].category, 'Sweatshirt');
  assert.equal(api._test.qItemCategory(request, request.items[0]), 'Sweatshirt');

  const initialTotal = api._test.qColumnTotalWidth();
  assert.equal(api._test.qSetColumnWidth('model', 30, true), 110);
  assert.equal(api._test.qLoadColumnWidths().model, 110);
  assert.ok(api._test.qColumnTotalWidth() < initialTotal);
  assert.equal(api._test.qSetColumnWidth('category', 1000, true), 640);
});

test('Quotation detail markup renders resize handles, colgroup and clipped model metadata', () => {
  const source = fs.readFileSync(path.join(root, 'public', 'quotations.js'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'public', 'app.css'), 'utf8');
  assert.ok(source.includes('data-qresize="${qEsc(col.key)}"'));
  assert.ok(source.includes('<colgroup>${columnGroup}</colgroup>'));
  assert.ok(source.indexOf("{key:'category'") > source.indexOf("{key:'model'"));
  assert.ok(source.indexOf("{key:'category'") < source.indexOf("{key:'manufacturer'"));
  assert.match(css, /\.quotationModelName,\.quotationModelMeta,\.quotationCategory,\.quotationManufacturer\{[^}]*text-overflow:ellipsis/);
  assert.match(css, /\.quotationColResize\{[^}]*cursor:col-resize/);
});

test('Best Price target delta controls signed percentage and green eligibility', () => {
  // kolBestPricing index.html'den app-main.js'e taşındı.
  const html = fs.readFileSync(path.join(root, 'public', 'app-main.js'), 'utf8');
  const start = html.indexOf('function kolBestPricing(row)');
  const end = html.indexOf('// Onaylı üretici/fiyat', start);
  assert.ok(start >= 0 && end > start);
  const context = {
    // quotations.js ortak tablo aramasını globalThis üzerinden okur; vm
    // bağlamında globalThis bu nesnedir. Gerçek uygulama kaynağından besleniyor.
    BLTableSearch: createTableSearch(),
    appLang: 'tr',
    kolParseMoneyNum(value) {
      if (value == null || value === '') return Number.NaN;
      let text = String(value).replace(/[$£€\s]/g, '');
      if (text.includes(',') && text.includes('.')) text = text.replace(/\./g, '').replace(',', '.');
      else text = text.replace(',', '.');
      return Number(text);
    },
    kolEffectiveValue(row, key) { return row == null ? '' : row[key]; },
  };
  vm.createContext(context);
  vm.runInContext(html.slice(start, end), context);

  assert.deepEqual(
    JSON.parse(JSON.stringify(context.kolBestPriceTargetDelta({ targetPrice: '10' }, { name: 'B', price: 9 }))),
    { target: 10, percent: -10, meetsTarget: true, text: '−10%' }
  );
  assert.equal(context.kolBestPriceTargetDelta({ targetPrice: '10' }, { name: 'B', price: 10 }).text, '0%');
  assert.equal(context.kolBestPriceTargetDelta({ targetPrice: '10' }, { name: 'B', price: 11 }).meetsTarget, false);
  assert.equal(context.kolBestPriceTargetDelta({ targetPrice: '10' }, { name: 'B', price: 10.32 }).text, '+3,2%');
  assert.equal(context.kolBestPriceTargetDelta({ targetPrice: '' }, { name: 'B', price: 9 }), null);
});



test('Price commit normalizes and persists the active value before keyboard navigation', async () => {
  const api = loadQuotationTestApi();
  const request = await api.recordRequest('cp', [
    { _sourceOrderCode: 'CP-1', modelKod: 'MODEL-1', targetPrice: '10.00' },
  ], [{ name: 'Factory A' }]);
  const line = request.items[0];
  const classes = new Set(['isApproved']);
  const approve = {
    classList: { toggle(name, enabled) { enabled ? classes.add(name) : classes.delete(name); } },
    setAttribute() {},
    title: '',
  };
  const input = {
    dataset: { quotePrice: line.id },
    value: '12,5',
    closest() { return { querySelector() { return approve; } }; },
  };

  assert.equal(api._test.qCommitPriceInput(request, input), true);
  assert.equal(line.price, '12.50');
  assert.equal(input.value, '12.50');
  assert.equal(input.dataset.lastCommitted, '12.50');
  assert.equal(classes.has('isApproved'), false);
});

test('Quotation table viewport persists across approval, Drop, sort and filter rerenders', () => {
  const source = fs.readFileSync(path.join(root, 'public', 'quotations.js'), 'utf8');
  assert.match(source, /previousState\.view=\{scrollTop:previousWrap\.scrollTop,scrollLeft:previousWrap\.scrollLeft\}/);
  assert.match(source, /wrap\.scrollTop=Number\(view\.scrollTop\)\|\|0;/);
  assert.match(source, /wrap\.scrollLeft=Number\(view\.scrollLeft\)\|\|0;/);
  assert.match(source, /wrap\.addEventListener\('scroll',[\s\S]*tableState\.view=/);
});

test('Enter commits the active quotation price before moving focus and does not rerender the table', () => {
  const source = fs.readFileSync(path.join(root, 'public', 'quotations.js'), 'utf8');
  const bindStart = source.indexOf("host.querySelectorAll('.quotationPriceInput')");
  const bindEnd = source.indexOf("if(req.source==='collection') host.querySelectorAll('.quotationModelThumb')", bindStart);
  assert.ok(bindStart >= 0 && bindEnd > bindStart);
  const block = source.slice(bindStart, bindEnd);
  assert.ok(block.indexOf('qCommitPriceInput(req,input);') < block.indexOf('next.focus();'));
  assert.ok(!block.includes("dispatchEvent(new Event('change'))"));
  assert.ok(!block.includes('qRenderDetail();'));
});

test('Drop remains local to one manufacturer line and never writes Collection dropped state', () => {
  const source = fs.readFileSync(path.join(root, 'public', 'quotations.js'), 'utf8');
  const start = source.indexOf('function qToggleDrop(req,line)');
  const end = source.indexOf('function qBindColumnResize', start);
  assert.ok(start >= 0 && end > start);
  const block = source.slice(start, end);
  assert.match(block, /line\.dropped=next/);
  // Testin asıl koruduğu şey: Drop TEK üretici satırına özeldir.
  assert.ok(!block.includes('req.items.forEach'), 'aynı teklifin diğer satırlarına yayılmamalı');
  assert.ok(!block.includes('qLoad().requests.forEach'), 'diğer tekliflere yayılmamalı');
  assert.ok(!block.includes('row.dropped='), 'Koleksiyon satırını iptal etmemeli');
  // v5.99: düşülen üreticinin fiyatı Koleksiyon'daki Best Price hesabında
  // kalmaya devam ediyordu. Artık YALNIZ o üreticinin fiyatı haritadan
  // çıkarılır — yayılma yok, model iptal edilmiyor.
  assert.ok(block.includes('qWritePriceToCollection(req,line)'), 'o satırın fiyatı Koleksiyon’dan düşmeli');
  assert.ok(block.includes('qRefreshCollection()'), 'ekran tazelenmeli');
});

test('Quotation drop finalizes drag state before navigation rerender', () => {
  const source = fs.readFileSync(path.join(root, 'public', 'quotations.js'), 'utf8');
  const dropStart = source.indexOf("nav.addEventListener('drop'");
  const dragEndStart = source.indexOf("nav.addEventListener('dragend'", dropStart);
  assert.ok(dropStart >= 0 && dragEndStart > dropStart);
  const dropBlock = source.slice(dropStart, dragEndStart);
  assert.ok(dropBlock.indexOf('qDragId=null;') < dropBlock.indexOf('qRenderNav(search.value);'));
  assert.ok(dropBlock.includes('setTimeout(()=>{qDragMoved=false;},0);'));
});


test('Quotation pricing shows live Target deltas and per-model Best Price manufacturer', async () => {
  const api = loadQuotationTestApi();
  const request = await api.recordRequest('collection', [
    { id: 7, modelKod: 'KMODEL', targetPrice: '10.00' },
  ], [{ name: 'Factory A' }, { name: 'Factory B' }]);
  request.items[0].price = '11.00';
  request.items[1].price = '9.00';

  assert.equal(api._test.qItemTargetPrice(request, request.items[0]), '10.00');
  assert.deepEqual(
    JSON.parse(JSON.stringify(api._test.qTargetDelta('10.00', '9.00'))),
    { target: 10, price: 9, percent: -10, meetsTarget: true, text: '−10%' }
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(api._test.qBestForModel(request, request.items[0]))),
    { price: 9, manufacturer: 'Factory B', lineId: request.items[1].id }
  );

  const cols = api._test.qTableCols.map(col => col.key);
  assert.equal(cols.indexOf('best'), cols.indexOf('target') + 1);
  assert.equal(api._test.qTableCols.find(col => col.key === 'price').value(request, request.items[0]), '+10% $11.00');
  assert.equal(api._test.qTableCols.find(col => col.key === 'best').value(request, request.items[0]), '$9.00 · Factory B');
});



test('Best Price / Mfr is shared across separate quotations for the same model', async () => {
  const api = loadQuotationTestApi();
  const first = await api.recordRequest('collection', [
    { id: 7, modelKod: 'KMODEL', targetPrice: '10.00' },
  ], [{ name: 'Factory X' }]);
  const second = await api.recordRequest('collection', [
    { id: 7, modelKod: 'KMODEL', targetPrice: '10.00' },
  ], [{ name: 'Factory Y' }]);
  first.items[0].price = '8.75';
  second.items[0].price = '9.40';

  assert.deepEqual(
    JSON.parse(JSON.stringify(api._test.qBestForModel(second, second.items[0]))),
    { price: 8.75, manufacturer: 'Factory X', lineId: first.items[0].id }
  );
  assert.equal(api._test.qTableCols.find(col => col.key === 'best').value(second, second.items[0]), '$8.75 · Factory X');
});

// targetPrice dalı büyüdü (kolApplyRulePricing çağrısı eklendi); tek satırlık
// needsRerender=true artık bir blok içinde. Kod ayrıca index.html'den app-main.js'e taşındı.
test('Collection Target edits rerender derived Best Price and Confirmed FOB percentages', () => {
  const appMain = fs.readFileSync(path.join(root, 'public', 'app-main.js'), 'utf8');
  assert.match(appMain, /else if\(k==='targetPrice'\)\{[\s\S]{0,240}?needsRerender=true;\s*\}/);
  assert.match(appMain, /function kolConfirmedPriceTargetDelta\(row,confirmed=kolConfirmedPricing\(row\)\)/);
  assert.match(appMain, /kolConfirmedDelta[\s\S]*delta\.text/);
  const quotations = fs.readFileSync(path.join(root, 'public', 'quotations.js'), 'utf8');
  assert.match(quotations, /quotationPriceDelta/);
});

test('Quotation price commits refresh same-model Best Price and delta cells without rerendering', () => {
  const source = fs.readFileSync(path.join(root, 'public', 'quotations.js'), 'utf8');
  // options={} üçüncü parametresi eklendi (zorla-onaylama bayrağı).
  const start = source.indexOf('function qCommitPriceInput(req,input,options={})');
  const end = source.indexOf('function qToggleApproval', start);
  assert.ok(start >= 0 && end > start);
  const block = source.slice(start, end);
  assert.match(block, /qUpdateModelPricingCells\(req,line\.modelKey,table\)/);
  assert.ok(!block.includes('qRenderDetail();'));
  assert.match(source, /data-quote-best=/);
  assert.match(source, /quotationPriceEditor/);
});


test('same-model quotation cells update Best Price manufacturer and Target deltas in place', async () => {
  const api = loadQuotationTestApi();
  const request = await api.recordRequest('collection', [
    { id: 7, modelKod: 'KMODEL', targetPrice: '10.00' },
  ], [{ name: 'Factory A' }, { name: 'Factory B' }]);
  request.items[0].price = '11.00';
  request.items[1].price = '9.00';

  const makeClassList = () => {
    const set = new Set();
    return { add: value => set.add(value), remove: (...values) => values.forEach(value => set.delete(value)), has: value => set.has(value) };
  };
  const rows = request.items.map(item => {
    const bestCell = { innerHTML: '' };
    const delta = { textContent: '', title: '', classList: makeClassList() };
    return {
      dataset: { quoteLine: item.id },
      bestCell,
      delta,
      querySelector(selector) { return selector === '[data-quote-best]' ? bestCell : selector === '.quotationPriceDelta' ? delta : null; },
    };
  });
  const table = { querySelectorAll: selector => selector === '[data-quote-line]' ? rows : [] };
  api._test.qUpdateModelPricingCells(request, request.items[0].modelKey, table);

  assert.match(rows[0].bestCell.innerHTML, /\$9\.00/);
  assert.match(rows[0].bestCell.innerHTML, /Factory B/);
  assert.equal(rows[0].delta.textContent, '+10%');
  assert.equal(rows[1].delta.textContent, '−10%');
  assert.equal(rows[0].delta.classList.has('isAboveTarget'), true);
  assert.equal(rows[1].delta.classList.has('isAtOrBelowTarget'), true);
});

// Koleksiyon rowId'leri kullanıcı başına 1'den başlar ve veri taşıma / yeniden
// import sonrası yeniden dağıtılır. İlk kez fiyatlamaya çıkan bir model, aynı
// `kol:<rowId>` anahtarını taşıyan başka kullanıcının ya da artık başka bir
// modele ait eski quotation satırından Best Price / Mfr devralmamalıdır.
test('Best Price / Mfr ignores reused Collection rowIds from other owners or other models', async () => {
  const api = loadQuotationTestApi();
  const foreign = await api.recordRequest('collection', [
    { id: 7, plmId: 'PLM-7', modelKod: 'KMODEL' },
  ], [{ name: 'Foreign Factory' }]);
  foreign.ownerId = 'other-user';
  foreign.items[0].price = '1.23';

  const stale = await api.recordRequest('collection', [
    { id: 7, plmId: 'OLD-PLM', modelKod: 'OLD-MODEL' },
  ], [{ name: 'Stale Factory' }]);
  stale.items[0].price = '1.40';

  const fresh = await api.recordRequest('collection', [
    { id: 7, plmId: 'PLM-7', modelKod: 'KMODEL' },
  ], [{ name: 'Factory A' }]);
  assert.equal(api._test.qBestForModel(fresh, fresh.items[0]), null);
  assert.equal(api._test.qTableCols.find(col => col.key === 'best').value(fresh, fresh.items[0]), '');

  // Yalnız model adı revize edilmiş aynı model (PLM ID aynı) geçmişini korur.
  const renamed = await api.recordRequest('collection', [
    { id: 7, plmId: 'PLM-7', modelKod: 'KMODEL-OLDNAME' },
  ], [{ name: 'Factory R' }]);
  renamed.items[0].price = '2.10';
  assert.deepEqual(
    JSON.parse(JSON.stringify(api._test.qBestForModel(fresh, fresh.items[0]))),
    { price: 2.1, manufacturer: 'Factory R', lineId: renamed.items[0].id }
  );
});

test('Pricing History stable rowId match is guarded by owner and model identity', () => {
  const source = fs.readFileSync(path.join(root, 'public', 'quotations.js'), 'utf8');
  const start = source.indexOf('function qhSelectedMeta(req,item,index)');
  const end = source.indexOf('function qhCollect(rows)', start);
  assert.ok(start >= 0 && end > start);
  assert.match(source.slice(start, end), /if\(meta&&qhStableMatchValid\(req,item,meta\)\)return meta;/);
  assert.match(source, /function qhStableMatchValid\(req,item,meta\)\{[\s\S]*?_collectionOwnerId[\s\S]*?qIdentityCompatible\(/);
});
