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
  const PAPERS = Object.freeze({ '16:9': [960, 540], A3: [842, 1191], A4: [595, 842], A5: [420, 595], Letter: [612, 792] });
  function normalizeStudio(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const spans = {};
    for (const [id, span] of Object.entries(value.spans || {}).slice(0, 30000)) if (/^[A-Z]{2,4}-\d{1,6}$/.test(id) && [1, 2].includes(span)) spans[id] = span;
    return { version: 1, sizing: ['equal', 'sets', 'auto'].includes(value.sizing) ? value.sizing : 'sets',
      reflow: ['dense', 'large', 'balanced', 'fixed'].includes(value.reflow) ? value.reflow : 'balanced',
      paper: PAPERS[value.paper] ? value.paper : '16:9', orientation: value.orientation === 'portrait' ? 'portrait' : 'landscape',
      spans, galleryFirst: value.galleryFirst === true, headerHidden: value.headerHidden === true,
      note: cleanText(value.note, 400), noteHeight: Math.max(0, Math.min(160, Number(value.noteHeight) || 0)),
      preset: cleanText(value.preset, 30), groupRules: Object.fromEntries(Object.entries(value.groupRules || {}).filter(([key, mode]) => /^[\w .%-]{1,60}$/.test(key) && ['page', 'section', 'inline', 'side'].includes(mode)).slice(0, 3)) };
  }
  function pageSize(raw) {
    const studio = raw && raw.studio;
    if (!studio) return { width: SLIDE.width, height: SLIDE.height };
    const pair = PAPERS[studio.paper] || PAPERS['16:9'];
    const [a, b] = pair;
    return studio.orientation === 'portrait' ? { width: Math.min(a, b), height: Math.max(a, b) } : { width: Math.max(a, b), height: Math.min(a, b) };
  }
  const specKey = format => (format === 'html' ? 'pdf' : SPEC[format] ? format : null);

  function defaults(format) {
    const key = specKey(format);
    if (!key) return null;
    const out = {};
    for (const [name, spec] of Object.entries(SPEC[key])) out[name] = spec[2];
    for (const flag of FLAGS[key]) out[flag] = !FLAG_OFF.has(flag);
    // Kartta gösterilecek bilgiler (sıralı alan adları); null = varsayılan önemli
    // bilgiler (renk kodu, fit, adet, hedef fiyat — DEFAULT_CARD_ROLES).
    if (key !== 'xlsx') { out.cardFields = null; out.groupBy = null; out.groupBreak = 1; out.pageTitle = null; }
    return out;
  }

  /* Alan adı anahtarı: büyük/küçük harf, Türkçe harf ve noktalama farkı
     gözetmez ("RENK" = "Renk", "Tedarikçi" = "TEDARIKCI"). */
  const fieldKey = value => String(value == null ? '' : value).replace(/[İIı]/g, 'i').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9%]+/g, ' ').trim();
  const cleanText = (value, max) => String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, max);
  /* Gruplama: en çok 3 seviye alan adı (1. grup / 2. grup / 3. grup);
     null = LCW AI'ın gruplaması. groupBreak: ilk kaç seviye yeni slayt/bölüm
     başlatır (varsayılan 1: yalnız 1. grup; 0: hiçbiri). Kalan seviyeler
     sayfada adlarıyla yan yana gruplardır (ör. LİSANS slaytında Tişört ·
     SJ 30/1 ve Sweatshirt · 3 İP grupları birlikte). */
  const GROUP_LEVELS = 3;
  function normalizeGroupBy(value) {
    const list = normalizeCardFields(value);
    return list && list.length ? list.slice(0, GROUP_LEVELS) : null;
  }
  function normalizeGroupBreak(value) {
    const n = Number(value);
    return Number.isInteger(n) && n >= 0 && n < GROUP_LEVELS ? n : 1;
  }
  /* Etkin sayfa seviyesi sayısı: en az bir seviye yan yana grup kalır. */
  const pageDepth = l => Math.min(normalizeGroupBreak(l && l.groupBreak), Math.max(0, ((l && l.groupBy) || []).length - 1));
  /* Sayfa (galeri slaytı / bölüm) başlığı:
     null = otomatik · { mode:'fields', fields:[…] } = seçilen alanların
     değerleri · { mode:'manual', text } = elle; {Alan} yer tutucusu o
     sayfadaki değerle dolar (ör. "{Kategori} · {Kumaş}"). */
  const TITLE_MODES = ['fields', 'manual'];
  function normalizePageTitle(value) {
    if (!value || typeof value !== 'object' || !TITLE_MODES.includes(value.mode)) return null;
    return { mode: value.mode, fields: (normalizeCardFields(value.fields) || []).slice(0, 6), text: cleanText(value.text, 140) };
  }
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
    if (key !== 'xlsx') {
      out.cardFields = normalizeCardFields(source.cardFields);
      out.groupBy = normalizeGroupBy(source.groupBy);
      out.groupBreak = normalizeGroupBreak(source.groupBreak);
      out.pageTitle = normalizePageTitle(source.pageTitle);
      if (source.studio) out.studio = normalizeStudio(source.studio);
    }
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
  /* Hazır yerleşim görünümü değiştirir; kart bilgileri, gruplama ve sayfa
     başlığı içerik seçimidir, korunur. */
  function applyPreset(format, name, current) {
    const key = specKey(format);
    const preset = PRESETS[name] && PRESETS[name][key];
    if (!preset) return normalizeLayout(format, current);
    if (name !== 'standard') return normalizeLayout(format, { ...(current || {}), ...preset });
    const out = defaults(format);
    if (key !== 'xlsx') {
      out.cardFields = normalizeCardFields(current && current.cardFields);
      out.groupBy = normalizeGroupBy(current && current.groupBy);
      out.groupBreak = normalizeGroupBreak(current && current.groupBreak);
      out.pageTitle = normalizePageTitle(current && current.pageTitle);
      if (current && current.studio) out.studio = normalizeStudio(current.studio);
    }
    return out;
  }

  /* ---------------- PowerPoint geometrisi (pt) ---------------- */
  const SLIDE = Object.freeze({ width: 960, height: 540, footer: 44 });
  function pptxGeometry(raw) {
    const layout = normalizeLayout('pptx', raw);
    const size = pageSize(layout);
    const band = layout.studio && layout.studio.headerHidden ? 0 : layout.headerHeight;
    const contentTop = band + 14;
    const note = layout.studio && layout.studio.note ? layout.studio.noteHeight : 0;
    return { layout, size, margin: layout.margin, band, contentTop, contentH: size.height - contentTop - SLIDE.footer - note, width: size.width - layout.margin * 2, note };
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
    if (record && !Array.isArray(record) && record.values) {
      const alias = Object.keys(record.aliases || {}).find(label => fieldKey(label) === key);
      const id = Object.keys(record.values).find(id => fieldKey(id) === key || fieldKey((record.labels || {})[id]) === key) || alias && record.aliases[alias];
      return id ? cleanText(record.values[id], 300) : '';
    }
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
    const rows = record && !Array.isArray(record) && record.values ? Object.entries(record.values) : Array.isArray(record) ? record.filter(pair => Array.isArray(pair) && cleanText(pair[1], 300)) : [];
    // Varsayılan: önemli bilgiler (LCW AI'ın alanları + kaynak satır); hiçbiri yoksa LCW AI'ın ilk alanları.
    let chosen = l.cardFields;
    if (!Array.isArray(chosen)) {
      chosen = defaultCardFields([...own.map(field => field.label), ...rows.map(pair => pair[0])]);
      if (!chosen.length) return own.slice(0, 4).map(field => pick(field.label, field.value, field.tone));
    }
    return chosen.map(label => {
      const key = fieldKey(label);
      if (record && !Array.isArray(record) && record.values) {
        const value = recordValue(record, key);
        return value ? pick((record.labels || {})[label] || label, value, '') : null;
      }
      const hit = own.find(field => fieldKey(field.label) === key);
      const value = recordValue(record, key);
      if (Array.isArray(record) && record.some(pair => Array.isArray(pair) && fieldKey(pair[0]) === key)) return value ? pick(label, value, '') : null;
      return hit ? pick(hit.label, hit.value, hit.tone) : null;
    }).filter(Boolean);
  }
  /* Yerleşim aracındaki alan seçicisi: kartlarda kullanılabilecek tüm alanlar
     (önce LCW AI'ın yazdıkları, sonra kaynak kayıttaki diğer sütunlar) ve
     seçim yapılmadıysa gösterilen varsayılanlar. Kaynak sütun, bu modellerde
     değeri boş olsa da listelenir (koleksiyonun tüm başlıkları seçilebilir;
     boş değer kartta yazılmaz); varsayılanlar yalnız dolu alanlardan seçilir. */
  function availableCardFields(items, records) {
    const seen = new Set();
    const ai = [];
    const source = [];
    const filled = new Set();
    const add = (list, label) => { const text = cleanText(label, 60); const key = fieldKey(text); if (key && !seen.has(key)) { seen.add(key); list.push(text); } };
    for (const item of items || []) for (const field of (item && item.fields) || []) if (field && cleanText(field.value, 300)) {
      const record = records && records[item.image];
      const alias = Object.keys(record && record.aliases || {}).find(label => fieldKey(label) === fieldKey(field.label));
      add(ai, alias ? record.aliases[alias] : field.label);
    }
    for (const item of items || []) {
      const record = records && item && item.image ? records[String(item.image).toUpperCase()] : null;
      for (const pair of record && !Array.isArray(record) && record.values ? Object.entries(record.values) : Array.isArray(record) ? record : []) {
        if (!Array.isArray(pair)) continue;
        add(source, pair[0]);
        if (cleanText(pair[1], 300)) filled.add(fieldKey(pair[0]));
      }
    }
    const defaults = defaultCardFields([...ai, ...source.filter(label => filled.has(fieldKey(label)))]);
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
  function packGroups(groups, columns, rows, options) {
    if (options && options.span) {
      const out = [];
      let page = 0, cursor = 0, occupied = new Set();
      const next = () => { page++; cursor = 0; occupied = new Set(); };
      groups.forEach((group, gi) => {
        if (gi && options.separate && occupied.size) next();
        if (gi && group.flow === 'section' && cursor % columns) cursor += columns - cursor % columns;
        // A group that fits a whole page starts there rather than being split at the tail.
        const area = group.items.reduce((sum, item) => sum + options.span(item), 0);
        if (occupied.size && area <= columns * rows && area > columns * rows - occupied.size) next();
        group.items.forEach((item, index) => {
          const rowSpan = Math.min(rows, options.span(item));
          for (;;) {
            if (cursor >= columns * rows) next();
            const row = Math.floor(cursor / columns), col = cursor % columns;
            if (row + rowSpan <= rows && Array.from({ length: rowSpan }, (_, k) => cursor + k * columns).every(at => !occupied.has(at))) {
              for (let k = 0; k < rowSpan; k++) occupied.add(cursor + k * columns);
              out.push({ page, row, col, rowSpan, group: gi, index }); cursor++; break;
            }
            cursor++;
          }
        });
      });
      return out;
    }
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
  /* Bir modelin alan değeri: önce LCW AI'ın kart alanı, yoksa kaynak satır. */
  function fieldValue(item, label, records) {
    const key = fieldKey(label);
    if (!key || !item) return '';
    const record = records && item.image ? records[String(item.image).toUpperCase()] : null;
    if (record && !Array.isArray(record) && record.values) return recordValue(record, key);
    if (Array.isArray(record) && record.some(pair => Array.isArray(pair) && fieldKey(pair[0]) === key)) return recordValue(record, key);
    const own = (Array.isArray(item.fields) ? item.fields : []).find(field => field && fieldKey(field.label) === key && cleanText(field.value, 300));
    if (own) return cleanText(own.value, 300);
    return recordValue(records && item.image ? records[String(item.image).toUpperCase()] : null, key);
  }
  /* Sayfadaki modellerin bir alandaki değerleri: tekse kendisi, birkaçsa
     "A / B", çoksa "A / B +3". */
  function pageValue(items, label, records) {
    const values = [];
    for (const item of items) { const value = fieldValue(item, label, records); if (value && !values.includes(value)) values.push(value); }
    return values.length <= 2 ? values.join(' / ') : `${values.slice(0, 2).join(' / ')} +${values.length - 2}`;
  }
  /* layout.pageTitle → başlık (boş = otomatik başlık kalır). */
  function customTitle(l, items, records) {
    const spec = l && l.pageTitle;
    if (!spec) return '';
    if (spec.mode === 'fields') return cleanText(spec.fields.map(label => pageValue(items, label, records)).filter(Boolean).join(' · '), 140);
    if (spec.mode === 'manual') {
      // {Alan} yer tutucuları dolar; hiçbiri dolmadıysa otomatik başlık kalır.
      let filled = 0, slots = 0;
      const text = spec.text.replace(/\{([^{}]{1,60})\}/g, (_, label) => { slots++; const value = pageValue(items, label, records); if (value) filled++; return value; });
      if (slots && !filled) return '';
      return cleanText(text.replace(/(\s*·\s*){2,}/g, ' · ').replace(/^[\s·\-–—/|:,]+|[\s·\-–—/|:,]+$/g, ''), 140);
    }
    return '';
  }
  /* Grup adı tek satırda kalır (alt grup adları "Ürün · Kumaş" gibi uzayabilir):
     önce yazı küçülür (en az 6.5), yine sığmazsa sonu "…" ile kısalır. */
  function fitLabel(text, width, size, reserve = 0) {
    const charW = value => value * 0.58;
    const value = String(text == null ? '' : text);
    const room = Math.max(1, width - reserve * charW(size));
    const fit = value.length * charW(size) > room ? Math.max(6.5, room / (value.length * 0.58)) : size;
    const max = Math.max(4, Math.floor(room / charW(fit)));
    return { text: value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value, size: Number(fit.toFixed(2)) };
  }
  function galleryPages(raw, groups, { english = false, fallbackTitle = '', records = null } = {}) {
    const g = pptxGeometry(raw);
    const l = g.layout;
    const C = l.columns, gap = l.gap;
    const studio = l.studio;
    const span = item => {
      if (!studio || studio.sizing === 'equal') return 1;
      const override = studio.spans[item.image];
      if (override) return override;
      const record = records && records[item.image];
      const pieces = record && !Array.isArray(record) && record.values ? Number(record.values.setPieceCount) : Number(fieldValue(item, 'setPieceCount', records));
      const detailed = studio.sizing === 'auto' && (l.cardFields || []).filter(id => fieldValue(item, id, records)).length > 4;
      return Number.isInteger(pieces) && pieces > 1 || detailed ? 2 : 1;
    };
    let R = studio && studio.reflow !== 'fixed' ? Math.max(1, Math.min(6, Math.floor((g.contentH - 8 + gap) / ({ dense: 110, balanced: 140, large: 220 }[studio.reflow] + gap)))) : l.rows;
    if (studio && (groups || []).some(group => group.items.some(item => span(item) === 2))) R = Math.max(2, R);
    const list = (groups || []).filter(group => group && Array.isArray(group.items) && group.items.length);
    if (!list.length) return [];
    const labelH = Number((l.cardTextSize * 1.4 + 7).toFixed(1));
    const top = g.contentTop + 8;
    const availH = g.contentH - 8;
    const runs = l.packGroups ? [list] : list.map(group => [group]);
    const pages = [];
    for (const run of runs) {
      const packing = studio ? { span } : null;
      const placed = packGroups(run, C, R, packing);
      const pageCount = placed.length ? placed[placed.length - 1].page + 1 : 0;
      const byPage = new Map(), groupPageSets = run.map(() => new Set());
      placed.forEach(p => { if (!byPage.has(p.page)) byPage.set(p.page, []); byPage.get(p.page).push(p); groupPageSets[p.group].add(p.page); });
      const groupPages = groupPageSets.map(set => [...set]);
      for (let pi = 0; pi < pageCount; pi++) {
        let items = byPage.get(pi) || [];
        const ids = [...new Set(items.map(p => p.group))];
        const labelled = ids.length > 1;
        const strip = labelled ? labelH : 0;
        const baseW = (g.width - gap * (C - 1)) / C;
        const baseH = (availH - gap * (R - 1) - strip * R) / R;
        let cols = C, cellW = baseW, cellH = baseH;
        const split = ids.some(gi => groupPages[gi].length > 1);
        const usedRows = Math.max(...items.map(p => p.row + (p.rowSpan || 1)));
        const usedCols = Math.max(...items.map(p => p.col)) + 1;
        // Az dolu sayfa: daha küçük ızgara denenir, kart oranı korunarak büyür (en çok 3 kat).
        if (l.autoFit && !split && (usedRows < R || usedCols < C)) {
          const aspect = baseW / Math.max(1, (availH - gap * (R - 1)) / R);
          const subset = ids.map(gi => ({ items: run[gi].items }));
          let best = null;
          for (let c = 1; c <= C; c++) {
            for (let r = 1; r <= R; r++) {
              if (studio && subset.some(group => group.items.some(item => span(item) > r))) continue;
              const trial = packGroups(subset, c, r, packing);
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
        const rowsUsed = Math.max(...items.map(p => p.row + (p.rowSpan || 1)));
        const blockH = rowsUsed * (cellH + strip) + gap * (rowsUsed - 1);
        const offsetY = cellW === baseW ? 0 : Math.max(0, (availH - blockH) / 2);
        const xOf = col => left + col * (cellW + gap);
        const yOf = row => top + offsetY + row * (cellH + gap + strip) + strip;
        const titles = ids.map(gi => run[gi].title);
        // Kullanıcının gruplamasında grup adı ve sayfa başlığı açıktır; yoksa ortak önekten çıkar.
        const explicit = ids.every(gi => run[gi].label != null);
        const named = explicit ? { common: run[ids[0]].heading || '', labels: ids.map(gi => run[gi].label) } : commonLabels(titles);
        const cells = items.map(p => ({ x: xOf(p.col), y: yOf(p.row), w: cellW, h: cellH * (p.rowSpan || 1) + (gap + strip) * ((p.rowSpan || 1) - 1), ...(studio ? { rowSpan: p.rowSpan || 1 } : {}), item: run[p.group].items[p.index], group: p.group }));
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
              const fitted = fitLabel(named.labels[ids.indexOf(seg.group)], w, Math.max(8, l.cardTextSize), cont ? 9 : 0);
              labels.push({ x, y, w, h: strip - 4, text: fitted.text, size: fitted.size, cont, group: seg.group });
            }
            if (seg.from > 0 && segments.some(other => other !== seg && other.row === seg.row && other.to === seg.from - 1)) dividers.push({ x: x - gap / 2, y, h: strip + cellH });
          }
        }
        const one = ids.length === 1 ? run[ids[0]] : null;
        const parts = one ? groupPages[ids[0]].length : 0;
        const part = parts > 1 ? ` (${groupPages[ids[0]].indexOf(pi) + 1}/${parts})` : '';
        const custom = customTitle(l, cells.map(cell => cell.item), records);
        const title = custom ? `${custom}${part}`
          : one ? `${one.title}${part}`
            : named.common || fallbackTitle || (english ? 'Model gallery' : 'Model galerisi');
        const count = items.length;
        const subtitle = one ? (one.subtitle || '') : (english ? `${ids.length} groups · ${count} models` : `${ids.length} grup · ${count} model`);
        pages.push({ title, subtitle, cells, labels, rules, dividers, scale: cellW / baseW, groups: ids.map(gi => run[gi]), sources: [...new Set(ids.flatMap(gi => run[gi].sources || []))], labelH: strip });
      }
    }
    return pages;
  }
  /* Kullanıcı gruplaması (layout.groupBy): tüm galeri modelleri seçilen
     alanların değerine göre yeniden gruplanır. İlk `depth` seviye (groupBreak,
     ör. Kategori) yeni slayt başlatır; kalan seviyeler (ör. Kumaş › Baskı)
     sayfada "Kumaş · Baskı" adıyla yan yana gruplardır.
     Grup sırası modellerin ilk görünüş sırasıdır; değeri olmayan model
     "Belirtilmemiş" grubuna girer. Döner: [{ heading, groups:[{ label, title, items, sources }] }]. */
  function regroupItems(entries, levels, records, english, depth = levels.length - 1, rules = null) {
    const blank = english ? 'Not specified' : 'Belirtilmemiş';
    const pages = new Map();
    for (const { item, source } of entries) {
      const values = levels.map(label => fieldValue(item, label, records) || blank);
      const record = records && records[item.image];
      const keys = levels.map((id, index) => record && record.keys && record.keys[id] || values[index]);
      const isPage = (id, index) => rules && rules[id] ? rules[id] === 'page' : index < depth;
      const pageKey = keys.filter((_, i) => isPage(levels[i], i)).join('\u0001');
      if (!pages.has(pageKey)) pages.set(pageKey, { heading: values.filter((_, i) => isPage(levels[i], i)).join(' · '), groups: new Map() });
      const page = pages.get(pageKey);
      const label = values.filter((_, i) => !isPage(levels[i], i)).join(' · ');
      const groupKey = keys.filter((_, i) => !isPage(levels[i], i)).join('\u0001');
      if (!page.groups.has(groupKey)) page.groups.set(groupKey, { label, heading: page.heading, title: [page.heading, label].filter(Boolean).join(' · '), subtitle: '', items: [], sources: [],
        ...(rules && levels.some(id => ['section', 'inline'].includes(rules[id])) ? { flow: 'section' } : {}) });
      const group = page.groups.get(groupKey);
      group.items.push(item);
      if (!group.sources.includes(source)) group.sources.push(source);
    }
    return [...pages.values()].map(page => ({ heading: page.heading, groups: [...page.groups.values()] }));
  }
  /* Slayt listesindeki galerileri gruplara çevirip paketler. Döner:
     [{ slide } | { page, sources }] — PowerPoint ve önizleme aynı sonucu kullanır.
     records: görsel anahtarı → kaynak satır (gruplama ve başlık değerleri için). */
  function expandGalleries(slides, raw, { english = false, records = null } = {}) {
    const l = normalizeLayout('pptx', raw);
    if (l.studio && l.studio.galleryFirst) {
      const ordered = [...(slides || []).filter(s => s.layout === 'gallery'), ...(slides || []).filter(s => s.layout !== 'gallery')];
      return expandGalleries(ordered, { ...l, studio: { ...l.studio, galleryFirst: false } }, { english, records }).map(entry => ({ ...entry, sources: entry.sources.map(index => slides.indexOf(ordered[index])) }));
    }
    const list = slides || [];
    const out = [];
    if (l.groupBy) {
      const galleries = list.map((slide, index) => (slide && slide.layout === 'gallery' ? index : -1)).filter(index => index >= 0);
      if (galleries.length) {
        // Galeri bloğu: ilk galeriden (önündeki bölüm ayraçlarıyla) son galeriye kadar.
        // LCW AI'ın gruplamasına ait galeri ve bölüm ayracı slaytları yeni gruplamayla değişir;
        // bloktaki diğer slaytlar (tablo, madde…) blokun ardına geçer.
        let start = galleries[0];
        while (start > 0 && list[start - 1] && list[start - 1].layout === 'section') start--;
        const end = galleries[galleries.length - 1];
        let lastSection = '';
        for (let i = 0; i < start; i++) if (list[i] && list[i].layout === 'section') lastSection = list[i].title;
        list.slice(0, start).forEach((slide, index) => out.push({ slide, sources: [index] }));
        const entries = [];
        galleries.forEach(index => (list[index].items || []).forEach(item => entries.push({ item, source: index })));
        for (const page of regroupItems(entries, l.groupBy, records, english, pageDepth(l), l.studio && l.studio.groupRules)) {
          for (const result of galleryPages(l, page.groups, { english, fallbackTitle: page.heading || lastSection, records })) out.push({ page: result, sources: result.sources });
        }
        list.forEach((slide, index) => { if (index >= start && index <= end && slide && slide.layout !== 'gallery' && slide.layout !== 'section') out.push({ slide, sources: [index] }); });
        list.slice(end + 1).forEach((slide, offset) => out.push({ slide, sources: [end + 1 + offset] }));
        return out;
      }
    }
    let run = [];
    let lastSection = '';
    const flush = () => {
      if (!run.length) return;
      for (const page of galleryPages(l, run, { english, fallbackTitle: lastSection, records })) out.push({ page, sources: page.sources });
      run = [];
    };
    list.forEach((slide, index) => {
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
    if (l.studio && (l.studio.sizing !== 'equal' || l.studio.reflow !== 'fixed')) {
      const size = pageSize(l);
      css.push(`@page{size:${size.width}pt ${size.height}pt;margin:0}.bl-page,.bl-report{padding:0!important;max-width:none!important}.bl-studio-page{margin:0!important;overflow:hidden}.bl-studio-card{border:1px solid var(--line);background:var(--paper)}.bl-studio-card img{max-width:none!important;margin:0!important}.bl-studio-title small{display:block;font-size:12pt}`);
    }
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
  /* ---- PDF/HTML: kullanıcı gruplaması ve sayfa (bölüm) başlığı ----
     Kök = .bl-groups ya da grup dışındaki .bl-gallery. Gruplamada tüm
     model kartları köklerden toplanır; yalnız başlık + kök taşıyan bölümler
     (ve kökün hemen önündeki başlık) kaldırılır, ilk kökün yerine yeni
     bölümler yazılır: her sayfa seviyesi bir <section> + <h2>, son seviye
     .bl-groups içinde yan yana .bl-group. Kart HTML'i olduğu gibi taşınır. */
  function elementsByTag(html, tag) {
    const re = new RegExp(`<${tag}\\b([^>]*)>`, 'gi');
    const out = [];
    let match;
    while ((match = re.exec(html))) {
      const end = elementEnd(html, tag, re.lastIndex);
      if (end > 0) out.push({ start: match.index, openEnd: re.lastIndex, end, tag, attrs: match[1], classes: classesOf(match[1]) });
    }
    return out;
  }
  const inside = (inner, outer) => inner.start > outer.start && inner.end <= outer.end;
  function reportRoots(source) {
    const boxes = elementsWith(source, 'bl-groups');
    const galleries = elementsWith(source, 'bl-gallery');
    const roots = [...boxes, ...galleries.filter(gallery => !boxes.some(box => inside(gallery, box)))].sort((a, b) => a.start - b.start);
    const cards = elementsWith(source, 'bl-card').filter(card => galleries.some(gallery => inside(card, gallery)));
    return { roots, cards };
  }
  function cardItem(source, card) {
    const inner = source.slice(card.openEnd, card.end);
    const image = (/data-bl-image="([^"]+)"/.exec(inner) || [])[1] || '';
    const title = textOf((/<h3\b[^>]*>([\s\S]*?)<\/h3>/i.exec(inner) || [])[1] || '');
    const fields = [];
    const pair = /<dt\b[^>]*>([\s\S]*?)<\/dt>\s*<dd\b[^>]*>([\s\S]*?)<\/dd>/gi;
    let match;
    while ((match = pair.exec(inner))) fields.push({ label: textOf(match[1]), value: textOf(match[2]) });
    return { image, title, fields, html: source.slice(card.start, card.end) };
  }
  const HEADING = /^\s*<(h[1-4])\b[^>]*>[\s\S]*?<\/\1>\s*$/i;
  function regroupReport(html, l, records, english) {
    const source = String(html || '');
    if (!l.groupBy) return source;
    const { roots, cards } = reportRoots(source);
    if (!roots.length || !cards.length) return source;
    const sections = elementsByTag(source, 'section').filter(section => !section.classes.includes('bl-group'));
    const removals = [];
    let firstHeading = '';
    for (const root of roots) {
      const owner = sections.filter(section => inside(root, section)).pop();
      if (owner) {
        // Bölüm yalnız başlık(lar) + kök(ler)den oluşuyorsa bölümün tamamı kalkar.
        let rest = source.slice(owner.openEnd, owner.end - `</${owner.tag}>`.length);
        for (const other of roots.filter(item => inside(item, owner)).sort((a, b) => b.start - a.start)) rest = rest.slice(0, other.start - owner.openEnd) + rest.slice(other.end - owner.openEnd);
        const headings = rest.replace(/<(h[1-4])\b[^>]*>[\s\S]*?<\/\1>/gi, '');
        if (!textOf(headings)) {
          if (!firstHeading) firstHeading = textOf((/<h2\b[^>]*>([\s\S]*?)<\/h2>/i.exec(rest) || [])[1] || '');
          removals.push({ start: owner.start, end: owner.end });
          continue;
        }
      }
      // Kökün hemen önündeki başlık da kalkar (yetim başlık kalmasın).
      const before = source.slice(0, root.start);
      const heading = /<(h[2-4])\b[^>]*>([\s\S]*?)<\/\1>\s*$/i.exec(before);
      if (heading && !firstHeading && heading[1].toLowerCase() === 'h2') firstHeading = textOf(heading[2]);
      removals.push({ start: heading ? heading.index : root.start, end: root.end });
    }
    removals.sort((a, b) => a.start - b.start);
    const merged = [];
    for (const range of removals) {
      const last = merged[merged.length - 1];
      if (last && range.start < last.end) last.end = Math.max(last.end, range.end); else merged.push({ ...range });
    }
    const entries = cards.map((card, index) => ({ item: { ...cardItem(source, card), index }, source: index }));
    const fallback = firstHeading || (english ? 'Models' : 'Modeller');
    const block = regroupItems(entries, l.groupBy, records, english, pageDepth(l)).map(page => {
      const items = page.groups.flatMap(group => group.items);
      const title = customTitle(l, items, records) || page.heading || fallback;
      const groups = page.groups.map(group => `<section class="bl-group"><h3 class="bl-group-title">${escHtml(group.label)}</h3><div class="bl-gallery">${group.items.map(item => item.html).join('')}</div></section>`).join('');
      return `<section class="bl-section bl-regrouped"><h2>${escHtml(title)}</h2><div class="bl-groups">${groups}</div></section>`;
    }).join('');
    let out = '', cursor = 0;
    merged.forEach((range, index) => { out += source.slice(cursor, range.start) + (index ? '' : block); cursor = range.end; });
    return out + source.slice(cursor);
  }
  /* Gruplama yokken seçilen sayfa başlığı: her kökün önündeki <h2> o
     kökteki modellerin değerleriyle yeniden yazılır (yoksa eklenir). */
  function reportTitles(html, l, records) {
    const source = String(html || '');
    if (!l.pageTitle || l.groupBy) return source;
    const { roots, cards } = reportRoots(source);
    const edits = [];
    let previous = 0;
    for (const root of roots) {
      const items = cards.filter(card => inside(card, root)).map(card => cardItem(source, card));
      const title = customTitle(l, items, records);
      if (title) {
        const span = source.slice(previous, root.start);
        let found = null, match;
        const re = /<h2\b([^>]*)>([\s\S]*?)<\/h2>/gi;
        while ((match = re.exec(span))) found = match;
        if (found) edits.push({ start: previous + found.index, end: previous + found.index + found[0].length, text: `<h2${found[1]}>${escHtml(title)}</h2>` });
        else edits.push({ start: root.start, end: root.start, text: `<h2>${escHtml(title)}</h2>` });
      }
      previous = root.end;
    }
    return edits.length ? applyEdits(source, edits) : source;
  }
  function prepareReport(html, raw, { pages = true, records = null, english = false } = {}) {
    const l = normalizeLayout('pdf', raw);
    if (l.studio && (l.studio.sizing !== 'equal' || l.studio.reflow !== 'fixed')) {
      const source = paginateGallery(html, null, { pages: false });
      const { roots, cards } = reportRoots(source);
      const edits = roots.map(root => {
        const items = cards.filter(card => inside(card, root)).map(card => cardItem(source, card));
        if (!items.length) return null;
        const before = source.slice(0, root.start);
        const heading = /<h([1-4])\b[^>]*>([^<]*)<\/h\1>\s*$/i.exec(before);
        const title = heading ? textOf(heading[2]) : english ? 'Models' : 'Modeller';
        const report = presentationReport({ title, layout: l, slides: [{ layout: 'gallery', title, items }] }, records || {}, english);
        return { start: heading ? heading.index : root.start, end: root.end, text: report.body };
      }).filter(Boolean);
      return applyEdits(source, edits);
    }
    const grouped = reportTitles(regroupReport(html, l, records, english), l, records);
    return paginateGallery(decorateGroups(applyCardFields(grouped, l, records), l), l, { pages });
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

  // Commands change presentation state only. Unknown or invalid commands reject the entire batch.
  function applyOperations(raw, actions, { fields = [], tokens = [] } = {}) {
    if (!Array.isArray(actions) || !actions.length || actions.length > 24) throw Error('Invalid layout operations.');
    let layout = normalizeLayout('pptx', raw), title;
    layout.studio = layout.studio || normalizeStudio({});
    const allowed = new Set(fields);
    for (const a of actions) {
      if (!a || typeof a !== 'object' || Object.keys(a).some(k => !['op', 'value', 'target'].includes(k))) throw Error('Invalid layout operation.');
      const v = a.value;
      if (a.op === 'setCardFields' || a.op === 'setGrouping') {
        if (!Array.isArray(v) || v.length > (a.op === 'setGrouping' ? 3 : 24) || v.some(id => !allowed.has(id))) throw Error('Unavailable field.');
        layout[a.op === 'setCardFields' ? 'cardFields' : 'groupBy'] = v;
      } else if (a.op === 'setCardSpan') {
        if (!tokens.includes(a.target) || ![1, 2].includes(v)) throw Error('Invalid card span.');
        layout.studio.spans[a.target] = v;
      } else if (a.op === 'resizeSection') {
        const key = a.target === 'header' ? 'headerHeight' : a.target === 'note' ? 'noteHeight' : '';
        if (!key || !Number.isFinite(v) || v < (key === 'headerHeight' ? 48 : 0) || v > 160) throw Error('Invalid section size.');
        if (key === 'headerHeight') layout.headerHeight = v; else layout.studio.noteHeight = v;
      } else if (a.op === 'setGrid') {
        if (!v || Object.keys(v).some(k => !['columns', 'rows'].includes(k)) || !Number.isInteger(v.columns) || v.columns < 1 || v.columns > 8 || !Number.isInteger(v.rows) || v.rows < 1 || v.rows > 6) throw Error('Invalid grid.');
        layout.columns = v.columns; layout.rows = v.rows; layout.studio.reflow = 'fixed';
      } else if (a.op === 'setSizing') {
        if (!['equal', 'sets', 'auto'].includes(v)) throw Error('Invalid sizing.'); layout.studio.sizing = v;
      } else if (a.op === 'setReflow') {
        if (!['dense', 'large', 'balanced', 'fixed'].includes(v)) throw Error('Invalid reflow.'); layout.studio.reflow = v;
      } else if (a.op === 'applyPreset') {
        if (!PRESETS[v]) throw Error('Invalid preset.'); layout = applyPreset('pptx', v, layout);
      } else if (a.op === 'setTitle') {
        if (typeof v !== 'string' || v.length > 140) throw Error('Invalid title.'); title = v;
      } else if (a.op === 'toggleSection') {
        if (a.target !== 'header' || typeof v !== 'boolean') throw Error('Invalid section.'); layout.studio.headerHidden = !v;
      } else if (a.op === 'reorderSection') {
        if (!['galleryFirst', 'summaryFirst'].includes(v)) throw Error('Invalid section order.'); layout.studio.galleryFirst = v === 'galleryFirst';
      } else throw Error('Unsupported layout operation.');
    }
    return { layout: normalizeLayout('pptx', layout), ...(title === undefined ? {} : { title }) };
  }

  // A structured report uses the exact same gallery page plan as PowerPoint and the editor.
  function presentationReport(data, records = {}, english = false) {
    const l = normalizeLayout('pptx', data.layout), g = pptxGeometry(l);
    const escape = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const block = (x, y, w, h, cls, html, extra = '') => `<div class="${cls}" style="position:absolute;left:${x}pt;top:${y}pt;width:${w}pt;height:${h}pt;${extra}">${html}</div>`;
    const pages = expandGalleries(data.slides, l, { records, english });
    const body = pages.map((entry, index) => {
      const slide = entry.slide || { title: entry.page.title, subtitle: entry.page.subtitle };
      let html = l.studio && l.studio.headerHidden ? '' : block(g.margin, 8, g.width, Math.max(1, g.band - 8), 'bl-studio-title', `<b>${escape(slide.title)}</b>${slide.subtitle ? `<small>${escape(slide.subtitle)}</small>` : ''}`, `font-size:${l.titleSize}pt;overflow:hidden;`);
      const cover = entry.slide && ['title', 'section'].includes(entry.slide.layout);
      if (cover) {
        html = block(g.margin, g.size.height * .3, g.width, g.size.height * .25, 'bl-studio-title', `<b>${escape(slide.title)}</b>`, `font-size:${Math.min(40, g.size.width / 18)}pt;`);
        if (slide.subtitle) html += block(g.margin, g.size.height * .6, g.width, g.size.height * .2, 'bl-studio-content', escape(slide.subtitle), 'font-size:16pt;');
      } else if (entry.page) {
        entry.page.labels.forEach(label => { html += block(label.x, label.y, label.w, label.h, 'bl-studio-label', escape(label.text), `font-size:${label.size}pt;`); });
        entry.page.cells.forEach(cell => {
          const content = cardContent(cell, l, cell.item, records[cell.item.image], entry.page.scale), k = content.box;
          const fields = content.lines.map(line => line.map(row => `${l.showFieldLabels ? `${escape(row.label)} ` : ''}${escape(row.value)}`).join(' · ')).join('<br>');
          const image = `<div style="height:${k.imgH}pt;"><img data-bl-image="${escape(cell.item.image)}" alt="${escape(cell.item.title)}" style="width:100%;height:100%;object-fit:contain;"></div>`;
          html += block(cell.x, cell.y, cell.w, cell.h, 'bl-studio-card', `${image}<div style="font-size:${k.detail}pt;line-height:1.25;"><b>${escape(content.title)}</b><br>${fields}</div>`, `padding:${k.pad}pt;box-sizing:border-box;overflow:hidden;`);
        });
      } else {
        const content = slide.layout === 'kpis' ? (slide.kpis || []).map(k => `<p><b>${escape(k.label)}: ${escape(k.value)}</b> ${escape(k.note)}</p>`).join('')
          : slide.layout === 'table' ? `<table><thead><tr>${slide.table.columns.map(c => `<th>${escape(c)}</th>`).join('')}</tr></thead><tbody>${slide.table.rows.map(row => `<tr>${row.map(v => `<td>${escape(v)}</td>`).join('')}</tr>`).join('')}</tbody></table>`
          : slide.layout === 'comparison' ? [slide.left, slide.right].map(side => `<h3>${escape(side.title)}</h3>${side.bullets.map(b => `<p>${escape(b)}</p>`).join('')}`).join('')
          : slide.layout === 'chart' ? `<table>${slide.chart.categories.map((category, i) => `<tr><th>${escape(category)}</th>${slide.chart.series.map(series => `<td>${escape(series.name)}: ${escape(series.values[i])}</td>`).join('')}</tr>`).join('')}</table>`
          : `<p>${escape(slide.subtitle)}</p>${(slide.bullets || []).map(b => `<p>${escape(b)}</p>`).join('')}`;
        html += block(g.margin, g.contentTop + 8, g.width, g.contentH, 'bl-studio-content', content, `font-size:${l.bodySize}pt;`);
      }
      if (!cover && l.studio && l.studio.note) html += block(g.margin, g.size.height - SLIDE.footer - g.note, g.width, g.note, 'bl-studio-note', escape(l.studio.note), 'font-size:10pt;overflow:hidden;');
      if (!cover) html += block(g.margin, g.size.height - 25, g.width, 18, 'bl-studio-footer', `${escape(data.title)} · ${index + 1}/${pages.length}`, 'font-size:9pt;');
      return `<section class="bl-studio-page" style="position:relative;width:${g.size.width}pt;height:${g.size.height}pt;break-after:page;box-sizing:border-box;">${html}</section>`;
    }).join('');
    return { body, width: g.size.width, height: g.size.height, pages };
  }

  return {
    SPEC, FLAGS, PRESETS, SLIDE, PAGE, PAPERS, pageSize, normalizeStudio, applyOperations, presentationReport, specKey, defaults, normalizeLayout, isDefault, perPage, applyPreset, pptxGeometry, galleryCells, pageBox, layoutCss, paginateGallery, xlsxMetrics,
    fieldKey, normalizeCardFields, normalizeGroupBy, normalizeGroupBreak, pageDepth, normalizePageTitle, fieldValue, pageValue, customTitle, regroupItems, autoTone, DEFAULT_CARD_ROLES, defaultCardFields, cardDetails, availableCardFields, packDetailLines, cardContent, cardLayout, commonLabels, fitLabel, packGroups, galleryPages, expandGalleries,
    applyCardFields, decorateGroups, regroupReport, reportTitles, prepareReport,
  };
});
