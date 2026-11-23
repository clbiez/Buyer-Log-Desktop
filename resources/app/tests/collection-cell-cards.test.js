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
  assert.match(LAYOUT, /:is\(#kolTable,#cpTable,#ordersTable\) tbody \.blCellChip\.isShrink b\{overflow:hidden;text-overflow:ellipsis\}/);
});

test('status badge keeps the full label in its tooltip, also after a live change', () => {
  assert.match(APP, /<select class="editCell kolStatusNoArrow" data-id="\$\{r\.id\}" data-k="\$\{c\.k\}" title="\$\{statusRender\.title\(statusValue\)\}"/, 'render uses the per-paint snapshot, not a catalog rescan');
  const fn = APP.slice(APP.indexOf('function kolApplyStatusCellAppearance('), APP.indexOf('function kolStatusDisplayLabel('));
  assert.match(fn, /if\(el\.tagName==='SELECT'\)el\.title=kolStatusDisplayLabel\(name\);/);
});
