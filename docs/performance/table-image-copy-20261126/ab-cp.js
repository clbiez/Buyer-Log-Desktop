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
      for (let i = 0; i < 23; i++) { const t = performance.now(); renderCPNow(); out.push(performance.now() - t); await new Promise(r => setTimeout(r, 150)); }
      return out;
    });
    const kol = { out: [0, 0, 0], rows: 0 };
    const median = a => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
    // İlk iki ısınma çağrısı atılır.
    const cpS = cp.slice(3), kolS = kol.out.slice(2);
    console.log(JSON.stringify({ label, cpMedian: +median(cpS).toFixed(1), kolMedian: +median(kolS).toFixed(1), kolRows: kol.rows, cp: cpS.map(x => +x.toFixed(1)), kol: kolS.map(x => +x.toFixed(1)), errors: app.errors.length }));
  } finally { await app.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
