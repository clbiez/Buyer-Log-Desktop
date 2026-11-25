'use strict';
// Gerçek Buyer Log (izole demo veri): Send to Pricing → "Yalnız Fiyat Masası'na
// Gönder" üretici seçmeden talep açar; Fiyat Masası'nda listede olmayan yeni bir
// üretici elle eklenir ve fiyat girilir. Sürüm notu görselini üretir.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { start } = require('./lib/client-performance-app');

const NEW_MFR = 'ANLIK ATÖLYE DEMO';
(async () => {
  const app = await start({});
  try {
    const { page } = app;
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.evaluate(() => switchTab('koleksiyon'));
    await page.waitForFunction(() => window.BL_QUOTATIONS?.openSendToPricing && typeof kolRows !== 'undefined', null, { timeout: 120000 });
    await page.waitForTimeout(1500);
    // Demo Koleksiyon satırları: gerçek kolRows'a eklenir, Send to Pricing penceresi bunlarla açılır.
    const ids = await page.evaluate(() => {
      const base = Date.now() % 100000;
      const rows = ['DEMO-KNIT-01', 'DEMO-KNIT-02', 'DEMO-KNIT-03'].map((code, i) => ({ id: base + i, modelKod: code, plmId: 'PLM-' + (900 + i), lisans: 'DEMO LICENSE', urunTipi: 'Sweat', colour: 'NAVY', season: 'SS27', quantity: 2400 + i * 300, targetPrice: '4.20', pricing: {} }));
      kolRows.push(...rows); saveKolRows();
      return rows.map(row => row.id);
    });
    // Ön kontrol (pricingPreflight) bir onay penceresi açabilir; çağrı beklenmez.
    await page.evaluate(ids => { window.BL_QUOTATIONS.openSendToPricing({ rows: kolRows.filter(row => ids.includes(row.id)), count: ids.length, persist: true }); }, ids);
    // Demo satırlarda Tech Pack yok: ön kontrol penceresinde devam edilir.
    await page.waitForSelector('[data-pricing-preflight="continue"]', { timeout: 60000 });
    await page.click('[data-pricing-preflight="continue"]');
    await page.waitForSelector('#kolMfrDeskOnly', { timeout: 60000 });
    assert.equal(await page.locator('.mfrNavItem.isActive').count(), 0, 'hiçbir üretici seçili olmamalı');
    await page.click('#kolMfrDeskOnly');
    await page.waitForSelector('#kolMfrDeskOnly', { state: 'detached', timeout: 30000 });
    const created = await page.evaluate(() => { const list = window.BL_QUOTATIONS.desk.requests(); return list[0]; });
    assert.equal(created.items.length, 0, 'satır yok');
    assert.equal(created.models.length, 3, 'üç bekleyen model');

    await page.evaluate(() => switchTab('quotations'));
    await page.waitForSelector('.pdMatrix', { timeout: 60000 });
    assert.equal(await page.locator('.pdMatrix tbody tr[data-pd-model]').count(), 3, 'matris üç model satırı gösterir');
    await page.click('[data-pd-add-mfr]');
    await page.fill('[data-pd-mfr-name]', NEW_MFR);
    await page.click('[data-pd-mfr-apply]');
    await page.waitForSelector('.pdCellInput', { timeout: 30000 });
    const inputs = page.locator('.pdCellInput');
    assert.equal(await inputs.count(), 3, 'yeni üretici için üç fiyat hücresi');
    const prices = ['4.05', '3.95', '4.30'];
    for (let i = 0; i < prices.length; i++) { await inputs.nth(i).fill(prices[i]); await inputs.nth(i).press('Enter'); }
    await page.waitForTimeout(1500);
    const saved = await page.evaluate(async id => { const r = await fetch('/api/quotations', { credentials: 'same-origin' }); const data = await r.json(); return data.requests.find(item => item.id === id); }, created.id);
    assert.deepEqual(saved.models, [], 'sunucuda bekleyen model kalmaz');
    const num = value => Number(String(value).replace(',', '.'));
    assert.deepEqual(saved.items.map(item => item.manufacturer), [NEW_MFR, NEW_MFR, NEW_MFR], 'ASAS dışı üretici adı olduğu gibi kaydedilir');
    assert.deepEqual(saved.items.map(item => num(item.price)).sort(), prices.map(num).sort());
    await page.evaluate(() => {
      document.activeElement?.blur?.(); document.querySelectorAll('[data-ui-feedback],.toast,.blToast').forEach(el => el.remove());
      // Sürüm notu görselinde gerçek hesap adı görünmez: sahip adı demo adla değiştirilir.
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); const own = String(window.BL_USER_CONTEXT?.displayName || state?.currentUser?.displayName || '').trim();
      for (let node = walker.nextNode(); node; node = walker.nextNode()) if (own && node.nodeValue.includes(own)) node.nodeValue = node.nodeValue.split(own).join('Demo Buyer');
    });
    await page.waitForTimeout(400);
    const screenshot = path.join(__dirname, '../public/release-notes/next-assets/pricing-request-without-manufacturer.png');
    const box = await page.locator('.pdMatrix').evaluate(el => { const host = el.closest('.quotationDetail') || el.parentElement.parentElement; const r = host.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; });
    const clip = { x: Math.max(0, Math.round(box.x)), y: Math.max(0, Math.round(box.y)), width: Math.min(1600 - Math.round(box.x), Math.round(box.width)), height: 470 };
    await page.screenshot({ path: screenshot, clip });
    assert.deepEqual(app.errors, []);
    console.log(JSON.stringify({ screenshot, clip, request: saved.id }));
  } finally { await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
