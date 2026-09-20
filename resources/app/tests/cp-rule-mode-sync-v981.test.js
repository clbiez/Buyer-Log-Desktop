'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const Rules = require('../public/cp-rules-engine.js');
const VIEW = fs.readFileSync(path.join(ROOT, 'public', 'cp-overview-assistant.js'), 'utf8');

test('Basic koşullar Formula görünümüne kayıpsız çevrilebilir', () => {
  const formula = Rules.conditionsToFormula([
    { field: 'Status', operator: 'ne', value: 'In Production' },
    { field: '@daysToLoad', operator: 'lte', value: 14 },
  ], 'all');

  assert.equal(formula, '=AND([Status]<>"In Production",[@daysToLoad]<=14)');
  const synced = Rules.formulaToConditions(formula);
  assert.equal(synced.match, 'all');
  assert.deepEqual(synced.conditions.map(({ field, operator, value }) => ({ field, operator, value })), [
    { field: 'Status', operator: 'ne', value: 'In Production' },
    { field: '@daysToLoad', operator: 'lte', value: 14 },
  ]);
});

test('Formula temel moda çevrilebilen koşulları ve OR eşleşmesini geri üretir', () => {
  const synced = Rules.formulaToConditions('=OR(IN([Country],"TR","BD"),ISBLANK([Status]))');
  assert.equal(synced.match, 'any');
  assert.deepEqual(synced.conditions.map(({ field, operator, value }) => ({ field, operator, value })), [
    { field: 'Country', operator: 'in', value: ['TR', 'BD'] },
    { field: 'Status', operator: 'empty', value: '' },
  ]);
});

test('Boş temel kural Formula modunda FALSE olarak korunur ve desteklenmeyen ifade sessizce bozulmaz', () => {
  assert.deepEqual(Rules.formulaToConditions('=FALSE'), { match: 'all', conditions: [] });
  assert.equal(Rules.formulaToConditions('=AND([Status]=\"Approved\",IF([Age]>18,TRUE,FALSE))'), null);
});

test('Kural editörü iki mod değişiminde ortak senkronizasyon yardımcılarını çağırır', () => {
  assert.match(VIEW, /Rules\.conditionsToFormula\(/);
  assert.match(VIEW, /Rules\.formulaToConditions\(/);
  assert.match(VIEW, /rule\.formula = Rules\.conditionsToFormula\(rule\.conditions, rule\.match\)/);
  assert.match(VIEW, /rule\.conditions = synced\.conditions/);
});
