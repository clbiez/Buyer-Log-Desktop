'use strict';
// Gerçek Buyer Log, izole demo veriyle: aşama süre modeli → Backlog Teslimat Riski.
// Üretim verisi okunmaz. Demo IAS satırlarına Global Lojistik kritik yol tarihleri
// (Yükleme Talep → Handover → Cut Off → Fiili Yükleme → ETA → Antrepo Giriş)
// eklenir; model sunucuda kurulur, ETA son gerçekleşen kilometre taşından gelir.
//   node scripts/stage-eta-ui-acceptance.js [çıktı-klasörü]
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict'), { spawn } = require('node:child_process');
const { chromium } = require('playwright');
const app = path.resolve(__dirname, '..'), root = fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-stage-eta-'));
const outDir = path.resolve(process.argv[2] || root);
const port = Number(process.env.BUYER_LOG_STAGE_ETA_PORT || 6497), base = `http://127.0.0.1:${port}`;
const env = { ...process.env, BUYER_LOG_CONFIG_PATH: path.join(root, 'config.json') };
for (const [key, dir] of Object.entries({ BUYER_LOG_DATA_ROOT: 'app', BUYER_LOG_SERVER_DATA_ROOT: 'server', BUYER_LOG_LOCAL_DATA_ROOT: 'local', BUYER_LOG_TEMP_ROOT: 'temp' })) {
  env[key] = path.join(root, dir); fs.mkdirSync(env[key], { recursive: true });
}
env.BUYER_LOG_AUTH_DATA_ROOT = env.BUYER_LOG_SERVER_DATA_ROOT;
env.BL_DATA_DIR = env.BUYER_LOG_SERVER_DATA_ROOT;
const source = path.join(root, 'source'); fs.mkdirSync(source);
fs.writeFileSync(env.BUYER_LOG_CONFIG_PATH, JSON.stringify({ port, host: '127.0.0.1', sourceFolder: source, updates: { enabled: false } }));

const SPARSE = process.env.BUYER_LOG_STAGE_ETA_SPARSE === '1';
const today = new Date();
const DAY = 86400000, t0 = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
const iso = offset => new Date(t0 + offset * DAY).toISOString().slice(0, 10);
let seed = 11;
const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const between = (a, b) => a + Math.floor(rand() * (b - a + 1));
// Deniz/kara/hava ayağı (Fiili Yükleme → ETA) ülkeye göre.
const LEG = { GEMI: { BANGLADES: 38, CIN: 34, MISIR: 7, TURKIYE: 2, Georgia: 9, FAS: 6 }, TIR: { BANGLADES: 20, CIN: 18, MISIR: 6, TURKIYE: 2, Georgia: 5, FAS: 7 }, UCAK: {} };
const leg = (vehicle, country) => (LEG[vehicle] && LEG[vehicle][country]) || (vehicle === 'UCAK' ? 3 : 6);
function chain(vehicle, country, loadingRequest) {
  const handover = loadingRequest + between(2, 5), cutOff = handover + between(2, 5), actualLoading = cutOff + between(1, 3);
  const eta = actualLoading + leg(vehicle, country) + between(-3, 3);
  const summary = eta + between(0, 2), warehouse = summary + between(0, 1), transit = warehouse + between(0, 2), entry = transit + between(1, 3);
  const docs = eta - between(-2, 6); // çoğunlukla ETA'dan önce; bazen geç (paralel süreç)
  return { loadingRequest, handover, cutOff, actualLoading, eta, summary, warehouse, transit, entry, docs };
}

const demo = require('./generate-demo-data').build({ rows: 160, seed: 7, today });
const countryOf = new Map(demo.asas.slice(3).map(row => [row[0], row[15]]));
const header = demo.antrepo[0];
const extra = ['Yükleme Talep Tarih', 'Cut Off Tarih', 'Fiili Yükleme Tarih', 'ETA Tarih', 'Antrepo Giriş Tarihi', 'Ürün Menşei', 'Özet Beyan Onay Tarih', 'Ambar Onay Tarih', 'Transit Beyanname Tarih', 'Evrak Teslim Tarih'];
const H = name => header.indexOf(name);
const antrepo = [[...header, ...extra]];
let transitCount = 0;
for (const row of demo.antrepo.slice(1)) {
  const status = row[H('Supplier Portal Statü')], vehicle = row[H('Vasita Tanim')], country = countryOf.get(row[0]) || 'BANGLADES';
  const out = [...row, '', '', '', '', '', country, '', '', '', ''];
  const set = (name, value) => { const i = header.includes(name) ? H(name) : header.length + extra.indexOf(name); out[i] = value == null ? '' : iso(value); };
  if (status === 'Depoda') {
    const c = chain(vehicle, country, -between(60, 120));
    set('Yükleme Talep Tarih', c.loadingRequest); set('HANDOVER Tarihi', c.handover); set('Cut Off Tarih', c.cutOff);
    set('Fiili Yükleme Tarih', c.actualLoading); set('ETA Tarih', c.eta); set('Antrepo Giriş Tarihi', c.entry);
    // Depodaki parsiyelde IAS antrepo tarihi gerçekleşen girişle aynı (demo tutarlılığı).
    if (header.includes('Tahmini Antrepo Giriş Tarihi')) set('Tahmini Antrepo Giriş Tarihi', c.entry);
    set('Özet Beyan Onay Tarih', c.summary); set('Ambar Onay Tarih', c.warehouse); set('Transit Beyanname Tarih', c.transit); set('Evrak Teslim Tarih', c.docs);
  } else if (status === 'Yolda') {
    // Yüklendi; ETA gelecekte (gemi tarifesi) ya da geçmiş ama gümrük açık.
    transitCount += 1;
    // Çoğu yeni yüklenmiş (ETA gelecekte); her dördüncüsü ETA'yı geçmiş, gümrük açık.
    const shift = transitCount % 4 === 0 ? -between(45, 60) : -between(8, 14);
    // SPARSE: ETA'sı geçmiş olanlar gümrükte; sonraki adımların sütunu yok (gerçek sorgu gibi).
    if (SPARSE && transitCount % 4 === 0) out[H('Supplier Portal Statü')] = 'Gümrük-Liman Operasyonları'; // i18n-ignore
    const c = chain(vehicle, country, shift);
    set('Yükleme Talep Tarih', c.loadingRequest); set('HANDOVER Tarihi', c.handover);
    // SPARSE: gerçek Backlog/CP sorgusu gibi yoldaki parsiyelde yalnız Talep + Handover.
    if (!SPARSE) { set('Cut Off Tarih', c.cutOff); set('Fiili Yükleme Tarih', c.actualLoading); set('ETA Tarih', c.eta); }
  } else if (status === 'Yüklemede') {
    const c = chain(vehicle, country, -between(4, 18));
    set('Yükleme Talep Tarih', c.loadingRequest);
    if (transitCount++ % 2 === 0) set('HANDOVER Tarihi', c.handover);
  }
  antrepo.push(out);
}
// Model örneklemi: her ülke × taşıt için antrepoya girmiş geçmiş parsiyeller
// (ASAS siparişine bağlanmayan dosyalar; ülke "Ürün Menşei" sütunundan).
let historyCode = 9800000;
for (const country of ['BANGLADES', 'CIN', 'MISIR', 'TURKIYE', 'Georgia', 'FAS']) {
  for (const vehicle of ['GEMI', 'TIR', 'UCAK']) {
    for (let i = 0; i < 9; i += 1) {
      const c = chain(vehicle, country, -between(70, 300));
      const out = new Array(header.length + extra.length).fill('');
      out[H('Sipariş Kod')] = historyCode++; out[H('Model Adı')] = 'DEMO HISTORY'; out[H('Renk Kod')] = 'H00'; out[H('Renk Tanım')] = 'DEMO';
      out[H('Supplier Portal Statü')] = 'Depoda'; out[H('Vasita Tanim')] = vehicle; out[H('Yükleme Toplam Adet')] = 1000; out[H('Net Alım Sipariş Miktarı')] = 1000;
      out[H('HANDOVER Tarihi')] = iso(c.handover); out[H('Tahmini Antrepo Giriş Tarihi')] = iso(c.entry);
      const at = name => header.length + extra.indexOf(name);
      out[at('Yükleme Talep Tarih')] = iso(c.loadingRequest); out[at('Cut Off Tarih')] = iso(c.cutOff); out[at('Fiili Yükleme Tarih')] = iso(c.actualLoading);
      out[at('ETA Tarih')] = iso(c.eta); out[at('Antrepo Giriş Tarihi')] = iso(c.entry); out[at('Ürün Menşei')] = country;
      out[at('Özet Beyan Onay Tarih')] = iso(c.summary); out[at('Ambar Onay Tarih')] = iso(c.warehouse); out[at('Transit Beyanname Tarih')] = iso(c.transit); out[at('Evrak Teslim Tarih')] = iso(c.docs);
      antrepo.push(out);
    }
  }
}
/* SPARSE: gerçek Backlog/CP IAS sorgusunun sütun kümesi — Cut Off, Fiili Yükleme,
   Özet Beyan, Ambar Onay ve Transit Beyanname sütunları dosyada HİÇ yok. */
if (SPARSE) {
  const drop = new Set(['Cut Off Tarih', 'Fiili Yükleme Tarih', 'Özet Beyan Onay Tarih', 'Ambar Onay Tarih', 'Transit Beyanname Tarih'].map(name => antrepo[0].indexOf(name)).filter(i => i >= 0));
  for (let r = 0; r < antrepo.length; r += 1) antrepo[r] = antrepo[r].filter((_, i) => !drop.has(i));
}
const XLSX = require('xlsx');
for (const [name, rows] of [['ASAS', demo.asas], ['Antrepo', antrepo]]) {
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name); XLSX.writeFile(wb, path.join(source, `${name} - Demo.xlsx`));
}

const log = fs.openSync(path.join(root, 'server.log'), 'a');
const server = spawn(process.execPath, ['server/server.js'], { cwd: app, env, stdio: ['ignore', log, log] });
let browser, cookie;
async function api(url, body, method) {
  const res = await fetch(base + url, { method: method || (body ? 'POST' : 'GET'), headers: { cookie: cookie || '', 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  assert.ok(res.ok, `${url}: ${await res.clone().text()}`); return res;
}
async function shot(page, top, bottom, file) {
  const a = await page.locator(top).boundingBox(), b = await page.locator(bottom).boundingBox();
  const x = Math.max(0, Math.min(a.x, b.x) - 8), y = Math.max(0, a.y - 8);
  const width = Math.max(a.x + a.width, b.x + b.width) - x + 8;
  let height = b.y + b.height - y + 8;
  height = Math.max(height, width / 3.1);
  await page.screenshot({ path: file, clip: { x, y, width, height } });
}
(async () => {
  console.log('Artifacts:', root);
  let ready = false;
  for (let i = 0; i < 160; i++) { try { ready = (await fetch(base + '/api/health')).status < 500; if (ready) break; } catch {} await new Promise(r => setTimeout(r, 250)); }
  assert.ok(ready, 'demo server did not start; see server.log');
  const login = await api('/api/user-login', { userId: 'moderator', newPassword: 'demo-stage-eta-123', password: 'demo-stage-eta-123' });
  cookie = login.headers.get('set-cookie').split(';')[0];
  // Ekran görüntüsünde gerçek kişi adı görünmesin: demo moderatör adı.
  await api('/api/users/moderator', { displayName: 'Demo Moderatör', reason: 'demo' }, 'PUT');
  // Statik karşılaştırma ölçütü: taşıt başına tek kural günü (Handover + gün).
  const rules = [['Gemi', 52], ['Tır', 24], ['Uçak', 9]].map(([delType, days], i) => ({ id: `demo-${i}`, exfStart: '', exfEnd: '', seasons: [], countries: [], delType, days }));
  await api('/api/transit-rules', { rules }, 'PUT');
  // Priority Rules ile paralel: moderatör kuralı "Aşama gecikmesi ≥ 1σ → Bugün Aksiyon".
  await api('/api/cp-managed-rules', { rules: [{ id: 'stage-sigma-demo', kind: 'priority', name: 'Aşama gecikmesi ≥ 1σ', enabled: true, target: 'ACTION_TODAY', // i18n-ignore
    conditions: [{ field: '@stageDelaySigma', operator: 'gte', value: 1 }] }] }, 'PUT');
  await api('/api/refresh', {});
  for (let i = 0; i < 160; i++) { if (!(await (await api('/api/refresh-status')).json()).running) break; await new Promise(r => setTimeout(r, 250)); }
  const saved = await (await api('/api/transit-analysis/stage-model', { scope: 'company', window: 'y1' })).json();
  assert.equal(saved.analysis.kind, 'stageModel');
  assert.ok(saved.analysis.stats.used >= 100, `model sample ${saved.analysis.stats.used}`);
  const rows = (await (await api('/api/backlog-export?format=json')).json()).rows;
  const projected = rows.filter(r => r._backlogExcel && r._backlogExcel.stageProjection);
  assert.ok(projected.length >= 5, `projected partials ${projected.length}`);
  assert.ok(projected.some(r => r._backlogExcel.stageProjection.openOverrunDays > 0), 'an open stage overrun exists');

  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 }, deviceScaleFactor: 2, reducedMotion: 'reduce' });
  const split = cookie.indexOf('='); await context.addCookies([{ name: cookie.slice(0, split), value: cookie.slice(split + 1), domain: '127.0.0.1', path: '/', httpOnly: true }]);
  await context.addInitScript(() => localStorage.setItem('bl.releaseNotes.lastSeenStable.v1', '99.0.0'));
  const page = await context.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message)); page.on('dialog', d => d.dismiss());
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof switchTab === 'function', null, { timeout: 60000 });
  await page.getByText(/Buyer Log'a devam et|Continue to Buyer Log/).click({ timeout: 4000 }).catch(() => {});
  await page.waitForFunction(() => !document.getElementById('blBootGuard'), null, { timeout: 60000 });
  await page.evaluate(async () => { applyLanguage('tr'); switchTab('backlog'); await BLPerf.ensureFeature('backlogAnalysis'); });
  const section = page.locator('#backlogAnalysis [data-fold="stageModel"]');
  await section.waitFor({ timeout: 60000 });
  await section.scrollIntoViewIfNeeded();
  const counts = await page.evaluate(() => [...document.querySelectorAll('#backlogAnalysis [data-stage-signal] .bdaKpiValue')].map(e => e.textContent.trim()));
  assert.ok(counts.length === 5, 'five stage signal cards');
  await page.waitForTimeout(300);
  fs.mkdirSync(outDir, { recursive: true });
  await page.evaluate(() => { const t = document.getElementById('_toast'); if (t) t.remove(); });
  await shot(page, '#backlogAnalysis [data-fold="stageModel"]', '#backlogAnalysis [data-fold="stageModel"]', path.join(outDir, 'backlog-stage-eta-forecast.png'));
  // P80 seçimi aynı ekranda ETA'yı temkinli istatistiğe çevirir.
  await page.selectOption('#backlogAnalysis [data-control="etaStat"]', 'p80');
  await page.locator('#backlogAnalysis [data-fold="stageModel"]').waitFor();
  assert.match(await page.locator('#backlogAnalysis [data-fold="stageModel"] .bdaFoldSummary').textContent(), /P80/);
  // Kırılım detayı aşama kolonlarını taşır.
  await page.locator('#backlogAnalysis [data-stage-signal="projected"]').click();
  await page.getByText('Aşama ETA (P80)').first().waitFor({ timeout: 20000 });
  await page.getByText('Koşan Aşama').first().waitFor({ timeout: 5000 });
  await page.keyboard.press('Escape').catch(() => {});

  // Yol Süreleri penceresi: aşama süre modeli bölümü.
  await page.evaluate(() => { document.querySelectorAll('.bpaDrawerRoot,.blDetailDrawer').forEach(e => e.remove()); openTransitRulesModal(); });
  const model = page.locator('.trxStageModel');
  await model.waitFor({ timeout: 60000 });
  await page.locator('.trxStageModel table').waitFor({ timeout: 60000 });
  await model.scrollIntoViewIfNeeded();
  // Önceki çekmecenin bilgi balonu görüntüye girmesin (sabit konumlu üst öğe gizlenir).
  await page.evaluate(() => {
    for (const el of document.querySelectorAll('body *')) {
      if (!/Satırlar yükleniyor|Loading rows/.test(el.textContent || '') || el.children.length > 4) continue;
      let node = el; while (node && node !== document.body && getComputedStyle(node).position !== 'fixed') node = node.parentElement;
      if (node && node !== document.body) node.style.display = 'none';
    }
  });
  await page.waitForTimeout(300);
  assert.match(await model.textContent(), /Demo Moderatör/);
  assert.doesNotMatch(await model.textContent(), /Tahmini kalan/);
  await shot(page, '.trxStageModel', '.trxStageModel', path.join(outDir, 'transit-stage-model.png'));
  // CP Tracker: yeni sütunlar varsayılan gizli; kullanıcı açınca en geç parsiyel,
  // Ex→Retail hücresinde statik ETA farkı, alt detayda parsiyel bazında aşama.
  await page.evaluate(() => { document.querySelectorAll('.warnOverlay,.modalOverlay').forEach(e => e.remove()); });
  const targets = [...new Set(projected.filter(r => /Yolda/.test(r['GÜNCEL DURUM\n(STATUS)'] || '')).map(r => String(r['Sipariş Kod'])))].slice(0, 4); // i18n-ignore
  const target = targets.join(', ');
  await page.setViewportSize({ width: 1920, height: 1000 });
  await page.evaluate(() => switchTab('cp'));
  for (let i = 0; i < 60; i++) { if (await page.evaluate(() => !!document.querySelector('#cpTable tbody tr[data-id]'))) break; await page.waitForTimeout(1000); }
  const defaults = await page.evaluate(() => ({ cp: ['Stage ETA', 'Current Stage'].every(k => colmgr.cp.hidden.has(k)), orders: ['Stage ETA', 'Current Stage'].every(k => colmgr.orders.hidden.has(k)) }));
  assert.deepEqual(defaults, { cp: true, orders: true }, 'yeni sütunlar varsayılan gizli');
  await page.evaluate(() => {
    colmgr.cp.hidden.delete('Stage ETA'); colmgr.cp.hidden.delete('Current Stage');
    CP_COLS.filter(c => c.group === 'Kumaş Detayları' || ['Original Ex-factory', 'OPD', 'LT', 'In-Store (Model Budget)', 'Del. Type'].includes(c.k)).forEach(c => colmgr.cp.hidden.add(c.k));
    saveAutoTableColumnState(); renderCP();
  });
  await page.fill('#cpSearch', target); await page.keyboard.press('Enter');
  await page.waitForTimeout(3000);
  await page.evaluate(() => { const tr = document.querySelector('#cpTable tbody tr[data-id]'); state.cpLogisticExpanded.add(Number(tr.dataset.id)); renderCP(); });
  await page.waitForTimeout(2500);
  const cells = await page.evaluate(() => ({ exr: document.querySelector('#cpTable tbody td[data-key="Ex→Retail"] .cpStageShift')?.textContent || '',
    eta: document.querySelector('#cpTable tbody td[data-key="Stage ETA"]')?.textContent.trim() || '', run: document.querySelector('#cpTable tbody td[data-key="Current Stage"]')?.textContent.trim() || '',
    detail: document.querySelectorAll('.cpLogisticDetailLine.hasStage .cpLogisticStage strong').length,
    shiftColor: getComputedStyle(document.querySelector('.cpLogisticStage .cpStageShift') || document.body).color }));
  assert.match(cells.exr, /^\d+ g (erken|geç)$|Statik ETA ile aynı/, 'Ex→Retail ikinci satırı');
  if (!SPARSE) assert.match(cells.run, /σ/, 'Koşan Aşama σ gösterir');
  assert.match(cells.eta, /\d{2}\.\d{2}\.\d{2}/);
  assert.ok(cells.run.length > 3 && cells.detail >= 1, JSON.stringify(cells));
  await page.evaluate(() => { const th = [...document.querySelectorAll('#cpTable thead tr:last-child th')].find(e => /Retail Date|Retail Tarihi/i.test(e.textContent)); const wrap = document.getElementById('cpTableWrap'); if (th && wrap) wrap.scrollLeft += th.getBoundingClientRect().left - wrap.getBoundingClientRect().left - 8; });
  await page.evaluate(() => { const t = document.getElementById('_toast'); if (t) t.remove(); });
  await page.waitForTimeout(600);
  const box = await page.locator('#cpTableWrap').boundingBox();
  await page.screenshot({ path: path.join(outDir, 'cp-stage-columns.png'), clip: { x: box.x, y: box.y, width: box.width, height: Math.min(box.height, Math.max(560, Math.ceil(box.width / 3))) } });
  console.log('CP', JSON.stringify(cells));
  // σ ≥ 1 olan yoldaki sipariş kuralla Bugün Aksiyon; σ verisi olmayan sipariş etkilenmez.
  await page.fill('#cpSearch', ''); await page.keyboard.press('Enter');
  let prio = null;
  for (let i = 0; i < 60 && !prio; i++) {
    prio = await page.evaluate(() => {
      const rows = (state.cp && state.cp.rows) || [];
      const hit = rows.find(r => Number(r._stageMaxSigma) >= 1 && r.Priority && !/^\s*$/.test(String(r.Priority)));
      const none = rows.filter(r => r._stageMaxSigma == null);
      if (!hit) return null;
      return { code: hit['Order Code'], priority: hit.Priority, sigma: hit._stageMaxSigma, noneRaised: none.filter(r => r.Priority === 'ACTION_TODAY').length };
    });
    if (!prio) await page.waitForTimeout(1000);
  }
  assert.ok(prio && prio.priority === 'ACTION_TODAY', `σ kuralı: ${JSON.stringify(prio)}`);
  assert.equal(prio.noneRaised, 0, 'aşama verisi olmayan sipariş kuraldan etkilenmez');
  await page.fill('#cpSearch', String(prio.code)); await page.keyboard.press('Enter');
  await page.waitForTimeout(2500);
  await page.evaluate(() => { const wrap = document.getElementById('cpTableWrap'); if (wrap) wrap.scrollLeft = 0; state.cpLogisticExpanded.clear(); renderCP(); });
  await page.waitForTimeout(1500);
  console.log('PRIORITY', JSON.stringify(prio));
  // Görüntü: Priority ile aşama sütunları yan yana (kullanıcının Sütunlar panelinden yapabileceği gibi).
  const stageCodes = await page.evaluate(() => {
    const withStage = state.cp.rows.filter(r => r._stageMaxSigma != null).sort((a, b) => b._stageMaxSigma - a._stageMaxSigma);
    return [...withStage.filter(r => r._stageMaxSigma >= 1).slice(0, 4), ...withStage.filter(r => r._stageMaxSigma < 1).slice(0, 3)].map(r => String(r['Order Code'])).join(', ');
  });
  await page.fill('#cpSearch', stageCodes); await page.keyboard.press('Enter');
  await page.evaluate(() => {
    const keep = new Set(['Priority', 'Order Code', 'Ex→Retail', 'STATUS', 'Ant. Arrival', 'Stage ETA', 'Current Stage']);
    CP_COLS.forEach(c => { if (keep.has(c.k)) colmgr.cp.hidden.delete(c.k); else colmgr.cp.hidden.add(c.k); });
    saveAutoTableColumnState(); renderCP();
  });
  await page.waitForTimeout(3000);
  await page.evaluate(() => { const t = document.getElementById('_toast'); if (t) t.remove(); const wrap = document.getElementById('cpTableWrap'); if (wrap) wrap.scrollLeft = 0; });
  const pbox = await page.locator('#cpTableWrap').boundingBox();
  await page.screenshot({ path: path.join(outDir, 'cp-stage-priority.png'), clip: { x: pbox.x, y: pbox.y, width: pbox.width, height: Math.min(pbox.height, Math.max(420, Math.ceil(pbox.width / 3.1))) } });
  {
    /* Depoya girmiş parsiyel: gerçekleşen Handover → Antrepo süresi; yoldaki
       parsiyelin farkı işaretsiz ("6 g geç") ve üzerine gelince kalemleri. */
    const mixedDone = await page.evaluate(() => {
      const rows = (state.cp && state.cp.rows) || [];
      const segs = r => (Array.isArray(r._logisticSegments) ? r._logisticSegments : []);
      const done = rows.find(r => segs(r).some(s => cpSegmentRealized(r, s) && cpSegmentRealized(r, s).ruleDays != null));
      const live = rows.find(r => segs(r).some(s => s.stage && s.stage.why && s.stage.vsRule < 0)) || rows.find(r => segs(r).some(s => s.stage && s.stage.why));
      return done && live ? [done, live].map(r => String(r['Order Code'])).join(', ') : null;
    });
    assert.ok(mixedDone, 'depoda ve yolda parsiyelli siparişler');
    await page.fill('#cpSearch', mixedDone); await page.keyboard.press('Enter');
    await page.waitForTimeout(2500);
    await page.evaluate(() => {
      const keep = new Set(['Priority', 'Order Code', 'Ex→Retail', 'STATUS', 'Ant. Arrival', 'Stage ETA', 'Current Stage', 'Order Quantity']);
      CP_COLS.forEach(c => { if (keep.has(c.k)) colmgr.cp.hidden.delete(c.k); else colmgr.cp.hidden.add(c.k); });
      saveAutoTableColumnState(); state.cpLogisticExpanded.clear();
      document.querySelectorAll('#cpTable tbody tr[data-id]').forEach(tr => state.cpLogisticExpanded.add(Number(tr.dataset.id))); renderCP();
    });
    await page.waitForTimeout(2500);
    const info = await page.evaluate(() => ({
      realized: [...document.querySelectorAll('.cpLogisticStage[title*="Handover → Antrepo"]')].map(e => ({ text: e.textContent.trim(), title: e.title })),
      why: [...document.querySelectorAll('.cpLogisticStage .cpStageShift[title]')].map(e => ({ text: e.textContent.trim(), title: e.title })),
    }));
    console.log('REALIZED', JSON.stringify(info).slice(0, 1500));
    assert.ok(info.realized.length >= 1 && /^\d+ g/.test(info.realized[0].text), 'gerçekleşen süre');
    assert.ok(info.why.some(w => /Nedenleri:/.test(w.title) && /Model ortalaması/.test(w.title)), 'fark kalemleri tooltip');
    assert.ok(info.why.every(w => !/-\d/.test(w.text)), 'işaretsiz yön');
    await page.evaluate(() => { const t = document.getElementById('_toast'); if (t) t.remove(); const wrap = document.getElementById('cpTableWrap'); if (wrap) wrap.scrollLeft = 0; });
    await page.waitForTimeout(600);
    const rbox = await page.locator('#cpTableWrap').boundingBox();
    await page.screenshot({ path: path.join(outDir, 'cp-stage-realized.png'), clip: { x: rbox.x, y: rbox.y, width: rbox.width, height: Math.min(rbox.height, Math.max(480, Math.ceil(rbox.width / 3.2))) } });
  }
  {
    // Partial View: Ex→Retail ikinci satırı grubun parsiyellerinden; depoda gerçekleşen.
    await page.evaluate(() => { setPartialView('cp', true); renderCP(); });
    await page.waitForTimeout(2500);
    const pv = await page.evaluate(() => [...document.querySelectorAll('#cpTable tbody td[data-key="Ex→Retail"] .cpStageShift')].map(e => ({ text: e.textContent.trim(), title: e.title.split('\n')[0] })));
    console.log('PARTIAL', JSON.stringify(pv));
    assert.ok(pv.some(x => /^✓ \d+ g · \d+ g (erken|geç)$/.test(x.text) && /^Gerçekleşen/.test(x.title)), 'Partial View depoda satırı gerçekleşen süre');
    const stageCells = await page.evaluate(() => [...document.querySelectorAll('#cpTable tbody tr[data-id]')].map(tr => ({ status: tr.querySelector('td[data-key="STATUS"]')?.textContent.trim() || '', eta: tr.querySelector('td[data-key="Stage ETA"]')?.textContent.trim() || '' })));
    assert.ok(stageCells.filter(c => /ÜRETİMDE|Üretimde|DEPODA|Depoda/.test(c.status)).every(c => !c.eta), `üretimde/depoda grubunda aşama ETA yok: ${JSON.stringify(stageCells)}`);
    assert.ok(pv.some(x => /^\d+ g (erken|geç)$|Statik ETA ile aynı/.test(x.text)), 'Partial View yolda satırı aşama farkı');
    await page.evaluate(() => { state.cpLogisticExpanded.clear(); renderCP(); const wrap = document.getElementById('cpTableWrap'); if (wrap) wrap.scrollLeft = 0; const t = document.getElementById('_toast'); if (t) t.remove(); });
    await page.waitForTimeout(1500);
    const vbox = await page.locator('#cpTableWrap').boundingBox();
    await page.screenshot({ path: path.join(outDir, 'cp-partial-view-realized.png'), clip: { x: vbox.x, y: vbox.y, width: vbox.width, height: Math.min(vbox.height, Math.max(420, Math.ceil(vbox.width / 3.2))) } });
    await page.evaluate(() => { setPartialView('cp', false); renderCP(); });
  }
  if (SPARSE) {
    /* Yoldaki parsiyel (yalnız Talep + Handover) sahte "Handover → Cut-off"
       aşımı üretmez; Buyer Log'un ürettiği üretimde parsiyeli sipariş yükleme
       onayını devralmaz. */
    const mixed = await page.evaluate(() => {
      const rows = (state.cp && state.cp.rows) || [];
      const hit = rows.find(r => Array.isArray(r._logisticSegments) && r._logisticSegments.some(s => s.synthetic === 'production')
        && r._logisticSegments.some(s => s.stage && /Yolda/i.test(s.status || '')) && r['Buying Son Onay Tarihi']);
      return hit ? { id: hit._id != null ? hit._id : null, code: String(hit['Order Code']) } : null;
    });
    assert.ok(mixed, 'Yolda + üretimde parsiyelli sipariş');
    await page.fill('#cpSearch', mixed.code); await page.keyboard.press('Enter');
    await page.waitForTimeout(2500);
    await page.evaluate(() => {
      const keep = new Set(['Priority', 'Order Code', 'Ex→Retail', 'STATUS', 'Ant. Arrival', 'Stage ETA', 'Current Stage', 'Order Quantity']);
      CP_COLS.forEach(c => { if (keep.has(c.k)) colmgr.cp.hidden.delete(c.k); else colmgr.cp.hidden.add(c.k); });
      saveAutoTableColumnState(); renderCP();
      const tr = document.querySelector('#cpTable tbody tr[data-id]'); state.cpLogisticExpanded.add(Number(tr.dataset.id)); renderCP();
    });
    await page.waitForTimeout(2500);
    const detail = await page.evaluate(() => [...document.querySelectorAll('.cpLogisticDetailLine')].map(line => ({
      name: line.querySelector('.cpLogisticDetailName strong')?.textContent.trim() || '',
      cells: [...line.children].map(c => c.textContent.trim().replace(/\s+/g, ' ')),
    })));
    console.log('DETAIL', JSON.stringify(detail));
    const run = await page.evaluate(() => document.querySelector('#cpTable tbody td[data-key="Current Stage"]')?.textContent.trim() || '');
    assert.doesNotMatch(run, /Cut-?off/i, `yoldaki parsiyel Cut-off'ta görünmez: ${run}`);
    assert.ok(detail.every(d => !/Tahmini kalan/.test(d.cells.join(' '))), 'aşama metni çeviri ağınca bozulmaz');
    assert.doesNotMatch(run, /\d\.\d+\//, 'gün tam sayı');
    const prod = detail.find(d => /Üretim/i.test(d.name));
    assert.ok(prod, 'üretimde satırı');
    assert.equal(prod.cells[6], '—', 'üretimde parsiyeli yükleme onayı devralmaz');
    await page.evaluate(() => { const t = document.getElementById('_toast'); if (t) t.remove(); const wrap = document.getElementById('cpTableWrap'); if (wrap) wrap.scrollLeft = 0; });
    await page.waitForTimeout(600);
    // Gümrükte takılı parsiyel: sonraki adımın sütunu yok, yine de aşım görünür.
    const stuck = await page.evaluate(() => {
      const rows = (state.cp && state.cp.rows) || [];
      const hit = rows.filter(r => r._stageRun && r._stageRun.to === 'warehouseEntry' && r._stageRun.over > 0).sort((a, b) => b._stageRun.over - a._stageRun.over)[0];
      return hit ? { code: String(hit['Order Code']), run: hit._stageRun } : null;
    });
    console.log('STUCK', JSON.stringify(stuck));
    assert.ok(stuck, 'gümrükte takılı parsiyel aşım gösterir');
    await page.fill('#cpSearch', `${stuck.code}, ${mixed.code}`); await page.keyboard.press('Enter');
    await page.waitForTimeout(2500);
    await page.evaluate(() => { state.cpLogisticExpanded.clear(); renderCP(); const wrap = document.getElementById('cpTableWrap'); if (wrap) wrap.scrollLeft = 0; const t = document.getElementById('_toast'); if (t) t.remove(); });
    await page.waitForTimeout(1500);
    const stuckRun = await page.evaluate(() => [...document.querySelectorAll('#cpTable tbody td[data-key="Current Stage"]')].map(td => td.textContent.trim()));
    console.log('STUCK_CELLS', JSON.stringify(stuckRun));
    assert.ok(stuckRun.some(t => /ETA → Antrepo Giriş .* g aşıldı/.test(t)), 'etiket sayılan aralığı yazar');
    const sbox = await page.locator('#cpTableWrap').boundingBox();
    await page.screenshot({ path: path.join(outDir, 'cp-stage-stuck-customs.png'), clip: { x: sbox.x, y: sbox.y, width: sbox.width, height: Math.min(sbox.height, Math.max(420, Math.ceil(sbox.width / 3.2))) } });
    await page.fill('#cpSearch', mixed.code); await page.keyboard.press('Enter');
    await page.waitForTimeout(2000);
    await page.evaluate(() => { const tr = document.querySelector('#cpTable tbody tr[data-id]'); state.cpLogisticExpanded.add(Number(tr.dataset.id)); renderCP(); });
    await page.waitForTimeout(1500);
    const dbox = await page.locator('#cpTableWrap').boundingBox();
    await page.screenshot({ path: path.join(outDir, 'cp-stage-status-floor.png'), clip: { x: dbox.x, y: dbox.y, width: dbox.width, height: Math.min(dbox.height, Math.max(480, Math.ceil(dbox.width / 3.2))) } });
  }
  assert.deepEqual(errors, [], 'browser errors');
  console.log(`PASS model ${saved.analysis.stats.used} partials · ${projected.length} projected Backlog partials · signal cards ${counts.join('/')} · screenshots in ${outDir}`);
})().catch(e => { console.error(e); process.exitCode = 1; }).finally(async () => {
  if (browser) await browser.close();
  if (server.exitCode === null) { const stopped = new Promise(r => server.once('exit', r)); server.kill('SIGTERM'); const timer = setTimeout(() => server.kill('SIGKILL'), 5000); await stopped; clearTimeout(timer); }
  fs.closeSync(log);
});
