'use strict';
// Gerçek Buyer Log (anonim demo veri): Non-DTR üretici kartı Lisans Kartları'ndaki
// lisansör birleştirme seçicisinde görünür ve lisansörle (TR/YD carisi) birleştirilir.
const path = require('node:path'), assert = require('node:assert/strict');
const { start } = require('./lib/client-performance-app');
const MAKER = 'WARNER BROS TÜRKİYE TEKSTİL LTD. ŞTİ.'; // i18n-ignore — demo üretici adı
(async () => {
  const lang = process.argv.includes('--tr') ? 'tr' : 'en';
  const app = await start({ initScript: l => { try { localStorage.setItem('bl.user.moderator.lcw.lang.v1', l); } catch (_) {} }, initArg: lang, deviceScaleFactor: 2 });
  try {
    const { page, api } = app;
    const directory = await (await api('/api/email-groups')).json();
    await api('/api/email-groups/records', { record: { manufacturer: MAKER, dtrStatus: 'NON-DTR', country: 'Turkey' }, expectedRevision: directory.revision });
    // Demo ASAS has no licensor column: two anonymous licensor cards (one licensor, TR + YD account names).
    for (const [license, licensor] of [['Harry Potter', 'Warner Bros'], ['Looney Tunes', 'Warner Bros UK Ltd'], ['Disney', 'Disney']]) await api('/api/license-cards', { license, licensor });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !document.getElementById('blBootGuard') || document.querySelector('[data-boot-continue]'), null, { timeout: 180000 });
    if (await page.$('[data-boot-continue]')) await page.click('[data-boot-continue]');
    await page.waitForFunction(() => !document.getElementById('blBootGuard'), null, { timeout: 180000 });
    await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close()));
    await page.click('button[data-tab="licensecards"]');
    await page.waitForSelector('[data-lc-act="merges"]', { timeout: 120000 });
    await page.click('button.lcBtn[data-lc-act="merges"]');
    await page.waitForSelector('#lcMergeSource');
    const groups = await page.$$eval('#lcMergeSource optgroup', list => list.map(g => ({ label: g.label, options: [...g.querySelectorAll('option')].map(o => o.value) })));
    assert.equal(groups.length, 2, JSON.stringify(groups));
    assert.ok(groups[1].options.includes(MAKER), 'Non-DTR manufacturer is offered: ' + JSON.stringify(groups));
    const target = groups[0].options.find(name => name === 'Warner Bros');
    assert.ok(target, 'demo licensor Warner Bros exists: ' + JSON.stringify(groups));
    await page.selectOption('#lcMergeSource', MAKER);
    await page.selectOption('#lcMergeTarget', target);
    await page.click('[data-lc-act="mergeManualAdd"]');
    await page.waitForFunction(m => [...document.querySelectorAll('.lcMergePanel .lcMergeName')].some(el => el.textContent === m), MAKER, { timeout: 30000 });
    await page.mouse.move(5, 5); await page.waitForTimeout(400);
    const box = await page.$eval('.lcMergePanel', el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; });
    const screenshot = path.join(__dirname, '../public/release-notes/next-assets/license-manufacturer-merge.png');
    if (!process.argv.includes('--no-shot')) {
      const pad = 16;
      await page.screenshot({ path: screenshot, clip: { x: Math.max(0, box.x - pad), y: Math.max(0, box.y - pad), width: box.width + pad * 2, height: Math.max(box.height + pad * 2, box.width / 3) } });
    }
    assert.deepEqual(app.errors, []);
    console.log(JSON.stringify({ groups, target, box, screenshot }, null, 1));
  } finally { await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
