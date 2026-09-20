'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const picker = require('../server/lib/chooseFolder');
const SERVER = fs.readFileSync(path.join(ROOT, 'server', 'server.js'), 'utf8');
const APP = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');
const POWERSHELL = fs.readFileSync(path.join(ROOT, 'server', 'lib', 'ChooseFolder.ps1'), 'utf8');

test('Sync Browse Windows picker ağ modu ve mevcut UNC yolunu korur', () => {
  const unc = '\\\\fileserver\\Buyer Log Sync';
  const args = picker.windowsFolderDialogArgs({ mode: 'network', initialPath: unc });
  assert.ok(args.includes('-NetworkMode'));
  assert.equal(args[args.indexOf('-InitialPath') + 1], unc);
});

test('Sync Browse endpointi kaynak klasörü seçicisinden bağımsız ağ modu kullanır', () => {
  const start = SERVER.indexOf("app.post('/api/sync-settings/browse'");
  const block = SERVER.slice(start, start + 1000);
  assert.match(block, /express\.json\(\{ limit: '16kb' \}\)/);
  assert.match(block, /chooseFolderDialog\(\{[\s\S]*?mode:\s*isLocalDbBrowse\s*\?\s*'source'\s*:\s*'network'[\s\S]*?initialPath/);
});

test('Yerel DB Browse yerel klasör modunda kalır ve ağ seçiciyi kullanmaz', () => {
  /* Bu test eskiden istemcideki addEditableSyncDbFolder'ı da arıyordu. v7.80 o
     düzenleyiciyi BİLEREK kaldırdı: Sync Status penceresi kanonik yolları salt
     okunur gösteriyor (sync-status-db-folder-editor-v780.test.js). Dolayısıyla
     istemci yarısı artık geçersiz bir beklenti — sunucu sözleşmesi ise geçerli:
     purpose:'local-db' geldiğinde AĞ seçicisi değil YEREL klasör seçicisi
     açılmalı (yerel DB ağ yolunda tutulamaz). */
  const routeStart = SERVER.indexOf("app.post('/api/sync-settings/browse'");
  const route = SERVER.slice(routeStart, routeStart + 1400);
  assert.match(route, /purpose[\s\S]{0,100}===\s*'local-db'/);
  assert.match(route, /isLocalDbBrowse\s*\?\s*'source'\s*:\s*'network'/);
  // Yerel DB salt okunur kaldığı sürece istemcide düzenleyici OLMAMALI.
  assert.doesNotMatch(APP, /addEditableSyncDbFolder/);
});

test('Sync Browse mevcut yolu gönderir ve seçim hatasını pencerede gösterir', () => {
  const start = APP.indexOf("modal.querySelector('[data-browse]')?.addEventListener", APP.indexOf('async function openSyncLocalDataModal'));
  const block = APP.slice(start, start + 900);
  assert.match(block, /JSON\.stringify\(\{\s*initialFolder:\s*folder\(\)\.value\s*\}\)/);
  assert.match(block, /_syncError/);
  assert.match(block, /response\.ok/);
});

test('Windows ağ modu adres çubuğu olan modern dosya diyaloğunu klasör seçici olarak kullanır', () => {
  assert.match(POWERSHELL, /\[switch\]\$NetworkMode/);
  assert.match(POWERSHELL, /System\.Windows\.Forms\.OpenFileDialog/);
  assert.match(POWERSHELL, /\$networkDialog\.InitialDirectory/);
  assert.match(POWERSHELL, /Split-Path/);
});
