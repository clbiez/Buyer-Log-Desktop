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
  /* Kart bayrakları: showBadge: kart etiketi (varsayılan kapalı) ·
     showFieldLabels: kart bilgisinde alan adı ("Fit Regular") · packGroups:
     küçük grupları aynı slayta/sayfaya yan yana diz · autoFit: az model varsa
     kartları büyüt. Alt bilgi ve not varsayılan kapalıdır: kartta görsel önde,
     altında yalnız seçilen kısa bilgiler. */
  const CARD_FLAGS = ['showTitle', 'showSubtitle', 'showNote', 'showBadge', 'showFieldLabels', 'packGroups', 'autoFit'];
  const FLAG_OFF = new Set(['showSubtitle', 'showNote', 'showBadge']);
  const FLAGS = Object.freeze({ pptx: CARD_FLAGS, pdf: CARD_FLAGS, xlsx: [] });
  const MAX_CARD_FIELDS = 24;
  const specKey = format => (format === 'html' ? 'pdf' : SPEC[format] ? format : null);

  function defaults(format) {
    const key = specKey(format);
    if (!key) return null;
    const out = {};
    for (const [name, spec] of Object.entries(SPEC[key])) out[name] = spec[2];
    for (const flag of FLAGS[key]) out[flag] = !FLAG_OFF.has(flag);
    // Kartta gösterilecek bilgiler (sıralı alan adları); null = varsayılan önemli
    // bilgiler (renk kodu, fit, adet, hedef fiyat — DEFAULT_CARD_ROLES).
    if (key !== 'xlsx') out.cardFields = null;
    return out;
  }

  /* Alan adı anahtarı: büyük/küçük harf, Türkçe harf ve noktalama farkı
     gözetmez ("RENK" = "Renk", "Tedarikçi" = "TEDARIKCI"). */
  const fieldKey = value => String(value == null ? '' : value).replace(/[İIı]/g, 'i').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9%]+/g, ' ').trim();
  const cleanText = (value, max) => String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, max);
  function normalizeCardFields(value) {
    if (!Array.isArray(value)) return null;
    const seen = new Set();
    const out = [];
    for (const item of value) {
      const label = cleanText(item, 60);
      const key = fieldKey(label);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(label);
      if (out.length >= MAX_CARD_FIELDS) break;
    }
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
    if (key !== 'xlsx') out.cardFields = normalizeCardFields(source.cardFields);
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
  /* Hazır yerleşim görünümü değiştirir; kartta hangi bilgilerin yazacağı
     (cardFields) içerik seçimidir, korunur. */
  function applyPreset(format, name, current) {
    const key = specKey(format);
    const preset = PRESETS[name] && PRESETS[name][key];
    if (!preset) return normalizeLayout(format, current);
    if (name !== 'standard') return normalizeLayout(format, { ...(current || {}), ...preset });
    const out = defaults(format);
    if (key !== 'xlsx') out.cardFields = normalizeCardFields(current && current.cardFields);
    return out;
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

  /* ---------------- Model kartı bilgileri ----------------
     Kart bilgisi = { label, value, tone } satırları. Kaynak sırası:
       1) LCW AI'ın karta yazdığı alanlar (item.fields),
       2) Buyer Log kaydı (görsel anahtarının bağlam satırı; records[KOL-3]
          = [[sütun, değer], …]) — değer LCW AI'dan değil kaynaktan gelir.
     layout.cardFields null ise LCW AI'ın seçtiği alanlar; dizi ise kullanıcının
     Yerleşim'de seçtiği alanlar (bu sırayla). Durum/onay alanında "bekliyor,
     eksik, gecikme…" kırmızı, "onaylandı, tamam…" yeşil yazılır. */
  const TONES = ['ok', 'warn', 'risk', 'info'];
  const STATUS_LABEL = /\b(durum|status|statu|onay|approval|konsept|concept|asama|stage|risk)\b/;
  const RISK_VALUE = /\b(bekli|bekle|pending|waiting|eksik|missing|gecik|late|delay|redd|reject|iptal|cancel|hold|risk)/;
  const OK_VALUE = /\b(onaylandi|onayli|approved|tamam|complete|done|hazir|ready)\b/;
  function autoTone(label, value) {
    if (!STATUS_LABEL.test(fieldKey(label))) return '';
    const key = fieldKey(value);
    return RISK_VALUE.test(key) ? 'risk' : OK_VALUE.test(key) ? 'ok' : '';
  }
  function recordValue(record, key) {
    if (!Array.isArray(record)) return '';
    const hit = record.find(pair => Array.isArray(pair) && fieldKey(pair[0]) === key);
    return hit ? cleanText(hit[1], 300) : '';
  }
  /* Varsayılan kart bilgileri (Model adı kartın başlığıdır): renk kodu, fit,
     adet, hedef fiyat. Alan adları kaynağa göre değişir (TR/EN, PLM/Excel
     başlığı); eş anlamlılar öncelik sırasıyla aranır, ilk bulunan kullanılır. */
  const DEFAULT_CARD_ROLES = Object.freeze([
    ['renk kodu', 'color code', 'colour code', 'renk', 'color', 'colour'], // i18n-ignore
    ['fit', 'kalip', 'kesim'], // i18n-ignore
    ['siparis adedi', 'order qty', 'order quantity', 'adet', 'quantity', 'qty', 'miktar'], // i18n-ignore
    ['hedef fiyat', 'target price', 'hedef fob', 'target fob', 'hedef maliyet', 'target cost', 'fob', 'fiyat', 'price'], // i18n-ignore
  ]);
  const hasWords = (key, words) => (` ${key} `).includes(` ${words} `);
  function defaultCardFields(labels) {
    const list = (labels || []).map(label => cleanText(label, 60)).filter(Boolean);
    const out = [];
    for (const role of DEFAULT_CARD_ROLES) {
      let hit = null;
      for (const words of role) { hit = list.find(label => hasWords(fieldKey(label), words) && !out.includes(label)); if (hit) break; }
      if (hit) out.push(hit);
    }
    return out;
  }
  function cardDetails(item, raw, record) {
    const l = raw && typeof raw.showTitle === 'boolean' && 'cardFields' in raw ? raw : normalizeLayout('pptx', raw);
    const own = (item && Array.isArray(item.fields) ? item.fields : []).filter(field => field && cleanText(field.value, 300));
    const pick = (label, value, tone) => ({ label: cleanText(label, 60), value: cleanText(value, 300), tone: TONES.includes(tone) && tone !== 'info' ? tone : autoTone(label, value) });
    const rows = Array.isArray(record) ? record.filter(pair => Array.isArray(pair) && cleanText(pair[1], 300)) : [];
    // Varsayılan: önemli bilgiler (LCW AI'ın alanları + kaynak satır); hiçbiri yoksa LCW AI'ın ilk alanları.
    let chosen = l.cardFields;
    if (!Array.isArray(chosen)) {
      chosen = defaultCardFields([...own.map(field => field.label), ...rows.map(pair => pair[0])]);
      if (!chosen.length) return own.slice(0, 4).map(field => pick(field.label, field.value, field.tone));
    }
    return chosen.map(label => {
      const key = fieldKey(label);
      const hit = own.find(field => fieldKey(field.label) === key);
      if (hit) return pick(hit.label, hit.value, hit.tone);
      const value = recordValue(record, key);
      return value ? pick(label, value, '') : null;
    }).filter(Boolean);
  }
  /* Yerleşim aracındaki alan seçicisi: kartlarda kullanılabilecek tüm alanlar
     (önce LCW AI'ın yazdıkları, sonra kaynak kayıttaki diğer sütunlar) ve
     seçim yapılmadıysa gösterilen varsayılanlar. */
  function availableCardFields(items, records) {
    const seen = new Set();
    const ai = [];
    const source = [];
    const add = (list, label) => { const text = cleanText(label, 60); const key = fieldKey(text); if (key && !seen.has(key)) { seen.add(key); list.push(text); } };
    for (const item of items || []) for (const field of (item && item.fields) || []) if (field && cleanText(field.value, 300)) add(ai, field.label);
    for (const item of items || []) {
      const record = records && item && item.image ? records[String(item.image).toUpperCase()] : null;
      for (const pair of Array.isArray(record) ? record : []) if (Array.isArray(pair) && cleanText(pair[1], 300)) add(source, pair[0]);
    }
    const defaults = defaultCardFields([...ai, ...source]);
    return { ai, source, defaults: defaults.length ? defaults : ai.slice(0, 4) };
  }

  /* Kart içi düzen (pt): metin satırları kadar yer ayrılır, görsel kalan
     alanı (en çok imageShare kadar) alır; sığmayan satır gösterilmez. */
  function cardLayout(cell, raw, { lines = 0, badge = false, title = false, meta = false, scale = 1 } = {}) {
    // Görsel önce gelir: en az imageShare kadar yer alır, metin kısa kalırsa
    // kalan yeri de görsel kullanır. Metin ikinci plandadır: küçük yazı;
    // sığmazsa önce yazı küçülür (alt sınır), sonra son satırlar düşer.
    const l = raw && raw.cardTextSize ? raw : normalizeLayout('pptx', raw);
    const grow = Math.min(1.45, Math.max(1, Math.sqrt(scale)));
    const pad = Math.max(3, Math.min(7, cell.w * 0.045));
    const inner = cell.h - pad * 2;
    const imgShare = Math.max(16, inner * l.imageShare / 100);
    const want = l.cardTextSize * grow;
    const need = factor => (badge ? want * factor * 1.1 + 3 : 0) + (title ? want * factor * 1.3 : 0) + (meta ? want * factor * 0.85 * 1.25 : 0) + lines * want * factor * 0.85 * 1.25 + 4;
    const space = Math.max(0, inner - imgShare - 3);
    const factor = Math.max(Math.min(1, 6.5 / want), Math.min(1, space / Math.max(1, need(1))));
    const size = Number((want * factor).toFixed(2));
    const detail = Math.max(5.5, Number((size * 0.85).toFixed(2)));
    const line = detail * 1.25;
    const text = need(factor);
    const imgH = Math.min(inner * 0.9, Math.max(imgShare, inner - text - 3));
    const head = (badge ? size * 1.1 + 3 : 0) + (title ? size * 1.3 : 0) + (meta ? line : 0);
    const maxLines = Math.max(0, Math.floor((inner - imgH - 3 - head - 4) / line + 0.2));
    return { pad, imgH, size, detail, line, maxLines };
  }

  /* Kartın tüm içeriği (PowerPoint ve önizleme ortak): görsel yüksekliği,
     yazı boyutları ve bilgi satırları. Bilgiler alt alta sığmazsa genişlik
     yettikçe aynı satırda "·" ile yan yana dizilir; yine sığmayan son
     bilgiler gösterilmez (görsel küçülmez). */
  function packDetailLines(details, width, size, labels) {
    const charW = size * 0.52;
    const textOf = row => `${labels ? `${row.label} ` : ''}${row.value}`;
    const lines = [];
    for (const row of details) {
      const last = lines[lines.length - 1];
      const length = last ? last.reduce((sum, item) => sum + textOf(item).length + 3, 0) + textOf(row).length : Infinity;
      if (last && length * charW <= width) last.push(row); else lines.push([row]);
    }
    return lines;
  }
  function cardContent(cell, raw, item, record, scale = 1) {
    const l = raw && typeof raw.showTitle === 'boolean' && 'cardFields' in raw ? raw : normalizeLayout('pptx', raw);
    const details = cardDetails(item || {}, l, record);
    const meta = [l.showSubtitle ? item.subtitle : '', l.showNote ? item.note : ''].filter(Boolean).join(' · ');
    const badge = l.showBadge && item.badge ? item.badge : '';
    const title = l.showTitle && item.title ? item.title : '';
    const flags = { badge: Boolean(badge), title: Boolean(title), meta: Boolean(meta), scale };
    let box = cardLayout(cell, l, { ...flags, lines: details.length });
    let lines = details.map(row => [row]);
    if (box.maxLines < lines.length) {
      lines = packDetailLines(details, cell.w - box.pad * 2, box.detail, l.showFieldLabels);
      box = cardLayout(cell, l, { ...flags, lines: lines.length });
    }
    return { box, title, meta, badge, lines: lines.slice(0, box.maxLines), hidden: Math.max(0, lines.length - box.maxLines) };
  }

  /* ---------------- Galeri grupları: paketleme ----------------
     Ardışık galeri slaytları (ve bir galerideki "group" alanı) GRUPtur.
     Grup, satırın kalanına sığıyorsa yan yana yerleşir; sığmıyorsa yeni
     satıra, tek sayfaya sığan grup sayfa sonunda bölünmez. Birden çok grup
     taşıyan sayfada her grubun üstünde adı ve çizgisi, grupların arasında
     ayraç vardır. Az dolu sayfada (autoFit) kartlar oran korunarak büyür. */
  const tokensOf = title => String(title == null ? '' : title).split(/\s+[·•—–|/-]\s+|\s*,\s+|\s+:\s+/).map(part => part.trim()).filter(Boolean);
  function commonLabels(titles) {
    const lists = titles.map(tokensOf);
    if (lists.length < 2 || lists.some(list => !list.length)) return { common: '', labels: titles.map(title => cleanText(title, 140)) };
    let n = 0;
    const shortest = Math.min(...lists.map(list => list.length));
    while (n < shortest - 1 && lists.every(list => fieldKey(list[n]) === fieldKey(lists[0][n]))) n++;
    return { common: lists[0].slice(0, n).join(' · '), labels: lists.map((list, i) => (n ? list.slice(n).join(' · ') : cleanText(titles[i], 140))) };
  }
  /* Sıra korunur; yalnız satırda kalan boşluğa TAMAMEN sığan sonraki küçük
     grup öne alınır (satır boş kalmasın). */
  function packGroups(groups, columns, rows) {
    const out = [];
    const done = new Set();
    let page = 0, row = 0, col = 0;
    const newRow = () => { row++; col = 0; if (row >= rows) { page++; row = 0; } };
    const place = gi => {
      done.add(gi);
      groups[gi].items.forEach((item, index) => { if (col >= columns) newRow(); out.push({ page, row, col, group: gi, index }); col++; });
    };
    groups.forEach((group, gi) => {
      const n = group.items.length;
      if (done.has(gi) || !n) return;
      if (col > 0 && n > columns - col) {
        for (let next = gi + 1; next < groups.length && col < columns; next++) {
          const size = groups[next].items.length;
          if (!done.has(next) && size && size <= columns - col) place(next);
        }
        if (col > 0) newRow();
      }
      if (col === 0 && row > 0 && n <= columns * rows && Math.ceil(n / columns) > rows - row) { page++; row = 0; }
      place(gi);
    });
    return out;
  }
  /* groups: [{ title, subtitle, items, sources }] → sayfalar (pt, 960 × 540):
     { title, subtitle, cells:[{x,y,w,h,item,group}], labels:[{x,y,w,text,cont}],
       rules:[{x,y,w}], dividers:[{x,y,h}], scale, groups:[gi], sources }. */
  function galleryPages(raw, groups, { english = false, fallbackTitle = '' } = {}) {
    const g = pptxGeometry(raw);
    const l = g.layout;
    const C = l.columns, R = l.rows, gap = l.gap;
    const list = (groups || []).filter(group => group && Array.isArray(group.items) && group.items.length);
    if (!list.length) return [];
    const labelH = Number((l.cardTextSize * 1.4 + 7).toFixed(1));
    const top = g.contentTop + 8;
    const availH = g.contentH - 8;
    const runs = l.packGroups ? [list] : list.map(group => [group]);
    const pages = [];
    for (const run of runs) {
      const placed = packGroups(run, C, R);
      const pageCount = placed.length ? placed[placed.length - 1].page + 1 : 0;
      const groupPages = run.map((_, gi) => [...new Set(placed.filter(p => p.group === gi).map(p => p.page))]);
      for (let pi = 0; pi < pageCount; pi++) {
        let items = placed.filter(p => p.page === pi);
        const ids = [...new Set(items.map(p => p.group))];
        const labelled = ids.length > 1;
        const strip = labelled ? labelH : 0;
        const baseW = (g.width - gap * (C - 1)) / C;
        const baseH = (availH - gap * (R - 1) - strip * R) / R;
        let cols = C, cellW = baseW, cellH = baseH;
        const split = ids.some(gi => groupPages[gi].length > 1);
        const usedRows = Math.max(...items.map(p => p.row)) + 1;
        const usedCols = Math.max(...items.map(p => p.col)) + 1;
        // Az dolu sayfa: daha küçük ızgara denenir, kart oranı korunarak büyür (en çok 3 kat).
        if (l.autoFit && !split && (usedRows < R || usedCols < C)) {
          const aspect = baseW / Math.max(1, (availH - gap * (R - 1)) / R);
          const subset = ids.map(gi => ({ items: run[gi].items }));
          let best = null;
          for (let c = 1; c <= C; c++) {
            for (let r = 1; r <= R; r++) {
              const trial = packGroups(subset, c, r);
              if (trial.some(p => p.page > 0)) continue;
              const w0 = (g.width - gap * (c - 1)) / c;
              const h0 = (availH - gap * (r - 1) - strip * r) / r;
              const w = Math.min(w0, h0 * aspect, baseW * 3);
              if (w > cellW + 0.5 && (!best || w > best.w + 0.5)) best = { c, w, trial };
            }
          }
          if (best) {
            cols = best.c; cellW = best.w; cellH = best.w / aspect;
            items = best.trial.map(p => ({ ...p, group: ids[p.group] }));
          }
        }
        const colsUsed = Math.max(...items.map(p => p.col)) + 1;
        const blockW = colsUsed * cellW + gap * (colsUsed - 1);
        const left = cols === C && cellW === baseW ? g.margin : g.margin + (g.width - blockW) / 2;
        // Büyütülen blok içerik alanında dikeyde de ortalanır.
        const rowsUsed = Math.max(...items.map(p => p.row)) + 1;
        const blockH = rowsUsed * (cellH + strip) + gap * (rowsUsed - 1);
        const offsetY = cellW === baseW ? 0 : Math.max(0, (availH - blockH) / 2);
        const xOf = col => left + col * (cellW + gap);
        const yOf = row => top + offsetY + row * (cellH + gap + strip) + strip;
        const titles = ids.map(gi => run[gi].title);
        const named = commonLabels(titles);
        const cells = items.map(p => ({ x: xOf(p.col), y: yOf(p.row), w: cellW, h: cellH, item: run[p.group].items[p.index], group: p.group }));
        const labels = [], rules = [], dividers = [];
        if (labelled) {
          const segments = [];
          for (const p of items) {
            const last = segments[segments.length - 1];
            if (last && last.group === p.group && last.row === p.row) last.to = p.col;
            else segments.push({ group: p.group, row: p.row, from: p.col, to: p.col });
          }
          const seen = new Set();
          for (const seg of segments) {
            const x = xOf(seg.from);
            const w = xOf(seg.to) + cellW - x;
            const y = yOf(seg.row) - strip;
            rules.push({ x, y: y + strip - 4, w, group: seg.group });
            if (!seen.has(seg.group)) {
              seen.add(seg.group);
              const cont = groupPages[seg.group][0] !== pi;
              labels.push({ x, y, w, h: strip - 4, text: named.labels[ids.indexOf(seg.group)], cont, group: seg.group });
            }
            if (seg.from > 0 && segments.some(other => other !== seg && other.row === seg.row && other.to === seg.from - 1)) dividers.push({ x: x - gap / 2, y, h: strip + cellH });
          }
        }
        const one = ids.length === 1 ? run[ids[0]] : null;
        const parts = one ? groupPages[ids[0]].length : 0;
        const title = one
          ? (parts > 1 ? `${one.title} (${groupPages[ids[0]].indexOf(pi) + 1}/${parts})` : one.title)
          : named.common || fallbackTitle || (english ? 'Model gallery' : 'Model galerisi');
        const count = items.length;
        const subtitle = one ? (one.subtitle || '') : (english ? `${ids.length} groups · ${count} models` : `${ids.length} grup · ${count} model`);
        pages.push({ title, subtitle, cells, labels, rules, dividers, scale: cellW / baseW, groups: ids.map(gi => run[gi]), sources: [...new Set(ids.flatMap(gi => run[gi].sources || []))], labelH: strip });
      }
    }
    return pages;
  }
  /* Slayt listesindeki galerileri gruplara çevirip paketler. Döner:
     [{ slide } | { page, sources }] — PowerPoint ve önizleme aynı sonucu kullanır. */
  function expandGalleries(slides, raw, { english = false } = {}) {
    const out = [];
    let run = [];
    let lastSection = '';
    const flush = () => {
      if (!run.length) return;
      for (const page of galleryPages(raw, run, { english, fallbackTitle: lastSection })) out.push({ page, sources: page.sources });
      run = [];
    };
    (slides || []).forEach((slide, index) => {
      if (!slide || slide.layout !== 'gallery') {
        flush();
        if (slide && (slide.layout === 'section' || slide.layout === 'title')) lastSection = slide.layout === 'section' ? slide.title : lastSection;
        out.push({ slide, sources: [index] });
        return;
      }
      const items = Array.isArray(slide.items) ? slide.items : [];
      const named = [...new Set(items.map(item => cleanText(item && item.group, 80)).filter(Boolean))];
      if (named.length > 1 || (named.length === 1 && items.every(item => cleanText(item && item.group, 80)))) {
        for (const name of named) run.push({ title: `${slide.title} · ${name}`, subtitle: slide.subtitle || '', items: items.filter(item => cleanText(item && item.group, 80) === name), sources: [index] });
        const loose = items.filter(item => !cleanText(item && item.group, 80));
        if (loose.length) run.push({ title: slide.title, subtitle: slide.subtitle || '', items: loose, sources: [index] });
      } else run.push({ title: slide.title, subtitle: slide.subtitle || '', items, sources: [index] });
    });
    flush();
    return out;
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
      // Görsel, kart bilgisine yer kalacak kadar küçülür (en çok imageShare).
      // Görsel önce: en az imageShare kadar, kalan boşluk da görselin; yazı küçük kalır.
      `.bl-gallery-page .bl-model-img,.bl-gallery-page .bl-noimg{flex:1 1 0;min-height:${l.imageShare}%;height:auto;aspect-ratio:auto;}`,
      '.bl-gallery-page>.bl-card{overflow:hidden;}',
      '.bl-gallery-page>.bl-card>:not(.bl-model-img):not(.bl-noimg){flex:none;}',
      `@media screen{.bl-gallery-page+.bl-gallery-page{margin-top:${l.gap * 2}px;padding-top:${l.gap * 2}px;border-top:2px dashed var(--line);}}`,
      // Gruplar: aynı ızgarada yan yana; her grup kart sayısı kadar sütun kaplar.
      `.bl-groups{grid-template-columns:repeat(${l.columns},minmax(0,1fr));column-gap:${Math.round(l.gap * 1.6)}px;row-gap:${Math.round(l.gap * 1.4)}px;}`,
      ...Array.from({ length: 8 }, (_, i) => `.bl-gallery.bl-cols-${i + 1},.bl-groups.bl-cols-${i + 1}{grid-template-columns:repeat(${i + 1},minmax(0,1fr));}.bl-group.bl-span-${i + 1}{grid-column:span ${i + 1};}`),
      ...partialRowsCss(l, box),
      l.showTitle ? '' : '.bl-gallery>.bl-card h3{display:none;}',
      l.showSubtitle ? '' : '.bl-gallery>.bl-card small{display:none;}',
      l.showNote ? '' : '.bl-gallery>.bl-card p{display:none;}',
      l.showBadge ? '' : '.bl-gallery .bl-card .bl-badge{display:none;}',
      l.showFieldLabels ? '' : '.bl-specs dt{display:none;}',
    ];
    return css.filter(Boolean).join('\n');
  }
  /* Yarım sayfa (satırları dolmamış) galeri parçası: tam sayfa kutusu yerine
     yalnız dolu satırlar kadar yer kaplar; sonraki bölüm aynı sayfaya akar.
     Kart oranı a = (genişlik/sütun) / (yükseklik/satır) korunur: K sütun ×
     N satırlık parçanın oranı K·a / N (parçanın genişliğinden bağımsız). */
  function partialRowsCss(l, box) {
    const a = (box.width / l.columns) / (box.height / l.rows);
    const rules = [];
    for (let n = 1; n <= l.rows; n++) {
      if (n < l.rows) rules.push(`.bl-gallery-page.bl-rows-${n}{grid-template-rows:repeat(${n},minmax(0,1fr));aspect-ratio:${(l.columns * a).toFixed(3)} / ${n};}`);
      for (let k = 1; k <= 8; k++) if (k !== l.columns || n < l.rows) rules.push(`.bl-gallery-page.bl-cols-${k}.bl-rows-${n}{grid-template-rows:repeat(${n},minmax(0,1fr));aspect-ratio:${(k * a).toFixed(3)} / ${n};}`);
    }
    return rules;
  }

  /* ---------------- PDF/HTML: kart bilgisi ve gruplar (HTML dizesi) ----------------
     Girdi temizlenmiş (dengeli) rapor gövdesidir; çıktı yalnız sınıf ekler ya
     da Buyer Log'un kendi ürettiği <dl class="bl-specs"> bloğunu yazar
     (değerler kaçışlıdır). Taslak bu işlemlerden geçmemiş hâliyle saklanır. */
  const escHtml = value => String(value == null ? '' : value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const textOf = html => String(html || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;|&#160;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
  const OPEN_TAG = /<(div|section|article|aside)\b([^>]*)>/gi;
  const classesOf = attrs => { const m = /\bclass="([^"]*)"/i.exec(attrs || ''); return m ? m[1].split(/\s+/).filter(Boolean) : []; };
  function elementEnd(html, tag, from) {
    const re = new RegExp(`<(/?)${tag}\\b[^>]*>`, 'gi');
    re.lastIndex = from;
    let depth = 1, match;
    while ((match = re.exec(html))) {
      if (match[1]) { if (--depth === 0) return re.lastIndex; } else depth++;
    }
    return -1;
  }
  /* class listesinde `name` bulunan öğeler: { start, openEnd, end, tag, attrs, classes }. */
  function elementsWith(html, name) {
    const out = [];
    OPEN_TAG.lastIndex = 0;
    let match;
    while ((match = OPEN_TAG.exec(html))) {
      const classes = classesOf(match[2]);
      if (!classes.includes(name)) continue;
      const end = elementEnd(html, match[1].toLowerCase(), OPEN_TAG.lastIndex);
      if (end > 0) out.push({ start: match.index, openEnd: OPEN_TAG.lastIndex, end, tag: match[1].toLowerCase(), attrs: match[2], classes });
    }
    return out;
  }
  function withClasses(open, tag, attrs, classes) {
    const value = classes.join(' ');
    return /\bclass="/i.test(attrs) ? `<${tag}${attrs.replace(/\bclass="[^"]*"/i, `class="${value}"`)}>` : `<${tag} class="${value}"${attrs}>`;
  }
  function applyEdits(html, edits) {
    let out = html;
    edits.sort((a, b) => b.start - a.start).forEach(edit => { out = out.slice(0, edit.start) + edit.text + out.slice(edit.end); });
    return out;
  }
  const countCards = html => (String(html).match(/\bclass="(?:[^"]*\s)?bl-card(?:\s[^"]*)?"/g) || []).length;

  function specsHtml(rows) {
    return rows.length ? `<dl class="bl-specs">${rows.map(row => `<div${row.tone ? ` class="${row.tone}"` : ''}><dt>${escHtml(row.label)}</dt><dd>${row.html != null ? row.html : escHtml(row.value)}</dd></div>`).join('')}</dl>` : '';
  }
  function applyCardFields(html, raw, records) {
    const l = normalizeLayout('pdf', raw);
    const source = String(html || '');
    const edits = [];
    for (const card of elementsWith(source, 'bl-card')) {
      const inner = source.slice(card.openEnd, card.end);
      const token = (/data-bl-image="([^"]+)"/.exec(inner) || [])[1];
      const dl = /<dl\b[^>]*class="[^"]*\bbl-specs\b[^"]*"[^>]*>[\s\S]*?<\/dl>/i.exec(inner);
      if (!token && !dl) continue;
      const own = [];
      if (dl) {
        const pair = /<dt\b[^>]*>([\s\S]*?)<\/dt>\s*<dd\b[^>]*>([\s\S]*?)<\/dd>/gi;
        let match;
        while ((match = pair.exec(dl[0]))) own.push({ label: textOf(match[1]), value: textOf(match[2]), html: match[2] });
      }
      const record = token && records ? records[String(token).toUpperCase()] : null;
      const rows = cardDetails({ fields: own }, l, record).map(row => {
        const hit = own.find(field => fieldKey(field.label) === fieldKey(row.label) && field.value === row.value);
        return { ...row, html: hit ? hit.html : null };
      });
      const block = specsHtml(rows);
      if (dl) edits.push({ start: card.openEnd + dl.index, end: card.openEnd + dl.index + dl[0].length, text: block });
      else if (block) {
        const head = /<\/h3>/i.exec(inner);
        const at = head ? card.openEnd + head.index + head[0].length : card.end - `</${card.tag}>`.length;
        edits.push({ start: at, end: at, text: block });
      }
    }
    return edits.length ? applyEdits(source, edits) : source;
  }
  /* Grup kapsayıcısı (.bl-groups > .bl-group) ve tek galeriler: grup kart
     sayısı kadar sütun kaplar (bl-span-K, iç galeri bl-cols-K); az kartlı
     galeri/grup satırı autoFit ile büyür. İşlem tekrarlanabilir. */
  const DECOR = /^bl-(span|cols)-\d+$/;
  function decorateGroups(html, raw) {
    const l = normalizeLayout('pdf', raw);
    const C = l.columns;
    const source = String(html || '');
    const edits = [];
    const groups = elementsWith(source, 'bl-group');
    const inside = (el, list) => list.some(g => el.start > g.start && el.end <= g.end);
    const spans = new Map();
    for (const group of groups) {
      const inner = source.slice(group.openEnd, group.end);
      const k = Math.min(C, Math.max(1, countCards(inner)));
      spans.set(group, k);
      edits.push({ start: group.start, end: group.openEnd, text: withClasses('', group.tag, group.attrs, [...group.classes.filter(name => !DECOR.test(name)), `bl-span-${k}`]) });
    }
    for (const gallery of elementsWith(source, 'bl-gallery')) {
      const base = gallery.classes.filter(name => !DECOR.test(name));
      const owner = groups.filter(g => gallery.start > g.start && gallery.end <= g.end).pop();
      let k = 0;
      if (owner) k = spans.get(owner);
      else if (l.autoFit) { const n = countCards(source.slice(gallery.openEnd, gallery.end)); if (n && n < C) k = Math.max(n, Math.ceil(C / 3)); }
      edits.push({ start: gallery.start, end: gallery.openEnd, text: withClasses('', gallery.tag, gallery.attrs, k ? [...base, `bl-cols-${k}`] : base) });
    }
    for (const box of elementsWith(source, 'bl-groups')) {
      const members = groups.filter(g => g.start > box.start && g.end <= box.end && !inside(g, groups.filter(other => other !== g && other.start > box.start)));
      const total = members.reduce((sum, g) => sum + spans.get(g), 0);
      const base = box.classes.filter(name => !DECOR.test(name));
      const k = l.autoFit && total && total < C ? Math.max(total, Math.ceil(C / 3)) : 0;
      edits.push({ start: box.start, end: box.openEnd, text: withClasses('', box.tag, box.attrs, k ? [...base, `bl-cols-${k}`] : base) });
    }
    return edits.length ? applyEdits(source, edits) : source;
  }
  /* Rapor gövdesi → dosyaya/önizlemeye giden hâl: kart bilgileri, gruplar,
     (PDF'te) sütun × satır sayfaları. */
  function prepareReport(html, raw, { pages = true, records = null } = {}) {
    const l = normalizeLayout('pdf', raw);
    return paginateGallery(decorateGroups(applyCardFields(html, l, records), l), l, { pages });
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
      // Sayfa sınıfları her bölmede yeniden yazılır; yalnız birleştirmede (taslak) süsleme de atılır.
      const classes = match[1].split(/\s+/).filter(name => name && name !== 'bl-gallery-page' && name !== 'bl-gallery-first' && !/^bl-rows-\d+$/.test(name) && (raw || !DECOR.test(name)));
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
    const l = pages && raw ? normalizeLayout('pdf', raw) : null;
    let out = '', cursor = 0;
    for (const group of groups) {
      out += source.slice(cursor, group.start);
      const decor = group.classes.filter(name => DECOR.test(name));
      const classes = group.classes.filter(name => !DECOR.test(name)).join(' ');
      // Grup içindeki (ya da autoFit) galeri kendi sütun sayısıyla bölünür.
      const cols = l ? Math.min(8, Number((decor.find(name => /^bl-cols-/.test(name)) || '').slice(8)) || l.columns) : 0;
      const size = l ? cols * l.rows : Infinity;
      const tail = decor.length ? ` ${decor.join(' ')}` : '';
      if (size === Infinity || !group.children.length) out += `<div class="${classes}${tail}">${group.children.join('')}</div>`;
      else for (let i = 0; i < group.children.length; i += size) {
        const chunk = group.children.slice(i, i + size);
        out += `<div class="${classes} bl-gallery-page${i ? '' : ' bl-gallery-first'} bl-rows-${Math.ceil(chunk.length / cols)}${tail}">${chunk.join('')}</div>`;
      }
      cursor = group.end;
    }
    return out + source.slice(cursor);
  }

  /* ---------------- Excel ---------------- */
  function xlsxMetrics(raw) {
    const l = normalizeLayout('xlsx', raw);
    return { ...l, imageRow: l.imageSize + 6, imageBoxPx: Math.round(l.imageSize * 4 / 3), imageColChars: Math.max(8, Math.round(l.imageSize * 4 / 3 / 7) + 1) };
  }

  return {
    SPEC, FLAGS, PRESETS, SLIDE, PAGE, specKey, defaults, normalizeLayout, isDefault, perPage, applyPreset, pptxGeometry, galleryCells, pageBox, layoutCss, paginateGallery, xlsxMetrics,
    fieldKey, normalizeCardFields, autoTone, DEFAULT_CARD_ROLES, defaultCardFields, cardDetails, availableCardFields, packDetailLines, cardContent, cardLayout, commonLabels, packGroups, galleryPages, expandGalleries,
    applyCardFields, decorateGroups, prepareReport,
  };
});
