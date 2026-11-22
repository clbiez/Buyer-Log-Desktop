'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const { promisify } = require('util');
const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);
const { LOCAL_DATA_ROOT, atomicWriteBuffer, atomicWriteBufferAsync } = require('../user-data');
const { jsonToBuffer, jsonToBufferAsync, parseJsonBuffer, parseJsonBufferAsync } = require('./large-json');

const SNAPSHOT_ROOT = path.join(LOCAL_DATA_ROOT, 'model-snapshots');
const LEGACY_SNAPSHOT_SCHEMA_VERSION = 1;
const LEGACY_V2_SCHEMA_VERSION = 2;
/* v3 = v2 + sütun sözlüklü satır torbaları (yalnız disk biçimi; bellekteki şekil
   aynıdır). FAZ 2: yazıcı v3 yazar. v3 okuyucusu (faz 1) bir önceki sürümde
   yayında olmalıdır: 8.0.6 ve öncesi v3'ü reddeder ve snapshot'ı yok sayar
   (Excel/yüklenen LFL kaynağında tek kalıcı kopya snapshot'tır). Bu yüzden faz 2,
   faz 1'in TEST'e çıktığı sürümden SONRAKİ sürümle yayınlanır; bir sürüm geri
   dönüş v3'ü okuyabilir. v2 dosyaları okunmaya devam eder; ilk kayıtta v3 olur. */
const COLUMNAR_SNAPSHOT_SCHEMA_VERSION = 3;
const SNAPSHOT_SCHEMA_VERSION = COLUMNAR_SNAPSHOT_SCHEMA_VERSION; // yazılan sürüm
const ROW_BAGS = Object.freeze(['_sourceFields', '_asas', '_cpExtra', '_sourceValues', '_matchValues']);
const BAG_COLUMNS_KEY = '_bagColumns';
const ARRAY_BAG = -1;
const TARGET_GROUPS = Object.freeze([
  ['asasOrders', 'asasOrdersByTarget'],
  ['antrepoMap', 'antrepoMapByTarget'],
]);
const snapshotWriteTails = new Map();
const verifiedSnapshots = new Map();
const CONTENT_KEYS = Object.freeze(['asasOrders','asasOrdersByTarget','antrepoMap','antrepoMapByTarget','lflRows','targetAliases']);

function splitCompactedPayload(compacted) {
  const content = {}, metadata = {};
  for (const [key, value] of Object.entries(compacted.value)) {
    (CONTENT_KEYS.includes(key) ? content : metadata)[key] = value;
  }
  return { content, metadata };
}
/* İçerik anahtarı artık yazılan JSON'un kendisinden üretilir ve dosya başlığında
   saklanır. Eskiden her kayıtta veri ayrıca sıkıştırılıp serileştirilip
   hash'leniyor (33 bin siparişte ~3,5 sn), her açılışta da yüklenen snapshot
   için aynı iş tekrarlanıyordu. Başlığında anahtar olmayan eski dosyalar için
   yeniden kullanım yalnız bir sonraki tam yazımdan sonra devreye girer. */
function rememberSnapshot(userId, contentKey, baseChecksum, buffer, metrics = {}) {
  if (!baseChecksum || !contentKey) return;
  verifiedSnapshots.set(safeUserId(userId), {
    contentKey, baseChecksum, compressedChecksum:checksum(buffer), bytes:buffer.length, ...metrics,
  });
}
function applySnapshotMetadata(userId, value) {
  const baseChecksum = value._baseChecksum;
  if (!baseChecksum) return value;
  for (const file of [snapshotPath(userId)+'.meta.json', snapshotPath(userId)+'.meta.json.bak']) {
    try {
      const wrapper = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (wrapper.schemaVersion !== 1 || wrapper.baseChecksum !== baseChecksum || !wrapper.payload
          || checksum(JSON.stringify(wrapper.payload)) !== wrapper.checksum) continue;
      if (Object.keys(wrapper.payload).some(key => CONTENT_KEYS.includes(key) || key.startsWith('_'))) continue;
      Object.assign(value, wrapper.payload);
      break;
    } catch (_) { /* incomplete/corrupt metadata: keep the verified base or backup */ }
  }
  return value;
}

function safeUserId(value) {
  return String(value || 'moderator').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 100) || 'moderator';
}
function snapshotPath(userId) { return path.join(SNAPSHOT_ROOT, `${safeUserId(userId)}.json.gz`); }
function checksum(value) { return crypto.createHash('sha256').update(value).digest('hex'); }

/* İçerik eşitliği: yalnız JSON çıktısı (dolayısıyla yükleme sonrası değer)
   birebir aynı olacak durumlarda true döner; şüphede false (takma ad yok).
   Aynı referans en hızlı yoldur; dizide boy, nesnede anahtar SIRASI ve
   prototip aynı olmalı. Date yalnız Date ile ve aynı zamanla eşittir; diğer
   sınıflar (toJSON taşıyabilir) yalnız referansla. İlk farkta durur. */
const PLAIN_PROTOTYPES = new Set([Object.prototype, null]);
function sameSnapshotContent(a, b) {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i] && !sameSnapshotContent(a[i], b[i])) return false;
    return true;
  }
  if (Array.isArray(b)) return false;
  if (a instanceof Date || b instanceof Date) {
    if (!(a instanceof Date) || !(b instanceof Date)) return false;
    const at = a.getTime(), bt = b.getTime();
    return at === bt || (Number.isNaN(at) && Number.isNaN(bt));
  }
  const proto = Object.getPrototypeOf(a);
  if (proto !== Object.getPrototypeOf(b) || !PLAIN_PROTOTYPES.has(proto)) return false;
  const keys = Object.keys(a), otherKeys = Object.keys(b);
  if (keys.length !== otherKeys.length) return false;
  for (let i = 0; i < keys.length; i += 1) {
    const key = keys[i];
    if (key !== otherKeys[i]) return false;
    if (a[key] !== b[key] && !sameSnapshotContent(a[key], b[key])) return false;
  }
  return true;
}

// Excel/local source modes intentionally reuse the same array/map for CP, Orders
// and Backlog. Plain JSON duplicated that object up to four times on disk and on
// every fallback parse. Preserve target semantics while storing identity aliases.
// Buyer snapshot'ında hedefler ayrı dizi nesneleri olabilir (#1145 öncesi
// snapshot'tan yükle→yeniden kaydet, ya da aynı ufka ayrı sorgular); içerikçe
// aynıysa onlar da takma ad olur. Yükleme hedefleri tek nesnede birleştirir;
// moderatör/Excel modundaki paylaşım sözleşmesiyle aynıdır (hedef dizisi yerinde
// değiştirilmez, yenisiyle değiştirilir).
/* Hedef başına üst seviye karşılaştırma bir üreteçtir: kooperatif kayıt yolu
   (prepareSnapshotAsync) satır/anahtar arasında olay döngüsüne döner. 9082
   satırlık eşit içerikte karşılaştırma ~130 ms sürüyordu; tek blok olsaydı
   kayıt yolunun ~8 ms dilim sözleşmesini bozardı. */
const COMPARE_YIELD_EVERY = 256;
function* sameTopLevelContent(a, b) {
  if (a === b) return true;
  const isArray = Array.isArray(a);
  if (isArray !== Array.isArray(b)) return false;
  if (isArray) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) {
      if (a[i] !== b[i] && !sameSnapshotContent(a[i], b[i])) return false;
      if ((i + 1) % COMPARE_YIELD_EVERY === 0) yield;
    }
    return true;
  }
  if (Object.getPrototypeOf(a) !== Object.getPrototypeOf(b) || !PLAIN_PROTOTYPES.has(Object.getPrototypeOf(a))) return false;
  const keys = Object.keys(a), otherKeys = Object.keys(b);
  if (keys.length !== otherKeys.length) return false;
  for (let i = 0; i < keys.length; i += 1) {
    const key = keys[i];
    if (key !== otherKeys[i]) return false;
    if (a[key] !== b[key] && !sameSnapshotContent(a[key], b[key])) return false;
    if ((i + 1) % COMPARE_YIELD_EVERY === 0) yield;
  }
  return true;
}
function* compactSnapshotSteps(payload) {
  const value = { ...(payload && typeof payload === 'object' ? payload : {}) };
  const targetAliases = {};
  let aliasCount = 0;
  for (const [baseKey, groupKey] of TARGET_GROUPS) {
    const source = value[groupKey];
    if (!source || typeof source !== 'object' || Array.isArray(source)) continue;
    const compact = {}, aliases = {}, seen = new Map();
    const base = value[baseKey];
    if (base && typeof base === 'object') seen.set(base, baseKey);
    for (const [target, entry] of Object.entries(source)) {
      let match = entry && typeof entry === 'object' ? (seen.get(entry) || null) : null;
      if (!match && entry && typeof entry === 'object') {
        for (const [candidate, name] of seen) {
          if (Array.isArray(candidate) !== Array.isArray(entry)) continue;
          if (Array.isArray(entry) && candidate.length !== entry.length) continue;
          if (yield* sameTopLevelContent(candidate, entry)) { match = name; break; }
        }
      }
      if (match) {
        aliases[target] = match; aliasCount += 1;
      } else {
        compact[target] = entry;
        if (entry && typeof entry === 'object') seen.set(entry, target);
      }
    }
    value[groupKey] = compact;
    if (Object.keys(aliases).length) targetAliases[groupKey] = aliases;
  }
  if (Object.keys(targetAliases).length) value.targetAliases = targetAliases;
  return { value, aliasCount };
}
function compactSnapshotPayload(payload) {
  const steps = compactSnapshotSteps(payload);
  for (;;) { const step = steps.next(); if (step.done) return step.value; }
}
const COMPACT_SLICE_MS = 8;
async function compactSnapshotPayloadAsync(payload, yieldControl = yieldToEventLoop) {
  const steps = compactSnapshotSteps(payload);
  let sliceStart = Date.now();
  for (;;) {
    const step = steps.next();
    if (step.done) return step.value;
    if (Date.now() - sliceStart >= COMPACT_SLICE_MS) { await yieldControl(); sliceStart = Date.now(); }
  }
}

function expandSnapshotPayload(snapshot) {
  const value = { ...(snapshot && typeof snapshot === 'object' ? snapshot : {}) };
  const allAliases = value.targetAliases && typeof value.targetAliases === 'object' ? value.targetAliases : {};
  for (const [baseKey, groupKey] of TARGET_GROUPS) {
    const stored = value[groupKey] && typeof value[groupKey] === 'object' && !Array.isArray(value[groupKey])
      ? { ...value[groupKey] } : {};
    const aliases = allAliases[groupKey] && typeof allAliases[groupKey] === 'object' ? allAliases[groupKey] : {};
    const resolving = new Set();
    const resolve = target => {
      if (Object.prototype.hasOwnProperty.call(stored, target)) return stored[target];
      if (resolving.has(target)) throw new Error(`Snapshot target alias döngüsü: ${groupKey}.${target}`);
      resolving.add(target);
      const ref = aliases[target];
      const resolved = ref === baseKey ? value[baseKey] : resolve(ref);
      resolving.delete(target);
      if (resolved === undefined) throw new Error(`Snapshot target alias bulunamadı: ${groupKey}.${target}`);
      stored[target] = resolved;
      return resolved;
    };
    for (const target of Object.keys(aliases)) resolve(target);
    value[groupKey] = stored;
  }
  delete value.targetAliases;
  return value;
}

// İçerik UTF-8 parçalarıyla üretilir; bütün kaynak için büyük bir V8 metni
// oluşturmak, snapshot kaydında sunucuyu OOM ile kapatabiliyordu.
// Gövde hash'i ve dosya baytları yalnız gerçekten yazılacaksa hazırlanır.
/* İçerik: v2'de içerik nesnesi olduğu gibi (jsonChunks) serileştirilir; v3'te
   aynı içerik bir torba kodlayıcısıyla columnarContentJson'dan geçer. Bütün
   satırların kodlanmış kopyası hiçbir anda tutulmaz (OOM geçmişi: #1148/#1153).
   format 'v2' yalnız test/geri dönüş aracıdır. */
function snapshotContent(compacted, format) {
  const { content, metadata } = splitCompactedPayload(compacted);
  const base = { metadata, savedAt:new Date().toISOString(), aliasCount:compacted.aliasCount };
  if (format === 'v2') return { ...base, content, encoder:null };
  return { ...base, content, encoder:rowBagEncoder() };
}
/* v3 içerik baytları. Satır bölümleri SERIALIZE_BATCH_ROWS'luk partiler hâlinde
   yerel JSON.stringify ile yazılır: parti kodlanır, metne döner, bırakılır.
   Satırı alan alan JS'te gezen önceki Proxy görünümüne göre sahaya benzer
   veride kayıt ~2 kat hızlı ve örneklenen heap tepe noktası v2'nin altında (L2).
   _bagColumns en son yazılır; o ana kadar bütün şemalar toplanmıştır. Çıktı,
   JSON.stringify(içerik + _bagColumns) ile bayt bayt aynıdır. */
const SERIALIZE_BATCH_ROWS = 256;
const ROW_SECTIONS = Object.freeze({ asasOrders:'rows', lflRows:'rows', asasOrdersByTarget:'rowGroup', antrepoMap:'map', antrepoMapByTarget:'mapGroup' });
function* rowsJson(rows, encodeRow) {
  yield '[';
  for (let i = 0; i < rows.length; i += SERIALIZE_BATCH_ROWS) {
    const end = Math.min(rows.length, i + SERIALIZE_BATCH_ROWS), batch = new Array(end - i);
    for (let j = i; j < end; j += 1) batch[j - i] = encodeRow(rows[j]);
    const text = JSON.stringify(batch);
    yield i ? `,${text.slice(1, -1)}` : text.slice(1, -1);
  }
  yield ']';
}
function* mapJson(map, encodeRow) {
  yield '{';
  let first = true, pending = [];
  for (const key of Object.keys(map)) {
    const value = map[key];
    const text = JSON.stringify(Array.isArray(value) ? value.map(encodeRow) : encodeRow(value));
    if (text === undefined) continue;
    pending.push(`${first ? '' : ','}${JSON.stringify(key)}:${text}`); first = false;
    if (pending.length >= SERIALIZE_BATCH_ROWS) { yield pending.join(''); pending = []; }
  }
  if (pending.length) yield pending.join('');
  yield '}';
}
function* groupJson(group, section) {
  yield '{';
  let first = true;
  for (const key of Object.keys(group)) {
    const value = group[key];
    if (jsonOmitted(resolveToJson(value, key))) continue;
    yield `${first ? '' : ','}${JSON.stringify(key)}:`; first = false;
    yield* section(value);
  }
  yield '}';
}
function* columnarContentJson(content, encoder) {
  const { encodeRow } = encoder;
  const rows = value => (Array.isArray(value) ? rowsJson(value, encodeRow) : [JSON.stringify(value)]);
  const map = value => (value && typeof value === 'object' && !Array.isArray(value) ? mapJson(value, encodeRow) : [JSON.stringify(value)]);
  const sections = {
    rows,
    map,
    rowGroup:value => (value && typeof value === 'object' && !Array.isArray(value) ? groupJson(value, rows) : [JSON.stringify(value)]),
    mapGroup:value => (value && typeof value === 'object' && !Array.isArray(value) ? groupJson(value, map) : [JSON.stringify(value)]),
  };
  yield '{';
  for (const key of Object.keys(content)) {
    const value = content[key];
    if (jsonOmitted(resolveToJson(value, key))) continue;
    yield `${JSON.stringify(key)}:`;
    const kind = ROW_SECTIONS[key];
    if (kind && value && typeof value === 'object' && typeof value.toJSON !== 'function') yield* sections[kind](value);
    else yield JSON.stringify(value);
    yield ',';
  }
  // _bagColumns en sondadır: o ana kadar bütün şemalar toplanmıştır.
  yield `${JSON.stringify(BAG_COLUMNS_KEY)}:${JSON.stringify(encoder.columns)}}`;
}
const FLUSH_CHARS = 8 * 1024 * 1024;
function contentBufferFrom(view) {
  if (!view.encoder) return jsonToBuffer(view.content);
  const parts = []; let batch = [], size = 0;
  for (const chunk of columnarContentJson(view.content, view.encoder)) {
    batch.push(chunk); size += chunk.length;
    if (size >= FLUSH_CHARS) { parts.push(Buffer.from(batch.join(''), 'utf8')); batch = []; size = 0; }
  }
  if (batch.length) parts.push(Buffer.from(batch.join(''), 'utf8'));
  return parts.length === 1 ? parts[0] : Buffer.concat(parts);
}
async function contentBufferFromAsync(view, yieldControl) {
  if (!view.encoder) return jsonToBufferAsync(view.content, { yieldControl });
  const parts = []; let batch = [], size = 0, deadline = performance.now() + 8;
  for (const chunk of columnarContentJson(view.content, view.encoder)) {
    batch.push(chunk); size += chunk.length;
    if (size >= FLUSH_CHARS) { parts.push(Buffer.from(batch.join(''), 'utf8')); batch = []; size = 0; }
    if (performance.now() >= deadline) { await yieldControl(); deadline = performance.now() + 8; }
  }
  if (batch.length) parts.push(Buffer.from(batch.join(''), 'utf8'));
  return parts.length === 1 ? parts[0] : Buffer.concat(parts);
}
function preparedFrom({ content, encoder, ...rest }, contentBuffer, contentKey) {
  // v2 eşdeğeri payload = v3 payload − (",\"_bagColumns\":[...]") + torba farkı.
  // Önündeki virgül her zaman vardır: metadata (savedAt) daima içerikten önce gelir.
  const bag = encoder ? { delta:encoder.delta,
    columnsEntryBytes:1 + Buffer.byteLength(`${JSON.stringify(BAG_COLUMNS_KEY)}:${JSON.stringify(encoder.columns)}`, 'utf8') } : null;
  return { contentBuffer, contentKey, ...rest, bag };
}
function prepareSnapshot(payload, format = 'v3') {
  const view = snapshotContent(compactSnapshotPayload(payload), format);
  const contentBuffer = contentBufferFrom(view);
  return preparedFrom(view, contentBuffer, checksum(contentBuffer));
}
/* Yenileme/kayıt yolu (saveModelSnapshotAsync) için kooperatif eşdeğerler.
   Senkron prepare/finish 120 MiB sentetik veride ana thread'i ~6,6 sn tek
   blokta tutuyordu (kullanıcı verisinde çok daha uzun). Baytlar, contentKey ve
   checksum aynı fonksiyonlarla aynı sırada üretilir; yalnız iş ~8 ms dilimlere
   bölünür ve hash 8 MiB dilimlerle güncellenir. */
const HASH_SLICE_BYTES = 8 * 1024 * 1024;
const yieldToEventLoop = () => new Promise(resolve => setImmediate(resolve));
async function hashPartsAsync(parts, yieldControl) {
  const hash = crypto.createHash('sha256');
  for (const part of parts) {
    for (let offset = 0; offset < part.length; offset += HASH_SLICE_BYTES) {
      hash.update(part.subarray(offset, Math.min(part.length, offset + HASH_SLICE_BYTES)));
      await yieldControl();
    }
  }
  return hash.digest('hex');
}
async function prepareSnapshotAsync(payload, yieldControl = yieldToEventLoop, format = 'v3') {
  // v3 kodlaması içerik eşitliği takma adlarından (compact, #1157) SONRA çalışır.
  const view = snapshotContent(await compactSnapshotPayloadAsync(payload, yieldControl), format);
  const contentBuffer = await contentBufferFromAsync(view, yieldControl);
  return preparedFrom(view, contentBuffer, await hashPartsAsync([contentBuffer], yieldControl));
}
async function finishSnapshotAsync(prepared, yieldControl = yieldToEventLoop) {
  const bodyParts = snapshotBodyParts(prepared);
  return assembleVersioned(prepared, bodyParts, await hashPartsAsync(bodyParts, yieldControl));
}
// Gövde = metadata + içerik; çözücü gövdeyi olduğu gibi ayrıştırır.
// Gövde parçalar halinde hash'lenir ve tek tampona yazılır. Eskiden parçalar
// birleştirilmiş tek metne dönüştürülüyordu; V8 bu metni düzleştirirken büyük
// veri setinde içeriğin ikinci tam kopyasını heap'te açıyor ve yenileme
// "snapshot-save" adımında heap out of memory ile çöküyordu. Baytlar aynıdır.
function snapshotBodyParts({ contentBuffer, metadata, savedAt }) {
  const metadataJson = JSON.stringify({ savedAt, ...metadata });
  return contentBuffer.length === 2
    ? [Buffer.from(metadataJson,'utf8')]
    : [Buffer.from(`${metadataJson.slice(0, -1)},`,'utf8'),contentBuffer.subarray(1)];
}
function assembleSnapshot(prepared, bodyParts, digest, { schemaVersion, extraHeader = '' }) {
  const { contentBuffer, bag, ...rest } = prepared;
  const parts = [Buffer.from(`{"schemaVersion":${schemaVersion},"checksum":"${digest}","contentKey":"${rest.contentKey}",${extraHeader}"payload":`,'utf8'), ...bodyParts, Buffer.from('}')];
  const json = Buffer.allocUnsafe(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) offset += part.copy(json, offset);
  if (offset !== json.length) throw new Error('Snapshot gövdesi yazılamadı.');
  return { ...rest, json, baseChecksum:digest };
}
/* decodedBytes: çözülmüş verinin v2 eşdeğeri payload baytı (işçi/bellek tahmini).
   v2'de payload'ın kendisi; v3'te başlığa yazılır (snapshotByteEstimate okur). */
function assembleVersioned(prepared, bodyParts, digest) {
  const payloadBytes = bodyParts.reduce((sum, part) => sum + part.length, 0);
  if (!prepared.bag) return { ...assembleSnapshot(prepared, bodyParts, digest, { schemaVersion:LEGACY_V2_SCHEMA_VERSION }), decodedBytes:payloadBytes };
  const decodedBytes = payloadBytes - prepared.bag.columnsEntryBytes + prepared.bag.delta;
  return { ...assembleSnapshot(prepared, bodyParts, digest,
    { schemaVersion:COLUMNAR_SNAPSHOT_SCHEMA_VERSION, extraHeader:`"decodedBytes":${decodedBytes},` }), decodedBytes };
}
function finishSnapshot(prepared) {
  const bodyParts = snapshotBodyParts(prepared), hash = crypto.createHash('sha256');
  for (const part of bodyParts) hash.update(part);
  return assembleVersioned(prepared, bodyParts, hash.digest('hex'));
}
function encodeSnapshot(payload, format = 'v3') { return finishSnapshot(prepareSnapshot(payload, format)); }

/* ---- v3 satır torbası sözlüğü --------------------------------------------
   Her satırdaki ham kaynak torbaları (_sourceFields, LFL _asas, ...) aynı 40+
   sütun adını her satırda tekrar yazıyordu (sahada 321 MiB'ın ~105 MiB'ı ad
   baytı). v3'te torba diskte [şemaNo, değer1, değer2, ...] dizisidir; sütun
   listeleri payload'ın sonunda _bagColumns altında bir kez tutulur. Dizi biçimli
   (beklenmeyen) torba [-1, ...öğeler] olarak kaçışlanır. JSON anlamı korunur:
   undefined/fonksiyon değerli alan düşer, toJSON uygulanır. Çözülen nesneler v2
   ile aynı anahtar sırası ve değerlerle kurulur. */
const jsonByteLength = value => Buffer.byteLength(JSON.stringify(value), 'utf8');
const jsonOmitted = value => value === undefined || typeof value === 'function' || typeof value === 'symbol';
const resolveToJson = (value, key) => (value && typeof value === 'object' && typeof value.toJSON === 'function' ? value.toJSON(key) : value);
function rowBagEncoder() {
  const schemaIds = new Map(), columns = [], keyBytes = [], lastSchema = new Map();
  let delta = 0; // v2 (nesne) baytı − v3 (dizi) baytı; decodedBytes için kesin toplam
  const schemaFor = keys => {
    const signature = keys.join('\u0000');
    let id = schemaIds.get(signature);
    if (id === undefined) {
      id = columns.length; schemaIds.set(signature, id); columns.push(keys);
      keyBytes.push(keys.reduce((sum, key) => sum + jsonByteLength(key) + 1, 0));
    }
    return id;
  };
  // Ardışık satırlar neredeyse her zaman aynı sütunları taşır: önce aynı torba
  // adının son şemasıyla (anahtar anahtar, kimlik karşılaştırması) denenir;
  // birleştirilmiş imza metni yalnız şema değiştiğinde üretilir.
  const sameKeys = (a, b) => {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
    return true;
  };
  /* Anahtarlar for-in ile, ara dizi kurulmadan son şemayla karşılaştırılır;
     anahtar dizisi yalnız şema değişince kurulur. */
  const encodeBag = (bag, name) => {
    const node = resolveToJson(bag, name);
    if (Array.isArray(node)) { delta -= node.length ? 3 : 2; return [ARRAY_BAG, ...node]; }
    if (!node || typeof node !== 'object') return node;
    const last = lastSchema.get(name), expected = last ? last.keys : null;
    const out = [0];
    let index = 0, matches = !!expected;
    for (const key in node) {
      if (!Object.prototype.hasOwnProperty.call(node, key)) continue;
      let value = node[key];
      if (value && typeof value === 'object' && typeof value.toJSON === 'function') value = value.toJSON(key);
      if (jsonOmitted(value)) continue;
      if (matches && expected[index] !== key) matches = false;
      index += 1;
      out.push(value);
    }
    let id;
    if (matches && index === expected.length) id = last.id;
    else {
      const keys = [];
      for (const key in node) {
        if (!Object.prototype.hasOwnProperty.call(node, key)) continue;
        if (!jsonOmitted(resolveToJson(node[key], key))) keys.push(key);
      }
      id = schemaFor(keys);
      lastSchema.set(name, { id, keys:columns[id] });
    }
    out[0] = id;
    delta += index ? keyBytes[id] - 1 - String(id).length : -String(id).length;
    return out;
  };
  // Satırın sığ kopyası, torbaları kodlanmış olarak; parti serileştirilince bırakılır.
  const encodeRow = row => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) return row;
    let out = null;
    for (const name of ROW_BAGS) {
      const bag = row[name];
      if (!bag || typeof bag !== 'object' || !Object.prototype.propertyIsEnumerable.call(row, name)) continue;
      out = out || { ...row };
      out[name] = encodeBag(bag, name);
    }
    return out || row;
  };
  return { encodeRow, columns, get delta() { return delta; } };
}
/* Satır torbalarını yerinde çözer. Üreteçtir: kooperatif yükleme yolu
   (loadModelSnapshotAsync + yieldControl) DECODE_YIELD_ROWS satırda bir olay
   döngüsüne dönebilir; senkron yol üreteci tek seferde tüketir. Sahadaki
   ~160 bin satırlık çözme tek blokta ana thread'i saniyenin üzerinde tutabilirdi. */
const DECODE_YIELD_ROWS = 512;
function* decodeRowBagSteps(payload) {
  const columns = payload[BAG_COLUMNS_KEY];
  if (!Array.isArray(columns) || columns.some(keys => !Array.isArray(keys) || keys.some(key => typeof key !== 'string'))) {
    throw new Error('Snapshot v3 sütun sözlüğü geçersiz.');
  }
  delete payload[BAG_COLUMNS_KEY];
  /* Object.fromEntries bilinçli seçimdir: 45 sütunluk nesneyi `o[k] = v` ile adım
     adım kurmak V8'de sözlük kipine düşüp 60 bin satırda ~180 MiB heap tutuyordu;
     fromEntries ~24 MiB (JSON.parse nesneleri kadar) ve "__proto__" adlı ham
     sütunu prototip değil kendi alanı olarak yazar (JSON.parse ile aynı anlam). */
  const decodeBag = encoded => {
    const id = encoded[0];
    if (id === ARRAY_BAG) return encoded.slice(1);
    const keys = Number.isInteger(id) && id >= 0 ? columns[id] : undefined;
    if (!keys || keys.length !== encoded.length - 1) throw new Error('Snapshot v3 satır torbası sözlükle uyuşmuyor.');
    return Object.fromEntries(keys.map((key, index) => [key, encoded[index + 1]]));
  };
  const decodeRow = row => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) return row;
    for (const name of ROW_BAGS) if (Array.isArray(row[name])) row[name] = decodeBag(row[name]);
    return row;
  };
  // Yerinde çözülür: JSON.parse'ın ürettiği satırlar zaten tekil nesnelerdir.
  let done = 0;
  function* each(rows) {
    if (!Array.isArray(rows)) return;
    for (let i = 0; i < rows.length; i += 1) { decodeRow(rows[i]); if (++done % DECODE_YIELD_ROWS === 0) yield; }
  }
  function* eachMap(map) {
    if (!map || typeof map !== 'object' || Array.isArray(map)) return;
    for (const value of Object.values(map)) {
      if (Array.isArray(value)) yield* each(value);
      else { decodeRow(value); if (++done % DECODE_YIELD_ROWS === 0) yield; }
    }
  }
  function* eachGroup(group, fn) {
    if (group && typeof group === 'object' && !Array.isArray(group)) for (const value of Object.values(group)) yield* fn(value);
  }
  yield* each(payload.asasOrders); yield* eachGroup(payload.asasOrdersByTarget, each);
  yield* eachMap(payload.antrepoMap); yield* eachGroup(payload.antrepoMapByTarget, eachMap);
  yield* each(payload.lflRows);
  return payload;
}
function drain(steps) { for (;;) { const step = steps.next(); if (step.done) return step.value; } }
const DECODE_SLICE_MS = 8;
async function drainAsync(steps, yieldControl) {
  let sliceStart = Date.now();
  for (;;) {
    const step = steps.next();
    if (step.done) return step.value;
    if (Date.now() - sliceStart >= DECODE_SLICE_MS) { await yieldControl(); sliceStart = Date.now(); }
  }
}
/* Sıkıştırılmamış dosya baytları (test, benchmark ve geri dönüş tanısı için).
   Kayıt yolu aynı prepare/finish fonksiyonlarını kullanır. */
function encodeColumnarSnapshot(payload) { assertSnapshotPayload(payload); return encodeSnapshot(payload, 'v3'); }
function encodeLegacyV2Snapshot(payload) { assertSnapshotPayload(payload); return encodeSnapshot(payload, 'v2'); }

/* Model snapshot'ı düz JSON'dur: Date alanları "2026-03-09T21:00:00.000Z"
   metnine dönüşür (TR'de 10.03 gece yarısı). Canlı yenilemede ise aynı alanlar
   Date nesnesidir. Bazı tüketiciler (ör. Sipariş Yerleştirme tarihi, P&A
   snapshot'ı) metni olduğu gibi taşıyor ya da ilk 10 karakterini UTC günü
   olarak okuyordu; soğuk açılıştan sonra tarihler bir gün geri ve saat
   kısmıyla görünüyordu. Sipariş ve IAS verisindeki tam Date#toJSON biçimli
   metinler burada yeniden Date'e çevrilir; böylece hydrate edilen veri canlı
   yenilemeyle aynı tiptedir. Yalnız tam ISO-Z biçimi dönüştürülür. */
const DATE_JSON = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
/* Üreteç + açık yığın: kooperatif yükleme yolu REVIVE_YIELD_NODES düğümde bir
   olay döngüsüne dönebilir (sahada tarih dönüşümü tek blokta yüzlerce ms
   sürüyordu); senkron yol üreteci tek seferde tüketir. Ziyaret sırası değişse de
   her dönüşüm yerinde ve bağımsızdır; `seen` paylaşılan dizileri bir kez gezer. */
const REVIVE_YIELD_NODES = 1024;
const isDateJson = v => v.length === 24 && v.charCodeAt(10) === 84 && v.charCodeAt(23) === 90 && DATE_JSON.test(v);
function* reviveDatesSteps(root, seen) {
  let revived = 0, visited = 0;
  const stack = [root];
  while (stack.length) {
    const node = stack.pop();
    if (!node || typeof node !== 'object' || node instanceof Date || seen.has(node)) continue;
    seen.add(node);
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i += 1) {
        const v = node[i];
        if (typeof v === 'string') { if (isDateJson(v)) { node[i] = new Date(v); revived += 1; } }
        else if (v && typeof v === 'object') stack.push(v);
      }
    } else {
      for (const key of Object.keys(node)) {
        const v = node[key];
        if (typeof v === 'string') { if (isDateJson(v)) { node[key] = new Date(v); revived += 1; } }
        else if (v && typeof v === 'object') stack.push(v);
      }
    }
    if (++visited % REVIVE_YIELD_NODES === 0) yield;
  }
  return revived;
}
function reviveDatesIn(root, seen = new WeakSet()) { return drain(reviveDatesSteps(root, seen)); }
function* reviveSnapshotDateSteps(value) {
  if (!value || typeof value !== 'object') return 0;
  let total = 0;
  const seen = new WeakSet(); // hedef takma adları aynı diziyi paylaşır; bir kez gezilir
  for (const [baseKey, groupKey] of TARGET_GROUPS) {
    total += yield* reviveDatesSteps(value[baseKey], seen);
    total += yield* reviveDatesSteps(value[groupKey], seen);
  }
  return total;
}
function reviveSnapshotDates(value) { return drain(reviveSnapshotDateSteps(value)); }

/* Snapshot çözme adımları (üreteç). v3 satır torbası çözme dilimlenir; senkron
   yol (decodeSnapshotRaw) aynı adımları tek seferde tüketir, sonuç birebir aynıdır. */
function* decodeSnapshotSteps(raw, parsed) {
  let value;
  if (parsed && parsed.schemaVersion === LEGACY_SNAPSHOT_SCHEMA_VERSION) {
    value = parsed;
  } else if (parsed && (parsed.schemaVersion === LEGACY_V2_SCHEMA_VERSION || parsed.schemaVersion === COLUMNAR_SNAPSHOT_SCHEMA_VERSION) && parsed.payload) {
    const marker = Buffer.from('"payload":'), start = raw.indexOf(marker);
    if (start < 0 || raw[raw.length - 1] !== 0x7d) throw new Error('Snapshot payload biçimi geçersiz.');
    const payloadBytes = raw.subarray(start + marker.length, -1);
    if (!parsed.checksum || (yield* checksumSteps(payloadBytes)) !== parsed.checksum) throw new Error('Snapshot checksum uyuşmuyor.');
    const columnar = parsed.schemaVersion === COLUMNAR_SNAPSHOT_SCHEMA_VERSION;
    value = expandSnapshotPayload(columnar ? yield* decodeRowBagSteps(parsed.payload) : parsed.payload);
    Object.defineProperty(value, '_baseChecksum', { value:parsed.checksum, enumerable:false });
    if (/^[0-9a-f]{64}$/.test(String(parsed.contentKey || ''))) Object.defineProperty(value, '_contentKey', { value:parsed.contentKey, enumerable:false });
    // Çözülmüş verinin v2 eşdeğeri bayt boyutu (bellek tahmini); v2'de dosyanın kendisi.
    const decodedBytes = columnar ? parsed.decodedBytes : payloadBytes.length;
    if (Number.isSafeInteger(decodedBytes) && decodedBytes > 0) Object.defineProperty(value, '_decodedBytes', { value:decodedBytes, enumerable:false });
  } else {
    throw new Error('Snapshot schema sürümü desteklenmiyor.');
  }
  if (!value || !Array.isArray(value.asasOrders)) throw new Error('Snapshot ana sipariş verisi eksik.');
  yield* reviveSnapshotDateSteps(value);
  return value;
}
// sha256, HASH_SLICE_BYTES dilimlerle (sonuç tek update ile aynıdır).
function* checksumSteps(buffer) {
  const hash = crypto.createHash('sha256');
  for (let offset = 0; offset < buffer.length; offset += HASH_SLICE_BYTES) {
    hash.update(buffer.subarray(offset, Math.min(buffer.length, offset + HASH_SLICE_BYTES)));
    yield;
  }
  return hash.digest('hex');
}
function decodeSnapshotRaw(raw, parsed = parseJsonBuffer(raw)) { return drain(decodeSnapshotSteps(raw, parsed)); }
async function decodeSnapshotRawAsync(raw, parsed, yieldControl) { return drainAsync(decodeSnapshotSteps(raw, parsed), yieldControl); }

function decodeSnapshotBuffer(buffer) {
  return decodeSnapshotRaw(zlib.gunzipSync(buffer));
}

function assertSnapshotPayload(payload) {
  if (!payload || !Array.isArray(payload.asasOrders)) throw new Error('Snapshot ana sipariş verisi eksik.');
}
/* Yazmadan önce doğrulama: sıkıştırılmış baytlar açılınca üretilen JSON'un
   birebir aynısı olmalı. Eskiden bunun yerine tüm snapshot yeniden
   ayrıştırılıyordu (JSON.parse + tarih dönüşümü); bayt eşitliği daha güçlü ve
   çok daha ucuz bir kanıttır, JSON zaten JSON.stringify ile üretildi. */
function assertRoundTrip(raw, encoded) {
  if (!Buffer.isBuffer(raw) || !raw.equals(encoded.json)) throw new Error('Snapshot sıkıştırma doğrulaması başarısız.');
}

function saveModelSnapshot(userId, payload) {
  assertSnapshotPayload(payload);
  const started = Date.now(), encoded = encodeSnapshot(payload);
  const buffer = zlib.gzipSync(encoded.json, { level: 6 });
  assertRoundTrip(zlib.gunzipSync(buffer), encoded);
  const file = snapshotPath(userId);
  atomicWriteBuffer(file, buffer);
  rememberSnapshot(userId, encoded.contentKey, encoded.baseChecksum, buffer, { uncompressedBytes:encoded.decodedBytes, fileBytes:encoded.json.length });
  // uncompressedBytes = çözülmüş (v2 eşdeğeri) boyut: işçi/bellek ayırması bunu kullanır.
  // fileBytes = diskteki açık v3 dosyası (daha küçük).
  return { file, savedAt: encoded.savedAt, bytes: buffer.length, uncompressedBytes: encoded.decodedBytes, fileBytes: encoded.json.length, aliasCount: encoded.aliasCount, reused:false, totalMs: Date.now() - started };
}

async function writeModelSnapshotAsync(userId, payload) {
  const started = Date.now();
  await new Promise(resolve => setImmediate(resolve));
  assertSnapshotPayload(payload);
  const serializeStarted = Date.now(), previous = verifiedSnapshots.get(safeUserId(userId));
  let prepared = await prepareSnapshotAsync(payload);
  if (previous && previous.contentKey === prepared.contentKey) {
    // Re-read and hash the compressed primary: a replaced/deleted/corrupt file
    // must never inherit an in-memory verification from an older generation.
    const primary = await fs.promises.readFile(snapshotPath(userId)).catch(() => null);
    if (primary && checksum(primary) === previous.compressedChecksum) {
      const metadata = { savedAt:prepared.savedAt, ...prepared.metadata };
      const wrapper = { schemaVersion:1, baseChecksum:previous.baseChecksum, checksum:checksum(JSON.stringify(metadata)), payload:metadata };
      await atomicWriteBufferAsync(snapshotPath(userId)+'.meta.json', Buffer.from(JSON.stringify(wrapper)));
      return { file:snapshotPath(userId), savedAt:metadata.savedAt, bytes:previous.bytes, uncompressedBytes:previous.uncompressedBytes, fileBytes:previous.fileBytes,
        aliasCount:prepared.aliasCount, reused:true, totalMs:Date.now()-started };
    }
  }
  const encoded = await finishSnapshotAsync(prepared);
  prepared = null; // release the content buffer before the awaited gzip/write
  const compressStarted = Date.now(), buffer = await gzip(encoded.json, { level: 6 });
  const validateStarted = Date.now();
  { const raw = await gunzip(buffer); assertRoundTrip(raw, encoded); } // raw is released before the write
  const writeStarted = Date.now(), file = snapshotPath(userId);
  await atomicWriteBufferAsync(file, buffer);
  rememberSnapshot(userId, encoded.contentKey, encoded.baseChecksum, buffer, { uncompressedBytes:encoded.decodedBytes, fileBytes:encoded.json.length });
  return {
    file, savedAt: encoded.savedAt, bytes: buffer.length, uncompressedBytes: encoded.decodedBytes, fileBytes: encoded.json.length, aliasCount: encoded.aliasCount, reused:false,
    serializeMs: compressStarted - serializeStarted, compressMs: validateStarted - compressStarted,
    validateMs: writeStarted - validateStarted, writeMs: Date.now() - writeStarted, totalMs: Date.now() - started,
  };
}

function saveModelSnapshotAsync(userId, payload) {
  const key = safeUserId(userId), previous = snapshotWriteTails.get(key) || Promise.resolve();
  const next = previous.catch(() => {}).then(() => writeModelSnapshotAsync(userId, payload));
  snapshotWriteTails.set(key, next);
  return next.finally(() => { if (snapshotWriteTails.get(key) === next) snapshotWriteTails.delete(key); });
}

function loadModelSnapshot(userId) {
  const file = snapshotPath(userId);
  for (const candidate of [file, file + '.bak']) {
    if (!fs.existsSync(candidate)) continue;
    try {
      const buffer = fs.readFileSync(candidate), value = decodeSnapshotBuffer(buffer);
      if (candidate === file) rememberSnapshot(userId, value._contentKey, value._baseChecksum, buffer);
      return applySnapshotMetadata(userId, value);
    }
    catch (_) { /* bozuk ana kopyada yedeği dene */ }
  }
  return null;
}

async function loadModelSnapshotAsync(userId, {yieldControl} = {}) {
  const file = snapshotPath(userId);
  for (const candidate of [file, file + '.bak']) {
    const started = Date.now();
    try {
      const compressed = await fs.promises.readFile(candidate);
      const readMs = Date.now() - started, raw = await gunzip(compressed), inflateMs = Date.now() - started - readMs;
      const parseStarted = Date.now(), value = yieldControl
        ? await decodeSnapshotRawAsync(raw, await parseJsonBufferAsync(raw,{yieldControl}), yieldControl)
        : decodeSnapshotRaw(raw);
      const decodedBytes = value._decodedBytes || raw.length;
      if (candidate === file) rememberSnapshot(userId, value._contentKey, value._baseChecksum, compressed, { uncompressedBytes:decodedBytes, fileBytes:raw.length });
      applySnapshotMetadata(userId, value);
      Object.defineProperty(value, '_snapshotMetrics', {
        value:{ readMs, inflateMs, parseMs:Date.now() - parseStarted, totalMs:Date.now() - started, bytes:compressed.length, decodedBytes, fallback:candidate !== file },
        enumerable:false,
      });
      return value;
    } catch (error) {
      if (error && error.code === 'ENOENT') continue;
      if (yieldControl && error?.code?.startsWith('COMPUTE_')) throw error;
      // bozuk ana kopyada yedeği dene
    }
  }
  return null;
}

/* İşçi/bellek tahmini için dosyanın çözülmüş (v2 eşdeğeri) bayt boyutu.
   v2: gzip kuyruğundaki ISIZE (açık boyut = çözülmüş boyut). v3: açık dosya
   torba sözlüğü yüzünden küçüktür; başlıktaki decodedBytes kullanılır (yalnız
   ilk birkaç KiB açılır). Dosya yoksa null. ISIZE 4 GiB modülüdür (eskisi gibi). */
const HEADER_PROBE_BYTES = 4096;
const COLUMNAR_HEADER = /^\{"schemaVersion":3,"checksum":"[0-9a-f]{64}","contentKey":"[0-9a-f]*","decodedBytes":(\d{1,15}),"payload":/;
function columnarDecodedBytesHint(compressedHead) {
  try {
    const head = zlib.gunzipSync(compressedHead, { finishFlush:zlib.constants.Z_SYNC_FLUSH });
    const match = COLUMNAR_HEADER.exec(head.subarray(0, 256).toString('latin1'));
    const bytes = match ? Number(match[1]) : 0;
    return Number.isSafeInteger(bytes) && bytes > 0 ? bytes : null;
  } catch (_) { return null; }
}
async function snapshotByteEstimate(file) {
  let handle;
  try {
    handle = await fs.promises.open(file, 'r');
    const { size } = await handle.stat();
    if (size < 4) return null;
    const tail = Buffer.alloc(4);
    await handle.read(tail, 0, 4, size - 4);
    const head = Buffer.alloc(Math.min(size, HEADER_PROBE_BYTES));
    await handle.read(head, 0, head.length, 0);
    return columnarDecodedBytesHint(head) || tail.readUInt32LE(0);
  } catch (error) {
    if (error && error.code === 'ENOENT') return null;
    throw error;
  } finally { await handle?.close(); }
}

module.exports = {
  SNAPSHOT_ROOT, SNAPSHOT_SCHEMA_VERSION, COLUMNAR_SNAPSHOT_SCHEMA_VERSION, snapshotPath,
  LEGACY_V2_SCHEMA_VERSION, encodeColumnarSnapshot, encodeLegacyV2Snapshot, snapshotByteEstimate, decodeSnapshotRawAsync,
  compactSnapshotPayload, expandSnapshotPayload, reviveSnapshotDates,
  saveModelSnapshot, saveModelSnapshotAsync, loadModelSnapshot, loadModelSnapshotAsync,
};
