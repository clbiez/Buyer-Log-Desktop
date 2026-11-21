'use strict';
// Gerçek Buyer Log (demo veri) içinde ortak alan seçicisinin (BLDataPicker —
// ASAS / IAS filtresi, eşleme, CP sütunları) Tablo → Klasör ara başlıklarını
// doğrular ve sürüm notu görselini üretir. Demo ortamında Horizon database
// bulunmadığından alan listesi anonim demo alanlarla verilir; seçici, CSS ve
// başlıklar gerçek istemci koduyla çizilir.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { start } = require('./lib/client-performance-app');
(async () => {
  const app = await start({});
  try {
    const { page } = app;
    // Modül tembel yüklenir; seçici ve data-management.css gerçek yoldan yüklenir.
    await page.evaluate(() => window.BLPerf.ensureFeature('dataManagement'));
    await page.waitForFunction(() => window.BLDataPicker && typeof window.BLDataPicker.open === 'function', null, { timeout: 15000 });
    await page.evaluate(() => {
      const anchor = document.createElement('button');
      anchor.id = 'demoPickerAnchor'; anchor.textContent = 'alan seç';
      Object.assign(anchor.style, { position: 'fixed', left: '40px', top: '40px', zIndex: 1 });
      document.body.appendChild(anchor);
      const items = [];
      const add = (group, labels) => labels.forEach(label => items.push({ value: `${group.join('/')}/${label}`, label, group }));
      add(['Buyer Log alanları'], ['Merch Alt Grup', 'Merch Grup']);
      add(['Demo Model', 'Merch'], ['Merch Alt Grup Kod', 'Merch Alt Grup Ad', 'Merch Grup Kod']);
      add(['Demo Model', 'Planlama'], ['Model Bütçe Merch Yıl Ay', 'Gelecek Dönem Merch Alt Grup Kod']);
      add(['Demo Sevkiyat', 'Inspection'], ['Inspection Geçme Merch Yıl Ay', 'Inspection Geçme Merch Yıl Hafta']);
      add(['Demo Stok', 'Depo'], ['Depo Merch Yıl Ay', 'Depo Merch Yıl Hafta']);
      window.BLDataPicker.open(anchor, items, () => {}, { placeholder: 'Alan ara…' });
    });
    await page.fill('.dmfPickerSearch', 'merch');
    const heights = await page.$$eval('.dmfPickerGroup', els => els.map(el => el.getBoundingClientRect().height));
    assert.ok(heights.length >= 6, 'başlıklar çizilmeli');
    for (const h of heights) assert.ok(h >= 16, `başlık ezilmemeli: ${h}px`);
    await page.waitForTimeout(200);
    const screenshot = path.join(__dirname, '../public/release-notes/next-assets/data-picker-group-headers.png');
    fs.mkdirSync(path.dirname(screenshot), { recursive: true });
    await page.screenshot({ path: screenshot, clip: { x: 0, y: 0, width: 960, height: 420 } });
    assert.deepEqual(app.errors, []);
    console.log(JSON.stringify({ screenshot, heights }));
  } finally { await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
