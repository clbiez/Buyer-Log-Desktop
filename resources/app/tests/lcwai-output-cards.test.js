'use strict';

/*
 * LCW AI model kartları (line sheet): kart bilgileri, grup paketleme, akıllı
 * büyütme, PDF/HTML grupları ve HTML gösteri katmanı.
 *
 * Korunan davranışlar:
 *  - Görsel önde ve büyük (en az imageShare); yazı ikinci planda, küçük.
 *    Bilgiler alt alta sığmazsa aynı satırda yan yana dizilir, görsel küçülmez.
 *  - Varsayılan kart bilgisi: model adı (başlık), renk kodu, fit, adet, hedef
 *    fiyat (TR/EN ve kaynak başlık farklarına dayanıklı). A3 biçimindeki
 *    etiket (UPDATE…) varsayılan kapalı ve LCW AI'dan istenmez.
 *  - Kartta yazacak bilgiler Yerleşim'den seçilir (layout.cardFields, sıralı);
 *    seçilmeyen alan dosyaya girmez. Kaynak sütunun değeri LCW AI'dan değil
 *    Buyer Log bağlam satırından (records) gelir ve kaçışlıdır.
 *  - Ardışık küçük galeri grupları aynı slayta/sayfaya yan yana, adları ve
 *    ayraçlarıyla dizilir; tek sayfaya sığan grup bölünmez; satır boşluğu
 *    sonraki küçük grupla dolar. Az dolu sayfada kartlar büyür (devam
 *    sayfasında büyümez; tutarlılık).
 *  - PDF'te yarım galeri sayfası tam sayfa yer kaplamaz (boş sayfa yok).
 *  - Kaynak satırları LCW AI'a giden bağlama girmez; yalnız yerel sunucuya,
 *    istenen görsel anahtarları için gider.
 *  - HTML dosyası betiksiz (CSP) CSS animasyonları taşır; PDF baskısında yok.
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
const outputImages = require(path.join(OUT, 'output-images'));
const { reportCss } = require(path.join(OUT, 'output-theme'));
const { renderPresentation, expandSlides } = require(path.join(OUT, 'output-pptx'));
const { createOutputService } = require(path.join(OUT, 'output-service'));
const userTemplates = require(path.join(OUT, 'output-user-templates'));

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000020000000308020000001226e1bb0000000c49444154789c6360f8cf00000301010018dd8db00000000049454e44ae426082', 'hex');
const pngUrl = `data:image/png;base64,${PNG.toString('base64')}`;
const unzip = buffer => {
  const cfb = XLSX.CFB.read(buffer, { type: 'buffer' });
  const files = {};
  cfb.FullPaths.forEach((name, index) => { const entry = cfb.FileIndex[index]; if (entry && entry.type === 2) files[name.replace(/^Root Entry\//, '')] = Buffer.from(entry.content).toString('utf8'); });
  return files;
};
const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'bl-ai-cards-'));
const fakeEngine = text => ({ async chat() { return { requestId: 'r', chatId: 'c', text, model: { key: 'x', label: 'X' } }; } });
const models = (n, prefix = 'DEMO', start = 1) => Array.from({ length: n }, (_, i) => ({
  title: `${prefix}-${i + 1}`, image: `KOL-${start + i}`,
  fields: [{ label: 'Kumaş', value: '2 İP 240 GR' }, { label: 'Renk Kodu', value: '19-1724 TCX' }, { label: 'Kalıp', value: 'Regular' }, { label: 'Sipariş Adedi', value: '1.200' }, { label: 'Hedef Fiyat', value: '4,20 USD' }, { label: 'Durum', value: 'Konsept onayı bekliyor' }],
}));

test('sözleşme: galeri kartı etiket, grup ve kart bilgisi taşır; talimat A3 kartını ve grupları anlatır (TR/EN)', () => {
  const deck = contracts.normalizePresentation({ slides: [{ layout: 'gallery', title: 'G', items: [
    { title: 'A', image: 'kol-1', badge: 'update', group: 'Pigment', fields: [{ label: 'Renk', value: 'Siyah', tone: 'risk' }, 'Kumaş: Süprem', 'etiketsiz'] },
    { title: 'B', details: { Renk: 'Lacivert', Kalıp: 'Regular' } },
  ] }] }).data;
  const [a, b] = deck.slides[1].items;
  assert.equal(a.image, 'KOL-1');
  assert.equal(a.badge, 'update');
  assert.equal(a.group, 'Pigment');
  assert.deepEqual(a.fields, [{ label: 'Renk', value: 'Siyah', tone: 'risk' }, { label: 'Kumaş', value: 'Süprem', tone: '' }]);
  assert.deepEqual(b.fields.map(field => field.label), ['Renk', 'Kalıp']);
  const template = { label: { tr: 'Sunum', en: 'Deck' }, guide: { tr: 'g', en: 'g' }, slides: '' };
  const tr = contracts.buildInstruction({ format: 'pptx', template, lang: 'tr' });
  assert.match(tr, /"fields":\[\{"label":"Renk kodu"[\s\S]*"Hedef fiyat"[\s\S]*MODEL KARTI BİLGİSİ: kartta görsel öndedir/);
  assert.match(contracts.buildInstruction({ format: 'pptx', template, lang: 'en' }), /"label":"Colour code"[\s\S]*"Target price"[\s\S]*MODEL CARD DETAILS: the picture is the main element/);
  assert.doesNotMatch(tr, /UPDATE|badge/, 'A3 etiketi istenmez');
  const html = contracts.buildInstruction({ format: 'html', template, lang: 'tr' });
  assert.match(html, /<dl class="bl-specs">[\s\S]*<div class="bl-groups"><section class="bl-group">/);
  assert.doesNotMatch(html, /bl-badge">UPDATE/);
  assert.doesNotMatch(contracts.buildInstruction({ format: 'xlsx', template, lang: 'tr' }), /MODEL KARTI/);
});

test('kart bilgisi: varsayılan renk kodu/fit/adet/hedef fiyat; seçilen alanlar sırayla, kaynak satırdan değer; durum tonu', () => {
  const item = models(1)[0];
  const auto = layout.cardDetails(item, layout.defaults('pptx'), null);
  assert.deepEqual(auto.map(row => row.label), ['Renk Kodu', 'Kalıp', 'Sipariş Adedi', 'Hedef Fiyat'], 'varsayılan önemli bilgiler (Kumaş/Durum seçilmedikçe yok)');
  assert.deepEqual(layout.defaultCardFields(['Colour', 'Fit', 'Qty', 'Target FOB', 'Target date']), ['Colour', 'Fit', 'Qty', 'Target FOB'], 'İngilizce başlıklar');
  assert.deepEqual(layout.cardDetails({ fields: [{ label: 'Renk Kodu', value: '19-1724' }] }, null, [['Fit', 'Slim'], ['Adet', '800'], ['Hedef Fiyat', '3,90']]).map(row => row.value), ['19-1724', 'Slim', '800', '3,90'], 'eksik varsayılan alan kaynak satırdan');
  assert.deepEqual(layout.cardDetails({ fields: [{ label: 'A', value: '1' }, { label: 'B', value: '2' }] }, null, null).map(row => row.label), ['A', 'B'], 'eşleşme yoksa LCW AI alanları');
  const d = layout.defaults('pptx');
  assert.equal(d.showBadge, false, 'A3 etiketi varsayılan kapalı');
  assert.equal(d.showSubtitle, false);
  assert.equal(d.showTitle, true, 'model adı varsayılan açık');
  const record = [['TEDARİKÇİ', 'Eureko'], ['Shopping No', '  '], ['Sezon', 'SS27']];
  const chosen = layout.cardDetails(item, layout.normalizeLayout('pptx', { cardFields: ['Durum', 'tedarikci', 'Shopping No', 'kumas', 'Yok'] }), record);
  assert.deepEqual(chosen.map(row => [row.label, row.value]), [['Durum', 'Konsept onayı bekliyor'], ['tedarikci', 'Eureko'], ['Kumaş', '2 İP 240 GR']], 'sıra korunur, boş/eksik alan atlanır, harf/aksan farkı yok');
  assert.equal(chosen[0].tone, 'risk', '"onayı bekliyor" kırmızı');
  assert.equal(layout.cardDetails({ fields: [{ label: 'Onay', value: 'Onaylandı' }] }, { cardFields: ['Onay'] }, null)[0].tone, 'ok');
  assert.equal(layout.cardDetails({ fields: [{ label: 'Not', value: 'bekliyor' }] }, { cardFields: ['Not'] }, null)[0].tone, '', 'durum dışı alan renklenmez');
  const options = layout.availableCardFields([item], { 'KOL-1': record });
  assert.deepEqual(options.source, ['TEDARİKÇİ', 'Sezon']);
  assert.deepEqual(options.defaults, ['Renk Kodu', 'Kalıp', 'Sipariş Adedi', 'Hedef Fiyat']);
  const l = layout.normalizeLayout('pptx', { cardFields: ['Renk', 'RENK', ' Kumaş ', ...Array.from({ length: 40 }, (_, i) => `F${i}`)] });
  assert.equal(l.cardFields[0], 'Renk');
  assert.equal(l.cardFields[1], 'Kumaş', 'tekrar ve boşluk temizlenir');
  assert.equal(l.cardFields.length, 24, 'üst sınır');
  assert.equal(layout.defaults('pptx').cardFields, null);
  assert.deepEqual(layout.applyPreset('pptx', 'catalog', { cardFields: ['Renk'] }).cardFields, ['Renk'], 'hazır yerleşim seçimi korur');
  assert.deepEqual(layout.applyPreset('pptx', 'standard', { cardFields: ['Renk'] }).cardFields, ['Renk']);
});

test('görsel önde: yoğun katalog kartında görsel payı korunur, bilgiler yan yana dizilerek hepsi görünür', () => {
  const catalog = layout.applyPreset('pptx', 'catalog', null);
  const cell = layout.galleryCells(catalog, 18)[0];
  const content = layout.cardContent(cell, catalog, models(1)[0], null);
  assert.ok(content.box.imgH >= (cell.h - content.box.pad * 2) * catalog.imageShare / 100 - 0.01, 'görsel en az imageShare');
  assert.equal(content.lines.flat().length, 4, '4 varsayılan bilginin hepsi görünür');
  assert.ok(content.lines.length < 4, 'sığmadığı için aynı satırda yan yana');
  assert.equal(content.hidden, 0);
  assert.ok(content.box.detail < content.box.size, 'bilgi yazısı başlıktan küçük (ikinci plan)');
  const roomy = layout.cardContent({ w: 300, h: 360 }, layout.defaults('pptx'), models(1)[0], null);
  assert.equal(roomy.lines.length, 4, 'yer varsa her bilgi kendi satırında');
  assert.ok(roomy.box.imgH > 360 * 0.7, 'kısa metinde kalan yer görselin');
});

test('paketleme: ardışık küçük gruplar aynı slayta yan yana; ortak başlık + grup adları; boşluk dolar; grup bölünmez', () => {
  const catalog = layout.applyPreset('pptx', 'catalog', null); // 6 × 3
  const slides = [
    { layout: 'section', title: 'Single Jersey' },
    { layout: 'gallery', title: 'Single Jersey · 20/1 · 200 gsm — Pigment Print 2x', items: models(1) },
    { layout: 'gallery', title: 'Single Jersey · 20/1 · 200 gsm — Pigment Print', items: models(7, 'PP', 10) },
    { layout: 'gallery', title: 'Single Jersey · 20/1 · 200 gsm — Artwork', items: models(2, 'AW', 20) },
    { layout: 'gallery', title: 'Single Jersey · 20/1 · 200 gsm — Büyük', items: models(14, 'BG', 30) },
    { layout: 'summary', title: 'Aksiyonlar', bullets: ['x'] },
  ];
  const pages = layout.expandGalleries(slides, catalog, {}).filter(entry => entry.page).map(entry => entry.page);
  assert.equal(pages.length, 2, '4 galeri slaytı → 2 slayt (eskiden 4, çoğu boş)');
  const [packed, big] = pages;
  assert.equal(packed.title, 'Single Jersey · 20/1 · 200 gsm', 'ortak başlık');
  assert.equal(packed.subtitle, '3 grup · 10 model');
  assert.deepEqual(packed.labels.map(label => label.text), ['Pigment Print 2x', 'Artwork', 'Pigment Print'], '1. satırın boşluğunu 2 modelli grup doldurur');
  assert.ok(packed.dividers.length >= 1, 'yan yana gruplar arasında ayraç');
  assert.equal(packed.cells.length, 10);
  assert.equal(big.groups.length, 1, '14 modelli grup yeni slayta (bölünmez)');
  assert.equal(big.title, 'Single Jersey · 20/1 · 200 gsm — Büyük');
  for (const page of pages) for (const cell of page.cells) {
    assert.ok(cell.x >= catalog.margin - 1e-6 && cell.x + cell.w <= 960 - catalog.margin + 1e-6, 'yatayda kenar içinde');
    assert.ok(cell.y + cell.h <= 540 - 44 + 1e-6, 'altbilginin üstünde');
  }
  const english = layout.expandGalleries(slides, catalog, { english: true }).find(entry => entry.page).page;
  assert.equal(english.subtitle, '3 groups · 10 models');
  const separate = layout.expandGalleries(slides, { ...catalog, packGroups: false }, {}).filter(entry => entry.page);
  assert.equal(separate.length, 4, 'paketleme kapalı: her grup kendi slaytında');
  const grouped = layout.expandGalleries([{ layout: 'gallery', title: 'Koleksiyon', items: [...models(2).map(item => ({ ...item, group: 'Erkek' })), ...models(2).map(item => ({ ...item, group: 'Kadın' }))] }], catalog, {});
  assert.deepEqual(grouped[0].page.labels.map(label => label.text), ['Erkek', 'Kadın'], 'öğedeki "group" alanı da grup olur');
});

test('akıllı büyütme: az model varsa kartlar oran korunarak büyür; devam slaytında büyümez; kapatılabilir', () => {
  const catalog = layout.applyPreset('pptx', 'catalog', null);
  const [single] = layout.expandGalleries([{ layout: 'gallery', title: 'G', items: models(2) }], catalog, {});
  const base = layout.galleryCells(catalog, 1)[0];
  assert.ok(single.page.scale > 2.5, `2 model 6 × 3 ızgarada büyür (${single.page.scale})`);
  assert.ok(Math.abs(single.page.cells[0].w / single.page.cells[0].h - base.w / base.h) < 0.05, 'kart oranı korunur');
  const off = layout.expandGalleries([{ layout: 'gallery', title: 'G', items: models(2) }], { ...catalog, autoFit: false }, {});
  assert.equal(off[0].page.scale, 1);
  const long = layout.expandGalleries([{ layout: 'gallery', title: 'G', items: models(20) }], catalog, {});
  assert.deepEqual(long.map(entry => entry.page.cells.length), [18, 2]);
  assert.equal(long[1].page.scale, 1, 'devam slaytı ilk slaytla aynı kart boyunda');
  assert.equal(long[1].page.title, 'G (2/2)');
});

test('PowerPoint: koyu line-sheet bandı, gruplar, etiket ve seçilen kart bilgileri (kaynak değeri) dosyada', () => {
  const deck = contracts.normalizePresentation({ title: 'Temmuz 2027', slides: [
    { layout: 'gallery', title: 'SJ · 30/1 — Pigment', items: models(2) },
    { layout: 'gallery', title: 'SJ · 30/1 — Artwork', items: models(1, 'AW', 5) },
  ] }).data;
  deck.layout = layout.normalizeLayout('pptx', { cardFields: ['Durum', 'Tedarikçi'] });
  const plain = unzip(renderPresentation({ ...deck, layout: null }, { lang: 'tr' }))['ppt/slides/slide2.xml'];
  assert.match(plain, /<a:t>19-1724 TCX<\/a:t>[\s\S]*<a:t>4,20 USD<\/a:t>/, 'varsayılan: renk kodu … hedef fiyat');
  assert.doesNotMatch(plain, /name="Badge \d+"|<a:t>2 İP 240 GR<\/a:t>/, 'etiket yok; seçilmeyen Kumaş yok');
  const records = { 'KOL-1': [['Tedarikçi', 'Eureko & <Co>']] };
  const slides = expandSlides(deck.slides, deck.layout);
  assert.equal(slides.filter(slide => slide.layout === 'gallery').length, 1, 'iki küçük grup tek slaytta');
  const files = unzip(renderPresentation(deck, { lang: 'tr', images: outputImages.normalizeImages({ 'KOL-1': pngUrl }, ['KOL-1']), records }));
  const xml = files['ppt/slides/slide2.xml'];
  assert.match(xml, /name="HeadBand \d+"\/>[\s\S]*?<a:srgbClr val="262626"\/>/, 'galeri bandı logo siyahı (A3)');
  assert.equal((xml.match(/name="Card \d+"/g) || []).length, 3);
  assert.equal((xml.match(/name="GroupRule \d+"/g) || []).length, 2);
  assert.match(xml, /<a:t>Pigment<\/a:t>[\s\S]*<a:t>Artwork<\/a:t>/);
  assert.match(xml, /<a:t>SJ · 30\/1<\/a:t>/, 'ortak başlık');
  assert.match(xml, /<a:t>Eureko &amp; &lt;Co&gt;<\/a:t>/, 'kaynak değeri kaçışlı');
  assert.match(xml, /<a:t>Konsept onayı bekliyor<\/a:t>/);
  assert.doesNotMatch(xml, /<a:t>19-1724 TCX<\/a:t>/, 'seçilmeyen alan (Renk kodu) karta yazılmaz');
  assert.match(xml, /<a:outerShdw/, 'kart gölgesi');
});

test('PDF/HTML: gruplar yan yana (span), az kartlı galeri büyür, yarım sayfa tam sayfa kaplamaz, kart bilgisi kaynaktan ve kaçışlı', () => {
  const card = (n, specs = '') => `<div class="bl-card"><img class="bl-model-img" data-bl-image="KOL-${n}" alt="m"><span class="bl-badge">UPDATE</span><h3>M${n}</h3>${specs}</div>`;
  const body = `<div class="bl-groups"><section class="bl-group"><h3 class="bl-group-title">A</h3><div class="bl-gallery">${card(1, '<dl class="bl-specs"><div><dt>Durum</dt><dd>Onay bekliyor</dd></div><div><dt>Renk</dt><dd>Siyah</dd></div></dl>')}</div></section><section class="bl-group"><h3 class="bl-group-title">B</h3><div class="bl-gallery">${card(2)}${card(3)}</div></section></div><div class="bl-gallery">${card(4)}</div>`;
  const l = layout.normalizeLayout('pdf', { columns: 4, rows: 3, cardFields: ['Durum', 'Sezon'] });
  const out = layout.prepareReport(body, l, { pages: true, records: { 'KOL-2': [['Sezon', '<b>SS27</b>']], 'KOL-9': [['Sezon', 'x']] } });
  assert.match(out, /class="bl-groups bl-cols-3"/, '3 kartlık grup satırı 4 sütunda büyür (autoFit)');
  assert.match(out, /class="bl-group bl-span-1"[\s\S]*class="bl-group bl-span-2"/);
  assert.match(out, /class="bl-gallery bl-gallery-page bl-gallery-first bl-rows-1 bl-cols-2"/, 'grup galerisi kendi sütunu, tek satır');
  assert.match(out, /<dl class="bl-specs"><div class="risk"><dt>Durum<\/dt><dd>Onay bekliyor<\/dd><\/div><\/dl>/, 'Renk seçilmedi → yazılmaz; durum kırmızı');
  assert.match(out, /<dt>Sezon<\/dt><dd>&lt;b&gt;SS27&lt;\/b&gt;<\/dd>/, 'kaynak değeri kaçışlı');
  assert.equal(layout.paginateGallery(out, null, { pages: false }).includes('bl-rows-'), false, 'taslak birleştirmede sayfa/süs sınıfı kalmaz');
  assert.equal(layout.prepareReport(out, l, { pages: true }).match(/bl-cols-/g).length, out.match(/bl-cols-/g).length, 'tekrarlanabilir');
  const css = layout.layoutCss(l);
  assert.match(css, /\.bl-gallery-page\.bl-rows-1\{grid-template-rows:repeat\(1,minmax\(0,1fr\)\);aspect-ratio:/, 'yarım sayfa yalnız dolu satır kadar');
  assert.match(css, /\.bl-group\.bl-span-2\{grid-column:span 2;\}/);
  assert.doesNotMatch(css, /\.bl-specs dt\{display:none/);
  const hidden = layout.layoutCss({ showFieldLabels: false, showBadge: false });
  assert.match(hidden, /\.bl-specs dt\{display:none;\}/, 'alan adları gizlenebilir');
  assert.match(hidden, /\.bl-gallery \.bl-card \.bl-badge\{display:none;\}/, 'etiket gizlenebilir');
});

test('servis: kaynak satırları yalnız istenen anahtarlar için alınır, taslakta kalır, yeniden oluşturmada kullanılır', async () => {
  const answer = JSON.stringify({ title: 'K', slides: [{ layout: 'gallery', title: 'Modeller', items: [{ title: 'A', image: 'KOL-1', fields: [{ label: 'Renk', value: 'Siyah' }] }] }] });
  const service = createOutputService({ engine: fakeEngine(answer), storeOptions: { root: path.join(tempDir(), 'out') } });
  const first = await service.create('u1', { message: 'kartlar', output: { format: 'pptx' } });
  assert.equal(first.output.pending, 'images');
  const done = service.completeImages('u1', first.output.pendingId, { 'KOL-1': pngUrl }, { 'KOL-1': [['Tedarikçi', 'Eureko'], ['BL Image', 'KOL-1'], ['Boş', '']], 'KOL-77': [['Gizli', 'x']] });
  assert.ok(done.id);
  const draft = service.getDraft('u1', first.output.draftId);
  assert.deepEqual(draft.records, { 'KOL-1': [['Tedarikçi', 'Eureko']] }, 'istenmeyen anahtar, boş değer ve anahtar sütunu atılır');
  const data = { ...draft.data, layout: { cardFields: ['Tedarikçi', 'Renk'] } };
  const rendered = service.renderDraft('u1', draft.id, { data });
  const files = unzip(fs.readFileSync(rendered.output.path));
  assert.match(files['ppt/slides/slide2.xml'], /<a:t>Eureko<\/a:t>[\s\S]*<a:t>Siyah<\/a:t>/, 'seçim sırası: önce Tedarikçi (kaynak), sonra Renk');
  assert.deepEqual(outputImages.normalizeRecords({ 'kol-1': [['A', { x: 1 }], ['B', 2]], 'KOL-2': 'x' }, ['KOL-1', 'KOL-2']), { 'KOL-1': [['B', '2']] });
});

test('şablon: seçilen kart bilgileri LCW AI talimatına girer (TR/EN)', () => {
  const def = userTemplates.normalizeDefinition({ format: 'pptx', layout: { columns: 4, rows: 2, cardFields: ['Renk', 'Kumaş', 'Durum'] } });
  assert.deepEqual(def.layout.cardFields, ['Renk', 'Kumaş', 'Durum']);
  assert.match(userTemplates.templateInstruction(def, { name: 'Line sheet', lang: 'tr' }), /Model kartı bilgileri: .*Renk, Kumaş, Durum/);
  assert.match(userTemplates.templateInstruction(def, { name: 'Line sheet', lang: 'en' }), /Model card details: .*Renk, Kumaş, Durum/);
});

test('HTML gösterisi: betiksiz CSS animasyonları (kaydırmayla beliren kartlar, ilerleme çubuğu, parıltı); baskıda kapalı', () => {
  const screen = reportCss({ print: false });
  assert.match(screen, /prefers-reduced-motion:no-preference/);
  assert.match(screen, /animation-timeline:view\(\)/);
  assert.match(screen, /animation-timeline:scroll\(root\)/);
  assert.match(screen, /@keyframes bl-aurora/);
  assert.match(screen, /\.bl-gallery>\.bl-card:hover \.bl-model-img\{transform:scale/);
  const print = reportCss({ print: true });
  assert.doesNotMatch(print, /animation-timeline|bl-aurora|bl-sheen/);
  assert.match(print, /\.bl-specs dd\{/, 'kart bilgisi stili baskıda da var');
  assert.doesNotMatch(screen.replace(/url\(data:font\/woff2;base64,[^)]*\)/g, ''), /url\(|<script|javascript:/i);
});

test('arayüz: kart bilgisi seçici, grup bayrakları, 60 kartlık galeri, kaynak satırları LCW AI bağlamına girmez; TR/EN', () => {
  const editor = fs.readFileSync(path.join(ROOT, 'public', 'lcwai-output-editor.js'), 'utf8');
  assert.match(editor, /gallery: 60/, 'düzenleyici sunucu sınırıyla aynı (eskiden 6)');
  assert.match(editor, /data-lay-field="\$\{esc\(label\)\}"/);
  assert.match(editor, /data-lay-field-move=/);
  assert.match(editor, /flag\('packGroups'/);
  assert.match(editor, /flag\('autoFit'/);
  for (const text of ["L('Kart bilgileri', 'Card details')", "L('Az model varsa kartları büyüt', 'Enlarge cards when there are few models')", "L('Kaynak', 'Source')", "L('Alan adları', 'Field names')", "L('Varsayılan bilgilere dön', 'Back to the default details')"]) assert.ok(editor.includes(text), text);
  assert.doesNotMatch(editor, /\.badge`|flag\('showBadge'/, 'A3 etiketi düzenleyicide sunulmaz');
  assert.match(editor, /LAY\(\)\.cardContent\(cell, l,/, 'önizleme kartı dosyayla aynı hesap');
  const chat = fs.readFileSync(path.join(ROOT, 'public', 'lcwai-chat.js'), 'utf8');
  assert.match(chat, /const \{ rows, columns, images, records, \.\.\.rest \} = context;/, 'records bağlam özetinden ayrılır');
  assert.match(chat, /if \(prepared\.context\) delete prepared\.context\.records;/);
  const persist = chat.indexOf('function persistConversations');
  assert.ok(persist > 0);
  assert.doesNotMatch(chat.slice(persist, chat.indexOf('\n  }\n', persist)), /recordMap|imageMap/, 'kaynak satırları geçmişe yazılmaz');
  const assistant = fs.readFileSync(path.join(ROOT, 'public', 'lcwai-assistant.js'), 'utf8');
  assert.match(assistant, /JSON\.stringify\(\{ images, records \}\)/);
});
