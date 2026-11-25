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

test('eski kayıtlardan stüdyo oluşturma yolu geri gelmez; LCW AI çıktı düzenleyicisi korunur', () => {
  const editor = read('public/lcwai-output-editor.js'), assistant = read('public/lcwai-assistant.js'), routes = read('server/routes/lcwai-routes.js'), service = read('server/lib/lcwai-output/output-service.js');
  assert.doesNotMatch(editor, /function openSelection|data-studio-scope|sourceTab/);
  assert.match(editor, /window\.BLOutputEditor = \{ open, close:/);
  assert.doesNotMatch(assistant, /createStudio|saveStudioImages|\/api\/lcwai\/output-studio/);
  assert.doesNotMatch(routes, /\/api\/lcwai\/output-studio/);
  assert.doesNotMatch(service, /function createStudio|saveStudioImages/);
  assert.match(service, /function renderStudio\(/, 'mevcut stüdyo düzenli taslaklar ve LCW AI çıktıları için çizim yolu kalır');
  assert.match(read('public/lcwai-chat.js'), /ensureFeature\('lcwaiOutputEditor'\)/);
});
