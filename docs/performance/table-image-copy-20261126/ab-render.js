'use strict';
// L2 A/B: renderKol (1000 model, tek sayfa) ve renderCPNow (2000 satır) süreleri.
// node ab-render.js <appDir> <label>
const path = require('node:path');
const appDir = process.argv[2], label = process.argv[3];
const { start } = require(path.join(appDir, 'scripts/lib/client-performance-app'));
(async () => {
  const app = await start({ demoRows: 2000 });
  const { page } = app;
  try {
    // CP: tam satırlar yüklü eski çizim yolu (aynı fonksiyon renderFullTable'ı çağırır).
    await page.click('button[data-tab="cp"]');
    await page.waitForFunction(() => document.querySelectorAll('#cpTable tbody tr[data-id]').length > 5, null, { timeout: 120000 });
    await page.evaluate(() => ensureCpLoaded({ deferRender: true }));
    await page.waitForTimeout(1500);
    const cp = await page.evaluate(async () => {
      const out = [];
      for (let i = 0; i < 7; i++) { const t = performance.now(); renderCPNow(); out.push(performance.now() - t); await new Promise(r => setTimeout(r, 150)); }
      return out;
    });
    await page.click('button[data-tab="koleksiyon"]');
    await page.waitForFunction(() => typeof renderKol === 'function' && document.querySelector('#view-koleksiyon')?.offsetParent, null, { timeout: 60000 });
    await page.waitForFunction(() => kolWorkspaceCanEdit && kolIsOwnWorkspace(), null, { timeout: 60000 });
    const kol = await page.evaluate(async () => {
      const statuses = ['Sent for MB Approval', 'Order Placed', 'File Received'];
      kolRows = kolNormalizeModelGroups(Array.from({ length: 1000 }, (_, i) => ({ id: i + 1, plmId: 'DEMO-' + (1000 + i), modelKod: 'DEMO-M-' + i, colour: 'NAVY', colourCode: 'N' + (i % 50), durum: statuses[i % 3], productMainDefinition: 'Takım', category: 'KEY ORME TAKIM', season: 'W7', inStoreMonth: '2027-08', notes: 'Demo not ' + i })));
      const select = document.querySelector('#kolTableToolbar [data-range-size]');
      select.value = 'all'; select.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise(r => setTimeout(r, 500));
      const out = [];
      for (let i = 0; i < 7; i++) { const t = performance.now(); renderKol(); out.push(performance.now() - t); await new Promise(r => setTimeout(r, 150)); }
      return { out, rows: document.querySelectorAll('#kolTable tbody tr[data-id]').length };
    });
    const median = a => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
    // İlk iki ısınma çağrısı atılır.
    const cpS = cp.slice(2), kolS = kol.out.slice(2);
    console.log(JSON.stringify({ label, cpMedian: +median(cpS).toFixed(1), kolMedian: +median(kolS).toFixed(1), kolRows: kol.rows, cp: cpS.map(x => +x.toFixed(1)), kol: kolS.map(x => +x.toFixed(1)), errors: app.errors.length }));
  } finally { await app.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
