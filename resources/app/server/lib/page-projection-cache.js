'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const { promisify } = require('util');
const { LOCAL_DATA_ROOT } = require('../user-data');
const { stringifyWithDates } = require('./json-dates');

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);
// v2: CP/Orders lojistik segmentleri parsiyel kimliği (dosya/konteyner/gemi) taşır.
const CACHE_SCHEMA_VERSION = 2;
const ROOT = path.join(LOCAL_DATA_ROOT, 'page-cache');
// order-summary: CP tabanlı sipariş özeti. Siparişler ekranı okumaz; orders
// projeksiyonuna gömülüyken her ilk girişte ~%35 fazla veri indiriliyordu.
const MODULES = new Set(['cp', 'overview', 'orders', 'order-summary', 'collection-catalog']);
const BACKLOG_MAX_VARIANTS = 8;
const MEMORY_MAX_ENTRIES = Math.max(2, Number(process.env.BL_PAGE_CACHE_MEMORY_ITEMS) || 12);
const MEMORY_MAX_BYTES = Math.max(4 * 1024 * 1024, Number(process.env.BL_PAGE_CACHE_MEMORY_BYTES) || 48 * 1024 * 1024);
const compressedLru = new Map();
const singleFlights = new Map();
const userMutationTails = new Map();
// Row-level rewrites run after the write is acknowledged. A projection read for
// that user waits for them so a fresh context never becomes a cache miss.
const pendingRewrites = new Map();
async function pendingRewritesSettled(userId) {
  const pending = pendingRewrites.get(safeUserId(userId));
  if (pending && pending.size) await Promise.allSettled([...pending]);
}
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
// Kullanıcı başına mutasyon sıra numarası: satır yaması yeniden yazımları yalnız kuyrukta
// ARDIŞIK oldukları (araya başka mutasyon girmediği) sürece birleştirilir (rewriteRowPatches).
const userMutationSeq = new Map();
function enqueueUserMutation(userId, task) {
  const key = safeUserId(userId), previous = userMutationTails.get(key) || Promise.resolve();
  userMutationSeq.set(key, (userMutationSeq.get(key) || 0) + 1);
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
async function saveManifest(userId, manifest) {
  const file = manifestPath(userId);
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  // .bak gerçek bir önceki başarılı generation'ı temsil eder. Aynı aktif generation
  // üzerinde LRU touch veya tek-modül patch yapılırken backup'ı mevcut manifest ile
  // ezmek fallback'i yok ederdi; yalnız generation değişirken primary'yi yedekle.
  try {
    const current = loadManifestFile(file);
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
  await pendingRewritesSettled(userId);
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
  const inputKey=checksum(Buffer.from(JSON.stringify([sourceLoadedAt,extra.moduleInputKeys||null,extra.sourceProjectionKeys||null])));
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
      assertCurrent?.();await saveManifest(userId,manifest);committed=true;assertCurrent?.();await cleanupGenerations(userId,new Set([id,manifest.previousGeneration].filter(Boolean)));return manifest;
    }catch(error){if(!committed){try{await fs.promises.rm(root,{recursive:true,force:true});}catch(_){}}throw error;}
  }));
}

// Küçük bir row-level değişiklikte ham snapshot'ı tekrar açıp tüm projection
// formüllerini çalıştırmak yerine mevcut doğrulanmış generation'ı dönüştürür.
// Okuma, dönüşüm ve atomik generation switch aynı kullanıcı mutation kuyruğunda
// kalır; refresh ile yarışırsa yarım manifest yayımlanmaz.
async function rewriteGeneration(userId, { fromContextHash, toContextHash, transform } = {}) {
  if (typeof transform !== 'function') throw new TypeError('transform fonksiyonu zorunludur.');
  const key = safeUserId(userId), pending = pendingRewrites.get(key) || new Set();
  pendingRewrites.set(key, pending);
  const promise = singleFlight(`rewrite:${safeUserId(userId)}:${fromContextHash}:${toContextHash}`, () => enqueueUserMutation(userId, async () => {
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
  pending.add(promise);
  promise.catch(() => {}).finally(() => { pending.delete(promise); if (!pending.size && pendingRewrites.get(key) === pending) pendingRewrites.delete(key); });
  return promise;
}
/* Satır yaması yeniden yazımı (#1078 takip / WS7b). rewriteGeneration(transform) ile aynı sonucu
   üretir; farkları:
   - Ağır iş (gunzip → parse → yama → stringify → gzip) projection-rewrite işçisinde çalışır. Ana
     iş parçacığında yalnız dosya okuma, atomik yazım ve manifest değişimi kalır. İşçi kapalıysa
     (BL_PROJECTION_REWRITE_WORKER=0) veya hata verirse aynı çekirdek ana iş parçacığında çalışır.
   - Hiç satırı eşleşmeyen modülün önceki baytları aynen taşınır.
   - Aynı kullanıcının kuyrukta ARDIŞIK bekleyen satır yaması yeniden yazımları, bağlam zinciri
     kesintisizse (sonraki.from === önceki.to) tek okuma/yazımda sırayla uygulanır. Araya giren her
     mutasyon (yenileme, görsel yaması, modül/backlog yazımı) zinciri keser.
   step: { items:[{orderCode,patch}], context:rowPatchContext(...), collectCpRows }
   Dönen: { manifest, cpRows } | null (bağlam eşleşmedi / modül yok). */
const ROW_REWRITE_MAX_BATCH = 64;
const rowRewriteQueues = new Map();
let rowRewriteRunner = null;
function setRowRewriteRunnerForTests(fn) { rowRewriteRunner = fn; }
/* Modülleri en çok `parts` gruba böler (büyükten küçüğe, en hafif gruba): her grup ayrı işçide
   çalışır; duvar süresi yaklaşık en büyük modülün süresidir. Modüller birbirinden bağımsızdır
   (adımlar modül başına uygulanır), sonuç bölmeden bağımsızdır. */
function splitRewriteModules(modules, parts, sizeOf) {
  const groups = Array.from({ length: Math.max(1, Math.min(parts, modules.length)) }, () => ({ bytes: 0, modules: [] }));
  for (const entry of modules.slice().sort((a, b) => sizeOf(b) - sizeOf(a))) {
    const target = groups.reduce((min, group) => (group.bytes < min.bytes ? group : min), groups[0]);
    target.modules.push(entry); target.bytes += sizeOf(entry);
  }
  return groups.filter(group => group.modules.length).map(group => group.modules);
}
function mergeRewriteParts(parts, stepCount) {
  const out = { modules: [], cpRowsBySteps: Array.from({ length: stepCount }, () => null), timings: { parts: parts.length, perPart: [] } };
  for (const part of parts) {
    out.modules.push(...part.modules);
    (part.cpRowsBySteps || []).forEach((rows, index) => { if (rows) out.cpRowsBySteps[index] = rows; });
    out.timings.perPart.push(part.timings || null);
  }
  return out;
}
async function runRowRewriteSteps(modules, steps, sizeOf = entry => entry.buffer.length) {
  const pool = require('./projection-rewrite-pool');
  const shared = !rowRewriteRunner && pool.workerEnabled() ? pool.getProjectionRewritePool() : null;
  const runner = rowRewriteRunner || (shared ? input => shared.run(input) : null);
  if (runner) {
    try {
      const groups = splitRewriteModules(modules, rowRewriteRunner ? (rowRewriteRunner.parallelism || 1) : shared.parallelism, sizeOf);
      const parts = await Promise.all(groups.map(group => runner({ modules: group, steps })));
      return { ...mergeRewriteParts(parts, steps.length), via: 'worker' };
    } catch (error) { console.warn('[page-cache] projection rewrite worker failed; main-thread fallback:', error && (error.code || error.message)); }
  }
  const core = require('./projection-rewrite'), out = [], cpRowsBySteps = steps.map(() => null);
  for (const { module, buffer } of modules) {
    const data = JSON.parse((await gunzip(buffer)).toString('utf8'));
    const applied = core.applySteps(module, data, steps);
    applied.cpRowsBySteps.forEach((rows, index) => { if (rows) cpRowsBySteps[index] = rows; });
    if (!applied.changed) { out.push({ module, changed: false }); continue; }
    const json = Buffer.from(core.serializeProjection(data), 'utf8');
    out.push({ module, changed: true, buffer: await gzip(json, { level: 4 }), uncompressedBytes: json.length });
  }
  return { modules: out, cpRowsBySteps, via: 'main' };
}
async function runRowRewriteBatch(userId, request) {
  if (request.done) return;
  const key = safeUserId(userId), queue = rowRewriteQueues.get(key) || [];
  const finish = (batch, values, error) => {
    batch.forEach((item, index) => {
      item.done = true;
      const at = queue.indexOf(item); if (at >= 0) queue.splice(at, 1);
      if (error) item.reject(error); else item.resolve(values ? values[index] : null);
    });
    if (!queue.length && rowRewriteQueues.get(key) === queue) rowRewriteQueues.delete(key);
  };
  const batch = [request];
  try {
    const previous = loadManifest(userId);
    if (!previous || String(previous.contextHash || '') !== String(request.fromContextHash || '')) return finish(batch, null);
    for (const next of queue) {
      if (next === request || next.done || !(next.seq > request.seq)) continue;
      const last = batch[batch.length - 1];
      if (batch.length >= ROW_REWRITE_MAX_BATCH || next.seq !== last.seq + 1 || String(next.fromContextHash || '') !== String(last.toContextHash || '')) break;
      batch.push(next);
    }
    const modules = [], metas = {};
    for (const module of MODULES) {
      const meta = previous.modules && previous.modules[module];
      if (!meta) continue;
      const { buffer } = await readCompressed(modulePath(userId, previous.activeGeneration, module), meta.checksum || '');
      modules.push({ module, buffer }); metas[module] = meta;
    }
    if (!modules.length) return finish(batch, null);
    const steps = batch.map(item => ({ items: item.items, context: item.context, collectCpRows: item.collectCpRows }));
    const rewritten = await runRowRewriteSteps(modules, steps, entry => Number(metas[entry.module].uncompressedBytes) || entry.buffer.length);
    const reused = {};
    for (const entry of rewritten.modules) {
      const original = modules.find(item => item.module === entry.module);
      reused[entry.module] = entry.changed
        ? { buffer: entry.buffer, uncompressedBytes: entry.uncompressedBytes }
        : { buffer: original.buffer, uncompressedBytes: metas[entry.module].uncompressedBytes };
    }
    const manifest = await writeGenerationUnlocked(userId, {
      contextHash: batch[batch.length - 1].toContextHash,
      sourceLoadedAt: previous.sourceLoadedAt || null,
      reused,
      extra: { runtimeMeta: previous.runtimeMeta || {}, sourceRevisionKey: previous.sourceRevisionKey || null },
      previous,
    });
    const info = { batchSize: batch.length, via: rewritten.via, changedModules: rewritten.modules.filter(item => item.changed).map(item => item.module), timings: rewritten.timings || null };
    finish(batch, batch.map((_, index) => ({ manifest, cpRows: rewritten.cpRowsBySteps[index] || null, info })));
  } catch (error) { finish(batch, null, error); }
}
function rewriteRowPatches(userId, { fromContextHash, toContextHash, items, context = {}, collectCpRows = false } = {}) {
  const key = safeUserId(userId), flightKey = `rewrite:${key}:${fromContextHash}:${toContextHash}`;
  // Eski yoldaki singleFlight ile aynı: aynı bağlam geçişi için ikinci istek ilkini paylaşır.
  if (singleFlights.has(flightKey)) return singleFlights.get(flightKey);
  const request = { fromContextHash, toContextHash, items: Array.isArray(items) ? items : [], context, collectCpRows: Boolean(collectCpRows), done: false };
  const promise = new Promise((resolve, reject) => { request.resolve = resolve; request.reject = reject; });
  const queue = rowRewriteQueues.get(key) || [];
  rowRewriteQueues.set(key, queue);
  queue.push(request);
  // Kuyruğa giriş eski yoldaki gibi bir mikro görev sonra (singleFlight → enqueueUserMutation):
  // aynı anda çağrılan diğer mutasyonlarla göreli sıra eski yolla aynı kalır.
  Promise.resolve().then(() => {
    enqueueUserMutation(userId, () => runRowRewriteBatch(userId, request)).catch(() => {});
    request.seq = userMutationSeq.get(key);
  });
  singleFlights.set(flightKey, promise);
  const pending = pendingRewrites.get(key) || new Set();
  pendingRewrites.set(key, pending);
  pending.add(promise);
  promise.catch(() => {}).finally(() => {
    if (singleFlights.get(flightKey) === promise) singleFlights.delete(flightKey);
    pending.delete(promise); if (!pending.size && pendingRewrites.get(key) === pending) pendingRewrites.delete(key);
  });
  return promise;
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
    await saveManifest(userId, manifest);
    return meta;
  }));
}

async function readBacklog(userId, contextHash, key) {
  await pendingRewritesSettled(userId);
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
  MEMORY_MAX_ENTRIES, MEMORY_MAX_BYTES,
  readProjection, readProjectionCompressed, decodeProjection, readReusableProjections, reuseGeneration, writeProjection, writeGeneration, writeCompressedGeneration, rewriteGeneration, rewriteRowPatches, setRowRewriteRunnerForTests, splitRewriteModules, readBacklog, writeBacklog, invalidate, invalidateAll, listCachedUserIds, listSnapshotUserIds,
};
