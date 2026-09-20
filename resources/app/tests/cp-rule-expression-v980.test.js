'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Rules = require('../public/cp-rules-engine.js');

const facts = {
  row: {
    'Status': 'Approved',
    'A Date': '2026-09-10',
    'B Date': '2026-09-15',
    'Ex-Factory': '2026-09-01',
    'Ex->Retail': 14,
    'Days to Load': 5,
    'Number A': 12,
    'Number B': 7,
    'Empty Text': '',
  },
  derived: {},
  checklist: {},
};

test('v9.80 basic condition compares two fields without changing the legacy shape', () => {
  const condition = Rules.normalizeCondition({
    left: { type: 'field', field: 'Number A' },
    operator: 'gt',
    right: { type: 'field', field: 'Number B' },
  });
  assert.equal(condition.field, 'Number A');
  assert.equal(Rules.matchesCondition(condition, facts), true);
});

test('v9.80 basic condition supports TODAY and date-only comparison', () => {
  const condition = Rules.normalizeCondition({
    left: { type: 'today' },
    operator: 'gt',
    right: { type: 'field', field: 'A Date' },
  });
  assert.equal(Rules.matchesCondition(condition, facts, { today: '2026-09-11' }), true);
});

test('v9.80 basic condition supports date plus static and field day offsets', () => {
  const staticOffset = Rules.normalizeCondition({
    left: { type: 'field', field: 'Ex-Factory', offset: { value: 14, unit: 'days' } },
    operator: 'lte',
    right: { type: 'field', field: 'B Date' },
  });
  const fieldOffset = Rules.normalizeCondition({
    left: { type: 'field', field: 'Ex-Factory', offsetField: 'Ex->Retail' },
    operator: 'lt',
    right: { type: 'today' },
  });
  assert.equal(Rules.matchesCondition(staticOffset, facts), true);
  assert.equal(Rules.matchesCondition(fieldOffset, facts, { today: '2026-09-11' }), false);
});

test('v9.80 formula mode evaluates the supported boolean and date subset', () => {
  const formula = '=AND([Status]<>"In Production",[Ex-Factory]+[Ex->Retail]<TODAY())';
  const compiled = Rules.compileExpression(formula);
  assert.equal(compiled.evaluate(facts, { today: '2026-09-20' }).value, true);
  assert.deepEqual(compiled.fields.sort(), ['Ex->Retail', 'Ex-Factory', 'Status']);
});

test('v9.80 formula mode supports IF, OR, NOT, blank, IN, BETWEEN and DAYS_BETWEEN', () => {
  assert.equal(Rules.evaluateExpression('=IF(OR([Status]="Loaded",[Status]="Approved"),"XXX","")', facts).value, 'XXX');
  assert.equal(Rules.evaluateExpression('=NOT([Status]="Loaded")', facts).value, true);
  assert.equal(Rules.evaluateExpression('=ISBLANK([Empty Text])', facts).value, true);
  assert.equal(Rules.evaluateExpression('=ISNOTBLANK([Status])', facts).value, true);
  assert.equal(Rules.evaluateExpression('=IN([Status],"Approved","Closed")', facts).value, true);
  assert.equal(Rules.evaluateExpression('=BETWEEN([Days to Load],0,7)', facts).value, true);
  assert.equal(Rules.evaluateExpression('=DAYS_BETWEEN([A Date],TODAY())>0', facts, { today: '2026-09-11' }).value, true);
});

test('v9.80 invalid formulas return actionable validation errors and unknown fields are rejected', () => {
  const known = { fields: ['Status', 'A Date', 'B Date'] };
  assert.equal(Rules.validateExpression('=[Unknown Field]>0', known).valid, false);
  assert.match(Rules.validateExpression('=[Unknown Field]>0', known).errors.join(' '), /Unknown field/i);
  assert.equal(Rules.validateExpression('=AND([Status]').valid, false);
  assert.match(Rules.validateExpression('=AND([Status]').errors.join(' '), /bracket|parenthes|beklenmeyen/i);
  assert.equal(Rules.validateExpression('=EXEC([Status])').valid, false);
});

test('v9.80 empty operands never crash or match numeric/date rules', () => {
  const emptyFacts = { row: { 'A Date': '', 'Number A': '' }, derived: {}, checklist: {} };
  assert.equal(Rules.evaluateExpression('=TODAY()>[A Date]', emptyFacts, { today: '2026-09-11' }).value, false);
  assert.equal(Rules.evaluateExpression('=[Number A]>0', emptyFacts).value, false);
});

test('v9.80 formula rules are normalized once and evaluated by the shared priority/checklist engine', () => {
  const rule = Rules.normalizeRule({
    id: 'formula-rule', kind: 'priority', mode: 'formula', target: 'CRITICAL',
    formula: '=AND([Status]="Approved",[Number A]>[Number B])',
    name: 'Formula rule', reasonTr: 'reason', reasonEn: 'reason',
  });
  assert.equal(rule.mode, 'formula');
  assert.equal(Rules.matchesRule(rule, facts), true);
  assert.equal(Rules.customChecklistItems({ sourceRow: facts.row }, [
    Rules.normalizeRule({ id: 'check-formula', kind: 'checklist', mode: 'formula', formula: '=TRUE', name: 'Check' }),
  ], {}).length, 1);
});

test('v9.80 formula source is parsed safely and never compiled as JavaScript', () => {
  const source = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'public', 'cp-rules-engine.js'), 'utf8');
  assert.doesNotMatch(source, /\beval\(|new Function\(/);
  assert.equal(Rules.validateExpression('=process.exit()').valid, false);
});
