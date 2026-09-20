'use strict';

/*
 * PAYLAŞILAN REVİZYON DEPOSU — WINDOWS EPERM RENAME DÖNGÜSÜ
 *
 * Bulunan kusur: shared-revision-store.js kendi atomicJson()'ını yazıyordu —
 * geçici dosyaya yaz → fsp.rename(), SIFIR retry, SIFIR süreçler-arası kilit.
 * Uygulamadaki DİĞER HER JSON store'u (local-db.js, sync-settings.js,
 * collection-workspaces.js, email-groups-store.js, quotations-store.js)
 * withFileLeaseAsync + replaceFileWithRetry kullanıyordu; bu store mimarideki
 * TEK istisnaydı — ve EPERM döngüsünün yalnız burada görülmesi rastlantı
 * değildi.
 *
 * Bu testler üç şeyi kanıtlar:
 *   1) Geçici EPERM/EBUSY rename kilidi retry ile geçilir, veri kaybolmaz.
 *   2) Kalıcı başarısızlıkta geçici dosya temizlenir ve hata çağırana döner —
 *      sessizce yutulmaz, "başarılı" gibi de gösterilmez.
 *   3) Aynı entity'ye eşzamanlı update() çağrıları KAYIP GÜNCELLEME üretmez
 *      (revizyon sayacı, hem tek süreç içinde hem süreçler arası, doğru artar).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { SharedRevisionStore } = require('../server/lib/shared-revision-store');

function renameError(code = 'EPERM') {
  const error = new Error(`${code}: simulated Windows rename lock`);
  error.code = code;
  return error;
}

async function withRenameFailures(matchesTarget, failureCount, run) {
  const original = fsp.rename;
  let attempts = 0;
  fsp.rename = async (from, to) => {
    if (matchesTarget(from, to)) {
      attempts += 1;
      if (attempts <= failureCount) throw renameError();
    }
    return original(from, to);
  };
  try { return await run(() => attempts); }
  finally { fsp.rename = original; }
}

async function tempRoot(t, prefix) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  return root;
}

/* --------------------------------------------------- GEÇİCİ EPERM RETRY */

test('geçici EPERM rename kilidini retry ederek tamamlar, revizyon ilerler', async t => {
  const root = await tempRoot(t, 'buyerlog-shared-revision-eperm-');
  const store = new SharedRevisionStore(root, { onTrace: () => {} });

  await withRenameFailures((_from, to) => to === store.file, 2, async attempts => {
    const result = await store.update('quotation', { actorId: 'u1' });
    assert.equal(result.entities.quotation.revision, 1);
    assert.equal(attempts(), 3, 'iki başarısız + bir başarılı deneme olmalı');
  });

  const state = await store.read();
  assert.equal(state.entities.quotation.revision, 1);
  assert.equal(state.entities.quotation.actorId, 'u1');
  // Geçici dosya artakalmamalı.
  assert.deepEqual((await fsp.readdir(root)).filter(name => name.endsWith('.tmp')), []);
});

test('kalıcı EPERM hatayı çağırana döner, eski revizyonu korur, temp dosyasını temizler', async t => {
  const root = await tempRoot(t, 'buyerlog-shared-revision-stable-');
  const store = new SharedRevisionStore(root, { onTrace: () => {} });
  await store.update('quotation', { actorId: 'u1' });

  await withRenameFailures((_from, to) => to === store.file, Number.MAX_SAFE_INTEGER, async () => {
    await assert.rejects(store.update('quotation', { actorId: 'u2' }), error => error && error.code === 'EPERM');
  });

  const state = await store.read();
  assert.equal(state.entities.quotation.revision, 1, 'kalıcı hatada eski revizyon korunmalı');
  assert.equal(state.entities.quotation.actorId, 'u1');
  assert.deepEqual((await fsp.readdir(root)).filter(name => name.endsWith('.tmp')), []);
});

test('EBUSY de retryable kabul edilir', async t => {
  const root = await tempRoot(t, 'buyerlog-shared-revision-ebusy-');
  const store = new SharedRevisionStore(root, { onTrace: () => {} });
  const original = fsp.rename;
  let attempts = 0;
  fsp.rename = async (from, to) => {
    if (to === store.file) { attempts += 1; if (attempts === 1) throw renameError('EBUSY'); }
    return original(from, to);
  };
  try {
    const result = await store.update('collection', {});
    assert.equal(result.entities.collection.revision, 1);
    assert.equal(attempts, 2);
  } finally { fsp.rename = original; }
});

test('ENOSPC gibi kalıcı bir hata hiç retry edilmeden fırlatılır', async t => {
  const root = await tempRoot(t, 'buyerlog-shared-revision-enospc-');
  const store = new SharedRevisionStore(root, { onTrace: () => {} });
  const original = fsp.rename;
  let attempts = 0;
  fsp.rename = async (from, to) => {
    if (to === store.file) { attempts += 1; throw renameError('ENOSPC'); }
    return original(from, to);
  };
  try {
    await assert.rejects(store.update('collection', {}), error => error && error.code === 'ENOSPC');
    assert.equal(attempts, 1, 'kalıcı disk hatasında beklenmeden hemen fırlatılmalı');
  } finally { fsp.rename = original; }
});

/* ------------------------------------------------------ TANILAMA OLAYLARI */

test('diagnostics: retry ve başarı olayları pid/instanceId taşır, iş verisi taşımaz', async t => {
  const root = await tempRoot(t, 'buyerlog-shared-revision-trace-');
  const events = [];
  const store = new SharedRevisionStore(root, { onTrace: line => events.push(line) });

  await withRenameFailures((_from, to) => to === store.file, 1, async () => {
    await store.update('quotation', { actorId: 'gizli-kullanici-id-99', secretNote: 'ASLA LOGLANMAMALI' });
  });

  const joined = events.join('\n');
  assert.match(joined, /SHARED_REVISION_WRITE_START/);
  assert.match(joined, /SHARED_REVISION_TEMP_WRITTEN/);
  assert.match(joined, /SHARED_REVISION_RENAME_RETRY/);
  assert.match(joined, /SHARED_REVISION_WRITE_OK/);
  assert.match(joined, /pid=\d+/);
  assert.match(joined, /instanceId=/);
  assert.match(joined, /attempt=1/);
  assert.match(joined, /error=EPERM/);
  // İş verisi (metadata içeriği) tanılama satırlarına SIZMAMALI.
  assert.doesNotMatch(joined, /gizli-kullanici-id-99/);
  assert.doesNotMatch(joined, /ASLA LOGLANMAMALI/);
});

test('diagnostics: kalıcı başarısızlıkta WRITE_FAILED denenen sayıyı ve hata kodunu taşır', async t => {
  const root = await tempRoot(t, 'buyerlog-shared-revision-trace-fail-');
  const events = [];
  const store = new SharedRevisionStore(root, { onTrace: line => events.push(line) });

  await withRenameFailures((_from, to) => to === store.file, Number.MAX_SAFE_INTEGER, async () => {
    await assert.rejects(store.update('quotation', {}));
  });

  const joined = events.join('\n');
  const failedLine = events.find(line => line.includes('SHARED_REVISION_WRITE_FAILED'));
  assert.ok(failedLine, 'WRITE_FAILED olayı üretilmeli');
  assert.match(failedLine, /entity=quotation/);
  assert.match(failedLine, /error=EPERM/);
  assert.match(joined, /attempts=6/, 'varsayılan 6 denemenin tamamı tükenmeli');
});

/* --------------------------------------------------- KAYIP GÜNCELLEME YOK */

test('tek süreçte eşzamanlı update() çağrıları kayıp güncelleme üretmez', async t => {
  const root = await tempRoot(t, 'buyerlog-shared-revision-concurrent-');
  const store = new SharedRevisionStore(root);

  const results = await Promise.all(
    Array.from({ length: 20 }, (_, index) => store.update('collection', { seq: index }))
  );

  // Her çağrı revizyonu BİR öncekinin üzerine artırmalı; 1..20 hepsi görülmeli.
  const revisions = results.map(next => next.entities.collection.revision).sort((a, b) => a - b);
  assert.deepEqual(revisions, Array.from({ length: 20 }, (_, i) => i + 1));

  const state = await store.read();
  assert.equal(state.entities.collection.revision, 20);
  assert.equal(state.revision, 20);
});

test('farklı entity anahtarları birbirini beklemek zorunda değil ama ikisi de doğru sonuçlanır', async t => {
  const root = await tempRoot(t, 'buyerlog-shared-revision-multi-entity-');
  const store = new SharedRevisionStore(root);

  await Promise.all([
    ...Array.from({ length: 5 }, () => store.update('quotation', {})),
    ...Array.from({ length: 5 }, () => store.update('cpOverrides', {})),
  ]);

  const state = await store.read();
  assert.equal(state.entities.quotation.revision, 5);
  assert.equal(state.entities.cpOverrides.revision, 5);
});

test('iki ayrı süreç aynı dosyaya yazınca revizyon kaybolmadan toplanır (lost-update koruması)', async t => {
  const root = await tempRoot(t, 'buyerlog-shared-revision-multiproc-');
  const storeModule = path.resolve(__dirname, '../server/lib/shared-revision-store.js');
  const script = `
    const { SharedRevisionStore } = require(process.env.TEST_STORE_MODULE);
    const store = new SharedRevisionStore(process.env.TEST_STORE_ROOT);
    (async () => {
      for (let i = 0; i < 10; i += 1) await store.update('quotation', {});
      process.exit(0);
    })().catch(() => process.exit(1));
  `;
  const spawnWriter = () => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['-e', script], {
      env: { ...process.env, TEST_STORE_MODULE: storeModule, TEST_STORE_ROOT: root },
      stdio: 'ignore',
    });
    child.once('exit', code => (code === 0 ? resolve() : reject(new Error(`writer exited ${code}`))));
    child.once('error', reject);
  });

  await Promise.all([spawnWriter(), spawnWriter()]);

  const store = new SharedRevisionStore(root);
  const state = await store.read();
  // 2 süreç × 10 yazma = 20 artış; hiçbiri süreçler arası çakışmayla kaybolmamalı.
  assert.equal(state.entities.quotation.revision, 20);
});

/* ------------------------------------------------------- BOZUK VERİ YOK */

test('yazma sırasında process kill edilirse hedef dosya BOZULMAZ (kısmi JSON kalmaz)', async t => {
  const root = await tempRoot(t, 'buyerlog-shared-revision-crash-');
  const store = new SharedRevisionStore(root);
  await store.update('quotation', { actorId: 'u1' });
  const before = await fsp.readFile(store.file, 'utf8');

  const storeModule = path.resolve(__dirname, '../server/lib/shared-revision-store.js');
  const script = `
    const { SharedRevisionStore } = require(process.env.TEST_STORE_MODULE);
    const store = new SharedRevisionStore(process.env.TEST_STORE_ROOT);
    // Kira alındıktan, geçici dosya yazıldıktan HEMEN SONRA — ama rename
    // tamamlanmadan önce süreci öldür.
    const fsp = require('fs/promises');
    const original = fsp.rename;
    fsp.rename = async (...args) => { process.kill(process.pid, 'SIGKILL'); return original(...args); };
    store.update('quotation', { actorId:'u2' }).catch(() => {});
  `;
  const child = spawn(process.execPath, ['-e', script], {
    env: { ...process.env, TEST_STORE_MODULE: storeModule, TEST_STORE_ROOT: root },
    stdio: 'ignore',
  });
  await new Promise(resolve => child.once('exit', resolve));

  // Hedef dosya: ya eski (rename hiç olmadı) ya da yeni (rename oldu) TAM
  // JSON olmalı — ikisinin ARASINDA kısmi bir içerik OLAMAZ.
  const after = await fsp.readFile(store.file, 'utf8');
  assert.doesNotThrow(() => JSON.parse(after), 'hedef dosya geçerli JSON olmalı');
  assert.ok(after === before || JSON.parse(after).entities.quotation.actorId === 'u2');

  // Kilit dizini kalıcı olarak kilitli bırakılmamalı — bir sonraki yazma
  // (bayatlama kurtarmasıyla) ilerleyebilmeli.
  const result = await store.update('quotation', { actorId: 'u3' });
  assert.equal(result.entities.quotation.actorId, 'u3');
});

/* ---------------------------------------------------- OKUMA ETKİLENMEZ */

test('okuma yazma ile aynı anda çalışabilir ve her zaman tam bir JSON görür', async t => {
  const root = await tempRoot(t, 'buyerlog-shared-revision-read-');
  const store = new SharedRevisionStore(root);
  await store.update('quotation', {});

  let readErrors = 0;
  const reads = Array.from({ length: 30 }, async () => {
    try { await store.read(); } catch (_) { readErrors += 1; }
  });
  const writes = Array.from({ length: 10 }, (_, i) => store.update('quotation', { seq: i }));
  await Promise.all([...reads, ...writes]);

  assert.equal(readErrors, 0);
});

/* --------------------------------------------------------- ÇAĞRI YOLU */

test('sunucu ateşle-unut çağrıları hâlâ tek argümanla kurulabilir (geriye dönük uyumlu)', () => {
  const store = new SharedRevisionStore(os.tmpdir());
  assert.ok(store instanceof SharedRevisionStore);
  assert.equal(typeof store.update, 'function');
});

test('server.js hâlâ tek argümanlı kurucuyu kullanıyor ve her update() void+catch ile ateşle-unut çağrılıyor', () => {
  const server = fs.readFileSync(path.join(__dirname, '..', 'server', 'server.js'), 'utf8');
  assert.match(server, /new SharedRevisionStore\(SHARED_DATA_ROOT\)/);
  const calls = server.match(/sharedRevisionStore\.update\([^)]*\)/g) || [];
  assert.ok(calls.length >= 10, 'çok sayıda çağrı yeri beklenir');
  for (const call of calls) {
    const index = server.indexOf(call);
    const before = server.slice(Math.max(0, index - 10), index);
    assert.match(before, /void\s*$/, `ateşle-unut olmalı: ...${before}${call}`);
  }
});
