'use strict';
// Gerçek Buyer Log (anonim demo veri) Genel Bakış › Ticari sayfasında FOB Sonrası
// Maliyet widget'ını uçtan uca sürer ve sürüm notu görselini üretir. Şirket içi
// SSAS modeline bu ortamdan erişilemediği için YALNIZ model yanıtı veren iki
// uç (/api/postfob/report, /api/postfob/distinct) anonim sentetik satırlarla
// taklit edilir; /api/postfob/state, görünüm kaydı ve bütün çizim gerçektir.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { start } = require('./lib/client-performance-app');

function demoRows() {
  const origins = [['BANGLADEŞ', 3.9, 1.11], ['MISIR', 5.1, 1.07], ['FAS', 4.6, 1.09], ['TÜRKİYE', 6.1, 0.99]];
  const mags = ['DM1A', 'DM2B'];
  const rows = [];
  let seq = 0;
  for (const [origin, fob, ratio] of origins) {
    for (let i = 0; i < 9; i++) {
      seq += 1;
      const unitFob = Math.round((fob + (i % 3) * 0.21) * 100) / 100;
      const r = seq === 7 ? 1.62 : ratio + (i % 4) * 0.008;
      const landed = Math.round(unitFob * r * 100) / 100;
      rows.push({
        order: `DEMO-${1000 + seq}`, model: `DM${300 + seq}`, colour: `C${(i % 3) + 1}`, season: 'S6', mag: mags[i % 2],
        buyerGroup: 'DEMO GRUP', classification: 'DEMO KLASMAN', originCountry: origin, salesCountry: i % 3 ? 'TURKIYE' : 'DEMO ÜLKE',
        qty: 400 + i * 150, fob: unitFob, landedActual: landed, landedForecast: Math.round(unitFob * (ratio - 0.01) * 100) / 100,
        integralFirst: Math.round(landed * 1.21 * 100) / 100, integralLast: Math.round(landed * 1.26 * 100) / 100,
        financeCost: null, advanceCost: null, customsRate: origin === 'TÜRKİYE' ? 0 : 0.12, freightRate: 0.04 + (i % 2) * 0.01, extraRate: 0.02, tpMultiplier: null,
      });
    }
  }
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
    await page.route('**/api/postfob/report', route => {
      reportBody = JSON.parse(route.request().postData() || '{}');
      route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, view: reportBody.view, rows, fetchedAt: new Date().toISOString(), filterValues: reportBody.view.filterValues, missing: ['tpMultiplier'], truncated: false, rowLimit: 10000, fromCache: false }) });
    });
    await page.waitForFunction(() => window.BLOverviewHome && document.getElementById('postFobSection'), null, { timeout: 60000 });
    // Ticari sayfası (varsayılan düzende 2. sayfa) — widget orada.
    await page.evaluate(() => window.BLOverviewHome.goToPage(1));
    await page.waitForFunction(() => window.BLPostFob && window.BLPostFob.state.started && !document.getElementById('postFobSection').classList.contains('ovHomeOff'), null, { timeout: 60000 });
    await page.waitForFunction(() => window.BLPostFob.state.catalog.dimensions.length > 0, null, { timeout: 30000 });
    // Sezonsuz yenileme engellenir ve filtre paneli açılır.
    await page.click('#postFobRefreshBtn');
    await page.waitForFunction(() => !document.getElementById('postFobFilterPanel').hidden, null, { timeout: 10000 });
    assert.equal(reportBody, null);
    await page.click('[data-postfob-filter="season"]');
    await page.waitForSelector('.intakeFilterPopover input[value="S6"]', { timeout: 10000 });
    await page.check('.intakeFilterPopover input[value="S6"]');
    await page.click('[data-postfob-apply]');
    await page.keyboard.press('Escape');
    await page.click('#postFobRefreshBtn');
    await page.waitForFunction(() => document.querySelectorAll('#postFobTable tbody tr').length === 4, null, { timeout: 20000 });
    assert.deepEqual(reportBody.view.filterValues, { season: ['S6'] });
    const groups = await page.$$eval('#postFobTable tbody tr td:first-child', tds => tds.map(td => td.textContent));
    assert.deepEqual([...groups].sort(), ['BANGLADEŞ', 'FAS', 'MISIR', 'TÜRKİYE']);
    const kpis = await page.$$eval('#postFobKpis .kpi', els => els.map(el => el.textContent));
    assert.equal(kpis.length, 8);
    const outlierCells = await page.$$eval('#postFobTable tr.postFobHasOutlier td:first-child', tds => tds.map(td => td.textContent));
    assert.deepEqual(outlierCells, ['BANGLADEŞ']);
    // Görünüm sunucuya kaydedilir (gerçek route).
    await page.selectOption('#postFobSegment', 'import');
    await page.waitForFunction(() => document.querySelectorAll('#postFobTable tbody tr').length === 3, null, { timeout: 10000 });
    await page.waitForTimeout(600);
    const saved = await app.api('/api/postfob/state').then(response => response.json());
    assert.equal(saved.view.segment, 'import');
    assert.deepEqual(saved.view.filterValues, { season: ['S6'] });
    await page.selectOption('#postFobSegment', 'all');
    await page.waitForFunction(() => document.querySelectorAll('#postFobTable tbody tr').length === 4, null, { timeout: 10000 });
    assert.match(await page.textContent('#postFobStatus'), lang === 'en' ? /TP multiplier/ : /TP çarpanı/);
    // İlgisiz açılış bildirimi (demo kaynak uyarısı) görüntüyü kapatmasın.
    await page.evaluate(() => {
      const hit = [...document.querySelectorAll('body *')].filter(el => /uyarı var|warnings —/.test(el.textContent || '') && !el.children.length)[0];
      let host = hit;
      while (host && !host.querySelector('button')) host = host.parentElement;
      host?.querySelector('button')?.click();
    });
    await page.waitForTimeout(500);
    await page.mouse.move(5, 5); await page.waitForTimeout(400);
    const box = await page.$eval('#postFobSection', el => { el.scrollIntoView({ block: 'start' }); const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
    const name = `postfob-cost-${theme}${lang === 'en' ? '-en' : ''}.png`;
    const screenshot = path.join(__dirname, '../public/release-notes/next-assets/' + name);
    fs.mkdirSync(path.dirname(screenshot), { recursive: true });
    await page.screenshot({ path: screenshot, clip: { x: Math.max(0, box.x - 4), y: Math.max(0, box.y - 4), width: Math.min(1400, box.w + 8), height: Math.max(Math.ceil((box.w + 8) / 3), Math.min(560, box.h + 8)) } });
    assert.deepEqual(app.errors, []);
    console.log(JSON.stringify({ screenshot, groups, kpis, outlierCells, box }));
  } finally { await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
