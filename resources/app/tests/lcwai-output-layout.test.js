'use strict';

/*
 * LCW AI çıktı YERLEŞİMİ (Yerleşim aracı): başlık bandı yüksekliği, yazı
 * boyutları, kenar boşluğu ve model ızgarası (sütun × satır).
 *
 * Korunan davranışlar:
 *  - Sunucu ve tarayıcı önizlemesi aynı modülü (public/lcwai-output-layout.js)
 *    kullanır; değerler sınır içinde tutulur.
 *  - PowerPoint: başlık bandı/yazı boyutu dosyaya yansır; galeri Yerleşim
 *    ızgarası kadar model alır, fazlası devam slaytına geçer.
 *  - PDF: model galerisi sütun × satır sayfalarına bölünür; HTML'de bölünmez.
 *  - Excel: yazı boyutu, başlık satırı yüksekliği, hücre görseli boyutu.
 *  - Yerleşim şablona kaydedilir; LCW AI'ın JSON'da yazdığı yerleşim yok sayılır.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const XLSX = require('xlsx');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'server', 'lib', 'lcwai-output');
const layout = require(path.join(ROOT, 'public', 'lcwai-output-layout'));
const contracts = require(path.join(OUT, 'output-contracts'));
const { renderPresentation, expandSlides } = require(path.join(OUT, 'output-pptx'));
const { renderWorkbook } = require(path.join(OUT, 'output-xlsx'));
const { createOutputService } = require(path.join(OUT, 'output-service'));
const userTemplates = require(path.join(OUT, 'output-user-templates'));

const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'bl-ai-layout-'));
const unzip = buffer => {
  const cfb = XLSX.CFB.read(buffer, { type: 'buffer' });
  const files = {};
  cfb.FullPaths.forEach((name, index) => { const entry = cfb.FileIndex[index]; if (entry && entry.type === 2) files[name.replace(/^Root Entry\//, '')] = Buffer.from(entry.content).toString('utf8'); });
  return files;
};
const fakeEngine = text => ({ calls: [], async chat(owner, input) { this.calls.push(input); return { requestId: 'r', chatId: 'c', text, model: { key: 'x', label: 'X' } }; } });
const items = n => Array.from({ length: n }, (_, i) => ({ title: `DEMO-${100 + i}`, subtitle: 'Süprem', note: 'Not', image: '', tone: 'info' }));

test('ortak modül: sınırlar, hazır yerleşimler, galeri hücreleri slayta sığar', () => {
  const l = layout.normalizeLayout('pptx', { columns: 12, rows: '3', titleSize: 31.4, headerHeight: 10, unknown: 1, showNote: false });
  assert.equal(l.columns, 8, 'üst sınır');
  assert.equal(l.rows, 3);
  assert.equal(l.titleSize, 31);
  assert.equal(l.headerHeight, 48, 'alt sınır');
  assert.equal(l.showNote, false);
  assert.equal('unknown' in l, false);
  assert.equal(layout.normalizeLayout('docx', {}), null);
  assert.equal(layout.normalizeLayout('html', {}).columns, layout.defaults('pdf').columns, 'HTML = PDF ayarları');
  assert.deepEqual(layout.applyPreset('pptx', 'standard', l), layout.defaults('pptx'));
  assert.equal(layout.applyPreset('pptx', 'catalog', null).columns, 6);
  const cells = layout.galleryCells({ columns: 4, rows: 3, headerHeight: 80, margin: 30, gap: 10 }, 20);
  assert.equal(cells.length, 12, 'sayfa başına sütun × satır');
  const g = layout.pptxGeometry({ headerHeight: 80, margin: 30 });
  for (const cell of cells) {
    assert.ok(cell.x >= 30 - 1e-6 && cell.x + cell.w <= 960 - 30 + 1e-6, 'yatayda kenar içinde');
    assert.ok(cell.y >= g.contentTop && cell.y + cell.h <= g.contentTop + g.contentH + 1e-6, 'dikeyde içerik alanında');
    assert.ok(cell.imgH < cell.h);
  }
});

test('ortak modül: galeri HTML sayfalara bölünür ve geri birleşir (tekrarlanabilir)', () => {
  const card = i => `<div class="bl-card"><img class="bl-model-img" data-bl-image="KOL-${i}" alt="m"><h3>M${i}</h3><div><small>alt</small></div><p>not</p></div>`;
  const html = `<h1>R</h1><section><h2>Modeller</h2><div class="bl-gallery">${Array.from({ length: 9 }, (_, i) => card(i)).join('')}</div></section>`;
  const paged = layout.paginateGallery(html, { columns: 2, rows: 2 });
  assert.equal((paged.match(/bl-gallery-page/g) || []).length, 3, '9 model / 4 → 3 sayfa');
  assert.equal((paged.match(/bl-gallery-first/g) || []).length, 1);
  assert.equal(layout.paginateGallery(paged, { columns: 3, rows: 3 }).match(/bl-gallery-page/g).length, 1, 'yeniden bölme önce birleştirir');
  assert.equal(layout.paginateGallery(paged, null, { pages: false }), html, 'birleştirme özgün HTML’i verir');
  const mixed = '<div class="bl-gallery"><p>serbest metin</p><div class="bl-card">x</div></div>';
  assert.equal(layout.paginateGallery(mixed, { columns: 1, rows: 1 }), mixed, 'beklenmeyen içerik bozulmaz');
  const css = layout.layoutCss({ columns: 4, rows: 3, headerHeight: 90, titleSize: 34, showNote: false }, { orientation: 'landscape' });
  assert.match(css, /grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
  assert.match(css, /grid-template-rows:repeat\(3,minmax\(0,1fr\)\)/);
  assert.match(css, /\.bl-header\{min-height:90px/);
  assert.match(css, /h1\{font-size:34px/);
  assert.match(css, /\.bl-gallery>\.bl-card p\{display:none/);
  assert.doesNotMatch(css, /url\(|@import/i);
});

test('PowerPoint: başlık bandı ve yazı boyutu dosyaya yansır; galeri ızgara kadar model alır, kalanı devam slaytına', () => {
  const deck = contracts.normalizePresentation({
    title: 'Koleksiyon', layout: { headerHeight: 70, titleSize: 22, columns: 4, rows: 2 },
    slides: [{ layout: 'gallery', title: 'Modeller', items: items(13) }, { layout: 'bullets', title: 'Notlar', bullets: ['a'] }],
  }, { lang: 'tr' }).data;
  assert.equal(deck.slides[1].items.length, 13, 'galeri 6 ile sınırlı değil');
  assert.equal(deck.layout.columns, 4);
  const expanded = expandSlides(deck.slides, deck.layout).filter(slide => slide.layout === 'gallery');
  assert.deepEqual(expanded.map(slide => slide.items.length), [8, 5]);
  assert.deepEqual(expanded.map(slide => slide.title), ['Modeller (1/2)', 'Modeller (2/2)']);
  const files = unzip(renderPresentation(deck, { lang: 'tr', date: new Date('2026-10-07T00:00:00Z') }));
  const slide2 = files['ppt/slides/slide2.xml'];
  assert.match(slide2, new RegExp(`name="HeadBand \\d+"/>[\\s\\S]*?<a:ext cx="12192000" cy="${70 * 12700}"/>`), 'bant yüksekliği 70 pt');
  assert.match(slide2, /sz="2200" b="1"[^>]*>[\s\S]*?<a:t>Modeller \(1\/2\)<\/a:t>/, 'başlık 22 pt');
  assert.equal((slide2.match(/name="Card \d+"/g) || []).length, 8, '4 × 2 = 8 kart');
  assert.equal((files['ppt/slides/slide3.xml'].match(/name="Card \d+"/g) || []).length, 5);
  // Varsayılan yerleşim (layout yok): eski 3 × 2 düzeni.
  const plain = contracts.normalizePresentation({ slides: [{ layout: 'gallery', title: 'G', items: items(7) }] }).data;
  assert.equal(plain.layout, null);
  assert.deepEqual(expandSlides(plain.slides, null).filter(slide => slide.layout === 'gallery').map(slide => slide.items.length), [6, 1]);
});

test('PDF: model galerisi sütun × satır sayfalarına bölünür; HTML dosyasında bölünmez; yerleşim CSS’i belgededir', async () => {
  const cards = Array.from({ length: 5 }, (_, i) => `<div class="bl-card"><img class="bl-model-img" data-bl-image="KOL-${i + 1}" alt="m"><h3>DEMO-${i}</h3><p>Süprem kumaş</p></div>`).join('');
  const answer = '```html\n<h1>Koleksiyon</h1><section class="bl-section"><h2>Modeller</h2><div class="bl-gallery">' + cards + '</div><p>' + 'Açıklama metni. '.repeat(6) + '</p></section>\n```';
  const dir = tempDir();
  const service = createOutputService({ engine: fakeEngine(answer), storeOptions: { root: path.join(dir, 'out') } });
  const first = await service.create('u1', { message: 'rapor', output: { format: 'pdf' } });
  const draft = service.getDraft('u1', first.output.draftId);
  assert.equal(draft.data.layout, null, 'şablonsuz: varsayılan yerleşim');
  const pending = service.renderDraft('u1', draft.id, { data: { body: draft.data.body, styles: draft.data.styles, layout: { columns: 2, rows: 2, titleSize: 36 } } });
  const html = pending.output.html || '';
  assert.equal((html.match(/class="bl-gallery bl-gallery-page[^"]*"/g) || []).length, 2, '5 model / 4 → 2 sayfa');
  assert.equal((html.match(/bl-gallery-first/g) || []).length, 2, 'ilk parça işaretli (CSS + HTML)');
  assert.match(html, /\.bl-gallery-page\.bl-gallery-first\{aspect-ratio:/, 'ilk sayfa başlık için kısalır');
  assert.match(html, /grid-template-rows:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(html, /h1\{font-size:36px/);
  assert.equal(service.getDraft('u1', draft.id).data.layout.columns, 2, 'yerleşim taslakta saklanır');
  assert.doesNotMatch(service.getDraft('u1', draft.id).data.body, /bl-gallery-page/, 'taslak bölünmemiş saklanır');

  const htmlService = createOutputService({ engine: fakeEngine(answer), storeOptions: { root: path.join(dir, 'out2') } });
  const created = await htmlService.create('u1', { message: 'rapor', output: { format: 'html' } });
  const htmlDraft = htmlService.getDraft('u1', created.output.draftId);
  const saved = htmlService.renderDraft('u1', htmlDraft.id, { data: { body: htmlDraft.data.body, layout: { columns: 5, rows: 1 } } });
  const file = fs.readFileSync(saved.output.path, 'utf8');
  assert.doesNotMatch(file, /class="bl-gallery bl-gallery-page/, 'HTML’de sayfa yok');
  assert.match(file, /grid-template-columns:repeat\(5,minmax\(0,1fr\)\)/);
});

test('Excel: yazı boyutu, başlık satırı yüksekliği ve hücre görseli boyutu yerleşimden gelir', () => {
  const workbook = contracts.normalizeWorkbook({ title: 'Liste', subtitle: 'x', layout: { titleSize: 20, bodySize: 9, headerHeight: 30, imageSize: 100 }, sheets: [{ name: 'S', columns: [{ header: 'Görsel', type: 'image' }, { header: 'Model', type: 'text' }], rows: [['KOL-1', 'A']] }] }).data;
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const files = unzip(renderWorkbook(workbook, { lang: 'tr', images: { 'KOL-1': { buffer: png, ext: 'png', width: 1, height: 1 } } }));
  assert.match(files['xl/styles.xml'], /<font><sz val="9"\/>/);
  assert.match(files['xl/styles.xml'], /<font><b\/><sz val="20"\/>/);
  const sheet = files['xl/worksheets/sheet2.xml'];
  assert.match(sheet, /<row r="1" ht="30" customHeight="1">/);
  assert.match(sheet, /<row r="2" ht="106" customHeight="1">/, 'görsel satırı = görsel + 6 pt');
  assert.match(sheet, /<col min="1" max="1" width="20" customWidth="1"\/>/, 'görsel sütunu görselle büyür');
});

test('şablon: yerleşim kaydedilir ve uygulanır; LCW AI’ın yazdığı yerleşim yok sayılır', async () => {
  const def = userTemplates.normalizeDefinition({ format: 'pptx', layout: { columns: 5, rows: 3, headerHeight: 999 } });
  assert.equal(def.layout.columns, 5);
  assert.equal(def.layout.headerHeight, 160, 'sınır');
  assert.equal(userTemplates.normalizeDefinition({ format: 'pptx' }).layout, null);
  assert.match(userTemplates.templateInstruction(def, { name: 'Katalog', lang: 'tr' }), /5 × 3 ızgarasına \(slayt başına 15\)/);
  assert.match(userTemplates.templateInstruction(def, { name: 'Catalogue', lang: 'en' }), /placed 5 × 3 \(15 per slide\)/);
  const answer = JSON.stringify({ title: 'K', layout: { columns: 1, rows: 1 }, slides: [{ layout: 'gallery', title: 'G', items: items(3) }] });
  const service = createOutputService({ engine: fakeEngine(answer), storeOptions: { root: path.join(tempDir(), 'out') } });
  const plain = await service.create('u1', { message: 'x', output: { format: 'pptx' } });
  assert.equal(service.getDraft('u1', plain.output.draftId).data.layout, null, 'AI yerleşimi kullanılmaz');
  const withTemplate = await service.create('u1', { message: 'x', output: { format: 'pptx', userTemplate: { name: 'Katalog', definition: def } } });
  assert.equal(service.getDraft('u1', withTemplate.output.draftId).data.layout.columns, 5, 'şablon yerleşimi taslağa geçer');
  const skeleton = service.skeleton('u1', withTemplate.output.draftId);
  assert.equal(skeleton.layout.rows, 3, 'şablon olarak kaydederken yerleşim gelir');
});

test('arayüz: İçerik/Yerleşim geçişi, kaydırıcılar, ızgara seçici, hazır yerleşimler, ortak hesap; TR/EN', () => {
  const editor = fs.readFileSync(path.join(ROOT, 'public', 'lcwai-output-editor.js'), 'utf8');
  assert.match(editor, /data-ed-mode="layout"/);
  assert.match(editor, /data-lay="\$\{key\}"/);
  assert.match(editor, /data-gp="\$\{c\},\$\{r\}"/);
  assert.match(editor, /data-lay-preset="\$\{key\}"/);
  assert.match(editor, /LAY\(\)\.expandGalleries\(slides, l,/, 'önizleme sunucuyla aynı hücre/paketleme hesabı');
  assert.match(editor, /LAY\(\)\.prepareReport\(ed\.data\.body/, 'rapor önizlemesi sunucuyla aynı hazırlık (kart bilgisi, grup, sayfa)');
  assert.match(editor, /layout: ed\.data\.layout \|\| null/, 'rapor yerleşimi oluşturmaya gider');
  for (const text of ["L('Yerleşim', 'Layout')", "L('Başlık bandı yüksekliği', 'Title band height')", "L('Model ızgarası', 'Model grid')", "L('Yerleşimi de kaydet', 'Save the layout too')"]) assert.ok(editor.includes(text), text);
  const shared = fs.readFileSync(path.join(ROOT, 'public', 'lcwai-output-layout.js'), 'utf8');
  assert.doesNotMatch(shared, /require\(|document\.|window\.[a-z]/, 'saf modül (sunucu + tarayıcı)');
});

test('sadelik: 3 adımlı üst çubuk, temel ayarlar önde / ince ayar katlı, galeri yoksa ızgara gizli, sohbette şablon seçici yalnız dosya kipinde', () => {
  const editor = fs.readFileSync(path.join(ROOT, 'public', 'lcwai-output-editor.js'), 'utf8');
  assert.match(editor, /class="lcwaiEdSteps"/);
  assert.match(editor, /data-ed-mode="content"[\s\S]*data-ed-mode="layout"[\s\S]*data-ed-render/, 'İçerik → Yerleşim → Dosyayı Oluştur sırası');
  assert.doesNotMatch(editor, /<select data-ed-orientation/, 'sayfa yönü üst çubukta değil, Yerleşim adımında');
  assert.match(editor, /data-ed-orient="\$\{key\}"/);
  assert.match(editor, /<details class="lcwaiLayMore"/, 'ince ayar varsayılan kapalı');
  assert.match(editor, /const grid = isSheet \? '' : gallery/, 'galeri yoksa ızgara yerine yönlendirme');
  assert.match(editor, /<details class="lcwaiEdAdvanced"/, 'şablon penceresinde yapı/ayrıntılar katlı');
  assert.match(editor, /Bu düzeni yine kullanacak mısınız\?/, 'oluşturma sonrası şablon önerisi');
  const chat = fs.readFileSync(path.join(ROOT, 'public', 'lcwai-chat.js'), 'utf8');
  const options = chat.slice(chat.indexOf('data-output-options hidden'), chat.indexOf('</span>', chat.indexOf('data-output-options hidden')));
  assert.match(options, /data-output-template/, 'şablon seçici dosya seçenekleri içinde (sohbet kipinde gizli)');
});
