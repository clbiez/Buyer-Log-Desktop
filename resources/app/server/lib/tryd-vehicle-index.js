'use strict';

/* TR/YD Landed Avantaj — sipariş kodu → vasıta (yükleme tipi) eşlemesi.
 *
 * Kaynak: Buyer Log'un kullanıcı runtime'ında zaten yüklü IAS/antrepo haritası
 * (server/lib/parse.js parseAntrepoMatrix: her değer bir IAS parsiyelidir;
 * `ocode`, `vasita` = "Vasita Tanim", `loadedQty` = yükleme adedi, `arr` = tahmini
 * varış). Yeni bir küp bağlantısı AÇILMAZ; FOB Sonrası sorgusunda vasıta yoktur.
 *
 * Sipariş kodu her iki tarafta parse.orderCodeKey ile normalize edilir (ASAS↔IAS
 * eşleşmesiyle aynı kural). Siparişin parsiyelleri vasıtaya göre toplanır:
 *  - yükleme adedi tüm parsiyellerde varsa toplam adet ağırlıktır;
 *  - bir vasıtanın parsiyellerinden birinde adet yoksa o vasıtanın adedi null olur
 *    ve standart hesabı eşit ağırlığa düşer (public/landed-vehicle-standards.js);
 *  - adedi açıkça 0 olan vasıta, siparişin başka bir vasıtasında pozitif adet
 *    varsa düşer (o vasıtayla yükleme yapılmamıştır).
 * Vasıtası boş parsiyel bilinmeyendir; siparişin bütün parsiyelleri boşsa sipariş
 * "vasıta bilinmiyor" olur. Kullanıcının Sipariş Özeti'nde elle girdiği Del. Type
 * (delmap) KULLANILMAZ: kıyas gerçekleşen yükleme tipine dayanır.
 *
 * İndeks haritanın kendisine bağlı WeakMap'te tutulur: harita yenilenince
 * (yeni nesne) indeks yeniden kurulur, aynı haritada istek başına O(1)'dir.
 */

const { orderCodeKey } = require('./parse');
const Vehicles = require('../../public/landed-vehicle-standards');
const trydEngine = require('../../public/tryd-advantage-engine');

const INDEX_CACHE = new WeakMap();

function dayOf(value) {
  if (value == null || value === '') return '';
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : '';
}

function antrepoMapOf(cache) {
  if (!cache || typeof cache !== 'object') return null;
  // TR/YD geçmiş (kapanmış) siparişleri de içerir: Sipariş listesi hedefinin haritası.
  const byTarget = cache.antrepoMapByTarget && typeof cache.antrepoMapByTarget === 'object' ? cache.antrepoMapByTarget : null;
  const map = (byTarget && byTarget.orders && typeof byTarget.orders === 'object' ? byTarget.orders : null) || cache.antrepoMap;
  return map && typeof map === 'object' ? map : null;
}

function buildIndex(antrepoMap) {
  if (!antrepoMap || typeof antrepoMap !== 'object') return { orders: new Map(), parsiyels: 0 };
  const cached = INDEX_CACHE.get(antrepoMap);
  if (cached) return cached;
  const orders = new Map();
  let parsiyels = 0;
  for (const entry of Object.values(antrepoMap)) {
    if (!entry || typeof entry !== 'object') continue;
    const order = orderCodeKey(entry.ocode != null ? entry.ocode : entry._matchOcode);
    if (!order) continue;
    parsiyels += 1;
    let slot = orders.get(order);
    if (!slot) { slot = { parts: new Map(), from: '', to: '' }; orders.set(order, slot); }
    const day = dayOf(entry.arr);
    if (day && (!slot.from || day < slot.from)) slot.from = day;
    if (day && (!slot.to || day > slot.to)) slot.to = day;
    const label = String(entry.vasita == null ? '' : entry.vasita).trim();
    const key = Vehicles.normalizeVehicleKey(label);
    if (!key) continue;
    let part = slot.parts.get(key);
    if (!part) { part = { key, label, qty: 0, count: 0 }; slot.parts.set(key, part); }
    part.count += 1;
    const qty = typeof entry.loadedQty === 'number' && Number.isFinite(entry.loadedQty) && entry.loadedQty >= 0 ? entry.loadedQty : null;
    part.qty = part.qty == null || qty == null ? null : part.qty + qty;
  }
  const index = { orders, parsiyels };
  INDEX_CACHE.set(antrepoMap, index);
  return index;
}

/* Siparişin vasıta parçaları: [{ key, label, qty }] (boş dizi = bilinmiyor). */
function partsOf(index, order) {
  const slot = index && index.orders.get(orderCodeKey(order));
  if (!slot) return [];
  let parts = [...slot.parts.values()];
  if (parts.some(part => part.qty > 0)) parts = parts.filter(part => part.qty !== 0);
  return parts.map(part => ({ key: part.key, label: part.label, qty: part.qty }));
}

/* Yanıt eki: yalnız YD satırlarının siparişleri, ham `order` değeriyle anahtarlı
   (istemci satırın kendi değeriyle birebir okur). Önbelleğe yazılmaz: IAS
   yenilenince güncel vasıta gelir. */
function payloadFor(rows, cache) {
  const map = antrepoMapOf(cache);
  const index = buildIndex(map);
  const byOrder = {};
  const seen = new Set();
  let ydOrders = 0, matched = 0;
  for (const row of Array.isArray(rows) ? rows : []) {
    const raw = String(row && row.order == null ? '' : row.order);
    if (!raw || seen.has(raw) || trydEngine.originClass(row) !== 'yd') continue;
    seen.add(raw);
    ydOrders += 1;
    const parts = partsOf(index, raw);
    if (!parts.length) continue;
    matched += 1;
    byOrder[raw] = parts.map(part => [part.key, part.label, part.qty]);
  }
  return { byOrder, source: { loaded: Boolean(map && index.parsiyels), parsiyels: index.parsiyels, loadedAt: cache && cache.loadedAt ? String(cache.loadedAt) : '' }, ydOrders, matched };
}

/* Landed çarpanları penceresi: veride görülen vasıtalar (IAS). */
function knownVehicles(cache) {
  const index = buildIndex(antrepoMapOf(cache));
  const out = new Map();
  for (const slot of index.orders.values()) {
    for (const part of slot.parts.values()) {
      let item = out.get(part.key);
      if (!item) { item = { key: part.key, label: part.label, labels: new Map(), orders: 0, parsiyels: 0 }; out.set(part.key, item); }
      item.labels.set(part.label, (item.labels.get(part.label) || 0) + part.count);
      item.orders += 1;
      item.parsiyels += part.count;
    }
  }
  return [...out.values()].map(item => ({
    key: item.key,
    label: [...item.labels.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0],
    orders: item.orders, parsiyels: item.parsiyels,
  })).sort((a, b) => b.parsiyels - a.parsiyels || a.key.localeCompare(b.key));
}

/* "Geçmiş veriden öner": eldeki TR/YD (FOB Sonrası) satırlarından, TEK vasıtalı
   siparişlerin geçerli YD satırları (gerçekleşen landed ≥ FOB). Karışık vasıtalı
   sipariş örnek olamaz: landed'i iki yükleme tipini harmanlar. */
function suggestions(rows, cache) {
  const index = buildIndex(antrepoMapOf(cache));
  const samples = [];
  const skipped = { unknownVehicle: 0, mixedVehicle: 0, invalidOrNoLanded: 0 };
  const seasons = new Set();
  let ydRows = 0;
  for (const row of Array.isArray(rows) ? rows : []) {
    if (trydEngine.originClass(row) !== 'yd') continue;
    const status = trydEngine.rowStatus(row, trydEngine.DEFAULT_STANDARD_MULTIPLIER, 'actual');
    if (!status) continue;
    ydRows += 1;
    if (status === trydEngine.STATUS.invalid || status === trydEngine.STATUS.noLanded) { skipped.invalidOrNoLanded += 1; continue; }
    const parts = partsOf(index, row.order);
    if (!parts.length) { skipped.unknownVehicle += 1; continue; }
    if (parts.length > 1) { skipped.mixedVehicle += 1; continue; }
    const slot = index.orders.get(orderCodeKey(row.order));
    if (row.season) seasons.add(String(row.season));
    samples.push({ key: parts[0].key, label: parts[0].label, order: orderCodeKey(row.order), qty: row.qty, ratio: row.landedActual / row.fob, dates: [slot.from, slot.to].filter(Boolean) });
  }
  return {
    items: Vehicles.suggest(samples), ydRows, skipped,
    seasons: [...seasons].sort((a, b) => a.localeCompare(b, 'tr', { numeric: true })),
    thresholds: { rows: Vehicles.MIN_SAMPLE_ROWS, orders: Vehicles.MIN_SAMPLE_ORDERS },
    iasLoaded: index.parsiyels > 0,
  };
}

module.exports = { antrepoMapOf, buildIndex, partsOf, payloadFor, knownVehicles, suggestions };
