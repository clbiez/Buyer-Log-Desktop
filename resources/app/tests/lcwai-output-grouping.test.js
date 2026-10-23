'use strict';

/*
 * LCW AI model galerisi: kullanıcı gruplaması (1./2./3. grup) ve sayfa başlığı.
 *
 * Korunan davranışlar:
 *  - layout.groupBy (en çok 3 alan) tüm galeri modellerini alan değerine göre
 *    yeniden gruplar (ör. Kategori › Kumaş › Baskı). layout.groupBreak kaç
 *    seviyenin yeni slayt/bölüm başlattığını belirler (varsayılan 1: yalnız
 *    1. grup); kalan seviyeler aynı sayfada "Kumaş · Baskı" adıyla yan yana
 *    alt gruplardır — farklı alt gruplar tek sayfada birlikte. Değer önce
 *    kart alanından, yoksa Buyer Log kaynak satırından gelir; yoksa
 *    "Belirtilmemiş". LCW AI'ın galeri ve bölüm ayracı slaytları yerine geçer;
 *    bloktaki diğer slaytlar korunur.
 *  - layout.pageTitle: otomatik (null) · alanlardan · elle ({Alan} yer
 *    tutucusu). Hiç değer dolmazsa otomatik başlık kalır; devam slaytı (i/n) alır.
 *  - PDF/HTML: aynı gruplama bölüm + .bl-groups olarak yazılır; yalnız başlık
 *    + galeri taşıyan bölümler kalkar, diğer içerik korunur; değerler kaçışlıdır.
 *  - Seçimler hazır yerleşimde korunur, şablona kaydedilir ve şablon
 *    talimatına (LCW AI karta bu alanları yazsın diye) girer.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const XLSX = require('xlsx');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'server', 'lib', 'lcwai-output');
const layout = require(path.join(ROOT, 'public', 'lcwai-output-layout'));
const contracts = require(path.join(OUT, 'output-contracts'));
const { renderPresentation, expandSlides } = require(path.join(OUT, 'output-pptx'));
const userTemplates = require(path.join(OUT, 'output-user-templates'));

const unzip = buffer => {
  const cfb = XLSX.CFB.read(buffer, { type: 'buffer' });
  const files = {};
  cfb.FullPaths.forEach((name, index) => { const entry = cfb.FileIndex[index]; if (entry && entry.type === 2) files[name.replace(/^Root Entry\//, '')] = Buffer.from(entry.content).toString('utf8'); });
  return files;
};
const model = (n, category, fabric, print) => ({ title: `DEMO-${n}`, image: `KOL-${n}`, fields: [{ label: 'Kategori', value: category }, { label: 'Kumaş', value: fabric }, { label: 'Baskı', value: print }, { label: 'Fit', value: 'Regular' }].filter(field => field.value) });
const deckSlides = () => [
  { layout: 'title', title: 'Koleksiyon' },
  { layout: 'section', title: 'LCW AI bölümü' },
  { layout: 'gallery', title: 'Galeri 1', items: [model(1, 'Tişört', 'SJ 30/1', 'Pigment'), model(2, 'Tişört', 'SJ 30/1', 'Pigment 2x'), model(3, 'Şort', 'SJ 20/1', 'Pigment')] },
  { layout: 'table', title: 'Fiyat tablosu', table: { columns: ['A'], rows: [['1']] }, bullets: [] },
  { layout: 'section', title: 'LCW AI bölümü 2' },
  { layout: 'gallery', title: 'Galeri 2', items: [model(4, 'Tişört', 'SJ 30/1', 'Pigment'), model(5, 'Tişört', 'SJ 20/1', 'No Print'), { title: 'DEMO-9', image: 'KOL-9', fields: [] }] },
  { layout: 'summary', title: 'Aksiyonlar', bullets: ['x'] },
];

test('normalize: gruplama en çok 3 seviye, tekrar yok; başlık kipi; hazır yerleşim korur', () => {
  const l = layout.normalizeLayout('pptx', { groupBy: ['Kategori', 'KATEGORI', 'Kumaş', 'Baskı', 'Fit'], pageTitle: { mode: 'manual', text: '  {Kategori}   · Yaz  ' } });
  assert.deepEqual(l.groupBy, ['Kategori', 'Kumaş', 'Baskı']);
  assert.deepEqual(l.pageTitle, { mode: 'manual', fields: [], text: '{Kategori} · Yaz' });
  assert.equal(layout.normalizeLayout('pptx', { groupBy: [], pageTitle: { mode: 'auto' } }).groupBy, null);
  assert.equal(layout.normalizeLayout('pptx', { pageTitle: { mode: 'x' } }).pageTitle, null);
  assert.equal(layout.defaults('pdf').groupBy, null);
  const kept = layout.applyPreset('pptx', 'standard', l);
  assert.deepEqual(kept.groupBy, l.groupBy);
  assert.deepEqual(kept.pageTitle, l.pageTitle);
  assert.deepEqual(layout.applyPreset('pptx', 'catalog', l).groupBy, l.groupBy);
});

test('PowerPoint: Kategori › Kumaş › Baskı — 1. grup yeni slayt, alt gruplar aynı slaytta yan yana; LCW AI galeri/bölüm slaytları değişir', () => {
  const l = layout.normalizeLayout('pptx', { ...layout.applyPreset('pptx', 'catalog', null), groupBy: ['Kategori', 'Kumaş', 'Baskı'] });
  assert.equal(l.groupBreak, 1, 'varsayılan: yalnız 1. grup yeni slayt');
  const records = { 'KOL-9': [['Kategori', 'Şort'], ['KUMAŞ', 'SJ 20/1'], ['Baskı', 'Artwork']] };
  const out = layout.expandGalleries(deckSlides(), l, { records });
  const summary = out.map(entry => (entry.page ? `P:${entry.page.title}|${entry.page.labels.map(label => label.text).join(',')}` : `S:${entry.slide.title}`));
  assert.deepEqual(summary, [
    'S:Koleksiyon',
    'P:Tişört|SJ 30/1 · Pigment,SJ 30/1 · Pigment 2x,SJ 20/1 · No Print',
    'P:Şort|SJ 20/1 · Pigment,SJ 20/1 · Artwork',
    'S:Fiyat tablosu',
    'S:Aksiyonlar',
  ], 'farklı Kumaş alt grupları tek slaytta; bölüm ayraçları kalkar, tablo blok ardında korunur; kaynak satırdan değer (KOL-9)');
  assert.deepEqual(out[1].sources, [2, 5], 'önizleme için kaynak slaytlar');
  const deep = layout.expandGalleries(deckSlides(), { ...l, groupBreak: 2 }, { records });
  assert.deepEqual(deep.filter(entry => entry.page).map(entry => `${entry.page.title}|${entry.page.labels.map(label => label.text).join(',')}`), [
    'Tişört · SJ 30/1|Pigment,Pigment 2x',
    'Şort · SJ 20/1|Pigment,Artwork',
    'Tişört · SJ 20/1 · No Print|',
  ], 'groupBreak=2: 1. ve 2. grup yeni slayt (eski düzen)');
  const flat = layout.expandGalleries(deckSlides(), { ...l, groupBreak: 0 }, { records });
  assert.equal(flat.filter(entry => entry.page).length, 1, 'groupBreak=0: tüm gruplar aynı slaytta (sığdıkça)');
  assert.equal(layout.normalizeLayout('pptx', { groupBreak: 7 }).groupBreak, 1, 'sınır dışı → varsayılan');
  assert.equal(layout.applyPreset('pptx', 'standard', { groupBy: ['Kategori', 'Kumaş'], groupBreak: 0 }).groupBreak, 0, 'hazır yerleşim korur');
  // 3 × 1 ızgarada 1 + 3 + 2 modellik alt gruplar: 1 ve 2 aynı slayta sığar, 3'lü grup sonraki slayta (her grup ayrı slayt değil).
  const lic = (n, pmd) => ({ title: `L-${n}`, image: `KOL-${n}`, fields: [{ label: 'Buying Group', value: 'LİSANS' }, { label: 'Product Main Definition', value: pmd }] });
  const three = layout.expandGalleries([{ layout: 'gallery', title: 'G', items: [lic(1, 'Uzun Kollu Tshirt'), lic(2, 'T-Shirt'), lic(3, 'T-Shirt'), lic(4, 'T-Shirt'), lic(5, 'Takım'), lic(6, 'Takım')] }],
    layout.normalizeLayout('pptx', { columns: 3, rows: 1, groupBy: ['Buying Group', 'Product Main Definition'] }), {});
  assert.deepEqual(three.map(entry => entry.page.labels.map(label => label.text).join(',') || entry.page.title), ['Uzun Kollu Tshirt,Takım', 'LİSANS · T-Shirt']);
  // Uzun alt grup adı tek kart genişliğinde tek satırda kalır: önce küçülür, sonra "…".
  const fit = layout.fitLabel('Uzun Kollu Tshirt · Single Jersey · 20/1 · 200 gsm · 100% Cotton', 150, 12);
  assert.ok(fit.size >= 6.5 && fit.size < 12, 'yazı küçülür');
  assert.ok(fit.text.endsWith('…') && fit.text.length * fit.size * 0.58 <= 150 + fit.size, 'sığmayan kısım kısalır');
  assert.deepEqual(layout.fitLabel('Takım', 150, 12), { text: 'Takım', size: 12 }, 'kısa ad aynen');
  const blank = layout.expandGalleries(deckSlides(), { ...l, groupBy: ['Kategori'] }, { english: true });
  assert.ok(blank.some(entry => entry.page && entry.page.labels.some(label => label.text === 'Not specified')), 'değeri olmayan model "Not specified"');
  const none = layout.expandGalleries(deckSlides(), layout.applyPreset('pptx', 'catalog', null), {});
  assert.equal(none.filter(entry => entry.slide && entry.slide.layout === 'section').length, 2, 'gruplama yoksa LCW AI düzeni aynen');
});

test('sayfa başlığı: alanlardan / elle {Alan}; değer yoksa otomatik; devam slaytı (i/n)', () => {
  const base = { ...layout.applyPreset('pptx', 'catalog', null), groupBy: ['Kategori', 'Kumaş'] };
  const titles = spec => layout.expandGalleries(deckSlides(), layout.normalizeLayout('pptx', { ...base, pageTitle: spec }), {}).filter(entry => entry.page).map(entry => entry.page.title);
  // Kategori sayfa seviyesidir; Kumaş grupları aynı slaytta yan yana → başlıkta "A / B".
  assert.deepEqual(titles({ mode: 'manual', text: '{Kategori} – {Kumaş} – Yaz 27' }).slice(0, 2), ['Tişört – SJ 30/1 / SJ 20/1 – Yaz 27', 'Şort – SJ 20/1 – Yaz 27']);
  assert.deepEqual(titles({ mode: 'fields', fields: ['Kategori', 'Fit'] }).slice(0, 2), ['Tişört · Regular', 'Şort · Regular']);
  assert.ok(titles({ mode: 'manual', text: '{Yok}' }).every(title => !/Yok|^\s*$/.test(title)), 'hiç değer yoksa otomatik başlık');
  const mixed = layout.expandGalleries(deckSlides(), layout.normalizeLayout('pptx', { ...layout.applyPreset('pptx', 'catalog', null), pageTitle: { mode: 'fields', fields: ['Kategori'] } }), {}).find(entry => entry.page).page.title;
  assert.equal(mixed, 'Tişört / Şort', 'sayfada birden çok değer');
  const many = [{ layout: 'gallery', title: 'G', items: Array.from({ length: 20 }, (_, i) => model(i + 1, 'Tişört', 'SJ', 'P')) }];
  const long = layout.expandGalleries(many, layout.normalizeLayout('pptx', { ...layout.applyPreset('pptx', 'catalog', null), pageTitle: { mode: 'fields', fields: ['Kategori'] } }), {});
  assert.deepEqual(long.map(entry => entry.page.title), ['Tişört (1/2)', 'Tişört (2/2)']);
});

test('PowerPoint dosyası: gruplama ve elle başlık dosyaya yansır (kaynak değeri kaçışlı)', () => {
  const deck = contracts.normalizePresentation({ title: 'K', slides: deckSlides().slice(1) }).data;
  deck.layout = layout.normalizeLayout('pptx', { groupBy: ['Kategori', 'Baskı'], pageTitle: { mode: 'manual', text: '{Kategori} & sezon' } });
  assert.equal(expandSlides(deck.slides, deck.layout).filter(slide => slide.layout === 'section').length, 0);
  const records = { 'KOL-9': [['Kategori', '<Şort>'], ['Baskı', 'Artwork']] };
  const files = unzip(renderPresentation(deck, { lang: 'tr', records }));
  const xml = Object.keys(files).filter(name => /^ppt\/slides\/slide\d+\.xml$/.test(name)).map(name => files[name]).join('');
  assert.match(xml, /<a:t>Tişört &amp; sezon<\/a:t>/);
  assert.match(xml, /<a:t>&lt;Şort&gt; &amp; sezon<\/a:t>/);
  assert.match(xml, /<a:t>Pigment 2x<\/a:t>/, 'son seviye grup adı');
});

test('PDF/HTML: aynı gruplama bölüm + yan yana gruplar; başlık+galeri bölümü kalkar, diğer içerik kalır; kaçış', () => {
  const card = (n, category, print) => `<div class="bl-card"><img class="bl-model-img" data-bl-image="KOL-${n}" alt="m"><h3>M${n}</h3><dl class="bl-specs"><div><dt>Kategori</dt><dd>${category}</dd></div><div><dt>Baskı</dt><dd>${print}</dd></div></dl></div>`;
  const body = `<h1>R</h1><p class="bl-lead">Giriş</p><section class="bl-section"><h2>Single Jersey</h2><div class="bl-groups"><section class="bl-group"><h3 class="bl-group-title">A</h3><div class="bl-gallery">${card(1, 'Tişört', 'Pigment')}${card(2, 'Şort', 'Pigment')}</div></section></div></section><h2>Diğer modeller</h2><div class="bl-gallery">${card(3, 'Tişört', 'No Print')}${card(4, '', '')}</div><section class="bl-section"><h2>Özet</h2><p>Sonuç metni</p></section>`;
  const l = layout.normalizeLayout('pdf', { groupBy: ['Kategori', 'Baskı'] });
  const out = layout.regroupReport(body, l, { 'KOL-4': [['Kategori', '<Şort>'], ['Baskı', 'Art']] }, false);
  const sections = [...out.matchAll(/<section class="bl-section bl-regrouped"><h2>([^<]*)<\/h2>/g)].map(match => match[1]);
  assert.deepEqual(sections, ['Tişört', 'Şort', '&lt;Şort&gt;'], 'kaynak değeri kaçışlı; dl’de değer boşsa kaynak satır');
  assert.match(out, /<h3 class="bl-group-title">Pigment<\/h3>[\s\S]*<h3 class="bl-group-title">No Print<\/h3>/);
  assert.doesNotMatch(out, /Single Jersey|Diğer modeller/, 'eski galeri başlıkları kalkar');
  assert.match(out, /<p class="bl-lead">Giriş<\/p>[\s\S]*<h2>Özet<\/h2><p>Sonuç metni<\/p>/, 'diğer içerik korunur');
  assert.equal((out.match(/class="bl-card"/g) || []).length, 4, 'kart kaybolmaz');
  const prepared = layout.prepareReport(body, l, { pages: true, records: {} });
  assert.match(prepared, /class="bl-group bl-span-\d"/, 'gruplar yan yana süslenir');
  const titled = layout.reportTitles(body, layout.normalizeLayout('pdf', { pageTitle: { mode: 'fields', fields: ['Kategori'] } }), null);
  assert.match(titled, /<h2>Tişört \/ Şort<\/h2>[\s\S]*<h2>Tişört<\/h2>/, 'gruplama yokken başlık yeniden yazılır');
});

test('şablon ve arayüz: gruplama/başlık alanları LCW AI talimatına girer; Yerleşim kontrolleri TR/EN', () => {
  const def = userTemplates.normalizeDefinition({ format: 'pptx', layout: { groupBy: ['Kategori', 'Kumaş'], pageTitle: { mode: 'manual', text: '{Sezon} · {Kategori}' }, cardFields: ['Fit'] } });
  assert.deepEqual(def.layout.groupBy, ['Kategori', 'Kumaş']);
  assert.match(userTemplates.templateInstruction(def, { name: 'X', lang: 'tr' }), /Model kartı bilgileri: .*Fit, Kategori, Kumaş, Sezon/);
  const editor = fs.readFileSync(path.join(ROOT, 'public', 'lcwai-output-editor.js'), 'utf8');
  assert.match(editor, /data-lay-group="\$\{i\}"/);
  assert.match(editor, /data-lay-group-break/);
  assert.match(editor, /groupBreak: Number\(el\.value\)/);
  assert.match(editor, /data-lay-title-mode="\$\{value\}"/);
  assert.match(editor, /data-lay-title-text/);
  assert.match(editor, /data-lay-title-insert=/);
  assert.match(editor, /LAY\(\)\.expandGalleries\(slides, l, \{ english: isEn\(\), records:/, 'önizleme gruplamada kaynak satırları kullanır');
  for (const text of ["L('Gruplama', 'Grouping')", "L('1. grup', '1st group')", "L('3. grup', '3rd group')", "L('Elle yaz', 'Type it')", "L('Alanlardan', 'From fields')", "L('Slayt başlığı', 'Slide title')", "L('Bölüm başlığı', 'Section title')", "L('Yeni slayt', 'New slide')", "L('Yok — tüm gruplar yan yana', 'None — all groups side by side')"]) assert.ok(editor.includes(text), text);
});
