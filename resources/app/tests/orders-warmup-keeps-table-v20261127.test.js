'use strict';

/* SİPARİŞLER — ARKA PLAN HAZIRLIĞI TABLOYU GİZLEMEZ
 *
 * Açılıştan sonra arka plan hazırlığı Siparişler tam satırlarını yükler
 * (ensureOrdersLoaded({deferRender:true})). Kullanıcı o sırada Siparişler'deyse ve okuma modeli
 * penceresi satırları zaten gösteriyorsa, tablo ~9 sn tam sayfa "Siparişler yükleniyor…" ile
 * değiştiriliyordu (gerçek tarayıcı, 30k demo, yığın izi: ensureOrdersLoaded ← warmup load).
 * Pencerede satır varken tam yükleme arka planda sürer; tablo, filtre ve seçim yerinde kalır.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SOURCE = fs.readFileSync(path.join(__dirname, '..', 'public', 'app-main.js'), 'utf8');

test('pencerede satır varken tam satır yüklemesi Siparişler tablosunu yükleniyor durumuyla değiştirmez', () => {
  const fn = SOURCE.slice(SOURCE.indexOf('async function ensureOrdersLoaded('), SOURCE.indexOf('ordersLoadPromise=(async()=>{'));
  assert.match(fn, /if\(currentActiveTab\(\)==='orders'&&!\(ordersReadModelEnabled\(\)&&ordersRM\.rows\)\)setOrdersLoadingState\(true\);/);
  assert.doesNotMatch(fn, /if\(currentActiveTab\(\)==='orders'\)setOrdersLoadingState\(true\);/);
});
