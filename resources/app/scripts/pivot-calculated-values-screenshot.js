'use strict';
// Gerçek Buyer Log (anonim demo veri) Genel Bakış › Ticari pivot widget'larında
// "ƒx Hesaplanan değer ekle" akışını uçtan uca sürer ve sürüm notu görselini
// üretir. Şirket içi SSAS kaynaklarına bu ortamdan erişilemediği için YALNIZ
// kaynak yanıtı veren uçlar anonim sentetik satırlarla taklit edilir; görünüm
// kaydı (sunucu normalizeView), formül editörü, pivot toplamları ve bütün çizim
// gerçektir. Canlı küp doğrulaması değildir.
//
//   node scripts/pivot-calculated-values-screenshot.js [--en] [--dark] [--no-shot]
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { start } = require('./lib/client-performance-app');
const cubeReport = require('../server/lib/oab-cube-report');

function cubeRows() {
  const classes = [['DEMO TRİKO', ['DEMO KAZAK', 'DEMO HIRKA']], ['DEMO DOKUMA', ['DEMO GÖMLEK', 'DEMO PANTOLON']]];
  const rows = [];
  let seq = 0;
  for (const [classGroup, list] of classes) {
    for (const classification of list) {
      for (let i = 0; i < 4; i++) {
        seq += 1;
        rows.push({
          season: i % 2 ? 'W6' : 'S6', mag: 'DM1A', buyerGroup: 'DEMO GRUP', classGroup, classification,
          modelCode: `DM${400 + seq}`, modelName: `DEMO MODEL ${seq}`, colourCode: `C${(i % 3) + 1}`, colourName: `DEMO RENK ${(i % 3) + 1}`,
          // Her üçüncü option'da WSSI yok: satır bazlı koşullu adet ile toplam oranı farklı sonuç verir.
          wssi: seq % 3 ? 600 + seq * 40 : 0, approved: 500 + seq * 35, plan: 700 + seq * 50, unapproved: seq % 4 ? 80 + seq * 5 : 0, buyingPeriodQty: 300 + seq * 10,
          reserveApproved: 0, fastApproved: 0, poQty: 450 + seq * 30, warehouseIn: 200 + seq * 20, eligibleBuy: null,
          plannedStores: 120, landedPrice: 4.1, markupYd: 2.4, markupYi: 2.1,
        });
      }
    }
  }
  return cubeReport.normalizeRows(rows, {
    dimensions: Object.keys(rows[0]).filter(key => !cubeReport.MEASURES.some(item => item.key === key)),
    measures: cubeReport.MEASURES.map(item => item.key),
    derived: cubeReport.DERIVED_MEASURES.map(item => item.key),
  });
}

const number = text => Number(String(text).replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.'));
const numberEn = text => Number(String(text).replace(/[^\d.-]/g, ''));

(async () => {
  const theme = process.argv.includes('--dark') ? 'dark' : 'light';
  const lang = process.argv.includes('--en') ? 'en' : 'tr';
  const parse = lang === 'en' ? numberEn : number;
  const L = (tr, en) => (lang === 'en' ? en : tr);
  // OAB PASS hesaplanan değerleri kişiseldir (kullanıcı kapsamlı yerel depo).
  const passCalc = [
    { id: 'pcv_pass_ratio', label: L('Onaylı / WSSI', 'Approved / WSSI'), formula: '[Toplam Onaylı Sipariş Miktarı::SUM] / [Toplam WSSI Sipariş Miktarı::SUM]', mode: 'aggregate', format: 'number', decimals: '3', refs: {} }, // i18n-ignore: OAB kaynak alan adları
    { id: 'pcv_pass_row', label: L('WSSI yokken onaylı', 'Approved without WSSI'), formula: 'IF([WSSI Sipariş Miktarı] = 0, [Onaylı Sipariş Miktarı], 0)', mode: 'row', format: 'integer', refs: {} }, // i18n-ignore: OAB kaynak alan adları
  ];
  const app = await start({ initScript: ([t, l, calc]) => { try { localStorage.setItem('bl.user.moderator.lcw_theme', t); localStorage.setItem('bl.user.moderator.lcw.lang.v1', l); localStorage.setItem('bl.user.moderator.lcw.oab.pivotCalculated.v1', calc); } catch (_) {} }, initArg: [theme, lang, JSON.stringify(passCalc)] });
  const results = {};
  // Açılışta paylaşılan yazma kilidi kısa süre meşgul olabilir (SHARED_WRITE_BUSY): yeniden dene.
  const put = async (url, body) => {
    for (let attempt = 0; ; attempt++) {
      try { return await app.api(url, body, 'PUT'); } catch (error) { if (attempt >= 8) throw error; await new Promise(resolve => setTimeout(resolve, 500)); }
    }
  };
  try {
    const { page } = app;
    page.on('dialog', dialog => dialog.accept());
    const rows = cubeRows();
    const reports = [];
    await page.route('**/api/oab-cube/distinct', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, key: 'season', values: ['S6', 'W6'], truncated: false, limit: 1000 }) }));
    await page.route('**/api/oab-cube/metadata', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, dimensions: [], measures: [] }) }));
    await page.route('**/api/oab-cube/report', route => {
      const body = JSON.parse(route.request().postData() || '{}');
      reports.push(body);
      route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, view: body.view, rows, fetchedAt: new Date().toISOString(), filterValues: body.view.filterValues, measures: [...cubeReport.MEASURES.map(item => item.key), ...cubeReport.DERIVED_MEASURES.map(item => item.key)], missing: [], truncated: false, rowLimit: 20000, dataDate: '2026-11-22T05:30:00', fromCache: false }) });
    });
    /* ---- OAB PASS: PASS uçları taklit, pivot motoru ve çizim gerçek ---- */
    const passRows = [];
    [['DEMO TRİKO', 'DEMO KAZAK'], ['DEMO TRİKO', 'DEMO HIRKA'], ['DEMO DOKUMA', 'DEMO GÖMLEK']].forEach(([group, klass], g) => { // i18n-ignore: demo veri
      for (let i = 0; i < 3; i++) passRows.push({ 'Klasman Grup Tanımı': group, 'Klasman Tanımı': klass, 'Plan Başlangıç Ayı': 'Ocak', 'Option Adı': `DEMO OPT ${g}${i}`, 'Renk Kodu': `C${i}`, 'WSSI Sipariş Miktarı': i === 1 ? 0 : 500 + g * 100 + i * 10, 'Onaylı Sipariş Miktarı': 300 + g * 50 + i * 20 }); // i18n-ignore: OAB kaynak alan adları
    });
    const json = body => route => route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
    await page.route('**/api/oab/seasons', json({ ok: true, seasons: [{ Name: 'S6', SeasonRef: 'S6' }] }));
    await page.route('**/api/oab/mag', json({ ok: true, mag: [{ Name: 'DM1A', MerchSubGroupRef: 'M1' }] }));
    await page.route('**/api/oab/buyer-groups', json({ ok: true, buyerGroups: [{ Name: 'DEMO GRUP', BuyerGroupRef: 'B1' }] }));
    await page.route('**/api/oab/batch-status*', json({ ok: true, job: null }));
    await page.route('**/api/oab/state', json({ ok: true, state: { selection: { seasonRefs: ['S6'], merchSubGroupRefs: ['M1'], buyerGroupRefs: ['B1'] }, snapshot: { rows: passRows, fields: Object.keys(passRows[0]), fetchedAt: '2026-11-22T08:00:00Z' } } }));

    /* ---- FOB Sonrası: aynı modül, sunucu görünümünden ---- */
    const postRows = [1, 2, 3, 4].map(i => ({ order: `DEMO-${i}`, model: `DM${i}`, colour: 'C1', season: 'S6', mag: 'DM1A', buyerGroup: 'DEMO GRUP', classification: 'DEMO', originCountry: i % 2 ? 'DEMO A' : 'DEMO B', salesCountry: 'DEMO', qty: 100 * i, fob: 2 + i, landedActual: 2.5 + i, landedForecast: 2.4 + i, integralFirst: null, integralLast: null, financeCost: null, advanceCost: null, customsRate: 0.1, freightRate: 0.05, extraRate: 0.02, tpMultiplier: null }));
    await page.route('**/api/postfob/report', route => { const body = JSON.parse(route.request().postData() || '{}'); route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, view: body.view, rows: postRows, fetchedAt: new Date().toISOString(), filterValues: body.view.filterValues, missing: [], truncated: false, rowLimit: 10000 }) }); });
    const postState = await app.api('/api/postfob/state').then(response => response.json());
    await put('/api/postfob/view', { view: { ...postState.view, filterValues: { season: ['S6'] }, calculated: [{ id: 'pcv_cost', label: L('Toplam FOB maliyeti', 'Total FOB cost'), formula: '[qty] * [fob]', mode: 'row', format: 'integer', refs: { qty: 'Adet', fob: 'FOB' } }] } });
    /* ---- INTAKE: yalnız toplamlar üzerinden ---- */
    const intake = require('../server/lib/intake-report');
    const viewConfig = intake.defaultViewConfig();
    const [m1, m2] = viewConfig.query.measures;
    const intakeRows = [0, 1, 2].map(index => Object.fromEntries([
      ...viewConfig.query.rows.map(field => [field.id, `DEMO ${index % 2}`]),
      ...viewConfig.query.measures.map((field, measure) => [field.id, (index + 1) * (measure + 1) * 100]),
    ]));
    const intakeView = intake.reconcileViewConfig({ ...viewConfig, display: { ...viewConfig.display, calculated: [{ id: 'pcv_share', label: L('Pay oranı', 'Share ratio'), formula: `[${m2.id}] / [${m1.id}]`, mode: 'aggregate', format: 'number', decimals: '2', refs: {} }] } }, []);
    await put('/api/intake/settings', { viewConfig: intakeView });
    const intakePayload = { ok: true, fields: intake.defaultFields(), viewConfig: intakeView, rows: intakeRows, fetchedAt: '2026-11-22T08:00:00Z', offline: false, fromCache: false };
    await page.route('**/api/intake/report', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify(intakePayload) }));
    await page.route('**/api/intake/metadata', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, fields: intake.defaultFields(), viewConfig: intakeView, connection: { server: 'demo', catalog: 'demo' }, offline: false }) }));
    await page.route('**/api/intake/state', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, fields: intake.defaultFields(), viewConfig: intakeView, snapshot: { rows: intakeRows, fetchedAt: '2026-11-22T08:00:00Z' }, offline: false }) }));
    await page.waitForFunction(() => window.BLOverviewHome && document.getElementById('oabCubeSection'), null, { timeout: 60000 });
    await page.evaluate(() => window.BLOverviewHome.goToPage(1));
    await page.waitForFunction(() => window.BLOabCube, null, { timeout: 60000 });
    await page.evaluate(() => document.getElementById('oabCubeSection').scrollIntoView({ block: 'start' }));
    await page.waitForFunction(() => window.BLOabCube.state.started && window.BLOabCube.state.catalog.dimensions.length > 0, null, { timeout: 60000 });
    assert.ok(await page.evaluate(() => Boolean(window.BLPivotCalculatedValues)), 'ortak modül widget ile yüklendi');
    // Hesaplanan değer tanımlı değilken formül motoru widget yüzünden yüklenmez (lazy sözleşme).
    await page.click('#oabCubeRefreshBtn');
    await page.waitForFunction(() => !document.getElementById('oabCubeFilterPanel').hidden, null, { timeout: 10000 });
    await page.click('[data-oab-cube-filter="season"]');
    await page.waitForSelector('.intakeFilterPopover input[value="S6"]', { timeout: 10000 });
    await page.check('.intakeFilterPopover input[value="S6"]');
    await page.check('.intakeFilterPopover input[value="W6"]');
    await page.click('[data-oab-cube-apply]');
    await page.keyboard.press('Escape');
    await page.click('#oabCubeRefreshBtn');
    await page.waitForFunction(() => document.querySelectorAll('#oabCubeTable tr.oabPivotSubtotalRow').length === 2, null, { timeout: 20000 });

    /* ---- 1) Toplamlar üzerinden: Onaylı / WSSI % ---- */
    const addCalc = async ({ mode, formula, label, format, decimals }) => {
      await page.click('#_oabCubeFieldsModal [data-pcv-add]');
      await page.waitForSelector('#_formulaColumnModal .pcvModes', { timeout: 15000 });
      if (mode === 'row') {
        await page.click('#_formulaColumnModal [data-pcv-mode="row"]');
        await page.waitForSelector('#_formulaColumnModal [data-pcv-mode="row"][aria-selected="true"]', { timeout: 10000 });
        // İnceleme için isteğe bağlı editör görüntüsü (sürüm notuna girmez).
        if (process.env.PCV_EDITOR_SHOT) await page.locator('#_formulaColumnModal .fcCard').screenshot({ path: process.env.PCV_EDITOR_SHOT });
      }
      // Pivotta yalnız sayısal tarifler açılır.
      const recipes = await page.$$eval('#_formulaColumnModal [data-fc-mode]', buttons => buttons.map(button => button.dataset.fcMode));
      assert.deepEqual(recipes, ['calc', 'percent', 'advanced']);
      await page.click('#_formulaColumnModal [data-fc-mode="advanced"]');
      await page.fill('#_formulaColumnModal [data-fc-formula]', formula);
      await page.fill(`#_formulaColumnModal ${lang === 'en' ? '[data-fc-label-en]' : '[data-fc-label]'}`, label);
      await page.click('#_formulaColumnModal .fcMore > summary');
      await page.selectOption('#_formulaColumnModal [data-fc-format]', format);
      if (decimals != null) await page.fill('#_formulaColumnModal [data-fc-decimals]', String(decimals));
      await page.waitForFunction(() => /isOk/.test(document.querySelector('#_formulaColumnModal [data-fc-preview]').className), null, { timeout: 10000 });
      await page.click('#_formulaColumnModal [data-fc-save]');
      await page.waitForFunction(() => !document.getElementById('_formulaColumnModal'), null, { timeout: 10000 });
    };
    await page.click('#oabCubeFieldsBtn');
    await page.waitForSelector('#_oabCubeFieldsModal [data-pcv-add]', { timeout: 10000 });
    const ratioLabel = L('Onaylı / WSSI %', 'Approved / WSSI %');
    const rowLabel = L('WSSI yokken onaylı', 'Approved without WSSI');
    await addCalc({ mode: 'aggregate', formula: L('[Onaylı sipariş] / [WSSI sipariş] * 100', '[Approved order] / [WSSI order] * 100'), label: ratioLabel, format: 'percent', decimals: 1 });
    /* ---- 2) Satır bazında, sonra topla: IF(WSSI = 0, Onaylı, 0) ---- */
    await addCalc({ mode: 'row', formula: L('IF([WSSI sipariş] = 0, [Onaylı sipariş], 0)', 'IF([WSSI order] = 0, [Approved order], 0)'), label: rowLabel, format: 'integer' });
    assert.equal(await page.$$eval('#_oabCubeFieldsModal [data-pcv-id]', list => list.length), 2);
    await Promise.all([
      page.waitForResponse(response => /\/api\/oab-cube\/view$/.test(response.url()) && response.request().method() === 'PUT' && response.ok(), { timeout: 15000 }),
      page.click('#_oabCubeFieldsModal [data-oab-cube-save]'),
    ]);
    await page.waitForFunction(() => document.querySelectorAll('#oabCubeTable thead th.pcvHead').length === 2, null, { timeout: 15000 });

    // Sunucu görünümü tanımları doğrulayıp sakladı; başvurular kalıcı anahtardır.
    const saved = await app.api('/api/oab-cube/state').then(response => response.json());
    assert.deepEqual(saved.view.calculated.map(def => def.mode), ['aggregate', 'row']);
    assert.equal(saved.view.calculated[0].formula, '[approved] / [wssi] * 100');
    assert.equal(saved.view.calculated[1].formula, 'IF([wssi] = 0, [approved], 0)');

    const sum = (list, key) => list.reduce((total, row) => total + (row[key] || 0), 0);
    const columnIndex = await page.$$eval('#oabCubeTable thead th', (ths, labels) => labels.map(label => ths.findIndex(th => th.textContent.includes(label))), [ratioLabel, rowLabel]);
    const cellText = (selector, index) => page.$eval(selector, (tr, i) => tr.cells[i].textContent, index);
    // Genel toplam: oran TOPLAMLARIN oranıdır; satır modu PASS formülünün toplamına eşittir.
    const grandRatio = parse(await page.$eval('#oabCubeTable tr.oabPivotGrandTotalRow', (tr, i) => tr.cells[tr.cells.length - 2].textContent, 0));
    const expectedRatio = Math.round(sum(rows, 'approved') / sum(rows, 'wssi') * 1000) / 10;
    assert.equal(grandRatio, expectedRatio, `genel toplam oranı ${expectedRatio}`);
    const averageOfRatios = rows.filter(row => row.wssi).reduce((total, row) => total + row.approved / row.wssi, 0) / rows.filter(row => row.wssi).length * 100;
    assert.notEqual(Math.round(averageOfRatios * 10) / 10, expectedRatio, 'demo veride oranların ortalaması toplam oranından farklıdır');
    const grandRow = parse(await page.$eval('#oabCubeTable tr.oabPivotGrandTotalRow', tr => tr.cells[tr.cells.length - 1].textContent));
    assert.equal(grandRow, sum(rows, 'approvedNotOrdered'), 'satır bazlı toplam = PASS "onaylanmış - sipariş geçilmemiş"');
    // Alt toplam: ilk klasman grubunun kendi toplamlarıyla.
    const firstGroup = await page.$eval('#oabCubeTable tr.oabPivotSubtotalRow', tr => tr.textContent);
    const groupName = firstGroup.includes('DEMO DOKUMA') ? 'DEMO DOKUMA' : 'DEMO TRİKO';
    const groupRows = rows.filter(row => row.classGroup === groupName);
    const subtotalRatio = parse(await page.$eval('#oabCubeTable tr.oabPivotSubtotalRow', tr => tr.cells[tr.cells.length - 2].textContent));
    assert.equal(subtotalRatio, Math.round(sum(groupRows, 'approved') / sum(groupRows, 'wssi') * 1000) / 10, 'alt toplam oranı');
    results.cube = { grandRatio, grandRow, subtotalRatio, columnIndex };

    // Sıralama: hesaplanan değer başlığı tıklanınca alt düzeydeki satırlar o değere göre sıralanır.
    await Promise.all([
      page.waitForResponse(response => /\/api\/oab-cube\/view$/.test(response.url()) && response.request().method() === 'PUT', { timeout: 15000 }),
      page.locator('#oabCubeTable thead th.pcvHead').first().click(),
    ]);
    const sortKey = await page.evaluate(() => window.BLOabCube.state.view.display.sort.key);
    assert.match(sortKey, /^calc:/);

    // Excel: hesaplanan değerler pivot sayfasında DEĞER olarak.
    const XLSX = require('xlsx');
    const [download] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), page.click('#oabCubeExcelExportBtn')]);
    const pivot = XLSX.utils.sheet_to_json(XLSX.read(fs.readFileSync(await download.path())).Sheets.Pivot);
    const grandExcel = pivot.find(row => /Genel|Grand/.test(Object.values(row).join(' ')));
    assert.equal(Math.round(grandExcel[ratioLabel] * 10) / 10, expectedRatio);
    assert.equal(grandExcel[rowLabel], sum(rows, 'approvedNotOrdered'));

    // Ad çakışması (#1163): "Klasman grup" adlı tanım bile Excel'de boyut sütununu ezmez.
    const clashLabel = L('Klasman grup', 'Class group');
    await put('/api/oab-cube/view', { view: { ...saved.view, calculated: [...saved.view.calculated, { id: 'pcv_clash', label: clashLabel, formula: '[wssi]', mode: 'aggregate', refs: {} }] } });
    await page.evaluate(() => window.BLOabCube.reload());
    await page.waitForFunction(() => document.querySelectorAll('#oabCubeTable thead th.pcvHead').length === 3, null, { timeout: 15000 });
    const [clashDownload] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), page.click('#oabCubeExcelExportBtn')]);
    const clashPivot = XLSX.utils.sheet_to_json(XLSX.read(fs.readFileSync(await clashDownload.path())).Sheets.Pivot);
    const groupRow = clashPivot.find(row => row[clashLabel] === 'DEMO TRİKO');
    assert.ok(groupRow, 'boyut değeri korunur');
    assert.equal(groupRow[`${clashLabel} (ƒx)`], sum(rows.filter(row => row.classGroup === 'DEMO TRİKO'), 'wssi'), 'hesaplanan değer ayrı sütunda');
    await put('/api/oab-cube/view', { view: saved.view });
    await page.evaluate(() => window.BLOabCube.reload());
    await page.waitForFunction(() => document.querySelectorAll('#oabCubeTable thead th.pcvHead').length === 2, null, { timeout: 15000 });
    // Alt detay: hesaplanan hücreden açılır, notta değeri söyler.
    await page.locator('#oabCubeTable tr.oabPivotGrandTotalRow td.pcvCell').first().dblclick();
    await page.waitForSelector('#blSharedDetailDrawer.is-open', { timeout: 10000 });
    assert.ok((await page.textContent('#blSharedDetailDrawer')).includes(ratioLabel));
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('#blSharedDetailDrawer.is-open'), null, { timeout: 10000 });

    // Hata sessiz değildir: sıfıra bölen tanım "—" ve ipucunda sebep gösterir (kayıt sunucudan geçer).
    const broken = { ...saved.view, calculated: [...saved.view.calculated, { id: 'pcv_zero', label: 'Zero', formula: '[wssi] / ([plan] - [plan])', mode: 'aggregate', refs: {} }] };
    await put('/api/oab-cube/view', { view: broken });
    await page.evaluate(() => window.BLOabCube.reload());
    await page.waitForFunction(() => document.querySelectorAll('#oabCubeTable thead th.pcvHead').length === 3, null, { timeout: 15000 });
    const zero = await page.$eval('#oabCubeTable tr.oabPivotGrandTotalRow', tr => ({ text: tr.cells[tr.cells.length - 1].textContent, title: tr.cells[tr.cells.length - 1].title }));
    assert.equal(zero.text, '—');
    assert.match(zero.title, lang === 'en' ? /Division by zero/ : /Sıfıra bölme/);
    await put('/api/oab-cube/view', { view: saved.view });
    await page.evaluate(() => window.BLOabCube.reload());
    await page.waitForFunction(() => document.querySelectorAll('#oabCubeTable thead th.pcvHead').length === 2, null, { timeout: 15000 });

    await page.evaluate(() => document.getElementById('postFobSection').scrollIntoView({ block: 'start' }));
    await page.waitForFunction(() => window.BLPostFob && window.BLPostFob.state.started, null, { timeout: 60000 });
    await page.click('#postFobRefreshBtn');
    await page.waitForFunction(() => document.querySelector('#postFobTable thead th.pcvHead'), null, { timeout: 20000 });
    const postGrand = parse(await page.$eval('#postFobTable tr.oabPivotGrandTotalRow', tr => tr.cells[tr.cells.length - 1].textContent));
    assert.equal(postGrand, postRows.reduce((total, row) => total + row.qty * row.fob, 0), 'FOB Sonrası satır bazlı toplam');
    results.postfob = { postGrand };

    await page.evaluate(() => document.getElementById('intakeSection')?.scrollIntoView({ block: 'start' }));
    await page.waitForFunction(() => window.BLINTAKE, null, { timeout: 60000 });
    await page.waitForFunction(() => document.querySelector('#intakeTable thead th.pcvHead') && document.querySelector('#intakeTable tr.oabPivotGrandTotalRow'), null, { timeout: 30000 });
    const intakeGrand = parse(await page.$eval('#intakeTable tr.oabPivotGrandTotalRow', tr => tr.cells[tr.cells.length - 1].textContent));
    assert.equal(intakeGrand, Math.round(intakeRows.reduce((t, r) => t + r[m2.id], 0) / intakeRows.reduce((t, r) => t + r[m1.id], 0) * 100) / 100);
    results.intake = { intakeGrand };

    /* ---- OAB PASS arayüzü: kişisel tanımlar pivot, alt toplam ve genel toplamda ---- */
    await page.evaluate(() => document.getElementById('oabSection')?.scrollIntoView({ block: 'start' }));
    await page.waitForFunction(() => document.querySelector('#oabTable thead th') && [...document.querySelectorAll('#oabTable tbody tr')].some(tr => tr.classList.contains('oabPivotGrandTotalRow')), null, { timeout: 60000 }).catch(async error => { throw new Error(`OAB PASS pivot çizilmedi: ${error.message}`); });
    await page.waitForFunction(() => document.querySelectorAll('#oabTable td.pcvCell').length > 0, null, { timeout: 20000 });
    const passGrand = await page.$$eval('#oabTable tr.oabPivotGrandTotalRow td.pcvCell', tds => tds.map(td => td.textContent));
    const passSum = key => passRows.reduce((total, row) => total + row[key], 0);
    const passExpectedRatio = passSum('Onaylı Sipariş Miktarı') / passSum('WSSI Sipariş Miktarı'); // i18n-ignore: OAB kaynak alan adı
    assert.equal(parse(passGrand[0]), Math.round(passExpectedRatio * 1000) / 1000, 'OAB PASS genel toplam oranı');
    assert.equal(parse(passGrand[1]), passRows.filter(row => row['WSSI Sipariş Miktarı'] === 0).reduce((total, row) => total + row['Onaylı Sipariş Miktarı'], 0), 'OAB PASS satır bazlı toplam'); // i18n-ignore: OAB kaynak alan adı
    const passHead = await page.$$eval('#oabTable thead th', ths => ths.map(th => th.textContent));
    assert.ok(passHead.some(text => text.includes(passCalc[0].label)), 'OAB PASS başlığı hesaplanan değerin adıdır');
    // Kalem penceresinde kişisel tanımlar listelenir.
    await page.click('#oabSettingsBtn');
    await page.waitForSelector('#_oabSettingsModal [data-pcv-section] [data-pcv-id]', { timeout: 10000 });
    assert.equal(await page.$$eval('#_oabSettingsModal [data-pcv-id]', list => list.length), 2);
    await page.click('#_oabSettingsModal [data-oab-settings-close]');
    results.oabPassUi = passGrand;

    /* ---- OAB PASS: kişisel depo + OABPivotEngine kancası (motor düzeyinde) ---- */
    const pass = await page.evaluate(() => {
      const engine = new window.OABPivotEngine([{ K: 'A', W: 10, O: 5 }, { K: 'A', W: 30, O: 5 }, { K: 'B', W: 0, O: 7 }]);
      const PCV = window.BLPivotCalculatedValues;
      const evaluator = PCV.createEvaluator([{ id: 'r', label: 'r', formula: '[O::SUM] / [W::SUM]', mode: 'aggregate' }, { id: 'z', label: 'z', formula: 'IF([W] = 0, [O], 0)', mode: 'row' }]);
      const out = engine.compute({ rows: ['K'], columns: [], values: [{ field: 'W', agg: 'SUM' }, { field: 'O', agg: 'SUM' }], calculatedFields: [
        { key: 'calc:r', fn: (results, rows) => evaluator.compute(results, rows).values['calc:r'] },
        { key: 'calc:z', fn: (results, rows) => evaluator.compute(results, rows).values['calc:z'] },
      ] });
      return out.cells.map(cell => [cell.rowValues[0], cell.results['calc:r'], cell.results['calc:z']]);
    });
    assert.deepEqual(pass, [['A', 0.25, 0], ['B', null, 7]]);
    results.oabPass = pass;

    if (!process.argv.includes('--no-shot')) {
      // Görsel: iki ƒx sütunu kırpılmadan görünsün diye değer listesi sadeleşir (hesap aynıdır).
      await put('/api/oab-cube/view', { view: { ...saved.view, values: ['wssi', 'approved', 'approvedNotOrdered'].map(key => ({ key })) } });
      await page.evaluate(() => window.BLOabCube.reload());
      await page.waitForFunction(() => document.querySelectorAll('#oabCubeTable thead th.pcvHead').length === 2 && document.querySelectorAll('#oabCubeTable thead th').length === 7, null, { timeout: 15000 });
      assert.ok(await page.$eval('#oabCubeNote', note => note.hidden), 'eski veri uyarısı yok');
      await page.evaluate(() => document.getElementById('oabCubeSection').scrollIntoView({ block: 'start' }));
      await page.evaluate(() => { document.activeElement?.blur?.(); window.BLOabCube.state.status = null; document.getElementById('oabCubeStatus').hidden = true; });
      await page.mouse.move(5, 5); await page.waitForTimeout(500);
      const box = await page.$eval('#oabCubeSection', el => { el.scrollIntoView({ block: 'start' }); const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
      const name = `pivot-calculated-values-${theme}${lang === 'en' ? '-en' : ''}.png`;
      const screenshot = path.join(__dirname, '../public/release-notes/next-assets/' + name);
      fs.mkdirSync(path.dirname(screenshot), { recursive: true });
      await page.screenshot({ path: screenshot, clip: { x: Math.max(0, box.x - 4), y: Math.max(0, box.y - 4), width: Math.min(1400, box.w + 8), height: Math.max(Math.ceil((box.w + 8) / 3), Math.min(620, box.h + 8)) } });
      results.screenshot = screenshot;
    }
    assert.deepEqual(app.errors, []);
    console.log(JSON.stringify(results));
  } finally { await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
