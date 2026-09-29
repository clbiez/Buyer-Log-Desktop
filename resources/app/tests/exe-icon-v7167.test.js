'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { pathToFileURL } = require('node:url');
const { runExeIconPatch, planExeIconPatch, cleanupLeftovers, parseWorkerOutput, MAX_ATTEMPTS } = require('../electron/exe-icon');

const APP_ROOT = path.join(__dirname, '..');
const ICON = path.join(APP_ROOT, 'buyerlog.ico');
// Portable kökteki gerçek bir PE dosyası; exe gibi yamalanabilir.
const SAMPLE_PE = path.join(APP_ROOT, '..', '..', 'vulkan-1.dll');

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'bl-exe-icon-'));
}

async function loadWorker() {
  return import(pathToFileURL(path.join(APP_ROOT, 'electron', 'exe-icon-worker.mjs')).href);
}

async function iconGroups(file) {
  const ResEdit = await import('resedit');
  const exe = ResEdit.NtExecutable.from(fs.readFileSync(file), { ignoreCert: true });
  return ResEdit.Resource.IconGroupEntry.fromEntries(ResEdit.NtExecutableResource.from(exe).entries);
}

test('işçi exe simgesini değiştirir, doğrular ve eski dosyayı yeniden adlandırır', { skip: !fs.existsSync(SAMPLE_PE) && 'örnek PE yok' }, async () => {
  const dir = tempDir();
  try {
    const exePath = path.join(dir, 'BuyerLog.exe');
    fs.copyFileSync(SAMPLE_PE, exePath);
    const originalSize = fs.statSync(exePath).size;
    const tested = [];
    const { patchExeIcon } = await loadWorker();
    const result = await patchExeIcon({ exePath, iconPath: ICON, now: 42, smokeTest: file => { tested.push(file); return true; } });
    assert.equal(result.swapped, true);
    assert.deepEqual(tested, [exePath + '.icon-new']);
    assert.equal(fs.statSync(result.retired).size, originalSize);
    assert.equal(result.retired, exePath + '.old-42');
    assert.equal(fs.existsSync(exePath + '.icon-new'), false);
    const groups = await iconGroups(exePath);
    assert.equal(groups.length, 1);
    assert.equal(groups[0].icons.length, result.icons);
    assert.ok(result.icons >= 5);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('deneme çalıştırması başarısızsa asıl exe olduğu gibi kalır', { skip: !fs.existsSync(SAMPLE_PE) && 'örnek PE yok' }, async () => {
  const dir = tempDir();
  try {
    const exePath = path.join(dir, 'BuyerLog.exe');
    fs.copyFileSync(SAMPLE_PE, exePath);
    const before = fs.readFileSync(exePath);
    const { patchExeIcon } = await loadWorker();
    await assert.rejects(patchExeIcon({ exePath, iconPath: ICON, smokeTest: () => false }), /deneme çalıştırması/);
    assert.ok(fs.readFileSync(exePath).equals(before));
    assert.deepEqual(fs.readdirSync(dir), ['BuyerLog.exe']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('aynı simge uygulanmışsa tekrar denenmez; üç başarısızlıktan sonra vazgeçilir', () => {
  const dir = tempDir();
  try {
    const exePath = path.join(dir, 'BuyerLog.exe');
    fs.writeFileSync(exePath, 'MZ-exe');
    const stateFile = path.join(dir, 'state', 'exe-icon.json');
    const first = planExeIconPatch({ exePath, sourceIcon: ICON, stateFile });
    assert.equal(first.action, 'patch');
    const stat = fs.statSync(exePath);
    fs.mkdirSync(path.dirname(stateFile), { recursive: true });
    fs.writeFileSync(stateFile, JSON.stringify({ appliedIconHash: first.iconHash, exeSize: stat.size, exeMtimeMs: stat.mtimeMs }));
    assert.equal(planExeIconPatch({ exePath, sourceIcon: ICON, stateFile }).reason, 'up-to-date');
    // exe elle eski haline döndürülürse (boyut değişir) yeniden uygulanır.
    fs.writeFileSync(exePath, 'MZ-exe-restored');
    assert.equal(planExeIconPatch({ exePath, sourceIcon: ICON, stateFile }).action, 'patch');
    fs.writeFileSync(stateFile, JSON.stringify({ failedIconHash: first.iconHash, failures: MAX_ATTEMPTS }));
    assert.equal(planExeIconPatch({ exePath, sourceIcon: ICON, stateFile }).reason, 'gave-up');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('önceki değişimden kalan eski exe ve yarım kopyalar temizlenir, diğer dosyalara dokunulmaz', () => {
  const dir = tempDir();
  try {
    const exePath = path.join(dir, 'BuyerLog.exe');
    for (const name of ['BuyerLog.exe', 'BuyerLog.exe.old-1', 'BuyerLog.exe.icon-new', 'config.json', 'ffmpeg.dll']) fs.writeFileSync(path.join(dir, name), 'x');
    assert.equal(cleanupLeftovers(exePath), 2);
    assert.deepEqual(fs.readdirSync(dir).sort(), ['BuyerLog.exe', 'config.json', 'ffmpeg.dll']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function fakeSpawn(output, calls) {
  return (command, args, options) => {
    calls.push({ command, args, options });
    const child = new EventEmitter();
    child.pid = 0;
    child.stdout = new EventEmitter();
    setImmediate(() => { child.stdout.emit('data', output); child.emit('close', 0); });
    return child;
  };
}

test('ana süreç işçiyi exe üzerinden Node modunda başlatır ve sonucu kaydeder', async () => {
  const dir = tempDir();
  try {
    const exePath = path.join(dir, 'BuyerLog.exe');
    fs.writeFileSync(exePath, 'MZ-exe');
    const stateFile = path.join(dir, 'state', 'exe-icon.json');
    const calls = [];
    let applied = 0;
    const ok = await runExeIconPatch({
      exePath, sourceIcon: ICON, stateFile,
      spawn: fakeSpawn('ilerleme\n' + JSON.stringify({ ok: true, swapped: true, exeSize: 6, exeMtimeMs: 7 }) + '\n', calls),
      onApplied: () => { applied += 1; },
    });
    assert.equal(ok.action, 'patched');
    assert.equal(applied, 1);
    assert.equal(calls[0].command, exePath);
    assert.equal(calls[0].args[0], path.join(APP_ROOT, 'electron', 'exe-icon-worker.mjs'));
    assert.deepEqual(calls[0].args.slice(1), [exePath, ICON]);
    assert.equal(calls[0].options.env.ELECTRON_RUN_AS_NODE, '1');
    assert.equal(calls[0].options.windowsHide, true);
    const saved = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    assert.equal(saved.exeSize, 6);
    assert.equal(saved.exeMtimeMs, 7);

    fs.rmSync(stateFile);
    const failed = await runExeIconPatch({ exePath, sourceIcon: ICON, stateFile, spawn: fakeSpawn(JSON.stringify({ ok: false, error: 'erişim reddedildi' }), []) });
    assert.equal(failed.action, 'failed');
    const failState = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    assert.equal(failState.failures, 1);
    assert.match(failState.lastError, /erişim reddedildi/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('işçi çıktısı okunamazsa başarısız sayılır', () => {
  assert.deepEqual(parseWorkerOutput('{"ok":true,"swapped":true}\n'), { ok: true, swapped: true });
  assert.equal(parseWorkerOutput('beklenmeyen').ok, false);
});
