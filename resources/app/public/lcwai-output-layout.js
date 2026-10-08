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
  // Kartta görünenler: model adı, bilgi satırları, durum etiketi.
  const FLAGS = Object.freeze({ pptx: ['showTitle', 'showLines', 'showBadge'], pdf: ['showTitle', 'showLines', 'showBadge'], xlsx: [] });
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
    // Eski şablonlar: alt bilgi ve not ikisi de kapalıysa bilgi satırları kapalı.
    if (key !== 'xlsx' && typeof source.showLines !== 'boolean' && source.showSubtitle === false && source.showNote === false) out.showLines = false;
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
      pptx: { headerHeight: 56, titleSize: 20, margin: 24, gap: 6, columns: 6, rows: 3, cardTextSize: 8.5, imageShare: 70 },
      pdf: { headerHeight: 44, titleSize: 20, margin: 8, gap: 6, columns: 5, rows: 4, cardTextSize: 9.5, imageShare: 66 },
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
  const PAGE_BREAKS = Object.freeze(['auto', 'group', 'subgroup']);
  function normalizeCatalog(raw) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const text = (value, max) => String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, max);
    const list = value => (Array.isArray(value) ? [...new Set(value.map(item => text(item, 120)))].slice(0, 200) : []);
    // Grup adı veri kaynaklıdır ("constructor", "__proto__" olabilir): prototipsiz sözlük.
    const subOrder = Object.create(null);
    if (source.subOrder && typeof source.subOrder === 'object') for (const [group, items] of Object.entries(source.subOrder).slice(0, 200)) subOrder[text(group, 120)] = list(items);
    // pageBreak: yeni sayfa ne zaman başlar — auto (varsayılan): grup kalan alana
    // tümüyle sığıyorsa aynı sayfada devam eder; group: her grupta; subgroup: her alt grupta.
    const pageBreak = PAGE_BREAKS.includes(source.pageBreak) ? source.pageBreak : 'auto';
    return { by: text(source.by, 80), then: text(source.then, 80), order: list(source.order), subOrder, pageBreak };
  }
  /* ---------------- Model kartı ----------------
     Kart: model adı, bilgi satırları (kaynaktaki gibi TAM; kısaltılmaz) ve
     isteğe bağlı durum etiketi. Eski biçim (subtitle / note) satırlara çevrilir. */
  const TONES = ['ok', 'warn', 'risk', 'info'];
  const ITEM_LIMITS = Object.freeze({ title: 160, line: 400, lines: 8, badge: 80, group: 160 });
  const oneLine = (value, max) => String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, max);
  function normalizeItem(raw) {
    const item = raw && typeof raw === 'object' ? raw : {};
    const image = oneLine(item.image, 12).toUpperCase();
    const source = Array.isArray(item.lines) ? item.lines : [item.subtitle, item.note || item.text];
    const lines = source.map(line => oneLine(line, ITEM_LIMITS.line)).filter(Boolean).slice(0, ITEM_LIMITS.lines);
    const rawBadge = item.badge && typeof item.badge === 'object' ? item.badge : { text: item.badge, tone: item.badgeTone };
    const tone = TONES.includes(item.tone) ? item.tone : 'info';
    const badgeText = oneLine(rawBadge.text, ITEM_LIMITS.badge);
    return {
      title: oneLine(item.title || item.name || item.model, ITEM_LIMITS.title), lines,
      badge: badgeText ? { text: badgeText, tone: TONES.includes(rawBadge.tone) ? rawBadge.tone : tone } : null,
      image: /^[A-Z]{2,4}-\d{1,6}$/.test(image) ? image : '', tone,
      group: oneLine(item.group, ITEM_LIMITS.group), subgroup: oneLine(item.subgroup, ITEM_LIMITS.group),
    };
  }
  const ITEM_FIELDS = ['title', 'line1', 'line2', 'line3', 'badge'];
  const ITEM_LABELS = { title: ['Model adı', 'Model name'], line1: ['1. satır', 'Line 1'], line2: ['2. satır', 'Line 2'], line3: ['3. satır', 'Line 3'], badge: ['Durum', 'Status'] };
  const LEGACY_FIELDS = { subtitle: 'line1', note: 'line2' };
  /* Gruplama alanı değeri: "a:Sütun" bağlam verisi (görsel anahtarıyla),
     "f:title|line1..3|badge" kartın kendi alanı. */
  function fieldValue(item, field, attributes) {
    const key = String(field || '');
    if (key.startsWith('a:')) { const row = attributes && item && item.image ? attributes[String(item.image).toUpperCase()] : null; return row && Object.prototype.hasOwnProperty.call(row, key.slice(2)) ? String(row[key.slice(2)] == null ? '' : row[key.slice(2)]).replace(/\s+/g, ' ').trim() : ''; }
    if (!key.startsWith('f:') || !item) return '';
    const name = LEGACY_FIELDS[key.slice(2)] || key.slice(2);
    if (name === 'title') return oneLine(item.title, ITEM_LIMITS.title);
    if (name === 'badge') return item.badge ? oneLine(item.badge.text, ITEM_LIMITS.badge) : '';
    const line = /^line([1-3])$/.exec(name);
    return line && Array.isArray(item.lines) ? oneLine(item.lines[Number(line[1]) - 1], ITEM_LIMITS.line) : '';
  }

  /* ---------------- Metni kutuya sığdırma (tahmini) ----------------
     PDF basımında JavaScript yoktur, PowerPoint'te de ölçüm yapılamaz; bu
     yüzden satır sayısı karakter genişliği tahminiyle hesaplanır (Barlow
     ailesi için ortalama ~0,5 em; temkinli değer). Aynı hesap iki biçimde
     kullanılır: yazı gerekirse küçülür, sığmazsa son çare kırpılır. */
  const CHAR_EM = Object.freeze({ body: 0.52, head: 0.46 });
  // PowerPoint Segoe UI kullanır (Barlow'dan geniş).
  const CHAR_EM_OFFICE = Object.freeze({ body: 0.56, head: 0.6 });
  function wrapCount(text, width, size, charEm = CHAR_EM.body) {
    const perLine = Math.max(1, Math.floor(width / Math.max(1, size * charEm)));
    let total = 0;
    for (const para of String(text == null ? '' : text).split('\n')) {
      let count = 1, current = 0;
      for (const word of para.split(/\s+/).filter(Boolean)) {
        const add = current ? current + 1 + word.length : word.length;
        if (add <= perLine) { current = add; continue; }
        if (current) count++;
        current = word.length;
        while (current > perLine) { count++; current -= perLine; }
      }
      total += count;
    }
    return total;
  }
  function fitText(text, width, height, size, { min = 7, lineHeight = 1.18, charEm = CHAR_EM.body } = {}) {
    for (let s = size; s >= min; s -= 0.5) {
      const lines = wrapCount(text, width, s, charEm);
      if (lines * s * lineHeight <= height + 0.01) return { size: s, lines, fits: true };
    }
    return { size: min, lines: Math.max(1, Math.floor(height / (min * lineHeight))), fits: false };
  }
  /* Kartta görünen metin (yerleşim bayraklarına göre). */
  function cardContent(item, raw) {
    const l = raw || {};
    return {
      title: l.showTitle === false ? '' : String(item && item.title || ''),
      lines: l.showLines === false ? [] : (item && Array.isArray(item.lines) ? item.lines : []),
      badge: l.showBadge === false || !(item && item.badge && item.badge.text) ? null : item.badge,
    };
  }
  /* Bir sayfadaki kartların ortak ölçüsü: yazı boyutu ve görsel yüksekliği.
     Görsel önce istenen paya göre; metin sığmazsa yazı küçülür (en az 6,5),
     yine sığmazsa görsel %30'a kadar daralır; o da yetmezse fits=false. */
  function cardFit(cell, raw, items, { charEm = CHAR_EM } = {}) {
    const l = raw || {};
    const pad = Math.max(3, Math.min(8, cell.w * 0.05));
    const innerW = Math.max(10, cell.w - pad * 2);
    const innerH = Math.max(10, cell.h - pad * 2 - 4);
    const contents = (items || []).map(item => cardContent(item, l));
    const need = size => Math.max(0, ...contents.map(c => {
      let h = 0;
      if (c.title) h += Math.min(2, wrapCount(c.title, innerW, size * 1.15, charEm.head)) * size * 1.15 * 1.15 + 2;
      for (const line of c.lines) h += wrapCount(line, innerW, size, charEm.body) * size * 1.18 + 1;
      if (c.badge) h += size * 1.18 + size * 0.7 + 3;
      return h;
    }));
    const base = Number(l.cardTextSize) || 12;
    const readable = Math.max(7, base * 0.8);
    const share = Math.min(85, Math.max(30, Number(l.imageShare) || 65)) / 100;
    const done = (s, textH) => ({ size: s, textH, imageH: innerH - textH, pad, fits: true });
    // 1) İstenen görsel payıyla, yazı okunur aralıkta küçülerek.
    for (let s = base; s >= readable; s -= 0.5) { const t = need(s); if (t <= innerH * (1 - share)) return done(s, t); }
    // 2) Yazı okunur kalsın diye görsel %40'a kadar daralır.
    for (let s = base; s >= readable; s -= 0.5) { const t = need(s); if (t <= innerH * 0.6) return done(s, t); }
    // 3) Son çare: yazı 6,5'e kadar iner, görsel en az %30.
    for (let s = Math.min(base, readable); s >= 6.5; s -= 0.5) { const t = need(s); if (t <= innerH * 0.7) return done(s, t); }
    return { size: 6.5, textH: innerH * 0.7, imageH: innerH * 0.3, pad, fits: false };
  }

  /* Seçilebilir gruplama alanları: en az 2, en çok kart sayısından az farklı değeri olanlar. */
  function groupingFields(items, attributes) {
    const list = Array.isArray(items) ? items : [];
    const columns = new Set();
    for (const item of list) { const row = attributes && item && item.image ? attributes[String(item.image).toUpperCase()] : null; if (row) Object.keys(row).forEach(name => columns.add(name)); }
    const candidates = [...[...columns].map(name => `a:${name}`), ...ITEM_FIELDS.map(name => `f:${name}`)];
    return candidates.map(key => {
      const values = new Set(list.map(item => fieldValue(item, key, attributes)).filter(Boolean));
      const name = key.slice(2);
      return { key, label: name, labels: key.startsWith('f:') ? ITEM_LABELS[name] : null, source: key.startsWith('a:') ? 'data' : 'card', distinct: values.size };
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
  /* Katalog sayfaları. Bölümler (grup › alt grup) sırayla yerleşir; yeni
     sayfa catalog.pageBreak'e göre başlar: 'subgroup' her alt grupta,
     'group' her grupta, 'auto' grup kalan alana tümüyle sığmıyorsa. Sayfada birden çok bölüm
     varsa bölümlerin önüne ara başlık şeritleri gelir (sayfada birden çok grup
     varsa grup şeridi de). Kart boyu sabittir (sütun × satır); şeridin yeri
     kart satırı biriminde `stripUnits(text, kind)` ile ölçülür.
     Sayfa: { group, subgroup, sections: [{ group, subgroup, entries, part,
     parts }], entries, part, parts } — group/subgroup yalnız sayfada tekse dolu. */
  function pageStrips(sections) {
    const groups = new Set(sections.map(sec => sec.group));
    const multiGroup = groups.size > 1;
    const out = [];
    sections.forEach((sec, i) => {
      const firstOfGroup = i === 0 || sections[i - 1].group !== sec.group;
      const list = [];
      if (multiGroup && firstOfGroup) list.push({ kind: 'group', text: sec.group });
      if (sec.subgroup && (sections.length > 1)) list.push({ kind: 'subgroup', text: sec.subgroup });
      out.push(list);
    });
    return out;
  }
  function catalogPages(items, catalog, raw, { stripUnits = () => 0.3, strip } = {}) {
    const l = raw && raw.columns ? raw : normalizeLayout('pdf', raw);
    const cols = Math.max(1, Number(l.columns) || 1), rows = Math.max(1, Number(l.rows) || 1);
    const unit = typeof strip === 'number' ? () => strip : stripUnits;
    const cat = normalizeCatalog(catalog);
    const pages = [];
    let page = null;
    const cost = sections => {
      let total = 0;
      pageStrips(sections).forEach((list, i) => {
        for (const s of list) total += unit(s.text, s.kind);
        total += Math.ceil(sections[i].entries.length / cols);
      });
      return total;
    };
    const newPage = () => { page = { sections: [] }; pages.push(page); };
    let lastGroup = null;
    const sectionsOf = group => group.subgroups.map(sub => ({ group: group.group, subgroup: sub.subgroup, entries: sub.entries }));
    for (const group of groupItems(items, cat)) {
      // auto: küçük grup bir önceki grubun sayfasında kalan yere sığıyorsa orada devam eder.
      const fitsHere = page && page.sections.length && cost([...page.sections, ...sectionsOf(group)]) <= rows + 1e-6;
      for (const sub of group.subgroups) {
        const newGroup = lastGroup !== group.group;
        const breakHere = !page || cat.pageBreak === 'subgroup' || (newGroup && (cat.pageBreak === 'group' || !fitsHere));
        if (breakHere) newPage();
        lastGroup = group.group;
        let section = null;
        for (let i = 0; i < sub.entries.length; i += cols) {
          const chunk = sub.entries.slice(i, i + cols);
          const trial = section
            ? page.sections.map(sec => (sec === section ? { ...sec, entries: [...sec.entries, ...chunk] } : sec))
            : [...page.sections, { group: group.group, subgroup: sub.subgroup, entries: chunk }];
          if (page.sections.length && cost(trial) > rows + 1e-6) {
            newPage();
            section = { group: group.group, subgroup: sub.subgroup, entries: [...chunk] };
            page.sections.push(section);
            continue;
          }
          if (section) section.entries.push(...chunk);
          else { section = { group: group.group, subgroup: sub.subgroup, entries: [...chunk] }; page.sections.push(section); }
        }
      }
    }
    // Parça numaraları: alt grup (bölüm) ve grup bazında "(2/3)".
    const secCount = new Map(), groupCount = new Map();
    const key = sec => `${sec.group}\u0000${sec.subgroup}`;
    for (const p of pages) {
      for (const sec of p.sections) secCount.set(key(sec), (secCount.get(key(sec)) || 0) + 1);
      for (const g of new Set(p.sections.map(sec => sec.group))) groupCount.set(g, (groupCount.get(g) || 0) + 1);
    }
    const secSeen = new Map(), groupSeen = new Map();
    return pages.filter(p => p.sections.length).map(p => {
      const sections = p.sections.map(sec => { secSeen.set(key(sec), (secSeen.get(key(sec)) || 0) + 1); return { ...sec, part: secSeen.get(key(sec)), parts: secCount.get(key(sec)) }; });
      const groups = [...new Set(sections.map(sec => sec.group))];
      for (const g of groups) groupSeen.set(g, (groupSeen.get(g) || 0) + 1);
      const single = sections.length === 1 ? sections[0] : null;
      const oneGroup = groups.length === 1 ? groups[0] : null;
      return {
        group: oneGroup == null ? '' : oneGroup, subgroup: single ? single.subgroup : '', sections,
        entries: sections.flatMap(sec => sec.entries),
        part: single ? single.part : oneGroup != null ? groupSeen.get(oneGroup) : 1,
        parts: single ? single.parts : oneGroup != null ? groupCount.get(oneGroup) : 1,
      };
    });
  }
  /* Model alanındaki yerleşim (birim: alanın birimi). Döner: { cards: [{ x, y,
     w, h, item }], strips: [{ x, y, w, h, text, kind, part, parts }],
     cell: { w, h } }. stripHeight(text, kind) şeridin yüksekliği. */
  function catalogSlots(page, rect, raw, stripHeight) {
    const l = raw && raw.columns ? raw : normalizeLayout('pdf', raw);
    const cols = Math.max(1, l.columns), rows = Math.max(1, l.rows), gap = Number(l.gap) || 0;
    const cardW = (rect.w - gap * (cols - 1)) / cols;
    const rowH = (rect.h - gap * (rows - 1)) / rows;
    const height = typeof stripHeight === 'function' ? stripHeight : () => Number(stripHeight) || 16;
    // flow: sıralı satırlar — { strip } ya da { cards: [...] } (PDF ızgarası bunu izler).
    const out = { cards: [], strips: [], flow: [], cell: { w: cardW, h: rowH } };
    let y = rect.y;
    const lists = pageStrips(page.sections);
    page.sections.forEach((section, si) => {
      for (const s of lists[si]) {
        const h = height(s.text, s.kind);
        const strip = { x: rect.x, y, w: rect.w, h, text: s.text, kind: s.kind, part: section.part, parts: section.parts };
        out.strips.push(strip);
        out.flow.push({ strip });
        y += h + gap;
      }
      for (let i = 0; i < section.entries.length; i += cols) {
        const row = section.entries.slice(i, i + cols).map((entry, col) => ({ x: rect.x + col * (cardW + gap), y, w: cardW, h: rowH, item: entry.item }));
        out.cards.push(...row);
        out.flow.push({ cards: row, h: rowH });
        y += rowH + gap;
      }
    });
    return out;
  }
  /* Bir sayfada çizilecek bloklar: grup ve alt başlık boşsa (sayfada birden
     çok grup var; adlar şeritlerde) o bloklar düşer ve hemen altındaki model
     alanı yukarı uzar — sayfanın üstünde boş satır kalmaz. */
  function pageBlocks(pageModel, labels) {
    const empty = block => (block.kind === 'group' || block.kind === 'subgroup') && !labels[block.kind];
    const blocks = pageModel.blocks.filter(block => !empty(block));
    const models = blocks.find(block => block.kind === 'models');
    const dropped = pageModel.blocks.filter(empty);
    if (!models || !dropped.length) return blocks;
    const top = Math.min(...dropped.map(block => block.y));
    if (top >= models.y) return blocks;
    const overlaps = blocks.some(block => block !== models && block.y < models.y && block.y + block.h > top && block.x < models.x + models.w && block.x + block.w > models.x);
    if (overlaps) return blocks;
    return blocks.map(block => (block === models ? { ...block, y: top, h: block.h + (block.y - top) } : block));
  }
  /* Ara başlık şeritleri: yazı boyutu kart yazısından biraz büyük; uzun grup
     adı (ör. tam kumaş tanımı) kısaltılmaz, en çok 3 satıra sarılır.
     Döner: { height(text, kind), units(text, kind), size }. */
  function stripMetrics(rect, raw, { charEm = CHAR_EM } = {}) {
    const l = raw && raw.columns ? raw : normalizeLayout('pdf', raw);
    const gap = Number(l.gap) || 0;
    const rowH = (rect.h - gap * (Math.max(1, l.rows) - 1)) / Math.max(1, l.rows);
    const size = Math.max(7, Math.min(16, (Number(l.cardTextSize) || 12) * 1.05));
    const height = (text, kind) => {
      const s = kind === 'group' ? size * 1.1 : size;
      const lines = Math.min(3, wrapCount(text || '', Math.max(20, rect.w - 20), s, charEm.head));
      return Math.min(rowH, lines * s * 1.2 + 8);
    };
    return { size, height, units: (text, kind) => (height(text, kind) + gap) / (rowH + gap) };
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
      // Katalog sayfası: 12 sütunlu blok ızgarası; her sayfa tam bir A4 içerik kutusu
      // (yükseklik 2 mm pay bırakır: taşma olursa boş sayfa oluşmaz).
      `.bl-catalog-page{display:grid;grid-template-columns:repeat(12,minmax(0,1fr));grid-template-rows:repeat(${l.page.rows},minmax(0,1fr));gap:${l.gap}px;width:${box.width}mm;height:${box.height}mm;margin:0;break-before:page;break-inside:avoid;overflow:hidden;box-sizing:border-box;}`,
      '.bl-catalog{display:block;}',
      // Başlık blokları: yazı boyutu sunucuda kutuya sığacak şekilde hesaplanır (satır içi).
      '.bl-cb{min-width:0;min-height:0;overflow:hidden;display:flex;flex-direction:column;justify-content:center;line-height:1.15;}',
      '.bl-cb>h2,.bl-cb>h3,.bl-cb>h4,.bl-cb>div{margin:0;padding:0;border:0;background:none;font-size:inherit;font-weight:inherit;color:inherit;line-height:1.15;letter-spacing:0;text-transform:none;overflow-wrap:anywhere;}',
      '.bl-cb>*::before,.bl-cb>*::after{display:none !important;}',
      '.bl-cb.is-center{align-items:center;}.bl-cb.is-right{align-items:flex-end;padding-right:4px;}',
      '.bl-cb-title{font-weight:600;color:var(--logo);justify-content:flex-end;}',
      '.bl-cb-title.is-fill{background:var(--thead-bg);border-bottom:3px solid var(--logo);padding:0 12px;justify-content:center;}',
      '.bl-cb-group{font-weight:600;color:var(--logo);border-left:4px solid var(--logo);padding-left:10px;}',
      '.bl-cb-group.is-fill{background:var(--thead-bg);padding:0 10px;}',
      '.bl-cb-subgroup{color:var(--head-ink);font-weight:600;}',
      '.bl-cb-subgroup.is-fill{background:var(--thead-bg);padding:0 10px;}',
      '.bl-cb-text{justify-content:flex-start;white-space:pre-wrap;color:var(--ink2);}',
      // Model kartları: görsel kalan alanı doldurur, metin doğal yüksekliğinde (kırpılmaz).
      '.bl-cb-models{display:block;}',
      `.bl-cb-models .bl-gallery{height:100%;margin:0;display:grid;grid-template-columns:repeat(${l.columns},minmax(0,1fr));align-content:start;gap:${l.gap}px;}`,
      '.bl-cb-models .bl-strip{display:flex;align-items:center;min-width:0;overflow:hidden;padding:0 8px;background:var(--thead-bg);border-left:3px solid var(--logo);color:var(--logo);font-weight:600;line-height:1.2;overflow-wrap:anywhere;}',
      '.bl-cb-models .bl-strip.is-group{background:var(--logo);color:#fff;border-left-color:var(--logo);}',
      '.bl-cb-models .bl-card{display:flex;flex-direction:column;min-width:0;min-height:0;overflow:hidden;margin:0;padding:var(--bl-card-pad,6px);font-size:var(--bl-card-fs,12px);line-height:1.18;gap:0;box-sizing:border-box;}',
      '.bl-cb-models .bl-card-img{flex:1 1 0;min-height:0;display:flex;align-items:center;justify-content:center;background:#fff;border:1px solid var(--line);margin:0 0 4px;overflow:hidden;}',
      '.bl-cb-models .bl-card-img .bl-model-img,.bl-cb-models .bl-card-img .bl-noimg{width:100%;height:100%;aspect-ratio:auto;object-fit:contain;margin:0;border:0;}',
      '.bl-cb-models .bl-card-body{flex:0 0 auto;display:flex;flex-direction:column;gap:1px;min-width:0;}',
      '.bl-cb-models .bl-card-body h3{font-size:1.15em;line-height:1.15;margin:0 0 2px;color:var(--logo);overflow-wrap:anywhere;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;}',
      '.bl-cb-models .bl-card-body p{margin:0;color:var(--ink2);overflow-wrap:anywhere;}',
      '.bl-cb-models .bl-card-body .bl-badge{align-self:flex-start;margin-top:3px;padding:1px 6px;font-size:.92em;line-height:1.3;white-space:normal;animation:none;}',
      '.bl-cb-models .bl-gallery.is-tight .bl-card-body p{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;}',
      `@media screen{.bl-catalog-page{margin:${l.gap * 2}px auto;outline:1px dashed var(--line);outline-offset:6px;}}`,
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
    normalizeItem, cardContent, cardFit, fitText, wrapCount, CHAR_EM, CHAR_EM_OFFICE, ITEM_LIMITS, TONES, catalogSlots, stripMetrics, pageBlocks,
  };
});
