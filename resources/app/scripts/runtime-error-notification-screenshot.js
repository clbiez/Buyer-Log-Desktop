'use strict';
// Gerçek Buyer Log (demo veri) içinde yakalanmamış Promise hatasının kalıcı kırmızı
// kutu yerine kapanan hata bildirimi olarak göründüğünü ve Bildirim Geçmişi'ne
// yazıldığını doğrular; sürüm notu görselini üretir.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { start } = require('./lib/client-performance-app');
(async () => {
  const app = await start({});
  try {
    const { page } = app;
    await page.waitForFunction(() => typeof showToast === 'function', null, { timeout: 30000 });
    const fire = () => page.evaluate(() => { setTimeout(() => { Promise.reject(new TypeError("Cannot read properties of null (reading 'keys')")); }, 0); });
    await fire(); await fire();
    const notice = page.locator('[data-ui-feedback][data-kind="error"]', { hasText: "reading 'keys'" });
    await notice.first().waitFor({ timeout: 5000 });
    await page.waitForTimeout(400);
    assert.equal(await notice.count(), 1, 'duplicate error must not stack');
    assert.equal(await page.evaluate(() => { const b = document.getElementById('blErrBox'); return !!b && b.getClientRects().length === 0; }), true, 'red box must be hidden');
    assert.equal(await page.locator('#notificationUnreadBadge').isVisible(), true);
    const screenshot = path.join(__dirname, '../public/release-notes/next-assets/runtime-error-notification.png');
    fs.mkdirSync(path.dirname(screenshot), { recursive: true }); await page.screenshot({ path: screenshot });
    await notice.waitFor({ state: 'detached', timeout: 15000 });
    await page.click('#notificationsBtn');
    await page.locator('#notificationHistoryList', { hasText: "reading 'keys'" }).waitFor({ timeout: 5000 });
    console.log(JSON.stringify({ screenshot, autoClosed: true, inHistory: true }));
  } finally { await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
