'use strict';

/* Bileşen sözleşmeleri (DESIGN_SYSTEM.md §7) — 2026-10-15 arayüz denetimi.
   Denetimde bağımsız eylem düğmeleri 10 farklı yükseklikte, segment/sekme
   bileşenleri 9 ayrı stilde ve KPI kartları 4 ayrı tipografide bulundu.
   Tüm görünümler ortak Manifest bileşenlerini kullanır.
   Manifest bileşenleri ui-components.css ve ui-manifest-contract.test.js ile denetlenir. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PUBLIC = path.join(__dirname, '..', 'public');
const read = file => fs.readFileSync(path.join(PUBLIC, file), 'utf8');
const EXPERIENCE = read('experience.css');
const SHARED=read('ui-components.css').replace(/:root\[data-ui-system="manifest"\]/g,':root').replace(/html\[data-ui-system="manifest"\] /g,'').replace(/\s*\{/g,'{');
const APP_CSS = read('app.css');
const ALL_CSS = fs.readdirSync(PUBLIC).filter(f => f.endsWith('.css')).map(read).join('\n').replace(/\/\*[\s\S]*?\*\//g, '');

function ruleFor(selectorStart) {
  const blocks=[EXPERIENCE,SHARED].flatMap(source=>{
    const i=source.indexOf(selectorStart);return i<0?[]:[source.slice(i,source.indexOf('}',i))];
  });
  assert.ok(blocks.length, `${selectorStart} sözleşmesi bulunamadı`);
  return blocks.join(';');
}

test('Küçük kontrol yüksekliği ana ölçekten türetilir ve arayüz boyutuyla büyür', () => {
  assert.match(read('ui-tokens.css'), /--ui-control-height-small:calc\(var\(--ui-control-height\) - 4px\);/);
  for(const scale of ['compact','standard','large','xl'])assert.ok(read('ui-tokens.css').includes('data-ui-scale="'+scale+'"'));
});

test('Düğme L ve S tek yükseklik, tek yazı ölçüsü kullanır', () => {
  const large = ruleFor(':root :is(.psaGhostBtn,.mfpBtn,.cpaBtn:not(.sm),.aoButton,.dmViewBtn,.lcBtn:not(.sm)){');
  assert.match(large, /height:var\(--ui-control-height\)/);
  assert.match(large, /font-size:var\(--ui-font-xs\)[^}]*font-weight:600/);
  const small = ruleFor(':root :is(.cpaBtn.sm,.ovClockManageBtn,.bpaTodayBtn,.lflCpTableTool');
  assert.match(small, /height:var\(--ui-control-height\)/);
  assert.match(small, /font-size:var\(--ui-font-xs\)[^}]*font-weight:600/);
});

test('Segment bileşenleri tek görünüm ve tek aktif durum paylaşır', () => {
  const groups=['.bpaSeg2','.cpaSeg','.gfSegment','.backlogChartTypeSwitch','.lcwaiSeg','.dmViewToggle','.lcSeg'];
  assert.match(ruleFor(`:root :is(${groups.join(',')})>button{`), /height:var\(--ui-control-height\)/);
  for(const group of groups){
    for(const state of ['.is-active','.is-on','.active','.isActive','[aria-pressed="true"]','[aria-selected="true"]'])
      assert.match(ruleFor(`:root ${group}>button${state}`), /background:var\(--ui-accent\) !important;color:var\(--ui-on-accent\)/);
  }
});

test('Filtre çipi ve sayfa sekmesi ayrı, tutarlı iki dil kullanır', () => {
  assert.match(ruleFor(':root :is(.ovBreakdownDims>button,.quotationStatusTabs>button,.mfpStats>.mfpStat,.sourceModeGroup>.sourceModeBtn,.lcChip,.kolHealthChip).isActive'), /background:var\(--ui-selected\) !important;color:var\(--ui-selected-ink\)/);
  const tab = ruleFor(':root :is(.ovHomePager>.ovHomePageTab,.psaTabs>[role="tab"],.dmLabTabs>.dmLabTab).isActive');
  assert.match(tab, /background:transparent !important;color:var\(--ui-selected-ink\)/);
});

test('KPI etiket, değer ve alt satırı her modülde aynı tipografiyle çizilir', () => {
  assert.match(ruleFor(':root :is(.cpaChip .l,.gfKpi>span,.bdaKpiLabel'), /font-size:var\(--ui-font-xs\)[^}]*font-weight:600[^}]*letter-spacing:0[^}]*text-transform:none/);
  const value = ruleFor(':root :is(.cpaChip .n,.bdaKpiValue,.bpaTileValue,.psaKpi strong,.pricingMetric b)');
  assert.match(value, /font-family:var\(--ui-font-body\)[^}]*font-size:var\(--ui-font-2xl\)[^}]*font-weight:700/);
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

test('Manifest shared controls consume canonical UI tokens, not the temporary bridge',()=>{
  const manifest=read('ui-components.css');
  assert.match(manifest,/height:var\(--ui-control-height\)/);
  assert.match(manifest,/font-size:var\(--ui-font-xs\)/);
  assert.match(manifest,/\[data-ui-variant="primary"\]/);
  assert.doesNotMatch(manifest,/var\(--(?:acc|card|ink|fs-|sans|head|mono)/);
  assert.equal(fs.existsSync(path.join(PUBLIC,'ui-legacy-bridge.css')),false);
});

test('A single shared reset replaces repeated zero borders, radii and shadows',()=>{
  assert.match(read('ui-components.css'),/:where\(body,body \*\)\{border:0;border-radius:var\(--ui-radius\);box-shadow:none;text-shadow:none;/);
});
