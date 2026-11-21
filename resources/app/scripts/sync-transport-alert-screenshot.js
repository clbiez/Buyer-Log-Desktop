'use strict';
// Gerçek Buyer Log (demo veri) içinde Sync durumu penceresindeki OneDrive
// aktarım uyarısını doğrular ve sürüm notu görselini üretir. Demo ortamında
// eş cihaz ve Windows OneDrive bulunmadığından yalnız iki API yanıtı demo
// uyarıyla değiştirilir; rozet, bildirim ve panel gerçek istemci koduyla çizilir.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { start } = require('./lib/client-performance-app');
const MIN = 60 * 1000;
(async () => {
  const app = await start({});
  try {
    const { page } = app;
    const now = Date.now();
    const transport = {
      checkedAt: new Date(now).toISOString(), lagMinutes: 30, alert: true, key: 'out:412', peerCount: 3,
      outbound: { status: 'stalled', since: new Date(now - 95 * MIN).toISOString(), seq: 412,
        peers: [{ deviceId: 'demo-device-b', updatedAt: new Date(now - 4 * MIN).toISOString() }, { deviceId: 'demo-device-c', updatedAt: new Date(now - 9 * MIN).toISOString() }] },
      inbound: { status: 'ok', since: null, peers: [], suspect: [] },
    };
    await page.route('**/api/sync-status', async route => {
      const response = await route.fetch(), body = await response.json();
      body.status = { ...body.status, online: true, sharedSyncRoot: 'C:\\Users\\demo\\OneDrive - Demo\\Buyer Log\\Senkronizasyon Verileri', lastSync: new Date(now - 2 * MIN).toISOString(), pendingUpload: 0, transport };
      await route.fulfill({ response, json: body });
    });
    await page.route('**/api/sync-transport/onedrive', route => route.fulfill({ json: { ok: true, onedrive: { supported: true, platform: 'win32', managed: true, running: true, executable: true, restartAvailableInMs: 0 } } }));
    await page.click('#syncStatusBtn');
    const panel = page.locator('[data-sync-transport]:not([hidden])');
    await panel.waitFor({ timeout: 15000 });
    await page.locator('[data-transport-restart]:not([disabled])').waitFor({ timeout: 10000 });
    assert.match(await panel.innerText(), /Değişiklikleriniz diğer cihazlara ulaşmıyor/);
    assert.equal(await page.locator('[data-transport-pin]').isEnabled(), true);
    await panel.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    const screenshot = path.join(__dirname, '../public/release-notes/next-assets/sync-onedrive-transfer-alert.png');
    fs.mkdirSync(path.dirname(screenshot), { recursive: true });
    assert.match(await page.locator('[data-sync-status]').innerText(), /OneDrive aktarımı takılmış olabilir/);
    await page.screenshot({ path: screenshot });
    assert.deepEqual(app.errors, []);
    console.log(JSON.stringify({ screenshot }));
  } finally { await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
