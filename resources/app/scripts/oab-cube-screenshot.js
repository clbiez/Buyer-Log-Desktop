'use strict';
// Gerçek Buyer Log (anonim demo veri) Genel Bakış › Ticari sayfasında OAB (Küp)
// widget'ını uçtan uca sürer ve sürüm notu görselini üretir. Şirket içi SSAS
// küpüne (OAB_Cube) bu ortamdan erişilemediği için YALNIZ küp yanıtı veren üç uç
// (/api/oab-cube/report, /distinct, /metadata) anonim sentetik satırlarla taklit
// edilir; /api/oab-cube/state, görünüm kaydı, OABPivotEngine toplamları ve
// bütün çizim gerçektir. Canlı küp doğrulaması değildir.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { start } = require('./lib/client-performance-app');

function demoRows() {
  const classes = [['DEMO TRİKO', ['DEMO KAZAK', 'DEMO HIRKA']], ['DEMO DOKUMA', ['DEMO GÖMLEK', 'DEMO PANTOLON']]];
  const rows = [];
  let seq = 0;
  for (const [classGroup, list] of classes) {
    for (const classification of list) {
      for (let i = 0; i < 4; i++) {
        seq += 1;
        rows.push({
          season: i % 2 ? 'W6' : 'S6', mag: seq % 3 ? 'DM1A' : 'DM2B', buyerGroup: 'DEMO GRUP', classGroup, classification,
          // "3E8" bilimsel gösterime kaymamalı: kod alanı metin kalır.
          modelCode: seq === 3 ? '3E8' : `DM${400 + seq}`, modelName: `DEMO MODEL ${seq}`, colourCode: seq === 3 ? '1E5' : `C${(i % 3) + 1}`, colourName: `DEMO RENK ${(i % 3) + 1}`,
          wssi: 600 + seq * 40, approved: 500 + seq * 35, plan: 700 + seq * 50, unapproved: seq % 4 ? 80 + seq * 5 : 0, buyingPeriodQty: 300 + seq * 10,
          reserveApproved: 0, fastApproved: seq % 5 ? 0 : 40, poQty: 450 + seq * 30, warehouseIn: 200 + seq * 20, eligibleBuy: null,
          plannedStores: 120 + (seq % 4) * 10, landedPrice: 4.1 + (seq % 3) * 0.35, markupYd: 2.4, markupYi: 2.1,
        });
      }
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
    const reports = [], distincts = [];
    await page.route('**/api/oab-cube/distinct', route => {
      const body = JSON.parse(route.request().postData() || '{}');
      distincts.push(body);
      const values = { season: ['S6', 'W6', 'S7'], mag: ['DM1A', 'DM2B'], buyerGroup: ['DEMO GRUP'] }[body.key] || [];
      // Aramalı yanıt sınıra ulaşmış gibi döner: seçici "aramayı daraltın" notunu göstermeli.
      route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, key: body.key, values, truncated: Boolean(body.search), limit: 1000 }) });
    });
    await page.route('**/api/oab-cube/metadata', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true,
      dimensions: [{ source: '[Data].[Hedef PSF]', table: 'Data', name: 'Hedef PSF', label: 'Hedef PSF', baseKey: '' }],
      measures: [{ source: '[Measures].[PO Adet Ydisi]', table: 'Measures', name: 'PO Adet Ydisi', label: 'PO Adet Ydisi', baseKey: '' }] }) }));
    await page.route('**/api/oab-cube/report', route => {
      const body = JSON.parse(route.request().postData() || '{}');
      reports.push(body);
      route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, view: body.view, rows, fetchedAt: new Date().toISOString(), filterValues: body.view.filterValues, missing: [], truncated: false, rowLimit: 20000, dataDate: '2026-11-22T05:30:00', dataDateSource: 'GuncellemeTarih', fromCache: false }) });
    });
    await page.waitForFunction(() => window.BLOverviewHome && document.getElementById('oabCubeSection'), null, { timeout: 60000 });
    await page.evaluate(() => window.BLOverviewHome.goToPage(1));
    // Widget Ticari sayfasında alt sırada: görünür olunca (IntersectionObserver) başlar.
    await page.waitForFunction(() => window.BLOabCube, null, { timeout: 60000 });
    await page.evaluate(() => document.getElementById('oabCubeSection').scrollIntoView({ block: 'start' }));
    await page.waitForFunction(() => window.BLOabCube && window.BLOabCube.state.started && !document.getElementById('oabCubeSection').classList.contains('ovHomeOff'), null, { timeout: 60000 });
    await page.waitForFunction(() => window.BLOabCube.state.catalog.dimensions.length > 0, null, { timeout: 30000 });
    // PASS'li OAB widget'ı yerinde ve aynı sayfada.
    assert.ok(await page.$('#oabSection[data-overview-widget="oab"]'));
    assert.ok(await page.evaluate(() => typeof window.OABPivotEngine === 'function'));
    // Sezonsuz yenileme engellenir ve filtre paneli açılır.
    await page.click('#oabCubeRefreshBtn');
    await page.waitForFunction(() => !document.getElementById('oabCubeFilterPanel').hidden, null, { timeout: 10000 });
    assert.equal(reports.length, 0);
    const pickValues = async (key, values) => {
      await page.click(`[data-oab-cube-filter="${key}"]`);
      await page.waitForSelector(`.intakeFilterPopover input[value="${values[0]}"]`, { timeout: 10000 });
      for (const value of values) await page.check(`.intakeFilterPopover input[value="${value}"]`);
      await page.click('[data-oab-cube-apply]');
    };
    await pickValues('season', ['S6', 'W6']);
    await pickValues('mag', ['DM1A', 'DM2B']);
    await page.keyboard.press('Escape');
    await page.click('#oabCubeRefreshBtn');
    // Varsayılan pivot: Klasman grup › Ürün klasmanı + alt toplam + Genel Toplam.
    await page.waitForFunction(() => document.querySelectorAll('#oabCubeTable tr.oabPivotSubtotalRow').length === 2, null, { timeout: 20000 });
    assert.equal(reports.length, 1, 'çoklu sezon × MAG tek istek');
    assert.deepEqual(reports[0].view.filterValues, { season: ['S6', 'W6'], mag: ['DM1A', 'DM2B'] });
    const leafRows = await page.$$eval('#oabCubeTable tbody tr:not(.oabPivotSubtotalRow):not(.oabPivotGrandTotalRow)', trs => trs.length);
    assert.equal(leafRows, 4);
    const grandText = await page.textContent('#oabCubeTable tr.oabPivotGrandTotalRow');
    const sum = key => rows.reduce((total, row) => total + (row[key] || 0), 0);
    const fmt = value => value.toLocaleString(lang === 'en' ? 'en-GB' : 'tr-TR');
    assert.ok(grandText.includes(fmt(sum('wssi'))), `WSSI genel toplamı ${fmt(sum('wssi'))}: ${grandText}`);
    assert.ok(grandText.includes(fmt(sum('approved'))), 'Onaylı genel toplamı');
    const meta = await page.textContent('#oabCubeStateMeta');
    assert.match(meta, lang === 'en' ? /Data date: / : /Veri tarihi: /);
    assert.match(await page.textContent('#oabCubePassGap'), lang === 'en' ? /Special code, Persona/ : /Özel Kod, Persona/);
    // Alt detay: kod alanı "3E8" metin olarak görünür.
    await page.locator('#oabCubeTable tbody tr:not(.oabPivotSubtotalRow):not(.oabPivotGrandTotalRow)', { hasText: 'DEMO KAZAK' }).locator('td').nth(2).dblclick();
    await page.waitForSelector('#blSharedDetailDrawer.is-open', { timeout: 10000 });
    const drawerText = await page.textContent('#blSharedDetailDrawer');
    assert.match(drawerText, /4 (kaynak satır|source rows)/);
    assert.match(drawerText, /3E8/);
    assert.match(drawerText, /1E5/);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('#blSharedDetailDrawer.is-open'), null, { timeout: 10000 });
    // Excel: pivot + kaynak satırlar (kod hücreleri metin) + filtre/kaynak özeti.
    const [download] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), page.click('#oabCubeExcelExportBtn')]);
    const XLSX = require('xlsx');
    const book = XLSX.read(fs.readFileSync(await download.path()));
    assert.equal(book.SheetNames.length, 3);
    const sourceSheet = book.Sheets[book.SheetNames[1]];
    const codeCell = Object.entries(sourceSheet).find(([, cell]) => cell && cell.v === '3E8');
    assert.ok(codeCell && codeCell[1].t === 's', 'Model kodu Excel’de metin hücre');
    assert.equal(XLSX.utils.sheet_to_json(sourceSheet).length, 16);
    const summaryText = JSON.stringify(XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[2]]));
    assert.match(summaryText, /2026-11-22T05:30:00/);
    // Pivot düzenleyici: küp ölçüsü havuzda; sütuna Sezon eklenince sorgu düzeyi değişmez (hazır boyut).
    await page.click('#oabCubeFieldsBtn');
    await page.waitForSelector('#_oabCubeFieldsModal [data-oab-cube-add="oabCubeValuesList"]', { timeout: 10000 });
    const valueOptions = await page.$$eval('#_oabCubeFieldsModal #oabCubeValuesList select.oabCubeValueField option', options => options.map(option => option.textContent));
    assert.ok(valueOptions.includes('PO Adet Ydisi'), 'küp ölçüsü değer havuzunda');
    await page.click('#_oabCubeFieldsModal [data-oab-cube-close]');
    // Arama: yalnız yüklü satırlarda (model kodu).
    await page.fill('#oabCubeSearch', '3e8');
    await page.waitForFunction(() => /1 \/ 16/.test(document.getElementById('oabCubeNote').textContent), null, { timeout: 10000 });
    await page.fill('#oabCubeSearch', '');
    await page.waitForFunction(() => document.getElementById('oabCubeNote').hidden, null, { timeout: 10000 });
    // Filtre değişip Yenile'ye basılmadıysa eski veri sessizce yeni filtrenin altında görünmez.
    await page.click('#oabCubeFiltersBtn');
    await page.click('[data-oab-cube-filter="mag"]');
    await page.waitForSelector('.intakeFilterPopover input[value="DM2B"]', { timeout: 10000 });
    await page.uncheck('.intakeFilterPopover input[value="DM2B"]');
    await page.click('[data-oab-cube-apply]');
    await page.waitForFunction(() => /farklı filtrelerle|different filters/.test(document.getElementById('oabCubeNote').textContent), null, { timeout: 10000 });
    // Eski veri dışa aktarılırken özet, satırları üreten filtreleri ve uyarıyı yazar.
    const [staleDownload] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), page.click('#oabCubeExcelExportBtn')]);
    const staleSummary = JSON.stringify(XLSX.utils.sheet_to_json(XLSX.read(fs.readFileSync(await staleDownload.path())).Sheets[lang === 'en' ? 'Filters' : 'Filtreler']));
    assert.match(staleSummary, /DM1A, DM2B/);
    assert.match(staleSummary, /farklı|differs/);
    // Filtre değer araması ilk 1.000 değerle sınırlı kalmaz: metin küpte aranır.
    await page.click('#oabCubeFiltersBtn');
    await page.waitForFunction(() => !document.getElementById('oabCubeFilterPanel').hidden, null, { timeout: 10000 });
    await page.click('[data-oab-cube-filter="mag"]');
    await page.waitForSelector('.intakeFilterPopover .intakeFilterSearch', { timeout: 10000 });
    await page.fill('.intakeFilterPopover .intakeFilterSearch', 'dm2');
    for (let i = 0; i < 40 && !distincts.some(body => body.key === 'mag' && body.search === 'dm2'); i++) await page.waitForTimeout(100);
    assert.ok(distincts.some(body => body.key === 'mag' && body.search === 'dm2'), 'arama küpe gider');
    await page.waitForFunction(() => { const n = document.querySelector('.intakeFilterPopover .oabCubeDistinctNote'); return n && !n.hidden && /aramayı daraltın|narrow the search/.test(n.textContent); }, null, { timeout: 10000 });
    await page.keyboard.press('Escape');
    await page.click('[data-oab-cube-filter="mag"]');
    await page.waitForSelector('.intakeFilterPopover input[value="DM2B"]', { timeout: 10000 });
    await page.check('.intakeFilterPopover input[value="DM2B"]');
    await page.click('[data-oab-cube-apply]');
    await page.waitForFunction(() => document.getElementById('oabCubeNote').hidden, null, { timeout: 10000 });
    await page.keyboard.press('Escape');
    assert.equal(reports.length, 1, 'filtre uygulaması sorgu atmaz');
    // Görünüm sunucuya kaydedilir (gerçek PUT route; rapor ucu taklit olduğu için
    // filtreler sıralama kaydıyla birlikte yazılır).
    // Sabit bekleme yerine kayıt yanıtı beklenir (zamanlamaya bağlı yanlış hata olmasın).
    await Promise.all([
      page.waitForResponse(response => /\/api\/oab-cube\/view$/.test(response.url()) && response.request().method() === 'PUT' && response.ok(), { timeout: 15000 }),
      page.click('#oabCubeTable thead th[data-oab-cube-sort="approved"]'),
    ]);
    const saved = await app.api('/api/oab-cube/state').then(response => response.json());
    assert.deepEqual(saved.view.filterValues, { season: ['S6', 'W6'], mag: ['DM1A', 'DM2B'] });
    assert.deepEqual(saved.view.rows.map(ref => ref.key), ['classGroup', 'classification']);
    assert.equal(saved.view.display.sort.key, 'approved');
    // İlgisiz açılış bildirimi (demo kaynak uyarısı) görüntüyü kapatmasın.
    await page.evaluate(() => {
      const hit = [...document.querySelectorAll('body *')].filter(el => /uyarı var|warnings —/.test(el.textContent || '') && !el.children.length)[0];
      let host = hit;
      while (host && !host.querySelector('button')) host = host.parentElement;
      host?.querySelector('button')?.click();
    });
    await page.waitForTimeout(500);
    await page.evaluate(() => { document.activeElement?.blur?.(); window.BLOabCube.state.status = null; document.getElementById('oabCubeStatus').hidden = true; });
    await page.mouse.move(5, 5); await page.waitForTimeout(400);
    const box = await page.$eval('#oabCubeSection', el => { el.scrollIntoView({ block: 'start' }); const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
    const name = `oab-cube-${theme}${lang === 'en' ? '-en' : ''}.png`;
    const screenshot = path.join(__dirname, '../public/release-notes/next-assets/' + name);
    fs.mkdirSync(path.dirname(screenshot), { recursive: true });
    await page.screenshot({ path: screenshot, clip: { x: Math.max(0, box.x - 4), y: Math.max(0, box.y - 4), width: Math.min(1400, box.w + 8), height: Math.max(Math.ceil((box.w + 8) / 3), Math.min(620, box.h + 8)) } });
    assert.deepEqual(app.errors, []);
    console.log(JSON.stringify({ screenshot, meta, leafRows, box }));
  } finally { await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
