/* ===================================================================
   Presentation Studio — ortak çizim listesi (önizleme = PDF = PPTX).

   Belge + yerleşim → sayfa başına öğe listesi. Metin satırları burada bir
   kez ölçülür ve gerekiyorsa "…" ile kısaltılır; görselin sığdırılmış
   konumu burada bir kez hesaplanır. Editör ve PDF aynı pageHtml()
   çıktısını, PowerPoint yazıcısı aynı listeyi kullanır; böylece satır
   kırılması ve konumlar üç yüzeyde aynıdır.

   Belge renkleri ekran temasından bağımsızdır (DESIGN_SYSTEM.md §8) ve
   export-document-palette.json değerleridir; karanlık temada da kâğıt beyazdır.
   =================================================================== */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.BLPresentationRender = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';
  const DOC = Object.freeze({ paper: '#FFFFFF', card: '#FFFFFF', image: '#F5F5F8', ink: '#1D1F20', ink2: '#5D5D60', muted: '#7A7A7D', line: '#D4D4D7', rule: '#B7B7BA' });
  const PAD_X = 5, PAD_TOP = 4, FRAME = 0.6;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const r2 = v => Math.round(v * 100) / 100;
  // Tek tırnak: değer style="…" özniteliğine kaçışsız yazılır (PDF belgesi dahil).
  const fontStack = font => `'${String(font).replace(/['"<>&;]/g, '')}',Arial,sans-serif`;
  /* Ölçüm: tarayıcıda canvas; Node testlerinde yaklaşık genişlik. */
  function approxMeasure(t, size, bold) { return String(t).length * size * (bold ? 0.56 : 0.52); }
  function canvasMeasure(doc) {
    const canvas = doc && doc.createElement ? doc.createElement('canvas') : null, ctx = canvas && canvas.getContext ? canvas.getContext('2d') : null;
    if (!ctx) return (t, size, bold) => approxMeasure(t, size, bold);
    const cache = new Map();
    return (t, size, bold, font) => {
      const key = `${bold ? 1 : 0}|${size}|${font}|${t}`;
      if (cache.has(key)) return cache.get(key);
      ctx.font = `${bold ? 700 : 400} ${size}pt ${fontStack(font)}`;
      const w = ctx.measureText(String(t)).width * 0.75; // px → pt
      if (cache.size > 20000) cache.clear();
      cache.set(key, w); return w;
    };
  }
  /* Satırı genişliğe sığdırır: son parçadan karakter atar, "…" ekler. */
  function fitRuns(runs, maxW, measure, font) {
    const width = list => list.reduce((s, r) => s + measure(r.t, r.size, r.bold, font), 0);
    if (width(runs) <= maxW) return runs;
    const out = runs.map(r => ({ ...r }));
    while (out.length) {
      const last = out[out.length - 1];
      let lo = 0, hi = last.t.length;
      while (lo < hi) { const mid = Math.ceil((lo + hi) / 2); last.t = runs[out.length - 1].t.slice(0, mid).trimEnd() + '…'; if (width(out) <= maxW) lo = mid; else hi = mid - 1; }
      last.t = runs[out.length - 1].t.slice(0, lo).trimEnd() + '…';
      if (lo > 0 && width(out) <= maxW) return out;
      out.pop();
    }
    return [];
  }
  /* Satır kırma: kelime sınırından böler (boşluksuz uzun parça karakterden),
     biçimi (kalın/renk) korur. maxLines aşılırsa yalnız son satır "…" ile biter. */
  const MAX_LINES = Object.freeze({ title: 2, field: 3, header: 6, chips: 4 });
  function wrapRuns(runs, maxW, measure, font, maxLines = 1) {
    const w = r => measure(r.t, r.size, r.bold, font), total = list => list.reduce((s, r) => s + w(r), 0);
    if (total(runs) <= maxW) return [runs];
    const tokens = [];
    for (const r of runs) for (const t of String(r.t).split(/(\s+)/)) if (t) tokens.push({ ...r, t });
    const lines = []; let cur = [], curW = 0;
    const push = () => { while (cur.length && !cur[cur.length - 1].t.trim()) cur.pop(); if (cur.length) lines.push(cur); cur = []; curW = 0; };
    for (let i = 0; i < tokens.length; i++) {
      let tk = tokens[i];
      if (!cur.length && !tk.t.trim()) continue;
      let tw = w(tk);
      if (curW + tw <= maxW) { cur.push(tk); curW += tw; continue; }
      if (tk.t.trim() && cur.length) { push(); i--; continue; }
      if (!tk.t.trim()) { push(); continue; }
      // Tek başına sığmayan parça: sığan kadarını bu satıra al.
      let lo = 1, hi = tk.t.length;
      while (lo < hi) { const mid = Math.ceil((lo + hi) / 2); if (w({ ...tk, t: tk.t.slice(0, mid) }) <= maxW) lo = mid; else hi = mid - 1; }
      cur.push({ ...tk, t: tk.t.slice(0, lo) }); push();
      tokens.splice(i + 1, 0, { ...tk, t: tk.t.slice(lo) });
    }
    push();
    // Aynı biçimli komşu parçaları birleştir (daha az span/PowerPoint run).
    const merged = lines.map(l => l.reduce((out, r) => { const last = out[out.length - 1]; if (last && last.size === r.size && last.bold === r.bold && last.color === r.color) last.t += r.t; else out.push({ ...r }); return out; }, []));
    if (merged.length <= maxLines) return merged;
    const keep = merged.slice(0, maxLines), rest = merged.slice(maxLines - 1).flat();
    const tail = rest.reduce((out, r) => { const last = out[out.length - 1]; if (last && last.size === r.size && last.bold === r.bold && last.color === r.color) last.t += (/\s$/.test(last.t) ? '' : ' ') + r.t.trimStart(); else out.push({ ...r }); return out; }, []);
    const last = fitRuns(tail, maxW, measure, font);
    // fitRuns yalnız taşarsa "…" ekler; burada metin her zaman devam ettiği için işaretle.
    if (last.length && !last[last.length - 1].t.endsWith('…')) {
      const lr = last[last.length - 1];
      while (lr.t && total(last) + measure('…', lr.size, lr.bold, font) > maxW) lr.t = lr.t.slice(0, -1);
      lr.t = lr.t.trimEnd() + '…';
    }
    keep[maxLines - 1] = last;
    return keep;
  }
  /* ---------- Çip görünümü (Kumaş, Artwork Detail) ----------
     BL tablo hücresindeki kartların belge karşılığı. Renkler tasarım token'larının
     açık tema değerleri; etiket tonları tablodaki gibi %10 dolgu / %45 çerçeve karışımı. */
  const blend = (c, k) => { const n = parseInt(c.slice(1), 16), ch = sh => Math.round(((n >> sh) & 255) * k + 255 * (1 - k)); return '#' + [16, 8, 0].map(sh => ch(sh).toString(16).padStart(2, '0')).join('').toUpperCase(); };
  const TONES = { 1: '#376F73', 2: '#81523E', 3: '#665B35', 4: '#536478', 5: '#356A96', eco: '#386E4F' };
  const CHIP = Object.freeze({ line: '#CBD1D9', fill: '#FFFFFF', ink: '#16212D', sub: '#EAF2F8', subInk: '#245578', part: '#374454', partInk: '#FFFFFF', muted: '#5F6F80',
    tone: Object.freeze(Object.fromEntries(Object.entries(TONES).map(([k, c]) => [k, Object.freeze({ ink: c, fill: blend(c, 0.1), line: blend(c, 0.45) })]))) });
  const CHIP_PAD = 2.5, CHIP_GAP = 2;
  const chipBox = lh => ({ h: Math.max(4, lh - 1.6), top: 0.8 });
  const words = (t, size, bold, color) => String(t).split(/(\s+)/).filter(w => w.trim()).map(w => ({ type: 'text', t: w, size, bold, color }));
  /* Model satırı → atomlar: parça harfi, çipler, etiketler, sağda toplam; satırlar arası zorunlu kırılma. */
  function chipAtoms(model, size) {
    const cs = size * 0.86, out = [];
    model.forEach((line, i) => {
      if (i) out.push({ type: 'br' });
      if (line.label) out.push({ type: 'part', t: line.label, size: cs });
      for (const it of line.items || []) {
        if (it.kind === 'none') { out.push(...words(it.t, cs, false, CHIP.muted)); continue; }
        const tone = it.kind === 'tag' ? CHIP.tone[it.tone] || CHIP.tone[5] : null;
        const segs = it.kind === 'code' ? [{ t: it.t, fill: CHIP.sub, ink: CHIP.subInk, bold: true }]
          : tone ? [{ t: it.t, fill: tone.fill, ink: tone.ink, bold: false }]
          : [{ t: it.t, fill: CHIP.fill, ink: CHIP.ink, bold: false }, ...(it.sub ? [{ t: it.sub, fill: CHIP.sub, ink: CHIP.subInk, bold: false }] : [])];
        out.push({ type: 'chip', segs, line: tone ? tone.line : CHIP.line, size: cs });
      }
      if (line.total) out.push({ type: 'total', t: line.total, size: cs, bold: true, color: CHIP.ink });
    });
    return out;
  }
  /* Atomları genişliğe dizer; satır sayısı maxRows'u aşarsa son satır "…" ile biter. */
  function layoutAtoms(atoms, maxW, measure, font, maxRows = 99) {
    const rows = [[]]; let x = 0;
    const segW = (sg, a) => measure(sg.t, a.size, sg.bold, font) + CHIP_PAD * 2;
    const width = a => {
      if (a.type === 'chip') return a.segs.reduce((w, sg) => w + segW(sg, a), 0);
      if (a.type === 'part') return Math.max(measure(a.t, a.size, true, font) + 3, a.size * 1.5);
      return measure(a.t, a.size, a.bold, font);
    };
    const space = a => (a.type === 'text' ? measure(' ', a.size, false, font) : CHIP_GAP);
    for (const src of atoms) {
      if (src.type === 'br') { rows.push([]); x = 0; continue; }
      const a = { ...src, segs: src.segs && src.segs.map(sg => ({ ...sg })) };
      let w = width(a);
      if (a.type === 'total') {
        const cur = rows[rows.length - 1], gap = cur.length ? CHIP_GAP : 0;
        a.w = w; a.right = true;
        if (x + gap + w > maxW + 0.01) rows.push([]);
        a.x = Math.max(0, maxW - w); rows[rows.length - 1].push(a); x = maxW;
        continue;
      }
      if (rows[rows.length - 1].length && x + space(a) + w > maxW) { rows.push([]); x = 0; }
      if (w > maxW) {
        // Tek başına sığmayan çip/metin: son parça "…" ile kısaltılır (tablodaki isShrink gibi).
        const last = a.type === 'chip' ? a.segs[a.segs.length - 1] : a, base = last.t;
        let lo = 0, hi = base.length;
        while (lo < hi) { const mid = Math.ceil((lo + hi) / 2); last.t = base.slice(0, mid).trimEnd() + '…'; if (width(a) <= maxW) lo = mid; else hi = mid - 1; }
        last.t = base.slice(0, lo).trimEnd() + '…'; w = width(a);
      }
      const cur = rows[rows.length - 1], g2 = cur.length ? space(a) : 0;
      a.x = x + g2; a.w = w;
      if (a.segs) a.segs.forEach(sg => { sg.w = segW(sg, a); });
      cur.push(a); x = a.x + w;
    }
    const out = rows.filter((r, i) => r.length || i === 0);
    if (out.length > maxRows) {
      const keep = out.slice(0, maxRows), last = keep[maxRows - 1], size = (last[0] && last[0].size) || 7;
      const dots = { type: 'text', t: '…', size, bold: false, color: CHIP.muted, w: measure('…', size, false, font) };
      while (last.length && last[last.length - 1].x + last[last.length - 1].w + 2 + dots.w > maxW) last.pop();
      dots.x = last.length ? last[last.length - 1].x + last[last.length - 1].w + 2 : 0; last.push(dots);
      return keep;
    }
    return out;
  }
  const cardAtoms = (s, f, i) => [...(s.labels && f.label && i ? words(f.label, s.fs, false, DOC.muted) : []), ...chipAtoms(f.chips, i ? s.fs : s.fs * 1.18)];
  const headerAtoms = (hd, size) => hd.parts.flatMap((p, j) => [...(j ? [{ type: 'text', t: '·', size, bold: false, color: DOC.ink2 }] : []), ...(p.chips ? chipAtoms(p.chips, size).filter(a => a.type !== 'br') : words(p.text, size, j === 0, j === 0 ? DOC.ink : DOC.ink2))]);
  const cardRuns = (s, f, i) => i === 0 ? [{ t: f.value || '—', size: s.fs * 1.18, bold: true, color: DOC.ink }]
    : [...(s.labels && f.label ? [{ t: f.label + ' ', size: s.fs, bold: false, color: DOC.muted }] : []), { t: f.value || '—', size: s.fs, bold: false, color: DOC.ink2 }];
  /* Dar başlıkta model sayısı metne yer bırakmıyorsa gösterilmez; başlık tam genişliği kullanır. */
  function headerBox(hd, w, size, measure, font) {
    const countW = measure(hd.count, size * 0.82, false, font), textW = w - countW - 6;
    return textW >= Math.max(70, w * 0.55) ? { textW, countW, showCount: true } : { textW: Math.max(10, w), countW: 0, showCount: false };
  }
  const headerRuns = (h, size) => [{ t: h.main, size, bold: true, color: DOC.ink }, ...(h.rest ? [{ t: ' · ' + h.rest, size, bold: false, color: DOC.ink2 }] : [])];
  /* Metin planı: her alanın en uzun değerinin kartta kaç satır gerektirdiği
     (üst sınırlı) ve grup başlığının satır sayısı. Yerleşim motoru kart ve
     başlık yüksekliğini bundan hesaplar; tüm kartlarda alanlar hizalı kalır. */
  /* Alan başına farklı değerler: genişlik değişse de (kaydırıcı) değişmez; bir kez toplanır. */
  function distinctValues(doc, ids, src) {
    const s = doc.style, out = s.fields.map(() => new Map());
    for (const id of ids) {
      const lines = src.lines(id);
      for (let i = 0; i < out.length && i < lines.length; i++) { const f = lines[i], key = (s.labels ? f.label : '') + '\u0001' + f.value + (f.chips ? '\u0001c' : ''); if (!out[i].has(key)) out[i].set(key, f); }
    }
    return out.map(m => [...m.values()]);
  }
  function textPlan(doc, cellW, ids, src, { measure = approxMeasure, values = null } = {}) {
    const s = doc.style, font = s.font, maxW = Math.max(10, cellW - PAD_X * 2);
    const vals = values || distinctValues(doc, ids, src), fieldLines = s.fields.map(() => 1);
    for (let i = 0; i < fieldLines.length && i < vals.length; i++) {
      const cap = vals[i].some(f => f.chips) ? MAX_LINES.chips : i ? MAX_LINES.field : MAX_LINES.title;
      for (const f of vals[i]) {
        if (f.chips) { fieldLines[i] = Math.max(fieldLines[i], layoutAtoms(cardAtoms(s, f, i), maxW, measure, font, cap).length); if (fieldLines[i] >= cap) break; continue; }
        const runs = cardRuns(s, f, i);
        // Hiçbir glif 1,1 em'den geniş değil: bu üst sınır sığıyorsa ölçmeye gerek yok.
        if (runs.reduce((w, r) => w + r.t.length * r.size * 1.1, 0) <= maxW) continue;
        if (runs.reduce((w, r) => w + measure(r.t, r.size, r.bold, font), 0) <= maxW) continue; // tek satır: kırma gerekmez
        fieldLines[i] = Math.max(fieldLines[i], wrapRuns(runs, maxW, measure, font, cap).length);
        if (fieldLines[i] >= cap) break;
      }
    }
    const size = s.fs * 1.25, cache = new Map(), natural = new Map();
    const plan = { fieldLines, approx: false };
    plan.hdrLines = (h, w) => {
      const hd = src.header(h), base = `${hd.main}\u0001${hd.rest}\u0001${hd.count}\u0001${hd.parts ? 'c' : ''}`;
      if (plan.approx) {
        // Kaydırıcı sürüklenirken: tek satırlık doğal genişlikten tahmin (genişlikten bağımsız önbellek); bırakınca kesin hesap.
        if (!natural.has(base)) natural.set(base, hd.parts ? layoutAtoms(headerAtoms(hd, size), 1e9, measure, font).reduce((m, r) => Math.max(m, r.reduce((x, a) => Math.max(x, a.x + a.w), 0)), 0) : headerRuns(hd, size).reduce((x, r) => x + measure(r.t, r.size, r.bold, font), 0));
        const tw = headerBox(hd, w, size, measure, font).textW;
        return Math.max(1, Math.min(MAX_LINES.header, Math.ceil(natural.get(base) / Math.max(10, tw))));
      }
      const key = `${base}\u0001${Math.round(w * 10)}`;
      if (!cache.has(key)) { const tw = headerBox(hd, w, size, measure, font).textW; cache.set(key, hd.parts ? layoutAtoms(headerAtoms(hd, size), tw, measure, font, MAX_LINES.header).length : wrapRuns(headerRuns(hd, size), tw, measure, font, MAX_LINES.header).length); }
      return cache.get(key);
    };
    return plan;
  }
  function containRect(box, natural) {
    if (!natural || !natural.w || !natural.h) return { ...box };
    const k = Math.min(box.w / natural.w, box.h / natural.h), w = natural.w * k, h = natural.h * k;
    return { x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2, w, h };
  }

  /* src: { lines(id) → [{label, value}], image(id) → {src, w, h} | null, header(item) → {main, rest, count} } */
  function build(doc, res, src, { measure = approxMeasure } = {}) {
    const s = doc.style, g = res.g, font = s.font;
    const pages = res.pages.map(p => {
      const els = [];
      for (const it of p.items) {
        if (it.kind === 'hdr') {
          const h = src.header(it), size = s.fs * 1.25, countSize = size * 0.82;
          const box = headerBox(h, it.w, size, measure, font), countW = box.countW;
          // Bandın aldığı satır sayısı kadar kırılır; metin alta (çizgiye) yaslanır.
          const lh = size * 1.3, room = Math.max(1, Math.round((it.h - g.hH) / (g.hLine || lh)) + 1);
          const wrapped = h.parts ? layoutAtoms(headerAtoms(h, size), box.textW, measure, font, room) : wrapRuns(headerRuns(h, size), box.textW, measure, font, room);
          const top = it.y + it.h - 2 - wrapped.length * lh, lines = wrapped.map((r, i) => (h.parts ? { y: top + i * lh, atoms: r, box: chipBox(lh) } : { y: top + i * lh, runs: r }));
          const lastY = lines.length ? lines[lines.length - 1].y : it.y + it.h - 2 - lh;
          els.push({ type: 'hdr', key: it.key, x: it.x, y: it.y, w: it.w, h: it.h, lines, lh, size, count: box.showCount ? { t: h.count, size: countSize, color: DOC.muted, w: countW, y: lastY + (size - countSize) } : null, rule: { x: it.x, y: it.y + it.h - 0.8, w: it.w, h: 0.8 } });
          continue;
        }
        const img = src.image(it.id), imgH = Math.max(16, it.h - g.th), box = { x: it.x, y: it.y, w: it.w, h: imgH };
        const maxW = Math.max(10, it.w - PAD_X * 2);
        let y = it.y + imgH + PAD_TOP;
        // Her alan plandaki satır sayısı kadar yer alır: kısa değerde boş kalır, alanlar kartlar arasında hizalıdır.
        const lines = src.lines(it.id).flatMap((f, i) => {
          const size = i === 0 ? s.fs * 1.18 : s.fs, lh = size * 1.3, room = (g.fieldLines && g.fieldLines[i]) || 1;
          const out = f.chips
            ? layoutAtoms(cardAtoms(s, f, i), maxW, measure, font, room).map((atoms, j) => ({ x: it.x + PAD_X, y: y + j * lh, w: maxW, lh, atoms, box: chipBox(lh) }))
            : wrapRuns(cardRuns(s, f, i), maxW, measure, font, room).map((runs, j) => ({ x: it.x + PAD_X, y: y + j * lh, w: maxW, lh, runs }));
          y += room * lh; return out;
        }).filter(l => l.y + l.lh <= it.y + it.h + 0.5);
        els.push({ type: 'card', id: it.id, pinned: Boolean(it.pinned), x: it.x, y: it.y, w: it.w, h: it.h, style: s.card,
          imageBox: box, image: img && img.src ? { src: img.src, ...containRect(box, img) } : null, lines });
      }
      return { id: p.id, w: g.w, h: g.h, font, elements: els };
    });
    return { pages, w: g.w, h: g.h, font };
  }

  /* Çip satırı: her atom satır içinde mutlak konumlu; çip kutusu satır yüksekliğinin içinde ortalanır. */
  /* Çip öğelerinin sabit yerleşim kuralları sınıflarda (öğe başına satır içi stil ayrıştırması büyük
     sunumda kare başına onlarca ms tutuyordu); veri renkleri ve konumlar satır içi kalır. Aynı metin
     editörde presentation-studio.css'te, PDF belgesinde <style> içinde (test eşitliği denetler). */
  const DOC_CSS = '.psC{position:absolute;white-space:pre;outline-offset:-0.6pt}.psS{position:absolute;top:0;height:100%;text-align:center}.psP{position:absolute;text-align:center;font-weight:700}.psT{position:absolute;top:0;white-space:pre}';
  function atomsHtml(atoms, lh, lite = false) {
    const b = chipBox(lh), bh = r2(b.h), bt = r2(b.top), lhp = r2(lh);
    return atoms.map(a => {
      // Kaydırıcı sürüklenirken (lite) çip tek öğe: parça metinleri yan yana, ilk parçanın dolgusu; bırakınca tam çizim.
      if (a.type === 'chip' && lite) return `<span class="psC" style="left:${r2(a.x)}pt;top:${bt}pt;width:${r2(a.w)}pt;height:${bh}pt;font-size:${r2(a.size)}pt;outline:0.6pt solid ${a.line};background:${a.segs[0].fill};color:${a.segs[0].ink};line-height:${bh}pt;text-align:center">${esc(a.segs.map(sg => sg.t).join('  '))}</span>`;
      if (a.type === 'chip') {
        let off = 0;
        const segs = a.segs.map(sg => { const html = `<span class="psS" style="left:${r2(off)}pt;width:${r2(sg.w)}pt;background:${sg.fill};color:${sg.ink};line-height:${bh}pt${sg.bold ? ';font-weight:700' : ''}">${esc(sg.t)}</span>`; off += sg.w; return html; }).join('');
        // Çerçeve: outline alt öğelerin (parça dolguları) üstünde çizilir; ayrı katman öğesine gerek yok.
        return `<span class="psC" style="left:${r2(a.x)}pt;top:${bt}pt;width:${r2(a.w)}pt;height:${bh}pt;font-size:${r2(a.size)}pt;outline:0.6pt solid ${a.line}">${segs}</span>`;
      }
      if (a.type === 'part') return `<span class="psP" style="left:${r2(a.x)}pt;top:${bt}pt;width:${r2(a.w)}pt;height:${bh}pt;background:${CHIP.part};color:${CHIP.partInk};font-size:${r2(a.size)}pt;line-height:${bh}pt">${esc(a.t)}</span>`;
      return `<span class="psT" style="left:${r2(a.x)}pt;font-size:${r2(a.size)}pt;color:${a.color};line-height:${lhp}pt${a.bold ? ';font-weight:700' : ''}">${esc(a.t)}</span>`;
    }).join('');
  }
  const runHtml = r => `<span style="font-size:${r2(r.size)}pt;color:${r.color};font-weight:${r.bold ? 700 : 400}">${esc(r.t)}</span>`;
  /* attrs(el) → ek öznitelik/sınıf (yalnız editörde); belge görünümü aynıdır. */
  function elementsHtml(page, { attrs = null, lite = false } = {}) {
    return page.elements.map(el => {
      const extra = attrs ? attrs(el) : { attr: '', cls: '', inner: '' };
      if (el.type === 'hdr') {
        return `<div class="psDocHdr${extra.cls}"${extra.attr} style="position:absolute;left:${r2(el.x)}pt;top:${r2(el.y)}pt;width:${r2(el.w)}pt;height:${r2(el.h)}pt">`
          + el.lines.map(l => (l.atoms
            ? `<div style="position:absolute;left:0;top:${r2(l.y - el.y)}pt;width:100%;height:${r2(el.lh)}pt">${atomsHtml(l.atoms, el.lh, lite)}</div>`
            : `<div style="position:absolute;left:0;top:${r2(l.y - el.y)}pt;white-space:pre;line-height:${r2(el.lh)}pt">${l.runs.map(runHtml).join('')}</div>`)).join('')
          + (el.count ? `<div style="position:absolute;right:0;top:${r2(el.count.y - el.y)}pt;white-space:pre;line-height:${r2(el.count.size * 1.3)}pt">${runHtml(el.count)}</div>` : '')
          + `<div style="position:absolute;left:0;top:${r2(el.rule.y - el.y)}pt;width:100%;height:${el.rule.h}pt;background:${DOC.rule}"></div>${extra.inner}</div>`;
      }
      // Çerçeve, görsel zemininin üstünde kalması için ayrı katmandır (aşağıda).
      const frame = el.style === 'shadow' ? 'box-shadow:0 1pt 4pt rgba(16,24,40,.18);' : '';
      const b = el.imageBox;
      const image = el.image ? `<img src="${esc(el.image.src)}" alt="" draggable="false" style="position:absolute;left:${r2(el.image.x - el.x)}pt;top:${r2(el.image.y - el.y)}pt;width:${r2(el.image.w)}pt;height:${r2(el.image.h)}pt">` : '';
      const lines = el.lines.map(l => (l.atoms
        ? `<div style="position:absolute;left:${r2(l.x - el.x)}pt;top:${r2(l.y - el.y)}pt;width:${r2(l.w)}pt;height:${r2(l.lh)}pt">${atomsHtml(l.atoms, l.lh, lite)}</div>`
        : `<div style="position:absolute;left:${r2(l.x - el.x)}pt;top:${r2(l.y - el.y)}pt;width:${r2(l.w)}pt;white-space:pre;overflow:hidden;line-height:${r2(l.lh)}pt">${l.runs.map(runHtml).join('')}</div>`)).join('');
      return `<div class="psDocCard${extra.cls}"${extra.attr} style="position:absolute;left:${r2(el.x)}pt;top:${r2(el.y)}pt;width:${r2(el.w)}pt;height:${r2(el.h)}pt;background:${DOC.card};overflow:hidden;${frame}">`
        + `<div style="position:absolute;left:0;top:0;width:${r2(b.w)}pt;height:${r2(b.h)}pt;background:${DOC.image}"></div>${image}${lines}`
        + (el.style === 'frame' ? `<div style="position:absolute;inset:0;pointer-events:none;box-shadow:inset 0 0 0 ${FRAME}pt ${DOC.line}"></div>` : '') + `${extra.inner}</div>`;
    }).join('');
  }
  /* Baskıya hazır bağımsız belge: Electron printToPDF (JS kapalı) ve tarayıcı yazdırması. */
  function documentHtml(list, title) {
    const pages = list.pages.map(p => `<section style="position:relative;width:${r2(p.w)}pt;height:${r2(p.h)}pt;overflow:hidden;background:${DOC.paper};font-family:${fontStack(list.font)};break-after:page;page-break-after:always">${elementsHtml(p)}</section>`).join('');
    return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>${DOC_CSS}@page{size:${r2(list.w)}pt ${r2(list.h)}pt;margin:0}html,body{margin:0;padding:0;background:${DOC.paper}}*{-webkit-print-color-adjust:exact;print-color-adjust:exact}section:last-child{break-after:auto!important;page-break-after:auto!important}</style></head><body>${pages}</body></html>`;
  }
  return { DOC, PAD_X, PAD_TOP, FRAME, MAX_LINES, CHIP, DOC_CSS, chipBox, fontStack, approxMeasure, canvasMeasure, fitRuns, wrapRuns, chipAtoms, layoutAtoms, distinctValues, textPlan, containRect, build, elementsHtml, documentHtml };
});
