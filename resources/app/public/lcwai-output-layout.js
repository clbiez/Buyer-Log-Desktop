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
    if (key !== 'xlsx') out.page = defaultPage(format);
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
    if (key !== 'xlsx') out.page = normalizePage(format, source.page);
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
    // Hazır yerleşim boyutları değiştirir; kullanıcının sayfa tasarımı (bloklar) korunur.
    const page = current && current.page;
    return name === 'standard' ? normalizeLayout(format, { ...defaults(format), page }) : normalizeLayout(format, { ...(current || {}), ...preset });
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

  /* ---------------- Katalog sayfası: bloklar (widget) ----------------
     Model galerisi "katalog sayfaları" olarak çizilir. Sayfa 12 sütunlu bir
     ızgaradır; başlık, grup başlığı, alt başlık, model alanı ve serbest metin
     blokları bu ızgaraya oturur (x, y, w, h ızgara birimidir). Kullanıcı
     blokları Yerleşim adımında taşır/boyutlandırır; PowerPoint ve PDF aynı
     düzeni kullanır. */
  const GRID_COLS = 12;
  const PAGE_ROWS = Object.freeze({ pptx: 8, pdf: 14 });
  const BLOCK_KINDS = Object.freeze(['title', 'group', 'subgroup', 'models', 'text']);
  const SINGLE_KINDS = new Set(['title', 'group', 'subgroup', 'models']);
  const MAX_TEXT_BLOCKS = 6;
  const SIZE_RANGE = [7, 72];
  const DEFAULT_PAGES = Object.freeze({
    pptx: [
      { id: 'title', kind: 'title', x: 0, y: 0, w: 12, h: 1, fill: true },
      { id: 'group', kind: 'group', x: 0, y: 1, w: 8, h: 1 },
      { id: 'subgroup', kind: 'subgroup', x: 8, y: 1, w: 4, h: 1, align: 'right' },
      { id: 'models', kind: 'models', x: 0, y: 2, w: 12, h: 6 },
    ],
    pdf: [
      { id: 'title', kind: 'title', x: 0, y: 0, w: 12, h: 1, fill: true },
      { id: 'group', kind: 'group', x: 0, y: 1, w: 8, h: 1 },
      { id: 'subgroup', kind: 'subgroup', x: 8, y: 1, w: 4, h: 1, align: 'right' },
      { id: 'models', kind: 'models', x: 0, y: 2, w: 12, h: 12 },
    ],
  });
  const pageKey = format => (specKey(format) === 'pptx' ? 'pptx' : specKey(format) === 'pdf' ? 'pdf' : null);
  const int = (value, min, max, fallback) => { const n = Math.round(Number(value)); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback; };
  const clip = (value, max) => String(value == null ? '' : value).replace(/\r\n?/g, '\n').slice(0, max);

  function defaultPage(format) {
    const key = pageKey(format);
    return key ? { rows: PAGE_ROWS[key], blocks: DEFAULT_PAGES[key].map(block => ({ ...block })) } : null;
  }
  /* Blok listesi sınır içine alınır: ızgaradan taşan blok kısaltılır, tekil
     bloklar (başlık, grup, alt başlık, model alanı) bir kez bulunur, model
     alanı her zaman vardır. */
  function normalizePage(format, raw) {
    const key = pageKey(format);
    if (!key) return null;
    const rows = PAGE_ROWS[key];
    const source = raw && typeof raw === 'object' && Array.isArray(raw.blocks) ? raw.blocks : null;
    if (!source) return defaultPage(format);
    const seen = new Set(), ids = new Set();
    const blocks = [];
    let texts = 0;
    for (const item of source) {
      if (!item || typeof item !== 'object' || !BLOCK_KINDS.includes(item.kind)) continue;
      if (SINGLE_KINDS.has(item.kind) && seen.has(item.kind)) continue;
      if (item.kind === 'text' && ++texts > MAX_TEXT_BLOCKS) continue;
      seen.add(item.kind);
      const x = int(item.x, 0, GRID_COLS - 1, 0), y = int(item.y, 0, rows - 1, 0);
      const block = { id: '', kind: item.kind, x, y, w: int(item.w, 1, GRID_COLS - x, GRID_COLS - x), h: int(item.h, 1, rows - y, 1) };
      let id = String(item.id || item.kind).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 24) || item.kind;
      for (let n = 2; ids.has(id); n++) id = `${item.kind}${n}`;
      ids.add(id);
      block.id = id;
      const size = Number(item.size);
      if (Number.isFinite(size) && size > 0) block.size = Math.min(SIZE_RANGE[1], Math.max(SIZE_RANGE[0], Math.round(size * 2) / 2));
      if (['center', 'right'].includes(item.align)) block.align = item.align;
      if (item.fill === true) block.fill = true;
      if (item.kind === 'text') block.text = clip(item.text, 400);
      blocks.push(block);
    }
    if (!seen.has('models')) blocks.push({ ...DEFAULT_PAGES[key].find(block => block.kind === 'models') });
    return { rows, blocks };
  }
  /* Bloğun alanı (aynı formül CSS ızgarasıyla: sütun genişliği = (W − 11·gap)/12). */
  function blockRect(area, page, block, gap = 0) {
    const cw = (area.w - gap * (GRID_COLS - 1)) / GRID_COLS;
    const rh = (area.h - gap * (page.rows - 1)) / page.rows;
    return { x: area.x + block.x * (cw + gap), y: area.y + block.y * (rh + gap), w: block.w * cw + (block.w - 1) * gap, h: block.h * rh + (block.h - 1) * gap };
  }
  /* PowerPoint katalog sayfasının ızgara alanı (pt). */
  function pptxPageArea(raw) {
    const l = normalizeLayout('pptx', raw);
    return { x: l.margin, y: 18, w: SLIDE.width - l.margin * 2, h: SLIDE.height - 18 - SLIDE.footer };
  }
  /* Bir dikdörtgendeki model kartları (sütun × satır). */
  function cardCells(rect, raw, count) {
    const l = raw && raw.columns ? raw : normalizeLayout('pptx', raw);
    const { columns, rows, gap, imageShare } = l;
    const cardW = (rect.w - gap * (columns - 1)) / columns;
    const cardH = (rect.h - gap * (rows - 1)) / rows;
    const imgH = Math.max(12, (cardH - 14) * imageShare / 100);
    return Array.from({ length: Math.min(count, columns * rows) }, (_, i) => ({ x: rect.x + (i % columns) * (cardW + gap), y: rect.y + Math.floor(i / columns) * (cardH + gap), w: cardW, h: cardH, imgH }));
  }

  /* ---------------- Gruplama (kategori / alt kategori) ----------------
     Her model kartı kendi grubunu (group) ve alt grubunu (subgroup) taşır;
     otomatik gruplama bunları seçilen sütundan doldurur, kullanıcı sonra
     sürükleyerek değiştirir. catalog yalnız seçimi ve grup sırasını saklar. */
  function normalizeCatalog(raw) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const text = (value, max) => String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, max);
    const list = value => (Array.isArray(value) ? [...new Set(value.map(item => text(item, 120)))].slice(0, 200) : []);
    // Grup adı veri kaynaklıdır ("constructor", "__proto__" olabilir): prototipsiz sözlük.
    const subOrder = Object.create(null);
    if (source.subOrder && typeof source.subOrder === 'object') for (const [group, items] of Object.entries(source.subOrder).slice(0, 200)) subOrder[text(group, 120)] = list(items);
    return { by: text(source.by, 80), then: text(source.then, 80), order: list(source.order), subOrder };
  }
  const ITEM_FIELDS = ['subtitle', 'note', 'title'];
  /* Gruplama alanı değeri: "a:Sütun" bağlam verisi (görsel anahtarıyla),
     "f:subtitle|note|title" kartın kendi alanı. */
  function fieldValue(item, field, attributes) {
    const key = String(field || '');
    if (key.startsWith('a:')) { const row = attributes && item && item.image ? attributes[String(item.image).toUpperCase()] : null; return row && Object.prototype.hasOwnProperty.call(row, key.slice(2)) ? String(row[key.slice(2)] == null ? '' : row[key.slice(2)]).replace(/\s+/g, ' ').trim() : ''; }
    if (key.startsWith('f:') && ITEM_FIELDS.includes(key.slice(2))) return String(item && item[key.slice(2)] || '').replace(/\s+/g, ' ').trim();
    return '';
  }
  /* Seçilebilir gruplama alanları: en az 2, en çok kart sayısından az farklı değeri olanlar. */
  function groupingFields(items, attributes) {
    const list = Array.isArray(items) ? items : [];
    const columns = new Set();
    for (const item of list) { const row = attributes && item && item.image ? attributes[String(item.image).toUpperCase()] : null; if (row) Object.keys(row).forEach(name => columns.add(name)); }
    const candidates = [...[...columns].map(name => `a:${name}`), ...ITEM_FIELDS.map(name => `f:${name}`)];
    return candidates.map(key => {
      const values = new Set(list.map(item => fieldValue(item, key, attributes)).filter(Boolean));
      return { key, label: key.slice(2), source: key.startsWith('a:') ? 'data' : 'card', distinct: values.size };
    }).filter(entry => entry.distinct >= 2 && (entry.distinct < list.length || list.length <= 3));
  }
  function assignGroups(items, attributes, by, then) {
    return (Array.isArray(items) ? items : []).map(item => ({ ...item, group: by ? fieldValue(item, by, attributes).slice(0, 120) : '', subgroup: by && then ? fieldValue(item, then, attributes).slice(0, 120) : '' }));
  }
  /* Kartlar → sıralı gruplar → alt gruplar (catalog.order / subOrder, sonra ilk görülme sırası). */
  function groupItems(items, raw) {
    const catalog = normalizeCatalog(raw);
    const groups = new Map();
    (Array.isArray(items) ? items : []).forEach((item, index) => {
      const g = String(item && item.group || ''), sg = String(item && item.subgroup || '');
      if (!groups.has(g)) groups.set(g, new Map());
      const subs = groups.get(g);
      if (!subs.has(sg)) subs.set(sg, []);
      subs.get(sg).push({ item, index });
    });
    const ordered = (keys, order) => [...order.filter(key => keys.includes(key)), ...keys.filter(key => !order.includes(key))];
    return ordered([...groups.keys()], catalog.order).map(group => {
      const subs = groups.get(group);
      return { group, subgroups: ordered([...subs.keys()], Array.isArray(catalog.subOrder[group]) ? catalog.subOrder[group] : []).map(subgroup => ({ subgroup, entries: subs.get(subgroup) })) };
    });
  }
  /* Katalog sayfaları: her alt grup kendi sayfasında başlar; model alanına
     sığmayan kartlar aynı başlıklarla devam sayfasına geçer. */
  function catalogPages(items, catalog, raw) {
    const size = perPage(raw);
    const pages = [];
    for (const group of groupItems(items, catalog)) {
      for (const sub of group.subgroups) {
        const parts = Math.max(1, Math.ceil(sub.entries.length / size));
        for (let part = 0; part < parts; part++) pages.push({ group: group.group, subgroup: sub.subgroup, entries: sub.entries.slice(part * size, (part + 1) * size), part: part + 1, parts });
      }
    }
    return pages;
  }

  /* ---------------- PDF/HTML: tema üstüne yerleşim CSS'i ---------------- */
  const PAGE = Object.freeze({ portrait: [210, 297], landscape: [297, 210], top: 14, bottom: 16 });
  // Katalog sayfasının içerik kutusu (mm): sayfa − kenar boşlukları.
  function pageBox(raw, orientation) {
    const layout = normalizeLayout('pdf', raw);
    const [w, h] = PAGE[orientation === 'landscape' ? 'landscape' : 'portrait'];
    return { width: w - layout.margin * 2, height: h - PAGE.top - PAGE.bottom - 2 };
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
      // Katalog sayfası: 12 sütunlu blok ızgarası; her sayfa bir A4 içerik kutusu.
      `.bl-catalog-page{display:grid;grid-template-columns:repeat(12,minmax(0,1fr));grid-template-rows:repeat(${l.page.rows},minmax(0,1fr));gap:${l.gap}px;width:${box.width}mm;max-width:100%;aspect-ratio:${box.width} / ${box.height};margin:0;break-before:page;break-inside:avoid;overflow:hidden;box-sizing:border-box;}`,
      '.bl-cb{min-width:0;min-height:0;overflow:hidden;display:flex;flex-direction:column;justify-content:flex-end;line-height:1.15;}',
      // Blok başlıkları h2/h3/h4 (tema yazı tipi); rapor başlığı süslemeleri kapalı.
      '.bl-cb>h2,.bl-cb>h3,.bl-cb>h4{margin:0;padding:0;font-size:inherit;color:inherit;line-height:1.15;}',
      '.bl-cb>h2::before,.bl-cb>h2::after{display:none;}',
      `.bl-cb-title{font-weight:600;color:var(--logo);font-size:${l.titleSize}px;}`,
      '.bl-cb-title.is-fill{background:var(--thead-bg);border-bottom:3px solid var(--logo);padding:0 12px;justify-content:center;}',
      `.bl-cb-group{font-weight:600;color:var(--logo);font-size:${Math.round(l.titleSize * 0.72)}px;border-left:4px solid var(--logo);padding-left:10px;}`,
      `.bl-cb-group.is-fill,.bl-cb-subgroup.is-fill{background:var(--thead-bg);padding:0 10px;justify-content:center;}`,
      `.bl-cb-subgroup{color:var(--head-ink);font-size:${Math.round(l.titleSize * 0.55)}px;}`,
      `.bl-cb-text{justify-content:flex-start;white-space:pre-wrap;color:var(--ink2);font-size:${l.bodySize}px;}`,
      '.bl-cb-models{justify-content:stretch;}',
      `.bl-cb-models .bl-gallery{height:100%;margin:0;display:grid;grid-template-columns:repeat(${l.columns},minmax(0,1fr));grid-template-rows:repeat(${l.rows},minmax(0,1fr));gap:${l.gap}px;}`,
      `.bl-cb-models .bl-card{display:flex;flex-direction:column;min-width:0;min-height:0;overflow:hidden;margin:0;padding:6px;font-size:${l.cardTextSize}px;}`,
      `.bl-cb-models .bl-card h3{font-size:${Number((l.cardTextSize * 1.15).toFixed(1))}px;margin:2px 0;}`,
      '.bl-cb-models .bl-card small,.bl-cb-models .bl-card p{margin:0;}',
      `.bl-cb-models .bl-model-img,.bl-cb-models .bl-noimg{flex:0 0 ${l.imageShare}%;height:${l.imageShare}%;min-height:0;aspect-ratio:auto;margin:0 0 4px;}`,
      `@media screen{.bl-catalog-page{margin:${l.gap * 2}px auto;outline:1px dashed var(--line);outline-offset:6px;}}`,
      l.showTitle ? '' : '.bl-cb-models .bl-card h3{display:none;}',
      l.showSubtitle ? '' : '.bl-cb-models .bl-card small{display:none;}',
      l.showNote ? '' : '.bl-cb-models .bl-card p{display:none;}',
    ];
    return css.filter(Boolean).join('\n');
  }

  /* ---------------- Galeri bloklarını bulma (HTML dizesi) ----------------
     Temizlenmiş (dengeli) HTML'de .bl-gallery bloklarını ve doğrudan çocuk
     <div>'lerini (model kartları) bulur; sunucu bunları katalog verisine çevirir. */
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
  function findGalleries(html) {
    const source = String(html || '');
    const found = [];
    const re = new RegExp(OPEN_GALLERY.source, 'g');
    let match;
    while ((match = re.exec(source))) {
      const scanned = scanGallery(source, match.index, re.lastIndex);
      if (!scanned) continue;
      found.push(scanned);
      re.lastIndex = scanned.end;
    }
    return found;
  }

  /* ---------------- Excel ---------------- */
  function xlsxMetrics(raw) {
    const l = normalizeLayout('xlsx', raw);
    return { ...l, imageRow: l.imageSize + 6, imageBoxPx: Math.round(l.imageSize * 4 / 3), imageColChars: Math.max(8, Math.round(l.imageSize * 4 / 3 / 7) + 1) };
  }

  return {
    SPEC, FLAGS, PRESETS, SLIDE, PAGE, GRID_COLS, PAGE_ROWS, BLOCK_KINDS, specKey, defaults, normalizeLayout, isDefault, perPage, applyPreset,
    pptxGeometry, galleryCells, pageBox, layoutCss, findGalleries, xlsxMetrics,
    defaultPage, normalizePage, blockRect, pptxPageArea, cardCells,
    normalizeCatalog, fieldValue, groupingFields, assignGroups, groupItems, catalogPages,
  };
});
