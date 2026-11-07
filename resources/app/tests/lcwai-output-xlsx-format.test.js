'use strict';

/*
 * LCW AI Excel çıktısı: sade varsayılan + isteğe bağlı, beyaz listeli biçim.
 * Varsayılan dosyada koşullu biçim (zebra, veri çubuğu) yoktur; kullanıcı
 * isterse yalnız sözleşmedeki seçenekler (hizalama, genişlik, toplam satırı,
 * veri çubuğu, vurgu kuralı, zebra, sabit sütun) palet tonlarıyla açılır.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const XLSX = require('xlsx');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'server', 'lib', 'lcwai-output');
const contracts = require(path.join(OUT, 'output-contracts'));
const templates = require(path.join(OUT, 'output-templates'));
const userTemplates = require(path.join(OUT, 'output-user-templates'));
const theme = require(path.join(OUT, 'output-theme'));
const { renderWorkbook } = require(path.join(OUT, 'output-xlsx'));
const LAY = require(path.join(ROOT, 'public', 'lcwai-output-layout'));

const unzip = buffer => {
  const cfb = XLSX.CFB.read(buffer, { type: 'buffer' });
  const files = {};
  cfb.FullPaths.forEach((name, index) => { const entry = cfb.FileIndex[index]; if (entry && entry.type === 2) files[name.replace(/^Root Entry\//, '')] = Buffer.from(entry.content).toString('utf8'); });
  return files;
};
const cellStyle = (sheetXml, ref) => Number((new RegExp(`<c r="${ref}" s="(\\d+)"`).exec(sheetXml) || [])[1]);
const xfList = stylesXml => (/<cellXfs count="\d+">([\s\S]*?)<\/cellXfs>/.exec(stylesXml)[1].match(/<xf [^]*?(?:\/>|<\/xf>)/g));

const FORMATTED = {
  title: 'Gecikme', subtitle: 'SS27',
  sheets: [{
    name: 'Liste', style: { zebra: true, freezeColumns: 1 },
    columns: [
      { header: 'Sipariş', type: 'text', highlight: { op: 'contains', value: 'PO-2', tone: 'info' } },
      { header: 'Adet', type: 'integer', total: 'sum', bar: true },
      { header: 'Oran', type: 'percent', total: 'avg', highlight: [{ op: '>', value: '%20', tone: 'risk' }, { op: 'between', value: 0.1, value2: 0, tone: 'ok' }] },
      { header: 'Termin', type: 'date', total: 'max', width: 14, align: 'center' },
    ],
    rows: [['PO-1', 1200, 0.12, '2026-11-02'], ['PO-2', 800, 0.3, '2026-11-09'], ['PO-3', null, 0.05, null]],
  }],
};

test('XLSX varsayılanı sade: koşullu biçim yok, ızgara gizli, ince başlık çizgisi, sayılar sağa', () => {
  const data = contracts.normalizeWorkbook({ title: 't', subtitle: 'Yalnız alt başlık', sheets: [{ name: 'S', columns: [{ header: 'Model', type: 'text' }, { header: 'Adet', type: 'integer' }, { header: 'FOB', type: 'currency' }], rows: [['a', 1, 2.5], ['b', 2, 3], ['c', 3, 4]] }] }).data;
  assert.deepEqual(data.sheets[0].style, { zebra: false, freezeColumns: 0 });
  assert.deepEqual(data.sheets[0].columns, [{ header: 'Model', type: 'text' }, { header: 'Adet', type: 'integer' }, { header: 'FOB', type: 'currency' }], 'biçim istenmediyse sütunda biçim alanı yok');
  const buffer = renderWorkbook(data, { lang: 'tr' });
  const read = XLSX.read(buffer, { type: 'buffer' });
  assert.deepEqual(read.SheetNames, ['S'], 'yalnız alt başlık için ayrı Özet sayfası açılmaz');
  const files = unzip(buffer);
  const sheet = files['xl/worksheets/sheet1.xml'];
  assert.doesNotMatch(sheet, /conditionalFormatting|dataBar/);
  assert.match(sheet, /<sheetView workbookViewId="0" showGridLines="0">/);
  assert.match(files['docProps/core.xml'], /<dc:description>Yalnız alt başlık<\/dc:description>/);
  const styles = files['xl/styles.xml'];
  assert.doesNotMatch(styles, /style="medium"/, 'kalın başlık çizgisi yok');
  assert.match(styles, new RegExp(`<bottom style="thin"><color rgb="FF${theme.ooxml(theme.theme().colors['thead-line'])}"/></bottom>`));
  const xfs = xfList(styles);
  assert.match(xfs[cellStyle(sheet, 'A1')], /horizontal="left"/);
  assert.match(xfs[cellStyle(sheet, 'B1')], /horizontal="right"/, 'sayısal sütun başlığı veriyle aynı hizada');
  assert.match(xfs[cellStyle(sheet, 'C2')], /numFmtId="167"[^>]*>[^]*horizontal="right"/);
  assert.match(styles, new RegExp(`<cellXfs count="${xfs.length}">`));
});

test('biçim sözleşmesi: beyaz liste, takma adlar, sınırlar ve idempotent normalize', () => {
  const parsed = contracts.normalizeWorkbook(FORMATTED, { lang: 'tr' });
  assert.equal(parsed.ok, true);
  const [order, qty, rate, due] = parsed.data.sheets[0].columns;
  assert.deepEqual(order.highlight, [{ op: 'contains', value: 'PO-2', tone: 'info' }]);
  assert.deepEqual(qty, { header: 'Adet', type: 'integer', total: 'sum', bar: true });
  assert.deepEqual(rate.highlight, [{ op: '>', value: 0.2, tone: 'risk' }, { op: 'between', value: 0, value2: 0.1, tone: 'ok' }], '"%20" → 0.2, between sınırları sıralanır');
  assert.deepEqual(due, { header: 'Termin', type: 'date', width: 14, align: 'center', total: 'max' });
  assert.deepEqual(parsed.data.sheets[0].style, { zebra: true, freezeColumns: 1 });
  const again = contracts.normalizeWorkbook(parsed.data, { lang: 'tr' });
  assert.deepEqual(again.data.sheets, parsed.data.sheets, 'düzenleyici kaydı aynı yapıyı korur');

  const messy = contracts.normalizeWorkbook({ title: 'x', style: { zebra: true }, sheets: [{ name: 'S', columns: [
    { header: 'T', type: 'text', bar: true, total: 'sum', align: 'justify', highlight: [{ op: '>', value: 3 }, { when: 'eq', value: 'Gecikti', tone: 'bad' }] },
    { header: 'A', type: 'integer', bar: true, highlight: [{ op: 'lt', value: 0 }, { op: 'gte', value: 10, tone: 'green' }, { op: '>', value: 5 }, { op: '<', value: -5 }] },
    { header: 'B', type: 'number', bar: true, width: 500, highlight: [{ op: '<', value: 1 }, { op: '<', value: 2 }, { op: '<', value: 3 }] },
    { header: 'C', type: 'currency', bar: true, highlight: [{ op: '<', value: 'abc' }, { op: 'between', value: 1 }, { op: '<', value: 4 }, { op: '<', value: 5 }] },
    { header: 'G', type: 'image', bar: true, highlight: [{ op: '=', value: 'KOL-1' }] },
  ], rows: [['x', 1, 2, 3, 'KOL-1']] }] }, { lang: 'tr' });
  const cols = messy.data.sheets[0].columns;
  assert.deepEqual(cols[0], { header: 'T', type: 'text', highlight: [{ op: '=', value: 'Gecikti', tone: 'risk' }] }, 'metinde çubuk/toplam toplamı ve sayısal kural atılır');
  assert.deepEqual(cols[1].highlight, [{ op: '<', value: 0, tone: 'risk' }, { op: '>=', value: 10, tone: 'ok' }, { op: '>', value: 5, tone: 'risk' }], 'sütun başına en fazla 3 kural');
  assert.equal(cols[2].width, 80);
  assert.equal(cols.filter(column => column.bar).length, 2, 'sayfa başına en fazla 2 veri çubuğu');
  assert.equal(cols.reduce((n, column) => n + (column.highlight || []).length, 0), 8, 'sayfa başına en fazla 8 kural');
  assert.deepEqual(cols[4], { header: 'G', type: 'image' });
  assert.deepEqual(messy.data.sheets[0].style, { zebra: true, freezeColumns: 0 }, 'kitap düzeyi stil sayfaya varsayılan olur');
  assert.ok(messy.warnings.includes('format-bar-dropped'));
  assert.ok(messy.warnings.includes('format-rule-dropped'));
});

test('biçimli XLSX: toplam satırı (SUBTOTAL), vurgu kuralları, zebra, sabit sütun, genişlik; Excel okuyucusuyla geri okunur', () => {
  const data = contracts.normalizeWorkbook(FORMATTED, { lang: 'tr' }).data;
  const buffer = renderWorkbook(data, { lang: 'tr' });
  const read = XLSX.read(buffer, { type: 'buffer' });
  const rows = XLSX.utils.sheet_to_json(read.Sheets.Liste, { header: 1, raw: true });
  assert.deepEqual(rows[4].slice(0, 2), ['Toplam', 2000]);
  assert.ok(Math.abs(rows[4][2] - (0.12 + 0.3 + 0.05) / 3) < 1e-12);
  assert.equal(rows[4][3], 46335, 'en geç termin (tarih seri numarası)');
  assert.equal(read.Sheets.Liste.B5.f, 'SUBTOTAL(109,B2:B4)');
  assert.equal(read.Sheets.Liste.C5.f, 'SUBTOTAL(101,C2:C4)');
  assert.equal(read.Sheets.Liste.D5.f, 'SUBTOTAL(104,D2:D4)');
  const files = unzip(buffer);
  const sheet = files['xl/worksheets/sheet1.xml'];
  assert.match(sheet, /<dimension ref="A1:D5"\/>/);
  assert.match(sheet, /<autoFilter ref="A1:D4"\/>/, 'toplam satırı filtre dışında');
  assert.match(sheet, /<pane xSplit="1" ySplit="1" topLeftCell="B2" activePane="bottomRight" state="frozen"\/>/);
  assert.match(sheet, /<col min="4" max="4" width="14" customWidth="1"\/>/);
  assert.match(sheet, /<conditionalFormatting sqref="A2:A4"><cfRule type="expression" dxfId="4" priority="1"><formula>ISNUMBER\(SEARCH\(&quot;PO-2&quot;,A2\)\)<\/formula>/);
  assert.match(sheet, /<cfRule type="expression" dxfId="3" priority="2"><formula>AND\(ISNUMBER\(C2\),C2&gt;0\.2\)<\/formula>/);
  assert.match(sheet, /<cfRule type="expression" dxfId="1" priority="3"><formula>AND\(ISNUMBER\(C2\),C2&gt;=0,C2&lt;=0\.1\)<\/formula>/);
  assert.match(sheet, /<conditionalFormatting sqref="B2:B4"><cfRule type="dataBar"/);
  assert.match(sheet, /<conditionalFormatting sqref="A2:D4"><cfRule type="expression" dxfId="0" priority="5"><formula>MOD\(ROW\(\),2\)=1<\/formula>/, 'zebra en düşük öncelik');
  const c = theme.theme().colors;
  assert.match(files['xl/styles.xml'], new RegExp(`<dxfs count="5">[^]*<color rgb="FF${theme.ooxml(c.red)}"/></font><fill><patternFill patternType="solid"><bgColor rgb="FF${theme.ooxml(c['red-bg'])}"/>`), 'risk tonu belge paletinden');
  const xfs = xfList(files['xl/styles.xml']);
  assert.match(xfs[cellStyle(sheet, 'D2')], /horizontal="center"/);
  assert.match(xfs[cellStyle(sheet, 'B5')], /fontId="6"[^>]*borderId="3"/, 'toplam satırı kalın, üst çizgili');
});

test('metin ve tarih kuralı formülleri: tırnak kaçışı, tarih seri numarası, eşit değil boş hücreyi saymaz', () => {
  const data = contracts.normalizeWorkbook({ title: 't', sheets: [{ name: 'S', columns: [
    { header: 'Durum', type: 'text', highlight: [{ op: '=', value: 'A"B', tone: 'warn' }, { op: '!=', value: 'Tamam' }, { op: 'contains', value: '50*?~' }] },
    { header: 'Termin', type: 'date', highlight: { op: '<', value: '2026-11-05', tone: 'risk' } },
  ], rows: [['A"B', '2026-11-01'], ['', '2026-11-10']] }] }).data;
  const sheet = unzip(renderWorkbook(data))['xl/worksheets/sheet1.xml'];
  assert.match(sheet, /<formula>A2=&quot;A&quot;&quot;B&quot;<\/formula>/);
  assert.match(sheet, /<formula>AND\(A2&lt;&gt;&quot;&quot;,A2&lt;&gt;&quot;Tamam&quot;\)<\/formula>/);
  assert.match(sheet, /<formula>ISNUMBER\(SEARCH\(&quot;50~\*~\?~~&quot;,A2\)\)<\/formula>/, 'joker karakterler düz metin');
  assert.match(sheet, /<formula>AND\(ISNUMBER\(B2\),B2&lt;46331\)<\/formula>/);
});

test('ortak eşleştirici: önizleme ile Excel kuralı aynı anlam (boş hücre eşleşmez, metin harf duyarsız)', () => {
  const rule = LAY.normalizeXlsxRule({ op: '<=', value: 0 }, 'integer');
  assert.equal(LAY.matchXlsxRule(rule, null, 'integer'), false);
  assert.equal(LAY.matchXlsxRule(rule, '', 'integer'), false);
  assert.equal(LAY.matchXlsxRule(rule, 0, 'integer'), true);
  assert.equal(LAY.matchXlsxRule(rule, { f: 'SUM(A1)' }, 'integer'), false);
  assert.equal(LAY.matchXlsxRule(LAY.normalizeXlsxRule({ op: 'contains', value: 'gecik' }, 'text'), 'GECİKTİ', 'text'), true, 'Türkçe küçültme: İ → i');
  assert.equal(LAY.matchXlsxRule(LAY.normalizeXlsxRule({ op: 'contains', value: 'gecik' }, 'text'), 'Gecikti', 'text'), true);
  assert.equal(LAY.matchXlsxRule(LAY.normalizeXlsxRule({ op: '!=', value: 'x' }, 'text'), '', 'text'), false);
  assert.equal(LAY.matchXlsxRule(LAY.normalizeXlsxRule({ op: '<', value: '2026-11-05' }, 'date'), '2026-11-01', 'date'), true);
  assert.equal(LAY.xlsxTotalValue('sum', [1, null, 2], 'integer'), 3);
  assert.equal(LAY.xlsxTotalValue('sum', [1, { f: 'A1' }], 'integer'), null, 'formül varsa önbellek değeri yazılmaz');
  assert.equal(LAY.xlsxTotalValue('count', ['a', '', null, 'b'], 'text'), 2);
  assert.equal(LAY.xlsxTotalValue('min', ['2026-11-09', '2026-11-02'], 'date'), '2026-11-02');
});

test('LCW AI talimatı: biçim yalnız istenirse; alanlar ve sınırlar TR/EN aynı', () => {
  const tr = contracts.buildInstruction({ format: 'xlsx', template: templates.TEMPLATES.workbook, lang: 'tr' });
  const en = contracts.buildInstruction({ format: 'xlsx', template: templates.TEMPLATES.workbook, lang: 'en' });
  assert.match(tr, /Biçimi YALNIZ kullanıcı isterse/);
  assert.match(en, /Add formatting ONLY when the user asks/);
  for (const text of [tr, en]) {
    for (const key of ['"highlight"', '"total"', '"bar"', '"zebra"', '"freezeColumns"', 'SUBTOTAL']) assert.ok(text.includes(key), key);
    assert.match(text, /\b2\b[^]*\b3\b[^]*\b8\b/);
  }
});

test('kullanıcı şablonu Excel biçimini saklar ve LCW AI’a aktarır; hücre değeri taşımaz', () => {
  const data = contracts.normalizeWorkbook(FORMATTED, { lang: 'tr' }).data;
  const structure = userTemplates.skeletonFromData('xlsx', data);
  assert.deepEqual(structure, [{ kind: 'sheet', title: 'Liste', columns: [
    { name: 'Sipariş', highlight: [{ op: 'contains', value: 'PO-2', tone: 'info' }] },
    { name: 'Adet', type: 'integer', total: 'sum', bar: true },
    { name: 'Oran', type: 'percent', total: 'avg', highlight: [{ op: '>', value: 0.2, tone: 'risk' }, { op: 'between', value: 0, value2: 0.1, tone: 'ok' }] },
    { name: 'Termin', type: 'date', width: 14, align: 'center', total: 'max' },
  ], style: { zebra: true, freezeColumns: 1 } }]);
  assert.doesNotMatch(JSON.stringify(structure), /PO-1|1200|2026-11-02/);
  const text = userTemplates.templateInstruction({ format: 'xlsx', structure }, { name: 'Gecikme', lang: 'en' });
  assert.match(text, /Adet \(integer; total: sum; bar\)/);
  assert.match(text, /Oran \(percent; total: avg; highlight: > 0\.2 → risk, between 0–0\.1 → ok\)/);
  assert.match(text, /sheet style: zebra, freezeColumns 1/);
  assert.match(text, /Apply the formatting shown in parentheses/);
  const plain = userTemplates.templateInstruction({ format: 'xlsx', structure: [{ kind: 'sheet', title: 'S', columns: [{ name: 'A' }] }] }, { lang: 'tr' });
  assert.doesNotMatch(plain, /Parantez içindeki biçimi/, 'biçimsiz şablon ek kural eklemez');
});

test('düzenleyici: Excel biçimi bölümü ve önizleme ortak doğrulayıcıyı kullanır (kaynak sözleşmesi)', () => {
  const editor = fs.readFileSync(path.join(ROOT, 'public', 'lcwai-output-editor.js'), 'utf8');
  assert.match(editor, /function sheetFormatForm\(sheet, index\)/);
  assert.match(editor, /\$\{sheetFormatForm\(sheet, index\)\}/);
  assert.match(editor, /LAY\(\)\.normalizeXlsxColumnFormat\(column, column\.type\)/, 'önizleme sunucuyla aynı beyaz listeden geçer');
  assert.match(editor, /LAY\(\)\.normalizeXlsxSheetFormat\(sheet\.style, columns\)/);
  assert.match(editor, /LAY\(\)\.xlsxToneOf\(column, row\[c\]\)/);
  assert.match(editor, /window\.BLMotionPlus\.play\('branch'/, 'bölüm açılışı ortak Motion+ ile');
  assert.match(editor, /data-ed-xrule-add/);
  assert.match(editor, /LAY\(\)\.XLSX_FORMAT\.limits\.bars/, 'çubuk sınırı arayüzde de korunur');
  const perf = fs.readFileSync(path.join(ROOT, 'public', 'perf-runtime.js'), 'utf8');
  assert.match(perf, /lcwai-output-layout\.js\?rev=6[^]*lcwai-output-editor\.js\?rev=8/);
});

test('servis: düzenleyiciden gelen metin değerli biçim doğrulanır, taslakta saklanır ve dosyaya yazılır', () => {
  const os = require('node:os');
  const { createOutputService } = require(path.join(OUT, 'output-service'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bl-xlsx-fmt-'));
  try {
    const service = createOutputService({ engine: { chat() { throw new Error('LCW AI çağrılmamalı'); } }, storeOptions: { root: path.join(dir, 'ai-outputs') } });
    const first = service.createTable('u1', { data: { title: 'Demo', sheets: [{ name: 'S', columns: [{ header: 'Model', type: 'text' }, { header: 'Oran', type: 'percent' }], rows: [['A', 0.1], ['B', 0.3]] }] }, lang: 'tr' });
    const draft = service.getDraft('u1', first.draftId);
    // Düzenleyici seçim ve metin kutularından dize yazar; sunucu sayıya çevirir.
    const data = JSON.parse(JSON.stringify(draft.data));
    data.sheets[0].style = { zebra: false, freezeColumns: 1 };
    Object.assign(data.sheets[0].columns[1], { total: 'avg', highlight: [{ op: '>=', value: '0,25', tone: 'warn' }] });
    const rendered = service.renderDraft('u1', draft.id, { data });
    const saved = service.getDraft('u1', draft.id);
    assert.deepEqual(saved.data.sheets[0].columns[1], { header: 'Oran', type: 'percent', total: 'avg', highlight: [{ op: '>=', value: 0.25, tone: 'warn' }] });
    const sheet = unzip(fs.readFileSync(rendered.output.path))['xl/worksheets/sheet1.xml'];
    assert.match(sheet, /<f>SUBTOTAL\(101,B2:B3\)<\/f><v>0\.2<\/v>/);
    assert.match(sheet, /<formula>AND\(ISNUMBER\(B2\),B2&gt;=0\.25\)<\/formula>/);
    assert.match(sheet, /<pane xSplit="1"/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
