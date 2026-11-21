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
    set('Özet Beyan Onay Tarih', c.summary); set('Ambar Onay Tarih', c.warehouse); set('Transit Beyanname Tarih', c.transit); set('Evrak Teslim Tarih', c.docs);
  } else if (status === 'Yolda') {
    // Yüklendi; ETA gelecekte (gemi tarifesi) ya da geçmiş ama gümrük açık.
    transitCount += 1;
    // Çoğu yeni yüklenmiş (ETA gelecekte); her dördüncüsü ETA'yı geçmiş, gümrük açık.
    const shift = transitCount % 4 === 0 ? -between(45, 60) : -between(8, 14);
    const c = chain(vehicle, country, shift);
    set('Yükleme Talep Tarih', c.loadingRequest); set('HANDOVER Tarihi', c.handover); set('Cut Off Tarih', c.cutOff);
    set('Fiili Yükleme Tarih', c.actualLoading); set('ETA Tarih', c.eta);
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
  assert.deepEqual(errors, [], 'browser errors');
  console.log(`PASS model ${saved.analysis.stats.used} partials · ${projected.length} projected Backlog partials · signal cards ${counts.join('/')} · screenshots in ${outDir}`);
})().catch(e => { console.error(e); process.exitCode = 1; }).finally(async () => {
  if (browser) await browser.close();
  if (server.exitCode === null) { const stopped = new Promise(r => server.once('exit', r)); server.kill('SIGTERM'); const timer = setTimeout(() => server.kill('SIGKILL'), 5000); await stopped; clearTimeout(timer); }
  fs.closeSync(log);
});
