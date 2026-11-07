'use strict';
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { createHash } = require('node:crypto');
const app = path.resolve(__dirname, '..');
const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i < 0 ? fallback : process.argv[i + 1]; };
const sourceDir = arg('--source-dir', path.join(app, 'public'));
(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
  const results = [];
  try {
    for (const count of (process.argv.includes('--small-only') ? [500] : [500, 5000])) for (const module of (arg('--module', '') ? [arg('--module')] : ['license-cards', 'manufacturers', 'email-groups'])) {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
      await page.setContent('<div id="licenseCardsPage"></div><div id="manufacturersPage"></div><div id="emailFixture"><span data-eg-count></span><select data-eg-filter-country></select><select data-eg-filter-type></select><div data-eg-body></div></div>');
      await page.addStyleTag({ content: '.lcTable,.mfpListScroll,.egDirectoryScroll{height:500px;overflow:auto}.lcRow{height:44px}.mfpRow,.egDirectoryRow{display:block;height:70px}.mfpBody,[data-eg-body]{display:grid;grid-template-columns:400px 1fr}.lcEditor{width:800px;height:500px}' });
      await page.evaluate(() => { window.appLang = 'en'; window.BLStorage = { getItem: () => null }; window.showToast = () => {}; window.__requests = []; });
      for (const file of ['license-cards-engine.js', 'manufacturer-cards-engine.js', 'business-rules.js']) await page.addScriptTag({ path: path.join(app, 'public', file) });
      let source = fs.readFileSync(path.join(sourceDir, module + '.js'), 'utf8');
      const expose = {
        'license-cards': ['window.initLicenseCardsPage=', 'window.__fixture={S,render,act,save,ensureDraft,currentRows,counts,rowHtml,detailHtml};window.initLicenseCardsPage='],
        manufacturers: ['window.initManufacturersPage =', 'window.__fixture={S,render,shellHtml,visibleCards,detailHtml,listRowHtml};window.initManufacturersPage ='],
        'email-groups': ['window.BLEmailGroups =', 'window.__fixture={S,render,sections,detailPaneHtml,absorb,startEdit,saveEdit,collectDraft,directoryRowHtml};window.BLEmailGroups ='],
      }[module]; source = source.replace(...expose);
      // Rehberin ilgisiz gecikmeli arka plan okumasını bu fixture dışında tut.
      if (module === 'email-groups') source = source.replace('setTimeout(() => { void ensureDirectory()', 'window.__unused = (() => { void ensureDirectory()');
      await page.addScriptTag({ content: source });
      const result = await page.evaluate(async ({ module, count, verifyOnly }) => {
        const f = __fixture, S = f.S;
        const records = Array.from({ length: count }, (_, i) => ({ id: 'demo-' + i, manufacturer: 'Demo ' + String(i).padStart(5, '0'), email: 'demo' + i + '@example.test', contact: 'Demo contact', countryId: 'tr', typeId: 'knit', dtrStatus: 'DTR', aliases: [], note: '', updatedAt: '2026-11-07T00:00:00.000Z' }));
        const directory = { revision: 1, countries: [{ id: 'tr', name: 'Demo country' }], types: [{ id: 'knit', name: 'Demo type' }], records, currentUserId: 'demo' };
        if (module === 'license-cards') {
          S.host = document.getElementById('licenseCardsPage'); S.animate = false;
          S.data = { revision: 1, canEdit: true, cards: records.map((r, i) => ({ id: r.id, license: r.manufacturer, licensor: 'Demo agency', editToken: 'demo-token', contactName: '', rules: [{ id: 'rule-' + i, license: r.manufacturer, licensor: 'Demo agency', royalty: 5, trCommission: 0, ydCommission: 0, hologramCost: 0, seasons: [], categories: [], opdStart: '2020-01-01', opdEnd: '' }] })) };
        } else if (module === 'manufacturers') {
          S.host = document.getElementById('manufacturersPage'); S.host.innerHTML = f.shellHtml(); S.directory = directory;
          S.result = BLManufacturerCards.buildCards([], records, { today: new Date('2026-11-07') });
        } else { S.modal = document.getElementById('emailFixture'); f.absorb(directory); }
        window.fetch = async (url, options = {}) => {
          __requests.push({ url, method: options.method || 'GET', body: options.body && JSON.parse(options.body) });
          if (module === 'license-cards') {
            const id = decodeURIComponent(url.split('/').at(-1)), card = S.data.cards.find(c => c.id === id);
            const data = { ...S.data, revision: S.data.revision + 1, cards: S.data.cards.map(c => c.id === id ? { ...card, ...JSON.parse(options.body).profile, editToken: 'demo-token-' + S.data.revision } : c) };
            return { ok: true, json: async () => data };
          }
          const id = decodeURIComponent(url.split('/').at(-1)), record = options.body && JSON.parse(options.body).record;
          return { ok: true, json: async () => record ? { ...S.data, revision: S.data.revision + 1, records: S.data.records.map(r => r.id === id ? { ...record, id } : r) } : directory };
        };
        f.render();
        const listSelector = module === 'license-cards' ? '.lcTable' : module === 'manufacturers' ? '.mfpListScroll' : '.egDirectoryScroll';
        const rowSelector = module === 'license-cards' ? '[data-row]' : module === 'manufacturers' ? '[data-mfp-select]' : '[data-eg-select]';
        const detailSelector = module === 'license-cards' ? '.lcEditor' : module === 'manufacturers' ? '.mfpDetail' : '.egDetailPane';
        const root = S.host || S.modal, list = root.querySelector(listSelector), firstRow = root.querySelector(rowSelector);
        list.scrollTop = 120;
        const select = i => {
          if (module === 'license-cards') f.act({ dataset: { lcAct: 'expand', id: records[i].id } });
          else { if (module === 'manufacturers') S.selectedKey = S.result.cards[i].key; else S.selectedId = records[i].id; f.render(); }
        };
        const timings = { select: [], search: [], save: [] };
        const measure = async (name, fn) => { await new Promise(requestAnimationFrame); const start = performance.now(); await fn(); void root.offsetHeight; timings[name].push(performance.now() - start); };
        for (let i = 0; i < (verifyOnly ? 2 : 10); i++) await measure('select', () => select(i + 1));
        const retainedList = root.querySelector(listSelector) === list, retainedRow = root.querySelector(rowSelector) === firstRow, scrollTop = root.querySelector(listSelector).scrollTop;
        const expectedRows = module === 'license-cards' ? f.currentRows().map(f.rowHtml).join('') : module === 'manufacturers' ? f.visibleCards().map(f.listRowHtml).join('') : f.sections().flatMap(s => s.records).map(f.directoryRowHtml).join('');
        const expectedTemplate = document.createElement('template'); expectedTemplate.innerHTML = expectedRows;
        const actualRows = [...root.querySelectorAll(rowSelector)].map(row => row.outerHTML).join('');
        const expectedRowsHtml = expectedTemplate.innerHTML;
        const listEquivalent = actualRows === expectedRowsHtml;
        let differenceAt = 0; while (differenceAt < Math.min(actualRows.length, expectedRowsHtml.length) && actualRows[differenceAt] === expectedRowsHtml[differenceAt]) differenceAt++;
        const listDifference = listEquivalent ? null : {at: differenceAt, actual: actualRows.slice(differenceAt - 40, differenceAt + 150), expected: expectedRowsHtml.slice(differenceAt - 40, differenceAt + 150)};
        let detailEquivalent = true;
        {
          const expected = module === 'license-cards' ? f.detailHtml(f.currentRows().find(r => r.id === S.expanded), S.drafts.get(S.expanded)) : module === 'manufacturers' ? f.detailHtml(S.result.cards.find(c => c.key === S.selectedKey)) : f.detailPaneHtml(S.data.records.find(r => r.id === S.selectedId));
          const template = document.createElement('template'); template.innerHTML = expected; detailEquivalent = root.querySelector(detailSelector).innerHTML === (module === 'license-cards' ? template.content.firstElementChild.innerHTML : template.innerHTML);
        }
        if (module === 'license-cards') f.act({ dataset: { lcAct: 'closeEditor' } });
        for (let i = 0; i < (verifyOnly ? 2 : 10); i++) await measure('search', () => { if (module === 'license-cards') S.query = i % 2 ? '' : '000'; else S.search = i % 2 ? '' : '000'; f.render(); });
        let draftPreserved = true, saved = true;
        if (module === 'license-cards') {
          for (let i = 0; i < 5; i++) await measure('save', async () => { document.activeElement?.blur(); S.expanded = records[0].id; const d = f.ensureDraft(records[0].id); d.profile.contactName = 'Changed ' + i; await f.save(records[0].id); });
          saved = S.data.cards[0].contactName === 'Changed 4';
        } else if (module === 'email-groups') {
          S.selectedId = records[0].id; S.editingId = records[0].id; S.draft = { ...S.data.records[0] }; f.render();
          const input = root.querySelector('[data-eg-input="contact"]'); input.value = 'Draft'; input.focus(); input.setSelectionRange(2, 2); S.draft = f.collectDraft();
          S.search = 'Demo'; f.render(); draftPreserved = root.querySelector('[data-eg-input="contact"]') === input && document.activeElement === input && input.selectionStart === 2;
          for (let i = 0; i < 5; i++) await measure('save', async () => { document.activeElement?.blur(); S.editingId = records[0].id; S.draft = { ...S.data.records[0], contact: 'Changed ' + i }; f.render(); await f.saveEdit(records[0].id); });
          saved = S.data.records[0].contact === 'Changed 4';
        }
        let lockRefreshed = true;
        if (module === 'email-groups') {
          S.search = ''; S.selectedId = records[0].id;
          f.absorb({ ...S.data, revision: S.data.revision + 1, records: S.data.records.map(r => r.id === S.selectedId ? { ...r, lock: { userId: 'other-demo', userName: 'Demo peer' } } : r) }); f.render();
          lockRefreshed = !!root.querySelector('.egDirectoryRow.isLocked') && root.querySelector('.egDetailPane').textContent.includes('Demo peer') && !root.querySelector('[data-eg-edit]');
          window.appLang = 'tr'; f.render(); lockRefreshed = lockRefreshed && root.querySelector('.egDetailPane').textContent.includes('düzenliyor');
        }
        const summary = Object.fromEntries(Object.entries(timings).map(([name, values]) => { values.sort((a, b) => a - b); return [name, values.length ? { samples: values.length, p50Ms: values[Math.floor(values.length / 2)], p95Ms: values[Math.ceil(values.length * .95) - 1] } : null]; }));
        return { module, count, ...summary, retainedList, retainedRow, scrollTop, listEquivalent, listDifference, detailEquivalent, draftPreserved, saved, lockRefreshed, renderedRows: root.querySelectorAll(rowSelector).length, requests: __requests.length, requestBodies: __requests };
      }, { module, count, verifyOnly: process.argv.includes('--verify-only') });
      result.requestSha256 = createHash('sha256').update(JSON.stringify(result.requestBodies)).digest('hex'); delete result.requestBodies;
      results.push(result); console.error(module + ' ' + count + ': selection p95=' + result.select.p95Ms.toFixed(1) + ' ms; output=' + (result.listEquivalent && result.detailEquivalent)); await page.close();
    }
    console.log(JSON.stringify({ chromium: browser.version(), results }, null, 2));
    for (const r of results) {
      assert.equal(r.lockRefreshed, true, r.module + ' lock/language invalidation'); assert.equal(r.listEquivalent, true, r.module + ' list output'); assert.equal(r.detailEquivalent, true, r.module + ' detail output'); assert.equal(r.saved, true, r.module + ' save');
      if (process.argv.includes('--assert-optimized')) {
        assert.equal(r.retainedList, true, r.module + ' list identity'); assert.equal(r.retainedRow, true, r.module + ' row identity');
        assert.equal(r.scrollTop, 120, r.module + ' scroll'); assert.equal(r.draftPreserved, true, r.module + ' draft focus/caret');
      }
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
