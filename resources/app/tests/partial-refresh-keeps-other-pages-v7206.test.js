'use strict';

/* v7.206 — KISMİ YENİLEME YENİLENMEYEN SAYFANIN YÜKLÜ VERİSİNİ SİLMEZ.
 *
 * Kullanıcı: "Orders & LFL grubunu yenilediğimde CP'deki yüklü veri
 * kayboluyor; CP'yi tekrar yenilemem gerekiyor."
 *
 * Kök neden (istemci): Yenileme bitince loadFromServer hafif `mode=initial`
 * yanıtını okur; bu yanıt CP'yi taşımaz (cpDeferred) ve kod hangi sayfa
 * yenilenmiş olursa olsun state.cp=null yapıyordu. CP sayfası bellekten
 * düşüyor, kaydedilmemiş CP düzenlemeleri / undo geçmişi sıfırlanıyor ve CP
 * yeniden yüklenmek zorunda kalıyordu. Aynısı yalnız CP yenilendiğinde
 * Siparişler sayfası için de geçerliydi.
 *
 * Sözleşme: kullanıcı-görünür kısmi yenilemede hedefler arasında olmayan
 * CP/Siparişler verisi korunur; yalnız yenilenen sayfa yeniden yüklenir.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const APP = fs.readFileSync(path.join(__dirname, '..', 'public', 'app-main.js'), 'utf8');
const LOAD = APP.slice(APP.indexOf('async function loadFromServer('), APP.indexOf('applyCachedProfilesForCurrentPage(initialScreenLoad);'));

test('kısmi yenileme hedefleri sunucunun genişlettiği bağlı grupla birlikte hesaplanır', () => {
  assert.match(LOAD, /const partialRefreshTargets=/);
  assert.match(LOAD, /data\.lastRefreshResult&&Array\.isArray\(data\.lastRefreshResult\.targets\)/);
});

test('CP hedefte değilse yüklü CP satırları, dirty ve undo korunur', () => {
  assert.match(LOAD, /const keepCpForPartialRefresh=Boolean\(partialRefreshTargets&&!partialRefreshTargets\.includes\('cp'\)&&state\.cp/);
  assert.match(LOAD, /const preserveCpClientState=\(!userVisibleRefresh&&cpClientWorkInProgress\(\)\)\|\|keepCpForPartialRefresh;/);
  const deferred = LOAD.slice(LOAD.indexOf('}else if(data.cpDeferred){'));
  assert.match(deferred.slice(0, 400), /if\(!preserveCpClientState\)state\.cp=null;/);
});

test('Siparişler hedefte değilse yüklü Siparişler satırları ve seçimi korunur', () => {
  assert.match(LOAD, /const keepOrdersForPartialRefresh=Boolean\(partialRefreshTargets&&!partialRefreshTargets\.includes\('orders'\)&&state\.orders/);
  const branch = LOAD.slice(LOAD.indexOf('data.orderSummaryDeferred){'));
  assert.match(branch.slice(0, 200), /if\(!keepOrdersForPartialRefresh\)state\.orders=null;state\.orderSummary=null;/);
  assert.match(LOAD, /if\(\(userVisibleRefresh&&!keepOrdersForPartialRefresh\)\|\|initialScreenLoad\|\|Array\.isArray\(data\.orders\)\)state\.ordersSelected/);
});
