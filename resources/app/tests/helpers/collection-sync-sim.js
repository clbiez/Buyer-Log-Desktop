'use strict';

/* KOLEKSİYON ÇOK KURULUMLU SENKRON SİMÜLATÖRÜ
 *
 * Her kurulum (cihaz) kendi yerel verisine sahiptir: kendi Koleksiyon çalışma
 * alanı klasörü (collection-workspaces modülünün ayrı bir kopyası, kendi
 * SERVER_DATA_ROOT'u), kendi izin önbelleği ve kendi replikasyon durumu.
 * Cihazlar yalnız ortak Shared Hub klasörü üzerinden konuşur. Üretim kodunda
 * test kancası yoktur; sunucu rotalarının ince yapıştırıcısı (izin tazeleme →
 * yetki denetimi → yerel yazım → yayım; canlı yoklama) burada aynı sırayla
 * yeniden kurulur.
 *
 * Taşıma modeli SMB'dir: bütün cihazlar aynı hub dizinini görür, dosya
 * kirası bu yüzden gerçekten sıraya koyar. Gecikme/sıra değişimi/çift teslim,
 * cihazların yoklama (poll) sırasının ve sıklığının seed'li karıştırılmasıyla,
 * yarım geçici dosya, OneDrive çakışma kopyası ve bozuk nihai JSON ise hub
 * dosyalarına doğrudan enjekte edilir. Ayrı OneDrive aynaları (çok yazarlı
 * dosyanın fiziksel olarak iki kopyada değişmesi) belgelenmiş bir tasarım
 * sınırıdır; bkz. docs/ai/SHARED_FOLDER_WRITERS.md.
 *
 * Bir senaryo başarısız olursa seed, cihaz sayısı ve sentetik işlem günlüğü
 * bir JSON dosyasına yazılır ve hata mesajına COLLECTION_SYNC_SIM_REPRO
 * satırı eklenir. Aynı seed aynı işlem planını üretir; tick içindeki gerçek
 * G/Ç sıralaması için BUYERLOG_COLLECTION_SIM_SERIAL=1 tam sıralı çalıştırır.
 * Yalnız sentetik/anonim veri kullanılır. */

const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { seededRandom } = require('./sync-sim');

// A/B ölçümü için aynı simülatör başka bir uygulama köküne (ör. main) yöneltilebilir.
const appRoot = process.env.BUYERLOG_COLLECTION_SIM_APP_ROOT || path.resolve(__dirname, '../..');
const { createCollectionPermissionsStore } = require(path.join(appRoot, 'server/lib/collection-permissions-store'));
const { createCollectionReplication } = require(path.join(appRoot, 'server/lib/collection-replication'));

const ISOLATED_MODULES = ['server/user-data.js', 'server/lib/collection-workspaces.js', 'server/lib/collection-recycle-bin.js'];

/* Modüller veri kökünü yüklenme anında okur; her kurulum kendi kopyasını alır.
   Paylaşılan require önbelleği işlem bitince eski hâline döner. */
function loadIsolatedServerModules(serverDataRoot) {
  const ids = ISOLATED_MODULES.map(rel => require.resolve(path.join(appRoot, rel)));
  const saved = ids.map(id => require.cache[id]);
  const previous = process.env.BUYER_LOG_SERVER_DATA_ROOT;
  for (const id of ids) delete require.cache[id];
  process.env.BUYER_LOG_SERVER_DATA_ROOT = serverDataRoot;
  try {
    return { workspaces: require(ids[1]), recycleBin: require(ids[2]) };
  } finally {
    if (previous === undefined) delete process.env.BUYER_LOG_SERVER_DATA_ROOT;
    else process.env.BUYER_LOG_SERVER_DATA_ROOT = previous;
    ids.forEach((id, index) => { if (saved[index]) require.cache[id] = saved[index]; else delete require.cache[id]; });
  }
}

function checksum(value) { return crypto.createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex'); }
function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
function safeId(value) { return String(value == null ? '' : value).trim().replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 100); }

const OWNER = 'owner-ayse';
const MANUFACTURERS = ['Mfr Alfa', 'Mfr Beta', 'Mfr Gamma', 'Mfr Delta'];
const TEXT_FIELDS = ['not', 'modelKod', 'colour', 'buyer', 'line', 'exFactory'];
const PRICE_FIELDS = ['fob', 'targetPrice', 'confirmedManufacturer', 'quantity'];

/* Rol dağılımı (20 kurulum varsayılanı): sahibin iki kurulumu (dizüstü +
   masaüstü), on düzenleyici, beş izleyici, üç yetkisiz kullanıcı. */
function defaultRoster(count) {
  const roster = [];
  for (let index = 0; index < count; index++) {
    let userId, role;
    if (index < 2) { userId = OWNER; role = 'owner'; }
    else if (index < Math.max(3, Math.round(count * 0.6))) { userId = `editor-${String(index).padStart(2, '0')}`; role = 'edit'; }
    else if (index < Math.max(4, Math.round(count * 0.85))) { userId = `viewer-${String(index).padStart(2, '0')}`; role = 'view'; }
    else { userId = `outsider-${String(index).padStart(2, '0')}`; role = 'none'; }
    roster.push({ index, userId, role });
  }
  return roster;
}

async function createCollectionSimulation({ seed = 1, devices: count = 20, rows: rowCount = 24, serial = process.env.BUYERLOG_COLLECTION_SIM_SERIAL === '1' } = {}) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'buyerlog-collection-sim-'));
  const hub = path.join(root, 'hub');
  // Erişilemeyen ağ paylaşımı: yolun bir ara bileşeni dosyadır (ENOTDIR).
  // Boş kök ("yapılandırılmamış") gerçek kopukluğu temsil etmez.
  const unreachableMarker = path.join(root, 'unreachable-share');
  await fsp.mkdir(hub, { recursive: true });
  await fsp.writeFile(unreachableMarker, 'offline');
  const random = seededRandom(seed);
  const log = [];
  const roster = defaultRoster(count);
  const users = [...new Map(roster.map(item => [item.userId, item])).values()];
  const profiles = users.map(item => ({ id: item.userId, enabled: true, displayName: item.userId }));
  const devices = [];
  // Her yerel user-data kopyası bir çıkış dinleyicisi kaydeder (görsel indeksi).
  process.setMaxListeners(process.getMaxListeners() + count + 5);

  function record(entry) { log.push({ at: log.length, ...entry }); }

  try {
    for (const member of roster) {
      const local = path.join(root, `device-${String(member.index).padStart(2, '0')}`);
      await fsp.mkdir(local, { recursive: true });
      const modules = loadIsolatedServerModules(path.join(local, 'server-data'));
      const device = {
        ...member, local, online: true, modules,
        counters: { loadWorkspace: 0, replace: 0, published: 0, merged: 0, synced: 0, traces: [] },
      };
      const sharedRoot = async () => (device.online ? hub : path.join(unreachableMarker, 'hub'));
      device.permissions = createCollectionPermissionsStore({ file: path.join(local, 'collection-permissions.json'), getProfiles: () => profiles, getSharedSyncRoot: sharedRoot });
      // Sayaçlı ince sarmalayıcı: gerçek modül davranışı değişmez, yalnız
      // sessiz turda gereksiz okuma/yazma olup olmadığı ölçülür.
      const workspaceAdapter = {
        loadWorkspace: owner => { device.counters.loadWorkspace++; return modules.workspaces.loadWorkspace(owner); },
        replaceWorkspaceReplica: async (owner, raw, options) => { device.counters.replace++; return modules.workspaces.replaceWorkspaceReplica(owner, raw, options); },
      };
      device.replication = createCollectionReplication({
        workspaces: workspaceAdapter, permissions: device.permissions, getSharedSyncRoot: sharedRoot,
        stateFile: path.join(local, 'collection-replication-state.json'),
        onTrace: (event, detail) => {
          if (event === 'COLLECTION_REPLICA_PUBLISHED') device.counters.published++;
          if (event === 'COLLECTION_REPLICA_MERGED') device.counters.merged++;
          if (event === 'COLLECTION_REPLICA_SYNCED') device.counters.synced++;
          device.counters.traces.push(event);
          if (device.counters.traces.length > 200) device.counters.traces.shift();
          void detail;
        },
      });
      devices.push(device);
    }

    /* ---- sunucu rotalarının yapıştırıcısı (server.js / oab-batch-routes.js) ---- */
    async function refreshPermissions(device) {
      try { await device.permissions.sync(); } catch (_) { /* çevrimdışı: doğrulanmış yerel önbellek */ }
    }
    function accessLevel(device, ownerId) { return device.permissions.accessLevel(device.userId, ownerId); }
    async function publishReplica(device, ownerId) {
      try { return { ok: true, ...(await device.replication.publishOwner(ownerId)) }; }
      catch (error) { return { ok: false, code: error.code || 'PUBLISH_FAILED', message: error.message }; }
    }
    // GET /api/collection-workspaces/:ownerId
    async function open(device, ownerId) {
      await refreshPermissions(device);
      if (!accessLevel(device, ownerId)) return { status: 403, code: 'COLLECTION_ACCESS_DENIED' };
      let syncError = null;
      await device.replication.syncOwner(device.userId, ownerId).catch(error => { syncError = error; });
      return { status: 200, workspace: device.modules.workspaces.loadWorkspace(ownerId), syncError };
    }
    // PATCH /api/collection-workspaces/:ownerId (satır modu)
    async function patch(device, ownerId, change) {
      await refreshPermissions(device);
      if (accessLevel(device, ownerId) !== 'edit') return { status: 403, code: 'COLLECTION_EDIT_DENIED' };
      const result = await device.modules.workspaces.applyRowChangesAsync(ownerId, change);
      const replication = result.changed ? await publishReplica(device, ownerId) : null;
      return { status: 200, ...result, replication };
    }
    // Sunucudaki 5 sn'lik canlı yoklama: izinleri TAZELEMEZ (üretimdeki gibi).
    async function poll(device) {
      if (device.role === 'none') return [];
      const ownerIds = device.permissions.effectiveOwners(device.userId).map(item => item.ownerId);
      return device.replication.pollOwners(device.userId, ownerIds);
    }
    async function grant(actor, granteeId, level) {
      await refreshPermissions(actor);
      const result = await actor.permissions.setGrant({ ownerId: actor.userId, granteeId, level, actorId: actor.userId });
      await publishReplica(actor, actor.userId);
      return result;
    }
    async function revoke(actor, granteeId) {
      await refreshPermissions(actor);
      return actor.permissions.removeGrant({ ownerId: actor.userId, granteeId, actorId: actor.userId });
    }

    /* ---- kullanıcı arayüzü davranışı ----
       Ekran yerel sunucunun güncel satırını gösterir; kayıt satırın tamamını
       okunduğu _rev ile gönderir. Satır revizyonu çakışırsa kullanıcı güncel
       satırı görüp girişini yeniden uygular (en fazla üç deneme). */
    async function edit(device, ownerId, rowId, patchFields, meta = {}) {
      for (let attempt = 1; attempt <= 3; attempt++) {
        const current = device.modules.workspaces.loadWorkspace(ownerId);
        const row = current.rows.find(item => String(item.id) === String(rowId));
        if (!row) { record({ kind: 'edit-missing', device: device.index, ownerId, rowId, patch: patchFields, ...meta }); return { status: 'missing' }; }
        const next = { ...clone(row), ...clone(patchFields) };
        for (const [key, value] of Object.entries(patchFields)) if (value === undefined) delete next[key];
        const result = await patch(device, ownerId, { upserts: [next], expectedExistingIds: [String(rowId)] });
        if (result.status === 403) { record({ kind: 'edit-denied', device: device.index, ownerId, rowId, patch: patchFields, ...meta }); return { status: 'denied' }; }
        const conflict = (result.conflicts || []).find(item => String(item.id) === String(rowId));
        if (!conflict) {
          record({ kind: 'edit', device: device.index, ownerId, rowId, patch: patchFields, revision: result.saved && result.saved._revision, published: Boolean(result.replication && result.replication.ok), ...meta });
          return { status: 'applied', result };
        }
        if (conflict.reason === 'row-missing') { record({ kind: 'edit-missing', device: device.index, ownerId, rowId, patch: patchFields, ...meta }); return { status: 'missing' }; }
      }
      record({ kind: 'edit-rejected', device: device.index, ownerId, rowId, patch: patchFields, ...meta });
      return { status: 'rejected' };
    }
    async function remove(device, ownerId, rowId, meta = {}) {
      const current = device.modules.workspaces.loadWorkspace(ownerId);
      const row = current.rows.find(item => String(item.id) === String(rowId));
      if (!row) { record({ kind: 'delete-missing', device: device.index, ownerId, rowId, ...meta }); return { status: 'missing' }; }
      if (accessLevel(device, ownerId) !== 'edit') return { status: 'denied' };
      // İstemci silmeden ÖNCE satırın tam kopyasını bu cihazın kutusuna alır.
      device.modules.recycleBin.addEntries(ownerId, [{ rowId: Number(row.id), plmId: row.plmId, modelName: row.modelKod, row: clone(row) }], { deletedBy: device.userId, reason: 'manual' });
      const result = await patch(device, ownerId, { deletes: [{ id: row.id, _rev: row._rev }] });
      const removed = result.status === 200 && (result.applied || []).some(item => item.kind === 'removed' && String(item.id) === String(rowId));
      record({ kind: removed ? 'delete' : 'delete-rejected', device: device.index, ownerId, rowId, ...meta });
      return { status: removed ? 'applied' : 'rejected', result };
    }

    /* ---- kurulum: izin geçişi, paylaşım ve sahibin ilk Koleksiyonu ---- */
    async function bootstrap() {
      // Her kurulum açılışta izin geçişini (boş eski kayıtla) tamamlar.
      for (const device of devices) { await device.permissions.ensure(); await device.permissions.migrateLegacyInboundAccess([]); }
      const ownerDevice = devices.find(item => item.role === 'owner');
      for (const member of users) {
        if (member.role === 'edit' || member.role === 'view') await grant(ownerDevice, member.userId, member.role);
      }
      const seedRows = [];
      for (let id = 1; id <= rowCount; id++) {
        seedRows.push({ id, plmId: `PLM-${seed}-${id}`, modelKod: `M-${id}`, colour: 'Ecru', not: '', fob: '', targetPrice: '', confirmedManufacturer: '', quantity: 100 + id, pricing: {}, pricingSent: {} });
      }
      const created = await patch(ownerDevice, OWNER, { upserts: seedRows, expectedNewIds: seedRows.map(item => String(item.id)), nextId: rowCount + 1 });
      assert.equal(created.status, 200);
      assert.equal(created.replication && created.replication.ok, true, `seed=${seed}: owner bootstrap publish failed: ${JSON.stringify(created.replication)}`);
      record({ kind: 'bootstrap', rows: rowCount });
      // Her kullanıcı Koleksiyon ekranını bir kez açar: izinler tazelenir, sahip
      // kopyası indirilir ve canlı yoklama bu kullanıcı için başlar.
      await runTick(devices.map(device => () => open(device, OWNER)));
      await settle();
    }

    async function runTick(tasks) {
      if (serial) { const results = []; for (const task of tasks) results.push(await task()); return results; }
      return Promise.all(tasks.map(task => task()));
    }
    function shuffled(list) {
      const out = [...list];
      for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
      return out;
    }
    /* Teslim belirsizliği: her tick'te cihazların yalnız bir kısmı yoklar, sıra
       karışıktır ve bazı cihazlar aynı turda iki kez yoklar (çift teslim). */
    async function jitteredPolls(probability = 0.45) {
      const chosen = shuffled(devices.filter(item => item.online && item.role !== 'none')).filter(() => random() < probability);
      const doubled = chosen.filter(() => random() < 0.2);
      record({ kind: 'poll', devices: chosen.map(item => item.index), doubled: doubled.map(item => item.index) });
      await runTick([...chosen, ...doubled].map(device => () => poll(device)));
    }
    /* Yakınsama sözleşmesi: bütün çevrimiçi cihazlar sınırlı sayıda tam yoklama
       turunda aynı kopyaya ulaşır; gizli "yakınsayana kadar" döngüsü yoktur. */
    async function settle({ rounds = 4 } = {}) {
      let used = 0;
      for (let round = 0; round < rounds; round++) {
        used = round + 1;
        await runTick(devices.filter(item => item.online && item.role !== 'none').map(device => () => poll(device)));
        if (await convergedNow()) break;
      }
      record({ kind: 'settle', rounds: used });
      return used;
    }
    async function remoteEnvelope(ownerId = OWNER) {
      try { return JSON.parse(await fsp.readFile(path.join(hub, 'BUYER_LOG_SYNC', 'collection-workspaces', 'v1', `${safeId(ownerId)}.json`), 'utf8')); }
      catch (_) { return null; }
    }
    async function convergedNow(ownerId = OWNER) {
      const envelope = await remoteEnvelope(ownerId);
      if (!envelope) return false;
      const expected = checksum(envelope.workspace);
      return devices.filter(item => item.online && item.role !== 'none').every(device => checksum(device.modules.workspaces.loadWorkspace(ownerId)) === expected);
    }
    async function quietRound() {
      const before = devices.map(device => ({ load: device.counters.loadWorkspace, replace: device.counters.replace, published: device.counters.published, merged: device.counters.merged }));
      const changed = await Promise.all(devices.filter(item => item.online && item.role !== 'none').map(device => poll(device)));
      const work = devices.map((device, index) => ({
        device: device.index,
        loads: device.counters.loadWorkspace - before[index].load,
        replaces: device.counters.replace - before[index].replace,
        publishes: device.counters.published - before[index].published,
        merges: device.counters.merged - before[index].merged,
      })).filter(item => item.loads || item.replaces || item.publishes || item.merges);
      return { changed: changed.flat(), work };
    }
    async function openConflicts(device, ownerId = OWNER) {
      return (await device.replication.listMergeConflicts([ownerId])) || [];
    }
    function workspaceOf(device, ownerId = OWNER) { return device.modules.workspaces.loadWorkspace(ownerId); }
    function rowOf(device, rowId, ownerId = OWNER) { return workspaceOf(device, ownerId).rows.find(item => String(item.id) === String(rowId)) || null; }

    async function writeFailureLog(error, extra = {}) {
      const failureRoot = process.env.BUYERLOG_COLLECTION_SIM_FAILURE_ROOT || await fsp.mkdtemp(path.join(os.tmpdir(), 'buyerlog-collection-sim-failure-'));
      await fsp.mkdir(failureRoot, { recursive: true });
      const file = path.join(failureRoot, `collection-seed-${seed}-${count}.json`);
      await fsp.writeFile(file, JSON.stringify({ seed, devices: count, rows: rowCount, serial, ...extra, log }, null, 2));
      error.message += `\nCOLLECTION_SYNC_SIM_REPRO=${JSON.stringify({ seed, devices: count, rows: rowCount, operationLog: file })}`;
      return file;
    }

    return {
      seed, root, hub, devices, users, log, random, record, OWNER, MANUFACTURERS, TEXT_FIELDS, PRICE_FIELDS,
      refreshPermissions, accessLevel, open, patch, poll, grant, revoke, edit, remove, publishReplica,
      bootstrap, runTick, shuffled, jitteredPolls, settle, remoteEnvelope, convergedNow, quietRound,
      openConflicts, workspaceOf, rowOf, writeFailureLog, checksum, clone,
      workspaceFile: (ownerId = OWNER) => path.join(hub, 'BUYER_LOG_SYNC', 'collection-workspaces', 'v1', `${safeId(ownerId)}.json`),
      permissionsFile: () => path.join(hub, 'BUYER_LOG_SYNC', 'collection-permissions', 'v1.json'),
      setOnline(device, online) { device.online = Boolean(online); record({ kind: online ? 'online' : 'offline', device: device.index }); },
      close: () => fsp.rm(root, { recursive: true, force: true }),
    };
  } catch (error) { await fsp.rm(root, { recursive: true, force: true }); throw error; }
}

/* SEED'Lİ RASTGELE SENARYO
 *
 * Her epoch'ta bir (satır, alan) çifti — fiyat haritasında (satır, üretici) —
 * en fazla bir cihaz tarafından talep edilir; böylece epoch sonunda her alanın
 * beklenen değeri tektir ve herhangi bir sapma kayıp/yanlış birleşimdir.
 * Bir cihaz bir tick'te en fazla bir işlem yapar (aynı cihazda sıra belirsizliği
 * yok). Çevrimdışı cihazlar epoch boyunca yerel düzenleme biriktirir. Silinen
 * satır o epoch'ta başkasınca talep edilmemiştir ve sonra hiç düzenlenmez.
 * Aynı alanın eşzamanlı yazımı ayrı bir testte çakışma sözleşmesiyle denenir. */
async function runCollectionScenario({ seed = 1, devices = 20, operations = 240, epochs = 3, rows = 24, settleRounds = 3, faults = true } = {}) {
  const sim = await createCollectionSimulation({ seed, devices, rows });
  const started = performance.now();
  const expected = new Map(), deleted = new Set(), added = new Map();
  const metrics = { applied: 0, rejected: 0, denied: 0, deletes: 0, adds: 0, offlineEdits: 0, corruptWindows: 0, conflictCopies: 0, partialTemps: 0, settleRounds: [] };
  const random = sim.random;
  try {
    await sim.bootstrap();
    const writers = sim.devices.filter(item => item.role === 'owner' || item.role === 'edit');
    const fs = require('node:fs/promises');
    const { findConflictCopies } = require(path.join(appRoot, 'server/lib/onedrive-conflict-copies'));
    let ordinal = 0;
    for (let epoch = 0; epoch < epochs; epoch++) {
      const claimed = new Map();
      const offline = sim.shuffled(writers).slice(0, 2);
      for (const device of offline) sim.setOnline(device, false);
      const budget = Math.floor(operations / epochs);
      const tickSize = Math.max(2, Math.ceil(writers.length * 0.6));
      const ticks = Math.ceil(budget / tickSize);
      const corruptTick = faults ? Math.floor(random() * ticks) : -1;
      for (let tick = 0; tick < ticks; tick++) {
        const actors = sim.shuffled(writers).slice(0, Math.min(tickSize, budget - tick * tickSize));
        const tasks = [];
        for (const device of actors) {
          const n = ordinal++;
          const roll = random();
          const liveRows = [];
          for (let id = 1; id <= rows; id++) if (!deleted.has(id)) liveRows.push(id);
          const rowId = liveRows[Math.floor(random() * liveRows.length)];
          if (roll < 0.06) {
            const free = liveRows.filter(id => ![...claimed.keys()].some(key => key.startsWith(`${id}\u0000`)));
            if (free.length > 2) {
              const target = free[Math.floor(random() * free.length)];
              claimed.set(`${target}\u0000*`, device.index);
              tasks.push(async () => { const result = await sim.remove(device, sim.OWNER, target, { ordinal: n, epoch }); if (result.status === 'applied') { deleted.add(target); metrics.deletes++; } });
              continue;
            }
          }
          if (roll < 0.1) {
            const marker = `NEW-${seed}-${n}`;
            tasks.push(async () => {
              const workspace = sim.workspaceOf(device);
              const id = Math.max(workspace.nextId || 1, ...workspace.rows.map(item => Number(item.id) + 1));
              const result = await sim.patch(device, sim.OWNER, { upserts: [{ id, modelKod: marker, colour: 'Navy', pricing: {}, pricingSent: {} }], expectedNewIds: [String(id)], nextId: id + 1 });
              sim.record({ kind: 'add', device: device.index, rowId: id, marker, status: result.status, ordinal: n, epoch });
              if (result.status === 200 && !(result.conflicts || []).length) { added.set(marker, device.index); metrics.adds++; }
            });
            continue;
          }
          let field, mapKey = null;
          if (roll < 0.35) { field = 'pricing'; mapKey = MANUFACTURERS[Math.floor(random() * MANUFACTURERS.length)]; }
          else if (roll < 0.42) { field = 'pricingSent'; mapKey = MANUFACTURERS[Math.floor(random() * MANUFACTURERS.length)]; }
          else if (roll < 0.7) field = PRICE_FIELDS[Math.floor(random() * PRICE_FIELDS.length)];
          else field = TEXT_FIELDS[Math.floor(random() * TEXT_FIELDS.length)];
          const claim = `${rowId}\u0000${field}${mapKey ? `\u0000${mapKey}` : ''}`;
          const holder = claimed.has(`${rowId}\u0000*`) ? -1 : claimed.get(claim);
          if (holder != null && holder !== device.index) continue; // epoch içinde başka cihazın alanı
          claimed.set(claim, device.index);
          const value = field === 'confirmedManufacturer' ? MANUFACTURERS[n % MANUFACTURERS.length]
            : field === 'quantity' ? 1000 + n
            : field === 'pricingSent' ? true
            : field === 'pricing' ? `${(n % 97) + 1},${String(n % 100).padStart(2, '0')}`
            : `${field}-${seed}-${n}`;
          tasks.push(async () => {
            const current = sim.rowOf(device, rowId);
            const fields = mapKey ? { [field]: { ...((current && current[field]) || {}), [mapKey]: value } } : { [field]: value };
            const result = await sim.edit(device, sim.OWNER, rowId, fields, { ordinal: n, epoch, mapKey });
            if (result.status === 'applied') {
              metrics.applied++; if (!device.online) metrics.offlineEdits++;
              expected.set(mapKey ? `${rowId}\u0000${field}\u0000${mapKey}` : `${rowId}\u0000${field}`, value);
            } else if (result.status === 'denied') metrics.denied++;
            else metrics.rejected++;
          });
        }
        if (tick === corruptTick) {
          // Bozuk nihai JSON penceresi: yayımlar/yoklamalar hata alır, yerel kayıt sürer.
          const file = sim.workspaceFile();
          const good = await fs.readFile(file);
          await fs.writeFile(file, good.subarray(0, Math.max(1, good.length >> 1)));
          sim.record({ kind: 'corrupt-begin', epoch, tick });
          await sim.runTick(tasks);
          await sim.jitteredPolls(0.3);
          // Sağlayıcı aynı dosyanın doğru baytlarını sonradan teslim eder.
          const current = await fs.readFile(file);
          if (current.length === Math.max(1, good.length >> 1)) await fs.writeFile(file, good);
          sim.record({ kind: 'corrupt-end', epoch, tick });
          metrics.corruptWindows++;
        } else {
          await sim.runTick(tasks);
        }
        if (faults && random() < 0.35) {
          // Yarım geçici dosya ve OneDrive çakışma kopyası: hiçbiri benimsenmez.
          const file = sim.workspaceFile();
          const bytes = await fs.readFile(file);
          await fs.writeFile(`${file}.${9000 + tick}.${seed}.tmp`, bytes.subarray(0, Math.max(1, bytes.length >> 2)));
          metrics.partialTemps++;
          const envelope = JSON.parse(bytes.toString('utf8'));
          envelope.workspace = { ...envelope.workspace, _revision: Number(envelope.workspace._revision) + 1000, rows: envelope.workspace.rows.slice(1) };
          await fs.writeFile(file.replace(/\.json$/, `-PC${tick}.json`), JSON.stringify(envelope));
          metrics.conflictCopies++;
          sim.record({ kind: 'provider-artifacts', epoch, tick });
        }
        await sim.jitteredPolls();
      }
      for (const device of offline) sim.setOnline(device, true);
      const used = await sim.settle({ rounds: settleRounds + 3 });
      metrics.settleRounds.push(used);
      await assertScenarioInvariants(sim, { expected, deleted, added, epoch, settleRounds, used, findConflictCopies });
    }
    const quiet = await sim.quietRound();
    assert.deepEqual(quiet.work, [], `seed=${seed}: settled installations must not re-read or re-publish: ${JSON.stringify(quiet.work)}`);
    assert.deepEqual(quiet.changed, [], `seed=${seed}: settled installations reported changes`);
    return { seed, devices, operations: ordinal, durationMs: Math.round(performance.now() - started), metrics };
  } catch (error) {
    await sim.writeFailureLog(error, { operations, epochs, metrics });
    throw error;
  } finally { await sim.close(); }
}

async function assertScenarioInvariants(sim, { expected, deleted, added, epoch, settleRounds, used, findConflictCopies }) {
  const label = `seed=${sim.seed}, epoch=${epoch}`;
  const envelope = await sim.remoteEnvelope();
  assert.ok(envelope, `${label}: owner envelope missing`);
  assert.ok(await sim.convergedNow(), `${label}: installations did not converge in ${used} rounds`);
  assert.ok(used <= settleRounds, `${label}: convergence needed ${used} poll rounds (contract ≤ ${settleRounds})`);
  const hubRows = new Map(envelope.workspace.rows.map(row => [String(row.id), row]));
  for (const [key, value] of expected) {
    const [rowId, field, mapKey] = key.split('\u0000');
    if (deleted.has(Number(rowId))) continue;
    const row = hubRows.get(rowId);
    assert.ok(row, `${label}: row ${rowId} lost`);
    const actual = mapKey ? row[field] && row[field][mapKey] : row[field];
    assert.deepEqual(actual, value, `${label}: row ${rowId}.${field}${mapKey ? `[${mapKey}]` : ''} expected ${JSON.stringify(value)} got ${JSON.stringify(actual)}`);
  }
  for (const rowId of deleted) assert.equal(hubRows.has(String(rowId)), false, `${label}: deleted row ${rowId} resurrected`);
  const markers = new Map(envelope.workspace.rows.filter(row => String(row.modelKod || '').startsWith('NEW-')).map(row => [row.modelKod, row]));
  for (const marker of added.keys()) assert.ok(markers.has(marker), `${label}: added row ${marker} lost`);
  const ids = envelope.workspace.rows.map(row => String(row.id));
  assert.equal(new Set(ids).size, ids.length, `${label}: duplicate row ids after merge`);
  assert.ok(Number(envelope.workspace.nextId) > Math.max(...ids.map(Number)), `${label}: nextId must stay above every row id`);
  for (const device of sim.devices) {
    if (device.role === 'none') {
      const local = sim.workspaceOf(device);
      assert.equal(local.rows.length, 0, `${label}: outsider device ${device.index} received owner rows`);
      assert.equal((await sim.open(device, sim.OWNER)).status, 403, `${label}: outsider ${device.index} opened the owner workspace`);
      continue;
    }
    const conflicts = await sim.openConflicts(device);
    assert.deepEqual(conflicts.map(item => `${item.rowId}.${item.field}`), [], `${label}: false merge conflicts on device ${device.index}`);
    const status = await device.replication.status(sim.OWNER);
    assert.notEqual(status.state, 'conflict', `${label}: device ${device.index} left in conflict state: ${status.message}`);
  }
  // OneDrive yan dosyaları Moderatör için GÖRÜNÜR kalır (tespit, birleştirme değil).
  const names = await require('node:fs/promises').readdir(path.dirname(sim.workspaceFile()));
  const copies = findConflictCopies(names).map(item => item.name);
  assert.ok(copies.every(name => !name.endsWith('.tmp')), `${label}: temporary file reported as conflict copy`);
}

module.exports = { createCollectionSimulation, runCollectionScenario, loadIsolatedServerModules, defaultRoster, OWNER, MANUFACTURERS, TEXT_FIELDS, PRICE_FIELDS };
