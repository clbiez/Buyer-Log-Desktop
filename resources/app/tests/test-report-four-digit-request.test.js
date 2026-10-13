'use strict';
/* Regression: some Labright [RESULT REPORT] requests have four-digit IDs.
 * Keep request and order numbers separate; CP matching remains deterministic. */
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../public/test-report-engine');

const SUBJECT = '[RESULT REPORT] TALEP NO/REQUEST NO:7375  (KK.BDY,PSG-7-YD, BRIGHT RED, 1384522, VICKY ZHONG)';
const BODY = [
  'Talep Bilgileri / Test Request Informations\t',
  'Talep No / Request no\t 7375\t Sipariş Kodu / Order No\t 1384522\t',
  'Talep Tipi / Request Type\t Pre-Production Component\t',
  'Model Adı / Model Name\t KK.BDY,PSG-7-YD\t',
  'Renk / Color\t BRIGHT RED\t',
  'Genel Değerlendirme / General Evaluation\t Pass\t',
].join('\n');

test('4-digit Labright request IDs are validated without changing order IDs', () => {
  assert.equal(E.normalizeTalepNo('7375'), '7375');
  assert.equal(E.normalizeTalepNo('07375'), '07375', 'leading zero is preserved');
  assert.equal(E.normalizeTalepNo('737'), '', 'short arbitrary numbers remain invalid');
  assert.equal(E.normalizeTalepNo('123456789'), '', 'oversized numbers remain invalid');
  assert.equal(E.normalizeTalepNo('1375ABC'), '', 'mixed text remains invalid');
  assert.equal(E.normalizeTalepNo('3464570'), '3464570', 'existing 7-digit requests still work');
});

test('Labright mail with request 7375 and order 1384522 matches the correct CP row', () => {
  const parsed = E.parseMail({ subject: SUBJECT, body: BODY, from: '', date: 'Mon, 12 Oct 2026 12:00:00 +0300' });
  assert.equal(parsed.format, 'B');
  assert.equal(parsed.report.talepNo, '7375');
  assert.equal(parsed.report.siparisKodu, '1384522');
  assert.equal(parsed.report.talepTipi, 'Pre-Production Component');
  assert.equal(parsed.report.modelAdi, 'KK.BDY,PSG-7-YD');
  assert.equal(parsed.report.renk, 'BRIGHT RED');
  assert.equal(parsed.report.uyarilar.some(w => w.code === 'missingTalepNo'), false);

  const rows = [
    { 'Order Code': '1384522', 'Model Name': 'KK.BDY,PSG-7-YD', Colour: 'BRIGHT RED', 'C.Code': 'AAA' },
    { 'Order Code': '1384523', 'Model Name': 'KK.BDY,PSG-7-YD', Colour: 'BRIGHT RED', 'C.Code': 'BBB' },
  ];
  const match = E.matchReport(parsed.report, rows);
  assert.equal(match.level, 'exact');
  assert.equal(match.candidates.length, 1);
  assert.equal(match.candidates[0].row['Order Code'], '1384522');
});

test('Labright subject fallback extracts a 4-digit request, but not a longer partial number', () => {
  const report = E.parseMail({ subject: SUBJECT, body: '', from: '' }).report;
  assert.equal(report.talepNo, '7375');
  const english = E.parseMail({ subject: '[RESULT REPORT] REQUEST NO:7375', body: '', from: '' }).report;
  assert.equal(english.talepNo, '7375');
  const invalid = E.parseMail({ subject: '[RESULT REPORT] REQUEST NO:123456789', body: '', from: '' }).report;
  assert.equal(invalid.talepNo, '');
});

test('Labright PDF field extraction accepts 4-digit request IDs on an explicit label', () => {
  const items = [
    { p: 1, x: 20, y: 700, s: 'Request No' },
    { p: 1, x: 155, y: 700, s: '7375' },
    { p: 1, x: 20, y: 680, s: 'Order No' },
    { p: 1, x: 155, y: 680, s: '1384522' },
    { p: 1, x: 20, y: 600, s: 'Evaluation Summary' },
  ];
  const parsed = E.parsePdfItems(items);
  assert.equal(parsed.format, 'labright');
  assert.equal(parsed.report.talepNo, '7375');
  assert.equal(parsed.report.siparisKodu, '1384522');
  assert.equal(parsed.report.uyarilar.some(w => w.code === 'missingTalepNo'), false);
});

test('AI-extracted four-digit request IDs pass validation and preserve review identity', () => {
  const report = E.reportFromAiExtract({ talepNo: '7375', siparisKodu: '1384522', confidence: 'HIGH' });
  assert.equal(report.talepNo, '7375');
  assert.equal(report.siparisKodu, '1384522');
  assert.equal(report.uyarilar.some(w => w.code === 'missingTalepNo'), false);
  const reviews = E.parseReviews(['talepNo=7375|step=tests|summary=Reviewed'], { talepNos: ['7375'], stepIds: ['tests'] });
  assert.equal(reviews['7375'].step, 'tests');
});
