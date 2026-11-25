'use strict';
// Fiyat Masası hücresindeki onay/drop düğmeleri yalnız hücre üzerine gelince
// ya da odaktayken görünür. Tasarım sisteminin genel kuralı
// `html[data-ui-system="manifest"] button:disabled{opacity:.5}` (özgüllük 0,2,1)
// `.pdCell .pdApprove{opacity:0}` (0,2,0) kuralını eziyordu: yalnız görüntüleme
// izinli kullanıcıda her fiyatın, düzenleyicide boş hücrelerin üzerinde yarı
// saydam ✓/✗ duruyor, fiyat üstü çizili gibi okunuyordu (gerçek tarayıcı kanıtı:
// scripts/multiuser-collection-pricing-e2e.js, hesaplanan opacity 0.5).
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const css = fs.readFileSync(path.join(__dirname, '../public/pricing-desk.css'), 'utf8');
const globalRule = fs.readFileSync(path.join(__dirname, '../public/ui-components.css'), 'utf8');

test('genel disabled kuralı hâlâ mevcut (bu düzeltmenin sebebi)', () => {
  assert.match(globalRule, /html\[data-ui-system="manifest"\] button:disabled\{cursor:not-allowed;opacity:\.5;\}/);
});
test('devre dışı hücre eylemleri varsayılan olarak gizli (0,3,0 > 0,2,1)', () => {
  assert.match(css, /\.pdCell \.pdApprove:disabled,\.pdCell \.pdDrop:disabled\{opacity:0\}/);
});
test('üzerine gelince/odakta devre dışı eylem soluk görünür', () => {
  assert.match(css, /\.pdCell:hover \.pdApprove:disabled,\.pdCell:hover \.pdDrop:disabled,\.pdCell:focus-within \.pdApprove:disabled,\.pdCell:focus-within \.pdDrop:disabled\{opacity:\.45\}/);
});
