'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'public', 'app-main.js'), 'utf8');
const ui = fs.readFileSync(path.join(root, 'public', 'intake.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'public', 'app.css'), 'utf8');

test('INTAKE Overview yüzeyi kendi kontrolleri ve lazy loader ile bağlıdır', () => {
  for (const id of ['intakeSection', 'intakeConnectionBtn', 'intakeFieldsBtn', 'intakeResetBtn', 'intakeRefreshBtn', 'intakeFilterBar', 'intakeTable']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(app, /ensureOverviewIntakeModule/);
  assert.match(app, /loader\('intake\.js\?rev=[A-Za-z0-9._-]+'\)/);
  assert.match(app, /catalog:'WSSI Intake Raporu4', role:'intake'/);
  assert.match(app, /BL_GET_OVERVIEW_FILTERS/);
  assert.match(app, /BLINTAKE\?\.onOverviewFiltersChanged/);
  assert.match(ui, /openDataSourceAndFilters\(\{ target: 'intake' \}\)/);
  assert.match(ui, /metadataPromise: null/);
  assert.match(ui, /if \(state\.metadataLoading\) return state\.metadataPromise \|\| Promise\.resolve\(\)/);
  assert.match(ui, /state\.metadataPromise = \(async \(\) =>/);
  assert.match(html, /data-overview-widget="intake"/);
  assert.match(app, /MODEL_TARGET_LABELS=\{[^}]*intake:'INTAKE'/);
  /* v7.81: bağlantı listesi ve alan eşlemesi başlığı eski modaldaydı; ikisi de
     Veri Yönetimi ekranına taşındı. INTAKE'in korunan güvencesi aynı — kendi
     kaynağı listelenebilir olmalı ve eşleme düzenlenebilmeli. */
  const readModel = fs.readFileSync(path.join(root, 'server', 'lib', 'data-domain', 'read-model.js'), 'utf8');
  assert.match(readModel, /mappedFieldCount/);
  const profiles = require('../server/lib/data-domain/source-profiles');
  assert.ok(profiles.get('intake-budget'), 'INTAKE kaynak profili tanımlı olmalı');
  assert.deepEqual(profiles.get('intake-budget').feedableModules, ['intake']);
  /* v7.81 — Rozetteki "Yenile" düğmesi (INTAKE'i de tazeleyen kısayol)
     kaldırıldı: modül başlığı artık salt okunur özet taşıyor. İŞLEV
     KAYBI YOK — INTAKE'in kendi yenileme düğmesi intake.js'te bağlı;
     korunan güvence oydu. */
  const intakeUi = fs.readFileSync(path.join(root, 'public', 'intake.js'), 'utf8');
  assert.match(intakeUi, /byId\('intakeRefreshBtn'\)\?\.addEventListener\('click'/,
    'INTAKE kendi yenileme düğmesini bağlamalı');
  assert.match(app, /ensureOverviewIntakeModule/);
});

test('INTAKE bağlantı ayarları ana veri offline olsa da yerel sunucudan yüklenir', () => {
  assert.match(app, /function modelConnectionApiAvailable\(\)/);
  assert.match(app, /location\.protocol==='http:'\|\|location\.protocol==='https:'/);
  const load = app.match(/async function modelConnLoad\(\)\{([\s\S]*?)\n\}/)?.[1] || '';
  const save = app.match(/async function modelConnSave\(items\)\{([\s\S]*?)\n\}/)?.[1] || '';
  assert.match(load, /modelConnectionApiAvailable\(\)/);
  assert.match(save, /modelConnectionApiAvailable\(\)/);
  assert.doesNotMatch(load, /SERVER_BACKED/);
  assert.doesNotMatch(save, /SERVER_BACKED/);
});

test('INTAKE UI alan ekleme, sürükleyerek sıralama, etiket ve filtre akışlarını içerir', () => {
  for (const marker of [
    '/api/intake/state',
    '/api/intake/metadata',
    '/api/intake/settings',
    '/api/intake/distinct',
    '/api/intake/report',
    'data-intake-add',
    'data-intake-remove',
    'dragstart',
    'data-intake-rename',
    'data-intake-filter',
    'data-intake-add-filter',
  ]) assert.match(ui, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(css, /\.intakeSection/);
  assert.match(css, /\.intakeConfigRow\{[^}]*cursor:grab/);
  assert.match(css, /\.intakeFilterPopover/);
});
