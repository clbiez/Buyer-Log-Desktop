'use strict';
// Actual Buyer Log HTTP/auth/ingest/storage/UI. Only upstream PLM metadata and
// image transport are synthetic loopback fixtures. No production credentials.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const crypto = require('node:crypto'), assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const app = path.resolve(__dirname, '../../../../resources/app');
const out = __dirname;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
function png(tag) {
  const zlib = require('node:zlib');
  function crc(buffer) { let c = 0xffffffff; for (const b of buffer) { c ^= b; for (let i = 0; i < 8; i++) c = (c >>> 1) ^ ((c & 1) ? 0xedb88320 : 0); } return (c ^ 0xffffffff) >>> 0; }
  function chunk(type, data) { const typeBytes = Buffer.from(type), n = Buffer.alloc(4), checksum = Buffer.alloc(4); n.writeUInt32BE(data.length); checksum.writeUInt32BE(crc(Buffer.concat([typeBytes, data]))); return Buffer.concat([n, typeBytes, data, checksum]); }
  const header = Buffer.alloc(13); header.writeUInt32BE(160, 0); header.writeUInt32BE(160, 4); header[8] = 8; header[9] = 6;
  const pixels = Buffer.alloc(160 * (160 * 4 + 1));
  for (let y = 0; y < 160; y++) for (let x = 0; x < 160; x++) { const at = y * 641 + 1 + x * 4; pixels[at] = 30 + tag % 180; pixels[at + 1] = x > 40 && x < 120 ? 170 : 60; pixels[at + 2] = y > 30 && y < 135 ? 220 : 90; pixels[at + 3] = 255; }
  const text = Buffer.alloc((1 + tag % 4) * 256 * 1024, 65 + tag % 20); Buffer.from('Synthetic\0').copy(text);
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header), chunk('tEXt', text), chunk('IDAT', zlib.deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
}
async function serverMode() {
  const http = require('node:http'), https = require('node:https');
  const budget = require(path.join(app, 'server/lib/plm-image-byte-budget-int03'));
  let version = 1, attempts = 0, unknown = 0;
  const imageServer = http.createServer((req, res) => {
    if (req.url === '/state') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ attempts, unknown, budget: budget.imageByteBudget.snapshot() })); return; }
    const tag = Number(req.url.split('/').pop());
    const buffer = png(tag);
    res.setHeader('Content-Type', 'image/png');
    if (tag % 2) res.setHeader('Content-Length', String(buffer.length)); else unknown++;
    attempts++;
    res.write(buffer.subarray(0, 64000)); setTimeout(() => res.end(buffer.subarray(64000)), 5);
  });
  await new Promise(resolve => imageServer.listen(0, '127.0.0.1', resolve));
  const original = https.get;
  https.get = (options, callback) => {
    if (!String(options.path).includes('/Attachment/GetAttachment/')) throw new Error('Unexpected external HTTPS in synthetic acceptance');
    return http.get({ host: '127.0.0.1', port: imageServer.address().port, path: options.path }, callback);
  };
  const connector = require(path.join(app, 'server/lib/agent-browser-connector'));
  connector.openCoreNectumStyleApiSession = async () => ({
    styleListLookup: async codes => ({ data: { coreNectumResultData: { styleListResult: codes.map(code => ({ plmCode: code, styleId: code,
      model: { imageUrl: `https://mym-api.lcwaikiki.com/lcw/live/corenectum/service/api/Attachment/GetAttachment/${Number(code) + version}` } })) } } }),
    styleImagesLookup: async () => ({ data: { styleImages: { StyleImages: [] }, styleOptionImages: { OptionImages: [] } } }),
    close: async () => {}, diagnostics: () => [],
  });
  fs.writeFileSync(process.env.INT03_UPSTREAM_PORT_FILE, String(imageServer.address().port));
  require(path.join(app, 'server/server'));
}
async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-int03-ui-'));
  const source = path.join(root, 'source'); fs.mkdirSync(source);
  const generated = spawnSync(process.execPath, [path.join(app, 'scripts/generate-demo-data.js'), source, '--rows', '24'], { cwd: app, encoding: 'utf8' }); assert.equal(generated.status, 0, generated.stderr);
  const env = { ...process.env, BL_AUTOMATION_RUN: '0', BL_KEEP_ALIVE: '1',
    BUYER_LOG_DATA_ROOT: path.join(root, 'app'), BUYER_LOG_LOCAL_DATA_ROOT: path.join(root, 'local'), BUYER_LOG_SERVER_DATA_ROOT: path.join(root, 'server'),
    BUYER_LOG_AUTH_DATA_ROOT: path.join(root, 'server/auth'), BUYER_LOG_TEMP_ROOT: path.join(root, 'temp'), BUYER_LOG_CONFIG_PATH: path.join(root, 'config.json'), INT03_UPSTREAM_PORT_FILE: path.join(root, 'upstream-port') };
  for (const key of ['BUYER_LOG_DATA_ROOT', 'BUYER_LOG_LOCAL_DATA_ROOT', 'BUYER_LOG_SERVER_DATA_ROOT', 'BUYER_LOG_AUTH_DATA_ROOT', 'BUYER_LOG_TEMP_ROOT']) fs.mkdirSync(env[key], { recursive: true });
  const port = 6483, base = `http://127.0.0.1:${port}`;
  fs.writeFileSync(env.BUYER_LOG_CONFIG_PATH, JSON.stringify({ port, host: '127.0.0.1', sourceFolder: source, refreshWithExcel: false, updates: { enabled: false } }));
  const child = spawn(process.execPath, [__filename, '--server'], { cwd: app, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '', browser;
  child.stdout.on('data', b => { log += b; }); child.stderr.on('data', b => { log += b; });
  const report = { synthetic: true, upstream: 'loopback metadata and real HTTP stream; actual queue/ingest/server/auth/UI', status: 'running' };
  try {
    for (let i = 0; i < 120; i++) { try { if ((await fetch(base + '/api/user-profiles')).ok) break; } catch {} await pause(250); }
    const password = crypto.randomBytes(24).toString('hex');
    const login = await fetch(base + '/api/user-login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: 'moderator', password, newPassword: password }) }); assert.equal(login.status, 200, await login.clone().text());
    const cookie = login.headers.get('set-cookie').split(';')[0];
    async function api(url, body) { const response = await fetch(base + url, { method: body ? 'POST' : 'GET', headers: { cookie, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) }); const json = await response.json(); assert.ok(response.ok, JSON.stringify(json)); return json; }
    await api('/api/refresh', {});
    for (let i = 0; i < 160; i++) { if (!(await api('/api/refresh-status')).running) break; await pause(250); }
    const cp = await api('/api/data/cp'); assert.equal(cp.rows.length, 21);
    const items = cp.rows.map(row => ({ plmId: String(row['PLM ID']), colourCode: row['C.Code'], colour: row.Colour, styleName: row['Model Name'] }));
    assert.ok(items.every(item => /^\d+$/.test(item.plmId)), JSON.stringify(cp.rows[0]));
    const first = await api('/api/model-images/import-plm', { mode: 'all', scope: 'cp', items });
    assert.equal(first.status, 'completed'); assert.equal(first.images.length, 21); assert.equal(first.counts.failed, 0);
    for (const item of first.images) { const response = await fetch(base + item.url, { headers: { cookie } }); assert.equal(response.status, 200); const bytes = Buffer.from(await response.arrayBuffer()); const tag = Number(item.plmId) + 1; assert.deepEqual(bytes, png(tag)); }
    const cached = await api('/api/model-images/import-plm', { mode: 'missing', scope: 'cp', items });
    assert.equal(cached.counts.downloadsCompleted, 0); assert.equal(cached.counts.cacheHits, 21);
    const state = await (await fetch('http://127.0.0.1:' + fs.readFileSync(env.INT03_UPSTREAM_PORT_FILE, 'utf8') + '/state')).json();
    assert.ok(state.unknown > 0); assert.equal(state.budget.used, 0); assert.ok(state.budget.peak <= state.budget.limit);
    report.acceptance = { generatedRows: 24, requested: 21, downloaded: first.counts.downloadsCompleted, bytes: first.counts.bytesDownloaded, exactHttpContents: true, cacheHits: cached.counts.cacheHits, ...state };
    const { chromium } = require('/opt/codex/cua_node/lib/node_modules/playwright');
    browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true });
    const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
    const [name, ...value] = cookie.split('='); await context.addCookies([{ name, value: value.join('='), url: base }]);
    const page = await context.newPage();
    await page.route('https://**', route => route.abort());
    await page.goto(base, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('nav.tabs button[data-tab="cp"]', { timeout: 60000 });
    await page.getByText(/Buyer Log'a devam et|Continue to Buyer Log/).first().click({ timeout: 20000 }).catch(() => {});
    await page.waitForFunction(() => !document.getElementById('blBootGuard'), null, { timeout: 60000 });
    await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close()));
    await page.locator('[data-rn-close]').click({ timeout: 2000 }).catch(() => {});
    await page.locator('nav.tabs button[data-tab="cp"]').click();
    await page.waitForSelector('#cpTable tbody tr', { timeout: 60000 });
    await page.evaluate(data => { applySyncedPlmImages(data); plmSyncRepaintAll(); }, first);
    await page.waitForFunction(() => [...document.querySelectorAll('#cpTable img')].some(img => img.complete && img.naturalWidth > 0 && !img.src.startsWith('data:image/svg')), null, { timeout: 30000 });
    await pause(500);
    report.loadedUiImages = await page.locator('#cpTable img').evaluateAll(images => images.filter(img => img.complete && img.naturalWidth > 0 && !img.src.startsWith('data:image/svg')).length);
    const screenshot = path.join(app, 'public/release-notes/next-assets/int03-shared-image-byte-budget-20261109.png');
    await page.screenshot({ path: screenshot });
    report.screenshot = path.relative(app, screenshot); report.status = 'passed';
  } catch (error) { report.status = 'failed'; report.error = { message: error.message, stack: error.stack }; throw error; }
  finally {
    fs.writeFileSync(path.join(out, 'acceptance.json'), JSON.stringify(report, null, 2) + '\n');
    fs.writeFileSync(path.join(out, 'acceptance-server.log'), log);
    if (browser) await browser.close();
    if (child.exitCode === null) { const ended = new Promise(resolve => child.once('exit', resolve)); child.kill('SIGTERM'); const timer = setTimeout(() => child.kill('SIGKILL'), 5000); await ended; clearTimeout(timer); }
    fs.rmSync(root, { recursive: true, force: true });
  }
}
(process.argv.includes('--server') ? serverMode() : main()).catch(error => { console.error(error); process.exitCode = 1; });
