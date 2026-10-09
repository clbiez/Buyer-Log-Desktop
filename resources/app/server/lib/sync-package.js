'use strict';

const crypto = require('crypto');
const hybridClock = require('./hlc');
const { mergeListClocks } = require('./hlc-email-list');
function greatestHlc(a, b) { return !a ? b : !b ? a : hybridClock.compare(a, b) >= 0 ? a : b; }

/* v2 shared-folder transport. Keep these limits centralized: the bottleneck on
   SMB shares is directory/file metadata traffic, not payload bytes. */
const SYNC_PACKAGE_VERSION = 2;
const SYNC_PACKAGE_MAX_EVENTS = 500;
const SYNC_PACKAGE_MAX_BYTES = 768 * 1024;
const SYNC_PACKAGE_DIR = 'bundles';
const SYNC_GZIP_SUFFIX = '.sync.gz';

function sha256Text(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}
function jsonBytes(value) { return Buffer.byteLength(JSON.stringify(value), 'utf8'); }
function eventChecksum(value) {
  return crypto.createHash('sha256').update(JSON.stringify({ ...value, sha256: undefined }), 'utf8').digest('hex');
}
function packageChecksum(value) {
  return crypto.createHash('sha256').update(JSON.stringify({ ...value, checksum: undefined }), 'utf8').digest('hex');
}
function sourceIds(event) {
  const ids = Array.isArray(event && event.sourceEventIds) ? event.sourceEventIds : [event && event.eventId];
  return ids.map(value => String(value || '').trim()).filter(Boolean);
}
function sourceCount(event) { return Math.max(1, sourceIds(event).length); }
function sourceFirstSeq(event) { return Number(event && event.sourceFirstSeq) || Number(event && event.localSequence) || 0; }
function sourceLastSeq(event) { return Number(event && event.sourceLastSeq) || Number(event && event.localSequence) || 0; }
function transportKey(event) {
  return [event && event.entityType || '', event && event.id || '', event && event.userId || '', event && event.origin || ''].join('|');
}
function isDelete(event) { return Boolean(event && (event.delete || event.tombstone || event.operation === 'delete')); }
function isPatch(event) { return Boolean(event && !isDelete(event) && event.patch && typeof event.patch === 'object' && !Array.isArray(event.patch)); }

/* Conservative coalescing only combines adjacent, unsent operations for the
   same record and actor. Cross-record ordering is never changed. create+delete
   stays explicit because deletion/conflict history can be business-significant. */
function coalescePendingEvents(items = []) {
  const input = (Array.isArray(items) ? items : []).filter(Boolean).slice().sort((a, b) => Number(a.localSequence || 0) - Number(b.localSequence || 0));
  const out = [];
  for (const raw of input) {
    const current = { ...raw, patch: raw.patch && typeof raw.patch === 'object' ? { ...raw.patch } : raw.patch, sourceEventIds: sourceIds(raw), sourceFirstSeq: sourceFirstSeq(raw), sourceLastSeq: sourceLastSeq(raw) };
    delete current.sha256;
    current.sha256 = eventChecksum(current);
    const previous = out[out.length - 1];
    const same = previous && transportKey(previous) === transportKey(current);
    if (!same) { out.push(current); continue; }

    const prevDelete = isDelete(previous), curDelete = isDelete(current);
    const prevCreate = previous.operation === 'create' || Boolean(previous.patch && previous.patch._created);
    if (prevCreate && curDelete) { out.push(current); continue; }

    if (isPatch(previous) && isPatch(current)) {
      const merged = {
        ...current,
        ...(greatestHlc(previous.hlc,current.hlc) ? {hlc:greatestHlc(previous.hlc,current.hlc)} : {}),
        ...(previous.listClocks || current.listClocks ? {listClocks:mergeListClocks(previous.listClocks,current.listClocks)} : {}),
        operation: prevCreate ? 'create' : (current.operation || 'update'),
        baseRevision: Number(previous.baseRevision) || 0,
        // Birleşik olayın bilgisi en eski olayınki kadardır (sürüm vektörü
        // monoton artar): çakışma kaçırılmaz, en fazla temkinli davranılır.
        ...(previous.seen !== undefined ? { seen: previous.seen } : {}),
        patch: { ...(previous.patch || {}), ...(current.patch || {}) },
        sourceEventIds: [...sourceIds(previous), ...sourceIds(current)],
        sourceFirstSeq: Math.min(sourceFirstSeq(previous), sourceFirstSeq(current)),
        sourceLastSeq: Math.max(sourceLastSeq(previous), sourceLastSeq(current)),
      };
      delete merged.sha256;
      merged.sha256 = eventChecksum(merged);
      out[out.length - 1] = merged;
      continue;
    }
    if (!prevDelete && curDelete && previous.operation !== 'create') {
      const merged = {
        ...current,
        ...(greatestHlc(previous.hlc,current.hlc) ? {hlc:greatestHlc(previous.hlc,current.hlc)} : {}),
        ...(previous.listClocks || current.listClocks ? {listClocks:mergeListClocks(previous.listClocks,current.listClocks)} : {}),
        baseRevision: Number(previous.baseRevision) || 0,
        sourceEventIds: [...sourceIds(previous), ...sourceIds(current)],
        sourceFirstSeq: Math.min(sourceFirstSeq(previous), sourceFirstSeq(current)),
        sourceLastSeq: Math.max(sourceLastSeq(previous), sourceLastSeq(current)),
      };
      delete merged.sha256;
      merged.sha256 = eventChecksum(merged);
      out[out.length - 1] = merged;
      continue;
    }
    out.push(current);
  }
  return out;
}

/* coverFromSeq (v20261009): cihaz sıra numarası yerel kalan (ortak klasöre
   hiç gitmeyen) olaylarca da tüketilir. Paket yalnız taşınan olayların
   aralığını bildirseydi alıcının kesintisiz checkpoint'i ilk boşlukta takılır,
   o cihazın klasörü her sync'te yeniden taranırdı. coverFromSeq, bu paketten
   önceki boşluğun da bu cihazdan hiç gelmeyecek olaylardan oluştuğunu bildirir.
   firstSeq/lastSeq anlamı DEĞİŞMEDİ: eski alıcılar alanı yok sayar. */
function buildSyncPackages(items = [], { deviceId = '', maxEvents = SYNC_PACKAGE_MAX_EVENTS, maxBytes = SYNC_PACKAGE_MAX_BYTES, coverFromSeq = 0 } = {}) {
  const source = (Array.isArray(items) ? items : []).filter(Boolean).slice().sort((a, b) => Number(a.localSequence || 0) - Number(b.localSequence || 0));
  const coalesced = coalescePendingEvents(source);
  const packages = [];
  let currentEvents = [], currentSourceCount = 0, currentBytes = 0;
  let nextCoverFrom = Math.max(0, Math.trunc(Number(coverFromSeq) || 0));

  function closePackage() {
    if (!currentEvents.length) return;
    const sourceEventIds = currentEvents.flatMap(sourceIds);
    const firstSeq = Math.min(...currentEvents.map(sourceFirstSeq));
    const lastSeq = Math.max(...currentEvents.map(sourceLastSeq));
    const packageId = `p2_${sha256Text(`${deviceId}|${firstSeq}|${lastSeq}|${sourceEventIds.join(',')}`).slice(0, 32)}`;
    const createdAt = currentEvents[currentEvents.length - 1].at || new Date().toISOString();
    const manifest = {
      version: SYNC_PACKAGE_VERSION,
      packageId,
      deviceId: String(deviceId || ''),
      createdAt,
      firstSeq,
      lastSeq,
      eventCount: currentEvents.length,
      sourceEventCount: sourceEventIds.length,
      sourceEventIds,
      events: currentEvents.map(item => ({ ...item })),
    };
    if (nextCoverFrom >= 1 && nextCoverFrom < firstSeq) manifest.coverFromSeq = nextCoverFrom;
    nextCoverFrom = lastSeq + 1;
    manifest.checksum = packageChecksum(manifest);
    packages.push({ manifest, sourceEventIds, firstSeq, lastSeq, sourceEventCount: sourceEventIds.length });
    currentEvents = []; currentSourceCount = 0; currentBytes = 0;
  }

  for (const event of coalesced) {
    const count = sourceCount(event);
    const bytes = jsonBytes(event);
    const wouldOverflowCount = currentEvents.length && currentSourceCount + count > Math.max(1, Number(maxEvents) || SYNC_PACKAGE_MAX_EVENTS);
    const wouldOverflowBytes = currentEvents.length && currentBytes + bytes > Math.max(1024, Number(maxBytes) || SYNC_PACKAGE_MAX_BYTES);
    if (wouldOverflowCount || wouldOverflowBytes) closePackage();
    currentEvents.push(event); currentSourceCount += count; currentBytes += bytes;
  }
  closePackage();
  return { packages, transportEvents: coalesced.length, sourceEvents: source.length };
}

function validateSyncPackage(value) {
  if (!value || Number(value.version) !== SYNC_PACKAGE_VERSION) throw new Error('Sync package version is not supported.');
  if (!value.packageId || !value.deviceId || !Array.isArray(value.events)) throw new Error('Sync package manifest is incomplete.');
  if (value.checksum && packageChecksum(value) !== String(value.checksum)) throw new Error('Sync package checksum could not be verified.');
  if (Number(value.eventCount) !== value.events.length) throw new Error('Sync package event count is inconsistent.');
  const manifestSourceIds = Array.isArray(value.sourceEventIds) ? value.sourceEventIds.map(item => String(item || '')).filter(Boolean) : [];
  if (Number(value.sourceEventCount) !== manifestSourceIds.length) throw new Error('Sync package source event count is inconsistent.');
  const eventSourceIds = value.events.flatMap(sourceIds);
  if (eventSourceIds.length !== manifestSourceIds.length || eventSourceIds.some((id, index) => id !== manifestSourceIds[index])) throw new Error('Sync package source event manifest is inconsistent.');
  const firstSeq = Number(value.firstSeq) || 0, lastSeq = Number(value.lastSeq) || 0;
  if (firstSeq < 0 || lastSeq < firstSeq) throw new Error('Sync package sequence range is invalid.');
  if (value.coverFromSeq != null) {
    const cover = Number(value.coverFromSeq);
    if (!Number.isSafeInteger(cover) || cover < 1 || cover >= firstSeq) throw new Error('Sync package cover range is invalid.');
  }
  if (value.events.length) {
    const actualFirst = Math.min(...value.events.map(sourceFirstSeq));
    const actualLast = Math.max(...value.events.map(sourceLastSeq));
    if (actualFirst !== firstSeq || actualLast !== lastSeq) throw new Error('Sync package sequence manifest is inconsistent.');
  }
  for (const event of value.events) {
    if (!event || !event.eventId || !event.id) throw new Error('Sync package contains an invalid event.');
    if (event.sha256 && eventChecksum(event) !== String(event.sha256)) throw new Error('Sync event checksum could not be verified.');
  }
  return value;
}

function bundleFileName(bundle, options = {}) {
  const last = String(Number(bundle.lastSeq) || 0).padStart(12, '0');
  const first = String(Number(bundle.firstSeq) || 0).padStart(12, '0');
  const suffix = options.gzip ? SYNC_GZIP_SUFFIX : '.ready';
  return `${last}-${first}-${bundle.manifest.packageId}${suffix}`;
}
function gzipBundleFileName(bundle) { return bundleFileName(bundle, { gzip: true }); }
function sequenceFromBundleFile(name) { return Number(String(name || '').split('-', 1)[0]) || 0; }
/* Dosya adındaki paket kimliği: indirmeden "bu paket zaten uygulandı mı"
   sorusunu cevaplamak için. Biçim: <last>-<first>-<packageId><sonek>. */
function packageIdFromBundleFile(name) {
  const base = String(name || '').replace(SYNC_GZIP_SUFFIX, '').replace(/\.ready$/, '');
  const parts = base.split('-');
  return parts.length >= 3 ? parts.slice(2).join('-') : '';
}
/* Alıcının kesintisiz sıra hesabında kullanacağı ilk sıra. */
function receiptFirstSeq(value) {
  const first = Number(value && value.firstSeq) || 0, cover = Number(value && value.coverFromSeq) || 0;
  return cover >= 1 && cover < first ? cover : first;
}
function isBundleFile(name) { return String(name || '').endsWith('.ready') || String(name || '').endsWith(SYNC_GZIP_SUFFIX); }

module.exports = {
  SYNC_PACKAGE_VERSION, SYNC_PACKAGE_MAX_EVENTS, SYNC_PACKAGE_MAX_BYTES, SYNC_PACKAGE_DIR, SYNC_GZIP_SUFFIX,
  eventChecksum, packageChecksum, coalescePendingEvents, buildSyncPackages, validateSyncPackage,
  bundleFileName, gzipBundleFileName, sequenceFromBundleFile, packageIdFromBundleFile, receiptFirstSeq, isBundleFile,
};
