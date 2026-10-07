/* ===================================================================
   LCW AI çıktı YERLEŞİMİ (layout) — tek kaynak.

   Hem sunucu (output-pptx / output-xlsx / output-html) hem de tarayıcıdaki
   görsel Yerleşim aracı (lcwai-output-editor.js) bu dosyayı kullanır; canlı
   önizleme ile oluşturulan dosya aynı hesaptan çıkar.

   Ayarlar biçime göre birimlidir: PowerPoint pt (16:9 slayt 960 × 540 pt),
   PDF/HTML px (+ sayfa kenarı mm), Excel pt. Her değer sınır içinde tutulur;
   bilinmeyen alan atılır. Model ızgarası (sütun × satır) PowerPoint'te
   slayt başına, PDF'te sayfa başına kaç model kartı yerleşeceğini belirler.
   =================================================================== */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.BLOutputLayout = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  // [min, max, varsayılan, adım]
  const SPEC = Object.freeze({
    pptx: {
      headerHeight: [48, 160, 96, 2], titleSize: [16, 44, 30, 1], bodySize: [10, 28, 20, 1], tableSize: [0, 18, 0, 0.5],
      margin: [20, 80, 48, 2], gap: [4, 32, 14, 1], columns: [1, 8, 3, 1], rows: [1, 6, 2, 1], cardTextSize: [8, 18, 12, 0.5], imageShare: [30, 85, 70, 1],
    },
    pdf: {
      headerHeight: [40, 160, 72, 2], titleSize: [18, 44, 30, 1], bodySize: [10, 20, 14, 0.5], tableSize: [0, 18, 0, 0.5],
      margin: [6, 25, 12, 1], gap: [4, 32, 12, 1], columns: [1, 8, 3, 1], rows: [1, 6, 3, 1], cardTextSize: [9, 18, 13, 0.5], imageShare: [30, 85, 65, 1],
    },
    xlsx: {
      headerHeight: [15, 60, 22, 1], titleSize: [10, 28, 16, 1], bodySize: [8, 16, 11, 0.5], imageSize: [30, 160, 60, 2],
    },
  });
  const FLAGS = Object.freeze({ pptx: ['showTitle', 'showSubtitle', 'showNote'], pdf: ['showTitle', 'showSubtitle', 'showNote'], xlsx: [] });
  const specKey = format => (format === 'html' ? 'pdf' : SPEC[format] ? format : null);

  function defaults(format) {
    const key = specKey(format);
    if (!key) return null;
    const out = {};
    for (const [name, spec] of Object.entries(SPEC[key])) out[name] = spec[2];
    for (const flag of FLAGS[key]) out[flag] = true;
    return out;
  }

  /* Sınır içine alınmış tam yerleşim (eksik alan varsayılanla dolar). */
  function normalizeLayout(format, raw) {
    const key = specKey(format);
    if (!key) return null;
    const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    const out = defaults(format);
    for (const [name, [min, max, , step]] of Object.entries(SPEC[key])) {
      const value = Number(source[name]);
      if (!Number.isFinite(value)) continue;
      const stepped = Math.round(value / step) * step;
      out[name] = Math.min(max, Math.max(min, Number(stepped.toFixed(2))));
    }
    for (const flag of FLAGS[key]) if (typeof source[flag] === 'boolean') out[flag] = source[flag];
    return out;
  }
  const isDefault = (format, layout) => JSON.stringify(normalizeLayout(format, layout)) === JSON.stringify(defaults(format));
  const perPage = layout => Math.max(1, (Number(layout && layout.columns) || 1) * (Number(layout && layout.rows) || 1));

  /* Hazır yerleşimler: yalnız değişen alanlar (biçime göre). */
  const PRESETS = Object.freeze({
    standard: { pptx: {}, pdf: {}, xlsx: {} },
    compact: {
      pptx: { headerHeight: 64, titleSize: 22, bodySize: 16, tableSize: 9, margin: 28, gap: 8, columns: 4, rows: 3, cardTextSize: 9.5, imageShare: 66 },
      pdf: { headerHeight: 48, titleSize: 22, bodySize: 12, tableSize: 10.5, margin: 8, gap: 8, columns: 4, rows: 4, cardTextSize: 10.5, imageShare: 62 },
      xlsx: { headerHeight: 18, titleSize: 13, bodySize: 9, imageSize: 40 },
    },
    largeImage: {
      pptx: { headerHeight: 72, titleSize: 26, columns: 3, rows: 1, cardTextSize: 14, imageShare: 80, gap: 18 },
      pdf: { headerHeight: 56, titleSize: 26, columns: 2, rows: 2, cardTextSize: 14, imageShare: 76, gap: 16 },
      xlsx: { imageSize: 120, bodySize: 12 },
    },
    catalog: {
      pptx: { headerHeight: 56, titleSize: 20, margin: 24, gap: 6, columns: 6, rows: 3, cardTextSize: 8.5, imageShare: 72, showNote: false },
      pdf: { headerHeight: 44, titleSize: 20, margin: 8, gap: 6, columns: 5, rows: 5, cardTextSize: 9.5, imageShare: 72, showNote: false },
      xlsx: { headerHeight: 18, bodySize: 9, imageSize: 80 },
    },
  });
  function applyPreset(format, name, current) {
    const key = specKey(format);
    const preset = PRESETS[name] && PRESETS[name][key];
    if (!preset) return normalizeLayout(format, current);
    return name === 'standard' ? defaults(format) : normalizeLayout(format, { ...(current || {}), ...preset });
  }

  /* ---------------- PowerPoint geometrisi (pt) ---------------- */
  const SLIDE = Object.freeze({ width: 960, height: 540, footer: 44 });
  function pptxGeometry(raw) {
    const layout = normalizeLayout('pptx', raw);
    const band = layout.headerHeight;
    const contentTop = band + 14;
    return { layout, margin: layout.margin, band, contentTop, contentH: SLIDE.height - contentTop - SLIDE.footer, width: SLIDE.width - layout.margin * 2 };
  }
  /* Galeri kartlarının konumu: bir slayttaki n kart için { x, y, w, h, imgH }. */
  function galleryCells(raw, count) {
    const g = pptxGeometry(raw);
    const { columns, rows, gap, imageShare } = g.layout;
    const cardW = (g.width - gap * (columns - 1)) / columns;
    const cardH = (g.contentH - 8 - gap * (rows - 1)) / rows;
    const imgH = Math.max(16, (cardH - 14) * imageShare / 100);
    return Array.from({ length: Math.min(count, columns * rows) }, (_, i) => ({
      x: g.margin + (i % columns) * (cardW + gap), y: g.contentTop + 8 + Math.floor(i / columns) * (cardH + gap), w: cardW, h: cardH, imgH,
    }));
  }

  /* ---------------- PDF/HTML: tema üstüne yerleşim CSS'i ---------------- */
  const PAGE = Object.freeze({ portrait: [210, 297], landscape: [297, 210], top: 14, bottom: 16, reserve: 22 });
  function pageBox(raw, orientation) {
    const layout = normalizeLayout('pdf', raw);
    const [w, h] = PAGE[orientation === 'landscape' ? 'landscape' : 'portrait'];
    // İlk galeri parçası rapor başlığı + bölüm başlığının altına sığsın diye kısalır
    // (px → mm: × 0.2646). Sayfa başına model sayısı değişmez; kartlar kısalır.
    const head = layout.headerHeight * 0.2646 + layout.titleSize * 0.2646 * 2.6 + 30;
    return { width: w - layout.margin * 2, height: h - PAGE.top - PAGE.bottom - PAGE.reserve, firstHeight: Math.max(60, h - PAGE.top - PAGE.bottom - PAGE.reserve - head) };
  }
  function layoutCss(raw, { orientation = 'portrait' } = {}) {
    const l = normalizeLayout('pdf', raw);
    const box = pageBox(l, orientation);
    const css = [
      `@page{margin:${PAGE.top}mm ${l.margin}mm ${PAGE.bottom}mm;}`,
      `body{font-size:${l.bodySize}px;}`,
      `.bl-header{min-height:${l.headerHeight}px;box-sizing:border-box;}`,
      `h1{font-size:${l.titleSize}px;}`,
      `h2{font-size:${Math.round(l.titleSize * 0.66)}px;}`,
      l.tableSize ? `table{font-size:${l.tableSize}px;}` : '',
      `.bl-gallery{grid-template-columns:repeat(${l.columns},minmax(0,1fr));gap:${l.gap}px;}`,
      `.bl-gallery>.bl-card{min-width:0;overflow:hidden;font-size:${l.cardTextSize}px;}`,
      `.bl-gallery>.bl-card h3{font-size:${Number((l.cardTextSize * 1.15).toFixed(1))}px;margin-bottom:2px;}`,
      // Sayfa (PDF) başına sütun × satır: her parça bir A4 içerik kutusu oranındadır.
      `.bl-gallery-page{grid-template-rows:repeat(${l.rows},minmax(0,1fr));aspect-ratio:${box.width.toFixed(1)} / ${box.height.toFixed(1)};break-inside:avoid;}`,
      `.bl-gallery-page.bl-gallery-first{aspect-ratio:${box.width.toFixed(1)} / ${box.firstHeight.toFixed(1)};}`,
      '.bl-gallery-page+.bl-gallery-page{break-before:page;}',
      '.bl-gallery-page>.bl-card{display:flex;flex-direction:column;min-height:0;}',
      `.bl-gallery-page .bl-model-img,.bl-gallery-page .bl-noimg{flex:0 0 ${l.imageShare}%;height:${l.imageShare}%;min-height:0;aspect-ratio:auto;}`,
      `@media screen{.bl-gallery-page+.bl-gallery-page{margin-top:${l.gap * 2}px;padding-top:${l.gap * 2}px;border-top:2px dashed var(--line);}}`,
      l.showTitle ? '' : '.bl-gallery>.bl-card h3{display:none;}',
      l.showSubtitle ? '' : '.bl-gallery>.bl-card small{display:none;}',
      l.showNote ? '' : '.bl-gallery>.bl-card p{display:none;}',
    ];
    return css.filter(Boolean).join('\n');
  }

  /* ---------------- Galeriyi sayfalara bölme (HTML dizesi) ----------------
     Temizlenmiş (dengeli) HTML'de .bl-gallery bloklarının doğrudan çocuk
     <div>'lerini bulur. Art arda gelen sayfa parçaları (.bl-gallery-page)
     önce birleştirilir; böylece işlem tekrarlanabilir. layout=null → yalnız
     birleştirir (taslak bu hâlde saklanır). */
  const OPEN_GALLERY = /<div\b[^>]*\bclass="([^"]*\bbl-gallery\b[^"]*)"[^>]*>/g;
  function scanGallery(html, start, openEnd) {
    const tag = /<(\/?)div\b[^>]*>/g;
    tag.lastIndex = openEnd;
    let depth = 1, childStart = -1, match;
    const children = [];
    let last = openEnd;
    while ((match = tag.exec(html))) {
      if (!match[1]) {
        if (depth === 1) {
          if (html.slice(last, match.index).trim()) return null; // div dışı içerik: dokunma
          childStart = match.index;
        }
        depth++;
      } else {
        depth--;
        if (depth === 1 && childStart >= 0) { children.push(html.slice(childStart, tag.lastIndex)); childStart = -1; last = tag.lastIndex; }
        if (depth === 0) {
          if (html.slice(last, match.index).trim()) return null;
          return { start, end: tag.lastIndex, children };
        }
      }
    }
    return null;
  }
  function paginateGallery(html, raw, { pages = true } = {}) {
    const source = String(html || '');
    const found = [];
    OPEN_GALLERY.lastIndex = 0;
    let match;
    while ((match = OPEN_GALLERY.exec(source))) {
      const scanned = scanGallery(source, match.index, OPEN_GALLERY.lastIndex);
      if (!scanned) continue;
      const classes = match[1].split(/\s+/).filter(name => name && name !== 'bl-gallery-page' && name !== 'bl-gallery-first');
      found.push({ ...scanned, classes, page: /\bbl-gallery-page\b/.test(match[1]), first: /\bbl-gallery-first\b/.test(match[1]) });
      OPEN_GALLERY.lastIndex = scanned.end;
    }
    if (!found.length) return source;
    // Art arda gelen sayfa parçaları tek galeriye.
    const groups = [];
    for (const item of found) {
      const prev = groups[groups.length - 1];
      if (prev && item.page && prev.page && !item.first && !source.slice(prev.end, item.start).trim()) { prev.children.push(...item.children); prev.end = item.end; }
      else groups.push({ ...item, children: [...item.children] });
    }
    const size = pages && raw ? perPage(normalizeLayout('pdf', raw)) : Infinity;
    let out = '', cursor = 0;
    for (const group of groups) {
      out += source.slice(cursor, group.start);
      const classes = group.classes.join(' ');
      if (size === Infinity || !group.children.length) out += `<div class="${classes}">${group.children.join('')}</div>`;
      else for (let i = 0; i < group.children.length; i += size) out += `<div class="${classes} bl-gallery-page${i ? '' : ' bl-gallery-first'}">${group.children.slice(i, i + size).join('')}</div>`;
      cursor = group.end;
    }
    return out + source.slice(cursor);
  }

  /* ---------------- Excel ---------------- */
  function xlsxMetrics(raw) {
    const l = normalizeLayout('xlsx', raw);
    return { ...l, imageRow: l.imageSize + 6, imageBoxPx: Math.round(l.imageSize * 4 / 3), imageColChars: Math.max(8, Math.round(l.imageSize * 4 / 3 / 7) + 1) };
  }

  return { SPEC, FLAGS, PRESETS, SLIDE, PAGE, specKey, defaults, normalizeLayout, isDefault, perPage, applyPreset, pptxGeometry, galleryCells, pageBox, layoutCss, paginateGallery, xlsxMetrics };
});
