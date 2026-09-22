'use strict';

/* v10.89 — F5 TAM ARAYÜZ (RENDERER) YENİLEMESİ (Packet 15).
 *
 * Menü kurulmadığı için (bkz. electron/main.js §2 yorumu, F12/Ctrl+Shift+I
 * örneği) Electron'un F5'e varsayılan bir bağlaması yoktu; tuş sayfaya aynen
 * ulaşıp hiçbir şey yapmıyordu. F5 artık aynı `before-input-event` dinleyicisi
 * içinde ele alınıyor. Çoklu-sekme çalışma alanında dinleyici her canlı tab'ın
 * WebContents'ine bağlanır; yalnız odaktaki renderer yeniden yüklenir.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const MAIN = fs.readFileSync(path.join(ROOT, 'electron', 'main.js'), 'utf8');
const WORKSPACE = fs.readFileSync(path.join(ROOT, 'electron', 'workspace-manager.js'), 'utf8');

function block(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.ok(start >= 0, `${startMarker} bulunmalı`);
  const end = source.indexOf(endMarker, start);
  assert.ok(end > start, `${endMarker} bulunmalı`);
  return source.slice(start, end);
}

test('F5, her canlı tab WebContents dinleyicisinin İÇİNDE ele alınıyor', () => {
  const listener = block(WORKSPACE, 'function bindInputShortcuts(contents)', 'function createTab(');
  assert.match(listener, /if \(key === 'f12' \|\| \(input\.control && input\.shift && key === 'i'\)\) \{/, 'F12 dalı korunmalı (referans desen)');
  assert.match(listener, /if \(key === 'f5'\) \{/);
  assert.match(listener, /contents\.reload\(\);/);
  // F5 dalı da F12 gibi event.preventDefault() ile tüketilmeli (sayfaya
  // sızıp tarayıcının kendi davranışını tetiklememeli).
  const f5Start = listener.indexOf("if (key === 'f5')");
  const f5Block = listener.slice(f5Start, f5Start + 120);
  assert.match(f5Block, /event\.preventDefault\(\);/);
});

test('F5 yalnız ilgili tab rendererını yeniler — pencere/backend oluşturmaz', () => {
  const listener = block(WORKSPACE, 'function bindInputShortcuts(contents)', 'function createTab(');
  const f5Start = listener.indexOf("if (key === 'f5')");
  const f5Block = listener.slice(f5Start, f5Start + 120);
  assert.ok(!/new BrowserWindow/.test(f5Block), 'yeni pencere açılmamalı');
  assert.ok(!/createMainWindow/.test(f5Block), 'ikinci bir örnek başlatılmamalı');
  assert.ok(!/app\.relaunch|spawn|exec\(/.test(f5Block), 'arka uç/işlem yeniden başlatılmamalı — yalnız arayüz');
});

test('backend süreç yaşam döngüsü F5 tarafından etkilenmiyor', () => {
  // main.js'in arka uç sunucusunu başlattığı/durdurduğu kod, F5 işleyicisinin
  // DIŞINDA kalmalı; before-input-event bloğu yalnızca webContents.reload()
  // çağırır, backend modülüne hiç referans vermez.
  const listener = block(WORKSPACE, 'function bindInputShortcuts(contents)', 'function createTab(');
  assert.ok(!/backend\./.test(listener), 'F5 dinleyicisi backend modülüne dokunmamalı');
  assert.ok(!/startServer|stopServer/.test(listener), 'F5 sunucu yaşam döngüsünü çağırmamalı');
});
