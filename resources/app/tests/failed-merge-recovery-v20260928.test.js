'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'public', 'app-main.js'), 'utf8');
const chart = fs.readFileSync(path.join(root, 'public', 'backlog-chart.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
const intake = fs.readFileSync(path.join(root, 'public', 'intake.js'), 'utf8');

test('failed merge recovery keeps both Backlog chart date sources in export payload', () => {
  assert.match(app, /\[chartState\.timeField,chartState\.timeField2,chartState\.metricField,chartState\.seriesField\]/);
});

test('failed merge recovery keeps visible-range export bound to matching chart data', () => {
  assert.match(chart, /const requestedView=opts\.viewRange\|\|null,expectedSignature=chartViewSignature\(fullModel\)/);
  assert.match(chart, /const compatibleView=requestedView&&\(!requestedView\.signature\|\|requestedView\.signature===expectedSignature\)/);
  assert.match(chart, /const range=compatibleView\?clampChartRange\(requestedView,fullModel\.categories\.length\):ensureChartView\(fullModel\)/);
});

test('failed merge recovery keeps blank Backlog series live in Excel formulas', () => {
  assert.match(chart, /const seriesCriterion=serie\.baseName===tr\('\(boş\)','\(blank\)'\)\?'':serie\.baseName/);
  assert.match(chart, /criteria\.push\(seriesRange,formulaText\(seriesCriterion\)\)/);
  assert.match(chart, /predicates\.push\('\(' \+? /); // source contract checked below without relying on spacing
  assert.ok(chart.includes("if(hasSeries)predicates.push('('+seriesRange+'='+formulaText(seriesCriterion)+')');"));
});

test('previous Overview INTAKE recovery remains present', () => {
  assert.match(html, /id="intakeFiltersBtn"/);
  assert.match(html, /id="intakeFilterPanel"/);
  assert.match(intake, /function setFilterPanelOpen\(open\)/);
  assert.match(app, /loader\('intake\.js\?rev=4'\)/);
});
