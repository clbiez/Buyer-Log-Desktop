'use strict';

/*
 * ORTAK VERİNİN DELTA MOTORUNA TAŞINMASI — UYUMLULUK KATMANI TESTLERİ
 *
 * Bu katmanın taşıması gereken yük, hız değil GÜVENLİKTİR: geçiş sırasında
 * hiçbir kullanıcı kaydı düşmemeli, hiçbir veri görünmez olmamalı ve her faz
 * geri alınabilir olmalı. Testler bu garantileri tek tek çiviler.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createLocalDb } = require('../server/lib/local-db');
const { createDeltaStore, resolveMode, recordKey, MODES, DEFAULT_MODE } = require('../server/lib/delta-store');

async function freshDb(t) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'buyerlog-delta-store-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const db = createLocalDb(path.join(root, 'BuyerLogLocal.db'));
  await db.ensure();
  return { root, db };
}

const LINKS = {
  '1001': { plmId: '1001', styleId: '55501', styleName: 'BASIC TEE', season: '2026SS' },
  '1002': { plmId: '1002', styleId: '55502', styleName: 'CARGO PANT', season: '2026SS' },
};

/* ---------------------------------------------------- 1) FAZ SÖZLEŞMESİ */

test('varsayılan faz shadow: delta yetkili DEĞİL, eski JSON yazılmaya devam eder', async t => {
  const { db } = await freshDb(t);
  const store = createDeltaStore({ localDb: db });
  assert.equal(store.mode, DEFAULT_MODE);
  assert.equal(store.mode, 'shadow');
  assert.equal(store.isAuthoritative, false, 'shadow fazında okuma eski dosyadan gelmeli');
  assert.equal(store.writesLegacy, true, 'shadow fazında eski dosya yazılmaya devam etmeli');
});

test('delta fazı yetkilidir ama geri dönüş için eski dosyayı yazmayı sürdürür', async t => {
  const { db } = await freshDb(t);
  const store = createDeltaStore({ localDb: db, mode: 'delta' });
  assert.equal(store.isAuthoritative, true);
  assert.equal(store.writesLegacy, true, 'geri dönüş kopyası olmadan bu faza geçilmemeli');
});

test('delta-only fazı ağ yazmasını bırakır — donma ancak burada kalkar', async t => {
  const { db } = await freshDb(t);
  const store = createDeltaStore({ localDb: db, mode: 'delta-only' });
  assert.equal(store.isAuthoritative, true);
  assert.equal(store.writesLegacy, false);
});

test('tanınmayan faz sessizce en güvenli faza düşer', () => {
  for (const value of ['', null, undefined, 'DELTA_ONLY', 'kapali', 42]) {
    assert.equal(resolveMode(value), 'shadow', `${String(value)} shadow'a düşmeli`);
  }
  assert.deepEqual(MODES, ['shadow', 'delta', 'delta-only']);
});

/* ---------------------------------------------------- 2) VERİ KAYBETMEME */

test('ayna hatası kullanıcının kaydını DÜŞÜREMEZ; fırlatmaz, raporlar', async t => {
  const { db } = await freshDb(t);
  const reported = [];
  const store = createDeltaStore({ localDb: db, onError: (stage, error) => reported.push({ stage, error }) });

  const broken = { ...db, queuePatches: async () => { throw new Error('disk dolu'); } };
  const failing = createDeltaStore({ localDb: broken, onError: (stage, error) => reported.push({ stage, error }) });

  const result = await failing.mirror('plm-style-link', LINKS);
  assert.equal(result.ok, false, 'hata yutulmalı, fırlatılmamalı');
  assert.equal(result.mirrored, 0);
  assert.equal(reported.length, 1);
  assert.equal(reported[0].stage, 'mirror:plm-style-link');
  assert.match(reported[0].error.message, /disk dolu/);

  // Sağlam depo aynı veriyi hâlâ alabilmeli: başarısız ayna kalıcı hasar bırakmaz.
  assert.equal((await store.mirror('plm-style-link', LINKS)).ok, true);
});

test('raporlayıcının kendisi patlasa bile ayna çağrısı fırlatmaz', async t => {
  const { db } = await freshDb(t);
  const broken = { ...db, queuePatches: async () => { throw new Error('disk dolu'); } };
  const store = createDeltaStore({ localDb: broken, onError: () => { throw new Error('raporlayıcı da bozuk'); } });
  const result = await store.mirror('plm-style-link', LINKS);
  assert.equal(result.ok, false, 'ikinci hata da yutulmalı');
});

test('okuma hatası null döner; çağıran eski dosyaya düşer, veri görünmez olmaz', async t => {
  const broken = { read: async () => { throw new Error('DB okunamadı'); } };
  const reported = [];
  const store = createDeltaStore({ localDb: broken, onError: (stage, error) => reported.push(stage) });
  assert.equal(await store.readAll('plm-style-link'), null);
  assert.deepEqual(reported, ['read:plm-style-link']);
});

test('boş koleksiyon null döner — "delta boş" ile "delta yok" karışmamalı', async t => {
  const { db } = await freshDb(t);
  const store = createDeltaStore({ localDb: db });
  assert.equal(await store.readAll('plm-style-link'), null, 'hiç kayıt yokken null olmalı');
  await store.mirror('plm-style-link', LINKS);
  assert.notEqual(await store.readAll('plm-style-link'), null);
});

/* ---------------------------------------------------- 3) EŞLEME DOĞRULUĞU */

test('ayna kaydı eski JSON haritasıyla aynı biçimde geri okunur', async t => {
  const { db } = await freshDb(t);
  const store = createDeltaStore({ localDb: db });
  await store.mirror('plm-style-link', LINKS, { userId: 'u1' });

  const back = await store.readAll('plm-style-link');
  assert.deepEqual(Object.keys(back).sort(), ['1001', '1002']);
  assert.equal(back['1001'].styleId, '55501');
  assert.equal(back['1002'].styleName, 'CARGO PANT');
});

test('kayıt anahtarları koleksiyona göre ayrılır; iki koleksiyon birbirine sızmaz', async t => {
  const { db } = await freshDb(t);
  const store = createDeltaStore({ localDb: db });
  await store.mirror('plm-style-link', { '1001': { styleId: 'A' } });
  await store.mirror('email-group', { '1001': { name: 'Farklı varlık, aynı kimlik' } });

  assert.equal((await store.readAll('plm-style-link'))['1001'].styleId, 'A');
  assert.equal((await store.readAll('email-group'))['1001'].name, 'Farklı varlık, aynı kimlik');
  assert.equal((await store.readAll('plm-style-link'))['1001'].name, undefined, 'alanlar karışmamalı');
});

test('alan bazlı merge, iki kullanıcının aynı anda farklı alan yazmasını korur', async t => {
  const { db } = await freshDb(t);
  const store = createDeltaStore({ localDb: db });
  await store.mirror('plm-style-link', { '1001': { styleId: '55501', styleName: 'ESKİ' } });
  // Bugünkü "tüm dosyayı ez" davranışında bu yazma styleId'yi de geri alırdı.
  await store.mirror('plm-style-link', { '1001': { styleName: 'YENİ' } });

  const back = await store.readAll('plm-style-link');
  assert.equal(back['1001'].styleName, 'YENİ', 'yeni değer uygulanmalı');
  assert.equal(back['1001'].styleId, '55501', 'dokunulmayan alan korunmalı');
});

test('iç alanlar (_revision gibi) kayda taşınmaz', async t => {
  const { db } = await freshDb(t);
  const store = createDeltaStore({ localDb: db });
  await store.mirror('plm-style-link', { '1001': { styleId: 'A', _revision: 9, _updatedAt: 'x' } });
  const back = await store.readAll('plm-style-link');
  assert.equal(back['1001'].styleId, 'A');
  assert.equal(back['1001']._revision, undefined);
  assert.equal(back['1001']._updatedAt, undefined);
});

/* ---------------------------------------------------- 4) JOURNAL / SYNC */

test('her kayıt ayrı journal olayı üretir; sync tanesini ayrı taşıyabilir', async t => {
  const { db } = await freshDb(t);
  const store = createDeltaStore({ localDb: db });
  await store.mirror('plm-style-link', LINKS, { userId: 'u1' });

  const pending = await db.pending();
  assert.equal(pending.length, 2, 'kayıt başına bir olay');
  assert.deepEqual(pending.map(item => item.entityType), ['plm-style-link', 'plm-style-link']);
  assert.deepEqual(pending.map(item => item.userId), ['u1', 'u1']);
  for (const item of pending) assert.equal(item.sha256.length, 64, 'her paket checksum taşımalı');
});

test('toplu yazma DB dosyasını kayıt başına yeniden yazmaz', async t => {
  const { db } = await freshDb(t);
  const store = createDeltaStore({ localDb: db });
  const many = {};
  for (let i = 0; i < 200; i++) many[String(i)] = { styleId: `S${i}` };

  /* v7.86: sıcak yol anlık görüntüyü hiç yeniden yazmıyor, WAL'a ekliyor.
     Ölçü de buna göre: 200 kayıt için kaç kez WAL açıldı ve kaç kez tam
     görüntü yazıldı (geçici dosya). Beklenen: bir WAL turu, sıfır görüntü. */
  const open = fsp.open;
  let walOpens = 0, snapshotTmpOpens = 0;
  fsp.open = (...args) => {
    const target = String(args[0]);
    if (target.endsWith('.wal')) walOpens += 1;
    // Lease metadata also uses .tmp files. Only a temporary image of this DB
    // (including its backup) is a snapshot rewrite, regardless of lease I/O.
    else if (target.startsWith(db.file + '.') && target.endsWith('.tmp')) snapshotTmpOpens += 1;
    return open(...args);
  };
  try { await store.mirror('plm-style-link', many); } finally { fsp.open = open; }

  assert.equal(walOpens, 1, `200 kayıt tek WAL turunda yazılmalı; ${walOpens} tur açıldı`);
  assert.equal(snapshotTmpOpens, 0, 'sıcak yol tam görüntü yeniden yazmamalı');
  assert.equal(Object.keys(await store.readAll('plm-style-link')).length, 200);
  assert.equal((await db.pending(1000)).length, 200, 'yine de kayıt başına bir sync olayı');
});

/* ---------------------------------------------------- 5) TOHUMLAMA */

test('tohumlama bir kez çalışır ve mevcut kayıtları ezmez', async t => {
  const { db } = await freshDb(t);
  const store = createDeltaStore({ localDb: db });

  const first = await store.seedOnce('plm-style-link', LINKS);
  assert.equal(first.seeded, 2);
  assert.equal(first.skipped, false);

  // Kullanıcı tohumlamadan sonra bir kaydı değiştirir.
  await store.mirror('plm-style-link', { '1001': { styleName: 'KULLANICI DEĞİŞTİRDİ' } });

  const second = await store.seedOnce('plm-style-link', LINKS);
  assert.equal(second.skipped, true, 'ikinci kez tohumlanmamalı');
  assert.equal(second.seeded, 0);
  assert.equal((await store.readAll('plm-style-link'))['1001'].styleName, 'KULLANICI DEĞİŞTİRDİ',
    'tohumlama kullanıcının değişikliğini geri almamalı');
});

test('tohumlama işareti kalıcıdır; süreç yeniden başlasa da tekrarlamaz', async t => {
  const { root } = await freshDb(t);
  const file = path.join(root, 'BuyerLogLocal.db');
  const first = createLocalDb(file);
  await first.ensure();
  await createDeltaStore({ localDb: first }).seedOnce('plm-style-link', LINKS);

  const second = createLocalDb(file);
  await second.ensure();
  const again = await createDeltaStore({ localDb: second }).seedOnce('plm-style-link', LINKS);
  assert.equal(again.skipped, true);

  const state = await second.read();
  assert.equal(state.migrations['deltaStoreSeed:plm-style-link'].count, 2);
});

test('tohumlama hatası fırlatmaz ve işaret koymaz — sonra tekrar denenebilir', async t => {
  const { db } = await freshDb(t);
  const reported = [];
  const broken = { read: db.read, transaction: db.transaction, queuePatches: async () => { throw new Error('ağ gitti'); } };
  const store = createDeltaStore({ localDb: broken, onError: (stage) => reported.push(stage) });

  const result = await store.seedOnce('plm-style-link', LINKS);
  assert.equal(result.seeded, 0, 'hiçbir kayıt tohumlanmamalı');
  assert.ok(reported.includes('mirror:plm-style-link'));

  // İşaret KONULMUŞ olsa bile içerik boş kalırdı; sağlam depoda tekrar denenince
  // gerçekten tohumlanabildiğini doğrula.
  const healthy = createDeltaStore({ localDb: db });
  assert.equal((await healthy.seedOnce('plm-style-link', LINKS)).seeded, 2);
});

/* ---------------------------------------------------- 6) OKUMA YOLU / FAZ GEÇİŞİ */

test('hydrate edilmemiş depo null döner — yükleme hatası "veri silinmiş" gibi görünmez', async t => {
  const { db } = await freshDb(t);
  const store = createDeltaStore({ localDb: db, mode: 'delta' });
  await store.mirror('plm-style-link', LINKS);
  assert.equal(store.isHydrated, false);
  assert.equal(store.readAllSync('plm-style-link'), null, 'hydrate öncesi okuma eski dosyaya düşmeli');
  await store.hydrate();
  assert.equal(store.isHydrated, true);
  assert.equal(Object.keys(store.readAllSync('plm-style-link')).length, 2);
});

test('hydrate hatası deposu boş göstermez; eski dosya yolu korunur', async t => {
  const reported = [];
  const store = createDeltaStore({ localDb: { read: async () => { throw new Error('DB bozuk'); } }, mode: 'delta', onError: s => reported.push(s) });
  const result = await store.hydrate();
  assert.equal(result.ok, false);
  assert.equal(store.isHydrated, false, 'başarısız hydrate depoyu "yüklendi ve boş" saymamalı');
  assert.equal(store.readAllSync('plm-style-link'), null);
  assert.deepEqual(reported, ['hydrate']);
});

test('yazma belleği günceller; hydrate beklemeden okunabilir', async t => {
  const { db } = await freshDb(t);
  const store = createDeltaStore({ localDb: db, mode: 'delta' });
  await store.hydrate();
  await store.mirror('plm-style-link', { '1001': { styleId: '55501' } });
  assert.equal(store.readAllSync('plm-style-link')['1001'].styleId, '55501', 'yazma anında görünmeli');
});

test('disk yazması başarısızsa bellek KİRLENMEZ', async t => {
  const { db } = await freshDb(t);
  const store = createDeltaStore({ localDb: db, mode: 'delta' });
  await store.hydrate();
  await store.mirror('plm-style-link', { '1001': { styleId: 'DISKTE VAR' } });

  const broken = createDeltaStore({ localDb: { ...db, queuePatches: async () => { throw new Error('disk dolu'); }, read: db.read }, mode: 'delta' });
  await broken.hydrate();
  await broken.mirror('plm-style-link', { '1001': { styleId: 'DISKE YAZILAMADI' } });
  assert.equal(broken.readAllSync('plm-style-link')['1001'].styleId, 'DISKTE VAR',
    'diske gitmeyen değer bellekte görünmemeli');
});

test('silinen kayıt bellekten de düşer', async t => {
  const { db } = await freshDb(t);
  const store = createDeltaStore({ localDb: db, mode: 'delta' });
  await store.mirror('plm-style-link', LINKS);
  await store.hydrate();
  await store.removeMirrored('plm-style-link', ['1001']);
  assert.deepEqual(Object.keys(store.readAllSync('plm-style-link')), ['1002']);
});

test('meta iş kayıtlarına karışmaz; revizyon delta-only fazında da ilerler', async t => {
  const { db } = await freshDb(t);
  const store = createDeltaStore({ localDb: db, mode: 'delta-only' });
  await store.mirror('plm-style-link', LINKS);
  await store.writeMeta('plm-style-link', { revision: 7, updatedAt: '2026-09-02T00:00:00.000Z' });
  await store.hydrate();

  assert.equal(store.readMetaSync('plm-style-link').revision, 7);
  assert.deepEqual(Object.keys(store.readAllSync('plm-style-link')).sort(), ['1001', '1002'],
    'meta kaydı iş kayıtlarının arasına karışmamalı');
});

test('iki nokta içeren koleksiyon adı reddedilir — kayıtlar sessizce kaybolmamalı', () => {
  // Anahtar "koleksiyon:kimlik" biçiminde ve ilk iki noktadan ayrıştırılıyor.
  // Adın kendisinde iki nokta olsaydı kayıtlar yanlış koleksiyona düşerdi.
  assert.throws(() => recordKey('meta:plm-style-link', 'store'), /iki nokta içeremez/);
  assert.throws(() => recordKey('', 'store'), /iki nokta içeremez/);
  assert.equal(recordKey('plm-style-link', '1001'), 'plm-style-link:1001');
});

test('faz ilerletmek ve geri almak veri kaybettirmez', async t => {
  const { root } = await freshDb(t);
  const file = path.join(root, 'BuyerLogLocal.db');

  // shadow: yazılan her şey aynaya da gider
  const shadowDb = createLocalDb(file); await shadowDb.ensure();
  const shadow = createDeltaStore({ localDb: shadowDb, mode: 'shadow' });
  await shadow.seedOnce('plm-style-link', LINKS);
  await shadow.mirror('plm-style-link', { '1003': { plmId: '1003', styleId: '55503' } });

  // delta: aynı veri yetkili kaynak olarak okunabilmeli
  const deltaDb = createLocalDb(file); await deltaDb.ensure();
  const delta = createDeltaStore({ localDb: deltaDb, mode: 'delta' });
  await delta.hydrate();
  assert.deepEqual(Object.keys(delta.readAllSync('plm-style-link')).sort(), ['1001', '1002', '1003']);

  // geri shadow'a dönülse bile kayıtlar yerinde durur
  const backDb = createLocalDb(file); await backDb.ensure();
  const back = createDeltaStore({ localDb: backDb, mode: 'shadow' });
  await back.hydrate();
  assert.equal(Object.keys(back.readAllSync('plm-style-link')).length, 3,
    'faz geri alınınca delta kayıtları silinmemeli');
});

/* ---------------------------------------------------- 7) SİLME */

test('silinen kayıt tombstone bırakır ve okumadan düşer', async t => {
  const { db } = await freshDb(t);
  const store = createDeltaStore({ localDb: db });
  await store.mirror('plm-style-link', LINKS);

  const removed = await store.removeMirrored('plm-style-link', ['1001']);
  assert.equal(removed.removed, 1);

  const back = await store.readAll('plm-style-link');
  assert.deepEqual(Object.keys(back), ['1002'], 'silinen kayıt okumada görünmemeli');
});

test('silme hatası da yutulur; eski dosya yolunu engellemez', async t => {
  const reported = [];
  const broken = { tombstone: async () => { throw new Error('kilit meşgul'); } };
  const store = createDeltaStore({ localDb: broken, onError: stage => reported.push(stage) });
  const result = await store.removeMirrored('plm-style-link', ['1001']);
  assert.equal(result.ok, false);
  assert.deepEqual(reported, ['remove:plm-style-link']);
});
