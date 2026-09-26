'use strict';

/*
 * Buyer Log local-first store.
 *
 * The file intentionally has a .db suffix but uses a small, dependency-free
 * JSON envelope.  This keeps the portable Node install dependency-free while
 * providing the database semantics the UI needs: journal-before-sync,
 * idempotent events, revisions, field-level merges and tombstones.
 */
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { withFileLeaseAsync, replaceFileWithRetry } = require('./shared-file-transaction');
const { resolveLocalDbFolder } = require('./local-path-policy');
const { createDurableFileRecovery } = require('./durable-file-recovery');

const SCHEMA_VERSION = 3;
const DEFAULT_DB_NAME = 'BuyerLogLocal.db';

function now() { return new Date().toISOString(); }
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function eventId(value) { return String(value || '').trim().slice(0, 160); }
function recordId(value) { return String(value || '').trim().slice(0, 240); }
function sha256(buffer) { return crypto.createHash('sha256').update(buffer).digest('hex'); }

function emptyState(deviceId = crypto.randomUUID()) {
  return {
    schemaVersion: SCHEMA_VERSION, revision: 0, deviceId: String(deviceId), localSequence: 0,
    records: {}, tombstones: {}, events: {}, appliedEvents: {}, appliedPackages: {}, conflicts: [], journal: [],
    syncCheckpoints: {}, syncLedger: { version: 1, eventIds: {}, acknowledgedEventIds: {}, compactedEvents: 0, compactedThrough: 0, acknowledgedThrough: 0, ranges: [], receivedBeyondByDevice: {} }, assets: {}, migrations: {},
  };
}

function dataIntegrityError(file, errors = []) {
  const details = errors.map(item => `${path.basename(item.file)}: ${item.error && item.error.message || item.error}`).join('; ');
  return Object.assign(new Error(`BuyerLogLocal.db okunamadı; mevcut veri korunuyor. ${details}`), {
    code: 'DATA_INTEGRITY_ERROR', statusCode: 503, file, errors,
  });
}
function normalizeState(raw, deviceId) {
  const state = { ...emptyState(deviceId || undefined), ...(raw && typeof raw === 'object' ? raw : {}) };
  state.schemaVersion = SCHEMA_VERSION;
  state.deviceId = String(state.deviceId || deviceId || crypto.randomUUID());
  state.localSequence = Number(state.localSequence) || 0;
  state.appliedEvents = state.appliedEvents && typeof state.appliedEvents === 'object' ? state.appliedEvents : {};
  state.appliedPackages = state.appliedPackages && typeof state.appliedPackages === 'object' ? state.appliedPackages : {};
  state.conflicts = Array.isArray(state.conflicts) ? state.conflicts : [];
  state.syncCheckpoints = state.syncCheckpoints && typeof state.syncCheckpoints === 'object' ? state.syncCheckpoints : {};
  const ledger = state.syncLedger && typeof state.syncLedger === 'object' ? state.syncLedger : {};
  state.syncLedger = {
    version: 1,
    eventIds: ledger.eventIds && typeof ledger.eventIds === 'object' ? ledger.eventIds : {},
    acknowledgedEventIds: ledger.acknowledgedEventIds && typeof ledger.acknowledgedEventIds === 'object' ? ledger.acknowledgedEventIds : {},
    compactedEvents: Math.max(0, Number(ledger.compactedEvents) || 0),
    compactedThrough: Math.max(0, Number(ledger.compactedThrough) || 0),
    acknowledgedThrough: Math.max(0, Number(ledger.acknowledgedThrough) || 0),
    ranges: Array.isArray(ledger.ranges) ? ledger.ranges.slice(-200) : [],
    receivedBeyondByDevice: ledger.receivedBeyondByDevice && typeof ledger.receivedBeyondByDevice === 'object' ? ledger.receivedBeyondByDevice : {},
  };
  state.records = state.records && typeof state.records === 'object' ? state.records : {};
  state.tombstones = state.tombstones && typeof state.tombstones === 'object' ? state.tombstones : {};
  state.events = state.events && typeof state.events === 'object' ? state.events : {};
  state.journal = Array.isArray(state.journal) ? state.journal : [];
  state.assets = state.assets && typeof state.assets === 'object' ? state.assets : {};
  state.migrations = state.migrations && typeof state.migrations === 'object' ? state.migrations : {};
  return state;
}
async function readState(file, deviceId = null) {
  const errors = [];
  for (const candidate of [file, `${file}.bak`]) {
    try {
      const state = normalizeState(JSON.parse(await fsp.readFile(candidate, 'utf8')), deviceId);
      if (candidate !== file) {
        // Keep the unreadable primary for forensics, then restore the validated
        // backup. writeState must not copy the corrupt primary over the backup.
        if (fs.existsSync(file)) {
          const quarantine = `${file}.corrupt-${Date.now()}`;
          await replaceFileWithRetry(file, quarantine);
        }
        await writeState(file, state);
        /* Çağıran bunu bilmek zorunda: yedekten dönülen görüntü, WAL'daki
           işlemleri İÇERMEZ. Oynatma bittikten sonra yeniden sıkıştırılmalı,
           yoksa onarılmış birincil dosya eksik kalır. Sayılmayan alan olarak
           iliştirilir; JSON.stringify ve Object.keys etkilenmez. */
        Object.defineProperty(state, '__restoredFromBackup', { value: true, enumerable: false, configurable: true });
      }
      return state;
    } catch (error) {
      if (error && error.code === 'ENOENT') continue;
      errors.push({ file: candidate, error });
    }
  }
  if (!fs.existsSync(file) && !fs.existsSync(`${file}.bak`) && !errors.length) return emptyState(deviceId || undefined);
  throw dataIntegrityError(file, errors);
}

async function writeState(file, state) {
  const folder = path.dirname(path.resolve(file));
  const recovery = createDurableFileRecovery({
    recoveryRoot: path.join(folder, '.buyerlog-db-recovery'),
    allowedRoots: [folder],
  });
  await recovery.replace(file, Buffer.from(JSON.stringify(state, null, 2), 'utf8'));
}

/* Belge defteri (delta-store DOCUMENT_REVISION_META): her cihaz kendi
   yazımında yerel revizyon sayacını ve zaman damgasını günceller. İş verisi
   değildir; kullanıcıya "çakışma" olarak sorulacak bir seçim içermez. Yüksek
   revizyonlu defter kazanır, eşitlikte yerel kalır. */
const DOCUMENT_REVISION_META_FIELD = 'storeRevisionMeta';
function newerRevisionMeta(current, incoming) {
  const currentRevision = Number(current && current.revision) || 0;
  const incomingRevision = Number(incoming && incoming.revision) || 0;
  return incoming && typeof incoming === 'object' && incomingRevision > currentRevision ? incoming : current;
}

/* PAYLAŞILAN BELGE LİSTELERİ — kayıt bazında birleşim.
   Fiyat talepleri ve e-posta grupları tek bir belge alanında dizi olarak
   durur. İki cihaz aynı aralıkta AYRI kayıt eklediğinde alanı bütün olarak
   seçmek (çakışma) bir tarafın kaydını kaybettirirdi. Bu alanlar kimliğe göre
   birleştirilir: aynı kayıtta en yeni updatedAt kazanır (eşitlikte içerik
   karşılaştırması iki cihazda aynı sonucu verir); silinen e-posta kaydı
   silindi işaretiyle birleşimden düşer. Birleşim değişmeli ve tekrarlanabilir
   olduğu için cihazlar yeniden yayına gerek kalmadan aynı sonuca yakınsar. */
const DOCUMENT_LIST_MERGE = Object.freeze({
  'store:quotations.json': { requests: { tombstones: 'deletedRequests' }, deletedRequests: { tombstoneMap: true } },
  'store:email-groups.json': { records: { tombstones: 'deletedRecords' }, deletedRecords: { tombstoneMap: true } },
});
function mergeTombstoneMaps(a, b) {
  const out = { ...(a && typeof a === 'object' ? a : {}) };
  for (const [id, at] of Object.entries(b && typeof b === 'object' ? b : {})) if (!out[id] || String(at) > String(out[id])) out[id] = at;
  return out;
}
function newerListItem(a, b) {
  const at = String(a && a.updatedAt || ''), bt = String(b && b.updatedAt || '');
  if (at !== bt) return at > bt ? a : b;
  return JSON.stringify(a) >= JSON.stringify(b) ? a : b;
}
function mergeListById(current, incoming, tombstones = {}) {
  const out = new Map(), extra = [];
  for (const item of [...(Array.isArray(current) ? current : []), ...(Array.isArray(incoming) ? incoming : [])]) {
    const id = item && typeof item === 'object' ? String(item.id || '') : '';
    if (!id) { extra.push(item); continue; }
    out.set(id, out.has(id) ? newerListItem(out.get(id), item) : item);
  }
  return [...out.values()].filter(item => !(tombstones[item.id] && String(tombstones[item.id]) >= String(item.updatedAt || ''))).concat(extra);
}
function listMergeRule(recordKey, field) {
  const rules = DOCUMENT_LIST_MERGE[String(recordKey || '')];
  return rules && Object.prototype.hasOwnProperty.call(rules, field) ? rules[field] : null;
}

function fieldMerge(current, incoming, revision, baseRevision = null, recordKey = '') {
  const base = current && typeof current === 'object' ? current : {};
  const next = { ...base };
  const fields = { ...(base._fieldRevisions || {}) };
  const conflicts = [];
  for (const [key, value] of Object.entries(incoming && typeof incoming === 'object' ? incoming : {})) {
    if (key === '_fieldRevisions' || key === '_revision') continue;
    const previousRevision = Number(fields[key]) || 0;
    if (key === DOCUMENT_REVISION_META_FIELD && next[key] && typeof next[key] === 'object') {
      next[key] = newerRevisionMeta(next[key], value);
      fields[key] = Math.max(previousRevision, revision);
      continue;
    }
    /* Uzak olayda liste alanı HER ZAMAN kimlikle birleşir. Cihaz sayaçları
       bağımsız ilerlediği için "yerelde değişti mi" sorusu revizyonla her zaman
       doğru cevaplanamaz; yerel kaydı hiç görmemiş cihazın yüksek tabanlı olayı
       listeyi bütün olarak yazıp yeni kaydı sessizce siliyordu. Birleşim
       değişmeli ve tekrarlanabilir olduğundan her durumda güvenlidir; silme,
       silme iziyle taşınır. (Yerel yazımda recordKey yoktur: liste aynen yazılır.) */
    const listRule = recordKey ? listMergeRule(recordKey, key) : null;
    if (listRule && next[key] !== undefined) {
      if (listRule.tombstoneMap) next[key] = mergeTombstoneMaps(next[key], value);
      else next[key] = mergeListById(next[key], value, listRule.tombstones ? mergeTombstoneMaps(next[listRule.tombstones], incoming[listRule.tombstones]) : {});
      fields[key] = Math.max(previousRevision, revision);
      continue;
    }
    const changedLocally = baseRevision != null && previousRevision > Number(baseRevision || 0) && JSON.stringify(next[key]) !== JSON.stringify(value);
    if (changedLocally || (baseRevision == null && previousRevision > revision)) {
      const rule = listMergeRule(recordKey, key);
      if (rule) {
        if (rule.tombstoneMap) next[key] = mergeTombstoneMaps(next[key], value);
        else {
          const tombstones = rule.tombstones ? mergeTombstoneMaps(next[rule.tombstones], incoming[rule.tombstones]) : {};
          next[key] = mergeListById(next[key], value, tombstones);
        }
        fields[key] = Math.max(previousRevision, revision);
        continue;
      }
      conflicts.push({ field: key, current: clone(next[key]), incoming: clone(value), currentRevision: previousRevision, baseRevision: Number(baseRevision) || 0 });
      continue;
    }
    next[key] = value;
    fields[key] = revision;
  }
  next._fieldRevisions = fields;
  next._revision = Math.max(Number(base._revision) || 0, revision);
  return { value: next, conflicts };
}

/* ===================================================================
   APPEND-ONLY JOURNAL (WAL)

   PROBLEM. Yerel DB tek bir JSON zarfı ve her transaction bütün durumu
   yeniden yazıyor. Ortak iş verisi motora taşındıktan sonra bu maliyet
   gerçek oldu; ölçüldü:

     500 satırlık çalışma alanı  -> DB 0.2 MB, küçük bir yazma  10 ms
     5.000 satır                 -> DB 1.7 MB, küçük bir yazma  30 ms
     50.000 satır                -> DB 17.4 MB, küçük bir yazma 207 ms

   Yani tek bir ayar değişikliği, ilgisiz bir Koleksiyon sayfası büyüdüğü
   için yavaşlıyor. Maliyet veriye göre doğrusal.

   ÇÖZÜM. Yazma iki parçaya ayrılır:

     BuyerLogLocal.db      anlık görüntü — BİÇİMİ DEĞİŞMEDİ
     BuyerLogLocal.db.wal  o görüntüden sonraki işlemler, satır satır

   Sıcak yol (patch/tombstone/delta) yalnız WAL'a bir satır ekler: maliyet
   işlemin boyutuyla orantılı, durumun boyutuyla değil. Okuma anlık
   görüntüyü alır ve WAL'ı üzerine oynatır. WAL büyüyünce yeni bir anlık
   görüntü yazılıp WAL boşaltılır (compaction).

   ANLIK GÖRÜNTÜ BİÇİMİ AYNI KALDI. Bu bilinçli: WAL silinse bile eski
   sürüm dosyayı okuyabilir, yani geri dönüş her zaman mümkün.

   ÇÖKME GÜVENLİĞİ. Her satır kendi sha256'sını taşır. Yarım yazılmış ya
   da bozuk bir satırda oynatma DURUR ve sonrası atılır — append-only
   olduğu için sıra korunur, dolayısıyla bozuk satırdan sonrası zaten
   onaylanmamış yazmalardır. Satır fsync edilmeden çağırana dönülmez, yani
   onaylanmış hiçbir yazma kaybolmaz.

   REPLAY DETERMİNİST OLMALI. eventId ve zaman damgası çağrı anında
   üretilip WAL'a YAZILIR; oynatma sırasında yeniden üretilmez. revision ve
   localSequence durumdan türediği için sıralı oynatmada kendiliğinden
   aynı çıkar.
   =================================================================== */
const WAL_SUFFIX = '.wal';
const WAL_VERSION = 1;
/* Eşikler: WAL bu boyutu ya da satır sayısını aşınca sıkıştırılır. Amaç,
   açılıştaki oynatma maliyetini sınırlı tutmak. */
const WAL_MAX_BYTES = 1024 * 1024;
const WAL_MAX_ENTRIES = 2000;

function walLine(operation, payload) {
  const entry = { v: WAL_VERSION, op: operation, payload };
  entry.sha256 = sha256(Buffer.from(JSON.stringify(entry), 'utf8'));
  return `${JSON.stringify(entry)}\n`;
}

/* Bozuk ya da yarım satırda durur. Döndürülen sayı, güvenle uygulanabilen
   işlem sayısıdır; sonrası sessizce atılmaz, `truncated` ile bildirilir. */
function parseWal(text) {
  const entries = [];
  let truncated = false;
  for (const line of String(text || '').split('\n')) {
    if (!line.trim()) continue;
    let entry = null;
    try { entry = JSON.parse(line); } catch (_) { truncated = true; break; }
    if (!entry || entry.v !== WAL_VERSION || !entry.op) { truncated = true; break; }
    const expected = sha256(Buffer.from(JSON.stringify({ v: entry.v, op: entry.op, payload: entry.payload }), 'utf8'));
    if (expected !== entry.sha256) { truncated = true; break; }
    entries.push(entry);
  }
  return { entries, truncated };
}

function createLocalDb(file) {
  let dbFile = path.resolve(file);
  let deviceId = null;
  let recoveredFolder = '';
  function recoverPendingWrites() {
    const folder = path.dirname(dbFile);
    if (recoveredFolder === folder) return;
    const recovery = createDurableFileRecovery({ recoveryRoot: path.join(folder, '.buyerlog-db-recovery'), allowedRoots: [folder] });
    const result = recovery.recoverSync();
    if (result.conflicts || result.errors.length) throw dataIntegrityError(dbFile, result.errors.map(item => ({ file: item.file, error: new Error(item.error) })));
    recoveredFolder = folder;
  }
  /* ===================================================================
     v7.85 — YAPICI ARTIK DİSKE DOKUNMUYOR.

     createLocalDb, modül yüklenirken iki senkron iş yapıyordu: bütün
     recovery klasörünü tarayıp her intent için payload'ı ve hedefi baştan
     sona okuyup hashlemek, ve deviceId'yi almak için DB'nin tamamını
     readFileSync ile okumak. İkisi de HTTP sunucusu porta bağlanmadan
     ÖNCE, olay döngüsünü bloke ederek çalışıyordu; birikmiş intent'ler ve
     soğuk disk önbelleği bunu saniyeler mertebesine çıkarabiliyordu.

     Kurtarma artık ihtiyaç anında yapılıyor. Doğruluk için bir şey
     kaybedilmez: DB'ye dokunan HER yol (ensure, read, transaction) zaten
     recoverPendingWrites çağırıyor, yani ilk okuma ya da yazmadan önce
     kurtarma mutlaka çalışır. Yapıcı yalnız yolu hesaplar.
     =================================================================== */
  function loadDeviceId() {
    if (deviceId) return deviceId;
    recoverPendingWrites();
    for (const candidate of [dbFile, `${dbFile}.bak`]) {
      try {
        const existing = JSON.parse(fs.readFileSync(candidate, 'utf8'));
        if (existing && existing.deviceId) { deviceId = String(existing.deviceId); return deviceId; }
      } catch (_) { /* yoksa ya da okunamıyorsa sıradaki adaya geç */ }
    }
    deviceId = crypto.randomUUID();
    return deviceId;
  }
  function walFile() { return `${dbFile}${WAL_SUFFIX}`; }

  /* WAL'daki işlemleri anlık görüntünün üzerine oynatır. Uygulama, canlı
     yolun kullandığı fonksiyonların ta kendisidir — oynatma ile normal
     çalışma arasında davranış farkı olamaz. */
  function replayWal(state, entries) {
    for (const entry of entries) {
      if (entry.op === 'patch') applyLocalPatch(state, entry.payload);
      else if (entry.op === 'tombstone') applyLocalTombstone(state, entry.payload);
      else if (entry.op === 'delta') applyRemoteDelta(state, entry.payload);
      else if (entry.op === 'mark-synced') applyMarkSynced(state, entry.payload);
      else if (entry.op === 'mark-ack') applyMarkAcknowledged(state, entry.payload);
      else if (entry.op === 'mark-ack-through') applyMarkAcknowledgedThrough(state, entry.payload);
      else if (entry.op === 'package') applyPackageToState(state, entry.payload);
    }
    return state;
  }

  async function readWalEntries(target) {
    try { return parseWal(await fsp.readFile(target, 'utf8')); }
    catch (error) {
      if (error && error.code === 'ENOENT') return { entries: [], truncated: false };
      throw error;
    }
  }

  /* Anlık görüntü + WAL. Çağıranların gördüğü durum her zaman budur.

     Bir ÖNCEKİ kuşak WAL de oynatılır. Sebebi şu: readState birincil dosya
     okunamazsa .bak'a düşer, ve .bak sıkıştırmadan ÖNCEKİ görüntüdür. O
     görüntüye katlanmış işlemler yalnız eski WAL'da durur; saklanmasaydı
     bozuk bir anlık görüntüde aradaki yazmalar kaybolurdu.

     Fazladan oynatmanın bedeli yok: her işlem eventId ile idempotent, yani
     zaten uygulanmış olanlar duplicate olarak geçilir. */
  /* Durum bellekte tutulur ve dosya imzalarıyla doğrulanır.

     WAL yazmayı ucuzlattı ama okuma hâlâ bütün görüntüyü okuyup parse
     ediyordu; 17 MB'lık bir durumda küçük bir yazma bu yüzden 60 ms sürüyordu.
     İmza (boyut+mtime) değişmediyse yeniden okumaya gerek yok — db.js'teki
     jsonReadCache ile aynı desen.

     Başka bir süreç yazarsa imza değişir ve durum yeniden yüklenir; ayrıca
     yazmalar zaten dosya kirasıyla sıralanıyor. Döndürülen nesne canlıdır:
     transaction mutator'ları onu bilerek değiştirir, okuyucular değiştirmez
     (pending/listConflicts kendi kopyalarını üretir). */
  let cachedState = null;
  let cachedTags = null;
  async function fileTag(target) {
    try { const stat = await fsp.stat(target); return `${stat.size}-${stat.mtimeMs}`; }
    catch (_) { return ''; }
  }
  async function currentTags() {
    return `${await fileTag(dbFile)}|${await fileTag(walFile())}|${await fileTag(`${walFile()}.bak`)}`;
  }
  function invalidateCache() { cachedState = null; cachedTags = null; }

  async function loadState() {
    const tags = await currentTags();
    if (cachedState && cachedTags === tags) return cachedState;
    const state = await loadStateFromDisk();
    cachedState = state;
    cachedTags = await currentTags();
    return state;
  }

  async function loadStateFromDisk() {
    const state = await readState(dbFile, loadDeviceId());
    deviceId = state.deviceId;
    const previous = await readWalEntries(`${walFile()}.bak`);
    const current = await readWalEntries(walFile());
    const entries = previous.entries.concat(current.entries);
    if (!entries.length) return state;
    const replayed = replayWal(state, entries);
    /* Birincil dosya bozulmuş ve yedekten dönülmüşse, o görüntü WAL'daki
       işlemleri içermiyor. Onarımı yarım bırakmamak için tam durumu hemen
       kalıcı yaz: bundan sonra birincil dosya tek başına eksiksizdir. */
    if (state.__restoredFromBackup) await writeSnapshot(replayed);
    return replayed;
  }

  /* Anlık görüntüyü yazar, sonra WAL'ı bir kuşak geriye döndürür. Sıra
     önemli: görüntü kalıcı olmadan WAL kaybolursa o işlemler yok olur.
     writeState hedefi yazdıktan sonra sha256 ile doğruluyor, yani buraya
     dönülmüşse görüntü gerçekten diskte. */
  async function writeSnapshot(state) {
    await writeState(dbFile, state);
    try { await replaceFileWithRetry(walFile(), `${walFile()}.bak`); }
    catch (error) { if (error && error.code !== 'ENOENT') throw error; }
  }

  /* Sıcak yol. Durumun tamamını değil yalnız işlemleri yazar. */
  async function appendOperations(operations) {
    return withFileLeaseAsync(dbFile, async () => {
      recoverPendingWrites();
      await fsp.mkdir(path.dirname(dbFile), { recursive: true });
      /* WAL'ın altında her zaman bir temel anlık görüntü bulunmalı. Yoksa
         dosya hiç oluşmaz; yedekleme, taşıma ve .bak kurtarma yolu dayanacak
         bir taban bulamaz. Yalnız ilk yazmada bir kez ödenir. */
      if (!fs.existsSync(dbFile) && !fs.existsSync(`${dbFile}.bak`)) await writeState(dbFile, emptyState(loadDeviceId()));
      const state = await loadState();
      const results = operations.map(item => item.apply(state));

      const lines = operations.map(item => walLine(item.op, item.payload)).join('');
      const handle = await fsp.open(walFile(), 'a');
      // fsync ÖNCE, dönüş SONRA: çağırana "kaydedildi" dendiğinde satır diskte.
      try { await handle.writeFile(lines, 'utf8'); await handle.sync(); } finally { await handle.close(); }

      let size = 0;
      try { size = (await fsp.stat(walFile())).size; } catch (_) {}
      const { entries } = size ? await readWalEntries(walFile()) : { entries: [] };
      if (size > WAL_MAX_BYTES || entries.length > WAL_MAX_ENTRIES) await writeSnapshot(state);
      // Durum yerinde değişti ve dosyalar yeniden yazıldı: imzayı tazele ki
      // sıradaki okuma diski boşuna baştan okumasın.
      cachedState = state; cachedTags = await currentTags();
      return results;
    });
  }

  async function transaction(mutator) {
    return withFileLeaseAsync(dbFile, async () => {
      recoverPendingWrites();
      const state = await loadState();
      const result = await mutator(state);
      // Rastgele bir mutasyonu işleme çevirmek mümkün değil; bu yol tam
      // görüntü yazar. Sık çağrılmaz (migration işareti, markSynced,
      // çakışma çözümü), sıcak yol appendOperations'tan geçer.
      await writeSnapshot(state);
      cachedState = state; cachedTags = await currentTags();
      return result;
    });
  }
  async function ensure() {
    await fsp.mkdir(path.dirname(dbFile), { recursive: true });
    recoverPendingWrites();
    if (!fs.existsSync(dbFile) && !fs.existsSync(`${dbFile}.bak`)) await writeState(dbFile, emptyState(loadDeviceId()));
    return loadState();
  }
  async function read() { return ensure(); }
  function setFolder(folder) {
    const next = path.join(resolveLocalDbFolder(folder), path.basename(dbFile));
    dbFile = next;
    recoveredFolder = '';
    // Konum değişti: bellekteki durum başka bir dosyaya ait.
    invalidateCache();
    recoverPendingWrites();
    return dbFile;
  }
  async function moveTo(folder) {
    const previous = dbFile, next = path.join(resolveLocalDbFolder(folder), path.basename(previous));
    if (path.resolve(previous) === path.resolve(next)) return dbFile;
    await ensure();
    await fsp.mkdir(path.dirname(next), { recursive: true });
    if (fs.existsSync(next)) throw new Error('Seçilen klasörde BuyerLogLocal.db zaten var; veri ezilmedi.');
    // Anlık görüntü tek başına eksiktir: WAL'daki işlemler henüz içine
    // alınmamış olabilir. Taşımadan önce sıkıştır ki hiçbir yazma geride
    // kalmasın, sonra tam durumu yeni konuma yaz.
    const state = await loadState();
    await writeSnapshot(state);
    await writeState(next, state);
    const copied = await readState(next);
    if (Number(copied.revision) !== Number(state.revision) || Object.keys(copied.records || {}).length !== Object.keys(state.records || {}).length) {
      try { await fsp.rm(next, { force: true }); } catch (_) {}
      throw new Error('Yerel DB kopyası doğrulanamadı; eski konum korunuyor.');
    }
    dbFile = next;
    recoveredFolder = path.dirname(next);
    invalidateCache();
    return dbFile;
  }

  /* Tek bir patch'i AÇIK bir transaction state'i üzerine uygular. queuePatch ile
     queuePatches aynı gövdeyi paylaşır; böylece toplu yol tek kayıtlık yoldan
     ayrışıp farklı journal/merge davranışına kayamaz. */
  function applyLocalPatch(state, { id, patch, eventId: eid, at, origin = 'local', baseRevision = null, entityType = 'record', userId = null }) {
    const key = recordId(id);
    if (state.events[eid] || state.syncLedger?.eventIds?.[eid]) return { duplicate: true, record: clone(state.records[key]), revision: state.revision, eventId: eid };
    // A normal local edit is based on the record revision actually visible on
    // this client. Persist that revision in the outgoing journal so a remote
    // client can distinguish a real same-field race from a sequential edit.
    // Explicit callers (bootstrap/conflict-resolution) may still supply a base.
    const effectiveBaseRevision = baseRevision == null
      ? Number(state.records[key] && state.records[key]._revision) || 0
      : Number(baseRevision) || 0;
    const revision = Math.max(Number(state.revision) || 0, effectiveBaseRevision) + 1;
    // Local writes are authoritative for this device; baseRevision is carried
    // in the journal for remote conflict detection, not used to reject the edit.
    const merged = fieldMerge(state.records[key], patch, revision);
    const operation = state.records[key] ? 'update' : 'create';
    state.revision = revision;
    state.localSequence = Number(state.localSequence) + 1;
    state.records[key] = { ...merged.value, _deleted: false };
    delete state.tombstones[key];
    const journalItem = { schemaVersion: SCHEMA_VERSION, eventId: eid, id: key, entityType: String(entityType || 'record'), userId: userId == null ? null : String(userId), deviceId: state.deviceId, operation, patch: clone(patch || {}), revision, baseRevision: effectiveBaseRevision, localSequence: state.localSequence, at, origin, uploaded: false, acknowledged: false, synced: false };
    journalItem.sha256 = sha256(Buffer.from(JSON.stringify({ ...journalItem, sha256: undefined }), 'utf8'));
    state.events[eid] = { eventId: eid, revision, at, origin, deviceId: state.deviceId, localSequence: state.localSequence };
    state.journal.push(journalItem);
    return { duplicate: false, record: clone(state.records[key]), revision, conflicts: merged.conflicts, eventId: eid, localSequence: state.localSequence };
  }

  function applyLocalTombstone(state, { id, eventId: eid, at, origin = 'local', baseRevision = null, entityType = 'record', userId = null }) {
    const key = recordId(id);
    if (state.events[eid] || state.syncLedger?.eventIds?.[eid]) return { duplicate: true, revision: state.revision };
    const effectiveBaseRevision = baseRevision == null
      ? Number(state.records[key] && state.records[key]._revision || state.tombstones[key] && state.tombstones[key].revision) || 0
      : Number(baseRevision) || 0;
    const revision = Math.max(Number(state.revision) || 0, effectiveBaseRevision) + 1;
    state.localSequence = Number(state.localSequence) + 1;
    state.revision = revision;
    state.tombstones[key] = { id: key, revision, baseRevision: effectiveBaseRevision, at, deviceId: state.deviceId };
    delete state.records[key];
    const journalItem = { schemaVersion: SCHEMA_VERSION, eventId: eid, id: key, entityType: String(entityType || 'record'), userId: userId == null ? null : String(userId), deviceId: state.deviceId, operation: 'delete', delete: true, revision, baseRevision: effectiveBaseRevision, localSequence: state.localSequence, at, origin, uploaded: false, acknowledged: false, synced: false };
    journalItem.sha256 = sha256(Buffer.from(JSON.stringify({ ...journalItem, sha256: undefined }), 'utf8'));
    state.events[eid] = { eventId: eid, revision, at, origin, deviceId: state.deviceId, localSequence: state.localSequence };
    state.journal.push(journalItem);
    return { duplicate: false, revision, eventId: eid, localSequence: state.localSequence };
  }

  function recordSyncReceipt(state, sourceDeviceId, firstSequence, lastSequence) {
    const source = String(sourceDeviceId || '').trim();
    const first = Math.max(0, Number(firstSequence) || 0), last = Math.max(first, Number(lastSequence) || first);
    if (!source || !last) return Number(state.syncCheckpoints[source] || 0);
    const ledger = state.syncLedger = state.syncLedger || { version: 1, eventIds: {}, ranges: [], receivedBeyondByDevice: {} };
    ledger.receivedBeyondByDevice = ledger.receivedBeyondByDevice && typeof ledger.receivedBeyondByDevice === 'object' ? ledger.receivedBeyondByDevice : {};
    let checkpoint = Math.max(0, Number(state.syncCheckpoints[source]) || 0);
    let ranges = Array.isArray(ledger.receivedBeyondByDevice[source]) ? ledger.receivedBeyondByDevice[source].map(item => ({ first: Number(item.first)||0, last: Number(item.last)||0 })).filter(item => item.last > checkpoint) : [];
    ranges.push({ first: first || last, last });
    ranges.sort((a,b) => a.first - b.first || a.last - b.last);
    const merged=[];
    for (const range of ranges) {
      const prev=merged[merged.length-1];
      if (prev && range.first <= prev.last + 1) prev.last=Math.max(prev.last,range.last);
      else merged.push({...range});
    }
    let progressed = true;
    while (progressed) {
      progressed = false;
      const idx = merged.findIndex(range => range.first <= checkpoint + 1 && range.last > checkpoint);
      if (idx >= 0) { checkpoint = Math.max(checkpoint, merged[idx].last); merged.splice(idx,1); progressed = true; }
      while (merged.length && merged[0].last <= checkpoint) merged.shift();
    }
    state.syncCheckpoints[source] = checkpoint;
    ledger.receivedBeyondByDevice[source] = merged.slice(0, 500);
    return checkpoint;
  }

  function applyRemoteDelta(state, { delta, eventId: eid, at, conflictIds = [] }) {
    if (state.events[eid] || state.appliedEvents[eid] || state.syncLedger?.eventIds?.[eid]) return { duplicate: true, applied: false, revision: state.revision };
    const key = recordId(delta.id);
    const revision = Math.max(Number(delta.revision) || 0, Number(state.revision) || 0);
    const tomb = state.tombstones[key];
    // Çakışma kimlikleri de çağrı anında üretilip WAL'a yazılır; oynatmada
    // yeniden üretilseydi aynı çakışma her açılışta yeni kimlik alırdı.
    let conflictIndex = 0;
    const nextConflictId = () => conflictIds[conflictIndex++] || crypto.randomUUID();
    if (delta.delete || delta.tombstone) {
      const currentRevision = Number(state.records[key]?._revision || tomb?.revision || 0);
      if (delta.baseRevision != null && currentRevision > Number(delta.baseRevision || 0)) {
        state.conflicts.push({ conflictId: nextConflictId(), eventId: eid, id: key, type: 'delete', current: clone(state.records[key] || tomb), incoming: { delete: true }, currentRevision, baseRevision: Number(delta.baseRevision) || 0, at, resolved: false });
      } else {
        if (!tomb || Number(tomb.revision) <= revision) state.tombstones[key] = { id: key, revision, baseRevision: Number(delta.baseRevision) || 0, at, deviceId: delta.deviceId || null };
        delete state.records[key];
      }
    } else if (!tomb || Number(tomb.revision) <= revision) {
      const merged = fieldMerge(state.records[key], delta.patch || delta.value || {}, revision, delta.baseRevision, key);
      state.records[key] = { ...merged.value, _deleted: false };
      delete state.tombstones[key];
      // Alan, çakışmayı görmüş daha yeni bir olayla çakışmasız güncellendi:
      // o alandaki eski çakışmanın seçenekleri artık geçersiz, kayıt kapanır.
      const conflictedFields = new Set(merged.conflicts.map(item => item.field));
      const appliedFields = new Set(Object.keys(delta.patch || delta.value || {}).filter(field => !conflictedFields.has(field)));
      for (const open of state.conflicts) {
        if (!open.resolved && open.type === 'field' && open.id === key && appliedFields.has(open.field)) {
          open.resolved = true; open.resolvedAt = at; open.resolution = 'superseded';
        }
      }
      for (const conflict of merged.conflicts) state.conflicts.push({ conflictId: nextConflictId(), eventId: eid, id: key, type: 'field', ...conflict, at, resolved: false });
    }
    state.revision = Math.max(Number(state.revision) || 0, revision);
    state.events[eid] = { eventId: eid, revision, at, origin: 'remote', deviceId: delta.deviceId || null, localSequence: Number(delta.localSequence) || 0 };
    state.appliedEvents[eid] = { eventId: eid, revision, at, origin: delta.origin || 'remote', deviceId: delta.deviceId || null };
    if (delta.deviceId) recordSyncReceipt(state, delta.deviceId, Number(delta.sourceFirstSeq) || Number(delta.localSequence) || 0, Number(delta.sourceLastSeq) || Number(delta.localSequence) || 0);
    return { duplicate: false, applied: true, revision, id: key, conflicts: state.conflicts.filter(item => item.eventId === eid) };
  }

  /* İşlem kimliği ve zaman damgası ÇAĞRI ANINDA çözülür ve WAL'a öyle yazılır.
     Oynatma sırasında yeniden üretilselerdi her açılış farklı bir sonuç verirdi. */
  function resolvePatch(item = {}) {
    const key = recordId(item.id);
    if (!key) throw new Error('Local record id is required.');
    return { ...item, id: key, eventId: eventId(item.eventId) || crypto.randomUUID(), at: item.at || now() };
  }

  async function queuePatch(item = {}) {
    const payload = resolvePatch(item);
    const [result] = await appendOperations([{ op: 'patch', payload, apply: state => applyLocalPatch(state, payload) }]);
    return result;
  }

  /* Toplu yazma. Bir içe aktarma binlerce kayıt taşıyabilir; hepsi tek kilit
     turunda ve tek WAL yazımında toplanır. Journal yine kayıt başına bir olay
     üretir — yani sync tanesini ayrı taşıyabilir. */
  async function queuePatches(items = []) {
    const list = (Array.isArray(items) ? items : []).filter(item => item && recordId(item.id)).map(resolvePatch);
    if (!list.length) return { count: 0, results: [] };
    const results = await appendOperations(list.map(payload => ({ op: 'patch', payload, apply: state => applyLocalPatch(state, payload) })));
    return { count: results.filter(result => !result.duplicate).length, results };
  }

  async function tombstone(item = {}) {
    const payload = resolvePatch(item);
    const [result] = await appendOperations([{ op: 'tombstone', payload, apply: state => applyLocalTombstone(state, payload) }]);
    return result;
  }

  async function applyDelta(delta = {}) {
    const key = recordId(delta.id);
    if (!key) throw new Error('Delta record id is required.');
    if (delta.sha256) {
      const expected = sha256(Buffer.from(JSON.stringify({ ...delta, sha256: undefined }), 'utf8'));
      if (expected !== String(delta.sha256)) throw new Error('Delta checksum doğrulanamadı.');
    }
    const payload = {
      delta,
      eventId: eventId(delta.eventId) || crypto.createHash('sha256').update(JSON.stringify(delta)).digest('hex'),
      at: now(),
      // Çakışma başına bir kimlik ayır; alan sayısı üst sınırdır.
      conflictIds: Array.from({ length: Object.keys(delta.patch || delta.value || {}).length + 1 }, () => crypto.randomUUID()),
    };
    const [result] = await appendOperations([{ op: 'delta', payload, apply: state => applyRemoteDelta(state, payload) }]);
    return result;
  }

  /* v2 sync packages are applied in one local WAL/lease turn. This preserves
     event-level idempotency/conflict semantics while avoiding hundreds of
     local snapshot transactions for one network package. */
  async function applyDeltas(deltas = []) {
    const list = (Array.isArray(deltas) ? deltas : []).filter(Boolean);
    if (!list.length) return { count: 0, applied: 0, duplicates: 0, conflicts: [], results: [] };
    const operations = list.map(delta => {
      const key = recordId(delta.id);
      if (!key) throw new Error('Delta record id is required.');
      if (delta.sha256) {
        const expected = sha256(Buffer.from(JSON.stringify({ ...delta, sha256: undefined }), 'utf8'));
        if (expected !== String(delta.sha256)) throw new Error('Delta checksum doğrulanamadı.');
      }
      const payload = {
        delta,
        eventId: eventId(delta.eventId) || crypto.createHash('sha256').update(JSON.stringify(delta)).digest('hex'),
        at: now(),
        conflictIds: Array.from({ length: Object.keys(delta.patch || delta.value || {}).length + 1 }, () => crypto.randomUUID()),
      };
      return { op: 'delta', payload, apply: state => applyRemoteDelta(state, payload) };
    });
    const results = await appendOperations(operations);
    const conflicts = results.flatMap(result => Array.isArray(result && result.conflicts) ? result.conflicts : []);
    return {
      count: results.length,
      applied: results.filter(result => result && result.applied).length,
      duplicates: results.filter(result => result && result.duplicate).length,
      conflicts,
      results,
    };
  }

  function applyPackageToState(next, payload = {}) {
    const pid = eventId(payload.packageId);
    const list = (Array.isArray(payload.events) ? payload.events : []).filter(Boolean);
    if (!pid) throw new Error('Sync package id is required.');
    next.appliedPackages = next.appliedPackages && typeof next.appliedPackages === 'object' ? next.appliedPackages : {};
    if (next.appliedPackages[pid]) return { duplicate: true, applied: 0, duplicates: list.length, conflicts: [], packageId: pid };
    let applied = 0, duplicates = 0;
    const conflicts = [];
    for (const delta of list) {
      const key = recordId(delta && delta.id);
      if (!key) throw new Error('Delta record id is required.');
      if (delta.sha256) {
        const expected = sha256(Buffer.from(JSON.stringify({ ...delta, sha256: undefined }), 'utf8'));
        if (expected !== String(delta.sha256)) throw new Error('Delta checksum doğrulanamadı.');
      }
      const itemPayload = {
        delta,
        eventId: eventId(delta.eventId) || crypto.createHash('sha256').update(JSON.stringify(delta)).digest('hex'),
        at: payload.at || now(),
        conflictIds: Array.from({ length: Object.keys(delta.patch || delta.value || {}).length + 1 }, (_, index) => `${pid}:${index}:${eventId(delta.eventId) || key}`),
      };
      const item = applyRemoteDelta(next, itemPayload);
      if (item.applied) applied++;
      if (item.duplicate) duplicates++;
      if (Array.isArray(item.conflicts)) conflicts.push(...item.conflicts);
    }
    const firstSeq = Math.max(0, Number(payload.firstSeq) || (list.length ? Math.min(...list.map(item => Number(item.sourceFirstSeq) || Number(item.localSequence) || 0).filter(Boolean)) : 0));
    const lastSeq = Math.max(firstSeq, Number(payload.lastSeq) || 0);
    next.appliedPackages[pid] = { packageId: pid, sourceDeviceId: String(payload.sourceDeviceId || ''), firstSeq, lastSeq, at: payload.at || now() };
    if (payload.sourceDeviceId && lastSeq) recordSyncReceipt(next, payload.sourceDeviceId, firstSeq || lastSeq, lastSeq);
    return { duplicate: false, applied, duplicates, conflicts, packageId: pid, checkpoint: Number(next.syncCheckpoints[payload.sourceDeviceId] || 0) };
  }

  async function applyPackage({ packageId, sourceDeviceId, firstSeq = 0, lastSeq = 0, events = [] } = {}) {
    const pid = eventId(packageId);
    if (!pid) throw new Error('Sync package id is required.');
    const state = await read();
    if (state.appliedPackages && state.appliedPackages[pid]) return { duplicate: true, applied: 0, duplicates: (events || []).length, conflicts: [], packageId: pid };
    const payload = { packageId: pid, sourceDeviceId: String(sourceDeviceId || ''), firstSeq: Number(firstSeq)||0, lastSeq: Number(lastSeq)||0, events: (Array.isArray(events)?events:[]), at: now() };
    const [result] = await appendOperations([{ op: 'package', payload, apply: next => applyPackageToState(next, payload) }]);
    return result;
  }

  function applyMarkSynced(state, payload = {}) {
    const wanted = new Set((payload.ids || []).map(eventId).filter(Boolean));
    if (!wanted.size) return { marked: 0 };
    let marked = 0;
    const at = payload.at || now();
    for (const item of state.journal) {
      if (!wanted.has(item.eventId) || item.uploaded) continue;
      item.uploaded = true; item.uploadedAt = at; item.synced = true; marked += 1;
    }
    return { marked };
  }
  function applyMarkAcknowledged(state, payload = {}) {
    const wanted = new Set((payload.ids || []).map(eventId).filter(Boolean));
    if (!wanted.size) return { marked: 0 };
    let marked = 0;
    const at = payload.at || now();
    const ledger = state.syncLedger = state.syncLedger || { version: 1, eventIds: {}, acknowledgedEventIds: {}, ranges: [] };
    ledger.eventIds = ledger.eventIds && typeof ledger.eventIds === 'object' ? ledger.eventIds : {};
    ledger.acknowledgedEventIds = ledger.acknowledgedEventIds && typeof ledger.acknowledgedEventIds === 'object' ? ledger.acknowledgedEventIds : {};
    const journalIds = new Set();
    for (const item of state.journal) {
      if (!item || !wanted.has(item.eventId)) continue;
      journalIds.add(item.eventId);
      if (item.acknowledged) continue;
      item.acknowledged = true; item.acknowledgedAt = at; marked += 1;
    }
    // Compaction removes full payloads but deliberately keeps lightweight
    // event identities in syncLedger. A legacy/per-event ACK that arrives
    // afterwards must still be remembered, otherwise pendingAck would jump
    // back after a restart/compaction.
    for (const id of wanted) {
      if (journalIds.has(id) || !Object.prototype.hasOwnProperty.call(ledger.eventIds, id) || ledger.acknowledgedEventIds[id]) continue;
      ledger.acknowledgedEventIds[id] = at;
      marked += 1;
    }
    return { marked };
  }
  function applyMarkAcknowledgedThrough(state, payload = {}) {
    const limit = Math.max(0, Number(payload.lastSequence) || 0);
    if (!limit) return { marked: 0 };
    let marked = 0;
    const at = payload.at || now();
    for (const item of state.journal) {
      if (!item.uploaded || item.acknowledged || Number(item.localSequence) > limit) continue;
      item.acknowledged = true; item.acknowledgedAt = at; marked += 1;
    }
    state.syncLedger = state.syncLedger || { version: 1, eventIds: {}, acknowledgedEventIds: {}, ranges: [] };
    state.syncLedger.acknowledgedThrough = Math.max(Number(state.syncLedger.acknowledgedThrough) || 0, limit);
    // Per-event ACK exceptions at/below the contiguous checkpoint are now
    // redundant. Removing only their ACK markers bounds this metadata; event
    // identities stay for idempotency/duplicate detection.
    const acked = state.syncLedger.acknowledgedEventIds && typeof state.syncLedger.acknowledgedEventIds === 'object' ? state.syncLedger.acknowledgedEventIds : {};
    for (const [id, _at] of Object.entries(acked)) {
      const seq = Number(state.syncLedger.eventIds && state.syncLedger.eventIds[id]) || 0;
      if (seq && seq <= state.syncLedger.acknowledgedThrough) delete acked[id];
    }
    state.syncLedger.acknowledgedEventIds = acked;
    return { marked };
  }

  /* "Yüklenmeyi bekleyen" = henüz hub a yazılmamış olay. Eskiden ölçüt
     !acknowledged idi; onay ise ANCAK BAŞKA bir cihaz paketi okuyup ACK
     yazdığında geliyor. Tek cihazlı kurulumda onaylayacak eş olmadığı için
     sayaç hiç düşmüyor, senkron başarılı olduğu hâlde arayüz kalıcı olarak
     "464 Pending" gösteriyor ve yükleme döngüsü her turda aynı 464 paketi
     yeniden tarıyordu. acknowledged bayrağı yerinde duruyor; görevi yalnızca
     journal budamasıdır (onaylanmamış olay asla atılmaz). */
  async function pending(limit = 1000) {
    const state = await read();
    return state.journal.filter(item => !item.uploaded).slice(0, Math.max(1, Number(limit) || 1000)).map(clone);
  }
  /* Yalnız SAYI için: pending()'in varsayılan limiti (1000) gerçek bekleyen
     sayısı ondan büyük olduğunda durum raporunu yanlış gösterirdi (ör. 15.000
     bekleyen kayıt varken "1000 Pending" yazardı). Bu, dilimlemeden/klonlamadan
     tüm günlüğü sayar. */
  async function pendingCount() {
    const state = await read();
    return state.journal.filter(item => !item.uploaded).length;
  }
  /* Onay bekleyen olaylar: budama ve tanılama için. */
  function compactedPendingAckCount(state) {
    const ledger = state && state.syncLedger || {};
    const eventIds = ledger.eventIds && typeof ledger.eventIds === 'object' ? ledger.eventIds : {};
    const acked = ledger.acknowledgedEventIds && typeof ledger.acknowledgedEventIds === 'object' ? ledger.acknowledgedEventIds : {};
    const through = Math.max(0, Number(ledger.acknowledgedThrough) || 0);
    let count = 0;
    for (const [id, rawSeq] of Object.entries(eventIds)) {
      const seq = Math.max(0, Number(rawSeq) || 0);
      if (seq > through && !acked[id]) count += 1;
    }
    return count;
  }
  async function unacknowledged(limit = 1000) {
    const state = await read();
    const max = Math.max(1, Number(limit) || 1000);
    const out = state.journal.filter(item => !item.acknowledged).slice(0, max).map(clone);
    // Full payloads were intentionally compacted. Expose only lightweight
    // diagnostic stubs when a caller explicitly requests the list; sync uses
    // unacknowledgedCount(), so network semantics never depend on these stubs.
    if (out.length < max) {
      const ledger = state.syncLedger || {}, through = Math.max(0, Number(ledger.acknowledgedThrough) || 0);
      const acked = ledger.acknowledgedEventIds || {};
      for (const [id, rawSeq] of Object.entries(ledger.eventIds || {})) {
        const seq = Math.max(0, Number(rawSeq) || 0);
        if (seq <= through || acked[id]) continue;
        out.push({ eventId: id, localSequence: seq, uploaded: true, acknowledged: false, compacted: true });
        if (out.length >= max) break;
      }
    }
    return out;
  }
  async function unacknowledgedCount() {
    const state = await read();
    return state.journal.filter(item => !item.acknowledged).length + compactedPendingAckCount(state);
  }
  async function markSynced(ids = []) {
    const normalized = [...new Set(ids.map(eventId).filter(Boolean))];
    if (!normalized.length) return { marked: 0 };
    const payload = { ids: normalized, at: now() };
    const [result] = await appendOperations([{ op: 'mark-synced', payload, apply: state => applyMarkSynced(state, payload) }]);
    return result;
  }
  async function markAcknowledged(ids = []) {
    const normalized = [...new Set(ids.map(eventId).filter(Boolean))];
    if (!normalized.length) return { marked: 0 };
    const payload = { ids: normalized, at: now() };
    const [result] = await appendOperations([{ op: 'mark-ack', payload, apply: state => applyMarkAcknowledged(state, payload) }]);
    return result;
  }
  async function markAcknowledgedThrough(lastSequence) {
    const limit = Math.max(0, Number(lastSequence) || 0);
    if (!limit) return { marked: 0 };
    const payload = { lastSequence: limit, at: now() };
    const [result] = await appendOperations([{ op: 'mark-ack-through', payload, apply: state => applyMarkAcknowledgedThrough(state, payload) }]);
    return result;
  }

  function businessStateHashFromState(state) {
    const business = {
      records: state.records || {}, tombstones: state.tombstones || {}, conflicts: state.conflicts || [],
      assets: state.assets || {}, migrations: state.migrations || {}, revision: Number(state.revision) || 0,
    };
    return sha256(Buffer.from(JSON.stringify(business), 'utf8'));
  }
  async function businessHash() { return businessStateHashFromState(await read()); }
  async function stats() {
    const state = await read();
    let bytes = 0, backupBytes = 0, walBytes = 0;
    try { bytes = (await fsp.stat(dbFile)).size; } catch (_) {}
    try { backupBytes = (await fsp.stat(`${dbFile}.bak`)).size; } catch (_) {}
    try { walBytes = (await fsp.stat(walFile())).size; } catch (_) {}
    const journal = state.journal || [];
    return {
      schemaVersion: state.schemaVersion, bytes, backupBytes, walBytes,
      records: Object.keys(state.records || {}).length, journal: journal.length,
      events: Object.keys(state.events || {}).length,
      unsynced: journal.filter(item => !item.uploaded).length,
      uploaded: journal.filter(item => item.uploaded).length,
      acknowledged: journal.filter(item => item.acknowledged).length + Math.max(0, Object.keys(state.syncLedger?.eventIds || {}).length - compactedPendingAckCount(state)),
      pendingAck: journal.filter(item => !item.acknowledged).length + compactedPendingAckCount(state),
      compactedEvents: Number(state.syncLedger?.compactedEvents) || 0,
      compactedThrough: Number(state.syncLedger?.compactedThrough) || 0,
      ledgerEventIds: Object.keys(state.syncLedger?.eventIds || {}).length,
      businessHash: businessStateHashFromState(state),
    };
  }

  async function compact(options = {}) {
    const keepUploadedTail = Math.max(100, Number(options.keepUploadedTail) || 1000);
    return withFileLeaseAsync(dbFile, async () => {
      recoverPendingWrites();
      const state = await loadState();
      const beforeHash = businessStateHashFromState(state);
      const before = await stats();
      const journal = Array.isArray(state.journal) ? state.journal : [];
      const uploadedIndexes = journal.map((item, index) => item && item.uploaded ? index : -1).filter(index => index >= 0);
      const keepIndexes = new Set(uploadedIndexes.slice(-keepUploadedTail));
      const nextJournal = [];
      const ledger = state.syncLedger = state.syncLedger || { version: 1, eventIds: {}, acknowledgedEventIds: {}, compactedEvents: 0, compactedThrough: 0, acknowledgedThrough: 0, ranges: [] };
      ledger.eventIds = ledger.eventIds && typeof ledger.eventIds === 'object' ? ledger.eventIds : {};
      ledger.acknowledgedEventIds = ledger.acknowledgedEventIds && typeof ledger.acknowledgedEventIds === 'object' ? ledger.acknowledgedEventIds : {};
      let compacted = 0, firstSeq = 0, lastSeq = 0;
      for (let index = 0; index < journal.length; index += 1) {
        const item = journal[index];
        if (!item || !item.uploaded || keepIndexes.has(index)) { nextJournal.push(item); continue; }
        const seq = Number(item.localSequence) || 0;
        ledger.eventIds[item.eventId] = seq;
        if (state.events && state.events[item.eventId]) delete state.events[item.eventId];
        compacted += 1;
        if (!firstSeq || (seq && seq < firstSeq)) firstSeq = seq;
        if (seq > lastSeq) lastSeq = seq;
      }
      if (compacted) {
        ledger.compactedEvents = (Number(ledger.compactedEvents) || 0) + compacted;
        ledger.compactedThrough = Math.max(Number(ledger.compactedThrough) || 0, lastSeq);
        ledger.ranges = Array.isArray(ledger.ranges) ? ledger.ranges : [];
        ledger.ranges.push({ firstSequence: firstSeq, lastSequence: lastSeq, count: compacted, compactedAt: now() });
        ledger.ranges = ledger.ranges.slice(-200);
      }
      state.journal = nextJournal;
      // Drop references to compacted full payloads before serializing the new
      // state. On a 295 MB real DB this materially lowers peak memory during
      // compaction; retained tail objects are still referenced by nextJournal.
      journal.length = 0;
      state.schemaVersion = SCHEMA_VERSION;
      const afterHash = businessStateHashFromState(state);
      if (beforeHash !== afterHash) throw Object.assign(new Error('LOCAL_DB_COMPACTION_BUSINESS_HASH_MISMATCH'), { code: 'DATA_INTEGRITY_ERROR' });

      const buffer = Buffer.from(JSON.stringify(state, null, 2), 'utf8');
      const compacting = `${dbFile}.compacting`;
      const handle = await fsp.open(compacting, 'w');
      try { await handle.writeFile(buffer); try { await handle.sync(); } catch (_) {} } finally { await handle.close(); }
      const verified = normalizeState(JSON.parse(await fsp.readFile(compacting, 'utf8')), state.deviceId);
      if (businessStateHashFromState(verified) !== beforeHash) throw Object.assign(new Error('LOCAL_DB_COMPACTION_TEMP_VALIDATION_FAILED'), { code: 'DATA_INTEGRITY_ERROR' });
      const folder = path.dirname(dbFile);
      const recovery = createDurableFileRecovery({ recoveryRoot: path.join(folder, '.buyerlog-db-recovery'), allowedRoots: [folder] });
      await recovery.replace(dbFile, buffer);
      // The recovery layer first creates a .bak of the old large file. Replace
      // that backup only AFTER the compacted primary has been validated.
      await recovery.replace(`${dbFile}.bak`, buffer);
      // Replacing the backup itself creates a temporary backup-of-backup in
      // the generic recovery layer. At this point both primary and .bak have
      // independently verified compact hashes, so the redundant pre-compact
      // backup can be removed safely.
      try { await fsp.unlink(`${dbFile}.bak.bak`); } catch (_) {}
      await recovery.replace(walFile(), Buffer.alloc(0));
      await recovery.replace(`${walFile()}.bak`, Buffer.alloc(0));
      try { await fsp.unlink(`${walFile()}.bak.bak`); } catch (_) {}
      try { await fsp.unlink(compacting); } catch (_) {}
      cachedState = state; cachedTags = await currentTags();
      const after = await stats();
      return { compacted, keepUploadedTail, before, after, bytesFreed: Math.max(0, (before.bytes + before.backupBytes + before.walBytes) - (after.bytes + after.backupBytes + after.walBytes)), businessHashBefore: beforeHash, businessHashAfter: after.businessHash };
    });
  }

  async function listConflicts(limit = 200) {
    const state = await read();
    return state.conflicts.filter(item => !item.resolved).slice(0, Math.max(1, Number(limit) || 200)).map(clone);
  }
  async function resolveConflict(conflictId, choice = 'current', customValue) {
    const id = eventId(conflictId);
    const state = await read();
    const conflict = state.conflicts.find(item => item.conflictId === id && !item.resolved);
    if (!conflict) throw new Error('Çakışma bulunamadı veya zaten çözüldü.');
    /* Çözüm, çakışan İKİ revizyonu da aşan bir tabanla yayımlanır. Aksi hâlde
       karşı değeri kabul etmiş cihazlar kararı yeni bir çakışma sayar ya da
       ("benimkini koru" seçiminde) hiç duymaz ve cihazlar kalıcı olarak ayrışır. */
    const incomingRevision = Number(state.events[conflict.eventId] && state.events[conflict.eventId].revision) || 0;
    const resolutionBase = Math.max(Number(conflict.currentRevision) || 0, incomingRevision);
    if (choice === 'incoming' && conflict.type === 'field') {
      await queuePatch({ id: conflict.id, patch: { [conflict.field]: customValue === undefined ? conflict.incoming : customValue }, baseRevision: resolutionBase, origin: 'conflict-resolution' });
    } else if (choice === 'current' && conflict.type === 'field') {
      const record = state.records[conflict.id];
      const kept = record && Object.prototype.hasOwnProperty.call(record, conflict.field) ? record[conflict.field] : conflict.current;
      await queuePatch({ id: conflict.id, patch: { [conflict.field]: kept === undefined ? null : clone(kept) }, baseRevision: resolutionBase, origin: 'conflict-resolution' });
    } else if (choice === 'incoming' && conflict.type === 'delete') {
      await tombstone({ id: conflict.id, baseRevision: conflict.currentRevision, origin: 'conflict-resolution' });
    } else if (choice !== 'current' && choice !== 'incoming') {
      throw new Error('Çakışma seçimi geçersiz.');
    }
    return transaction(async next => {
      const item = next.conflicts.find(entry => entry.conflictId === id);
      if (item) { item.resolved = true; item.resolvedAt = now(); item.resolution = choice; }
      return item ? clone(item) : null;
    });
  }
  async function putAsset({ id, buffer, mimeType = '', filename = '' } = {}) {
    const key = recordId(id);
    if (!key || !Buffer.isBuffer(buffer)) throw new Error('Local asset id and buffer are required.');
    return transaction(async state => {
      const item = { id: key, mimeType: String(mimeType), filename: String(filename), bytes: buffer.length, sha256: sha256(buffer), data: buffer.toString('base64'), updatedAt: now() };
      state.assets[key] = item;
      return { ...item, data: undefined };
    });
  }
  async function putAssets(items = []) {
    const normalized = items.filter(item => item && recordId(item.id) && Buffer.isBuffer(item.buffer)).map(item => ({
      id: recordId(item.id), mimeType: String(item.mimeType || ''), filename: String(item.filename || ''),
      bytes: item.buffer.length, sha256: sha256(item.buffer), data: item.buffer.toString('base64'), updatedAt: now(),
    }));
    if (!normalized.length) return { count: 0 };
    return transaction(async state => { for (const item of normalized) state.assets[item.id] = item; return { count: normalized.length }; });
  }
  return { get file() { return dbFile; }, getFile: () => dbFile, getDeviceId: () => loadDeviceId(), setFolder, moveTo, ensure, read, transaction, queuePatch, queuePatches, tombstone, applyDelta, applyDeltas, applyPackage, pending, pendingCount, unacknowledged, unacknowledgedCount, markSynced, markAcknowledged, markAcknowledgedThrough, stats, businessHash, compact, listConflicts, resolveConflict, putAsset, putAssets };
}

/* ===================================================================
   v7.85 — ÖLÜ LEGACY ASSET YÜKÜNÜN SICAK DURUMDAN ÇIKARILMASI

   Emekliye ayrılan whole-folder migration'ı (aşağıdaki migrateLegacyFiles)
   kullanıcı klasörlerindeki dosyaları Base64 olarak state.assets içine
   kopyalamıştı. Bu kayıtları HİÇBİR kod okumuyor: putAsset/putAssets'in
   üretimde çağıranı yok ve state.assets yalnız yazılıyor.

   Ölçüldü: gerçek bir kullanıcı DB'sinde 1149 asset = 11.6 MB, yani
   dosyanın %99.4'ü. Her transaction bu yükü baştan sona ödüyor —
   readState (11.7 MB oku + parse), prepare (hedefi hashle, payload yaz),
   commitPrepared (payload'ı geri oku + hashle, tmp yaz, .bak'a kopyala,
   hedefi tekrar oku + hashle). Tek bir kayıt için ~70 MB I/O ve 11.7 MB
   üzerinde 4 SHA-256 geçişi.

   Ölçüm: 110 ms/transaction → 12 ms/transaction, dosya 11.7 MB → 5 KB.

   Kayıtlar SİLİNMEZ; yanına arşiv dosyasına taşınır ve sıcak durumdan
   çıkarılır. Migration idempotenttir: işaret konduktan sonra tekrar
   çalışmaz.
   =================================================================== */
const LEGACY_ASSET_ARCHIVE_SUFFIX = '.assets-legacy.json';

async function offloadLegacyAssets(db) {
  const before = await db.read();
  if (before.migrations && before.migrations.legacyAssets) return { moved: 0, skipped: true };
  const count = Object.keys(before.assets || {}).length;
  if (count) {
    const archive = `${db.getFile ? db.getFile() : db.file}${LEGACY_ASSET_ARCHIVE_SUFFIX}`;
    const folder = path.dirname(path.resolve(archive));
    const recovery = createDurableFileRecovery({ recoveryRoot: path.join(folder, '.buyerlog-db-recovery'), allowedRoots: [folder] });
    await recovery.replace(archive, Buffer.from(JSON.stringify({
      archivedAt: now(), reason: 'unreferenced-legacy-file-import', count, assets: before.assets,
    }, null, 2), 'utf8'));
  }
  await db.transaction(async state => {
    state.assets = {};
    state.migrations = { ...(state.migrations || {}), legacyAssets: { at: now(), count, status: 'archived' } };
    return null;
  });
  return { moved: count, skipped: false };
}

/* Atomic temp → rename yolunda hedef dosya Windows tarafından kilitliyken
   (Defender taraması, yedekleme ajanı) rename EPERM verir ve finally içindeki
   unlink de aynı kilide takılır. Geride tam boyutlu bir .tmp kalır ve hiçbir
   şey onu toplamaz. Gerçek bir kullanıcı klasöründe ölçüldü: 127 yetim tmp,
   toplam 1.24 GB. Süpürücü yalnız bu kod tabanının temp adlandırma desenine
   uyan ve eşik yaşından eski dosyaları siler; uçuştaki yazımlara dokunmaz. */
const TEMP_DEBRIS = /\.\d+\.\d+(\.[0-9a-f]+)?\.(tmp|rollback)$/i;

async function sweepWriteDebris(folder, { olderThanMs = 3600000 } = {}) {
  const result = { removed: 0, bytes: 0, failed: 0 };
  let names = [];
  try { names = await fsp.readdir(folder); } catch (_) { return result; }
  const cutoff = Date.now() - Math.max(60000, Number(olderThanMs) || 3600000);
  for (const name of names) {
    if (!TEMP_DEBRIS.test(name)) continue;
    const file = path.join(folder, name);
    try {
      const stat = await fsp.stat(file);
      if (!stat.isFile() || stat.mtimeMs > cutoff) continue;
      await fsp.unlink(file);
      result.removed += 1; result.bytes += stat.size;
    } catch (_) { result.failed += 1; }
  }
  return result;
}

async function migrateLegacyFiles(db, roots = []) {
  const before = await db.read();
  if (before.migrations && before.migrations.legacyFiles) return [];
  // This migration predated the delta-sync registry and copied every local file
  // as Base64 into one JSON database.  Nothing reads those legacy asset records;
  // on real user folders the aggregate string exceeded V8's string limit and the
  // failed scan repeated at every startup.  Retire it with an idempotent marker.
  await db.transaction(async state => {
    state.migrations = { ...(state.migrations || {}), legacyFiles: { at: now(), count: 0, status: 'retired', reason: 'delta-sync-managed-data-only' } };
    return null;
  });
  return [];
}

module.exports = { SCHEMA_VERSION, DEFAULT_DB_NAME, createLocalDb, migrateLegacyFiles, offloadLegacyAssets, sweepWriteDebris };
