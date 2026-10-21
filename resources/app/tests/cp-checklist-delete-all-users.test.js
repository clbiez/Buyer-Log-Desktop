'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Rules = require('../public/cp-rules-engine');
const source = fs.readFileSync(path.join(__dirname, '../public/cp-overview-assistant.js'), 'utf8');
const check = id => Rules.normalizeRule({ id, kind: 'checklist', name: id, conditions: [{ field: '@qty', operator: 'gt', value: 0 }] });
const copy = value => JSON.parse(JSON.stringify(value));

// Execute the shipped manager's bindings and persistence functions without its DOM editor.
function manager({ managed = false, moderator = true, accepted = true, save } = {}) {
  const target = check('shared-check'), own = check('own-check');
  const state = { managed: Rules.normalizeManagedRules({ revision: 4, rules: managed ? [target] : [] }),
    rules: [], deletedRuleIds: [], shadowedPersonal: [] };
  const personal = [target, own];
  state.rules = Rules.effectiveRules(personal, [], state.managed);
  let button;
  const requests = [], prompts = [], toasts = [], timers = [];
  const ctx = { Rules, state, lastRows: null, JSON, Set, CHECKLIST_RULE_STORE_VERSION: 2,
    L: (_tr, en) => en, esc: value => value, ruleName: rule => rule.name,
    isModerator: () => moderator, notifyDecisionContextChanged: () => {},
    managedChannel: () => ({ load: async () => null, save: async (next, revision) => {
      requests.push({ next: copy(next), revision });
      if (save) await save();
      return { ...next, revision: revision + 1 };
    } }),
    confirm: message => { prompts.push(message); return accepted; },
    showToast: message => toasts.push(message),
    priorityLabel: value => value,
    setTimeout: fn => { timers.push(fn); return timers.length; }, clearTimeout: () => {},
    findRule: id => state.rules.find(rule => rule.id === id), ruleIdOf: () => target.id,
    modal: { querySelectorAll: () => [button = { disabled: false }] },
  };
  vm.createContext(ctx);
  vm.runInContext(source.slice(source.indexOf('  function personalRuleList()'), source.indexOf('  const isModerator =')), ctx);
  vm.runInContext(source.slice(source.indexOf('  function ruleStorePayload('), source.indexOf('  function saveRules()')), ctx);
  ctx.applyRuleLayers(personal);
  vm.runInContext(source.slice(source.indexOf('  let managedRulesRedraw = null;'), source.indexOf('  /* Moderatörün yayımlanmış')), ctx);
  vm.runInContext(source.slice(source.indexOf('  let managedSyncTimer = 0;'), source.indexOf("  window.addEventListener('bl:cp-managed-rules-changed'")), ctx);
  vm.runInContext(source.slice(source.indexOf('    function confirmDelete('), source.indexOf('    function bindRules(')), ctx);
  const start = source.indexOf("      modal.querySelectorAll('[data-cpa-rule-delete-all]')");
  assert.ok(start >= 0, 'the manager binds an explicit delete-for-all action');
  vm.runInContext(source.slice(start, source.indexOf("      modal.querySelectorAll('[data-cpa-rule-delete]')", start)), ctx);
  return { ctx, state, target, own, button, requests, prompts, toasts, timers };
}

test('moderators have a visible delete-for-all button beside publication', () => {
  const start = source.indexOf('    const moderatorActions = moderator');
  const end = source.indexOf('    return `<div class="cpaRule', start);
  for (const managed of [false, true]) {
    const ctx = vm.createContext({ moderator: true, rule: { managed }, esc: v => v, L: (_tr, en) => en });
    const html = vm.runInContext(source.slice(start, end) + '\nmoderatorActions;', ctx);
    assert.match(html, /data-cpa-rule-delete-all/);
    assert.match(html, /Delete for all users/);
    assert.match(html, managed ? /data-cpa-rule-unpublish/ : /data-cpa-rule-publish/);
  }
  const ctx = vm.createContext({ moderator: false });
  assert.equal(vm.runInContext(source.slice(start, end) + '\nmoderatorActions;', ctx), '');
});

for (const managed of [false, true]) test(`global deletion persists before hiding a ${managed ? 'published' : 'personal/shared'} checklist`, async () => {
  let finish;
  const m = manager({ managed, save: () => new Promise(resolve => { finish = resolve; }) });
  const pending = m.button.onclick();
  assert.ok(m.state.rules.some(rule => rule.id === m.target.id), 'still visible while saving');
  assert.equal(m.button.disabled, true);
  finish(); await pending;
  assert.equal(m.requests[0].revision, 4);
  assert.deepEqual(m.requests[0].next.deletedRuleIds, [m.target.id]);
  assert.ok(!m.state.rules.some(rule => rule.id === m.target.id));
  for (const user of [[m.target, m.own], [m.target, check('another-users-own')]]) {
    const restarted = Rules.effectiveRules(user, [], copy(m.state.managed));
    assert.ok(!restarted.some(rule => rule.id === m.target.id));
    assert.ok(restarted.some(rule => rule.id === user[1].id), 'unrelated personal checklist survives');
  }
  assert.match(m.prompts[0], /shared-check.*all users/);
});

for (const status of [403, 409, 500]) test(`failed global save (${status}) leaves local and shared checklists intact`, async () => {
  const m = manager({ save: async () => { throw Object.assign(new Error('Save failed'), { status }); } });
  const before = copy(m.state);
  await m.button.onclick();
  assert.deepEqual(copy(m.state), before);
  assert.equal(m.button.disabled, false);
  assert.deepEqual(m.toasts, ['Save failed']);
});

test('cancel and non-moderator actions never save', async () => {
  for (const options of [{ accepted: false }, { moderator: false }]) {
    const m = manager(options);
    await m.button.onclick();
    assert.equal(m.requests.length, 0);
    assert.ok(m.state.rules.some(rule => rule.id === m.target.id));
  }
});

test('pending edit autosave cannot republish a checklist deleted for everyone', async () => {
  const m = manager({ managed: true });
  m.state.rules.find(rule => rule.id === m.target.id).name = 'Edited';
  vm.runInContext('scheduleManagedSync()', m.ctx);
  assert.equal(m.timers.length, 1);
  await m.button.onclick();
  m.timers[0]();
  await Promise.resolve();
  assert.deepEqual(m.requests.at(-1).next.rules, []);
  assert.deepEqual(m.requests.at(-1).next.deletedRuleIds, [m.target.id]);
});

test('global deletion retains dependency warnings and undo restores original checklist copies', async () => {
  const m = manager();
  m.state.rules.push(Rules.normalizeRule({ id: 'dependent', kind: 'priority', name: 'Dependent rule',
    conditions: [{ field: '@checklist:shared-check', operator: 'eq', value: 'open' }] }));
  await m.button.onclick();
  assert.match(m.prompts[0], /Dependent rule/);
  assert.match(m.prompts[0], /those conditions will never match/);
  const persisted = copy(vm.runInContext('ruleStorePayload("checklist")', m.ctx));
  assert.ok(persisted.rules.some(rule => rule.id === m.target.id), 'hidden original survives a preference save');
  m.ctx.applyRuleLayers(persisted.rules);
  assert.ok(!m.state.rules.some(rule => rule.id === m.target.id), 'deletion still applies after preference reload');
  await vm.runInContext('restoreRuleForAll("shared-check")', m.ctx);
  assert.ok(m.state.rules.some(rule => rule.id === m.target.id), 'custom original returns in the same session');
  const builtin = Rules.DEFAULT_CHECKLIST_RULES[0];
  await vm.runInContext(`deleteRuleForAll(${JSON.stringify(builtin.id)})`, m.ctx);
  assert.ok(!m.state.rules.some(rule => rule.id === builtin.id));
  await vm.runInContext(`restoreRuleForAll(${JSON.stringify(builtin.id)})`, m.ctx);
  assert.ok(m.state.rules.some(rule => rule.id === builtin.id));
});

test('local trash action never writes a global deletion', () => {
  const m = manager();
  Object.assign(m.ctx, { newPriorityRuleIds: new Set(), expandedRuleId: null, commit: () => {}, draw: () => {} });
  const start = source.indexOf("      modal.querySelectorAll('[data-cpa-rule-delete]')");
  const button = {};
  m.ctx.modal.querySelectorAll = () => [button];
  vm.runInContext(source.slice(start, source.indexOf("      modal.querySelectorAll('[data-cpa-cond-add]')", start)), m.ctx);
  button.onclick();
  assert.equal(m.requests.length, 0);
  assert.ok(!m.state.rules.some(rule => rule.id === m.target.id));
  assert.match(m.prompts[0], /only for you/);
});
