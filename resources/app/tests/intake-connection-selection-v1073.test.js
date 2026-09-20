'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const intakeConnection = require('../server/lib/intake-connection');

test('manual Overview refresh accepts a configured INTAKE connection even when scheduled refresh is disabled', () => {
  const selected = intakeConnection.selectIntakeConnection([
    { id: 'intake', role: 'intake', server: 'sql-01', catalog: 'Intake', refreshEnabled: false },
  ]);

  assert.equal(selected.id, 'intake');
  assert.equal(selected.refreshEnabled, false);
});

test('an enabled configured INTAKE connection remains preferred when duplicate historical records exist', () => {
  const selected = intakeConnection.selectIntakeConnection([
    { id: 'old', role: 'intake', server: 'sql-old', catalog: 'IntakeOld', refreshEnabled: false },
    { id: 'active', role: 'intake', server: 'sql-new', catalog: 'IntakeNew', refreshEnabled: true },
  ]);

  assert.equal(selected.id, 'active');
});
