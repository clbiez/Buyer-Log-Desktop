'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const ROOT=path.join(__dirname,'..');
const APP=fs.readFileSync(path.join(ROOT,'public','app-main.js'),'utf8');
const FLOW=fs.readFileSync(path.join(ROOT,'public','overview-global-flow.js'),'utf8');
const DRAWER=fs.readFileSync(path.join(ROOT,'public','detail-drawer.js'),'utf8');
const CSS=fs.readFileSync(path.join(ROOT,'public','detail-drawer.css'),'utf8');

test('Global Flow details request the CP table setup',()=>{
  assert.ok(FLOW.includes("tableSetup:'cp'"));
  assert.ok(FLOW.includes("moduleId:'cp'"));
  assert.ok(FLOW.includes("rows:cpDetailRows(rows)"));
  assert.ok(FLOW.includes("columns:detailContextColumns()"));
  assert.ok(FLOW.includes("'STATUS':rec.status"));
  assert.ok(FLOW.includes("'HANDOVER Tarihi':rec.handover"));
  assert.ok(FLOW.includes("'Shipment Quantity':rec.qty"));
});

test('CP exposes one read-only snapshot for detail table views',()=>{
  assert.ok(APP.includes('window.BLTableViewSetup=Object.freeze({snapshot:detailTableViewSnapshot})'));
  assert.ok(APP.includes('normalizedColumnOrder(tableKey,state.order)'));
  // v7.0.229 — çekmece, ana tablonun Alanlar katmanını da (Tümü / Gizli başlıklar) miras alır.
  assert.ok(APP.includes("tableViewEffectiveKeys(tableKey,'focus')"));
  assert.ok(APP.includes("tableViewEffectiveKeys(tableKey,'extended')"));
  assert.ok(APP.includes('widthPx:colWidthPx(tableKey,column)'));
});

test('shared detail drawer renders Focus Extended All from the inherited setup',()=>{
  assert.ok(DRAWER.includes('data-bl-detail-view-preset'));
  assert.ok(DRAWER.includes("['focus','extended','all']"));
  assert.ok(DRAWER.includes('tableSetupSnapshot(input)'));
  assert.ok(DRAWER.includes('setupInitialPreset(setup)'));
  assert.ok(DRAWER.includes('setupVisibleKeys(setup,preset,contextKeys)'));
  assert.ok(DRAWER.includes('groupHeaderHtml(columns,showImages)'));
  assert.ok(CSS.includes('.blDetailViewPreset[aria-pressed="true"]'));
  assert.ok(CSS.includes('.blDetailGroupRow'));
});
