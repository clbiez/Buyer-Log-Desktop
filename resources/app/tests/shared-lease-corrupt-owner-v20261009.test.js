'use strict';

/* 7.0.266 — Saha logu: business/current.json (OneDrive paylaşılan klasör) ve
 * collection-permissions.json kilitleri 41-47 saat "currentOwner=unknown"
 * çakışmasında kaldı; iş verisi checkpoint'i 1188 kez reddedildi ve kullanıcının
 * güncellemeleri yeniden açılışta kayboldu. Kilit klasöründe owner.json boş ya
 * da bozukken bayat kilit hiç temizlenmiyordu. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { withFileLeaseAsync } = require('../server/lib/shared-file-transaction');

function tempTarget(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bl-lease-corrupt-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return path.join(root, 'current.json');
}
function ageLock(lockDir, ms) {
  const past = new Date(Date.now() - ms);
  for (const entry of fs.readdirSync(lockDir)) fs.utimesSync(path.join(lockDir, entry), past, past);
  fs.utimesSync(lockDir, past, past);
}

for (const [label, content] of [['empty', ''], ['truncated', '{"token":"abc","instanceId":'], ['binary', '\u0000\u0000\u0000']]) {
  test(`a stale lock with a ${label} owner.json is recovered instead of blocking writes forever`, async t => {
    const target = tempTarget(t);
    const lockDir = `${target}.write-lock`;
    fs.mkdirSync(lockDir);
    fs.writeFileSync(path.join(lockDir, 'owner.json'), content);
    ageLock(lockDir, 2 * 60 * 60 * 1000);
    let ran = false;
    await withFileLeaseAsync(target, async () => { ran = true; }, { timeoutMs: 500, logger: () => {} });
    assert.equal(ran, true);
    assert.equal(fs.existsSync(lockDir), false, 'lock released after the operation');
  });
}

test('a fresh lock with an unreadable owner.json is still respected until the grace period passes', async t => {
  const target = tempTarget(t);
  const lockDir = `${target}.write-lock`;
  fs.mkdirSync(lockDir);
  fs.writeFileSync(path.join(lockDir, 'owner.json'), '');
  // Writer just created the directory and is about to write owner.json.
  await assert.rejects(
    () => withFileLeaseAsync(target, async () => {}, { timeoutMs: 150, ownerGraceMs: 60000, logger: () => {} }),
    error => error && error.code === 'SHARED_WRITE_BUSY',
  );
});
