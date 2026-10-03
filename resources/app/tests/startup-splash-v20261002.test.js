'use strict';

/*
 * AÇILIŞ EKRANI. BuyerLog.exe çalıştırıldıktan sonra kurulum onarımı, veri
 * taşıma ve sunucunun hazır olması beklenirken ekranda hiçbir şey görünmüyordu;
 * kullanıcılar programın açılmadığını sanıp exe'yi tekrar çalıştırıyordu. Bu
 * testler "Buyer Log başlatılıyor" penceresinin hemen açılıp ana pencere ya da
 * hata ekranı görününce kapanmasını kilitler.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ELECTRON = path.resolve(__dirname, '..', 'electron');
const main = fs.readFileSync(path.join(ELECTRON, 'main.js'), 'utf8');
const splash = fs.readFileSync(path.join(ELECTRON, 'splash.html'), 'utf8');

function body(name) {
  const start = main.indexOf('function ' + name + '(');
  assert.ok(start >= 0, name + ' bulunamadı');
  const next = main.indexOf('\nfunction ', start + 1);
  const nextAsync = main.indexOf('\nasync function ', start + 1);
  const ends = [next, nextAsync].filter(i => i > 0);
  return main.slice(start, ends.length ? Math.min(...ends) : undefined);
}

test('açılış ekranı ortada, çerçevesiz ve güvenli varsayılanlarla açılır', () => {
  const fn = body('showSplash');
  assert.match(fn, /center:\s*true/);
  assert.match(fn, /frame:\s*false/);
  assert.match(fn, /sandbox:\s*true/);
  assert.match(fn, /contextIsolation:\s*true/);
  assert.match(fn, /nodeIntegration:\s*false/);
  assert.match(fn, /splash\.html/);
  assert.match(splash, /Buyer Log başlatılıyor/);
});

test('açılış ekranı uzun başlatma adımlarından ÖNCE gösterilir', () => {
  const ready = main.slice(main.indexOf('app.whenReady().then('));
  const splashAt = ready.indexOf('showSplash()');
  assert.ok(splashAt >= 0, 'whenReady içinde showSplash çağrılmalı');
  assert.ok(splashAt < ready.indexOf('runInstallRepair('), 'kurulum onarımından önce');
  assert.ok(splashAt < ready.indexOf('startBuyerLog()'), 'sunucu başlatmadan önce');
  assert.match(body('startBuyerLog'), /showSplash\(\)/, 'yeniden deneme yolları da açılış ekranını gösterir');
});

test('açılış ekranı ana pencere görününce veya hata ekranı açılınca kapanır', () => {
  assert.match(body('createMainWindow'), /mainWindow\.once\('show',\s*closeSplash\)/);
  assert.match(body('showStartupError'), /closeSplash\(\)/);
});

test('ikinci BuyerLog.exe açılış ekranını öne getirir', () => {
  assert.match(main, /activeBuyerLogWindow\(\)\s*\|\|\s*errorWindow\s*\|\|\s*splashWindow/);
});
