'use strict';

// Gerçek DB/protokol, ayrı yerel OneDrive aynaları; üretim kodunda test kancası yok.
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const appRoot = process.env.BUYERLOG_SYNC_SIM_APP_ROOT || path.resolve(__dirname, '../..');
const { createLocalDb } = require(path.join(appRoot, 'server/lib/local-db'));
const { createSyncSettings } = require(path.join(appRoot, 'server/lib/sync-settings'));
const policy = require(path.join(appRoot, 'server/lib/shared-sync-policy'));
const { filterCollectionWorkspaceDeltas } = require(path.join(appRoot, 'server/lib/collection-replication'));
const { computeSharedDigest } = require(path.join(appRoot, 'server/lib/sync-health'));

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => { state += 0x6D2B79F5; let n = state; n = Math.imul(n ^ n >>> 15, n | 1); n ^= n + Math.imul(n ^ n >>> 7, n | 61); return ((n ^ n >>> 14) >>> 0) / 4294967296; };
}
function serverFilter(direction) { return items => policy.filterDeltas(filterCollectionWorkspaceDeltas(items), direction); }
function hash(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
async function filesUnder(root, prefix = '') {
  let entries;
  try { entries = await fsp.readdir(path.join(root, prefix), { withFileTypes: true }); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  const lists = await Promise.all(entries.map(entry => {
    const relative = path.join(prefix, entry.name);
    return entry.isDirectory() ? filesUnder(root, relative) : entry.isFile() && !entry.name.endsWith('.tmp') && !entry.name.endsWith('.lock') ? [relative] : [];
  }));
  return lists.flat().sort();
}

class MirrorReplicator {
  constructor(devices, random) {
    this.devices = devices; this.random = random; this.tick = 0; this.queue = [];
    this.published = new Map(); this.received = devices.map(() => new Map());
    this.metrics = { scheduled: 0, delivered: 0, duplicateDeliveries: 0, partialWrites: 0, conflictCopies: 0, reorderedDeliveries: 0 };
    this.serial = 0;
  }
  owns(device, relative) {
    const parts = relative.split(path.sep), id = encodeURIComponent(device.id);
    if (parts[0] !== 'BUYER_LOG_SYNC') return false;
    if (parts[1] === 'changes') return parts[2] === id;
    return (parts[1] === 'acks' || parts[1] === 'health') && parts.at(-1) === `${id}.json`;
  }
  async capture() {
    for (const device of this.devices) {
      const canonicalName = relative => this.devices.reduce((name, item) => name.replaceAll(encodeURIComponent(item.id), `device-${item.index}`), relative);
      const files = (await filesUnder(device.mirror)).sort((a, b) => canonicalName(a).localeCompare(canonicalName(b)));
      for (const relative of files) {
        if (!this.owns(device, relative)) continue;
        const bytes = await fsp.readFile(path.join(device.mirror, relative));
        const key = `${device.index}:${relative}`, fingerprint = hash(bytes), previous = this.published.get(key);
        if (previous && previous.hash === fingerprint) continue;
        const version = (previous?.version || 0) + 1;
        this.published.set(key, { hash: fingerprint, version });
        this.received[device.index].set(relative, { owner: device.index, version, hash: fingerprint });
        for (const target of this.devices) {
          if (target === device) continue;
          const task = { source: device.index, target: target.index, relative, bytes, hash: fingerprint, version,
            due: this.tick + 1 + Math.floor(this.random() * 5), priority: this.random(), partial: this.random() < 0.1, serial: this.serial++ };
          this.queue.push(task); this.metrics.scheduled++;
          if (this.random() < 0.12) { this.queue.push({ ...task, due: task.due + 1, priority: this.random(), serial: this.serial++, duplicate: true }); this.metrics.scheduled++; }
        }
      }
    }
  }
  async deliver(task) {
    const device = this.devices[task.target], known = this.received[task.target].get(task.relative);
    // Aynı yazarın eski dosya sürümü, daha yeni sürümü geriye götürmez.
    if (known && known.owner === task.source && known.version > task.version) return;
    let relative = task.relative;
    if (known && known.owner !== task.source && known.hash !== task.hash) {
      const extension = path.extname(relative);
      relative = relative.slice(0, -extension.length) + `-PC${task.source}` + extension;
      this.metrics.conflictCopies++;
    }
    const destination = path.join(device.mirror, relative);
    await fsp.mkdir(path.dirname(destination), { recursive: true });
    const temporary = `${destination}.sim-${task.serial}.tmp`;
    // Yarım kopya henüz .tmp; protokol tarafından paket kabul edilmez.
    if (task.partial) {
      await fsp.writeFile(temporary, task.bytes.subarray(0, Math.max(1, task.bytes.length >> 1)));
      this.metrics.partialWrites++;
    }
    await fsp.writeFile(temporary, task.bytes);
    await fsp.rename(temporary, destination);
    if (relative === task.relative) this.received[task.target].set(relative, { owner: task.source, version: task.version, hash: task.hash });
    this.metrics.delivered++; if (task.duplicate) this.metrics.duplicateDeliveries++;
  }
  async step({ drain = false } = {}) {
    this.tick++;
    const due = this.queue.filter(task => drain || task.due <= this.tick);
    this.queue = this.queue.filter(task => !drain && task.due > this.tick);
    due.sort((a, b) => a.priority - b.priority);
    for (let i = 1; i < due.length; i++) if (due[i].serial < due[i - 1].serial) this.metrics.reorderedDeliveries++;
    // Her aynada tek kopyalayıcı: dosya sürümü denetimi yarışmaz.
    await Promise.all(this.devices.map(async device => { for (const task of due) if (task.target === device.index) await this.deliver(task); }));
  }
  async flush() { await this.capture(); await this.step({ drain: true }); assert.equal(this.queue.length, 0); }
  async collide(targetIndex, relative, bytes, source = 'FOREIGN') {
    const target = this.devices[targetIndex], original = await fsp.readFile(path.join(target.mirror, relative));
    const known = this.received[targetIndex].get(relative);
    this.received[targetIndex].set(relative, known || { owner: targetIndex, version: 1, hash: hash(original) });
    await this.deliver({ source, target: targetIndex, relative, bytes: Buffer.from(bytes), hash: hash(Buffer.from(bytes)), version: 1, serial: this.serial++ });
    assert.deepEqual(await fsp.readFile(path.join(target.mirror, relative)), original, 'çakışma kopyası aslı ezmez');
  }
}

async function createSimulation({ seed = 1, devices: count = 10 } = {}) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'buyerlog-sync-sim-'));
  const random = seededRandom(seed), devices = [];
  try {
    for (let index = 0; index < count; index++) {
      const local = path.join(root, `device-${index}`), mirror = path.join(local, 'shared-mirror');
      await fsp.mkdir(mirror, { recursive: true });
      const db = createLocalDb(path.join(local, 'BuyerLogLocal.db'));
      db.setTransportFilter(item => serverFilter('outgoing')([item]).length === 1);
      const sync = createSyncSettings({ localDataRoot: path.join(local, 'settings'), localDb: db,
        filterIncomingDeltas: serverFilter('incoming'), filterOutgoingDeltas: serverFilter('outgoing'),
        installationFingerprint: `sync-simulation-${seed}-${index}` });
      await sync.save(mirror); await sync.savePeriod('manual');
      devices.push({ index, db, sync, mirror, id: db.getDeviceId() });
    }
    const replicator = new MirrorReplicator(devices, seededRandom(seed ^ 0xA11CE)), log = [], expected = new Map(), localExpected = devices.map(() => new Map());
    const emailItems = devices.map(() => new Map()), emailDeleted = devices.map(() => ({})), expectedEmails = new Map(), expectedDeleted = {};
    async function syncRound() {
      const results = await Promise.all(devices.map(async device => {
        const result = await device.sync.syncOnce();
        assert.equal(result.online, true, `seed=${seed}, device=${device.index}: ${result.lastError}`);
        return result;
      }));
      return results;
    }
    function generateOperations(count) {
      const batches = devices.map(() => []), fields = [...policy.PEER_CP_FIELDS];
      function enqueue(device, kind, id, patch, ordinal) {
        const at = new Date(Date.UTC(2026, 9, 9) + ordinal).toISOString();
        const item = { id, patch, at, eventId: `sim-${seed}-${ordinal}`, userId: `user-${device}` };
        batches[device].push(item); log.push({ ordinal, device, kind, ...item });
        return at;
      }
      for (let ordinal = 0; ordinal < count; ordinal++) {
        const forced = ordinal < devices.length * 3, chosen = Math.floor(random() * devices.length), roll = random();
        if ((forced && ordinal % 3 === 0) || (!forced && roll < 0.55)) {
          const order = forced ? Math.floor(ordinal / 3) : Math.floor(random() * devices.length * 8);
          const fieldIndex = forced ? 0 : Math.floor(random() * fields.length), field = fields[fieldIndex];
          const device = (order + fieldIndex) % devices.length, id = `cp-order:SIM-${order}`;
          const value = field === 'suppFob' ? ordinal / 100 : field === 'dates' ? { ex: `2026-11-${String(ordinal % 28 + 1).padStart(2, '0')}` } : field === 'suppFobMeta' ? { source: `sim-${ordinal}`, at: new Date(Date.UTC(2026, 9, 9) + ordinal).toISOString() } : `SUB-${ordinal}`;
          enqueue(device, 'cp', id, { [field]: value }, ordinal); expected.set(`${id}\0${field}`, value);
        } else if ((forced && ordinal % 3 === 1) || (!forced && roll < 0.66)) {
          const device = forced ? Math.floor(ordinal / 3) : chosen, patch = { modelConnections: [{ id: `private-${device}`, lastRun: { at: `run-${ordinal}` } }] };
          enqueue(device, 'settings', 'store:settings.json', patch, ordinal); localExpected[device].set('store:settings.json', patch);
        } else if ((forced && ordinal % 3 === 2) || (!forced && roll < 0.77)) {
          const device = forced ? Math.floor(ordinal / 3) : chosen, id = `store:user/sim-private-${device}.json`, patch = { rows: [`private-${ordinal}`] };
          enqueue(device, 'personal', id, patch, ordinal); localExpected[device].set(id, patch);
        } else if (roll < 0.85) {
          const id = `cp-order:LOCAL-${chosen}`, patch = { notes: { Notes: `local-${ordinal}` } };
          enqueue(chosen, 'notes', id, patch, ordinal); localExpected[chosen].set(id, patch);
        } else {
          const id = `email-${chosen}-${Math.floor(random() * 6)}`, at = new Date(Date.UTC(2026, 9, 9) + ordinal).toISOString();
          const deleting = emailItems[chosen].has(id) && random() < 0.4;
          if (deleting) { emailItems[chosen].delete(id); emailDeleted[chosen][id] = at; expectedEmails.delete(id); expectedDeleted[id] = at; }
          else { const item = { id, email: `sim-${ordinal}@example.invalid`, updatedAt: at }; emailItems[chosen].set(id, item); expectedEmails.set(id, item); }
          enqueue(chosen, deleting ? 'email-delete' : 'email-add', 'store:email-groups.json', { records: [...emailItems[chosen].values()], deletedRecords: { ...emailDeleted[chosen] } }, ordinal);
        }
      }
      return batches;
    }
    async function injectProviderArtifacts() {
      const source = devices[0], relative = path.join('BUYER_LOG_SYNC', 'changes', encodeURIComponent(source.id), 'provider-garbage.json');
      // Çakışma kopyası alıcıdaki v1 aday taramasına girer: atlanabilir ama online kalmalı.
      const head = path.join('BUYER_LOG_SYNC', 'changes', encodeURIComponent(source.id), '_head.json');
      await replicator.collide(1, head, '{"OneDrive":"different writer"}');
      // Bozuk nihai .json + görünür yarım .tmp. Sağlam paketler ayrıca duruyor.
      await Promise.all(devices.slice(1).map(async device => {
        await fsp.writeFile(path.join(device.mirror, relative), '{"eventId":');
        await fsp.writeFile(path.join(device.mirror, relative + '.tmp'), '{"eventId":');
      }));
    }
    async function settle() {
      await replicator.flush();
      // Sözleşme tam iki turdur; yakınsayana kadar gizli döngü YOK.
      for (let round = 0; round < 2; round++) { await syncRound(); await replicator.flush(); }
    }
    async function assertInvariants() {
      const states = await Promise.all(devices.map(device => device.db.read()));
      const digests = states.map(computeSharedDigest);
      assert.equal(new Set(digests.map(item => item.sharedHash)).size, 1, `seed=${seed}: shared digests differ: ${JSON.stringify(digests.map(item => item.recordHashes))}`);
      for (const [index, state] of states.entries()) {
        assert.equal(state.conflicts.filter(item => !item.resolved).length, 0, `seed=${seed}, device=${index}: false conflict`);
        for (const [key, value] of expected) { const [id, field] = key.split('\0'); assert.deepEqual(state.records[id]?.[field], value, `seed=${seed}, device=${index}: last value ${id}.${field}`); }
        for (const [owner, entries] of localExpected.entries()) for (const [id, patch] of entries) {
          if (owner === index) for (const [field, value] of Object.entries(patch)) assert.deepEqual(state.records[id]?.[field], value, `local value ${id}.${field}`);
          else if (id !== 'store:settings.json') assert.equal(state.records[id], undefined, `seed=${seed}: leaked ${id} to ${index}`);
          else assert.notDeepEqual(state.records[id]?.modelConnections, patch.modelConnections, `seed=${seed}: leaked settings`);
        }
        const email = state.records['store:email-groups.json'];
        if (expectedEmails.size || Object.keys(expectedDeleted).length) {
          assert.deepEqual((email?.records || []).map(item => item.id).sort(), [...expectedEmails.keys()].sort(), `seed=${seed}: missing email rows`);
          for (const item of email.records) assert.deepEqual(item, expectedEmails.get(item.id));
          assert.deepEqual(email.deletedRecords, expectedDeleted, `seed=${seed}: lost tombstones`);
        }
        for (const source of devices) {
          if (source.index === index) continue;
          const head = JSON.parse(await fsp.readFile(path.join(source.mirror, 'BUYER_LOG_SYNC', 'changes', encodeURIComponent(source.id), '_head.json'), 'utf8'));
          assert.equal(Number(state.syncCheckpoints[source.id] || 0), head.latestSequence, `seed=${seed}, reader=${index}, source=${source.index}: contiguous checkpoint`);
        }
      }
      const extra = await syncRound();
      for (const result of extra) {
        assert.equal(result.downloadedPackages, 0, `seed=${seed}: redundant package download`);
        assert.equal(result.scannedPackages, 0, `seed=${seed}: redundant package scan`);
        assert.equal(result.skippedDeviceFolders, devices.length - 1, `seed=${seed}: settled peer directories must be skipped`);
      }
      return { seed, operations: log.length, devices: devices.length, digest: digests[0].sharedHash, metrics: { ...replicator.metrics } };
    }
    return { seed, root, devices, replicator, log, expected, syncRound, generateOperations, injectProviderArtifacts, settle, assertInvariants,
      close: () => fsp.rm(root, { recursive: true, force: true }) };
  } catch (error) { await fsp.rm(root, { recursive: true, force: true }); throw error; }
}

async function runScenario({ seed = 1, devices = 10, operations = 300 } = {}) {
  const simulation = await createSimulation({ seed, devices }), started = performance.now();
  try {
    await simulation.syncRound(); await simulation.replicator.flush(); // v2 ilanları önce bütün aynalarda.
    const batches = simulation.generateOperations(operations);
    await Promise.all(simulation.devices.map((device, index) => device.db.queuePatches(batches[index])));
    await simulation.syncRound(); await simulation.replicator.capture();
    // Paketler/head/ACK sırası değişir ve bazı dosyalar hâlâ yoldayken alım yapılır.
    await simulation.replicator.step(); await simulation.syncRound();
    await simulation.replicator.flush(); await simulation.injectProviderArtifacts();
    await simulation.settle();
    const result = await simulation.assertInvariants(); result.durationMs = Math.round(performance.now() - started);
    assert.ok(result.metrics.duplicateDeliveries > 0); assert.ok(result.metrics.reorderedDeliveries > 0);
    assert.ok(result.metrics.partialWrites > 0); assert.ok(result.metrics.conflictCopies > 0);
    return result;
  } catch (error) {
    // Yalnız anonim/sentetik işlem günlüğü; aynı seed ve sayıyla tekrar üretilebilir.
    const failureRoot = process.env.BUYERLOG_SYNC_SIM_FAILURE_ROOT || await fsp.mkdtemp(path.join(os.tmpdir(), 'buyerlog-sync-sim-failure-'));
    await fsp.mkdir(failureRoot, { recursive: true });
    const file = path.join(failureRoot, `seed-${seed}-${operations}.json`);
    await fsp.writeFile(file, JSON.stringify({ seed, devices, operations, log: simulation.log }, null, 2));
    error.message += `\nSYNC_SIM_REPRO=${JSON.stringify({ seed, devices, operations, operationLog: file })}`;
    throw error;
  } finally { await simulation.close(); }
}

module.exports = { seededRandom, serverFilter, MirrorReplicator, createSimulation, runScenario };
