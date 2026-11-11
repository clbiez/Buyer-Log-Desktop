'use strict';
// Sürüm notu görseli: PDF isteğinde Buyer Log tablosu görünürken dosya üretim
// adımları. Gerçek Buyer Log + sentetik demo verisi; LCW AI cevapları taklit edilir.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { start } = require('./lib/client-performance-app');
(async () => {
  const app = await start();
  try {
    const { page } = app;
    await page.evaluate(async () => { switchTab('lcwai'); if (window.BLPerf) await BLPerf.ensureFeature('lcwaiChat'); await initLcwAiChat(); });
    await page.click('[data-output-format="pdf"]');
    await page.evaluate(() => {
      const state = BLLcwAiChat._state;
      state.autoContext = false;
      state.conversations = [{ id: 'demo-progress', title: 'Demo · sezon özeti PDF', messages: [] }]; state.activeId = 'demo-progress';
      BuyerLogAI.ask = async () => ({ data: { mode: 'query', dataset: 'orders', specJson: JSON.stringify({ dataset: 'orders', rows: [{ field: 'Season' }], measures: [{ agg: 'count' }], title: 'Demo — sezon bazında sipariş sayısı' }), assumptions: [] }, structured: { ok: true }, model: { label: 'Demo' } });
      BuyerLogAI.chat = async options => {
        window.demoProgress = options.onProgress;
        return new Promise(resolve => { window.demoFinish = () => resolve({ chatId: 'demo', text: '', output: { id: 'demo', fileName: 'demo.pdf', format: 'pdf', bytes: 1000 } }); });
      };
      window.demoSend = BLLcwAiChat.send('Siparişlerden sezon bazında sipariş sayısını PDF olarak hazırla.');
    });
    await page.waitForFunction(() => typeof window.demoProgress === 'function', null, { timeout: 60000 });
    await page.evaluate(() => { demoProgress({ phase: 'streaming', chars: 2480 }); demoProgress({ phase: 'output', step: 'rendering' }); });
    await page.waitForFunction(() => document.querySelector('.lcwaiProgress .is-active')?.textContent.includes('sayfa düzenini'));
    await page.waitForTimeout(1200);
    const state = await page.evaluate(() => ({ steps: [...document.querySelectorAll('.lcwaiProgressStep')].map(li => `${li.className.split(' ').pop()}:${li.textContent}`), table: Boolean(document.querySelector('.is-streaming table')) }));
    assert.equal(state.table, true);
    await page.evaluate(() => {
      const box = document.querySelector('[data-chat-messages]'); box.scrollTop = box.scrollHeight;
      // Demo kurulumunun genel uyarı bildirimi görüntüyü örtmesin.
      for (const el of document.querySelectorAll('body *')) if (el.children.length < 6 && /uyarı var/.test(el.textContent || '') && getComputedStyle(el).position === 'fixed') el.style.display = 'none';
    });
    const screenshot = path.join(__dirname, '../public/release-notes/next-assets/lcwai-output-progress.png');
    await page.screenshot({ path: screenshot });
    await page.evaluate(async () => { demoFinish(); await demoSend; });
    assert.equal(await page.evaluate(() => document.querySelector('.lcwaiProgress')), null);
    assert.deepEqual(app.errors, []); console.log(JSON.stringify({ screenshot, state }));
  } finally { await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
