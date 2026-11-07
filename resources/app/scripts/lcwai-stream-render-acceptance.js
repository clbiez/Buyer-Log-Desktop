'use strict';
// Sentetik sohbet verisiyle Chromium içinde gerçek çizim ve Markdown.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i < 0 ? fallback : process.argv[i + 1]; };
const source = fs.readFileSync(arg('--source', path.join(__dirname, '../public/lcwai-chat.js')), 'utf8');
const instrumented = source.replace('window.BLLcwAiChat = {', 'window.BLLcwAiChat = { _paint: () => renderMessages(activeConversation().messages.at(-1)), _full: renderMessages, _html: () => activeConversation().messages.map((m, i) => messageHtml(m, i, activeConversation())).join(""),');
(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.setContent('<div id="lcwaiChatPage"><div data-chat-messages style="height:600px;overflow:auto"></div></div>');
    await page.addScriptTag({ path: path.join(__dirname, '../public/lcwai-markdown.js') });
    await page.evaluate(() => { window.mdCalls = 0; const render = BLMarkdown.render; BLMarkdown.render = (...args) => { window.mdCalls++; return render(...args); }; });
    await page.addScriptTag({ content: instrumented });
    const result = await page.evaluate(async () => {
      const chat = BLLcwAiChat, state = chat._state;
      const expectedHtml = () => { const template = document.createElement("template"); template.innerHTML = chat._html(); return template.innerHTML; };
      const messages = Array.from({ length: 100 }, (_, i) => ({ role: i % 2 ? 'ai' : 'user', text: i % 2 ? ('## Demo ' + i + '\n\n**Summary**\n\n| A | B |\n|---|---|\n| demo | 12 |\n\n```js\nconst demo = 1;\n```\n\n').repeat(8) : 'Demo question ' + i }));
      const answer = { role: 'ai', text: '', streaming: true, phase: 'Demo' };
      messages.push(answer);
      state.conversations = [{ id: 'demo', title: 'Demo', messages }]; state.activeId = 'demo';
      chat._full();
      const box = document.querySelector('[data-chat-messages]'), history = box.firstElementChild;
      const textNode = history.querySelector('.lcwaiMsgBody').firstChild, selection = window.getSelection(), range = document.createRange();
      range.selectNodeContents(textNode); selection.removeAllRanges(); selection.addRange(range);
      const selected = selection.toString(); box.scrollTop = 120;
      const times = [], frames = [], longTasks = [];
      const observer = new PerformanceObserver(list => longTasks.push(...list.getEntries().map(e => e.duration)));
      observer.observe({ type: 'longtask', buffered: false });
      let mdCalls = 0;
      // Uzun kod bloklu Markdown parçalarını rAF çizimi gibi ayrı karelerde gönder.
      const chunk = '\n\n**Demo** & <img src=x onerror="window.xss=1"> [bad](javascript:alert(1))\n\n```js\nconst x = 1;\n';
      for (let i = 0; i < 40; i++) {
        await new Promise(requestAnimationFrame);
        answer.text += chunk + (i % 2 ? '```\n' : '');
        const before = performance.now(); window.mdCalls = 0; chat._paint();
        times.push(performance.now() - before); mdCalls += window.mdCalls;
        frames.push(await new Promise(resolve => requestAnimationFrame(() => resolve(performance.now() - before))));
      }
      await new Promise(resolve => setTimeout(resolve, 50)); observer.disconnect();
      const sameHistory = box.firstElementChild === history, sameSelection = selection.toString() === selected, scrollTop = box.scrollTop;
      const streamingHtml = box.innerHTML, expected = expectedHtml();
      const safe = !box.querySelector('.lcwaiMsgBody img') && !box.querySelector('a[href^="javascript:"]') && !window.xss;
      answer.streaming = false; answer.text += '\n```\nFinal'; chat._full();
      const finalEquivalent = box.innerHTML === expectedHtml();
      // Geçersizleştirmeyi sınamak için dili ve sohbeti değiştirip yeniden çiz.
      window.appLang = 'en'; chat._full(); answer.text += '\nEnglish'; chat._paint();
      const languageEquivalent = box.innerHTML === expectedHtml();
      state.conversations.push({ id: 'other', messages: [{ role: 'ai', text: 'Other' }] }); state.activeId = 'other'; chat._full(); chat._paint();
      const conversationEquivalent = box.innerHTML === expectedHtml();
      times.sort((a, b) => a - b); frames.sort((a, b) => a - b);
      return { historyMessages: 100, paints: 40, mdCalls, p50Ms: times[20], p95Ms: times[38], frameP95Ms: frames[38], longTasks, sameHistory, sameSelection, scrollTop, safe, streamingEquivalent: streamingHtml === expected, finalEquivalent, languageEquivalent, conversationEquivalent };
    });
    console.log(JSON.stringify({ chromium: browser.version(), ...result }, null, 2));
    for (const key of ['safe', 'streamingEquivalent', 'finalEquivalent', 'languageEquivalent', 'conversationEquivalent']) assert.equal(result[key], true, key);
    if (process.argv.includes('--assert-optimized')) {
      assert.equal(result.mdCalls, result.paints, 'only active Markdown is parsed per paint');
      assert.equal(result.sameHistory, true, 'history DOM is retained');
      assert.equal(result.sameSelection, true, 'history text selection survives streaming');
      assert.equal(result.scrollTop, 120, 'reading position survives streaming');
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
