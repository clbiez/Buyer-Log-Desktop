'use strict';

/*
 * Smart Layout Studio → etkileşimli HTML sunum.
 *
 * Sayfa planı PowerPoint ile AYNI hesaptan gelir (BLOutputLayout.expandGalleries
 * + cardContent): kart konumu, gruplar, başlık bandı, not ve alt bilgi
 * kullanıcının Studio'da kurduğu düzendir. Her slayt, ekran genişliğine göre
 * ölçeklenen bir tuvaldir (konumlar %, yazılar cqw).
 *
 * Etkileşim yalnız CSS'tir; belge katı CSP ile (script-src 'none') sarılır:
 *   - kaydırınca slayta oturma (scroll-snap) ve kaydırmaya bağlı giriş animasyonları,
 *   - karta tıklayınca büyük görsel + tüm kart bilgileri (:target), önceki/sonraki model,
 *   - sağda aktif slaytı izleyen gezinme noktaları, üstte ilerleme çubuğu,
 *   - "Tüm slaytlar" genel bakışı.
 * prefers-reduced-motion'da hareket kapanır; yazdırmada her slayt bir sayfadır.
 * Görseller CSS sınıfına bir kez gömülür; kart ve büyük görünüm aynı veriyi kullanır.
 */
const BLOutputLayout = require('../../../public/lcwai-output-layout');
const { CSP, escapeHtml: esc } = require('./output-html');
const { theme, embeddedFontCss } = require('./output-theme');

const MAX_ZOOMS = 2000; // büyük görünüm (kart başına bir katman) üst sınırı; fazlası düz kart
const MAX_TRACKED = 200; // aktif slayt vurgusu izlenen nokta sayısı
const IMAGE_RE = /^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/;
const num = value => Math.round(value * 1000) / 1000;

function buildDeck({ data, records = {}, images = {}, title = '', lang = 'tr', date = '' } = {}) {
  const english = lang === 'en';
  const T = (tr, en) => (english ? en : tr);
  const c = theme().colors, f = theme().fonts;
  const l = BLOutputLayout.normalizeLayout('pptx', data.layout);
  const g = BLOutputLayout.pptxGeometry(l);
  const W = g.size.width, H = g.size.height;
  const pages = BLOutputLayout.expandGalleries(data.slides, l, { records, english });
  const deckTitle = String(title || data.title || T('Sunum', 'Presentation'));
  const brand = 'Buyer Log';
  const X = v => `${num(v / W * 100)}%`, Y = v => `${num(v / H * 100)}%`, F = v => `${num(v / W * 100)}cqw`;
  const at = (x, y, w, h) => `left:${X(x)};top:${Y(y)};width:${X(w)};height:${Y(h)};`;
  const block = (x, y, w, h, cls, html, extra = '') => `<div class="${cls}" style="${at(x, y, w, h)}${extra}">${html}</div>`;

  // Görseller: anahtar başına tek CSS sınıfı.
  const imageClass = new Map();
  const imageCss = [];
  const imageOf = token => {
    const key = String(token || '').toUpperCase();
    if (imageClass.has(key)) return imageClass.get(key);
    const url = images[key] && images[key].dataUrl;
    const cls = url && IMAGE_RE.test(url) ? `im${imageClass.size}` : '';
    if (cls) imageCss.push(`.${cls}{background-image:url("${url}")}`);
    imageClass.set(key, cls);
    return cls;
  };
  const picture = (token, label, cls) => {
    const im = imageOf(token);
    return im ? `<div class="${cls} ${im}" role="img" aria-label="${esc(label)}"></div>`
      : `<div class="${cls} is-empty"><span>${esc(T('Görsel yok', 'No image'))}</span></div>`;
  };

  // Not: tuval ve kutular overflow:clip kullanır; hidden kaydırma kabı oluşturup view() zaman çizelgesini kopardı.
  // Kartlar: deste sırası (büyük görünümde önceki/sonraki için).
  const cards = [];
  pages.forEach((entry, index) => { if (entry.page) entry.page.cells.forEach(cell => cards.push({ cell, slide: index + 1 })); });
  const zoomable = cards.length <= MAX_ZOOMS;
  const zoomId = n => `z${n + 1}`;
  const toneClass = tone => (['ok', 'warn', 'risk'].includes(tone) ? ` is-${tone}` : '');
  const toneAttr = tone => (toneClass(tone) ? ` class="${toneClass(tone).trim()}"` : '');

  let cardNo = 0;
  const slides = pages.map((entry, index) => {
    const n = index + 1;
    const slide = entry.slide || { layout: 'gallery', title: entry.page.title, subtitle: entry.page.subtitle };
    const cover = entry.slide && ['title', 'section'].includes(entry.slide.layout);
    let html = '';
    if (cover) {
      const models = cards.length;
      html += `<div class="dk-orb is-a"></div><div class="dk-orb is-b"></div><div class="dk-orb is-c"></div>`;
      html += block(g.margin + 24, H * 0.22, W - g.margin * 2 - 48, H * 0.1, 'dk-kicker', esc(entry.slide.layout === 'title' ? brand : T('Bölüm', 'Section')), `font-size:${F(13)};`);
      html += block(g.margin + 24, H * 0.32, W - g.margin * 2 - 48, H * 0.3, 'dk-cover-title', `<b>${esc(slide.title)}</b>`, `font-size:${F(slide.title.length > 50 ? 36 : 46)};`);
      if (slide.subtitle) html += block(g.margin + 24, H * 0.63, W - g.margin * 2 - 48, H * 0.12, 'dk-cover-sub', esc(slide.subtitle), `font-size:${F(18)};`);
      if (entry.slide.layout === 'title') {
        const meta = [date, models ? T(`${models} model`, `${models} models`) : '', T(`${pages.length} slayt`, `${pages.length} slides`)].filter(Boolean);
        html += block(g.margin + 24, H * 0.78, W - g.margin * 2 - 48, H * 0.08, 'dk-cover-meta', meta.map(item => `<span>${esc(item)}</span>`).join(''), `font-size:${F(11)};`);
      }
    } else {
      if (g.band) {
        const dark = !entry.slide || entry.slide.layout === 'gallery';
        const size = slide.title.length > 60 ? Math.round(l.titleSize * 0.8) : l.titleSize;
        const sub = slide.subtitle && g.band >= 56 ? `<small style="font-size:${F(Math.max(9, Math.round(size * 0.45)))}">${esc(slide.subtitle)}</small>` : '';
        html += block(0, 0, W, g.band, `dk-band${dark ? ' is-dark' : ''}`, `<div class="dk-band-text" style="padding:0 ${X(g.margin)} ${F(16)};"><b style="font-size:${F(size)}">${esc(slide.title)}</b>${sub}</div><i class="dk-band-rule" style="left:${X(g.margin)};width:${F(64)};height:${F(3)};bottom:${F(10)}"></i>`);
      }
      if (entry.page) {
        const page = entry.page;
        html += block(g.margin - 10, g.contentTop - 4, g.width + 20, H - 40 - g.contentTop + 4, 'dk-frame', '');
        page.dividers.forEach(d => { html += block(d.x - 0.4, d.y, 0.8, d.h, 'dk-divider', ''); });
        page.rules.forEach(r => { html += block(r.x, r.y, r.w, 1.6, 'dk-rule', ''); });
        page.labels.forEach(label => { html += block(label.x, label.y, label.w, label.h, 'dk-label', `<span>${esc(label.text)}${label.cont ? esc(T(' (devam)', ' (cont.)')) : ''}</span>`, `font-size:${F(label.size || Math.max(8, l.cardTextSize))};`); });
        page.cells.forEach((cell, i) => {
          const no = cardNo++;
          const item = cell.item, record = records[String(item.image || '').toUpperCase()];
          const content = BLOutputLayout.cardContent(cell, l, item, record, page.scale), k = content.box;
          const lines = content.lines.map(line => `<p>${line.map(field => `${l.showFieldLabels ? `<i>${esc(field.label)}</i> ` : ''}<span${toneAttr(field.tone)}>${esc(field.value)}</span>`).join('<em> · </em>')}</p>`).join('');
          const inner = `${picture(item.image, item.title, 'dk-img')}<div class="dk-card-text">${content.badge ? `<span class="dk-badge" style="font-size:${F(Math.max(5.5, k.size - 2))}">${esc(content.badge)}</span>` : ''}${content.title ? `<b style="font-size:${F(k.size)}">${esc(content.title)}</b>` : ''}${content.meta ? `<small style="font-size:${F(k.detail)}">${esc(content.meta)}</small>` : ''}<div style="font-size:${F(k.detail)}">${lines}</div></div>${zoomable ? `<span class="dk-more">${esc(T('Ayrıntı', 'Details'))} ↗</span>` : ''}`;
          const style = `${at(cell.x, cell.y, cell.w, cell.h)}padding:${F(k.pad)};--img:${F(k.imgH)};--i:${Math.min(i, 11)};`;
          const cls = `dk-card bl-studio-card${toneClass(item.tone)}`;
          html += zoomable ? `<a class="${cls}" href="#${zoomId(no)}" style="${style}" aria-label="${esc(`${item.title} — ${T('ayrıntılar', 'details')}`)}">${inner}</a>` : `<div class="${cls}" style="${style}">${inner}</div>`;
        });
      } else {
        html += block(g.margin, g.contentTop + 8, g.width, g.contentH, 'dk-content', contentHtml(slide, { T, F, l }));
      }
      if (l.studio && l.studio.note) html += block(g.margin, H - 44 - l.studio.noteHeight, g.width, l.studio.noteHeight, 'dk-note', esc(l.studio.note), `font-size:${F(10)};`);
      html += block(g.margin, H - 30, W / 2, 18, 'dk-foot', esc(`${brand} · ${deckTitle}`.slice(0, 110)), `font-size:${F(9)};`);
      html += block(W - g.margin - 120, H - 30, 120, 18, 'dk-foot is-right', `${n} / ${pages.length}`, `font-size:${F(9)};`);
    }
    const tracked = n <= MAX_TRACKED ? ` style="view-timeline-name:--s${n}"` : '';
    return `<section class="dk-slide${cover ? ' is-cover' : ''}" id="s${n}" aria-label="${esc(`${n} / ${pages.length} · ${slide.title}`)}"${tracked}><div class="dk-canvas">${html}</div></section>`;
  }).join('\n');

  // Büyük görünüm: tüm seçili kart bilgileri (kartta sığmayanlar dahil), önceki/sonraki model.
  const zooms = zoomable ? cards.map(({ cell, slide }, i) => {
    const item = cell.item, record = records[String(item.image || '').toUpperCase()];
    const details = BLOutputLayout.cardDetails(item, l, record);
    const back = `#s${slide}`;
    const step = (j, text, cls) => (j >= 0 && j < cards.length ? `<a class="${cls}" href="#${zoomId(j)}">${text}</a>` : `<span class="${cls} is-off">${text}</span>`);
    return `<div class="dk-zoom" id="${zoomId(i)}" role="dialog" aria-modal="true" aria-label="${esc(item.title)}"><a class="dk-scrim" href="${back}" aria-label="${esc(T('Kapat', 'Close'))}"></a><figure class="dk-zoom-card">${picture(item.image, item.title, 'dk-zoom-img')}<figcaption><small>${esc(T(`Model ${i + 1} / ${cards.length}`, `Model ${i + 1} of ${cards.length}`))}</small><h3>${esc(item.title)}</h3>${item.subtitle ? `<p class="dk-zoom-sub">${esc(item.subtitle)}</p>` : ''}<dl>${details.map(row => `<div><dt>${esc(row.label)}</dt><dd${toneAttr(row.tone)}>${esc(row.value)}</dd></div>`).join('')}</dl><nav>${step(i - 1, `← ${esc(T('Önceki', 'Previous'))}`, 'dk-step')}<a class="dk-close" href="${back}">${esc(T('Kapat', 'Close'))} ✕</a>${step(i + 1, `${esc(T('Sonraki', 'Next'))} →`, 'dk-step')}</nav></figcaption></figure></div>`;
  }).join('\n') : '';

  const titles = pages.map(entry => (entry.slide || { title: entry.page.title }).title);
  const dots = titles.map((text, i) => `<a class="dk-dot" href="#s${i + 1}" style="${i < MAX_TRACKED ? `--tl:--s${i + 1}` : ''}" title="${esc(`${i + 1} · ${text}`)}"><span>${i + 1}</span></a>`).join('');
  const overview = `<div class="dk-overview" id="overview" role="dialog" aria-modal="true" aria-label="${esc(T('Tüm slaytlar', 'All slides'))}"><a class="dk-scrim" href="#s1" aria-label="${esc(T('Kapat', 'Close'))}"></a><div class="dk-overview-panel"><header><b>${esc(T('Tüm slaytlar', 'All slides'))}</b><a class="dk-close" href="#s1">${esc(T('Kapat', 'Close'))} ✕</a></header><ol>${pages.map((entry, i) => `<li><a href="#s${i + 1}"><span>${i + 1}</span><b>${esc(titles[i])}</b><small>${esc(entry.page ? T(`${entry.page.cells.length} model`, `${entry.page.cells.length} models`) : '')}</small></a></li>`).join('')}</ol></div></div>`;
  const scope = titles.slice(0, MAX_TRACKED).map((_, i) => `--s${i + 1}`).join(',');

  return `<!DOCTYPE html>
<html lang="${english ? 'en' : 'tr'}">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${CSP}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="Buyer Log · Smart Layout Studio">
<title>${esc(deckTitle)}</title>
<style>${embeddedFontCss()}
${deckCss({ c, f, W, H, scope })}
${imageCss.join('\n')}</style>
</head>
<body>
<div class="dk-progress" aria-hidden="true"></div>
<header class="dk-top"><span class="dk-mark">BL</span><span class="dk-top-title"><b>${esc(deckTitle)}</b><small>${esc([brand, date].filter(Boolean).join(' · '))}</small></span><a class="dk-top-btn" href="#overview">${esc(T('Tüm slaytlar', 'All slides'))}</a></header>
<nav class="dk-nav" aria-label="${esc(T('Slaytlar', 'Slides'))}">${dots}</nav>
<main class="dk-deck">
${slides}
</main>
<p class="dk-hint">${esc(T('Kaydırın ya da Page Down / Boşluk ile ilerleyin · Bir modele tıklayınca ayrıntısı açılır', 'Scroll or use Page Down / Space · Click a model to open its details'))}</p>
${zooms}
${overview}
</body>
</html>
`;
}

/* Kapak/galeri dışı slaytlar: KPI, tablo, grafik, karşılaştırma, maddeler. */
function contentHtml(slide, { T, F, l }) {
  const body = F(l.bodySize);
  if (slide.layout === 'kpis') {
    return `<div class="dk-kpis">${(slide.kpis || []).map((k, i) => `<div class="dk-kpi" style="--i:${i}"><span>${esc(k.label)}</span><b style="font-size:${F(40)}">${esc(k.value)}</b>${k.note ? `<small>${esc(k.note)}</small>` : ''}</div>`).join('')}</div>${bullets(slide, body)}`;
  }
  if (slide.layout === 'table' && slide.table) {
    return `<div class="dk-table" style="font-size:${F(Math.min(12, l.bodySize))}"><table><thead><tr>${slide.table.columns.map(col => `<th>${esc(col)}</th>`).join('')}</tr></thead><tbody>${slide.table.rows.map((row, i) => `<tr style="--i:${Math.min(i, 12)}">${row.map(v => `<td>${esc(v)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  }
  if (slide.layout === 'chart' && slide.chart) {
    const values = slide.chart.series.flatMap(s => s.values.map(v => Math.abs(Number(v) || 0)));
    const max = Math.max(1, ...values);
    return `<div class="dk-chart" style="font-size:${F(12)}">${slide.chart.categories.map((cat, i) => `<div class="dk-chart-row" style="--i:${i}"><span>${esc(cat)}</span><div>${slide.chart.series.map((s, j) => `<p><i class="dk-bar is-s${j % 3}" style="width:${num(Math.abs(Number(s.values[i]) || 0) / max * 100)}%"></i><em>${esc(slide.chart.series.length > 1 ? `${s.name}: ` : '')}${esc(s.values[i])}</em></p>`).join('')}</div></div>`).join('')}</div>${bullets(slide, body)}`;
  }
  if (slide.layout === 'comparison' && slide.left && slide.right) {
    return `<div class="dk-compare" style="font-size:${body}">${[slide.left, slide.right].map((side, i) => `<div class="dk-side" style="--i:${i}"><h3>${esc(side.title)}</h3><ul>${side.bullets.map(b => `<li>${esc(b)}</li>`).join('')}</ul></div>`).join('')}</div>`;
  }
  return `${slide.subtitle ? `<p class="dk-lead" style="font-size:${body}">${esc(slide.subtitle)}</p>` : ''}${bullets(slide, body, slide.layout === 'summary')}${slide.callout ? `<div class="dk-callout" style="font-size:${body}">${esc(typeof slide.callout === 'string' ? slide.callout : slide.callout.text || '')}</div>` : ''}`;
}
function bullets(slide, size, numbered = false) {
  const list = slide.bullets || [];
  if (!list.length) return '';
  const tag = numbered ? 'ol' : 'ul';
  return `<${tag} class="dk-bullets" style="font-size:${size}">${list.map((b, i) => `<li style="--i:${i}">${esc(b)}</li>`).join('')}</${tag}>`;
}

function deckCss({ c, f, W, H, scope }) {
  return `
:root{--ink:${c.ink};--ink2:${c.ink2};--muted:${c.muted};--line:${c.line};--paper:${c.paper};--card:${c.card};--acc:${c.acc};--acc-bg:${c['acc-bg']};--acc-lite:${c['acc-lite']};--navy:${c['navy-deep']};--logo:${c.logo};--head:${c['thead-bg']};--head-ink:${c['thead-ink']};--head-line:${c['thead-line']};--ok:${c.green};--warn:${c.orange};--risk:${c.red};--ease:cubic-bezier(.2,.7,.2,1);color-scheme:light}
*,*::before,*::after{box-sizing:border-box}
html{scroll-snap-type:y mandatory;scroll-behavior:smooth;scroll-padding-top:0}
body{margin:0;font-family:${f.html};color:var(--ink);background:radial-gradient(1200px 700px at 12% -10%,color-mix(in srgb,var(--acc) 38%,transparent),transparent 60%),radial-gradient(900px 600px at 110% 110%,color-mix(in srgb,var(--acc-lite) 22%,transparent),transparent 60%),var(--navy);background-attachment:fixed;min-height:100vh;${scope ? `timeline-scope:${scope};` : ''}}
a{color:inherit}
.dk-progress{position:fixed;left:0;top:0;right:0;height:3px;z-index:30;transform-origin:0 50%;transform:scaleX(0);background:linear-gradient(90deg,var(--acc-lite),#fff,var(--acc-lite))}
.dk-top{position:fixed;left:16px;top:12px;z-index:25;display:flex;align-items:center;gap:10px;padding:6px 8px 6px 6px;border-radius:12px;color:#fff;background:color-mix(in srgb,var(--navy) 70%,transparent);backdrop-filter:blur(10px);border:1px solid color-mix(in srgb,#fff 14%,transparent);max-width:calc(100vw - 32px)}
.dk-mark{display:grid;place-items:center;width:30px;height:30px;border-radius:8px;background:#fff;color:var(--logo);font:600 13px ${f.htmlHead}}
.dk-top-title{display:flex;flex-direction:column;min-width:0;line-height:1.15}.dk-top-title b{font:600 15px ${f.htmlHead};white-space:nowrap;overflow:clip;text-overflow:ellipsis}.dk-top-title small{font-size:11px;opacity:.7}
.dk-top-btn{margin-left:6px;padding:6px 10px;border-radius:8px;font-size:12px;font-weight:700;text-decoration:none;background:color-mix(in srgb,#fff 14%,transparent);transition:background .2s}
.dk-top-btn:hover,.dk-top-btn:focus-visible{background:color-mix(in srgb,#fff 26%,transparent)}
.dk-nav{position:fixed;right:14px;top:50%;transform:translateY(-50%);z-index:25;display:flex;flex-direction:column;gap:6px;max-height:80vh;overflow:auto;padding:6px;scrollbar-width:none}
.dk-dot{position:relative;display:block;width:10px;height:10px;border-radius:50%;background:color-mix(in srgb,#fff 35%,transparent);transition:transform .2s var(--ease),background .2s;flex:none}
.dk-dot span{position:absolute;right:18px;top:50%;transform:translateY(-50%);padding:2px 6px;border-radius:6px;background:#fff;color:var(--logo);font-size:11px;font-weight:700;opacity:0;pointer-events:none;transition:opacity .15s}
.dk-dot:hover,.dk-dot:focus-visible{transform:scale(1.5);background:#fff}.dk-dot:hover span,.dk-dot:focus-visible span{opacity:1}
.dk-deck{display:block}
.dk-slide{min-height:100vh;min-height:100svh;display:grid;place-items:center;padding:64px 44px 28px;scroll-snap-align:center;scroll-snap-stop:normal}
.dk-canvas{position:relative;width:min(100%,calc((100svh - 92px) * ${W} / ${H}));aspect-ratio:${W} / ${H};container-type:inline-size;overflow:clip;background:var(--paper);border-radius:14px;box-shadow:0 30px 80px -30px rgba(0,0,0,.65),0 0 0 1px color-mix(in srgb,#fff 10%,transparent)}
.dk-canvas>div{position:absolute}
.dk-band{background:var(--head);border-bottom:1px solid var(--head-line);overflow:clip;color:var(--logo)}
.dk-band.is-dark{background:linear-gradient(110deg,var(--logo),color-mix(in srgb,var(--logo) 70%,var(--acc)) 60%,var(--logo));color:#fff;border-bottom-color:var(--logo)}
.dk-band::after{content:"";position:absolute;inset:0;background:linear-gradient(100deg,transparent 30%,color-mix(in srgb,#fff 16%,transparent) 50%,transparent 70%);transform:translateX(-110%)}
.dk-band-text{position:absolute;inset:0;display:flex;flex-direction:column;justify-content:flex-end;line-height:1.1}
.dk-band-text b{font-family:${f.htmlHead};font-weight:600;white-space:nowrap;overflow:clip;text-overflow:ellipsis}
.dk-band-text small{opacity:.75;margin-top:.25em}
.dk-band-rule{position:absolute;background:currentColor;transform-origin:0 50%;border-radius:2px}
.dk-frame{background:color-mix(in srgb,var(--head) 55%,transparent);border:1px solid var(--head-line);border-radius:6px}
.dk-divider{background:var(--head-line)}
.dk-rule{background:var(--logo);transform-origin:0 50%}
.dk-label{display:flex;align-items:flex-end;font-weight:700;color:var(--logo);white-space:nowrap;overflow:clip}
.dk-label span{overflow:clip;text-overflow:ellipsis}
.dk-card{position:absolute;display:flex;flex-direction:column;background:#fff;border:1px solid var(--line);border-radius:6px;overflow:clip;text-decoration:none;color:var(--ink);box-shadow:0 1px 2px rgba(0,0,0,.06);transition:transform .35s var(--ease),box-shadow .35s var(--ease),border-color .2s}
.dk-card.is-ok{border-top:2px solid var(--ok)}.dk-card.is-warn{border-top:2px solid var(--warn)}.dk-card.is-risk{border-top:2px solid var(--risk)}
.dk-img,.dk-zoom-img{background:center/contain no-repeat;flex:none}
.dk-img{height:var(--img);transition:transform .5s var(--ease)}
.dk-img.is-empty,.dk-zoom-img.is-empty{display:grid;place-items:center;background:var(--card);color:var(--muted);border-radius:4px;font-size:max(9px,1.2cqw)}
.dk-card-text{padding-top:.3em;line-height:1.25;min-width:0}
.dk-card-text b{display:block;color:var(--ink);white-space:nowrap;overflow:clip;text-overflow:ellipsis}
.dk-card-text small{display:block;color:var(--ink2)}
.dk-card-text p{margin:0;color:var(--ink2);white-space:nowrap;overflow:clip;text-overflow:ellipsis}
.dk-card-text i{font-style:normal;color:var(--muted)}.dk-card-text em{font-style:normal;color:var(--line)}
.is-ok{color:var(--ok)!important;font-weight:700}.is-warn{color:var(--warn)!important;font-weight:700}.is-risk{color:var(--risk)!important;font-weight:700}
.dk-badge{display:inline-block;padding:.1em .5em;border-radius:99px;background:var(--acc-bg);color:${c['acc-ink']};font-weight:700}
.dk-more{position:absolute;right:6%;top:6%;padding:.35em .7em;border-radius:99px;background:var(--logo);color:#fff;font-size:max(9px,1cqw);font-weight:700;opacity:0;transform:translateY(-4px);transition:opacity .2s,transform .2s var(--ease);pointer-events:none}
a.dk-card:hover,a.dk-card:focus-visible{transform:translateY(-3px) scale(1.015);box-shadow:0 18px 34px -18px rgba(0,0,0,.45);border-color:var(--acc-lite);z-index:2;outline:none}
a.dk-card:hover .dk-img,a.dk-card:focus-visible .dk-img{transform:scale(1.06)}
a.dk-card:hover .dk-more,a.dk-card:focus-visible .dk-more{opacity:1;transform:none}
.dk-note{padding:.4em .8em;border-left:3px solid var(--acc);background:var(--acc-bg);color:var(--ink);border-radius:0 6px 6px 0;overflow:clip}
.dk-foot{color:var(--muted);white-space:nowrap;overflow:clip;text-overflow:ellipsis;display:flex;align-items:center}.dk-foot.is-right{justify-content:flex-end}
.dk-content{display:flex;flex-direction:column;gap:1.4cqw;overflow:clip}
.dk-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(18cqw,1fr));gap:1.6cqw}
.dk-kpi{display:flex;flex-direction:column;gap:.3cqw;padding:2cqw;border-radius:1cqw;background:#fff;border:1px solid var(--line);box-shadow:0 10px 30px -22px rgba(0,0,0,.4);position:relative;overflow:clip}
.dk-kpi::before{content:"";position:absolute;left:0;top:0;bottom:0;width:.45cqw;background:linear-gradient(var(--acc),var(--acc-lite))}
.dk-kpi span{font-size:1.4cqw;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}
.dk-kpi b{font-family:${f.htmlHead};font-weight:600;color:var(--logo);line-height:1}.dk-kpi small{font-size:1.3cqw;color:var(--ink2)}
.dk-bullets{margin:0;padding-left:1.2em;display:grid;gap:.5em;color:var(--ink)}
.dk-bullets li::marker{color:var(--acc);font-weight:700}
.dk-lead{margin:0;color:var(--ink2)}
.dk-callout{padding:1em 1.2em;border-radius:.6em;background:var(--logo);color:#fff}
.dk-table{overflow:clip;border-radius:.8cqw;border:1px solid var(--line);background:#fff}
.dk-table table{width:100%;border-collapse:collapse}.dk-table th{background:var(--head);color:var(--head-ink);text-align:left;padding:.55em .8em;border-bottom:1px solid var(--head-line)}
.dk-table td{padding:.5em .8em;border-bottom:1px solid var(--card)}.dk-table tbody tr:hover td{background:var(--acc-bg)}
.dk-chart{display:grid;gap:.8em}.dk-chart-row{display:grid;grid-template-columns:24% 1fr;gap:1em;align-items:center}
.dk-chart-row>span{font-weight:700;color:var(--ink);text-align:right}.dk-chart-row p{margin:.15em 0;display:flex;align-items:center;gap:.6em}
.dk-bar{display:block;height:1.1em;border-radius:99px;background:var(--acc);transform-origin:0 50%;min-width:2px}.dk-bar.is-s1{background:var(--acc-lite)}.dk-bar.is-s2{background:var(--logo)}
.dk-chart-row em{font-style:normal;color:var(--ink2);white-space:nowrap}
.dk-compare{display:grid;grid-template-columns:1fr 1fr;gap:2cqw;height:100%}
.dk-side{padding:1.6cqw 2cqw;border-radius:1cqw;background:#fff;border:1px solid var(--line);border-top:.5cqw solid var(--logo)}.dk-side+.dk-side{border-top-color:var(--acc)}
.dk-side h3{margin:0 0 .5em;font-family:${f.htmlHead};font-weight:600;color:var(--logo)}.dk-side ul{margin:0;padding-left:1.1em;display:grid;gap:.4em}
.is-cover .dk-canvas{background:radial-gradient(120% 140% at 0% 0%,color-mix(in srgb,var(--acc) 55%,var(--logo)),var(--logo) 60%);color:#fff}
.dk-orb{position:absolute;border-radius:50%;filter:blur(2px);opacity:.55;background:radial-gradient(circle at 30% 30%,color-mix(in srgb,var(--acc-lite) 85%,#fff),transparent 65%)}
.dk-orb.is-a{width:46cqw;height:46cqw;right:-12cqw;top:-18cqw}.dk-orb.is-b{width:30cqw;height:30cqw;right:8cqw;bottom:-14cqw;opacity:.35}.dk-orb.is-c{width:22cqw;height:22cqw;left:-8cqw;bottom:-8cqw;opacity:.25}
.dk-kicker{font-weight:700;letter-spacing:.24em;text-transform:uppercase;opacity:.75;display:flex;align-items:flex-end}
.dk-cover-title{display:flex;align-items:center;line-height:1.02}.dk-cover-title b{font-family:${f.htmlHead};font-weight:600;letter-spacing:-.01em}
.dk-cover-sub{opacity:.82}
.dk-cover-meta{display:flex;flex-wrap:wrap;gap:.8em;align-items:center}.dk-cover-meta span{padding:.35em .9em;border-radius:99px;background:color-mix(in srgb,#fff 14%,transparent);border:1px solid color-mix(in srgb,#fff 22%,transparent)}
.dk-hint{position:fixed;left:50%;bottom:10px;transform:translateX(-50%);margin:0;padding:6px 12px;border-radius:99px;font-size:12px;color:#fff;background:color-mix(in srgb,var(--navy) 70%,transparent);backdrop-filter:blur(8px);z-index:20;white-space:nowrap;max-width:calc(100vw - 32px);overflow:clip;text-overflow:ellipsis}
.dk-zoom,.dk-overview{position:fixed;inset:0;z-index:50;display:none;place-items:center;padding:24px}
.dk-zoom:target,.dk-overview:target{display:grid}
.dk-scrim{position:absolute;inset:0;background:color-mix(in srgb,var(--navy) 78%,transparent);backdrop-filter:blur(6px)}
.dk-zoom-card{position:relative;margin:0;display:grid;grid-template-columns:minmax(0,1.25fr) minmax(260px,1fr);width:min(1100px,100%);max-height:calc(100vh - 48px);background:#fff;border-radius:18px;overflow:clip;box-shadow:0 40px 120px -30px rgba(0,0,0,.7)}
.dk-zoom-img{min-height:min(70vh,560px);background-color:var(--card);background-origin:content-box;padding:28px}
.dk-zoom-card figcaption{display:flex;flex-direction:column;gap:12px;padding:28px 28px 22px;overflow:auto}
.dk-zoom-card small{font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
.dk-zoom-card h3{margin:0;font:600 30px/1.05 ${f.htmlHead};color:var(--logo)}.dk-zoom-sub{margin:0;color:var(--ink2)}
.dk-zoom-card dl{margin:4px 0 0;display:grid;gap:0;border-top:1px solid var(--line)}
.dk-zoom-card dl div{display:grid;grid-template-columns:42% 1fr;gap:12px;padding:9px 0;border-bottom:1px solid var(--line)}
.dk-zoom-card dt{color:var(--muted);font-size:13px}.dk-zoom-card dd{margin:0;font-weight:700;color:var(--ink);font-size:15px;word-break:break-word}
.dk-zoom-card nav{margin-top:auto;display:flex;gap:8px;justify-content:space-between;padding-top:12px}
.dk-step,.dk-close{padding:8px 12px;border-radius:10px;font-size:13px;font-weight:700;text-decoration:none;background:var(--card);border:1px solid var(--line);transition:background .2s,transform .2s var(--ease)}
.dk-close{background:var(--logo);color:#fff;border-color:var(--logo)}
.dk-step:hover,.dk-close:hover,.dk-step:focus-visible,.dk-close:focus-visible{transform:translateY(-1px)}.dk-step.is-off{opacity:.35}
.dk-overview-panel{position:relative;width:min(980px,100%);max-height:calc(100vh - 48px);overflow:auto;background:#fff;border-radius:18px;padding:20px 22px;box-shadow:0 40px 120px -30px rgba(0,0,0,.7)}
.dk-overview-panel header{display:flex;justify-content:space-between;align-items:center;margin-bottom:14px}.dk-overview-panel header b{font:600 22px ${f.htmlHead};color:var(--logo)}
.dk-overview-panel ol{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:10px}
.dk-overview-panel li a{display:grid;grid-template-columns:auto 1fr;gap:2px 10px;padding:12px;border-radius:12px;border:1px solid var(--line);text-decoration:none;transition:transform .2s var(--ease),border-color .2s,box-shadow .2s}
.dk-overview-panel li a:hover,.dk-overview-panel li a:focus-visible{transform:translateY(-2px);border-color:var(--acc);box-shadow:0 12px 28px -18px rgba(0,0,0,.4)}
.dk-overview-panel li span{grid-row:span 2;display:grid;place-items:center;width:30px;height:30px;border-radius:8px;background:var(--logo);color:#fff;font-weight:700;font-size:13px}
.dk-overview-panel li b{font-size:14px;color:var(--ink);overflow:clip;text-overflow:ellipsis;white-space:nowrap}.dk-overview-panel li small{color:var(--muted);font-size:12px}
:focus-visible{outline:2px solid var(--acc-lite);outline-offset:2px}
@media (max-width:720px){.dk-slide{padding:62px 10px 24px}.dk-nav,.dk-hint{display:none}.dk-zoom-card{grid-template-columns:1fr}.dk-zoom-img{min-height:40vh}.dk-top-btn{display:none}}
@keyframes dk-rise{from{opacity:0;transform:translateY(26px) scale(.97)}to{opacity:1;transform:none}}
@keyframes dk-card{from{opacity:0;transform:translateY(22px) scale(.94)}to{opacity:1;transform:none}}
@keyframes dk-fade{from{opacity:0}to{opacity:1}}
@keyframes dk-grow{from{transform:scaleX(0)}to{transform:scaleX(1)}}
@keyframes dk-sheen{0%{transform:translateX(-110%)}55%,100%{transform:translateX(110%)}}
@keyframes dk-drift{0%{transform:translate3d(0,0,0) scale(1)}50%{transform:translate3d(-3cqw,2cqw,0) scale(1.08)}100%{transform:translate3d(2cqw,-2cqw,0) scale(1.02)}}
@keyframes dk-blur{from{opacity:0;filter:blur(8px);transform:translateY(16px)}to{opacity:1;filter:none;transform:none}}
@keyframes dk-pop{from{opacity:0;transform:translateY(18px) scale(.96)}to{opacity:1;transform:none}}
@keyframes dk-progress{to{transform:scaleX(1)}}
@keyframes dk-dot{0%,100%{background:#fff;transform:scale(1.6)}}
@media (prefers-reduced-motion:no-preference){
.dk-orb.is-a{animation:dk-drift 16s ease-in-out infinite alternate}.dk-orb.is-b{animation:dk-drift 22s ease-in-out infinite alternate-reverse}.dk-orb.is-c{animation:dk-drift 19s ease-in-out infinite alternate}
.dk-band::after{animation:dk-sheen 7s var(--ease) infinite 1.2s}
.dk-zoom:target .dk-scrim,.dk-overview:target .dk-scrim{animation:dk-fade .3s ease both}
.dk-zoom:target .dk-zoom-card,.dk-overview:target .dk-overview-panel{animation:dk-pop .45s var(--ease) both}
.dk-zoom:target .dk-zoom-img{animation:dk-blur .6s var(--ease) both .08s}
.dk-zoom:target dl div{animation:dk-pop .45s var(--ease) both}.dk-zoom:target dl div:nth-child(2){animation-delay:.05s}.dk-zoom:target dl div:nth-child(3){animation-delay:.1s}.dk-zoom:target dl div:nth-child(4){animation-delay:.15s}.dk-zoom:target dl div:nth-child(n+5){animation-delay:.2s}
.dk-slide:first-child .dk-kicker{animation:dk-blur .8s var(--ease) both .1s}.dk-slide:first-child .dk-cover-title{animation:dk-blur 1s var(--ease) both .25s}.dk-slide:first-child .dk-cover-sub{animation:dk-blur 1s var(--ease) both .45s}.dk-slide:first-child .dk-cover-meta{animation:dk-blur 1s var(--ease) both .6s}
@supports (animation-timeline:view()){
.dk-progress{animation:dk-progress linear both;animation-timeline:scroll(root)}
.dk-canvas{animation:dk-rise linear both;animation-timeline:view();animation-range:entry 0% cover 35%}
.dk-band-text{animation:dk-blur linear both;animation-timeline:view();animation-range:entry 20% cover 40%}
.dk-band-rule,.dk-rule{animation:dk-grow linear both;animation-timeline:view();animation-range:entry 30% cover 45%}
.dk-label,.dk-frame{animation:dk-fade linear both;animation-timeline:view();animation-range:entry 20% cover 38%}
.dk-card{animation:dk-card linear both;animation-timeline:view();animation-range:entry calc(5% + var(--i) * 4%) cover calc(28% + var(--i) * 3%)}
.dk-kpi,.dk-side,.dk-bullets li,.dk-chart-row,.dk-table tr{animation:dk-pop linear both;animation-timeline:view();animation-range:entry calc(10% + var(--i,0) * 5%) cover calc(30% + var(--i,0) * 4%)}
.dk-bar{animation:dk-grow linear both;animation-timeline:view();animation-range:entry 30% cover 50%}
.dk-note,.dk-callout{animation:dk-fade linear both;animation-timeline:view();animation-range:entry 30% cover 45%}
.dk-slide:not(:first-child) .dk-cover-title,.dk-slide:not(:first-child) .dk-kicker,.dk-slide:not(:first-child) .dk-cover-sub{animation:dk-blur linear both;animation-timeline:view();animation-range:entry 15% cover 40%}
.dk-dot{animation:dk-dot linear;animation-timeline:var(--tl);animation-range:cover 35% cover 65%}
}
}
@media print{
@page{size:${W}pt ${H}pt;margin:0}
html{scroll-snap-type:none}body{background:#fff}
.dk-top,.dk-nav,.dk-hint,.dk-progress,.dk-zoom,.dk-overview,.dk-more{display:none!important}
.dk-slide{display:block;min-height:0;padding:0;break-after:page}
.dk-canvas{width:${W}pt;border-radius:0;box-shadow:none}
*,*::before,*::after{animation:none!important;transition:none!important}
}`;
}

module.exports = { buildDeck, MAX_ZOOMS };
