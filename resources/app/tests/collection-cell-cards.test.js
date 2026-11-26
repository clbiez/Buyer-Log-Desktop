'use strict';
/* Ortak hücre kartları: Kumaş (Koleksiyon/CP/Siparişler) ve Koleksiyon Durum rozeti
   Artwork ile aynı kart dilini kullanır (ürün kararı 2026-11). */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const PUBLIC = path.join(__dirname, '..', 'public');
const APP = fs.readFileSync(path.join(PUBLIC, 'app-main.js'), 'utf8');
const LAYOUT = fs.readFileSync(path.join(PUBLIC, 'app.css'), 'utf8');
const SEGMENTS = require('../public/fabric-card-segments.js');

function chipsFn() {
  const start = APP.indexOf('function fabricCardChipsHtml(');
  const end = APP.indexOf('\n}\n', start) + 2;
  const context = vm.createContext({
    window: { BLFabricSegments: SEGMENTS },
    norm: s => String(s == null ? '' : s).trim(),
    escapeHtml: s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])),
  });
  vm.runInContext(APP.slice(start, end), context);
  return context.fabricCardChipsHtml;
}

test('fabric card renders type|weight chip, separate composition chip and green sustainability tag', () => {
  const chips = chipsFn()({ details: { sustainability: 'BCI' } }, 'İnterlok · 30/1 Ne · 190 gsm · %100 Pamuk');
  assert.equal(chips.head, '<span class="blCellChip"><b>İnterlok</b><i>190 gsm</i></span><span class="blCellTag" data-tone="eco">BCI</span>');
  assert.equal(chips.mix, '<span class="blCellChip isShrink"><b>%100 Pamuk</b></span>');
  assert.doesNotMatch(chips.head + chips.mix, /30\/1 Ne/, 'yarn stays in the tooltip/card, not in the cell');
});

test('fabric card escapes text and falls back to the plain summary when it is not four segments', () => {
  const fn = chipsFn();
  assert.equal(fn({}, 'Serbest özet metni'), null);
  const chips = fn({}, '<b>X</b> · 1 · 2 gsm · %5 <i>');
  assert.match(chips.head, /&lt;b&gt;X&lt;\/b&gt;/);
  assert.match(chips.mix, /%5 &lt;i&gt;/);
});

test('fabric cell: single fabric → code + type|weight, composition below; A/B → one line per part', () => {
  const block = APP.slice(APP.indexOf('function fabricCardCellParts('), APP.indexOf('function kolFabricCellHtml('));
  assert.match(block, /list\.length===1\s*\?`<div class="kolFabricLine hasCard blCellLine">\$\{label\}<span class="blCellBody">\$\{code\}\$\{chips\.head\}<\/span><\/div>\$\{chips\.mix\?`<div class="kolFabricLine hasCard blCellLine"><span class="blCellBody">\$\{chips\.mix\}/);
  assert.match(block, /:`<div class="kolFabricLine hasCard blCellLine">\$\{label\}<span class="blCellBody">\$\{code\}\$\{chips\.head\}\$\{chips\.mix\}<\/span><\/div>`\)/);
  assert.match(block, /<span class="blCellChip isCode"><b>\$\{escapeHtml\(part\.code\)\}<\/b><\/span>/);
  assert.match(block, /:`<div class="kolFabricLine\$\{card\?' hasCard':''\}">/, 'cards without segments keep the plain summary line');
  assert.match(LAYOUT, /:is\(#kolTable,#cpTable,#ordersTable,\.pdMatrix\) tbody \.blCellChip\.isShrink b\{overflow:hidden;text-overflow:ellipsis\}/);
});

test('status badge keeps the full label in its tooltip, also after a live change', () => {
  assert.match(APP, /<select class="editCell kolStatusNoArrow" data-id="\$\{r\.id\}" data-k="\$\{c\.k\}" title="\$\{statusRender\.title\(statusValue\)\}"/, 'render uses the per-paint snapshot, not a catalog rescan');
  const fn = APP.slice(APP.indexOf('function kolApplyStatusCellAppearance('), APP.indexOf('function kolStatusDisplayLabel('));
  assert.match(fn, /if\(el\.tagName==='SELECT'\)el\.title=kolStatusDisplayLabel\(name\);/);
});

/* ---- Fiyat özetleri: alt alta ortak kart dili ---- */
function stripFn(model) {
  const start = APP.indexOf('function kolPriceStripCellHtml(');
  const end = APP.indexOf('\nfunction ', start + 1);
  const context = vm.createContext({
    appLang: 'tr', norm: s => String(s == null ? '' : s).trim(),
    escapeHtml: s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])),
    kolFormatMoneyDisplay: v => Number(v).toFixed(2).replace('.', ','),
    kolPriceStripModel: () => model,
  });
  vm.runInContext(APP.slice(start, end), context);
  return context.kolPriceStripCellHtml;
}
const offers = [{ name: 'DEMO A', price: 3.7 }, { name: 'DEMO B', price: 3.9 }];

test('Quotes & Approval stacks Supp. FOB + %, FOB only when costs apply, then the manufacturer box', () => {
  const confirmed = stripFn({ offers, target: 3.6, confirmed: { name: 'DEMO A', price: 3.7 }, main: { name: 'DEMO A', price: 3.7 }, delta: { text: '+2,8%', meetsTarget: false }, fob: 3.98, status: { waiting: 1 } })({ id: 7 }, '');
  assert.match(confirmed, /Supp\. FOB<\/span><b class="blCellValue isStrong">\$3,70<\/b><span class="blCellTag" data-tone="bad">\+2,8%<\/span>/);
  assert.match(confirmed, /FOB<\/span><b class="blCellValue">\$3,98<\/b><span class="blCellNone">\+ masraf<\/span>/);
  assert.match(confirmed, /<span class="blCellMfr isConfirmed"><em>✓ Onaylı<\/em><b>DEMO A<\/b><\/span><span class="blCellTag" data-tone="4">1 bekliyor<\/span><span class="blCellTotal"[^>]*>2<\/span>/);
  assert.ok(confirmed.indexOf('Supp. FOB') < confirmed.indexOf('>FOB<') && confirmed.indexOf('>FOB<') < confirmed.indexOf('blCellMfr'), 'order: Supp. FOB → FOB → manufacturer');
  assert.match(confirmed, /data-kol-drawer-open="7"/, 'price drawer button stays');

  const best = stripFn({ offers, target: 4, confirmed: null, main: { name: 'DEMO A', price: 3.7 }, delta: { text: '−7,5%', meetsTarget: true }, fob: 3.7, status: null })({ id: 8 }, '');
  assert.match(best, /<b class="blCellValue isSoft">\$3,70<\/b><span class="blCellTag" data-tone="good">/);
  assert.match(best, /<span class="blCellMfr"><em>Öneri<\/em><b>DEMO A<\/b>/);
  assert.doesNotMatch(best, />FOB</, 'no costs → no FOB line');

  const none = stripFn({ offers: [], target: 4.5, confirmed: null, main: null, delta: null, fob: 4.5, status: null })({ id: 9 }, '');
  assert.match(none, /Teklif yok/);
  assert.match(none, /FOB<\/span><b class="blCellValue">\$4,50<\/b><span class="blCellNone">hedef<\/span>/);
});

test('Landed summary and Endeksmatik stack OS/TR lines; references carry their own % per line', () => {
  const landed = APP.slice(APP.indexOf('function kolLandedSummaryCellHtml('), APP.indexOf('\nfunction ', APP.indexOf('function kolLandedSummaryCellHtml(') + 1));
  assert.match(landed, /<div class="kolLs blCellStack"><span class="blCellStackLabel">\$\{escapeHtml\(en\?'OS':'YD'\)\}<\/span><b class="blCellValue">\$\{escapeHtml\(yd\)\}<\/b>\$\{profitTag\}<span class="blCellStackLabel">TR<\/span>/);
  assert.match(landed, /data-tone="\$\{profit>0\?'good':profit<0\?'bad':'4'\}"/, 'positive overseas advantage is good');
  const ek = APP.slice(APP.indexOf('function endeksmatikCellHtml('), APP.indexOf('\nasync function refreshEndeksmatikStatus'));
  assert.match(ek, /<span class="blCellStack">\$\{line\(appLang==='en'\?'OS':'YD',usd,result\.indexes&&result\.indexes\.targetUsd\)\}\$\{line\('TR',tr,result\.indexes&&result\.indexes\.targetTl\)\}<\/span>/);
  const lfl = fs.readFileSync(path.join(PUBLIC, 'collection-lfl.js'), 'utf8');
  assert.match(lfl, /<span class="blCellStackRow" title="\$\{esc\(m\.detail\)\}"><span class="blCellStackLabel">\$\{esc\(labelFor\(key\)\)\}<\/span><b class="blCellValue/);
  assert.match(lfl, /data-tone="\$\{m\.percent<=0\?'good':'bad'\}">\$\{esc\(m\.percentText\)\}/);
  assert.match(LAYOUT, /:is\(#kolTable,#cpTable,#ordersTable,\.pdMatrix\) tbody \.blCellStack\{display:grid;grid-template-columns:auto auto auto/);
});
