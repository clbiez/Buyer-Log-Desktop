'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const radar = require('../public/overview-radar-charts.js');

const ROOT = path.join(__dirname, '..');
const INDEX = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const SOURCE = fs.readFileSync(path.join(ROOT, 'public', 'overview-radar-charts.js'), 'utf8');
const APP = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'public', 'overview-radar.css'), 'utf8');

test('Radar sayı ayrıştırıcısı Türkçe binlik gösterimini tam sayıya çevirir', () => {
  assert.equal(radar.numberFromText('149.762 units'), 149762);
  assert.equal(radar.numberFromText('22'), 22);
  assert.equal(radar.numberFromText('—'), 0);
});

test('Radar seri ve eksen normalizasyonları 0..1 aralığında kalır', () => {
  const bySeries = radar.normalizeSeries([{label:'A',values:[10,20,5]}], 'series');
  assert.deepEqual(bySeries[0].normalized, [0.5,1,0.25]);
  const byAxis = radar.normalizeSeries([{label:'A',values:[10,10]},{label:'B',values:[20,5]}], 'axis');
  assert.deepEqual(byAxis[0].normalized, [0.5,1]);
  assert.deepEqual(byAxis[1].normalized, [1,0.5]);
});

test('CP priority radar sipariş ve adet değerlerini aynı priority sözleşmesinden toplar', () => {
  const sum = radar.prioritySummary([
    {priority:'CRITICAL',units:100},
    {priority:'CRITICAL',units:50},
    {priority:'ACTION_THIS_WEEK',units:25},
  ], ['CRITICAL','ACTION_THIS_WEEK','ON_TRACK']);
  assert.deepEqual(sum.CRITICAL, {count:2,units:150});
  assert.deepEqual(sum.ACTION_THIS_WEEK, {count:1,units:25});
  assert.deepEqual(sum.ON_TRACK, {count:0,units:0});
});

test('İşaretlenen dört Overview özeti radar motoruna bağlıdır', () => {
  for (const id of ['tblCountry','tblLicense','tblSeason','tblBuyingGroup']) {
    assert.match(SOURCE, new RegExp("id:'"+id+"'"));
    assert.match(INDEX, new RegExp('id="'+id+'"'));
  }
  assert.match(CSS, /\.ovRadarSourceTable\{display:none!important;\}/);
  assert.match(INDEX, /overview-radar-charts\.js/);
  assert.match(INDEX, /overview-radar\.css/);
});

test('CP priority radar bağımsız Overview modülü olarak eklenip çıkarılabilir', () => {
  assert.match(INDEX, /data-overview-detail-widget="priorityRadar"/);
  assert.match(INDEX, /id="ovPriorityRadar"/);
  assert.match(APP, /renderOverviewPriorityRadar\(cpRows\)/);
  assert.match(APP, /priorityRadar:appLang/);
});
