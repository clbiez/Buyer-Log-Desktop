'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const INDEX = read('public/index.html');
const APP = read('public/app-main.js');

function menuBlock(id) {
  const start = INDEX.indexOf(`id="${id}"`);
  assert.ok(start >= 0, `${id} bulunmalı`);
  const end = INDEX.indexOf('</div>', start);
  assert.ok(end > start, `${id} kapanış kapsayıcısı bulunmalı`);
  return INDEX.slice(start, end);
}

test('v7.70 License Royalty Calculations CP, Orders ve Collection Tools menüsünde görünür', () => {
  for (const [menuId, buttonId] of [
    ['cpToolsMenu', 'cpLicenseRoyaltyBtn'],
    ['ordersToolsMenu', 'ordersLicenseRoyaltyBtn'],
    ['kolToolsMenu', 'kolLicenseRoyaltyBtn'],
  ]) {
    const block = menuBlock(menuId);
    assert.match(block, new RegExp(`id="${buttonId}"`), `${buttonId} Tools menüsünde olmalı`);
    assert.match(block, /data-license-royalty/);
  }
  assert.match(APP, /querySelectorAll\('\[data-license-royalty\]'\)/);
  assert.match(APP, /openSuppFobRulesModal\(\)/);
});

test('v7.81 genel Ayarlar açılır menüsü kalkar; işleri Veri Yönetimi’nde', () => {
  /* Korunan karar: aynı işe iki kapı olmamalı. v7.70'te bu, Ayarlar'ı Source
     Data'nın hemen üstüne koyarak çözülmüştü; v7.81'de menünün KENDİSİ kalktı
     ve içindeki on üç iş Veri Yönetimi ekranındaki Araçlar bölümüne, ne
     yaptıklarını yazan satırlar hâlinde taşındı. Etiketsiz bir yığında bir
     aracı bulmak hepsini açıp kapatmayı gerektiriyordu. */
  assert.doesNotMatch(INDEX, /id="sourceSettingsBtn"/);
  assert.doesNotMatch(INDEX, /sourceSettingsMenu/);

  const dmUi = read('public/data-management.js');
  assert.match(dmUi, /const TOOL_GROUPS = \[/);
  for (const id of ['transit', 'landed', 'royalty', 'nondtr', 'emailgroups', 'fx',
    'endeksmatik', 'folder', 'maintenance', 'sync', 'backup', 'imagelimit', 'browser']) {
    assert.match(dmUi, new RegExp(`id: '${id}'`), `${id} aracı Veri Yönetimi'nde olmalı`);
  }
});

test('v7.81 Kaynak Veri şeridinin TAMAMI Veri Yönetimi’ne taşındı', () => {
  /* İlk adımda yalnız eylem düğmeleri taşınmıştı ve şeridin kendi denetimleri
     (otomatik yenileme, kaynak modu) yerinde bırakılmıştı. Kullanıcı kararıyla
     onlar da taşındı: "Excel mi Database mi?" sorusu bağlantı kartlarından
     ÖNCE gelir ve sonucunu orada gösterir; şeritte dururken kullanıcı
     bağlantıyı kurup neden sorgulanmadığını anlamıyordu. */
  for (const id of ['autoRefreshSelect', 'backupSettingsBtn', 'chooseFolderBtn', 'syncLocalDataBtn',
    'asasSourceControl', 'antrepoSourceControl', 'lflSourceControl']) {
    assert.doesNotMatch(INDEX, new RegExp(`id="${id}"`), `${id} Veri Yönetimi'ne taşınmış olmalı`);
  }
  const dmUi = read('public/data-management.js');
  assert.match(dmUi, /id="autoRefreshSelect"/);
  assert.match(dmUi, /const SOURCE_MODES = \[/);
});
