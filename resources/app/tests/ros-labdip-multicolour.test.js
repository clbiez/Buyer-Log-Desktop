'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const E = require('../public/test-report-engine');

function rosMail(subject, resultA, resultB, date='07.10.2026', round='1') {
  return {
    subject,
    body: [
      'Talep Tipi\tLabdip',
      'Renk Kodu-Adı\tModel Adı',
      'R9J - EKRU\tMINECRAFT-13-YD',
      'Renk Sonuçlanma Tarihi\tTur\tRenk Analisti\tRenk Yorum\tSonuç\tSubmit No\tTicari Onay Tarihi\tTalep Tipi\tUrl',
      date + '\t' + round + '\tAnalyst\tNO DARKER / NO YELLOWER\t' + resultA + '\tA\t\tLabdip\trequestId=73822',
      'Renk Kodu-Adı\tModel Adı',
      'ZZX 19-4209 TCX - BLACK\tMINECRAFT-13-YD',
      'Renk Sonuçlanma Tarihi\tTur\tRenk Analisti\tRenk Yorum\tSonuç\tSubmit No\tTicari Onay Tarihi\tTalep Tipi\tUrl',
      date + '\t' + round + '\tAnalyst\tS/B LIGHTER\t' + resultB + '\tC\t\tLabdip\trequestId=73822',
    ].join('\n'),
  };
}

test('ROS .msg Turkish and English decisions are parsed independently', () => {
  const parsed = E.parseMail(rosMail('REVİZE LCW- ROS - Renk Sonuç Bildirimi', 'Approved', 'Rejected'));
  assert.equal(parsed.format, 'R');
  const r = parsed.report;
  assert.equal(r.talepNo, '73822');
  assert.equal(r.talepTipi, 'Labdip');
  assert.equal(r.modelAdi, 'MINECRAFT-13-YD');
  assert.deepEqual(r.labDipColors.map(c => c.status), ['pass', 'fail']);
  assert.match(r.labDipColors[1].comment, /LIGHTER/);
  assert.equal(E.reportOutcome(r).code, 'fail');
  assert.match(E.labDipSummary([r], 'tr'), /EKRU · Onaylandı/);
  assert.match(E.labDipSummary([r], 'en'), /BLACK · Rejected/);
});

test('ROS revised decision only supersedes its own colour, not sibling colours', () => {
  const first = E.parseMail(rosMail('LCW- ROS - Renk Sonuç Bildirimi', 'Approved', 'Rejected', '07.10.2026','1')).report;
  const revision = E.parseMail(rosMail('REVİZE LCW- ROS - Renk Sonuç Bildirimi', 'Digital Approved', 'Approved', '08.10.2026','2')).report;
  const merged = E.mergeReports(first, revision);
  assert.equal(merged.labDipColors.length, 4);
  assert.deepEqual(E.resolveLabDipColors([merged]).map(c => c.status), ['pass', 'pass']);
  assert.equal(E.deriveStepStatus([merged]).state, 'approved');
  assert.equal(E.mergeReports(merged, revision).labDipColors.length, 4, 'idempotent import');
});

test('if multiple independent ROS reports share a checklist, latest colour states are reconciled', () => {
  const old = E.parseMail(rosMail('LCW- ROS - Renk Sonuç Bildirimi', 'Approved', 'Rejected')).report;
  const revised = E.parseMail(rosMail('REVİZE LCW- ROS - Renk Sonuç Bildirimi', 'Approved', 'Approved', '08.10.2026')).report;
  revised.talepNo = '73823';
  const output = E.deriveStepStatus([old, revised]);
  assert.equal(output.state, 'approved');
  assert.equal(output.outcomes.length, 1);
});

test('ROS request is not an approval and cannot infer an order from request ID', () => {
  const parsed = E.parseMail({
    subject:'Talep ID:73822 ROS - Renk Çalıştırma Talebi',
    body:'Talep ID:73822\nTalep Tipi\tLabdip',
  });
  assert.equal(parsed.format, 'R');
  assert.equal(parsed.report.talepNo, '73822');
  assert.equal(parsed.report.labDipColors.length, 0);
  assert.ok(parsed.report.uyarilar.some(w => w.code === 'rosRequestOnly'));
  assert.equal(E.reportOutcome(parsed.report).code, 'pending');
});

test('without PO identifier ROS never reaches exact match; multiple candidate POs require manual choice', () => {
  const report = E.parseMail(rosMail('LCW- ROS - Renk Sonuç Bildirimi', 'Approved', 'Rejected')).report;
  const rows = [
    {'Order Code':'1400011','Model Name':'MINECRAFT-13-YD','Colour':'EKRU','C.Code':'R9J'},
    {'Order Code':'1400012','Model Name':'MINECRAFT-13-YD','Colour':'EKRU','C.Code':'R9J'},
    {'Order Code':'1400013','Model Name':'OTHER-1-YD','Colour':'EKRU','C.Code':'R9J'},
  ];
  assert.equal(E.matchReport(report,rows).level,'ambiguous');
  const single=E.matchReport(report,[rows[0]]);
  assert.equal(single.level,'partial');
  assert.equal(single.candidates[0].row['Order Code'],'1400011');
});

test('Lab Dip UI keeps detail inside existing checklist cell and no new columns', () => {
  const ui = fs.readFileSync(path.join(__dirname,'../public/test-report-import.js'),'utf8');
  assert.match(ui,/labDipResultCell/);
  assert.match(ui,/trLabDipDetails/);
  assert.match(ui,/meta\.note = labDipText/);
  assert.match(ui,/previous\.note/);
  assert.match(ui,/data-tr-drop/);
  assert.match(ui,/source: 'test-report-review'/);
  assert.doesNotMatch(ui,/Lab Dip Status\s+Column/);
});
