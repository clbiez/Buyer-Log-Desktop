'use strict';

/*
 * AI HTML çıktısı: ayrıştırma + güvenli temizleme + Buyer Log belgesi.
 *
 * LCW AI HTML'i üç biçimde döndürebilir: doğrudan belge, ```html``` kod
 * bloğu ya da "açıklama + kod bloğu". extractHtml() üçünü de tanır.
 *
 * GÜVENLİK (derinlemesine savunma):
 *  1. sanitizeHtml() İZİN LİSTESİ ile yeniden yazar: bilinmeyen etiket
 *     düşer (içeriği kalır), tehlikeli kapsayıcılar (script, iframe, object,
 *     embed, form alanları, foreignObject…) içerikleriyle düşer; olay
 *     öznitelikleri (on*), javascript:/data: bağlantıları, uzak görseller,
 *     url()/@import/expression içeren stiller atılır.
 *  2. buildDocument() her belgeye katı CSP koyar: default-src 'none' — betik,
 *     ağ isteği, iframe, form gönderimi tarayıcıda da çalışmaz.
 *  3. PDF, javascript kapalı ve ağı engellenmiş gizli bir pencerede basılır
 *     (electron/main.js → buyerlog:render-pdf).
 *  AI HTML'i HİÇBİR ZAMAN Buyer Log ana DOM'una eklenmez.
 */
const { reportCss } = require('./output-theme');

const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

/* ---------------- Ayrıştırma ---------------- */
function extractHtml(text) {
  const source = String(text == null ? '' : text).replace(/\r\n?/g, '\n');
  const fence = /```[ \t]*(html|htm|xhtml)?[ \t]*\n([\s\S]*?)(?:\n```|$)/gi;
  let best = null;
  let match;
  while ((match = fence.exec(source))) {
    const body = match[2];
    const labelled = Boolean(match[1]);
    if (!labelled && !/<\s*(!doctype|html|body|div|section|table|h1|h2|main|article)\b/i.test(body)) continue;
    if (!best || body.length > best.body.length) best = { body, start: match.index, end: match.index + match[0].length };
  }
  if (best) {
    const explanation = (source.slice(0, best.start) + source.slice(best.end)).trim();
    return { ok: true, html: best.body.trim(), explanation, mode: explanation ? 'explained-fence' : 'fence' };
  }
  const start = source.search(/<\s*(!doctype\s+html|html)\b/i);
  if (start >= 0) {
    const endMatch = /<\/html\s*>/i.exec(source.slice(start));
    const end = endMatch ? start + endMatch.index + endMatch[0].length : source.length;
    const explanation = (source.slice(0, start) + source.slice(end)).trim();
    return { ok: true, html: source.slice(start, end).trim(), explanation, mode: 'direct' };
  }
  const fragment = source.search(/<\s*(body|main|article|section|div|h1|table)\b/i);
  if (fragment >= 0 && /<\/\s*(body|main|article|section|div|h1|table)\s*>/i.test(source)) {
    return { ok: true, html: source.slice(fragment).trim(), explanation: source.slice(0, fragment).trim(), mode: 'fragment' };
  }
  return { ok: false, html: '', explanation: source.trim(), mode: 'none' };
}

/* ---------------- Temizleme ---------------- */
const ALLOWED_TAGS = new Set([
  'div', 'span', 'p', 'br', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'strong', 'b', 'em', 'i', 'u', 's', 'small', 'sub', 'sup', 'mark', 'del', 'ins',
  'ul', 'ol', 'li', 'dl', 'dt', 'dd', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'colgroup', 'col',
  'section', 'article', 'header', 'footer', 'main', 'aside', 'nav', 'figure', 'figcaption', 'blockquote', 'pre', 'code', 'abbr', 'time',
  'a', 'img', 'details', 'summary',
  'svg', 'g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'text', 'tspan', 'defs', 'lineargradient', 'stop', 'title', 'desc',
]);
const VOID_TAGS = new Set(['br', 'hr', 'img', 'col']);
// Kapanışı olmayan (void) tehlikeli etiketler: içerik beklenmeden düşer.
const DROP_VOID = new Set(['embed', 'frame', 'param', 'source', 'track', 'keygen', 'input', 'meta', 'link', 'base', 'basefont', 'bgsound', 'isindex']);
// İçerikleriyle birlikte düşen kapsayıcılar.
const DROP_WITH_CONTENT = new Set(['script', 'style', 'iframe', 'frameset', 'object', 'applet', 'noscript', 'template', 'foreignobject', 'textarea', 'select', 'option', 'button', 'head', 'math', 'video', 'audio', 'canvas', 'portal', 'xml', 'noembed', 'noframes']);
const ALLOWED_ATTRS = new Set([
  'class', 'id', 'style', 'title', 'alt', 'colspan', 'rowspan', 'scope', 'align', 'valign', 'width', 'height', 'href', 'src', 'lang', 'dir', 'datetime', 'open', 'start', 'reversed', 'type',
  'viewbox', 'xmlns', 'preserveaspectratio', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'd', 'points', 'fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-linecap', 'stroke-linejoin', 'opacity',
  'transform', 'text-anchor', 'dominant-baseline', 'font-size', 'font-weight', 'font-family', 'offset', 'stop-color', 'stop-opacity', 'gradientunits', 'dx', 'dy',
]);
// SVG büyük/küçük harf duyarlıdır; HTML ayrıştırıcısı düzeltse de dosya
// (ve XML okuyucular) için doğru yazım korunur.
const CASED = { viewbox: 'viewBox', preserveaspectratio: 'preserveAspectRatio', gradientunits: 'gradientUnits', lineargradient: 'linearGradient' };
const SAFE_IMAGE = /^data:image\/(png|jpe?g|gif|webp);base64,[a-z0-9+/=\s]+$/i;

function safeUrl(value, tag) {
  const url = String(value || '').replace(/[\u0000- ]+/g, '').trim();
  if (tag === 'img') return SAFE_IMAGE.test(url) ? url : null;
  if (/^#[\w-]*$/.test(url)) return url;
  if (/^https?:\/\/[^\s"'<>]+$/i.test(url)) return url;
  if (/^mailto:[^\s"'<>]+$/i.test(url)) return url;
  return null;
}

// CSS kaçışı (\75rl( → url() denetimi atlatabildiği için ters bölü içeren
// stil hiç kabul edilmez; uzak kaynak çağırabilen tüm işlevler engellenir.
const CSS_BLOCK = /\\|url\s*\(|image-set\s*\(|\bsrc\s*\(|@import|@namespace|expression\s*\(|behavio(u)?r\s*:|-moz-binding|javascript:|vbscript:|<\/?\s*style/i;
function safeCss(value) {
  const css = String(value || '');
  if (CSS_BLOCK.test(css.replace(/\/\*[\s\S]*?\*\//g, ''))) return null;
  return css.replace(/[<>]/g, '');
}

/* <style> bloklarındaki CSS: uzak/url kaynağı, @import, @font-face dışarıda. */
function sanitizeStyleSheet(cssText) {
  let css = String(cssText || '').replace(/\/\*[\s\S]*?\*\//g, '');
  // Kaçış içeren bildirim/kural düşer (\75rl(…), @\69mport…).
  css = css.replace(/[^{};]*\\[^{};]*;?/g, '');
  css = css.replace(/(-webkit-)?image-set\s*\([^)]*\)/gi, 'none').replace(/\bsrc\s*\([^)]*\)/gi, 'none').replace(/@namespace[^;]*;?/gi, '');
  css = css.replace(/@import[^;]*;?/gi, '').replace(/@font-face\s*\{[^}]*\}/gi, '');
  css = css.replace(/url\s*\([^)]*\)/gi, 'none').replace(/expression\s*\(/gi, '(').replace(/behavio(u)?r\s*:/gi, 'x:').replace(/-moz-binding/gi, 'x').replace(/javascript:|vbscript:/gi, '');
  return css.replace(/<\/?\s*style/gi, '').replace(/[<>]/g, '').trim();
}

const ATTR_RE = /([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
function sanitizeAttributes(tag, raw) {
  const out = [];
  let match;
  ATTR_RE.lastIndex = 0;
  while ((match = ATTR_RE.exec(raw || ''))) {
    const name = match[1].toLowerCase();
    const value = match[2] != null ? match[2] : match[3] != null ? match[3] : match[4] != null ? match[4].replace(/\/$/, '') : '';
    // Model görseli yer tutucusu: yalnız <img> üzerinde, yalnız anahtar biçimi.
    if (name === 'data-bl-image') {
      if (tag === 'img' && /^[A-Za-z]{2,4}-\d{1,6}$/.test(value)) out.push(` data-bl-image="${value.toUpperCase()}"`);
      continue;
    }
    if (/^on/.test(name) || !ALLOWED_ATTRS.has(name)) continue;
    const decoded = value.replace(/&#x([0-9a-f]+);?/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16))).replace(/&#(\d+);?/g, (_, dec) => String.fromCharCode(Number(dec))).replace(/&colon;/gi, ':').replace(/&tab;|&newline;/gi, '');
    let safe = decoded;
    if (name === 'href' || name === 'src') { safe = safeUrl(decoded, tag); if (safe == null) continue; }
    else if (name === 'style') { safe = safeCss(decoded); if (safe == null) continue; }
    else if (/javascript:|vbscript:|data:/i.test(decoded.replace(/\s+/g, ''))) continue;
    out.push(` ${CASED[name] || name}="${esc(safe)}"`);
    if (tag === 'a' && name === 'href' && /^https?:/i.test(safe)) out.push(' target="_blank" rel="noopener noreferrer"');
  }
  return out.join('');
}

const TOKEN_RE = /<!--[\s\S]*?(?:-->|$)|<!\[CDATA\[[\s\S]*?(?:\]\]>|$)|<![^>]*>|<\?[^>]*>|<\/\s*([a-zA-Z][\w:-]*)\s*>|<([a-zA-Z][\w:-]*)((?:\s+[^\s=>\/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>/g;

/* Döner: { body, styles, title, removed } — body temiz HTML parçasıdır. */
function sanitizeHtml(html) {
  const source = String(html == null ? '' : html);
  const styles = [];
  let title = '';
  let removed = 0;
  const out = [];
  const stack = [];
  let dropDepth = 0;
  let dropTag = '';
  let dropStart = 0;
  let last = 0;
  let match;
  const pushText = text => {
    if (!text || dropDepth) return;
    out.push(text.replace(/</g, '&lt;').replace(/>/g, '&gt;'));
  };
  TOKEN_RE.lastIndex = 0;
  while ((match = TOKEN_RE.exec(source))) {
    const text = source.slice(last, match.index);
    last = TOKEN_RE.lastIndex;
    const closing = match[1] && match[1].toLowerCase();
    const opening = match[2] && match[2].toLowerCase();
    if (dropDepth) {
      // Düşürülen kapsayıcının içinde: yalnız kendi kapanışı aranır; <style>
      // içeriği temizlenip ayrıca toplanır.
      if (closing === dropTag) {
        dropDepth--;
        if (!dropDepth) {
          const inner = source.slice(dropStart, match.index);
          if (dropTag === 'style') styles.push(sanitizeStyleSheet(inner));
          dropTag = '';
        }
      } else if (opening === dropTag && !match[4]) dropDepth++;
      continue;
    }
    pushText(text);
    if (!closing && !opening) { if (!/^<!--|^<!\[CDATA|^<!doctype/i.test(match[0])) removed++; continue; }
    if (opening) {
      if (opening === 'title' && !stack.includes('svg')) {
        const end = source.toLowerCase().indexOf('</title', last);
        title = source.slice(last, end < 0 ? source.length : end).replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().slice(0, 160);
        const close = end < 0 ? -1 : source.indexOf('>', end);
        last = close < 0 ? source.length : close + 1;
        TOKEN_RE.lastIndex = last;
        continue;
      }
      if (DROP_VOID.has(opening)) { removed++; continue; }
      if (DROP_WITH_CONTENT.has(opening)) {
        // <head> kendisi düşer ama içi tek tek işlenir: style/title toplanır,
        // meta/link/base atılır.
        if (opening === 'head') continue;
        if (opening !== 'style') removed++;
        if (!match[4] && !VOID_TAGS.has(opening)) { dropDepth = 1; dropTag = opening; dropStart = last; }
        continue;
      }
      // İzin listesinde olmayan etiket düşer, içeriği (metin) kalır. Yapısal
      // sarmalayıcılar (html/body/form/font…) kaldırma sayılmaz.
      if (!ALLOWED_TAGS.has(opening)) { if (!/^(html|body|form|label|font|center|fieldset|legend)$/.test(opening)) removed++; continue; }
      const attrs = sanitizeAttributes(opening, match[3]);
      if (opening === 'img' && !/\ssrc="|\sdata-bl-image="/.test(attrs)) { removed++; continue; }
      const name = CASED[opening] || opening;
      if (VOID_TAGS.has(opening)) { out.push(`<${name}${attrs}>`); continue; }
      if (match[4]) { out.push(`<${name}${attrs}></${name}>`); continue; }
      out.push(`<${name}${attrs}>`);
      stack.push(opening);
      continue;
    }
    if (closing) {
      if (!ALLOWED_TAGS.has(closing) || VOID_TAGS.has(closing)) continue;
      const index = stack.lastIndexOf(closing);
      if (index < 0) continue;
      while (stack.length > index) { const tag = stack.pop(); out.push(`</${CASED[tag] || tag}>`); }
    }
  }
  if (!dropDepth) pushText(source.slice(last));
  while (stack.length) { const tag = stack.pop(); out.push(`</${CASED[tag] || tag}>`); }
  return { body: out.join('').trim(), styles, title, removed };
}

/* Görünür metin (doğrulama için): etiketler ve boşluklar atılır. */
function visibleText(html) {
  return String(html || '').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]*>/g, ' ').replace(/&nbsp;|&#160;/g, ' ').replace(/&[a-z#0-9]+;/gi, 'x').replace(/\s+/g, ' ').trim();
}

const CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; base-uri 'none'; form-action 'none'; frame-src 'none'; object-src 'none'; script-src 'none'";

/* Temiz gövdeyi Buyer Log raporu belgesine sarar. */
function buildDocument({ body, styles = [], title = '', lang = 'tr', orientation = 'portrait', print = false, meta = {} } = {}) {
  const english = lang === 'en';
  const date = meta.date || new Date().toISOString().slice(0, 10);
  const brand = english ? 'Buyer Log · LCW AI Report' : 'Buyer Log · LCW AI Raporu';
  const hasHeader = /class="[^"]*\bbl-header\b/.test(body);
  const header = hasHeader ? '' : `<div class="bl-header"><div class="bl-brand">${esc(brand)}${title ? `<small>${esc(title)}</small>` : ''}</div><div class="bl-meta">${esc(date)}${meta.template ? `<br>${esc(meta.template)}` : ''}</div></div>`;
  const footer = print ? '' : `<div class="bl-footer"><span>${esc(english ? 'Generated with LCW AI in Buyer Log. Verify figures against Buyer Log data.' : 'Buyer Log içinde LCW AI ile oluşturuldu. Rakamları Buyer Log verisiyle doğrulayın.')}</span><span>${esc(date)}</span></div>`;
  return `<!DOCTYPE html>
<html lang="${english ? 'en' : 'tr'}">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${CSP}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="Buyer Log · LCW AI">
<title>${esc(title || brand)}</title>
<style>${reportCss({ orientation, print })}</style>
${styles.filter(Boolean).map(css => `<style>${css}</style>`).join('\n')}
</head>
<body>
<div class="bl-page"><div class="bl-report">
${header}
${body}
${footer}
</div></div>
</body>
</html>
`;
}

module.exports = { extractHtml, sanitizeHtml, sanitizeStyleSheet, buildDocument, visibleText, safeUrl, safeCss, CSP, escapeHtml: esc };
