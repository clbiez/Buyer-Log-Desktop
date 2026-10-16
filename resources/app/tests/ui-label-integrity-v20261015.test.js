'use strict';

/* Arayüz denetimi (2026-10-15): i18n güvenlik ağı, çevrilmemesi gereken kodları
   ve yarım kalmış İngilizce etiketleri bozuyordu.
   - Genel Bakış saat kartında "TR" ülke kodu sözlükteki ["TR","EN"] çiftine
     takılıp "EN" görünüyordu.
   - Veri Yönetimi laboratuvarında sunucunun ham İngilizce etiketi TR arayüzde
     "Yerel Simulation" ve "CORPORATE VALIDATION REQUIRED" olarak kalıyordu. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = file => fs.readFileSync(path.join(__dirname, '..', 'public', file), 'utf8');

test('Saat kartındaki ülke kodu i18n güvenlik ağının dışında kalır', () => {
  assert.match(read('overview-launchpad.js'), /<span class="ovClockCode" data-no-i18n>/);
});

test('Entegrasyon laboratuvarı ortam etiketleri TR/EN çiftiyle çizilir', () => {
  const source = read('data-management.js');
  assert.match(source, /T\('Yerel simülasyon', 'Local simulation'\)/);
  assert.match(source, /T\('Kurumsal canlı', 'Corporate live'\)/);
  assert.match(source, /T\('Kurumsal doğrulama gerekli', 'Corporate validation required'\)/);
  assert.doesNotMatch(source, />CORPORATE VALIDATION REQUIRED</);
  assert.doesNotMatch(source, /esc\(environment\.label \|\| environment\.mode\)/);
});
