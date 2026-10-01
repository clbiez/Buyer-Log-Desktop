'use strict';

/*
 * "Get OAB" / Veri Yönetimi > Browser & Remote Debugging: 3–4 tarayıcı açılıp
 * kapanıyordu.
 *
 * Kök neden: detectBrowser() sürümü okumak için `msedge.exe --version`
 * (Chrome'da `chrome.exe --version`) çalıştırıyordu. Windows'ta Edge/Chrome bu
 * bayrağı desteklemez; gerçek bir tarayıcı penceresi açar ve spawnSync 2,5 sn
 * zaman aşımında süreci öldürür. Her durum/bağlantı kontrolü detectBrowser'ı
 * 2–4 kez çağırdığı için her tıklamada birden çok pencere açılıp kapanıyordu.
 *
 * Sözleşme: tarayıcı yürütülebilir dosyası YALNIZ gerçek başlatmada (spawn)
 * çalıştırılır; sürüm kurulum klasöründeki sürüm adlı alt klasörden okunur.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const service = require('../server/lib/browser-debug-service');

function makeService(spawnSyncCalls, { versionFolders = ['153.0.4234.32', '9.0.0.1', '153.0.4234.120', 'SetupMetrics'] } = {}) {
  return service.createBrowserDebugService({
    localDataRoot: path.join('C:', 'Users', 'test', 'BuyerLog'),
    canonicalDataRoot: path.join('C:', 'Users', 'test', 'BuyerLog'),
    env: { LOCALAPPDATA: 'C:\\Users\\test\\AppData\\Local', PROGRAMFILES: 'C:\\Program Files', 'PROGRAMFILES(X86)': '' },
    fs: {
      existsSync: item => /msedge\.exe$|chrome\.exe$/i.test(String(item)),
      // Kurulum klasörünün içeriği (Linux'ta Windows yolu farklı bölündüğü için
      // klasör adına bakılmaz; profil keşfi bu sınamada kullanılmıyor).
      readdirSync: () => versionFolders,
      readFileSync: () => { throw new Error('missing'); },
      mkdirSync: () => {},
    },
    writeJson: () => {},
    spawnSync: (command, args) => { spawnSyncCalls.push({ command: String(command), args: [...(args || [])] }); return { stdout: '', stderr: '' }; },
    spawn: () => { throw new Error('launch must not happen in this test'); },
    readRegistry: () => '',
    fetch: async () => ({ ok: false, status: 404, text: async () => '{}' }),
    canBindPort: () => true,
    processRunning: () => false,
  });
}

const launchesBrowserExecutable = calls => calls.filter(call => /msedge\.exe$|chrome\.exe$/i.test(call.command));

test('detectBrowser tarayıcıyı çalıştırmaz; sürümü kurulum klasöründen okur', () => {
  const calls = [];
  const svc = makeService(calls);
  const edge = svc.detectBrowser('edge');
  assert.equal(edge.installed, true);
  assert.equal(edge.version, '153.0.4234.120', 'en yeni sürüm klasörü seçilmeli');
  assert.equal(edge.majorVersion, 153);
  svc.detectInstalledBrowsers();
  svc.detectSystemDefaultBrowser();
  svc.resolveEffectiveBrowser();
  assert.deepEqual(launchesBrowserExecutable(calls), [], 'msedge.exe/chrome.exe --version çalıştırılmamalı');
});

test('durum ve bağlantı kontrolleri tarayıcı penceresi açmaz', async () => {
  const calls = [];
  const svc = makeService(calls);
  await svc.getRuntimeStatus();
  await svc.testConnection();
  assert.deepEqual(launchesBrowserExecutable(calls), []);
});

test('sürüm klasörü yoksa sürüm boş kalır ve süreç yine başlatılmaz', () => {
  const calls = [];
  const svc = makeService(calls, { versionFolders: [] });
  const edge = svc.detectBrowser('edge');
  assert.equal(edge.installed, true);
  assert.equal(edge.version, undefined);
  assert.equal(edge.majorVersion, 0);
  assert.deepEqual(launchesBrowserExecutable(calls), []);
});

test('kaynakta tarayıcıya --version gönderen çağrı kalmadı', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server', 'lib', 'browser-debug-service.js'), 'utf8');
  assert.doesNotMatch(src, /spawnSyncImpl\(executablePath/);
  assert.doesNotMatch(src, /\[\s*'--version'\s*\]/);
});
