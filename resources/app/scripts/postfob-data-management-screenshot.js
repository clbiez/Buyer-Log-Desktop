'use strict';
// Gerçek Buyer Log (anonim demo veri) Veri Yönetimi ekranında FOB Sonrası Maliyet
// kaynağının INTAKE gibi ayrı veritabanı olarak listelendiğini ve kendi ufuk
// satırının olduğunu doğrular; sürüm notu görselini üretir. Ağ çağrısı yoktur.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { start } = require('./lib/client-performance-app');
(async () => {
  const theme = process.argv.includes('--dark') ? 'dark' : 'light';
  const app = await start({ initScript: t => { try { localStorage.setItem('bl.user.moderator.lcw_theme', t); } catch (_) {} }, initArg: theme });
  try {
    const { page } = app;
    const lab = await app.api('/api/data-management/integration-lab').then(response => response.json());
    const text = JSON.stringify(lab);
    assert.match(text, /FiyatMaliyetKontrolRapor/, 'entegrasyon envanteri postfob kaynağını içerir');
    const inventory = (lab.inventory || []).map(item => `${item.kind}:${item.name}:${item.profileId || ''}`);
    assert.ok(inventory.some(entry => /^database:FOB Sonrası Maliyet/.test(entry)), 'Corporate Integration Lab listesinde database olarak: ' + inventory.join(' | '));
    await page.click('button[data-tab="source"]');
    await page.waitForSelector('[data-horizon-row="postfob"]', { state: 'attached', timeout: 60000 });
    // Horizon paneli varsayılan olarak daraltılmış olabilir; kullanıcı gibi açılır.
    if (await page.$('[data-dm-panel-toggle="refresh"][aria-expanded="false"]')) await page.click('[data-dm-panel-toggle="refresh"]');
    await page.waitForSelector('[data-horizon-row="postfob"]', { state: 'visible', timeout: 20000 });
    const row = await page.textContent('[data-horizon-row="postfob"]');
    assert.match(row, /FOB Sonrası Maliyet/);
    assert.match(row, /FOB Sonrası Maliyet|F5_S41|FiyatMaliyetKontrolRapor/);
    const editable = await page.$('[data-horizon-row="postfob"] [data-open-horizon="postfob"]');
    assert.ok(editable, 'ufuk filtresi düzenlenebilir');
    await page.click('[data-horizon-row="postfob"] [data-open-horizon="postfob"]');
    await page.waitForFunction(() => { const drawer = document.getElementById('dmHorizonDrawer'); return drawer && !drawer.hidden; }, null, { timeout: 20000 });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    await page.mouse.move(5, 5);
    const box = await page.$eval('[data-horizon-row="intake"]', el => { const panel = el.closest('.dmPanel') || el.parentElement; el.scrollIntoView({ block: 'center' }); const a = el.getBoundingClientRect(), b = document.querySelector('[data-horizon-row="postfob"]').getBoundingClientRect(), p = panel.getBoundingClientRect(); return { x: p.x, y: a.y - 70, w: p.width, h: b.bottom - a.y + 90 }; });
    const shot = path.join(__dirname, '../public/release-notes/next-assets/postfob-data-management-' + theme + '.png');
    const width = Math.min(1400, box.w + 8);
    await page.screenshot({ path: shot, clip: { x: Math.max(0, box.x - 4), y: Math.max(0, box.y), width, height: Math.max(Math.ceil(width / 3), box.h) } });
    assert.deepEqual(app.errors, []);
    console.log(JSON.stringify({ shot, inventory, row: row.replace(/\s+/g, ' ').slice(0, 300) }));
  } finally { await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
