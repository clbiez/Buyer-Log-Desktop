'use strict';

/* ===================================================================
   OAB — KULLANICI BAZLI SON SNAPSHOT / SEÇİM DURUMU

   Amaç:
   - Son başarılı OAB raporunda kullanılan Season/MAG/Buyer seçimini hatırla.
   - Son başarılı OAB snapshot'ını kullanıcı bazında kalıcı tut.
   - Uygulama yeniden açıldığında PASS'e gitmeden aynı snapshot ile devam et.

   Bu depo Authorization/token içermez. Yalnız filtre ref'leri, satırlar, alanlar
   ve snapshot zamanı saklanır. LOCAL_DATA_ROOT kullanıldığı için yeni Buyer Log
   paketine geçildiğinde de kullanıcı durumunun korunması hedeflenir.
   =================================================================== */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const { withFileLeaseSync } = require('./shared-file-transaction');
const { LOCAL_DATA_ROOT, atomicWriteBuffer, atomicWriteJson } = require('../user-data');

const ROOT = path.join(LOCAL_DATA_ROOT, 'oab-snapshots');
const SCHEMA_VERSION = 1;

function safeUserId(value) {
  return String(value || 'moderator').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 100) || 'moderator';
}
function cleanRef(value) { return String(value == null ? '' : value).trim(); }
function filePathFor(userId) { return path.join(ROOT, `${safeUserId(userId)}.json.gz`); }

function cleanRefList(value, single) {
  const list = Array.isArray(value) ? value : [];
  const seen = new Set(), out = [];
  for (const item of list) {
    const ref = cleanRef(item);
    if (!ref || seen.has(ref)) continue;
    seen.add(ref); out.push(ref);
  }
  if (out.length) return out;
  const one = cleanRef(single);
  return one ? [one] : [];
}

/* v7.23 — ÇOKLU SEÇİM SNAPSHOT'A DA YAZILIR.

   v7.20'de çoklu seçim eklendiğinde toplu iş, seçimi ÇOĞUL alanlarla
   (seasonRefs/merchSubGroupRefs/buyerGroupRefs) kaydetmeye başladı; bu depo
   ise yalnız TEKİL alanları yazıyordu. Sonuç: çoklu seçimle çekilen her
   raporun seçimi boş kaydediliyor, program yeniden açıldığında istemci
   seçimi doğrulayamayıp son snapshot'ı hiç geri yükleyemiyordu.

   Artık ikisi de yazılır. SCHEMA_VERSION BİLEREK ARTIRILMADI: sürüm
   değişirse load() eldeki bütün snapshot'ları reddeder ve kullanıcılar
   yükseltmede son raporlarını kaybederdi. Eski dosyalarda çoğul alanlar
   yoktur; istemci zaten tekilden diziye düşüyor. */
function normalizePayload(payload) {
  const src = payload && typeof payload === 'object' ? payload : {};
  const selection = src.selection && typeof src.selection === 'object' ? src.selection : {};
  const seasonRefs = cleanRefList(selection.seasonRefs, selection.seasonRef);
  const merchSubGroupRefs = cleanRefList(selection.merchSubGroupRefs, selection.merchSubGroupRef);
  const buyerGroupRefs = cleanRefList(selection.buyerGroupRefs, selection.buyerGroupRef);
  return {
    schemaVersion: SCHEMA_VERSION,
    revisionId: crypto.randomUUID(),
    savedAt: new Date().toISOString(),
    selection: {
      seasonRef: seasonRefs[0] || '',
      merchSubGroupRef: merchSubGroupRefs[0] || '',
      buyerGroupRef: buyerGroupRefs[0] || '',
      seasonRefs,
      merchSubGroupRefs,
      buyerGroupRefs,
      allBuyerGroups: Boolean(selection.allBuyerGroups),
    },
    snapshot: {
      rows: Array.isArray(src.rows) ? src.rows : [],
      fields: Array.isArray(src.fields) ? src.fields : [],
      fetchedAt: src.fetchedAt || new Date().toISOString(),
      fromCache: Boolean(src.fromCache),
    },
  };
}

function sourceFingerprint(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
function mutationOf(options){
 const value=options.mutation;
 if(value===undefined)return null;
 if(!value||!/^[a-f0-9]{64}$/.test(value.id||'')||!/^[a-f0-9]{64}$/.test(value.expectedFingerprint||'')||value.expectedFingerprint!==options.expectedFingerprint)throw Object.assign(new Error('OAB_SNAPSHOT_MUTATION_INVALID'),{code:'OAB_SNAPSHOT_MUTATION_INVALID',statusCode:409});
 return {id:value.id,expectedFingerprint:value.expectedFingerprint};
}
const sameMutation=(a,b)=>a&&b&&a.id===b.id&&a.expectedFingerprint===b.expectedFingerprint;
function clearRevision(userId) {
  const file = filePathFor(userId) + '.revision.json';
  if (!fs.existsSync(file)) {
    if (fs.existsSync(file + '.bak')) throw Object.assign(new Error('OAB_SNAPSHOT_REVISION_INVALID'),{code:'OAB_SNAPSHOT_REVISION_INVALID',statusCode:409});
    return null; // Existing legacy owners need no migration.
  }
  try {
    const value = JSON.parse(fs.readFileSync(file,'utf8'));
    if (value?.schemaVersion === 1 && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value.revisionId)) return value.revisionId;
  } catch (_) {}
  throw Object.assign(new Error('OAB_SNAPSHOT_REVISION_INVALID'),{code:'OAB_SNAPSHOT_REVISION_INVALID',statusCode:409});
}
function fingerprint(userId) {return sourceFingerprint({clearRevision:clearRevision(userId),snapshot:load(userId)});}

// Same native atomic writer, under the existing inter-process file lease.
// The trusted transformer receives the actual current report inside the lease.
function update(userId, transform, options = {}) {
  if (typeof transform !== 'function') throw new TypeError('Native snapshot transformer required');
  return withFileLeaseSync(filePathFor(userId), () => {
    if (options.assertAuthority) options.assertAuthority();
    const mutation=mutationOf(options);
    const previous = load(userId), current = sourceFingerprint({clearRevision:clearRevision(userId),snapshot:previous});
    if(sameMutation(previous?._nativeMutation,mutation)){options.assertAuthority?.();return{savedAt:previous.savedAt,fetchedAt:previous.snapshot.fetchedAt,rows:previous.snapshot.rows.length,sourceFingerprint:current,reused:true};}
    if (options.expectedFingerprint !== undefined && options.expectedFingerprint !== current) {
      throw Object.assign(new Error('OAB_SNAPSHOT_CHANGED'),{code:'OAB_SNAPSHOT_CHANGED',statusCode:409});
    }
    const payload = transform(previous);
    if (payload && typeof payload.then === 'function') throw new TypeError('Native snapshot transformer must be synchronous');
    const value = normalizePayload(payload);
    if(mutation)value._nativeMutation=mutation;
    if (options.assertAuthority) options.assertAuthority();
    const buffer = zlib.gzipSync(Buffer.from(JSON.stringify(value), 'utf8'), { level: 6 });
    if (options.assertAuthority) options.assertAuthority();
    atomicWriteBuffer(filePathFor(userId), buffer);
    const persisted = load(userId);
    if (sourceFingerprint(persisted) !== sourceFingerprint(value)) throw Object.assign(new Error('OAB_SNAPSHOT_SAVE_FAILED'),{code:'OAB_SNAPSHOT_SAVE_FAILED',statusCode:500});
    return {savedAt:value.savedAt,fetchedAt:value.snapshot.fetchedAt,rows:value.snapshot.rows.length,sourceFingerprint:fingerprint(userId)};
  });
}
function save(userId, payload, options = {}) {
  const {savedAt,fetchedAt,rows} = update(userId, () => payload, options);
  return {savedAt,fetchedAt,rows};
}

function load(userId) {
  const file = filePathFor(userId);
  for (const candidate of [file, file + '.bak']) {
    if (!fs.existsSync(candidate)) continue;
    try {
      const raw = zlib.gunzipSync(fs.readFileSync(candidate));
      const parsed = JSON.parse(raw.toString('utf8'));
      if (!parsed || parsed.schemaVersion !== SCHEMA_VERSION) continue;
      if (!parsed.selection || !parsed.snapshot || !Array.isArray(parsed.snapshot.rows) || !Array.isArray(parsed.snapshot.fields)) continue;
      return parsed;
    } catch (_) { /* yedek kopyayı dene */ }
  }
  return null;
}

function readCurrent(userId,options={}) {
  return withFileLeaseSync(filePathFor(userId),()=>{
    options.assertAuthority?.();
    const state=load(userId),current=sourceFingerprint({clearRevision:clearRevision(userId),snapshot:state});
    if(options.expectedFingerprint!==undefined&&options.expectedFingerprint!==current)throw Object.assign(new Error('OAB_SNAPSHOT_CHANGED'),{code:'OAB_SNAPSHOT_CHANGED',statusCode:409});
    options.assertAuthority?.();return options.withFingerprint?{state,sourceFingerprint:current}:state;
  });
}

function clear(userId,options={}) {
 return withFileLeaseSync(filePathFor(userId), () => {
  options.assertAuthority?.();
  const file = filePathFor(userId);
  const mutation=mutationOf(options);clearRevision(userId);
  const copyHash=candidate=>fs.existsSync(candidate)?crypto.createHash('sha256').update(fs.readFileSync(candidate)).digest('hex'):null;
  const copies={main:copyHash(file),backup:copyHash(file+'.bak')};
  let priorRevision=null;try{priorRevision=JSON.parse(fs.readFileSync(file+'.revision.json','utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
  const reused=sameMutation(priorRevision?.mutation,mutation);
  if(reused){
   // An interrupted clear may retain either exact original physical copy.
   // Missing copies are allowed; new/different bytes never belong to it.
   if(!priorRevision.previousCopies||Object.entries(copies).some(([key,value])=>value!==null&&value!==priorRevision.previousCopies[key]))throw Object.assign(new Error('OAB_SNAPSHOT_CHANGED'),{code:'OAB_SNAPSHOT_CHANGED',statusCode:409});
  }else if(options.expectedFingerprint!==undefined&&options.expectedFingerprint!==fingerprint(userId))throw Object.assign(new Error('OAB_SNAPSHOT_CHANGED'),{code:'OAB_SNAPSHOT_CHANGED',statusCode:409});
  // Persist the native empty-state identity before deleting both report copies.
  // A no-report -> save -> clear transition must not return to the old CAS stamp.
  options.assertAuthority?.();if(!reused)atomicWriteJson(file + '.revision.json',{schemaVersion:1,revisionId:crypto.randomUUID(),clearedAt:new Date().toISOString(),...(mutation?{mutation,previousCopies:copies}:{})});
  let removed = false;
  for (const candidate of [file, file + '.bak']) {
    try { fs.unlinkSync(candidate); removed = true; } catch (err) { if (err && err.code !== 'ENOENT') throw err; }
  }
  return options.returnReceipt?{removed,sourceFingerprint:fingerprint(userId),rowCount:0,reused:!!reused}:removed;
 });
}

module.exports = { ROOT, SCHEMA_VERSION, filePathFor, save, load, clear, fingerprint, update, readCurrent };
