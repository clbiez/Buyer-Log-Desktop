'use strict';

/*
 * LCW AI model KATALOĞU (kart verisi, gruplama, sayfalama).
 *
 * Korunan davranışlar (gerçek bir kullanıcı raporunda görülen sorunlar):
 *  - Kart satırları ve durum etiketi KAYBOLMAZ, kumaş gibi uzun değerler
 *    kısaltılmaz (önceden yalnız alt bilgi + not alınıyordu, 80/140 karakter).
 *  - LCW AI'ın başlıklarla (Ana kategori / Alt kategori) ayrı galerilere
 *    böldüğü modeller tek katalogda gruplanır; başka içerik yerinde kalır.
 *  - Bağlam verisinin bir sütunu başlıklarla örtüşüyorsa gruplama o sütuna
 *    bağlanır (temiz, tam grup adı).
 *  - Az modelli gruplar boş sayfa üretmez (auto: sığan grup aynı sayfada);
 *    sayfada birden çok bölüm varsa ara başlık şeritleri çizilir.
 *  - Kart yazısı kutuya sığdırılır; okunurluk için önce görsel daralır.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'server', 'lib', 'lcwai-output');
const layout = require(path.join(ROOT, 'public', 'lcwai-output-layout'));
const contracts = require(path.join(OUT, 'output-contracts'));
const catalog = require(path.join(OUT, 'output-catalog'));
const { previewPresentation } = require(path.join(OUT, 'output-pptx'));
const fx = require('./fixtures/lcwai-catalog-grouped-report');

test('kart: tüm satırlar, durum etiketi ve ton korunur; uzun değer kısaltılmaz', () => {
  const long = `Kumaş: ${'Süprem,150 gsm,30/1 '.repeat(12)}`.trim();
  const card = catalog.cardOf(`<div class="bl-card warn"><img class="bl-model-img" data-bl-image="KOL-7" alt="M"><h3>DEMO-7-YD</h3><p>R9J · ECRU</p><small>S7DEMO7</small><p>${long}</p><div>PLM ID: 1 · Adet: 10<br>Not: lab dip</div><span class="bl-badge risk">Pending File</span></div>`);
  assert.equal(card.title, 'DEMO-7-YD');
  assert.equal(card.image, 'KOL-7');
  assert.equal(card.tone, 'warn');
  assert.deepEqual(card.badge, { text: 'Pending File', tone: 'risk' });
  assert.deepEqual(card.lines, ['R9J · ECRU', 'S7DEMO7', long, 'PLM ID: 1 · Adet: 10', 'Not: lab dip']);
  assert.ok(long.length > 200);
  // Eski biçim (subtitle / note) satırlara çevrilir; gruplama alanı eşlenir.
  const legacy = layout.normalizeItem({ title: 'A', subtitle: 'Süprem', note: 'Not' });
  assert.deepEqual(legacy.lines, ['Süprem', 'Not']);
  assert.equal(layout.fieldValue(legacy, 'f:subtitle'), 'Süprem');
  assert.equal(layout.fieldValue(card, 'f:badge'), 'Pending File');
});

test('çıkarım: AI’ın başlıklarla böldüğü galeriler gruplu kataloğa; diğer içerik yerinde', () => {
  const r = contracts.normalizeHtmlDraft({ body: fx.body });
  assert.equal(r.ok, true);
  const body = r.data.body;
  assert.equal(r.data.galleries.length, 2, 'not paragrafı iki katalog arasını ayırır');
  const all = r.data.galleries.flatMap(g => g.items);
  assert.equal(all.length, 15, 'galerideki tüm kartlar');
  assert.ok(all.every(item => item.lines.length === 2 && item.badge), 'satırlar ve durum korunur');
  assert.deepEqual([...new Set(r.data.galleries[1].items.map(item => item.subgroup))], ['Atlet', 'T-Shirt', 'Şort']);
  assert.equal(r.data.galleries[0].items[0].subgroup, 'T-Shirt', '"· 9 model kartı · tüm modeller bu sayfada" atılır');
  assert.equal(r.data.galleries[0].items[0].group, fx.FABRIC_A, '"Ana kategori —" atılır, kumaş tam kalır');
  // Gruplama başlıkları ve galeriler gövdeden çıkar; KPI, not, uyarı ve galeri dışı kart kalır.
  assert.doesNotMatch(body, /Ana kategori — Kumaş: 1001|Alt kategori — Atlet|bl-gallery/);
  assert.match(body, /bl-kpis/);
  assert.match(body, /Kaynak: demo\.csv/);
  assert.match(body, /Kumaş alanı boş/);
  assert.match(body, /DEMO\.SHORT/);
  assert.equal((body.match(/data-bl-catalog="\d"/g) || []).length, 2);
  assert.doesNotMatch(body, /<div class="bl-grid">\s*<div class="bl-catalog"/, 'iki sütunlu sarmalayıcıdan çıkarılır');
  // LCW AI'ın yazdığı grup öznitelikleri başlıklardan önceliklidir.
  const tagged = contracts.normalizeHtmlDraft({ body: '<h1>R</h1><div class="bl-gallery" data-bl-group="Örme" data-bl-subgroup="T-Shirt"><div class="bl-card"><h3>A</h3></div></div><div class="bl-gallery" data-bl-group="Dokuma"><div class="bl-card"><h3>B</h3></div></div>' }).data;
  assert.equal(tagged.galleries.length, 1, 'ardışık galeriler tek katalog');
  assert.deepEqual(tagged.galleries[0].items.map(item => [item.group, item.subgroup]), [['Örme', 'T-Shirt'], ['Dokuma', '']]);
});

test('veriden gruplama: başlıklarla örtüşen sütun bulunur, adlar veriyle aynı olur', () => {
  const r = contracts.normalizeHtmlDraft({ body: fx.body });
  const refined = catalog.refineGrouping(r.data.galleries[1], fx.attributes);
  assert.equal(refined.catalog.by, 'a:Fabric');
  assert.equal(refined.catalog.then, 'a:Product Main Definition');
  assert.equal(refined.items[0].group, fx.FABRIC_A.replace(/^Kumaş: /, ''));
  assert.equal(refined.items[0].subgroup, 'Atlet');
  // Sütun yoksa ya da örtüşmüyorsa dokunulmaz.
  assert.equal(catalog.refineGrouping(r.data.galleries[1], {}).catalog.by, '');
});

test('sayfalama: yeni sayfa kuralı (auto / group / subgroup), şeritler, devam parçaları', () => {
  const l = layout.normalizeLayout('pdf', { columns: 3, rows: 3 });
  const items = [
    ...Array.from({ length: 9 }, (_, i) => ({ title: `A${i}`, group: 'G1', subgroup: 'T-Shirt' })),
    ...Array.from({ length: 2 }, (_, i) => ({ title: `B${i}`, group: 'G2', subgroup: 'Atlet' })),
    { title: 'C', group: 'G3', subgroup: 'T-Shirt' },
    ...Array.from({ length: 4 }, (_, i) => ({ title: `D${i}`, group: 'G4', subgroup: 'Şort' })),
  ];
  const shape = mode => layout.catalogPages(items, { pageBreak: mode }, l, { strip: 0.15 }).map(page => page.sections.map(sec => `${sec.group}/${sec.subgroup}:${sec.entries.length}`).join('+'));
  assert.deepEqual(shape('auto'), ['G1/T-Shirt:9', 'G2/Atlet:2+G3/T-Shirt:1', 'G4/Şort:4'], 'küçük gruplar aynı sayfada');
  assert.deepEqual(shape('group'), ['G1/T-Shirt:9', 'G2/Atlet:2', 'G3/T-Shirt:1', 'G4/Şort:4']);
  assert.equal(layout.normalizeCatalog({}).pageBreak, 'auto');
  const mixed = layout.catalogPages(items, {}, l, { strip: 0.15 })[1];
  assert.equal(mixed.group, '', 'karışık sayfada başlık bloğu boş; adlar şeritte');
  const slots = layout.catalogSlots(mixed, { x: 0, y: 0, w: 900, h: 600 }, l, () => 20);
  assert.deepEqual(slots.strips.map(s => `${s.kind}:${s.text}`), ['group:G2', 'subgroup:Atlet', 'group:G3', 'subgroup:T-Shirt']);
  assert.ok(Math.max(...slots.cards.map(c => c.y + c.h)) <= 600 + 1e-6, 'model alanı içinde');
  // Devam: alt grup birden çok sayfaya taşarsa (1/2), (2/2).
  const many = layout.catalogPages(Array.from({ length: 11 }, (_, i) => ({ title: `M${i}`, group: 'G', subgroup: 'S' })), {}, l);
  assert.deepEqual(many.map(page => [page.subgroup, page.part, page.parts]), [['S', 1, 2], ['S', 2, 2]]);
  // Boş grup/alt başlık bloğu düşer, model alanı yukarı uzar.
  const blocks = layout.pageBlocks(l.page, { title: 'T', group: '', subgroup: '' });
  const models = blocks.find(block => block.kind === 'models');
  assert.equal(models.y, 1);
  assert.ok(!blocks.some(block => block.kind === 'group'));
});

test('sığdırma: kart yazısı küçülmeden önce görsel daralır; başlık metni kutuya sığar', () => {
  const l = layout.normalizeLayout('pdf', { cardTextSize: 12, imageShare: 70 });
  const item = layout.normalizeItem({ title: 'DEMO-1-YD', lines: ['R9J · ECRU · S7DEMO1', 'PLM ID: 2120001 · Adet: 1000'], badge: 'Sipariş Geçildi' });
  const fit = layout.cardFit({ w: 220, h: 230 }, l, [item]);
  assert.equal(fit.fits, true);
  assert.ok(fit.size >= 9.5, `okunur yazı (${fit.size})`);
  assert.ok(fit.imageH >= (230 - 2 * fit.pad - 4) * 0.4 - 1e-6, 'görsel en az %40');
  const crowded = layout.cardFit({ w: 90, h: 70 }, l, [{ ...item, lines: Array(8).fill('Çok uzun bir bilgi satırı burada yer alıyor') }]);
  assert.equal(crowded.fits, false, 'sığmayan kart işaretlenir');
  const head = layout.fitText(fx.FABRIC_A, 600, 40, 22, { min: 7, lineHeight: 1.15, charEm: layout.CHAR_EM.head });
  assert.ok(head.fits && head.size < 22 && head.size >= 10, `uzun grup adı küçülür ama okunur kalır (${head.size})`);
});

test('PDF katalog sayfaları: tam sayfa kutusu, satır yükseklikleri alana sığar, şerit ve rozet', () => {
  const r = contracts.normalizeHtmlDraft({ body: fx.body });
  const gallery = catalog.refineGrouping(r.data.galleries[1], fx.attributes);
  const pages = catalog.catalogPagesHtml(gallery, { columns: 3, rows: 3 }, { lang: 'tr', orientation: 'landscape', fallbackTitle: 'Rapor' });
  assert.ok(pages.length >= 1 && pages.length <= 2, `az modelli gruplar sayfa israf etmez (${pages.length})`);
  const html = pages.map(page => page.html).join('');
  assert.match(html, /class="bl-strip is-group"/);
  assert.match(html, /<span class="bl-badge (ok|warn|risk)">/);
  assert.match(html, /PLM ID: 2120010 · Adet: 10000/);
  assert.ok(pages.every(page => page.fits));
  for (const page of pages) {
    const rows = /grid-template-rows:([^;]+);/.exec(page.html)[1].trim().split(/\s+/).map(parseFloat);
    const gap = layout.normalizeLayout('pdf', {}).gap;
    const box = layout.pageBox(layout.normalizeLayout('pdf', {}), 'landscape');
    assert.ok(rows.reduce((a, b) => a + b, 0) + gap * (rows.length - 1) <= box.height * 96 / 25.4, 'model satırları sayfa kutusunu aşmaz');
  }
});

test('PowerPoint: kart satırları ve rozet tam; ardışık gallery slaytları gruplu tek katalog', () => {
  const answer = JSON.stringify({ title: 'Katalog', slides: [
    { layout: 'gallery', title: 'Örme', items: [{ title: 'A', lines: ['R9J · ECRU', `Kumaş: ${'uzun '.repeat(40)}`.trim()], badge: 'Sipariş Geçildi', tone: 'ok' }] },
    { layout: 'gallery', title: 'Dokuma', items: [{ title: 'B', subtitle: 'Poplin', note: 'Not' }] },
  ] });
  const parsed = contracts.parseOutput('pptx', answer, { lang: 'tr' });
  const galleries = parsed.data.slides.filter(slide => slide.layout === 'gallery');
  assert.equal(galleries.length, 1, 'ardışık galeriler birleşir');
  assert.deepEqual(galleries[0].items.map(item => item.group), ['Örme', 'Dokuma']);
  assert.ok(galleries[0].items[0].lines[1].length > 150, 'satır kısaltılmaz');
  const scene = previewPresentation(parsed.data, { lang: 'tr' });
  const texts = scene.slides.flatMap(slide => slide.scene.items.flatMap(item => (item.paragraphs || []).map(par => par.text)));
  assert.ok(texts.includes('Sipariş Geçildi'), 'durum rozeti çizilir');
  assert.ok(texts.includes('R9J · ECRU'));
  assert.ok(texts.includes('Poplin') && texts.includes('Not'));
});

test('sözleşme: LCW AI’a grup öznitelikleri ve tam değer kuralı anlatılır; bağlam değeri 400 karaktere kadar', () => {
  const source = require('node:fs').readFileSync(path.join(OUT, 'output-contracts.js'), 'utf8');
  assert.match(source, /data-bl-group="grup değeri" data-bl-subgroup="alt grup değeri"/);
  assert.match(source, /data-bl-group="group value" data-bl-subgroup="subgroup value"/);
  assert.match(source, /kumaş ve diğer ayrıntıları asla kısaltma/);
  assert.match(source, /"lines":\["her satırda bir değer, tam"\]/);
  const service = require('node:fs').readFileSync(path.join(OUT, 'output-service.js'), 'utf8');
  assert.match(service, /\.slice\(0, 400\);/);
  const chat = require('node:fs').readFileSync(path.join(ROOT, 'public', 'lcwai-chat.js'), 'utf8');
  assert.match(chat, /row\[index \+ 1\]\)\.slice\(0, 400\)/);
  // Temizleyici yalnız <div> üzerinde grup özniteliğine izin verir.
  const { sanitizeHtml } = require(path.join(OUT, 'output-html'));
  assert.match(sanitizeHtml('<div class="bl-gallery" data-bl-group="A&quot;B" onclick="x"></div>').body, /data-bl-group="A&quot;B"/);
  assert.doesNotMatch(sanitizeHtml('<span data-bl-group="A"></span>').body, /data-bl-group/);
});
