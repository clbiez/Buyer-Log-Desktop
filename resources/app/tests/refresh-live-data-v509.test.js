'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');
const SERVER = fs.readFileSync(path.join(ROOT, 'server', 'server.js'), 'utf8');

function between(source, start, end) {
  const a = source.indexOf(start);
  assert.ok(a >= 0, `${start} bulunmalı`);
  const b = source.indexOf(end, a + start.length);
  assert.ok(b > a, `${end} bulunmalı`);
  return source.slice(a, b);
}

test('v5.09 refresh job has an identity and terminal loadedAt marker', () => {
  const state = between(SERVER, 'function refreshJobState(id)', 'async function performRefresh');
  assert.match(state, /jobId:\s*job\.jobId/);
  assert.match(state, /loadedAt:\s*job\.loadedAt/);
  // The async job is created by the shared native start used by the HTTP route and Agent Office.
  const route = between(SERVER, 'function startNativeRefresh(', "app.post('/api/overrides/batch'");
  assert.match(route, /startNativeRefresh\(req\.currentUser, rawTargets\)/);
  assert.match(route, /jobId:\s*`\$\{Date\.now\(\)\.toString\(36\)\}/);
  assert.match(route, /job\.loadedAt\s*=\s*cacheForUser\(id\)\.loadedAt/);
});

test('v5.09 frontend never treats idle or another refresh job as success', () => {
  const block = between(APP, 'async function waitForRefreshJob(expectedJob=null)', '// İlk sayfa açılışı');
  assert.match(block, /String\(jobState\.jobId\|\|''\)===expectedId/);
  assert.match(block, /if\(jobState\.phase!==['"]done['"]\)/);
  assert.match(block, /if\(!res\.ok\)/);
  assert.doesNotMatch(block, /if\(state\.running\) continue;\s*if\(state\.error\)/);
});

test('v5.09 completed refresh reloads current data with no-store and verifies the snapshot', () => {
  const block = between(APP, 'async function loadFromServer(force, targets)', '// Yenile: ASAS aktif Data Model');
  assert.match(block, /fetch\(`\/api\/data\?mode=initial&_refresh=\$\{Date\.now\(\)\}`/);
  assert.match(block, /cache:'no-store'/);
  assert.match(block, /completedJob\.loadedAt&&data\.loadedAt/);
  assert.match(block, /data\.refreshSummary=completedJob\.summary/);
});

// Tıklama işleyicisi artık tek-ifadeli değil: devam eden bir yenileme varsa iptal
// isteği gönderip erken çıkan bir gövde kazandı (isRefreshRunning/requestRefreshCancel).
test('v5.09 Source Refresh All explicitly refreshes every live target', () => {
  // v7.26: Kaynak Veri şeridindeki yenileme düğmeleri kullanıcı talebiyle
  // kaldırıldı; dinleyici isteğe bağlı bağlanıyor (düğme yoksa hiçbir şey
  // yapmaz). Testin AMACI değişmedi: "tümünü yenile" yolu HÂLÂ dört hedefin
  // dördünü de açıkça yeniliyor olmalı — bir hedefin sessizce düşmemesi için.
  assert.match(APP, /serverRefreshBtn['"]\)\?\.addEventListener\(['"]click['"],\s*\(\)=>\{[\s\S]{0,240}?loadFromServer\(true,\['cp','orders','backlog','lfl'\]\)/);
  // v2026-10-30 — Başlıktaki Yenile menüsünün "Diğer modüller + CP" satırı CP dahil
  // bütün hedefleri yeniler (ayrı "Tümü" satırı yok); gruba girmeyen hedef de
  // kendi satırını alır — hiçbir hedef menüden sessizce düşmez.
  const menu = APP.slice(APP.indexOf('function openTopRefreshMenu'), APP.indexOf('// Yenile sürerken aynı düğmeye'));
  assert.match(menu, /const linkedTargets=withLinkedRefreshTargets\(members\);/);
  assert.match(menu, /ALL_REFRESH_TARGETS\.forEach\(target=>\{\s*if\(!options\.some\(\(\[,,targets\]\)=>targets\.includes\(target\)\)\)options\.push/);
  assert.match(APP, /LINKED_REFRESH_CHAIN\.forEach\(target=>\{if\(!list\.includes\(target\)\)list\.push\(target\);\}\);/);
  assert.match(menu, /return loadFromServer\(true,option\[2\]\.slice\(\)\)/);
  assert.match(APP, /const ALL_REFRESH_TARGETS=Object\.freeze\(\['cp','orders','backlog','lfl','priceanalysis'\]\);/);
});

test('v5.09 top/source LFL refresh reloads the LFL module from the new server cache', () => {
  const block = between(APP, 'async function loadFromServer(force, targets)', '// Yenile: ASAS aktif Data Model');
  assert.match(block, /targets\.includes\('lfl'\)/);
  assert.match(block, /window\.reloadLflFromCache/);
  assert.match(block, /await window\.reloadLflFromCache\(\)/);
});

test('v5.09 dynamic data endpoints explicitly disable response caching', () => {
  assert.match(SERVER, /app\.get\('\/api\/refresh-status'[\s\S]*?Cache-Control[\s\S]*?no-store/);
  assert.match(SERVER, /app\.get\('\/api\/data'[\s\S]*?Cache-Control[\s\S]*?no-store/);
});
