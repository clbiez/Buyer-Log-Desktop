'use strict';
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { start } = require('./lib/client-performance-app');
(async () => {
  const app = await start();
  try {
    const { page } = app;
    await page.evaluate(async () => { switchTab('lcwai'); if (window.BLPerf) await BLPerf.ensureFeature('lcwaiChat'); await initLcwAiChat(); });
    await page.evaluate(() => {
      const state = BLLcwAiChat._state;
      state.autoContext = false;
      state.conversations = [{ id: 'demo-stream', title: 'Demo · performans özeti', messages: [
        { role: 'user', text: 'Demo siparişleri kısa bir tabloyla özetle.' },
        { role: 'ai', text: '## Demo özeti\n\n| Üretici | Sipariş | Adet |\n|---|---:|---:|\n| Demo Tekstil A | 12 | 2400 |\n| Demo Tekstil B | 8 | 1600 |\n\n**20 sentetik sipariş · 4.000 adet.**' },
      ] }]; state.activeId = 'demo-stream';
      BuyerLogAI.chat = async options => {
        window.demoProgress = options.onProgress;
        return new Promise(resolve => { window.demoFinish = () => resolve({ chatId: 'demo', text: BLLcwAiChat._state.conversations[0].messages.at(-1).text }); });
      };
      window.demoSend = BLLcwAiChat.send('Bu demo özeti için kısa bir değerlendirme yaz.');
    });
    await page.waitForFunction(() => typeof window.demoProgress === 'function');
    const result = await page.evaluate(() => {
      const box = document.querySelector('[data-chat-messages]'), history = box.children[1];
      window.demoHistory = history;
      const range = document.createRange(); range.selectNodeContents(history.querySelector('strong'));
      getSelection().removeAllRanges(); getSelection().addRange(range); box.scrollTop = 0;
      demoProgress({ phase: 'streaming', delta: '## Değerlendirme\n\nDemo Tekstil A toplam adedin **%60**’ını, Demo Tekstil B **%40**’ını karşılıyor.\n\n- Toplam: **4.000 adet**\n- Sipariş sayısı: **20**\n\nYanıt akışı devam ediyor…' });
      return { selected: getSelection().toString() };
    });
    await page.waitForFunction(() => document.querySelector('.is-streaming')?.textContent.includes('Değerlendirme'));
    assert.equal(await page.evaluate(() => document.querySelector('[data-chat-messages]').children[1] === demoHistory), true);
    assert.equal(await page.evaluate(() => getSelection().toString()), result.selected);
    const screenshot = path.join(__dirname, '../public/release-notes/next-assets/lcwai-active-stream.png');
    fs.mkdirSync(path.dirname(screenshot), { recursive: true }); await page.screenshot({ path: screenshot });
    await page.evaluate(async () => { demoFinish(); await demoSend; });
    assert.deepEqual(app.errors, []); console.log(JSON.stringify({ screenshot, selected: result.selected, historyRetained: true, root: app.root }));
  } finally { await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
