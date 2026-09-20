'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { OperationController, STATES } = require('../server/lib/operation-controller');

test('browser approval pauses the operation watchdog and resumes the remaining budget', async () => {
  let timedOut = false;
  const controller = new OperationController({
    operationTimeoutMs: 40,
    userApprovalTimeoutMs: 100,
    onTimeout: () => { timedOut = true; },
  }).start();

  await new Promise(resolve => setTimeout(resolve, 20));
  controller.enterWaitingForUser({ message: 'Allow remote debugging' });
  await new Promise(resolve => setTimeout(resolve, 55));
  assert.equal(controller.state, STATES.WAITING_FOR_USER);
  assert.equal(timedOut, false);

  controller.resumeAfterUserApproval();
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(timedOut, true);
  assert.equal(controller.state, STATES.FAILED);
  assert.equal(controller.error.timeoutType, 'operationTimeout');
  controller.dispose();
});

test('approval rejection is user_cancelled and never classified as a timeout', () => {
  const controller = new OperationController({ userApprovalTimeoutMs: 600000 }).start();
  controller.enterWaitingForUser({ message: 'Approve external browser access' });
  controller.cancel('user_cancelled');
  assert.equal(controller.state, STATES.CANCELLED);
  assert.equal(controller.error.code, 'USER_CANCELLED');
  assert.equal(controller.error.timeoutType, undefined);
  controller.dispose();
});

test('timeout budgets expose separate approval, navigation, network and operation values', () => {
  const controller = new OperationController().start();
  assert.equal(controller.timeoutFor('userApprovalTimeout'), 600000);
  assert.equal(controller.timeoutFor('navigationTimeout'), 45000);
  assert.equal(controller.timeoutFor('networkTimeout'), 20000);
  assert.equal(controller.timeoutFor('operationTimeout'), 120000);
  controller.dispose();
});

