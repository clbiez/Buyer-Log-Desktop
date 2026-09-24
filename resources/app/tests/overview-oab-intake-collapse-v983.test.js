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

test('v7.83 page collapse düğmeleri ortak layout state ile uygulanır ve persist edilir', () => {
  assert.match(APP, /data-overview-collapse/);
  assert.match(APP, /next\.collapsed\[key\]=!next\.collapsed\[key\]/);
  assert.match(APP, /overviewLayoutSave\(next\);renderOverviewLayout\(\)/);
  assert.match(APP, /overviewLayoutApplyPageState\(widget,state\)/);
  assert.match(CSS, /:not\(\.intakeHeader\)/);
});
