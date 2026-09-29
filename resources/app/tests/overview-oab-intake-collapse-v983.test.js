'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const INDEX = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const APP = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');
const OAB = fs.readFileSync(path.join(ROOT, 'public', 'oab.js'), 'utf8');
const HOME_CSS = fs.readFileSync(path.join(ROOT, 'public', 'overview-home.css'), 'utf8');

test('v7.83 OAB KPI özet satırı kaldırılmıştır', () => {
  assert.doesNotMatch(INDEX, /id="oabKpiRow"/);
  assert.doesNotMatch(OAB, /OAB_KPI_FIELDS|function oabRenderKpis|oabRenderKpis\(\)/);
});

test('OAB ve INTAKE ana ekran widget\'ıdır: daraltma yerine ızgara boyutu, tablo kalan yüksekliği kaydırır', () => {
  const oabHeader = INDEX.slice(INDEX.indexOf('<div class="oabHeader">'), INDEX.indexOf('<div class="oabAuthBar"'));
  const intakeHeader = INDEX.slice(INDEX.indexOf('<div class="intakeHeader">'), INDEX.indexOf('<div id="intakeHorizonBadge"'));
  assert.doesNotMatch(oabHeader + intakeHeader, /data-overview-collapse|id="oabCollapseBtn"|id="intakeCollapseBtn"/);
  assert.doesNotMatch(APP, /overviewLayoutApplyPageState|next\.collapsed\[key\]/);
  assert.match(HOME_CSS, /\.ovHome>#oabSection \.oabTableWrap,\.ovHome>#intakeSection \.intakeTableWrap\{[^}]*overflow:auto/);
});

test('INTAKE pivot grupları OAB ile aynı daralt/tümünü genişlet aksiyonlarını taşır', () => {
  const intakeHeader = INDEX.slice(INDEX.indexOf('<div class="intakeHeader">'), INDEX.indexOf('<div id="intakeHorizonBadge"'));
  assert.match(intakeHeader, /id="intakeCollapseAllBtn"/);
  assert.match(intakeHeader, /id="intakeExpandAllBtn"/);
  assert.match(intakeHeader, /i-chevrons-left/);
  assert.match(intakeHeader, /i-chevrons-right/);
});

test('INTAKE pivot ayarı kalem ikonudur ve DB düğmesi yoktur', () => {
  const intakeHeader = INDEX.slice(INDEX.indexOf('<div class="intakeHeader">'), INDEX.indexOf('<div id="intakeHorizonBadge"'));
  assert.doesNotMatch(intakeHeader, /id="intakeConnectionBtn"|Veritabanı bağlantısı|Database connection/);
  const fieldsPos = intakeHeader.indexOf('id="intakeFieldsBtn"');
  assert.ok(fieldsPos > 0);
  assert.match(intakeHeader.slice(fieldsPos, fieldsPos + 700), /i-pencil/);
});

test('Overview sipariş KPI özet satırı görünmez', () => {
  const match = INDEX.match(/<div class="kpirow" id="kpiOrders"([^>]*)><\/div>/);
  assert.ok(match);
  assert.match(match[1], /hidden/);
  assert.match(match[1], /aria-hidden="true"/);
  assert.match(match[1], /display:none!important/);
});
