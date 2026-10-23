'use strict';

/*
 * AI çıktılarında gerçek model görselleri: LCW AI yalnız anahtar (KOL-3)
 * görür; Buyer Log görseli yerel depodan gömer (HTML/PDF/PPTX/XLSX).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const XLSX = require('xlsx');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'server', 'lib', 'lcwai-output');
const images = require(path.join(OUT, 'output-images'));
const html = require(path.join(OUT, 'output-html'));
const contracts = require(path.join(OUT, 'output-contracts'));
const { renderPresentation } = require(path.join(OUT, 'output-pptx'));
const { renderWorkbook } = require(path.join(OUT, 'output-xlsx'));
const { createOutputService } = require(path.join(OUT, 'output-service'));

// 2×3 px PNG (geçerli imza + IHDR)
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000020000000308020000001226e1bb0000000c49444154789c6360f8cf00000301010018dd8db00000000049454e44ae426082', 'hex');
const JPEG = Buffer.from('ffd8ffe000104a46494600010100000100010000ffc0001108000400050301220002110103110100ffd9', 'hex');
const pngUrl = `data:image/png;base64,${PNG.toString('base64')}`;
const jpegUrl = `data:image/jpeg;base64,${JPEG.toString('base64')}`;
const unzip = buffer => {
  const cfb = XLSX.CFB.read(buffer, { type: 'buffer' });
  const files = {};
  cfb.FullPaths.forEach((name, index) => { const entry = cfb.FileIndex[index]; if (entry && entry.type === 2) files[name.replace(/^Root Entry\//, '')] = Buffer.from(entry.content); });
  return files;
};

test('görsel anahtarları: yalnız biçimli anahtar; yalnız raster görsel; imza ve boyut doğrulanır', () => {
  assert.equal(images.isToken('KOL-3'), true);
  assert.equal(images.isToken('../x'), false);
  const body = html.sanitizeHtml('<img class="bl-model-img" data-bl-image="kol-3" alt="Kazak" onerror="x()"><img data-bl-image="../../etc"><img data-bl-image="CP-9" src="http://evil/x.png"><span data-bl-image="ORD-1">x</span>').body;
  assert.equal(body, '<img class="bl-model-img" data-bl-image="KOL-3" alt="Kazak"><img data-bl-image="CP-9"><span>x</span>', 'yer tutucu yalnız <img> üzerinde; src/olay düşer');
  assert.deepEqual(images.collectTokens('html', { body }), ['KOL-3', 'CP-9']);
  const normalized = images.normalizeImages({
    'KOL-3': pngUrl,
    'CP-9': 'data:image/svg+xml;base64,PHN2Zz48c2NyaXB0Pg==', // SVG reddedilir (betik taşıyabilir)
    'ORD-1': `data:image/png;base64,${Buffer.from('not a png').toString('base64')}`, // imza tutmaz
    'XX-1': pngUrl, // istenmeyen anahtar
  }, ['KOL-3', 'CP-9', 'ORD-1']);
  assert.deepEqual(Object.keys(normalized), ['KOL-3']);
  assert.equal(normalized['KOL-3'].width, 2);
  assert.equal(normalized['KOL-3'].height, 3);
  const filled = images.fillHtmlImages(body, normalized, 'tr');
  assert.match(filled, /<img class="bl-model-img" alt="Kazak" src="data:image\/png;base64,[^"]+" data-bl-image="KOL-3">/);
  assert.match(filled, /<span class="bl-noimg" data-bl-image="CP-9">Görsel yok<\/span>/);
});

test('sözleşme: LCW AI’a "BL Image" anahtarını yer tutucu olarak kullanması söylenir (HTML/PDF/PPTX/XLSX)', () => {
  const template = require(path.join(OUT, 'output-templates')).TEMPLATES.general;
  assert.match(contracts.buildInstruction({ format: 'pdf', template, lang: 'tr' }), /"BL Image" sütunu[^]*asla "görsel yok" yazma[^]*data-bl-image="KOL-3"/);
  assert.match(contracts.buildInstruction({ format: 'pptx', template, lang: 'en' }), /"layout":"gallery"[^]*"image":"KOL-3"/);
  assert.match(contracts.buildInstruction({ format: 'xlsx', template, lang: 'en' }), /"type":"image"/);
});

test('PPTX: galeri ve yan görsel gerçek medya parçası olarak gömülür; eksik görsel "Görsel yok"', () => {
  const deck = contracts.normalizePresentation({ title: 'Kartlar', slides: [
    { layout: 'gallery', title: 'Modeller', items: [{ title: 'A', image: 'KOL-1' }, { title: 'B', image: 'KOL-2' }, { title: 'C', image: 'KOL-404' }] },
    { layout: 'bullets', title: 'Öne çıkan', bullets: ['x'], image: 'KOL-1' },
  ] }).data;
  const tokens = images.collectTokens('pptx', deck);
  assert.deepEqual(tokens.sort(), ['KOL-1', 'KOL-2', 'KOL-404']);
  const files = unzip(renderPresentation(deck, { images: images.normalizeImages({ 'KOL-1': pngUrl, 'KOL-2': jpegUrl }, tokens) }));
  assert.ok(files['ppt/media/image1.png'] && files['ppt/media/image2.jpg']);
  assert.match(files['[Content_Types].xml'].toString(), /<Default Extension="png" ContentType="image\/png"\/><Default Extension="jpg" ContentType="image\/jpeg"\/>/);
  const gallery = files['ppt/slides/slide2.xml'].toString();
  assert.equal((gallery.match(/<p:pic>/g) || []).length, 2);
  assert.match(gallery, /Görsel yok/);
  assert.match(files['ppt/slides/_rels/slide2.xml.rels'].toString(), /Id="rId2" Type="[^"]+\/image" Target="\.\.\/media\/image1\.png"/);
  assert.match(files['ppt/slides/slide3.xml'].toString(), /<p:pic>/);
  assert.match(files['ppt/slides/_rels/slide3.xml.rels'].toString(), /Target="\.\.\/media\/image1\.png"/, 'aynı görsel tek medya dosyası');
});

test('XLSX: "image" sütunu hücreye gömülü resim olur; anahtar metni dosyada görünmez', () => {
  const workbook = contracts.normalizeWorkbook({ title: 'K', sheets: [{ name: 'Modeller', columns: [{ header: 'Görsel', type: 'image' }, 'Model'], rows: [['KOL-1', 'A'], ['KOL-2', 'B'], ['KOL-9', 'C']] }] }).data;
  const tokens = images.collectTokens('xlsx', workbook);
  const buffer = renderWorkbook(workbook, { images: images.normalizeImages({ 'KOL-1': pngUrl, 'KOL-2': jpegUrl }, tokens) });
  const files = unzip(buffer);
  const sheet = files['xl/worksheets/sheet1.xml'].toString();
  assert.match(sheet, /<drawing r:id="rId1"\/>\s*<\/worksheet>/);
  assert.doesNotMatch(sheet, /KOL-/);
  assert.match(sheet, /<row r="2" ht="66" customHeight="1">/);
  const drawing = files['xl/drawings/drawing1.xml'].toString();
  assert.equal((drawing.match(/<xdr:oneCellAnchor>/g) || []).length, 2);
  assert.match(files['xl/drawings/_rels/drawing1.xml.rels'].toString(), /Target="\.\.\/media\/image1\.png"/);
  assert.match(files['[Content_Types].xml'].toString(), /PartName="\/xl\/drawings\/drawing1\.xml" ContentType="application\/vnd\.openxmlformats-officedocument\.drawing\+xml"/);
  const read = XLSX.read(buffer, { type: 'buffer' });
  assert.equal(read.Sheets.Modeller.A1.v, 'Görsel');
  assert.equal(read.Sheets.Modeller.B2.v, 'A');
  assert.equal(read.Sheets.Modeller.A2, undefined, 'görsel hücresinde metin yok');
});

test('servis: anahtar kullanan çıktı önce görsel ister; görsellerle dosya oluşur; PDF görselli HTML ile basılır', async () => {
  const answer = '```html\n<h1>Model Kartları</h1><p>' + 'Sipariş verilen modeller ve görselleri. '.repeat(3) + '</p><div class="bl-gallery"><div class="bl-card"><img class="bl-model-img" data-bl-image="KOL-1" alt="A"><h3>A</h3></div><div class="bl-card"><img class="bl-model-img" data-bl-image="KOL-2" alt="B"><h3>B</h3></div></div>\n```';
  const engine = { async chat() { return { requestId: 'r', chatId: 'c', text: answer, model: { label: 'GPT-6 Sol' } }; } };
  const service = createOutputService({ engine, storeOptions: { root: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bl-img-')), 'ai-outputs') } });
  const first = await service.create('u1', { message: 'kartlar', output: { format: 'html' } });
  assert.equal(first.output.pending, 'images');
  assert.deepEqual(first.output.tokens, ['KOL-1', 'KOL-2']);
  assert.throws(() => service.completeImages('u2', first.output.pendingId, {}), error => error.code === 'LCWAI_OUTPUT_NOT_FOUND', 'başka kullanıcı tamamlayamaz');
  assert.throws(() => service.completePdf('u1', first.output.pendingId, Buffer.from('%PDF-1.7'.padEnd(100))), error => error.code === 'LCWAI_OUTPUT_NOT_FOUND', 'görsel bekleyen PDF sayılmaz');
  const done = service.completeImages('u1', first.output.pendingId, { 'KOL-1': pngUrl });
  assert.equal(done.format, 'html');
  assert.equal(done.imagesUsed, 1);
  const file = fs.readFileSync(done.path, 'utf8');
  assert.match(file, /src="data:image\/png;base64,/);
  assert.match(file, /class="bl-noimg" data-bl-image="KOL-2"/);
  const pdf = await service.create('u1', { message: 'kartlar', output: { format: 'pdf' } });
  const printed = service.completeImages('u1', pdf.output.pendingId, { 'KOL-1': pngUrl, 'KOL-2': jpegUrl });
  assert.equal(printed.pending, 'pdf');
  assert.equal((printed.html.match(/src="data:image\//g) || []).length, 2);
  const noImages = await service.create('u1', { message: 'kartlar', output: { format: 'html', images: false } });
  assert.equal(noImages.output.format, 'html', 'görsel istenmezse doğrudan dosya');
});

test('istemci: bağlam CSV’sine görsel anahtarı sütunu eklenir; yerel görsel kimliği LCW AI’a gitmez; aynı görsel aynı anahtar', () => {
  const vm = require('node:vm');
  const rows = [{ _id: 'a', 'Model Name': 'A' }, { _id: 'b', 'Model Name': 'B' }, { _id: 'c', 'Model Name': 'C' }];
  const window = {
    appLang: 'tr',
    BLAIScreenData: {
      lastTab: () => 'koleksiyon', pageTitle: () => 'Koleksiyon',
      table: () => ({ rows, columns: [{ key: 'Model Name', label: 'Model' }], selectedIds: ['c'], filters: {} }),
      rowImage: (tab, row) => (row._id === 'b' ? null : { modelId: row._id, colourCode: '', source: `/api/collection-images/${row._id}` }),
    },
    BuyerLogAI: { registerContextProvider() {}, getAvailableContext: () => [] },
  };
  window.window = window;
  class FakeFile { constructor(parts, name) { this.name = name; this.text = parts.join(''); this.size = this.text.length; } }
  const context = vm.createContext({ window, document: { documentElement: { lang: 'tr' }, getElementById: () => null }, File: FakeFile, console });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'public', 'lcwai-chat.js'), 'utf8'), context);
  const chat = window.BLLcwAiChat;
  const visible = chat.tableContext('koleksiyon', 'visible');
  assert.deepEqual([...visible.columns], ['BL Image', 'Model']);
  assert.deepEqual(visible.rows.map(row => row[0]), ['KOL-1', '', 'KOL-2']);
  const selected = chat.tableContext('koleksiyon', 'selected');
  assert.equal(selected.rows[0][0], 'KOL-2', 'aynı görsel ikinci bağlamda da aynı anahtar');
  const prepared = chat.contextAsFile(visible);
  assert.equal(prepared.context.images, undefined, 'görsel kimlikleri sunucuya/LCW AI’a gönderilmez');
  assert.equal(Object.keys(prepared.images).length, 2);
  assert.match(prepared.file.text, /^﻿BL Image,Model\r\nKOL-1,A\r\n,B\r\nKOL-2,C\r\n$/);
  assert.match(prepared.context.text, /“BL Image” sütunu kaydın Buyer Log’daki gerçek model görselinin anahtarıdır/);
  const source = fs.readFileSync(path.join(ROOT, 'public', 'lcwai-chat.js'), 'utf8');
  assert.match(source, /resolveImages: tokens => resolveImages\(conv, tokens, answer\)/);
  assert.match(source, /canvas\.toDataURL\('image\/jpeg', 0\.84\)/, 'görseller gönderilmeden önce küçültülür');
  const main = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');
  assert.match(main, /rowImage\(tab, row\) \{[^]*cpOrdersRowImageIdentity\(row\)/);
  assert.match(main, /imageDataUrl: identity => cpOrdersImageDataUrlFor\(identity\)/);
});
