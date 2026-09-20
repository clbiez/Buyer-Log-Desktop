const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const appMain = fs.readFileSync(
  path.join(__dirname, '..', 'public', 'app-main.js'),
  'utf8'
);

test('Horizon Overview does not duplicate top-level workspace actions', () => {
  assert.doesNotMatch(appMain, /horizonOverviewActions/);
  assert.doesNotMatch(appMain, /horizonWorkspaceShortcut/);
  assert.doesNotMatch(appMain, /data-horizon-jump/);
});

test('v7.81 Horizon yüzeyi tek bir işe indi: kişisel ufuk', () => {
  /* Eski modalın dört sekmesi (overview / filters / connection / linked) bir
     ekranda dört ayrı sorumluluk demekti; "hangi katmanı düzenliyorum?"
     belirsizliği oradan geliyordu. Ortak olan her şey Veri Yönetimi'ne taşındı,
     geriye TEK iş kaldı ve sekmeye gerek kalmadı. */
  assert.doesNotMatch(appMain, /data-horizon-tab=/);
  assert.doesNotMatch(appMain, /horizonWorkspaceTabs/);

  /* v7.81 — Kişisel ufuk düzenleyicisi (horizon-editor.js) KALDIRILDI.
     Eskiden burada "düzenleyici kendisi çiziyor, modala devretmiyor"
     doğrulanıyordu; artık düzenleme yolunun tamamı yok. Korunan karar
     aynı yönde ve daha güçlü: modül başlığından ufka giden bir düzenleme
     kapısı OLMAMALI. */
  assert.equal(fs.existsSync(path.join(__dirname, '..', 'public', 'horizon-editor.js')), false);
  assert.doesNotMatch(appMain, /BLHorizonEditor/);
});
