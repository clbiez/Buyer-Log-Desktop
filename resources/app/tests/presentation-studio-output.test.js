'use strict';
// Presentation Studio çıktıları: önizleme/PDF HTML'i ve PPTX aynı çizim
// listesinden üretilir; konum, sayfa ölçüsü ve kısaltılmış metin birebir aynıdır.
const test = require('node:test'), assert = require('node:assert/strict');
const E = require('../public/presentation-studio-engine.js');
const R = require('../public/presentation-studio-render.js');
const P = require('../public/presentation-studio-pptx.js');
const JSZip = require('../public/vendor/jszip.min.js');
const PALETTE = require('../public/export-document-palette.json');

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';
function fixture(page = { preset: 'A4', orient: 'landscape' }) {
  const ids = Array.from({ length: 18 }, (_, i) => 'K' + i);
  const doc = E.createDoc({ ids, fields: ['modelName', 'colour', 'fob'], levels: ['productGroup'] });
  doc.page = page;
  doc.style.labels = true;
  doc.cards.K3 = { pinned: true, page: 'p1', x: 40, y: 300, w: 150, h: 220 };
  const groupOf = id => { const v = Number(id.slice(1)) % 2 ? 'Hırka' : 'Kazak'; return { key: v, vals: [v] }; };
  const res = E.layout(doc, groupOf);
  const src = {
    lines: id => [{ label: 'Model Adı', value: id === 'K1' ? 'Çok uzun bir model adı '.repeat(6) : 'Model ' + id }, { label: 'Renk', value: 'Lacivert' }, { label: 'FOB', value: '' }],
    image: id => (id === 'K2' ? null : { src: PNG, w: 600, h: 800 }),
    header: it => ({ main: it.vals[0], rest: '', count: `${it.count} model` }),
  };
  return { doc, res, list: R.build(doc, res, src) };
}

test('belge renkleri ekran temasından bağımsız, LCW belge paletinden gelir', () => {
  assert.equal(R.DOC.ink, PALETTE.ink); assert.equal(R.DOC.ink2, PALETTE.ink2); assert.equal(R.DOC.muted, PALETTE.muted);
  assert.equal(R.DOC.line, PALETTE.line); assert.equal(R.DOC.rule, PALETTE.line2); assert.equal(R.DOC.image, PALETTE.card2);
});

test('metin satırları kart genişliğine kısaltılır; boş değer çizgiyle gösterilir', () => {
  const { list } = fixture();
  const cards = list.pages.flatMap(p => p.elements).filter(e => e.type === 'card');
  const long = cards.find(c => c.id === 'K1');
  const width = runs => runs.reduce((s, r) => s + R.approxMeasure(r.t, r.size, r.bold), 0);
  assert.ok(long.lines[0].runs[0].t.endsWith('…'));
  for (const c of cards) for (const l of c.lines) assert.ok(width(l.runs) <= l.w + 0.01, c.id);
  assert.equal(cards.find(c => c.id === 'K0').lines[2].runs.at(-1).t, '—');
  assert.equal(cards.find(c => c.id === 'K2').image, null, 'görseli olmayan kart yer tutucu alanı korur');
  const img = cards.find(c => c.id === 'K0').image;
  assert.ok(Math.abs(img.w / img.h - 0.75) < 0.001, 'görsel oranı korunur (contain)');
});

test('PDF belgesi sayfa ölçüsünü @page ile taşır; editörle aynı öğe HTML\'ini kullanır', () => {
  const { list } = fixture({ preset: 'A3', orient: 'portrait' });
  const html = R.documentHtml(list, 'Deneme <x>');
  const size = E.pageSize({ preset: 'A3', orient: 'portrait' });
  assert.match(html, new RegExp(`@page\\{size:${Math.round(size.w * 100) / 100}pt ${Math.round(size.h * 100) / 100}pt;margin:0\\}`));
  assert.equal((html.match(/<section /g) || []).length, list.pages.length);
  assert.ok(html.includes(R.elementsHtml(list.pages[0])), 'PDF sayfası editör öğe HTML\'inin aynısıdır');
  assert.doesNotMatch(html, /<script/i);
  assert.ok(html.includes('Deneme &lt;x&gt;'));
});

test('PPTX: slayt ölçüsü, kart konumları ve satırlar çizim listesiyle birebir aynıdır', async () => {
  for (const page of [{ preset: 'A4', orient: 'landscape' }, { preset: '16:9', orient: 'landscape' }, { preset: 'square', orient: 'portrait' }, { preset: 'custom', cw: 400, ch: 250 }]) {
    const { list } = fixture(page);
    const zip = P.build(JSZip, list, { title: 'Sunum & Test', palette: R.DOC, titles: { K0: 'Model K0' } });
    const buffer = await zip.generateAsync({ type: 'nodebuffer' });
    const pptx = await JSZip.loadAsync(buffer);
    const pres = await pptx.file('ppt/presentation.xml').async('string');
    const size = E.pageSize(page);
    assert.match(pres, new RegExp(`<p:sldSz cx="${Math.round(size.w * P.EMU)}" cy="${Math.round(size.h * P.EMU)}"/>`));
    assert.equal(Object.keys(pptx.files).filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n)).length, list.pages.length);
    const slide = await pptx.file('ppt/slides/slide1.xml').async('string');
    for (const el of list.pages[0].elements.filter(e => e.type === 'card')) {
      assert.ok(slide.includes(`<a:off x="${Math.round(el.x * P.EMU)}" y="${Math.round(el.y * P.EMU)}"/><a:ext cx="${Math.round(el.w * P.EMU)}" cy="${Math.round(el.h * P.EMU)}"/><a:chOff`), `kart grubu ${el.id}`);
      for (const l of el.lines) for (const r of l.runs) assert.ok(slide.includes(`<a:t>${r.t.replace(/&/g, '&amp;')}</a:t>`), r.t);
    }
    assert.match(slide, /wrap="none"/, 'PowerPoint satır kırmaz; satırlar önceden hesaplanmıştır');
    const rels = await pptx.file('ppt/slides/_rels/slide1.xml.rels').async('string');
    assert.match(rels, /media\/image1\.png/);
    assert.equal(Object.keys(pptx.files).filter(n => n.startsWith('ppt/media/') && !pptx.files[n].dir).length, 1, 'aynı görsel bir kez gömülür');
    for (const [name, file] of Object.entries(pptx.files)) if (name.endsWith('.xml') || name.endsWith('.rels')) {
      const text = await file.async('string');
      assert.equal((text.match(/</g) || []).length, (text.match(/>/g) || []).length, `${name} etiket dengesi`);
    }
  }
});

test('belge HTML\'inde yazı tipi style özniteliğini bozmaz (PDF serif düşmesi regresyonu)', () => {
  const { list } = fixture();
  for (const font of E.FONTS) {
    const html = R.documentHtml({ ...list, font }, 'x');
    const style = /<section style="([^"]*)"/.exec(html)[1];
    assert.ok(style.includes(`font-family:'${font}',Arial,sans-serif;`), font);
    assert.ok(style.endsWith('page-break-after:always'), 'öznitelik tırnakla erken kapanmaz');
  }
});

test('uzun metin satırlara kırılır; yalnız üst sınır aşılırsa "…" eklenir', () => {
  const m = R.approxMeasure, runs = [{ t: 'Three Thread Brushed · 30/70/14 · 260 gsm · 65% Cotton 35% Poliester', size: 7, bold: false }];
  const one = R.wrapRuns(runs, 1000, m, 'Arial', 3); assert.equal(one.length, 1); assert.equal(one[0][0].t, runs[0].t);
  const three = R.wrapRuns(runs, 60, m, 'Arial', 3);
  assert.equal(three.length, 3);
  const joined = three.map(l => l.map(r => r.t).join('')).join(' ').replace(/\s+/g, ' ');
  for (const l of three) assert.ok(l.reduce((s, r) => s + m(r.t, r.size, r.bold), 0) <= 60 + 0.01);
  const all = R.wrapRuns(runs, 60, m, 'Arial', 10);
  assert.ok(all.length > 3 && !all.flat().some(r => r.t.includes('…')), 'sınır yoksa metin tam');
  assert.equal(all.map(l => l.map(r => r.t).join('')).join(' ').replace(/\s+/g, ' ').trim(), runs[0].t.replace(/\s+/g, ' '));
  assert.ok(three.at(-1).at(-1).t.endsWith('…') && joined.startsWith('Three Thread Brushed'));
  // Biçim (kalın başlık + normal devam) satırlar boyunca korunur.
  const mixed = R.wrapRuns([{ t: 'Uzun Kumaş Adı', size: 9, bold: true }, { t: ' · Örme · Pamuk', size: 9, bold: false }], 60, m, 'Arial', 5);
  assert.ok(mixed.flat().some(r => r.bold) && mixed.flat().some(r => !r.bold));
  // Boşluksuz uzun parça karakter düzeyinde bölünür.
  assert.ok(R.wrapRuns([{ t: 'X'.repeat(80), size: 7 }], 60, m, 'Arial', 6).every(l => l.reduce((s, r) => s + m(r.t, r.size, r.bold), 0) <= 60.01));
});

test('metin planı: kartta tam metin, alanlar kartlar arasında hizalı; başlık tam görünür; PDF ve PPTX aynı satırlar', async () => {
  const ids = Array.from({ length: 8 }, (_, i) => 'K' + i);
  const doc = E.createDoc({ ids, fields: ['modelName', 'fabric', 'price'], levels: ['fabric'] });
  doc.style.cardW = 160;
  const longFabric = 'Three Thread Brushed · 30/70/14 · 260 gsm · 65% Cotton 35% Poliester';
  const fab = id => (Number(id.slice(1)) < 2 ? longFabric : 'Pamuk');
  const groupOf = id => ({ key: fab(id), vals: [fab(id)] });
  const src = {
    lines: id => [{ label: 'Model', value: 'Model ' + id }, { label: 'Kumaş', value: fab(id) }, { label: 'Fiyat', value: '' }],
    image: () => ({ src: PNG, w: 600, h: 800 }),
    header: it => ({ main: it.vals[0], rest: '', count: `${it.count} model` }),
  };
  const cellW = E.geometry(doc, null).cellW, plan = R.textPlan(doc, cellW, ids, src);
  // Dar kartta üst sınır korunur.
  const narrow = JSON.parse(JSON.stringify(doc)); narrow.style.cardW = 60;
  assert.equal(R.textPlan(narrow, E.geometry(narrow, null).cellW, ids, src).fieldLines[1], R.MAX_LINES.field);
  assert.equal(plan.fieldLines[0], 1); assert.ok(plan.fieldLines[1] >= 2 && plan.fieldLines[1] <= R.MAX_LINES.field); assert.equal(plan.fieldLines[2], 1);
  const res = E.layout(doc, groupOf, plan), list = R.build(doc, res, src);
  const cards = list.pages.flatMap(p => p.elements).filter(e => e.type === 'card');
  const longCard = cards.find(c => c.id === 'K0'), shortCard = cards.find(c => c.id === 'K5');
  const text = c => c.lines.map(l => l.runs.map(r => r.t).join('')).join(' ');
  assert.ok(!text(longCard).includes('…'), 'uzun kumaş adı kırpılmaz: ' + text(longCard));
  assert.ok(text(longCard).replace(/\s+/g, ' ').includes(longFabric.replace(/\s+/g, ' ')));
  // Fiyat satırı her kartta aynı yükseklikte (alan hizası).
  const priceY = c => c.lines.find(l => l.runs.at(-1).t === '—').y - c.y;
  assert.ok(Math.abs(priceY(longCard) - priceY(shortCard)) < 0.01);
  for (const c of cards) for (const l of c.lines) assert.ok(l.y + l.lh <= c.y + c.h + 0.5);
  // Dar (1-2 kartlık) grup başlığı tam metinle çok satıra kırılır.
  const hdr = list.pages.flatMap(p => p.elements).find(e => e.type === 'hdr' && e.key === longFabric);
  assert.ok(hdr.lines.length >= 2);
  assert.equal(hdr.lines.map(l => l.runs.map(r => r.t).join('')).join(' ').replace(/\s+/g, ' ').trim(), longFabric.replace(/\s+/g, ' '));
  for (const l of hdr.lines) assert.ok(l.y >= hdr.y - 0.01 && l.y + hdr.lh <= hdr.rule.y + 0.01);
  // PDF HTML ve PPTX aynı başlık satırlarını taşır.
  const html = R.documentHtml(list, 'Test');
  for (const l of hdr.lines) for (const r of l.runs) assert.ok(html.includes(`>${r.t.replace(/&/g, '&amp;')}</span>`), r.t);
  const zip = await JSZip.loadAsync(await P.build(JSZip, list, { title: 'Test', palette: R.DOC }).generateAsync({ type: 'nodebuffer' }));
  const slides = (await Promise.all(Object.keys(zip.files).filter(f => /^ppt\/slides\/slide\d+\.xml$/.test(f)).map(f => zip.file(f).async('string')))).join('');
  for (const l of hdr.lines) for (const r of l.runs) assert.ok(slides.includes(`<a:t>${r.t.replace(/&/g, '&amp;')}</a:t>`), 'pptx ' + r.t);
});

test('dar başlıkta model sayısı gizlenir, metin tam genişlikte kırılır (kelime ortasından bölünmez)', async () => {
  const ids = ['K0', 'K1'];
  const doc = E.createDoc({ ids, fields: ['modelName'], levels: ['fabric'] });
  doc.cards.K0 = { pinned: true, page: 'p1', x: 300, y: 300, w: 80, h: 150 };
  const label = 'Three Thread Brushed Cotton';
  const groupOf = id => ({ key: id, vals: [id === 'K0' ? label : 'Pamuk'] });
  const src = { lines: id => [{ label: 'Model', value: id }], image: () => null, header: it => ({ main: it.vals[0], rest: '', count: `${it.count} model` }) };
  const plan = R.textPlan(doc, E.geometry(doc, null).cellW, ids, src);
  const res = E.layout(doc, groupOf, plan), list = R.build(doc, res, src);
  const hdr = list.pages[0].elements.find(e => e.type === 'hdr' && e.key === 'K0');
  assert.equal(hdr.count, null, 'sayı gizli');
  const words = hdr.lines.map(l => l.runs.map(r => r.t).join('').trim());
  for (const w of words) for (const part of w.split(/\s+/)) assert.ok(label.split(' ').includes(part), 'kelime bölünmedi: ' + words);
  assert.ok(!R.documentHtml(list, 't').includes('undefined'));
  const zip = P.build(JSZip, list, { title: 't', palette: R.DOC });
  assert.ok((await zip.generateAsync({ type: 'nodebuffer' })).length > 0);
});
