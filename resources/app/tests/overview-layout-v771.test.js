'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const layout = require('../public/overview-layout.js');
const ROOT = require('node:path').join(__dirname, '..');
const INDEX = fs.readFileSync(require('node:path').join(ROOT, 'public', 'index.html'), 'utf8');
const APP = fs.readFileSync(require('node:path').join(ROOT, 'public', 'app-main.js'), 'utf8');

test('Overview default layout opens with Today launchpad and keeps Collection Summary directly above OAB', () => {
  const value = layout.normalize(null);
  assert.deepEqual(value.order.slice(0, 5), ['launchpad', 'notes', 'collectionSummary', 'oab', 'intake']);
  assert.equal(value.hidden.includes('collectionSummary'), false);
  assert.equal(value.widths.intake, 'full');\n  assert.equal(value.details.order[1], 'priorityRadar');\n  assert.equal(value.details.widths.priorityRadar, 'full');
});

test('Overview layout drops unknown widgets and clamps widths', () => {
  const value = layout.normalize({ order: ['oab', 'unknown', 'collectionSummary'], hidden: ['notes', 'unknown'], widths: { oab: 'quarter', collectionSummary: 'half' } });
  // Kayıtlı eski düzende olmayan "Bugün" modülü en üste, diğer eksikler sona eklenir.
  assert.deepEqual(value.order, ['launchpad', 'oab', 'collectionSummary', 'notes', 'intake', 'overviewContent']);
  assert.deepEqual(value.hidden, ['notes']);
  assert.equal(value.widths.oab, 'quarter');
  assert.equal(value.widths.collectionSummary, 'half');
});

test('Overview layout persists bounded widget heights for pointer resizing', () => {
  const value = layout.normalize({ heights: { intake: 420, unknown: 300 }, details: { heights: { country: 280 } } });
  assert.equal(value.heights.intake, 420);
  assert.equal(value.heights.unknown, undefined);
  assert.equal(value.details.heights.country, 280);
  assert.match(APP, /ovWidgetResizeHandle/);
});

test('Overview layout supports moving a widget without changing data state', () => {
  assert.deepEqual(layout.move(['notes', 'collectionSummary', 'oab'], 'oab', -1), ['notes', 'oab', 'collectionSummary']);
});

test('Overview edit mode and Collection Summary configurable scope keep dedicated UI hooks', () => {
  assert.match(INDEX, /id="ovDashboardGrid"/);
  assert.match(INDEX, /id="ovLayoutEditBtn"/);
  assert.match(INDEX, /id="ovCollectionSummaryScopeLabel"/);
  assert.match(INDEX, /id="ovCollectionSummaryScopeTrigger"/);
  assert.doesNotMatch(INDEX, /id="ovCollectionSummarySettingsBtn"/);
  assert.match(APP, /OVERVIEW_LAYOUT_KEY/);
  assert.match(APP, /draggable/);
  assert.match(APP, /scopeColumn,scopeValues/);
  assert.match(INDEX, /data-overview-widget="intake"/);\n  assert.match(INDEX, /data-overview-detail-widget="priorityRadar"/);\n  assert.ok(layout.detailWidgets.includes('priorityRadar'));
});
