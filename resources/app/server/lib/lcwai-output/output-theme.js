'use strict';

/*
 * Buyer Log Output Theme — AI çıktılarının (HTML/PDF/XLSX/PPTX) ortak görsel dili.
 *
 * Renkler elle kopyalanmaz: Buyer Log'un gerçek tasarım anahtarları
 * public/design.css içindeki AÇIK tema :root değerlerinden okunur (ilk
 * geçen #hex değeri). Dosya okunamazsa aynı değerlerin güvenli kopyası
 * kullanılır. Yazı tipi Barlow'dur; HTML/PDF çıktısına data: URI olarak
 * gömülür (uzak kaynak yüklenmez), Office dosyalarında kurumsal
 * makinelerde bulunan Segoe UI / Calibri kullanılır.
 */
const fs = require('fs');
const path = require('path');

const PUBLIC_ROOT = path.join(__dirname, '..', '..', '..', 'public');
const DESIGN_CSS = path.join(PUBLIC_ROOT, 'design.css');
const FONT_ROOT = path.join(PUBLIC_ROOT, 'vendor', 'fonts');

const FALLBACK = Object.freeze({
  paper: '#f2f2f3', card: '#f8f8f9', card2: '#f5f5f8', ink: '#1d1f20', ink2: '#5d5d60', muted: '#7a7a7d',
  line: '#d4d4d7', line2: '#b7b7ba', acc: '#3f6488', 'acc-bg': '#e6edf4', 'acc-lite': '#7fa3c6', 'acc-ink': '#2c455d',
  'navy-deep': '#1d2d3d', red: '#B42318', 'red-bg': '#f5e4e3', orange: '#946200', 'orange-bg': '#f4ebd5',
  green: '#177A4C', 'green-bg': '#e4efe9',
});
const KEYS = Object.keys(FALLBACK);

/* design.css → ilk #hex değerleri. Koyu tema blokları dosyada daha sonra
   geldiği için ilk geçen değer açık temanın değeridir. */
function readDesignTokens(cssText) {
  const tokens = {};
  const re = /--([a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{3,8})\b/g;
  let match;
  while ((match = re.exec(String(cssText || '')))) {
    if (KEYS.includes(match[1]) && !tokens[match[1]]) tokens[match[1]] = match[2];
  }
  return tokens;
}

let cached = null;
function theme() {
  if (cached) return cached;
  let found = {};
  try { found = readDesignTokens(fs.readFileSync(DESIGN_CSS, 'utf8')); } catch (_) { found = {}; }
  const colors = {};
  for (const key of KEYS) colors[key] = normalizeHex(found[key] || FALLBACK[key]);
  cached = Object.freeze({
    colors: Object.freeze(colors),
    source: Object.keys(found).length ? 'design.css' : 'fallback',
    fonts: Object.freeze({ html: '"Barlow","Segoe UI",Arial,sans-serif', htmlHead: '"Barlow Condensed","Barlow","Segoe UI",Arial,sans-serif', office: 'Segoe UI', excel: 'Calibri' }),
    // Durum tonları (badge/KPI): Buyer Log'un ok / uyarı / risk anlamları.
    tones: Object.freeze({ ok: colors.green, warn: colors.orange, risk: colors.red, info: colors.acc, neutral: colors.ink2 }),
  });
  return cached;
}

function normalizeHex(value) {
  let hex = String(value || '').replace('#', '').trim();
  if (hex.length === 3) hex = hex.split('').map(ch => ch + ch).join('');
  return `#${hex.slice(0, 6).toUpperCase()}`;
}
/* OOXML srgbClr değeri: '#3F6488' → '3F6488'. */
const ooxml = value => normalizeHex(value).slice(1);

/* Barlow (400/700) + Barlow Condensed 600; latin + latin-ext (Türkçe ğ/ş/İ). */
let fontCss = null;
function embeddedFontCss() {
  if (fontCss != null) return fontCss;
  const faces = [
    ['Barlow', 400, 'barlow-400'], ['Barlow', 700, 'barlow-700'], ['Barlow Condensed', 600, 'barlow-condensed-600'],
  ];
  const parts = [];
  for (const [family, weight, base] of faces) {
    for (const subset of ['latin', 'latin-ext']) {
      try {
        const data = fs.readFileSync(path.join(FONT_ROOT, `${base}-${subset}.woff2`)).toString('base64');
        parts.push(`@font-face{font-family:"${family}";font-style:normal;font-weight:${weight};src:url(data:font/woff2;base64,${data}) format("woff2");}`);
      } catch (_) { /* yazı tipi yoksa sistem yedeği kullanılır */ }
    }
  }
  fontCss = parts.join('\n');
  return fontCss;
}

/* HTML/PDF raporlarının ortak CSS'i. AI'a yalnız bu sınıfları kullanması
   söylenir (bkz. output-contracts); böylece her rapor Buyer Log görünür. */
function reportCss({ orientation = 'portrait', print = false } = {}) {
  const c = theme().colors;
  const f = theme().fonts;
  return `${embeddedFontCss()}
:root{--paper:${c.paper};--card:${c.card};--card2:${c.card2};--ink:${c.ink};--ink2:${c.ink2};--muted:${c.muted};--line:${c.line};--line2:${c.line2};--acc:${c.acc};--acc-bg:${c['acc-bg']};--acc-ink:${c['acc-ink']};--navy-deep:${c['navy-deep']};--red:${c.red};--red-bg:${c['red-bg']};--orange:${c.orange};--orange-bg:${c['orange-bg']};--green:${c.green};--green-bg:${c['green-bg']};}
@page{size:A4 ${orientation === 'landscape' ? 'landscape' : 'portrait'};margin:14mm 12mm 16mm;}
*{box-sizing:border-box;}
html{-webkit-print-color-adjust:exact;print-color-adjust:exact;}
body{margin:0;background:${print ? '#ffffff' : 'var(--paper)'};color:var(--ink);font:14px/1.5 ${f.html};}
.bl-page{max-width:${print ? 'none' : (orientation === 'landscape' ? '1280px' : '960px')};margin:0 auto;padding:${print ? '0' : '32px 28px 48px'};}
.bl-report{background:${print ? 'transparent' : 'var(--card)'};${print ? '' : 'border:1px solid var(--line);padding:32px 36px;'}}
.bl-header{display:flex;justify-content:space-between;align-items:flex-end;gap:16px;border-bottom:3px solid var(--acc);padding-bottom:12px;margin-bottom:20px;}
.bl-brand{font:600 12px/1.2 ${f.htmlHead};letter-spacing:.08em;text-transform:uppercase;color:var(--acc);}
.bl-meta{color:var(--muted);font-size:12px;text-align:right;}
h1,h2,h3,h4{font-family:${f.htmlHead};font-weight:600;color:var(--acc-ink);line-height:1.2;margin:0 0 .5em;}
h1{font-size:28px;color:var(--ink);}h2{font-size:20px;margin-top:1.4em;border-bottom:1px solid var(--line);padding-bottom:4px;}h3{font-size:16px;margin-top:1.1em;}
p{margin:0 0 .8em;}ul,ol{margin:0 0 .9em;padding-left:1.3em;}li{margin:.15em 0;}
a{color:var(--acc-ink);}
.bl-lead{font-size:15px;color:var(--ink2);}
.bl-section{margin:0 0 20px;break-inside:auto;}
.bl-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin:12px 0 20px;}
.bl-kpi{background:var(--card2);border:1px solid var(--line);border-top:3px solid var(--acc);padding:10px 12px;break-inside:avoid;}
.bl-kpi.ok{border-top-color:var(--green);}.bl-kpi.warn{border-top-color:var(--orange);}.bl-kpi.risk{border-top-color:var(--red);}
.bl-kpi-label{display:block;font-size:11px;letter-spacing:.04em;text-transform:uppercase;color:var(--muted);}
.bl-kpi-value{display:block;font:600 26px/1.15 ${f.htmlHead};color:var(--ink);margin-top:2px;}
.bl-kpi-note{display:block;font-size:12px;color:var(--ink2);margin-top:2px;}
.bl-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px;}
.bl-card{background:var(--card2);border:1px solid var(--line);padding:12px 14px;break-inside:avoid;}
.bl-card h3{margin-top:0;}
.bl-callout{border-left:4px solid var(--acc);background:var(--acc-bg);padding:10px 14px;margin:12px 0;break-inside:avoid;}
.bl-callout.ok{border-left-color:var(--green);background:var(--green-bg);}.bl-callout.warn{border-left-color:var(--orange);background:var(--orange-bg);}.bl-callout.risk{border-left-color:var(--red);background:var(--red-bg);}
.bl-table-wrap{overflow-x:auto;margin:8px 0 16px;}
table{border-collapse:collapse;width:100%;font-size:12.5px;}
thead{display:table-header-group;}tr{break-inside:avoid;}
th{background:var(--acc);color:#fff;text-align:left;font-weight:600;padding:7px 8px;border:1px solid var(--acc);}
td{padding:6px 8px;border:1px solid var(--line);vertical-align:top;}
tbody tr:nth-child(even) td{background:var(--card2);}
td.num,th.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap;}
.bl-badge{display:inline-block;padding:1px 7px;font-size:11px;font-weight:600;border:1px solid var(--line2);background:var(--card2);color:var(--ink2);white-space:nowrap;}
.bl-badge.ok{background:var(--green-bg);color:var(--green);border-color:var(--green);}.bl-badge.warn{background:var(--orange-bg);color:var(--orange);border-color:var(--orange);}.bl-badge.risk{background:var(--red-bg);color:var(--red);border-color:var(--red);}.bl-badge.info{background:var(--acc-bg);color:var(--acc-ink);border-color:var(--acc);}
.bl-bars{margin:8px 0 16px;}.bl-bar{display:grid;grid-template-columns:minmax(90px,28%) 1fr auto;gap:8px;align-items:center;margin:4px 0;font-size:12.5px;}
.bl-bar-track{background:var(--card2);border:1px solid var(--line);height:14px;}.bl-bar-fill{display:block;height:100%;background:var(--acc);}
.bl-bar.ok .bl-bar-fill{background:var(--green);}.bl-bar.warn .bl-bar-fill{background:var(--orange);}.bl-bar.risk .bl-bar-fill{background:var(--red);}
.bl-muted{color:var(--muted);}.bl-small{font-size:12px;}
.bl-footer{margin-top:28px;padding-top:8px;border-top:1px solid var(--line);color:var(--muted);font-size:11px;display:flex;justify-content:space-between;gap:12px;}
svg{max-width:100%;height:auto;}
@media print{.bl-page{padding:0;}.bl-report{border:0;padding:0;background:transparent;}h2,h3{break-after:avoid;}}`;
}

module.exports = { theme, reportCss, embeddedFontCss, readDesignTokens, normalizeHex, ooxml, FALLBACK };
