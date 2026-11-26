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

test('metin planı: alan satır sayısı kart yüksekliğine, uzun grup başlığı yalnız kendi satır bandına yansır', () => {
  for (const keepGroups of [false, true]) {
    const { doc, groupOf } = setup(60, ['fabric']);
    doc.style.keepGroups = keepGroups;
    const base = E.geometry(doc, null), s = doc.style;
    // Kumaş "Kaşmir" başlığı 3 satır ister; diğerleri 1.
    const text = { fieldLines: [2, 1, 3], hdrLines: h => (h.vals[0] === 'Kaşmir' ? 3 : 1) };
    const res = E.layout(doc, groupOf, text), g = res.g;
    assert.equal(g.th, 8 + 2 * s.fs * 1.18 * 1.3 + 4 * s.fs * 1.3, 'th alan satırlarının toplamı');
    assert.deepEqual(g.fieldLines, [2, 1, 3]);
    assert.ok(g.cellW === base.cellW, 'sütun genişliği metinden bağımsız');
    assertClean(res);
    const hdrs = res.pages.flatMap(p => p.items).filter(i => i.kind === 'hdr');
    const tall = hdrs.filter(h => h.vals[0] === 'Kaşmir');
    assert.ok(tall.length && tall.every(h => Math.abs(h.h - (g.hH + 2 * g.hLine)) < 0.01), 'uzun başlık 3 satırlık band');
    if (!keepGroups) {
      // Aynı satırdaki başlıklar aynı yükseklikte; Kaşmir olmayan satırlar tek satır kalır.
      const rows = new Map(); for (const p of res.pages) for (const h of p.items.filter(i => i.kind === 'hdr')) { const k = p.id + '@' + h.y.toFixed(2); (rows.get(k) || rows.set(k, []).get(k)).push(h); }
      for (const list of rows.values()) assert.equal(new Set(list.map(h => h.h.toFixed(2))).size, 1);
      assert.ok([...rows.values()].some(list => list.every(h => h.vals[0] !== 'Kaşmir' && Math.abs(h.h - g.hH) < 0.01)));
    }
    // Kartlar başlık bandının altında başlar.
    for (const p of res.pages) for (const h of p.items.filter(i => i.kind === 'hdr')) for (const c of p.items.filter(i => i.kind === 'card' && i.x >= h.x - 0.01 && i.x < h.x + h.w - 0.01 && i.y >= h.y)) assert.ok(c.y >= h.y + h.h - 0.01);
    // resolvePinned/findFree son planı kullanır (aynı hücre ölçüsü).
    assert.equal(E.geometry(doc).cellH, g.cellH);
  }
});

test('metin planı: sayfaya sığmayan çok satırlı başlık kartları kaybettirmez', () => {
  const { doc, groupOf } = setup(12, ['fabric']);
  doc.page = { preset: 'A5', orient: 'landscape' }; doc.style.cardW = 400; doc.style.img = 2.4;
  const res = E.layout(doc, groupOf, { fieldLines: [1, 1, 1], hdrLines: () => 40 });
  assert.equal(res.pages.flatMap(p => p.items).filter(i => i.kind === 'card').length, 12);
  assert.equal(res.overflow, false);
  assertClean(res);
});

test('grubundan çıkarılıp serbest yerleştirilen kartın grup başlığı görünür', () => {
  for (const keepGroups of [false, true]) {
    const { doc, groupOf } = setup(24, ['fabric']);
    doc.style.keepGroups = keepGroups;
    let res = E.layout(doc, groupOf);
    const g = res.g;
    // Viskon grubunun tamamı sabit → akışta Viskon başlığı yok; sabit kart kendi başlığını alır.
    const visk = doc.order.filter(id => groupOf(id).vals[0] === 'Viskon');
    const lone = visk[0];
    for (const id of visk.slice(1)) doc.cards[id] = { ...(doc.cards[id] || {}), excluded: true };
    doc.cards[lone] = { ...(doc.cards[lone] || {}), pinned: true, page: 'p1', x: g.w - g.m - g.cellW, y: g.h - g.m - g.cellH, w: g.cellW, h: g.cellH };
    // Pamuk kartı da sabit ama Pamuk'un akan kartları aynı sayfada başlık taşıyor → ek başlık yok.
    const cotton = doc.order.find(id => groupOf(id).vals[0] === 'Pamuk');
    doc.cards[cotton] = { ...(doc.cards[cotton] || {}), pinned: true, page: 'p1', x: g.m, y: g.h - g.m - g.cellH, w: g.cellW, h: g.cellH };
    res = E.layout(doc, groupOf);
    assertClean(res);
    const p1 = res.pages[0].items, hdr = p1.filter(i => i.kind === 'hdr' && i.key === groupOf(lone).key);
    assert.equal(hdr.length, 1, 'tek kalan sabit kartın başlığı');
    const card = p1.find(i => i.id === lone);
    assert.ok(Math.abs(hdr[0].y + hdr[0].h + g.hGap - card.y) < 0.01 && Math.abs(hdr[0].x - card.x) < 0.01 && Math.abs(hdr[0].w - card.w) < 0.01, 'başlık kartın hemen üstünde');
    assert.equal(hdr[0].count, 1);
    assert.ok(p1.some(i => i.kind === 'hdr' && i.key === groupOf(cotton).key && !i.pinOf), 'Pamuk akış başlığı');
    assert.equal(p1.filter(i => i.kind === 'hdr' && i.pinOf === cotton).length, 0, 'akışta başlığı olan sabit karta ek başlık yok');
    assert.equal(hdr[0].pinOf, lone);
    assert.equal(res.conflicts.size, 0);
  }
});

test('çoklu seçimde boyut: seçili kartların hepsi aynı ölçüye gelir, çakışmadan dizilir', () => {
  const { doc, groupOf } = setup(30, ['fabric']);
  let res = E.layout(doc, groupOf);
  const g = res.g, ids = res.pages[0].items.filter(i => i.kind === 'card').slice(0, 5).map(i => i.id);
  // Seçim dışında bir sabit kart engel olarak durur.
  const other = res.pages[0].items.filter(i => i.kind === 'card')[8];
  E.pinAt(doc, other.id, { ...res.index.get(other.id), page: 'p1' });
  res = E.layout(doc, groupOf);
  const W = g.cellW * 1.3, H = g.cellH * 1.2;
  const failed = E.resizeAll(doc, res, ids, W, H);
  assert.equal(failed, 0);
  res = E.layout(doc, groupOf);
  for (const id of ids) { const c = doc.cards[id]; assert.ok(c.pinned); assert.ok(Math.abs(c.w - W) < 0.01 && Math.abs(c.h - H) < 0.01, id); }
  assertClean(res);
  assert.equal(res.conflicts.size, 0);
  // Okuma sırası korunur.
  const pos = ids.map(id => doc.cards[id]);
  for (let i = 1; i < pos.length; i++) assert.ok(pos[i].y > pos[i - 1].y + 0.01 || (Math.abs(pos[i].y - pos[i - 1].y) < 0.01 && pos[i].x > pos[i - 1].x));
  // Sayfaya sığmayanlar akışta kalır, kaybolmaz.
  const many = res.pages[0].items.filter(i => i.kind === 'card' && !i.pinned).map(i => i.id);
  const lost = E.resizeAll(doc, res, many, g.w * 0.6, g.h * 0.6);
  assert.ok(lost > 0);
  res = E.layout(doc, groupOf);
  assert.equal(res.index.size, 30);
  assert.equal(res.conflicts.size, 0);
});

test('serbest bırakılan kart başka grubun alanına düşerse o gruba katılır; yeni başlık yazılmaz, kaynak değişmez', () => {
  const { data, doc, groupOf } = setup(24, ['fabric']);
  const snapshot = JSON.stringify(data);
  let res = E.layout(doc, groupOf);
  const p1 = res.pages[0].items, hdrs = p1.filter(i => i.kind === 'hdr');
  const target = hdrs[1], mover = p1.find(i => i.kind === 'card' && groupOf(i.id).key !== target.key);
  const inTarget = p1.find(i => i.kind === 'card' && i.x >= target.x - 0.1 && i.x < target.x + target.w && i.y > target.y);
  // Hedef grubun kartının üstü → grup anahtarı; boş alan → null.
  assert.equal(E.groupAt(res, 'p1', { x: inTarget.x + inTarget.w / 2, y: inTarget.y + inTarget.h / 2 }), target.key);
  assert.equal(E.groupAt(res, 'p1', { x: res.g.w - 2, y: res.g.h - 2 }), null);
  // Serbest bırakılıp gruba katılan kart: vgroup = hedef, ayrı başlık yok.
  E.pinAt(doc, mover.id, { page: 'p1', x: inTarget.x, y: inTarget.y, w: inTarget.w, h: inTarget.h });
  E.setGroup(doc, mover.id, target.key, groupOf);
  res = E.layout(doc, groupOf);
  assert.equal(doc.cards[mover.id].vgroup, target.key);
  assert.equal(res.pages.flatMap(p => p.items).filter(i => i.kind === 'hdr' && i.pinOf === mover.id).length, 0);
  assert.ok(res.pages[0].items.some(i => i.kind === 'hdr' && !i.pinOf && i.key === target.key));
  assert.equal(JSON.stringify(data), snapshot, 'kaynak veri değişmez');
  assertClean(res);
});

test('yan yana duran aynı gruptan sabit kartlar tek grup başlığını paylaşır', () => {
  const { doc, groupOf } = setup(24, ['fabric']);
  let res = E.layout(doc, groupOf);
  const g = res.g, visk = doc.order.filter(id => groupOf(id).vals[0] === 'Viskon');
  for (const id of visk.slice(2)) doc.cards[id] = { excluded: true };
  const y = g.h - g.m - g.cellH;
  doc.cards[visk[0]] = { pinned: true, page: 'p1', x: g.w - g.m - 2 * g.cellW - g.gap, y, w: g.cellW, h: g.cellH };
  doc.cards[visk[1]] = { pinned: true, page: 'p1', x: g.w - g.m - g.cellW, y, w: g.cellW, h: g.cellH };
  res = E.layout(doc, groupOf);
  const hdrs = res.pages[0].items.filter(i => i.kind === 'hdr' && i.key === groupOf(visk[0]).key);
  assert.equal(hdrs.length, 1);
  assert.equal(hdrs[0].count, 2);
  assert.ok(Math.abs(hdrs[0].w - (2 * g.cellW + g.gap)) < 0.01);
  assert.deepEqual(hdrs[0].pins, [visk[0], visk[1]]);
  assertClean(res);
});
