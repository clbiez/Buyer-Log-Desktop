'use strict';
// Gerçek Buyer Log (demo veri) içinde "güncelleme var" uyarısını doğrular ve sürüm
// notu görselini üretir. Masaüstü köprüsü yalnız güncelleme durumu için taklit edilir.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { start } = require('./lib/client-performance-app');
const current = require('../package.json').version, parts = current.split('.').map(Number);
const next = [parts[0], parts[1], parts[2] + 1].join('.'), nextEn = [parts[0], parts[1], parts[2] + 2].join('.');
(async () => {
  const app = await start({ initScript: ([current, next]) => {
    window.__updateCalls = { restart: 0, status: 0 };
    let listener = null;
    const ready = { enabled: true, state: 'READY_TO_INSTALL', currentVersion: current, pendingVersion: next, pendingReady: true, channel: 'stable' };
    window.buyerLogDesktop = { updates: {
      status: async () => { window.__updateCalls.status++; return ready; },
      onStatus: callback => { listener = callback; return () => { listener = null; }; },
      restart: async () => { window.__updateCalls.restart++; return { ok: true }; },
    } };
    window.__emitUpdate = status => listener && listener(status);
  }, initArg: [current, next] });
  try {
    const { page } = app;
    const notice = page.locator('[data-ui-feedback]', { hasText: next });
    await notice.waitFor({ timeout: 30000 });
    assert.equal(await notice.count(), 1);
    // Aynı sürümün tekrar yayını ikinci uyarı üretmez; uyarı kendiliğinden kapanmaz.
    await page.evaluate(v => window.__emitUpdate({ pendingReady: true, pendingVersion: v }), next);
    await page.waitForTimeout(6000);
    assert.equal(await notice.count(), 1);
    const text = await notice.textContent();
    for (const expected of ['Güncelleme var', `Buyer Log ${next} güncellemesi var`, 'Şimdi Yeniden Başlat', 'Sonra']) assert.ok(text.includes(expected), expected);
    const screenshot = path.join(__dirname, '../public/release-notes/next-assets/update-available-notice.png');
    fs.mkdirSync(path.dirname(screenshot), { recursive: true }); await page.screenshot({ path: screenshot });
    await notice.locator('[data-ui-feedback-action="restart"]').click();
    await page.waitForFunction(() => window.__updateCalls.restart === 1);
    await notice.locator('[data-ui-feedback-action="later"]').click();
    await notice.waitFor({ state: 'detached', timeout: 5000 });
    // EN metni
    await page.evaluate(v => { applyLanguage('en'); window.__emitUpdate({ pendingReady: true, pendingVersion: v }); }, nextEn);
    const en = page.locator('[data-ui-feedback]', { hasText: nextEn });
    await en.waitFor({ timeout: 5000 });
    const enText = await en.textContent();
    for (const expected of ['Update available', `Buyer Log ${nextEn} is available`, 'Restart Now', 'Later']) assert.ok(enText.includes(expected), expected);
    assert.deepEqual(app.errors, []);
    console.log(JSON.stringify({ screenshot, statusCalls: await page.evaluate(() => window.__updateCalls.status), restartCalls: 1, en: true }));
  } finally { await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
