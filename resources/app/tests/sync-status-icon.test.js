'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const ROOT=path.join(__dirname,'..');
const APP=fs.readFileSync(path.join(ROOT,'public','app-main.js'),'utf8');
const CSS=fs.readFileSync(path.join(ROOT,'public','app.css'),'utf8');
const INDEX=fs.readFileSync(path.join(ROOT,'public','index.html'),'utf8');

test('sync status header uses the shared compact line-icon pattern',()=>{
  assert.match(INDEX,/<symbol id="i-cloud"[\s\S]*?<\/symbol>/);
  assert.match(INDEX,/<symbol id="i-cloud-off"[\s\S]*?<\/symbol>/);
  assert.match(INDEX,/id="syncStatusBadge"[^>]*>[\s\S]*?<use href="#i-cloud-off"\/>/);
  // Sürüm numarası her yayında artıyor; test onu SABİTLEMEMELİ — v7.74'te
  // uygulama doğru çalışırken yalnızca bu sabit yüzünden kırmızıya düşüyordu.
  // Korunan kural cache-busting sorgusunun (v + rev) VARLIĞI, değeri değil.
  assert.match(INDEX,/app\.css\?v=__BL_ASSET_VERSION__&rev=\d+/);
  assert.match(INDEX,/app-main\.js\?v=__BL_ASSET_VERSION__&rev=[A-Za-z0-9._-]+/);
  assert.match(CSS,/\.syncStatusBadge\{[^}]*display:inline-flex/);
  assert.match(CSS,/\.syncStatusBadge\.is-offline/);
});

test('sync status refresh renders an accessible icon state instead of header text',()=>{
  assert.match(APP,/function syncStatusBadgeView\(s\)/);
  assert.match(APP,/function renderSyncStatusBadge\(s\)/);
  assert.match(APP,/if\(s&&s\.progress\)return \{icon:'i-cloud',tone:'syncing'/);
  assert.match(APP,/if\(pending\)return \{icon:'i-cloud',tone:'pending'/);
  assert.match(APP,/return \{icon:'i-cloud',tone:'synced'/);
  assert.match(APP,/refreshSyncStatusBadge\(\)[\s\S]*?renderSyncStatusBadge\(s\.status\)/);
  assert.doesNotMatch(APP,/b\.textContent=syncStatusText\(s\.status\)/);
  assert.match(APP,/setAttribute\('aria-label',view\.label\)/);
});
