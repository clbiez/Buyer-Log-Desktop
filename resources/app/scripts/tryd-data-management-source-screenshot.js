'use strict';
// Gerçek Buyer Log (anonim demo veri) Veri Yönetimi ekranında TR/YD Landed Avantaj
// widget'ının FiyatMaliyetKontrolRapor kaynağının beslediği hedef olarak
// adlandırıldığını doğrular; sürüm notu görselini üretir. Ağ çağrısı yoktur.
const path = require('node:path'), assert = require('node:assert/strict');
const { start } = require('./lib/client-performance-app');
(async () => {
  const app = await start({ initScript: t => { try { localStorage.setItem('bl.user.moderator.lcw_theme', t); } catch (_) {} }, initArg: 'light' });
  try {
    const { page } = app;
    await page.click('button[data-tab="source"]');
    await page.waitForSelector('[data-horizon-row="postfob"]', { state: 'attached', timeout: 60000 });
    if (await page.$('[data-dm-panel-toggle="refresh"][aria-expanded="false"]')) await page.click('[data-dm-panel-toggle="refresh"]');
    await page.waitForSelector('[data-horizon-row="postfob"]', { state: 'visible', timeout: 20000 });
    const row = await page.textContent('[data-horizon-row="postfob"]');
    assert.match(row, /TR\/YD Landed Avantaj|TR\/YD Landed Advantage/, 'ufuk satırı TR/YD widget\'ını adlandırır: ' + row);
    await page.mouse.move(5, 5);
    const box = await page.$eval('[data-horizon-row="intake"]', el => { const panel = el.closest('.dmPanel') || el.parentElement; el.scrollIntoView({ block: 'center' }); const a = el.getBoundingClientRect(), b = document.querySelector('[data-horizon-row="oabcube"]').getBoundingClientRect(), p = panel.getBoundingClientRect(); return { x: p.x, y: a.y - 20, w: p.width, h: b.bottom - a.y + 40 }; });
    const shot = path.join(__dirname, '../public/release-notes/next-assets/tryd-data-management-source.png');
    const width = Math.min(1400, box.w + 8);
    await page.screenshot({ path: shot, clip: { x: Math.max(0, box.x - 4), y: Math.max(0, box.y), width, height: Math.max(Math.ceil(width / 3), box.h) } });
    assert.deepEqual(app.errors, []);
    console.log(JSON.stringify({ shot, row: row.replace(/\s+/g, ' ').slice(0, 300) }));
  } finally { await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
