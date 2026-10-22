'use strict';

/* Bileşen sözleşmeleri (DESIGN_SYSTEM.md §7) — 2026-10-15 arayüz denetimi.
   Denetimde bağımsız eylem düğmeleri 10 farklı yükseklikte, segment/sekme
   bileşenleri 9 ayrı stilde ve KPI kartları 4 ayrı tipografide bulundu.
   Eşdeğer bileşenler experience.css'teki tek sözleşme kuralında toplanır. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PUBLIC = path.join(__dirname, '..', 'public');
const read = file => fs.readFileSync(path.join(PUBLIC, file), 'utf8');
const EXPERIENCE = read('experience.css');
const APP_CSS = read('app.css');
const ALL_CSS = fs.readdirSync(PUBLIC).filter(f => f.endsWith('.css')).map(read).join('\n').replace(/\/\*[\s\S]*?\*\//g, '');

function ruleFor(selectorStart) {
  const i = EXPERIENCE.indexOf(selectorStart);
  assert.notEqual(i, -1, `${selectorStart} sözleşmesi bulunamadı`);
  return EXPERIENCE.slice(i, EXPERIENCE.indexOf('}', i));
}

test('Küçük kontrol yüksekliği ana ölçekten türetilir ve arayüz boyutuyla büyür', () => {
  assert.match(APP_CSS, /--ctl-h-sm:calc\(var\(--ctl-h\) - 8px\);/);
});

test('Düğme L ve S tek yükseklik, tek yazı ölçüsü kullanır', () => {
  const large = ruleFor(':root :is(.psaGhostBtn,.mfpBtn,.cpaBtn:not(.sm),.aoButton,.dmViewBtn,.lcBtn:not(.sm)){');
  assert.match(large, /height:var\(--ctl-h\)/);
  assert.match(large, /font-size:var\(--fs-xs\);font-weight:600/);
  const small = ruleFor(':root :is(.cpaBtn.sm,.ovClockManageBtn,.bpaTodayBtn,.lflCpTableTool');
  assert.match(small, /height:var\(--ctl-h-sm\)/);
  assert.match(small, /font-size:var\(--fs-xs\);font-weight:600/);
});

test('Segment bileşenleri tek görünüm ve tek aktif durum paylaşır', () => {
  const group = '.bpaSeg2,.cpaSeg,.gfSegment,.backlogChartTypeSwitch,.lcwaiSeg,.dmViewToggle,.lcSeg';
  assert.match(ruleFor(`:root :is(${group})>button{`), /height:var\(--ctl-h-sm\)/);
  assert.match(ruleFor(`:root :is(${group})>button:is(.is-active,.is-on,.active,.isActive`), /background:var\(--acc\);color:var\(--on-acc\)/);
});

test('Filtre çipi ve sayfa sekmesi ayrı, tutarlı iki dil kullanır', () => {
  assert.match(ruleFor(':root :is(.ovBreakdownDims>button,.quotationStatusTabs>button,.mfpStats>.mfpStat,.sourceModeGroup>.sourceModeBtn,.lcChip):is('), /background:var\(--acc-bg\);color:var\(--acc-ink\)/);
  const tab = ruleFor(':root :is(.ovHomePager>.ovHomePageTab,.psaTabs>[role="tab"],.dmLabTabs>.dmLabTab):is(');
  assert.match(tab, /border-bottom-color:var\(--acc\);background:transparent/);
});

test('KPI etiket, değer ve alt satırı her modülde aynı tipografiyle çizilir', () => {
  assert.match(ruleFor(':root :is(.cpaChip .l,.gfKpi>span,.bdaKpiLabel'), /font-size:var\(--fs-xs\);font-weight:600;letter-spacing:0;text-transform:none/);
  const value = ruleFor(':root :is(.cpaChip .n,.bdaKpiValue,.bpaTileValue,.psaKpi strong,.pricingMetric b){');
  assert.match(value, /font-family:var\(--sans\);font-size:var\(--fs-2xl\);font-weight:700/);
  assert.match(value, /tabular-nums/);
});

test('Sayfa başlığı üst çubukta bir kez yazılır', () => {
  assert.doesNotMatch(read('price-supplier-analysis.js'), /<div class="psaTitle"><h2>/);
  assert.doesNotMatch(read('license-cards.js'), /<span class="lcEyebrow">Buyer Log<\/span><h1>/);
});

test('hidden özelliği taşıyan öğeyi sınıfının display değeri görünür bırakmaz', () => {
  assert.match(read('lfl.css'), /\.lflLoadingState\[hidden\]\{display:none\}/);
  const html = read('index.html');
  const leaks = [];
  for (const match of html.matchAll(/<(\w+)\b([^>]*)>/g)) {
    const attrs = match[2];
    if (!/(^|\s)hidden(\s|=|\/|$)/.test(attrs)) continue;
    const cls = (attrs.match(/class="([^"]+)"/) || [])[1];
    for (const name of (cls || '').split(/\s+/).filter(Boolean)) {
      const esc = name.replace(/[-]/g, '\\-');
      const shows = new RegExp(`(?<![\\w-])\\.${esc}\\s*\\{[^}]*display\\s*:\\s*(?!none)`).test(ALL_CSS);
      const guarded = new RegExp(`\\.${esc}\\[hidden\\]`).test(ALL_CSS);
      if (shows && !guarded) leaks.push(name);
    }
  }
  assert.deepEqual(leaks, [], 'sınıf display tanımlıyorsa .sınıf[hidden]{display:none} kuralı da olmalı');
});
