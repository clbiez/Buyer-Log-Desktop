'use strict';
/* Test Raporu Aktarımı — gerçek örnek dosyalar (tests/fixtures/test-reports).
   Örneklerde gerçek kişi adları var; repo özeldir, dışarı paylaşılmaz.
   Her format (A mail + PDF, B mail + Lang1/Lang2, C karar, D tek PDF) için
   deterministik ayrıştırma sonucu çivilenir. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const X = require('../server/lib/test-reports/extract');
const E = require('../public/test-report-engine');

const DIR = path.join(__dirname, 'fixtures', 'test-reports');
async function parse(name) {
  return X.processFile({ name, buffer: fs.readFileSync(path.join(DIR, name)) });
}

test('A: tedarikçi lab maili + ekli PDF', async () => {
  const result = await parse('A-supplier-lab-4467254.msg');
  assert.equal(result.kind, 'msg');
  assert.equal(result.format, 'A');
  assert.equal(result.reports.length, 1);
  const r = result.reports[0];
  assert.equal(r.talepNo, '4467254');
  assert.equal(r.siparisKodu, '1374861');
  assert.equal(r.modelAdi, 'KK.BDY,MINECRAFT-11-YD');
  assert.equal(r.modelKodu, 'S7H674');
  assert.equal(r.renk, 'R9J ECRU');
  assert.equal(E.normalizeResult(r.genelSonuc), 'pass');
  assert.equal(r.raporTarihiIso, '2026-10-05T12:24:16+03:00');
  assert.ok(r.kaynaklar.includes('parser:A'));
  assert.equal(r.uyarilar.filter(w => w.code === 'conflict').length, 0, 'mail "R9J ECRU" ile PDF "ECRU" aynı renk');
  assert.equal(r.testler.length, 13);
  assert.ok(r.testler.every(t => E.normalizeResult(t.sonuc) === 'pass'));
  assert.equal(r.bilesenler[0].renk, 'R9J EKRU', 'bileşen rengi ayrı tutulur');
  assert.deepEqual(r.dosyalar.map(f => f.ad), ['TestRequestResultReport_(4467254).pdf']);
  assert.equal(E.reportOutcome(r).code, 'pass');
});

test('A: tek başına tedarikçi lab PDF', async () => {
  const result = await parse('A-TestRequestResultReport_4459415.pdf');
  const r = result.reports[0];
  assert.equal(result.format, 'A');
  assert.equal(r.talepNo, '4459415');
  assert.equal(r.siparisKodu, '1359393');
  assert.equal(r.modelAdi, 'ATL,MINECRAFT-1-EQ');
  assert.equal(r.renk, 'ECRU');
  assert.equal(r.testler.length, 13);
  assert.deepEqual(r.bilesenler[0], { no: 'C1', grup: 'KUMAŞ', kod: '6116', ad: r.bilesenler[0].ad, renk: 'R9J EKRU' });
});

test('B: Labright sonuç maili; Lang1/Lang2 tek rapor', async () => {
  const result = await parse('B-labright-result-364790.msg');
  assert.equal(result.format, 'B');
  assert.equal(result.reports.length, 1, 'Lang1 ve Lang2 aynı rapordur');
  const r = result.reports[0];
  assert.equal(r.talepNo, '364790');
  assert.equal(typeof r.talepNo, 'string');
  assert.equal(r.siparisKodu, '1374537');
  assert.equal(E.modelKey(r.modelAdi), E.modelKey('KK.TSH,FT-UKRAYNA'));
  assert.equal(r.renk, 'BUXE WHITE');
  assert.equal(r.genelSonuc, 'Kalır / Fail', 'ham değer saklanır');
  assert.equal(E.normalizeResult(r.genelSonuc), 'fail');
  assert.equal(r.lab, 'LabRight Bangladesh Limited');
  assert.equal(r.dosyalar.length, 2);
  assert.ok(r.dosyalar.every(f => /Lang[12]/.test(f.ad) && f.hash));
  const failing = r.testler.filter(t => E.normalizeResult(t.sonuc) === 'fail');
  assert.equal(failing.length, 2);
  assert.equal(E.reportOutcome(r).code, 'fail');
});

test('C: ticari karar maili (Ticari Onay, TR saati)', async () => {
  const result = await parse('C-decision-1360191-barcha.msg');
  assert.equal(result.format, 'C');
  const r = result.reports[0];
  assert.equal(r.talepNo, '3467719');
  assert.equal(r.siparisKodu, '1360191');
  assert.equal(r.modelAdi, 'KK.BDY,BARCHA-4-YD');
  assert.equal(r.renk, 'DULL RED');
  assert.equal(r.kararlar.length, 1);
  assert.equal(E.normalizeResult(r.kararlar[0].karar), 'commercialApproval');
  assert.equal(r.kararlar[0].aciklama, 'görsel incelendi konu buyer ile görüşüldü ticari okeylendi');
  assert.equal(r.kararlar[0].tarihIso, '2026-10-05T16:18:00+03:00');
  assert.deepEqual(r.dosyalar.map(f => f.tur), ['msg'], 'eki olmayan karar mailinin kendisi eklenir');
  assert.equal(E.reportOutcome(r).code, 'pass');
});

test('C: Buying bekleniyor kararı görev üretir', async () => {
  const r = (await parse('C-decision-1380959-taste.msg')).reports[0];
  assert.equal(r.talepNo, '3465774');
  assert.equal(r.kararlar.length, 2);
  const step = E.deriveStepStatus([r]);
  assert.equal(step.state, 'open');
  assert.equal(step.tasks.length, 2);
});

test('D: tek başına Labright PDF (Gold Seal, Lack of Sample)', async () => {
  const result = await parse('D-TestRequestResultForm_(3464570_Lang2)_DEA43CB6503B47128A6347050F693815.pdf');
  assert.equal(result.format, 'labright');
  const r = result.reports[0];
  assert.equal(r.kaynak, 'parser:D');
  assert.equal(r.talepNo, '3464570');
  assert.equal(r.talepTipi, 'Gold Seal');
  assert.equal(r.siparisKodu, '1354538');
  assert.equal(r.modelAdi, 'KK.BDY,MINECRAFT-6-YD');
  assert.equal(r.modelKodu, 'S7IQ90Z4');
  assert.equal(r.renk, 'MID GREEN');
  assert.equal(E.normalizeResult(r.genelSonuc), 'lackOfSample');
  assert.equal(r.raporTarihiIso, '2026-09-30T13:11:41+03:00');
  assert.equal(r.testler.length, 9);
  assert.equal(r.testler.filter(t => E.normalizeResult(t.sonuc) === 'lackOfSample').length, 2);
  assert.equal(E.reportOutcome(r).code, 'pending');
});

test('aynı bırakmada mail + ayrı PDF talep no ile tekilleşir', async () => {
  const names = ['A-supplier-lab-4467254.msg', 'B-labright-result-364790.msg'];
  const files = names.map(name => ({ name, buffer: fs.readFileSync(path.join(DIR, name)) }));
  // B mailinin PDF'ini ikinci kez ayrı dosya olarak bırak.
  const msg = X.readMsg(files[1].buffer);
  files.push({ name: msg.attachments[1].name, buffer: msg.attachments[1].buffer });
  const out = await X.processFiles(files);
  assert.equal(out.files.length, 3);
  assert.deepEqual(out.reports.map(r => r.talepNo).sort(), ['364790', '4467254']);
  assert.equal(out.reports.find(r => r.talepNo === '364790').dosyalar.length, 2, 'aynı dosya (hash) iki kez eklenmez');
});

test('.eml okuyucu: MIME gövde + PDF eki', async () => {
  const pdf = fs.readFileSync(path.join(DIR, 'A-TestRequestResultReport_4459415.pdf'));
  const body = 'Test Talep No / Test Request No\t :\t 4459415\t \r\nSipari=C5=9F Kodu / Order No\t :\t 1359393\t \r\nRenk / Color\t :\t ECRU\t \r\n';
  const eml = [
    'From: SupplierLabUser@LCWaikiki.com',
    'Subject: =?utf-8?B?' + Buffer.from('4459415 Numaralı Talep Sonuç Raporu; Genel Değerlendirme: Geçer; Model Adı: ATL,MINECRAFT-1-EQ').toString('base64') + '?=',
    'Date: Tue, 18 Aug 2026 09:50:00 GMT',
    'MIME-Version: 1.0',
    'Content-Type: multipart/mixed; boundary="b1"',
    '',
    '--b1',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: quoted-printable',
    '',
    body,
    '--b1',
    'Content-Type: application/pdf; name="TestRequestResultReport_(4459415).pdf"',
    'Content-Disposition: attachment; filename="TestRequestResultReport_(4459415).pdf"',
    'Content-Transfer-Encoding: base64',
    '',
    pdf.toString('base64').replace(/.{76}/g, '$&\r\n'),
    '--b1--',
    '',
  ].join('\r\n');
  const result = await X.processFile({ name: 'synthetic.eml', buffer: Buffer.from(eml, 'utf8') });
  assert.equal(result.kind, 'eml');
  assert.equal(result.format, 'A');
  const r = result.reports[0];
  assert.equal(r.talepNo, '4459415');
  assert.equal(r.siparisKodu, '1359393');
  assert.equal(r.modelAdi, 'ATL,MINECRAFT-1-EQ');
  assert.equal(r.testler.length, 13);
  assert.equal(r.dosyalar[0].ad, 'TestRequestResultReport_(4459415).pdf');
});

test('tanınmayan dosya sessiz kalmaz: desteklenmeyen tür uyarılır, görsel LCW AI adayıdır', async () => {
  const junk = await X.processFile({ name: 'not-a-report.pdf', buffer: Buffer.from('hello') });
  assert.equal(junk.status, 'unsupported');
  assert.ok(junk.warnings.length > 0);
  const staged = [];
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), Buffer.alloc(32)]);
  const photo = await X.processFile({ name: 'rapor-foto.png', buffer: png }, { stage: f => { staged.push(f); return 'id' + staged.length; } });
  assert.equal(photo.kind, 'image');
  assert.equal(photo.status, 'unrecognized');
  assert.equal(photo.ai.eligible, true);
  assert.equal(photo.ai.uploadId, 'id1', 'dosya LCW AI yüklemesi için geçici alanda');
  assert.equal(photo.ai.files[0].tur, 'image');
});
