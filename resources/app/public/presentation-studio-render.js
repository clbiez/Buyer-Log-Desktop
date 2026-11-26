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
  const MAX_LINES = Object.freeze({ title: 2, field: 3, header: 6 });
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
      for (let i = 0; i < out.length && i < lines.length; i++) { const f = lines[i], key = (s.labels ? f.label : '') + '\u0001' + f.value; if (!out[i].has(key)) out[i].set(key, f); }
    }
    return out.map(m => [...m.values()]);
  }
  function textPlan(doc, cellW, ids, src, { measure = approxMeasure, values = null } = {}) {
    const s = doc.style, font = s.font, maxW = Math.max(10, cellW - PAD_X * 2);
    const vals = values || distinctValues(doc, ids, src), fieldLines = s.fields.map(() => 1);
    for (let i = 0; i < fieldLines.length && i < vals.length; i++) {
      const cap = i ? MAX_LINES.field : MAX_LINES.title;
      for (const f of vals[i]) {
        const runs = cardRuns(s, f, i);
        // Hiçbir glif 1,1 em'den geniş değil: bu üst sınır sığıyorsa ölçmeye gerek yok.
        if (runs.reduce((w, r) => w + r.t.length * r.size * 1.1, 0) <= maxW) continue;
        if (runs.reduce((w, r) => w + measure(r.t, r.size, r.bold, font), 0) <= maxW) continue; // tek satır: kırma gerekmez
        fieldLines[i] = Math.max(fieldLines[i], wrapRuns(runs, maxW, measure, font, cap).length);
        if (fieldLines[i] >= cap) break;
      }
    }
    const size = s.fs * 1.25, cache = new Map();
    const hdrLines = (h, w) => {
      const hd = src.header(h), key = `${hd.main}\u0001${hd.rest}\u0001${hd.count}\u0001${Math.round(w * 10)}`;
      if (!cache.has(key)) cache.set(key, wrapRuns(headerRuns(hd, size), headerBox(hd, w, size, measure, font).textW, measure, font, MAX_LINES.header).length);
      return cache.get(key);
    };
    return { fieldLines, hdrLines };
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
          const wrapped = wrapRuns(headerRuns(h, size), box.textW, measure, font, room);
          const top = it.y + it.h - 2 - wrapped.length * lh, lines = wrapped.map((runs, i) => ({ y: top + i * lh, runs }));
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
          const out = wrapRuns(cardRuns(s, f, i), maxW, measure, font, room).map((runs, j) => ({ x: it.x + PAD_X, y: y + j * lh, w: maxW, lh, runs }));
          y += room * lh; return out;
        }).filter(l => l.y + l.lh <= it.y + it.h + 0.5);
        els.push({ type: 'card', id: it.id, pinned: Boolean(it.pinned), x: it.x, y: it.y, w: it.w, h: it.h, style: s.card,
          imageBox: box, image: img && img.src ? { src: img.src, ...containRect(box, img) } : null, lines });
      }
      return { id: p.id, w: g.w, h: g.h, font, elements: els };
    });
    return { pages, w: g.w, h: g.h, font };
  }

  const runHtml = r => `<span style="font-size:${r2(r.size)}pt;color:${r.color};font-weight:${r.bold ? 700 : 400}">${esc(r.t)}</span>`;
  /* attrs(el) → ek öznitelik/sınıf (yalnız editörde); belge görünümü aynıdır. */
  function elementsHtml(page, { attrs = null } = {}) {
    return page.elements.map(el => {
      const extra = attrs ? attrs(el) : { attr: '', cls: '', inner: '' };
      if (el.type === 'hdr') {
        return `<div class="psDocHdr${extra.cls}"${extra.attr} style="position:absolute;left:${r2(el.x)}pt;top:${r2(el.y)}pt;width:${r2(el.w)}pt;height:${r2(el.h)}pt">`
          + el.lines.map(l => `<div style="position:absolute;left:0;top:${r2(l.y - el.y)}pt;white-space:pre;line-height:${r2(el.lh)}pt">${l.runs.map(runHtml).join('')}</div>`).join('')
          + (el.count ? `<div style="position:absolute;right:0;top:${r2(el.count.y - el.y)}pt;white-space:pre;line-height:${r2(el.count.size * 1.3)}pt">${runHtml(el.count)}</div>` : '')
          + `<div style="position:absolute;left:0;top:${r2(el.rule.y - el.y)}pt;width:100%;height:${el.rule.h}pt;background:${DOC.rule}"></div>${extra.inner}</div>`;
      }
      // Çerçeve, görsel zemininin üstünde kalması için ayrı katmandır (aşağıda).
      const frame = el.style === 'shadow' ? 'box-shadow:0 1pt 4pt rgba(16,24,40,.18);' : '';
      const b = el.imageBox;
      const image = el.image ? `<img src="${esc(el.image.src)}" alt="" draggable="false" style="position:absolute;left:${r2(el.image.x - el.x)}pt;top:${r2(el.image.y - el.y)}pt;width:${r2(el.image.w)}pt;height:${r2(el.image.h)}pt">` : '';
      const lines = el.lines.map(l => `<div style="position:absolute;left:${r2(l.x - el.x)}pt;top:${r2(l.y - el.y)}pt;width:${r2(l.w)}pt;white-space:pre;overflow:hidden;line-height:${r2(l.lh)}pt">${l.runs.map(runHtml).join('')}</div>`).join('');
      return `<div class="psDocCard${extra.cls}"${extra.attr} style="position:absolute;left:${r2(el.x)}pt;top:${r2(el.y)}pt;width:${r2(el.w)}pt;height:${r2(el.h)}pt;background:${DOC.card};overflow:hidden;${frame}">`
        + `<div style="position:absolute;left:0;top:0;width:${r2(b.w)}pt;height:${r2(b.h)}pt;background:${DOC.image}"></div>${image}${lines}`
        + (el.style === 'frame' ? `<div style="position:absolute;inset:0;pointer-events:none;box-shadow:inset 0 0 0 ${FRAME}pt ${DOC.line}"></div>` : '') + `${extra.inner}</div>`;
    }).join('');
  }
  /* Baskıya hazır bağımsız belge: Electron printToPDF (JS kapalı) ve tarayıcı yazdırması. */
  function documentHtml(list, title) {
    const pages = list.pages.map(p => `<section style="position:relative;width:${r2(p.w)}pt;height:${r2(p.h)}pt;overflow:hidden;background:${DOC.paper};font-family:${fontStack(list.font)};break-after:page;page-break-after:always">${elementsHtml(p)}</section>`).join('');
    return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>@page{size:${r2(list.w)}pt ${r2(list.h)}pt;margin:0}html,body{margin:0;padding:0;background:${DOC.paper}}*{-webkit-print-color-adjust:exact;print-color-adjust:exact}section:last-child{break-after:auto!important;page-break-after:auto!important}</style></head><body>${pages}</body></html>`;
  }
  return { DOC, PAD_X, PAD_TOP, FRAME, MAX_LINES, fontStack, approxMeasure, canvasMeasure, fitRuns, wrapRuns, distinctValues, textPlan, containRect, build, elementsHtml, documentHtml };
});
