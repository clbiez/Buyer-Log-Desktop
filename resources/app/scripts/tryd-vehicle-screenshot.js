'use strict';
// Gerçek Buyer Log (anonim demo veri): vasıtaya göre standart yurtdışı landed çarpanı.
// 1) Landed çarpanları penceresi: vasıta listesi GERÇEK sunucudan (demo IAS runtime'ı,
//    GET /api/landed-multipliers → knownVehicles); "Geçmiş veriden öner"; Kaydet GERÇEK PUT.
// 2) TR/YD widget'ı: durum satırın vasıta standardıyla; Vasıta › Model pivotu ve alt detay.
// Şirket içi SSAS modeline bu ortamdan erişilemediği için YALNIZ model yanıtı veren uçlar
// (/api/postfob/tryd/report, /api/postfob/distinct) ve onların önbelleğine bağlı öneri ucu
// taklit edilir; vasıta eki ve öneri, sunucunun kendi kütüphanesiyle (parse.js +
// server/lib/tryd-vehicle-index.js) demo IAS dosyasından hesaplanır.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const XLSX = require('xlsx');
const { start } = require('./lib/client-performance-app');
const engine = require('../public/tryd-advantage-engine');
const parse = require('../server/lib/parse');
const vehicleIndex = require('../server/lib/tryd-vehicle-index');

function demoRows(antrepoMap) {
  const index = vehicleIndex.buildIndex(antrepoMap);
  const single = { GEMI: [], TIR: [], UCAK: [] };
  for (const [order, slot] of index.orders) if (slot.parts.size === 1) { const key = [...slot.parts.keys()][0]; if (single[key]) single[key].push(order); }
  // Örnek sayısı: GEMI ve UÇAK eşiği geçer, TIR az örnekli kalır (öneri yok).
  single.TIR = single.TIR.slice(0, 3);
  const ratio = { GEMI: [1.06, 1.07, 1.08, 1.065, 1.075], TIR: [1.09, 1.1, 1.12], UCAK: [1.32, 1.36, 1.38, 1.41, 1.35] };
  const rows = [];
  const group = { buyerGroup: 'DEMO GRUP A', classification: 'DEMO TRİKO', mag: 'DMA1', season: 'S6', productName: 'DEMO ÜRÜN' };
  let modelNo = 100;
  for (const key of ['GEMI', 'UCAK', 'TIR']) {
    const orders = single[key];
    for (let i = 0; i < orders.length; i += 4) {
      modelNo += 1;
      const model = `DM${modelNo}`, trFob = 6 + (modelNo % 5) * 0.4, ydFob = 3.4 + (modelNo % 4) * 0.3;
      rows.push({ ...group, order: `TR-${modelNo}`, model, colour: 'C1', originCountry: 'TÜRKİYE', qty: 800, fob: trFob, landedActual: trFob * 1.02 });
      orders.slice(i, i + 4).forEach((order, j) => {
        for (const colour of ['C1', 'C2', 'C3']) {
          const r = ratio[key][(i + j) % ratio[key].length] + (colour === 'C2' ? 0.004 : 0);
          rows.push({ ...group, order, model, colour, originCountry: j % 2 ? 'ÇİN' : 'BANGLADEŞ', qty: 300 + j * 40, fob: ydFob, landedActual: Math.round(ydFob * r * 10000) / 10000 });
        }
      });
    }
  }
  // IAS'ta bulunmayan yurtdışı sipariş: vasıta bilinmiyor → genel standart.
  rows.push({ ...group, order: 'DEMO-YOK-1', model: `DM${modelNo}`, colour: 'C9', originCountry: 'PAKİSTAN', qty: 200, fob: 3.5, landedActual: 3.5 * 1.16 });
  return rows;
}

(async () => {
  const theme = process.argv.includes('--dark') ? 'dark' : 'light';
  const lang = process.argv.includes('--en') ? 'en' : 'tr';
  const L = (tr, en) => lang === 'en' ? en : tr;
  const app = await start({ demoRows: 600, initScript: ([t, l]) => { try { localStorage.setItem('bl.user.moderator.lcw_theme', t); localStorage.setItem('bl.user.moderator.lcw.lang.v1', l); } catch (_) {} }, initArg: [theme, lang] });
  try {
    const { page } = app;
    const antrepoMap = parse.parseAntrepoWorkbook(XLSX.readFile(path.join(app.root, 'source', 'Antrepo - Demo.xlsx')));
    const rows = demoRows(antrepoMap);
    const cache = { antrepoMap, loadedAt: new Date().toISOString() };
    await page.route('**/api/postfob/distinct', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, key: 'season', values: ['S6'] }) }));
    await page.route('**/api/postfob/tryd/report', route => {
      const body = JSON.parse(route.request().postData() || '{}');
      route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, view: engine.normalizePrefs(body.view), rows, fetchedAt: new Date().toISOString(), missing: [], truncated: false, rowLimit: 10000, fromCache: false, vehicles: vehicleIndex.payloadFor(rows, cache) }) });
    });
    await page.route('**/api/postfob/tryd/vehicle-suggestions', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, data: { ...vehicleIndex.suggestions(rows, cache), fetchedAt: new Date().toISOString(), filterValues: { season: ['S6'] }, truncated: false } }) }));

    // Başlangıç: vasıta standardı yok (gerçek sunucu).
    const initial = await app.api('/api/landed-multipliers').then(response => response.json());
    assert.equal(initial.multipliers.byVehicle, undefined, 'başlangıçta boş');
    assert.deepEqual(initial.knownVehicles.map(item => item.key).sort(), ['GEMI', 'TIR', 'UCAK'], JSON.stringify(initial.knownVehicles));

    await page.waitForFunction(() => window.BLOverviewHome && document.getElementById('trydAdvantageSection'), null, { timeout: 60000 });
    await page.evaluate(() => window.BLOverviewHome.goToPage(1));
    await page.evaluate(() => document.getElementById('trydAdvantageSection').scrollIntoView({ block: 'start' }));
    // Widget görünür olunca başlar (IntersectionObserver); sayfa geçişi gecikirse yeniden kaydırılır.
    await page.waitForFunction(() => {
      if (window.BLTrydAdvantage && !window.BLTrydAdvantage.state.started) { window.BLOverviewHome.goToPage(1); document.getElementById('trydAdvantageSection').scrollIntoView({ block: 'start' }); }
      return window.BLTrydAdvantage && window.BLTrydAdvantage.state.started && window.BLTrydAdvantage.state.filters.length > 0;
    }, null, { timeout: 60000, polling: 500 }).catch(async error => {
      console.error(JSON.stringify(await page.evaluate(() => ({ module: Boolean(window.BLTrydAdvantage), engine: Boolean(window.BLTrydAdvantageEngine), vehicles: Boolean(window.BLLandedVehicleStandards), state: window.BLTrydAdvantage && { started: window.BLTrydAdvantage.state.started, filters: window.BLTrydAdvantage.state.filters.length, status: window.BLTrydAdvantage.state.status }, off: document.getElementById('trydAdvantageSection').className }))), app.errors);
      throw error;
    });
    // Pivot: Vasıta › Model (gerçek tercih ucu).
    await app.api('/api/postfob/tryd/view', { view: { rows: ['vehicle'], filterValues: { season: ['S6'] }, values: ['trFob', 'ydFob', 'ydLanded', 'advantage', 'gap', 'ydQty', 'status'] } }, 'PUT');
    await page.evaluate(() => window.BLTrydAdvantage.reload());
    await page.waitForFunction(() => window.BLTrydAdvantage.state.view.rows.some(ref => ref.key === 'vehicle'), null, { timeout: 15000 });
    await page.click('#trydAdvantageRefreshBtn');
    await page.waitForFunction(() => document.querySelectorAll('#trydAdvantageTable tr.oabPivotGrandTotalRow').length === 1, null, { timeout: 20000 });
    const before = await page.evaluate(() => window.BLTrydAdvantage.state.analysis.scopeTotal.high);

    // 1) Landed çarpanları penceresi
    await page.evaluate(() => openLandedMultipliersModal());
    await page.waitForSelector('#_landedMultipliersModal [data-vehicle-input="UCAK"]', { timeout: 15000 });
    await page.click('#_landedVehicleSuggest');
    await page.waitForSelector('#_landedMultipliersModal [data-vehicle-apply="GEMI"]', { timeout: 15000 });
    await page.click('#_landedMultipliersModal [data-vehicle-apply="GEMI"]');
    await page.click('#_landedMultipliersModal [data-vehicle-apply="UCAK"]');
    assert.equal(await page.$('#_landedMultipliersModal [data-vehicle-apply="TIR"]'), null, 'TIR az örnekli: öneri yok');
    assert.match(await page.textContent('#_landedMultipliersModal [data-vehicle-suggestion="TIR"]'), lang === 'en' ? /No suggestion/ : /Öneri yok/);
    // Öneri kaydedilmez: sunucu hâlâ boş.
    assert.equal((await app.api('/api/landed-multipliers').then(response => response.json())).multipliers.byVehicle, undefined);
    await page.evaluate(() => document.activeElement && document.activeElement.blur());
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.waitForTimeout(300);
    const card = await page.$('#_landedMultipliersModal .landedMultiplierCard');
    const cardBox = await card.boundingBox();
    const out = name => { const file = path.join(__dirname, '../public/release-notes/next-assets/' + name); fs.mkdirSync(path.dirname(file), { recursive: true }); return file; };
    const modalShot = out(`landed-vehicle-standards-${theme}${lang === 'en' ? '-en' : ''}.png`);
    // Pencere ve arkasındaki karartılmış uygulama birlikte; en-boy 1.2–3.2 aralığında.
    const padX = Math.max(160, Math.ceil((cardBox.height * 1.35 - cardBox.width) / 2));
    await page.screenshot({ path: modalShot, clip: { x: Math.max(0, cardBox.x - padX), y: Math.max(0, cardBox.y - 12), width: Math.min(1440, cardBox.width + padX * 2), height: cardBox.height + 24 } });
    await page.click('#_landedMultiplierSave');
    await page.waitForFunction(() => !document.getElementById('_landedMultipliersModal'), null, { timeout: 15000 });
    const saved = await app.api('/api/landed-multipliers').then(response => response.json());
    assert.deepEqual(Object.keys(saved.multipliers.byVehicle).sort(), ['GEMI', 'UCAK'], JSON.stringify(saved.multipliers));

    // 2) TR/YD: standartlar olayla yeniden okunur; uçak satırları artık uçak standardıyla.
    await page.waitForFunction(() => Object.keys(window.BLTrydAdvantage.state.byVehicle || {}).length === 2, null, { timeout: 15000 });
    await page.waitForTimeout(300);
    const after = await page.evaluate(() => window.BLTrydAdvantage.state.analysis.scopeTotal.high);
    const expected = engine.analyze(rows, { standardMultiplier: saved.multipliers.overseas, byVehicle: saved.multipliers.byVehicle, vehicles: vehicleIndex.payloadFor(rows, cache).byOrder, target: 0.36 });
    assert.equal(after, expected.scopeTotal.high);
    // Not: öneri MEDYAN olduğu için o vasıtadaki satırların yaklaşık yarısı tanım gereği standardın üstünde kalır.
    assert.notEqual(after, before, `yüksek çarpanlı model ${before} → ${after}`);
    const tips = await page.$$eval('#trydAdvantageTable td.trydAdvantageStatusCell[title]', tds => tds.map(td => td.title));
    assert.ok(tips.some(tip => /Uçak|UCAK|Gemi|GEMI/i.test(tip) && /standar/i.test(tip)), tips.slice(0, 3).join(' | '));
    // Alt detay: satırın vasıtası ve kullanılan standardı varsayılan görünür sütunlardadır.
    const ucakModels = expected.models.filter(model => /uçak|ucak/i.test(model.vehicle)).map(model => model.model);
    const uIndex = await page.$$eval('#trydAdvantageTable tbody tr[data-tryd-row]', (trs, names) => trs.findIndex(tr => [...tr.cells].some(td => names.includes(td.textContent.trim()))), ucakModels);
    assert.ok(uIndex >= 0, 'uçak modeli');
    await page.dblclick(`#trydAdvantageTable tbody tr[data-tryd-row="${uIndex}"] td:last-child`);
    await page.waitForFunction(label => document.body.innerText.toLocaleUpperCase('tr-TR').includes(label), L('KULLANILAN STANDART', 'STANDARD USED').toLocaleUpperCase('tr-TR'), { timeout: 15000 }).catch(async error => { console.error((await page.evaluate(() => document.body.innerText)).slice(0, 3000)); throw error; });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    // Görsel: Vasıta › Model pivotu + uçak modelinin durum ipucu (ortak hızlı ipucu).
    await page.setViewportSize({ width: 1900, height: 1000 });
    // GEMI ve TIR grupları daraltılır: KPI, başlık ve UÇAK modelleri aynı karede.
    for (const key of ['GEMI', 'TIR']) await page.click(`#trydAdvantageTable [data-tryd-group-key='${JSON.stringify([key])}']`);
    await page.waitForTimeout(300);
    // Bildirim balonları (kayıt/uyarı) görseli örtmesin.
    await page.evaluate(() => {
      for (const el of [...document.body.querySelectorAll('*')]) {
        if (!/uyarı var|warnings —|kaydedildi|saved:/i.test(el.textContent || '') || el.closest('#trydAdvantageSection')) continue;
        if (getComputedStyle(el).position === 'fixed' && el.getBoundingClientRect().width < 700) el.remove();
      }
    });
    await page.evaluate(() => document.getElementById('trydAdvantageSection').scrollIntoView({ block: 'start' }));
    await page.waitForTimeout(400);
    const highUcak = await page.$$eval('#trydAdvantageTable tbody tr[data-tryd-row]', (trs, names) => trs.findIndex(tr => [...tr.cells].some(td => names.includes(td.textContent.trim())) && tr.querySelector('td.trydAdvantageHighMultiplier')), ucakModels);
    assert.ok(highUcak >= 0, 'yüksek çarpanlı uçak modeli');
    const cell = `#trydAdvantageTable tbody tr[data-tryd-row="${highUcak}"] td.trydAdvantageStatusCell`;
    const tip = await page.getAttribute(cell, 'title');
    assert.match(tip, lang === 'en' ? /highest landed\/FOB [\d.,]+ \(UCAK, standard [\d.,]+\)/ : /en yüksek Landed\/FOB [\d.,]+ \(UCAK, standart [\d.,]+\)/, tip);
    // Kaydırma ipucunu kapatır: önce hücre görünür yapılır, sonra fare üstüne getirilir.
    await page.evaluate(() => document.getElementById('trydAdvantageSection').scrollIntoView({ block: 'start' }));
    await page.waitForTimeout(300);
    await page.mouse.move(5, 5);
    await page.hover(cell);
    await page.waitForSelector('.blTip.isVisible', { timeout: 5000 });
    await page.waitForTimeout(250);
    const box = await page.evaluate(() => { const r = document.getElementById('trydAdvantageSection').getBoundingClientRect(); const top = Math.max(0, r.y); return { x: r.x, y: top, w: r.width, h: Math.min(r.bottom, window.innerHeight) - top }; });
    const shot = out(`tryd-vehicle-standard-${theme}${lang === 'en' ? '-en' : ''}.png`);
    await page.screenshot({ path: shot, clip: { x: Math.max(0, box.x - 4), y: Math.max(0, box.y - 4), width: Math.min(1900, box.w + 8), height: Math.max(Math.ceil((box.w + 8) / 3), Math.min(900, box.h + 8)) } });
    console.log(JSON.stringify({ modalShot, shot, before, after, byVehicle: saved.multipliers.byVehicle, coverage: expected.total.amounts, errors: app.errors }));
  } finally { await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
