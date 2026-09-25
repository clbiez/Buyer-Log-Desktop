'use strict';

/* YEREL-ÖNCELİKLİ MODEL GÖRSELİ DAĞITIMI (v11.10)
 *
 * Arama sırası HER ZAMAN: LOCAL → SHARED → ASAS/PLM.
 *
 * Bu modül "hangi kimlik nereden karşılanabilir" sorusunun tek cevap yeridir.
 * Ağ ve depo BİLMEZ; hepsi enjekte edilir (sharedStore, getImage, saveImage,
 * patchLinks, ownership). Böylece sıra, kaynak sıkılığı, tazelik penceresi,
 * manuel koruma ve mezar taşı davranışı gerçek diske ve ağa dokunmadan
 * sınanabilir.
 *
 * ÇALIŞMA ZAMANI KAYNAĞI DEĞİŞMEZ: her şey yerel collection-images deposuna
 * kurulur, tablolar yalnız oradan okur. Paylaşılan klasör bir taşıma bandıdır;
 * yavaş ya da kopuk olması yalnız senkron gecikmesidir, tablo gecikmesi değil.
 *
 * YAYIM ASENKRONDUR VE GERİ ALMAZ. Yerel yazma başarılıysa kullanıcı görseli
 * görür; ağ yoksa yayım kuyruğa yazılır ve sonra yeniden denenir. Ağ hatası
 * yerel başarıyı ASLA geri almaz.
 */


const crypto = require('crypto');
const sharedImageStore = require('./shared-image-store');
const ownershipStore = require('./plm-image-ownership');
const ingestLib = require('./plm-image-ingest');
const { sniffImageMime } = require('./plm-image-download-queue');

const SCHEMA_VERSION = 1;
const MAX_PENDING_PUBLISH = 20000;
const MAX_NOT_FOUND = 50000;
/* Başka bir kullanıcı aynı kimliği bu pencere içinde aynı kaynaktan başarıyla
   tazelediyse normal bir tazeleme üst kaynağa GİTMEZ (§19). Açık "force"
   isteği bu korumayı aşabilir; varsayılan eylem force DEĞİLDİR. */
const DEFAULT_FRESHNESS_MS = 6 * 60 * 60 * 1000;
/* Üst kaynak "yok" dediyse aynı turda tekrar tekrar sormanın anlamı yok.
   Açık Refresh Selected / Refresh All yeniden dener. */
const DEFAULT_NOT_FOUND_TTL_MS = 60 * 60 * 1000;

const ORIGIN_LOCAL = 'local';
const ORIGIN_SHARED = 'shared';
const ORIGIN_UPSTREAM = 'upstream';
const ORIGIN_MANUAL = 'manual-protected';
/* Kayıt "manuel" diyor ama referans edilen nesne artık yok. Koruma
   uygulanmaz; durum sayımda ayrıca raporlanır ki sessiz bir davranış
   değişikliği olmasın. */
const ORIGIN_STALE = 'stale-protection';
const ORIGIN_NOT_FOUND = 'unavailable';
const ORIGIN_LEASED = 'waiting-other-instance';

function clean(value, max = 300) {
  return String(value == null ? '' : value).replace(/\u0000/g, '').trim().slice(0, max);
}
function notFoundKey(canonicalKey, source) {
  return `${clean(canonicalKey, 300)}|${sharedImageStore.normalizeSource(source) || 'NONE'}`;
}
function hashOf(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function emptyState() {
  return { schemaVersion: SCHEMA_VERSION, lastApplied: {}, pendingPublish: [], notFound: {}, lastPullAt: null, lastPublishAt: null };
}

function normalizeState(raw) {
  const out = emptyState();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  const applied = raw.lastApplied && typeof raw.lastApplied === 'object' && !Array.isArray(raw.lastApplied) ? raw.lastApplied : {};
  for (const [deviceId, revision] of Object.entries(applied)) {
    const id = clean(deviceId, 80);
    const value = Math.max(0, Math.trunc(Number(revision) || 0));
    if (id) out.lastApplied[id] = value;
  }
  for (const entry of (Array.isArray(raw.pendingPublish) ? raw.pendingPublish : []).slice(0, MAX_PENDING_PUBLISH)) {
    const canonicalKey = clean(entry && entry.canonicalKey, 300);
    const source = sharedImageStore.normalizeSource(entry && entry.source);
    if (!canonicalKey || !source) continue;
    out.pendingPublish.push({
      canonicalKey, source,
      plmId: clean(entry.plmId, 80), colourCode: clean(entry.colourCode, 80), colour: clean(entry.colour, 160),
      imageRef: clean(entry.imageRef, 120),
      contentHash: clean(entry.contentHash, 80).toLowerCase(),
      mimeType: clean(entry.mimeType, 60).toLowerCase(),
      ownership: clean(entry.ownership, 20).toUpperCase() === sharedImageStore.OWNERSHIP_MANUAL
        ? sharedImageStore.OWNERSHIP_MANUAL : sharedImageStore.OWNERSHIP_AUTOMATIC,
      status: clean(entry.status, 20).toUpperCase() || sharedImageStore.STATUS_AVAILABLE,
      sourceIdentity: clean(entry.sourceIdentity, 200),
      sourceFetchedAt: clean(entry.sourceFetchedAt, 40) || null,
      queuedAt: clean(entry.queuedAt, 40) || null,
      attempts: Math.max(0, Math.trunc(Number(entry.attempts) || 0)),
    });
  }
  const notFound = raw.notFound && typeof raw.notFound === 'object' && !Array.isArray(raw.notFound) ? raw.notFound : {};
  for (const [key, value] of Object.entries(notFound).slice(0, MAX_NOT_FOUND)) {
    const id = clean(key, 400);
    if (!id) continue;
    out.notFound[id] = {
      at: clean(value && value.at, 40) || null,
      code: clean(value && value.code, 60),
      attempts: Math.max(0, Math.trunc(Number(value && value.attempts) || 0)),
    };
  }
  out.lastPullAt = clean(raw.lastPullAt, 40) || null;
  out.lastPublishAt = clean(raw.lastPublishAt, 40) || null;
  return out;
}

function createModelImageDistribution(deps = {}) {
  const shared = deps.sharedStore || sharedImageStore.createSharedImageStore({});
  const ownership = deps.ownership || ownershipStore;
  const readState = typeof deps.readState === 'function' ? deps.readState : () => emptyState();
  const writeState = typeof deps.writeState === 'function' ? deps.writeState : value => value;
  const getImage = typeof deps.getImage === 'function' ? deps.getImage : () => null;
  const readImageBytes = typeof deps.readImageBytes === 'function' ? deps.readImageBytes : null;
  const saveImage = typeof deps.saveImage === 'function' ? deps.saveImage : null;
  const patchLinks = typeof deps.patchLinks === 'function' ? deps.patchLinks : null;
  const onTrace = typeof deps.onTrace === 'function' ? deps.onTrace : null;
  const freshnessMs = Math.max(0, Number(deps.freshnessMs) || DEFAULT_FRESHNESS_MS);
  const notFoundTtlMs = Math.max(0, Number(deps.notFoundTtlMs) || DEFAULT_NOT_FOUND_TTL_MS);

  function trace(event, detail) {
    if (!onTrace) return;
    try { onTrace(event, detail || {}); } catch (_) { /* tanılama ikinci bir hata üretmemeli */ }
  }

  function state() { return normalizeState(readState()); }
  function persist(value) { return normalizeState(writeState(normalizeState(value))); }

  function hasLocalFile(ref) {
    const id = clean(ref, 120);
    return Boolean(id && getImage(id));
  }

  function localBytes(ref) {
    const found = getImage(clean(ref, 120));
    if (!found || !readImageBytes) return null;
    try { return readImageBytes(found); } catch (_) { return null; }
  }

  /* ---- Bulunamadı belleği (kaynak duyarlı) -------------------------------
     ASAS'ın "yok" demesi PLM için hiçbir şey söylemez; anahtar kaynağı taşır. */
  function isSuppressed(canonicalKey, source, { mode = 'missing', now = Date.now() } = {}) {
    if (mode !== 'missing') return false;
    const record = state().notFound[notFoundKey(canonicalKey, source)];
    if (!record || !record.at) return false;
    const at = Date.parse(record.at);
    return Number.isFinite(at) && now - at < notFoundTtlMs;
  }

  function rememberNotFound(entries) {
    const list = (Array.isArray(entries) ? entries : [entries]).filter(Boolean);
    if (!list.length) return { changed: 0 };
    const current = state();
    const now = new Date().toISOString();
    let changed = 0;
    for (const entry of list) {
      const key = notFoundKey(entry.canonicalKey, entry.source);
      if (!clean(entry.canonicalKey, 300) || !sharedImageStore.normalizeSource(entry.source)) continue;
      const previous = current.notFound[key];
      current.notFound[key] = { at: now, code: clean(entry.code, 60) || 'IMAGE_UNAVAILABLE', attempts: (previous && previous.attempts || 0) + 1 };
      changed += 1;
    }
    if (!changed) return { changed: 0 };
    persist(current);
    return { changed };
  }

  function clearNotFound(entries) {
    const list = (Array.isArray(entries) ? entries : [entries]).filter(Boolean);
    if (!list.length) return { changed: 0 };
    const current = state();
    let changed = 0;
    for (const entry of list) {
      const key = notFoundKey(entry.canonicalKey, entry.source);
      if (Object.prototype.hasOwnProperty.call(current.notFound, key)) { delete current.notFound[key]; changed += 1; }
    }
    if (!changed) return { changed: 0 };
    persist(current);
    return { changed };
  }

  /* ---- Tazelik: başkası yeterince yakın zamanda tazeledi mi? ------------- */
  function isFreshEnough(record, { now = Date.now(), force = false } = {}) {
    if (force || !record || record.status !== sharedImageStore.STATUS_AVAILABLE) return false;
    const stamp = Date.parse(record.sourceFetchedAt || record.updatedAt || '');
    return Number.isFinite(stamp) && now - stamp < freshnessMs;
  }

  /* ======================================================================
     1) PLANLAMA — LOCAL → SHARED → UPSTREAM

     Her kimlik için TEK bir sonuç üretilir. Çoğaltılmış satırlar çağıran
     tarafından değil burada tekilleştirilir: 20 satır tek bir çözümdür.
     ====================================================================== */
  async function plan(requests, options = {}) {
    const source = sharedImageStore.normalizeSource(options.source);
    const mode = options.mode === 'all' ? 'all' : options.mode === 'selected' ? 'selected' : 'missing';
    const force = options.force === true;
    const overwriteManual = options.overwriteManual === true;
    const imagemap = options.imagemap || {};
    const store = options.store || ownership.loadOwnership();
    const now = Number(options.now) || Date.now();

    const unique = new Map();
    for (const raw of Array.isArray(requests) ? requests : []) {
      const item = ingestLib.normalizeRequest(raw);
      if (!item.key || unique.has(item.key)) continue;
      unique.set(item.key, item);
    }

    const local = [];
    const fromShared = [];
    const upstream = [];
    const manualProtected = [];
    const staleProtection = [];
    const unavailable = [];
    const sharedAvailable = options.allowShared !== false && await shared.available();
    // One view can contain hundreds of models. Resolve their shared metadata
    // in one heads/manifest pass instead of one SMB directory+manifest scan
    // per identity.
    let sharedRecords = new Map();
    if (sharedAvailable && typeof shared.lookupMany === 'function') {
      try { sharedRecords = await shared.lookupMany([...unique.keys()], { source }); }
      catch (error) { trace('SHARED_LOOKUP_BATCH_FAILED', { identities: unique.size, error: (error && error.message) || String(error) }); }
    }

    for (const item of unique.values()) {
      const currentRef = ingestLib.currentRefFor(imagemap, item);
      /* BAYAT MANUEL KAYIT ≠ KORUNACAK MANUEL GÖRSEL.
       *
       * Koruma kararı sahiplik kaydına bakar ve sahipliği BİLİNMEYEN bir
       * referansı güvenli tarafa düşerek "kullanıcının elle koyduğu görsel"
       * sayar. Referansın gösterdiği dosya artık YOKSA bu karar boşa düşer:
       * kullanıcı ekranda görsel görmez ama model sonsuza dek "manuel
       * korundu" diye bloklanır ve eksik görsel HİÇBİR ZAMAN tamamlanamaz.
       *
       * Bu yüzden koruma yalnız referans edilen nesne GERÇEKTEN varken
       * uygulanır. Gerçek manuel görsellerin koruması aynen sürer; yalnız
       * ölü referansın oluşturduğu çıkmaz kaldırılır ve sayımda ayrıca
       * raporlanır. */
      const refAlive = hasLocalFile(currentRef);
      if (currentRef && !refAlive) staleProtection.push({ ...item, currentRef, origin: ORIGIN_STALE });
      const permission = ownership.canWriteAutomatic(store, item.key, refAlive ? currentRef : '', { overwriteManual });
      if (!permission.allowed) { manualProtected.push({ ...item, currentRef, origin: ORIGIN_MANUAL }); continue; }

      // 2) LOCAL. "Eksikleri tamamla" normalde kullanılabilir yerel
      //    görseli yeniden istemez. İstisna: ana renk geçmişte otomatik
      //    Option Image ile yazılmışsa yeni kanonik ön+arka görsele göç eder.
      const roleRefresh = ingestLib.imageRoleNeedsRefresh(item, currentRef, { store, ownership });
      if (mode === 'missing' && hasLocalFile(currentRef) && !roleRefresh) {
        local.push({ ...item, currentRef, imageRef: currentRef, origin: ORIGIN_LOCAL });
        continue;
      }

      // 3-5) SHARED. Kaynak SIKI: ASAS isteği PLM kökenli nesneyle karşılanmaz.
      let record = sharedRecords.get(item.key) || null;
      if (sharedAvailable && !record && typeof shared.lookupMany !== 'function') {
        try { record = await shared.lookup(item.key, { source }); }
        catch (error) { trace('SHARED_LOOKUP_FAILED', { key: item.key, error: (error && error.message) || String(error) }); }
      }
      if (record && record.status === sharedImageStore.STATUS_AVAILABLE) {
        const manualWins = record.ownership === sharedImageStore.OWNERSHIP_MANUAL && !overwriteManual;
        const missingLocally = !hasLocalFile(currentRef);
        if (manualWins || missingLocally || isFreshEnough(record, { now, force })) {
          fromShared.push({ ...item, currentRef, record, origin: ORIGIN_SHARED });
          continue;
        }
      }
      if (record && record.status === sharedImageStore.STATUS_UNAVAILABLE && mode === 'missing' && !force) {
        unavailable.push({ ...item, currentRef, origin: ORIGIN_NOT_FOUND, code: 'SHARED_IMAGE_UNAVAILABLE' });
        continue;
      }

      if (isSuppressed(item.key, source, { mode, now })) {
        unavailable.push({ ...item, currentRef, origin: ORIGIN_NOT_FOUND, code: 'IMAGE_RECENTLY_UNAVAILABLE' });
        continue;
      }

      // 6) Yalnız burada üst kaynağa çıkılır.
      upstream.push({ ...item, currentRef, origin: ORIGIN_UPSTREAM });
    }

    return {
      source, mode, sharedAvailable,
      identities: unique.size,
      local, fromShared, upstream, manualProtected, staleProtection, unavailable,
      counts: {
        identities: unique.size,
        localAvailable: local.length,
        sharedPullable: fromShared.length,
        remoteRequired: upstream.length,
        manualProtected: manualProtected.length,
        staleProtectionCleared: staleProtection.length,
        unavailable: unavailable.length,
      },
    };
  }

  /* ======================================================================
     2) PAYLAŞILANDAN YEREL DEPOYA KURULUM

     Bayt doğrulanır (hash + MIME), yerel depoya yazılır, kayıt güncellenir.
     MANUAL sahipli bir kayıt kurulurken YEREL SAHİPLİK DE MANUEL olur:
     aksi hâlde bir sonraki otomatik senkron başka bir kullanıcının elle
     koyduğu görseli ezerdi.
     ====================================================================== */
  async function installFromShared(entries, options = {}) {
    if (!saveImage || !patchLinks) throw new Error('Kanonik görsel deposu bağlanmadı (saveImage/patchLinks).');
    const list = (Array.isArray(entries) ? entries : []).filter(entry => entry && entry.record);
    const imagemap = options.imagemap || {};
    let store = options.store || ownership.loadOwnership();
    const outcomes = [];
    const links = [];
    const automatic = [];
    const manual = [];
    const created = [];
    const byHash = new Map();

    for (const entry of list) {
      const record = entry.record;
      try {
        const buffer = await shared.readObject(record);
        if (!buffer) {
          outcomes.push({ ...entry, status: 'failed', code: 'SHARED_OBJECT_UNREADABLE', error: 'Paylaşılan görsel nesnesi okunamadı veya bütünlük doğrulaması başarısız.' });
          continue;
        }
        const mimeType = sniffImageMime(buffer, record.mimeType);
        if (!mimeType) {
          outcomes.push({ ...entry, status: 'failed', code: 'SHARED_OBJECT_INVALID', error: 'Paylaşılan nesne geçerli bir raster görsel değil.' });
          continue;
        }
        const hash = record.contentHash || hashOf(buffer);

        // Aynı baytlar bu turda zaten yerelde oluşturulduysa dosya kopyalanmaz.
        const existingLocal = entry.currentRef ? localBytes(entry.currentRef) : null;
        if (existingLocal && hashOf(existingLocal) === hash) {
          byHash.set(hash, { id: entry.currentRef });
          (record.ownership === sharedImageStore.OWNERSHIP_MANUAL ? manual : automatic).push(ownerEntry(entry, record, entry.currentRef, hash, mimeType, buffer.length));
          outcomes.push({ ...entry, imageRef: entry.currentRef, status: 'unchanged', origin: ORIGIN_SHARED, source: record.source, contentHash: hash });
          continue;
        }
        const reuse = byHash.get(hash);
        const stored = reuse || saveImage({
          rowId: `shared:${entry.key}`,
          filename: sharedFilename(entry, mimeType),
          mimeType,
          base64: buffer.toString('base64'),
        });
        if (!reuse) { created.push(stored.id); byHash.set(hash, stored); }
        links.push({ plmId: entry.plmId, colourCode: entry.colourCode, colour: entry.colour, imageRef: stored.id });
        (record.ownership === sharedImageStore.OWNERSHIP_MANUAL ? manual : automatic).push(ownerEntry(entry, record, stored.id, hash, mimeType, buffer.length));
        outcomes.push({
          ...entry, imageRef: stored.id, status: 'installed', origin: ORIGIN_SHARED, source: record.source,
          contentHash: hash, mimeType, size: buffer.length, url: stored.url || '', imageVersion: stored.updatedAt || '',
        });
      } catch (error) {
        outcomes.push({ ...entry, status: 'failed', code: 'SHARED_INSTALL_FAILED', error: clean(error && error.message, 300) });
      }
    }

    let patched = { overrides: { imagemap }, updated: 0 };
    if (links.length) {
      try { patched = patchLinks(links); }
      catch (error) {
        // Kayıt yazılamadıysa bu turda oluşturulan dosyalar yetim kalmasın.
        if (typeof deps.deleteImage === 'function') for (const id of created) { try { deps.deleteImage(id); } catch (_) {} }
        throw error;
      }
    }
    if (automatic.length) store = ownership.rememberAutomatic(automatic, { store, persist: ownership.saveOwnership }).store;
    if (manual.length) store = ownership.rememberManual(manual, { store, persist: ownership.saveOwnership }).store;

    const installed = outcomes.filter(outcome => outcome.status === 'installed').length;
    trace('SHARED_IMAGES_INSTALLED', { installed, requested: list.length });
    return { outcomes, overrides: patched.overrides, linksUpdated: patched.updated || 0, store, installed };
  }

  function automaticSourceType(record) {
    const identity = clean(record && record.sourceIdentity, 200).toLowerCase();
    if (identity.startsWith('option:') || identity.startsWith('option-url:')) return 'OPTION';
    if (identity.startsWith('stylelist:')) return 'STYLE_LIST';
    if (identity.startsWith('styledefault:') || identity.startsWith('styledefault-url:')) return 'STYLE_DEFAULT';
    return clean(record && record.source, 40);
  }

  function ownerEntry(entry, record, imageRef, hash, mimeType, bytes) {
    const base = {
      key: entry.key, imageRef, hash, mimeType, bytes,
      sharedRevision: record.revision, deviceId: record.updatedByDevice,
      at: record.updatedAt || new Date().toISOString(),
    };
    if (record.ownership === sharedImageStore.OWNERSHIP_MANUAL) return base;
    return {
      ...base,
      owner: ownerFor(record.source),
      // Shared manifest kaynak ailesini (PLM/ASAS/PACKAGE) taşır; PLM
      // içindeki gerçek görsel türü sourceIdentity'den geri kazanılır.
      // Aksi hâlde option:... kaydı yerelde yalnız "PLM" görünür ve
      // ana renk self-heal politikası yanlış Option görselini cache sayar.
      sourceType: automaticSourceType(record),
      sourceIdentity: record.sourceIdentity,
      styleId: clean(entry.styleId, 40),
      sourceFetchedAt: record.sourceFetchedAt,
      publishedAt: record.updatedAt,
    };
  }

  function ownerFor(source) {
    const value = sharedImageStore.normalizeSource(source);
    if (value === sharedImageStore.SOURCE_ASAS) return ownership.OWNER_ASAS;
    if (value === sharedImageStore.SOURCE_PACKAGE) return ownership.OWNER_PACKAGE;
    return ownership.OWNER_PLM;
  }

  function sharedFilename(entry, mimeType) {
    const extension = mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : mimeType === 'image/gif' ? 'gif' : 'jpg';
    const colour = entry.colourCode ? `-${String(entry.colourCode).replace(/[^a-z0-9_-]/gi, '_')}` : '';
    return `shared-${entry.plmId}${colour}.${extension}`;
  }

  /* ======================================================================
     3) YAYIM — önce yerel başarı, sonra (asenkron) ağ.
     ====================================================================== */
  function queuePublish(entries) {
    const list = (Array.isArray(entries) ? entries : [entries]).filter(Boolean);
    if (!list.length) return { queued: 0 };
    const current = state();
    const now = new Date().toISOString();
    const index = new Map(current.pendingPublish.map((entry, position) => [`${entry.canonicalKey}|${entry.source}`, position]));
    let queued = 0;
    for (const entry of list) {
      const canonicalKey = clean(entry.canonicalKey, 300);
      const source = sharedImageStore.normalizeSource(entry.source);
      if (!canonicalKey || !source) continue;
      const item = {
        canonicalKey, source,
        plmId: clean(entry.plmId, 80), colourCode: clean(entry.colourCode, 80), colour: clean(entry.colour, 160),
        imageRef: clean(entry.imageRef, 120),
        contentHash: clean(entry.contentHash, 80).toLowerCase(),
        mimeType: clean(entry.mimeType, 60).toLowerCase(),
        ownership: clean(entry.ownership, 20).toUpperCase() === sharedImageStore.OWNERSHIP_MANUAL
          ? sharedImageStore.OWNERSHIP_MANUAL : sharedImageStore.OWNERSHIP_AUTOMATIC,
        status: clean(entry.status, 20).toUpperCase() || sharedImageStore.STATUS_AVAILABLE,
        sourceIdentity: clean(entry.sourceIdentity, 200),
        sourceFetchedAt: clean(entry.sourceFetchedAt, 40) || now,
        queuedAt: now, attempts: 0,
      };
      const position = index.get(`${canonicalKey}|${source}`);
      if (position == null) { current.pendingPublish.push(item); index.set(`${canonicalKey}|${source}`, current.pendingPublish.length - 1); }
      else current.pendingPublish[position] = item;
      queued += 1;
    }
    if (current.pendingPublish.length > MAX_PENDING_PUBLISH) current.pendingPublish = current.pendingPublish.slice(-MAX_PENDING_PUBLISH);
    persist(current);
    return { queued, pending: current.pendingPublish.length };
  }

  async function flushPublish({ limit = 200, sourceIdentityPrefix = '', dropNonMatching = false } = {}) {
    const prefix = clean(sourceIdentityPrefix, 200);
    const current = state();
    if (prefix && dropNonMatching) {
      current.pendingPublish = current.pendingPublish.filter(entry => clean(entry && entry.sourceIdentity, 200).startsWith(prefix));
      persist(current);
    }
    if (!(await shared.available())) return { published: 0, pending: current.pendingPublish.length, available: false };
    const eligible = prefix
      ? current.pendingPublish.filter(entry => clean(entry && entry.sourceIdentity, 200).startsWith(prefix))
      : current.pendingPublish;
    const batch = eligible.slice(0, Math.max(1, Math.trunc(Number(limit) || 200)));
    if (!batch.length) return { published: 0, pending: current.pendingPublish.length, available: true };

    const payload = [];
    const dropped = new Set();
    for (const entry of batch) {
      if (entry.status !== sharedImageStore.STATUS_AVAILABLE) { payload.push({ ...entry, buffer: null }); continue; }
      const buffer = localBytes(entry.imageRef);
      if (!buffer) {
        // Yerel dosya artık yok (silinmiş/değişmiş): eski baytı yayımlamak
        // başka bir kullanıcıda ölü bir kaydı diriltirdi.
        dropped.add(`${entry.canonicalKey}|${entry.source}`);
        continue;
      }
      payload.push({ ...entry, buffer, contentHash: entry.contentHash || hashOf(buffer) });
    }

    let result = { published: 0, skipped: 0, reused: 0, revision: 0 };
    try { result = await shared.publish(payload); }
    catch (error) {
      trace('SHARED_PUBLISH_FAILED', { pending: current.pendingPublish.length, error: (error && error.message) || String(error) });
      const bumped = state();
      for (const entry of bumped.pendingPublish) {
        if (batch.some(item => item.canonicalKey === entry.canonicalKey && item.source === entry.source)) entry.attempts += 1;
      }
      persist(bumped);
      return { published: 0, pending: bumped.pendingPublish.length, available: true, error: clean(error && error.message, 200) };
    }

    const done = new Set(payload.map(entry => `${entry.canonicalKey}|${entry.source}`));
    const after = state();
    after.pendingPublish = after.pendingPublish.filter(entry => {
      const id = `${entry.canonicalKey}|${entry.source}`;
      return !done.has(id) && !dropped.has(id);
    });
    after.lastPublishAt = new Date().toISOString();
    persist(after);
    trace('SHARED_PUBLISH_OK', { published: result.published, reused: result.reused, pending: after.pendingPublish.length });
    return { published: result.published, reused: result.reused, skipped: result.skipped, pending: after.pendingPublish.length, available: true, revision: result.revision };
  }

  /* ======================================================================
     4) ÇEKME — delta. Başlangıçta bloke etmez, baytları taramaz.
     ====================================================================== */
  async function pull(options = {}) {
    if (!(await shared.available())) return { installed: 0, scanned: 0, available: false };
    const current = state();
    const own = clean(options.deviceId, 80);
    const merged = await shared.mergedView({ since: current.lastApplied });
    const imagemap = options.imagemap || {};
    let store = options.store || ownership.loadOwnership();

    const wanted = [];
    const tombstones = [];
    for (const record of merged.records) {
      if (own && record.updatedByDevice === own) continue;
      const item = ingestLib.normalizeRequest({ plmId: record.plmId, colourCode: record.colourCode, colour: record.colour });
      if (!item.key) continue;
      const currentRef = ingestLib.currentRefFor(imagemap, item);
      if (record.status !== sharedImageStore.STATUS_AVAILABLE) {
        if (currentRef) tombstones.push({ ...item, currentRef, record });
        continue;
      }
      const owned = ownership.recordOf(store, item.key);
      const manual = ownership.manualRecordOf(store, item.key);
      const applied = Math.max(Number(owned && owned.sharedRevision) || 0, Number(manual && manual.sharedRevision) || 0);
      // Aynı ya da daha eski revizyon yeniden kurulmaz; aynı bayt yeniden
      // yazılmaz. Yerel dosya kayıpsa revizyon eşit olsa bile kurulur.
      if (applied >= record.revision && hasLocalFile(currentRef)) continue;
      wanted.push({ ...item, currentRef, record });
    }

    const limit = Math.max(1, Math.trunc(Number(options.limit) || 500));
    const batch = wanted.slice(0, limit);
    const installed = batch.length ? await installFromShared(batch, { imagemap, store }) : { outcomes: [], overrides: { imagemap }, linksUpdated: 0, store, installed: 0 };
    store = installed.store || store;

    /* MEZAR TAŞI: silinen/değiştirilen görsel eski bir istemcinin yerel
       kopyasından geri DİRİLMEZ. Kayıt düşürülür ve yerel sahiplik unutulur;
       bayt dosyası ortak silme yoluna bırakılır. */
    let tombstonesApplied = 0;
    if (tombstones.length && patchLinks) {
      try {
        const result = patchLinks(tombstones.map(item => ({ plmId: item.plmId, colourCode: item.colourCode, colour: item.colour, imageRef: '' })));
        tombstonesApplied = tombstones.length;
        store = ownership.forget(tombstones.map(item => item.key), { store, persist: ownership.saveOwnership }).store;
        store = ownership.forgetManual(tombstones.map(item => item.key), { store, persist: ownership.saveOwnership }).store;
        installed.overrides = result.overrides || installed.overrides;
      } catch (error) { trace('SHARED_TOMBSTONE_FAILED', { error: (error && error.message) || String(error) }); }
    }

    const after = state();
    const remaining = wanted.length - batch.length;
    if (!remaining) for (const head of merged.heads) after.lastApplied[head.deviceId] = head.revision;
    after.lastPullAt = new Date().toISOString();
    persist(after);

    return {
      available: true,
      scanned: merged.records.length,
      candidates: wanted.length,
      installed: installed.installed || 0,
      tombstones: tombstonesApplied,
      remaining,
      overrides: installed.overrides,
      outcomes: installed.outcomes,
      store,
      heads: merged.heads,
    };
  }

  /* ======================================================================
     5) DAĞITIK TAZELEME KİRASI — iki örnek aynı varlığı aynı anda çekmesin.
     ====================================================================== */
  async function withRefreshLease(canonicalKey, source, operation, options = {}) {
    return shared.withRefreshLease(canonicalKey, sharedImageStore.normalizeSource(source), operation, options);
  }

  function status() {
    const current = state();
    return {
      pendingPublish: current.pendingPublish.length,
      notFound: Object.keys(current.notFound).length,
      lastPullAt: current.lastPullAt,
      lastPublishAt: current.lastPublishAt,
      lastApplied: current.lastApplied,
      freshnessMs, notFoundTtlMs,
    };
  }

  return {
    plan, installFromShared, queuePublish, flushPublish, pull, withRefreshLease,
    isSuppressed, rememberNotFound, clearNotFound, isFreshEnough, status, state,
    ORIGIN_LOCAL, ORIGIN_SHARED, ORIGIN_UPSTREAM, ORIGIN_MANUAL, ORIGIN_STALE, ORIGIN_NOT_FOUND, ORIGIN_LEASED,
  };
}

module.exports = {
  SCHEMA_VERSION,
  DEFAULT_FRESHNESS_MS,
  DEFAULT_NOT_FOUND_TTL_MS,
  ORIGIN_LOCAL, ORIGIN_SHARED, ORIGIN_UPSTREAM, ORIGIN_MANUAL, ORIGIN_STALE, ORIGIN_NOT_FOUND, ORIGIN_LEASED,
  emptyState, normalizeState, notFoundKey,
  createModelImageDistribution,
};
