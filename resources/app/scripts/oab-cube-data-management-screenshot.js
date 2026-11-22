'use strict';
// Gerçek Buyer Log (anonim demo veri) Veri Yönetimi ekranında OAB (Küp)
// kaynağının INTAKE / FOB Sonrası Maliyet gibi ayrı veritabanı olarak
// listelendiğini ve kendi ufuk satırının olduğunu doğrular; sürüm notu
// görselini üretir. Ağ çağrısı yoktur (İncele çalıştırılmaz).
const path = require('node:path'), assert = require('node:assert/strict');
const { start } = require('./lib/client-performance-app');
(async () => {
  const theme = process.argv.includes('--dark') ? 'dark' : 'light';
  const app = await start({ initScript: t => { try { localStorage.setItem('bl.user.moderator.lcw_theme', t); } catch (_) {} }, initArg: theme });
  try {
    const { page } = app;
    const lab = await app.api('/api/data-management/integration-lab').then(response => response.json());
    const inventory = (lab.inventory || []).map(item => `${item.kind}:${item.name}:${item.profileId || ''}`);
    assert.ok(inventory.some(entry => /^database:OAB \(Küp\)/.test(entry)), 'Corporate Integration Lab listesinde database olarak: ' + inventory.join(' | '));
    const connections = await app.api('/api/model-connections').then(response => response.json()).catch(() => null);
    if (connections && Array.isArray(connections.items)) {
      const cube = connections.items.find(item => item.role === 'oabcube');
      assert.ok(cube && cube.catalog === 'OAB_Cube', 'varsayılan oabcube bağlantısı');
    }
    await page.click('button[data-tab="source"]');
    await page.waitForSelector('[data-horizon-row="oabcube"]', { state: 'attached', timeout: 60000 });
    // Horizon paneli varsayılan olarak daraltılmış olabilir; kullanıcı gibi açılır.
    if (await page.$('[data-dm-panel-toggle="refresh"][aria-expanded="false"]')) await page.click('[data-dm-panel-toggle="refresh"]');
    await page.waitForSelector('[data-horizon-row="oabcube"]', { state: 'visible', timeout: 20000 });
    const row = await page.textContent('[data-horizon-row="oabcube"]');
    assert.match(row, /OAB \(Küp\)/);
    assert.match(row, /Ufuk yoksa widget’ta sezon seçilir/, 'ufuksuz "filtre gerekli" yerine widget sezonu');
    assert.doesNotMatch(row, /filtre gerekli/);
    const editable = await page.$('[data-horizon-row="oabcube"] [data-open-horizon="oabcube"]');
    assert.ok(editable, 'ufuk filtresi düzenlenebilir');
    await page.click('[data-horizon-row="oabcube"] [data-open-horizon="oabcube"]');
    await page.waitForFunction(() => { const drawer = document.getElementById('dmHorizonDrawer'); return drawer && !drawer.hidden; }, null, { timeout: 20000 });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    await page.mouse.move(5, 5);
    const box = await page.$eval('[data-horizon-row="intake"]', el => { const panel = el.closest('.dmPanel') || el.parentElement; el.scrollIntoView({ block: 'center' }); const a = el.getBoundingClientRect(), b = document.querySelector('[data-horizon-row="oabcube"]').getBoundingClientRect(), p = panel.getBoundingClientRect(); return { x: p.x, y: a.y - 70, w: p.width, h: b.bottom - a.y + 90 }; });
    const shot = path.join(__dirname, '../public/release-notes/next-assets/oab-cube-data-management-' + theme + '.png');
    const width = Math.min(1400, box.w + 8);
    await page.screenshot({ path: shot, clip: { x: Math.max(0, box.x - 4), y: Math.max(0, box.y), width, height: Math.max(Math.ceil(width / 3), box.h) } });
    assert.deepEqual(app.errors, []);
    console.log(JSON.stringify({ shot, inventory, row: row.replace(/\s+/g, ' ').slice(0, 300) }));
  } finally { await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
