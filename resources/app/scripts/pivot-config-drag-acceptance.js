'use strict';
// Gerçek Buyer Log (izole sunucu, anonim demo veri) üzerinde:
//  1) OAB (PASS), INTAKE, FOB Sonrası, TR/YD ve OAB (Küp) kalem pencerelerinde
//     "⋮⋮" tutamağıyla GERÇEK mouse sürüklemesi (down/move/up) satır sırasını değiştirir;
//     yukarı/aşağı düğmeleri çalışmaya devam eder.
//  2) OAB (Küp): sürüklenen sıra Kaydet sonrası tabloda ve Excel'de geçerlidir.
//  3) OAB (Küp) Plan başlangıç ayı: 1–12 ay adı (TR/EN), ay sırası, filtre ham
//     değer, Excel ay adı + sıra; 1–12 dışı değer aynen.
// Şirket içi küp/PASS/SSAS bu ortamdan erişilemez: YALNIZ kaynak veri uçları
// (oab, intake, oab-cube report/distinct/metadata, postfob) demo yanıtla taklit
// edilir; görünüm kaydı, pivot motoru ve bütün çizim gerçektir.
// Kullanım: CHROMIUM_PATH=<chrome> node scripts/pivot-config-drag-acceptance.js [--screenshot <png>]
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { start } = require('./lib/client-performance-app');
const intake = require('../server/lib/intake-report');
const cubeReport = require('../server/lib/oab-cube-report');

function cubeRows() {
  const months = ['10', '2', '1', '12', '13', ''];
  const rows = [];
  months.forEach((planStartMonth, m) => ['DEMO KAZAK', 'DEMO HIRKA'].forEach((classification, c) => rows.push({
    season: 'S6', mag: 'DM1A', buyerGroup: 'DEMO GRUP', classGroup: 'DEMO TRİKO', classification, planStartMonth,
    modelCode: `DM${500 + m * 2 + c}`, modelName: `DEMO MODEL ${m}${c}`, colourCode: `C${c + 1}`, colourName: `DEMO RENK ${c + 1}`,
    wssi: 100 * (m + 1) + c, approved: 90 * (m + 1), plan: 120 * (m + 1), unapproved: 0, buyingPeriodQty: 0, reserveApproved: 0, fastApproved: 0,
    poQty: 80 * (m + 1), warehouseIn: 0, eligibleBuy: null, plannedStores: 100, landedPrice: 4.2, markupYd: 2.4, markupYi: 2.1,
  })));
  return cubeReport.normalizeRows(rows, {
    dimensions: Object.keys(rows[0]).filter(key => !cubeReport.MEASURES.some(item => item.key === key)),
    measures: cubeReport.MEASURES.map(item => item.key),
    derived: cubeReport.DERIVED_MEASURES.map(item => item.key),
  });
}

(async () => {
  const shotIndex = process.argv.indexOf('--screenshot');
  const shot = shotIndex > 0 ? path.resolve(process.argv[shotIndex + 1]) : '';
  const viewConfig = intake.defaultViewConfig(), fields = intake.defaultFields();
  const intakeRows = [0, 1].map(i => Object.fromEntries([...viewConfig.query.rows.map(f => [f.id, 'DEMO']), ...viewConfig.query.measures.map((f, m) => [f.id, (i + 1) * (m + 1)])]));
  const intakeFixture = { ok: true, fields, viewConfig, rows: intakeRows, fetchedAt: '2026-11-04T08:00:00Z', offline: false };
  const oabPivot = { rows: ['Season', 'Class'], columns: [], values: [{ field: 'Amount', agg: 'SUM' }], grouped: true, showSubtotals: true };
  const oabRows = ['A', 'B'].map((name, i) => ({ Season: 'S7', Class: `DEMO ${name}`, Amount: i + 1 }));
  const rows = cubeRows();
  // Ortak sürükle-bırak modülü bilerek geciktirilir: pencere modülden ÖNCE açılır (Codex bulgusu, PR #1177).
  let releaseReorder;
  const reorderGate = new Promise(resolve => { releaseReorder = resolve; });
  const app = await start({ deviceScaleFactor: shot ? 2 : 1, beforeNavigate: async page => {
    await page.route('**/pivot-config-reorder.js*', async route => { await reorderGate; await route.continue(); });
    await page.route('**/api/oab/**', async route => {
      const ep = new URL(route.request().url()).pathname.split('/').pop();
      const payload = { seasons: { seasons: [{ SeasonRef: 1, Name: 'S7' }] }, mag: { mag: [] }, 'buyer-groups': { buyerGroups: [] }, settings: { settings: { pivotConfig: oabPivot } }, state: { state: { selection: {}, snapshot: { rows: oabRows, fields: ['Season', 'Class', 'Amount'] } } } }[ep] || {};
      await route.fulfill({ json: { ok: true, ...payload } });
    });
    await page.route('**/api/intake/**', async route => { const u = new URL(route.request().url()); await route.fulfill({ json: u.pathname.endsWith('/state') ? { ...intakeFixture, snapshot: intakeFixture } : intakeFixture }); });
    await page.route('**/api/postfob/metadata', r => r.fulfill({ json: { ok: true, dimensions: [], measures: [] } }));
    await page.route('**/api/oab-cube/metadata', r => r.fulfill({ json: { ok: true, dimensions: [], measures: [] } }));
    await page.route('**/api/oab-cube/distinct', route => {
      const body = JSON.parse(route.request().postData() || '{}');
      const values = { season: ['S6'], planStartMonth: ['1', '10', '12', '13', '2'] }[body.key] || [];
      route.fulfill({ json: { ok: true, key: body.key, values, truncated: false, limit: 1000 } });
    });
    await page.route('**/api/oab-cube/report', route => {
      const body = JSON.parse(route.request().postData() || '{}');
      route.fulfill({ json: { ok: true, view: body.view, rows, fetchedAt: new Date().toISOString(), filterValues: body.view.filterValues, missing: [], truncated: false, rowLimit: 20000, dataDate: '2026-11-22T05:30:00', dataDateSource: 'GuncellemeTarih', fromCache: false } });
    });
  } });
  const { page } = app, results = [];
  const XLSX = require('xlsx');
  try {
    await page.waitForFunction(() => window.BLOverviewHome, null, { timeout: 60000 });
    const show = async (key, section, ready) => {
      await page.evaluate(key => { const s = BLOverviewHome.state(); BLOverviewHome.goToPage(s.pages.findIndex(p => p.items.some(it => it.key === key))); }, key);
      await page.evaluate(id => document.getElementById(id).scrollIntoView({ block: 'start' }), section);
      await page.waitForFunction(ready, null, { timeout: 30000 });
    };
    const listOrder = id => page.$$eval(`#${id} .oabConfigRow`, list => list.map(row => row.querySelector('select').value));
    /* Gerçek HTML5 sürükleme: tutamakta mouse down, adım adım hedef satırın alt yarısına, mouse up. */
    async function dragFirstBelowSecond(id, shotPath = '') {
      const handle = await page.locator(`#${id} .oabConfigRow`).nth(0).locator('.oabConfigDrag').boundingBox();
      const target = await page.locator(`#${id} .oabConfigRow`).nth(1).boundingBox();
      const x = handle.x + handle.width / 2, y = handle.y + handle.height / 2;
      await page.mouse.move(x, y);
      await page.mouse.down();
      for (let step = 1; step <= 12; step++) await page.mouse.move(x, y + (target.y + target.height * 0.85 - y) * step / 12);
      // İsteğe bağlı: sürükleme sürerken (satır yeni yerinde, .isDragging) pencere görüntüsü.
      if (shotPath) {
        const dialog = await page.$eval('#_oabCubeFieldsModal [role="dialog"]', el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: Math.min(r.height, 560) }; });
        await page.screenshot({ path: shotPath, clip: dialog });
      }
      await page.mouse.up();
      await page.waitForTimeout(150);
    }
    async function assertDrag(name, id) {
      if ((await page.locator(`#${id} .oabConfigRow`).count()) < 2) await page.locator(`#${id}`).locator('xpath=..').locator('.oabSettingsSectionHead button').click();
      const before = await listOrder(id);
      await dragFirstBelowSecond(id);
      const after = await listOrder(id);
      assert.deepEqual(after.slice(0, 2), [before[1], before[0]], `${name}: sürükle-bırak sırayı değiştirmeli ${JSON.stringify({ before, after })}`);
      assert.deepEqual(after.slice(2), before.slice(2), `${name}: diğer satırlar yerinde`);
      // Sürüklenen satır geçici draggable/isDragging durumunu bırakır; yukarı/aşağı düğmeleri yeni sıraya göre.
      const state = await page.$$eval(`#${id} .oabConfigRow`, list => list.map(row => ({ dragging: row.classList.contains('isDragging'), up: row.querySelector('[data-oab-config-move="-1"],[data-intake-config-move="-1"],[data-postfob-config-move="-1"],[data-tryd-config-move="-1"],[data-oab-cube-config-move="-1"]')?.disabled })));
      assert.ok(state.every(item => !item.dragging), `${name}: isDragging temizlenir`);
      assert.equal(state[0].up, true, `${name}: ilk satırın Yukarı düğmesi pasif`);
      assert.equal(state[1].up, false, `${name}: ikinci satırın Yukarı düğmesi aktif`);
      // Klavye/erişilebilir yol: Yukarı düğmesi sırayı geri alır.
      await page.locator(`#${id} .oabConfigRow`).nth(1).locator('.oabConfigActions button').first().click();
      assert.deepEqual((await listOrder(id)).slice(0, 2), before.slice(0, 2), `${name}: Yukarı düğmesi çalışır`);
      results.push(`${name}: gerçek mouse sürükleme + Yukarı düğmesi`);
    }
    const closeModal = () => page.evaluate(() => document.querySelectorAll('.autoModalOverlay').forEach(modal => modal.remove()));

    for (const w of [
      { name: 'OAB (PASS)', key: 'oab', section: 'oabSection', ready: () => window.BLOAB, btn: '#oabSettingsBtn', list: 'oabPivotRowsList' },
      { name: 'INTAKE', key: 'intake', section: 'intakeSection', ready: () => window.BLINTAKE, btn: '#intakeFieldsBtn', list: 'intakePivotRowsList' },
      { name: 'FOB Sonrası', key: 'postFob', section: 'postFobSection', ready: () => window.BLPostFob, btn: '#postFobFieldsBtn', list: 'postFobValuesList' },
      { name: 'TR/YD', key: 'trydAdvantage', section: 'trydAdvantageSection', ready: () => window.BLTrydAdvantage, btn: '#trydAdvantageFieldsBtn', list: 'trydRowsList' },
    ]) {
      await show(w.key, w.section, w.ready);
      await page.waitForTimeout(800);
      await page.click(w.btn);
      await page.waitForSelector(`#${w.list}`, { timeout: 10000 });
      if (w.key === 'oab') {
        // Pencere açıkken modül henüz yok; yukarı/aşağı düğmesi yine çalışır.
        assert.equal(await page.evaluate(() => Boolean(window.BLPivotConfigReorder && window.BLPivotConfigReorder.loaded)), false, 'modül gecikmeli');
        const before = await listOrder(w.list);
        await page.locator(`#${w.list} .oabConfigRow`).nth(1).locator('.oabConfigActions button').first().click();
        assert.deepEqual((await listOrder(w.list)).slice(0, 2), [before[1], before[0]], 'modülsüz Yukarı düğmesi');
        await page.locator(`#${w.list} .oabConfigRow`).nth(1).locator('.oabConfigActions button').first().click();
        releaseReorder();
        await page.waitForFunction(() => window.BLPivotConfigReorder && window.BLPivotConfigReorder.loaded, null, { timeout: 30000 });
        results.push('OAB (PASS): modül pencereden sonra yüklenince açık pencere bağlanır');
      }
      await assertDrag(w.name, w.list);
      await closeModal();
    }

    /* ---------- OAB (Küp) ---------- */
    await show('oabCube', 'oabCubeSection', () => window.BLOabCube && window.BLOabCube.state.started && window.BLOabCube.state.catalog.dimensions.length > 0);
    await page.click('#oabCubeFiltersBtn');
    await page.click('[data-oab-cube-filter="season"]');
    await page.check('.intakeFilterPopover input[value="S6"]');
    await page.click('[data-oab-cube-apply]');
    await page.keyboard.press('Escape');
    await page.click('#oabCubeRefreshBtn');
    await page.waitForFunction(() => document.querySelectorAll('#oabCubeTable tr.oabPivotSubtotalRow').length >= 1, null, { timeout: 20000 });
    // Pivot satırı: Plan başlangıç ayı › Ürün klasmanı; filtreye Plan başlangıç ayı.
    await page.click('#oabCubeFieldsBtn');
    await page.waitForSelector('#oabCubeRowsList .oabConfigRow');
    await page.locator('#oabCubeRowsList select.oabCubeAxisField').nth(0).selectOption('planStartMonth');
    await page.locator('#oabCubeRowsList select.oabCubeAxisField').nth(1).selectOption('classification');
    await page.click('[data-oab-cube-add="oabCubeFiltersList"]');
    await page.locator('#oabCubeFiltersList select.oabCubeAxisField').last().selectOption('planStartMonth');
    await page.click('[data-oab-cube-save]');
    const groupLabels = () => page.$$eval('#oabCubeTable tr.oabPivotSubtotalRow strong', list => list.map(node => node.textContent));
    await page.waitForFunction(() => document.querySelectorAll('#oabCubeTable tr.oabPivotSubtotalRow').length === 6, null, { timeout: 20000 });
    const tr = await groupLabels();
    assert.deepEqual(tr, ['(boş)', 'Ocak', 'Şubat', 'Ekim', 'Aralık', '13'], `TR ay adı + ay sırası: ${tr}`);
    results.push('Küp: Plan başlangıç ayı TR ay adı, 1→12 sırası, 13 ve boş aynen');
    if (shot) {
      const box = await page.$eval('#oabCubeSection', el => { el.scrollIntoView({ block: 'start' }); const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: Math.min(r.height, 620) }; });
      await page.waitForTimeout(300);
      await page.screenshot({ path: shot, clip: { x: box.x, y: box.y, width: box.w, height: box.h } });
      results.push(`Ekran görüntüsü: ${shot}`);
    }
    await page.evaluate(() => applyLanguage('en'));
    await page.waitForFunction(() => /January/.test(document.getElementById('oabCubeTable').textContent), null, { timeout: 10000 });
    assert.deepEqual(await groupLabels(), ['(blank)', 'January', 'February', 'October', 'December', '13']);
    await page.evaluate(() => applyLanguage('tr'));
    await page.waitForFunction(() => /Ocak/.test(document.getElementById('oabCubeTable').textContent), null, { timeout: 10000 });
    results.push('Küp: dil değişince EN ay adlarıyla yeniden çizilir');
    // Filtre: etiket ay adı ve ay sırası, checkbox değeri ham 1–12.
    await page.click('#oabCubeFiltersBtn');
    await page.click('[data-oab-cube-filter="planStartMonth"]');
    await page.waitForSelector('.intakeFilterPopover input[value="12"]');
    const options = await page.$$eval('.intakeFilterPopover .intakeFilterOption', list => list.map(node => [node.querySelector('input').value, node.textContent]));
    assert.deepEqual(options, [['1', 'Ocak'], ['2', 'Şubat'], ['10', 'Ekim'], ['12', 'Aralık'], ['13', '13']], JSON.stringify(options));
    await page.fill('.intakeFilterPopover .intakeFilterSearch', 'ara');
    assert.deepEqual(await page.$$eval('.intakeFilterPopover .intakeFilterOption input', list => list.map(node => node.value)), ['12'], 'ay adıyla aranır');
    await page.fill('.intakeFilterPopover .intakeFilterSearch', '');
    await page.check('.intakeFilterPopover input[value="1"]');
    await page.check('.intakeFilterPopover input[value="12"]');
    await page.click('[data-oab-cube-apply]');
    assert.deepEqual(await page.evaluate(() => window.BLOabCube.state.view.filterValues.planStartMonth), ['1', '12'], 'filtre ham değeri saklar');
    await page.waitForTimeout(400);
    const saved = await app.api('/api/oab-cube/state').then(response => response.json());
    assert.deepEqual(saved.view.filterValues.planStartMonth, ['1', '12'], 'kayıtlı görünüm ham değer');
    await page.click('[data-oab-cube-filter="planStartMonth"]');
    await page.click('[data-oab-cube-clear]');
    await page.check('.intakeFilterPopover input[value="1"]');
    await page.click('[data-oab-cube-apply]');
    assert.match(await page.textContent('#oabCubeFilterBar'), /Ocak/, 'filtre çubuğunda ay adı');
    await page.keyboard.press('Escape');
    await page.click('#oabCubeRefreshBtn');
    await page.waitForFunction(() => !window.BLOabCube.state.loading, null, { timeout: 20000 });
    results.push('Küp: filtre seçicisi ay adı + ay sırası gösterir, ham 1–12 saklar/sorgular');
    // Excel: ay adı + ay sırası (pivot ve kaynak satırlar).
    const readBook = async () => { const [download] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), page.click('#oabCubeExcelExportBtn')]); return XLSX.read(fs.readFileSync(await download.path())); };
    let book = await readBook();
    let pivot = XLSX.utils.sheet_to_json(book.Sheets.Pivot);
    const months = [...new Set(pivot.filter(row => row['Satır tipi'] !== 'Genel toplam').map(row => row['Plan başlangıç ayı']).filter(Boolean))];
    assert.deepEqual(months, ['Ocak', 'Şubat', 'Ekim', 'Aralık', '13'], `Excel pivot ay adı + sıra: ${months}`);
    const source = XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[1]]);
    assert.ok(source.some(row => row['Plan başlangıç ayı'] === 'Ekim') && source.some(row => row['Plan başlangıç ayı'] === '13'), 'Excel kaynak satır ay adı');
    results.push('Küp: Excel pivot + kaynak satırlarda ay adı, ay sırası');
    // Alt detay: ay adı.
    await page.locator('#oabCubeTable tr.oabPivotSubtotalRow', { hasText: 'Ocak' }).locator('td.num').first().dblclick();
    await page.waitForSelector('#blSharedDetailDrawer.is-open', { timeout: 10000 });
    assert.match(await page.textContent('#blSharedDetailDrawer'), /Plan başlangıç ayı: Ocak/);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('#blSharedDetailDrawer.is-open'), null, { timeout: 10000 });
    results.push('Küp: alt detay bağlamı ay adı');
    // Sürükle-bırak → Kaydet → tablo ve Excel yeni sırada.
    await page.click('#oabCubeFieldsBtn');
    await page.waitForSelector('#oabCubeRowsList .oabConfigRow');
    await assertDrag('OAB (Küp)', 'oabCubeRowsList');
    await dragFirstBelowSecond('oabCubeRowsList', shot ? shot.replace(/\.png$/, '-drag.png') : '');
    assert.deepEqual(await listOrder('oabCubeRowsList'), ['classification', 'planStartMonth']);
    await page.click('[data-oab-cube-save]');
    await page.waitForFunction(() => /^Ürün klasmanı/.test(document.querySelector('#oabCubeTable thead th')?.textContent || ''), null, { timeout: 20000 });
    assert.deepEqual((await page.evaluate(() => window.BLOabCube.state.view.rows)).map(ref => ref.key), ['classification', 'planStartMonth']);
    book = await readBook();
    const header = XLSX.utils.sheet_to_json(book.Sheets.Pivot, { header: 1 })[0];
    assert.ok(header.indexOf('Ürün klasmanı') < header.indexOf('Plan başlangıç ayı'), `Excel sütun sırası: ${header}`);
    results.push('Küp: sürüklenen sıra Kaydet sonrası tabloda ve Excel’de');
    assert.deepEqual(app.errors, [], `sayfa hatası yok: ${app.errors}`);
    console.log(results.map(line => `PASS ${line}`).join('\n'));
  } finally { await app.close(); }
})().catch(error => { console.error(error); process.exit(1); });
