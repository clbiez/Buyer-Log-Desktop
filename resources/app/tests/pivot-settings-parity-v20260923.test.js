'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const intakeUi = fs.readFileSync(path.join(root, 'public', 'intake.js'), 'utf8');
const oabUi = fs.readFileSync(path.join(root, 'public', 'oab.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'public', 'app.css'), 'utf8');
const intake = require('../server/lib/intake-report');

test('INTAKE pivot settings OAB ile aynı ana kontrolleri taşır', () => {
  for (const marker of [
    'intakeGroupedViewInput', 'intakeShowSubtotalsInput', 'intakeHideZeroBudgetInput', 'intakePivotRowsList',
    'intakePivotColsList', 'intakePivotValuesList', 'intakePivotValueAgg',
    'Pivot Rows', 'Pivot Columns', 'Pivot Values', 'Grouped pivot view',
    'Show subtotals and grand total', 'Hide rows where Current Purchase Budget is 0',
  ]) assert.ok(intakeUi.includes(marker), `INTAKE UI marker missing: ${marker}`);
  for (const agg of ['SUM', 'AVG', 'COUNT', 'MIN', 'MAX', 'FIRST']) assert.ok(intakeUi.includes(`'${agg}'`), `Aggregate missing: ${agg}`);
});

test('INTAKE aggregate ve grouped görünüm ayarları reconcile sırasında korunur', () => {
  const fields = intake.normalizeSchema({
    columns: [{ table: 'Dim', name: 'Group' }],
    measures: [{ table: 'Measures', name: 'Budget' }],
  });
  const row = fields.find(field => field.fieldType === 'dimension');
  const value = fields.find(field => field.fieldType === 'measure');
  const view = intake.reconcileViewConfig({
    version: 1,
    query: { rows: [row], columns: [], measures: [{ ...value, agg: 'FIRST' }], filters: [], filterValues: {} },
    display: { grouped: false, showSubtotals: false, collapsedGroups: ['["A"]'], hideZeroCurrentBudget: false },
  }, fields);
  assert.equal(view.query.measures[0].agg, 'FIRST');
  assert.equal(view.display.grouped, false);
  assert.equal(view.display.showSubtotals, false);
  assert.equal(view.display.hideZeroCurrentBudget, false);
  assert.deepEqual(view.display.collapsedGroups, ['["A"]']);
});

test('OAB ve INTAKE pivot ayar satırları sürükle-bırak sıralamayı destekler', () => {
  assert.ok(oabUi.includes('oabConfigRow" draggable="true"'));
  // Olaylar ortak modülde (public/pivot-config-reorder.js); iki widget aynı bind'i kullanır.
  const reorder = fs.readFileSync(path.join(root, 'public', 'pivot-config-reorder.js'), 'utf8');
  for (const event of ['dragstart', 'dragover', 'drop', 'dragend']) assert.ok(reorder.includes(`container.addEventListener('${event}'`), event);
  assert.ok(oabUi.includes('BLPivotConfigReorder?.bind(modal'));
  assert.ok(intakeUi.includes('oabConfigRow intakeConfigRow" draggable="true"'));
  assert.ok(intakeUi.includes('BLPivotConfigReorder?.bind(modal'));
  assert.ok(css.includes('.oabConfigRow[draggable="true"]{cursor:grab;'));
});
