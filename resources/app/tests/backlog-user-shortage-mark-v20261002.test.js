'use strict';
// Kullanıcı isteği: Buyer Log'un ASAS bakiyesi için açtığı "Üretimde" satırı
// (ör. 5.000 sipariş, IAS'ta 4.000 → 1.000 Üretimde) yüklenmeyecekse, her
// raporda elle düzeltmek yerine CP'de bir kez "Eksik Adet" olarak
// işaretlenebilsin. İşaret sipariş+model+renk satırına bağlı kalıcı bir
// override'dır; Backlog, CP lojistik akışı ve raporlar aynı kaydı okur.
process.env.TZ = 'Europe/Istanbul';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-shortage-mark-'));
Object.assign(process.env, {
  BUYER_LOG_SERVER_DATA_ROOT: path.join(root, 'data'),
  BUYER_LOG_DATA_ROOT: path.join(root, 'app'),
  BUYER_LOG_LOCAL_DATA_ROOT: path.join(root, 'local'),
  BUYER_LOG_CONFIG_PATH: path.join(root, 'config.json'),
});

const db = require('../server/db');
const parse = require('../server/lib/parse');
const scope = require('../server/lib/override-scope');
const syncPolicy = fs.readFileSync(path.join(__dirname, '..', 'server', 'lib', 'shared-sync-policy.js'), 'utf8');
const sharedStore = require('../server/lib/cp-shared-store');
const APP = fs.readFileSync(path.join(__dirname, '..', 'public', 'app-main.js'), 'utf8');

const STATUS = 'GÜNCEL DURUM\n(STATUS)';
const CODE = 1288118, MODEL = 'KBN,KABI-YD', CCODE = 'CVL';
function ov(extra = {}) {
  return {
    antrepoMatchConfig: parse.defaultAntrepoMatchConfig(),
    submap: {}, delmap: {}, suppfobmap: {}, suppfobmetamap: {}, notesmap: {}, licensormap: {},
    pricingRules: [], transitRules: [], ...extra,
  };
}
function data(iasStatuses = ['Depoda', 'Yol Operasyonları'], asasExtra = {}) {
  const config = parse.defaultAntrepoMatchConfig();
  const orders = parse.parseASASRows([{
    'Sezon':'W6', 'Buyer':'ASLI AKZEREN', 'Sipariş Kod':CODE, 'Model Adı':MODEL, 'Renk Kod':CCODE, 'Renk':'NEW BLACK',
    'Net Alım Sipariş Miktarı':5000, 'Kalan Alım Sipariş Miktarı':1000, 'Orijinal Exfactory Merch Tarih':'20260615',
    'Retail Depo Tarih Yıl Ay Gün':'20260914', 'Model Bütçe Tarih Yıl Ay Gün':'20260928', ...asasExtra,
  }], config).orders;
  const map = parse.parseAntrepoRows(iasStatuses.map((status, i) => ({
    'Sipariş Kod':CODE, 'Ürün Ad':MODEL, 'Renk Kod':CCODE, 'Renk Tanım':'NEW BLACK', 'Supplier Portal Statü':status,
    'Vasita Tanim':'Gemi', 'Yükleme Toplam Adet':2000, 'HANDOVER Tarihi':'2026-06-17', 'Tahmini Antrepo Giriş Tarihi':`2026-08-1${i}`,
  })), config);
  return { orders, map };
}
const lineKey = parse.orderLineKey(CODE, MODEL, CCODE);
const balanceRow = rows => rows.find(row => row._partial && row._partial.synthetic);

test('işaretsiz: 1.000 adetlik bakiye Üretimde; işaretli: Eksik Yükleme ve kullanıcı işareti taşır', () => {
  const { orders, map } = data();
  const plain = balanceRow(parse.buildBacklogTemplateRows(orders, map, ov(), {}));
  assert.equal(plain[STATUS], 'Üretimde');
  assert.equal(plain.Adet, 1000);
  assert.equal(plain._partial.userShortage, false);

  const marked = balanceRow(parse.buildBacklogTemplateRows(orders, map, ov({ shortagemap:{ [lineKey]:{ markedAt:'2026-10-02T10:00:00.000Z' } } }), {}));
  assert.equal(marked[STATUS], 'Eksik Yükleme');
  assert.equal(marked.Adet, 1000, 'adet aynı kalır, yalnız statü değişir');
  assert.equal(marked._partial.synthetic, 'shortage');
  assert.equal(marked._partial.userShortage, true);
  assert.equal(marked['Net Gelen Alım Sipariş Miktarı'], 0, 'eksik adet yüklenmiş sayılmaz');
  assert.equal(marked.Sezon, 'W6', 'satırın diğer bilgileri değişmez');
});

test('bütün parsiyeller depodaysa işaretli bakiye "Depoda - Eksik Yükleme" olur; IAS satırlarına dokunulmaz', () => {
  const { orders, map } = data(['Depoda', 'Depoda']);
  const rows = parse.buildBacklogTemplateRows(orders, map, ov({ shortagemap:{ [lineKey]:{} } }), {});
  assert.equal(balanceRow(rows)[STATUS], 'Depoda - Eksik Yükleme');
  const partials = rows.filter(row => !row._partial.synthetic);
  assert.equal(partials.length, 2);
  assert.ok(partials.every(row => row._partial.userShortage === false));
});

test('CP lojistik segmenti aynı işareti taşır ve arayüz geri alma sunar', () => {
  const { orders, map } = data();
  const cp = parse.buildCPRowsFromASAS(orders, map, ov({ shortagemap:{ [lineKey]:{} } }));
  const segments = cp[0]._logisticSegments || cp[0].logisticSegments || [];
  const balance = segments.find(segment => segment.synthetic);
  assert.ok(balance, 'bakiye segmenti bulunur');
  assert.equal(balance.kind, 'shortage');
  assert.equal(balance.userShortage, true);
  assert.match(APP, /function cpShortageActionHtml\(row,segment,segments\)/);
  assert.match(APP, /data-shortage-action="mark"/);
  assert.match(APP, /data-shortage-action="unmark"/);
  assert.match(APP, /shortage:marked\?\{marked:true,qty\}:null/);
});

test('işaret kalıcı kaydedilir, yazar oturumdan gelir, kaldırılınca silinir; kapsam ve eşitleme listelerinde', () => {
  const actor = { id:'u-1', name:'Gökberk' };
  let saved = db.patchOrderOverride(CODE, { model:MODEL, ccode:CCODE, shortage:{ marked:true, qty:1000 } }, null, null, { actor });
  const record = saved.overrides.shortagemap[lineKey];
  assert.ok(record, 'satır anahtarıyla saklanır');
  assert.equal(record.by, 'u-1');
  assert.equal(record.byName, 'Gökberk');
  assert.equal(record.qty, 1000);
  saved = db.patchOrderOverride(CODE, { model:MODEL, ccode:CCODE, shortage:null }, null, null, { actor });
  assert.equal(saved.overrides.shortagemap[lineKey], undefined);

  assert.ok(scope.ORDER_SCOPED_MAPS.includes('shortagemap'), 'kapsam dışı kullanıcıya gösterilmez');
  assert.match(syncPolicy, /'datemap', 'shortagemap'/);
  assert.equal(sharedStore.FIELDS.shortage, 'shortagemap');
});
