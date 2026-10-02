'use strict';

/*
 * Backlog Planlanan & Gerçekleşen Analizi
 * ----------------------------------------
 * Tam Backlog kopyalarını çoğaltmak yerine tek kullanıcı dosyasında bir baz
 * snapshot + delta zinciri tutar. Snapshot satırı sipariş/model/renk düzeyinde
 * operasyonel durumu özetler; IAS parsiyelleri status/ETA/Handover miktarları
 * olarak gruplanır. Böylece binlerce değişmeyen satır her yenilemede yeniden
 * yazılmaz.
 *
 * İki veri katmanı bilerek ayrıdır:
 *   1) snapshot farkı = seçilen iki an arasındaki NET durum,
 *   2) Refresh History = aradaki hareket/revizyon trafiği.
 * Bir alan hafta içinde üç kez değişip başlangıç değerine dönerse net farkta
 * kaybolur ama hareket listesinde "geri alındı / 3 revizyon" olarak görünür.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { promisify } = require('util');
const { LOCAL_DATA_ROOT, atomicWriteBufferAsync } = require('../user-data');

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

const ROOT = path.join(LOCAL_DATA_ROOT, 'backlog-plan-actual');
const SCHEMA_VERSION = 1;
const RETENTION_MS = 180 * 24 * 60 * 60 * 1000;
const MAX_SNAPSHOTS = 900;
const writeTails = new Map();

function clean(value) { return String(value == null ? '' : value).trim(); }
function safeUserId(value) {
  return clean(value || 'moderator').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 100) || 'moderator';
}
function archivePath(userId) { return path.join(ROOT, `${safeUserId(userId)}.json.gz`); }
function upper(value) { return clean(value).toLocaleUpperCase('tr-TR'); }
function lineId(orderCode, modelName, colourCode) {
  return [upper(orderCode), upper(modelName), upper(colourCode)].join('\u001f');
}
/* Takvim günü (YYYY-MM-DD). server.js dateOnlyISO ile aynı kural:
   yerel gece yarısı → yerel gün; yalnız UTC gece yarısı → UTC gün.
   ISO zaman damgası METNİ (ör. model snapshot'ından JSON ile dönen
   "2026-03-09T21:00:00.000Z" = TR'de 10.03 gece yarısı) önce Date'e çevrilir.
   Eskiden metnin ilk 10 karakteri alınıyordu; UTC+3'te bu, soğuk açılıştan
   sonra alınan snapshot'larda bütün tarihleri bir gün geri kaydırıyordu. */
function calendarDay(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  const localMidnight = date.getHours() === 0 && date.getMinutes() === 0 && date.getSeconds() === 0 && date.getMilliseconds() === 0;
  const utcMidnight = date.getUTCHours() === 0 && date.getUTCMinutes() === 0 && date.getUTCSeconds() === 0 && date.getUTCMilliseconds() === 0;
  const useUtc = utcMidnight && !localMidnight;
  const p = n => String(n).padStart(2, '0');
  return useUtc
    ? `${date.getUTCFullYear()}-${p(date.getUTCMonth() + 1)}-${p(date.getUTCDate())}`
    : `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}
function dateIso(value) {
  if (!value) return '';
  if (value instanceof Date) return calendarDay(value);
  const raw = clean(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(raw)) {
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) return calendarDay(parsed);
  }
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const compact = raw.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}`;
  const tr = raw.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})$/);
  if (tr) return `${tr[3]}-${String(tr[2]).padStart(2, '0')}-${String(tr[1]).padStart(2, '0')}`;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return raw;
  return calendarDay(parsed);
}
function dayOrdinal(value) {
  const iso = dateIso(value);
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? Math.floor(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86400000) : null;
}
function number(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}
function round(value) { return Math.round((number(value) + Number.EPSILON) * 100) / 100; }
function sortedObject(input) {
  return Object.fromEntries(Object.entries(input || {}).filter(([, value]) => number(value) !== 0)
    .sort(([a], [b]) => a.localeCompare(b, 'tr', { numeric: true, sensitivity: 'base' })));
}
function addBucket(target, key, qty) {
  const k = clean(key) || '(boş)';
  target[k] = round(number(target[k]) + number(qty));
}
function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function sourceOrderKey(order) {
  return lineId(order && order.ocode, order && order.model, order && order.ccode);
}
function templateRowKey(row) {
  return lineId(row && row['Sipariş Kod'], row && row['Model Adı'], row && row['Renk Kod']);
}

function projectSnapshot(orders, templateRows, meta = {}) {
  // Önce yalnız kaynak kimlik/plan sözlüğünü kur. Snapshot'ın satır kümesi
  // templateRows tarafından belirlenir; böylece ASAS'ta var ama kanonik Backlog'a
  // girmeyen bir sipariş analizde hayalet kayıt olarak görünmez.
  const sourceOrders = new Map();
  for (const order of Array.isArray(orders) ? orders : []) {
    const id = sourceOrderKey(order);
    if (clean(order && order.ocode)) sourceOrders.set(id, order);
  }

  const map = new Map();
  for (const row of Array.isArray(templateRows) ? templateRows : []) {
    const id = templateRowKey(row);
    const order = sourceOrders.get(id) || null;
    let item = map.get(id);
    if (!item) {
      item = {
        id,
        orderCode: clean(order ? order.ocode : row['Sipariş Kod']),
        modelName: clean(order ? order.model : row['Model Adı']),
        colourCode: clean(order ? order.ccode : row['Renk Kod']),
        colour: clean(order ? order.colour : row.Renk),
        buyer: clean(order ? order.buyer : row.Buyer),
        buyingGroup: clean(order ? order.buyerGrup : row['Buyer Grup (TR)']),
        manufacturer: clean(order ? order.manufacturer : row['Üretici']),
        subMfr: clean(row['Alt Üretici']),
        season: clean(order ? order.season : row.Sezon),
        mag: clean(order && order.merch),
        mmyg: clean(order && order.ageGroup),
        // Product Main Definition, ASAS kanonik productDescription alanından okunur
        // (canonical-fields: productMainDefinition ↔ asasProductDescription).
        productMainDefinition: clean(order && order.productDescription),
        category: clean(order ? order.category : row['Ürün Klasman']),
        country: clean(order ? order.countryRaw : row['Siparişin Üretildiği Ülke']),
        license: clean(order ? order.license : row.Lisans),
        line: clean(order ? order.line : row.Line),
        specialCode: clean(order ? order.ozel : row['Özel Kod 1']),
        originalExFactory: dateIso(order ? (order._asasEx || order.ex) : row['Orijinal Exfactory Merch Tarih']),
        // Planlanan Ex-Factory kaynak siparişin etkin Buyer Log tarihidir.
        // Parsiyelin gerçekleşen yüklemesi ayrı handover/loadDates alanlarında
        // tutulur; görünür Revised Shipment Date alanıyla karıştırılmaz.
        planExFactory: order ? dateIso(order.ex) : '',
        retail: dateIso(order ? order.retail : row['Retail Depo Tarih Yıl Ay Gün']),
        inStore: dateIso(order ? order.mb : row['Model Bütçe Tarih Yıl Ay Gün']),
        orderQty: Math.max(0, number(order ? order.qty : row['Net Alım Sipariş Miktarı'])),
        remainingQty: 0,
        receivedQty: 0,
        warehouseQty: 0,
        riskQty: 0,
        statuses: {},
        etaDates: {},
        handoverDates: {},
        // Gerçekleşen yükleme günü: parsiyelin fiili yükleme tarihi, yoksa
        // Handover. Handover boş gelen IAS'larda yüklemenin "0 adet" görünmesini önler.
        loadDates: {},
        deliveryTypes: {},
      };
      map.set(id, item);
    }
    const qty = Math.max(0, number(row.Adet));
    item.subMfr = item.subMfr || clean(row['Alt Üretici']);
    item.orderQty = Math.max(item.orderQty, Math.max(0, number(row['Net Alım Sipariş Miktarı'])));
    // ASAS kalan miktarı siparişin satırlarına dağıtılmış paydır; toplamı ASAS değeridir.
    item.remainingQty = round(item.remainingQty + Math.max(0, number(row['Kalan Alım Sipariş Miktarı'])));
    item.receivedQty = round(item.receivedQty + Math.max(0, number(row['Net Gelen Alım Sipariş Miktarı'])));
    item.warehouseQty = round(item.warehouseQty + Math.max(0, number(row['Gelen Alım Sipariş Miktarı Merkez Sevke Hazır Depo'])));
    if (clean(row['RİSK\n(PRIORITY)']).toLocaleUpperCase('tr-TR') === 'VAR') item.riskQty = round(item.riskQty + qty);
    addBucket(item.statuses, row['GÜNCEL DURUM\n(STATUS)'], qty);
    const eta = dateIso(row['ANTREPO GİRİŞ TARİHİ']);
    if (eta) addBucket(item.etaDates, eta, qty);
    const internal = row._backlogExcel && typeof row._backlogExcel === 'object' ? row._backlogExcel : {};
    const handover = dateIso(internal.handoverDate);
    if (handover) addBucket(item.handoverDates, handover, qty);
    const loaded = dateIso(internal.actualLoadDate) || handover;
    if (loaded) addBucket(item.loadDates, loaded, qty);
    const delType = clean(row['YÜKLEME TİPİ']);
    if (delType) addBucket(item.deliveryTypes, delType, qty);
  }

  const rows = [...map.values()].map(item => ({
    ...item,
    statuses: sortedObject(item.statuses),
    etaDates: sortedObject(item.etaDates),
    handoverDates: sortedObject(item.handoverDates),
    loadDates: sortedObject(item.loadDates),
    deliveryTypes: sortedObject(item.deliveryTypes),
    receivedQty: round(item.receivedQty),
    warehouseQty: round(item.warehouseQty),
    remainingQty: round(item.remainingQty),
    riskQty: round(item.riskQty),
  })).sort((a, b) => a.id.localeCompare(b.id));

  return {
    capturedAt: meta.capturedAt || new Date().toISOString(),
    sourceGenerationId: clean(meta.sourceGenerationId),
    rows,
  };
}
function emptyArchive() {
  return { schemaVersion: SCHEMA_VERSION, base: null, deltas: [] };
}
async function readArchive(userId) {
  const file = archivePath(userId);
  for (const candidate of [file, file + '.bak']) {
    try {
      const raw = await gunzip(await fs.promises.readFile(candidate));
      const parsed = JSON.parse(raw.toString('utf8'));
      if (!parsed || parsed.schemaVersion !== SCHEMA_VERSION) continue;
      if (!parsed.base || !Array.isArray(parsed.base.rows)) return emptyArchive();
      return { schemaVersion: SCHEMA_VERSION, base: parsed.base, deltas: Array.isArray(parsed.deltas) ? parsed.deltas : [] };
    } catch (error) {
      if (error && error.code === 'ENOENT') continue;
    }
  }
  return emptyArchive();
}
async function writeArchive(userId, archive) {
  const body = Buffer.from(JSON.stringify(archive), 'utf8');
  const compressed = await gzip(body, { level: 6 });
  await atomicWriteBufferAsync(archivePath(userId), compressed);
  return { bytes: compressed.length, uncompressedBytes: body.length };
}
function rowsMap(rows) {
  return new Map((Array.isArray(rows) ? rows : []).filter(row => row && row.id).map(row => [row.id, row]));
}
function applyDeltaToMap(state, delta) {
  for (const id of Array.isArray(delta && delta.removed) ? delta.removed : []) state.delete(id);
  for (const row of Array.isArray(delta && delta.upserts) ? delta.upserts : []) if (row && row.id) state.set(row.id, row);
  return state;
}
function deltaBetween(beforeRows, afterRows) {
  const before = rowsMap(beforeRows), after = rowsMap(afterRows), upserts = [], removed = [];
  for (const [id, row] of after) {
    const old = before.get(id);
    if (!old || !same(old, row)) upserts.push(row);
  }
  for (const id of before.keys()) if (!after.has(id)) removed.push(id);
  return { upserts, removed };
}
function latestRows(archive) {
  if (!archive || !archive.base) return [];
  const state = rowsMap(archive.base.rows);
  for (const delta of archive.deltas || []) applyDeltaToMap(state, delta);
  return [...state.values()];
}
function markerList(archive) {
  if (!archive || !archive.base) return [];
  return [
    { capturedAt: archive.base.capturedAt, sourceGenerationId: archive.base.sourceGenerationId || '', index: 0 },
    ...(archive.deltas || []).map((delta, index) => ({ capturedAt: delta.capturedAt, sourceGenerationId: delta.sourceGenerationId || '', index: index + 1 })),
  ];
}
function rowsAtMarker(archive, markerIndex) {
  if (!archive || !archive.base || markerIndex < 0) return [];
  const state = rowsMap(archive.base.rows);
  const last = Math.min((archive.deltas || []).length, markerIndex);
  for (let index = 0; index < last; index += 1) applyDeltaToMap(state, archive.deltas[index]);
  return [...state.values()];
}
function pruneArchive(archive, nowMs = Date.now()) {
  const markers = markerList(archive);
  if (markers.length <= 1) return archive;
  const cutoff = nowMs - RETENTION_MS;
  let keepIndex = 0;
  while (keepIndex < markers.length - 1 && Date.parse(markers[keepIndex].capturedAt || '') < cutoff) keepIndex += 1;
  keepIndex = Math.max(keepIndex, markers.length - MAX_SNAPSHOTS);
  if (keepIndex <= 0) return archive;
  const rebasedRows = rowsAtMarker(archive, keepIndex);
  return {
    schemaVersion: SCHEMA_VERSION,
    base: { capturedAt: markers[keepIndex].capturedAt, sourceGenerationId: markers[keepIndex].sourceGenerationId || '', rows: rebasedRows },
    deltas: (archive.deltas || []).slice(keepIndex),
  };
}

async function appendSnapshot(userId, snapshot) {
  const key = safeUserId(userId);
  const previous = writeTails.get(key) || Promise.resolve();
  const next = previous.catch(() => {}).then(async () => {
    let archive = await readArchive(userId);
    if (!archive.base) {
      archive.base = { capturedAt: snapshot.capturedAt, sourceGenerationId: snapshot.sourceGenerationId || '', rows: snapshot.rows || [] };
    } else {
      const prevRows = latestRows(archive);
      const delta = deltaBetween(prevRows, snapshot.rows || []);
      archive.deltas.push({
        capturedAt: snapshot.capturedAt,
        sourceGenerationId: snapshot.sourceGenerationId || '',
        upserts: delta.upserts,
        removed: delta.removed,
      });
    }
    archive = pruneArchive(archive);
    const saved = await writeArchive(userId, archive);
    return { ...saved, snapshots: markerList(archive).length, capturedAt: snapshot.capturedAt };
  });
  writeTails.set(key, next);
  return next.finally(() => { if (writeTails.get(key) === next) writeTails.delete(key); });
}

function resolveMarker(archive, requestedAt, side) {
  const markers = markerList(archive);
  if (!markers.length) return null;
  const requested = Date.parse(requestedAt || '');
  if (!Number.isFinite(requested)) return side === 'start' ? markers[0] : markers[markers.length - 1];
  let before = null;
  for (const marker of markers) {
    const at = Date.parse(marker.capturedAt || '');
    if (!Number.isFinite(at)) continue;
    if (at <= requested) before = marker;
    else break;
  }
  if (before) return before;
  return markers[0];
}
/* -------------------------------------------------------------------------
   Geçmiş arşiv onarımı (okuma anında, diske yazmadan).
   7.0.204 ve öncesinde soğuk açılıştan (model snapshot'ı) sonra alınan
   snapshot'larda ASAS/IAS kaynaklı bütün tarihler bir gün geri yazıldı.
   Böyle bir delta, satırların büyük çoğunluğunda Retail ve In Store'un AYNI
   ANDA tam ±1 gün kaymasıyla tanınır (gerçek iş değişikliği bu ikisini toplu
   ve birlikte bir gün oynatmaz). Kayma adımları zincirlenir; en yüksek ofset
   doğru kabul edilir ve kaymış snapshot satırları okunurken düzeltilir. */
const SHIFT_FIELDS = ['planExFactory', 'originalExFactory', 'retail', 'inStore'];
const SHIFT_BUCKETS = ['handoverDates', 'loadDates'];
function addDays(iso, days) {
  const ord = dayOrdinal(iso);
  return ord == null ? iso : new Date((ord + days) * 86400000).toISOString().slice(0, 10);
}
function shiftBuckets(buckets, days) {
  const out = {};
  for (const [key, qty] of Object.entries(buckets || {})) { const k = addDays(key, days); out[k] = round(number(out[k]) + number(qty)); }
  return sortedObject(out);
}
function deltaShiftStep(prevState, delta) {
  let total = 0, minus = 0, plus = 0;
  for (const row of Array.isArray(delta && delta.upserts) ? delta.upserts : []) {
    const old = row && prevState.get(row.id);
    if (!old) continue;
    let diff = null, consistent = true;
    for (const field of ['retail', 'inStore']) {
      const a = dayOrdinal(old[field]), b = dayOrdinal(row[field]);
      if (a == null || b == null) continue;
      if (diff == null) diff = b - a; else if (diff !== b - a) consistent = false;
    }
    if (diff == null) continue;
    total += 1;
    if (!consistent) continue;
    if (diff === -1) minus += 1; else if (diff === 1) plus += 1;
  }
  if (total < Math.max(20, prevState.size * 0.3)) return 0;
  if (minus / total >= 0.6) return -1;
  if (plus / total >= 0.6) return 1;
  return 0;
}
function markerDayOffsets(archive) {
  const markers = markerList(archive), offsets = new Array(markers.length).fill(0);
  if (!archive || !archive.base) return offsets;
  const state = rowsMap(archive.base.rows);
  let current = 0;
  (archive.deltas || []).forEach((delta, index) => {
    current += deltaShiftStep(state, delta);
    offsets[index + 1] = current;
    applyDeltaToMap(state, delta);
  });
  const max = Math.max(...offsets);
  return offsets.map(offset => offset - max);
}
function repairRow(row, offset, previous) {
  if (!offset || !row) return row;
  const shift = -offset, out = { ...row };
  for (const field of SHIFT_FIELDS) if (out[field]) out[field] = addDays(out[field], shift);
  for (const field of SHIFT_BUCKETS) if (out[field]) out[field] = shiftBuckets(out[field], shift);
  // Antrepo girişinin bir kısmı hesaplanmış (kaymamış) tarihtir. Yalnız önceki
  // doğru durumda karşılığı olan anahtarlar düzeltilir.
  if (out.etaDates && previous && previous.etaDates) {
    const fixed = {}, prev = previous.etaDates, has = key => Object.prototype.hasOwnProperty.call(prev, key);
    for (const [key, qty] of Object.entries(out.etaDates)) {
      const moved = addDays(key, shift), target = has(moved) && !has(key) ? moved : key;
      fixed[target] = round(number(fixed[target]) + number(qty));
    }
    out.etaDates = sortedObject(fixed);
  }
  return out;
}
function repairedRowsAtMarker(archive, markerIndex, offsets) {
  if (!archive || !archive.base || markerIndex < 0) return [];
  const list = offsets || markerDayOffsets(archive);
  const fixed = new Map();
  for (const row of archive.base.rows || []) if (row && row.id) fixed.set(row.id, repairRow(row, list[0], null));
  const last = Math.min((archive.deltas || []).length, markerIndex);
  for (let index = 0; index < last; index += 1) {
    const delta = archive.deltas[index], offset = list[index + 1];
    for (const id of Array.isArray(delta && delta.removed) ? delta.removed : []) fixed.delete(id);
    for (const row of Array.isArray(delta && delta.upserts) ? delta.upserts : []) if (row && row.id) fixed.set(row.id, repairRow(row, offset, fixed.get(row.id)));
  }
  return [...fixed.values()];
}

function resolveRange(archive, from, to) {
  if (!archive || !archive.base) return { start: null, end: null, coverage: null };
  const start = resolveMarker(archive, from, 'start');
  const end = resolveMarker(archive, to, 'end');
  const markers = markerList(archive);
  const offsets = markerDayOffsets(archive);
  const repairedMarkers = offsets.filter(offset => offset !== 0).length;
  return {
    start: start ? { ...start, rows: repairedRowsAtMarker(archive, start.index, offsets), dateRepair: offsets[start.index] || 0 } : null,
    end: end ? { ...end, rows: repairedRowsAtMarker(archive, end.index, offsets), dateRepair: offsets[end.index] || 0 } : null,
    repairedMarkers,
    coverage: markers.length ? { from: markers[0].capturedAt, to: markers[markers.length - 1].capturedAt, snapshotCount: markers.length } : null,
  };
}

function mapText(value) {
  const entries = Object.entries(value || {}).filter(([, qty]) => number(qty) > 0);
  return entries.map(([key, qty]) => `${key} · ${round(qty)}`).join(' | ');
}
function firstDateBucket(value) {
  const keys = Object.keys(value || {}).filter(Boolean).sort();
  return keys.length ? keys[0] : '';
}
function bucketAdded(before, after) {
  const out = [];
  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  for (const key of keys) {
    const delta = round(number(after && after[key]) - number(before && before[key]));
    if (delta > 0) out.push({ value: key, qty: delta });
  }
  return out;
}
function categoryForField(field) {
  const key = upper(field).replace(/İ/g, 'I');
  if (key.includes('EX-FACTORY') || key.includes('EXFACTORY') || key.includes('HANDOVER')) return 'exfactory';
  if (key.includes('ANTREPO') && (key.includes('TARIH') || key.includes('GIRIS') || key.includes('ARRIVAL'))) return 'eta';
  if (key.includes('DURUM') || key.includes('STATU') || key.includes('STATUS')) return 'status';
  if (key.includes('ADET') || key.includes('MIKTAR') || key.includes('KALAN') || key.includes('QUANTITY')) return 'quantity';
  if (key.includes('RETAIL') || key.includes('BUTCE') || key.includes('OPD') || key.includes('ONAY') || key.includes('TARIH')) return 'dates';
  if (key.includes('FOB') || key.includes('URETICI') || key.includes('SEZON') || key.includes('BUYER') || key.includes('MAG') || key.includes('MMYG')) return 'commercial';
  return 'other';
}
function historyLineId(detail) {
  return lineId(detail && detail.ocode, detail && detail.modelName, detail && detail.colourCode);
}
function collapseHistory(items, from, to) {
  const fromMs = Date.parse(from || ''), toMs = Date.parse(to || '');
  const grouped = new Map(), raw = [];
  const sortedItems = (Array.isArray(items) ? items : []).slice().sort((a, b) => Date.parse(a.createdAt || '') - Date.parse(b.createdAt || ''));
  for (const item of sortedItems) {
    const at = Date.parse(item && item.createdAt || '');
    if (Number.isFinite(fromMs) && at <= fromMs) continue;
    if (Number.isFinite(toMs) && at > toMs) continue;
    for (const detail of Array.isArray(item && item.details) ? item.details : []) {
      const field = clean(detail.field || detail.changeType || 'Değişiklik');
      const line = historyLineId(detail);
      const key = `${line}\u001e${upper(field)}`;
      const event = {
        at: item.createdAt, lineId: line, source: clean(detail.source), field,
        category: categoryForField(field), before: clean(detail.before), after: clean(detail.after),
        orderCode: clean(detail.ocode), modelName: clean(detail.modelName), colourCode: clean(detail.colourCode), colour: clean(detail.colour),
        buyer: clean(detail.buyer), buyingGroup: clean(detail.buyingGroup), manufacturer: clean(detail.manufacturer),
        subMfr: clean(detail.subMfr), season: clean(detail.season), mag: clean(detail.mag), mmyg: clean(detail.mmyg),
      };
      raw.push(event);
      if (!grouped.has(key)) grouped.set(key, { ...event, firstAt: event.at, lastAt: event.at, firstBefore: event.before, lastAfter: event.after, eventCount: 0, path: [] });
      const agg = grouped.get(key);
      agg.lastAt = event.at; agg.lastAfter = event.after; agg.eventCount += 1;
      agg.path.push({ at: event.at, before: event.before, after: event.after });
      for (const name of ['buyer','buyingGroup','manufacturer','subMfr','season','mag','mmyg','modelName','colourCode','colour']) if (!agg[name] && event[name]) agg[name] = event[name];
    }
  }
  const activity = [...grouped.values()].map(item => ({
    ...item,
    reverted: item.eventCount > 1 && item.firstBefore === item.lastAfter,
    repeated: item.eventCount > 1,
  })).sort((a, b) => b.eventCount - a.eventCount || Date.parse(b.lastAt || '') - Date.parse(a.lastAt || ''));
  return { activity, rawEvents: raw };
}

function dayIso(ordinal) {
  if (ordinal == null) return '';
  return new Date(ordinal * 86400000).toISOString().slice(0, 10);
}
function bucketTotal(map) {
  return round(Object.values(map || {}).reduce((total, value) => total + number(value), 0));
}
// Satırın henüz yüklenmemiş adedi: operasyon satırlarının toplamından IAS'a
// bağlanmış (yüklenmiş) adet düşülür. ASAS "Kalan" değeri depoya girişe kadar
// düşmediği için yükleme açığını ölçmekte kullanılamaz; yalnız eski/boş
// statü kovası olan snapshotlarda yedek olarak okunur.
function openQty(row) {
  if (!row) return 0;
  const total = bucketTotal(row.statuses);
  if (total > 0) return round(Math.max(0, total - number(row.receivedQty)));
  return round(Math.max(0, number(row.remainingQty)));
}
// İki snapshot arasında gerçekleşen yükleme. Tarihli kısım loadDates
// kovalarından gelir; IAS'ı olup tarihi olmayan yükleme receivedQty artışıyla
// yakalanır ve "tarihsiz" sayılır. loadDates alanı olmayan eski snapshotlarda
// önceki Handover davranışı korunur.
function periodLoads(a, b) {
  if (!b) return { dated: [], loadedQty: 0, undatedQty: 0 };
  const legacy = Boolean(a) && a.loadDates === undefined;
  const beforeBuckets = !a ? {} : (legacy ? a.handoverDates : a.loadDates);
  const afterBuckets = legacy ? b.handoverDates : (b.loadDates || b.handoverDates);
  const added = bucketAdded(beforeBuckets, afterBuckets).sort((x, y) => String(x.value).localeCompare(String(y.value)));
  const addedQty = round(added.reduce((total, item) => total + item.qty, 0));
  let loadedQty = addedQty;
  if (a && !legacy) {
    // Tarihi düzeltilen parsiyel yeni yükleme sayılmaz: net artış ve IAS artışı esas alınır.
    const netDated = Math.max(0, bucketTotal(afterBuckets) - bucketTotal(beforeBuckets));
    const received = Math.max(0, number(b.receivedQty) - number(a.receivedQty));
    loadedQty = round(Math.max(netDated, received));
  } else if (a) {
    loadedQty = round(Math.max(addedQty, Math.max(0, number(b.receivedQty) - number(a.receivedQty))));
  }
  const dated = [];
  let left = loadedQty;
  for (const item of added) {
    if (left <= 0) break;
    const qty = round(Math.min(item.qty, left));
    dated.push({ value: item.value, qty });
    left = round(left - qty);
  }
  return { dated, loadedQty, undatedQty: round(Math.max(0, left)) };
}
const PLAN_OUTCOMES = Object.freeze(['notLoaded', 'partial', 'late', 'pending', 'onTime', 'removed']);
const PLAN_OUTCOME_ORDER = Object.freeze(Object.fromEntries(PLAN_OUTCOMES.map((key, index) => [key, index])));
function planRowFor(id, a, b, ctx) {
  const preferred = b || a;
  const planned = ctx.plannedQty, realized = ctx.realizedPlannedQty;
  const onTime = round(Math.min(ctx.onTimeQty, realized));
  const late = round(Math.min(ctx.lateQty, realized - onTime));
  const undated = round(Math.max(0, realized - onTime - late));
  const open = round(Math.max(0, planned - realized));
  const overdue = Boolean(b) && open > 0 && ctx.planDay != null && ctx.asOfDay != null && ctx.planDay < ctx.asOfDay;
  let outcome;
  if (!b) outcome = 'removed';
  else if (open > 0) outcome = realized > 0 ? 'partial' : (overdue ? 'notLoaded' : 'pending');
  else outcome = late > 0 ? 'late' : 'onTime';
  const currentPlan = b ? b.planExFactory : '';
  const d0 = dayOrdinal(a.planExFactory), d1 = dayOrdinal(currentPlan);
  return {
    id,
    orderCode: preferred.orderCode || '', modelName: preferred.modelName || '', colourCode: preferred.colourCode || '', colour: preferred.colour || '',
    buyer: preferred.buyer || '', buyingGroup: preferred.buyingGroup || '', manufacturer: preferred.manufacturer || '', subMfr: preferred.subMfr || '',
    season: preferred.season || '', mag: preferred.mag || '', mmyg: preferred.mmyg || '', country: preferred.country || '',
    productMainDefinition: preferred.productMainDefinition || '', category: preferred.category || '',
    planDate: a.planExFactory || '', currentPlanDate: currentPlan || '',
    planShiftDays: d0 != null && d1 != null ? d1 - d0 : null,
    plannedQty: planned, loadedQty: realized, onTimeQty: onTime, lateQty: late, undatedQty: undated,
    openQty: outcome === 'removed' ? 0 : open, removedQty: outcome === 'removed' ? open : 0,
    overdue, overdueDays: overdue ? ctx.asOfDay - ctx.planDay : 0,
    lateDays: late > 0 ? ctx.maxLateDays : 0,
    lastLoadDate: ctx.lastLoad || '',
    status: b ? mapText(b.statuses) : '',
    eta: b ? firstDateBucket(b.etaDates) : '',
    outcome,
  };
}
function summarizePlan(rows) {
  const out = { lines: 0, plannedQty: 0, loadedQty: 0, onTimeQty: 0, lateQty: 0, undatedQty: 0, openQty: 0, overdueOpenQty: 0, pendingOpenQty: 0, removedQty: 0, overdueLines: 0, outcomes: {} };
  for (const key of PLAN_OUTCOMES) out.outcomes[key] = 0;
  for (const row of rows || []) {
    out.lines += 1;
    out.outcomes[row.outcome] = (out.outcomes[row.outcome] || 0) + 1;
    for (const key of ['plannedQty', 'loadedQty', 'onTimeQty', 'lateQty', 'undatedQty', 'openQty', 'removedQty']) out[key] = round(out[key] + number(row[key]));
    if (row.overdue) { out.overdueOpenQty = round(out.overdueOpenQty + number(row.openQty)); out.overdueLines += 1; }
    else out.pendingOpenQty = round(out.pendingOpenQty + number(row.openQty));
  }
  out.realisationPct = out.plannedQty > 0 ? Math.round((out.loadedQty / out.plannedQty) * 1000) / 10 : null;
  out.onTimePct = out.plannedQty > 0 ? Math.round((out.onTimeQty / out.plannedQty) * 1000) / 10 : null;
  return out;
}

function fieldChange(label, category, before, after, days) {
  return { label, category, before: before == null ? '' : before, after: after == null ? '' : after, days: Number.isFinite(days) ? days : null };
}
function compareSnapshots(startRows, endRows, options = {}) {
  const before = rowsMap(startRows), after = rowsMap(endRows);
  const activity = Array.isArray(options.activity) ? options.activity : [];
  const activityByLine = new Map();
  for (const item of activity) {
    if (!activityByLine.has(item.lineId)) activityByLine.set(item.lineId, []);
    activityByLine.get(item.lineId).push(item);
  }
  const ids = new Set([...before.keys(), ...after.keys()]);
  const changes = [];
  const summary = {
    changedOrders: 0, addedOrders: 0, removedOrders: 0,
    exFactoryDelayed: 0, exFactoryAdvanced: 0, statusChanged: 0, etaChanged: 0, etaDelayed: 0,
    quantityChanged: 0, actualLoadedQty: 0, onTimeLoadedQty: 0, lateLoadedQty: 0,
    plannedQty: 0, realizedPlannedQty: 0, planGapQty: 0,
    repeatedRevisionGroups: activity.filter(item => item.repeated).length,
    revertedRevisionGroups: activity.filter(item => item.reverted).length,
  };
  const fromDay = dayOrdinal(options.from), toDay = dayOrdinal(options.to);
  // Plan penceresi analiz döneminden bağımsız seçilebilir (ör. "1-15 Ekim'de
  // yüklenmesi planlananlar"). Verilmezse analiz dönemiyle aynıdır.
  const planFromDay = dayOrdinal(options.planFrom) != null ? dayOrdinal(options.planFrom) : fromDay;
  const planToDay = dayOrdinal(options.planTo) != null ? dayOrdinal(options.planTo) : toDay;
  // "Tarihi geçmiş" kararı bitiş snapshotının günü (veya verilen asOf) ile yapılır.
  const asOfDay = dayOrdinal(options.asOf) != null ? dayOrdinal(options.asOf) : toDay;
  const planRows = [];

  for (const id of ids) {
    const a = before.get(id), b = after.get(id), preferred = b || a;
    const fields = [], categories = new Set();
    if (!a && b) {
      fields.push(fieldChange('Backlog kaydı', 'record', '', 'Yeni kayıt')); categories.add('record'); summary.addedOrders += 1;
    } else if (a && !b) {
      fields.push(fieldChange('Backlog kaydı', 'record', 'Mevcut kayıt', 'Artık görünmüyor')); categories.add('record'); summary.removedOrders += 1;
    }
    if (a && b) {
      if (a.planExFactory !== b.planExFactory) {
        const d0 = dayOrdinal(a.planExFactory), d1 = dayOrdinal(b.planExFactory), days = d0 != null && d1 != null ? d1 - d0 : null;
        fields.push(fieldChange('Planlanan Ex-Factory', 'exfactory', a.planExFactory, b.planExFactory, days)); categories.add('exfactory');
        if (days > 0) summary.exFactoryDelayed += 1;
        if (days < 0) summary.exFactoryAdvanced += 1;
      }
      if (a.retail !== b.retail) fields.push(fieldChange('Retail', 'dates', a.retail, b.retail, (dayOrdinal(a.retail) != null && dayOrdinal(b.retail) != null) ? dayOrdinal(b.retail) - dayOrdinal(a.retail) : null)), categories.add('dates');
      if (a.inStore !== b.inStore) fields.push(fieldChange('In Store', 'dates', a.inStore, b.inStore, (dayOrdinal(a.inStore) != null && dayOrdinal(b.inStore) != null) ? dayOrdinal(b.inStore) - dayOrdinal(a.inStore) : null)), categories.add('dates');
      if (a.orderQty !== b.orderQty || a.remainingQty !== b.remainingQty || a.receivedQty !== b.receivedQty) {
        fields.push(fieldChange('Miktar', 'quantity', `Sipariş ${a.orderQty} · Kalan ${a.remainingQty} · Yüklenen ${a.receivedQty}`, `Sipariş ${b.orderQty} · Kalan ${b.remainingQty} · Yüklenen ${b.receivedQty}`));
        categories.add('quantity'); summary.quantityChanged += 1;
      }
      if (!same(a.statuses, b.statuses)) {
        fields.push(fieldChange('Operasyonel durum', 'status', mapText(a.statuses), mapText(b.statuses))); categories.add('status'); summary.statusChanged += 1;
      }
      if (!same(a.etaDates, b.etaDates)) {
        const oldEta = firstDateBucket(a.etaDates), newEta = firstDateBucket(b.etaDates);
        const days = dayOrdinal(oldEta) != null && dayOrdinal(newEta) != null ? dayOrdinal(newEta) - dayOrdinal(oldEta) : null;
        fields.push(fieldChange('Tahmini Antrepo Giriş', 'eta', mapText(a.etaDates), mapText(b.etaDates), days)); categories.add('eta'); summary.etaChanged += 1;
        if (days > 0) summary.etaDelayed += 1;
      }
      if (!same(a.handoverDates, b.handoverDates)) {
        fields.push(fieldChange('Gerçekleşen yükleme / Handover', 'exfactory', mapText(a.handoverDates), mapText(b.handoverDates))); categories.add('exfactory');
      }
      if (a.manufacturer !== b.manufacturer) fields.push(fieldChange('Üretici', 'commercial', a.manufacturer, b.manufacturer)), categories.add('commercial');
    }

    const loads = periodLoads(a, b);
    const planDay = dayOrdinal(a ? a.planExFactory : b && b.planExFactory);
    let onTimeQty = 0, lateQty = 0, maxLateDays = 0, lastLoad = '';
    for (const load of loads.dated) {
      const actualDay = dayOrdinal(load.value);
      if (!lastLoad || load.value > lastLoad) lastLoad = load.value;
      if (planDay == null || actualDay == null) continue;
      if (actualDay <= planDay) onTimeQty += load.qty;
      else { lateQty += load.qty; maxLateDays = Math.max(maxLateDays, actualDay - planDay); }
    }
    const loadedQty = loads.loadedQty;
    onTimeQty = round(onTimeQty); lateQty = round(lateQty);
    summary.actualLoadedQty = round(summary.actualLoadedQty + loadedQty);
    summary.onTimeLoadedQty = round(summary.onTimeLoadedQty + onTimeQty);
    summary.lateLoadedQty = round(summary.lateLoadedQty + lateQty);

    const inPlanWindow = planDay != null && planFromDay != null && planToDay != null && planDay >= planFromDay && planDay <= planToDay;
    let plannedQty = 0, realizedPlannedQty = 0;
    if (a && inPlanWindow) {
      plannedQty = openQty(a);
      if (plannedQty > 0) {
        realizedPlannedQty = round(Math.min(plannedQty, b ? loadedQty : 0));
        summary.plannedQty = round(summary.plannedQty + plannedQty);
        summary.realizedPlannedQty = round(summary.realizedPlannedQty + realizedPlannedQty);
        const planRow = planRowFor(id, a, b, {
          plannedQty, realizedPlannedQty, onTimeQty, lateQty, maxLateDays, lastLoad, planDay, asOfDay,
        });
        planRows.push(planRow);
        if (b && realizedPlannedQty < plannedQty) {
          fields.push(fieldChange(
            'Planlanan yükleme gerçekleşmesi',
            'exfactory',
            `Plan ${round(plannedQty)} adet`,
            `Gerçekleşen ${round(realizedPlannedQty)} adet · Açık ${round(plannedQty - realizedPlannedQty)} adet`
          ));
          categories.add('exfactory');
        }
      }
    }

    const lineActivity = activityByLine.get(id) || [];
    if (lineActivity.length) {
      for (const event of lineActivity) categories.add(event.category);
    }
    if (!fields.length && !lineActivity.length) continue;
    summary.changedOrders += 1;
    changes.push({
      id,
      orderCode: preferred && preferred.orderCode || '',
      modelName: preferred && preferred.modelName || '',
      colourCode: preferred && preferred.colourCode || '',
      colour: preferred && preferred.colour || '',
      buyer: preferred && preferred.buyer || '',
      buyingGroup: preferred && preferred.buyingGroup || '',
      manufacturer: preferred && preferred.manufacturer || '',
      subMfr: preferred && preferred.subMfr || '',
      season: preferred && preferred.season || '',
      mag: preferred && preferred.mag || '',
      mmyg: preferred && preferred.mmyg || '',
      country: preferred && preferred.country || '',
      productMainDefinition: preferred && preferred.productMainDefinition || '',
      category: preferred && preferred.category || '',
      fields,
      categories: [...categories],
      actualLoads: loads.dated,
      planDate: (a ? a.planExFactory : b && b.planExFactory) || '',
      inPlanWindow,
      loadedQty, onTimeQty, lateQty, undatedLoadedQty: loads.undatedQty, plannedQty, realizedPlannedQty,
      activityCount: lineActivity.reduce((total, item) => total + item.eventCount, 0),
      repeatedRevision: lineActivity.some(item => item.repeated),
      revertedRevision: lineActivity.some(item => item.reverted),
    });
  }
  summary.planGapQty = round(Math.max(0, summary.plannedQty - summary.realizedPlannedQty));
  changes.sort((a, b) => (b.lateQty - a.lateQty) || (b.activityCount - a.activityCount) || a.orderCode.localeCompare(b.orderCode, 'tr', { numeric: true }));
  planRows.sort((a, b) => (PLAN_OUTCOME_ORDER[a.outcome] - PLAN_OUTCOME_ORDER[b.outcome]) || (b.overdueDays - a.overdueDays) || (b.openQty - a.openQty) || a.orderCode.localeCompare(b.orderCode, 'tr', { numeric: true }));
  return {
    summary,
    changes,
    plan: {
      window: { from: dayIso(planFromDay), to: dayIso(planToDay), asOf: dayIso(asOfDay) },
      summary: summarizePlan(planRows),
      rows: planRows,
    },
  };
}

function catalogsFromRows(rows) {
  const keys = ['buyer','buyingGroup','manufacturer','subMfr','season','mag','mmyg','country','productMainDefinition','category'];
  const out = {};
  for (const key of keys) out[key] = [...new Set((rows || []).map(row => clean(row && row[key])).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'tr', { numeric: true, sensitivity: 'base' }));
  return out;
}

module.exports = {
  ROOT, SCHEMA_VERSION, RETENTION_MS, MAX_SNAPSHOTS,
  archivePath, lineId, dateIso, dayOrdinal, projectSnapshot,
  readArchive, writeArchive, appendSnapshot, markerList, rowsAtMarker, resolveRange,
  collapseHistory, compareSnapshots, catalogsFromRows, categoryForField,
  PLAN_OUTCOMES, summarizePlan,
  _test: { deltaBetween, latestRows, pruneArchive, rowsMap, bucketAdded, mapText, openQty, periodLoads, markerDayOffsets, repairedRowsAtMarker, calendarDay },
};
