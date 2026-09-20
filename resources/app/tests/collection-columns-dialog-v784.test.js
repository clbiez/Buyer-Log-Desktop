'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const app = fs.readFileSync(path.join(__dirname, '..', 'public', 'app-main.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

test('Koleksiyon özel sütun adları uygulama içi metin penceresinden alınır', () => {
  const section = app.slice(app.indexOf('async function kolAddCustomColumn'), app.indexOf('let kolActiveImgRowId'));
  assert.match(section, /openHorizonTextInput\(\{[\s\S]*?title:appLang==='en'\?'Add column':'Sütun ekle'/);
  assert.match(section, /openHorizonTextInput\(\{[\s\S]*?title:appLang==='en'\?'Rename column':'Sütunu yeniden adlandır'/);
  assert.doesNotMatch(section, /prompt\(/, 'Sütunlar akışı Electron desteklemeyen prompt kullanmamalı');
  assert.match(section, /void kolAddCustomColumn\(panelEl\)/, 'Ekle düğmesi asenkron giriş akışını başlatmalı');
});

test('Sütunlar tetikleyicisi aktif tabloyu body durumundan da çözer', () => {
  assert.match(app, /const tab = document\.body\.dataset\.activeTab \|\| btn\?\.dataset\.tab \|\| 'overview';/,
    'taşınan araç çubuğu düğmeleri aktif Koleksiyon sayfasını kaybetmemeli');
  assert.match(app, /document\.getElementById\('navColsBtn'\)\.addEventListener\('click',[\s\S]*?if\(info\.tableKey==='koleksiyon'\) renderKolColumnPanel\(panel\);/,
    'sağ üstteki Sütunlar düğmesi Koleksiyon seçim panelini açmalı');
});

test('Sütun paneli araç çubuğu kabından bağımsız ve ekran içinde konumlanır', () => {
  assert.match(app, /if\(panel\.parentElement!==document\.body\) document\.body\.appendChild\(panel\);/,
    'popover transform veya overflow taşıyan araç çubuğunda kalmamalı');
  assert.match(app, /panel\._buyerLogAnchor=anchor\|\|null;/,
    'taşınan panel tetikleyicisini korumalı');
  assert.match(html, /if\(panel\?\._buyerLogAnchor\?\.isConnected\) return panel\._buyerLogAnchor;/,
    'yeniden konumlandırma taşınmış panelin tetikleyicisini kullanmalı');
});
