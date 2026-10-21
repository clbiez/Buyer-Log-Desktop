'use strict';

/* v7.0.290 — Kullanıcı talebi:
   "Rules kısmında sildiğim priority kuralları hala buyer log'da görünmeye devam
   ediyor. Sadece kullanıcının ayarladığı kural ve checklistler çalışsın."
   "Moderatör olarak sildiklerim ve eklediklerimi dilersem tüm kullanıcılara
   uygulayabilmek istiyorum. Kullanıcıların kendi kurdukları checklist ve
   kurallara karışmayacağım." */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bl-rules-only-'));
for (const key of ['BUYER_LOG_DATA_ROOT', 'BUYER_LOG_LOCAL_DATA_ROOT', 'BUYER_LOG_SERVER_DATA_ROOT', 'BUYER_LOG_AUTH_DATA_ROOT']) process.env[key] = root;
test.after(() => fs.rmSync(root, { recursive: true, force: true }));

const CP = require('../public/cp-readiness-engine.js');
const Rules = require('../public/cp-rules-engine.js');
const APP = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(APP, file), 'utf8');

const F = CP.FIELDS;
const TODAY = CP.defaultOrdinal(new Date('2026-09-15T12:00:00Z'));
const overdueRow = {
  [F.orderCode]: 'RO-1', [F.model]: 'DEMO MODEL', [F.colourCode]: 'C1', [F.status]: 'Üretimde',
  [F.orderDate]: '2026-06-01', [F.exFactory]: '2026-09-01', [F.retail]: '2026-10-01', [F.inStore]: '2026-10-20',
  [F.delType]: 'Gemi', [F.qty]: 100, [F.season]: '26W', [F.country]: 'India',
};

test('engine suggestion no longer escalates by itself; only rules do', () => {
  const analysis = CP.analyzeOrder(overdueRow, { today: TODAY, transitRules: [] });
  assert.equal(analysis.priority, 'ON_TRACK');
  assert.equal(analysis.decision.action.priority, 'ON_TRACK');
  assert.deepEqual(analysis.actionReasons, []);
  assert.notEqual(analysis.systemPriority, 'ON_TRACK', 'suggestion is kept for [@basePriority]');
  assert.ok(analysis.riskReasons.includes('EX_FACTORY_OVERDUE'), 'reasons stay informational');
  // No rules at all → nothing is escalated.
  assert.equal(Rules.evaluateOrder(analysis, { rules: [], answers: {} }).priority, 'ON_TRACK');
  // A user rule can opt into the engine suggestion explicitly.
  const rule = Rules.normalizeRule({ id: 'use-suggestion', kind: 'priority', target: 'CRITICAL', name: 'Suggestion', reasonTr: 'Öneri', reasonEn: 'Suggestion',
    conditions: [{ field: '@basePriority', operator: 'eq', value: analysis.systemPriority }] });
  const evaluated = Rules.evaluateOrder(analysis, { rules: [rule], answers: {} });
  assert.equal(evaluated.priority, 'CRITICAL');
  assert.deepEqual(evaluated.matched.map(item => item.id), ['use-suggestion']);
});

test('a deleted built-in rule never comes back and never escalates', () => {
  const analysis = CP.analyzeOrder(overdueRow, { today: TODAY, transitRules: [] });
  analysis.deliveryOutcome = 'EXPECTED_LATE';
  const deleted = Rules.DEFAULT_PRIORITY_RULES.map(rule => rule.id);
  const rules = Rules.effectiveRules([], deleted, null);
  assert.equal(rules.filter(rule => rule.kind === 'priority').length, 0);
  assert.equal(Rules.evaluateOrder(analysis, { rules, answers: {} }).priority, 'ON_TRACK');
  const kept = Rules.effectiveRules([], deleted.filter(id => id !== 'builtin_critical_late'), null);
  assert.equal(Rules.evaluateOrder(analysis, { rules: kept, answers: {} }).priority, 'CRITICAL', 'kept built-in still works');
});

test('moderator publication adds/deletes for everyone but never touches user-created rules', () => {
  const own = Rules.normalizeRule({ id: 'user-own', kind: 'priority', target: 'WATCH', name: 'Mine', conditions: [{ field: '@qty', operator: 'gt', value: 0 }] });
  const builtinCopy = { ...Rules.DEFAULT_PRIORITY_RULES[0], target: 'WATCH' };
  const managed = Rules.normalizeManagedRules({
    rules: [{ id: 'mod-1', kind: 'checklist', name: 'Hologram', conditions: [{ field: '@daysToLoad', operator: 'lte', value: 60 }] }],
    deletedRuleIds: [Rules.DEFAULT_PRIORITY_RULES[1].id, 'mod-1'],
  });
  assert.deepEqual(managed.deletedRuleIds, [Rules.DEFAULT_PRIORITY_RULES[1].id], 'a published id cannot also be deleted');
  assert.equal(managed.rules[0].managed, true);
  const rules = Rules.effectiveRules([own, builtinCopy], [], managed);
  const ids = rules.map(rule => rule.id);
  assert.ok(ids.includes('user-own'), 'user rule untouched');
  assert.ok(ids.includes('mod-1'), 'published rule reaches the user');
  assert.ok(!ids.includes(Rules.DEFAULT_PRIORITY_RULES[1].id), 'deleted for all users');
  assert.equal(rules.find(rule => rule.id === Rules.DEFAULT_PRIORITY_RULES[0].id).target, 'WATCH', 'user edit of a built-in kept');
  // Same id: moderator copy wins; user copy returns when unpublished.
  const override = Rules.normalizeManagedRules({ rules: [{ ...own, target: 'CRITICAL' }] });
  assert.equal(Rules.effectiveRules([own], [], override).find(rule => rule.id === 'user-own').target, 'CRITICAL');
  assert.equal(Rules.effectiveRules([own], [], null).find(rule => rule.id === 'user-own').target, 'WATCH');
  // A stale managed copy inside a personal store is ignored.
  assert.ok(!Rules.effectiveRules([{ ...own, id: 'stale', managed: true }], [], null).some(rule => rule.id === 'stale'));
});

test('managed rules persist in overrides and travel with the Master rule release', () => {
  const db = require('../server/db');
  const saved = db.replaceCpManagedRules({ rules: [{ id: 'mod-2', kind: 'priority', target: 'ACTION_TODAY', name: 'Late', conditions: [{ field: '@daysToLoad', operator: 'lt', value: 0 }] }], deletedRuleIds: ['builtin_action_tests'] }, 0, { id: 'moderator', displayName: 'Mod' });
  assert.equal(saved.revision, 1);
  assert.equal(saved.rules[0].managed, true);
  assert.deepEqual(saved.deletedRuleIds, ['builtin_action_tests']);
  assert.throws(() => db.replaceCpManagedRules({ rules: [] }, 0), /revision|Moderatör|değiştirildi/i);
  assert.equal(db.loadOverrides().cpManagedRules.rules[0].id, 'mod-2');
  const policy = require('../server/lib/shared-sync-policy');
  assert.ok(policy.MASTER_OVERRIDE_FIELDS.has('cpManagedRules'));
  const records = policy.masterRecordsFromState({ records: { 'store:overrides.json': { cpManagedRules: saved, notesmap: { x: 1 } } } });
  assert.ok(records['store:overrides.json'].cpManagedRules);
  assert.equal(records['store:overrides.json'].notesmap, undefined);
});

test('server: only the Moderator writes; every read path uses the same layered rule list', () => {
  const server = read('server/server.js');
  assert.match(server, /app\.put\('\/api\/cp-managed-rules', userAccess\.requireModerator/);
  assert.match(server, /publishSharedMasterChange\('cpManagedRules', req\)/);
  assert.match(server, /createCpRulePreferences\(userPreferences,userAccess,cpManagedRulesState\)/);
  // Test report steps no longer resurrect legacy shared definitions the user deleted.
  const quality = server.slice(server.indexOf('async function agentQualityReviewContext('), server.indexOf("require('./routes/test-report-routes')"));
  assert.doesNotMatch(quality, /data\.checklist\.definitions/);
  assert.match(read('server/lib/cp-rule-preferences.js'), /Rules\.effectiveRules\(payload\.rules,payload\.deletedRuleIds\|\|\[\],managedRules\(\)\)/);
  // The view uses the dedicated channel, and non-moderators see published rules read-only.
  const view = read('public/cp-overview-assistant.js');
  assert.match(view, /window\.BLCpManagedRules/);
  assert.match(view, /const readOnly = rule\.managed === true && !isModerator\(\)/);
  assert.match(view, /data-cpa-rule-publish/);
  assert.match(view, /deleteRuleForAll\(rule\.id\)/);
  assert.match(read('public/perf-runtime.js'), /'cp-managed-rules\.js\?rev=\d+','cp-overview-assistant\.js/);
});
