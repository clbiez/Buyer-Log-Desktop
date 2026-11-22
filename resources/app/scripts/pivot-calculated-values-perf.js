'use strict';
// L2 performans ölçümü (CLAUDE.md §3.2): Genel Bakış pivot widget'larının sıcak
// yolu (sıralama tıklamasıyla eşzamanlı pivot yeniden çizimi) büyük sentetik
// veriyle ölçülür. Betik çalıştığı uygulama kopyasını (Main ya da aday) başlatır;
// kaynak yanıtları anonim sentetik satırlarla taklit edilir.
//   node scripts/pivot-calculated-values-perf.js [--calc] [--repeat 9]
// --calc: aday davranışında iki hesaplanan değer tanımlıyken (bilgi amaçlı).
const assert = require('node:assert/strict');
const { start } = require('./lib/client-performance-app');

const arg = (name, fallback) => { const index = process.argv.indexOf(name); return index >= 0 ? Number(process.argv[index + 1]) : fallback; };
const REPEAT = arg('--repeat', 9);
const WITH_CALC = process.argv.includes('--calc');

function cubeRows(count) {
  const rows = [];
  for (let i = 0; i < count; i++) {
    rows.push({
      season: i % 2 ? 'W6' : 'S6', mag: `DM${i % 40}`, buyerGroup: `DEMO GRUP ${i % 6}`, classGroup: `DEMO GRUP ${i % 12}`, classification: `DEMO KLASMAN ${i % 60}`,
      modelCode: `DM${100000 + i}`, modelName: `DEMO MODEL ${i}`, colourCode: `C${i % 9}`, colourName: `DEMO RENK ${i % 9}`,
      wssi: i % 3 ? 600 + (i % 97) * 4 : 0, approved: 500 + (i % 89) * 3, plan: 700 + (i % 83) * 5, unapproved: i % 4 ? 80 + (i % 7) : 0, poQty: 450 + (i % 71) * 3,
      buyingPeriodQty: 300, reserveApproved: 0, fastApproved: 0, warehouseIn: 200, eligibleBuy: null, plannedStores: 120, landedPrice: 4.1, markupYd: 2.4, markupYi: 2.1,
      approvedNotOrdered: i % 3 ? 0 : 500 + (i % 89) * 3, classAnalysisQty: 0,
    });
  }
  return rows;
}
function postRows(count) {
  const rows = [];
  for (let i = 0; i < count; i++) {
    const fob = 3 + (i % 50) / 10;
    rows.push({ order: `DEMO-${i}`, model: `DM${i % 3000}`, colour: `C${i % 7}`, season: 'S6', mag: `DM${i % 30}`, buyerGroup: 'DEMO GRUP', classification: `DEMO ${i % 40}`, originCountry: `DEMO ÜLKE ${i % 8}`, salesCountry: 'DEMO',
      qty: 100 + (i % 900), fob, landedActual: fob * 1.1, landedForecast: fob * 1.08, integralFirst: fob * 1.2, integralLast: fob * 1.25, financeCost: null, advanceCost: null, customsRate: 0.1, freightRate: 0.05, extraRate: 0.02, tpMultiplier: null });
  }
  return rows;
}

(async () => {
  const app = await start({});
  try {
    const { page } = app;
    const put = async (url, body) => { for (let attempt = 0; ; attempt++) { try { return await app.api(url, body, 'PUT'); } catch (error) { if (attempt >= 8) throw error; await new Promise(resolve => setTimeout(resolve, 500)); } } };
    const cube = cubeRows(20000), post = postRows(10000);
    await page.route('**/api/oab-cube/report', route => { const body = JSON.parse(route.request().postData() || '{}'); route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, view: body.view, rows: cube, fetchedAt: new Date().toISOString(), filterValues: body.view.filterValues, missing: [], truncated: false, rowLimit: 20000, fromCache: false }) }); });
    await page.route('**/api/postfob/report', route => { const body = JSON.parse(route.request().postData() || '{}'); route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, view: body.view, rows: post, fetchedAt: new Date().toISOString(), filterValues: body.view.filterValues, missing: [], truncated: false, rowLimit: 10000 }) }); });
    const calcCube = WITH_CALC ? [{ id: 'pcv_a', label: 'A', formula: '[approved] / [wssi] * 100', mode: 'aggregate', format: 'percent' }, { id: 'pcv_b', label: 'B', formula: 'IF([wssi] = 0, [approved], 0)', mode: 'row' }] : [];
    const calcPost = WITH_CALC ? [{ id: 'pcv_a', label: 'A', formula: '[landedActual] - [fob]', mode: 'aggregate' }, { id: 'pcv_b', label: 'B', formula: '[qty] * [fob]', mode: 'row' }] : [];
    const cubeState = await app.api('/api/oab-cube/state').then(response => response.json());
    await put('/api/oab-cube/view', { view: { ...cubeState.view, rows: [{ key: 'classGroup' }, { key: 'classification' }], filterValues: { season: ['S6', 'W6'] }, calculated: calcCube } });
    const postState = await app.api('/api/postfob/state').then(response => response.json());
    await put('/api/postfob/view', { view: { ...postState.view, rows: [{ key: 'originCountry' }, { key: 'mag' }], filterValues: { season: ['S6'] }, calculated: calcPost } });
    // INTAKE: varsayılan görünüm, 10.000 sorgu satırı (snapshot).
    const intake = require('../server/lib/intake-report');
    const intakeView = intake.defaultViewConfig();
    if (WITH_CALC) intakeView.display.calculated = [{ id: 'pcv_a', label: 'A', formula: `[${intakeView.query.measures[1].id}] / [${intakeView.query.measures[0].id}]`, mode: 'aggregate' }];
    const intakeRows = Array.from({ length: 10000 }, (_, i) => Object.fromEntries([
      ...intakeView.query.rows.map((field, level) => [field.id, `DEMO ${level}-${i % (level ? 40 : 12)}`]),
      ...intakeView.query.measures.map((field, m) => [field.id, 100 + ((i * (m + 3)) % 977)]),
    ]));
    const intakeState = JSON.stringify({ ok: true, fields: intake.defaultFields(), viewConfig: intakeView, snapshot: { rows: intakeRows, fetchedAt: '2026-11-22T08:00:00Z' }, offline: false });
    await page.route('**/api/intake/state', route => route.fulfill({ contentType: 'application/json', body: intakeState }));
    await page.route('**/api/intake/report', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, fields: intake.defaultFields(), viewConfig: intakeView, rows: intakeRows, fetchedAt: '2026-11-22T08:00:00Z', fromCache: true }) }));
    await page.route('**/api/intake/metadata', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, fields: intake.defaultFields(), viewConfig: intakeView, connection: { server: 'demo', catalog: 'demo' }, offline: false }) }));
    await page.route('**/api/intake/settings', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, viewConfig: JSON.parse(route.request().postData() || '{}').viewConfig || intakeView }) }));
    await page.waitForFunction(() => window.BLOverviewHome && document.getElementById('oabCubeSection'), null, { timeout: 60000 });
    await page.evaluate(() => window.BLOverviewHome.goToPage(1));
    if (WITH_CALC) await page.evaluate(() => window.BLPivotCalculatedValues && window.BLPivotCalculatedValues.ensureEngine(false));

    async function measure(sectionId, ready, refreshId, tableId, sortAttr, headerSelector) {
      await page.evaluate(id => document.getElementById(id).scrollIntoView({ block: 'start' }), sectionId);
      await page.waitForFunction(ready, null, { timeout: 60000 });
      if (refreshId) await page.click(`#${refreshId}`);
      await page.waitForFunction(id => document.querySelectorAll(`#${id} tbody tr`).length > 50, tableId, { timeout: 60000 });
      const samples = [];
      for (let i = 0; i < REPEAT + 2; i++) {
        const ms = await page.evaluate(([id, attr, selector]) => {
          const header = selector ? document.querySelector(selector) : [...document.querySelectorAll(`#${id} thead th[${attr}]`)].find(th => th.classList.contains('num'));
          const t0 = performance.now(); header.click(); return performance.now() - t0;
        }, [tableId, sortAttr, headerSelector || '']);
        if (i >= 2) samples.push(Math.round(ms * 10) / 10); // ilk iki ısınma
        await page.waitForTimeout(150);
      }
      samples.sort((a, b) => a - b);
      return { median: samples[Math.floor(samples.length / 2)], samples };
    }
    const out = {
      oabCube: await measure('oabCubeSection', () => window.BLOabCube && window.BLOabCube.state.started && window.BLOabCube.state.catalog.dimensions.length > 0, 'oabCubeRefreshBtn', 'oabCubeTable', 'data-oab-cube-sort'),
      postFob: await measure('postFobSection', () => window.BLPostFob && window.BLPostFob.state.started && window.BLPostFob.state.catalog.dimensions.length > 0, 'postFobRefreshBtn', 'postFobTable', 'data-postfob-sort'),
      intake: await measure('intakeSection', () => window.BLINTAKE && window.BLINTAKE.state.loaded, '', 'intakeTable', 'data-intake-sort', `#intakeTable thead th[data-intake-sort="${intakeView.query.measures[0].id}"]`),
    };
    out.calcColumns = await page.$$eval('th.pcvHead', list => list.length);
    if (WITH_CALC) assert.ok(out.calcColumns >= 4);
    assert.deepEqual(app.errors, []);
    console.log(JSON.stringify(out));
  } finally { await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
