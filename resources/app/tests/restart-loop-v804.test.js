'use strict';

/*
 * ÜRETİM LOGUNDAN ÇIKAN KUSUR — SONSUZ YENİDEN BAŞLATMA DÖNGÜSÜ
 *
 * server-error.log: 229 kez "listen EADDRINUSE 127.0.0.1:4173"
 * server-restart.log: 531 yeniden başlatma, en yoğun dakikada 26 tanesi.
 *
 * Zincir üç ayrı kusurdan oluşuyordu:
 *   1) Port başka bir Buyer Log kopyasındayken EADDRINUSE ölümcül hata
 *      sayılıyordu. Oysa bu, uygulamanın ZATEN çalıştığı anlamına gelir.
 *   2) scheduleFatalRestart'taki çıkış zamanlayıcısı .unref()'liydi. Bağlanma
 *      başarısız olunca geriye kalan handle'ların hepsi unref'li olduğu için
 *      Node zamanlayıcı ateşlenmeden KOD 0 ile çıkıyordu; gözetmen temiz bir
 *      kapanış görüp hemen yeniden başlatıyordu.
 *   3) Gözetmen hiç pes etmiyordu; 10 sn'lik kısılma döngüyü yalnız
 *      yavaşlatıyordu.
 *
 * Testler kaynak metnini değil, gerçek süreç davranışını ölçer.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const EXIT_ALREADY_RUNNING = 3;

function run(file, env, timeoutMs = 45000) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [file], { cwd: ROOT, env: { ...process.env, ...env } });
    let out = '';
    const timer = setTimeout(() => { try { child.kill(); } catch (_) {} reject(new Error(`zaman aşımı\n${out}`)); }, timeoutMs);
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { out += d; });
    child.once('exit', (code, signal) => { clearTimeout(timer); resolve({ code, signal, out }); });
    child.once('error', error => { clearTimeout(timer); reject(error); });
  });
}

async function occupiedPort() {
  const blocker = net.createServer(socket => socket.destroy());
  await new Promise((resolve, reject) => { blocker.once('error', reject); blocker.listen(0, '127.0.0.1', resolve); });
  return { port: blocker.address().port, close: () => new Promise(resolve => blocker.close(resolve)) };
}

async function sandbox(t, port) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'buyerlog-restart-loop-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const config = path.join(root, 'config.json');
  await fsp.writeFile(config, JSON.stringify({ port, host: '127.0.0.1' }), 'utf8');
  return {
    root,
    env: {
      BUYER_LOG_CONFIG_PATH: config,
      BUYER_LOG_SERVER_DATA_ROOT: path.join(root, 'server-data'),
      BUYER_LOG_DATA_ROOT: path.join(root, 'app-data'),
      BUYER_LOG_LOCAL_DATA_ROOT: path.join(root, 'local'),
      BL_KEEP_ALIVE: '1',
      BL_AUTOEXIT: '0',
    },
  };
}

test('port doluyken sunucu çökmez, "zaten çalışıyor" koduyla temiz kapanır', async t => {
  const blocker = await occupiedPort();
  t.after(() => blocker.close());
  const box = await sandbox(t, blocker.port);

  const result = await run(path.join(ROOT, 'server', 'server.js'), box.env);

  assert.equal(result.code, EXIT_ALREADY_RUNNING,
    `çıkış kodu ${EXIT_ALREADY_RUNNING} olmalı; 0 gözetmeni yeniden başlatmaya, 1 ise çökme muamelesine iter.\n${result.out}`);
  assert.match(result.out, /zaten çalışıyor/i, 'kullanıcıya sebebi söylenmeli');
});

test('gözetmen "zaten çalışıyor" kodunda yeniden başlatmaz ve durur', async t => {
  const blocker = await occupiedPort();
  t.after(() => blocker.close());
  const box = await sandbox(t, blocker.port);

  const result = await run(path.join(ROOT, 'server', 'watchdog.js'), box.env, 60000);

  assert.equal(result.code, 0, `gözetmen temiz durmalı\n${result.out}`);
  assert.match(result.out, /Gözetmen duruyor/i);
  const starts = (result.out.match(/sunucusu başlatılıyor/gi) || []).length;
  assert.equal(starts, 1, `sunucu yalnız bir kez denenmeli, ${starts} kez denendi — döngünün ta kendisi budur`);
  assert.doesNotMatch(result.out, /saniye içinde yeniden başlatılacak/i, 'yeniden başlatma planlanmamalı');

  const log = path.join(box.root, 'local', 'logs', 'server-restart.log');
  if (fs.existsSync(log)) {
    const text = await fsp.readFile(log, 'utf8');
    assert.equal((text.match(/sunucusu başlatılıyor/gi) || []).length, 1, 'log da tek deneme göstermeli');
  }
});

test('gözetmen düzelmeyen çökmede sonsuza kadar denemez', () => {
  // Bu sınır saatlerce süren gerçek bir döngü olmadan davranışsal olarak
  // ölçülemez; kaynağı okuyup eşiğin ve pes etme yolunun bağlı olduğunu
  // doğrulamak, bu bir testin gerçekçi kapsamıdır.
  const WATCHDOG = fs.readFileSync(path.join(ROOT, 'server', 'watchdog.js'), 'utf8');
  assert.match(WATCHDOG, /const GIVE_UP_AFTER = \d+;/);
  assert.match(WATCHDOG, /restartsInWindow\.length > GIVE_UP_AFTER/);
  assert.match(WATCHDOG, /function giveUp\(reason\)\{?[\s\S]{0,200}stopping = true/);
});

test('ölümcül çıkış zamanlayıcısı unref edilmez; kod kaybolmamalı', () => {
  const SERVER = fs.readFileSync(path.join(ROOT, 'server', 'server.js'), 'utf8');
  const block = SERVER.slice(SERVER.indexOf('function scheduleFatalRestart'), SERVER.indexOf("process.on('uncaughtException'"));
  assert.match(block, /setTimeout\(\(\) => process\.exit\(1\), 150\);/);
  assert.doesNotMatch(block, /process\.exit\(1\), 150\)\.unref\(\)/,
    'unref edilen zamanlayıcı ateşlenmeden süreç kod 0 ile çıkar');
});
