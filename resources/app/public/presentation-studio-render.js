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
          const countW = measure(h.count, countSize, false, font);
          const runs = fitRuns([{ t: h.main, size, bold: true, color: DOC.ink }, ...(h.rest ? [{ t: ' · ' + h.rest, size, bold: false, color: DOC.ink2 }] : [])], Math.max(10, it.w - countW - 6), measure, font);
          const textY = it.y + it.h - 2 - size * 1.3;
          els.push({ type: 'hdr', key: it.key, x: it.x, y: it.y, w: it.w, h: it.h, runs, textY, size, count: { t: h.count, size: countSize, color: DOC.muted, w: countW }, rule: { x: it.x, y: it.y + it.h - 0.8, w: it.w, h: 0.8 } });
          continue;
        }
        const img = src.image(it.id), imgH = Math.max(16, it.h - g.th), box = { x: it.x, y: it.y, w: it.w, h: imgH };
        const maxW = Math.max(10, it.w - PAD_X * 2);
        let y = it.y + imgH + PAD_TOP;
        const lines = src.lines(it.id).map((f, i) => {
          const size = i === 0 ? s.fs * 1.18 : s.fs, lh = size * 1.3;
          const runs = i === 0 ? [{ t: f.value || '—', size, bold: true, color: DOC.ink }]
            : [...(s.labels && f.label ? [{ t: f.label + ' ', size, bold: false, color: DOC.muted }] : []), { t: f.value || '—', size, bold: false, color: DOC.ink2 }];
          const line = { x: it.x + PAD_X, y, w: maxW, lh, runs: fitRuns(runs, maxW, measure, font) };
          y += lh; return line;
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
          + `<div style="position:absolute;left:0;top:${r2(el.textY - el.y)}pt;white-space:pre;line-height:${r2(el.size * 1.3)}pt">${el.runs.map(runHtml).join('')}</div>`
          + `<div style="position:absolute;right:0;top:${r2(el.textY - el.y + (el.size - el.count.size))}pt;white-space:pre;line-height:${r2(el.count.size * 1.3)}pt">${runHtml(el.count)}</div>`
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
  return { DOC, PAD_X, PAD_TOP, FRAME, fontStack, approxMeasure, canvasMeasure, fitRuns, containRect, build, elementsHtml, documentHtml };
});
