'use strict';
// Baseline Quick FOB functional equivalence; License CARD-01 list identity is parked.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { start } = require('./lib/client-performance-app');
const output = path.resolve(process.argv[2] || '/tmp/license-quick-fob-acceptance');
fs.mkdirSync(output, { recursive: true });
(async () => {
  const app = await start(), cases = [];
  try {
    const { page, api } = app;
    await page.evaluate(async () => {
      await window.BLEnsureCpLoaded({ deferRender: true });
      await window.BLEnsureOrdersLoaded({ deferRender: true });
      if (typeof hydrateUserPreferencesAfterUi === 'function') await hydrateUserPreferencesAfterUi();
    });
    const cards = [];
    for (const name of ['Alpha', 'Beta']) {
      const data = await (await api('/api/license-cards', { license: 'FOB Demo ' + name, licensor: 'Demo Agency' })).json();
      const card = data.cards.find(c => c.license === 'FOB Demo ' + name);
      const ruleId = 'quick-original-' + name.toLowerCase();
      await api('/api/license-cards/' + encodeURIComponent(card.id), { editToken: card.editToken, rules: [{ id: ruleId, license: card.license, licensor: card.licensor, royalty: 8, trCommission: 2, ydCommission: 2, hologramCost: .1, opdStart: '2020-01-01', opdEnd: '', seasons: [], categories: [] }] }, 'PUT');
      cards.push({ ...card, ruleId });
    }
    const card = cards[0];
    await page.evaluate(() => switchTab('licensecards'));
    await page.waitForSelector('#licenseCardsPage [data-row]', { timeout: 60000 });
    await page.evaluate(() => BLLicenseCardsPage.invalidate());
    await page.locator('#lcSearch').fill('FOB Demo');
    const snapshot = () => page.evaluate(() => {
      const quick = document.querySelector('.lcQuick'), clone = quick.cloneNode(true);
      clone.querySelectorAll('input').forEach((el, i) => el.setAttribute('value', quick.querySelectorAll('input')[i].value));
      clone.querySelectorAll('option').forEach((el, i) => el.toggleAttribute('selected', quick.querySelectorAll('option')[i].selected));
      return { quick: clone.outerHTML, selected: document.querySelector('#lcQuickRule').value,
        options: [...document.querySelector('#lcQuickRule').options].map(o => ({ value: o.value, label: o.textContent })),
        values: Object.fromEntries([...quick.querySelectorAll('[data-lc-quick]')].map(el => [el.dataset.lcQuick, el.value])),
        status: document.querySelector('#lcQuickStatus').textContent,
        rows: [...document.querySelectorAll('#licenseCardsPage [data-row]')].map(el => el.outerHTML),
        dialogs: document.querySelectorAll('.lcEditor').length };
    });
    const open = () => page.locator(`.lcName[data-lc-act="expand"][data-id="${card.id}"]`).click();
    const markList = () => page.evaluate(id => {
      const list = document.querySelector('.lcTable');
      window.quickCloseReferences = { list, other: [...list.querySelectorAll('[data-row]')].find(el => el.dataset.row !== id), top: list.scrollTop, left: list.scrollLeft };
    }, card.id);
    const retained = () => page.evaluate(() => {
      const ref = window.quickCloseReferences, list = document.querySelector('.lcTable');
      return { list: ref.list === list, other: ref.other?.isConnected === true, scroll: ref.top === list.scrollTop && ref.left === list.scrollLeft };
    });
    const full = async () => { await page.evaluate(() => { document.activeElement?.blur(); BLLicenseCardsPage.renderLanguage(); }); return snapshot(); };
    const reset = async (source, amount) => {
      await open(); await page.locator('.lcEditor [data-lc-act="cancelEditor"]').click(); await full();
      await page.locator('#lcQuickRule').selectOption(card.ruleId);
      await page.locator(`[data-lc-quick="${source}"]`).fill(amount);
    };
    for (const [source, amount] of [['supp', '100,00'], ['yd', '200,00'], ['tr', '300,00']]) {
      for (const scenario of ['rate-close', 'period-cancel']) {
        await reset(source, amount);
        const before = await snapshot();
        await open();
        let removed;
        if (scenario === 'period-cancel') {
          await page.locator('.lcEditor [data-lc-act="addPeriod"]').click();
          removed = await page.locator('.lcEditor [data-lc-key="royalty"]').first().getAttribute('data-lc-rule');
        }
        await page.locator('.lcEditor [data-lc-key="royalty"]').first().fill(scenario === 'rate-close' ? '20' : '30');
        if (scenario === 'period-cancel') {
          await page.locator('.lcEditor [data-lc-act="closeEditor"]').click();
          await page.locator('#lcQuickRule').selectOption(removed);
          await open();
        }
        const beforeClose = await snapshot();
        await markList();
        await page.locator(`.lcEditor [data-lc-act="${scenario === 'rate-close' ? 'closeEditor' : 'cancelEditor'}"]`).click();
        const actual = await snapshot(), nodes = await retained();
        if (source === 'supp') await page.screenshot({ path: path.join(output, scenario + '.png') });
        const expected = await full();
        const checks = {
          quickEquivalent: actual.quick === expected.quick,
          rowsEquivalent: JSON.stringify(actual.rows) === JSON.stringify(expected.rows),
          detailEquivalent: actual.dialogs === expected.dialogs && actual.dialogs === 0,
          // License CARD-01 listRetained invariant lives in the parked original, not this baseline functional gate.
          amountRetained: actual.values[source] === amount,
          selectionEquivalent: actual.selected === expected.selected,
          validSelectionRetained: scenario !== 'rate-close' || actual.selected === card.ruleId,
          removedRuleAbsent: !removed || !actual.options.some(o => o.value === removed),
          meaningfulCalculationChange: JSON.stringify(expected.values) !== JSON.stringify((scenario === 'rate-close' ? before : beforeClose).values)
        };
        await open();
        const detail = await page.locator('.lcEditor .lcDetailIn').innerHTML();
        const royalty = await page.locator('.lcEditor [data-lc-key="royalty"]').first().inputValue();
        await full();
        checks.reopenedDetailEquivalent = detail === await page.locator('.lcEditor .lcDetailIn').innerHTML();
        checks.reopenedRoyalty = royalty === (scenario === 'rate-close' ? '20' : '8');
        await page.locator('.lcEditor [data-lc-act="closeEditor"]').click();
        cases.push({ scenario, source, amount, removed, checks, before, beforeClose, actual, expected, nodes });
      }
    }
    assert.deepEqual(app.errors, []);
    const result = { scope: 'baseline Quick FOB functional checks; license list-identity optimization parked', root: app.root, fixture: 'real isolated Buyer Log server; 20 source rows; 2 saved license cards; 1440x900 Chromium', cases, errors: app.errors };
    fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(result, null, 2) + '\n');
    console.log(JSON.stringify(cases.map(({ scenario, source, checks }) => ({ scenario, source, checks })), null, 2));
    assert.ok(cases.every(c => Object.values(c.checks).every(Boolean)), 'Quick FOB functional close/cancel differs from full render; see ' + output);
  } finally { await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
