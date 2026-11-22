'use strict';
// Gerçek Buyer Log (anonim demo veri) Genel Bakış › Ticari sayfasında TR/YD Landed
// Avantaj widget'ını uçtan uca sürer ve sürüm notu görselini üretir. Şirket içi
// SSAS modeline bu ortamdan erişilemediği için YALNIZ model yanıtı veren iki uç
// (/api/postfob/tryd/report, /api/postfob/distinct) anonim sentetik satırlarla
// taklit edilir; /api/postfob/tryd/state, tercih kaydı, hesap ve çizim gerçektir.
// Kalemle pivot düzenleme (Sezon › MAG › Model, seçili değerler) ve "+ Filtre ekle"
// (Model) de uçtan uca sürülür; görsel düzenlenmiş pivotu ve açık filtre panelini gösterir.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { start } = require('./lib/client-performance-app');
const engine = require('../public/tryd-advantage-engine');

function demoRows() {
  const rows = [];
  let seq = 0;
  const push = (model, attrs, origin, qty, fob, landed, forecast) => {
    seq += 1;
    rows.push({ order: `DEMO-${2000 + seq}`, model, colour: `C${(seq % 3) + 1}`, productName: 'DEMO ÜRÜN', season: 'S6', ...attrs, originCountry: origin, qty, fob, landedActual: landed, landedForecast: forecast == null ? (landed == null ? null : Math.round(landed * 0.98 * 100) / 100) : forecast });
  };
  const groups = [
    { buyerGroup: 'DEMO GRUP A', classification: 'DEMO TRİKO', mag: 'DMA1' },
    { buyerGroup: 'DEMO GRUP A', classification: 'DEMO TRİKO', mag: 'DMA2' },
    { buyerGroup: 'DEMO GRUP B', classification: 'DEMO KAZAK', mag: 'DMB1' },
  ];
  const plan = [
    // [grup, model, TR FOB, YD FOB, landed/FOB] — gemi tipi oranlar standart 1,11'in
    // altında; DM202 uçak tipi yüksek çarpan (hata değil, hesapta kalır).
    [0, 'DM101', 7.2, 3.6, 1.08], [0, 'DM102', 6.8, 3.9, 1.07], [0, 'DM103', 6.1, 4.2, 1.07],
    [1, 'DM201', 8.4, 4.4, 1.06], [1, 'DM202', 7.9, 5.3, 1.32],
    [2, 'DM301', 9.1, 4.8, 1.08], [2, 'DM302', 8.2, 5.9, 1.08], [2, 'DM303', 7.6, 3.8, 1.05],
  ];
  for (const [g, model, trFob, ydFob, ratio] of plan) {
    push(model, groups[g], 'TÜRKİYE', 600, trFob, Math.round(trFob * 1.02 * 100) / 100);
    push(model, groups[g], 'BANGLADEŞ', 2400, ydFob, Math.round(ydFob * ratio * 100) / 100);
    push(model, groups[g], 'DEMO ÜLKE', 900, Math.round((ydFob + 0.3) * 100) / 100, Math.round((ydFob + 0.3) * (ratio + 0.02) * 100) / 100);
    push(model, groups[g], 'MISIR', 500, ydFob - 0.4, Math.round((ydFob - 0.4) * 1.08 * 100) / 100);
  }
  push('DM102', groups[0], 'BANGLADEŞ', 300, 3.9, null, null);       // landed yok
  push('DM302', groups[2], 'DEMO ÜLKE', 200, 5.9, 4.1);              // landed < FOB → hatalı
  push('DM401', groups[2], 'TÜRKİYE', 400, 6.5, 6.6);                 // yalnız TR
  push('DM402', groups[2], 'FAS', 400, 4.1, 4.5);                     // yalnız Fas: kıyas dışı
  return rows;
}

(async () => {
  const theme = process.argv.includes('--dark') ? 'dark' : 'light';
  const lang = process.argv.includes('--en') ? 'en' : 'tr';
  const app = await start({ initScript: ([t, l]) => { try { localStorage.setItem('bl.user.moderator.lcw_theme', t); localStorage.setItem('bl.user.moderator.lcw.lang.v1', l); } catch (_) {} }, initArg: [theme, lang] });
  try {
    const { page } = app;
    const rows = demoRows();
    let reportBody = null;
    await page.route('**/api/postfob/distinct', route => {
      const key = JSON.parse(route.request().postData() || '{}').key || 'season';
      const values = key === 'season' ? ['S6', 'W6'] : [...new Set(rows.map(row => row[key]).filter(Boolean))].sort();
      route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, key, values }) });
    });
    // Ortak "Landed çarpanları" ayarı: standart yurtdışı çarpanı 1,11.
    await page.route('**/api/landed-multipliers', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ multipliers: { tr: 1.05, overseas: 1.11 }, revision: 1 }) }));
    await page.route('**/api/postfob/tryd/report', route => {
      reportBody = JSON.parse(route.request().postData() || '{}');
      route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, view: engine.normalizePrefs(reportBody.view), rows, fetchedAt: new Date().toISOString(), missing: [], truncated: process.argv.includes('--truncated'), rowLimit: 10000, fromCache: false }) });
    });
    await page.waitForFunction(() => window.BLOverviewHome && document.getElementById('trydAdvantageSection'), null, { timeout: 60000 });
    await page.evaluate(() => window.BLOverviewHome.goToPage(1));
    await page.evaluate(() => document.getElementById('trydAdvantageSection').scrollIntoView({ block: 'start' }));
    await page.waitForFunction(() => window.BLTrydAdvantage && window.BLTrydAdvantage.state.started && !document.getElementById('trydAdvantageSection').classList.contains('ovHomeOff'), null, { timeout: 60000 });
    await page.waitForFunction(() => window.BLTrydAdvantage.state.filters.length > 0, null, { timeout: 30000 });
    // Sezonsuz yenileme engellenir ve filtre paneli açılır.
    await page.click('#trydAdvantageRefreshBtn');
    await page.waitForFunction(() => !document.getElementById('trydAdvantageFilterPanel').hidden, null, { timeout: 10000 });
    assert.equal(reportBody, null);
    await page.click('[data-tryd-filter="season"]');
    await page.waitForSelector('.intakeFilterPopover input[value="S6"]', { timeout: 10000 });
    await page.check('.intakeFilterPopover input[value="S6"]');
    await page.click('[data-tryd-apply]');
    await page.keyboard.press('Escape');
    await page.click('#trydAdvantageRefreshBtn');
    await page.waitForFunction(() => document.querySelectorAll('#trydAdvantageTable tr.oabPivotGrandTotalRow').length === 1, null, { timeout: 20000 });
    assert.deepEqual(reportBody.view.filterValues, { season: ['S6'] });
    // Hesap ekrandaki ile motor aynı: genel toplam avantaj tutarlardan.
    const expected = engine.analyze(rows, { target: 0.36, standardMultiplier: 1.11 });
    assert.equal(expected.models.length, 8);
    const grandText = await page.$eval('#trydAdvantageTable tr.oabPivotGrandTotalRow', row => row.textContent);
    const pct = value => (lang === 'en' ? `${(value * 100).toFixed(1)}%` : `%${(value * 100).toFixed(1).replace('.', ',')}`);
    assert.ok(grandText.includes(pct(expected.total.advantage)), `genel toplam ${grandText} ⊄ ${pct(expected.total.advantage)}`);
    const subtotals = await page.$$eval('#trydAdvantageTable tr.oabPivotSubtotalRow', trs => trs.length);
    assert.equal(subtotals, 2 + 2 + 3, 'buyer grup + klasman + MAG alt toplamları');
    const modelRows = await page.$$eval('#trydAdvantageTable tbody tr:not(.oabPivotSubtotalRow):not(.oabPivotGrandTotalRow)', trs => trs.map(tr => tr.cells[3]?.textContent));
    assert.equal(modelRows.length, 8);
    assert.ok(!modelRows.includes('DM401') && !modelRows.includes('DM402'), 'yalnız TR / yalnız Fas modeli kıyaslanmaz');
    const statusOf = model => page.$$eval('#trydAdvantageTable tbody tr', (trs, m) => { const tr = trs.find(row => row.cells[3] && row.cells[3].textContent === m); return tr ? tr.cells[tr.cells.length - 1].textContent : ''; }, model);
    assert.match(await statusOf('DM102'), lang === 'en' ? /No landed/ : /Landed yok/);
    assert.match(await statusOf('DM302'), lang === 'en' ? /Invalid landed/ : /Landed hatalı/);
    // Standardın üstündeki çarpan hata değildir: uyarı alır ve avantaj hesabına girer.
    assert.match(await statusOf('DM202'), lang === 'en' ? /High landed multiplier/ : /Landed çarpanı yüksek/);
    const dm202 = expected.models.find(model => model.model === 'DM202');
    assert.equal(dm202.status, engine.STATUS.high);
    assert.equal(dm202.amounts.ydQty, dm202.amounts.ydQtyAll, 'yüksek çarpanlı adet hesapta');
    assert.equal(dm202.amounts.highMultiplierQty, dm202.amounts.ydQtyAll);
    const belowExpected = expected.models.filter(model => model.advantage < 0.36).map(model => model.model).sort();
    const highlighted = await page.$$eval('#trydAdvantageTable tbody tr.trydAdvantageBelowRow', trs => trs.map(tr => tr.cells[3]?.textContent).filter(value => /^DM/.test(value || '')).sort());
    assert.deepEqual(highlighted, belowExpected);
    // Yalnız hedef altı.
    await page.check('#trydAdvantageBelowOnly');
    await page.waitForFunction(n => document.querySelectorAll('#trydAdvantageTable tbody tr:not(.oabPivotSubtotalRow):not(.oabPivotGrandTotalRow)').length === n, belowExpected.length, { timeout: 10000 });
    await page.uncheck('#trydAdvantageBelowOnly');
    // Hedef değişir → tercih sunucuya kaydedilir (gerçek route).
    await page.fill('#trydAdvantageTarget', '30');
    await page.dispatchEvent('#trydAdvantageTarget', 'change');
    await page.waitForTimeout(700);
    const saved = await app.api('/api/postfob/tryd/state').then(response => response.json());
    assert.equal(saved.view.target, 0.3);
    assert.deepEqual(saved.view.filterValues, { season: ['S6'] });
    await page.fill('#trydAdvantageTarget', '36');
    await page.dispatchEvent('#trydAdvantageTarget', 'change');
    // Öngörü kaynağı ayrı etiketle.
    await page.selectOption('#trydAdvantageLandedSource', 'forecast');
    assert.match(await page.textContent('#trydAdvantageTable thead'), lang === 'en' ? /Forecast advantage/ : /Öngörü avantajı/);
    assert.match(await page.textContent('#trydAdvantageNote'), lang === 'en' ? /not the realized/ : /gerçekleşmiş avantaj değildir/);
    await page.selectOption('#trydAdvantageLandedSource', 'actual');
    // Alt detay: model satırına çift tık → ortak çekmece, kaynak satırlar.
    await page.locator('#trydAdvantageTable tbody tr', { hasText: 'DM302' }).locator('td').nth(7).dblclick();
    await page.waitForSelector('#blSharedDetailDrawer.is-open', { timeout: 10000 });
    assert.match(await page.textContent('#blSharedDetailDrawer'), /DEMO-20\d\d/);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('#blSharedDetailDrawer.is-open'), null, { timeout: 10000 });
    // Excel: pivot + kaynak satırlar + özet.
    const [download] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), page.click('#trydAdvantageExcelExportBtn')]);
    const XLSX = require('xlsx');
    const book = XLSX.read(fs.readFileSync(await download.path()));
    assert.equal(book.SheetNames.length, 3);
    const pivotRows = XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]]);
    assert.equal(pivotRows.length, 7 + 8 + 1);
    const grandRow = pivotRows[pivotRows.length - 1];
    const advKey = lang === 'en' ? 'Realized advantage' : 'Gerçekleşen avantaj';
    assert.ok(Math.abs(grandRow[advKey] - expected.total.advantage) < 1e-6, JSON.stringify(grandRow));
    const L = (tr, en) => (lang === 'en' ? en : tr);
    // "+ Filtre ekle": üretici ülke ve sipariş listelenmez; Model eklenir, değer seçici hemen açılır.
    await page.click('#trydAdvantageFiltersBtn');
    await page.waitForFunction(() => !document.getElementById('trydAdvantageFilterPanel').hidden, null, { timeout: 10000 });
    await page.click('[data-tryd-add-filter]');
    await page.waitForSelector('.intakeFilterFieldPicker [data-tryd-add-filter-key]', { timeout: 10000 });
    const pickable = await page.$$eval('.intakeFilterFieldPicker [data-tryd-add-filter-key]', nodes => nodes.map(node => node.dataset.trydAddFilterKey));
    assert.ok(pickable.includes('model') && pickable.includes('salesCountry'), pickable.join());
    assert.ok(!pickable.includes('originCountry') && !pickable.includes('order') && !pickable.includes('season'), pickable.join());
    await page.click('.intakeFilterFieldPicker [data-tryd-add-filter-key="model"]');
    await page.waitForSelector('.intakeFilterPopover:not(.intakeFilterFieldPicker) input[value="DM101"]', { timeout: 10000 });
    for (const model of ['DM101', 'DM102', 'DM201', 'DM301', 'DM302']) await page.check(`.intakeFilterPopover input[value="${model}"]`);
    await page.click('[data-tryd-apply]');
    assert.ok(await page.$('#trydAdvantageFilterPanel [data-tryd-filter="model"]'), 'Model filtresi panelde');
    reportBody = null;
    await page.click('#trydAdvantageRefreshBtn');
    for (let i = 0; i < 100 && !reportBody; i++) await page.waitForTimeout(100);
    await page.waitForFunction(() => !window.BLTrydAdvantage.state.loading, null, { timeout: 20000 });
    assert.ok(reportBody, 'Yenile sorgusu gitti');
    assert.deepEqual(reportBody.view.filterValues.model, ['DM101', 'DM102', 'DM201', 'DM301', 'DM302']);
    assert.ok(reportBody.view.filters.some(ref => ref.key === 'model'));
    // Kalemle pivot: satırlar Sezon › MAG (Model yaprak); değerler avantaj, hedef, fark, FOB avantajı, YD adet, durum.
    await page.click('#trydAdvantageFieldsBtn');
    await page.waitForSelector('#_trydFieldsModal #trydRowsList', { timeout: 10000 });
    await page.evaluate(() => {
      const modal = document.getElementById('_trydFieldsModal');
      const setList = (id, keys) => {
        const list = modal.querySelector(`#${id}`);
        list.querySelectorAll('.oabConfigRow').forEach(row => row.remove());
        keys.forEach(key => { modal.querySelector(`[data-tryd-add="${id}"]`).click(); const selects = list.querySelectorAll('select'); selects[selects.length - 1].value = key; });
      };
      setList('trydRowsList', ['season', 'mag']);
      setList('trydValuesList', ['advantage', 'target', 'gap', 'fobAdvantage', 'ydLanded', 'ydQty', 'status']);
    });
    await page.click('[data-tryd-save]');
    await page.waitForFunction(() => !document.getElementById('_trydFieldsModal'), null, { timeout: 10000 });
    const heads = await page.$$eval('#trydAdvantageTable thead th', ths => ths.map(th => th.textContent.replace(/[↑↓]/g, '').trim()));
    assert.deepEqual(heads.slice(0, 3), [L('Sezon', 'Season'), 'MAG', 'Model']);
    assert.equal(heads.length, 3 + 7);
    assert.ok(!heads.includes(L('TR FOB USD', 'TR FOB USD')));
    const pivotExpected = engine.analyze(rows, { target: 0.36 });
    const pivotSubtotals = await page.$$eval('#trydAdvantageTable tr.oabPivotSubtotalRow', trs => trs.length);
    assert.equal(pivotSubtotals, 1 + 3, 'sezon + MAG alt toplamları');
    const pivotGrand = await page.$eval('#trydAdvantageTable tr.oabPivotGrandTotalRow', row => row.textContent);
    assert.ok(pivotGrand.includes(pct(pivotExpected.total.advantage)), 'eksen değişse de genel toplam tutarlardan aynı');
    await page.waitForTimeout(700);
    const savedPivot = await app.api('/api/postfob/tryd/state').then(response => response.json());
    assert.deepEqual(savedPivot.view.rows, [{ key: 'season' }, { key: 'mag' }]);
    assert.deepEqual(savedPivot.view.values.map(ref => ref.key), ['advantage', 'target', 'gap', 'fobAdvantage', 'ydLanded', 'ydQty', 'status']);
    assert.deepEqual(savedPivot.view.filterValues.model, ['DM101', 'DM102', 'DM201', 'DM301', 'DM302']);
    // Excel yeni eksen ve değer seçimini izler.
    const [pivotDownload] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), page.click('#trydAdvantageExcelExportBtn')]);
    const pivotBook = XLSX.read(fs.readFileSync(await pivotDownload.path()));
    const editedRows = XLSX.utils.sheet_to_json(pivotBook.Sheets[pivotBook.SheetNames[0]]);
    assert.equal(editedRows.length, 1 + 3 + 8 + 1);
    assert.ok(L('Sezon', 'Season') in editedRows[0] && !(L('Buyer grup', 'Buyer group') in editedRows[0]) && !('TR FOB USD' in editedRows[0]), Object.keys(editedRows[0]).join());
    assert.ok(Math.abs(editedRows[editedRows.length - 1][advKey] - expected.total.advantage) < 1e-6);
    // ƒx hesaplanan değer (public/pivot-calculated-values.js): yalnız toplamlar
    // üzerinden; alanlar her düzeyde tutarlardan. Satır modu TR/YD'de kapalıdır.
    const calcLabel = L('Landed / TR FOB', 'Landed / TR FOB');
    await page.click('#trydAdvantageFieldsBtn');
    await page.waitForSelector('#_trydFieldsModal [data-pcv-add]', { timeout: 10000 });
    await page.click('#_trydFieldsModal [data-pcv-add]');
    await page.waitForSelector('#_formulaColumnModal .pcvModes', { timeout: 15000 });
    assert.ok(await page.$eval('#_formulaColumnModal [data-pcv-mode="row"]', button => button.disabled), 'satır modu kapalı');
    await page.click('#_formulaColumnModal [data-fc-mode="advanced"]');
    await page.fill('#_formulaColumnModal [data-fc-formula]', L('[LANDED TUTAR] / [FOB TR TUTAR]', '[Landed amount] / [TR FOB amount]'));
    await page.fill(`#_formulaColumnModal ${lang === 'en' ? '[data-fc-label-en]' : '[data-fc-label]'}`, calcLabel);
    await page.click('#_formulaColumnModal .fcMore > summary');
    await page.selectOption('#_formulaColumnModal [data-fc-format]', 'number');
    await page.fill('#_formulaColumnModal [data-fc-decimals]', '3');
    await page.waitForFunction(() => /isOk/.test(document.querySelector('#_formulaColumnModal [data-fc-preview]').className), null, { timeout: 10000 });
    await page.click('#_formulaColumnModal [data-fc-save]');
    await page.waitForFunction(() => !document.getElementById('_formulaColumnModal'), null, { timeout: 10000 });
    await page.click('[data-tryd-save]');
    await page.waitForFunction(() => document.querySelector('#trydAdvantageTable thead th.pcvHead'), null, { timeout: 15000 });
    await page.waitForTimeout(700);
    const savedCalc = await app.api('/api/postfob/tryd/state').then(response => response.json());
    assert.equal(savedCalc.view.calculated.length, 1);
    assert.equal(savedCalc.view.calculated[0].formula, '[landedAmount] / [fobTrAmount]');
    assert.equal(savedCalc.view.calculated[0].mode, 'aggregate');
    // Her düzeyde: Landed / TR FOB tutarı = 1 − avantaj (tutarlardan, ortalama değil).
    const num = value => Number(String(value).replace(/[^\d,.-]/g, '').replace(lang === 'en' ? /,/g : /\./g, '').replace(',', '.'));
    const calcCells = await page.$$eval('#trydAdvantageTable tbody tr', trs => trs.map(tr => ({ cls: tr.className, label: [...tr.cells].map(td => td.textContent).join('|'), calc: tr.cells[tr.cells.length - 1].textContent })));
    const grandCalc = calcCells.find(row => /oabPivotGrandTotalRow/.test(row.cls));
    // Taklit rapor ucu filtreyi uygulamaz: ekranda bütün demo modeller vardır.
    const filtered = engine.analyze(rows, { target: 0.36, standardMultiplier: 1.11 });
    const round3 = value => Math.round(value * 1000) / 1000;
    assert.equal(num(grandCalc.calc), round3(1 - filtered.total.advantage), `genel toplam ${grandCalc.calc}`);
    const dm201 = filtered.models.find(model => model.model === 'DM201');
    const dm201Row = calcCells.find(row => row.label.includes('|DM201|'));
    assert.equal(num(dm201Row.calc), round3(dm201.amounts.landedAmount / dm201.amounts.fobTrAmount));
    // Sıralama: hesaplanan değer başlığı (model ve grup düzeyinde).
    await page.click('#trydAdvantageTable thead th.pcvHead');
    await page.waitForTimeout(300);
    assert.match(await page.evaluate(() => window.BLTrydAdvantage.state.view.sort.key), /^calc:/);
    const sortedModels = await page.$$eval('#trydAdvantageTable tbody tr:not(.oabPivotSubtotalRow):not(.oabPivotGrandTotalRow)', trs => trs.map(tr => tr.cells[tr.cells.length - 1].textContent));
    assert.ok(sortedModels.length > 0);
    // Excel: hesaplanan değer DEĞER olarak.
    const [calcDownload] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), page.click('#trydAdvantageExcelExportBtn')]);
    const calcRows = XLSX.utils.sheet_to_json(XLSX.read(fs.readFileSync(await calcDownload.path())).Sheets.Pivot);
    assert.ok(Math.abs(calcRows[calcRows.length - 1][calcLabel] - (1 - filtered.total.advantage)) < 1e-6, JSON.stringify(calcRows[calcRows.length - 1]));
    // Ad çakışması: editör boyut/sabit başlık adını ("Model") reddeder.
    await page.click('#trydAdvantageFieldsBtn');
    await page.waitForSelector('#_trydFieldsModal [data-pcv-add]', { timeout: 10000 });
    await page.click('#_trydFieldsModal [data-pcv-add]');
    await page.waitForSelector('#_formulaColumnModal .pcvModes', { timeout: 15000 });
    await page.click('#_formulaColumnModal [data-fc-mode="advanced"]');
    await page.fill('#_formulaColumnModal [data-fc-formula]', L('[YD adet]', '[Abroad qty]'));
    await page.fill(`#_formulaColumnModal ${lang === 'en' ? '[data-fc-label-en]' : '[data-fc-label]'}`, 'Model');
    await page.waitForFunction(() => /isOk/.test(document.querySelector('#_formulaColumnModal [data-fc-preview]').className), null, { timeout: 10000 });
    await page.click('#_formulaColumnModal [data-fc-save]');
    await page.waitForTimeout(300);
    assert.ok(await page.$('#_formulaColumnModal'), 'ayrılmış ad kaydedilmez; pencere açık kalır');
    await page.click('#_formulaColumnModal [data-fc-close]');
    await page.click('#_trydFieldsModal [data-tryd-close]');
    // Eski/dış kaynaklı "Model" adlı tanım bile Excel'de model kodunu ezmez: başlık "Model (ƒx)" olur.
    const beforeClash = await app.api('/api/postfob/tryd/state').then(response => response.json());
    const clashView = { ...beforeClash.view, calculated: [...beforeClash.view.calculated, { id: 'pcv_model', label: 'Model', formula: '[ydQty]', mode: 'aggregate', refs: {} }] };
    delete clashView.version;
    await app.api('/api/postfob/tryd/view', { view: clashView }, 'PUT');
    await page.evaluate(() => window.BLTrydAdvantage.reload());
    await page.waitForFunction(() => document.querySelectorAll('#trydAdvantageTable thead th.pcvHead').length === 2, null, { timeout: 15000 });
    const [clashDownload] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), page.click('#trydAdvantageExcelExportBtn')]);
    const clashRows = XLSX.utils.sheet_to_json(XLSX.read(fs.readFileSync(await clashDownload.path())).Sheets.Pivot);
    const dm201Excel = clashRows.find(row => row.Model === 'DM201');
    assert.ok(dm201Excel, 'model kodu Excel\'de korunur');
    assert.equal(dm201Excel['Model (ƒx)'], dm201.amounts.ydQty, 'hesaplanan değer ayrı sütunda');
    await app.api('/api/postfob/tryd/view', { view: { calculated: beforeClash.view.calculated } }, 'PUT');
    await page.evaluate(() => window.BLTrydAdvantage.reload());
    await page.waitForFunction(() => document.querySelectorAll('#trydAdvantageTable thead th.pcvHead').length === 1, null, { timeout: 15000 });
    // Görselde hesaplanan sütun da görünür; sıralama etikete döner.
    await page.click('#trydAdvantageTable thead th[data-tryd-sort="label"]');
    // İlgisiz açılış bildirimi görüntüyü kapatmasın.
    await page.evaluate(() => {
      const hit = [...document.querySelectorAll('body *')].filter(el => /uyarı var|warnings —/.test(el.textContent || '') && !el.children.length)[0];
      let host = hit;
      while (host && !host.querySelector('button')) host = host.parentElement;
      host?.querySelector('button')?.click();
    });
    await page.waitForTimeout(500);
    await page.evaluate(() => { document.activeElement?.blur?.(); window.BLTrydAdvantage.state.status = null; document.getElementById('trydAdvantageStatus').hidden = true; });
    // Durum sütunu ve bütün KPI'lar görünsün diye geniş görünüm; widget yapışkan sayfa başlığının altına kaydırılır.
    await page.setViewportSize({ width: 1900, height: 1000 });
    await page.waitForTimeout(400);
    await page.mouse.move(5, 5); await page.waitForTimeout(400);
    // Görsel: düzenlenmiş pivot + eklenen Model filtresiyle açık filtre paneli.
    // Panel sabit konumludur: önce widget yerleşir (belge kaydırması sıfır, başlık üst çubuğun altında kalmaz), sonra panel açılır.
    await page.evaluate(() => {
      const section = document.getElementById('trydAdvantageSection');
      section.scrollIntoView({ block: 'start' });
      // Uygulama üst çubuğu sabittir; widget başlığı onun altında kalsın.
      const bar = [...document.querySelectorAll('body *')].find(el => { const st = getComputedStyle(el); const r = el.getBoundingClientRect(); return (st.position === 'fixed' || st.position === 'sticky') && r.top <= 0 && r.height > 20 && r.height < 120 && r.width > innerWidth / 2; });
      const offset = bar ? bar.getBoundingClientRect().bottom + 8 - section.getBoundingClientRect().top : 0;
      if (offset > 0) { let el = section.parentElement; while (el && !(el.scrollHeight > el.clientHeight && /(auto|scroll)/.test(getComputedStyle(el).overflowY)) && el !== document.documentElement) el = el.parentElement; (el || document.scrollingElement).scrollTop -= offset; }
    });
    await page.click('#trydAdvantageFiltersBtn');
    await page.waitForFunction(() => !document.getElementById('trydAdvantageFilterPanel').hidden, null, { timeout: 10000 });
    await page.mouse.move(5, 5); await page.waitForTimeout(400);
    const box = await page.$eval('#trydAdvantageSection', el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
    const tableWrap = await page.$eval('#trydAdvantageTable', table => ({ scroll: table.parentElement.scrollWidth, client: table.parentElement.clientWidth }));
    assert.ok(tableWrap.scroll <= tableWrap.client + 2, `tablo yatayda taşmamalı: ${JSON.stringify(tableWrap)}`);
    const name = `tryd-advantage-${theme}${lang === 'en' ? '-en' : ''}${process.argv.includes('--truncated') ? '-truncated' : ''}.png`;
    const screenshot = path.join(__dirname, '../public/release-notes/next-assets/' + name);
    fs.mkdirSync(path.dirname(screenshot), { recursive: true });
    await page.screenshot({ path: screenshot, clip: { x: Math.max(0, box.x - 4), y: Math.max(0, box.y - 4), width: Math.min(1900, box.w + 8), height: Math.max(Math.ceil((box.w + 8) / 3), Math.min(820, box.h + 8)) } });
    // Pivot Varsayılanına Dön: eksen/değer/filtre alanları varsayılana döner; eklenen Model filtresi düşer.
    await page.keyboard.press('Escape');
    await page.click('#trydAdvantageFieldsBtn');
    await page.click('[data-tryd-settings-reset]');
    await page.waitForFunction(() => !document.getElementById('_trydFieldsModal'), null, { timeout: 10000 });
    await page.waitForTimeout(700);
    const reset = await app.api('/api/postfob/tryd/state').then(response => response.json());
    assert.deepEqual(reset.view.rows.map(ref => ref.key), engine.DEFAULT_ROWS);
    assert.equal(reset.view.values.length, engine.VALUE_KEYS.length);
    assert.deepEqual(reset.view.filterValues, { season: ['S6'] });
    assert.equal(await page.$$eval('#trydAdvantageTable tr.oabPivotSubtotalRow', trs => trs.length), 2 + 2 + 3);
    assert.equal(reset.view.calculated.length, 1, 'pivot sıfırlama hesaplanan değeri silmez');
    assert.deepEqual(app.errors, []);
    console.log(JSON.stringify({ screenshot, total: expected.total.advantage, below: belowExpected, box }));
  } finally { await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
