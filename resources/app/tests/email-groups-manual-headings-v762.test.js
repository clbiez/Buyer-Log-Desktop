const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const UI = fs.readFileSync(path.join(ROOT, 'public', 'email-groups.js'), 'utf8');
const INDEX = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');

test('Manufacturer Email Groups manuel ülke ve grup yönetimi sunar', () => {
  assert.match(UI, /data-eg-headings="country"/);
  assert.match(UI, /data-eg-headings="type"/);
  assert.match(UI, /function addHeading\(\)/);
  assert.match(UI, /data-eg-heading-input/);
  assert.match(UI, /data-eg-heading-remove/);
  assert.match(UI, /data-eg-heading-apply/);
  assert.match(UI, /api\(`\/api\/email-groups\/headings\/\$\{state\.kind\}`/);
  assert.doesNotMatch(UI, /\bprompt\(/, 'başlık yönetimi tarayıcı promptuna bağlı olmamalı');
});

test('Kaynak Veri gereksiz kısa yolları kaldırılmıştır', () => {
  for (const id of ['sourceHint', 'serverStatus', 'backupRestoreBtn', 'asasQuickUpload', 'fileAsasSourceUpload']) {
    assert.doesNotMatch(INDEX, new RegExp(`id="${id}"`), `${id} arayüzde kalmamalı`);
  }
  /* v7.81: Yedekleme, Veri Yönetimi → Araçlar → Depolama ve bakım altında.
     Korunan güvence aynı: yetenek bir yerden erişilebilir olmalı. */
  const DM_UI = fs.readFileSync(path.join(ROOT, 'public', 'data-management.js'), 'utf8');
  assert.match(DM_UI, /id: 'backup'/, 'Yedekleme erişilebilir kalmalı');
  assert.match(DM_UI, /buyerLogBackupModal/);
});
