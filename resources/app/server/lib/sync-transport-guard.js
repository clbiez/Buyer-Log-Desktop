'use strict';

/* OneDrive/ortak klasör aktarım bekçisi.

   Buyer Log paketleri yerel OneDrive klasörüne yazar; buluta yükleme ve
   buluttan indirme OneDrive istemcisinin işidir. OneDrive zaman zaman bir
   klasörde takılır (bekleyen yükleme/indirme) ve bu Buyer Log'dan görünmez.

   Bu modül sağlayıcıdan bağımsız, uçtan uca bir kanıt üretir:
   - Her cihaz her başarılı sync sonunda küçük bir "aktarım işareti"
     (BUYER_LOG_SYNC/transport/<cihaz>.json) yazar: son yayınladığı sıra ve
     diğer cihazlardan gördüğü en yüksek sıra.
   - Giden: Benim yayınımdan LAG sonra sync yapmış ve işareti bana ulaşmış
     cihazların HİÇBİRİ yayınımı görmediyse yüklemem takılmıştır.
   - Gelen: Bir eşin yayınını üçüncü bir cihaz görmüş, ben LAG sonra sync
     yapmama rağmen görmediysem indirmem takılmıştır. Üçüncü cihaz kanıtı
     yoksa durum yalnız "şüpheli"dir; alarm üretilmez.

   Modül yalnız ölçer: paket/kayıt değiştirmez, sync başlatmaz, onarım yapmaz.
   Eski sürümler işaret yazmadığı için karara katılmaz (yanlış alarm yok). */

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { hubFiles } = require('./hub-dirent');

const SCHEMA_VERSION = 1;
const TRANSPORT_DIR = 'transport';
const DEFAULT_LAG_MS = 30 * 60 * 1000;
const MAX_BEACON_BYTES = 256 * 1024;
const MAX_BEACONS = 300;
const MAX_SEEN_ENTRIES = 500;
const MAX_PUBLICATIONS = 30;
const STATE_FILE = 'sync-transport-state.json';

const integer = value => { const number = Number(value); return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : 0; };
const text = (value, max = 160) => String(value == null ? '' : value).slice(0, max);
const timeOf = value => { const parsed = Date.parse(value || ''); return Number.isFinite(parsed) ? parsed : NaN; };
const encode = value => encodeURIComponent(String(value || ''));

/* Bir kaynaktan görülen en yüksek sıra. Checkpoint bir boşlukta takılabilir;
   boşluk ötesinde alınan aralıklar da "görüldü" sayılır. Böylece yalnız
   gerçekten hiç ulaşmamış yayın takılma sayılır (muhafazakâr karar). */
function highestSeenBySource(state) {
  const seen = {};
  const checkpoints = state && state.syncCheckpoints && typeof state.syncCheckpoints === 'object' ? state.syncCheckpoints : {};
  for (const [source, seq] of Object.entries(checkpoints)) seen[source] = Math.max(seen[source] || 0, integer(seq));
  const beyond = state && state.syncLedger && state.syncLedger.receivedBeyondByDevice;
  if (beyond && typeof beyond === 'object') {
    for (const [source, ranges] of Object.entries(beyond)) {
      for (const range of Array.isArray(ranges) ? ranges : []) seen[source] = Math.max(seen[source] || 0, integer(range && range.last));
    }
  }
  return seen;
}

function boundedSeen(seen) {
  const entries = Object.entries(seen || {}).filter(([source, seq]) => source && integer(seq) > 0)
    .sort((a, b) => integer(b[1]) - integer(a[1]) || (a[0] < b[0] ? -1 : 1)).slice(0, MAX_SEEN_ENTRIES);
  return Object.fromEntries(entries.map(([source, seq]) => [text(source, 200), integer(seq)]));
}

function buildBeacon({ deviceId, state, head, publications, lastSyncAt, now } = {}) {
  const latest = (Array.isArray(publications) ? publications : []).reduce((best, item) => (!best || integer(item.seq) > integer(best.seq) ? item : best), null);
  const latestPublishedSeq = Math.max(integer(head && head.latestSequence), integer(latest && latest.seq));
  return {
    schemaVersion: SCHEMA_VERSION,
    deviceId: text(deviceId, 200),
    updatedAt: new Date(now === undefined ? Date.now() : now).toISOString(),
    lastSyncAt: lastSyncAt ? text(lastSyncAt, 80) : null,
    latestPublishedSeq,
    publishedAt: latest && integer(latest.seq) === latestPublishedSeq ? text(latest.at, 80) : null,
    seen: boundedSeen(highestSeenBySource(state)),
  };
}

/* Kendi head sırası arttığında ilk görüldüğü anı yayın zamanı olarak kaydeder.
   Head aynı sırayla yeniden yazılsa da (capability head) zaman değişmez. */
function recordPublication(publications, head, now) {
  const list = (Array.isArray(publications) ? publications : [])
    .filter(item => item && integer(item.seq) > 0 && Number.isFinite(timeOf(item.at)))
    .map(item => ({ seq: integer(item.seq), at: new Date(timeOf(item.at)).toISOString() }));
  const seq = integer(head && head.latestSequence);
  const last = list.reduce((max, item) => Math.max(max, item.seq), 0);
  if (seq > last) {
    const instant = now === undefined ? Date.now() : new Date(now).getTime();
    const headAt = timeOf(head && head.updatedAt);
    const at = Number.isFinite(headAt) ? Math.min(headAt, instant) : instant;
    list.push({ seq, at: new Date(at).toISOString() });
  }
  list.sort((a, b) => a.seq - b.seq);
  return list.slice(-MAX_PUBLICATIONS);
}

function validBeacon(beacon) {
  return Boolean(beacon && beacon.schemaVersion === SCHEMA_VERSION && typeof beacon.deviceId === 'string' && beacon.deviceId &&
    Number.isFinite(timeOf(beacon.updatedAt)) && beacon.seen && typeof beacon.seen === 'object' && !Array.isArray(beacon.seen));
}

function assessTransport({ deviceId, publications, beacons, localSeen, lastSyncAt, now, lagMs = DEFAULT_LAG_MS } = {}) {
  const instant = now === undefined ? Date.now() : new Date(now).getTime();
  const lag = Math.max(60 * 1000, Number(lagMs) || DEFAULT_LAG_MS);
  const me = String(deviceId || '');
  const peers = (Array.isArray(beacons) ? beacons : []).filter(validBeacon).filter(beacon => beacon.deviceId !== me);
  const label = beacon => ({ deviceId: beacon.deviceId, updatedAt: beacon.updatedAt });

  // Giden yön: en eski "kimsenin görmediği" yayın.
  let outbound = { status: 'unknown', since: null, seq: 0, peers: [] };
  const pubs = (Array.isArray(publications) ? publications : []).filter(item => integer(item && item.seq) > 0 && Number.isFinite(timeOf(item.at)))
    .sort((a, b) => integer(a.seq) - integer(b.seq));
  for (const pub of pubs) {
    const at = timeOf(pub.at);
    if (instant - at < lag) continue;
    const eligible = peers.filter(beacon => timeOf(beacon.updatedAt) >= at + lag);
    if (!eligible.length) continue;
    const reached = eligible.some(beacon => integer(beacon.seen[me]) >= integer(pub.seq));
    if (reached) { outbound = { status: 'ok', since: null, seq: 0, peers: [] }; continue; }
    outbound = { status: 'stalled', since: new Date(at).toISOString(), seq: integer(pub.seq), peers: eligible.slice(0, 20).map(label) };
    break;
  }

  // Gelen yön: eşin yayını bana ulaşmadı mı?
  const mine = localSeen && typeof localSeen === 'object' ? localSeen : {};
  const lastSync = timeOf(lastSyncAt);
  const stalledPeers = [], suspectPeers = [];
  let inboundSince = NaN;
  let inboundEvaluated = false;
  for (const peer of peers) {
    const seq = integer(peer.latestPublishedSeq), at = timeOf(peer.publishedAt);
    if (!seq || !Number.isFinite(at)) continue;
    if (!Number.isFinite(lastSync) || lastSync < at + lag || instant - at < lag) continue;
    inboundEvaluated = true;
    if (integer(mine[peer.deviceId]) >= seq) continue;
    const witness = peers.find(other => other.deviceId !== peer.deviceId && integer(other.seen[peer.deviceId]) >= seq);
    if (witness) {
      stalledPeers.push({ ...label(peer), seq, publishedAt: new Date(at).toISOString(), witness: witness.deviceId });
      inboundSince = Number.isFinite(inboundSince) ? Math.min(inboundSince, at) : at;
    } else suspectPeers.push({ ...label(peer), seq, publishedAt: new Date(at).toISOString() });
  }
  const inbound = stalledPeers.length
    ? { status: 'stalled', since: new Date(inboundSince).toISOString(), peers: stalledPeers.slice(0, 20), suspect: suspectPeers.slice(0, 20) }
    : { status: inboundEvaluated ? (suspectPeers.length ? 'suspect' : 'ok') : 'unknown', since: null, peers: [], suspect: suspectPeers.slice(0, 20) };

  const alert = outbound.status === 'stalled' || inbound.status === 'stalled';
  const key = alert ? [outbound.status === 'stalled' ? `out:${outbound.seq}` : '', inbound.status === 'stalled' ? `in:${stalledPeers.map(item => `${item.deviceId}@${item.seq}`).join(',')}` : ''].filter(Boolean).join('|') : '';
  return { checkedAt: new Date(instant).toISOString(), lagMinutes: Math.round(lag / 60000), alert, key, outbound, inbound, peerCount: peers.length };
}

function createSyncTransportGuard({ localDataRoot, withTimeout = (operation) => operation(), writeJson } = {}) {
  if (typeof writeJson !== 'function') throw new Error('writeJson is required');
  const stateFile = path.join(localDataRoot, STATE_FILE);
  const net = (operation, label) => withTimeout(operation, 15000, label);

  function readLocal() {
    try {
      const raw = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
      return raw && raw.version === 1 ? raw : { version: 1, publications: [] };
    } catch (_) { return { version: 1, publications: [] }; }
  }
  async function writeLocal(value) {
    await fsp.mkdir(path.dirname(stateFile), { recursive: true });
    const temp = `${stateFile}.${process.pid}.tmp`;
    await fsp.writeFile(temp, JSON.stringify({ version: 1, ...value }, null, 2), 'utf8');
    await fsp.rename(temp, stateFile);
  }

  async function readBeacons(syncRoot) {
    const dir = path.join(syncRoot, TRANSPORT_DIR);
    let entries = [];
    try { entries = await net(() => fsp.readdir(dir, { withFileTypes: true }), 'Aktarım işareti listesi'); }
    catch (error) { if (error && error.code === 'ENOENT') return []; throw error; }
    const files = await hubFiles(dir, entries.filter(entry => entry.name.endsWith('.json')).slice(0, MAX_BEACONS * 2));
    const out = [];
    for (const entry of files.slice(0, MAX_BEACONS)) {
      try {
        const file = path.join(dir, entry.name);
        const stat = await net(() => fsp.stat(file), 'Aktarım işareti boyutu');
        if (!stat.isFile() || stat.size > MAX_BEACON_BYTES) continue;
        const beacon = JSON.parse(await net(() => fsp.readFile(file, 'utf8'), 'Aktarım işareti okuma'));
        if (validBeacon(beacon) && entry.name === `${encode(beacon.deviceId)}.json`) out.push(beacon);
      } catch (_) { /* yarım yazılmış/bozuk işaret karar dışı kalır */ }
    }
    return out;
  }

  /* Başarılı sync sonrası: yayın kaydını güncelle, işareti yaz, eşleri oku,
     değerlendir. Hata sync sonucunu değiştirmez; çağıran yakalar. */
  async function afterSync({ syncRoot, deviceId, state, head, lastSyncAt, now } = {}) {
    if (!syncRoot || !deviceId) return null;
    const local = readLocal();
    const publications = recordPublication(local.publications, head, now);
    if (JSON.stringify(publications) !== JSON.stringify(local.publications || [])) await writeLocal({ ...local, publications });
    const beacon = buildBeacon({ deviceId, state, head, publications, lastSyncAt, now });
    await net(() => writeJson(path.join(syncRoot, TRANSPORT_DIR, `${encode(deviceId)}.json`), beacon), 'Aktarım işareti yazma');
    const beacons = await readBeacons(syncRoot);
    return assessTransport({ deviceId, publications, beacons, localSeen: beacon.seen, lastSyncAt, now });
  }

  return { afterSync, readBeacons, readLocal };
}

module.exports = {
  SCHEMA_VERSION, TRANSPORT_DIR, DEFAULT_LAG_MS,
  highestSeenBySource, buildBeacon, recordPublication, assessTransport, createSyncTransportGuard,
};
