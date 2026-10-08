'use strict';

/*
 * Model kataloğu (PDF/HTML).
 *
 * LCW AI'ın yazdığı <div class="bl-gallery"> model kartları yapılandırılmış
 * veriye çevrilir (görsel anahtarı, model adı, bilgi satırları TAM, durum
 * etiketi, ton) ve gövdede <div class="bl-catalog" data-bl-catalog="N">
 * yer tutucusu kalır. Kartlar kullanıcının gruplamasına (grup / alt grup) ve
 * sayfa tasarımına (12 sütunlu blok ızgarası) göre Buyer Log tarafından
 * çizilir; PowerPoint'teki katalog slaytlarıyla aynı model
 * (public/lcwai-output-layout.js).
 *
 * LCW AI modelleri çoğu zaman kendisi gruplar: her grup için başlıklar
 * ("Ana kategori — …", "Alt kategori — …") ve ayrı bir galeri yazar. Arada
 * yalnız başlık ve sarmalayıcı olan ARDIŞIK galeriler tek katalogda
 * birleşir; başlıklar grup / alt grup olur (data-bl-group / data-bl-subgroup
 * öznitelikleri varsa onlar esastır). Başka içerik (paragraf, tablo, not)
 * katalogları ayırır ve yerinde kalır.
 */
const BLOutputLayout = require('../../../public/lcwai-output-layout');
const { escapeHtml: esc } = require('./output-html');

const LIMITS = Object.freeze({ galleries: 20, items: 200, title: 140 });
const MM = 96 / 25.4;
const clean = (value, max) => String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, max);
const normalizeItem = raw => BLOutputLayout.normalizeItem(raw);

/* Temizlenmiş HTML parçasından düz metin (varlıklar çözülür). */
function decode(text) {
  return String(text || '')
    .replace(/&nbsp;|&#160;/gi, ' ').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16))).replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&amp;/gi, '&');
}
const textOf = html => clean(decode(String(html || '').replace(/<[^>]*>/g, ' ')), 2000);

function normalizeGallery(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  return {
    title: clean(source.title, LIMITS.title),
    items: (Array.isArray(source.items) ? source.items : []).slice(0, LIMITS.items).map(normalizeItem).filter(item => item.title || item.image),
    catalog: BLOutputLayout.normalizeCatalog(source.catalog),
  };
}

/* Kart HTML'i → kart verisi. Görsel, başlık ve durum etiketi ayrılır; geri
   kalan her blok (p, small, div, li, <br>) ayrı bir bilgi satırıdır. */
const BADGE_RE = /<(span|div|p|small|em|strong|b|mark)\b[^>]*\bclass="([^"]*\b(?:bl-badge|badge|pill|chip|status|tag)\b[^"]*)"[^>]*>([\s\S]*?)<\/\1>/i;
const TONE_OF = cls => { const match = /\b(ok|warn|risk|info)\b/.exec(cls || ''); return match ? match[1] : ''; };
function cardOf(html) {
  const open = /^<div\b[^>]*>/i.exec(html);
  const tone = TONE_OF((/class="([^"]*)"/.exec(open ? open[0] : '') || [])[1]) || 'info';
  const image = /data-bl-image="([^"]+)"/.exec(html);
  const alt = /<img\b[^>]*\balt="([^"]*)"/i.exec(html);
  let rest = String(html).replace(/^<div\b[^>]*>/i, '').replace(/<\/div>\s*$/i, '').replace(/<img\b[^>]*>/gi, '');
  let badge = null;
  const b = BADGE_RE.exec(rest);
  if (b) { badge = { text: textOf(b[3]), tone: TONE_OF(b[2]) || tone }; rest = `${rest.slice(0, b.index)}\n${rest.slice(b.index + b[0].length)}`; }
  let title = '';
  const t = /<(h[1-6])\b[^>]*>([\s\S]*?)<\/\1>/i.exec(rest) || /<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/i.exec(rest);
  if (t) { title = textOf(t[2]); rest = `${rest.slice(0, t.index)}\n${rest.slice(t.index + t[0].length)}`; }
  else if (alt) title = textOf(alt[1]);
  const lines = decode(rest.replace(/<br\s*\/?>/gi, '\n').replace(/<\/?(p|div|li|small|h[1-6]|ul|ol|dl|dt|dd|tr|table|tbody|thead|section|figure|figcaption|blockquote|header|footer)\b[^>]*>/gi, '\n').replace(/<[^>]*>/g, ' '))
    .split('\n').map(line => line.replace(/\s+/g, ' ').trim()).filter(Boolean);
  return normalizeItem({ title, lines, badge, image: image ? image[1] : '', tone });
}

/* ---------------- Galerilerin önündeki başlıklar ---------------- */
const WRAPPER = /^(div|section|article|aside|main|header|figure)$/;
const TAG_RE = /<(\/?)([a-z][a-z0-9]*)\b[^>]*?(\/?)>/gi;
/* Galeriden geriye doğru: boşluk ve sarmalayıcı etiketleri atlanır, tam
   başlıklar (h2–h6) toplanır; başka bir şeyde durulur. consumedAll: arada
   yalnız başlık/sarmalayıcı vardı. */
function headingsBefore(gap) {
  const tokens = [];
  let match, last = 0;
  TAG_RE.lastIndex = 0;
  while ((match = TAG_RE.exec(gap))) {
    if (match.index > last) tokens.push({ text: gap.slice(last, match.index), index: last });
    tokens.push({ tag: match[2].toLowerCase(), close: Boolean(match[1]), index: match.index, end: TAG_RE.lastIndex });
    last = TAG_RE.lastIndex;
  }
  if (last < gap.length) tokens.push({ text: gap.slice(last), index: last });
  const headings = [];
  let start = gap.length;
  for (let i = tokens.length - 1; i >= 0; i--) {
    const token = tokens[i];
    if (token.text != null) { if (token.text.trim()) return { headings, start, consumedAll: false }; continue; }
    if (WRAPPER.test(token.tag)) continue;
    const level = /^h([2-6])$/.exec(token.tag);
    if (level && token.close) {
      let j = i - 1;
      while (j >= 0 && !(tokens[j].tag === token.tag && !tokens[j].close)) j--;
      if (j < 0) return { headings, start, consumedAll: false };
      const text = textOf(gap.slice(tokens[j].end, token.index));
      if (text) headings.unshift({ level: Number(level[1]), text, index: tokens[j].index });
      start = tokens[j].index;
      i = j;
      continue;
    }
    return { headings, start, consumedAll: false };
  }
  return { headings, start, consumedAll: true };
}
/* "Ana kategori — Fabric: 3859-Örme…" → "Fabric: 3859-Örme…";
   "Alt kategori — T-Shirt · 21 model kartı · tüm modeller bu sayfada" → "T-Shirt". */
function cleanLabel(text) {
  let out = clean(text, 400);
  const lead = /^([^—–:]{1,24})\s+[—–]\s+(.+)$/.exec(out);
  if (lead) out = lead[2];
  const parts = out.split(/\s+·\s+/);
  const kept = parts.filter((part, index) => index === 0 || !/\d+\s*(model|kart|ürün|adet|item|card|product)|tüm model|all model|bu sayfa|this page|devam|continued/i.test(part));
  return clean(kept.join(' · '), 160);
}
/* Açık kalan / fazladan kapanan etiketler: kaldırılan aralığın yapısı korunur. */
function residualTags(span) {
  const stack = [], closes = [];
  let match;
  TAG_RE.lastIndex = 0;
  while ((match = TAG_RE.exec(span))) {
    const tag = match[2].toLowerCase();
    if (match[3] || /^(img|br|hr|col)$/.test(tag)) continue;
    if (!match[1]) stack.push(match[0]);
    else if (stack.length) stack.pop();
    else closes.push(match[0]);
  }
  return closes.join('') + stack.join('');
}
const PLACEHOLDER = index => `<div class="bl-catalog" data-bl-catalog="${index}"></div>`;
function tidy(body) {
  let out = body, previous;
  do {
    previous = out;
    out = out.replace(/<(div|section|article|aside|figure|header)\b(?![^>]*data-bl-catalog)[^>]*>\s*<\/\1>/gi, '');
    out = out.replace(/<(div|section|article|aside|figure)\b[^>]*>\s*(<div class="bl-catalog" data-bl-catalog="\d+"><\/div>)\s*<\/\1>/gi, '$2');
  } while (out !== previous);
  return out;
}

/* Gövdedeki galerileri katalog verisine çevirir. */
function extractGalleries(body, existing = []) {
  const source = String(body || '');
  const galleries = existing.slice(0, LIMITS.galleries);
  const found = BLOutputLayout.findGalleries(source);
  if (!found.length) return { body: source, galleries };
  // 1) Galerileri ardışıklığa göre kümele.
  const runs = [];
  let prevEnd = 0;
  for (const gallery of found) {
    const items = gallery.children.map(cardOf).filter(item => item.title || item.image);
    const before = headingsBefore(source.slice(prevEnd, gallery.start));
    const open = /^<div\b[^>]*>/.exec(source.slice(gallery.start)) || [''];
    const attr = name => { const m = new RegExp(`\\bdata-bl-${name}="([^"]*)"`).exec(open[0]); return m ? clean(decode(m[1]), 160) : null; };
    const entry = { gallery, items, headings: before.headings.map(h => ({ ...h, index: h.index + prevEnd })), start: before.start + prevEnd, group: attr('group'), subgroup: attr('subgroup') };
    const run = runs[runs.length - 1];
    if (run && before.consumedAll && items.length) run.entries.push(entry);
    else runs.push({ entries: [entry] });
    prevEnd = gallery.end;
  }
  // 2) Her küme bir katalog: başlıklar grup / alt grup olur.
  const replacements = [];
  for (const run of runs) {
    const entries = run.entries.filter(entry => entry.items.length);
    if (!entries.length || galleries.length >= LIMITS.galleries) continue;
    let title = '';
    const first = entries[0];
    const labelled = entries.some(entry => entry.group != null);
    if (!labelled && entries.length === 1 && first.headings.length === 1) { title = first.headings[0].text; first.headings = []; }
    else if (first.headings.length >= 3) title = first.headings.shift().text;
    const state = { group: '', subLevel: 0 };
    const items = [];
    for (const entry of entries) {
      let group = '', subgroup = '';
      if (entry.group != null) { group = entry.group; subgroup = entry.subgroup || ''; }
      else {
        const h = entry.headings;
        if (h.length >= 2) { group = cleanLabel(h[h.length - 2].text); subgroup = cleanLabel(h[h.length - 1].text); state.subLevel = h[h.length - 1].level; }
        else if (h.length === 1 && state.subLevel && h[0].level === state.subLevel && state.group) { group = state.group; subgroup = cleanLabel(h[0].text); }
        else if (h.length === 1) { group = cleanLabel(h[0].text); state.subLevel = 0; }
        else group = state.group;
      }
      state.group = group;
      for (const item of entry.items) if (items.length < LIMITS.items) items.push({ ...item, group: item.group || group, subgroup: item.subgroup || subgroup });
    }
    galleries.push({ title: clean(title, LIMITS.title), items, catalog: BLOutputLayout.normalizeCatalog(null) });
    const last = entries[entries.length - 1];
    const start = Math.min(first.start, first.gallery.start);
    replacements.push({ start, end: last.gallery.end, index: galleries.length - 1 });
  }
  // 3) Aralıklar sondan başa yer tutucuyla değişir (yapı korunur).
  let out = source;
  for (const r of replacements.sort((a, b) => b.start - a.start)) {
    out = `${out.slice(0, r.start)}${PLACEHOLDER(r.index)}${residualTags(out.slice(r.start, r.end))}${out.slice(r.end)}`;
  }
  return { body: tidy(out), galleries };
}

/* Yer tutucu dizinlerini doğrular; kullanılmayan galeriyi düşürür. */
function reconcile(body, galleries) {
  const list = (Array.isArray(galleries) ? galleries : []).slice(0, LIMITS.galleries).map(normalizeGallery);
  const used = new Map();
  // Tarayıcı düzenleyicisi yer tutucuya öznitelik (style="", contenteditable)
  // ya da <br> ekleyebilir; yer tutucu burada kanonik biçime döner.
  const out = String(body || '').replace(/<div\b[^>]*\bdata-bl-catalog="(\d{1,3})"[^>]*>(?:\s|<br\s*\/?>)*<\/div>/gi, (all, index) => {
    const n = Number(index);
    if (!list[n] || used.has(n)) return '';
    used.set(n, used.size);
    return PLACEHOLDER(used.get(n));
  });
  const next = [];
  for (const [old, now] of used) next[now] = list[old];
  return { body: out, galleries: next };
}

/* Bağlam verisinden gruplama tespiti: başlıklardan gelen grup adları bir
   sütunun değerlerini içeriyorsa (ör. "Fabric: 3859-Örme…" ⊃ Fabric değeri)
   gruplama o sütuna bağlanır; adlar veriyle aynı, temiz olur. */
function refineGrouping(gallery, attributes) {
  const g = normalizeGallery(gallery);
  if (!attributes || g.catalog.by || !g.items.some(item => item.group)) return g;
  const norm = value => String(value || '').toLocaleLowerCase('tr').replace(/\s+/g, ' ').trim();
  const columns = new Set();
  for (const item of g.items) { const row = item.image && attributes[item.image]; if (row) Object.keys(row).forEach(name => columns.add(name)); }
  const best = which => {
    let pick = null;
    for (const column of columns) {
      let count = 0, hit = 0, length = 0;
      for (const item of g.items) {
        const value = norm(BLOutputLayout.fieldValue(item, `a:${column}`, attributes));
        const label = norm(item[which]);
        if (!value || !label) continue;
        count++; length += value.length;
        if (label === value || (value.length >= 2 && label.includes(value))) hit++;
      }
      if (count < 2 || hit / count < 0.8) continue;
      const score = hit / count + Math.min(0.15, length / count / 400);
      if (!pick || score > pick.score) pick = { column, score };
    }
    return pick && pick.column;
  };
  const by = best('group');
  if (!by) return g;
  const then = g.items.some(item => item.subgroup) ? best('subgroup') : null;
  const items = g.items.map(item => {
    const group = BLOutputLayout.fieldValue(item, `a:${by}`, attributes);
    const subgroup = then ? BLOutputLayout.fieldValue(item, `a:${then}`, attributes) : '';
    return { ...item, group: clean(group || item.group, 160), subgroup: clean(then ? subgroup || item.subgroup : item.subgroup, 160) };
  });
  return { ...g, items, catalog: { ...g.catalog, by: `a:${by}`, then: then && then !== by ? `a:${then}` : '' } };
}

/* ---------------- Katalog sayfaları (HTML) ---------------- */
const pageSuffix = page => (page.parts > 1 ? ` (${page.part}/${page.parts})` : '');
/* Katalog sayfalarının başlık metinleri: devam ekini en alttaki dolu başlık alır. */
function pageLabels(title, page) {
  const suffix = pageSuffix(page);
  if (page.subgroup) return { title, group: page.group, subgroup: page.subgroup + suffix };
  if (page.group) return { title, group: page.group + suffix, subgroup: '' };
  return { title: title + suffix, group: '', subgroup: '' };
}

function cardHtml(item, layout, english) {
  const c = BLOutputLayout.cardContent(item, layout);
  const image = item.image ? `<img class="bl-model-img" data-bl-image="${esc(item.image)}" alt="${esc(item.title)}">` : `<span class="bl-noimg">${english ? 'No image' : 'Görsel yok'}</span>`;
  const text = [
    c.title ? `<h3>${esc(c.title)}</h3>` : '',
    ...c.lines.map(line => `<p>${esc(line)}</p>`),
    c.badge ? `<span class="bl-badge ${esc(c.badge.tone)}">${esc(c.badge.text)}</span>` : '',
  ].join('');
  return `<div class="bl-card ${esc(item.tone)}"><div class="bl-card-img">${image}</div>${text ? `<div class="bl-card-body">${text}</div>` : ''}</div>`;
}
/* Başlık bloklarının yazı boyutu: blok kutusuna sığacak şekilde (px). */
const HEAD_DEFAULT = (kind, l) => ({ title: l.titleSize, group: Math.round(l.titleSize * 0.72), subgroup: Math.round(l.titleSize * 0.55), text: l.bodySize }[kind] || 12);
function blockFont(block, text, rect) {
  const size = block.size || null;
  const want = size || block.defaultSize;
  const pad = block.kind === 'group' ? 16 : block.fill ? 20 : 2;
  const fit = BLOutputLayout.fitText(text, Math.max(10, rect.w - pad), Math.max(8, rect.h - 4), want, { min: 7, lineHeight: 1.15, charEm: block.kind === 'text' ? BLOutputLayout.CHAR_EM.body : BLOutputLayout.CHAR_EM.head });
  return fit.size;
}
function blockHtml(block, labels, cards, geometry) {
  const rect = BLOutputLayout.blockRect(geometry.area, geometry.page, block, geometry.gap);
  const style = `grid-column:${block.x + 1} / span ${block.w};grid-row:${block.y + 1} / span ${block.h};${block.align ? `text-align:${block.align};` : ''}`;
  const cls = `bl-cb bl-cb-${block.kind}${block.fill ? ' is-fill' : ''}${block.align ? ` is-${block.align}` : ''}`;
  if (block.kind === 'models') return `<div class="${cls}" data-bl-block="${esc(block.id)}" style="${style}">${cards(rect)}</div>`;
  const text = block.kind === 'text' ? block.text : labels[block.kind];
  if (!text) return '';
  const size = blockFont({ ...block, defaultSize: HEAD_DEFAULT(block.kind, geometry.layout) }, text, rect);
  const tag = { title: 'h2', group: 'h3', subgroup: 'h4' }[block.kind] || 'div';
  return `<div class="${cls}" data-bl-block="${esc(block.id)}" style="${style}font-size:${size}px;"><${tag}>${esc(text)}</${tag}></div>`;
}
/* Bir galerinin katalog sayfaları (HTML). Ölçüler px: sayfa kutusu mm → px.
   Model alanı kart satırları (sabit boy) ve alt grup şeritlerinden oluşan bir
   ızgaradır; satır yükseklikleri px olarak yazılır, toplamı alanı aşmaz. */
function catalogPagesHtml(gallery, layout, { lang = 'tr', fallbackTitle = '', orientation = 'portrait' } = {}) {
  const english = lang === 'en';
  const l = BLOutputLayout.normalizeLayout('pdf', layout);
  const title = gallery.title || fallbackTitle || (english ? 'Models' : 'Modeller');
  const box = BLOutputLayout.pageBox(l, orientation);
  const geometry = { layout: l, page: l.page, gap: l.gap, area: { x: 0, y: 0, w: box.width * MM, h: box.height * MM } };
  const modelsBlock = l.page.blocks.find(block => block.kind === 'models');
  const modelsRect = BLOutputLayout.blockRect(geometry.area, l.page, modelsBlock, l.gap);
  const strip = BLOutputLayout.stripMetrics(modelsRect, l);
  return BLOutputLayout.catalogPages(gallery.items, gallery.catalog, l, { stripUnits: strip.units }).map((page, index) => {
    const labels = pageLabels(title, page);
    let fits = true;
    const cards = rect => {
      // Kart boyu tüm sayfalarda aynı: yerleşim, tasarımdaki model alanı yüksekliğiyle hesaplanır.
      const slots = BLOutputLayout.catalogSlots(page, { x: 0, y: 0, w: rect.w, h: modelsRect.h }, l, strip.height);
      const fit = BLOutputLayout.cardFit(slots.cell, l, page.entries.map(entry => entry.item));
      fits = fit.fits;
      // Şeritler ve kart satırları sırayla; satır yükseklikleri yerleşim hesabından.
      const rowsCss = [];
      const cells = [];
      for (const row of slots.flow) {
        if (row.strip) {
          const st = row.strip;
          const suffix = st.kind === 'subgroup' && st.parts > 1 ? ` (${st.part}/${st.parts})` : '';
          rowsCss.push(`${st.h.toFixed(2)}px`);
          cells.push(`<div class="bl-strip is-${st.kind}" style="grid-column:1 / -1;font-size:${(st.kind === 'group' ? strip.size * 1.1 : strip.size).toFixed(1)}px">${esc((st.text || (english ? 'Other' : 'Diğer')) + suffix)}</div>`);
          continue;
        }
        rowsCss.push(`${row.h.toFixed(2)}px`);
        cells.push(...row.cards.map(card => cardHtml(card.item, l, english)));
        for (let k = row.cards.length; k < l.columns; k++) cells.push('<div class="bl-card-empty"></div>');
      }
      return `<div class="bl-gallery${fit.fits ? '' : ' is-tight'}" style="grid-template-rows:${rowsCss.join(' ')};--bl-card-fs:${fit.size}px;--bl-card-pad:${fit.pad.toFixed(1)}px">${cells.join('')}</div>`;
    };
    const html = `<section class="bl-catalog-page" data-bl-page="${index}">${BLOutputLayout.pageBlocks(l.page, labels).map(block => blockHtml(block, labels, cards, geometry)).join('')}</section>`;
    return { group: page.group, subgroup: page.subgroup, part: page.part, parts: page.parts, sections: page.sections.map(sec => ({ group: sec.group, subgroup: sec.subgroup, count: sec.entries.length })), fits, html };
  });
}
/* Gövdedeki yer tutucuları katalog sayfalarıyla değiştirir. */
function fillCatalogs(body, galleries, layout, options = {}) {
  return String(body || '').replace(/<div class="bl-catalog" data-bl-catalog="(\d{1,3})"><\/div>/g, (all, index) => {
    const gallery = galleries && galleries[Number(index)];
    if (!gallery) return '';
    return `<div class="bl-catalog" data-bl-catalog="${index}">${catalogPagesHtml(gallery, layout, options).map(page => page.html).join('')}</div>`;
  });
}

module.exports = { LIMITS, normalizeGallery, normalizeItem, extractGalleries, reconcile, refineGrouping, catalogPagesHtml, fillCatalogs, pageLabels, cardOf, cleanLabel, headingsBefore };
