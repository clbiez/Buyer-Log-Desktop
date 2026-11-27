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
  const STYLE_SPEC = Object.freeze({ fs: [6, 14, 8, 0.5], hfs: [6, 24, 10, 0.5], img: [0.6, 1.7, 1.05, 0.05], cardW: [60, 320, 112, 2], gap: [2, 30, 10, 1], margin: [6, 80, 26, 1] });
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
    return { font: 'Arial', fs: 8, hfs: 10, img: 1.05, cardW: 112, gap: 10, margin: 26, labels: false, card: 'frame', keepGroups: false, chips: true, fabricCode: true, fields: (fields || []).slice(0, LIMITS.fields) };
  }
  const SOURCES = Object.freeze(['koleksiyon', 'cp', 'orders']);
  function createDoc({ ids = [], fields = [], levels = [], title = '', source = 'koleksiyon' } = {}) {
    return { v: 2, source: SOURCES.includes(source) ? source : 'koleksiyon', title: text(title, LIMITS.title), page: { preset: 'A4', orient: 'landscape', cw: 297, ch: 210 }, style: defaultStyle(fields),
      grouping: { levels: levels.slice(0, LIMITS.levels), breakTop: false }, pages: [{ id: 'p1', flow: true, auto: true }], cards: {}, order: ids.slice(0, LIMITS.cards), areas: {}, splits: {}, labels: {}, ai: {}, seq: 2 };
  }
  function normalizeStyle(raw, allowedFields) {
    const s = raw && typeof raw === 'object' ? raw : {}, out = defaultStyle([]);
    for (const [k, [min, max, d]] of Object.entries(STYLE_SPEC)) out[k] = clamp(num(s[k], d), min, max);
    out.font = FONTS.includes(s.font) ? s.font : 'Arial';
    out.card = CARD_STYLES.includes(s.card) ? s.card : 'frame';
    out.labels = s.labels === true; out.keepGroups = s.keepGroups === true;
    out.chips = s.chips !== false; // Kumaş/Artwork çip görünümü (varsayılan açık; kullanıcı metne çevirebilir)
    out.fabricCode = s.fabricCode !== false; // kumaş çipinde kod (gizlenince: üstte ad, altta karışım | gramaj)
    const allowed = allowedFields ? new Set(allowedFields) : null;
    out.fields = [...new Set(Array.isArray(s.fields) ? s.fields.map(String) : [])].filter(f => !allowed || allowed.has(f)).slice(0, LIMITS.fields);
    return out;
  }
  /* Grup alanları: grup anahtarı → { page, x, y, w, h, mode?, z? }. h = 0: kartlar genel ölçüde, alan
     kartlara göre büyür. h > 0: mode 'fit' (varsayılan) tüm kartları alana sığdırır; 'spread' kartları
     genel ölçüde tutup alanı doldurur, sığmayanlar sonraki sayfada sürer. z: son taşınan/boyutlanan önde. */
  function normalizeAreas(raw, pageIds) {
    const out = {};
    for (const [k, a] of Object.entries(raw && typeof raw === 'object' ? raw : {}).slice(0, 400)) {
      if (typeof k !== 'string' || k.length > 2000 || !a || typeof a !== 'object' || !pageIds.has(a.page)) continue;
      const [x, y, w, h] = [a.x, a.y, a.w, a.h].map(Number);
      if (![x, y, w].every(Number.isFinite)) continue;
      out[k] = { page: a.page, x: Math.max(0, x), y: Math.max(0, y), w: Math.max(20, w), h: Number.isFinite(h) ? Math.max(0, h) : 0 };
      if (a.mode === 'spread') out[k].mode = 'spread';
      if (Number.isFinite(Number(a.z)) && Number(a.z) > 0) out[k].z = Math.min(1e9, Math.round(Number(a.z)));
    }
    return out;
  }
  /* Grubundan ayrılan kartlar için elle grup: anahtar → { vals } (başlık metni özgün grubunkidir). */
  function normalizeSplits(raw) {
    const out = {};
    for (const [k, v] of Object.entries(raw && typeof raw === 'object' ? raw : {}).slice(0, 400)) {
      if (typeof k !== 'string' || k.length > 2000 || !v || !Array.isArray(v.vals)) continue;
      out[k] = { vals: v.vals.slice(0, LIMITS.levels).map(x => text(x, 200)) };
    }
    return out;
  }
  const splitVals = (doc, k) => (doc.splits && doc.splits[k] ? doc.splits[k].vals : null);
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
  /* ai: LCW AI gruplamaları (id → sonuç); normalizeAi verilirse (BLPresentationAI.normalizeGrouping) korunur,
     gruplama seviyesi olarak "ai:<id>" kullanılabilir. Sonuç yalnız sunumdadır; kaynak veriye yazılmaz. */
  function normalizeDoc(raw, { ids = null, fields = null, normalizeAi = null } = {}) {
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
    const areas = normalizeAreas(d.areas, pageIds), splits = normalizeSplits(d.splits);
    const seq = Math.max(num(d.seq, 2), ...pages.map(p => Number(p.id.slice(1)) + 1));
    const ai = {};
    if (normalizeAi) for (const [id, g] of Object.entries(d.ai && typeof d.ai === 'object' ? d.ai : {}).slice(0, 8)) { if (!/^a\d{1,6}$/.test(id)) continue; const n = normalizeAi(g, order); if (n) ai[id] = n; }
    const levelFields = fields ? [...fields, ...Object.keys(ai).map(id => 'ai:' + id)] : null;
    return { v: 2, source: SOURCES.includes(d.source) ? d.source : 'koleksiyon', title: text(d.title, LIMITS.title), page: normalizePage(d.page), style: normalizeStyle(d.style, fields), grouping: normalizeGrouping(d.grouping, levelFields), pages, cards, order, areas, splits, labels, ai, seq };
  }

  /* Metin planı (ölçüm çizim modülünde yapılır): fieldLines[i] alanın kartta
     kaç satır alacağı, hdrLines(h, w) grup başlığının w genişliğinde kaç satır
     gerektirdiği. Son yerleşimin planı belgeye bağlanır; resolvePinned/findFree
     aynı hücre ölçüsünü kullanır. Plan yoksa her alan ve başlık tek satırdır. */
  const TEXT = new WeakMap(), lineCount = v => Math.max(1, Math.min(12, Math.round(Number(v) || 1)));
  function textHeight(s, lines) {
    const n = s.fields.length;
    if (!n) return 4;
    let h = 8;
    for (let i = 0; i < n; i++) h += lineCount(lines && lines[i]) * s.fs * (i ? 1 : 1.18) * 1.3;
    return h;
  }
  function geometry(doc, text) {
    if (text === undefined) text = TEXT.get(doc) || null;
    const { w, h } = pageSize(doc.page), s = doc.style, m = Math.min(s.margin, w / 5, h / 5), gap = s.gap;
    const cx = m, cy = m, cw = w - 2 * m, ch = h - 2 * m;
    const cols = Math.max(1, Math.round((cw + gap) / (s.cardW + gap))), cellW = (cw - gap * (cols - 1)) / cols;
    const hH = doc.grouping.levels.length ? s.hfs * 1.55 + 5 : 0, hGap = hH ? 5 : 0, th = textHeight(s, text && text.fieldLines), groupGap = Math.max(gap * 1.6, 8);
    let cellH = cellW * s.img + th;
    if (cellH > ch - hH - hGap) cellH = ch - hH - hGap;
    /* Dengeli doldurma: satır yüksekliği hedefin ±%20'si içinde ayarlanır;
       sayfanın altında bir satır boyu boşluk kalmaz. */
    const lead = hH + hGap, step = hH ? groupGap : gap, fit = k => (ch + step) / k - lead - step;
    const n0 = Math.max(1, Math.floor((ch + step) / (cellH + lead + step))), up = fit(n0 + 1), down = fit(n0);
    if (up >= cellH * 0.8 && up - th > 20) cellH = up; else if (down <= cellH * 1.2) cellH = down;
    const rows = Math.max(1, Math.floor((ch - hH - hGap + gap) / (cellH + gap)));
    const fieldLines = s.fields.map((_, i) => lineCount(text && text.fieldLines && text.fieldLines[i])), hLine = s.hfs * 1.3;
    // Başlık bandı: grup adının w genişliğinde gerektirdiği satır kadar uzar.
    const hdrH = hd => (!hH ? 0 : hH + (text && typeof text.hdrLines === 'function' ? lineCount(text.hdrLines(hd, hd.w)) - 1 : 0) * hLine);
    return { w, h, m, cx, cy, cw, ch, bottom: cy + ch, gap, cols, cellW, cellH, th, hH, hGap, cap: cols * rows, groupGap, fieldLines, hLine, hdrH };
  }

  // localeCompare her çağrıda karşılaştırıcı kurar; aynı seçeneklerle tek Collator (aynı sıralama).
  let collator = null;
  const cmp = (x, y) => (collator || (collator = typeof Intl !== 'undefined' && Intl.Collator ? new Intl.Collator('tr', { numeric: true, sensitivity: 'base' }) : { compare: (p, q) => p.localeCompare(q, 'tr', { numeric: true, sensitivity: 'base' }) })).compare(x, y);
  /* ao/bo: seviye başına isteğe bağlı sıra numarası (ör. LCW AI kategorilerinin sırası); ikisinde de varsa önce o. */
  function compareVals(a, b, n, ao = null, bo = null) {
    for (let i = 0; i < n; i++) {
      if (ao && bo && ao[i] != null && bo[i] != null) { if (ao[i] !== bo[i]) return ao[i] - bo[i]; continue; }
      const x = String(a[i] == null ? '' : a[i]), y = String(b[i] == null ? '' : b[i]);
      if (!x !== !y) return x ? -1 : 1; // boş değerli gruplar sona
      const d = cmp(x, y);
      if (d) return d;
    }
    return 0;
  }
  /* groupOf(id) → { key, vals } — anahtar normalize kimlik, vals görünen değerler. */
  function effectiveKey(doc, id, groupOf) { const c = doc.cards[id]; return c && c.vgroup != null ? c.vgroup : groupOf(id).key; }
  function buildChunks(doc, g, groupOf, skip = null) {
    const n = doc.grouping.levels.length, map = new Map(), valsOf = new Map(), ordOf = new Map();
    for (const id of doc.order) { const gi = groupOf(id); if (!valsOf.has(gi.key)) { valsOf.set(gi.key, gi.vals); if (gi.ord) ordOf.set(gi.key, gi.ord); } }
    for (const id of doc.order) {
      const c = doc.cards[id];
      if (c && (c.excluded || c.pinned)) continue;
      const key = effectiveKey(doc, id, groupOf);
      if (skip && skip.has(key)) continue; // grup alanındaki kartlar akışa girmez
      if (!map.has(key)) map.set(key, { key, vals: valsOf.get(key) || splitVals(doc, key) || key.split(SEP), items: [] });
      map.get(key).items.push(id);
    }
    const groups = [...map.values()].sort((a, b) => compareVals(a.vals, b.vals, n, ordOf.get(a.key), ordOf.get(b.key)));
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
    /* Tek satırı hH başlık bandıyla dener; kuyruğu ilerletir. */
    const row = hH => {
      const cardY = y + hH + g.hGap, out = [], hdrs = [];
      if (cardY + g.cellH > g.bottom + 0.01) return null;
      let seg = null, any = false, stop = false, n = 0;
      const close = () => { if (seg && g.hH) { const hd = { kind: 'hdr', key: seg.ch.key, vals: seg.ch.vals, cont: seg.cont, count: seg.ch.total, x: seg.x, y, w: seg.x2 - seg.x, h: hH }; out.push(hd); hdrs.push(hd); } seg = null; };
      for (let c = 0; c < g.cols && queue.length; c++) {
        const ch = queue[0];
        if (ch.brk && placed + n > 0 && ch.items.length === ch.total) { stop = true; break; }
        const x = colX(g, c);
        if (hit({ x, y, w: g.cellW, h: hH + g.hGap + g.cellH })) { close(); continue; }
        if (!seg || seg.ch !== ch) { close(); seg = { ch, x, cont: ch.cont || ch.items.length < ch.total }; }
        out.push({ kind: 'card', id: ch.items.shift(), x, y: cardY, w: g.cellW, h: g.cellH });
        seg.x2 = x + g.cellW; n++; any = true;
        if (!ch.items.length) queue.shift();
      }
      close();
      return { out, hdrs, any, stop, n, cardY, need: hdrs.reduce((m, hd) => Math.max(m, g.hdrH(hd)), g.hH) };
    };
    while (queue.length) {
      const q0 = queue.slice(), s0 = q0.map(ch => ch.items.slice());
      const restore = () => { queue.length = 0; queue.push(...q0); q0.forEach((ch, i) => { ch.items = s0[i].slice(); }); };
      let hH = g.hH, r = row(hH);
      if (!r) break;
      // Uzun başlık: satırı daha yüksek bantla yeniden kur (segment genişliği değişebilir).
      for (let k = 0; k < 3 && r.need > hH + 0.01; k++) {
        hH = r.need; restore();
        const next = row(hH);
        if (!next) {
          restore();
          if (placed > 0) return items; // satır bir sonraki sayfaya geçer
          hH = g.hH; r = row(hH); break; // boş sayfaya da sığmıyorsa başlık kısaltılır
        }
        r = next;
      }
      items.push(...r.out); placed += r.n;
      if (r.stop) break;
      y = r.cardY + g.cellH + (r.any ? g.groupGap : g.gap);
    }
    return items;
  }
  /* Grupları bütün tut: sütun tabanlı "skyline" yerleştirme; en alçak bitiş,
     sonra en üst konum, sonra en az boş hücre seçilir. */
  function layoutPageBlocks(queue, obs, g) {
    const items = [], hit = r => obs.some(o => overlaps(r, o)), tops = Array(g.cols).fill(g.cy);
    let placed = 0, lastY = g.cy;
    const sim = (ch, c, w, y0, base) => {
      const ids = ch.items;
      let y = y0; const bw = w * g.cellW + (w - 1) * g.gap;
      const hh = !g.hH || base ? g.hH : g.hdrH({ key: ch.key, vals: ch.vals, cont: ch.cont || ids.length < ch.total, count: ch.total, w: bw });
      if (hh) for (let k = 0; k < 30; k++) { const bl = obs.filter(o => overlaps({ x: colX(g, c), y, w: bw, h: hh }, o)); if (!bl.length) break; y = Math.max(...bl.map(o => o.y + o.h)) + 2; }
      if (y + hh + g.hGap + g.cellH > g.bottom + 0.01) return null;
      const top = y + hh + g.hGap, pl = []; let idx = 0, r = 0, bottom = y + hh;
      while (idx < ids.length && r < 500) {
        const ry = top + r * (g.cellH + g.gap);
        if (ry + g.cellH > g.bottom + 0.01) break;
        // Blok dikdörtgen kalır: satırda gereken hücrelerden biri engelliyse (alan/sabit kart) blok o satırda biter;
        // kartlar engelin çevresine dağılıp L biçimli, boşluklu blok oluşmaz.
        const need = Math.min(w, ids.length - idx);
        if (obs.length && obs.some(o => o.y < ry + g.cellH - 0.01 && o.y + o.h > ry + 0.01 && o.x < colX(g, c + need - 1) + g.cellW - 0.01 && o.x + o.w > colX(g, c) + 0.01)) break;
        for (let j = 0; j < need; j++) pl.push({ x: colX(g, c + j), y: ry, w: g.cellW, h: g.cellH, id: ids[idx++] });
        bottom = Math.max(bottom, ry + g.cellH);
        r++;
      }
      return { y, w, c, bw, hh, pl, bottom, complete: idx >= ids.length, empty: w * Math.ceil(ids.length / w) - ids.length };
    };
    while (queue.length) {
      const ch = queue[0];
      if (ch.brk && placed > 0) break;
      const n = ch.items.length; let best = null, part = null;
      for (let pass = 0; pass < 2 && !best && !(pass && (placed > 0 || part)); pass++) for (let w = Math.min(n, g.cols); w >= 1; w--) for (let c = 0; c + w <= g.cols; c++) {
        const s = sim(ch, c, w, Math.max(lastY, ...tops.slice(c, c + w)), pass === 1);
        if (!s || !s.pl.length) continue;
        if (!s.complete) { if (!part || s.pl.length > part.pl.length) part = s; continue; }
        if (!best || s.bottom < best.bottom - 0.5 || (Math.abs(s.bottom - best.bottom) <= 0.5 && (s.y < best.y - 0.5 || (Math.abs(s.y - best.y) <= 0.5 && (s.empty < best.empty || (s.empty === best.empty && s.c < best.c)))))) best = s;
      }
      let s = best;
      if (!s) { if (placed === 0 && part) s = part; else break; }
      if (g.hH) items.push({ kind: 'hdr', key: ch.key, vals: ch.vals, cont: ch.cont, count: ch.total, x: colX(g, s.c), y: s.y, w: s.bw, h: s.hh });
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
  function layout(doc, groupOf, text = null) {
    if (text) TEXT.set(doc, text); else TEXT.delete(doc);
    const g = geometry(doc), pageIds = new Set(doc.pages.map(p => p.id)), pinned = {};
    for (const id of doc.order) {
      const c = doc.cards[id];
      if (!c || !c.pinned || c.excluded) continue;
      if (!pageIds.has(c.page)) { c.pinned = false; continue; }
      // Sabit kart da sayfa kenar boşluğunun içinde gösterilir (baskıda kesilmez).
      const k = Math.min(1, g.cw / c.w, g.ch / c.h), w = c.w * k, h = c.h * k;
      (pinned[c.page] || (pinned[c.page] = [])).push({ kind: 'card', id, pinned: true, x: clamp(c.x, g.m, g.w - g.m - w), y: clamp(c.y, g.m, g.bottom - h), w, h });
    }
    const place = doc.style.keepGroups ? layoutPageBlocks : layoutPageFlow;
    const valsOf = new Map();
    if (g.hH) for (const id of doc.order) { const gi = groupOf(id); if (!valsOf.has(gi.key)) valsOf.set(gi.key, gi.vals); }
    /* Grubundan ayrı sabitlenen kart: aynı sayfada grubun akan başlığı yoksa
       kartın hemen üstüne kendi başlığı konur (akış o bandı boş bırakır). */
    const pinHdr = (it, count) => {
      const key = effectiveKey(doc, it.id, groupOf), hd = { kind: 'hdr', key, vals: valsOf.get(key) || splitVals(doc, key) || key.split(SEP), cont: false, count, x: it.x, w: it.w, pinOf: it.id };
      hd.h = g.hdrH(hd); hd.y = it.y - g.hGap - hd.h; return hd;
    };
    const pad = (it, need) => {
      const top = need && need.has(it.id) ? pinHdr(it, 1).y : it.y;
      return { x: it.x - g.gap / 2, y: top - g.gap / 2, w: it.w + g.gap, h: it.y + it.h - top + g.gap };
    };
    let overflow = false;
    /* Grup alanları (seçenek d): alan kartlara yetmezse aşağı büyür; sayfa bitince kalan
       kartlar sonraki sayfada aynı yatay konumda, aynı başlıkla ("devam") sürer. */
    const areaSpecs = new Map(), areaKeys = new Set();
    if (g.hH && doc.areas && Object.keys(doc.areas).length) {
      const byKey = new Map();
      for (const id of doc.order) {
        const c = doc.cards[id];
        if (c && (c.excluded || c.pinned)) continue;
        const k = effectiveKey(doc, id, groupOf);
        if (doc.areas[k] && pageIds.has(doc.areas[k].page)) (byKey.get(k) || byKey.set(k, []).get(k)).push(id);
      }
      for (const [k, ids] of byKey) {
        // Alan sayfa kenar boşluğunun (baskı payı) içinde kalır.
        const a = doc.areas[k], w = clamp(a.w, Math.min(g.cellW, g.cw), g.cw), y = clamp(a.y, g.m, g.bottom - g.hH - g.hGap - g.th - 24);
        const spec = { key: k, page: a.page, x: clamp(a.x, g.m, g.w - g.m - w), y, w, h: a.h > 0 ? Math.min(a.h, g.bottom - y) : 0, mode: a.mode === 'spread' ? 'spread' : 'fit', z: a.z || 0, ids, total: ids.length, vals: valsOf.get(k) || splitVals(doc, k) || k.split(SEP), cont: false };
        (areaSpecs.get(a.page) || areaSpecs.set(a.page, []).get(a.page)).push(spec);
        areaKeys.add(k);
      }
      // Öncelik: son taşınan/boyutlanan alan yerini korur; ötekiler onun etrafında bütün olarak yer değiştirir.
      for (const list of areaSpecs.values()) list.sort((p, q) => q.z - p.z || p.y - q.y || p.x - q.x);
    }
    /* obs: sayfadaki sabit kartlar ve önce yerleşen alanlar. Alan bunlarla çakışıyorsa altına kayar;
       aşağı doğru yalnız bir sonraki engele (ya da sayfa sonuna) kadar büyür, kalanlar sonraki sayfada sürer. */
    const placeArea = (sp, force, obs = []) => {
      const hd = { kind: 'hdr', key: sp.key, vals: sp.vals, cont: sp.cont, count: sp.total, x: sp.x, y: sp.y, w: sp.w, area: sp.key };
      hd.h = g.hdrH(hd);
      const minH = hd.h + g.hGap + g.cellH;
      let y = sp.y;
      for (let k = 0; k < 40; k++) {
        const bl = obs.filter(o => overlaps({ x: sp.x, y, w: sp.w, h: minH }, o));
        if (!bl.length) break;
        y = Math.max(...bl.map(o => o.y + o.h)) + g.gap;
      }
      const below = obs.filter(o => o.x < sp.x + sp.w && o.x + o.w > sp.x && o.y >= y).map(o => o.y - g.gap);
      const limit = Math.min(g.bottom, ...below);
      hd.y = y;
      /* Grup bazlı kart boyutu: alan elle boyutlandıysa (h > 0) kartlar alanı orantılı doldurur. Sütun sayısı,
         görsel oranı genel karta en yakın ve boş hücresi en az olan seçenektir; kart eklenince kartlar küçülür.
         Kartlar çok küçülürse (genişlik < 40 pt) genel ölçüyle akıp sayfa sonunda devam eder. */
      /* Kartları yay: genel kart ölçüsüyle alana kaç satır/sütun sığıyorsa o kadar kart alınır; yeni satır/sütun
         sığmayan artan pay mevcut kartları büyütür (boş alan kalmaz). Sığmayanlar sonraki sayfada aynı başlıkla
         sürer. Hepsi sığıyorsa "sığdır" gibi davranır. */
      if (sp.h > 0 && !sp.cont && sp.mode === 'spread') {
        const H = Math.min(sp.h, limit - y), bodyH = H - hd.h - g.hGap;
        const c = Math.max(1, Math.floor((sp.w + g.gap + 0.01) / (g.cellW + g.gap))), r = Math.max(1, Math.floor((bodyH + g.gap + 0.01) / (g.cellH + g.gap)));
        if (c * r < sp.ids.length) {
          // Hücreler alanı iki yönde de tam kaplar (boş şerit kalmaz); görsel kutusu içinde orantılı kalır.
          const cw = (sp.w - (c - 1) * g.gap) / c, ch = (bodyH - (r - 1) * g.gap) / r, top2 = y + hd.h + g.hGap;
          if (cw >= 40 && ch - g.th >= 16) {
            const items = [{ kind: 'area', key: sp.key, x: sp.x, y, w: sp.w, h: H, cont: false, fit: true, mode: 'spread' }, hd];
            for (let i = 0; i < c * r; i++) items.push({ kind: 'card', id: sp.ids[i], x: sp.x + (i % c) * (cw + g.gap), y: top2 + Math.floor(i / c) * (ch + g.gap), w: cw, h: ch, area: sp.key });
            return { items, rest: sp.ids.slice(c * r) };
          }
        }
      }
      if (sp.h > 0 && !sp.cont) {
        const H = Math.min(sp.h, limit - y), bodyH = H - hd.h - g.hGap, n = sp.ids.length, ratio = (g.cellH - g.th) / g.cellW;
        let best = null, grow = null;
        for (let c = 1; c <= Math.min(n, 24); c++) {
          const rws = Math.ceil(n / c), cwW = (sp.w - (c - 1) * g.gap) / c;
          if (cwW < 40) break;
          const chMax = (bodyH - (rws - 1) * g.gap) / rws, cwH = (chMax - g.th) / ratio, size = Math.min(cwW, cwH);
          // Alan yüksekliğine sığan en büyük kart (eşitlikte daha az boş hücre).
          if (chMax - g.th >= 16 && size >= 40 && (!best || size > best.size + 0.01 || (Math.abs(size - best.size) <= 0.01 && c * rws - n < best.empty))) best = { c, cw: cwW, ch: chMax, size, empty: c * rws - n, h: H };
          // Hiçbiri sığmazsa: genişliği dolduran doğal oranlı kartlarla alan aşağı büyür (sayfa sınırına kadar).
          const chN = cwW * ratio + g.th, total = hd.h + g.hGap + rws * chN + (rws - 1) * g.gap;
          if (y + total <= limit + 0.01 && (!grow || cwW > grow.cw)) grow = { c, cw: cwW, ch: chN, h: Math.max(H, total) };
        }
        const pick = best || grow;
        if (pick) {
          const top2 = y + hd.h + g.hGap, items = [{ kind: 'area', key: sp.key, x: sp.x, y, w: sp.w, h: pick.h, cont: sp.cont, fit: true, mode: sp.mode }, hd];
          sp.ids.forEach((id, i) => items.push({ kind: 'card', id, x: sp.x + (i % pick.c) * (pick.cw + g.gap), y: top2 + Math.floor(i / pick.c) * (pick.ch + g.gap), w: pick.cw, h: pick.ch, area: sp.key }));
          return { items, rest: [] };
        }
      }
      const cols = Math.max(1, Math.floor((sp.w + g.gap + 0.01) / (g.cellW + g.gap))), top = y + hd.h + g.hGap;
      let rows = Math.min(Math.ceil(sp.ids.length / cols), Math.max(0, Math.floor((limit - top + g.gap + 0.01) / (g.cellH + g.gap))));
      if (!rows && force && !obs.length) rows = 1; // boş sayfada bile sığmıyorsa bir satır zorla (sonsuz sayfa üretme)
      const n = Math.min(sp.ids.length, rows * cols);
      if (!n) return { items: [], rest: sp.ids };
      const bodyH = rows * (g.cellH + g.gap) - g.gap, h = Math.min(Math.max(sp.h || 0, hd.h + g.hGap + bodyH), Math.max(hd.h + g.hGap + bodyH, limit - y), g.bottom - y);
      const items = [{ kind: 'area', key: sp.key, x: sp.x, y, w: sp.w, h, cont: sp.cont }, hd];
      for (let i = 0; i < n; i++) items.push({ kind: 'card', id: sp.ids[i], x: sp.x + (i % cols) * (g.cellW + g.gap), y: top + Math.floor(i / cols) * (g.cellH + g.gap), w: g.cellW, h: g.cellH, area: sp.key });
      return { items, rest: sp.ids.slice(n) };
    };
    const areaPad = it => ({ x: it.x - g.gap / 2, y: it.y - g.gap / 2, w: it.w + g.gap, h: it.h + g.gap });
    /* Önde olan alanla/sabit kartla çakışan alan biçimi bozulmadan (aynı ölçü, aynı kart dizilimi) en yakın
       boş konuma bütün olarak taşınır. Sayfada yer yoksa null: eski davranış (altına kayar, kalanı sürer). */
    const moveWhole = (sp, obs) => {
      const free = placeArea(sp, false, []), box = free.items[0];
      if (!box) return null;
      const hit = r => obs.some(o => overlaps(r, o));
      if (!hit(box)) return free;
      const W = box.w, H = box.h, xs = new Set([sp.x, g.m, g.w - g.m - W]), ys = new Set([sp.y, g.m, g.bottom - H]);
      for (const o of obs) { xs.add(o.x + o.w + g.gap / 2); xs.add(o.x - W - g.gap / 2); ys.add(o.y + o.h + g.gap / 2); ys.add(o.y - H - g.gap / 2); }
      let best = null;
      for (const x of xs) for (const y of ys) {
        const r = { x, y, w: W, h: H };
        if (x < g.m - 0.01 || y < g.m - 0.01 || x + W > g.w - g.m + 0.01 || y + H > g.bottom + 0.01 || hit(r)) continue;
        const d = (x - sp.x) ** 2 + (y - sp.y) ** 2;
        if (!best || d < best.d) best = { x, y, d };
      }
      if (!best) return null;
      const out = placeArea({ ...sp, x: best.x, y: best.y }, false, []);
      return out.items[0] && !hit(out.items[0]) ? out : null;
    };
    const run = need => {
      const queue = buildChunks(doc, g, groupOf, areaKeys), out = [];
      let carry = [];
      const fill = (pid, items) => {
        // Sayfanın kendi alanları önce (öncelik sırasıyla), önceki sayfadan devam edenler sonra.
        const specs = [...(areaSpecs.get(pid) || []), ...carry]; carry = [];
        for (const sp of specs) {
          const obs = items.filter(it => it.kind === 'area' || it.pinned).map(it => ({ x: it.x - g.gap / 2, y: it.y - g.gap / 2, w: it.w + g.gap, h: it.h + g.gap }));
          const whole = !sp.cont && obs.length ? moveWhole(sp, obs) : null;
          // Sayfada bütün olarak yer yoksa alan biçimi bozulmadan sonraki sayfaya geçer (en çok 3 sayfa ötelenir).
          if (!sp.cont && obs.length && !whole && (sp.moved || 0) < 3) { carry.push({ ...sp, moved: (sp.moved || 0) + 1 }); continue; }
          const r = whole || placeArea(sp, sp.cont && Math.abs(sp.y - g.cy) < 0.01, obs);
          items.push(...r.items);
          if (r.rest.length) carry.push({ ...sp, y: g.cy, h: 0, cont: true, ids: r.rest });
        }
      };
      const obstacles = items => items.filter(it => it.kind === 'area' || it.pinned).map(it => (it.kind === 'area' ? areaPad(it) : pad(it, need)));
      // Başlık bandı gereken sabit kart, başlığı üst kenar boşluğuna taşmayacak kadar aşağıda gösterilir.
      const room = it => { if (!need || !need.has(it.id)) return it; const top = pinHdr(it, 1).y; return top >= g.m - 0.01 ? it : { ...it, y: Math.min(it.y + g.m - top, g.bottom - it.h) }; };
      for (const p of doc.pages) {
        const items = (pinned[p.id] || []).map(room);
        fill(p.id, items);
        if (p.flow && queue.length) items.push(...place(queue, obstacles(items), g));
        out.push({ id: p.id, items });
      }
      while ((queue.length || carry.length) && doc.pages.length < LIMITS.pages) {
        const items = [];
        fill(null, items);
        if (queue.length) items.push(...place(queue, obstacles(items), g));
        if (!items.length) break;
        const np = { id: 'p' + doc.seq++, flow: true, auto: true };
        doc.pages.push(np); out.push({ id: np.id, items });
      }
      overflow = queue.length > 0 || carry.length > 0;
      return out;
    };
    const lonely = out => {
      const set = new Set();
      for (const p of out) {
        const keys = new Set(p.items.filter(i => i.kind === 'hdr').map(i => i.key));
        for (const it of p.items) if (it.pinned && !keys.has(effectiveKey(doc, it.id, groupOf))) set.add(it.id);
      }
      return set;
    };
    let out = run(null);
    if (g.hH) {
      // Başlık bandı gereken sabitler: ikinci geçişte yeni yalnız kalan olursa kümeye eklenip yeniden yerleşir.
      let need = lonely(out), still = need;
      for (let k = 0; k < 3 && need.size; k++) {
        out = run(need); still = lonely(out);
        if ([...still].every(id => need.has(id))) break;
        need = new Set([...need, ...still]);
      }
      for (const p of out) {
        // Aynı gruptan, aynı hizada yan yana duran sabit kartlar tek başlığı paylaşır.
        const pins = p.items.filter(i => i.pinned && still.has(i.id)).sort((a, b) => a.y - b.y || a.x - b.x), runs = [];
        for (const it of pins) {
          const key = effectiveKey(doc, it.id, groupOf), run = runs.find(r => r.key === key && Math.abs(r.y - it.y) < 1 && it.x - r.x2 >= -0.5 && it.x - r.x2 <= g.gap * 1.6 + 0.5);
          if (run) { run.x2 = it.x + it.w; run.ids.push(it.id); } else runs.push({ key, id: it.id, ids: [it.id], x: it.x, y: it.y, x2: it.x + it.w });
        }
        for (const r of runs) {
          const hd = pinHdr({ id: r.id, x: r.x, y: r.y, w: r.x2 - r.x }, r.ids.length); hd.pins = r.ids;
          if (hd.y >= g.m - 0.01 && !p.items.some(o => !r.ids.includes(o.id) && overlaps(hd, o))) p.items.push(hd);
        }
      }
    }
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
      // Grup alanının üstüne düşen sabit kart da çakışmadır.
      for (const ar of p.items.filter(i => i.kind === 'area')) for (const c of pc) if (overlaps(ar, c)) set.add(c.id);
    }
    return set;
  }

  /* En yakın boş konum (sayfa sınırı içinde, engellerle çakışmadan). */
  function findFree(rect, obs, g, step = 6) {
    const fits = r => r.x >= g.m - 0.01 && r.y >= g.m - 0.01 && r.x + r.w <= g.w - g.m + 0.01 && r.y + r.h <= g.h - g.m + 0.01 && !obs.some(o => overlaps(r, o));
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
    const m = geometry(doc).m;
    for (const c of pins) if (c.pinned) { c.x = clamp(c.x, m, Math.max(m, nd.w - m - c.w)); c.y = clamp(c.y, m, Math.max(m, nd.h - m - c.h)); }
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
  /* Sayfadaki bir noktanın düştüğü akış grubu: başlık bandı ve altındaki akan
     kartlarının kapladığı alan. Boş alan veya sabit kart üstü → null. */
  function groupAt(res, pageId, pt) {
    const p = res.pages.find(pg => pg.id === pageId); if (!p) return null;
    const g = res.g, inside = (r, q) => q.x >= r.x && q.x <= r.x + r.w && q.y >= r.y && q.y <= r.y + r.h;
    for (const ar of p.items) if (ar.kind === 'area' && inside(ar, pt)) return ar.key;
    for (const h of p.items) {
      if (h.kind !== 'hdr' || h.pinOf) continue;
      const cards = p.items.filter(c => c.kind === 'card' && !c.pinned && c.x >= h.x - 0.1 && c.x < h.x + h.w - 0.1 && c.y > h.y && c.y - h.y <= h.h + g.hGap + 0.1);
      const bottom = cards.reduce((m, c) => Math.max(m, c.y + c.h), h.y + h.h);
      if (inside({ x: h.x, y: h.y, w: h.w, h: bottom - h.y }, pt)) return h.key;
    }
    return null;
  }
  /* Grubu kendi alanına alır / alanı taşır-boyutlar (sayfa, konum, genişlik, en az yükseklik). */
  function setArea(doc, key, rect) {
    if (!doc.areas) doc.areas = {};
    const prev = doc.areas[key], mode = rect.mode !== undefined ? rect.mode : prev && prev.mode;
    // z: son taşınan/boyutlanan alan önde (çakışmada yerini korur).
    const top = Math.max(0, ...Object.values(doc.areas).map(a => a.z || 0)), z = prev && prev.z && prev.z === top ? top : top + 1;
    doc.areas[key] = { page: rect.page, x: Math.max(0, Number(rect.x) || 0), y: Math.max(0, Number(rect.y) || 0), w: Math.max(20, Number(rect.w) || 20), h: Math.max(0, Number(rect.h) || 0), z };
    if (mode === 'spread') doc.areas[key].mode = 'spread';
  }
  function clearArea(doc, key) { if (doc.areas) delete doc.areas[key]; }
  /* Grubundan ayrılmış (sabit) kartları kendi elle grubuna alır: yeni anahtar, özgün başlık metni.
     Kartların sabitlemesi kalkar; çağıran alanı (setArea) bu anahtara verir. Kaynak veri değişmez. */
  function splitGroup(doc, ids, groupOf) {
    const base = effectiveKey(doc, ids[0], groupOf);
    const vals = splitVals(doc, base) || (groupOf(ids[0]).key === base ? groupOf(ids[0]).vals : base.split(SEP));
    let n = 1, key;
    do key = `${base}\u0002${n++}`; while ((doc.splits && doc.splits[key]) || doc.order.some(id => effectiveKey(doc, id, groupOf) === key));
    if (!doc.splits) doc.splits = {};
    doc.splits[key] = { vals: vals.slice() };
    for (const id of ids) { const c = doc.cards[id] || (doc.cards[id] = {}); c.pinned = false; c.vgroup = key; }
    return key;
  }
  /* İki grubu birleştirir: kaynak gruptaki tüm kartlar hedef grubun anahtarını alır (görsel; kaynak veri değişmez). */
  function mergeGroups(doc, fromKey, toKey, groupOf) {
    if (fromKey === toKey) return 0;
    let n = 0;
    for (const id of doc.order) if (effectiveKey(doc, id, groupOf) === fromKey) { setGroup(doc, id, toKey, groupOf); n++; }
    if (doc.areas && doc.areas[fromKey]) delete doc.areas[fromKey];
    return n;
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
  /* Çoklu seçimde boyut: seçili kartlar aynı ölçüye gelir ve sayfa başına
     okuma sırasıyla seçimin sol üstünden dizilir; diğer sabitlerin etrafından
     dolaşır. Yer bulunamayan kart akışta kalır. Dönüş: yerleşemeyen kart sayısı. */
  function resizeAll(doc, res, ids, w, h) {
    const g = res.g, byPage = new Map();
    for (const id of ids) { const it = res.index.get(id); if (it) (byPage.get(it.page) || byPage.set(it.page, []).get(it.page)).push(it); }
    w = Math.min(Math.max(1, w), g.w - 2 * g.m); h = Math.min(Math.max(1, h), g.h - 2 * g.m);
    let failed = 0;
    const sel = new Set(ids);
    for (const [page, list] of byPage) {
      list.sort((a, b) => (Math.abs(a.y - b.y) > 1 ? a.y - b.y : a.x - b.x));
      const x0 = Math.min(...list.map(i => i.x)), y0 = Math.min(...list.map(i => i.y));
      const p = res.pages.find(pg => pg.id === page);
      const obs = (p ? p.items : []).filter(i => i.kind === 'card' && i.pinned && !sel.has(i.id)).map(i => ({ x: i.x - g.gap / 2, y: i.y - g.gap / 2, w: i.w + g.gap, h: i.h + g.gap }));
      let x = x0, y = y0;
      for (const it of list) {
        if (x > x0 && x + w > g.w - g.m + 0.01) { x = x0; y += h + g.gap; }
        const spot = findFree({ x, y, w, h }, obs, g);
        if (!spot) { const c = doc.cards[it.id]; if (c) c.pinned = false; failed++; continue; }
        pinAt(doc, it.id, { ...spot, page });
        obs.push({ x: spot.x - g.gap / 2, y: spot.y - g.gap / 2, w: w + g.gap, h: h + g.gap });
        x = spot.x + w + g.gap; y = spot.y;
      }
    }
    return failed;
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

  return { MM, SEP, PAPERS, FONTS, CARD_STYLES, STYLE_SPEC, LIMITS, overlaps, pageSize, createDoc, resizeAll, groupAt, setArea, clearArea, splitGroup, mergeGroups, normalizeDoc, normalizeStyle, normalizePage, geometry, textHeight,
    buildChunks, layoutPageFlow, layoutPageBlocks, layout, conflicts, findFree, resolvePinned, pageChangeConflicts, applyPageChange,
    effectiveKey, pinAt, unpin, insertAt, setGroup, align, templateOf, normalizeTemplate, applyTemplate };
});
