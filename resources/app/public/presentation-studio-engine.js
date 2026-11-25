/* ===================================================================
   Presentation Studio — yerleşim motoru (saf, DOM'suz, test edilebilir).

   Belge (PresentationDoc v2) tek doğruluk kaynağıdır: kartların sayfa,
   konum ve boyutu pt cinsinden saklanır. Otomatik yerleşim yalnız
   sabitlenmemiş kartları yerleştirir; sabit kartlar engeldir. Sayfa
   ölçüsü ve yönü hiçbir yerde sabit değildir: bütün geometri
   pageSize(doc.page) ve kullanıcının stil ayarlarından hesaplanır.

   Kaynak iş verisi (Koleksiyon satırları) bu modülde hiç değiştirilmez;
   gruplar arası taşıma yalnız belgedeki görsel grup (vgroup) bilgisidir.
   =================================================================== */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.BLPresentationEngine = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';
  const MM = 72 / 25.4, SEP = '␟';
  // [kısa kenar, uzun kenar] mm; ekran oranları PowerPoint'in standart ölçüleridir.
  const PAPERS = Object.freeze({ A3: [297, 420], A4: [210, 297], A5: [148, 210], '16:9': [190.5, 338.67], '4:3': [190.5, 254], square: [190.5, 190.5], custom: null });
  const FONTS = Object.freeze(['Arial', 'Calibri', 'Segoe UI', 'Verdana', 'Tahoma', 'Trebuchet MS', 'Georgia', 'Times New Roman']);
  const CARD_STYLES = Object.freeze(['frame', 'shadow', 'plain']);
  const STYLE_SPEC = Object.freeze({ fs: [6, 14, 8, 0.5], img: [0.6, 1.7, 1.05, 0.05], cardW: [60, 320, 112, 2], gap: [2, 30, 10, 1], margin: [6, 80, 26, 1] });
  const LIMITS = Object.freeze({ cards: 2000, levels: 4, fields: 14, pages: 400, templates: 30, label: 80, title: 120, customMin: 50, customMax: 1200 });
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
  const overlaps = (a, b) => a.x < b.x + b.w - 0.01 && a.x + a.w > b.x + 0.01 && a.y < b.y + b.h - 0.01 && a.y + a.h > b.y + 0.01;
  const text = (v, max) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);

  function pageSize(page) {
    const p = page || {};
    let a, b;
    if (p.preset === 'custom') { a = clamp(num(p.cw, 297), LIMITS.customMin, LIMITS.customMax); b = clamp(num(p.ch, 210), LIMITS.customMin, LIMITS.customMax); }
    else [a, b] = PAPERS[p.preset] || PAPERS.A4;
    let w = Math.max(a, b), h = Math.min(a, b);
    if (p.orient === 'portrait') [w, h] = [h, w];
    return { w: w * MM, h: h * MM, mmW: w, mmH: h };
  }

  function defaultStyle(fields) {
    return { font: 'Arial', fs: 8, img: 1.05, cardW: 112, gap: 10, margin: 26, labels: false, card: 'frame', keepGroups: false, fields: (fields || []).slice(0, LIMITS.fields) };
  }
  function createDoc({ ids = [], fields = [], levels = [], title = '' } = {}) {
    return { v: 2, title: text(title, LIMITS.title), page: { preset: 'A4', orient: 'landscape', cw: 297, ch: 210 }, style: defaultStyle(fields),
      grouping: { levels: levels.slice(0, LIMITS.levels), breakTop: false }, pages: [{ id: 'p1', flow: true, auto: true }], cards: {}, order: ids.slice(0, LIMITS.cards), labels: {}, seq: 2 };
  }
  function normalizeStyle(raw, allowedFields) {
    const s = raw && typeof raw === 'object' ? raw : {}, out = defaultStyle([]);
    for (const [k, [min, max, d]] of Object.entries(STYLE_SPEC)) out[k] = clamp(num(s[k], d), min, max);
    out.font = FONTS.includes(s.font) ? s.font : 'Arial';
    out.card = CARD_STYLES.includes(s.card) ? s.card : 'frame';
    out.labels = s.labels === true; out.keepGroups = s.keepGroups === true;
    const allowed = allowedFields ? new Set(allowedFields) : null;
    out.fields = [...new Set(Array.isArray(s.fields) ? s.fields.map(String) : [])].filter(f => !allowed || allowed.has(f)).slice(0, LIMITS.fields);
    return out;
  }
  function normalizePage(raw) {
    const p = raw && typeof raw === 'object' ? raw : {};
    return { preset: Object.prototype.hasOwnProperty.call(PAPERS, p.preset) ? p.preset : 'A4', orient: p.orient === 'portrait' ? 'portrait' : 'landscape',
      cw: clamp(Math.round(num(p.cw, 297)), LIMITS.customMin, LIMITS.customMax), ch: clamp(Math.round(num(p.ch, 210)), LIMITS.customMin, LIMITS.customMax) };
  }
  function normalizeGrouping(raw, allowedFields) {
    const g = raw && typeof raw === 'object' ? raw : {}, allowed = allowedFields ? new Set(allowedFields) : null;
    return { levels: [...new Set(Array.isArray(g.levels) ? g.levels.map(String) : [])].filter(f => !allowed || allowed.has(f)).slice(0, LIMITS.levels), breakTop: g.breakTop === true };
  }
  /* Kayıtlı belge yeniden açılırken: bilinmeyen kayıtlar ve sınır dışı
     değerler atılır, yeni seçilen kayıtlar sıranın sonuna eklenir. */
  function normalizeDoc(raw, { ids = null, fields = null } = {}) {
    const d = raw && typeof raw === 'object' ? raw : {};
    const known = ids ? new Set(ids.map(String)) : null;
    let order = [...new Set(Array.isArray(d.order) ? d.order.map(String) : [])].filter(id => !known || known.has(id));
    if (ids) { const seen = new Set(order); for (const id of ids.map(String)) if (!seen.has(id)) order.push(id); }
    order = order.slice(0, LIMITS.cards);
    const inOrder = new Set(order);
    const pages = [], pageIds = new Set();
    for (const p of Array.isArray(d.pages) ? d.pages : []) {
      const id = text(p && p.id, 24);
      if (!/^p\d{1,6}$/.test(id) || pageIds.has(id) || pages.length >= LIMITS.pages) continue;
      pageIds.add(id); pages.push({ id, flow: p.flow !== false, auto: p.auto === true });
    }
    if (!pages.length) { pages.push({ id: 'p1', flow: true, auto: true }); pageIds.add('p1'); }
    const cards = {};
    for (const [id, c] of Object.entries(d.cards && typeof d.cards === 'object' ? d.cards : {})) {
      if (!inOrder.has(id) || !c || typeof c !== 'object') continue;
      const out = {};
      if (c.excluded === true) out.excluded = true;
      if (typeof c.vgroup === 'string' && c.vgroup.length <= 2000) out.vgroup = c.vgroup;
      if (c.pinned === true && pageIds.has(c.page) && [c.x, c.y, c.w, c.h].every(v => Number.isFinite(Number(v)))) Object.assign(out, { pinned: true, page: c.page, x: Number(c.x), y: Number(c.y), w: Math.max(20, Number(c.w)), h: Math.max(20, Number(c.h)) });
      if (Object.keys(out).length) cards[id] = out;
    }
    const labels = {};
    for (const [k, v] of Object.entries(d.labels && typeof d.labels === 'object' ? d.labels : {}).slice(0, 2000)) if (typeof k === 'string' && k.length <= 2000) { const t = text(v, LIMITS.label); if (t) labels[k] = t; }
    const seq = Math.max(num(d.seq, 2), ...pages.map(p => Number(p.id.slice(1)) + 1));
    return { v: 2, title: text(d.title, LIMITS.title), page: normalizePage(d.page), style: normalizeStyle(d.style, fields), grouping: normalizeGrouping(d.grouping, fields), pages, cards, order, labels, seq };
  }

  function textHeight(s) { const n = s.fields.length; return n ? 8 + s.fs * 1.18 * 1.3 + (n - 1) * s.fs * 1.3 : 4; }
  function geometry(doc) {
    const { w, h } = pageSize(doc.page), s = doc.style, m = Math.min(s.margin, w / 5, h / 5), gap = s.gap;
    const cx = m, cy = m, cw = w - 2 * m, ch = h - 2 * m;
    const cols = Math.max(1, Math.round((cw + gap) / (s.cardW + gap))), cellW = (cw - gap * (cols - 1)) / cols;
    const hH = doc.grouping.levels.length ? s.fs * 1.25 * 1.55 + 5 : 0, hGap = hH ? 5 : 0, th = textHeight(s), groupGap = Math.max(gap * 1.6, 8);
    let cellH = cellW * s.img + th;
    if (cellH > ch - hH - hGap) cellH = ch - hH - hGap;
    /* Dengeli doldurma: satır yüksekliği hedefin ±%20'si içinde ayarlanır;
       sayfanın altında bir satır boyu boşluk kalmaz. */
    const lead = hH + hGap, step = hH ? groupGap : gap, fit = k => (ch + step) / k - lead - step;
    const n0 = Math.max(1, Math.floor((ch + step) / (cellH + lead + step))), up = fit(n0 + 1), down = fit(n0);
    if (up >= cellH * 0.8 && up - th > 20) cellH = up; else if (down <= cellH * 1.2) cellH = down;
    const rows = Math.max(1, Math.floor((ch - hH - hGap + gap) / (cellH + gap)));
    return { w, h, m, cx, cy, cw, ch, bottom: cy + ch, gap, cols, cellW, cellH, th, hH, hGap, cap: cols * rows, groupGap };
  }

  function compareVals(a, b, n) {
    for (let i = 0; i < n; i++) {
      const x = String(a[i] == null ? '' : a[i]), y = String(b[i] == null ? '' : b[i]);
      if (!x !== !y) return x ? -1 : 1; // boş değerli gruplar sona
      const d = x.localeCompare(y, 'tr', { numeric: true, sensitivity: 'base' });
      if (d) return d;
    }
    return 0;
  }
  /* groupOf(id) → { key, vals } — anahtar normalize kimlik, vals görünen değerler. */
  function effectiveKey(doc, id, groupOf) { const c = doc.cards[id]; return c && c.vgroup != null ? c.vgroup : groupOf(id).key; }
  function buildChunks(doc, g, groupOf) {
    const n = doc.grouping.levels.length, map = new Map(), valsOf = new Map();
    for (const id of doc.order) { const gi = groupOf(id); if (!valsOf.has(gi.key)) valsOf.set(gi.key, gi.vals); }
    for (const id of doc.order) {
      const c = doc.cards[id];
      if (c && (c.excluded || c.pinned)) continue;
      const key = effectiveKey(doc, id, groupOf);
      if (!map.has(key)) map.set(key, { key, vals: valsOf.get(key) || key.split(SEP), items: [] });
      map.get(key).items.push(id);
    }
    const groups = [...map.values()].sort((a, b) => compareVals(a.vals, b.vals, n));
    const out = []; let prev = null;
    for (const gr of groups) {
      const total = gr.items.length, k = doc.style.keepGroups ? Math.ceil(total / g.cap) : 1;
      let off = 0;
      for (let i = 0; i < k; i++) {
        const size = Math.floor(total / k) + (i < total % k ? 1 : 0);
        out.push({ key: gr.key, vals: gr.vals, items: gr.items.slice(off, off += size), cont: i > 0, total, brk: k > 1 || (doc.grouping.breakTop && n > 0 && prev !== null && gr.vals[0] !== prev) });
      }
      prev = gr.vals[0];
    }
    return out;
  }
  const colX = (g, c) => g.cx + c * (g.cellW + g.gap);
  /* Kesintisiz akış: kartlar satır satır akar; her grup parçasının üstünde
     kendi başlığı olur. Sabit kartın ve üstündeki başlık şeridinin kapladığı hücre atlanır. */
  function layoutPageFlow(queue, obs, g) {
    const items = [], hit = r => obs.some(o => overlaps(r, o));
    let y = g.cy, placed = 0;
    while (queue.length) {
      const cardY = y + g.hH + g.hGap;
      if (cardY + g.cellH > g.bottom + 0.01) break;
      let seg = null, any = false, stop = false;
      const close = () => { if (seg && g.hH) items.push({ kind: 'hdr', key: seg.ch.key, vals: seg.ch.vals, cont: seg.cont, count: seg.ch.total, x: seg.x, y, w: seg.x2 - seg.x, h: g.hH }); seg = null; };
      for (let c = 0; c < g.cols && queue.length; c++) {
        const ch = queue[0];
        if (ch.brk && placed > 0 && ch.items.length === ch.total) { stop = true; break; }
        const x = colX(g, c);
        if (hit({ x, y, w: g.cellW, h: g.hH + g.hGap + g.cellH })) { close(); continue; }
        if (!seg || seg.ch !== ch) { close(); seg = { ch, x, cont: ch.cont || ch.items.length < ch.total }; }
        items.push({ kind: 'card', id: ch.items.shift(), x, y: cardY, w: g.cellW, h: g.cellH });
        seg.x2 = x + g.cellW; placed++; any = true;
        if (!ch.items.length) queue.shift();
      }
      close();
      if (stop) break;
      y = cardY + g.cellH + (any ? g.groupGap : g.gap);
    }
    return items;
  }
  /* Grupları bütün tut: sütun tabanlı "skyline" yerleştirme; en alçak bitiş,
     sonra en üst konum, sonra en az boş hücre seçilir. */
  function layoutPageBlocks(queue, obs, g) {
    const items = [], hit = r => obs.some(o => overlaps(r, o)), tops = Array(g.cols).fill(g.cy);
    let placed = 0, lastY = g.cy;
    const sim = (ids, c, w, y0) => {
      let y = y0; const bw = w * g.cellW + (w - 1) * g.gap;
      if (g.hH) for (let k = 0; k < 30; k++) { const bl = obs.filter(o => overlaps({ x: colX(g, c), y, w: bw, h: g.hH }, o)); if (!bl.length) break; y = Math.max(...bl.map(o => o.y + o.h)) + 2; }
      if (y + g.hH + g.hGap + g.cellH > g.bottom + 0.01) return null;
      const top = y + g.hH + g.hGap, pl = []; let idx = 0, r = 0, bottom = y + g.hH;
      while (idx < ids.length && r < 500) {
        const ry = top + r * (g.cellH + g.gap);
        if (ry + g.cellH > g.bottom + 0.01) break;
        for (let j = 0; j < w && idx < ids.length; j++) { const rc = { x: colX(g, c + j), y: ry, w: g.cellW, h: g.cellH }; if (!hit(rc)) { pl.push({ ...rc, id: ids[idx++] }); bottom = Math.max(bottom, ry + g.cellH); } }
        r++;
      }
      return { y, w, c, bw, pl, bottom, complete: idx >= ids.length, empty: w * Math.ceil(ids.length / w) - ids.length };
    };
    while (queue.length) {
      const ch = queue[0];
      if (ch.brk && placed > 0) break;
      const n = ch.items.length; let best = null, part = null;
      for (let w = Math.min(n, g.cols); w >= 1; w--) for (let c = 0; c + w <= g.cols; c++) {
        const s = sim(ch.items, c, w, Math.max(lastY, ...tops.slice(c, c + w)));
        if (!s || !s.pl.length) continue;
        if (!s.complete) { if (!part || s.pl.length > part.pl.length) part = s; continue; }
        if (!best || s.bottom < best.bottom - 0.5 || (Math.abs(s.bottom - best.bottom) <= 0.5 && (s.y < best.y - 0.5 || (Math.abs(s.y - best.y) <= 0.5 && (s.empty < best.empty || (s.empty === best.empty && s.c < best.c)))))) best = s;
      }
      let s = best;
      if (!s) { if (placed === 0 && part) s = part; else break; }
      if (g.hH) items.push({ kind: 'hdr', key: ch.key, vals: ch.vals, cont: ch.cont, count: ch.total, x: colX(g, s.c), y: s.y, w: s.bw, h: g.hH });
      for (const p of s.pl) items.push({ kind: 'card', id: p.id, x: p.x, y: p.y, w: p.w, h: p.h });
      for (let j = s.c; j < s.c + s.w; j++) tops[j] = s.bottom + g.groupGap;
      lastY = s.y; placed += s.pl.length;
      if (!s.complete) { ch.items = ch.items.slice(s.pl.length); ch.cont = true; ch.brk = false; break; }
      queue.shift();
    }
    return items;
  }

  /* Yerleşim: belgeyi okur, otomatik sayfaları ekler/budar (doc.pages
     güncellenir), sayfa başına öğe listesi döndürür. */
  function layout(doc, groupOf) {
    const g = geometry(doc), pageIds = new Set(doc.pages.map(p => p.id)), pinned = {};
    for (const id of doc.order) {
      const c = doc.cards[id];
      if (!c || !c.pinned || c.excluded) continue;
      if (!pageIds.has(c.page)) { c.pinned = false; continue; }
      (pinned[c.page] || (pinned[c.page] = [])).push({ kind: 'card', id, pinned: true, x: c.x, y: c.y, w: c.w, h: c.h });
    }
    const queue = buildChunks(doc, g, groupOf), place = doc.style.keepGroups ? layoutPageBlocks : layoutPageFlow, out = [];
    let overflow = false;
    const pad = it => ({ x: it.x - g.gap / 2, y: it.y - g.gap / 2, w: it.w + g.gap, h: it.h + g.gap });
    for (const p of doc.pages) {
      const items = [...(pinned[p.id] || [])];
      if (p.flow && queue.length) items.push(...place(queue, items.map(pad), g));
      out.push({ id: p.id, items });
    }
    while (queue.length && doc.pages.length < LIMITS.pages) {
      const items = place(queue, [], g);
      if (!items.length) { overflow = true; break; }
      const np = { id: 'p' + doc.seq++, flow: true, auto: true };
      doc.pages.push(np); out.push({ id: np.id, items });
    }
    if (queue.length) overflow = true;
    for (let i = out.length - 1; i >= 0 && out.length > 1; i--) {
      const p = doc.pages[i];
      if (p.auto && p.flow && !out[i].items.length) { out.splice(i, 1); doc.pages.splice(i, 1); }
    }
    const index = new Map();
    for (const p of out) for (const it of p.items) if (it.kind === 'card') index.set(it.id, { ...it, page: p.id });
    return { pages: out, g, index, conflicts: conflicts(out), overflow };
  }
  function conflicts(pages) {
    const set = new Set();
    for (const p of pages) {
      const pc = p.items.filter(i => i.pinned);
      for (let i = 0; i < pc.length; i++) for (let j = i + 1; j < pc.length; j++) if (overlaps(pc[i], pc[j])) { set.add(pc[i].id); set.add(pc[j].id); }
    }
    return set;
  }

  /* En yakın boş konum (sayfa sınırı içinde, engellerle çakışmadan). */
  function findFree(rect, obs, g, step = 6) {
    const fits = r => r.x >= -0.01 && r.y >= -0.01 && r.x + r.w <= g.w + 0.01 && r.y + r.h <= g.h + 0.01 && !obs.some(o => overlaps(r, o));
    if (fits(rect)) return rect;
    const c = [];
    for (let x = g.m; x + rect.w <= g.w - g.m + 0.01; x += step) for (let y = g.m; y + rect.h <= g.h - g.m + 0.01; y += step) c.push({ x, y, d: (x - rect.x) ** 2 + (y - rect.y) ** 2 });
    c.sort((a, b) => a.d - b.d);
    for (const p of c) { const r = { ...rect, x: p.x, y: p.y }; if (fits(r)) return r; }
    return null;
  }
  /* Sabit kartların çakışmasını giderir; yer bulunamayanlar akışa döner. */
  function resolvePinned(doc) {
    const g = geometry(doc); let unpinned = 0;
    for (const p of doc.pages) {
      const placed = [];
      for (const id of doc.order) {
        const c = doc.cards[id];
        if (!c || !c.pinned || c.excluded || c.page !== p.id) continue;
        const k = Math.min(1, (g.w - 2 * g.m) / c.w, (g.h - 2 * g.m) / c.h);
        const r = findFree({ x: c.x, y: c.y, w: c.w * k, h: c.h * k }, placed, g);
        if (!r) { c.pinned = false; unpinned++; continue; }
        Object.assign(c, { x: r.x, y: r.y, w: r.w, h: r.h }); placed.push(r);
      }
    }
    return unpinned;
  }
  /* Sayfa ölçüsü değişimi: yeni ölçüye sığmayan sabit kartlar. */
  function pageChangeConflicts(doc, newPage) {
    const nd = pageSize(newPage), out = [];
    for (const id of doc.order) { const c = doc.cards[id]; if (c && c.pinned && !c.excluded && (c.x + c.w > nd.w + 0.5 || c.y + c.h > nd.h + 0.5)) out.push(id); }
    return out;
  }
  /* mode: keep (sayfa içine al) · scale (tüm sabitleri orantılı ölçekle) · flow (taşanları akışa bırak). */
  function applyPageChange(doc, newPage, mode = 'keep') {
    const od = pageSize(doc.page), nd = pageSize(newPage), bad = new Set(pageChangeConflicts(doc, newPage));
    doc.page = normalizePage(newPage);
    const pins = doc.order.map(id => doc.cards[id]).filter(c => c && c.pinned && !c.excluded);
    if (mode === 'flow') for (const id of bad) doc.cards[id].pinned = false;
    if (mode === 'scale') { const sx = nd.w / od.w, sy = nd.h / od.h, k = Math.min(sx, sy); for (const c of pins) { c.x *= sx; c.y *= sy; c.w *= k; c.h *= k; } }
    for (const c of pins) if (c.pinned) { c.x = clamp(c.x, 0, Math.max(0, nd.w - c.w)); c.y = clamp(c.y, 0, Math.max(0, nd.h - c.h)); }
    return resolvePinned(doc);
  }

  function pinAt(doc, id, it) { const c = doc.cards[id] || (doc.cards[id] = {}); Object.assign(c, { pinned: true, page: it.page, x: it.x, y: it.y, w: it.w, h: it.h }); }
  /* Sabitlemeyi kaldırır; kart, bulunduğu konumdan önceki akış kartının ardına
     yerleşir ve o kartın görsel grubunu alır (kaynak veri değişmez). */
  function unpin(doc, ids, res, groupOf) {
    for (const id of ids) {
      const it = res.index.get(id), c = doc.cards[id];
      if (!it || !c || !c.pinned) continue;
      c.pinned = false;
      const page = res.pages.find(p => p.id === it.page);
      const flow = page.items.filter(x => x.kind === 'card' && !x.pinned && !ids.includes(x.id)).sort((a, b) => a.y - b.y || a.x - b.x);
      const before = flow.filter(x => x.y + x.h / 2 < it.y + it.h / 2 || (Math.abs(x.y - it.y) < it.h / 2 && x.x < it.x)).pop();
      if (!before) continue;
      doc.order = doc.order.filter(x => x !== id);
      doc.order.splice(doc.order.indexOf(before.id) + 1, 0, id);
      setGroup(doc, id, effectiveKey(doc, before.id, groupOf), groupOf);
    }
  }
  function setGroup(doc, id, key, groupOf) { const c = doc.cards[id] || (doc.cards[id] = {}); if (key === groupOf(id).key) delete c.vgroup; else c.vgroup = key; }
  /* Sıraya ekleme: kartlar hedef kartın önüne/arkasına ve hedefin görsel grubuna taşınır. */
  function insertAt(doc, ids, targetId, after, groupOf) {
    const key = effectiveKey(doc, targetId, groupOf);
    doc.order = doc.order.filter(id => !ids.includes(id));
    const at = doc.order.indexOf(targetId) + (after ? 1 : 0);
    doc.order.splice(at < 0 ? doc.order.length : at, 0, ...ids);
    for (const id of ids) { const c = doc.cards[id] || (doc.cards[id] = {}); c.pinned = false; setGroup(doc, id, key, groupOf); }
  }
  function align(doc, ids, kind) {
    const byPage = {};
    for (const id of ids) { const c = doc.cards[id]; if (c && c.pinned) (byPage[c.page] || (byPage[c.page] = [])).push(c); }
    for (const cs of Object.values(byPage)) {
      if (cs.length < 2) continue;
      const minX = Math.min(...cs.map(c => c.x)), maxX = Math.max(...cs.map(c => c.x + c.w)), minY = Math.min(...cs.map(c => c.y)), maxY = Math.max(...cs.map(c => c.y + c.h));
      if (kind === 'left') cs.forEach(c => { c.x = minX; });
      if (kind === 'right') cs.forEach(c => { c.x = maxX - c.w; });
      if (kind === 'hcenter') cs.forEach(c => { c.x = (minX + maxX) / 2 - c.w / 2; });
      if (kind === 'top') cs.forEach(c => { c.y = minY; });
      if (kind === 'bottom') cs.forEach(c => { c.y = maxY - c.h; });
      if (kind === 'vcenter') cs.forEach(c => { c.y = (minY + maxY) / 2 - c.h / 2; });
      if (kind === 'size') { const f = doc.cards[ids[0]]; cs.forEach(c => { c.w = f.w; c.h = f.h; }); }
      if ((kind === 'hdist' || kind === 'vdist') && cs.length > 2) {
        const X = kind === 'hdist' ? 'x' : 'y', W = kind === 'hdist' ? 'w' : 'h', s = [...cs].sort((a, b) => a[X] - b[X]);
        const total = s.reduce((n, c) => n + c[W], 0), span = s[s.length - 1][X] + s[s.length - 1][W] - s[0][X], gap = (span - total) / (s.length - 1);
        let p = s[0][X]; s.forEach(c => { c[X] = p; p += c[W] + gap; });
      }
    }
  }

  /* Şablon: sayfa ölçüsü, stil ve gruplama. Kart konumları sunuma özeldir. */
  function templateOf(doc, name) {
    return { v: 2, name: text(name, 60), page: normalizePage(doc.page), style: JSON.parse(JSON.stringify(doc.style)), grouping: JSON.parse(JSON.stringify(doc.grouping)) };
  }
  function normalizeTemplate(raw) {
    if (!raw || typeof raw !== 'object' || !text(raw.name, 60)) return null;
    return { v: 2, name: text(raw.name, 60), page: normalizePage(raw.page), style: normalizeStyle(raw.style), grouping: normalizeGrouping(raw.grouping) };
  }
  /* Uygulanan şablonda olmayan alanlar mevcut sunumdan alınmaz; kullanılabilir
     alanlarda karşılığı olmayanlar sessizce düşer ve missing listesinde döner. */
  function applyTemplate(doc, tpl, { fields = null, mode = 'keep' } = {}) {
    const t = normalizeTemplate(tpl); if (!t) return { ok: false };
    const allowed = fields ? new Set(fields) : null;
    const missing = [...t.style.fields, ...t.grouping.levels].filter(f => allowed && !allowed.has(f));
    const levelsChanged = JSON.stringify(doc.grouping.levels) !== JSON.stringify(t.grouping.levels);
    doc.style = normalizeStyle(t.style, fields);
    if (!doc.style.fields.length && fields) doc.style.fields = fields.slice(0, 4);
    doc.grouping = normalizeGrouping(t.grouping, fields);
    if (levelsChanged) { for (const c of Object.values(doc.cards)) delete c.vgroup; doc.labels = {}; }
    const unpinned = applyPageChange(doc, t.page, mode);
    return { ok: true, missing: [...new Set(missing)], unpinned, levelsChanged };
  }

  return { MM, SEP, PAPERS, FONTS, CARD_STYLES, STYLE_SPEC, LIMITS, overlaps, pageSize, createDoc, normalizeDoc, normalizeStyle, normalizePage, geometry, textHeight,
    buildChunks, layoutPageFlow, layoutPageBlocks, layout, conflicts, findFree, resolvePinned, pageChangeConflicts, applyPageChange,
    effectiveKey, pinAt, unpin, insertAt, setGroup, align, templateOf, normalizeTemplate, applyTemplate };
});
