'use strict';

/* v10.87 — CP-ONLY REFRESH DÜĞMESİ (Packet 12).
 *
 * Orders'ın kendi sayfa-kapsamlı yenileme düğmesi (ordersRefreshBtn →
 * loadFromServer(true,['orders'])) zaten vardı. CP'nin eşdeğeri yoktu; CP'yi
 * yenilemek için genel/çoklu-kaynak yenilemeye gidiliyordu. Bu paket Orders'la
 * BİREBİR aynı deseni CP'ye ekliyor — yeni bir yenileme mekanizması kurmadan.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
const APP = read('public/app-main.js');
const HTML = read('public/index.html');

test('cpRefreshBtn, CP arama kutusunun hemen sağında duruyor (Orders ile aynı yerleşim)', () => {
  const cpSearchIdx = HTML.indexOf('id="cpSearch"');
  const cpRefreshIdx = HTML.indexOf('id="cpRefreshBtn"');
  const cpActionsIdx = HTML.indexOf('id="cpTableActions"');
  assert.ok(cpSearchIdx >= 0 && cpRefreshIdx >= 0 && cpActionsIdx >= 0);
  assert.ok(cpSearchIdx < cpRefreshIdx && cpRefreshIdx < cpActionsIdx, 'düğme arama ile sonraki eylemler arasında olmalı');
});

test('cpRefreshBtn, ordersRefreshBtn ile aynı simge/erişilebilirlik desenini paylaşıyor', () => {
  /* v11.11 — sabit 260 karakterlik pencere, düğmeye yeni bir öznitelik
     eklendiğinde (duyarlı araç çubuğu önceliği) ikonu kapsam dışında
     bırakıyordu. Korunan davranış aynı; artık düğmenin TAMAMI okunur. */
  const buttonHtml = id => {
    const at = HTML.indexOf(`id="${id}"`);
    assert.ok(at >= 0, `${id} bulunmalı`);
    return HTML.slice(HTML.lastIndexOf('<button', at), HTML.indexOf('</button>', at));
  };
  const ordersBtn = buttonHtml('ordersRefreshBtn');
  const cpBtn = buttonHtml('cpRefreshBtn');
  for (const marker of ['class="tbtn primary"', 'data-action-role="primary"', '#i-refresh']) {
    assert.ok(ordersBtn.includes(marker), `orders düğmesinde ${marker} olmalı (referans)`);
    assert.ok(cpBtn.includes(marker), `CP düğmesinde de ${marker} olmalı`);
  }
});

test('cpRefreshBtn tıklaması yalnız CP verisini yeniler, global/çoklu-kaynak yenileme değil', () => {
  const start = APP.indexOf("document.getElementById('cpRefreshBtn')");
  assert.ok(start >= 0, 'cpRefreshBtn için click bağlayıcısı bulunmalı');
  const block = APP.slice(start, start + 220);
  assert.match(block, /void loadFromServer\(true,\['cp'\]\);/);
  assert.ok(!/loadFromServer\(true,\['cp','orders'/.test(block), 'yalnız CP hedeflenmeli, orders/backlog/lfl birlikte değil');
});

test('çalışan bir yenileme sırasında ikinci tık ikinci isteği tetiklemez, aşama penceresini açar', () => {
  const cpStart = APP.indexOf("document.getElementById('cpRefreshBtn')");
  const ordersStart = APP.indexOf("document.getElementById('ordersRefreshBtn')");
  const cpBlock = APP.slice(cpStart, cpStart + 220);
  const ordersBlock = APP.slice(ordersStart, ordersStart + 220);
  for (const block of [cpBlock, ordersBlock]) {
    assert.match(block, /if\(isRefreshRunning\(\)\)\{openRefreshStagesModal\(\);return;\}/);
  }
});
