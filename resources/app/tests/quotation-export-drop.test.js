'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createTableSearch } = require('./helpers/bl-table-search');

const root = path.join(__dirname, '..');

function quotationApi() {
  let source = fs.readFileSync(path.join(root, 'public', 'quotations.js'), 'utf8');
  source = source.replace(
    /window\.BL_QUOTATIONS=.*?;\n/,
    'window.BL_QUOTATIONS={recordRequest,open:openModal,save:qSave,renameManufacturer,setPrice,toggleApproval,moveRequest:qMoveRequest,deleteRequest:qDeleteRequest,_test:{qBuildExportRows,qItemDropped,qToggleDrop,qTableState,qVisibleTableItems,qDetachLegacyCollectionDrops}};\n'
  );
  const storage = new Map();
  const kolRows = [{
    id: 7, modelKod: 'MODEL-7', plmId: 'PLM-7', fabric: 'Interlock', targetPrice: '10.00',
    pricing: {}, confirmedManufacturer: '', dropped: false, img: '',
  }];
  // v6.52: quotations.js paylaşımlı/sunucu-destekli depoya taşındı (qApi -> fetch).
  // /api/quotations uçlarını taklit eden minimal bellek-içi mağaza.
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
    document: { getElementById: () => null, body: { dataset: { activeTab: 'koleksiyon' } }, addEventListener() {}, removeEventListener() {} },
    localStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
    BLStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
    fetch: fetchMock,
    appLang: 'en',
    kolRows,
    state: { cp: { rows: [] } },
    saveKolRows() { context.saved = (context.saved || 0) + 1; },
    renderKol() { context.rendered = (context.rendered || 0) + 1; },
    showToast() {},
    setTimeout,
    clearTimeout,
    confirm: () => true,
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  return { api: context.window.BL_QUOTATIONS, context, kolRows };
}

test('Quotation export groups models and appends every Sub. MFR quotation price', async () => {
  const { api } = quotationApi();
  const request = await api.recordRequest('collection', [{
    id: 7, modelKod: 'MODEL-7', plmId: 'PLM-7', fabric: 'Interlock', targetPrice: '10.00', pricing: {},
  }], [{ name: 'Factory A' }, { name: 'Factory B' }]);
  request.items.find(item => item.manufacturer === 'Factory A').price = '9.25';
  request.items.find(item => item.manufacturer === 'Factory A').approved = true;
  request.items.find(item => item.manufacturer === 'Factory B').price = '10.40';

  const rows = api._test.qBuildExportRows(request);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].modelKod, 'MODEL-7');
  assert.equal(rows[0]._quotationPrices['Factory A'], '9.25');
  assert.equal(rows[0]._quotationPrices['Factory B'], '10.40');
  assert.equal(rows[0]._quotationApprovals['Factory A'], true);
  assert.equal(rows[0]._quotationApprovals['Factory B'], false);
});

test('Drop is isolated to the active quotation and never mutates the Collection order', async () => {
  const { api, context, kolRows } = quotationApi();
  const first = await api.recordRequest('collection', [{ id: 7, modelKod: 'MODEL-7', targetPrice: '10.00', pricing: {} }], [{ name: 'A' }, { name: 'B' }]);
  const second = await api.recordRequest('collection', [{ id: 7, modelKod: 'MODEL-7', targetPrice: '10.00', pricing: {} }], [{ name: 'C' }]);
  const line = first.items[0];

  assert.equal(api._test.qToggleDrop(first, line), true);
  assert.equal(kolRows[0].dropped, false);
  assert.equal(first.items[0].dropped, true);
  assert.equal(first.items[1].dropped, false);
  assert.ok(second.items.every(item => !item.dropped));
  // v5.99: Drop işareti sahibinin kendi Koleksiyon satırına (fiyat haritası üzerinden)
  // yansıtılır — bu yüzden saveKolRows/renderKol artık çağrılıyor. Testin asıl koruduğu
  // "izolasyon" budur değil: kolRows[0].dropped'ın (satırın kendisinin) değişmemesi
  // (yukarıdaki assertion), tekliften bağımsız kalması.
  assert.equal(context.saved || 0, 1);
  assert.equal(context.rendered || 0, 1);

  assert.equal(api._test.qToggleDrop(first, line), false);
  assert.equal(kolRows[0].dropped, false);
  assert.ok(first.items.every(item => !item.dropped));
  assert.ok(second.items.every(item => !item.dropped));
});

test('Legacy quotation Drop flags are detached from Collection without losing quotation state', async () => {
  const { api, context, kolRows } = quotationApi();
  const request = await api.recordRequest('collection', [{ id: 7, modelKod: 'MODEL-7', pricing: {} }], [{ name: 'A' }, { name: 'B' }]);
  request.items.forEach(item => { item.dropped = true; });
  kolRows[0].dropped = true;
  context.localStorage.removeItem('lcw.quotations.dropDetached.v2.82');

  assert.equal(api._test.qDetachLegacyCollectionDrops(), 1);
  assert.equal(kolRows[0].dropped, false);
  assert.ok(request.items.every(item => item.dropped));
  assert.equal(context.saved, 1);
  assert.equal(context.rendered, 1);
});

// Bu blok index.html'den app-main.js'e taşındı. Sabit satır yüksekliği
// (KOL_IMAGE_EXCEL_ROW_HEIGHT_PX=145) kaldırıldı; artık kolExcelImageMetrics()
// hesaplıyor. "WebP, GIF ve SVG" açıklama yorumu da kaldırılmış — davranış
// (canvas.toDataURL('image/png')'a düşme) hâlâ aynı, bu yüzden o assertion korunuyor.
test('Pricing workbook keeps image aspect ratio and appends approved quotation columns', async () => {
  const html = fs.readFileSync(path.join(root, 'public', 'app-main.js'), 'utf8');
  assert.match(html,/canvas\.toDataURL\('image\/png'\)/);
  const start = html.indexOf('const KOL_IMAGE_EXCEL_PADDING_PX=2;');
  const end = html.indexOf('function kolBase64ObjectUrl', start);
  assert.ok(start >= 0 && end > start);
  const ExcelJS = require(path.join(root, 'public', 'vendor', 'exceljs.min.js'));
  const context = {
    // quotations.js ortak tablo aramasını globalThis üzerinden okur; vm
    // bağlamında globalThis bu nesnedir. Gerçek uygulama kaynağından besleniyor.
    BLTableSearch: createTableSearch(),
    console,
    window: {},
    ExcelJS,
    fetch: async () => { throw new Error('not expected'); },
    kolPricingExcelCols: () => [
      { k: 'modelKod', label: 'Model Name', w: 160 },
      { k: 'targetPrice', label: 'Target Price', w: 100, money: true },
    ],
    columnSchemaFor: () => null,
    kolColWidth: col => col.w || 100,
    kolReadFileAsDataUrl: async () => '',
    kolLoadPricingImage: async source => source ? { naturalWidth: 1600, naturalHeight: 900, width: 1600, height: 900 } : null,
    kolExToRetailDays: () => '',
    kolEffectiveValue: (row,key) => row && row[key] != null ? row[key] : '',
    kolEffectivePricing: row => row && row.pricing && typeof row.pricing === 'object' ? row.pricing : {},
    // kolExcelImageMetrics artık sabit bir satır yüksekliği yerine kolImgDims()'e
    // dayanıyor (Koleksiyon boyut kademesi); test aşağıdaki sabit değerlerle
    // (159/145) çalışacak şekilde kalibre edildiği için burada onu yansıtan bir
    // mock veriyoruz.
    kolImgDims: () => ({ row: 145, col: 159, w: 145, h: 145 }),
    kolParseQuantityNum: value => Number(value),
    kolParseMoneyNum(value) {
      if(value == null || value === '') return Number.NaN;
      const n = Number(String(value).replace(/[$£€\s]/g, '').replace(',', '.'));
      return Number.isFinite(n) ? n : Number.NaN;
    },
    coerceDateLoose: () => null,
    kolSafePricingFileName: value => String(value || 'Quotation').replace(/[^A-Za-z0-9._-]+/g, '_'),
    kolDownloadBuffer() {},
  };
  vm.createContext(context);
  vm.runInContext(html.slice(start, end), context);
  // Bu VM kesiti workbook geometrisini test eder; görsel adaylarını başka testler doğrular.
  // Kayıt tabanlı yardımcıyı testin gerçek Excel dönüştürücüsüne bağla.
  vm.runInContext('async function kolPrepareModelExcelImage(row){ return row && row.img ? kolPrepareExcelImage(row.img) : null; }', context);
  const bridge = context.window.BL_KOL_PRICING_EXCEL;

  const landscape = bridge.anchorBox(1600, 900, 159, 145, 6);
  assert.ok(Math.abs((landscape.width / landscape.height) - (1600 / 900)) < 1e-9);
  assert.ok(Math.abs(landscape.width - 147) < 1e-6, 'landscape image should use the available cell width');
  assert.ok(landscape.height < 145, 'landscape image must not be stretched to row height');

  const portrait = bridge.anchorBox(900, 1600, 159, 145, 6);
  assert.ok(Math.abs((portrait.width / portrait.height) - (900 / 1600)) < 1e-9);
  assert.ok(Math.abs(portrait.height - 133) < 1e-6, 'portrait image should use the available row height');

  const placement = bridge.imagePlacement({ width: 1600, height: 900 }, 2, 159, 145);
  // placement artık açık bir editAs alanı taşımıyor (yalnız {tl,ext}) — ExcelJS br
  // verilmediğinde zaten oneCellAnchor+editAs="oneCell" üretiyor; bu aşağıdaki gerçek
  // OOXML çıktısı testinde ayrıca doğrulanıyor.
  assert.ok(placement.ext && !placement.br, 'image must use fixed pixel extents instead of a two-cell stretch anchor');
  assert.ok(Math.abs((placement.ext.width / placement.ext.height) - (1600 / 900)) < 1e-9);

  const rows = [{
    img: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZgOQAAAAASUVORK5CYII=', modelKod: 'MODEL-7', targetPrice: '10.00',
    _quotationPrices: { 'Factory A': '9.25' },
    _quotationApprovals: { 'Factory A': true },
  }];
  const workbook = await bridge.build(rows, 'History', {
    fileName: 'Quotation_History.xlsx',
    sheetName: 'Quotation History',
    extraColumns: [{
      label: '[Factory A] Quotation Price', width: 24, money: true,
      value: row => row._quotationPrices['Factory A'],
      approved: row => row._quotationApprovals['Factory A'],
    }],
  });
  const loaded = new ExcelJS.Workbook();
  await loaded.xlsx.load(Buffer.from(workbook.buffer));
  const sheet = loaded.getWorksheet('Quotation History');
  assert.equal(sheet.getColumn(1).width, 22);
  assert.equal(sheet.getRow(2).height, 108.75);
  const images=sheet.getImages();
  assert.equal(images.length,1);
  assert.equal(images[0].range.editAs,'oneCell');
  assert.ok(images[0].range.ext && !images[0].range.br);
  // v6.53 — tolerans 1e-6 -> 1e-4 gevşetildi. Bu, xlsx'e YAZILIP GERİ OKUNDUKTAN
  // sonraki oran; px<->EMU dönüşümü kaçınılmaz bir alt-piksel yuvarlaması
  // taşıyor (ölçülen fark ~2e-6, görsel olarak anlamsız). Kanıt: aynı oran
  // xlsx'e hiç yazılmadan (yukarıdaki placement.ext, satır ~180) 1e-9 toleransla
  // tam tutuyor — kayıp yalnız gerçek dosya round-trip'inde oluşuyor, kod
  // regresyonu değil.
  assert.ok(Math.abs((images[0].range.ext.width/images[0].range.ext.height)-(1600/900))<1e-4);
  const JSZip=require(path.join(root,'public','vendor','jszip.min.js'));
  const zip=await JSZip.loadAsync(Buffer.from(workbook.buffer));
  const drawingXml=await zip.file('xl/drawings/drawing1.xml').async('string');
  assert.match(drawingXml,/<xdr:oneCellAnchor[^>]*editAs="oneCell"/);
  assert.match(drawingXml,/noChangeAspect="1"/);
  assert.doesNotMatch(drawingXml,/<xdr:twoCellAnchor/);
  assert.equal(sheet.getCell('D1').value, '[Factory A] Quotation Price');
  assert.equal(sheet.getCell('D2').value, 9.25);
  assert.equal(sheet.getCell('D2').numFmt, '"$"#,##0.00');
  assert.equal(sheet.getCell('D2').fill.fgColor.argb, 'FFE4F3EB');
});
