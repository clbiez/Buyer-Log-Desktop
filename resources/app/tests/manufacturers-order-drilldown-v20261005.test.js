'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const PAGE = fs.readFileSync(path.join(ROOT, 'public', 'manufacturers.js'), 'utf8');
const CSS = require('./helpers/manifest-css')(['ui-tokens.css','app.css','design.css','experience.css','ui-components.css','manufacturers.css'] );
const BACKLOG = fs.readFileSync(path.join(ROOT, 'public', 'backlog-overview.js'), 'utf8');

test('manufacturer and backlog drilldown scripts remain syntactically valid', () => {
  assert.doesNotThrow(() => new Function(PAGE));
  assert.doesNotThrow(() => new Function(BACKLOG));
});

test('order summary cards expose drilldown targets', () => {
  for (const kind of ['all', 'open', 'recent_loaded', 'month', 'mag', 'on_time', 'revised', 'late', 'overdue']) {
    assert.match(PAGE, new RegExp(`data-mfp-drill=["\\']${kind}["\\']|kind === ["\\']${kind}["\\']`), kind);
  }
  assert.match(PAGE, /data-mfp-drill-value/);
  assert.match(PAGE, /data-mfp-drill-label/);
});

test('manufacturer drilldown reuses Backlog V3 normalization and native detail drawer', () => {
  assert.match(PAGE, /window\.BLBacklogV3Report/);
  assert.match(PAGE, /report\.normalizeRows\(adapted\)/);
  assert.match(PAGE, /window\.BLBacklogOverview\?\.openItems\?\.\(items/);
  assert.match(PAGE, /openOrders\(card, rows, title \|\| card\.name\)/, 'generic drawer remains as a safe fallback');
  assert.match(BACKLOG, /function openExternalItems\(externalItems,options\)/);
  assert.match(BACKLOG, /openItems:openExternalItems/);
});

test('clicked KPI quantity semantics match the summary being opened', () => {
  assert.match(PAGE, /if \(kind === 'open'\) return rowNumber\(row, E\.KEYS\.remaining\)/);
  assert.match(PAGE, /if \(kind === 'recent_loaded'\)/);
  assert.match(PAGE, /E\.KEYS\.shipmentQuantity/);
});

test('clickable summary controls preserve keyboard focus and hover affordance', () => {
  require('./helpers/manifest-css').assertFocus();
  for(const name of ['Tile','Metric','Month','Chip']) assert.ok(CSS.includes('.mfp'+name+'.isDrill'),name+' keeps the shared interactive class');
  assert.match(CSS, /\.mfpTile\.isDrill:hover/);
});
