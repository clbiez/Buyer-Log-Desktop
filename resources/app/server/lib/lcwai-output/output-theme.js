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
// Tablo başlığı anahtarları (--thead-*) app.css'te tanımlıdır.
const APP_CSS = path.join(PUBLIC_ROOT, 'app.css');
const FONT_ROOT = path.join(PUBLIC_ROOT, 'vendor', 'fonts');

const FALLBACK = Object.freeze({
  paper: '#f2f2f3', card: '#f8f8f9', card2: '#f5f5f8', ink: '#1d1f20', ink2: '#5d5d60', muted: '#7a7a7d',
  line: '#d4d4d7', line2: '#b7b7ba', acc: '#3f6488', 'acc-bg': '#e6edf4', 'acc-lite': '#7fa3c6', 'acc-ink': '#2c455d',
  'navy-deep': '#1d2d3d', red: '#B42318', 'red-bg': '#f5e4e3', orange: '#946200', 'orange-bg': '#f4ebd5',
  green: '#177A4C', 'green-bg': '#e4efe9',
  // Başlıklar: Buyer Log tablo başlığı grisi (app.css --thead-*).
  'thead-bg': '#F2F4F7', 'thead-ink': '#54595F', 'thead-line': '#D0D5DD',
  // Başlık metni: BL logosunun siyahı (icons/icon-mark.png). CSS anahtarı
  // olmadığı için sabittir; test logodaki değerle eşitliği denetler.
  logo: '#262626',
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
  try { const app = readDesignTokens(fs.readFileSync(APP_CSS, 'utf8')); for (const key of Object.keys(app)) if (!found[key]) found[key] = app[key]; } catch (_) {}
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
   söylenir (bkz. output-contracts); böylece her rapor Buyer Log görünür.
   Ekranda (HTML) hareketli: renk geçişli başlık bandı, bölümlerin kademeli
   belirmesi, KPI kartlarının yükselmesi, bar ve halka göstergelerin dolması,
   üzerine gelince canlanan kart/satırlar. Hepsi yalnız CSS'tir (betik yok,
   CSP ile uyumlu); "hareketi azalt" tercihinde ve baskıda (PDF) kapanır,
   öğeler son hâlleriyle görünür. */
function reportCss({ orientation = 'portrait', print = false } = {}) {
  const c = theme().colors;
  const f = theme().fonts;
  const motion = print ? '' : `
@media screen and (prefers-reduced-motion:no-preference){
.bl-header{background-size:220% 220%;animation:bl-shift 14s ease-in-out infinite alternate,bl-rise .7s cubic-bezier(.2,.7,.2,1) both;}
.bl-report>*:not(.bl-header){animation:bl-rise .6s cubic-bezier(.2,.7,.2,1) both;}
.bl-report>*:nth-child(2){animation-delay:.08s}.bl-report>*:nth-child(3){animation-delay:.16s}.bl-report>*:nth-child(4){animation-delay:.24s}.bl-report>*:nth-child(5){animation-delay:.32s}.bl-report>*:nth-child(6){animation-delay:.40s}.bl-report>*:nth-child(7){animation-delay:.48s}.bl-report>*:nth-child(n+8){animation-delay:.56s}
.bl-kpi{animation:bl-pop .55s cubic-bezier(.2,.8,.2,1.2) both;}
.bl-kpi:nth-child(2){animation-delay:.1s}.bl-kpi:nth-child(3){animation-delay:.2s}.bl-kpi:nth-child(4){animation-delay:.3s}.bl-kpi:nth-child(5){animation-delay:.4s}.bl-kpi:nth-child(n+6){animation-delay:.5s}
.bl-kpi-value{animation:bl-count 1.1s steps(12,end) both .25s;}
.bl-bar-fill{transform-origin:left center;animation:bl-grow 1.1s cubic-bezier(.2,.7,.2,1) both .35s;}
.bl-bar:nth-child(2) .bl-bar-fill{animation-delay:.45s}.bl-bar:nth-child(3) .bl-bar-fill{animation-delay:.55s}.bl-bar:nth-child(4) .bl-bar-fill{animation-delay:.65s}.bl-bar:nth-child(n+5) .bl-bar-fill{animation-delay:.75s}
.bl-ring{animation:bl-ring 1.4s cubic-bezier(.2,.7,.2,1) both .3s;}
.bl-callout{animation:bl-slide .6s cubic-bezier(.2,.7,.2,1) both .4s;}
.bl-progress-fill{transform-origin:left center;animation:bl-grow 1.2s cubic-bezier(.2,.7,.2,1) both .3s;}
tbody tr{animation:bl-fade .5s ease both;}tbody tr:nth-child(n+2){animation-delay:.05s}tbody tr:nth-child(n+4){animation-delay:.1s}tbody tr:nth-child(n+8){animation-delay:.15s}
.bl-badge.risk{animation:bl-pulse 2.4s ease-in-out infinite 1.2s;}
.bl-timeline li::before{animation:bl-pop .5s cubic-bezier(.2,.8,.2,1.2) both .4s;}
}
@property --bl-p{syntax:'<number>';inherits:true;initial-value:0;}
@keyframes bl-rise{from{opacity:0;transform:translateY(14px);}to{opacity:1;transform:none;}}
@keyframes bl-pop{from{opacity:0;transform:translateY(10px) scale(.96);}to{opacity:1;transform:none;}}
@keyframes bl-fade{from{opacity:0;}to{opacity:1;}}
@keyframes bl-slide{from{opacity:0;transform:translateX(-14px);}to{opacity:1;transform:none;}}
@keyframes bl-grow{from{transform:scaleX(0);}to{transform:scaleX(1);}}
@keyframes bl-count{from{opacity:.15;filter:blur(3px);}to{opacity:1;filter:none;}}
@keyframes bl-ring{from{--bl-p:0;}}
@keyframes bl-shift{from{background-position:0% 50%;}to{background-position:100% 50%;}}
@keyframes bl-pulse{0%,100%{box-shadow:0 0 0 0 color-mix(in srgb,var(--red) 35%,transparent);}50%{box-shadow:0 0 0 5px transparent;}}
.bl-kpi,.bl-card,.bl-ring-card{transition:transform .18s ease,box-shadow .18s ease;}
.bl-kpi:hover,.bl-card:hover,.bl-ring-card:hover{transform:translateY(-3px);box-shadow:0 10px 24px -14px color-mix(in srgb,var(--navy-deep) 55%,transparent);}
tbody tr{transition:background-color .15s ease;}tbody tr:hover td{background:var(--acc-bg);}
details.bl-details>summary{cursor:pointer;font-weight:600;color:var(--logo);}
details.bl-details[open]>summary~*{animation:bl-rise .35s ease both;}`;
  return `${embeddedFontCss()}
:root{--paper:${c.paper};--card:${c.card};--card2:${c.card2};--ink:${c.ink};--ink2:${c.ink2};--muted:${c.muted};--line:${c.line};--line2:${c.line2};--acc:${c.acc};--acc-bg:${c['acc-bg']};--acc-lite:${c['acc-lite']};--acc-ink:${c['acc-ink']};--navy-deep:${c['navy-deep']};--red:${c.red};--red-bg:${c['red-bg']};--orange:${c.orange};--orange-bg:${c['orange-bg']};--green:${c.green};--green-bg:${c['green-bg']};--thead-bg:${c['thead-bg']};--thead-ink:${c['thead-ink']};--thead-line:${c['thead-line']};--logo:${c.logo};--head-ink:color-mix(in srgb,var(--logo) 72%,var(--thead-ink));}
@page{size:A4 ${orientation === 'landscape' ? 'landscape' : 'portrait'};margin:14mm 12mm 16mm;}
*{box-sizing:border-box;}
html{-webkit-print-color-adjust:exact;print-color-adjust:exact;scroll-behavior:smooth;min-height:100%;background:${print ? '#ffffff' : `radial-gradient(1200px 500px at 85% -10%,color-mix(in srgb,var(--acc) 14%,transparent),transparent 60%) fixed,var(--paper)`};}
body{margin:0;background:transparent;color:var(--ink);font:14px/1.55 ${f.html};}
.bl-page{max-width:${print ? 'none' : (orientation === 'landscape' ? '1280px' : '980px')};margin:0 auto;padding:${print ? '0' : '32px 28px 56px'};}
.bl-report{background:${print ? 'transparent' : 'var(--card)'};${print ? '' : 'border:1px solid var(--line);padding:0 36px 32px;box-shadow:0 24px 60px -36px color-mix(in srgb,var(--navy-deep) 45%,transparent);'}}
.bl-header{display:flex;justify-content:space-between;align-items:flex-end;gap:16px;margin:${print ? '0 0 22px' : '0 -36px 26px'};padding:${print ? '16px 18px' : '26px 36px 22px'};color:var(--logo);background:linear-gradient(120deg,var(--thead-bg),color-mix(in srgb,var(--thead-bg) 86%,var(--thead-ink)) 60%,var(--thead-bg));border-bottom:3px solid var(--logo);position:relative;overflow:hidden;}
.bl-header::after{content:"";position:absolute;right:-60px;top:-80px;width:240px;height:240px;border-radius:50%;background:radial-gradient(circle,color-mix(in srgb,var(--logo) 8%,transparent),transparent 70%);pointer-events:none;}
.bl-brand{font:600 13px/1.2 ${f.htmlHead};letter-spacing:.12em;text-transform:uppercase;color:var(--logo);}
.bl-brand small{display:block;font:400 11px/1.4 ${f.html};letter-spacing:.02em;text-transform:none;color:var(--thead-ink);margin-top:3px;}
.bl-meta{color:var(--thead-ink);font-size:12px;text-align:right;}
h1,h2,h3,h4{font-family:${f.htmlHead};font-weight:600;color:var(--head-ink);line-height:1.2;margin:0 0 .5em;}
h1{font-size:30px;color:var(--logo);letter-spacing:-.01em;}h2{color:var(--logo);}
h2{font-size:20px;margin-top:1.5em;padding-bottom:6px;position:relative;}
h2::after{content:"";position:absolute;left:0;bottom:0;width:100%;height:1px;background:var(--line);}
h2::before{content:"";position:absolute;left:0;bottom:0;width:56px;height:3px;background:var(--logo);z-index:1;}
h3{font-size:16px;margin-top:1.1em;}
p{margin:0 0 .8em;}ul,ol{margin:0 0 .9em;padding-left:1.3em;}li{margin:.15em 0;}li::marker{color:var(--acc);}
a{color:var(--acc-ink);}
.bl-lead{font-size:16px;color:var(--ink2);border-left:3px solid var(--acc-lite);padding-left:12px;}
.bl-section{margin:0 0 22px;break-inside:auto;}
.bl-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin:14px 0 22px;}
.bl-kpi{position:relative;overflow:hidden;background:linear-gradient(160deg,#fff,var(--card2));border:1px solid var(--line);border-top:4px solid var(--acc);padding:12px 14px;break-inside:avoid;}
.bl-kpi::after{content:"";position:absolute;right:-26px;bottom:-26px;width:80px;height:80px;border-radius:50%;background:color-mix(in srgb,var(--acc) 9%,transparent);}
.bl-kpi.ok{border-top-color:var(--green);}.bl-kpi.ok::after{background:color-mix(in srgb,var(--green) 10%,transparent);}
.bl-kpi.warn{border-top-color:var(--orange);}.bl-kpi.warn::after{background:color-mix(in srgb,var(--orange) 10%,transparent);}
.bl-kpi.risk{border-top-color:var(--red);}.bl-kpi.risk::after{background:color-mix(in srgb,var(--red) 10%,transparent);}
.bl-kpi-label{display:block;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);}
.bl-kpi-value{display:block;font:600 30px/1.1 ${f.htmlHead};color:var(--ink);margin-top:4px;}
.bl-kpi.ok .bl-kpi-value{color:var(--green);}.bl-kpi.warn .bl-kpi-value{color:var(--orange);}.bl-kpi.risk .bl-kpi-value{color:var(--red);}
.bl-kpi-note{display:block;font-size:12px;color:var(--ink2);margin-top:3px;position:relative;z-index:1;}
.bl-trend{font-size:12px;font-weight:600;margin-left:6px;}.bl-trend.up{color:var(--green);}.bl-trend.down{color:var(--red);}
.bl-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px;}
.bl-card{background:var(--card2);border:1px solid var(--line);border-left:3px solid var(--acc-lite);padding:12px 14px;break-inside:avoid;}
.bl-card.ok{border-left-color:var(--green);}.bl-card.warn{border-left-color:var(--orange);}.bl-card.risk{border-left-color:var(--red);}
.bl-card h3{margin-top:0;color:var(--logo);}
/* Model görselleri (Buyer Log yerel deposundan gömülür) */
.bl-gallery{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px;margin:10px 0 18px;}
.bl-gallery .bl-card{display:flex;flex-direction:column;gap:4px;}
.bl-model-img{display:block;width:100%;aspect-ratio:1/1;object-fit:contain;background:#fff;border:1px solid var(--line);margin:0 0 8px;break-inside:avoid;}
.bl-noimg{display:grid;place-items:center;align-content:center;gap:2px;width:100%;aspect-ratio:1/1;border:1px dashed var(--line2);background:var(--card2);color:var(--muted);font-size:12px;margin:0 0 8px;text-align:center;}
.bl-noimg small{font-size:11px;color:var(--muted);}
td .bl-model-img,td .bl-noimg{width:64px;margin:0;}
.bl-callout{border-left:4px solid var(--acc);background:var(--acc-bg);padding:12px 16px;margin:14px 0;break-inside:avoid;}
.bl-callout.ok{border-left-color:var(--green);background:var(--green-bg);}.bl-callout.warn{border-left-color:var(--orange);background:var(--orange-bg);}.bl-callout.risk{border-left-color:var(--red);background:var(--red-bg);}
.bl-table-wrap{overflow-x:auto;margin:8px 0 16px;border:1px solid var(--thead-line);}
table{border-collapse:collapse;width:100%;font-size:12.5px;}
thead{display:table-header-group;}tr{break-inside:avoid;}
th{background:var(--thead-bg);color:var(--logo);text-align:left;font-weight:600;font-size:11.5px;letter-spacing:.05em;text-transform:uppercase;padding:8px 9px;border-bottom:1px solid var(--thead-line);border-right:1px solid var(--thead-line);}
th:last-child{border-right:0;}
td{padding:7px 9px;border-top:1px solid var(--line);vertical-align:top;}
tbody tr:nth-child(even) td{background:var(--card2);}
td.num,th.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap;}
.bl-badge{display:inline-block;padding:2px 8px;font-size:11px;font-weight:600;border:1px solid var(--line2);background:var(--card2);color:var(--ink2);white-space:nowrap;}
.bl-badge.ok{background:var(--green-bg);color:var(--green);border-color:var(--green);}.bl-badge.warn{background:var(--orange-bg);color:var(--orange);border-color:var(--orange);}.bl-badge.risk{background:var(--red-bg);color:var(--red);border-color:var(--red);}.bl-badge.info{background:var(--acc-bg);color:var(--acc-ink);border-color:var(--acc);}
.bl-bars{margin:10px 0 18px;}.bl-bar{display:grid;grid-template-columns:minmax(90px,28%) 1fr auto;gap:10px;align-items:center;margin:6px 0;font-size:12.5px;}
.bl-bar-track{background:var(--card2);border:1px solid var(--line);height:16px;overflow:hidden;}.bl-bar-fill{display:block;height:100%;background:linear-gradient(90deg,var(--acc),var(--acc-lite));}
.bl-bar.ok .bl-bar-fill{background:linear-gradient(90deg,var(--green),color-mix(in srgb,var(--green) 55%,#fff));}.bl-bar.warn .bl-bar-fill{background:linear-gradient(90deg,var(--orange),color-mix(in srgb,var(--orange) 55%,#fff));}.bl-bar.risk .bl-bar-fill{background:linear-gradient(90deg,var(--red),color-mix(in srgb,var(--red) 55%,#fff));}
.bl-rings{display:flex;flex-wrap:wrap;gap:14px;margin:12px 0 20px;}
.bl-ring-card{display:flex;align-items:center;gap:12px;background:var(--card2);border:1px solid var(--line);padding:10px 14px;break-inside:avoid;}
.bl-ring{--bl-c:var(--acc);width:72px;height:72px;border-radius:50%;flex:none;display:grid;place-items:center;font:600 16px/1 ${f.htmlHead};color:var(--ink);background:radial-gradient(closest-side,var(--card2) 72%,transparent 73% 100%),conic-gradient(var(--bl-c) calc(var(--bl-p) * 1%),var(--line) 0);}
.bl-ring.ok{--bl-c:var(--green);}.bl-ring.warn{--bl-c:var(--orange);}.bl-ring.risk{--bl-c:var(--red);}
.bl-ring-label{font-size:12px;color:var(--ink2);max-width:160px;}
.bl-progress{height:10px;background:var(--card2);border:1px solid var(--line);overflow:hidden;margin:4px 0 10px;}.bl-progress-fill{display:block;height:100%;background:linear-gradient(90deg,var(--acc),var(--acc-lite));}
.bl-timeline{list-style:none;margin:10px 0 18px;padding:0 0 0 22px;border-left:2px solid var(--line);}
.bl-timeline li{position:relative;margin:0 0 12px;padding-left:6px;}
.bl-timeline li::before{content:"";position:absolute;left:-29px;top:4px;width:12px;height:12px;border-radius:50%;background:var(--acc);box-shadow:0 0 0 3px var(--card);}
.bl-timeline li.ok::before{background:var(--green);}.bl-timeline li.warn::before{background:var(--orange);}.bl-timeline li.risk::before{background:var(--red);}
.bl-timeline time{display:block;font-size:11px;color:var(--muted);letter-spacing:.04em;text-transform:uppercase;}
.bl-steps{counter-reset:bl-step;list-style:none;padding:0;margin:10px 0 18px;display:grid;gap:8px;}
.bl-steps li{counter-increment:bl-step;display:grid;grid-template-columns:30px 1fr;gap:10px;align-items:start;background:var(--card2);border:1px solid var(--line);padding:9px 12px;break-inside:avoid;}
.bl-steps li::before{content:counter(bl-step);display:grid;place-items:center;width:26px;height:26px;background:var(--logo);color:#fff;font:600 14px/1 ${f.htmlHead};}
.bl-muted{color:var(--muted);}.bl-small{font-size:12px;}
.bl-footer{margin-top:30px;padding-top:10px;border-top:1px solid var(--line);color:var(--muted);font-size:11px;display:flex;justify-content:space-between;gap:12px;}
svg{max-width:100%;height:auto;}${motion}
@media print{.bl-page{padding:0;}.bl-report{border:0;padding:0;background:transparent;box-shadow:none;}.bl-header{margin:0 0 22px;padding:16px 18px;}h2,h3{break-after:avoid;}*,*::before,*::after{animation:none !important;transition:none !important;}}`;
}

module.exports = { theme, reportCss, embeddedFontCss, readDesignTokens, normalizeHex, ooxml, FALLBACK };
