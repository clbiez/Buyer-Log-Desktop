'use strict';

/*
 * LCW AI çıktı YERLEŞİMİ (Yerleşim aracı): başlık bandı yüksekliği, yazı
 * boyutları, kenar boşluğu ve model ızgarası (sütun × satır).
 *
 * Korunan davranışlar:
 *  - Sunucu ve tarayıcı önizlemesi aynı modülü (public/lcwai-output-layout.js)
 *    kullanır; değerler sınır içinde tutulur.
 *  - Katalog: model kartları grup / alt gruba göre sayfalanır; sayfa 12
 *    sütunlu blok ızgarasıdır (başlık, grup, alt başlık, model alanı, metin).
 *  - Önizleme, dosyayı oluşturan kodun çıktısıdır (PowerPoint sahnesi,
 *    PDF/HTML katalog sayfaları); dosya kaydedilmeden üretilir.
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
const { renderPresentation, previewPresentation, expandSlides } = require(path.join(OUT, 'output-pptx'));
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

test('ortak modül: katalog sayfası blokları 12 sütunlu ızgarada; gruplama veriden ve elle', () => {
  const page = layout.defaultPage('pptx');
  assert.deepEqual(page.blocks.map(block => block.kind), ['title', 'group', 'subgroup', 'models']);
  // Taşma ve çakışma düzeltilir; model alanı silinemez.
  const l = layout.normalizeLayout('pptx', { page: { blocks: [{ id: 't', kind: 'title', x: 10, y: 0, w: 9, h: 1 }, { id: 'x', kind: 'text', x: 0, y: 99, w: 3, h: 1, text: 'Not' }, { id: 'z', kind: 'bogus', x: 0, y: 0, w: 1, h: 1 }] } });
  const title = l.page.blocks.find(block => block.kind === 'title');
  assert.ok(title.x + title.w <= 12, 'sağa taşmaz');
  assert.ok(l.page.blocks.some(block => block.kind === 'models'), 'model alanı her zaman var');
  assert.ok(!l.page.blocks.some(block => block.kind === 'bogus'));
  for (const block of l.page.blocks) assert.ok(block.y + block.h <= l.page.rows, 'sayfa içinde');
  const area = { x: 0, y: 0, w: 1200, h: 800 };
  const r = layout.blockRect(area, { rows: 8 }, { x: 0, y: 2, w: 6, h: 6 }, 0);
  assert.deepEqual([r.x, r.y, r.w, r.h], [0, 200, 600, 600]);

  // Gruplama: BL Image anahtarı → bağlam satırındaki sütun.
  const list = [{ title: 'A', image: 'KOL-1' }, { title: 'B', image: 'KOL-2' }, { title: 'C', image: 'KOL-3' }, { title: 'D', subtitle: 'Süprem' }];
  const attributes = { 'KOL-1': { Kategori: 'Örme', Kumaş: 'Süprem' }, 'KOL-2': { Kategori: 'Dokuma', Kumaş: 'Poplin' }, 'KOL-3': { Kategori: 'Örme', Kumaş: 'Ribana' } };
  const fields = layout.groupingFields(list, attributes);
  assert.ok(fields.some(field => field.key === 'a:Kategori' && field.distinct === 2));
  const grouped = layout.assignGroups(list, attributes, 'a:Kategori', 'a:Kumaş');
  assert.deepEqual(grouped.map(item => [item.group, item.subgroup]), [['Örme', 'Süprem'], ['Dokuma', 'Poplin'], ['Örme', 'Ribana'], ['', '']]);
  // Elle sıra: catalog.order gruplar arası sırayı belirler.
  const groups = layout.groupItems(grouped, { order: ['Dokuma', 'Örme'] });
  assert.deepEqual(groups.map(group => group.group).slice(0, 2), ['Dokuma', 'Örme']);
  // Katalog sayfaları: bir alt grup = bir sayfa; ızgarayı aşan devam sayfasına.
  const many = Array.from({ length: 7 }, (_, i) => ({ title: `M${i}`, group: i < 5 ? 'Örme' : 'Dokuma' }));
  const pages = layout.catalogPages(many, { order: [] }, layout.normalizeLayout('pptx', { columns: 2, rows: 2 }));
  assert.deepEqual(pages.map(item => [item.group, item.entries.length, item.part, item.parts]), [['Örme', 4, 1, 2], ['Örme', 1, 2, 2], ['Dokuma', 2, 1, 1]]);
  const css = layout.layoutCss({ columns: 4, rows: 3, headerHeight: 90, titleSize: 34, showNote: false }, { orientation: 'landscape' });
  assert.match(css, /\.bl-catalog-page\{/);
  assert.match(css, /grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
  assert.match(css, /grid-template-rows:repeat\(3,minmax\(0,1fr\)\)/);
  assert.match(css, /\.bl-header\{min-height:90px/);
  assert.match(css, /h1\{font-size:34px/);
  assert.doesNotMatch(css, /url\(|@import/i);
});

test('PowerPoint: galeri gruplara göre katalog slaytlarına bölünür; bloklar ve gerçek önizleme dosyayla aynı', () => {
  const list = items(13).map((item, i) => ({ ...item, group: i < 9 ? 'Örme' : 'Dokuma' }));
  const blocks = layout.defaultPage('pptx').blocks.map(block => (block.kind === 'title' ? { ...block, size: 30 } : block));
  blocks.push({ id: 'n1', kind: 'text', x: 0, y: 7, w: 12, h: 1, text: 'Demo notu' });
  const deck = contracts.normalizePresentation({
    title: 'Koleksiyon', layout: { headerHeight: 70, titleSize: 22, columns: 4, rows: 2, page: { rows: 8, blocks } },
    slides: [{ layout: 'gallery', title: 'Modeller', items: list }, { layout: 'bullets', title: 'Notlar', bullets: ['a'] }],
  }, { lang: 'tr' }).data;
  assert.equal(deck.slides[1].items.length, 13, 'galeri 6 ile sınırlı değil');
  const expanded = expandSlides(deck.slides, deck.layout).filter(slide => slide.layout === 'catalogPage');
  assert.deepEqual(expanded.map(slide => [slide.labels.group, slide.items.length]), [['Örme (1/2)', 8], ['Örme (2/2)', 1], ['Dokuma', 4]]);
  const files = unzip(renderPresentation(deck, { lang: 'tr', date: new Date('2026-10-07T00:00:00Z') }));
  const slide2 = files['ppt/slides/slide2.xml'];
  assert.equal((slide2.match(/name="Card \d+"/g) || []).length, 8, '4 × 2 = 8 kart');
  assert.match(slide2, /sz="3000" b="1"[^>]*>[\s\S]*?<a:t>Modeller<\/a:t>/, 'başlık bloğu boyutu dosyada');
  assert.match(slide2, /<a:t>Örme \(1\/2\)<\/a:t>/, 'grup başlığı');
  assert.match(slide2, /<a:t>Demo notu<\/a:t>/, 'metin kutusu');
  assert.equal((files['ppt/slides/slide4.xml'].match(/name="Card \d+"/g) || []).length, 4);
  // Önizleme: aynı çizim kodunun sahnesi (dosya oluşturulmadan).
  const preview = previewPresentation(deck, { lang: 'tr' });
  assert.equal(preview.slides.length, 5);
  const scene = preview.slides[1];
  assert.equal(scene.layout, 'catalogPage');
  assert.deepEqual([scene.catalog.group, scene.catalog.part], ['Örme', 1]);
  assert.ok(scene.scene.items.some(item => item.paragraphs && item.paragraphs.some(par => par.text === 'Demo notu')));
  assert.ok(scene.scene.items.some(item => item.paragraphs && item.paragraphs.some(par => par.text === 'Modeller' && par.size === 30)), 'sahne dosyadaki boyutu taşır');
});

test('PDF: kartlar katalog verisine ayrılır, gruplara göre sayfalanır; önizleme dosyayla aynı HTML; HTML dosyası da katalogludur', async () => {
  const cards = Array.from({ length: 5 }, (_, i) => `<div class="bl-card"><img class="bl-model-img" data-bl-image="KOL-${i + 1}" alt="m"><h3>DEMO-${i}</h3><small>Süprem</small><p>Kumaş detayı uzun açıklama ${i}</p></div>`).join('');
  const answer = '```html\n<h1>Koleksiyon</h1><section class="bl-section"><h2>Modeller</h2><div class="bl-gallery">' + cards + '</div><p>' + 'Açıklama metni. '.repeat(6) + '</p></section>\n```';
  const dir = tempDir();
  const service = createOutputService({ engine: fakeEngine(answer), storeOptions: { root: path.join(dir, 'out') } });
  const first = await service.create('u1', { message: 'rapor', output: { format: 'pdf' } });
  const draft = service.getDraft('u1', first.output.draftId);
  assert.equal(draft.data.galleries.length, 1, 'galeri katalog verisine çevrilir');
  assert.equal(draft.data.galleries[0].title, 'Modeller');
  assert.equal(draft.data.galleries[0].items[2].note, 'Kumaş detayı uzun açıklama 2', 'not kısaltılmaz');
  assert.match(draft.data.body, /<div class="bl-catalog" data-bl-catalog="0"><\/div>/);
  assert.doesNotMatch(draft.data.body, /bl-card/);
  // Tarayıcı düzenleyicisinin eklediği öznitelikler yer tutucuyu kaybettirmez.
  assert.equal(contracts.normalizeHtmlDraft({ body: draft.data.body.replace('data-bl-catalog="0">', 'data-bl-catalog="0" style="" contenteditable="false"><br>'), galleries: draft.data.galleries }).data.galleries.length, 1);
  const galleries = [{ ...draft.data.galleries[0], items: draft.data.galleries[0].items.map((item, i) => ({ ...item, group: i < 3 ? 'Örme' : 'Dokuma' })) }];
  const data = { body: draft.data.body, styles: draft.data.styles, galleries, layout: { columns: 2, rows: 1, titleSize: 36 } };
  const preview = service.previewDraft('u1', draft.id, { data });
  assert.equal(preview.format, 'pdf');
  assert.deepEqual(preview.catalogs[0].pages.map(page => [page.group, page.part, page.parts]), [['Örme', 1, 2], ['Örme', 2, 2], ['Dokuma', 1, 1]]);
  assert.match(preview.shell, /<!--BL-PAGE-->/);
  const pending = service.renderDraft('u1', draft.id, { data });
  const html = pending.output.html || '';
  assert.equal((html.match(/<section class="bl-catalog-page"/g) || []).length, 3, 'dosyada aynı 3 sayfa');
  for (const page of preview.catalogs[0].pages) assert.ok(preview.document.includes(page.html), 'önizleme sayfası = belge sayfası');
  assert.match(html, /h1\{font-size:36px/);
  assert.equal(service.getDraft('u1', draft.id).data.galleries[0].items[4].group, 'Dokuma', 'gruplama taslakta saklanır');

  const htmlService = createOutputService({ engine: fakeEngine(answer), storeOptions: { root: path.join(dir, 'out2') } });
  const created = await htmlService.create('u1', { message: 'rapor', output: { format: 'html' } });
  const htmlDraft = htmlService.getDraft('u1', created.output.draftId);
  const saved = htmlService.renderDraft('u1', htmlDraft.id, { data: { body: htmlDraft.data.body, galleries: htmlDraft.data.galleries, layout: { columns: 5, rows: 1 } } });
  const file = fs.readFileSync(saved.output.path, 'utf8');
  assert.match(file, /class="bl-catalog-page"/);
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
  assert.match(editor, /layout: ed\.data\.layout \|\| null, galleries: ed\.data\.galleries \|\| \[\]/, 'rapor yerleşimi ve kataloğu oluşturmaya gider');
  for (const text of ["L('Yerleşim', 'Layout')", "L('Rapor başlığı yüksekliği', 'Report header height')", "L('Yerleşimi de kaydet', 'Save the layout too')"]) assert.ok(editor.includes(text), text);
  const shared = fs.readFileSync(path.join(ROOT, 'public', 'lcwai-output-layout.js'), 'utf8');
  assert.doesNotMatch(shared, /require\(|document\.|window\.[a-z]/, 'saf modül (sunucu + tarayıcı)');
});

test('arayüz: gerçek önizleme sunucudan, gruplama ağacı, blok tasarımcısı (taşı/boyutlandır/düzenle); TR/EN', () => {
  const editor = fs.readFileSync(path.join(ROOT, 'public', 'lcwai-output-editor.js'), 'utf8');
  // Önizleme dosyayı oluşturan sunucu kodundan gelir; ayar değişince gecikmeli yenilenir, eskisi iptal edilir.
  assert.match(editor, /api\.previewDraft\(draftId, \{ data: collectData\(\)/);
  assert.match(editor, /if \(previewAbort\) previewAbort\.abort\(\)/);
  assert.match(editor, /function updateLayoutPreview\(\)[\s\S]*?schedulePreview\(\);/);
  assert.doesNotMatch(editor, /paginateGallery|galleryCells\(l,/, 'tarayıcıda ayrı yaklaşık çizim yok');
  // AI/rapor HTML'i ana DOM'a girmez: betiksiz iframe.
  assert.match(editor, /<iframe data-lay-frame sandbox="allow-same-origin"/);
  assert.doesNotMatch(editor, /sandbox="[^"]*allow-scripts/);
  // Gruplama: veriden otomatik + sürükle-bırak / yeniden adlandır / sırala.
  assert.match(editor, /LAY\(\)\.assignGroups\(obj\.items, ed\.draft\.attributes/);
  assert.match(editor, /data-grp-by/);
  assert.match(editor, /data-grp-drop=/);
  assert.match(editor, /draggable="true" data-grp-item=/);
  assert.match(editor, /data-grp-rename=/);
  assert.match(editor, /data-grp-move=/);
  // Blok tasarımcısı: ızgaraya oturan taşıma/boyutlandırma, araç çubuğu, metin kutusu.
  assert.match(editor, /Math\.round\(\(event\.clientX - drag\.startX\) \/ drag\.cellW\)/);
  assert.match(editor, /data-blk-resize=/);
  for (const attr of ['data-blk-size', 'data-blk-align', 'data-blk-fill', 'data-blk-edit', 'data-blk-del', 'data-blk-add', 'data-blk-reset']) assert.ok(editor.includes(attr), attr);
  for (const text of ["L('Gruplar', 'Groups')", "L('Görünüm', 'Look')", "L('✓ Dosyayla aynı', '✓ Same as the file')", "L('Metin kutusu', 'Text box')", "L('Grup başlığı', 'Group heading')", "L('Alt başlık', 'Subheading')"]) assert.ok(editor.includes(text), text);
  // İçerik adımında katalog yer tutucusu görünür ve düzenlenemez.
  assert.match(editor, /catalogStandInCss\(\)/);
  assert.match(editor, /\.bl-catalog'\)\.forEach\(el => el\.setAttribute\('contenteditable', 'false'\)\)/);
  const assistant = fs.readFileSync(path.join(ROOT, 'public', 'lcwai-assistant.js'), 'utf8');
  assert.match(assistant, /previewDraft/);
  const routes = fs.readFileSync(path.join(ROOT, 'server', 'routes', 'lcwai-routes.js'), 'utf8');
  assert.match(routes, /output-drafts\/:id\/preview/);
});

test('sadelik: 3 adımlı üst çubuk, temel ayarlar önde / ince ayar katlı, galeri yoksa ızgara gizli, sohbette şablon seçici yalnız dosya kipinde', () => {
  const editor = fs.readFileSync(path.join(ROOT, 'public', 'lcwai-output-editor.js'), 'utf8');
  assert.match(editor, /class="lcwaiEdSteps"/);
  assert.match(editor, /data-ed-mode="content"[\s\S]*data-ed-mode="layout"[\s\S]*data-ed-render/, 'İçerik → Yerleşim → Dosyayı Oluştur sırası');
  assert.doesNotMatch(editor, /<select data-ed-orientation/, 'sayfa yönü üst çubukta değil, Yerleşim adımında');
  assert.match(editor, /data-ed-orient="\$\{key\}"/);
  assert.match(editor, /<details class="lcwaiLayMore"/, 'ince ayar varsayılan kapalı');
  assert.match(editor, /const grid = gallery \?/, 'galeri yoksa ızgara yerine yönlendirme');
  assert.match(editor, /<details class="lcwaiEdAdvanced"/, 'şablon penceresinde yapı/ayrıntılar katlı');
  assert.match(editor, /Bu düzeni yine kullanacak mısınız\?/, 'oluşturma sonrası şablon önerisi');
  const chat = fs.readFileSync(path.join(ROOT, 'public', 'lcwai-chat.js'), 'utf8');
  const options = chat.slice(chat.indexOf('data-output-options hidden'), chat.indexOf('</span>', chat.indexOf('data-output-options hidden')));
  assert.match(options, /data-output-template/, 'şablon seçici dosya seçenekleri içinde (sohbet kipinde gizli)');
});
