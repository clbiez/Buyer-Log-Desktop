'use strict';
// Gerçek Buyer Log (anonim demo veri): gramajı boş kumaş kartı kaydedilebilir.
// Kart penceresinde boş GRAMAJ parçası doğrulama hatası vermez; Kaydet sonrası
// kart iki dilde de boş parçayı korur ve tablo hücresi kart görünümüne geçer.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { start } = require('./lib/client-performance-app');
const RAW = '900201-Triko,Triko-Diğer,30/2/2,%100 Pamuk'; // i18n-ignore
(async () => {
  const lang = process.argv.includes('--tr') ? 'tr' : 'en';
  const app = await start({ initScript: l => { try { localStorage.setItem('bl.user.moderator.lcw.lang.v1', l); } catch (_) {} }, initArg: lang, deviceScaleFactor: 2 });
  try {
    const { page } = app;
    await page.click('button[data-tab="koleksiyon"]');
    await page.waitForFunction(() => typeof renderKol === 'function' && document.querySelector('#view-koleksiyon')?.offsetParent, null, { timeout: 60000 });
    await page.waitForFunction(() => kolWorkspaceCanEdit && kolIsOwnWorkspace(), null, { timeout: 60000 });
    await page.evaluate(async ({ RAW }) => {
      kolFabricCardsState = 'ready';
      kolRows = kolNormalizeModelGroups([{ id: 1, plmId: 'DEMO-901', modelKod: 'DM901', colour: 'ECRU', colourCode: 'E01', fabric: RAW, inStoreMonth: '2026-10', durum: 'Order Placed', quantity: '800' }]);
      saveKolRows(); renderKol();
    }, { RAW });
    await page.dblclick('#kolTable textarea.editCell[data-k="fabric"][data-id="1"], #kolTable td.kolFabricTd[data-fabric-id="1"]');
    await page.waitForSelector('#_kolFabricCardModal [data-part="tr:0"]');
    const fill = async (sel, value) => { await page.fill(sel, value); await page.dispatchEvent(sel, 'input'); };
    // Fill the active source language; the other side is translated (Triko/Knitwear by hand, it is not in the glossary).
    const src = await page.$eval('#_kolFabricCardModal [data-source-language]', el => el.value);
    const other = src === 'tr' ? 'en' : 'tr';
    const values = { tr: ['Triko', '30/2/2', '', '100% Pamuk'], en: ['Knitwear', '30/2/2', '', '100% Cotton'] };
    for (let i = 0; i < 4; i++) await fill(`#_kolFabricCardModal [data-part="${src}:${i}"]`, values[src][i]);
    await page.evaluate(() => {
      const box = document.querySelector('#_kolFabricCardModal');
      box.querySelector('[data-segment-action="edit:0"]').click();
    });
    await fill(`#_kolFabricCardModal [data-part="${other}:0"]`, values[other][0]);
    await page.mouse.move(5, 5); await page.waitForTimeout(400);
    const state = await page.evaluate(() => {
      const box = document.querySelector('#_kolFabricCardModal');
      const v = box.querySelector('[data-segment-validation]');
      return { hidden: v.hidden, text: v.textContent, en: [0, 1, 2, 3].map(i => box.querySelector(`[data-part="en:${i}"]`).value) };
    });
    assert.equal(state.hidden, true, 'validation error must not block an empty weight: ' + state.text);
    assert.deepEqual(state.en, ['Knitwear', '30/2/2', '', '100% Cotton']);
    console.log('source', src);
    const box = await page.$eval('#_kolFabricCardModal [role="dialog"], #_kolFabricCardModal .verHistBox, #_kolFabricCardModal > div', el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; });
    const screenshot = path.join(__dirname, '../public/release-notes/next-assets/fabric-card-empty-segment.png');
    if (!process.argv.includes('--no-shot')) {
      const pad = 16, h = Math.min(box.height, 560) + pad * 2;
      await page.screenshot({ path: screenshot, clip: { x: Math.max(0, box.x - pad), y: Math.max(0, box.y - pad), width: box.width + pad * 2, height: h } });
    }
    await page.click('#_kolFabricCardModal [data-fabric="save"]');
    await page.waitForSelector('#_kolFabricCardModal', { state: 'detached', timeout: 15000 });
    const saved = await page.evaluate(() => { const c = kolFabricCards.get('900201'); return { tr: c.summarySegments.tr, en: c.summarySegments.en, summary: c.summary, summaryEn: c.summaryEn }; });
    assert.deepEqual(saved.tr, ['Triko', '30/2/2', '', '100% Pamuk']);
    assert.deepEqual(saved.en, ['Knitwear', '30/2/2', '', '100% Cotton']);
    const cell = await page.$eval('#kolTable td.kolFabricTd[data-fabric-id="1"]', el => el.textContent.replace(/\s+/g, ' ').trim());
    assert.deepEqual(app.errors, []);
    console.log(JSON.stringify({ saved, cell, box, screenshot }, null, 1));
  } finally { await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
