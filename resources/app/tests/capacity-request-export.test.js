/* Capacity Request Excel export — alan esleme ve granularity regresyonlari.
   Kural tek yerde (public/capacity-request-export.js) yasar; bu dosya o
   sozlesmeyi hem Koleksiyon hem CP satir sekli icin dogrular. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

require('../public/canonical-fields.js');
const CR = require('../public/capacity-request-export.js');

const TODAY = new Date(2026, 8, 17); // 2026-09-17, yerel gun

/* Koleksiyon satir sekli: kol* modulunun kendi camelCase anahtarlari. */
function collectionRow(over) {
  return Object.assign({
    id: 1,
    plmId: 'PLM-123',
    modelKod: 'ARDA/BARCHA-9',
    colour: 'BLACK',
    quantity: 1200,
    season: 'W6',
    mmyg: 'MMYG-1',
    mag: 'MAG-1',
    buyingGroup: 'ORME',
    confirmedManufacturer: 'ACME',
    urunTipi: 'T-Shirt',
    exFactory: '2026-10-19',
    retail: '2026-12-01',
    fob: 8.5
  }, over || {});
}

/* CP satir sekli: ASAS basliklariyla gelen ham satir. */
function cpRow(over) {
  return Object.assign({
    _id: 'cp-1',
    'PLM ID': 'PLM-123',
    'Model Name': 'Model A',
    Colour: 'BLACK',
    'Order Quantity': 1200,
    Season: 'W6',
    MMYG: 'MMYG-1',
    MAG: 'MAG-1',
    'Buying Group': 'ORME',
    Manufacturer: 'ACME',
    Category: 'T-Shirt',
    OPD: '2026-09-30',
    'Ex-factory': '2026-10-19',
    'Retail Date': '2026-12-01',
    'FOB ($)': 8.5
  }, over || {});
}

const col = name => CR.HEADERS.indexOf(name);

test('sutun sozlesmesi: 20 sutun, verilen sirayla', () => {
  assert.strictEqual(CR.HEADERS.length, 20);
  assert.deepStrictEqual(CR.HEADERS.slice(0, 7), [
    'Supplier Name', 'Season', 'PLM Code', 'Style', 'Color', 'units', 'Garment Qty'
  ]);
  assert.strictEqual(CR.HEADERS[12], 'garment ex-factory date: (shipment date)');
  assert.strictEqual(CR.HEADERS[15], "Supplier's delivery confirmation mail");
  assert.strictEqual(CR.HEADERS[19], 'Ex-Factory to Retail Stock Date');
});

test('1 · Koleksiyon normal urun: units ve Garment Qty Quantity ile ayni', () => {
  const out = CR.buildExport([collectionRow()], 'collection', { today: TODAY });
  assert.strictEqual(out.rows.length, 1);
  assert.strictEqual(out.rows[0].units, 1200);
  assert.strictEqual(out.rows[0].garmentQty, 1200);
});

test('2 · Koleksiyon Takim/Set: Garment Qty = Quantity x 2', () => {
  for (const category of ["2'li Takim (T-shirt+Sort)", "2'li Takım (T-shirt+Şort)", 'KEY JERSEY SET', 'takim', 'set', 'TAKIM']) {
    const out = CR.buildExport([collectionRow({ urunTipi: category })], 'collection', { today: TODAY });
    assert.strictEqual(out.rows[0].garmentQty, 2400, 'beklenen carpan 2: ' + category);
    assert.strictEqual(out.rows[0].units, 1200, 'units carpandan etkilenmez: ' + category);
  }
});

test('3 · CP normal urun: units ve Garment Qty Order Quantity ile ayni', () => {
  const out = CR.buildExport([cpRow()], 'cp', { today: TODAY });
  assert.strictEqual(out.rows[0].units, 1200);
  assert.strictEqual(out.rows[0].garmentQty, 1200);
});

test('4 · CP Takim/Set: Garment Qty = Order Quantity x 2', () => {
  const out = CR.buildExport([cpRow({ Category: 'ORME TAKİM-LİSANS' })], 'cp', { today: TODAY });
  assert.strictEqual(out.rows[0].garmentQty, 2400);
});

test('Takim/Set tespiti yalniz klasman alanindan yapilir, model adindan degil', () => {
  const out = CR.buildExport([cpRow({ 'Model Name': 'SUNSET BASIC TEE', Category: 'T-Shirt' })], 'cp', { today: TODAY });
  assert.strictEqual(out.rows[0].garmentQty, 1200, 'stil adindaki SUNSET carpani degistirmemeli');
});

test('5-7 · Supplier Name birlesimi', () => {
  assert.strictEqual(CR.buildExport([cpRow({ Manufacturer: 'A', 'Sub-Manufacturer': 'B' })], 'cp', { today: TODAY }).rows[0].supplierName, 'A / B');
  assert.strictEqual(CR.buildExport([cpRow({ Manufacturer: 'A', 'Sub-Manufacturer': '' })], 'cp', { today: TODAY }).rows[0].supplierName, 'A');
  assert.strictEqual(CR.buildExport([cpRow({ Manufacturer: '', 'Sub-Manufacturer': 'B' })], 'cp', { today: TODAY }).rows[0].supplierName, 'B');
  assert.strictEqual(CR.buildExport([cpRow({ Manufacturer: '', 'Sub-Manufacturer': '' })], 'cp', { today: TODAY }).rows[0].supplierName, '');
  assert.strictEqual(CR.buildExport([collectionRow({ confirmedManufacturer: 'A' })], 'collection', { today: TODAY }).rows[0].supplierName, 'A');
});

test('8 · Ayni PLM altindaki uc renk uc ayri satir olarak kalir', () => {
  const rows = [
    cpRow({ _id: 'a', Colour: 'BLACK', 'Order Quantity': 100 }),
    cpRow({ _id: 'b', Colour: 'WHITE', 'Order Quantity': 200 }),
    cpRow({ _id: 'c', Colour: 'BLUE', 'Order Quantity': 300 })
  ];
  const out = CR.buildExport(rows, 'cp', { today: TODAY });
  assert.strictEqual(out.rows.length, 3);
  assert.deepStrictEqual(out.rows.map(r => r.color), ['BLACK', 'WHITE', 'BLUE']);
  assert.deepStrictEqual(out.rows.map(r => r.units), [100, 200, 300], 'adetler toplanmaz, ilk degere indirgenmez');
});

test('satirlar arasinda tarih/FOB/supplier tasinmaz', () => {
  const out = CR.buildExport([
    cpRow({ _id: 'a', Manufacturer: 'A', 'FOB ($)': 5, 'Ex-factory': '2026-10-01' }),
    cpRow({ _id: 'b', Manufacturer: 'B', 'FOB ($)': 9, 'Ex-factory': '2026-11-01' })
  ], 'cp', { today: TODAY });
  assert.deepStrictEqual(out.rows.map(r => r.supplierName), ['A', 'B']);
  assert.deepStrictEqual(out.rows.map(r => r.fobPrice), [5, 9]);
  assert.deepStrictEqual(out.rows.map(r => r.exFactoryDate.getMonth()), [9, 10]);
});

test('9-11 · Collection PO Issuing Date export gunudur; OPD olsa bile kullanilmaz', () => {
  const out = CR.buildExport([collectionRow({ OPD: '2026-08-01' })], 'collection', { today: TODAY });
  const row = out.rows[0];
  assert.strictEqual(row.capacityRequestSendingDate.getTime(), TODAY.getTime());
  assert.strictEqual(row.poIssuingDate.getTime(), TODAY.getTime());
  assert.strictEqual(row.capacityRequestSendingDate.getHours(), 0, 'saat yazilmaz');
});

test('Collection disinda PO Issuing Date canonical OPD / Order Placement Date degerinden gelir', () => {
  const out = CR.buildExport([cpRow({ OPD: '2026-10-15' })], 'cp', { today: TODAY });
  const row = out.rows[0];
  assert.strictEqual(row.capacityRequestSendingDate.getTime(), TODAY.getTime(), 'gonderim tarihi yine export gunudur');
  assert.strictEqual(row.poIssuingDate.getFullYear(), 2026);
  assert.strictEqual(row.poIssuingDate.getMonth(), 9);
  assert.strictEqual(row.poIssuingDate.getDate(), 15);
});

test('Orders gercek ASAS Siparis Yerleştirme MerchTarih alanini kullanir', () => {
  const row = cpRow({OPD:'', 'Order Placement Date':'', 'Sipariş Yerleştirme MerchTarih':'2026-09-28'});
  const mapped = CR.buildExport([row], 'orders', {today:TODAY}).rows[0];
  assert.strictEqual(mapped.poIssuingDate.getDate(), 28);
  assert.strictEqual(mapped.poIssueToExFactory, 21);
});

test('Collection disinda gecmis/ileri OPD aynen korunur; bos OPD bugune dusmez', () => {
  const past = CR.buildExport([cpRow({ OPD: '2026-08-01' })], 'cp', { today: TODAY }).rows[0];
  const future = CR.buildExport([cpRow({ OPD: '2027-01-05' })], 'cp', { today: TODAY }).rows[0];
  const blank = CR.buildExport([cpRow({ OPD: '', 'Order Placement Date': '', orderPlacementDate: '' })], 'cp', { today: TODAY }).rows[0];
  assert.deepStrictEqual([past.poIssuingDate.getFullYear(), past.poIssuingDate.getMonth()+1, past.poIssuingDate.getDate()],[2026,8,1]);
  assert.deepStrictEqual([future.poIssuingDate.getFullYear(), future.poIssuingDate.getMonth()+1, future.poIssuingDate.getDate()],[2027,1,5]);
  assert.strictEqual(blank.poIssuingDate, null, 'eksik OPD sahte bugun tarihiyle doldurulmaz');
});

test('12 · Retail Stock Date yalniz Retail Date kaynagindan gelir', () => {
  const out = CR.buildExport([cpRow({ 'Retail Date': '2026-12-01', 'In-Store': '2027-01-15' })], 'cp', { today: TODAY });
  assert.strictEqual(out.rows[0].retailStockDate.getFullYear(), 2026);
  assert.strictEqual(out.rows[0].retailStockDate.getMonth(), 11);
  const none = CR.buildExport([cpRow({ 'Retail Date': '', 'In-Store': '2027-01-15' })], 'cp', { today: TODAY });
  assert.strictEqual(none.rows[0].retailStockDate, null, 'In-Store bosluga dusmemeli');
});

test('13 · FOB PRICE yalniz FOB kaynagindan gelir, Supplier FOB degil', () => {
  const out = CR.buildExport([cpRow({ 'FOB ($)': 8.5, 'Supp. FOB': 99 })], 'cp', { today: TODAY });
  assert.strictEqual(out.rows[0].fobPrice, 8.5);
  const none = CR.buildExport([cpRow({ 'FOB ($)': '', 'Supp. FOB': 99 })], 'cp', { today: TODAY });
  assert.strictEqual(none.rows[0].fobPrice, null);
});

test('14-16 · uc sutun her zaman bostur', () => {
  const row = CR.buildExport([cpRow({
    Country: 'Egypt', 'Fabric Supplier': 'MILL X', Buyer: 'someone@example.com'
  })], 'cp', { today: TODAY }).rows[0];
  assert.strictEqual(row.fabricCountryOrigin, '');
  assert.strictEqual(row.fabricMillName, '');
  assert.strictEqual(row.supplierConfirmationMail, '');
});

test('17-18 · gun farki alanlari', () => {
  // PO Issuing = 2026-09-30, Ex-Factory = 2026-10-19 -> 19 gun
  // Ex-Factory = 2026-10-19, Retail = 2026-12-01 -> 43 gun
  const row = CR.buildExport([cpRow()], 'cp', { today: TODAY }).rows[0];
  assert.strictEqual(row.poIssueToExFactory, 19);
  assert.strictEqual(row.exFactoryToRetail, 43);
});

test('gun farki eksik tarihte bos kalir, dosya uretimini engellemez', () => {
  const row = CR.buildExport([cpRow({ 'Ex-factory': '', 'Retail Date': '' })], 'cp', { today: TODAY }).rows[0];
  assert.strictEqual(row.poIssueToExFactory, null);
  assert.strictEqual(row.exFactoryToRetail, null);
  assert.strictEqual(CR.toArray(row)[col('PO Issue to Ex-Factory')], '');
});

test('19 · secili satir yoksa workbook modeli bos kalir', () => {
  const out = CR.buildExport([], 'cp', { today: TODAY });
  assert.strictEqual(out.rows.length, 0);
  assert.strictEqual(out.matrix.length, 0);
});

test('adet cozulemeyen satir reddedilir, digerleri sessizce kaybolmaz', () => {
  const out = CR.buildExport([
    cpRow({ _id: 'a', 'Order Quantity': 100 }),
    cpRow({ _id: 'b', 'Order Quantity': '', 'Net Alim Siparis Miktari': '' }),
    cpRow({ _id: 'c', 'Order Quantity': 300 })
  ], 'cp', { today: TODAY });
  assert.strictEqual(out.rows.length, 2);
  assert.deepStrictEqual(out.rows.map(r => r.units), [100, 300]);
  assert.strictEqual(out.rejected.length, 1);
  assert.strictEqual(out.rejected[0].reason, 'quantity');
  assert.match(out.rejected[0].identity, /PLM-123/);
});

test('eksik opsiyonel alanlar satiri dusurmez', () => {
  const out = CR.buildExport([cpRow({
    Manufacturer: '', 'FOB ($)': '', 'Ex-factory': '', 'Retail Date': '', Season: '', MMYG: '', MAG: ''
  })], 'cp', { today: TODAY });
  assert.strictEqual(out.rows.length, 1);
  assert.strictEqual(out.rejected.length, 0);
  assert.strictEqual(out.rows[0].units, 1200);
});

test('metin adet ve fiyat degerleri numerige cozulur', () => {
  assert.strictEqual(CR.toNumber('1.234'), 1234);
  assert.strictEqual(CR.toNumber('1,234'), 1234);
  assert.strictEqual(CR.toNumber('1.234,50'), 1234.5);
  assert.strictEqual(CR.toNumber('1,234.50'), 1234.5);
  assert.strictEqual(CR.toNumber('8,5'), 8.5);
  assert.strictEqual(CR.toNumber(''), null);
  assert.strictEqual(CR.toNumber('abc'), null);
  assert.strictEqual(CR.toNumber(0), 0);
});

test('matrix satir sirasi HEADERS ile hizalidir', () => {
  const out = CR.buildExport([cpRow({ Manufacturer: 'A', 'Sub-Manufacturer': 'B' })], 'cp', { today: TODAY });
  const line = out.matrix[0];
  assert.strictEqual(line.length, CR.HEADERS.length);
  assert.strictEqual(line[col('Supplier Name')], 'A / B');
  assert.strictEqual(line[col('PLM Code')], 'PLM-123');
  assert.strictEqual(line[col('Color')], 'BLACK');
  assert.strictEqual(line[col('units')], 1200);
  assert.strictEqual(line[col('Fabric Mill Name')], '');
});

test('dosya adi standardi', () => {
  assert.strictEqual(CR.fileName(TODAY), 'Capacity Request - 2026-09-17.xlsx');
});

/* --- Cagri yolu sozlesmesi: app-main ve index.html gercekten baglanmis mi --- */

const appMain = fs.readFileSync(path.join(__dirname, '..', 'public', 'app-main.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

test('20 · Tools menuleri komutu tasir ve mevcut Tools butonlari korunur', () => {
  assert.match(indexHtml, /id="kolCapacityRequestBtn"/);
  assert.match(indexHtml, /id="cpCapacityRequestBtn"/);
  assert.match(indexHtml, /Create Capacity Request Excel/);
  // Mevcut secim/aksiyon butonlari yerinde kalmali.
  assert.match(indexHtml, /id="kolMbExportBtn"/);
  assert.match(indexHtml, /id="kolSendPricingBtn"/);
  assert.match(indexHtml, /id="cpExcelImportBtn"/);
});

test('Capacity Request secime baglidir ve secim yokken pasif kalir', () => {
  assert.match(indexHtml, /id="cpCapacityRequestBtn"[^>]*\bdisabled\b/);
  assert.match(indexHtml, /id="kolCapacityRequestBtn"[^>]*\bdisabled\b/);

  const cpStateStart = appMain.indexOf('function updateShippingBtnVisibility()');
  assert.ok(cpStateStart > 0, 'CP secim durumu senkronlayicisi bulunmali');
  const cpState = appMain.slice(cpStateStart, cpStateStart + 7000);
  assert.match(cpState, /getElementById\('cpCapacityRequestBtn'\)/);
  assert.match(cpState, /capacityRequestBtn\.disabled\s*=\s*!hasActionSelection/);

  const kolStateStart = appMain.indexOf('function updateKolSendBtnState()');
  assert.ok(kolStateStart > 0, 'Collection secim durumu senkronlayicisi bulunmali');
  const kolState = appMain.slice(kolStateStart, kolStateStart + 5000);
  assert.match(kolState, /getElementById\('kolCapacityRequestBtn'\)/);
  assert.match(kolState, /capacityRequestBtn\.disabled\s*=\s*!hasSelection/);

  const bindStart = appMain.indexOf('function bindCapacityRequestButton');
  const bind = appMain.slice(bindStart, bindStart + 1400);
  assert.match(bind, /source==='cp'\)updateShippingBtnVisibility\(\)/);
  assert.match(bind, /source==='collection'\)updateKolSendBtnState\(\)/);
});

test('export yolu mevcut secim state ve indirme altyapisini kullanir', () => {
  const start = appMain.indexOf('async function capacityRequestExport');
  assert.ok(start > 0, 'capacityRequestExport tanimli olmali');
  const block = appMain.slice(start, start + 4000);
  assert.match(block, /window\.BLCapacityRequest/, 'ortak mapping motoru uzerinden gitmeli');
  assert.match(block, /kolDownloadBuffer/, 'mevcut indirme yolu kullanilmali');
  assert.match(block, /ensureLibrary\('exceljs'\)/, 'mevcut ExcelJS yukleme yolu kullanilmali');
  const kol = appMain.slice(appMain.indexOf('function kolCapacityRequestRows'), appMain.indexOf('function kolCapacityRequestRows') + 400);
  assert.match(kol, /kolSelected/, 'Koleksiyon mevcut secim setini okumali');
  const cp = appMain.slice(appMain.indexOf('function cpCapacityRequestRows'), appMain.indexOf('function cpCapacityRequestRows') + 400);
  assert.match(cp, /selectedCpRowsForAction/, 'CP mevcut secim cozumleyicisini okumali');
});

test('script index.html icinde yuklenir', () => {
  assert.match(indexHtml, /capacity-request-export\.js/);
  assert.match(indexHtml, /canonical-fields\.js\?v=/, 'canonical registry eager yuklenmeli');
});
