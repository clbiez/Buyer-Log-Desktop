'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const { promisify, types } = require('util');
const { LOCAL_DATA_ROOT } = require('../user-data');
const { stringifyWithDates } = require('./json-dates');
const schemaBindings = require('./page-projection-schema-binding').create({
  schemaApi: require('../../public/module-projection-schema'),
});

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);
// v2: CP/Orders lojistik segmentleri parsiyel kimliği (dosya/konteyner/gemi) taşır.
const CACHE_SCHEMA_VERSION = 2;
const ROOT = path.join(LOCAL_DATA_ROOT, 'page-cache');
// order-summary: CP tabanlı sipariş özeti. Siparişler ekranı okumaz; orders
// projeksiyonuna gömülüyken her ilk girişte ~%35 fazla veri indiriliyordu.
const MODULES = new Set(['cp', 'overview', 'orders', 'order-summary', 'collection-catalog']);
const BACKLOG_MAX_VARIANTS = 8;
// Advisory Orders-only derived bytes. No previous-manifest fallback or source rebuild.
const VIEW_LIMITS = Object.freeze({ maxEntries: 2, maxCompressedBytes: 32 * 1024 * 1024,
  maxRawBytes: 128 * 1024 * 1024, maxMetadataBytes: 64 * 1024, maxRegistryKeys: 512 });
const VIEW_PIN_KEYS = ['generation', 'contextHash', 'moduleInputKey', 'sourceProjectionKey', 'fullChecksum', 'sourceRevisionKey', 'planHash'];
const MEMORY_MAX_ENTRIES = Math.max(2, Number(process.env.BL_PAGE_CACHE_MEMORY_ITEMS) || 12);
const MEMORY_MAX_BYTES = Math.max(4 * 1024 * 1024, Number(process.env.BL_PAGE_CACHE_MEMORY_BYTES) || 48 * 1024 * 1024);
const compressedLru = new Map();
const singleFlights = new Map();
const userMutationTails = new Map();
let compressedLruBytes = 0;

function safeUserId(value) {
  return String(value || 'moderator').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 100) || 'moderator';
}
function userRoot(userId) { return path.join(ROOT, safeUserId(userId)); }
function manifestPath(userId) { return path.join(userRoot(userId), 'manifest.json'); }
function generationRoot(userId, generationId) { return path.join(userRoot(userId), String(generationId || '')); }
function modulePath(userId, generationId, module) { return path.join(generationRoot(userId, generationId), `${module}.json.gz`); }
function backlogPath(userId, generationId, key) { return path.join(generationRoot(userId, generationId), `backlog-${String(key || '').replace(/[^A-Fa-f0-9_-]/g, '').slice(0, 80)}.json.gz`); }
function generationId() { return `${Date.now().toString(36)}-${crypto.randomBytes(6).toString('hex')}`; }
function dateOnlyISO(d) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function checksum(buffer) { return crypto.createHash('sha256').update(buffer).digest('hex'); }
function lruKey(file, expectedChecksum) { return `${file}\u0000${expectedChecksum || ''}`; }
function lruForgetFile(file) {
  for (const [key, entry] of compressedLru) {
    if (entry.file !== file) continue;
    compressedLru.delete(key); compressedLruBytes -= entry.buffer.length;
  }
}
function lruPut(file, expectedChecksum, buffer, statTag = '') {
  if (!Buffer.isBuffer(buffer) || buffer.length > MEMORY_MAX_BYTES) return;
  const key = lruKey(file, expectedChecksum), previous = compressedLru.get(key);
  if (previous) compressedLruBytes -= previous.buffer.length;
  compressedLru.delete(key);
  compressedLru.set(key, { file, buffer, statTag });
  compressedLruBytes += buffer.length;
  while (compressedLru.size > MEMORY_MAX_ENTRIES || compressedLruBytes > MEMORY_MAX_BYTES) {
    const oldest = compressedLru.entries().next().value;
    if (!oldest) break;
    compressedLru.delete(oldest[0]); compressedLruBytes -= oldest[1].buffer.length;
  }
}
async function singleFlight(key, task) {
  if (singleFlights.has(key)) return singleFlights.get(key);
  const promise = Promise.resolve().then(task).finally(() => {
    if (singleFlights.get(key) === promise) singleFlights.delete(key);
  });
  singleFlights.set(key, promise);
  return promise;
}
function enqueueUserMutation(userId, task) {
  const key = safeUserId(userId), previous = userMutationTails.get(key) || Promise.resolve();
  const next = previous.catch(() => {}).then(task);
  userMutationTails.set(key, next);
  return next.finally(() => { if (userMutationTails.get(key) === next) userMutationTails.delete(key); });
}
async function atomicWrite(file, buffer) {
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.${crypto.randomBytes(3).toString('hex')}.tmp`;
  await fs.promises.writeFile(tmp, buffer, { flag: 'wx' });
  try { await fs.promises.rename(tmp, file); }
  catch (renameErr) {
    try { await fs.promises.copyFile(tmp, file); await fs.promises.unlink(tmp); }
    catch (copyErr) { try { await fs.promises.unlink(tmp); } catch (_) {} throw copyErr; }
  }
}
async function writeJsonGzip(file, value) {
  const json = Buffer.from(stringifyWithDates(value, dateOnlyISO), 'utf8');
  const compressed = await gzip(json, { level: 4 });
  await atomicWrite(file, compressed);
  lruForgetFile(file);
  return { bytes: compressed.length, uncompressedBytes: json.length, checksum: checksum(compressed) };
}
function loadManifestFile(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (parsed && parsed.schemaVersion === CACHE_SCHEMA_VERSION && parsed.activeGeneration) return parsed;
  } catch (_) {}
  return null;
}
function loadManifestCandidates(userId) {
  const primary = loadManifestFile(manifestPath(userId));
  const backup = loadManifestFile(manifestPath(userId) + '.bak');
  const out = [];
  if (primary) out.push(primary);
  if (backup && (!primary || backup.activeGeneration !== primary.activeGeneration)) out.push(backup);
  return out;
}
function loadManifest(userId) { return loadManifestCandidates(userId)[0] || null; }
async function saveManifest(userId, manifest, publishNewModuleSchemas = false) {
  const file = manifestPath(userId);
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  const current = loadManifestFile(file); // Primary only: optional schema never gains backup authority.
  const ownSchemas = schemaBindings.retainCurrent(publishNewModuleSchemas ? manifest : current, manifest, String(userId));
  if (Object.keys(ownSchemas).length) manifest.moduleSchemas = ownSchemas;
  else delete manifest.moduleSchemas;
  // .bak gerçek bir önceki başarılı generation'ı temsil eder. Aynı aktif generation
  // üzerinde LRU touch veya tek-modül patch yapılırken backup'ı mevcut manifest ile
  // ezmek fallback'i yok ederdi; yalnız generation değişirken primary'yi yedekle.
  try {
    if (current && current.activeGeneration !== manifest.activeGeneration) {
      await fs.promises.copyFile(file, file + '.bak');
    }
  } catch (_) {}
  await atomicWrite(file, Buffer.from(JSON.stringify(manifest, null, 2), 'utf8'));
}
async function readJsonGzip(file, expectedChecksum = '') {
  const started = Date.now();
  const compressedResult = await readCompressed(file, expectedChecksum);
  const compressed = compressedResult.buffer;
  const inflateStarted = Date.now();
  const raw = await gunzip(compressed);
  const parseStarted = Date.now();
  const parsed = JSON.parse(raw.toString('utf8'));
  return {
    data: parsed, ms: Date.now() - started, bytes: compressed.length,
    diskReadMs: compressedResult.diskReadMs, memoryHit: compressedResult.memoryHit,
    decompressMs: parseStarted - inflateStarted, parseMs: Date.now() - parseStarted,
  };
}
async function readCompressed(file, expectedChecksum = '') {
  const key = lruKey(file, expectedChecksum), hit = compressedLru.get(key);
  if (hit) {
    try {
      const stat = await fs.promises.stat(file), statTag = `${stat.size}:${stat.mtimeMs}`;
      if (hit.statTag === statTag) {
        compressedLru.delete(key); compressedLru.set(key, hit);
        return { buffer: hit.buffer, diskReadMs: 0, memoryHit: true };
      }
    } catch (_) { /* normal read below reports the real failure */ }
    lruForgetFile(file);
  }
  const started = Date.now(), stat = await fs.promises.stat(file), buffer = await fs.promises.readFile(file);
  const actualChecksum = checksum(buffer);
  if (expectedChecksum && actualChecksum !== expectedChecksum) {
    const error = new Error('Page cache checksum uyuşmuyor.'); error.code = 'PAGE_CACHE_CHECKSUM_MISMATCH'; throw error;
  }
  lruPut(file, expectedChecksum || actualChecksum, buffer, `${stat.size}:${stat.mtimeMs}`);
  return { buffer, diskReadMs: Date.now() - started, memoryHit: false };
}
async function readProjectionCompressed(userId, module, contextHash) {
  if (!MODULES.has(module)) return null;
  const started = Date.now(), candidates = loadManifestCandidates(userId);
  for (let index = 0; index < candidates.length; index += 1) {
    const manifest = candidates[index];
    if (String(manifest.contextHash || '') !== String(contextHash || '')) continue;
    const meta = manifest.modules && manifest.modules[module];
    if (!meta) continue;
    const file = modulePath(userId, manifest.activeGeneration, module);
    try {
      const result = await readCompressed(file, meta.checksum || '');
      return { ...result, manifest, module, meta, hit: true, fallback: index > 0, ms: Date.now() - started, bytes: result.buffer.length };
    } catch (_) { /* same-context fallback */ }
  }
  return null;
}
async function readProjection(userId, module, contextHash) {
  const compressed = await readProjectionCompressed(userId, module, contextHash);
  if (!compressed) return null;
  const inflateStarted = Date.now(), raw = await gunzip(compressed.buffer);
  const parseStarted = Date.now(), data = JSON.parse(raw.toString('utf8'));
  return {
    ...compressed, data, ms: compressed.ms + (Date.now() - inflateStarted),
    decompressMs: parseStarted - inflateStarted, parseMs: Date.now() - parseStarted,
  };
}
async function decodeProjection(buffer){return JSON.parse((await gunzip(buffer)).toString('utf8'));}
async function readReusableProjections(userId,contextHash,moduleInputKeys={}) {
  const manifest=loadManifest(userId),projections={};
  if(!manifest||String(manifest.contextHash)!==String(contextHash))return {manifest,projections};
  for(const [module,key] of Object.entries(moduleInputKeys)){
    const meta=manifest.modules?.[module];
    if(!MODULES.has(module)||!key||manifest.moduleInputKeys?.[module]!==key||!meta?.checksum)continue;
    try{
      const {buffer}=await readCompressed(modulePath(userId,manifest.activeGeneration,module),meta.checksum);
      projections[module]={buffer,uncompressedBytes:meta.uncompressedBytes};
    }catch(_){/* Missing/corrupt bytes must be rebuilt from authoritative data. */}
  }
  return {manifest,projections};
}
async function reuseGeneration(userId,{contextHash,generation,moduleInputKeys={},sourceLoadedAt=null,extra={},assertCurrent}={}){
  return enqueueUserMutation(userId,async()=>{
    assertCurrent?.();
    const checked=await readReusableProjections(userId,contextHash,moduleInputKeys),manifest=checked.manifest;
    assertCurrent?.();
    if(!manifest||manifest.activeGeneration!==generation||Object.keys(checked.projections).length!==Object.keys(moduleInputKeys).length)return null;
    const next={...manifest,...extra,sourceLoadedAt,moduleInputKeys};
    if(manifest.backlogInputKey!==next.backlogInputKey)next.backlogVariants={};
    await saveManifest(userId,next);assertCurrent?.();return next;
  });
}
async function writeGenerationUnlocked(userId, { contextHash, sourceLoadedAt = null, projections = {}, reused = {}, extra = {}, previous = null } = {}) {
    const id = generationId();
    const root = generationRoot(userId, id);
    await fs.promises.mkdir(root, { recursive: true });
    const modules = {};
    try {
      for (const module of MODULES) {
        if (Object.prototype.hasOwnProperty.call(projections, module))modules[module] = await writeJsonGzip(modulePath(userId, id, module), projections[module]);
        else if(reused[module]){
          const entry=reused[module],buffer=Buffer.from(entry.buffer);
          await atomicWrite(modulePath(userId,id,module),buffer);
          modules[module]={bytes:buffer.length,uncompressedBytes:entry.uncompressedBytes,checksum:checksum(buffer)};
        }
      }
      const manifest = {
        schemaVersion: CACHE_SCHEMA_VERSION,
        activeGeneration: id,
        previousGeneration: previous && previous.activeGeneration || null,
        contextHash: String(contextHash || ''),
        sourceLoadedAt,
        createdAt: new Date().toISOString(),
        modules,
        backlogVariants: {},
        ...extra,
      };
      await saveManifest(userId, manifest);
      await cleanupGenerations(userId, new Set([id, manifest.previousGeneration].filter(Boolean)));
      return manifest;
    } catch (error) {
      try { await fs.promises.rm(root, { recursive: true, force: true }); } catch (_) {}
      throw error;
    }
}
async function writeGeneration(userId, { contextHash, sourceLoadedAt = null, projections = {}, reused = {}, extra = {} } = {}) {
  const moduleKey = Object.keys({...reused,...projections}).sort().join(',');
  const inputKey=checksum(Buffer.from(JSON.stringify([sourceLoadedAt,extra.moduleInputKeys||null])));
  return singleFlight(`generation:${safeUserId(userId)}:${contextHash}:${moduleKey}:${inputKey}`, () => enqueueUserMutation(userId, async () => {
    return writeGenerationUnlocked(userId, { contextHash, sourceLoadedAt, projections, reused, extra, previous:loadManifest(userId) });
  }));
}
async function writeCompressedGeneration(userId,{contextHash,sourceLoadedAt=null,projections={},extra={},assertCurrent,mergePrevious=false}={}){
  const moduleKey=Object.keys(projections).sort().join(',');
  const schemaCandidates=schemaBindings.snapshotPrepared(extra.moduleSchemas);
  const inputKey=checksum(Buffer.from(JSON.stringify([sourceLoadedAt,extra.moduleInputKeys||null,extra.sourceProjectionKeys||null,schemaBindings.preparedKey(schemaCandidates)])));
  return singleFlight(`compressed-generation:${safeUserId(userId)}:${contextHash}:${moduleKey}:${inputKey}`,()=>enqueueUserMutation(userId,async()=>{
    assertCurrent?.();
    const previous=loadManifest(userId),id=generationId(),root=generationRoot(userId,id),modules={};let committed=false;
    await fs.promises.mkdir(root,{recursive:true});
    try{
      const inherit=mergePrevious&&previous&&String(previous.contextHash||'')===String(contextHash||'')
        &&String(previous.sourceLoadedAt||'')===String(sourceLoadedAt||'')&&String(previous.sourceRevisionKey||'')===String(extra.sourceRevisionKey||'');
      for(const module of MODULES){
        if(!Object.prototype.hasOwnProperty.call(projections,module)){
          if(inherit&&previous.modules?.[module]&&(!extra.sourceProjectionKeys||previous.sourceProjectionKeys?.[module]===extra.sourceProjectionKeys[module])){
            try{await fs.promises.copyFile(modulePath(userId,previous.activeGeneration,module),modulePath(userId,id,module));modules[module]={...previous.modules[module]};}
            catch(error){if(error.code!=='ENOENT')throw error;}
          }
          continue;
        }
        const entry=projections[module]||{},buffer=Buffer.isBuffer(entry.buffer)?entry.buffer:Buffer.from(entry.buffer||[]);
        if(!buffer.length)throw new Error(`${module} sıkıştırılmış projection buffer'ı boş.`);
        const file=modulePath(userId,id,module);await atomicWrite(file,buffer);lruForgetFile(file);
        modules[module]={bytes:buffer.length,uncompressedBytes:Number(entry.uncompressedBytes)||0,checksum:checksum(buffer)};
      }
      const manifest={schemaVersion:CACHE_SCHEMA_VERSION,activeGeneration:id,previousGeneration:previous&&previous.activeGeneration||null,contextHash:String(contextHash||''),sourceLoadedAt,createdAt:new Date().toISOString(),modules,backlogVariants:{},...extra};
      manifest.moduleSchemas=schemaBindings.bindCommitted(manifest,schemaCandidates,String(userId));
      assertCurrent?.();await saveManifest(userId,manifest,true);committed=true;assertCurrent?.();await cleanupGenerations(userId,new Set([id,manifest.previousGeneration].filter(Boolean)));return manifest;
    }catch(error){if(!committed){try{await fs.promises.rm(root,{recursive:true,force:true});}catch(_){}}throw error;}
  }));
}

// Küçük bir row-level değişiklikte ham snapshot'ı tekrar açıp tüm projection
// formüllerini çalıştırmak yerine mevcut doğrulanmış generation'ı dönüştürür.
// Okuma, dönüşüm ve atomik generation switch aynı kullanıcı mutation kuyruğunda
// kalır; refresh ile yarışırsa yarım manifest yayımlanmaz.
async function rewriteGeneration(userId, { fromContextHash, toContextHash, transform } = {}) {
  if (typeof transform !== 'function') throw new TypeError('transform fonksiyonu zorunludur.');
  return singleFlight(`rewrite:${safeUserId(userId)}:${fromContextHash}:${toContextHash}`, () => enqueueUserMutation(userId, async () => {
    const previous = loadManifest(userId);
    if (!previous || String(previous.contextHash || '') !== String(fromContextHash || '')) return null;
    const projections = {};
    for (const module of MODULES) {
      const meta = previous.modules && previous.modules[module];
      if (!meta) continue;
      const loaded = await readJsonGzip(modulePath(userId, previous.activeGeneration, module), meta.checksum || '');
      const transformed = await transform(module, loaded.data);
      projections[module] = transformed === undefined ? loaded.data : transformed;
    }
    if (!Object.keys(projections).length) return null;
    return writeGenerationUnlocked(userId, {
      contextHash:toContextHash,
      sourceLoadedAt:previous.sourceLoadedAt || null,
      projections,
      extra:{ runtimeMeta:previous.runtimeMeta || {},sourceRevisionKey:previous.sourceRevisionKey||null },
      previous,
    });
  }));
}
async function cleanupGenerations(userId, keep) {
  const dir = userRoot(userId);
  let entries = [];
  try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); } catch (_) { return; }
  for (const entry of entries) {
    if (!entry.isDirectory() || keep.has(entry.name)) continue;
    try { await fs.promises.rm(path.join(dir, entry.name), { recursive: true, force: true }); } catch (_) {}
  }
  // Interrupted atomic writes are never valid cache entries.
  try {
    const files = await fs.promises.readdir(dir);
    await Promise.all(files.filter(name => name.endsWith('.tmp')).map(name => fs.promises.rm(path.join(dir, name), { force: true }).catch(() => {})));
  } catch (_) {}
}
async function writeProjection(userId, module, contextHash, value) {
  if (!MODULES.has(module)) return null;
  return singleFlight(`projection:${safeUserId(userId)}:${contextHash}:${module}`, () => enqueueUserMutation(userId, async () => {
    const manifest = loadManifest(userId);
    if (!manifest || String(manifest.contextHash || '') !== String(contextHash || '')) return null;
    const meta = await writeJsonGzip(modulePath(userId, manifest.activeGeneration, module), value);
    manifest.modules = manifest.modules || {};
    manifest.modules[module] = meta;
    manifest.moduleSchemas = schemaBindings.drop(manifest.moduleSchemas, module);
    await saveManifest(userId, manifest);
    return meta;
  }));
}

// These APIs receive trusted producer bytes/metadata after the existing HTTP/worker guards.
// A plan hash is a cache selector, never an authorization token or a caller-selected path.
function viewData(value) {
  if (!value || typeof value !== 'object' || types.isProxy(value) || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return false;
  return Reflect.ownKeys(value).every(key => { const d = Object.getOwnPropertyDescriptor(value, key);
    return typeof key === 'string' && d.enumerable && Object.hasOwn(d, 'value'); });
}
function viewPin(input) {
  if (!viewData(input) || Object.keys(input).length !== VIEW_PIN_KEYS.length) return null;
  const pin = {};
  for (const key of VIEW_PIN_KEYS) {
    const value = input[key]; if (typeof value !== 'string' || !value.length || value.length > 4096) return null;
    pin[key] = value;
  }
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(pin.generation) || !/^[a-f0-9]{64}$/.test(pin.planHash)
    || !/^[a-f0-9]{64}$/.test(pin.fullChecksum)) return null;
  return Object.freeze(pin);
}
function sameViewPin(a, b) { return a && b && VIEW_PIN_KEYS.every(key => a[key] === b[key]); }
function primaryViewMatches(manifest, module, pin) {
  return module === 'orders' && manifest && manifest.activeGeneration === pin.generation && manifest.contextHash === pin.contextHash
    && manifest.moduleInputKeys?.[module] === pin.moduleInputKey && manifest.sourceProjectionKeys?.[module] === pin.sourceProjectionKey
    && manifest.modules?.[module]?.checksum === pin.fullChecksum && manifest.sourceRevisionKey === pin.sourceRevisionKey;
}
function viewKeys(value, maximum = VIEW_LIMITS.maxRegistryKeys) {
  if (!Array.isArray(value) || types.isProxy(value) || value.length > maximum || Reflect.ownKeys(value).length !== value.length + 1) return null;
  const result = [];
  for (let i = 0; i < value.length; i++) { const d = Object.getOwnPropertyDescriptor(value, String(i));
    if (!d || !Object.hasOwn(d, 'value') || typeof d.value !== 'string' || !d.value.length || d.value.length > 512) return null;
    result.push(d.value); }
  return new Set(result).size === result.length ? result : null;
}
// Opaque producer descriptor, not a field registry or authorization proof. Never call user JSON hooks.
function viewInfoSnapshot(input, maximum = VIEW_LIMITS.maxMetadataBytes) {
  try {
    if (!viewData(input) || Object.getOwnPropertyDescriptor(Object.prototype, 'toJSON')
      || Object.getOwnPropertyDescriptor(Array.prototype, 'toJSON')) return null;
    const ancestors = new WeakSet(); let bytes = 0, nodes = 0;
    const charge = size => { bytes += size; if (bytes > maximum) throw new Error('VIEW_INFO_LIMIT'); };
    const text = value => {
      if (value.length > maximum) throw new Error('VIEW_INFO_LIMIT');
      const json = JSON.stringify(value); charge(Buffer.byteLength(json)); return json;
    };
    function copy(value, depth = 0) {
      if (++nodes > 16384 || depth > 24) throw new Error('VIEW_INFO_LIMIT');
      if (value === null) { charge(4); return null; }
      if (typeof value === 'boolean') { charge(value ? 4 : 5); return value; }
      if (typeof value === 'string') { text(value); return value; }
      if (typeof value === 'number' && Number.isFinite(value)) { charge(JSON.stringify(value).length); return value === 0 ? 0 : value; }
      if (!value || typeof value !== 'object' || types.isProxy(value) || ancestors.has(value)) throw new Error('VIEW_INFO_DATA_ONLY');
      const array = Array.isArray(value);
      if (array ? Object.getPrototypeOf(value) !== Array.prototype || value.length > 16384 : !viewData(value)) throw new Error('VIEW_INFO_DATA_ONLY');
      const keys = Reflect.ownKeys(value);
      if (keys.length > 16385 || array && keys.length !== value.length + 1) throw new Error('VIEW_INFO_DATA_ONLY');
      ancestors.add(value); charge(2); const result = array ? [] : {}; let count = 0;
      try { for (const key of keys) {
        if (array && key === 'length') continue;
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (typeof key !== 'string' || !descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')
          || array && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length)) throw new Error('VIEW_INFO_DATA_ONLY');
        if (count++) charge(1); if (!array) { text(key); charge(1); }
        Object.defineProperty(result, key, { value: copy(descriptor.value, depth + 1), enumerable: true, writable: true, configurable: true });
      } } finally { ancestors.delete(value); }
      return result;
    }
    const value = copy(input), json = JSON.stringify(value);
    return Buffer.byteLength(json) <= maximum ? { value, json } : null;
  } catch (_) { return null; }
}
function viewInfoChecksum(userId, module, pin, digest, json) {
  return checksum(Buffer.from(JSON.stringify(['buyerlog-ready-view-info-v1', userId, module,
    ...VIEW_PIN_KEYS.map(key => pin[key]), digest, json])));
}
function viewMetaValid(meta, userId, module, pin) {
  if (!viewData(meta)) return false;
  const hasInfo = Object.hasOwn(meta, 'info') || Object.hasOwn(meta, 'infoChecksum');
  if (hasInfo) {
    const info = viewInfoSnapshot(meta.info);
    if (!info || typeof meta.infoChecksum !== 'string' || !/^[a-f0-9]{64}$/.test(meta.infoChecksum)
      || !pin || viewInfoChecksum(userId, module, pin, meta.checksum, info.json) !== meta.infoChecksum) return false;
  }
  return Object.keys(meta).length === (hasInfo ? 12 : 10) && meta.schemaVersion === 1 && meta.profile === 'cp-orders-private-view-v1'
    && meta.ownerId === userId && meta.module === module && sameViewPin(viewPin(meta.pin), pin)
    && Number.isSafeInteger(meta.bytes) && meta.bytes > 0 && meta.bytes <= VIEW_LIMITS.maxCompressedBytes
    && Number.isSafeInteger(meta.uncompressedBytes) && meta.uncompressedBytes > 0 && meta.uncompressedBytes <= VIEW_LIMITS.maxRawBytes
    && typeof meta.checksum === 'string' && /^[a-f0-9]{64}$/.test(meta.checksum) && viewKeys(meta.registryKeys) !== null
    && typeof meta.createdAt === 'string' && Number.isFinite(Date.parse(meta.createdAt));
}
function viewFile(userId, module, pin, digest) {
  const binding = checksum(Buffer.from(JSON.stringify([userId, module, ...VIEW_PIN_KEYS.map(key => pin[key]), digest])));
  return path.join(generationRoot(userId, pin.generation), `orders-view-${pin.planHash}-${binding}.json.gz`);
}
function viewLimits(input = {}) {
  if (!viewData(input) || Object.keys(input).some(key => !Object.hasOwn(VIEW_LIMITS, key))) return null;
  const limits = { ...VIEW_LIMITS, ...input };
  return Object.keys(VIEW_LIMITS).every(key => Number.isSafeInteger(limits[key]) && limits[key] > 0 && limits[key] <= VIEW_LIMITS[key]) ? limits : null;
}
function viewGzip(buffer, rawBytes) {
  // Trusted worker supplies a single gzip member. This is a cheap envelope/ISIZE check, not inflation or JSON validation.
  return buffer.length >= 18 && buffer[0] === 0x1f && buffer[1] === 0x8b && buffer[2] === 8
    && buffer.readUInt32LE(buffer.length - 4) === rawBytes;
}
// New derived path only: strict rename, no copy fallback and no fsync durability claim.
async function writeViewFile(file, buffer, guard) {
  const temporary = `${file}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  try { await fs.promises.writeFile(temporary, buffer, { flag: 'wx', mode: 0o600 });
    const written = await fs.promises.readFile(temporary);
    if (written.length !== buffer.length || checksum(written) !== checksum(buffer) || !guard()) return false;
    await fs.promises.rename(temporary, file); return true;
  } finally { try { await fs.promises.unlink(temporary); } catch (_) {} }
}
async function pruneViewFiles(userId, keep) {
  // Only our hash-named derived files; never canonical projections/manifests or arbitrary caller paths.
  for (const generation of await fs.promises.readdir(userRoot(userId), { withFileTypes: true })) {
    if (!generation.isDirectory() || !/^[A-Za-z0-9_-]{1,100}$/.test(generation.name)) continue;
    const dir = generationRoot(userId, generation.name);
    for (const item of await fs.promises.readdir(dir, { withFileTypes: true })) {
      if (!item.isFile() || !/^orders-view-[a-f0-9]{64}-[a-f0-9]{64}\.json\.gz(?:\.\d+\.[a-f0-9]{12}\.tmp)?$/.test(item.name)) continue;
      const file = path.join(dir, item.name); if (keep.has(file)) continue;
      lruForgetFile(file); await fs.promises.unlink(file);
    }
  }
}
async function readViewCompressed(userId, module, request, options = {}) {
  const pin = viewPin(request);
  if (typeof userId !== 'string' || !userId.length || userId.length > 512 || module !== 'orders' || !pin
    || !viewData(options) || Object.keys(options).some(key => !['requireInfo', 'infoChecksum'].includes(key))
    || Object.hasOwn(options, 'requireInfo') && typeof options.requireInfo !== 'boolean'
    || Object.hasOwn(options, 'infoChecksum') && (typeof options.infoChecksum !== 'string' || !/^[a-f0-9]{64}$/.test(options.infoChecksum))) return null;
  const requireInfo = options.requireInfo === true || Object.hasOwn(options, 'infoChecksum'), expectedInfo = options.infoChecksum;
  return enqueueUserMutation(userId, async () => {
    try {
      const manifest = loadManifestFile(manifestPath(userId));
      if (!primaryViewMatches(manifest, module, pin)) return null;
      const catalog = manifest.derivedViews?.[module], meta = catalog?.[pin.planHash];
      if (!viewData(catalog) || Object.keys(catalog).length > VIEW_LIMITS.maxEntries
        || Buffer.byteLength(JSON.stringify(catalog)) > VIEW_LIMITS.maxMetadataBytes || !viewMetaValid(meta, userId, module, pin)) return null;
      if ((requireInfo && !Object.hasOwn(meta, 'info')) || (expectedInfo && meta.infoChecksum !== expectedInfo)) return null;
      let total = 0;
      for (const [key, entry] of Object.entries(catalog)) {
        if (!viewMetaValid(entry, userId, module, viewPin(entry?.pin)) || key !== entry.pin.planHash
          || !primaryViewMatches(manifest, module, entry.pin)) return null;
        total += entry.bytes;
      }
      if (total > VIEW_LIMITS.maxCompressedBytes) return null;
      const file = viewFile(userId, module, pin, meta.checksum), stat = await fs.promises.lstat(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== meta.bytes) return null;
      const result = await readCompressed(file, meta.checksum);
      if (result.buffer.length !== meta.bytes || checksum(result.buffer) !== meta.checksum
        || !viewGzip(result.buffer, meta.uncompressedBytes)) { lruForgetFile(file); return null; }
      const current = loadManifestFile(manifestPath(userId)), latest = current?.derivedViews?.[module]?.[pin.planHash];
      if (!primaryViewMatches(current, module, pin) || !viewMetaValid(latest, userId, module, pin)
        || JSON.stringify(latest) !== JSON.stringify(meta)) return null;
      const info = Object.hasOwn(latest, 'info') ? viewInfoSnapshot(latest.info) : null;
      return { ...result, manifest: current, module, meta: latest, hit: true, fallback: false, bytes: result.buffer.length,
        ...(info ? { info: info.value, infoChecksum: latest.infoChecksum } : {}) };
    } catch (_) { return null; } // optional data never falls back to a previous generation or triggers a rebuild
  });
}
async function writeViewCompressed(userId, module, request, entry, options = {}) {
  const pin = viewPin(request);
  const hasInfo = viewData(entry) && Object.hasOwn(entry, 'info');
  if (typeof userId !== 'string' || !userId.length || userId.length > 512 || module !== 'orders' || !pin || !viewData(entry)
    || Object.keys(entry).length !== (hasInfo ? 6 : 5) || !['buffer','bytes','uncompressedBytes','checksum','registryKeys'].every(key => Object.hasOwn(entry, key))
    || !viewData(options) || Object.keys(options).some(key => !['limits','assertCurrent'].includes(key))
    || Object.hasOwn(options, 'assertCurrent') && typeof options.assertCurrent !== 'function') return null;
  const limits = viewLimits(options.limits); if (!limits) return null;
  const assertCurrent = options.assertCurrent; // Own callback captured before queueing.
  const info = hasInfo ? viewInfoSnapshot(entry.info, limits.maxMetadataBytes) : null;
  if (hasInfo && !info) return null;
  const registryKeys = viewKeys(entry.registryKeys, limits.maxRegistryKeys);
  if (!registryKeys || !Buffer.isBuffer(entry.buffer) || types.isProxy(entry.buffer)
    || entry.buffer.length <= 0 || entry.buffer.length > limits.maxCompressedBytes || entry.bytes !== entry.buffer.length
    || !Number.isSafeInteger(entry.uncompressedBytes) || entry.uncompressedBytes <= 0 || entry.uncompressedBytes > limits.maxRawBytes
    || typeof entry.checksum !== 'string' || !/^[a-f0-9]{64}$/.test(entry.checksum) || checksum(entry.buffer) !== entry.checksum
    || !viewGzip(entry.buffer, entry.uncompressedBytes)) return null;
  // Bounded compressed copy protects the queued operation from caller mutation; no row graph is copied.
  const buffer = Buffer.from(entry.buffer), meta = { schemaVersion: 1, profile: 'cp-orders-private-view-v1', ownerId: userId, module,
    pin, bytes: buffer.length, uncompressedBytes: entry.uncompressedBytes, checksum: entry.checksum,
    registryKeys, createdAt: new Date().toISOString(),
    ...(info ? { info: info.value, infoChecksum: viewInfoChecksum(userId, module, pin, entry.checksum, info.json) } : {}) };
  if (Buffer.byteLength(JSON.stringify({ [pin.planHash]: meta })) > limits.maxMetadataBytes) return null;
  return enqueueUserMutation(userId, async () => {
    let file, committed = false;
    try {
      const current = () => loadManifestFile(manifestPath(userId));
      const guard = () => {
        const result = assertCurrent?.();
        if (result === false) return false;
        if (result && typeof result.then === 'function') {
          // Reject asynchronous authority. Drain its invalid return value only;
          // neither fulfillment nor rejection can authorize publication.
          void Promise.resolve(result).catch(() => {});
          return false;
        }
        return primaryViewMatches(current(), module, pin);
      };
      if (!guard()) return null;
      const manifest = current(); if (!primaryViewMatches(manifest, module, pin)) return null;
      const prior = manifest.derivedViews?.[module], catalog = {};
      if (viewData(prior) && Object.keys(prior).length <= VIEW_LIMITS.maxEntries
        && Buffer.byteLength(JSON.stringify(prior)) <= VIEW_LIMITS.maxMetadataBytes) for (const [key, old] of Object.entries(prior)) {
        const oldPin = viewPin(old?.pin);
        if (key !== pin.planHash && oldPin && key === oldPin.planHash && primaryViewMatches(manifest, module, oldPin)
          && viewMetaValid(old, userId, module, oldPin)) {
          try { const stat = await fs.promises.lstat(viewFile(userId, module, oldPin, old.checksum));
            if (stat.isFile() && !stat.isSymbolicLink() && stat.size === old.bytes) catalog[key] = old;
          } catch (_) { /* Missing optional old entry is not a reason to rebuild or reuse its bytes. */ }
        }
      }
      catalog[pin.planHash] = meta;
      while (Object.keys(catalog).length > limits.maxEntries || Object.values(catalog).reduce((n, value) => n + value.bytes, 0) > limits.maxCompressedBytes
        || Buffer.byteLength(JSON.stringify(catalog)) > limits.maxMetadataBytes) {
        const oldest = Object.keys(catalog).find(key => key !== pin.planHash); if (!oldest) return null; delete catalog[oldest];
      }
      file = viewFile(userId, module, pin, meta.checksum);
      // Evict optional files before admitting new bytes. Returned read buffers remain valid, with no open-file lease.
      await pruneViewFiles(userId, new Set(Object.values(catalog).filter(value => value !== meta)
        .map(value => viewFile(userId, module, value.pin, value.checksum))));
      if (!guard() || !await writeViewFile(file, buffer, guard)) return null;
      lruForgetFile(file);
      const verified = await readCompressed(file, meta.checksum);
      if (verified.buffer.length !== meta.bytes || checksum(verified.buffer) !== meta.checksum || !guard()) return null;
      const fresh = current(); if (!guard() || !primaryViewMatches(fresh, module, pin)) return null;
      const next = { ...fresh, derivedViews: { ...(fresh.derivedViews || {}), [module]: catalog } };
      if (!await writeViewFile(manifestPath(userId), Buffer.from(JSON.stringify(next, null, 2)), guard)) return null;
      committed = true; return meta; // activeGeneration and .bak are unchanged
    } catch (_) { return null; }
    finally { if (file && !committed) { lruForgetFile(file); try { await fs.promises.unlink(file); } catch (_) {} } }
  });
}

async function readBacklog(userId, contextHash, key) {
  const candidates = loadManifestCandidates(userId);
  for (let index = 0; index < candidates.length; index += 1) {
    const manifest = candidates[index];
    if (String(manifest.contextHash || '') !== String(contextHash || '')) continue;
    // A previous manifest may only supply variants for the current Backlog input.
    if(manifest.backlogInputKey!==candidates[0].backlogInputKey)continue;
    const meta = manifest.backlogVariants && manifest.backlogVariants[key];
    if (!meta) continue;
    try {
      const result = await readJsonGzip(backlogPath(userId, manifest.activeGeneration, key), meta.checksum || '');
      // Yalnız aktif manifest üzerinde LRU touch yap; fallback manifest'i tekrar aktif
      // hale getirmeye çalışma.
      if (index === 0) {
        enqueueUserMutation(userId,async()=>{
          const current=loadManifest(userId);
          if(current?.activeGeneration!==manifest.activeGeneration||current.backlogInputKey!==manifest.backlogInputKey||!current.backlogVariants?.[key])return;
          current.backlogVariants[key].lastAccessAt=new Date().toISOString();
          await saveManifest(userId,current);
        }).catch(() => {});
      }
      return { ...result, manifest, hit: true, fallback: index > 0 };
    } catch (_) { /* aynı context'teki önceki varyantı dene */ }
  }
  return null;
}
async function writeBacklog(userId, contextHash, key, value) {
  return singleFlight(`backlog:${safeUserId(userId)}:${contextHash}:${key}`, () => enqueueUserMutation(userId, async () => {
    const manifest = loadManifest(userId);
    if (!manifest || String(manifest.contextHash || '') !== String(contextHash || '')) return null;
    const meta = await writeJsonGzip(backlogPath(userId, manifest.activeGeneration, key), value);
    manifest.backlogVariants = manifest.backlogVariants || {};
    manifest.backlogVariants[key] = { ...meta, lastAccessAt: new Date().toISOString() };
    const entries = Object.entries(manifest.backlogVariants).sort((a, b) => Date.parse(b[1].lastAccessAt || 0) - Date.parse(a[1].lastAccessAt || 0));
    for (const [oldKey] of entries.slice(BACKLOG_MAX_VARIANTS)) {
      delete manifest.backlogVariants[oldKey];
      try { await fs.promises.unlink(backlogPath(userId, manifest.activeGeneration, oldKey)); } catch (_) {}
    }
    await saveManifest(userId, manifest);
    return meta;
  }));
}
function readCurrentModuleSchema(userId, module, contextHash, cached) {
  const primary = loadManifestFile(manifestPath(userId));
  if (!primary || primary.contextHash !== contextHash) return null;
  return schemaBindings.readCurrent({ ownerId: String(userId), module, manifest: primary, cached });
}
function invalidate(userId) {
  const prefix = userRoot(userId) + path.sep;
  for (const [key, entry] of compressedLru) {
    if (entry.file.startsWith(prefix)) { compressedLru.delete(key); compressedLruBytes -= entry.buffer.length; }
  }
  try { fs.rmSync(userRoot(userId), { recursive: true, force: true }); } catch (_) {}
}
/* v10.90 — Toplu bakım için önbelleği olan bütün kullanıcılar. Sayfa
   projeksiyonu satırları _imageRef/_imageUrl'i GÖMÜLÜ taşır; tam görsel
   sıfırlaması bu kopyaları da düşürmezse yeniden başlatmadan sonra silinmiş
   referanslar önbellekten geri gelir. */
function listCachedUserIds() {
  try { return fs.readdirSync(ROOT, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name); }
  catch (_) { return []; }
}
function invalidateAll() {
  const users = listCachedUserIds();
  for (const userId of users) invalidate(userId);
  return users.length;
}
function listSnapshotUserIds(snapshotRoot) {
  try { return fs.readdirSync(snapshotRoot).filter(name => name.endsWith('.json.gz')).map(name => name.slice(0, -8)); } catch (_) { return []; }
}

module.exports = {
  ROOT, CACHE_SCHEMA_VERSION, BACKLOG_MAX_VARIANTS, safeUserId, manifestPath, loadManifest,
  MEMORY_MAX_ENTRIES, MEMORY_MAX_BYTES, VIEW_LIMITS, readViewCompressed, writeViewCompressed,
  prepareModuleSchemas: schemaBindings.prepare, readCurrentModuleSchema,
  readProjection, readProjectionCompressed, decodeProjection, readReusableProjections, reuseGeneration, writeProjection, writeGeneration, writeCompressedGeneration, rewriteGeneration, readBacklog, writeBacklog, invalidate, invalidateAll, listCachedUserIds, listSnapshotUserIds,
};
