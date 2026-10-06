'use strict';
/* Test Raporu Aktarımı — saf motor. Brief'teki "bilinen tuzaklar" burada
   çivilenir; fixture okuması tests/test-report-fixtures.test.js içindedir. */
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../public/test-report-engine');

test('tuzak 9: talep no metindir, sayıya çevrilmez (BD 6 / TR 7 hane)', () => {
  assert.equal(E.normalizeTalepNo('362184'), '362184');
  assert.equal(E.normalizeTalepNo(' 3464570 '), '3464570');
  assert.equal(E.normalizeTalepNo('0364790'), '0364790');
  assert.equal(typeof E.normalizeTalepNo(3464570), 'string');
  assert.equal(E.normalizeTalepNo('ABC'), '');
});

test('tuzak 3: model adı yazım farkları normalleştirilir', () => {
  assert.equal(E.modelMatch('ŞRT,PLAYS10-YD', 'ŞRT,PLAYS-10-YD'), 'exact');
  assert.equal(E.modelMatch('KK.BDY,SPACEJAM', 'KK.BDY,SPACEJAM-1-YD'), 'partial');
  assert.equal(E.modelMatch('KK.TSH,YUKI 2447911', 'KK.TSH,YUKI'), 'exact');
  assert.equal(E.modelMatch('KK.BDY,MINECRAFT-11-YD]', 'KK.BDY,MINECRAFT-11-YD'), 'exact');
  assert.equal(E.modelMatch('SRT,PLAYS10-YD', 'ŞRT,PLAYS10-YD'), 'exact');
  assert.equal(E.modelMatch('KK.BDY,BARCHA-4-YD', 'KK.BDY,MINECRAFT-6-YD'), '');
  assert.equal(E.modelMatch('KK', 'KK.BDY,BARCHA-4-YD'), '', 'kısa önek eşleşme sayılmaz');
  assert.equal(E.modelCodeMatch('S7IQ90', 'S7IQ90Z4'), true);
  assert.equal(E.modelCodeMatch('S7IQ90', 'S7NM50Z4'), false);
});

test('tuzak 1: renk tanımı ile eşleşir; kod önekli tanım ayrıştırılır', () => {
  assert.deepEqual(E.colourParts('R9J ECRU'), { code: 'R9J', key: 'ECRU' });
  assert.deepEqual(E.colourParts('MID GREEN'), { code: '', key: 'MID GREEN' });
  assert.equal(E.colourMatch('HC3 CHINESE RED', 'CHINESE RED', 'XXX'), 'exact');
  assert.equal(E.colourMatch('HC3 BRIGHT RED', 'CHINESE RED', 'HC3'), 'code');
  assert.equal(E.colourMatch('ECRU', 'MID GREEN', 'R9J'), '');
});

test('tuzak 8: sonuç sözlüğü ikili değildir; ham değer saklanır, TR/EN çevrilir', () => {
  const cases = {
    'Geçer': 'pass', 'Pass': 'pass', 'Kalır / Fail': 'fail', 'FAIL': 'fail', 'Lack of Sample': 'lackOfSample',
    'Ticari Onay': 'commercialApproval', 'Tekrar Test': 'retest', 'Buyingden dönüş bekleniyor': 'awaitingBuying',
  };
  for (const [raw, code] of Object.entries(cases)) assert.equal(E.normalizeResult(raw), code, raw);
  assert.equal(E.normalizeResult('Belirsiz'), '');
  assert.equal(E.resultLabel('Kalır / Fail', 'en'), 'Fail');
  assert.equal(E.resultLabel('awaitingBuying', 'tr'), 'Buying dönüşü bekleniyor');
  for (const code of E.RESULT_CODES) {
    assert.ok(E.RESULT_LABELS[code].tr && E.RESULT_LABELS[code].en, code);
    assert.doesNotMatch(E.RESULT_LABELS[code].en, /[çğıİöşüÇĞŞÜÖ]/, 'İngilizce etikette Türkçe karakter olmaz');
  }
});

test('tuzak 10: tarih biçimleri ve TR/BD saat dilimi', () => {
  assert.equal(E.parseDate('03.10.2026').iso, '2026-10-03');
  assert.equal(E.parseDate('05/10/2026').date, '2026-10-05');
  assert.equal(E.parseDate('5.10.2026 19:37:44', { offsetMinutes: 360 }).iso, '2026-10-05T19:37:44+06:00');
  assert.equal(E.parseDate('Oct 5 2026 9:20AM').time, '09:20');
  assert.equal(E.parseDate('Oct 5 2026 12:05AM').time, '00:05');
  assert.equal(E.parseDate('Oct 5 2026 4:18PM').time, '16:18');
  // Karar 16:18 yerel, mail 13:19 UTC → TR (+03).
  assert.equal(E.inferOffsetMinutes('Oct 5 2026 4:18PM', 'Mon, 05 Oct 2026 13:19:24 GMT'), 180);
  // Karar 19:18 yerel, mail 13:19 UTC → BD (+06).
  assert.equal(E.inferOffsetMinutes('Oct 5 2026 7:18PM', 'Mon, 05 Oct 2026 13:19:24 GMT'), 360);
  assert.equal(E.inferOffsetMinutes('Oct 5 2026 7:18PM', ''), null);
});

function report(extra) { return { ...E.emptyReport(), ...extra }; }

test('tuzak 2: mail ile PDF çelişirse uyarı üretilir, sessizce seçilmez', () => {
  const mail = report({ talepNo: '4469191', renk: 'HC3 CHINESE RED', kaynak: 'parser:A', kaynakDosya: 'mail.msg', siparisKodu: '1350000' });
  const pdf = report({ talepNo: '4469191', renk: 'BRIGHT RED', kaynak: 'parser:A', kaynakDosya: 'rapor.pdf', siparisKodu: '1350000' });
  const merged = E.mergeReports(mail, pdf);
  const conflict = merged.uyarilar.find(w => w.code === 'conflict' && w.field === 'renk');
  assert.ok(conflict, 'renk çelişkisi uyarısı');
  assert.deepEqual(conflict.values.map(v => v.value), ['HC3 CHINESE RED', 'BRIGHT RED']);
  assert.match(E.warningText(conflict, 'en'), /Colour differs/);
  assert.equal(merged.uyarilar.some(w => w.field === 'siparisKodu'), false);
  // Model adı kısaltması çelişki değildir; uzun yazım tercih edilir.
  const subject = report({ talepNo: '1', modelAdi: 'KK.BDY,SPACEJAM' });
  const body = report({ talepNo: '1', modelAdi: 'KK.BDY,SPACEJAM-1-YD' });
  const m2 = E.mergeReports(subject, body);
  assert.equal(m2.modelAdi, 'KK.BDY,SPACEJAM-1-YD');
  assert.equal(m2.uyarilar.length, 0);
});

test('tuzak 7: Lang1/Lang2 ve aynı karar tekilleştirilir (anahtar talep no)', () => {
  const lang1 = report({ talepNo: '364790', dosyalar: [{ ad: 'Lang1.pdf', hash: 'a' }], kaynak: 'parser:D' });
  const lang2 = report({ talepNo: '364790', dosyalar: [{ ad: 'Lang2.pdf', hash: 'b' }, { ad: 'Lang1.pdf', hash: 'a' }], kaynak: 'parser:D' });
  const grouped = E.groupReports([lang1, lang2]);
  assert.equal(grouped.length, 1);
  assert.deepEqual(grouped[0].dosyalar.map(f => f.ad), ['Lang1.pdf', 'Lang2.pdf']);
  const decision = { talepNo: '3467719', test: 'Baskı Dayanımı', karar: 'Ticari Onay', tarih: 'Oct 5 2026 4:18PM', tarihIso: '2026-10-05T16:18:00+03:00' };
  const twice = E.mergeReports(report({ talepNo: '3467719', kararlar: [decision] }), report({ talepNo: '3467719', kararlar: [{ ...decision }] }));
  assert.equal(twice.kararlar.length, 1);
});

test('tuzak 5: karar mailleri raporu günceller; Ticari Onay geçer sayılır', () => {
  const failed = report({ talepNo: '3467719', genelSonuc: 'Kalır', testler: [{ ad: 'Baskı Dayanımı (İşletme İçi Metot T-037 KMS-01 Rev.04)', sonuc: 'Kalır' }, { ad: 'pH (ISO 3071)', sonuc: 'Geçer' }] });
  assert.equal(E.reportOutcome(failed).code, 'fail');
  const decided = E.mergeReports(failed, report({ talepNo: '3467719', kararlar: [{ test: 'Baskı Dayanımı (İşletme İçi Metot T-037 KMS-01 Rev.04)', karar: 'Ticari Onay', aciklama: 'ticari okeylendi', tarihIso: '2026-10-05T16:18:00+03:00' }] }));
  const outcome = E.reportOutcome(decided);
  assert.equal(outcome.code, 'pass');
  assert.equal(outcome.commercial, true);
  assert.equal(decided.kararlar[0].aciklama, 'ticari okeylendi', 'açıklama saklanır');
  // Tekrar Test → bekliyor.
  const retest = E.mergeReports(failed, report({ talepNo: '3467719', kararlar: [{ test: 'Baskı Dayanımı (İşletme İçi Metot T-037 KMS-01 Rev.04)', karar: 'Tekrar Test' }] }));
  assert.equal(E.reportOutcome(retest).code, 'pending');
});

test('test ayrıntısı olmayan Kalır raporu (yalnız mail) adımı reddeder', () => {
  const r = report({ talepNo: '4400003', genelSonuc: 'Kalır' });
  assert.equal(E.reportOutcome(r).code, 'fail');
  assert.equal(E.deriveStepStatus([r]).state, 'rejected');
  assert.equal(E.reportOutcome(report({ talepNo: '1', genelSonuc: 'Geçer' })).code, 'pass');
});

test('tuzak 5: Buyingden dönüş bekleniyor kullanıcı görevi üretir', () => {
  const r = report({ talepNo: '3465774', kararlar: [
    { test: 'Yıkama Haslığı (ISO 105 C06:2010)', karar: 'Buyingden dönüş bekleniyor', aciklama: 'görsel iletebilir misiniz' },
    { test: 'Sürtme Haslığı (ISO 105 X12:2016)', karar: 'Buyingden dönüş bekleniyor', aciklama: 'görsel iletebilir misiniz' },
  ] });
  const outcome = E.reportOutcome(r);
  assert.equal(outcome.code, 'pending');
  assert.equal(outcome.tasks.length, 2);
  assert.equal(outcome.tasks[0].aciklama, 'görsel iletebilir misiniz');
  const step = E.deriveStepStatus([r]);
  assert.equal(step.state, 'open');
  assert.equal(step.tasks.length, 2);
});

test('karar adı farklı dilde olsa da standart kodla teste bağlanır', () => {
  const r = report({ talepNo: '1', genelSonuc: 'Fail', testler: [{ ad: 'Colour Fastness to Washing (ISO 105 C06)', sonuc: 'Fail' }],
    kararlar: [{ test: 'Yıkama Haslığı (ISO 105 C06:2010)', karar: 'Ticari Onay' }] });
  assert.equal(E.reportOutcome(r).code, 'pass');
});

test('tuzak 4: adım durumu satırın bütün raporlarından türetilir', () => {
  const supreme = report({ talepNo: '4463094', genelSonuc: 'Geçer' });
  const kaskorse = report({ talepNo: '4463927', genelSonuc: 'Kalır', testler: [{ ad: 'pH', sonuc: 'Kalır' }] });
  const gold = report({ talepNo: '3464570', genelSonuc: 'Lack of Sample' });
  assert.equal(E.deriveStepStatus([supreme]).state, 'approved');
  assert.equal(E.deriveStepStatus([supreme, gold]).state, 'open');
  assert.equal(E.deriveStepStatus([supreme, gold, kaskorse]).state, 'rejected');
  assert.equal(E.deriveStepStatus([]).state, '');
});

test('tuzak 6: tekrar test sonucu eskisinin yerine geçer', () => {
  const old = report({ talepNo: '358018', genelSonuc: 'Kalır', testler: [{ ad: 'pH', sonuc: 'Kalır' }] });
  const retest = report({ talepNo: '364298', retestOf: '358018', genelSonuc: 'Geçer' });
  const step = E.deriveStepStatus([old, retest]);
  assert.equal(step.state, 'approved');
  assert.deepEqual(step.superseded, ['358018']);
});

test('eşleştirme: sipariş + model + renk tanımı; düzey görünür', () => {
  const rows = [
    { 'Order Code': 1354538, 'Model Name': 'KK.BDY,MINECRAFT-6-YD', 'C.Code': 'K5L', Colour: 'MID GREEN' },
    { 'Order Code': 1354538, 'Model Name': 'KK.BDY,MINECRAFT-6-YD', 'C.Code': 'R9J', Colour: 'ECRU' },
    { 'Order Code': 1354538, 'Model Name': 'KK.BDY,MINECRAFT-7-YD', 'C.Code': 'K5L', Colour: 'MID GREEN' },
  ];
  const exact = E.matchReport(report({ siparisKodu: '1354538', modelAdi: 'KK.BDY,MINECRAFT-6-YD', renk: 'MID GREEN' }), rows);
  assert.equal(exact.level, 'exact');
  assert.equal(exact.candidates[0].row['C.Code'], 'K5L');
  // Bileşen rengi (R9J EKRU) varyant rengi değildir: ECRU satırı seçilmez.
  const comp = E.matchReport(report({ siparisKodu: '1354538', modelAdi: 'KK.BDY,MINECRAFT-6-YD', renk: 'R9J EKRU' }), rows);
  assert.notEqual(comp.level, 'exact');
  const kod = E.matchReport(report({ siparisKodu: '1354538', modelAdi: 'KK.BDY,MINECRAFT-6-YD', renk: 'R9J ECRU' }), rows);
  assert.equal(kod.level, 'exact');
  assert.equal(kod.candidates[0].row.Colour, 'ECRU');
  const ambiguous = E.matchReport(report({ siparisKodu: '1354538', modelAdi: 'KK.BDY,MINECRAFT', renk: 'MID GREEN' }), rows);
  assert.equal(ambiguous.level, 'ambiguous');
  assert.equal(ambiguous.candidates.length, 2);
  assert.equal(E.matchReport(report({ siparisKodu: '999', modelAdi: 'X', renk: 'Y' }), rows).level, 'none');
  // Çelişen renklerin ikisi de denenir; uyarı korunur.
  const conflicted = E.mergeReports(report({ talepNo: '1', siparisKodu: '1354538', modelAdi: 'KK.BDY,MINECRAFT-6-YD', renk: 'BRIGHT RED' }), report({ talepNo: '1', renk: 'MID GREEN' }));
  assert.equal(E.matchReport(conflicted, rows).level, 'exact');
});

test('LCW AI okuması aynı rapor şemasına çevrilir ve doğrulanır', () => {
  const r = E.reportFromAiExtract({
    talepNo: ' 3464570 ', talepTipi: 'Gold Seal', siparisKodu: '1354538', modelAdi: 'KK.BDY,DEMO-6-YD', renk: 'MID GREEN',
    genelSonuc: 'Lack of Sample', raporTarihi: '30.09.2026 13:11', lab: 'Labright',
    testler: ['Determination of pH (ISO 3071) | C1 | Lack of Sample', 'Azo | C2 | Pass', 'Bozuk | C3 | Belki'],
    kararlar: ['pH | Ticari Onay | uygun | DEMO USER | 05.10.2026'],
    confidence: 'medium', explanation: 'Taranmış sayfa.',
  }, { fileName: 'scan.png' });
  assert.equal(r.talepNo, '3464570');
  assert.equal(typeof r.talepNo, 'string');
  assert.equal(r.kaynak, 'ai');
  assert.equal(r.aiConfidence, 'MEDIUM');
  assert.equal(r.testler.length, 3);
  assert.equal(r.testler[0].sonuc, 'Lack of Sample');
  assert.equal(r.kararlar[0].karar, 'Ticari Onay');
  assert.equal(r.kararlar[0].tarihIso, '2026-10-05');
  assert.ok(r.uyarilar.some(w => w.code === 'aiExtracted'));
  assert.ok(r.uyarilar.some(w => w.code === 'aiUnknownResult' && w.value === 'Belki'), 'sözlük dışı sonuç tahmin edilmez');
  assert.ok(r.uyarilar.some(w => w.code === 'aiNote'));
  const bad = E.reportFromAiExtract({ talepNo: 'abc', siparisKodu: 'SİP-1', confidence: 'sure' });
  assert.equal(bad.talepNo, '');
  assert.equal(bad.siparisKodu, '');
  assert.equal(bad.aiConfidence, 'LOW');
  assert.ok(bad.uyarilar.some(w => w.code === 'missingTalepNo'));
});

test('LCW AI incelemesi: bilinmeyen talep ve adım kimliği kabul edilmez', () => {
  const reviews = E.parseReviews([
    'talepNo=3465774|step=tests|summary=İki haslık testi Buying dönüşü bekliyor.|actions=Tedarikçiden görsel iste; Laboratuvara dönüş yap|risks=Yükleme gecikebilir',
    'talepNo=4400003|step=uydurma_adim|summary=Kalır',
    'talepNo=9999999|step=tests|summary=bilinmeyen',
    'bozuk satır',
  ], { talepNos: ['3465774', '4400003'], stepIds: ['tests', 'pps'] });
  assert.deepEqual(Object.keys(reviews).sort(), ['3465774', '4400003']);
  assert.equal(reviews['3465774'].step, 'tests');
  assert.deepEqual(reviews['3465774'].actions, ['Tedarikçiden görsel iste', 'Laboratuvara dönüş yap']);
  assert.equal(reviews['4400003'].step, '', 'mevcut olmayan adım önerilmez');
  assert.equal(reviews['4400003'].stepRejected, true);
  assert.deepEqual(E.parseReviews(null, {}), {});
});

test('LCW AI inceleme bağlamı Buyer Log sonucunu, test adlarını ve adımları taşır', () => {
  const ctx = E.reviewContext([{ report: report({
    talepNo: '1', genelSonuc: 'Kalır',
    testler: [{ ad: 'pH', sonuc: 'Kalır' }, { ad: 'Azo', sonuc: 'Geçer' }],
    kararlar: [{ test: 'Baskı Dayanımı', karar: 'Ticari Onay', aciklama: '', tarih: '06.10.2026' }],
  }), matchLevel: 'exact', currentStep: 'tests', currentStatus: 'open' }], [{ id: 'tests', name: 'Testler' }]);
  assert.equal(ctx.reports[0].buyerLogOutcome, 'fail');
  assert.deepEqual(ctx.reports[0].testNames, ['pH', 'Azo', 'Baskı Dayanımı']);
  assert.deepEqual(ctx.reports[0].notableTests, ['pH | Kalır']);
  assert.deepEqual(ctx.checklistSteps, [{ id: 'tests', name: 'Testler' }]);
  assert.match(E.aiKnowledge('en'), /Commercial Approval counts as pass/);
  assert.match(E.aiKnowledge('tr'), /Ticari Onay geçer sayılır/);
});
