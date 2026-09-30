'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const registry = require('../server/lib/ai-capability-registry');
const language = require('../server/lib/automation-language');
const guide = require('../server/lib/ai-guide-generator');
const compiler = require('../server/lib/ai-automation-compiler');
const recipeStore = require('../server/lib/automation-recipe-store');
const compatibility = require('../server/lib/ai-automation-compatibility');

test('AI capability registry exposes versioned, runtime-backed capabilities', () => {
  const current = registry.getCapabilityModel();
  assert.equal(current.automationLanguageVersion, '1.0');
  assert.equal(current.appVersion, require('../server/lib/app-version').APP_VERSION);
  assert.ok(current.capabilityHash);
  assert.ok(current.datasets.some(item => item.id === 'orders'));
  assert.ok(current.fields.some(item => item.id === 'orderStatus'));
  assert.ok(current.actions.some(item => item.id === 'SEND_EMAIL'));
  assert.equal(current.actions.some(item => item.id === 'EXECUTE_JAVASCRIPT'), false);
});

test('guide generation is deterministic and follows the registry metadata', () => {
  const first = guide.generateGuide(registry.getCapabilityModel(), { generatedAt: '2026-01-01T00:00:00.000Z' });
  const second = guide.generateGuide(registry.getCapabilityModel(), { generatedAt: '2026-01-01T00:00:00.000Z' });
  assert.equal(first, second);
  assert.match(first, /Capability Hash:/);
  assert.match(first, /SEND_EMAIL/);
  assert.match(first, /Do not output PowerShell/);
});

test('automation language parses the supported declarative example without execution', () => {
  const source = [
    'BUYERLOG_AUTOMATION 1.0',
    'NAME "Production Risk"',
    'TRIGGER',
    '  DAILY AT 09:00',
    'END',
    'SOURCE "orders"',
    'WHEN',
    '  [Status] != "In Production"',
    '  AND DAYS_UNTIL([Ex-Factory]) BETWEEN 0 AND 7',
    'END',
    'ACTIONS',
    '  SEND_EMAIL',
    '    RECIPIENT_GROUP ASK_USER',
    '    SUBJECT "Production risk"',
    '    INCLUDE_MATCHING_ROWS TRUE',
    '    ATTACHMENT EXCEL',
    '  END',
    'END',
  ].join('\n');
  const parsed = language.parse(source);
  assert.equal(parsed.name, 'Production Risk');
  assert.equal(parsed.trigger.type, 'DAILY');
  assert.equal(parsed.actions[0].type, 'SEND_EMAIL');
  assert.deepEqual(parsed.requiredInputs, ['EMAIL_GROUP']);
});

test('automation language rejects arbitrary code and unknown syntax', () => {
  assert.throws(() => language.parse('BUYERLOG_AUTOMATION 1.0\nNAME "x"\nEXECUTE javascript:alert(1)'), /unsupported|forbidden|geçersiz/i);
  assert.throws(() => language.parse('BUYERLOG_AUTOMATION 2.0\nNAME "x"'), /version|sürüm/i);
  assert.throws(() => language.parse('BUYERLOG_AUTOMATION 1.0\nNAME "x"\nWHEN\n  [Unknown Field] = "x"\nEND'), /required|TRIGGER|SOURCE|ACTIONS|eksik/i);
});

test('validator resolves stable fields, reports unknown fields and requires email choices', () => {
  const parsed = language.parse([
    'BUYERLOG_AUTOMATION 1.0',
    'NAME "Mail"',
    'TRIGGER',
    '  MANUAL',
    'END',
    'SOURCE "orders"',
    'WHEN',
    '  [Status] = "Approved"',
    'END',
    'ACTIONS',
    '  SEND_EMAIL',
    '    RECIPIENT_GROUP ASK_USER',
    '  END',
    'END',
  ].join('\n'));
  const valid = language.validate(parsed, registry.getCapabilityModel());
  assert.equal(valid.ok, true);
  assert.deepEqual(valid.requiredInputs, ['EMAIL_GROUP']);

  const bad = { ...parsed, conditions: [{ field: 'Not A Field', operator: 'eq', value: 'x' }] };
  const invalid = language.validate(bad, registry.getCapabilityModel());
  assert.equal(invalid.ok, false);
  assert.match(invalid.errors.join(' '), /Unknown field|Bilinmeyen alan/i);
});

test('field resolution is datasource-scoped and does not leak CP fields into INTAKE', () => {
  assert.ok(registry.resolveField('Merch Yil Ay', 'intake'));
  assert.equal(registry.resolveField('Buyer', 'intake'), null);
});

test('condition evaluator is deterministic and never executes source text', () => {
  const parsed = language.parse([
    'BUYERLOG_AUTOMATION 1.0',
    'NAME "Risk"',
    'TRIGGER',
    '  MANUAL',
    'END',
    'SOURCE "orders"',
    'WHEN',
    '  [Status] != "In Production"',
    '  AND DAYS_UNTIL([Ex-Factory]) BETWEEN 0 AND 7',
    'END',
    'ACTIONS',
    '  SHOW_REPORT',
    '    TITLE "Risk"',
    '  END',
    'END',
  ].join('\n'));
  assert.equal(language.evaluateConditions(parsed.conditions, { Status: 'Approved', 'Ex-factory': '2026-09-15' }, 'orders', { now: '2026-09-11T12:00:00' }), true);
  assert.equal(language.evaluateConditions(parsed.conditions, { Status: 'In Production', 'Ex-factory': '2026-09-15' }, 'orders', { now: '2026-09-11T12:00:00' }), false);
  assert.equal(language.evaluateConditions([{ field: 'Status', operator: 'contains', value: 'urgent' }], { Status: 'Approved' }, 'orders'), false);
  assert.equal(language.evaluateConditions([{ field: 'Status', operator: 'in', value: ['Approved', 'Pending'] }], { Status: 'Approved' }, 'orders'), true);
});

test('action parameters are closed-world and unsupported values are rejected', () => {
  assert.throws(() => language.parse([
    'BUYERLOG_AUTOMATION 1.0', 'NAME "x"', 'TRIGGER', '  MANUAL', 'END', 'SOURCE "orders"',
    'WHEN', 'END', 'ACTIONS', '  SHOW_REPORT', '    EXECUTE_CODE "alert(1)"', '  END', 'END',
  ].join('\n')), /paramet|desteklenmeyen|forbidden|geçersiz/i);
  const intakeRefresh = [
    'BUYERLOG_AUTOMATION 1.0', 'NAME "Refresh"', 'TRIGGER', '  MANUAL', 'END', 'SOURCE "intake"',
    'WHEN', 'END', 'ACTIONS', '  REFRESH_SOURCE', '    SOURCE INTAKE', '  END', 'END',
  ].join('\n');
  const parsed = language.parse(intakeRefresh);
  assert.equal(language.validate(parsed).ok, false);
});

test('compiler produces a disabled, reviewable existing automation recipe', () => {
  const source = [
    'BUYERLOG_AUTOMATION 1.0', 'NAME "Mail"', 'TRIGGER', '  DAILY AT 09:00', 'END',
    'SOURCE "orders"', 'WHEN', '  [Status] = "Approved"', 'END', 'ACTIONS',
    '  SEND_EMAIL', '    RECIPIENT_GROUP ASK_USER', '    SUBJECT "Daily"', '  END', 'END',
  ].join('\n');
  const parsed = language.parse(source);
  const validation = language.validate(parsed, registry.getCapabilityModel());
  const recipe = compiler.compile(parsed, validation, { sourceCode: source, emailGroupId: 'group_1' });
  assert.equal(recipe.enabled, false);
  assert.equal(recipe.source, 'orders');
  assert.equal(recipe.purpose, 'email');
  assert.equal(recipe.email.groupId, 'group_1');
  assert.equal(recipe.schedule.mode, 'daily');
  assert.equal(recipe.ai.origin, 'ai_import');
  assert.equal(recipe.ai.definition.conditions[0].field, 'Status');
});

test('recipe persistence keeps bounded AI provenance without accepting secrets', () => {
  const normalized = recipeStore.normalizeRecipe({
    name: 'AI draft', source: 'orders', enabled: false,
    ai: {
      origin: 'ai_import', status: 'draft', appVersion: '7.0.80', capabilitySchemaVersion: 1,
      capabilityHash: '0123456789abcdef', languageVersion: '1.0', sourceCode: 'BUYERLOG_AUTOMATION 1.0',
      password: 'must-not-persist', definition: { source: 'orders', conditions: [], actions: [] },
    },
  });
  assert.equal(normalized.ai.origin, 'ai_import');
  assert.equal(normalized.ai.capabilityHash, '0123456789abcdef');
  assert.equal(Object.prototype.hasOwnProperty.call(normalized.ai, 'password'), false);
  assert.deepEqual(normalized.ai.definition.conditions, []);
});

test('compatibility check distinguishes capability hash drift from removed capabilities', () => {
  const model = registry.getCapabilityModel();
  const recipe = recipeStore.normalizeRecipe({ source: 'orders', ai: {
    origin: 'ai_import', status: 'draft', appVersion: model.appVersion, capabilitySchemaVersion: model.capabilitySchemaVersion,
    capabilityHash: 'old-hash', languageVersion: model.automationLanguageVersion,
    definition: { source: 'orders', conditions: [{ field: 'Status', operator: 'eq', value: 'Approved' }], actions: [{ type: 'SEND_EMAIL' }] },
  }});
  const drift = compatibility.check(recipe, model);
  assert.equal(drift.compatible, true);
  assert.equal(drift.status, 'capability_drift');
  const broken = { ...recipe, ai: { ...recipe.ai, definition: { ...recipe.ai.definition, actions: [{ type: 'EXECUTE_JAVASCRIPT' }] } } };
  const invalid = compatibility.check(broken, model);
  assert.equal(invalid.compatible, false);
  assert.equal(invalid.status, 'needs_review');
});

test('AI modules contain no arbitrary-code execution primitive', () => {
  const root = path.join(__dirname, '..', 'server', 'lib');
  for (const file of ['ai-capability-registry.js', 'automation-language.js', 'ai-guide-generator.js']) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    const executableCode = source.replace(/const FORBIDDEN = [\s\S]*?;\r?\n/, '');
    assert.doesNotMatch(executableCode, /(?<!\.)\beval\s*\(|(?<!\.)\bnew\s+Function\s*\(|(?<!\.)\bspawn\s*\(|(?<!\.)\bexec\s*\(/);
  }
});

test('Automations UI exposes the AI guide, analysis, preview and disabled-draft flow', () => {
  const ui = fs.readFileSync(path.join(__dirname, '..', 'public', 'ai-automation-import.js'), 'utf8');
  const runtime = fs.readFileSync(path.join(__dirname, '..', 'public', 'perf-runtime.js'), 'utf8');
  const app = fs.readFileSync(path.join(__dirname, '..', 'public', 'app-main.js'), 'utf8');
  for (const endpoint of ['/api/automations/ai/guide', '/api/automations/ai/analyze', '/api/automations/ai/preview', '/api/automations/ai/import']) assert.match(ui + runtime, new RegExp(endpoint.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  // v7.175 — saf asistan modülü iki görünüm dosyasından ÖNCE yüklenir.
  assert.match(runtime, /automations:\['automation-assistant\.js','automations\.js','ai-automation-import\.js'\]/);
  assert.match(app, /initAiAutomationImport/);
  assert.match(ui, /Create disabled draft|Kapalı taslak oluştur/);
});

test('server routes AI code through validation, preview and existing recipe persistence', () => {
  const server = fs.readFileSync(path.join(__dirname, '..', 'server', 'server.js'), 'utf8');
  for (const endpoint of ['/api/automations/ai/capabilities', '/api/automations/ai/guide', '/api/automations/ai/analyze', '/api/automations/ai/preview', '/api/automations/ai/import']) assert.match(server, new RegExp(endpoint.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(server, /automationLanguage\.evaluateConditions\(aiDefinition\.conditions/);
  assert.match(server, /enabled:false/);
  assert.match(server, /AI_AUTOMATION_NEEDS_REVIEW/);
});
