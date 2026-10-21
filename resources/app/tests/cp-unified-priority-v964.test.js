'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const BR = require(path.join(ROOT, 'public', 'business-rules.js'));
const OD = require(path.join(ROOT, 'public', 'order-decision-engine.js'));
const CP = require(path.join(ROOT, 'public', 'cp-readiness-engine.js'));
const APP = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');
const HTML = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const PARSE = fs.readFileSync(path.join(ROOT, 'server', 'lib', 'parse.js'), 'utf8');
const BACKLOG = fs.readFileSync(path.join(ROOT, 'public', 'backlog-delivery-engine.js'), 'utf8');

const LEGACY = /(?:Ant\. Delay|MB Delay|\bIn Time\b|\bDiscount\b|\bShortage\b|\bHandover\b)/;

test('v9.64 Action Priority registry is the only severity vocabulary', () => {
  assert.deepEqual(OD.ACTION_PRIORITIES, ['CRITICAL','ACTION_TODAY','ACTION_THIS_WEEK','WATCH','ON_TRACK']);
  assert.equal(OD.ACTION_PRIORITY.CRITICAL.rank, 0);
  assert.equal(OD.ACTION_PRIORITY.ON_TRACK.rank, 4);
  assert.equal(OD.ACTION_PRIORITIES.includes('UNKNOWN'), false);
});

test('v9.64 business-rules emits operational signals but no legacy Priority display text', () => {
  const flags = BR.computePriorityFlags({
    exFactory: '2026-09-01', retailDate: '2026-12-01', inStoreDate: '2026-12-20',
    antArrival: '', handoverDate: '', shipConfirmationDate: '2026-09-01',
    status: 'Yükleme Operasyonları', delType: 'Gemi', season: '26W', country: 'India', today: '2026-09-07', rules: [],
  });
  assert.equal(Object.prototype.hasOwnProperty.call(flags, 'priority'), false);
  assert.equal(flags.handoverWarning, true);
  assert.ok(flags.signals.some(item => item.code === 'HANDOVER_PENDING'));
});

test('v9.64 Handover is a reason/signal and CP action is ACTION_THIS_WEEK', () => {
  const F = CP.FIELDS;
  const row = {
    [F.orderCode]:'U964-1',[F.model]:'M',[F.colourCode]:'C',[F.qty]:100,
    [F.status]:'Yükleme Operasyonları',[F.delType]:'Gemi',[F.country]:'India',[F.season]:'26W',
    [F.shipConfirmation]:'2026-09-01',[F.handover]:'',[F.exFactory]:'2026-09-01',
    [F.retail]:'2026-12-01',[F.inStore]:'2026-12-20',
  };
  const analysis = CP.analyzeOrder(row, { today: BR.defaultDateOrdinal('2026-09-07'), dateOrdinal: BR.defaultDateOrdinal, transitRules: [] });
  // v7.0.290: sistem önerisi korunur; Aksiyon Önceliği yalnız kurallarla yükselir.
  assert.equal(analysis.systemPriority, 'ACTION_THIS_WEEK');
  assert.equal(analysis.priority, 'ON_TRACK');
  assert.ok(analysis.riskReasons.includes('HANDOVER_PENDING'));
  assert.doesNotMatch(analysis.priority, LEGACY);
});

test('CP preserves canonical Action Priority while Orders no longer runs priority rules', () => {
  assert.match(APP, /row\['Priority'\]=code/);
  assert.doesNotMatch(APP, /row\['Priority'\]\s*=\s*cf\.priority/);
  // Unified Priority refactor ortak tablo primitive'lerini silemez. Priority
  // ilk hücrede `badge()` çağırdığı için bu helper eksikse CP render tamamen
  // durur; statusTone da sonraki Status/lojistik hücrelerinin dependency'sidir.
  assert.match(APP, /function badge\(text,tone\)\{/);
  assert.match(APP, /function statusTone\(s\)\{/);
  assert.match(APP, /function fillPrioritySelect\(id\)/);
  assert.match(APP, /priorityRank\(a\)-priorityRank\(b\)/);
  assert.match(APP, /key==='Priority' \? priorityDisplay\(v\)/);
  assert.match(APP, /syncUnifiedPrioritiesForTable\('cp'\)/);
  assert.doesNotMatch(APP, /syncUnifiedPrioritiesForTable\('orders'\)/);
  assert.match(APP, /if\(tableKey==='orders'\)return true;/);
  assert.match(HTML, /\(tableKey==='cp'\|\|tableKey==='orders'\)&&k==='Priority'/);
});

test('v9.64 server payload writes Action Priority from readiness decision, not legacy warning text', () => {
  assert.match(PARSE, /row\['Priority'\]\s*=\s*decision\s*&&\s*decision\.priority/);
  assert.doesNotMatch(PARSE, /const\s+priority\s*=\s*priorityFlags\.priority/);
  assert.doesNotMatch(PARSE, /function\s+backlogRiskValue\s*\(/);
  assert.match(PARSE, /signals:\s*operationalSignals/);
});

test('v9.64 Backlog compatibility priority is unified Action Priority, never meta warning text', () => {
  assert.match(BACKLOG, /priority:\s*actionDecision\.priority/);
  assert.doesNotMatch(BACKLOG, /priority:\s*text\(meta\.priority\)/);
});
