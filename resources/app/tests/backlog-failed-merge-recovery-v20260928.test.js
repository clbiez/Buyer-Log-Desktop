'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'public', 'app-main.js'), 'utf8');
const chart = fs.readFileSync(path.join(root, 'public', 'backlog-chart.js'), 'utf8');

test('recovered Backlog export keeps both chart date sources', () => {
  assert.match(app, /new Set\(\[chartState\.timeField,chartState\.timeField2,chartState\.metricField,chartState\.seriesField\]/);
});

test('recovered Backlog export reuses the visible range only for the same chart signature', () => {
  assert.match(chart, /const requestedView=opts\.viewRange\|\|null,expectedSignature=chartViewSignature\(fullModel\)/);
  assert.match(chart, /const compatibleView=requestedView&&\(!requestedView\.signature\|\|requestedView\.signature===expectedSignature\)/);
  assert.match(chart, /const range=compatibleView\?clampChartRange\(requestedView,fullModel\.categories\.length\):ensureChartView\(fullModel\)/);
});

test('recovered Backlog live Excel formulas map the displayed blank series back to an empty cell', () => {
  assert.match(chart, /const seriesCriterion=serie\.baseName===tr\('\(boş\)','\(blank\)'\)\?'':serie\.baseName/);
  assert.match(chart, /criteria\.push\(seriesRange,formulaText\(seriesCriterion\)\)/);
  assert.match(chart, /predicates\.push\('\('\+seriesRange\+'='\+formulaText\(seriesCriterion\)\+'\)'\)/);
});
