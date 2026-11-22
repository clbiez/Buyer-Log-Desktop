'use strict';
// Gerçek Buyer Log (anonim demo veri) Genel Bakış › Ticari sayfasında OAB (Küp)
// widget'ını ürün özellikleriyle (FİT, Silüet, Kumaş-malzeme tipi) sürer ve
// sürüm notu görselini üretir. Şirket içi SSAS küpüne (OAB_Cube) bu ortamdan
// erişilemediği için YALNIZ küp yanıtı veren /api/oab-cube/report ucu taklit
// edilir; satırlar ana küp satırları + Urun özellik satırlarının GERÇEK sunucu
// birleştirmesiyle (mergeProductAttributes) üretilir. /state, görünüm kaydı,
// OABPivotEngine toplamları, yerel filtre ve çizim gerçektir. Canlı küp
// doğrulaması değildir.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { start } = require('./lib/client-performance-app');
const cubeReport = require('../server/lib/oab-cube-report');

const FITS = ['Slim', 'Regular', 'Oversize'];
const SILHOUETTES = ['Düz', 'Bol'];
const FABRICS = ['Örme', 'Dokuma'];
function demoData() {
  const classes = [['DEMO TRİKO', ['DEMO KAZAK', 'DEMO HIRKA']], ['DEMO DOKUMA', ['DEMO GÖMLEK', 'DEMO PANTOLON']]];
  const rows = [], attrRows = [];
  let seq = 0;
  for (const [classGroup, list] of classes) {
    for (const classification of list) {
      for (let i = 0; i < 4; i++) {
        seq += 1;
        const modelCode = seq === 3 ? '3E8' : `DM${400 + seq}`, colourCode = seq === 3 ? '1E5' : `C${(i % 3) + 1}`;
        rows.push({
          season: 'S6', mag: 'DM1A', buyerGroup: 'DEMO GRUP', classGroup, classification,
          modelCode, modelName: `DEMO MODEL ${seq}`, colourCode, colourName: `DEMO RENK ${(i % 3) + 1}`,
          wssi: seq % 3 ? 600 + seq * 40 : 0, approved: 500 + seq * 35, plan: 700 + seq * 50, unapproved: seq % 4 ? 80 + seq * 5 : 0, poQty: 450 + seq * 30,
        });
        // Urun satırları: her model + renk tek FİT; iki option'da birden çok FİT ("Çoklu"),
        // biri hiç eşleşmez (boş) ve bir option'ın Urun satırı yinelenir (adet çoğalmamalı).
        if (seq === 16) continue;
        attrRows.push({ modelCode, colourCode, fit: FITS[seq % 3], silhouette: SILHOUETTES[seq % 2], fabricType: classGroup === 'DEMO TRİKO' ? FABRICS[0] : FABRICS[1] });
        if (seq === 2 || seq === 9) attrRows.push({ modelCode, colourCode, fit: FITS[(seq + 1) % 3], silhouette: SILHOUETTES[seq % 2], fabricType: classGroup === 'DEMO TRİKO' ? FABRICS[0] : FABRICS[1] });
        if (seq === 5) attrRows.push({ modelCode, colourCode, fit: FITS[seq % 3], silhouette: SILHOUETTES[seq % 2], fabricType: FABRICS[0] });
      }
    }
  }
  const main = cubeReport.normalizeRows(rows, {
    dimensions: Object.keys(rows[0]).filter(key => !cubeReport.MEASURES.some(item => item.key === key)),
    measures: ['wssi', 'approved', 'plan', 'unapproved', 'poQty'],
    derived: cubeReport.DERIVED_MEASURES.map(item => item.key),
  });
  return { main, attrRows };
}

(async () => {
  const theme = process.argv.includes('--dark') ? 'dark' : 'light';
  const lang = process.argv.includes('--en') ? 'en' : 'tr';
  const app = await start({ initScript: ([t, l]) => { try { localStorage.setItem('bl.user.moderator.lcw_theme', t); localStorage.setItem('bl.user.moderator.lcw.lang.v1', l); } catch (_) {} }, initArg: [theme, lang] });
  try {
    const { page } = app;
    const { main, attrRows } = demoData();
    const reports = [];
    await page.route('**/api/oab-cube/report', route => {
      const body = JSON.parse(route.request().postData() || '{}');
      reports.push(body);
      const view = cubeReport.normalizeView(body.view);
      const built = cubeReport.buildQuery({ view });
      const attributes = built.attributes;
      const merged = attributes.length ? cubeReport.mergeProductAttributes(main, cubeReport.normalizeProductAttributeRows(attrRows, attributes), attributes) : { rows: main, matchedRows: 0, multiRows: 0 };
      route.fulfill({ contentType: 'application/json', body: JSON.stringify({
        ok: true, view: body.view, rows: merged.rows, fetchedAt: new Date().toISOString(), filterValues: built.filterValues, missing: [], truncated: false, rowLimit: 20000,
        measures: [...built.measures, ...built.derived], dimensions: [...built.dimensions, ...attributes], dataDate: '2026-11-22T05:30:00', dataDateSource: 'GuncellemeTarih', fromCache: false,
        productAttributes: attributes.length ? { requested: attributes, fetched: attributes, missing: [], ok: true, code: '', truncated: false, chunks: 1, matchedRows: merged.matchedRows, multiRows: merged.multiRows, fromCache: false } : null,
      }) });
    });
    // Görünüm: Klasman grup › FİT satırları, Silüet sütunu, Kumaş-malzeme tipi yerel filtre, alt detayda üç özellik.
    const put = async body => { for (let attempt = 0; ; attempt++) { try { return await app.api('/api/oab-cube/view', body, 'PUT'); } catch (error) { if (attempt >= 8) throw error; await new Promise(resolve => setTimeout(resolve, 500)); } } };
    const initial = await app.api('/api/oab-cube/state').then(response => response.json());
    await put({ view: { ...initial.view, rows: [{ key: 'classGroup' }, { key: 'fit' }], columns: [{ key: 'silhouette' }], values: [{ key: 'wssi' }, { key: 'approved' }, { key: 'plan' }, { key: 'poQty' }], filters: [{ key: 'season' }, { key: 'mag' }, { key: 'fabricType' }], filterValues: { season: ['S6'] }, detailAttributes: ['fit', 'silhouette', 'fabricType'] } });
    await page.waitForFunction(() => window.BLOverviewHome && document.getElementById('oabCubeSection'), null, { timeout: 60000 });
    await page.evaluate(() => window.BLOverviewHome.goToPage(1));
    await page.waitForFunction(() => window.BLOabCube, null, { timeout: 60000 });
    await page.evaluate(() => document.getElementById('oabCubeSection').scrollIntoView({ block: 'start' }));
    await page.waitForFunction(() => window.BLOabCube.state.started && window.BLOabCube.state.catalog.dimensions.some(item => item.attribute), null, { timeout: 60000 })
      .catch(async error => { console.error(await page.evaluate(() => JSON.stringify({ started: window.BLOabCube.state.started, status: window.BLOabCube.state.status && String(typeof window.BLOabCube.state.status.copy === 'function' ? window.BLOabCube.state.status.copy() : window.BLOabCube.state.status.copy), dims: window.BLOabCube.state.catalog.dimensions.length, off: document.getElementById('oabCubeSection').className }))); throw error; });
    await page.click('#oabCubeRefreshBtn');
    await page.waitForFunction(() => document.querySelectorAll('#oabCubeTable tr.oabPivotGrandTotalRow').length === 1, null, { timeout: 20000 });
    assert.equal(reports.length, 1);
    const head = await page.textContent('#oabCubeTable thead');
    assert.match(head, lang === 'en' ? /Fit/ : /FİT/);
    assert.match(head, lang === 'en' ? /Silhouette/ : /Silüet/);
    // Adet değişmezliği: genel toplam ana satırların toplamıdır (özellik birleştirmesi çoğaltmaz).
    const fmt = value => value.toLocaleString(lang === 'en' ? 'en-GB' : 'tr-TR');
    const sum = (list, key) => list.reduce((total, row) => total + (row[key] || 0), 0);
    const grand = await page.textContent('#oabCubeTable tr.oabPivotGrandTotalRow');
    assert.ok(grand.includes(fmt(sum(main, 'approved'))), `Onaylı genel toplamı ${fmt(sum(main, 'approved'))}: ${grand}`);
    // Çoklu değer iki dilde; ipucu değerleri listeler.
    const multi = page.locator('#oabCubeTable td', { hasText: lang === 'en' ? 'Multiple' : 'Çoklu' }).first();
    assert.ok(await multi.count());
    assert.match(await multi.getAttribute('title'), /Oversize|Regular|Slim/);
    // Yerel filtre: Kumaş-malzeme tipi = Örme; küp sorgusu atılmaz, toplam yüklü satırlardan.
    await page.click('#oabCubeFiltersBtn');
    await page.click('[data-oab-cube-filter="fabricType"]');
    await page.waitForSelector('.intakeFilterPopover input[value="Örme"]', { timeout: 10000 });
    await page.check('.intakeFilterPopover input[value="Örme"]');
    await page.click('[data-oab-cube-apply]');
    await page.keyboard.press('Escape');
    const knit = main.filter((row, index) => index < 8); // DEMO TRİKO satırları (demoData sırası)
    await page.waitForFunction(text => document.querySelector('#oabCubeTable tr.oabPivotGrandTotalRow').textContent.includes(text), fmt(sum(knit, 'approved')), { timeout: 10000 });
    assert.equal(reports.length, 1, 'yerel filtre küp sorgusu atmaz');
    // Alt detay: özellik sütunları ve çoklu değer listesi.
    await page.locator('#oabCubeTable tbody tr:not(.oabPivotSubtotalRow):not(.oabPivotGrandTotalRow)').first().locator('td').last().dblclick();
    await page.waitForSelector('#blSharedDetailDrawer.is-open', { timeout: 10000 });
    const drawerText = await page.textContent('#blSharedDetailDrawer');
    assert.match(drawerText, lang === 'en' ? /Fabric-material type/ : /Kumaş-malzeme tipi/);
    { const hit = drawerText.match(/.{0,80}(attrMulti|__MULTI__).{0,80}/); assert.equal(hit && hit[0], null); }
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('#blSharedDetailDrawer.is-open'), null, { timeout: 10000 });
    // Excel: özellikler metin hücre, çoklu değer listesiyle; iç alan sütun olmaz.
    const [download] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), page.click('#oabCubeExcelExportBtn')]);
    const XLSX = require('xlsx');
    const book = XLSX.read(fs.readFileSync(await download.path()));
    const sourceRows = XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[1]]);
    assert.equal(sourceRows.length, 8);
    assert.equal(Object.keys(sourceRows[0]).some(key => /attrMulti/.test(key)), false);
    assert.ok(sourceRows.some(row => Object.values(row).some(value => /^(Çoklu|Multiple): /.test(String(value)))));
    const summary = JSON.stringify(XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[2]]));
    assert.match(summary, lang === 'en' ? /local filter/ : /yerel filtre/);
    // İlgisiz açılış bildirimi (demo kaynak uyarısı) görüntüyü kapatmasın.
    await page.evaluate(() => {
      const hit = [...document.querySelectorAll('body *')].filter(el => /uyarı var|warnings —/.test(el.textContent || '') && !el.children.length)[0];
      let host = hit;
      while (host && !host.querySelector('button')) host = host.parentElement;
      host?.querySelector('button')?.click();
    });
    await page.waitForTimeout(500);
    await page.evaluate(() => { document.activeElement?.blur?.(); });
    const box = await page.$eval('#oabCubeSection', el => { el.scrollIntoView({ block: 'start' }); const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
    // Filtre paneli açık: Kumaş-malzeme tipi yerel filtresi görünür (kaydırmadan sonra konumlanır).
    await page.click('#oabCubeFiltersBtn');
    await page.waitForFunction(() => !document.getElementById('oabCubeFilterPanel').hidden, null, { timeout: 10000 });
    await page.mouse.move(5, 5); await page.waitForTimeout(400);
    const name = `oab-cube-product-attributes-${theme}${lang === 'en' ? '-en' : ''}.png`;
    const screenshot = path.join(__dirname, '../public/release-notes/next-assets/' + name);
    fs.mkdirSync(path.dirname(screenshot), { recursive: true });
    const width = Math.min(1400, box.w + 8);
    await page.screenshot({ path: screenshot, clip: { x: Math.max(0, box.x - 4), y: Math.max(0, box.y - 4), width, height: Math.max(Math.ceil(width / 3), Math.min(680, box.h + 8)) } });
    assert.deepEqual(app.errors, []);
    console.log(JSON.stringify({ screenshot, box, reports: reports.length }));
  } finally { await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
