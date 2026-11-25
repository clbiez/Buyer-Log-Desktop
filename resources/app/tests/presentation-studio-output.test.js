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
