'use strict';
// Presentation Studio yerleşim motoru: sayfa ölçüsünden bağımsız geometri,
// sabit kartların korunması, çakışmasızlık ve kaynak verinin değişmemesi.
const test = require('node:test'), assert = require('node:assert/strict');
const E = require('../public/presentation-studio-engine.js');

const FABRICS = ['Merinos', 'Pamuk', 'Kaşmir', 'Viskon'], GROUPS = ['Kazak', 'Hırka', 'Yelek'];
function models(n) {
  const list = [];
  for (let i = 0; i < n; i++) list.push(Object.freeze({ id: 'R' + i, fabric: FABRICS[i % 4], productGroup: GROUPS[(i * 7) % 3] }));
  return Object.freeze(list);
}
function setup(n = 60, levels = ['fabric', 'productGroup']) {
  const data = models(n), byId = new Map(data.map(m => [m.id, m]));
  const doc = E.createDoc({ ids: data.map(m => m.id), fields: ['name', 'colour', 'price'], levels });
  const groupOf = id => { const m = byId.get(id), vals = doc.grouping.levels.map(f => m[f]); return { key: vals.join(E.SEP), vals }; };
  return { data, doc, groupOf };
}
function assertClean(res) {
  const g = res.g;
  for (const p of res.pages) {
    for (const it of p.items) assert.ok(it.x >= -0.01 && it.y >= -0.01 && it.x + it.w <= g.w + 0.01 && it.y + it.h <= g.h + 0.01, `${p.id} ${it.kind} sayfa dışında`);
    for (let i = 0; i < p.items.length; i++) for (let j = i + 1; j < p.items.length; j++) assert.equal(E.overlaps(p.items[i], p.items[j]), false, `${p.id}: ${p.items[i].id || 'hdr'} ↔ ${p.items[j].id || 'hdr'}`);
  }
}

test('her sayfa ölçüsü ve yönünde geometri sabit ölçüye bağlı değildir', () => {
  const a4 = E.pageSize({ preset: 'A4', orient: 'landscape' });
  assert.ok(Math.abs(a4.w - 841.89) < 0.1 && Math.abs(a4.h - 595.28) < 0.1);
  const a4p = E.pageSize({ preset: 'A4', orient: 'portrait' });
  assert.equal(Math.round(a4p.w), Math.round(a4.h));
  assert.equal(Math.round(E.pageSize({ preset: '16:9' }).w), 960);
  assert.equal(Math.round(E.pageSize({ preset: '4:3' }).h), 540);
  const sq = E.pageSize({ preset: 'square', orient: 'portrait' });
  assert.equal(Math.round(sq.w), Math.round(sq.h));
  const custom = E.pageSize({ preset: 'custom', cw: 400, ch: 250, orient: 'landscape' });
  assert.equal(Math.round(custom.mmW), 400);
  assert.equal(E.pageSize({ preset: 'custom', cw: 5, ch: 99999 }).mmW, 1200, 'özel ölçü sınırlanır');
  const cols = {};
  for (const preset of Object.keys(E.PAPERS).filter(k => k !== 'custom')) for (const orient of ['landscape', 'portrait']) {
    const { doc } = setup(1); doc.page = { preset, orient }; cols[preset + orient] = E.geometry(doc).cols;
  }
  assert.ok(cols.A3landscape > cols.A4landscape && cols.A4landscape > cols.A5landscape, JSON.stringify(cols));
});

test('tüm ölçü, yön ve iki yerleşim modunda kartlar eksiksiz ve çakışmasız yerleşir', () => {
  for (const preset of Object.keys(E.PAPERS)) for (const orient of ['landscape', 'portrait']) for (const keepGroups of [false, true]) {
    const { doc, groupOf } = setup(73);
    doc.page = { preset, orient, cw: 420, ch: 180 }; doc.style.keepGroups = keepGroups;
    const res = E.layout(doc, groupOf);
    assert.equal(res.index.size, 73, `${preset} ${orient} ${keepGroups}`);
    assert.equal(res.overflow, false);
    assertClean(res);
  }
});

test('sabit kartın konumu ve boyutu korunur; diğer kartlar çevresine akar', () => {
  const { doc, groupOf } = setup(40);
  doc.cards.R5 = { pinned: true, page: 'p1', x: 300, y: 200, w: 180, h: 240 };
  const res = E.layout(doc, groupOf);
  const pin = res.index.get('R5');
  assert.deepEqual([pin.x, pin.y, pin.w, pin.h, pin.page], [300, 200, 180, 240, 'p1']);
  assert.equal(res.index.size, 40);
  assertClean(res);
  const page1 = res.pages[0].items.filter(i => i.kind === 'card' && !i.pinned);
  assert.ok(page1.length > 0, 'sabit kartın olduğu sayfa otomatik akışa kapanmaz');
});

test('sayfa ölçüsü küçülünce sığmayan sabit kartlar bulunur; üç seçenek de çakışmasız sonuç verir', () => {
  for (const mode of ['keep', 'scale', 'flow']) {
    const { doc, groupOf } = setup(30);
    doc.cards.R1 = { pinned: true, page: 'p1', x: 650, y: 380, w: 150, h: 200 };
    doc.cards.R2 = { pinned: true, page: 'p1', x: 40, y: 40, w: 150, h: 200 };
    const next = { preset: 'A5', orient: 'landscape' };
    assert.deepEqual(E.pageChangeConflicts(doc, next), ['R1']);
    E.applyPageChange(doc, next, mode);
    const res = E.layout(doc, groupOf);
    assertClean(res);
    assert.equal(res.conflicts.size, 0);
    if (mode === 'flow') assert.equal(doc.cards.R1.pinned, false);
    if (mode === 'keep') { assert.equal(doc.cards.R1.pinned, true); assert.deepEqual([doc.cards.R2.x, doc.cards.R2.y], [40, 40], 'sığan sabit kart yerinde kalır'); }
  }
});

test('karta başka grup vermek yalnız belgeyi değiştirir; kaynak veri değişmez', () => {
  const { data, doc, groupOf } = setup(24);
  const before = JSON.stringify(data);
  const target = doc.order.find(id => groupOf(id).key !== groupOf('R0').key);
  E.insertAt(doc, ['R0'], target, true, groupOf);
  assert.equal(doc.cards.R0.vgroup, groupOf(target).key);
  assert.equal(doc.order.indexOf('R0'), doc.order.indexOf(target) + 1);
  const res = E.layout(doc, groupOf);
  const hdr = res.pages.flatMap(p => p.items).filter(i => i.kind === 'hdr' && i.key === groupOf(target).key);
  assert.ok(hdr.length >= 1);
  assert.equal(JSON.stringify(data), before);
  E.insertAt(doc, ['R0'], doc.order.find(id => id !== 'R0' && groupOf(id).key === groupOf('R0').key), false, groupOf);
  assert.equal(doc.cards.R0.vgroup, undefined, 'kendi grubuna dönen kartta görsel grup temizlenir');
});

test('sabitleme kaldırılınca kart bulunduğu yere en yakın akış sırasına döner', () => {
  const { doc, groupOf } = setup(20, []);
  let res = E.layout(doc, groupOf);
  const it = res.index.get('R12');
  E.pinAt(doc, 'R12', { ...it, x: it.x, y: 30 });
  res = E.layout(doc, groupOf);
  E.unpin(doc, ['R12'], res, groupOf);
  assert.equal(doc.cards.R12.pinned, false);
  assert.ok(doc.order.indexOf('R12') < 12, 'üste taşınan kart sırada öne gelir');
  assertClean(E.layout(doc, groupOf));
});

test('grupları bütün tut modunda büyük grup sayfalara dengeli bölünür', () => {
  const { doc, groupOf } = setup(1, []);
  doc.order = Array.from({ length: 30 }, (_, i) => 'R' + i);
  const g = E.geometry(doc);
  doc.style.keepGroups = true;
  const groupAll = () => ({ key: 'all', vals: ['Hepsi'] });
  const chunks = E.buildChunks(doc, g, groupAll);
  const sizes = chunks.map(c => c.items.length);
  assert.ok(Math.max(...sizes) - Math.min(...sizes) <= 1, sizes.join(','));
});

test('hizalama, çoklu kartı sabitler ve tek sayfada uygular', () => {
  const { doc } = setup(3, []);
  doc.cards.R0 = { pinned: true, page: 'p1', x: 50, y: 40, w: 100, h: 120 };
  doc.cards.R1 = { pinned: true, page: 'p1', x: 220, y: 90, w: 100, h: 120 };
  doc.cards.R2 = { pinned: true, page: 'p1', x: 400, y: 10, w: 100, h: 120 };
  E.align(doc, ['R0', 'R1', 'R2'], 'top');
  assert.deepEqual(['R0', 'R1', 'R2'].map(id => doc.cards[id].y), [10, 10, 10]);
  E.align(doc, ['R0', 'R1', 'R2'], 'hdist');
  assert.equal(Math.round(doc.cards.R1.x), 225);
});

test('kayıtlı belge doğrulanır: bilinmeyen kayıt atılır, yeni kayıt eklenir, sınırlar uygulanır', () => {
  const raw = { title: 'x'.repeat(500), order: ['A', 'B', 'GONE'], cards: { GONE: { pinned: true }, A: { pinned: true, page: 'p9', x: 1, y: 1, w: 50, h: 50 }, B: { pinned: true, page: 'p1', x: 'a' } },
    pages: [{ id: 'p1' }, { id: 'bad' }, { id: 'p1' }], style: { fs: 999, font: 'Comic', fields: ['name', 'evil'] }, grouping: { levels: ['fabric', 'hack'] }, page: { preset: 'B9' } };
  const doc = E.normalizeDoc(raw, { ids: ['A', 'B', 'C'], fields: ['name', 'fabric'] });
  assert.deepEqual(doc.order, ['A', 'B', 'C']);
  assert.deepEqual(doc.pages.map(p => p.id), ['p1']);
  assert.equal(doc.cards.A, undefined, 'olmayan sayfaya sabit kart düşer');
  assert.equal(doc.cards.B, undefined);
  assert.equal(doc.title.length, 120);
  assert.equal(doc.style.fs, 14); assert.equal(doc.style.font, 'Arial');
  assert.deepEqual(doc.style.fields, ['name']); assert.deepEqual(doc.grouping.levels, ['fabric']);
  assert.equal(doc.page.preset, 'A4');
});

test('şablon sayfa, stil ve gruplamayı taşır; eksik alanları bildirir; sabitleri korur', () => {
  const { doc, groupOf } = setup(20);
  doc.page = { preset: '16:9', orient: 'landscape' }; doc.style.cardW = 180; doc.style.fields = ['name', 'season'];
  const tpl = E.templateOf(doc, 'Vitrin');
  assert.equal(tpl.page.preset, '16:9');
  assert.equal(JSON.stringify(tpl).includes('cards'), false, 'kart konumu şablona girmez');
  const { doc: other } = setup(20);
  other.cards.R3 = { pinned: true, page: 'p1', x: 20, y: 20, w: 120, h: 160 };
  const result = E.applyTemplate(other, tpl, { fields: ['name', 'colour', 'price', 'fabric', 'productGroup'] });
  assert.equal(result.ok, true);
  assert.deepEqual(result.missing, ['season']);
  assert.deepEqual(other.style.fields, ['name']);
  assert.equal(other.page.preset, '16:9');
  assert.equal(other.cards.R3.pinned, true);
  assertClean(E.layout(other, groupOf));
});

test('2.000 kartlık yerleşim makul sürede biter', () => {
  const { doc, groupOf } = setup(2000);
  const t = process.hrtime.bigint();
  const res = E.layout(doc, groupOf);
  const ms = Number(process.hrtime.bigint() - t) / 1e6;
  assert.equal(res.index.size, 2000);
  assert.ok(ms < 1500, `${ms} ms`);
});

test('belge kaynak tabloyu (Koleksiyon/CP/Siparişler) saklar; bilinmeyen kaynak Koleksiyon’a düşer', () => {
  assert.equal(E.createDoc({ ids: ['a'], source: 'cp' }).source, 'cp');
  assert.equal(E.normalizeDoc({ order: ['a'], source: 'orders' }, { ids: ['a'] }).source, 'orders');
  assert.equal(E.normalizeDoc({ order: ['a'], source: 'evil' }, { ids: ['a'] }).source, 'koleksiyon');
  assert.equal(E.normalizeDoc({ order: ['a'] }, { ids: ['a'] }).source, 'koleksiyon');
});
