'use strict';

/*
 * Çapraz-platform katmanı (server/lib/platform.js), ağ kilidi (server/lib/net-guard.js)
 * ve Excel yenilemesinin Windows-dışı davranışı için testler. Bu testler macOS (a) ve
 * barındırma (c) yönünün temelini oluşturan platform-farkındalığı doğrular.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const platform = require('../server/lib/platform');
const { isLoopbackHost, assertSafeBind, resolveBindHost } = require('../server/lib/net-guard');
const { refreshExcelFile } = require('../server/lib/refreshExcel');

test('platform: yetenek bayrakları process.platform ile tutarlı', () => {
  const flags = [platform.IS_WINDOWS, platform.IS_MAC, platform.IS_LINUX].filter(Boolean);
  assert.ok(flags.length <= 1, 'En fazla bir platform bayrağı doğru olmalı');
  assert.equal(platform.canRefreshExcel(), platform.IS_WINDOWS, 'Excel COM yenilemesi yalnız Windows\'ta mümkün');
});

test('platform: harici açma komutu doğru platforma göre seçilir', () => {
  const plan = platform.externalOpenPlan('/tmp/örnek.eml');
  if (platform.IS_WINDOWS) assert.equal(plan.cmd, 'powershell.exe');
  else if (platform.IS_MAC) { assert.equal(plan.cmd, 'open'); assert.deepEqual(plan.args, ['/tmp/örnek.eml']); }
  else { assert.equal(plan.cmd, 'xdg-open'); assert.deepEqual(plan.args, ['/tmp/örnek.eml']); }
});

test('platform: klasör açma komutu doğru platforma göre seçilir', () => {
  const plan = platform.revealFolderPlan('/tmp/Buyer Log PO');
  if (platform.IS_WINDOWS) { assert.equal(plan.cmd, 'explorer.exe'); assert.deepEqual(plan.args, ['/tmp/Buyer Log PO']); }
  else if (platform.IS_MAC) { assert.equal(plan.cmd, 'open'); assert.deepEqual(plan.args, ['/tmp/Buyer Log PO']); }
  else { assert.equal(plan.cmd, 'xdg-open'); assert.deepEqual(plan.args, ['/tmp/Buyer Log PO']); }
});

test('platform: folderDialogPlan geçerli bir tür döndürür', () => {
  const kinds = new Set(['windows', 'mac', 'linux', 'unsupported']);
  assert.ok(kinds.has(platform.folderDialogPlan().kind));
});

test('refreshExcel: Windows dışında PowerShell çağırmadan net kodla reddeder', async () => {
  if (platform.canRefreshExcel()) return; // yalnız Windows-dışı ortamda anlamlı
  await assert.rejects(
    () => refreshExcelFile('herhangi.xlsx', 1000),
    err => err && err.code === 'EXCEL_REFRESH_UNSUPPORTED'
  );
});

test('net-guard: loopback host tespiti', () => {
  for (const h of ['127.0.0.1', '::1', 'localhost', '', '127.0.0.5', 'LOCALHOST']) {
    assert.equal(isLoopbackHost(h), true, `${h} loopback sayılmalı`);
  }
  for (const h of ['0.0.0.0', '192.168.1.10', '10.0.0.4', 'example.com']) {
    assert.equal(isLoopbackHost(h), false, `${h} loopback sayılmamalı`);
  }
});

test('net-guard: kimlik doğrulamasız loopback-dışı bağlanma reddedilir', () => {
  assert.doesNotThrow(() => assertSafeBind('127.0.0.1', false), 'localhost her zaman güvenli');
  assert.doesNotThrow(() => assertSafeBind('localhost', false));
  assert.doesNotThrow(() => assertSafeBind('0.0.0.0', true), 'auth varsa loopback-dışı bağlanabilir');
  assert.throws(
    () => assertSafeBind('0.0.0.0', false),
    err => err && err.code === 'UNSAFE_NETWORK_BIND',
    'auth yokken loopback-dışı bağlanma reddedilmeli'
  );
  assert.throws(() => assertSafeBind('192.168.1.20', false), /UNSAFE_NETWORK_BIND|GÜVENLİK/);
});

test('net-guard: resolveBindHost güvensiz yapılandırmada loopback\'e düşürür (çökmez)', () => {
  assert.deepEqual(resolveBindHost('127.0.0.1', false), { host: '127.0.0.1', downgraded: false });
  assert.deepEqual(resolveBindHost('0.0.0.0', true), { host: '0.0.0.0', downgraded: false }, 'auth varsa istenen host korunur');
  const downgraded = resolveBindHost('0.0.0.0', false);
  assert.equal(downgraded.host, '127.0.0.1', 'auth yokken loopback\'e düşülmeli');
  assert.equal(downgraded.downgraded, true);
  assert.equal(downgraded.requested, '0.0.0.0');
});
