'use strict';
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { start } = require('/workspace/buyerlog-post-main-acceptance/resources/app/scripts/lib/client-performance-app');
(async () => {
  const app = await start(), captures = [];
  try {
    const { page, api } = app;
    await page.evaluate(async () => {
      await window.BLEnsureCpLoaded({ deferRender: true });
      await window.BLEnsureOrdersLoaded({ deferRender: true });
      if (typeof hydrateUserPreferencesAfterUi === 'function') await hydrateUserPreferencesAfterUi();
    });
    const capture = async name => { const file = path.join('/tmp/buyerlog-906-current-ui', name + '.png'); fs.mkdirSync(path.dirname(file), { recursive: true }); await page.screenshot({ path: file }); captures.push(file); };
    let cardData;
    for (const license of ['Demo Alpha', 'Demo Beta', 'Demo Gamma']) cardData = await (await api('/api/license-cards', { license, licensor: 'Demo Agency' })).json();
    const card = cardData.cards.find(c => c.license === 'Demo Alpha');
    await api('/api/license-cards/' + encodeURIComponent(card.id), { editToken: card.editToken, rules: [{ id: 'demo-contract', license: card.license, licensor: card.licensor, royalty: 8, trCommission: 2, ydCommission: 2, hologramCost: .1, opdStart: '2026-01-01', opdEnd: '', seasons: [], categories: [] }] }, 'PUT');
    await page.evaluate(() => switchTab('licensecards'));
    await page.waitForSelector('#licenseCardsPage [data-row]', { timeout: 60000 });
    await page.evaluate(() => BLLicenseCardsPage.invalidate());
    const cardButton = page.locator('#licenseCardsPage [data-lc-act="expand"]').filter({ hasText: 'Demo Alpha' });
    // License CARD-01 identity assertions are preserved in the parked original.
    // Retain the existing draft/reopen/discard functional assertions below.
    await page.evaluate(id => {
      document.querySelector(`[data-lc-act="expand"][data-id="${CSS.escape(id)}"]`).click();
    }, card.id);
    await page.waitForSelector('.lcEditor[open]');
    await page.locator('.lcEditor [data-lc-profile="contactName"]').fill('Demo İletişim');
    // Historical license screenshot remains preserved; it is not recaptured for active notes.
    await page.locator('.lcEditor [data-lc-act="closeEditor"]').click();
    await page.locator('#lcSearch').fill('Demo Beta');
    await cardButton.click(); assert.equal(await page.locator('.lcEditor [data-lc-profile="contactName"]').inputValue(), 'Demo İletişim');
    await page.locator('.lcEditor [data-lc-act="cancelEditor"]').click();
    assert.equal(await cardButton.count(), 0, 'discard removes a draft that was forced outside the current filter');
    await page.evaluate(() => switchTab('manufacturers'));
    await page.waitForSelector('[data-mfp-select]', { timeout: 60000 });
    const names = await page.evaluate(() => BLManufacturersPage.state.result.cards.filter(c => !c.sourceOnly).slice(0, 4).map(c => c.name));
    assert.ok(names.length >= 2);
    let directory = await (await api('/api/email-groups')).json();
    for (const [i, name] of names.entries()) directory = await (await api('/api/email-groups/records', { expectedRevision: directory.revision, record: { manufacturer: name, email: `demo${i}@example.test`, contact: `Demo Contact ${i}`, note: 'Demo / synthetic' } })).json();
    await page.evaluate(() => BLManufacturersPage.refresh({ force: true }));
    assert.equal(await page.evaluate(() => {
      const list = document.querySelector('.mfpListScroll'), row = list.firstElementChild; list.scrollTop = 80;
      list.querySelectorAll('[data-mfp-select]')[1].click();
      return document.querySelector('.mfpListScroll') === list && list.firstElementChild === row;
    }), true);
    await capture('manufacturer-separate-detail');
    await page.evaluate(() => BLEmailGroups.open());
    await page.waitForSelector('.egDirectoryRow');
    await page.evaluate(() => { window.demoDirectoryList = document.querySelector('.egDirectoryScroll'); window.demoDirectoryRow = demoDirectoryList.querySelector('.egDirectoryRow'); window.egBeforeRecords=BLEmailGroups.state.data.records; window.egBeforeData=JSON.stringify(BLEmailGroups.state.data); window.egBeforeSelected=BLEmailGroups.state.selectedId; });
    await page.locator('.egDirectoryRow').nth(1).click();
    console.log('EG_TRACE',JSON.stringify(await page.evaluate(()=>({listSame:document.querySelector('.egDirectoryScroll')===demoDirectoryList,rowSame:demoDirectoryList.querySelector('.egDirectoryRow')===demoDirectoryRow,recordsSame:egBeforeRecords===BLEmailGroups.state.data.records,dataSame:egBeforeData===JSON.stringify(BLEmailGroups.state.data),beforeSelected:egBeforeSelected,afterSelected:BLEmailGroups.state.selectedId}))));
    assert.equal(await page.evaluate(() => document.querySelector('.egDirectoryScroll') === demoDirectoryList && demoDirectoryList.querySelector('.egDirectoryRow') === demoDirectoryRow), true);
    await page.locator('[data-eg-edit]').click();
    await page.waitForSelector('[data-eg-input="contact"]');
    await page.locator('[data-eg-input="contact"]').fill('Demo taslak · korunuyor');
    const editedId = await page.evaluate(() => BLEmailGroups.state.editingId);
    await capture('email-directory-separate-detail');
    await page.locator('[data-eg-save]').click();
    await page.waitForSelector('[data-eg-edit]');
    const saved = await (await api('/api/email-groups')).json();
    assert.equal(saved.records.find(r => r.id === editedId).contact, 'Demo taslak · korunuyor');
    assert.deepEqual(app.errors, []);
    console.log(JSON.stringify({ captures, draftReopened: true, listsRetained: true, retainedListModules: ['manufacturers', 'email-groups'], directorySaveVerified: true, root: app.root }, null, 2));
  } catch(error){await app.page.screenshot({path:'/tmp/buyerlog-906-ui-red-2.png'});throw error;} finally { await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
