'use strict';

/* KANONİK MODEL GÖRSELİ ALIM YOLU.
 *
 * Canlı PLM senkronu ve hazır BUYERLOG_IMPORT paketi AYNI bu yoldan geçer.
 * İkinci bir görsel alt sistemi kurulmaz: kimlik (PLM ID + Colour Code),
 * depo (collection-images), kayıt (overrides.imagemap) ve önbellek
 * geçersizleştirme sözleşmesi neyse o kalır.
 *
 * Bu modül depoyu ve kaydı KENDİ İÇİNDE bilmez; hepsi enjekte edilir
 * (getImage/saveImage/deleteImage/patchLinks/loadOverrides). Böylece bütün
 * karar mantığı gerçek diske dokunmadan sınanabilir.
 *
 * AŞAMALAR
 *   decideBeforeFetch  — metadata/indirme ÖNCESİ: mod ve manuel sahiplik.
 *   decideBeforeWrite  — indirme ÖNCESİ: kaynak kimliği önbellek isabeti.
 *   commit             — indirilen baytları depoya ve kayda yazar.
 *
 * "Görseli indirdikten sonra karar vermek" bilinçli olarak REDDEDİLDİ: 5.000
 * modellik bir işte gereksiz indirme hem süre hem CoreNectum yükü demektir.
 */

const crypto = require('crypto');
const parseLib = require('./parse');
const ownershipStore = require('./plm-image-ownership');
const { sniffImageMime } = require('./plm-image-download-queue');

const DECISION_FETCH = 'fetch';
const DECISION_CACHED = 'cached';
const DECISION_MANUAL = 'manual-preserved';
const DECISION_INVALID = 'invalid';

const COMMIT_WRITTEN = 'written';
const COMMIT_SHARED = 'shared';
const COMMIT_UNCHANGED = 'unchanged';
const COMMIT_MANUAL = 'manual-preserved';
const COMMIT_FAILED = 'failed';

function clean(value, max = 300) {
  return String(value == null ? '' : value).replace(/\u0000/g, '').trim().slice(0, max);
}

function imageHash(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/* Kanonik kimlik. Renk adı VARSA isim-özel anahtar kullanılır: gösterim
   katmanı da önce ona bakar (bkz. parse.plmImageRef ve
   plm-image-availability.js). Renk yoksa PLM-only anahtar yalnız eski
   göç verisi için okunur. */
function canonicalKeyFor({ plmId, colourCode, colour } = {}) {
  const code = clean(colourCode, 80);
  if (!code) return parseLib.plmImageKey(plmId);
  return parseLib.plmColourImageNameKey(plmId, code, clean(colour, 160));
}

/* imagemap'te bu kimlik için ŞU AN hangi referans okunuyor?
   Gösterimin gördüğü sırayla okunur; aksi hâlde "eski görsel duruyor" ile
   "yeni görsel yazıldı" kararları ekrandan farklı çıkardı. */
function currentRefFor(imagemap, { plmId, colourCode, colour } = {}) {
  const map = imagemap && typeof imagemap === 'object' ? imagemap : {};
  const code = clean(colourCode, 80);
  if (!code) {
    const legacy = parseLib.plmImageKey(plmId);
    return legacy && Object.prototype.hasOwnProperty.call(map, legacy) ? clean(map[legacy], 120) : '';
  }
  const named = parseLib.plmColourImageNameKey(plmId, code, clean(colour, 160));
  if (named && Object.prototype.hasOwnProperty.call(map, named)) return clean(map[named], 120);
  const coded = parseLib.plmColourImageKey(plmId, code);
  if (coded && Object.prototype.hasOwnProperty.call(map, coded)) return clean(map[coded], 120);
  return '';
}

function normalizeRequest(raw) {
  const plmId = clean(raw && raw.plmId, 80);
  const colourCode = clean(raw && (raw.colourCode ?? raw.colorCode), 80);
  const colour = clean(raw && (raw.colour ?? raw.color), 160);
  const key = canonicalKeyFor({ plmId, colourCode, colour });
  return {
    plmId,
    colourCode,
    colour,
    styleId: clean(raw && raw.styleId, 40),
    styleName: clean(raw && raw.styleName, 300),
    key,
  };
}

function createPlmImageIngest(deps = {}) {
  const getImage = typeof deps.getImage === 'function' ? deps.getImage : () => null;
  const saveImage = typeof deps.saveImage === 'function' ? deps.saveImage : null;
  const deleteImage = typeof deps.deleteImage === 'function' ? deps.deleteImage : () => false;
  const patchLinks = typeof deps.patchLinks === 'function' ? deps.patchLinks : null;
  const readImageBytes = typeof deps.readImageBytes === 'function' ? deps.readImageBytes : null;
  const ownership = deps.ownership || ownershipStore;
  const owner = clean(deps.owner, 20) || ownership.OWNER_PLM;

  function storedImageBytes(ref) {
    const found = getImage(ref);
    if (!found) return null;
    if (!readImageBytes) return { item: found.item || null, buffer: null };
    try { return { item: found.item || null, buffer: readImageBytes(found) }; }
    catch (_) { return { item: found.item || null, buffer: null }; }
  }

  function hasStoredFile(ref) {
    return Boolean(clean(ref, 120) && getImage(ref));
  }

  /* 1. AŞAMA — metadata/indirme öncesi.
     mode 'missing': kullanılabilir görseli olan kimlik İSTEĞE HİÇ GİRMEZ.
     Manuel görsel her modda korunur (overwriteManual hariç). */
  function decideBeforeFetch(request, { store, imagemap, mode = 'missing', overwriteManual = false } = {}) {
    const item = normalizeRequest(request);
    if (!item.key) return { ...item, decision: DECISION_INVALID, code: 'PLM_IMAGE_KEY_INVALID', reason: 'Geçerli bir PLM ID + Renk Kodu kimliği üretilemedi.' };
    const currentRef = currentRefFor(imagemap, item);
    const usable = hasStoredFile(currentRef);
    const permission = ownership.canWriteAutomatic(store, item.key, currentRef, { overwriteManual });
    if (!permission.allowed) {
      return { ...item, currentRef, decision: DECISION_MANUAL, ownershipState: permission.state, reason: 'Kullanıcının elle seçtiği görsel korunur.' };
    }
    if (mode === 'missing' && usable) {
      return { ...item, currentRef, decision: DECISION_CACHED, ownershipState: permission.state, reason: 'Kullanılabilir görsel zaten var (eksikleri tamamla modu).' };
    }
    return { ...item, currentRef, decision: DECISION_FETCH, ownershipState: permission.state };
  }

  /* 2. AŞAMA — indirme öncesi. Kaynak kimliği (styleOptionImageId /
     attachmentAssociationId / paket özeti) kayıttakiyle aynıysa bayt
     indirmeye GEREK YOK. */
  function decideBeforeWrite(decided, selection, { store, overwriteManual = false } = {}) {
    const sourceIdentity = clean(selection && selection.sourceIdentity, 200);
    const base = { ...decided, sourceType: clean(selection && selection.sourceType, 40), sourceIdentity, imageUrl: clean(selection && selection.imageUrl, 2000) };
    if (decided.decision === DECISION_MANUAL || decided.decision === DECISION_INVALID) return base;
    const permission = ownership.canWriteAutomatic(store, decided.key, decided.currentRef, { overwriteManual });
    if (!permission.allowed) return { ...base, decision: DECISION_MANUAL, ownershipState: permission.state, reason: 'Kullanıcının elle seçtiği görsel korunur.' };
    if (ownership.isCacheHit(store, decided.key, decided.currentRef, sourceIdentity, { hasStoredFile: hasStoredFile(decided.currentRef) })) {
      return { ...base, decision: DECISION_CACHED, reason: 'Aynı CoreNectum görsel kimliği zaten kayıtlı.' };
    }
    return { ...base, decision: DECISION_FETCH };
  }

  /* 3. AŞAMA — yazma.
     GÜVENLİ DEĞİŞTİRME SÖZLEŞMESİ: mevcut geçerli görsel, yenisi tamamen
     indirilip DOĞRULANIP depoya yazılana kadar kayıtta durur. Araya kırık
     bir ara durum girmez. Eski dosya yalnız kayıt güncellendikten ve başka
     hiçbir kimlik onu kullanmadığı doğrulandıktan sonra silinir. */
  function commit(entries, options = {}) {
    if (!saveImage || !patchLinks) throw new Error('Kanonik görsel deposu bağlanmadı (saveImage/patchLinks).');
    const store = options.store || ownership.loadOwnership();
    const overwriteManual = options.overwriteManual === true;
    const imagemap = options.imagemap || {};
    const dropOldFiles = options.dropOldFiles === true;

    const links = [];
    const ownerEntries = [];
    const outcomes = [];
    const created = [];
    // Aynı baytlar birden çok renk kimliğinde paylaşılır: aynı dosya renk
    // başına kopyalanmaz. Silme yolları zaten "başka anahtar bu referansı
    // kullanıyor mu" kontrolü yapıyor.
    const storedByHash = new Map();

    for (const entry of Array.isArray(entries) ? entries : []) {
      const item = normalizeRequest(entry);
      const currentRef = clean(entry.currentRef, 120) || currentRefFor(imagemap, item);
      try {
        if (!item.key) { outcomes.push({ ...item, status: COMMIT_FAILED, code: 'PLM_IMAGE_KEY_INVALID', error: 'Geçerli bir görsel kimliği üretilemedi.' }); continue; }
        const permission = ownership.canWriteAutomatic(store, item.key, currentRef, { overwriteManual });
        if (!permission.allowed) { outcomes.push({ ...item, currentRef, status: COMMIT_MANUAL, reason: 'Kullanıcının elle seçtiği görsel korunur.' }); continue; }

        const buffer = Buffer.isBuffer(entry.buffer) ? entry.buffer : null;
        if (!buffer || !buffer.length) { outcomes.push({ ...item, currentRef, status: COMMIT_FAILED, code: 'PLM_IMAGE_EMPTY', error: 'Görsel içeriği boş.' }); continue; }
        const mimeType = sniffImageMime(buffer, entry.mimeType);
        if (!mimeType) { outcomes.push({ ...item, currentRef, status: COMMIT_FAILED, code: 'PLM_IMAGE_INVALID', error: 'İçerik geçerli bir raster görsel değil.' }); continue; }

        const hash = imageHash(buffer);
        const sourceType = clean(entry.sourceType, 40).toUpperCase();
        const sourceIdentity = clean(entry.sourceIdentity, 200);

        // Baytlar birebir aynıysa yeni dosya oluşturulmaz; yalnız kaynak
        // kimliği tazelenir (aynı görsel yeni bir Option Image kimliğiyle
        // gelmiş olabilir).
        const existing = currentRef ? storedImageBytes(currentRef) : null;
        if (existing && existing.buffer && imageHash(existing.buffer) === hash) {
          storedByHash.set(hash, { id: currentRef, url: (existing.item && existing.item.url) || '', mimeType, size: buffer.length, updatedAt: (existing.item && existing.item.updatedAt) || '' });
          ownerEntries.push({ key: item.key, owner, imageRef: currentRef, sourceType, sourceIdentity, hash, styleId: item.styleId });
          outcomes.push({ ...item, currentRef, imageRef: currentRef, status: COMMIT_UNCHANGED, sourceType, sourceIdentity, contentHash: hash, size: buffer.length, mimeType, url: (existing.item && existing.item.url) || '', imageVersion: (existing.item && existing.item.updatedAt) || '' });
          continue;
        }

        const shared = storedByHash.get(hash);
        if (shared && shared.id !== currentRef) {
          links.push({ plmId: item.plmId, colourCode: item.colourCode, colour: item.colour, imageRef: shared.id });
          ownerEntries.push({ key: item.key, owner, imageRef: shared.id, sourceType, sourceIdentity, hash, styleId: item.styleId });
          outcomes.push({ ...item, currentRef, imageRef: shared.id, status: COMMIT_SHARED, sourceType, sourceIdentity, contentHash: hash, size: shared.size, mimeType: shared.mimeType, url: shared.url, imageVersion: shared.updatedAt || '' });
          continue;
        }

        const stored = saveImage({
          rowId: `plm:${item.key}`,
          filename: clean(entry.filename, 160) || defaultFilename(item, mimeType),
          mimeType,
          base64: buffer.toString('base64'),
        });
        created.push(stored.id);
        storedByHash.set(hash, { id: stored.id, url: stored.url, mimeType: stored.mimeType, size: stored.size, updatedAt: stored.updatedAt });
        links.push({ plmId: item.plmId, colourCode: item.colourCode, colour: item.colour, imageRef: stored.id });
        ownerEntries.push({ key: item.key, owner, imageRef: stored.id, sourceType, sourceIdentity, hash, styleId: item.styleId });
        outcomes.push({ ...item, currentRef, imageRef: stored.id, status: COMMIT_WRITTEN, sourceType, sourceIdentity, contentHash: hash, size: stored.size, mimeType: stored.mimeType, url: stored.url, imageVersion: stored.updatedAt || '' });
      } catch (error) {
        outcomes.push({ ...item, currentRef, status: COMMIT_FAILED, code: clean(error && error.code, 60) || 'PLM_IMAGE_STORAGE_FAILED', error: clean(error && error.message, 300) });
      }
    }

    let patched = { overrides: { imagemap }, updated: 0 };
    if (links.length) {
      try { patched = patchLinks(links); }
      catch (error) {
        // Kayıt yazılamadıysa bu turda OLUŞTURULAN dosyalar geri alınır:
        // aksi hâlde hiçbir kimliğin işaret etmediği yetim dosyalar kalırdı.
        for (const id of created) { try { deleteImage(id); } catch (_) {} }
        throw error;
      }
    }

    // Sahiplik kaydı ANCAK imagemap yazıldıktan sonra güncellenir: sıra ters
    // olsa, patch başarısız olduğunda kayıt "otomatik" der ama imagemap eski
    // manuel referansı taşır ve bir sonraki senkron onu ezebilirdi.
    /* persist AÇIKÇA geçilir: rememberAutomatic'in varsayılanı modül düzeyi
       saveOwnership'tir ve enjekte edilmiş bir sahiplik modülünü GÖRMEZ.
       Varsayılana bırakılırsa kayıt, çağıranın verdiği depoya değil gerçek
       dosyaya gider — sınamada ve çok adımlı (parti parti) yazmada sessiz
       bir tutarsızlık üretirdi. */
    const remembered = ownerEntries.length
      ? ownership.rememberAutomatic(ownerEntries, { store, persist: ownership.saveOwnership })
      : { store, changed: 0 };

    let removedFiles = 0;
    if (dropOldFiles) {
      const activeRefs = new Set(Object.values((patched.overrides && patched.overrides.imagemap) || {})
        .map(value => clean(value, 120)).filter(Boolean));
      for (const outcome of outcomes) {
        if (!outcome.currentRef || outcome.currentRef === outcome.imageRef) continue;
        if (outcome.status !== COMMIT_WRITTEN && outcome.status !== COMMIT_SHARED) continue;
        if (activeRefs.has(outcome.currentRef)) continue;
        try { if (deleteImage(outcome.currentRef)) removedFiles += 1; } catch (_) {}
      }
    }

    return {
      overrides: patched.overrides,
      linksUpdated: patched.updated || 0,
      outcomes,
      store: remembered.store,
      ownershipChanged: remembered.changed,
      removedFiles,
      counts: countOutcomes(outcomes),
    };
  }

  return { decideBeforeFetch, decideBeforeWrite, commit, canonicalKeyFor, currentRefFor, normalizeRequest, hasStoredFile };
}

function defaultFilename(item, mimeType) {
  const extension = mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : mimeType === 'image/gif' ? 'gif' : 'jpg';
  const colour = item.colourCode ? `-${item.colourCode.replace(/[^a-z0-9_-]/gi, '_')}` : '';
  return `corenectum-${item.plmId}${colour}.${extension}`;
}

function countOutcomes(outcomes) {
  const counts = { written: 0, shared: 0, unchanged: 0, manualPreserved: 0, failed: 0 };
  for (const outcome of Array.isArray(outcomes) ? outcomes : []) {
    if (outcome.status === COMMIT_WRITTEN) counts.written += 1;
    else if (outcome.status === COMMIT_SHARED) counts.shared += 1;
    else if (outcome.status === COMMIT_UNCHANGED) counts.unchanged += 1;
    else if (outcome.status === COMMIT_MANUAL) counts.manualPreserved += 1;
    else if (outcome.status === COMMIT_FAILED) counts.failed += 1;
  }
  return counts;
}

module.exports = {
  DECISION_FETCH,
  DECISION_CACHED,
  DECISION_MANUAL,
  DECISION_INVALID,
  COMMIT_WRITTEN,
  COMMIT_SHARED,
  COMMIT_UNCHANGED,
  COMMIT_MANUAL,
  COMMIT_FAILED,
  createPlmImageIngest,
  canonicalKeyFor,
  currentRefFor,
  normalizeRequest,
  imageHash,
  countOutcomes,
};
