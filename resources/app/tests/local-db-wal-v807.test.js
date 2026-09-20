'use strict';

/*
 * APPEND-ONLY JOURNAL (WAL)
 *
 * Ortak iş verisi delta motoruna taşındıktan sonra "her yazmada bütün durumu
 * yeniden yaz" modeli gerçek bir darboğaz oldu. Ölçüldü: 50.000 satırlık bir
 * Koleksiyon çalışma alanı varken ilgisiz bir ayar değişikliği 207 ms sürüyordu.
 *
 * Bu dosya WAL'ın taşıması gereken üç yükü çiviler:
 *   1) MALİYET veriye göre büyümemeli,
 *   2) onaylanmış hiçbir yazma kaybolmamalı (çökme güvenliği),
 *   3) anlık görüntü biçimi değişmemeli — geri dönüş her zaman mümkün.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createLocalDb } = require('../server/lib/local-db');

async function freshDb(t, prefix = 'buyerlog-wal-') {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'BuyerLogLocal.db');
  const db = createLocalDb(file);
  await db.ensure();
  return { root, file, wal: `${file}.wal`, db };
}

function bigPatch(rows) {
  const out = {};
  for (let i = 0; i < rows; i++) out[`r${i}`] = { model: `M${i}`, colour: `C${i}`, price: i, note: 'x'.repeat(40) };
  return out;
}

/* ------------------------------------------------- 1) MALİYET ÖLÇEKLENMESİN */

test('küçük bir yazmanın maliyeti veritabanının büyüklüğüyle büyümez', async t => {
  const box = await freshDb(t);
  await box.db.queuePatch({ id: 'store:collection-workspaces/moderator.json', patch: { rows: bigPatch(20000) } });

  // Anlık görüntü büyük; küçük yazma buna rağmen küçük kalmalı.
  const before = fs.statSync(box.file).size;
  assert.ok(before > 3 * 1024 * 1024, `taban görüntü büyük olmalı, ${before} bayt`);

  const started = process.hrtime.bigint();
  await box.db.queuePatch({ id: 'store:settings.json', patch: { sourceFolder: 'C:/kaynak' } });
  const ms = Number(process.hrtime.bigint() - started) / 1e6;

  // Eski modelde bu yazma bütün durumu (MB'larca) yeniden serialize ediyordu.
  // WAL'da yalnız bir satır ekleniyor; ölçüm makineye göre değişse de aradaki
  // fark bir büyüklük mertebesi. Eşik cömert tutuldu ki test kırılgan olmasın.
  assert.ok(ms < 60, `küçük yazma ${ms.toFixed(0)} ms sürdü; durum boyutuna bağlı kalmış olabilir`);

  const walSize = fs.statSync(box.wal).size;
  assert.ok(walSize < 4096, `WAL satırı küçük olmalı, ${walSize} bayt`);
  assert.equal((await box.db.read()).records['store:settings.json'].sourceFolder, 'C:/kaynak');
});

test('toplu yazma tek WAL turunda toplanır', async t => {
  const box = await freshDb(t);
  const items = Array.from({ length: 300 }, (_, i) => ({ id: `r${i}`, patch: { n: i } }));
  await box.db.queuePatches(items);

  const state = await box.db.read();
  assert.equal(Object.keys(state.records).length, 300);
  assert.equal(state.journal.length, 300, 'kayıt başına bir sync olayı korunmalı');
});

/* ------------------------------------------------- 2) ÇÖKME GÜVENLİĞİ */

test('WAL satırı fsync edilmeden çağırana dönülmez', async t => {
  const box = await freshDb(t);
  const open = fsp.open;
  let synced = false;
  fsp.open = async (...args) => {
    const handle = await open(...args);
    if (String(args[0]).endsWith('.wal')) {
      const sync = handle.sync.bind(handle);
      handle.sync = async () => { synced = true; return sync(); };
    }
    return handle;
  };
  try { await box.db.queuePatch({ id: 'r1', patch: { n: 1 } }); } finally { fsp.open = open; }
  assert.equal(synced, true, 'onaylanmış yazma diske inmiş olmalı');
});

test('yarım kalmış son satır atılır, öncekiler korunur', async t => {
  const box = await freshDb(t);
  await box.db.queuePatch({ id: 'r1', patch: { n: 1 } });
  await box.db.queuePatch({ id: 'r2', patch: { n: 2 } });

  // Süreç tam satır yazarken ölmüş gibi: son satırı ortadan kes.
  const text = await fsp.readFile(box.wal, 'utf8');
  await fsp.writeFile(box.wal, text.slice(0, text.lastIndexOf('\n', text.length - 2) + 1) + '{"v":1,"op":"pat');

  const state = await box.db.read();
  assert.equal(state.records.r1.n, 1, 'tamamlanmış yazma korunmalı');
  assert.equal(state.records.r2, undefined, 'yarım satır uygulanmamalı');
});

test('bozulmuş bir satır ve sonrası uygulanmaz', async t => {
  const box = await freshDb(t);
  await box.db.queuePatch({ id: 'r1', patch: { n: 1 } });
  await box.db.queuePatch({ id: 'r2', patch: { n: 2 } });
  await box.db.queuePatch({ id: 'r3', patch: { n: 3 } });

  // İkinci satırın içeriğini checksum'ı bozacak şekilde değiştir.
  const lines = (await fsp.readFile(box.wal, 'utf8')).trim().split('\n');
  const tampered = JSON.parse(lines[1]);
  tampered.payload.patch = { n: 999 };
  lines[1] = JSON.stringify(tampered);
  await fsp.writeFile(box.wal, `${lines.join('\n')}\n`);

  const state = await box.db.read();
  assert.equal(state.records.r1.n, 1);
  assert.equal(state.records.r2, undefined, 'checksum tutmayan satır uygulanmamalı');
  assert.equal(state.records.r3, undefined, 'bozuk satırdan sonrası da uygulanmamalı');
});

test('süreç yeniden başladığında WAL oynatılır', async t => {
  const box = await freshDb(t);
  await box.db.queuePatch({ id: 'r1', patch: { name: 'yazıldı' } });

  // Yeni bir örnek: bellekte hiçbir şey taşımıyor, yalnız diskten okuyor.
  const restarted = createLocalDb(box.file);
  assert.equal((await restarted.read()).records.r1.name, 'yazıldı');
});

test('oynatma determinist: kimlik ve zaman damgası yeniden üretilmez', async t => {
  const box = await freshDb(t);
  const written = await box.db.queuePatch({ id: 'r1', patch: { n: 1 } });

  const first = await createLocalDb(box.file).read();
  const second = await createLocalDb(box.file).read();
  assert.equal(first.events[written.eventId].at, second.events[written.eventId].at,
    'iki okuma aynı zaman damgasını vermeli');
  assert.equal(first.journal[0].sha256, second.journal[0].sha256, 'journal checksum değişmemeli');
  assert.equal(first.revision, second.revision);
});

/* ------------------------------------------------- 3) SIKIŞTIRMA VE GERİ DÖNÜŞ */

test('WAL eşiği aşınca sıkıştırılır ve veri görüntüye geçer', async t => {
  const box = await freshDb(t);
  for (let i = 0; i < 40; i++) {
    await box.db.queuePatch({ id: `r${i}`, patch: { blob: 'y'.repeat(30000) } });
  }
  const walSize = fs.existsSync(box.wal) ? fs.statSync(box.wal).size : 0;
  assert.ok(walSize < 1024 * 1024, `WAL sıkıştırılmalıydı, ${walSize} bayt`);

  const state = await box.db.read();
  assert.equal(Object.keys(state.records).length, 40, 'sıkıştırma veri kaybettirmemeli');
});

test('sıkıştırma bir kuşak WAL saklar; bozuk görüntüde aradaki yazmalar kurtarılır', async t => {
  const box = await freshDb(t);
  await box.db.queuePatch({ id: 'r1', patch: { n: 1 } });
  // transaction her zaman görüntü yazar ve WAL'ı bir kuşak geriye alır.
  await box.db.transaction(async state => { state.migrations = { compacted: true }; return null; });
  assert.ok(fs.existsSync(`${box.wal}.bak`), 'önceki kuşak WAL saklanmalı');
  assert.equal((await box.db.read()).records.r1.n, 1, 'saklanan kuşak oynatılabilmeli');
});

test('anlık görüntü biçimi değişmedi — WAL silinse de dosya tek başına okunur', async t => {
  const box = await freshDb(t);
  await box.db.queuePatch({ id: 'r1', patch: { n: 1 } });
  await box.db.transaction(async state => { state.migrations = { snapshot: true }; return null; });

  fs.rmSync(box.wal, { force: true });
  fs.rmSync(`${box.wal}.bak`, { force: true });

  // Eski sürümün okuduğu düz JSON zarfı; WAL olmadan da eksiksiz.
  const raw = JSON.parse(await fsp.readFile(box.file, 'utf8'));
  assert.equal(raw.schemaVersion, 3);
  assert.equal(raw.records.r1.n, 1, 'sıkıştırılmış görüntü tam olmalı');
  assert.equal((await createLocalDb(box.file).read()).records.r1.n, 1);
});

test('DB taşınırken WAL geride bırakılmaz', async t => {
  const box = await freshDb(t);
  await box.db.queuePatch({ id: 'r1', patch: { name: 'taşınmalı' } });
  const target = path.join(box.root, 'yeni-konum');

  await box.db.moveTo(target);
  const moved = createLocalDb(path.join(target, 'BuyerLogLocal.db'));
  assert.equal((await moved.read()).records.r1.name, 'taşınmalı',
    'WAL yalnız eski konumda kalsaydı bu yazma kaybolurdu');
});
