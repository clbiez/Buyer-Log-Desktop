'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const INDEX = read('public/index.html');
const APP = read('public/app-main.js');
const COLLECTION = read('public/collection-spreadsheet.js');
const UM = read('public/user-management.js');
const DESIGN = read('public/design.css');
const COMPONENTS = read('public/ui-components.css');
const LAYER_PATH = path.join(ROOT, 'public', 'layer-system.js');
const LAYER_SOURCE = fs.existsSync(LAYER_PATH) ? fs.readFileSync(LAYER_PATH, 'utf8') : '';
const LAYER = fs.existsSync(LAYER_PATH) ? require(LAYER_PATH) : {};

test('v10.37 ortak katman denetleyicisi dinamik modül ve uygulama kodundan önce yüklenir', () => {
  const layer = INDEX.indexOf('<script src="layer-system.js');
  const tabs = INDEX.indexOf('<script src="tab-system.js');
  const app = INDEX.indexOf('<script src="app-main.js');
  assert.ok(layer >= 0, 'ortak modal ve menü denetleyicisi sayfaya eklenmeli');
  assert.ok(layer < tabs && layer < app, 'katman denetleyicisi tüketicilerden önce hazır olmalı');
});

test('v10.37 menü ok, Home ve End tuşları etkin seçenekler arasında döner', () => {
  assert.equal(typeof LAYER.nextMenuIndex, 'function');
  assert.equal(LAYER.nextMenuIndex(1, 4, 'ArrowDown'), 2);
  assert.equal(LAYER.nextMenuIndex(0, 4, 'ArrowUp'), 3);
  assert.equal(LAYER.nextMenuIndex(2, 4, 'Home'), 0);
  assert.equal(LAYER.nextMenuIndex(1, 4, 'End'), 3);
  assert.equal(LAYER.nextMenuIndex(1, 4, 'ArrowRight'), null);
});

test('v10.37 modal odağı içeride tutar, Escape ile kapanır ve çağıran denetime geri döner', () => {
  assert.match(LAYER_SOURCE, /function openDialog\(/);
  assert.match(LAYER_SOURCE, /function closeDialog\(/);
  assert.match(LAYER_SOURCE, /trapDialogTab\(dialog,event\)/);
  assert.match(LAYER_SOURCE, /event\.key\s*===\s*'Escape'/);
  assert.match(LAYER_SOURCE, /stopPropagation\(\)/);
  assert.match(LAYER_SOURCE, /blDialogOpen/);
  assert.match(LAYER_SOURCE, /returnTarget/);
  assert.match(LAYER_SOURCE, /\.focus\(/);
  assert.doesNotMatch(LAYER_SOURCE, /MutationObserver/, 'büyük tablo DOM’unu izleyen sürekli gözlemci eklenmemeli');
});

test('v10.37 Kullanıcı Yönetimi penceresi başlığına bağlıdır ve ortak modal yaşam döngüsünü kullanır', () => {
  assert.match(UM, /id="umDialogTitle"/);
  assert.match(UM, /role="dialog" aria-modal="true" aria-labelledby="umDialogTitle"/);
  assert.match(UM, /data-bl-dialog-fallback/);
  assert.match(UM, /BLLayerSystem\?\.openDialog\(dialog/);
  assert.match(UM, /BLLayerSystem\?\.closeDialog\(dialog/);
});

test('v10.37 ortak tablo menüleri ve Collection sağ-tık menüsü aynı klavye sözleşmesini kullanır', () => {
  const appIntegrations = APP.match(/BLLayerSystem\?\.openMenu\(menu/g) || [];
  assert.ok(appIntegrations.length >= 2, 'pano ve sütun menüleri ortak denetleyiciye bağlanmalı');
  assert.match(APP, /BLLayerSystem\?\.closeMenu\(/);
  assert.match(APP, /_gridClipboardOutsideHandler/);
  assert.match(APP, /!menu\.contains\(outsideEvent\.target\)/, 'menü içindeki tıklama dışarı tıklama gibi kapatılmamalı');
  assert.match(COLLECTION, /BLLayerSystem\?\.openMenu\(menu/);
  assert.match(COLLECTION, /BLLayerSystem\?\.closeMenu\(/);
});

test('v10.37 Collection dış-tıklama dinleyicisi menü içi etkileşimde kaybolmaz', () => {
  const menuSource = COLLECTION.slice(COLLECTION.indexOf('function closeMenu'), COLLECTION.indexOf('function headerContext'));
  assert.match(COLLECTION, /menuOutsideHandler/);
  assert.match(COLLECTION, /removeEventListener\('pointerdown',\s*state\.menuOutsideHandler/);
  assert.match(COLLECTION, /if\s*\(!menu\.contains\(outsideEvent\.target\)\)\s*closeMenu\(\)/);
  assert.doesNotMatch(menuSource, /once:\s*true/, 'menü içi ilk pointerdown dış-tıklama korumasını tüketmemeli');
});

test('v10.37 menü seçenekleri semantik, tek tab duraklı ve pasif seçenekleri atlar', () => {
  assert.match(LAYER_SOURCE, /setAttribute\('role',\s*'menuitem'\)/);
  assert.match(LAYER_SOURCE, /setAttribute\('tabindex'/);
  assert.match(LAYER_SOURCE, /item\.disabled/);
  assert.match(LAYER_SOURCE, /aria-disabled/);
  assert.match(LAYER_SOURCE, /ArrowDown/);
  assert.match(LAYER_SOURCE, /ArrowUp/);
  assert.match(LAYER_SOURCE, /Home/);
  assert.match(LAYER_SOURCE, /End/);
});

test('v10.37 Escape yalnız en üst katmanı kapatır ve mevcut iş eylemlerini kendisi çalıştırmaz', () => {
  assert.match(LAYER_SOURCE, /onClose/);
  assert.match(LAYER_SOURCE, /event\.preventDefault\(\)/);
  assert.doesNotMatch(LAYER_SOURCE, /\.click\(\)/, 'katman sistemi iş düğmelerini taklit ederek çalıştırmamalı');
  assert.doesNotMatch(LAYER_SOURCE, /innerHTML\s*=/, 'katman sistemi modül içeriğini yeniden üretmemeli');
});

test('v10.37 modal ve menü odak yüzeyi tasarım tokenlarını kullanır', () => {
  const block = COMPONENTS;
  assert.match(DESIGN, /body\.blDialogOpen/);
  assert.match(block, /\[data-bl-layer="menu"\]/);
  assert.match(block, /\[role="menuitem"\]:focus-visible/);
  assert.match(block, /var\(--ui-accent\)/);
  const focus=block.match(/\[data-bl-layer="dialog"\][^{]+\{([^}]+)\}/)[1];
  assert.doesNotMatch(focus, /#[0-9a-f]{3,8}\b/i, 'katman sistemi tema dışı sabit renk üretmemeli');
});
