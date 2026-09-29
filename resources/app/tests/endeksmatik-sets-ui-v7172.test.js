'use strict';

// v7.0.172 — Endeksmatik set yöneticisi ve modal sözleşmesi (kaynak-sözleşme testi).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');
const HTML = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const DM = fs.readFileSync(path.join(ROOT, 'public', 'data-management.js'), 'utf8');
const SERVER = fs.readFileSync(path.join(ROOT, 'server', 'server.js'), 'utf8');

const slice = (start, end) => { const a = APP.indexOf(start); assert.notEqual(a, -1, start); const b = APP.indexOf(end, a + 1); return APP.slice(a, b < 0 ? undefined : b); };

test('Koleksiyon › Araçlar ve Veri Yönetimi set yöneticisini açar (lazy)', () => {
  assert.match(HTML, /id="kolEndeksmatikSetsBtn"/);
  assert.match(APP, /getElementById\('kolEndeksmatikSetsBtn'\)\?\.addEventListener\('click',\(\)=>void openEndeksmatikSetManager\(\)\)/);
  assert.match(DM, /id: 'endeksmatikSets'/);
  assert.match(DM, /run: \(\) => openEndeksmatikSetManager\(\)/);
  // Liste yalnız pencere açılınca okunur; açılışta eager render yok.
  const fn = slice('async function openEndeksmatikSetManager()', "document.getElementById('kolEndeksmatikSetsBtn')");
  assert.match(fn, /refreshEndeksmatikStatus\(\{silent:false\}\)/);
});

test('set işlemleri yetkili rotalara gider; sunucu izinleri zorlar', () => {
  const fn = slice('async function openEndeksmatikSetManager()', "document.getElementById('kolEndeksmatikSetsBtn')");
  assert.match(fn, /\/api\/endeksmatik\/sets\/active/);
  assert.match(fn, /method:'PATCH'/);
  assert.match(fn, /method:'DELETE'/);
  assert.match(fn, /window\.BLHasPermission\('manageModelConnections'\)/);
  assert.match(SERVER, /app\.post\('\/api\/endeksmatik\/sets\/active', userAccess\.requirePermission\('manageModelConnections'\)/);
  assert.match(SERVER, /app\.patch\('\/api\/endeksmatik\/sets\/:id', userAccess\.requirePermission\('manageModelConnections'\)/);
  assert.match(SERVER, /app\.delete\('\/api\/endeksmatik\/sets\/:id', userAccess\.requirePermission\('manageModelConnections'\)/);
  assert.match(SERVER, /app\.get\('\/api\/endeksmatik\/sets'/);
});

test('modal set + seviye seçer, SING OFF girdilerini gönderir; set değişince eski sonuç silinir', () => {
  assert.match(APP, /data-em-field="setId"/);
  assert.match(APP, /data-em-field="level"/);
  assert.match(APP, /data-em-singoff-field="\$\{name\}"/);
  assert.match(APP, /payload\.setId=get\('setId'\)\|\|''/);
  assert.match(APP, /payload\.level=Number\(get\('level'\)\)\|\|5/);
  assert.match(APP, /if\(Object\.keys\(singOff\)\.length\)payload\.singOff=singOff/);
  assert.match(APP, /setSelect\?\.addEventListener\('change',\(\)=>updateSetUi\(\{clearResult:true\}\)\)/);
  // Eski TL şablonunda seviye ve SING OFF kapalıdır.
  assert.match(APP, /levelSelect\.disabled=!usd/);
  assert.match(APP, /singOffEl\.hidden=!usd/);
});

test('Koleksiyon sonucu set kimliğiyle saklar; yeni set gelince "Yeni veri var"', () => {
  const saveAt = APP.indexOf('const nextEndeksmatik={');
  const save = APP.slice(saveAt, APP.indexOf('saveKolRows();renderKol();showToast', saveAt));
  assert.match(save, /setId:data\.source&&data\.source\.setId\|\|payload\.setId\|\|''/);
  assert.match(save, /level:payload\.level\|\|5/);
  assert.match(save, /singOff:payload\.singOff\|\|null/);
  const stale = slice('function endeksmatikSetSourceChanged(source)', 'function endeksmatikResultIsStale');
  assert.match(stale, /if\(!used\)return true;/);
  assert.match(stale, /String\(set\.region\|\|''\)===String\(used\.region\|\|''\)&&String\(set\.season\|\|''\)===String\(used\.season\|\|''\)/);
});

test('SING OFF: geçen FOB, YD karar fiyatı olarak önceden doldurulmaz', () => {
  const ctx = slice('function endeksmatikModelContext', 'function endeksmatikComponentTableHtml');
  assert.doesNotMatch(ctx, /singOff:\{overseasPrice/);
});
