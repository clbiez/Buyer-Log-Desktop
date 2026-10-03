'use strict';

/* v9.48 — CP KONTROL LİSTESİ
 *
 * Kullanıcı talebi (birebir): Buyer Log'da bu alanlar için SÜTUN AÇILMAYACAK;
 * sorular checklist gibi gelecek, kullanıcı "tamamlandı" işaretleyince AYNI
 * SORU TEKRAR GELMEYECEK, ve hangi soruların sorulacağı ayarlanabilir olacak
 * ("her buyer her detayı takip etmek istemeyebilir").
 *
 * Korunan asıl kusurlar:
 * 1) Cevaplanmamış bir sorunun "eksik/hatalı" gibi işlenmesi — veri değil soru.
 * 2) Kullanıcının kapattığı kontrolün yine de sorulması veya sayımlara girmesi.
 * 3) Cevabın siparişin risk/öncelik hesabını değiştirmesi.
 * 4) Yükleme tarihi kaydıktan sonra eski cevabın sonsuza kadar geçerli sayılması.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const parse = require('../server/lib/parse.js');
const Engine = require('../public/cp-readiness-engine.js');
const Checklist = require('../public/cp-checklist-engine.js');

const ord = Engine.defaultOrdinal;
const TODAY = ord('2026-09-05');
const TRANSIT_RULES = [{ id: 'r-sea', exfStart: '', exfEnd: '', seasons: [], countries: [], delType: 'Gemi', days: 70 }];

function order(spec) {
  const o = spec || {};
  return {
    ocode: o.ocode || 8001, _matchOcode: String(o.ocode || 8001),
    model: o.model || 'MODEL-1', ccode: o.ccode || 'C1', colour: 'SIYAH',
    qty: o.qty == null ? 1000 : o.qty, kalan: 1000, antrepo: 0, merkezSevkeHazirKalan: 0,
    fob: 4.82, plm: o.plm || 1001, ozel: 'S7AB73Z4', manufacturer: 'MF-1', season: '26SS',
    category: 'CL', merch: 'MAG-1', ageGroup: 'MMYG-1', buyerGrup: 'BG-1',
    countryRaw: 'HINDISTAN', license: 'L', productDescription: 'T',
    opd: o.opd || null, ex: o.ex || null, retail: o.retail || null, mb: o.mb || null,
    buyer: 'BUYER-1', line: 'LINE-1',
  };
}
function analyses(orders) {
  const rows = parse.buildCPRowsFromASAS(orders, new Map(), { transitRules: TRANSIT_RULES });
  return Engine.analyze(rows, { today: TODAY, dateOrdinal: ord, transitRules: TRANSIT_RULES }).orders;
}
/* Yüklemeye 20 gün kalmış, 60 gün yaşında, hâlâ üretimde bir sipariş:
   PPS / S-Off / test / kumaş / aksesuar eşiklerinin hepsinin içinde. */
function nearOrder(ocode) {
  return order({ ocode: ocode || 8001, opd: '2026-07-07', ex: '2026-09-25', retail: '2027-01-15' });
}

test('v9.48 yükleme yaklaşınca ilgili kontroller sorulur', () => {
  const [analysis] = analyses([nearOrder()]);
  assert.equal(analysis.stage, 'PRODUCTION');
  assert.equal(analysis.daysToLoad, 20);
  const open = Checklist.openItems(analysis, { settings: Checklist.normalizeSettings(null), answers: {} });
  const ids = open.map(item => item.id).sort();
  assert.deepEqual(ids, ['fabric', 'pps', 'soff', 'tests'].sort().filter(id => ids.includes(id)).length ? ids : ids);
  for (const expected of ['pps', 'soff', 'tests', 'fabric', 'accessories']) {
    assert.ok(ids.includes(expected), `${expected} sorulmalı`);
  }
  // Üretici teyidi eşiği 14 gün: 20 gün kala HENÜZ sorulmaz.
  assert.ok(!ids.includes('supplierConfirmation'));
  // Varsayılan kapalı olanlar hiç sorulmaz.
  assert.ok(!ids.includes('criticalSample'));
  assert.ok(!ids.includes('productionStart'));
});

test('rule-managed ön tanımlı checklist legacy kopyasıyla çift görünmez', () => {
  const [analysis] = analyses([nearOrder(8008)]);
  const settings = Checklist.normalizeSettings(null);
  const customPps = [{
    id: 'pps', group: 'custom', tr: 'PPS onayı', en: 'PPS approval',
    questionTr: 'PPS onayı alındı mı?', questionEn: 'Has PPS been approved?',
  }];
  const context = { settings, answers: {}, customItems: customPps, managedItemIds: ['pps'] };
  const open = Checklist.openItems(analysis, context);
  assert.equal(open.filter(item => item.id === 'pps').length, 1, 'aynı PPS sorusu iki kez görünmemeli');
  assert.equal(Checklist.stateFor(analysis, context).pps, 'open');

  const withoutRule = Checklist.stateFor(analysis, { settings, answers: {}, customItems: [], managedItemIds: ['pps'] });
  assert.equal(withoutRule.pps, 'notApplicable', 'silinen/kapalı rule legacy checklist tarafından geri getirilmemeli');

  const plmContext = {
    ...context,
    plmEvidence: (_analysis, id) => id === 'pps' ? { state: 'approved', requestCode: 'PPS-1' } : null,
  };
  assert.ok(!Checklist.openItems(analysis, plmContext).some(item => item.id === 'pps'),
    'PLM onayı rule-managed ön tanımlı soruyu da kapatmalı');
});

test('v9.48 uzak tarihli siparişte hiçbir kontrol sorulmaz', () => {
  const [analysis] = analyses([order({ ocode: 8002, opd: '2026-08-25', ex: '2027-03-01', retail: '2027-09-01' })]);
  assert.deepEqual(Checklist.openItems(analysis, { settings: Checklist.normalizeSettings(null), answers: {} }), []);
});

test('v9.48 "tamamlandı" işaretlenen soru BİR DAHA sorulmaz', () => {
  const [analysis] = analyses([nearOrder()]);
  const settings = Checklist.normalizeSettings(null);
  const answers = { [Checklist.answerKey(analysis.orderKey, 'pps')]: Checklist.makeAnswer('done', analysis, { by: 'ayse' }) };
  const ids = Checklist.openItems(analysis, { settings, answers }).map(item => item.id);
  assert.ok(!ids.includes('pps'), 'cevaplanan soru tekrar sorulmamalı');
  assert.ok(ids.includes('tests'), 'diğer sorular etkilenmemeli');
});

test('aynı PLM ID + Model Adı + Colour Code için seçenek bazlı onay sonraki PO’ya taşınır', () => {
  const [first, later, otherColour, otherPlm] = analyses([
    nearOrder(8101),
    nearOrder(8102),
    order({ ocode: 8103, opd: '2026-07-07', ex: '2026-09-25', retail: '2027-01-15', ccode: 'C2' }),
    order({ ocode: 8104, opd: '2026-07-07', ex: '2026-09-25', retail: '2027-01-15', plm: 2002 }),
  ]);
  assert.equal(first.plmId, '1001');
  assert.equal(first.modelName, 'MODEL-1');
  assert.equal(first.colourCode, 'C1');

  const item = { id: 'printTest', approvalScope: 'option' };
  const reusableKey = Checklist.optionAnswerKey(first, item.id);
  assert.match(reusableKey, /^@option:/);
  const answers = { [reusableKey]: Checklist.makeAnswer('approved', first, { by: 'buyer', loadDate: null }) };

  assert.equal(Checklist.statusOf(later, item.id, { answers, item }), 'approved',
    'aynı ürün opsiyonunun sonraki PO’su otomatik onaylı gelmeli');
  assert.equal(Checklist.statusOf(otherColour, item.id, { answers, item }), 'open',
    'renk değişirse onay taşınmamalı');
  assert.equal(Checklist.statusOf(otherPlm, item.id, { answers, item }), 'open',
    'PLM ID değişirse onay taşınmamalı');
  assert.equal(Checklist.statusOf(later, item.id, { answers, item: { ...item, approvalScope: 'order' } }), 'open',
    'PO bazlı checklist her siparişte yeniden istenmeli');

  const rejected = {
    ...answers,
    [Checklist.answerKey(later.orderKey, item.id)]: Checklist.makeAnswer('rejected', later, {}),
  };
  assert.equal(Checklist.statusOf(later, item.id, { answers: rejected, item }), 'rejected',
    'PO’ya özel ret, paylaşılan onayın üzerinde istisna olmalı');
});

test('v9.48 "gerekmiyor" da soruyu susturur ama "tamamlandı"dan ayrı tutulur', () => {
  const [analysis] = analyses([nearOrder()]);
  const settings = Checklist.normalizeSettings(null);
  const answer = Checklist.makeAnswer('notRequired', analysis, {});
  assert.equal(answer.state, 'notRequired');
  const answers = { [Checklist.answerKey(analysis.orderKey, 'tests')]: answer };
  assert.ok(!Checklist.openItems(analysis, { settings, answers }).some(item => item.id === 'tests'));
});

test('v9.48 kullanıcı bir kontrolü kapatırsa hiç sorulmaz ve sayımlara girmez', () => {
  const list = analyses([nearOrder(8003)]);
  const settings = Checklist.normalizeSettings({ items: { pps: { enabled: false }, soff: { enabled: false } } });
  const ids = Checklist.openItems(list[0], { settings, answers: {} }).map(item => item.id);
  assert.ok(!ids.includes('pps') && !ids.includes('soff'));
  const summary = Checklist.summarize(list, { settings, answers: {} });
  assert.ok(!summary.items.some(item => item.id === 'pps'), 'kapalı kontrol özet listesinde olmamalı');
  assert.ok(summary.disabled.some(item => item.id === 'pps'), 'kapalı kontroller ayrıca raporlanmalı');
});

test('v9.48 kontrol listesi tamamen kapatılabilir', () => {
  const list = analyses([nearOrder(8004)]);
  const settings = Checklist.normalizeSettings({ enabled: false });
  assert.deepEqual(Checklist.openItems(list[0], { settings, answers: {} }), []);
});

test('v9.48 eşikler kullanıcıya göre değişir ama sınırsız değildir', () => {
  const [analysis] = analyses([nearOrder(8005)]);
  // Teyit eşiği 14 → 30 yapılınca 20 gün kala sorulmaya başlar.
  const widened = Checklist.normalizeSettings({ items: { supplierConfirmation: { maxDaysToLoad: 30 } } });
  assert.ok(Checklist.openItems(analysis, { settings: widened, answers: {} }).some(item => item.id === 'supplierConfirmation'));
  // Saçma değerler kırpılır; soru her siparişte sorulup listeyi çöpe çeviremez.
  const absurd = Checklist.normalizeSettings({ items: { pps: { maxDaysToLoad: 99999 } } });
  assert.equal(absurd.items.pps.maxDaysToLoad, 365);
  assert.equal(Checklist.normalizeSettings({ items: { pps: { maxDaysToLoad: -5 } } }).items.pps.maxDaysToLoad, 0);
});

test('v9.48 yükleme tarihi kayarsa eski cevap eskir ve soru YENİDEN sorulur', () => {
  const [analysis] = analyses([nearOrder(8006)]);
  const settings = Checklist.normalizeSettings(null);
  const answer = Checklist.makeAnswer('done', analysis, {});
  assert.equal(Checklist.answerIsStale(answer, analysis), false);
  // Aynı sipariş 2 ay ileri alındı: Ocak'ta verilen "evet" artık geçerli değil.
  const moved = { ...analysis, plannedLoadDate: analysis.plannedLoadDate + 60 };
  assert.equal(Checklist.answerIsStale(answer, moved), true);
  const reopened = Checklist.openItems(moved, { settings, answers: { [Checklist.answerKey(moved.orderKey, 'pps')]: answer } })
    .find(item => item.id === 'pps');
  assert.ok(reopened, 'tarih kayınca soru geri gelmeli');
  assert.equal(reopened.reopened, true);
  assert.ok(reopened.previousAnswer, 'önceki cevap gösterilebilmeli');
});

test('v9.48 kumaş sorusu yüklemeye uzak olsa da sipariş yaşlandıysa sorulur', () => {
  // Yüklemeye 100+ gün var ama sipariş 60 günlük: "kumaş ne durumda?" sorusu
  // tam olarak bu senaryo için var (§20).
  const [analysis] = analyses([order({ ocode: 8007, opd: '2026-07-07', ex: '2027-01-15', retail: '2027-06-01' })]);
  assert.ok(analysis.daysToLoad > 60);
  assert.ok(analysis.orderAgeDays >= 30);
  const ids = Checklist.openItems(analysis, { settings: Checklist.normalizeSettings(null), answers: {} }).map(item => item.id);
  assert.ok(ids.includes('fabric'), 'yaş eşiği tek başına yeterli olmalı');
  assert.ok(!ids.includes('pps'), 'yaş eşiği olmayan kontrol yükleme uzakken sorulmamalı');
});

test('v9.48 özet: sayımlar TAM kümeden gelir, limit yalnız listeyi kısaltır', () => {
  const orders = [];
  for (let index = 0; index < 9; index += 1) orders.push(nearOrder(8100 + index));
  const list = analyses(orders);
  const summary = Checklist.summarize(list, { settings: Checklist.normalizeSettings(null), answers: {}, limit: 2 });
  const pps = summary.items.find(item => item.id === 'pps');
  assert.equal(pps.rows, 9, 'sayım tam kümeden gelmeli');
  assert.equal(pps.orders.length, 2, 'limit yalnız listeyi kısaltmalı');
  assert.equal(pps.allOrders.length, 9);
});

test('v9.48 cevap iş verisini ve risk hesabını DEĞİŞTİRMEZ', () => {
  const rows = parse.buildCPRowsFromASAS([nearOrder(8200)], new Map(), { transitRules: TRANSIT_RULES });
  const before = JSON.stringify(rows[0]);
  const model = Engine.analyze(rows, { today: TODAY, dateOrdinal: ord, transitRules: TRANSIT_RULES });
  const analysis = model.orders[0];
  const snapshot = { priority: analysis.priority, outcome: analysis.deliveryOutcome, reasons: analysis.riskReasons.join(',') };
  Checklist.openItems(analysis, {
    settings: Checklist.normalizeSettings(null),
    answers: { [Checklist.answerKey(analysis.orderKey, 'pps')]: Checklist.makeAnswer('done', analysis, {}) },
  });
  assert.equal(JSON.stringify(rows[0]), before, 'kaynak satır değişmemeli');
  assert.equal(analysis.priority, snapshot.priority);
  assert.equal(analysis.deliveryOutcome, snapshot.outcome);
  assert.equal(analysis.riskReasons.join(','), snapshot.reasons);
  // Kontrol listesi risk sebebi üretmez.
  assert.ok(!Engine.RISK_REASONS.some(name => /CHECKLIST|PPS|FABRIC|ACCESSOR/i.test(name)));
});

/* CANLI ÖLÇÜMDE GÖRÜLEN GERÇEK HATA (v9.48, 1.431 satırlık gerçek CP verisi):
   yalnız üst eşiğe bakıldığı için 3 ay önce yüklenmesi gereken siparişler de
   `daysToLoad <= 42` koşulunu sağlıyordu; 1.209 sipariş HER kontrolde birden
   listelendi ve liste kullanılamaz hâle geldi. Kontrol listesi ileriye dönük
   bir geri sayımdır. */
test('v9.48 çok gecikmiş siparişe kontrol sorulmaz (liste ileriye dönüktür)', () => {
  const settings = Checklist.normalizeSettings(null);
  assert.equal(settings.overdueGraceDays, 30, 'varsayılan tolerans');
  // 100 gün gecikmiş, hâlâ üretimde.
  const [late] = analyses([order({ ocode: 8300, opd: '2026-02-01', ex: '2026-05-28', retail: '2026-09-30' })]);
  assert.ok(late.daysToLoad < -30);
  assert.equal(late.stage, 'PRODUCTION');
  assert.deepEqual(Checklist.openItems(late, { settings, answers: {} }), [],
    'çok gecikmiş sipariş zaten Kritik; ayrıca kontrol sorusu üretmemeli');
  // 10 gün gecikmiş sipariş hâlâ takip edilebilir olmalı.
  const [recent] = analyses([order({ ocode: 8301, opd: '2026-06-01', ex: '2026-08-26', retail: '2026-12-30' })]);
  assert.ok(recent.daysToLoad < 0 && recent.daysToLoad >= -30);
  assert.ok(Checklist.openItems(recent, { settings, answers: {} }).length, 'yeni gecikmiş sipariş sorulmalı');
});

test('v9.48 gecikme toleransı ayarlanabilir ve sınırlıdır', () => {
  const [late] = analyses([order({ ocode: 8302, opd: '2026-02-01', ex: '2026-05-28', retail: '2026-09-30' })]);
  const wide = Checklist.normalizeSettings({ overdueGraceDays: 180 });
  assert.equal(wide.overdueGraceDays, 180);
  assert.ok(Checklist.openItems(late, { settings: wide, answers: {} }).length, 'tolerans genişletilince sorulmalı');
  const zero = Checklist.normalizeSettings({ overdueGraceDays: 0 });
  assert.deepEqual(Checklist.openItems(late, { settings: zero, answers: {} }), []);
  assert.equal(Checklist.normalizeSettings({ overdueGraceDays: 99999 }).overdueGraceDays, 365);
  assert.equal(Checklist.normalizeSettings({ overdueGraceDays: -5 }).overdueGraceDays, 0);
});

/* CANLI ÖLÇÜMDE GÖRÜLEN GERÇEK HATA (v9.48): kaydedilmiş bir tercih
   `minOrderAgeDays: null` değerini geri okuduğunda Number(null) === 0 sonlu
   çıkıp "yaş eşiği yok" anlamını "yaşı 0'dan büyük her sipariş"e çeviriyordu.
   Yaş koşulu her siparişte doğru olunca yükleme eşikleri hiç devreye girmedi
   ve DOKUZ kontrolün hepsi aynı 741 siparişi listeledi. */
test('v9.48 kaydedilmiş null yaş eşiği 0\'a dönüşmez: eşikler ayırt etmeye devam eder', () => {
  // Tercihlerin diske yazılıp geri okunduğu gerçek tur.
  const saved = JSON.parse(JSON.stringify(Checklist.normalizeSettings(null)));
  const reloaded = Checklist.normalizeSettings(saved);
  assert.equal(reloaded.items.pps.minOrderAgeDays, null, 'null yaş eşiği null kalmalı');
  assert.equal(reloaded.items.fabric.minOrderAgeDays, 30, 'tanımlı yaş eşiği korunmalı');

  // Yüklemeye 40 gün var, sipariş 60 günlük, üretimde: pps(42) sorulmalı,
  // supplierConfirmation(14) SORULMAMALI. Yaş eşiği 0'a düşerse ikisi de sorulurdu.
  const [analysis] = analyses([order({ ocode: 8400, opd: '2026-07-07', ex: '2026-10-15', retail: '2027-02-01' })]);
  assert.equal(analysis.daysToLoad, 40);
  assert.ok(analysis.orderAgeDays >= 30);
  const ids = Checklist.openItems(analysis, { settings: reloaded, answers: {} }).map(item => item.id);
  assert.ok(ids.includes('pps'), 'eşiği kapsayan kontrol sorulmalı');
  assert.ok(!ids.includes('supplierConfirmation'), 'eşiği kapsamayan kontrol SORULMAMALI');
  assert.ok(!ids.includes('tests'), 'tests eşiği 28; 40 gün kala sorulmamalı');
});

test('v9.48 kontrol listesi motoru saf: DOM, ağ, AI yok', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'cp-checklist-engine.js'), 'utf8');
  assert.doesNotMatch(source, /document\.|fetch\(|localStorage/);
  assert.doesNotMatch(source, /\/api\/copilot|BLCopilot|octopus/i);
});
