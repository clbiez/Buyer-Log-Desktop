'use strict';
// Gerçek Buyer Log (anonim demo veri) Koleksiyon Kumaş hücresinde olumsuz
// sürdürülebilirlik ibaresinin ("Sürdürülebilir İçerik Yok") özet etiketine
// girmediğini, gerçek sürdürülebilir içeriğin ise etiket olarak kaldığını
// doğrular ve sürüm notu görselini üretir.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { start } = require('./lib/client-performance-app');
(async () => {
  const app = await start();
  try {
    const { page } = app;
    await page.setViewportSize({ width: 1400, height: 800 });
    await page.click('button[data-tab="koleksiyon"]');
    await page.waitForFunction(() => typeof renderKol === 'function' && document.querySelector('#view-koleksiyon')?.offsetParent, null, { timeout: 60000 });
    const facts = await page.evaluate(async () => {
      const engine = window.BLFabricCards;
      const card = (raw, summary, summaryEn) => {
        const rule = engine.ruleCard(raw);
        return { ...rule, raw, summary, summaryEn, summarySource: 'manual' };
      };
      const cards = [
        card('9101-Örme,Süprem,24 Ne Compact Penye Pamuk,180 gsm,%100 Pamuk,Reaktif,Sürdürülebilir İçerik Yok', 'Süprem · 24/1 Ne · 180 gsm · 100% Pamuk', 'Single Jersey · 24/1 Ne · 180 gsm · 100% Cotton'), // i18n-ignore
        card('9102-Örme,Süprem,30/1 Ne Penye,150 gsm,%100 Pamuk,Reaktif,Organik Pamuk', 'Süprem · 30/1 Ne · 150 gsm · 100% Pamuk', 'Single Jersey · 30/1 Ne · 150 gsm · 100% Cotton'), // i18n-ignore
      ];
      kolFabricCardsSet({ cards });
      const base = { season: 'W26', mag: 'DEMO MAG', urunTipi: 'DEMO KLASMAN', inStoreMonth: '2027-02', country: 'China', licensor: 'DTR', lisans: '' };
      kolRows = kolNormalizeModelGroups([
        { id: 1, plmId: 'DEMO-100', modelKod: 'DM100', colour: 'NAVY', colourCode: 'N01', quantity: '2000', fabric: cards[0].raw, ...base },
        { id: 2, plmId: 'DEMO-200', modelKod: 'DM200', colour: 'ECRU', colourCode: 'E02', quantity: '1500', fabric: cards[1].raw, ...base },
      ]);
      const keep = new Set(['modelKod', 'colour', 'fabric', 'quantity']);
      kolHiddenCols = new Set([...kolDescriptorCatalog({ all: true }).keys()].filter(key => !keep.has(key))); kolPictureHidden = true;
      renderKol();
      await new Promise(resolve => setTimeout(resolve, 300));
      const tags = [...document.querySelectorAll('#kolTable .blCellTag[data-tone="eco"]')].map(el => el.textContent);
      return { tags, details: cards.map(c => c.details.sustainability), text: document.querySelector('#kolTable').innerText };
    });
    assert.deepEqual(facts.tags, ['Organik Pamuk']); // i18n-ignore
    assert.equal(facts.details[0], 'Sürdürülebilir İçerik Yok'); // i18n-ignore
    assert.doesNotMatch(facts.text, /Sürdürülebilir İçerik Yok/); // i18n-ignore
    await page.mouse.move(5, 5); await page.waitForTimeout(400);
    const box = await page.$eval('#kolTable', el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; });
    const screenshot = path.join(__dirname, '../public/release-notes/next-assets/fabric-sustainability-summary.png');
    fs.mkdirSync(path.dirname(screenshot), { recursive: true });
    const x = Math.max(0, box.x - 4), y = Math.max(0, box.y - 4);
    const width = Math.min(1400 - x, Math.max(900, Math.ceil(box.width) + 8)), height = Math.max(360, Math.ceil(box.height) + 16, Math.ceil(width / 3.1));
    await page.screenshot({ path: screenshot, clip: { x, y, width, height } });
    assert.deepEqual(app.errors, []);
    console.log(JSON.stringify({ screenshot, tags: facts.tags, box }));
  } finally { await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
