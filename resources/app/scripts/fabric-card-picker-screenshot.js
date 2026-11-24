'use strict';
// Gerçek Buyer Log (anonim demo veri) Koleksiyonunda kumaş seçiciyi doğrular ve
// sürüm notu görselini üretir: (1) boş kumaş hücresine çift tıkla kayıtlı karttan
// seçim; (2) kart penceresindeki "Kumaşı değiştir / set parçaları" ile takım
// modele elle harf verilen B parçası ekleme. Demo kartlar geçici veri köküne yazılır.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { start } = require('./lib/client-performance-app');
const RIB = '900101-Örme,Ribana,30/1 Ne,Pamuk,Elastan,220 gsm,%95 Pamuk, %5 Elastan,Reaktif'; // i18n-ignore
const TERRY = '900102-Örme,Üç İplik,30/70/20,260 gsm,%65 Pamuk, %35 Polyester,Reaktif'; // i18n-ignore
const JERSEY = '900103-Örme,Süprem,30/1 Ne,Compact Penye,150 gsm,%100 Pamuk,Reaktif'; // i18n-ignore
(async () => {
  const lang = process.argv.includes('--en') ? 'en' : 'tr';
  const app = await start({ initScript: l => { try { localStorage.setItem('bl.user.moderator.lcw.lang.v1', l); } catch (_) {} }, initArg: lang, deviceScaleFactor: 2 });
  try {
    const { page } = app;
    await page.click('button[data-tab="koleksiyon"]');
    await page.waitForFunction(() => typeof renderKol === 'function' && document.querySelector('#view-koleksiyon')?.offsetParent, null, { timeout: 60000 });
    await page.waitForFunction(() => kolWorkspaceCanEdit && kolIsOwnWorkspace(), null, { timeout: 60000 });
    await page.evaluate(async ({ RIB, TERRY, JERSEY }) => {
      const cards = [
        { code: '900101', summary: 'Ribana · 30/1 Ne · 220 gsm · 95% Pamuk 5% Elastan', summaryEn: 'Rib · 30/1 Ne · 220 gsm · 95% Cotton 5% Elastane', summarySource: 'manual', raw: RIB },
        { code: '900102', summary: 'Üç İplik · 30/70/20 · 260 gsm · 65% Pamuk 35% Polyester', summaryEn: 'Three Thread Terry · 30/70/20 · 260 gsm · 65% Cotton 35% Polyester', summarySource: 'manual', raw: TERRY },
        { code: '900103', summary: 'Süprem · 30/1 Ne · 150 gsm · 100% Pamuk', summaryEn: 'Single Jersey · 30/1 Ne · 150 gsm · 100% Cotton', summarySource: 'manual', raw: JERSEY },
      ];
      kolFabricCardsSet(await kolFabricCardsSave(cards, { onlyMissing: true }));
      kolFabricCardsState = 'ready';
      const base = { inStoreMonth: '2026-10', durum: 'Order Placed', quantity: '1200' };
      kolRows = kolNormalizeModelGroups([
        { id: 1, plmId: 'DEMO-701', modelKod: 'DM701', colour: 'NAVY', colourCode: 'N01', fabric: '', ...base },
        { id: 2, plmId: 'DEMO-702', modelKod: 'DM702', colour: 'GREY MEL', colourCode: 'G02', fabric: TERRY, ...base },
      ]);
      saveKolRows(); renderKol();
    }, { RIB, TERRY, JERSEY });
    // (1) Boş hücre → seçici → kayıtlı kart.
    await page.dblclick('#kolTable textarea.editCell[data-k="fabric"][data-id="1"]');
    await page.waitForSelector('#_kolFabricPickerModal [data-pick-code="0"]');
    await page.fill('#_kolFabricPickerModal [data-pick-code="0"]', 'ribana');
    await page.dispatchEvent('#_kolFabricPickerModal [data-pick-code="0"]', 'change');
    assert.equal(await page.inputValue('#_kolFabricPickerModal [data-pick-code="0"]'), '900101');
    await page.click('#_kolFabricPickerModal [data-pick="apply"]');
    await page.waitForSelector('#_kolFabricPickerModal', { state: 'detached' });
    const single = await page.evaluate(() => kolEffectiveValue(kolRows.find(r => r.id === 1), 'fabric'));
    assert.equal(single, RIB);
    // (2) Kart hücresi → kart penceresi → "Kumaşı değiştir / set parçaları" → B parçası.
    await page.dblclick('#kolTable td.kolFabricTd[data-fabric-id="2"]');
    await page.click('#_kolFabricCardModal [data-fabric="pick"]');
    await page.waitForSelector('#_kolFabricPickerModal [data-pick-code="0"]');
    await page.click('#_kolFabricPickerModal [data-pick="add"]');
    await page.fill('#_kolFabricPickerModal [data-pick-label="0"]', 'A');
    await page.fill('#_kolFabricPickerModal [data-pick-label="1"]', 'B');
    await page.fill('#_kolFabricPickerModal [data-pick-code="1"]', '900103');
    await page.dispatchEvent('#_kolFabricPickerModal [data-pick-code="1"]', 'change');
    await page.click('#_kolFabricPickerModal .verHistHead');
    await page.mouse.move(5, 5); await page.waitForTimeout(300);
    const box = await page.$eval('#_kolFabricPickerModal [role="dialog"]', el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; });
    const screenshot = path.join(__dirname, '../public/release-notes/next-assets/collection-fabric-card-picker.png');
    if (!process.argv.includes('--no-shot')) {
      fs.mkdirSync(path.dirname(screenshot), { recursive: true });
      const pad = 24;
      await page.screenshot({ path: screenshot, clip: { x: Math.max(0, box.x - pad), y: Math.max(0, box.y - pad), width: box.width + pad * 2, height: box.height + pad * 2 } });
    }
    await page.click('#_kolFabricPickerModal [data-pick="apply"]');
    await page.waitForSelector('#_kolFabricPickerModal', { state: 'detached' });
    const set = await page.evaluate(() => window.BLFabricCards.parts(kolEffectiveValue(kolRows.find(r => r.id === 2), 'fabric')).map(p => [p.label, p.code]));
    assert.deepEqual(set, [['A', '900102'], ['B', '900103']]);
    // Geri alma tek adımda önceki kumaşa döner.
    const undone = await page.evaluate(() => { kolUndo(); return kolEffectiveValue(kolRows.find(r => r.id === 2), 'fabric'); });
    assert.equal(undone, TERRY);
    const cell = await page.$eval('#kolTable td.kolFabricTd[data-fabric-id="1"]', el => el.textContent.replace(/\s+/g, ' ').trim());
    assert.deepEqual(app.errors, []);
    console.log(JSON.stringify({ single: single.slice(0, 20), set, cell, box, screenshot }, null, 1));
  } finally { await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
