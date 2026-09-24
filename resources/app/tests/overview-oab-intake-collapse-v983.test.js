'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const INDEX = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const APP = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');
const OAB = fs.readFileSync(path.join(ROOT, 'public', 'oab.js'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'public', 'app.css'), 'utf8');

test('v7.83 OAB KPI özet satırı kaldırılmıştır', () => {
  assert.doesNotMatch(INDEX, /id="oabKpiRow"/);
  assert.doesNotMatch(OAB, /OAB_KPI_FIELDS|function oabRenderKpis|oabRenderKpis\(\)/);
});

test('v7.83 OAB ve INTAKE başlıklarında ortak daraltma düğmesi bulunur', () => {
  const oabHeader = INDEX.slice(INDEX.indexOf('<div class="oabHeader">'), INDEX.indexOf('<div class="oabAuthBar"'));
  const intakeHeader = INDEX.slice(INDEX.indexOf('<div class="intakeHeader">'), INDEX.indexOf('<div id="intakeHorizonBadge"'));
  assert.match(oabHeader, /data-overview-collapse="oab"/);
  assert.match(oabHeader, /id="oabCollapseBtn"/);
  assert.match(intakeHeader, /data-overview-collapse="intake"/);
  assert.match(intakeHeader, /id="intakeCollapseBtn"/);
  assert.match(oabHeader + intakeHeader, /i-chevron-up/);
});

test('INTAKE pivot grupları OAB ile aynı daralt/tümünü genişlet aksiyonlarını taşır', () => {
  const intakeHeader = INDEX.slice(INDEX.indexOf('<div class="intakeHeader">'), INDEX.indexOf('<div id="intakeHorizonBadge"'));
  assert.match(intakeHeader, /id="intakeCollapseAllBtn"/);
  assert.match(intakeHeader, /id="intakeExpandAllBtn"/);
  assert.match(intakeHeader, /i-chevrons-left/);
  assert.match(intakeHeader, /i-chevrons-right/);
});

test('INTAKE pivot ayarı OAB gibi daraltma okunun sağında kalem ikonudur ve DB düğmesi yoktur', () => {
  const intakeHeader = INDEX.slice(INDEX.indexOf('<div class="intakeHeader">'), INDEX.indexOf('<div id="intakeHorizonBadge"'));
  assert.doesNotMatch(intakeHeader, /id="intakeConnectionBtn"|Veritabanı bağlantısı|Database connection/);
  const collapsePos = intakeHeader.indexOf('id="intakeCollapseBtn"');
  const fieldsPos = intakeHeader.indexOf('id="intakeFieldsBtn"');
  assert.ok(collapsePos >= 0 && fieldsPos > collapsePos, 'kalem daralt/genişlet okunun sağında olmalı');
  assert.match(intakeHeader.slice(fieldsPos, fieldsPos + 700), /i-pencil/);
});

test('Overview sipariş KPI özet satırı görünmez', () => {
  const match = INDEX.match(/<div class="kpirow" id="kpiOrders"([^>]*)><\/div>/);
  assert.ok(match);
  assert.match(match[1], /hidden/);
  assert.match(match[1], /aria-hidden="true"/);
  assert.match(match[1], /display:none!important/);
});

test('v7.83 page collapse düğmeleri ortak layout state ile uygulanır ve persist edilir', () => {
  assert.match(APP, /data-overview-collapse/);
  assert.match(APP, /next\.collapsed\[key\]=!next\.collapsed\[key\]/);
  assert.match(APP, /overviewLayoutSave\(next\);renderOverviewLayout\(\)/);
  assert.match(APP, /overviewLayoutApplyPageState\(widget,state\)/);
  assert.match(CSS, /:not\(\.intakeHeader\)/);
});
