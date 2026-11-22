'use strict';
// Gerçek Buyer Log (anonim demo veri) Genel Bakış › Ticari sayfasında TR/YD Landed
// Avantaj widget'ını uçtan uca sürer ve sürüm notu görselini üretir. Şirket içi
// SSAS modeline bu ortamdan erişilemediği için YALNIZ model yanıtı veren iki uç
// (/api/postfob/tryd/report, /api/postfob/distinct) anonim sentetik satırlarla
// taklit edilir; /api/postfob/tryd/state, tercih kaydı, hesap ve çizim gerçektir.
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
    // [grup, model, TR FOB, YD FOB, landed/FOB]
    [0, 'DM101', 7.2, 3.6, 1.18], [0, 'DM102', 6.8, 3.9, 1.16], [0, 'DM103', 6.1, 4.2, 1.17],
    [1, 'DM201', 8.4, 4.4, 1.15], [1, 'DM202', 7.9, 5.3, 1.19],
    [2, 'DM301', 9.1, 4.8, 1.17], [2, 'DM302', 8.2, 5.9, 1.2], [2, 'DM303', 7.6, 3.8, 1.16],
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
    await page.route('**/api/postfob/distinct', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, key: 'season', values: ['S6', 'W6'] }) }));
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
    const expected = engine.analyze(rows, { target: 0.36 });
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
    // İlgisiz açılış bildirimi görüntüyü kapatmasın.
    await page.evaluate(() => {
      const hit = [...document.querySelectorAll('body *')].filter(el => /uyarı var|warnings —/.test(el.textContent || '') && !el.children.length)[0];
      let host = hit;
      while (host && !host.querySelector('button')) host = host.parentElement;
      host?.querySelector('button')?.click();
    });
    await page.waitForTimeout(500);
    await page.evaluate(() => { document.activeElement?.blur?.(); window.BLTrydAdvantage.state.status = null; document.getElementById('trydAdvantageStatus').hidden = true; });
    await page.mouse.move(5, 5); await page.waitForTimeout(400);
    const box = await page.$eval('#trydAdvantageSection', el => { el.scrollIntoView({ block: 'start' }); const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
    const name = `tryd-advantage-${theme}${lang === 'en' ? '-en' : ''}${process.argv.includes('--truncated') ? '-truncated' : ''}.png`;
    const screenshot = path.join(__dirname, '../public/release-notes/next-assets/' + name);
    fs.mkdirSync(path.dirname(screenshot), { recursive: true });
    await page.screenshot({ path: screenshot, clip: { x: Math.max(0, box.x - 4), y: Math.max(0, box.y - 4), width: Math.min(1400, box.w + 8), height: Math.max(Math.ceil((box.w + 8) / 3), Math.min(760, box.h + 8)) } });
    assert.deepEqual(app.errors, []);
    console.log(JSON.stringify({ screenshot, total: expected.total.advantage, below: belowExpected, box }));
  } finally { await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
