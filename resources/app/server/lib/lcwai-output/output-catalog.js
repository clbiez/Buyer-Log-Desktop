'use strict';

/*
 * Model kataloğu (PDF/HTML).
 *
 * LCW AI'ın yazdığı <div class="bl-gallery"> model kartları yapılandırılmış
 * veriye çevrilir (görsel anahtarı, ad, alt bilgi, not, ton) ve gövdede
 * <div class="bl-catalog" data-bl-catalog="N"> yer tutucusu kalır. Kartlar
 * kullanıcının gruplamasına (grup / alt grup) ve sayfa tasarımına (12 sütunlu
 * blok ızgarası) göre Buyer Log tarafından çizilir; PowerPoint'teki katalog
 * slaytlarıyla aynı model (public/lcwai-output-layout.js).
 */
const BLOutputLayout = require('../../../public/lcwai-output-layout');
const { escapeHtml: esc, visibleText } = require('./output-html');

const LIMITS = Object.freeze({ galleries: 20, items: 200, text: 240, title: 140 });
const TONES = ['ok', 'warn', 'risk', 'info'];
const clean = (value, max) => String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, max);
const firstText = (html, re) => { const match = re.exec(html); return match ? clean(visibleText(match[1]), LIMITS.text) : ''; };

function normalizeItem(raw) {
  const item = raw && typeof raw === 'object' ? raw : {};
  const image = clean(item.image, 12).toUpperCase();
  return {
    title: clean(item.title, 120), subtitle: clean(item.subtitle, LIMITS.text), note: clean(item.note, LIMITS.text),
    image: /^[A-Z]{2,4}-\d{1,6}$/.test(image) ? image : '', tone: TONES.includes(item.tone) ? item.tone : 'info',
    group: clean(item.group, 120), subgroup: clean(item.subgroup, 120),
  };
}
function normalizeGallery(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  return {
    title: clean(source.title, LIMITS.title),
    items: (Array.isArray(source.items) ? source.items : []).slice(0, LIMITS.items).map(normalizeItem).filter(item => item.title || item.image),
    catalog: BLOutputLayout.normalizeCatalog(source.catalog),
  };
}

/* Kart HTML'i → kart verisi. */
function cardOf(html) {
  const image = /data-bl-image="([^"]+)"/.exec(html);
  const tone = /class="[^"]*\bbl-card\b[^"]*\b(ok|warn|risk|info)\b/.exec(html);
  return normalizeItem({
    image: image ? image[1] : '',
    title: firstText(html, /<h[3-5]\b[^>]*>([\s\S]*?)<\/h[3-5]>/i) || firstText(html, /<(?:b|strong)\b[^>]*>([\s\S]*?)<\/(?:b|strong)>/i) || firstText(html, /\balt="([^"]*)"/i),
    subtitle: firstText(html, /<small\b[^>]*>([\s\S]*?)<\/small>/i),
    note: firstText(html, /<p\b[^>]*>([\s\S]*?)<\/p>/i),
    tone: tone ? tone[1] : 'info',
  });
}

/* Gövdedeki galerileri katalog verisine çevirir. Galerinin hemen önündeki
   <h2> katalog başlığı olur (katalog sayfası başlığı bloğunda çizilir). */
function extractGalleries(body, existing = []) {
  let source = String(body || '');
  const galleries = existing.slice(0, LIMITS.galleries);
  const found = BLOutputLayout.findGalleries(source);
  for (let i = found.length - 1; i >= 0; i--) {
    if (galleries.length >= LIMITS.galleries) break;
    const gallery = found[i];
    const items = gallery.children.map(cardOf).filter(item => item.title || item.image);
    if (!items.length) continue;
    let start = gallery.start;
    let title = '';
    const before = source.slice(0, start);
    // Yalnız galeriden hemen önceki <h2> (aradaki içerik başlığa katılmaz).
    const heading = /<h2\b[^>]*>((?:(?!<h2\b)[\s\S])*?)<\/h2>\s*$/i.exec(before);
    if (heading) { title = clean(visibleText(heading[1]), LIMITS.title); start = heading.index; }
    galleries.push({ title, items, catalog: BLOutputLayout.normalizeCatalog(null) });
    source = `${source.slice(0, start)}<div class="bl-catalog" data-bl-catalog="${galleries.length - 1}"></div>${source.slice(gallery.end)}`;
  }
  return { body: source, galleries };
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
    return `<div class="bl-catalog" data-bl-catalog="${used.get(n)}"></div>`;
  });
  const next = [];
  for (const [old, now] of used) next[now] = list[old];
  return { body: out, galleries: next };
}

const pageSuffix = page => (page.parts > 1 ? ` (${page.part}/${page.parts})` : '');
/* Katalog sayfalarının başlık metinleri: devam ekini en alttaki dolu başlık alır. */
function pageLabels(title, page) {
  const suffix = pageSuffix(page);
  if (page.subgroup) return { title, group: page.group, subgroup: page.subgroup + suffix };
  if (page.group) return { title, group: page.group + suffix, subgroup: '' };
  return { title: title + suffix, group: '', subgroup: '' };
}

function cardHtml(item, english) {
  const image = item.image ? `<img class="bl-model-img" data-bl-image="${esc(item.image)}" alt="${esc(item.title)}">` : `<span class="bl-noimg">${english ? 'No image' : 'Görsel yok'}</span>`;
  return `<div class="bl-card ${esc(item.tone)}">${image}${item.title ? `<h3>${esc(item.title)}</h3>` : ''}${item.subtitle ? `<small>${esc(item.subtitle)}</small>` : ''}${item.note ? `<p>${esc(item.note)}</p>` : ''}</div>`;
}
function blockHtml(block, labels, cards) {
  const style = `grid-column:${block.x + 1} / span ${block.w};grid-row:${block.y + 1} / span ${block.h};${block.size ? `font-size:${block.size}px;` : ''}${block.align ? `text-align:${block.align};align-items:${block.align === 'right' ? 'flex-end' : 'center'};` : ''}`;
  const cls = `bl-cb bl-cb-${block.kind}${block.fill ? ' is-fill' : ''}`;
  if (block.kind === 'models') return `<div class="${cls}" data-bl-block="${esc(block.id)}" style="${style}"><div class="bl-gallery">${cards}</div></div>`;
  const text = block.kind === 'text' ? block.text : labels[block.kind];
  if (!text) return '';
  const tag = { title: 'h2', group: 'h3', subgroup: 'h4' }[block.kind] || 'div';
  return `<div class="${cls}" data-bl-block="${esc(block.id)}" style="${style}"><${tag}>${esc(text)}</${tag}></div>`;
}
/* Bir galerinin katalog sayfaları (HTML). */
function catalogPagesHtml(gallery, layout, { lang = 'tr', fallbackTitle = '' } = {}) {
  const english = lang === 'en';
  const l = BLOutputLayout.normalizeLayout('pdf', layout);
  const title = gallery.title || fallbackTitle || (english ? 'Models' : 'Modeller');
  return BLOutputLayout.catalogPages(gallery.items, gallery.catalog, l).map((page, index) => {
    const labels = pageLabels(title, page);
    const cards = page.entries.map(entry => cardHtml(entry.item, english)).join('');
    return { group: page.group, subgroup: page.subgroup, part: page.part, parts: page.parts, html: `<section class="bl-catalog-page" data-bl-page="${index}">${l.page.blocks.map(block => blockHtml(block, labels, cards)).join('')}</section>` };
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

module.exports = { LIMITS, normalizeGallery, normalizeItem, extractGalleries, reconcile, catalogPagesHtml, fillCatalogs, pageLabels, cardOf };
