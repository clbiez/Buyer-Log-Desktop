'use strict';
/* Landed çarpanları penceresi (public/app-main.js) ve TR/YD widget'ı — kaynak sözleşmesi.
   Vasıta standardı: veri kaynaklı liste, öneri yalnız alanı doldurur, Kaydet olmadan yazım yok,
   okunamazsa byVehicle gönderilmez (kayıtlı değer korunur). */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = name => fs.readFileSync(path.join(__dirname, '..', 'public', name), 'utf8');
const main = read('app-main.js');
const between = (text, start, end) => text.slice(text.indexOf(start), text.indexOf(end, text.indexOf(start)));

test('persist: byVehicle yalnız açıkça verildiğinde gönderilir; kayıt sonrası TR/YD bilgilendirilir', () => {
  const persist = between(main, 'async function persistLandedMultipliers', 'function landedVehicleDate');
  assert.match(persist, /value\.byVehicle&&typeof value\.byVehicle==='object'&&!Array\.isArray\(value\.byVehicle\)\?\{\.\.\.clean,byVehicle:value\.byVehicle\}:clean/);
  assert.match(persist, /'If-Match':String\(state\.storeRevisions\.landedMultipliers\|\|0\)/, 'CAS revizyonu korunur');
  assert.match(persist, /dispatchEvent\(new CustomEvent\('bl:landed-multipliers-changed'\)\)/);
});

test('pencere: vasıta listesi veriden; öneri Kaydet olmadan yazmaz; okunamazsa byVehicle gönderilmez', () => {
  const modal = between(main, 'function openLandedMultipliersModal', '/* --- ASAS - IAS Eşleştirme Kuralı');
  assert.match(modal, /fetch\('\/api\/landed-multipliers',\{credentials:'same-origin',cache:'no-store'\}\)/);
  assert.match(main, /payload&&payload\.knownVehicles/);
  assert.match(modal, /fetch\('\/api\/postfob\/tryd\/vehicle-suggestions'/);
  const suggest = between(modal, "suggestBtn?.addEventListener('click'", "modal.querySelector('#_landedMultiplierSave')");
  assert.doesNotMatch(suggest, /persistLandedMultipliers|method:'PUT'/, 'öneri otomatik kaydetmez');
  const apply = between(modal, "event.target.closest('[data-vehicle-apply]')", "suggestBtn?.addEventListener");
  assert.doesNotMatch(apply, /persistLandedMultipliers/, 'Alana al yalnız alanı doldurur');
  assert.match(modal, /persistLandedMultipliers\(byVehicle\?\{tr,overseas,byVehicle\}:\{tr,overseas\}\)/);
  assert.match(modal, /let byVehicle;\s*if\(vehicleModel\)\{/, 'bölüm okunamazsa byVehicle undefined kalır');
  assert.match(modal, /value<=0\|\|value>10/, 'istemci de 0 < x ≤ 10 denetler');
  // TR + EN metinler
  assert.match(modal, /Geçmiş veriden öner/);
  assert.match(modal, /Suggest from history/);
});

test('uzak senkron: landedMultipliers alanı TR/YD standartlarını yeniler', () => {
  assert.match(main, /if\(area==='landedMultipliers'\)window\.dispatchEvent\(new CustomEvent\('bl:landed-multipliers-changed'\)\);/);
});

test('TR/YD widget: satır standardı, vasıta eşleşme KPI\'ı, ipucu ve Excel kuralı', () => {
  const widget = read('tryd-advantage.js');
  assert.match(widget, /byVehicle: state\.byVehicle, vehicles: state\.vehicles/);
  assert.match(widget, /engine\.createStandardResolver\(/, 'alt detay satırın kendi standardını kullanır');
  assert.match(widget, /maxRatioVehicle/);
  assert.match(widget, /Vasıta eşleşmesi \(YD adet\)/);
  assert.match(widget, /Shipment mode match \(abroad qty\)/);
  assert.match(widget, /vehicleStandardsText\(\)/);
  assert.match(widget, /addEventListener\('bl:landed-multipliers-changed'/);
});
