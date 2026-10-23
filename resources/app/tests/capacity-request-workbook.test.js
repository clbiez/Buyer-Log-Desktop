/* Capacity Request Excel — gercek .xlsx uretip geri okuyan uctan uca dogrulama.
   Uygulamanin kullandigi yazicinin ta kendisi (BLCapacityRequest.buildWorkbook)
   calisir; dosya diske yazilir, ayri bir okuyucuyla (SheetJS) tekrar acilir. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ExcelJS = require('../public/vendor/exceljs.min.js');
const XLSX = require('xlsx');
require('../public/canonical-fields.js');
const DATES = require('../public/excel-date-utils.js');
const CR = require('../public/capacity-request-export.js');

const TODAY = new Date(2026, 8, 17);

const CP_ROWS = [
  {
    _id: 'a', 'PLM ID': 'PLM-123', 'Model Name': 'JERSEY TEE', Colour: 'BLACK',
    'Order Quantity': 1200, Season: 'W6', MMYG: 'MMYG-1', MAG: 'MAG-1',
    'Buying Group': 'ORME', Manufacturer: 'ACME', 'Sub-Manufacturer': 'BETA',
    Category: 'T-Shirt', OPD: '2026-09-30', 'Ex-factory': '2026-10-19', 'Retail Date': '2026-12-01',
    'FOB ($)': 8.5, Country: 'Egypt', 'Supp. FOB': 99, 'In-Store': '2027-01-15'
  },
  {
    _id: 'b', 'PLM ID': 'PLM-123', 'Model Name': 'JERSEY TEE', Colour: 'WHITE',
    'Order Quantity': 800, Season: 'W6', MMYG: 'MMYG-1', MAG: 'MAG-1',
    'Buying Group': 'ORME', Manufacturer: 'ACME', Category: 'T-Shirt',
    'Ex-factory': '2026-10-19', 'Retail Date': '2026-12-01', 'FOB ($)': 8.5
  },
  {
    _id: 'c', 'PLM ID': 'PLM-123', 'Model Name': 'JERSEY SET', Colour: 'BLUE',
    'Order Quantity': 500, Season: 'W6', MMYG: 'MMYG-1', MAG: 'MAG-1',
    'Buying Group': 'ORME', 'Sub-Manufacturer': 'BETA',
    Category: "2'li Takım (T-shirt+Şort)", OPD: '2026-09-30',
    'Ex-factory': '2026-11-02', 'Retail Date': '2026-12-20', 'FOB ($)': 12.75
  }
];

async function writeAndRead(rows, source) {
  const result = CR.buildExport(rows, source, { today: TODAY });
  const wb = CR.buildWorkbook(result, ExcelJS, 'dd.mm.yyyy');
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bl-cr-')), CR.fileName(TODAY));
  // Uygulamanin indirme yolu da writeBuffer kullanir (kolDownloadBuffer).
  fs.writeFileSync(file, Buffer.from(await wb.xlsx.writeBuffer()));
  // Tarihler ham Excel serial'i olarak okunur: SheetJS'in cellDates donusumu
  // yerel saat diliminde gunu kaydirir, dosyadaki serial ise Excel'in gercekte
  // gosterecegi degerdir.
  const read = XLSX.readFile(file);
  const sheet = read.Sheets[read.SheetNames[0]];
  return {
    file,
    result,
    sheetNames: read.SheetNames,
    sheet,
    aoa: XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, blankrows: false, defval: null })
  };
}

test('uretilen workbook geri okundugunda sozlesmeye uyar', async () => {
  const { file, sheetNames, aoa, sheet } = await writeAndRead(CP_ROWS, 'cp');
  try {
    assert.deepStrictEqual(sheetNames, ['Jersey'], 'ana sayfa Jersey olmali');

    // Baslik sirasi
    assert.deepStrictEqual(aoa[0], CR.HEADERS.slice());

    // Satir sayisi: 3 secili satir = 3 veri satiri, sablon ornek verisi kalmaz
    assert.strictEqual(aoa.length - 1, 3);

    const idx = name => CR.HEADERS.indexOf(name);
    const [r1, r2, r3] = aoa.slice(1);

    // Supplier Name birlesimi
    assert.strictEqual(r1[idx('Supplier Name')], 'ACME / BETA');
    assert.strictEqual(r2[idx('Supplier Name')], 'ACME');
    assert.strictEqual(r3[idx('Supplier Name')], 'BETA');

    // Renkler collapse olmaz
    assert.deepStrictEqual([r1, r2, r3].map(r => r[idx('Color')]), ['BLACK', 'WHITE', 'BLUE']);

    // Quantity numerik ve satira ozel
    assert.deepStrictEqual([r1, r2, r3].map(r => r[idx('units')]), [1200, 800, 500]);
    [r1, r2, r3].forEach(r => assert.strictEqual(typeof r[idx('units')], 'number'));

    // Garment Qty: normal 1x, Takim 2x
    assert.deepStrictEqual([r1, r2, r3].map(r => r[idx('Garment Qty')]), [1200, 800, 1000]);

    // Tarihler: dosyada duran serial, Excel'in gosterecegi takvim gunudur.
    const day = (y, m, d) => DATES.excelSerial(new Date(y, m - 1, d));
    const sending = r1[idx('Capacity Request sending Date')];
    const issuing = r1[idx('PO Issuing Date')];
    assert.strictEqual(sending, day(2026, 9, 17), 'gonderim tarihi export gunu olmali');
    assert.strictEqual(issuing, day(2026, 9, 30), 'CP PO Issuing Date canonical OPD kaynagindan gelmeli');
    assert.strictEqual(r1[idx('garment ex-factory date: (shipment date)')], day(2026, 10, 19));
    assert.strictEqual(r1[idx('Retail Stock Date')], day(2026, 12, 1), 'Retail Date kaynagi, In-Store degil');
    // Hucre gercekten tarih formatli mi (saat bileseni yok)
    assert.strictEqual(sheet.K2.z || sheet.K2.numFmt || DATES.DATE_FORMAT, DATES.DATE_FORMAT);

    // FOB numerik ve yalniz FOB kaynagindan
    assert.strictEqual(r1[idx('FOB PRICE')], 8.5);
    assert.strictEqual(r3[idx('FOB PRICE')], 12.75);

    // Her zaman bos uc sutun
    ['Fabric Country Origin', 'Fabric Mill Name', "Supplier's delivery confirmation mail"].forEach(header => {
      [r1, r2, r3].forEach(r => {
        const cell = r[idx(header)];
        assert.ok(cell === null || cell === undefined || cell === '', header + ' bos olmali, gelen: ' + cell);
      });
    });

    // Excel formulleri: kullanici inputu degistirdiginde kendiliginden hesaplanir.
    assert.strictEqual(sheet.G2.f, 'IF(F2="","",F2*1)');
    assert.strictEqual(sheet.G4.f, 'IF(F4="","",F4*2)');
    assert.strictEqual(sheet.S2.f, 'IF(OR(L2="",M2=""),"",M2-L2)');
    assert.strictEqual(sheet.T2.f, 'IF(OR(M2="",Q2=""),"",Q2-M2)');
    assert.strictEqual(sheet.S3.f, 'IF(OR(L3="",M3=""),"",M3-L3)', 'OPD eksikse de manuel giriste hesaplamaya hazir');
    assert.ok(r2[idx('PO Issue to Ex-Factory')] == null || r2[idx('PO Issue to Ex-Factory')] === '', 'tarihi eksik satirda sahte sonuc yok');

    // Gun farklari
    assert.strictEqual(r1[idx('PO Issue to Ex-Factory')], 19);
    assert.strictEqual(r1[idx('Ex-Factory to Retail Stock Date')], 43);
    assert.strictEqual(r3[idx('PO Issue to Ex-Factory')], 33);  // 09-30 -> 11-02
    assert.strictEqual(r3[idx('Ex-Factory to Retail Stock Date')], 48); // 11-02 -> 12-20
  } finally {
    fs.rmSync(path.dirname(file), { recursive: true, force: true });
  }
});

test('Koleksiyon secimi de ayni workbook sozlesmesini uretir', async () => {
  const rows = [
    { id: 1, plmId: 'PLM-9', modelKod: 'ARDA-1', colour: 'BLACK', quantity: 300, season: 'W6',
      confirmedManufacturer: 'ACME', urunTipi: 'T-Shirt', exFactory: '2026-10-19',
      retail: '2026-12-01', fob: 7, mmyg: 'M1', mag: 'A1', buyingGroup: 'ORME', OPD: '2026-08-01' },
    { id: 2, plmId: 'PLM-9', modelKod: 'ARDA-1-TKM', colour: 'WHITE', quantity: 300, season: 'W6',
      confirmedManufacturer: 'ACME', urunTipi: "2'li Takım", exFactory: '2026-10-19',
      retail: '2026-12-01', fob: 7, mmyg: 'M1', mag: 'A1', buyingGroup: 'ORME' }
  ];
  const { file, aoa } = await writeAndRead(rows, 'collection');
  try {
    const idx = name => CR.HEADERS.indexOf(name);
    assert.deepStrictEqual(aoa[0], CR.HEADERS.slice());
    assert.strictEqual(aoa.length - 1, 2);
    assert.deepStrictEqual(aoa.slice(1).map(r => r[idx('units')]), [300, 300]);
    assert.deepStrictEqual(aoa.slice(1).map(r => r[idx('Garment Qty')]), [300, 600]);
    assert.deepStrictEqual(aoa.slice(1).map(r => r[idx('Supplier Name')]), ['ACME', 'ACME']);
    assert.deepStrictEqual(aoa.slice(1).map(r => r[idx('Color')]), ['BLACK', 'WHITE']);
    const day = (y, m, d) => DATES.excelSerial(new Date(y, m - 1, d));
    assert.deepStrictEqual(aoa.slice(1).map(r => r[idx('PO Issuing Date')]), [day(2026,9,17), day(2026,9,17)], 'Collection OPD degeri olsa bile export gununu kullanmali');
  } finally {
    fs.rmSync(path.dirname(file), { recursive: true, force: true });
  }
});

test('sayfa duzeni: donmus baslik, autofilter ve sutun genislikleri', async () => {
  const result = CR.buildExport(CP_ROWS, 'cp', { today: TODAY });
  const wb = CR.buildWorkbook(result, ExcelJS, 'dd.mm.yyyy');
  const ws = wb.getWorksheet('Jersey');
  assert.strictEqual(ws.views[0].state, 'frozen');
  assert.strictEqual(ws.views[0].ySplit, 1);
  assert.strictEqual(ws.autoFilter.to.column, CR.HEADERS.length);
  assert.strictEqual(ws.columns.length, CR.HEADERS.length);
  assert.deepStrictEqual(ws.columns.map(c => c.width), CR.COLUMN_WIDTHS.slice());
  assert.strictEqual(ws.getRow(2).getCell(CR.ORDER.indexOf('capacityRequestSendingDate') + 1).numFmt, 'dd.mm.yyyy');
});
