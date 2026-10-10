'use strict';

/* v7.71 — "KAYNAK VERİ AYARLARI" İLE "GENEL AYARLAR" AYRIMI.
 *
 * Korunan kusur: iki açılır menü aynı anda vardı ve hangi ayarın hangisinde
 * olduğu belirsizdi. Kullanıcı Yedekleme'yi bir menüde arayıp diğerinde
 * buluyordu.
 *
 * v7.81 çözümü ayrımı KALDIRMAK oldu: genel Ayarlar menüsü silindi, içindeki
 * on üç iş Veri Yönetimi ekranına — üç adlandırılmış gruba — taşındı. Kaynak
 * Veri şeridinde yalnız kendi durumunu gösteren denetimler kaldı.
 *
 * Bu testler o sınırın korunduğunu kilitler: bir iş İKİ yerde birden
 * bulunmamalı, ve taşınan hiçbir yetenek kaybolmamalı.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const INDEX = read('public/index.html');
const APP = read('public/app-main.js');
const DM = read('public/data-management.js');

test('v7.81 genel Ayarlar menüsü ve düğmesi tamamen kalkar', () => {
  assert.doesNotMatch(INDEX, /sourceSettingsMenu/);
  assert.doesNotMatch(INDEX, /id="sourceSettingsBtn"/);
  // Menüyü konumlandıran/gizleyen kod da kalmamalı: elemanı olmayan kod,
  // sonraki okuyucuyu var olmayan bir yüzeye inandırır.
  assert.doesNotMatch(APP, /positionSourceSettingsMenu/);
  assert.doesNotMatch(APP, /sourceSettingsMenu/);
  assert.doesNotMatch(read('public/app.css'), /\.sourceSettingsMenu/);
});

test('v7.81 taşınan hiçbir iş İKİ yerde birden değil', () => {
  /* Asıl kusur buydu: aynı işin iki kapısı. Araç kaydındaki her iş Veri
     Yönetimi'nde YAŞAR ve index.html'de artık kendi düğmesi YOKTUR. */
  const movedButtons = [
    'transitRulesBtn', 'nonDtrManufacturersBtn', 'licenseRoyaltyRulesBtn', 'landedMultipliersBtn',
    'emailGroupsBtn', 'btnSourceFx', 'sourceEndeksmatikUploadBtn', 'chooseFolderBtn',
    'dataMaintenanceBtn', 'syncLocalDataBtn', 'backupSettingsBtn', 'modelImageLimitBtn',
    'browserDebugSettingsBtn',
  ];
  for (const id of movedButtons) {
    assert.doesNotMatch(INDEX, new RegExp(`id="${id}"`), `${id} taşındı; ikinci bir kapı kalmamalı`);
  }
  assert.equal(movedButtons.length, 13);
});

test('v7.81 taşınan hiçbir YETENEK kaybolmadı', () => {
  /* Kapıyı kapatmak işi silmek değildir. Her aracın çağırdığı gerçek
     düzenleyici hâlâ tanımlı olmalı — aksi hâlde satır tıklanınca hiçbir şey
     olmaz ve kullanıcı özelliği kaybettiğini sanır. */
  for (const fn of ['openTransitRulesModal', 'openLandedMultipliersModal', 'openSuppFobRulesModal',
    'triggerEndeksmatikUpload', 'chooseSourceFolder',
    'openSyncLocalDataModal', 'openModelImageLimitModal', 'openBrowserDebugSettingsModal',
    'openDataMaintenanceModal']) {
    assert.match(APP, new RegExp(`function ${fn}\\(`), `${fn} tanımlı kalmalı`);
    assert.match(DM, new RegExp(fn), `${fn} araç kaydından çağrılmalı`);
  }
  // DTR / Non-DTR yeteneği üretici kartına taşındı.
  assert.doesNotMatch(DM, /openNonDtrManufacturersModal/);
  assert.match(read('public/email-groups.js'), /data-eg-input="dtrStatus"/);
  // Tembel yüklenen ikisi ortak global üzerinden çağrılır.
  assert.match(DM, /BLEmailGroups\?\.open\?\.\(\)/);
  assert.match(DM, /buyerLogBackupModal\?\.\(\)/);
  assert.match(read('public/email-groups.js'), /window\.BLEmailGroups = \{/);
  assert.match(read('public/backup-manager.js'), /function buyerLogBackupModal\(/);
  // FX'in gizli dosya girdisi index.html'de KALMALI: araç satırı onu tetikliyor.
  assert.match(INDEX, /id="sourceFxFile"/);
});

test('v7.81 kaynak modu ve otomatik yenileme de Veri Yönetimi’nde', () => {
  /* Şerit artık yalnız durum gösteriyor (yenileme süre sayacı); karar veren
     her denetim tek ekranda toplandı. */
  for (const id of ['autoRefreshSelect', 'asasSourceControl', 'antrepoSourceControl', 'lflSourceControl']) {
    assert.doesNotMatch(INDEX, new RegExp(`id="${id}"`));
    assert.match(DM, new RegExp(id), `${id} Veri Yönetimi'nde üretilmeli`);
  }
  /* Durumu çizen fonksiyonlar app-main.js'te KALIR: ikinci bir kopya iki ayrı
     doğruluk kaynağı demek olurdu (§9). */
  for (const fn of ['renderAsasSourceControl', 'renderAntrepoSourceControl',
    'renderLflSourceControl', 'renderAutoRefreshState']) {
    assert.ok(APP.includes(`function ${fn}(`), `${fn} app-main.js'te kalmalı`);
    assert.ok(DM.includes(fn), `${fn} ekrandan yeniden uygulanmalı`);
  }
});
