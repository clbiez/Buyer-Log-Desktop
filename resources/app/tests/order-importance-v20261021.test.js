'use strict';
// Kullanıcı isteği (2026-10-21):
//  · Bazı siparişler / Line grupları özeldir (BTS, Transition, Bayram, Ekvator,
//    New Year). Etiket almamış sipariş Regular'dır. Etiket sipariş satırı bazındadır.
//  · Legacy Backlog'da yeni bir sütun: giriş yoksa Regular, varsa seçilen değer;
//    hücre serbest metin kabul etmez, seçenekler Ayarlar'dan düzenlenir.
//  · Backlog özetleri riskli siparişin içindeki özel siparişleri ayrıca gösterir.
//  · Legacy Backlog'daki "Üretici Tükleme Tipi Teyidi" sütunu kaldırılır.
//  · RİSK: Retail tarihine antrepo yetişmiyorsa VAR; yükleme onayı verilmiş ama
//    handover edilmemiş ve 3 günden fazla geçmişse VAR; ortalama yol süresiyle.
process.env.TZ = 'Europe/Istanbul';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-importance-'));
Object.assign(process.env, {
  BUYER_LOG_SERVER_DATA_ROOT: path.join(root, 'data'),
  BUYER_LOG_DATA_ROOT: path.join(root, 'app'),
  BUYER_LOG_LOCAL_DATA_ROOT: path.join(root, 'local'),
  BUYER_LOG_CONFIG_PATH: path.join(root, 'config.json'),
});

const OI = require('../public/order-importance');
const rules = require('../public/business-rules');
const formulas = require('../public/backlog-excel-formulas');
const V3 = require('../public/backlog-v3-report');
const db = require('../server/db');
const parse = require('../server/lib/parse');
const scope = require('../server/lib/override-scope');
const sharedStore = require('../server/lib/cp-shared-store');
const policy = require('../server/lib/shared-sync-policy');

const read = rel => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
const IMP = 'ÖNEM ETİKETİ\n(IMPORTANCE)';
const RISK = 'RİSK\n(PRIORITY)';
const CODE = 1288118, MODEL = 'KBN,KABI-YD', CCODE = 'CVL';
const lineKey = parse.orderLineKey(CODE, MODEL, CCODE);

function ov(extra = {}) {
  return {
    antrepoMatchConfig: parse.defaultAntrepoMatchConfig(),
    submap: {}, delmap: {}, suppfobmap: {}, suppfobmetamap: {}, notesmap: {}, licensormap: {},
    pricingRules: [], transitRules: [], ...extra,
  };
}
function data() {
  const config = parse.defaultAntrepoMatchConfig();
  const orders = parse.parseASASRows([{
    'Sezon':'W6', 'Buyer':'BUYER', 'Line':'KIDS BTS', 'Sipariş Kod':CODE, 'Model Adı':MODEL, 'Renk Kod':CCODE, 'Renk':'NEW BLACK',
    'Net Alım Sipariş Miktarı':5000, 'Kalan Alım Sipariş Miktarı':1000, 'Orijinal Exfactory Merch Tarih':'20260615',
    'Retail Depo Tarih Yıl Ay Gün':'20260914', 'Model Bütçe Tarih Yıl Ay Gün':'20260928',
  }], config).orders;
  const map = parse.parseAntrepoRows([{
    'Sipariş Kod':CODE, 'Ürün Ad':MODEL, 'Renk Kod':CCODE, 'Renk Tanım':'NEW BLACK', 'Supplier Portal Statü':'Depoda',
    'Vasita Tanim':'Gemi', 'Yükleme Toplam Adet':4000, 'HANDOVER Tarihi':'2026-06-17', 'Tahmini Antrepo Giriş Tarihi':'2026-08-10',
  }], config);
  return { orders, map };
}

test('katalog: ön tanımlı beş etiket; Regular katalogda tutulmaz', () => {
  const s = OI.defaultSettings();
  assert.deepEqual(s.tags.map(tag => tag.label), ['BTS', 'Transition', 'Bayram', 'Ekvator', 'New Year']);
  assert.deepEqual(s.rules, []);
  assert.equal(OI.normalizeTags([{ label:'Regular' }, { label:'bts' }, { label:'BTS' }]).length, 1, 'Regular ve büyük/küçük harf tekrarları elenir');
  assert.deepEqual(OI.excelValues(s), ['Regular', 'BTS', 'Transition', 'Bayram', 'Ekvator', 'New Year']);
  assert.equal(OI.idForLabel(s, 'Eid (Bayram)'), 'bayram', 'İngilizce ad da tanınır');
  assert.equal(OI.idForLabel(s, 'regular'), 'regular');
});

test('çözümleme: sipariş etiketi > Line/Sezon kuralı > Regular; açık Regular kuralı ezer', () => {
  const s = OI.normalizeSettings({ tags: OI.DEFAULT_TAGS, rules: [{ tagId:'bts', lines:['Kids BTS'], seasons:['W6'] }] });
  assert.deepEqual(OI.resolve({ line:'KIDS BTS', season:'W6' }, undefined, s).label, 'BTS');
  assert.equal(OI.resolve({ line:'KIDS BTS', season:'W6' }, undefined, s).source, 'rule');
  assert.equal(OI.resolve({ line:'KIDS BTS', season:'S7' }, undefined, s).label, 'Regular', 'sezon kısıtı uygulanır');
  assert.equal(OI.resolve({ line:'KIDS BTS', season:'W6' }, 'bayram', s).label, 'Bayram');
  const explicitRegular = OI.resolve({ line:'KIDS BTS', season:'W6' }, 'regular', s);
  assert.equal(explicitRegular.label, 'Regular');
  assert.equal(explicitRegular.source, 'manual');
  assert.equal(OI.resolve({ line:'OTHER' }, 'silinmis-etiket', s).label, 'Regular', 'katalogda olmayan kimlik yok sayılır');
  assert.deepEqual(OI.normalizeRules([{ tagId:'yok', lines:['A'] }, { tagId:'bts', lines:[] }], new Set(['bts'])), [], 'geçersiz kural kaydedilmez');
});

test('CP satırı ve Legacy Backlog sütunu aynı etiketi taşır; etiket yoksa Regular', () => {
  const { orders, map } = data();
  const plainCp = parse.buildCPRowsFromASAS(orders, map, ov())[0];
  assert.equal(plainCp.Importance, 'Regular');
  const plainBacklog = parse.buildBacklogTemplateRows(orders, map, ov(), {});
  assert.ok(plainBacklog.every(row => row[IMP] === 'Regular'));

  const byRule = ov({ importanceSettings: { tags: OI.DEFAULT_TAGS, rules: [{ tagId:'bts', lines:['KIDS BTS'] }] } });
  assert.equal(parse.buildCPRowsFromASAS(orders, map, byRule)[0].Importance, 'BTS');
  const manual = ov({ importancemap: { [lineKey]:'new-year' } });
  const cp = parse.buildCPRowsFromASAS(orders, map, manual)[0];
  assert.equal(cp.Importance, 'New Year');
  assert.equal(cp._importanceSource, 'manual');
  const backlog = parse.buildBacklogTemplateRows(orders, map, manual, {});
  assert.ok(backlog.every(row => row[IMP] === 'New Year'), 'parsiyel ve bakiye satırları siparişin etiketini taşır');
  assert.ok(backlog.every(row => row._backlogExcel.importanceId === 'new-year'));
});

test('Legacy Backlog: üretici yükleme teyidi sütunu kalktı, yerine aynı konumda ÖNEM ETİKETİ geldi', () => {
  for (const rel of ['server/server.js', 'public/app-main.js', 'server/lib/parse.js', 'server/workers/excel-worker.js', 'public/backlog-excel-formulas.js']) {
    assert.doesNotMatch(read(rel), /Tükleme Tipi Teyidi/, `${rel} artık teyit sütunu taşımaz`);
  }
  const visible = [...formulas.DEFAULT_VISIBLE_HEADERS];
  assert.equal(visible[visible.indexOf('ANTREPO-RETAIL') + 1], IMP);
  assert.equal(formulas.FORMULA_HEADERS.includes(IMP), false, 'etiket formül değil, listeden seçilen değerdir');
  // Hücre serbest metin kabul etmez: tarayıcı ve sunucu Excel'i liste doğrulaması yazar.
  assert.match(read('public/app-main.js'), /const importanceIndex=list\.indexOf\(BLOrderImportance\.BACKLOG_HEADER\);[\s\S]{0,400}BLOrderImportanceUI\.excelValues\(\)[\s\S]{0,40}allowBlank:false/);
  assert.match(read('server/workers/excel-worker.js'), /const importanceIndex = headers\.indexOf\('ÖNEM ETİKETİ\\n\(IMPORTANCE\)'\);[\s\S]{0,400}payload\.importanceValues/);
  assert.match(read('server/server.js'), /importanceValues:BLOrderImportance\.excelValues\(overrides\.importanceSettings\)/);
});

test('kalıcılık: satır anahtarıyla yazılır, bilinmeyen etiket reddedilir, silinen etiketin ataması düşer', () => {
  let saved = db.patchOrderOverride(CODE, { model:MODEL, ccode:CCODE, importance:'bts' });
  assert.equal(saved.overrides.importancemap[lineKey], 'bts');
  assert.throws(() => db.patchOrderOverride(CODE, { model:MODEL, ccode:CCODE, importance:'serbest metin' }), /katalogda yok/);
  saved = db.patchOrderOverride(CODE, { model:MODEL, ccode:CCODE, importance:'regular' });
  assert.equal(saved.overrides.importancemap[lineKey], 'regular', 'açık Regular seçimi saklanır (kuralı ezer)');
  db.patchOrderOverride(CODE, { model:MODEL, ccode:CCODE, importance:'ekvator' });
  const result = db.replaceImportanceSettings({ tags: OI.DEFAULT_TAGS.filter(tag => tag.id !== 'ekvator') });
  assert.equal(result.pruned, 1);
  assert.equal(db.loadOverrides().importancemap[lineKey], undefined);
  saved = db.patchOrderOverride(CODE, { model:MODEL, ccode:CCODE, importance:null });
  assert.equal(saved.overrides.importancemap[lineKey], undefined);

  assert.ok(scope.ORDER_SCOPED_MAPS.includes('importancemap'), 'kapsam dışı kullanıcıya gösterilmez');
  assert.equal(sharedStore.FIELDS.importance, 'importancemap');
  assert.deepEqual(sharedStore.patchFromOrderPatch({ importancemap:{ [lineKey]:'bts' } }, lineKey, { importance:'bts' }), { importance:'bts' });
  assert.ok(policy.MASTER_OVERRIDE_FIELDS.has('importanceSettings'), 'katalog Moderatör yayımıyla dağılır');
});

test('rotalar ve istemci bağlantıları: katalog uç noktası, Ayarlar aracı, CP/Orders sütunu', () => {
  const routes = read('server/routes/note-column-routes.js');
  assert.match(routes, /app\.get\('\/api\/order-importance', userAccess\.requireAnyArea\('cp', 'orders', 'backlog'\)/);
  assert.match(routes, /app\.put\('\/api\/order-importance', userAccess\.requireAnyArea\('cp', 'orders'\)/);
  assert.match(read('server/server.js'), /'dates','importance','imageRef','noteColumns'\]\);/);
  assert.match(read('public/app-main.js'), /\{k:'Importance', label:'Importance', type:'importance'/);
  assert.match(read('public/data-management.js'), /id: 'importance'[\s\S]{0,600}BLOrderImportanceUI\?\.openSettings/);
  const index = read('public/index.html');
  assert.ok(index.indexOf('order-importance.js') > index.indexOf('backlog-excel-formulas.js'));
  assert.ok(index.includes('order-importance-ui.js'));
});

test('risk: Retail\'e yetişmeme ortalama yol süresiyle tahmin edilir', () => {
  const base = { today:'2026-10-21', retailDate:'2026-12-01', transitDays:30 };
  // Üretimde: geçmiş Ex-Factory bugüne taşınır → 21.10 + 30 = 20.11 < 01.12 → risk yok.
  assert.equal(rules.computeBacklogRisk({ ...base, segmentKind:'production', exFactory:'2026-09-01' }).risk, false);
  // Yol süresi 45 → 05.12 > 01.12 → risk.
  const late = rules.computeBacklogRisk({ ...base, segmentKind:'production', exFactory:'2026-09-01', transitDays:45 });
  assert.equal(late.risk, true);
  assert.deepEqual(late.reasons, ['RETAIL_DATE_MISSED']);
  // Parsiyel: IAS tarihi Retail'den sonra → risk; IAS tarihi yoksa yükleme + yol süresi.
  assert.equal(rules.computeBacklogRisk({ ...base, antArrival:'2026-12-03' }).risk, true);
  assert.equal(rules.computeBacklogRisk({ ...base, loadDate:'2026-11-05' }).risk, true, '05.11 + 30 = 05.12');
  assert.equal(rules.computeBacklogRisk({ ...base, loadDate:'2026-10-20' }).risk, false);
  // Depoya girmemiş parsiyelin geçmiş tarihi en erken bugündür.
  assert.equal(rules.computeBacklogRisk({ ...base, retailDate:'2026-10-15', antArrival:'2026-10-10' }).risk, true);
  assert.equal(rules.computeBacklogRisk({ ...base, retailDate:'2026-10-15', antArrival:'2026-10-10', inWarehouse:true }).risk, false, 'depodaki satır risk taşımaz');
});

test('risk: yükleme onayı + handover yok + 3 günden FAZLA → VAR; Üretimde bakiyesi dahil', () => {
  const base = { today:'2026-10-21', retailDate:'2027-03-01', transitDays:30, segmentKind:'production', exFactory:'2026-11-01' };
  assert.equal(rules.computeBacklogRisk({ ...base, shipConfirmationDate:'2026-10-18' }).risk, false, 'tam 3 gün: henüz risk değil');
  const pending = rules.computeBacklogRisk({ ...base, shipConfirmationDate:'2026-10-17' });
  assert.equal(pending.risk, true);
  assert.deepEqual(pending.reasons, ['HANDOVER_PENDING']);
  assert.equal(pending.handoverPendingDays, 4);
  assert.equal(rules.computeBacklogRisk({ ...base, shipConfirmationDate:'2026-10-01', handoverDate:'2026-10-05' }).risk, false);
  assert.equal(rules.computeBacklogRisk({ ...base, segmentKind:'shortage', shipConfirmationDate:'2026-10-01' }).handoverRisk, false);
  // Yolda / Gümrük'teki parsiyel handover tarihi boş olsa da teslim edilmiştir.
  assert.equal(rules.computeBacklogRisk({ ...base, segmentKind:'partial', status:'Yolda', antArrival:'2026-11-10', shipConfirmationDate:'2026-10-01' }).handoverRisk, false);
  assert.equal(rules.computeBacklogRisk({ ...base, segmentKind:'partial', status:'Yükleme Operasyonları', antArrival:'2026-11-10', shipConfirmationDate:'2026-10-01' }).handoverRisk, true);
  // In-Store tamponu artık Backlog RİSK'i üretmez.
  assert.equal(rules.computeBacklogRisk({ ...base }).risk, false);
});

test('Excel RİSK formülü aynı üç bayrağı kurar ve boş tarihlerde #DEĞER! üretmez', () => {
  const plan = formulas.formulaPlan(formulas.DEFAULT_VISIBLE_HEADERS, {}, 2);
  const risk = plan.formulas[RISK].formula;
  const refs = plan.refs;
  assert.equal(risk, `IF(OR(${refs._BL_DELAY},${refs._BL_HANDOVER},${refs._BL_TRANSIT_OVERDUE}),"VAR","YOK")`);
  const delay = plan.helperCells._BL_DELAY.formula;
  assert.match(delay, /MAX\([A-Z]+2,TODAY\(\)\)\+[A-Z]+2>/, 'Üretimde: MAX(Ex-F, bugün) + yol süresi');
  assert.ok(delay.startsWith('IF(OR(OR('), 'Depoda / Retail boş ise önce elenir');
  assert.doesNotMatch(delay, /AND\([^()]*\+/, 'toplama yalnız IF korumasının içinde yapılır');
  const handover = plan.helperCells._BL_HANDOVER.formula;
  assert.match(handover, /TODAY\(\)-[A-Z]+2>3\)/, '3 günden fazla');
  assert.match(handover, /LEFT\([A-Z]+2,8\)="Üretimde"/, 'Üretimde bakiyesi (alt aşamalı statü dahil) değerlendirilir');
  assert.doesNotMatch(handover, /="Yolda"/, 'yoldaki ürün handover bekliyor sayılmaz');
});

test('Backlog özeti: riskli siparişlerin içindeki özel siparişler ayrıca sayılır', () => {
  const row = (order, importance, risk, qty) => ({ 'Sipariş Kod':order, 'Model Adı':'M' + order, 'Renk Kod':'C', [IMP]:importance, [RISK]:risk, 'Adet':qty, 'GÜNCEL DURUM\n(STATUS)':'Yolda' });
  const items = V3.normalizeRows([row(1, 'BTS', 'VAR', 10), row(2, 'Regular', 'VAR', 20), row(3, 'Bayram', 'VAR', 30), row(4, 'Bayram', 'YOK', 5), row(5, '', 'YOK', 1)]);
  const total = V3.summarize(items);
  assert.equal(total.riskOrders, 3);
  assert.equal(total.specialRiskOrders, 2);
  assert.equal(total.specialOrders, 3);
  assert.equal(total.specialRiskQty, 40);
  assert.equal(items[4].importance, 'Regular', 'boş etiket Regular sayılır');
  const groups = V3.importanceSummary(items);
  assert.deepEqual(groups.map(g => [g.name, g.riskItems.length]), [['Bayram', 1], ['BTS', 1]]);
  assert.ok(V3.DIMENSIONS.includes('importance'), 'Genel Bakış kırılımı etikete göre gruplanabilir');
});
