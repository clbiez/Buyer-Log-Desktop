'use strict';
// Sunum Oluştur: Koleksiyon, CP ve Siparişler aynı Presentation Studio'yu açar;
// eski "kayıtlardan stüdyo" yolu (openSelection/createStudio/output-studio uç noktası) kaldırıldı.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('üç Sunum Oluştur düğmesi Presentation Studio’yu tembel yükleyip açar', () => {
  const html = read('public/index.html'), app = read('public/app-main.js');
  for (const tab of ['cp', 'orders', 'koleksiyon']) assert.match(html, new RegExp(`data-output-studio="${tab}"`));
  const handler = app.slice(app.indexOf("const button = event.target.closest('[data-output-studio]');"), app.indexOf("const button = event.target.closest('[data-output-studio]');") + 600);
  assert.match(handler, /ensureFeature\('presentationStudio'\)/);
  assert.match(handler, /BLPresentationStudio\.openSelection\(button\.dataset\.outputStudio\)/);
  assert.doesNotMatch(handler, /BLOutputEditor/);
  const studio = read('public/presentation-studio.js');
  for (const [tab, module] of [['koleksiyon', 'collection'], ['cp', 'cp'], ['orders', 'orders']]) assert.match(studio, new RegExp(`${tab}: \\{ module: '${module}'`));
  assert.doesNotMatch(studio, /data-ps="classic"|Klasik düzenleyici/);
});

test('eski sunum stüdyosu tamamen kaldırıldı; LCW AI çıktı düzenleyicisi yalnız içerik ve önizleme sunar', () => {
  const editor = read('public/lcwai-output-editor.js'), assistant = read('public/lcwai-assistant.js'), routes = read('server/routes/lcwai-routes.js'), service = read('server/lib/lcwai-output/output-service.js');
  const layout = read('public/lcwai-output-layout.js'), pptx = read('server/lib/lcwai-output/output-pptx.js'), prompt = read('server/lib/lcwai/lcwai-prompt.js');
  assert.doesNotMatch(editor, /function openSelection|data-studio|sourceTab|isStudio|data-ed-mode="layout"|studio/i);
  assert.match(editor, /window\.BLOutputEditor = \{ open, close:/);
  assert.doesNotMatch(assistant, /createStudio|saveStudioImages|\/api\/lcwai\/output-studio/);
  assert.doesNotMatch(routes, /\/api\/lcwai\/output-studio/);
  assert.doesNotMatch(service, /createStudio|saveStudioImages|renderStudio|buildDeck|studioSource/);
  assert.doesNotMatch(layout + pptx, /studio/i);
  assert.doesNotMatch(prompt, /'output-studio'/);
  for (const gone of ['server/lib/lcwai-output/output-deck.js', 'public/lcwai-output-layout-worker.js']) assert.equal(fs.existsSync(path.join(__dirname, '..', gone)), false, gone);
  // Kayıtlardan oluşturulmuş eski taslak yeniden çizilmez (kartlar sessizce kırpılırdı); açık bir hata döner.
  assert.match(service, /if \(draft\.source\) throw lcwAiError\('OUTPUT_LEGACY_STUDIO'\)/);
  assert.match(read('public/lcwai-assistant.js'), /LCWAI_OUTPUT_LEGACY_STUDIO: \{ tr: 'Bu sunum taslağı kaldırılan eski/);
  assert.match(read('server/lib/lcwai/lcwai-errors.js'), /OUTPUT_LEGACY_STUDIO: \{ status: 410, tr: '[^']+', en: '[^']+' \}/);
  assert.match(read('public/lcwai-chat.js'), /ensureFeature\('lcwaiOutputEditor'\)/);
});

test('uzun alan listeleri (gruplama seviyesi, kart bilgileri) okunur ve aranabilir', () => {
  const css = read('public/presentation-studio.css'), studio = read('public/presentation-studio.js');
  // Kaydırılan flex listede düğmeler küçülüp üst üste binmez (min-height:0 + flex-shrink regresyonu).
  assert.match(css, /\.psMenu>\.tbtn,\.psOptions>\.tbtn\{flex:none;/);
  assert.match(css, /\.psField\{flex:none;/);
  for (const kind of ['level', 'fields']) {
    const start = studio.indexOf(`kind === '${kind}'`), block = studio.slice(start, studio.indexOf('} else if', start + 20));
    assert.match(block, /searchBox\(/, kind + ' arama kutusu');
    assert.match(block, /data-q="/, kind + ' aranabilir satırlar');
  }
  assert.match(studio, /function filterPop\(\)/);
  assert.match(studio, /const fold = s => String\(s \|\| ''\)\.toLocaleLowerCase\('tr'\)\.normalize\('NFD'\)/);
  assert.match(studio, /if \(t\.dataset\.ps === 'search'\) \{ S\.popQuery = t\.value; filterPop\(\); return; \}/);
});

test('çip görünümü: Kumaş/Artwork yapısal modeli tablodaki kartlarla aynı kaynaktan; üst çubukta Çip/Metin seçeneği', () => {
  const app = read('public/app-main.js'), art = read('public/collection-artwork-detail.js'), studio = read('public/presentation-studio.js');
  assert.match(app, /function fabricCardCellModel\(val\)\{/);
  assert.match(app, /window\.BLCellChips=Object\.freeze\(\{\n  columns:Object\.freeze\(\{koleksiyon:Object\.freeze\(\{fabric:'fabric',artworkDetail:'artwork'\}\),cp:Object\.freeze\(\{\[CP_FABRIC_PLM_KEY\]:'fabric'\}\),orders:/);
  assert.match(art, /function cellModel\(row, value\) \{/);
  assert.match(art, /    cellCards,\n    cellModel,\n/);
  assert.match(studio, /<span class="psSeg" data-ps="chipMode"><button type="button" data-v="chips"><\/button><button type="button" data-v="text"><\/button><\/span>/);
  assert.match(studio, /L\('Çip', 'Chips'\)/); assert.match(studio, /L\('Metin', 'Text'\)/);
  assert.match(studio, /\$\('\[data-ps="chipModeWrap"\]'\)\.hidden = !chipsInUse\(\);/);
  // Kaynak satır yalnız okunur.
  assert.doesNotMatch(studio.slice(studio.indexOf('function chipModel'), studio.indexOf('const chipsInUse')), /m\.row\[[^\]]+\]\s*=[^=]/);
});
