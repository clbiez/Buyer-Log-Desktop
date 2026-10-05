'use strict';
/* PLM/ASAS rehberinde tek tıkla Remote Debugging + tamamlandı sayfası.
   Kullanıcı Browser & Remote Debugging penceresini açmadan rehberden
   bağlantıyı açabilmeli, sonuç hemen Test Connection ile teyit edilmeli ve
   açılan tarayıcı işin bittiğini / sayfanın kapatılabileceğini söylemelidir. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const service = require('../server/lib/browser-debug-service');

const ROOT = path.join(__dirname, '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

function fakeService(calls, launches) {
  return service.createBrowserDebugService({
    localDataRoot: path.join('C:', 'Users', 'test', 'BuyerLog'),
    launchTimeoutMs: 500,
    env: { LOCALAPPDATA: 'C:\\Users\\test\\AppData\\Local', PROGRAMFILES: 'C:\\Program Files', 'PROGRAMFILES(X86)': '' },
    fs: { existsSync: item => item.endsWith('chrome.exe'), readFileSync: () => { throw new Error('missing'); }, mkdirSync: () => {} },
    writeJson: () => {},
    spawnSync: () => ({ stdout: 'Google Chrome 140.0.1' }),
    spawn: (executable, args) => { launches.push(args); return { pid: 42, unref() {} }; },
    readRegistry: () => '',
    fetch: async (url, init = {}) => {
      calls.push({ url, method: init.method || 'GET' });
      if (!launches.length) return { ok: false, status: 404, text: async () => '{}' };
      if (url.endsWith('/json/version')) return { ok: true, text: async () => JSON.stringify({ Browser: 'Chrome/140', webSocketDebuggerUrl: 'ws://127.0.0.1:49877/devtools/browser/test' }) };
      if (url.endsWith('/json/list')) return { ok: true, text: async () => JSON.stringify([
        { id: 'blank', type: 'page', url: 'chrome://newtab/' },
        { id: 'user', type: 'page', url: 'https://example.com/' },
      ]) };
      if (url.includes('/json/new?')) return { ok: true, text: async () => JSON.stringify({ id: 'ready', type: 'page' }) };
      return { ok: true, text: async () => 'Target is closing' };
    },
    processRunning: () => false,
    canBindPort: () => true,
  });
}

test('kullanıcı kurulumu tamamlandı sayfasını açar ve yalnız boş başlangıç sekmesini kapatır', async () => {
  const calls = [], launches = [];
  const result = await fakeService(calls, launches).enableAndLaunch({ preferredBrowser: 'chrome', preferredPort: 49877 }, { announceReady: true });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.setupPage, true);
  const opened = calls.find(call => call.url.includes('/json/new?'));
  assert.ok(opened, 'tamamlandı sekmesi açılmalı');
  assert.equal(opened.method, 'PUT');
  const page = decodeURIComponent(opened.url.split('/json/new?')[1]);
  const html = Buffer.from(page.split('base64,')[1], 'base64').toString('utf8');
  assert.match(html, /bu sayfayı kapatabilirsiniz/);
  assert.match(html, /you can close this page/);
  assert.doesNotMatch(html, /<script/i);
  const closed = calls.filter(call => call.url.includes('/json/close/')).map(call => call.url.split('/json/close/')[1]);
  assert.deepEqual(closed, ['blank']);
});

test('arka plan (ensureEndpoint) açılışında tamamlandı sayfası gösterilmez', async () => {
  const calls = [], launches = [];
  const result = await fakeService(calls, launches).enableAndLaunch({ preferredBrowser: 'chrome', preferredPort: 49877 });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.setupPage, false);
  assert.ok(!calls.some(call => call.url.includes('/json/new') || call.url.includes('/json/close')));
});

test('enable/restart rotaları tamamlandı sayfasını yalnız kullanıcı isteğinde ister', () => {
  const server = read('server/server.js');
  assert.match(server, /enableAndLaunch\(req\.body \|\| \{\}, \{ announceReady:true \}\)/);
  assert.match(server, /restartWithRemoteDebugging\(req\.body \|\| \{\}, \{ announceReady:true \}\)/);
  assert.match(read('server/lib/browser-debug-service.js'), /const launched = await enableAndLaunch\(configuration\);/);
});

test('PLM rehberi tek tıkla Remote Debugging açar ve hemen doğrular', () => {
  const ui = read('public/plm-sync-guide.js');
  assert.match(ui, /data-syncguide-enable/);
  assert.match(ui, /Enable Remote Debugging in one click/);
  assert.match(ui, /postJson\('\/api\/browser-debug\/enable',\{\}\)/);
  assert.match(ui, /postJson\('\/api\/browser-debug\/restart',\{\}\)/);
  assert.match(ui, /postJson\('\/api\/browser-debug\/test',\{\}\)/);
  assert.match(ui, /browserStatus\(true\)/);
  // Profil seçimi gereken durumlarda tahmin yapılmaz; tek tık sunulmaz.
  assert.doesNotMatch(ui.match(/const oneClickStates=new Set\(\[[^\]]*\]\)/)[0], /PROFILE_/);
  // Yeniden başlatma kullanıcı onayı olmadan yapılmaz.
  assert.match(ui, /confirm\(t\('Seçili tarayıcı kapatılıp/);
});
