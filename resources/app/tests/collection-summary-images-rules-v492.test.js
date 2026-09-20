'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const INDEX = (fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8') + '\n' + fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8'));
const CSS = fs.readFileSync(path.join(ROOT, 'public', 'app.css'), 'utf8');
const OPEN_COSTING = fs.readFileSync(path.join(ROOT, 'public', 'open-costing.js'), 'utf8');

function between(source, start, end) {
  const a = source.indexOf(start);
  const b = source.indexOf(end, a + start.length);
  assert.ok(a >= 0, `${start} not found`);
  assert.ok(b > a, `${end} not found`);
  return source.slice(a, b);
}

test('v4.92 Collection footer shows weighted and arithmetic averages for price and landed columns', () => {
  const block = between(INDEX, 'function kolWeightedAverage(', '// Aynı satırdaki geçerli');
  assert.match(block, /function kolArithmeticAverage\(/);
  assert.match(block, /function kolAverageFooter\(weightedValue,arithmeticValue,label\)/);
  assert.match(block, /landedByRow=new Map/);
  assert.match(block, /ydLandedGetter=row=>landedByRow\.get\(row\)\?\.ydLanded/);
  assert.match(block, /trLandedGetter=row=>landedByRow\.get\(row\)\?\.trLanded/);
  assert.match(block, /d\.k==='ydLanded'[\s\S]*?kolAverageFooter\(ydLandedAvg,ydLandedArithmetic/);
  assert.match(block, /d\.k==='trLanded'[\s\S]*?kolAverageFooter\(trLandedAvg,trLandedArithmetic/);
  assert.match(CSS, /collectionAverageLine/);
});

test('v4.92 Collection suggestion dropdown is a singleton and generic suggestion panels ignore Collection cells', () => {
  const block = between(INDEX, 'let _kolCatalogDrop', 'function migrateKolRow');
  assert.match(block, /querySelectorAll\('\.kolCatalogDrop'\)/);
  assert.match(block, /id='kolCatalogDropSingleton'/);
  assert.match(block, /closeSubmfrDrop\(\)/);
  assert.match(INDEX, /kind==='submfr' && !e\.target\.classList\.contains\('kolSuggestCell'\)/);
  assert.match(INDEX, /kind==='licensor' && !e\.target\.classList\.contains\('kolSuggestCell'\)/);
  assert.match(INDEX, /kind==='license' && !e\.target\.classList\.contains\('kolSuggestCell'\)/);
});

test('v4.92 image removal uses an anchored confirmation popover in Collection, CP and Open Costing', () => {
  const block = between(INDEX, 'let _imageDeleteConfirmPopover=', 'async function cpDeleteImageRef');
  assert.match(block, /function openImageDeleteConfirm\(anchorEl/);
  assert.match(block, /anchorEl\.getBoundingClientRect\(\)/);
  assert.match(block, /imageDeleteConfirmPopover/);
  assert.match(INDEX, /openImageDeleteConfirm\(img,\{message:appLang==='en'\?'Remove this CP image\?'/);
  assert.match(INDEX, /img\.addEventListener\('contextmenu'[\s\S]*?openImageDeleteConfirm\(img,\{message:appLang==='en'\?'Remove this Collection image\?'/);
  assert.match(OPEN_COSTING, /addEventListener\('contextmenu'[\s\S]*?BLConfirmImageDelete/);
  assert.match(CSS, /\.imageDeleteConfirmPopover\{/);
});

test('v4.92 Collection body values are left-aligned and vertically centered', () => {
  assert.match(CSS, /#kolTable tbody td\{[\s\S]*?vertical-align:middle!important;[\s\S]*?text-align:left!important;/);
  assert.match(CSS, /#kolTable tbody \.editCell,[\s\S]*?text-align:left!important;/);
  assert.match(CSS, /#kolTable tbody td\.kolPictureCell\{[\s\S]*?text-align:center!important;[\s\S]*?vertical-align:middle!important;/);
  assert.match(CSS, /#kolTable tbody td\.kolPictureCell \.kolThumb\{[\s\S]*?margin-left:auto!important;[\s\S]*?margin-right:auto!important;/);
});

test('v4.92 License Royalty Rules lives under Source Settings and is removed from the CP action bar', () => {
  /* v7.81: "Kaynak Veri" ayarlar menüsü kaldırıldı; License Royalty artık
     Veri Yönetimi → Araçlar → Hesaplama kuralları altında. Korunan karar aynı:
     kural CP eylem çubuğunda DEĞİL, yapılandırmanın yanında. */
  const sourceMenu = fs.readFileSync(path.join(ROOT, 'public', 'data-management.js'), 'utf8');
  assert.match(sourceMenu, /id: 'royalty'/);
  assert.match(sourceMenu, /openSuppFobRulesModal\(\)/);
  // Etiket korunur; yalnız artık bir düğme metni değil, araç satırının adı.
  assert.match(sourceMenu, /'License Royalty'/);
  assert.doesNotMatch(INDEX, /id="cpSuppFobRulesBtn"/);
  // Bağlama tek kimliğe değil, [data-license-royalty] özniteliğine geçti:
  // aynı ekranı açan birden fazla giriş noktası artık tek yerden bağlanıyor.
  /* v7.81: Kaynak Veri düğmesi kalktı. Korunan asıl karar — bağlamanın tek
     kimliğe değil [data-license-royalty] özniteliğine dayanması — CP / Orders /
     Collection Tools menülerindeki düğmelerde aynen sürüyor. */
  assert.match(INDEX, /data-license-royalty/);
  assert.doesNotMatch(INDEX, /id="licenseRoyaltyRulesBtn"/);
  assert.match(INDEX, /document\.querySelectorAll\('\[data-license-royalty\]'\)\.forEach\(button=>button\.addEventListener\('click'/);
  assert.match(INDEX, /id="_suppFobRulesTitle">License Royalty Calculations</);
});
