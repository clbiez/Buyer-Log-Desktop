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
