'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const radar = require('../public/overview-radar-charts.js');

const ROOT = path.join(__dirname, '..');
const INDEX = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const APP = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');
const SOURCE = fs.readFileSync(path.join(ROOT, 'public', 'overview-radar-charts.js'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'public', 'overview-radar.css'), 'utf8');

test('Radar numeric parser keeps Overview count and quantity cells deterministic', () => {
  assert.equal(radar.numberFromText('98'), 98);
  assert.equal(radar.numberFromText('423.287'), 423287);
  assert.equal(radar.numberFromText('2,438,888'), 2438888);
  assert.equal(radar.numberFromText('—'), 0);
});

test('Country and Sub-Manufacturer tables become one-series category radars', () => {
  const matrix = {
    headers: ['NAME', 'ORDER'],
    rows: [
      { rowIndex: 0, cells: ['Bangladesh', '98'] },
      { rowIndex: 1, cells: ['India', '46'] },
      { rowIndex: 2, cells: ['China', '2'] },
    ],
  };
  const config = radar.singleMetricConfig(matrix, 'country');
  assert.deepEqual(config.axes, ['Bangladesh', 'India', 'China']);
  assert.deepEqual(config.series[0].values, [98, 46, 2]);
  assert.deepEqual(config.axisRows, [0, 1, 2]);
});

test('Season radar uses order, priority and quantity metrics as radar axes', () => {
  const matrix = {
    headers: ['SEASON', 'ORDER', 'CRITICAL', 'ACTION TODAY', 'ACTION THIS WEEK', 'WATCH', 'ON TRACK', 'TOTAL QUANTITY'],
    rows: [
      { rowIndex: 0, cells: ['WS1', '74', '4', '0', '1', '69', '0', '423.287'] },
      { rowIndex: 1, cells: ['S7', '72', '0', '0', '21', '51', '0', '412.118'] },
    ],
  };
  const config = radar.multiMetricConfig(matrix, 'season');
  assert.deepEqual(config.axes, ['ORDER', 'CRITICAL', 'ACTION TODAY', 'ACTION THIS WEEK', 'WATCH', 'ON TRACK', 'TOTAL QUANTITY']);
  assert.equal(config.series.length, 2);
  assert.equal(config.series[0].label, 'WS1');
  assert.deepEqual(config.series[0].values, [74, 4, 0, 1, 69, 0, 423287]);
});

test('Buying Group radar excludes mixed-currency FOB axes but keeps operational metrics', () => {
  const matrix = {
    headers: ['BUYING GROUP', 'ACTIVE', 'TOTAL ORDERS', 'REMAINING QUANTITY', 'TOTAL QUANTITY', 'ACTIVE TOTAL FOB', 'TOTAL FOB'],
    rows: [
      { rowIndex: 0, cells: ['LISANS', '146', '156', '832.910', '901.015', '$2,438,888', '$2,651,114'] },
    ],
  };
  const config = radar.multiMetricConfig(matrix, 'buyingGroup');
  assert.deepEqual(config.axes, ['ACTIVE', 'TOTAL ORDERS', 'REMAINING QUANTITY', 'TOTAL QUANTITY']);
  assert.deepEqual(config.series[0].values, [146, 156, 832910, 901015]);
});

test('CP Priority radar counts orders and units from the same priority rows', () => {
  const codes = ['CRITICAL', 'ACTION_TODAY', 'ACTION_THIS_WEEK', 'WATCH', 'ON_TRACK', 'UNKNOWN'];
  const summary = radar.prioritySummary([
    { priority: 'CRITICAL', units: 100 },
    { priority: 'CRITICAL', units: 50 },
    { priority: 'ACTION_THIS_WEEK', units: 900 },
    { priority: 'WATCH', units: 2500 },
  ], codes);
  assert.deepEqual(summary.CRITICAL, { count: 2, units: 150 });
  assert.deepEqual(summary.ACTION_THIS_WEEK, { count: 1, units: 900 });
  assert.deepEqual(summary.WATCH, { count: 1, units: 2500 });
  assert.deepEqual(summary.ON_TRACK, { count: 0, units: 0 });
});

test('All four marked Overview modules are converted by the radar engine', () => {
  assert.match(SOURCE, /id:'tblCountry',mode:'single',key:'country'/);
  assert.match(SOURCE, /id:'tblLicense',mode:'single',key:'subManufacturer'/);
  assert.match(SOURCE, /id:'tblSeason',mode:'multi',key:'season'/);
  assert.match(SOURCE, /id:'tblBuyingGroup',mode:'multi',key:'buyingGroup'/);
  assert.match(CSS, /\.ovRadarSourceTable\{display:none!important;\}/);
  assert.match(INDEX, /overview-radar\.css/);
  assert.match(INDEX, /overview-radar-charts\.js/);
});

test('Priority radar is an independent Customize Layout module fed by filtered CP rows', () => {
  assert.match(INDEX, /data-overview-detail-widget="priorityRadar"/);
  assert.match(INDEX, /id="ovPriorityRadar"/);
  assert.match(APP, /renderOverviewPriorityRadar\(cpRows\)/);
  assert.match(APP, /window\.BLOverviewRadar\?\.renderPriority/);
  assert.match(APP, /priorityRadar:appLang==='en'\?'CP Priority Radar':'CP Öncelik Radarı'/);
});
