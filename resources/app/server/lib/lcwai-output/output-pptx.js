'use strict';

/*
 * PRESENTATION JSON → .pptx (Buyer Log temalı, 16:9).
 *
 * LCW AI yalnız slayt YAPISINI üretir (başlık, madde, KPI, tablo, grafik
 * verisi); yerleşim, renk ve tipografi burada sabittir. Bağımlılık yoktur:
 * en küçük geçerli PresentationML paketi (tema + asıl slayt + boş düzen +
 * slaytlar) yazılır. Grafikler düzenlenebilir şekil (dikdörtgen) olarak
 * çizilir; grafik XML'i (chart parts) gerekmez.
 *
 * Desteklenen düzenler: title, section, bullets, kpis, table, chart,
 * comparison, summary, gallery. Girdi normalizePresentation() çıktısıdır.
 *
 * Galeri (model kartları, line sheet): koyu başlık bandı + çerçeveli
 * içerik, beyaz kart; görsel önde ve büyük, altında küçük yazıyla model adı
 * ve kullanıcının Yerleşim'de seçtiği bilgiler (varsayılan: renk kodu, fit,
 * adet, hedef fiyat). Ardışık küçük galeri grupları aynı slayta yan yana,
 * adları ve ayraçlarıyla dizilir (BLOutputLayout.galleryPages).
 */
const { createZip, xmlText } = require('./output-zip');
const { theme, ooxml } = require('./output-theme');
const BLOutputLayout = require('../../../public/lcwai-output-layout');

const EMU = 12700; // 1 pt
const W = 12192000;
const H = 6858000;
const pt = value => Math.round(value * EMU);
/* Yerleşim geometrisi (kullanıcının Yerleşim aracındaki ayarları; bkz.
   public/lcwai-output-layout.js). Oluşturma eşzamanlıdır: renderPresentation
   / expandSlides başında applyGeometry ile ayarlanır, sonra yalnız okunur. */
let LAYOUT = BLOutputLayout.defaults('pptx');
let MARGIN = pt(48);
let BAND = pt(96);
let CONTENT_TOP = pt(110);
let CONTENT_H = H - CONTENT_TOP - pt(44);
let TABLE_WIDTH_PT = (W - MARGIN * 2) / EMU;
function applyGeometry(layout) {
  const g = BLOutputLayout.pptxGeometry(layout);
  LAYOUT = g.layout;
  MARGIN = pt(g.margin);
  BAND = pt(g.band);
  CONTENT_TOP = pt(g.contentTop);
  CONTENT_H = pt(g.contentH);
  TABLE_WIDTH_PT = g.width;
}

function palette() {
  const c = theme().colors;
  return {
    acc: ooxml(c.acc), accBg: ooxml(c['acc-bg']), accInk: ooxml(c['acc-ink']), deep: ooxml(c['navy-deep']),
    ink: ooxml(c.ink), ink2: ooxml(c.ink2), muted: ooxml(c.muted), line: ooxml(c.line), card: ooxml(c.card2), paper: 'FFFFFF',
    // Başlıklar: Buyer Log tablo başlığı grisi; başlık metni BL logosu siyahı.
    headBg: ooxml(c['thead-bg']), headBg2: mixHex(c['thead-bg'], c['thead-ink'], 0.14), headInk: ooxml(c['thead-ink']), headLine: ooxml(c['thead-line']), logo: ooxml(c.logo),
    ok: ooxml(c.green), okBg: ooxml(c['green-bg']), warn: ooxml(c.orange), warnBg: ooxml(c['orange-bg']), risk: ooxml(c.red), riskBg: ooxml(c['red-bg']),
  };
}
function mixHex(a, b, weight) {
  const parse = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  const [x, y] = [parse(a), parse(b)];
  return x.map((value, i) => Math.round(value * (1 - weight) + y[i] * weight).toString(16).padStart(2, '0')).join('').toUpperCase();
}
const toneColor = (tone, p) => ({ ok: p.ok, warn: p.warn, risk: p.risk }[tone] || p.acc);

/* ---------------- Şekil yardımcıları ---------------- */
function run(text, { size = 18, bold = false, color, italic = false } = {}, p, lang) {
  return `<a:r><a:rPr lang="${lang}" sz="${Math.round(size * 100)}"${bold ? ' b="1"' : ''}${italic ? ' i="1"' : ''} dirty="0"><a:solidFill><a:srgbClr val="${color || p.ink}"/></a:solidFill><a:latin typeface="${theme().fonts.office}"/><a:cs typeface="${theme().fonts.office}"/></a:rPr><a:t>${xmlText(text)}</a:t></a:r>`;
}
function paragraph(text, style, p, lang, { align = 'l', bullet = false, spaceAfter = 6 } = {}) {
  const ppr = bullet
    ? `<a:pPr marL="${pt(16)}" indent="-${pt(16)}" algn="${align}"><a:spcAft><a:spcPts val="${spaceAfter * 100}"/></a:spcAft><a:buClr><a:srgbClr val="${p.acc}"/></a:buClr><a:buFont typeface="Arial"/><a:buChar char="■"/></a:pPr>`
    : `<a:pPr algn="${align}"><a:spcAft><a:spcPts val="${spaceAfter * 100}"/></a:spcAft><a:buNone/></a:pPr>`;
  return `<a:p>${ppr}${text === '' ? '' : run(text, style, p, lang)}<a:endParaRPr lang="${lang}" sz="${Math.round((style.size || 18) * 100)}" dirty="0"/></a:p>`;
}

/* Karışık biçimli paragraf (ör. kart bilgisi: soluk alan adı + koyu değer). */
function richParagraph(runs, p, lang, { align = 'l', spaceAfter = 0, size = 10 } = {}) {
  return `<a:p><a:pPr algn="${align}"><a:spcAft><a:spcPts val="${Math.round(spaceAfter * 100)}"/></a:spcAft><a:buNone/></a:pPr>${runs.filter(item => item && item.text !== '').map(item => run(item.text, item, p, lang)).join('')}<a:endParaRPr lang="${lang}" sz="${Math.round(size * 100)}" dirty="0"/></a:p>`;
}

/* media: { token → { name, width, height } } (deste genelinde paylaşılır).
   Slayt kendi ilişki listesini (rels) tutar; rId1 düzen şablonudur. */
function createSlideBuilder(p, lang, media = {}) {
  let id = 1;
  const shapes = [];
  const rels = [];
  const next = () => ++id;
  /* Gerçek model görseli (en-boy korunarak kutuya sığdırılır); yoksa
     "görsel yok" kutusu. */
  function picture({ x, y, w, h, token, label = '', frame = true }) {
    const item = token && media[token];
    if (!item) {
      box({ x, y, w, h, fill: p.card, line: frame ? { color: p.line } : null, anchor: 'ctr', name: 'NoImage', paragraphs: [paragraph(lang.startsWith('en') ? 'No image' : 'Görsel yok', { size: Math.min(10, Math.max(7, h / EMU / 8)), color: p.muted }, p, lang, { align: 'ctr', spaceAfter: 0 })] });
      return;
    }
    let rel = rels.find(entry => entry.target === item.name);
    if (!rel) { rel = { id: `rId${rels.length + 2}`, target: item.name }; rels.push(rel); }
    const ratio = Math.max(0.05, item.width / Math.max(1, item.height));
    let pw = w, ph = w / ratio;
    if (ph > h) { ph = h; pw = h * ratio; }
    const shapeId = next();
    if (frame) box({ x, y, w, h, fill: 'FFFFFF', line: { color: p.line }, name: 'ImageFrame' });
    shapes.push(`<p:pic><p:nvPicPr><p:cNvPr id="${shapeId}" name="Picture ${shapeId}" descr="${xmlText(label || token)}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="${rel.id}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="${Math.round(x + (w - pw) / 2)}" y="${Math.round(y + (h - ph) / 2)}"/><a:ext cx="${Math.round(pw)}" cy="${Math.round(ph)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`);
  }
  function box({ x, y, w, h, fill, line, paragraphs = [], anchor = 't', inset = 6, name = 'Shape', geometry = 'rect', shadow = false, radius = null }) {
    const shapeId = next();
    // fill: 'RRGGBB' | { color, alpha (0–100) }
    const fillXml = !fill ? '<a:noFill/>' : typeof fill === 'object'
      ? `<a:solidFill><a:srgbClr val="${fill.color}"><a:alpha val="${Math.round((fill.alpha == null ? 100 : fill.alpha) * 1000)}"/></a:srgbClr></a:solidFill>`
      : `<a:solidFill><a:srgbClr val="${fill}"/></a:solidFill>`;
    const lineXml = (line ? `<a:ln w="${pt(line.width || 1)}"><a:solidFill><a:srgbClr val="${line.color}"/></a:solidFill></a:ln>` : '<a:ln><a:noFill/></a:ln>')
      // Yumuşak gölge (kartlar): PowerPoint ve PDF'e dönüştürmede kalır.
      + (shadow ? '<a:effectLst><a:outerShdw blurRad="50800" dist="12700" dir="5400000" algn="t" rotWithShape="0"><a:srgbClr val="000000"><a:alpha val="13000"/></a:srgbClr></a:outerShdw></a:effectLst>' : '');
    const body = paragraphs.length ? paragraphs.join('') : `<a:p><a:endParaRPr lang="${lang}" dirty="0"/></a:p>`;
    shapes.push(`<p:sp><p:nvSpPr><p:cNvPr id="${shapeId}" name="${xmlText(name)} ${shapeId}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${Math.round(x)}" y="${Math.round(y)}"/><a:ext cx="${Math.max(1, Math.round(w))}" cy="${Math.max(1, Math.round(h))}"/></a:xfrm><a:prstGeom prst="${geometry}">${radius == null ? '<a:avLst/>' : `<a:avLst><a:gd name="adj" fmla="val ${Math.round(radius)}"/></a:avLst>`}</a:prstGeom>${fillXml}${lineXml}</p:spPr><p:txBody><a:bodyPr wrap="square" lIns="${pt(inset)}" tIns="${pt(inset)}" rIns="${pt(inset)}" bIns="${pt(inset)}" anchor="${anchor}" rtlCol="0"><a:noAutofit/></a:bodyPr><a:lstStyle/>${body}</p:txBody></p:sp>`);
  }
  function text(x, y, w, h, value, style, opts = {}) {
    box({ x, y, w, h, paragraphs: [paragraph(value, style, p, lang, opts)], anchor: opts.anchor || 't', inset: opts.inset == null ? 2 : opts.inset, name: 'Text' });
  }
  function table({ x, y, w, columns, rows, fontSize, heights = null }) {
    const shapeId = next();
    const colW = Math.floor(w / columns.length);
    const rowH = pt(fontSize * 2.1);
    // Satır yüksekliği metin uzunluğuna göre (sarılan uzun hücre kesilmez).
    const hOf = index => (heights && heights[index] ? pt(heights[index]) : rowH);
    const cell = (value, header, index, numeric) => {
      const fill = header ? p.headBg : index % 2 ? p.card : p.paper;
      const color = header ? p.logo : p.ink;
      return `<a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:pPr algn="${numeric && !header ? 'r' : 'l'}"/>${run(String(value == null ? '' : value), { size: fontSize, bold: header, color }, p, lang)}</a:p></a:txBody><a:tcPr marL="${pt(5)}" marR="${pt(5)}" marT="${pt(3)}" marB="${pt(3)}" anchor="ctr"><a:lnL w="${pt(0.75)}"><a:solidFill><a:srgbClr val="${p.line}"/></a:solidFill></a:lnL><a:lnR w="${pt(0.75)}"><a:solidFill><a:srgbClr val="${p.line}"/></a:solidFill></a:lnR><a:lnT w="${pt(0.75)}"><a:solidFill><a:srgbClr val="${p.line}"/></a:solidFill></a:lnT><a:lnB w="${pt(0.75)}"><a:solidFill><a:srgbClr val="${p.line}"/></a:solidFill></a:lnB><a:solidFill><a:srgbClr val="${fill}"/></a:solidFill></a:tcPr></a:tc>`;
    };
    const numericCols = columns.map((_, index) => rows.length > 0 && rows.every(row => row[index] === '' || row[index] == null || typeof row[index] === 'number' || NUMERIC_TEXT.test(String(row[index]).trim())));
    const xmlRows = [`<a:tr h="${hOf(0)}">${columns.map((column, index) => cell(column, true, 0, numericCols[index])).join('')}</a:tr>`]
      .concat(rows.map((row, rowIndex) => `<a:tr h="${hOf(rowIndex + 1)}">${columns.map((_, index) => cell(row[index], false, rowIndex, numericCols[index])).join('')}</a:tr>`));
    const totalH = [columns, ...rows].reduce((sum, _, index) => sum + hOf(index), 0);
    shapes.push(`<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="${shapeId}" name="Table ${shapeId}"/><p:cNvGraphicFramePr><a:graphicFrameLocks noGrp="1"/></p:cNvGraphicFramePr><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${colW * columns.length}" cy="${totalH}"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr firstRow="1" bandRow="1"/><a:tblGrid>${columns.map(() => `<a:gridCol w="${colW}"/>`).join('')}</a:tblGrid>${xmlRows.join('')}</a:tbl></a:graphicData></a:graphic></p:graphicFrame>`);
  }
  /* background: 'RRGGBB' ya da [başlangıç, bitiş] renk geçişi.
     transition: slayt geçişi (fade | push) — sunum hareketli akar. */
  function xml(background, transition = 'fade') {
    const bg = Array.isArray(background)
      ? `<a:gradFill rotWithShape="1"><a:gsLst><a:gs pos="0"><a:srgbClr val="${background[0]}"/></a:gs><a:gs pos="100000"><a:srgbClr val="${background[1]}"/></a:gs></a:gsLst><a:lin ang="2400000" scaled="0"/></a:gradFill>`
      : `<a:solidFill><a:srgbClr val="${background || p.paper}"/></a:solidFill>`;
    const motion = transition === 'push' ? '<p:transition spd="slow"><p:push dir="u"/></p:transition>' : '<p:transition spd="med"><p:fade/></p:transition>';
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:bg><p:bgPr>${bg}<a:effectLst/></p:bgPr></p:bg><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>${shapes.join('')}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>${motion}</p:sld>`;
  }
  return { box, text, table, picture, xml, rels };
}

/* Metin uzunluğuna göre yazı boyutu (PowerPoint otomatik sığdırmayı ancak
   düzenlemede hesaplar; bu yüzden boyut baştan seçilir). */
function fitSize(lines, base, min, capacity) {
  const total = lines.reduce((sum, line) => sum + Math.max(1, Math.ceil(String(line).length / 90)), 0);
  if (total <= capacity) return base;
  return Math.max(min, Math.floor(base * Math.sqrt(capacity / total)));
}

function chrome(s, slide, index, total, deck, p, lang) {
  // Başlık bandı: tablo başlığı grisi; başlık metni logo siyahı. Model
  // galerisi (line sheet) A3 sunum formatındaki gibi koyu banttır.
  const dark = slide.layout === 'gallery';
  const ink = dark ? 'FFFFFF' : p.logo;
  s.box({ x: 0, y: 0, w: W, h: BAND, fill: dark ? p.logo : p.headBg, name: 'HeadBand' });
  s.box({ x: W - pt(150), y: -pt(110), w: pt(240), h: pt(240), fill: { color: dark ? 'FFFFFF' : p.logo, alpha: 4 }, geometry: 'ellipse', name: 'Orb' });
  s.box({ x: 0, y: BAND, w: W, h: pt(1), fill: dark ? p.logo : p.headLine, name: 'HeadLine' });
  const titleSize = slide.title.length > 60 ? Math.round(LAYOUT.titleSize * 0.8) : LAYOUT.titleSize;
  // Alt başlık (ör. "36-41 HFT · KK1-2-3" ya da "3 grup · 11 model") başlığın altında.
  const sub = slide.subtitle && BAND >= pt(56) ? Math.max(9, Math.round(titleSize * 0.45)) : 0;
  const subH = sub ? pt(sub * 1.35) : 0;
  s.text(MARGIN, Math.round(BAND * 0.08), W - MARGIN * 2, BAND - Math.round(BAND * 0.08) - pt(16) - subH, slide.title, { size: titleSize, bold: true, color: ink }, { anchor: 'b' });
  if (sub) s.text(MARGIN, BAND - pt(14) - subH, W - MARGIN * 2, subH, slide.subtitle, { size: sub, color: dark ? 'C9CDD2' : p.headInk }, { anchor: 't' });
  s.box({ x: MARGIN, y: BAND - pt(10), w: pt(64), h: pt(3), fill: dark ? 'FFFFFF' : p.logo, name: 'Rule' });
  s.text(MARGIN, H - pt(30), W / 2, pt(18), `Buyer Log · LCW AI${deck.title ? ` · ${deck.title}` : ''}`.slice(0, 110), { size: 9, color: p.muted });
  s.text(W - MARGIN - pt(120), H - pt(30), pt(120), pt(18), `${index + 1} / ${total}`, { size: 9, color: p.muted }, { align: 'r' });
}

// 1.234,5 · 1,234.5 · 12 · %15 · 15% — tarih (02.11.2026) sayı sayılmaz.
const NUMERIC_TEXT = /^%?\s*[-+]?(\d{1,3}([.,]\d{3})+|\d+)([.,]\d+)?\s*%?$/;

/* ---------------- Uzun tablo → devam slaytları ----------------
   Hücre metni kesilmez: her satırın yüksekliği metnin sarılacağı satır
   sayısından tahmin edilir; sayfaya sığmayan satırlar aynı başlıklı
   "(2/3)" devam slaytına geçer. Notlar ve "kaynakta N satır daha" yalnız
   son parçada görünür. */
const tableFontSize = table => LAYOUT.tableSize || (table.columns.length > 6 || table.rows.length > 9 ? 10 : 12);
function tableRowHeights(columns, rows, fontSize) {
  const colPt = TABLE_WIDTH_PT / Math.max(1, columns.length);
  const perLine = Math.max(4, Math.floor((colPt - 10) / (fontSize * 0.55)));
  const heightOf = cells => {
    const lines = Math.max(1, ...cells.map(value => String(value == null ? '' : value).split('\n').reduce((sum, part) => sum + Math.max(1, Math.ceil(part.length / perLine)), 0)));
    return Math.max(fontSize * 2.1, lines * fontSize * 1.22 + 7);
  };
  return [heightOf(columns), ...rows.map(row => heightOf(columns.map((_, index) => row[index])))];
}
function paginateTableSlide(slide) {
  const table = slide.table;
  if (!table || !table.rows.length) return [slide];
  const fontSize = tableFontSize(table);
  const heights = tableRowHeights(table.columns, table.rows, fontSize);
  const noteH = slide.bullets.length ? 60 : 0;
  const available = CONTENT_H / EMU - 6 - noteH - (table.omitted ? 22 : 0);
  const pages = [];
  let current = [];
  let used = heights[0];
  table.rows.forEach((row, index) => {
    const h = heights[index + 1];
    if (current.length && used + h > available) { pages.push(current); current = []; used = heights[0]; }
    current.push(row);
    used += h;
  });
  if (current.length) pages.push(current);
  if (pages.length === 1) return [{ ...slide, table: { ...table, fontSize } }];
  return pages.map((rows, index) => {
    const last = index === pages.length - 1;
    return { ...slide, title: `${slide.title} (${index + 1}/${pages.length})`, bullets: last ? slide.bullets : [], callout: last ? slide.callout : null, table: { ...table, rows, fontSize, omitted: last ? table.omitted : 0 } };
  });
}
/* Galeri: Yerleşim'deki sütun × satır kadar model bir slayta; fazlası
   aynı başlıklı devam slaytlarına. Ardışık küçük galeri grupları (ya da
   öğelerdeki "group") aynı slayta yan yana paketlenir; az dolu slaytta
   kartlar büyür. Hesap tarayıcı önizlemesiyle ortaktır. */
function expandSlides(slides, layout, { lang = 'tr' } = {}) {
  if (layout !== undefined) applyGeometry(layout);
  return BLOutputLayout.expandGalleries(slides, LAYOUT, { english: String(lang).startsWith('en') }).flatMap(entry => {
    if (entry.page) return [{ layout: 'gallery', title: entry.page.title, subtitle: entry.page.subtitle, bullets: [], callout: null, items: entry.page.cells.map(cell => cell.item), page: entry.page }];
    return entry.slide.layout === 'table' ? paginateTableSlide(entry.slide) : [entry.slide];
  });
}

function renderSlide(slide, index, total, deck, p, lang, media, records) {
  const s = createSlideBuilder(p, lang, media);
  const xml = renderSlideBody(s, slide, index, total, deck, p, lang, records || {});
  return { xml, rels: s.rels };
}

/* Tek model kartı: görsel önde ve büyük; altında ikinci planda küçük yazıyla
   model adı ve kullanıcının seçtiği bilgiler (varsayılan: renk kodu, fit,
   adet, hedef fiyat). İçerik hesabı önizlemeyle ortaktır (cardContent). */
function renderCard(s, cell, item, page, p, lang, records) {
  const x = pt(cell.x), y = pt(cell.y), w = pt(cell.w), h = pt(cell.h);
  const content = BLOutputLayout.cardContent(cell, LAYOUT, item, records[String(item.image || '').toUpperCase()], page.scale);
  const box = content.box;
  const pad = pt(box.pad);
  s.box({ x, y, w, h, fill: 'FFFFFF', line: { color: p.line, width: 0.75 }, name: 'Card', shadow: true });
  // Durum tonu (ok/uyarı/risk) yalnız ince üst çizgidir; nötr kartta çizgi yok.
  if (item.tone && item.tone !== 'info') s.box({ x, y, w, h: pt(2), fill: toneColor(item.tone, p), name: 'Tone' });
  const imgH = pt(box.imgH);
  s.picture({ x: x + pad, y: y + pad, w: w - pad * 2, h: imgH, token: item.image, label: item.title, frame: false });
  let ty = y + pad + imgH + pt(3);
  const bottom = y + h - pad + pt(2);
  const innerW = w - pad * 2;
  if (content.badge && ty + pt(box.size * 1.1) < bottom) {
    const chipW = Math.min(innerW, pt(content.badge.length * box.size * 0.6 + 6));
    s.box({ x: x + pad, y: ty, w: chipW, h: pt(box.size * 1.1), fill: p.accBg, anchor: 'ctr', inset: 1, name: 'Badge', paragraphs: [paragraph(content.badge, { size: Math.max(5.5, box.size - 2), bold: true, color: p.accInk }, p, lang, { align: 'ctr', spaceAfter: 0 })] });
    ty += pt(box.size * 1.1 + 3);
  }
  const lines = [];
  if (content.title) lines.push(richParagraph([{ text: content.title, size: box.size, bold: true, color: p.ink }], p, lang, { size: box.size, spaceAfter: 1 }));
  if (content.meta) lines.push(richParagraph([{ text: content.meta, size: box.detail, color: p.ink2 }], p, lang, { size: box.detail }));
  const toneOf = tone => (tone === 'risk' ? p.risk : tone === 'ok' ? p.ok : tone === 'warn' ? p.warn : p.ink2);
  for (const line of content.lines) {
    const runs = [];
    line.forEach((field, i) => {
      if (i) runs.push({ text: '  ·  ', size: box.detail, color: p.line });
      if (LAYOUT.showFieldLabels) runs.push({ text: `${field.label} `, size: box.detail, color: p.muted });
      runs.push({ text: field.value, size: box.detail, bold: Boolean(field.tone), color: toneOf(field.tone) });
    });
    lines.push(richParagraph(runs, p, lang, { size: box.detail }));
  }
  if (lines.length && ty < bottom - pt(4)) s.box({ x: x + pad, y: ty, w: innerW, h: bottom - ty, paragraphs: lines, inset: 0, name: 'CardText' });
}

function renderSlideBody(s, slide, index, total, deck, p, lang, records = {}) {
  const english = lang.startsWith('en');
  if (slide.layout === 'title') {
    // Renk geçişli kapak + yarı saydam dekoratif daireler.
    s.box({ x: W - pt(380), y: -pt(180), w: pt(560), h: pt(560), fill: { color: p.logo, alpha: 5 }, geometry: 'ellipse', name: 'Orb' });
    s.box({ x: W - pt(210), y: pt(300), w: pt(300), h: pt(300), fill: { color: p.headInk, alpha: 8 }, geometry: 'ellipse', name: 'Orb' });
    s.box({ x: -pt(90), y: H - pt(150), w: pt(240), h: pt(240), fill: { color: p.logo, alpha: 4 }, geometry: 'ellipse', name: 'Orb' });
    s.box({ x: 0, y: H - pt(6), w: W, h: pt(6), fill: p.logo, name: 'Base' });
    s.text(pt(80), pt(140), W - pt(200), pt(40), 'BUYER LOG · LCW AI', { size: 13, bold: true, color: p.headInk });
    s.text(pt(80), pt(180), W - pt(260), pt(150), slide.title, { size: slide.title.length > 50 ? 36 : 46, bold: true, color: p.logo });
    if (slide.subtitle) s.text(pt(80), pt(335), W - pt(260), pt(60), slide.subtitle, { size: 20, color: p.headInk });
    s.box({ x: pt(80), y: pt(410), w: pt(90), h: pt(4), fill: p.logo, name: 'Rule' });
    s.text(pt(80), pt(425), W - pt(160), pt(24), deck.date, { size: 12, color: p.headInk });
    return s.xml([p.headBg, p.headBg2]);
  }
  if (slide.layout === 'section') {
    s.box({ x: W - pt(320), y: -pt(120), w: pt(460), h: pt(460), fill: { color: p.logo, alpha: 5 }, geometry: 'ellipse', name: 'Orb' });
    s.box({ x: MARGIN * 2, y: H / 2 - pt(92), w: pt(70), h: pt(5), fill: p.logo, name: 'Rule' });
    s.text(MARGIN * 2, H / 2 - pt(80), W - MARGIN * 4, pt(100), slide.title, { size: 40, bold: true, color: p.logo }, { anchor: 'b' });
    if (slide.subtitle) s.text(MARGIN * 2, H / 2 + pt(40), W - MARGIN * 4, pt(60), slide.subtitle, { size: 18, color: p.headInk });
    return s.xml([p.headBg2, p.headBg], 'push');
  }
  chrome(s, slide, index, total, deck, p, lang);
  const width = W - MARGIN * 2;
  if (slide.layout === 'kpis') {
    const kpis = slide.kpis;
    const perRow = kpis.length <= 4 ? kpis.length : 3;
    const rowsCount = Math.ceil(kpis.length / perRow);
    const gap = pt(14);
    const cardW = (width - gap * (perRow - 1)) / perRow;
    const reserved = slide.bullets.length ? pt(110) : 0;
    const cardH = Math.min(pt(150), (CONTENT_H - reserved - gap * (rowsCount - 1)) / rowsCount);
    kpis.forEach((kpi, i) => {
      const x = MARGIN + (i % perRow) * (cardW + gap);
      const y = CONTENT_TOP + pt(8) + Math.floor(i / perRow) * (cardH + gap);
      s.box({ x, y, w: cardW, h: cardH, fill: p.card, line: { color: p.line }, name: 'KPI' });
      s.box({ x, y, w: cardW, h: pt(5), fill: toneColor(kpi.tone, p), name: 'Tone' });
      s.text(x + pt(12), y + pt(14), cardW - pt(24), pt(18), kpi.label.toUpperCase(), { size: 11, bold: true, color: p.muted });
      s.text(x + pt(12), y + pt(34), cardW - pt(24), pt(48), String(kpi.value), { size: String(kpi.value).length > 12 ? 24 : 32, bold: true, color: p.ink });
      if (kpi.note) s.text(x + pt(12), y + pt(84), cardW - pt(24), cardH - pt(92), kpi.note, { size: 11, color: p.ink2 });
    });
    if (slide.bullets.length) {
      const y = CONTENT_TOP + pt(8) + rowsCount * (cardH + gap);
      s.box({ x: MARGIN, y, w: width, h: H - pt(44) - y, paragraphs: slide.bullets.slice(0, 4).map(item => paragraph(item, { size: Math.max(9, LAYOUT.bodySize - 6), color: p.ink }, p, lang, { bullet: true, spaceAfter: 4 })), name: 'Notes' });
    }
    return s.xml();
  }
  if (slide.layout === 'table') {
    const fontSize = slide.table.fontSize || tableFontSize(slide.table);
    const noteH = slide.bullets.length ? pt(60) : 0;
    s.table({ x: MARGIN, y: CONTENT_TOP + pt(6), w: width, columns: slide.table.columns, rows: slide.table.rows, fontSize, heights: tableRowHeights(slide.table.columns, slide.table.rows, fontSize) });
    if (slide.table.omitted) s.text(MARGIN, H - pt(44) - noteH - pt(20), width, pt(18), english ? `+${slide.table.omitted} more rows in the source data` : `Kaynak veride ${slide.table.omitted} satır daha var`, { size: 10, color: p.muted, italic: true });
    if (noteH) s.box({ x: MARGIN, y: H - pt(44) - noteH, w: width, h: noteH, paragraphs: slide.bullets.slice(0, 2).map(item => paragraph(item, { size: 12, color: p.ink2 }, p, lang, { bullet: true, spaceAfter: 2 })), name: 'Notes' });
    return s.xml();
  }
  if (slide.layout === 'chart') {
    const chart = slide.chart;
    const sideW = slide.bullets.length ? pt(300) : 0;
    const chartW = width - sideW - (sideW ? pt(24) : 0);
    const categories = chart.categories;
    const series = chart.series;
    const max = Math.max(1e-9, ...series.flatMap(item => item.values.map(value => Math.abs(value))));
    const colors = [p.acc, p.warn, p.ok];
    const labelW = Math.min(pt(200), chartW * 0.32);
    const valueW = pt(70);
    const top = CONTENT_TOP + pt(8) + (series.length > 1 ? pt(22) : 0);
    const rowH = Math.min(pt(40), (CONTENT_H - pt(16) - (top - CONTENT_TOP)) / categories.length);
    const barArea = chartW - labelW - valueW;
    if (series.length > 1) {
      series.forEach((item, i) => {
        s.box({ x: MARGIN + labelW + i * pt(150), y: CONTENT_TOP + pt(6), w: pt(12), h: pt(12), fill: colors[i % colors.length], name: 'Legend' });
        s.text(MARGIN + labelW + i * pt(150) + pt(16), CONTENT_TOP + pt(2), pt(130), pt(18), item.name, { size: 11, color: p.ink2 });
      });
    }
    categories.forEach((category, row) => {
      const y = top + row * rowH;
      s.text(MARGIN, y, labelW - pt(8), rowH, category, { size: rowH < pt(24) ? 10 : 12, color: p.ink }, { anchor: 'ctr', align: 'r' });
      const barH = (rowH * 0.7) / series.length;
      series.forEach((item, i) => {
        const value = item.values[row] || 0;
        const w = Math.max(pt(1), (Math.abs(value) / max) * (barArea - pt(8)));
        const by = y + rowH * 0.15 + i * barH;
        s.box({ x: MARGIN + labelW, y: by, w, h: Math.max(pt(2), barH - pt(1)), fill: colors[i % colors.length], name: 'Bar' });
        if (series.length === 1 || barH >= pt(10)) s.text(MARGIN + labelW + w + pt(4), by, valueW, barH, formatNumber(value, chart.unit, lang), { size: barH < pt(14) ? 9 : 11, color: p.ink2 }, { anchor: 'ctr' });
      });
    });
    const sideH = Math.min(CONTENT_H - pt(16), pt(36) + slide.bullets.slice(0, 6).reduce((sum, item) => sum + pt(22) * Math.max(1, Math.ceil(item.length / 34)), 0));
    if (sideW) s.box({ x: W - MARGIN - sideW, y: CONTENT_TOP + pt(8), w: sideW, h: sideH, fill: p.accBg, paragraphs: slide.bullets.slice(0, 6).map(item => paragraph(item, { size: 13, color: p.ink }, p, lang, { bullet: true })), inset: 12, name: 'Insight' });
    return s.xml();
  }
  if (slide.layout === 'comparison') {
    const gap = pt(20);
    const colW = (width - gap) / 2;
    const lines = Math.max(...[slide.left, slide.right].map(column => column.bullets.reduce((sum, item) => sum + Math.max(1, Math.ceil(item.length / 48)), 0)));
    const cardH = Math.min(CONTENT_H - pt(16), Math.max(pt(170), pt(84) + lines * pt(30)));
    [slide.left, slide.right].forEach((column, i) => {
      const x = MARGIN + i * (colW + gap);
      s.box({ x, y: CONTENT_TOP + pt(8), w: colW, h: cardH, fill: p.card, line: { color: p.line }, name: 'Column' });
      s.box({ x, y: CONTENT_TOP + pt(8), w: colW, h: pt(5), fill: i ? p.headInk : p.logo, name: 'Tone' });
      s.text(x + pt(14), CONTENT_TOP + pt(22), colW - pt(28), pt(30), column.title, { size: 20, bold: true, color: p.logo });
      const size = fitSize(column.bullets, Math.max(10, LAYOUT.bodySize - 4), Math.min(11, LAYOUT.bodySize - 4), 9);
      s.box({ x: x + pt(14), y: CONTENT_TOP + pt(60), w: colW - pt(28), h: cardH - pt(64), paragraphs: column.bullets.map(item => paragraph(item, { size, color: p.ink }, p, lang, { bullet: true })), name: 'Bullets' });
    });
    return s.xml();
  }
  if (slide.layout === 'gallery' && slide.page) {
    // Model kartları Yerleşim ızgarasına (sütun × satır) yerleşir; konumlar
    // tarayıcıdaki önizlemeyle aynı hesaptan gelir (galleryPages).
    const page = slide.page;
    s.box({ x: MARGIN - pt(10), y: CONTENT_TOP - pt(4), w: width + pt(20), h: H - pt(40) - CONTENT_TOP + pt(4), fill: { color: p.headBg, alpha: 55 }, line: { color: p.headLine, width: 0.75 }, name: 'Frame' });
    page.dividers.forEach(item => s.box({ x: pt(item.x) - pt(0.4), y: pt(item.y), w: pt(0.8), h: pt(item.h), fill: p.headLine, name: 'GroupDivider' }));
    page.rules.forEach(item => s.box({ x: pt(item.x), y: pt(item.y), w: pt(item.w), h: pt(1.6), fill: p.logo, name: 'GroupRule' }));
    page.labels.forEach(item => s.text(pt(item.x), pt(item.y), pt(item.w), pt(item.h), `${item.text}${item.cont ? (english ? ' (cont.)' : ' (devam)') : ''}`, { size: Math.max(8, LAYOUT.cardTextSize), bold: true, color: p.logo }, { anchor: 'b', inset: 0 }));
    page.cells.forEach(cell => renderCard(s, cell, cell.item, page, p, lang, records));
    return s.xml();
  }
  if (slide.layout === 'gallery') {
    const cells = BLOutputLayout.galleryCells(LAYOUT, slide.items.length);
    const textSize = LAYOUT.cardTextSize;
    slide.items.slice(0, cells.length).forEach((item, i) => {
      const cell = cells[i];
      const x = pt(cell.x), y = pt(cell.y), cardW = pt(cell.w), cardH = pt(cell.h), imgH = pt(cell.imgH);
      const inset = Math.min(pt(8), cardW * 0.06);
      s.box({ x, y, w: cardW, h: cardH, fill: p.card, line: { color: p.line }, name: 'Card' });
      s.box({ x, y, w: cardW, h: pt(4), fill: toneColor(item.tone, p), name: 'Tone' });
      s.picture({ x: x + inset, y: y + pt(8), w: cardW - inset * 2, h: imgH, token: item.image, label: item.title });
      let ty = y + pt(8) + imgH + pt(3);
      const bottom = y + cardH - pt(3);
      if (LAYOUT.showTitle && item.title && ty < bottom) {
        const h = Math.min(pt(textSize * 1.45), bottom - ty);
        s.text(x + inset, ty, cardW - inset * 2, h, item.title, { size: textSize, bold: true, color: p.logo });
        ty += h;
      }
      const meta = [LAYOUT.showSubtitle ? item.subtitle : '', LAYOUT.showNote ? item.note : ''].filter(Boolean).join(' · ');
      if (meta && ty < bottom - pt(6)) s.text(x + inset, ty, cardW - inset * 2, bottom - ty, meta, { size: Math.max(7, textSize - 2.5), color: p.ink2 });
    });
    return s.xml();
  }
  // bullets & summary
  const numbered = slide.layout === 'summary';
  const items = slide.bullets;
  const hasCallout = Boolean(slide.callout);
  const size = fitSize(items, LAYOUT.bodySize, Math.min(12, LAYOUT.bodySize), hasCallout ? 7 : 9);
  const bodyH = CONTENT_H - (hasCallout ? pt(78) : 0);
  // Maddeli slayt model görseli taşıyabilir (sağda).
  const sideImage = slide.layout === 'bullets' && slide.image;
  const imageW = sideImage ? Math.min(pt(300), bodyH) : 0;
  if (sideImage) s.picture({ x: W - MARGIN - imageW, y: CONTENT_TOP + pt(8), w: imageW, h: Math.min(bodyH, imageW), token: slide.image, label: slide.title });
  s.box({
    x: MARGIN, y: CONTENT_TOP + pt(8), w: width - (imageW ? imageW + pt(20) : 0), h: bodyH,
    paragraphs: items.map((item, i) => numbered ? paragraph(`${i + 1}.  ${item}`, { size, color: p.ink }, p, lang, { spaceAfter: 8 }) : paragraph(item, { size, color: p.ink }, p, lang, { bullet: true, spaceAfter: 8 })),
    name: 'Bullets',
  });
  if (hasCallout) {
    s.box({ x: MARGIN, y: H - pt(44) - pt(64), w: width, h: pt(56), fill: toneBg(slide.callout.tone, p), name: 'Callout', anchor: 'ctr', inset: 12, paragraphs: [paragraph(slide.callout.text, { size: 14, bold: true, color: p.ink }, p, lang, { spaceAfter: 0 })] });
    s.box({ x: MARGIN, y: H - pt(44) - pt(64), w: pt(5), h: pt(56), fill: toneColor(slide.callout.tone, p), name: 'CalloutTone' });
  }
  return s.xml();
}
const toneBg = (tone, p) => ({ ok: p.okBg, warn: p.warnBg, risk: p.riskBg }[tone] || p.accBg);

function formatNumber(value, unit, lang) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '';
  const locale = lang.startsWith('en') ? 'en-US' : 'tr-TR';
  const text = number.toLocaleString(locale, { maximumFractionDigits: Math.abs(number) < 10 ? 2 : 0 });
  if (unit === '%') return `${text}%`;
  return unit ? `${text} ${unit}` : text;
}

/* ---------------- Paket parçaları ---------------- */
function themeXml(p) {
  const font = theme().fonts.office;
  const solid = color => `<a:solidFill><a:srgbClr val="${color}"/></a:solidFill>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Buyer Log"><a:themeElements><a:clrScheme name="Buyer Log"><a:dk1><a:srgbClr val="${p.ink}"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="${p.deep}"/></a:dk2><a:lt2><a:srgbClr val="${p.card}"/></a:lt2><a:accent1><a:srgbClr val="${p.acc}"/></a:accent1><a:accent2><a:srgbClr val="${p.accInk}"/></a:accent2><a:accent3><a:srgbClr val="${p.ok}"/></a:accent3><a:accent4><a:srgbClr val="${p.warn}"/></a:accent4><a:accent5><a:srgbClr val="${p.risk}"/></a:accent5><a:accent6><a:srgbClr val="${p.ink2}"/></a:accent6><a:hlink><a:srgbClr val="${p.accInk}"/></a:hlink><a:folHlink><a:srgbClr val="${p.ink2}"/></a:folHlink></a:clrScheme><a:fontScheme name="Buyer Log"><a:majorFont><a:latin typeface="${font}"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="${font}"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="Buyer Log"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill>${solid(p.accBg)}${solid(p.acc)}</a:fillStyleLst><a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill>${solid('FFFFFF')}${solid(p.card)}</a:bgFillStyleLst></a:fmtScheme></a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>`;
}

const NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const EMPTY_TREE = '<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree>';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

/* deck: normalizePresentation() çıktısı. Döner: Buffer (.pptx). */
/* records: { görsel anahtarı → [[sütun, değer], …] } — kart bilgisi kaynak veriden. */
function renderPresentation(deck, { lang = 'tr', date = new Date(), images = {}, records = {} } = {}) {
  const p = palette();
  const langTag = lang === 'en' ? 'en-US' : 'tr-TR';
  // PowerPoint yalnız PNG/JPEG/GIF'i güvenle açar (WEBP → "görsel yok").
  const media = {};
  const mediaFiles = [];
  for (const [token, image] of Object.entries(images || {})) {
    if (!['png', 'jpg', 'gif'].includes(image.ext)) continue;
    const name = `image${mediaFiles.length + 1}.${image.ext}`;
    media[token] = { name, width: image.width, height: image.height };
    mediaFiles.push({ name: `ppt/media/${name}`, data: image.buffer });
  }
  const expanded = expandSlides(deck.slides, deck.layout || null, { lang });
  const rendered = expanded.map((slide, index) => renderSlide(slide, index, expanded.length, deck, p, langTag, media, records));
  const slides = rendered.map(item => item.xml);
  const created = (date instanceof Date ? date : new Date()).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const entries = [
    { name: '[Content_Types].xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="jpg" ContentType="image/jpeg"/><Default Extension="gif" ContentType="image/gif"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/><Override PartName="/ppt/presProps.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presProps+xml"/><Override PartName="/ppt/viewProps.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.viewProps+xml"/><Override PartName="/ppt/tableStyles.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.tableStyles+xml"/>${slides.map((_, i) => `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join('')}<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>` },
    { name: '_rels/.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="ppt/presentation.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="${REL}/extended-properties" Target="docProps/app.xml"/></Relationships>` },
    { name: 'docProps/core.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xmlText(deck.title)}</dc:title><dc:creator>Buyer Log · LCW AI</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${created}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${created}</dcterms:modified></cp:coreProperties>` },
    { name: 'docProps/app.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Buyer Log</Application><Slides>${slides.length}</Slides></Properties>` },
    { name: 'ppt/presentation.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation ${NS} saveSubsetFonts="1"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>${slides.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 2}"/>`).join('')}</p:sldIdLst><p:sldSz cx="${W}" cy="${H}"/><p:notesSz cx="6858000" cy="9144000"/><p:defaultTextStyle><a:defPPr><a:defRPr lang="${langTag}"/></a:defPPr></p:defaultTextStyle></p:presentation>` },
    { name: 'ppt/_rels/presentation.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/slideMaster" Target="slideMasters/slideMaster1.xml"/>${slides.map((_, i) => `<Relationship Id="rId${i + 2}" Type="${REL}/slide" Target="slides/slide${i + 1}.xml"/>`).join('')}<Relationship Id="rId${slides.length + 2}" Type="${REL}/theme" Target="theme/theme1.xml"/><Relationship Id="rId${slides.length + 3}" Type="${REL}/presProps" Target="presProps.xml"/><Relationship Id="rId${slides.length + 4}" Type="${REL}/viewProps" Target="viewProps.xml"/><Relationship Id="rId${slides.length + 5}" Type="${REL}/tableStyles" Target="tableStyles.xml"/></Relationships>` },
    { name: 'ppt/presProps.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentationPr ${NS}/>` },
    { name: 'ppt/viewProps.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:viewPr ${NS}><p:normalViewPr><p:restoredLeft sz="15620"/><p:restoredTop sz="94660"/></p:normalViewPr><p:gridSpacing cx="76200" cy="76200"/></p:viewPr>` },
    { name: 'ppt/tableStyles.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:tblStyleLst xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" def="{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}"/>` },
    { name: 'ppt/theme/theme1.xml', data: themeXml(p) },
    { name: 'ppt/slideMasters/slideMaster1.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldMaster ${NS}><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg>${EMPTY_TREE}</p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle><a:lvl1pPr><a:defRPr sz="3000"/></a:lvl1pPr></p:titleStyle><p:bodyStyle><a:lvl1pPr><a:defRPr sz="1800"/></a:lvl1pPr></p:bodyStyle><p:otherStyle><a:lvl1pPr><a:defRPr sz="1400"/></a:lvl1pPr></p:otherStyle></p:txStyles></p:sldMaster>` },
    { name: 'ppt/slideMasters/_rels/slideMaster1.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="${REL}/theme" Target="../theme/theme1.xml"/></Relationships>` },
    { name: 'ppt/slideLayouts/slideLayout1.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldLayout ${NS} type="blank" preserve="1"><p:cSld name="Blank">${EMPTY_TREE}</p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>` },
    { name: 'ppt/slideLayouts/_rels/slideLayout1.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>` },
    ...slides.flatMap((xml, i) => [
      { name: `ppt/slides/slide${i + 1}.xml`, data: xml },
      { name: `ppt/slides/_rels/slide${i + 1}.xml.rels`, data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>${rendered[i].rels.map(rel => `<Relationship Id="${rel.id}" Type="${REL}/image" Target="../media/${rel.target}"/>`).join('')}</Relationships>` },
    ]),
    ...mediaFiles,
  ];
  return createZip(entries, { date });
}

module.exports = { renderPresentation, formatNumber, fitSize, expandSlides, SLIDE_SIZE: { width: W, height: H } };
