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
        specialCode: seq === 7 ? 'DEMO ÖZEL 7' : '',
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
    await page.route('**/api/postfob/metadata', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true,
      dimensions: [{ source: '[Urun].[SezonKod]', table: 'Urun', name: 'SezonKod', label: 'SezonKod', baseKey: 'season' }, { source: '[Urun].[OptionTanim]', table: 'Urun', name: 'OptionTanim', label: 'OptionTanim', baseKey: '' }],
      measures: [{ source: '[Measures].[Stok Tutma Maliyeti]', table: 'Measures', name: 'Stok Tutma Maliyeti', label: 'Stok Tutma Maliyeti', baseKey: '' }] }) }));
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
    // Varsayılan pivot: Üretici ülke satırları + Genel Toplam (INTAKE ile aynı sınıflar).
    await page.waitForFunction(() => document.querySelectorAll('#postFobTable tbody tr').length === 5, null, { timeout: 20000 });
    assert.deepEqual(reportBody.view.filterValues, { season: ['S6'] });
    assert.match(await page.textContent('#postFobStatus'), lang === 'en' ? /TP multiplier/ : /TP çarpanı/);
    const groups = await page.$$eval('#postFobTable tbody tr:not(.oabPivotGrandTotalRow) td:first-child', tds => tds.map(td => td.textContent));
    assert.deepEqual([...groups].sort(), ['BANGLADEŞ', 'FAS', 'MISIR', 'TÜRKİYE']);
    assert.equal(await page.$$eval('#postFobTable tr.oabPivotGrandTotalRow', rows => rows.length), 1);
    const kpis = await page.$$eval('#postFobKpis .kpi', els => els.map(el => el.textContent));
    assert.equal(kpis.length, 8);
    const outlierCells = await page.$$eval('#postFobTable tbody tr:not(.oabPivotGrandTotalRow)', rows => rows.filter(row => row.querySelector('.postFobOutlierCell')).map(row => row.cells[0].textContent));
    assert.deepEqual(outlierCells, ['BANGLADEŞ']);
    // Kalem: pivot düzenleyici — ikinci satır alanı olarak MAG eklenir → alt toplamlı gruplar.
    await page.click('#postFobFieldsBtn');
    await page.waitForSelector('#_postFobFieldsModal [data-postfob-add="postFobRowsList"]', { timeout: 10000 });
    const modelOptions = await page.$$eval('#_postFobFieldsModal #postFobValuesList select.postFobValueField option', options => options.map(option => option.textContent));
    assert.ok(modelOptions.includes('Stok Tutma Maliyeti'), 'model ölçüsü değer havuzunda');
    await page.click('#_postFobFieldsModal [data-postfob-add="postFobRowsList"]');
    await page.selectOption('#_postFobFieldsModal #postFobRowsList .oabConfigRow:last-child select', 'mag');
    await page.click('#_postFobFieldsModal [data-postfob-save]');
    await page.waitForFunction(() => document.querySelectorAll('#postFobTable tr.oabPivotSubtotalRow').length === 4, null, { timeout: 10000 });
    assert.equal(await page.$$eval('#postFobTable tbody tr:not(.oabPivotSubtotalRow):not(.oabPivotGrandTotalRow)', rows => rows.length), 8);
    // Alt detay: MISIR alt toplamında FOB hücresine çift tık → OAB ile aynı ortak çekmece, 9 kaynak satır.
    const fobColumn = await page.$$eval('#postFobTable thead th', ths => ths.findIndex(th => th.dataset.postfobSort === 'fob'));
    const misir = await page.$$eval('#postFobTable tr.oabPivotSubtotalRow', rows => rows.findIndex(row => /MISIR/.test(row.textContent)));
    // Grup hücresi colspan taşır: hücre indeksi = sütun − (colspan − 1).
    await page.locator('#postFobTable tr.oabPivotSubtotalRow').nth(misir).locator('td').nth(fobColumn - 1).dblclick();
    await page.waitForSelector('#blSharedDetailDrawer.is-open', { timeout: 10000 });
    const drawerText = await page.textContent('#blSharedDetailDrawer');
    assert.match(drawerText, /MISIR/);
    assert.match(drawerText, /9 (kaynak satır|source rows)/);
    assert.match(drawerText, /DEMO-101[0-8]/);
    if (process.argv.includes('--detail-shot')) {
      await page.waitForTimeout(500);
      const detailShot = path.join(__dirname, `../public/release-notes/next-assets/postfob-drilldown-${theme}.png`);
      const drawerBox = await page.$eval('#blSharedDetailDrawer', el => { const panel = el.querySelector('[role="dialog"]') || el.firstElementChild || el; const r = panel.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
      const width = Math.max(960, Math.min(1400, drawerBox.w));
      await page.screenshot({ path: detailShot, clip: { x: Math.max(0, Math.min(drawerBox.x, 1440 - width)), y: Math.max(0, drawerBox.y), width, height: Math.min(560, Math.max(Math.ceil(width / 3), drawerBox.h)) } });
      console.log(JSON.stringify({ detailShot, drawerBox }));
    }
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('#blSharedDetailDrawer.is-open'), null, { timeout: 10000 });
    // Excel: pivot (ekrandaki düzen) + kaynak satırlar + filtre özeti.
    const [download] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), page.click('#postFobExcelExportBtn')]);
    const XLSX = require('xlsx');
    const book = XLSX.read(fs.readFileSync(await download.path()));
    assert.equal(book.SheetNames.length, 3);
    const pivotRows = XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]]);
    assert.equal(pivotRows.length, 4 + 8 + 1, 'alt toplam + detay + genel toplam');
    const grandRow = pivotRows[pivotRows.length - 1];
    assert.equal(Object.values(grandRow).includes(36000), true, 'genel toplam adedi ' + JSON.stringify(grandRow));
    assert.equal(XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[1]]).length, 36);
    // + Filtre ekle: canlı modelin ek alanı listelenir.
    await page.click('#postFobFiltersBtn');
    await page.click('[data-postfob-add-filter]');
    await page.waitForSelector('.intakeFilterFieldPicker [data-postfob-add-filter-id]', { timeout: 10000 });
    assert.ok((await page.textContent('.intakeFilterFieldPicker')).includes('OptionTanim'));
    await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
    // Arama: özel kod ve sipariş kodu (VE).
    await page.fill('#postFobSearch', lang === 'en' ? 'özel 7' : 'ÖZEL 7');
    await page.waitForFunction(() => /1 \/ 36/.test(document.getElementById('postFobNote').textContent), null, { timeout: 10000 });
    await page.fill('#postFobSearch', 'DEMO-1007 dm307');
    await page.waitForFunction(() => /1 \/ 36/.test(document.getElementById('postFobNote').textContent), null, { timeout: 10000 });
    await page.fill('#postFobSearch', '');
    await page.waitForFunction(() => document.querySelectorAll('#postFobTable tr.oabPivotSubtotalRow').length === 4, null, { timeout: 10000 });
    // Görünüm sunucuya kaydedilir (gerçek route).
    await page.selectOption('#postFobSegment', 'import');
    await page.waitForFunction(() => document.querySelectorAll('#postFobTable tr.oabPivotSubtotalRow').length === 3, null, { timeout: 10000 });
    await page.waitForTimeout(600);
    const saved = await app.api('/api/postfob/state').then(response => response.json());
    assert.equal(saved.view.segment, 'import');
    assert.deepEqual(saved.view.rows.map(ref => ref.key), ['originCountry', 'mag']);
    assert.deepEqual(saved.view.filterValues, { season: ['S6'] });
    await page.selectOption('#postFobSegment', 'all');
    await page.waitForFunction(() => document.querySelectorAll('#postFobTable tr.oabPivotSubtotalRow').length === 4, null, { timeout: 10000 });
    // Hover: alt toplam ve genel toplam satırında metin zeminden ayrışır (iki tema).
    const luminance = color => { const scale = /^color\(srgb/.test(color) ? 255 : 1; const [r, g, b] = (color.match(/[\d.]+/g) || []).map(Number).map(value => value * scale); const f = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
    const contrastOn = async selector => {
      await page.hover(`${selector} td:nth-child(3)`); await page.waitForTimeout(450);
      const colors = await page.$eval(`${selector} td:nth-child(3)`, td => { const style = getComputedStyle(td); return { fg: style.color, bg: style.backgroundColor }; });
      const [a, b] = [luminance(colors.fg), luminance(colors.bg)].sort((x, y) => y - x);
      return { ...colors, ratio: (a + 0.05) / (b + 0.05) };
    };
    const hoverGrand = await contrastOn('#postFobTable tr.oabPivotGrandTotalRow');
    const hoverSubtotal = await contrastOn('#postFobTable tr.oabPivotSubtotalRow');
    assert.ok(hoverGrand.ratio >= 4.5, 'genel toplam hover kontrastı ' + JSON.stringify(hoverGrand));
    assert.ok(hoverSubtotal.ratio >= 4.5, 'alt toplam hover kontrastı ' + JSON.stringify(hoverSubtotal));
    if (process.argv.includes('--hover-shot')) {
      // Sürüm notu: fare genel toplam satırının üzerindeyken (düzeltme sonrası).
      await page.evaluate(() => { document.getElementById('postFobStatus').hidden = true; });
      await page.evaluate(() => {
        for (const hit of [...document.querySelectorAll('body *')].filter(el => /uyarı var|warnings —/.test(el.textContent || '') && !el.children.length)) {
          let host = hit; while (host && !host.querySelector('button')) host = host.parentElement;
          host?.querySelector('button')?.click();
        }
      });
      await page.waitForTimeout(500);
      const grand = await page.$eval('#postFobTable tr.oabPivotGrandTotalRow', row => { row.scrollIntoView({ block: 'center' }); const r = row.getBoundingClientRect(); const t = row.closest('table').getBoundingClientRect(); return { x: t.x, y: r.bottom, w: Math.min(t.width, document.querySelector('#postFobSection .intakeTableWrap').getBoundingClientRect().width) }; });
      await page.hover('#postFobTable tr.oabPivotGrandTotalRow td:nth-child(3)'); await page.waitForTimeout(500);
      const width = Math.min(1200, grand.w + 8), height = Math.max(380, Math.ceil(width / 3));
      const hoverShot = path.join(__dirname, `../public/release-notes/next-assets/pivot-total-hover-${theme}.png`);
      await page.screenshot({ path: hoverShot, clip: { x: Math.max(0, grand.x - 4), y: Math.max(0, grand.y - height + 6), width, height } });
      console.log(JSON.stringify({ hoverShot }));
    }
    // İlgisiz açılış bildirimi (demo kaynak uyarısı) görüntüyü kapatmasın.
    await page.evaluate(() => {
      const hit = [...document.querySelectorAll('body *')].filter(el => /uyarı var|warnings —/.test(el.textContent || '') && !el.children.length)[0];
      let host = hit;
      while (host && !host.querySelector('button')) host = host.parentElement;
      host?.querySelector('button')?.click();
    });
    await page.waitForTimeout(500);
    await page.evaluate(() => { document.activeElement?.blur?.(); window.BLPostFob.state.status = null; document.getElementById('postFobStatus').hidden = true; });
    await page.mouse.move(5, 5); await page.waitForTimeout(400);
    const box = await page.$eval('#postFobSection', el => { el.scrollIntoView({ block: 'start' }); const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
    const name = `postfob-cost-${theme}${lang === 'en' ? '-en' : ''}.png`;
    const screenshot = path.join(__dirname, '../public/release-notes/next-assets/' + name);
    fs.mkdirSync(path.dirname(screenshot), { recursive: true });
    await page.screenshot({ path: screenshot, clip: { x: Math.max(0, box.x - 4), y: Math.max(0, box.y - 4), width: Math.min(1400, box.w + 8), height: Math.max(Math.ceil((box.w + 8) / 3), Math.min(560, box.h + 8)) } });
    assert.deepEqual(app.errors, []);
    console.log(JSON.stringify({ screenshot, groups, kpis, outlierCells, hoverGrand, hoverSubtotal, box }));
  } finally { await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
