'use strict';

/* v10.88 — REFRESH STAGES: YALNIZ AÇIKÇA AÇILIR (Packet 13).
 *
 * userVisibleRefresh true olduğunda (kullanıcı görür bir yenileme
 * başladığında) openRefreshStagesModal() KOŞULSUZ çağrılıyordu — yenilemeyi
 * kim/ne tetiklerse tetiklesin pencere kendiliğinden açılıyordu. İlerleme
 * zaten düğmenin spinner/"Durdur" durumuyla görünür; pencere artık yalnız
 * kullanıcı ilerleme kontrolüne (Refresh/CP/Orders düğmesi, üst menü) AÇIKÇA
 * tıkladığında açılıyor — bu tıklama yolları (isRefreshRunning() ⇒ aç)
 * DOKUNULMADI.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const APP = fs.readFileSync(path.join(__dirname, '..', 'public', 'app-main.js'), 'utf8');

test('yenileme başlarken Refresh Stages artık kendiliğinden açılmıyor', () => {
  assert.ok(!APP.includes('if(userVisibleRefresh){ setRefreshFailureState(false); openRefreshStagesModal(); }'),
    'eski koşulsuz açma satırı kalmamalı');
  assert.match(APP, /if\(userVisibleRefresh\)\{ setRefreshFailureState\(false\); \}/,
    'başarısızlık durumu hâlâ sıfırlanmalı, yalnız pencere açılmamalı');
});

test('ilerleme hâlâ görünür: düğme spinner/"Durdur" durumuna geçmeye devam ediyor', () => {
  const idx = APP.indexOf("if(userVisibleRefresh){ setRefreshFailureState(false); }");
  assert.ok(idx >= 0);
  const before = APP.slice(Math.max(0, idx - 1000), idx);
  assert.match(before, /btn\.classList\.add\('spinning'\)/);
  assert.match(before, /topBtn\.classList\.add\('spinning'\)/);
});

test('pencereyi kapatmak çalışan yenilemeyi durdurmuyor (yalnız DOM\'dan kaldırıyor)', () => {
  const start = APP.indexOf('function openRefreshStagesModal()');
  const end = APP.indexOf('function showSourceRefreshAdvisory');
  assert.ok(start >= 0 && end > start);
  const block = APP.slice(start, end);
  assert.match(block, /const close=\(\)=>\{ clearInterval\(modal\._timer\); modal\.remove\(\); \};/);
  assert.ok(!block.includes('close=()=>{requestRefreshCancel'), 'kapatma requestRefreshCancel çağırmamalı');
});

test('üst çubuktaki yenileme ve LFL düğmeleri çalışırken aşamaları açar', () => {
  const menu = APP.slice(APP.indexOf('async function openTopRefreshMenu('));
  const lfl = APP.slice(APP.indexOf('window.BLRunLinkedRefresh=function()'));
  assert.match(menu, /^async function openTopRefreshMenu[^]*?if\(window\.BL_REFRESH_BUSY\)\{openRefreshStagesModal\(\);return;\}/);
  assert.match(lfl, /^window\.BLRunLinkedRefresh=function\(\)\{\s*if\(isRefreshRunning\(\)\)\{openRefreshStagesModal\(\);return Promise\.resolve\(false\);\}/);
});
