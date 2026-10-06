'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
const APP = read('public/app-main.js');
const VIEW = read('public/cp-overview-assistant.js');

test('Overview CP dependency loads in background without rendering the hidden CP table', () => {
  assert.match(APP, /function ensureOverviewCpDependency\(\)/);
  assert.match(APP, /ensureCpLoaded\(\{deferRender:true,reason:'overview'\}\)/);
  const ensureStart = APP.indexOf('function ensureOverviewCpDependency()');
  const ensureBlock = APP.slice(ensureStart, ensureStart + 1200);
  assert.doesNotMatch(ensureBlock, /renderCP\(/, 'Overview dependency helper must not render CP table DOM');
  assert.match(APP, /if\(cpLoadPromise\)return cpLoadPromise;/, 'CP requests must remain deduplicated');
});

test('cold Overview distinguishes loading from a genuinely empty CP dataset', () => {
  const renderStart = APP.indexOf('function renderOverviewNow()');
  const renderBlock = APP.slice(renderStart, renderStart + 4200);
  assert.match(renderBlock, /if\(!state\.cp\)\{/);
  assert.match(renderBlock, /renderOverviewCpDependencyState\(mode,overviewCpLoadError\)/);
  assert.match(renderBlock, /void ensureOverviewCpDependency\(\)/);
  assert.match(APP, /Üretim öncelikleri hazırlanıyor…/);
  assert.match(APP, /Preparing production priorities…/);
  assert.match(APP, /overviewCpLoadState='error'/);
  assert.match(APP, /data-overview-cp-retry/);
});

test('CP ready invalidates visible Overview or marks hidden Overview dirty', () => {
  assert.match(APP, /function scheduleOverviewRender\(reason='data'\)/);
  assert.match(APP, /if\(currentActiveTab\(\)!=='overview'\)\{_deferredTabRenders\.add\('overview'\);return;\}/);
  assert.match(APP, /scheduleOverviewRender\('cp-ready'\)/);
  assert.match(APP, /window\.BLPerf\?\.mark\?\.\('CP_LOAD_READY'/);
  assert.match(APP, /window\.BLPerf\?\.mark\?\.\('OVERVIEW_INVALIDATED'/);
});

test('Production Focus cache uses dataset revision and Overview filter signature', () => {
  assert.match(APP, /dataRevision:_unifiedPriorityDataRevision/);
  assert.match(APP, /filterRevision:overviewCpFilterSignature\(\)/);
  assert.match(APP, /function overviewCpFilterSignature\(\)/);
  assert.match(VIEW, /function onOverviewRendered\(rows, context = \{\}\)/);
  assert.match(VIEW, /const dataRevision = Number\(context && context\.dataRevision\) \|\| 0/);
  assert.match(VIEW, /const filterRevision = String\(context && context\.filterRevision \|\| ''\)/);
  assert.match(VIEW, /datasetSignature = dataRevision > 0/);
  assert.match(VIEW, /decision:\$\{decisionContextRevision\}/);
  assert.match(VIEW, /PRODUCTION_FOCUS_RECOMPUTE/);
});

test('old length + first order identity is only a compatibility fallback, not authoritative when revision exists', () => {
  const start = VIEW.indexOf('function onOverviewRendered');
  const block = VIEW.slice(start, start + 1900);
  const revisionBranch = block.indexOf('dataRevision > 0');
  const fallback = block.indexOf("fallback:${list.length}");
  assert.ok(revisionBranch >= 0 && fallback > revisionBranch, 'revision must be selected before compatibility fallback');
  assert.match(block, /rev:\$\{dataRevision\}/);
});

test('personal Priority Rules / checklist changes invalidate Overview too', () => {
  const start = APP.indexOf("window.addEventListener('bl:cp-decision-context-changed'");
  const block = APP.slice(start, start + 500);
  assert.match(block, /invalidateUnifiedPriorityDecisions\('personal-decision-context',\['cp'\]\)/);
  assert.match(block, /scheduleOverviewRender\('personal-decision-context'\)/);
});

test('local CP edits, remote decision patches and transit-rule changes invalidate Overview', () => {
  const refreshRowStart = APP.indexOf('function refreshRowEverywhere(id)');
  const refreshRowBlock = APP.slice(refreshRowStart, refreshRowStart + 700);
  assert.match(refreshRowBlock, /scheduleOverviewRender\('cp-row-updated'\)/);
  assert.match(APP, /invalidateUnifiedPriorityDecisions\('transit-rules-local'\);\s*scheduleOverviewRender\('transit-rules-local'\)/);
  assert.match(APP, /invalidateUnifiedPriorityDecisions\('remote-cp-decision-patch'\);scheduleOverviewRender\('remote-cp-decision-patch'\)/);
});
