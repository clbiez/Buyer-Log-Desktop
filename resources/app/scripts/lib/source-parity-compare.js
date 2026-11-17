'use strict';

/*
 * KAYNAK DOĞRULAMA — SAF KARŞILAŞTIRMA MOTORU
 *
 * scripts/source-parity-check.js bu modülü kullanır. Burada ağ, Excel veya
 * dosya erişimi yoktur; yalnız Buyer Log'un kendi ayrıştırıcılarının ürettiği
 * çıktılar (ASAS sipariş listesi, IAS/Antrepo haritası) karşılaştırılır.
 *
 * İlkeler:
 *  - Excel raporu doğruluk referansıdır. Excel'de olup Database'de olmayan veya
 *    farklı gelen her değer HATA'dır.
 *  - Database'de olup Excel'de olmayan kayıtlar ayrı listelenir (UYARI): çoğu
 *    zaman ufuk/kapsam farkıdır ama sessizce yok sayılmaz.
 *  - Database ⇄ Database (mevcut ⇄ aday sorgu) karşılaştırmasında tolerans
 *    yoktur: tek satır farkı bile adayı geçersiz kılar.
 *  - Değer karşılaştırması BL'ın gün bazlı tarih semantiğini (parseDateOnly)
 *    ve sayısal eşitliği kullanır; başka hiçbir normalizasyon yapılmaz.
 */

const crypto = require('crypto');

const FABRIC_ORDER_FIELDS = Object.freeze(['fabricCategory', 'fabricSupplierCountry', 'fabricSupplier', 'kumasTipi', 'iplikNo', 'fabricWeight', 'karisim']);
const IAS_QTY_FIELDS = Object.freeze(['loadedQty', 'iasOrderQty']);
const IAS_IDENTITY_FIELDS = Object.freeze(['ocode', 'model', 'ccode', 'colour', 'importFile', 'containerNo', 'vesselName', 'statu', 'arr', 'vasita', 'handover']);
const ASAS_QTY_FIELDS = Object.freeze(['qty', 'kalan', 'antrepo', 'merkezSevkeHazirKalan']);

function pad(value) { return String(value).padStart(2, '0'); }

/* Tek değer → karşılaştırma metni. Tarihler BL'ın gün bazlı semantiğiyle
   (parse.parseDateOnly) yerel YYYY-MM-DD olur; sayılar 6 ondalıkta sabitlenir. */
function createCanon(parseLib) {
  const dateOnly = parseLib && typeof parseLib.parseDateOnly === 'function' ? parseLib.parseDateOnly : null;
  return function canon(value) {
    if (value == null) return '';
    if (value instanceof Date) {
      if (isNaN(value)) return '';
      const day = dateOnly ? dateOnly(value) : value;
      const d = day instanceof Date ? day : value;
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    }
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) return '';
      return String(Number(value.toFixed(6)));
    }
    if (typeof value === 'boolean') return value ? '1' : '0';
    if (typeof value === 'object') return '';
    return String(value).trim();
  };
}

/* İki kanonik metin eşit mi? Biri "001", diğeri "1" gibi sayısal eşdeğerlikler
   yalnız iki taraf da tam sayısal metinse eşit sayılır. */
function canonEqual(a, b) {
  if (a === b) return true;
  const numeric = /^-?\d+(?:\.\d+)?$/;
  if (numeric.test(a) && numeric.test(b)) return Number(a) === Number(b);
  return false;
}

function scalarFields(objects) {
  const fields = new Set();
  for (const object of objects) {
    if (!object || typeof object !== 'object') continue;
    for (const [key, value] of Object.entries(object)) {
      if (key.startsWith('_')) continue;
      if (value == null || value instanceof Date || ['string', 'number', 'boolean'].includes(typeof value)) fields.add(key);
    }
  }
  return [...fields].sort();
}

/* Bir alan bu kaynakta gerçekten var mı? (en az bir dolu değer) — Excel raporu
   bazı sütunları hiç taşımıyorsa o alanın farkları "veri hatası" değil "kapsam
   notu" olarak raporlanır. Sayısal miktar alanlarında 0 da "dolu" sayılmaz;
   ayrıştırıcı eksik sütunu 0'a çevirir. */
function presentFields(objects, fields, canon) {
  const present = new Set();
  for (const field of fields) {
    for (const object of objects) {
      const text = canon(object && object[field]);
      if (text !== '' && text !== '0') { present.add(field); break; }
    }
  }
  return present;
}

function orderKey(parseLib, rule, order) {
  const base = parseLib.antrepoMatchKey(order.ocode, order.model, order.ccode);
  const dynamic = parseLib.dynamicAntrepoMatchKey(order, 'asas', rule) || '';
  return `${base}\u0001${dynamic}`;
}
function displayKey(key) { return String(key || '').replace(/\u0000/g, ' | ').replace(/\u0001/g, ' ‖ '); }

function groupBy(list, keyOf) {
  const map = new Map();
  for (const item of list) {
    const key = keyOf(item);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  }
  return map;
}

function fingerprint(values) {
  const hash = crypto.createHash('sha1');
  for (const value of values) hash.update(String(value)).update('\u0002');
  return hash.digest('hex').slice(0, 16);
}

/* ---------------------------- ASAS SİPARİŞLERİ ---------------------------- */

/**
 * reference: doğruluk referansı (Excel ya da "mevcut" DB),
 * candidate: denetlenen kaynak.
 * options.strict: true → kapsam farkı da HATA (DB⇄DB karşılaştırması).
 * options.ignoreFields: karşılaştırma dışı alanlar (ör. kumaşsız varyantta kumaş).
 */
function compareOrders(reference, candidate, ctx, options = {}) {
  const { parseLib, rule, canon } = ctx;
  const ignore = new Set(options.ignoreFields || []);
  const refList = Array.isArray(reference) ? reference : [];
  const candList = Array.isArray(candidate) ? candidate : [];
  const refByKey = groupBy(refList, order => orderKey(parseLib, rule, order));
  const candByKey = groupBy(candList, order => orderKey(parseLib, rule, order));
  const allFields = scalarFields([...refList, ...candList]).filter(field => !ignore.has(field));
  const refPresent = presentFields(refList, allFields, canon);
  const candPresent = presentFields(candList, allFields, canon);
  // Kapsam farkı olan alanlar: bir tarafta hiç dolu değer yok.
  const comparedFields = options.strict ? allFields : allFields.filter(field => refPresent.has(field) && candPresent.has(field));
  const coverage = options.strict ? [] : allFields
    .filter(field => refPresent.has(field) !== candPresent.has(field))
    .map(field => ({ field, onlyIn: refPresent.has(field) ? 'reference' : 'candidate' }));

  const missing = [];   // referansta var, adayda yok
  const extra = [];     // adayda var, referansta yok
  const valueDiffs = []; // ortak anahtar, farklı değer
  const multiplicity = []; // aynı anahtarda farklı satır sayısı
  const fieldDiffCounts = {};
  for (const [key, refOrders] of refByKey) {
    const candOrders = candByKey.get(key);
    if (!candOrders) { missing.push({ key, order: refOrders[0], count: refOrders.length }); continue; }
    if (candOrders.length !== refOrders.length) {
      multiplicity.push({ key, reference: refOrders.length, candidate: candOrders.length });
    }
    // Aynı anahtarda birden çok satır: kanonik imzaya göre sıralanıp eşlenir.
    const sig = order => comparedFields.map(field => canon(order[field])).join('\u0002');
    const refSorted = [...refOrders].sort((a, b) => sig(a).localeCompare(sig(b)));
    const candSorted = [...candOrders].sort((a, b) => sig(a).localeCompare(sig(b)));
    const n = Math.min(refSorted.length, candSorted.length);
    for (let i = 0; i < n; i++) {
      for (const field of comparedFields) {
        const a = canon(refSorted[i][field]);
        const b = canon(candSorted[i][field]);
        if (canonEqual(a, b)) continue;
        fieldDiffCounts[field] = (fieldDiffCounts[field] || 0) + 1;
        valueDiffs.push({ key, field, reference: a, candidate: b });
      }
    }
  }
  for (const [key, candOrders] of candByKey) {
    if (!refByKey.has(key)) extra.push({ key, order: candOrders[0], count: candOrders.length });
  }
  const sum = (list, field) => list.reduce((acc, order) => acc + (Number(order && order[field]) || 0), 0);
  const totals = Object.fromEntries(ASAS_QTY_FIELDS.map(field => [field, { reference: sum(refList, field), candidate: sum(candList, field) }]));
  return {
    referenceCount: refList.length, candidateCount: candList.length,
    referenceKeys: refByKey.size, candidateKeys: candByKey.size,
    comparedFields, coverage, missing, extra, valueDiffs, multiplicity, fieldDiffCounts, totals,
  };
}

/* ------------------------------ IAS PARSİYELLERİ ------------------------------ */

function iasEntries(map) {
  if (!map || typeof map !== 'object') return [];
  return Object.values(map).filter(value => value && typeof value === 'object');
}

/**
 * IAS parsiyellerini iki kaynakta karşılaştırır.
 * strict=true (DB⇄DB): bütün kimlik alanları + miktarlar birebir çoklu-küme.
 * strict=false (Excel⇄DB): iki tarafta da var olan kimlik alanlarına göre
 *   gruplanıp Yükleme Toplam Adet toplanır (Excel pivotu daha kaba granülde
 *   olabilir), ayrıca Sipariş+Model+Renk düzeyinde toplam karşılaştırılır.
 */
function compareIas(referenceMap, candidateMap, ctx, options = {}) {
  const { canon } = ctx;
  const ref = iasEntries(referenceMap);
  const cand = iasEntries(candidateMap);
  const refPresent = presentFields(ref, IAS_IDENTITY_FIELDS, canon);
  const candPresent = presentFields(cand, IAS_IDENTITY_FIELDS, canon);
  const identity = options.strict
    ? [...IAS_IDENTITY_FIELDS]
    : IAS_IDENTITY_FIELDS.filter(field => refPresent.has(field) && candPresent.has(field));
  const coverage = options.strict ? [] : IAS_IDENTITY_FIELDS
    .filter(field => refPresent.has(field) !== candPresent.has(field))
    .map(field => ({ field, onlyIn: refPresent.has(field) ? 'reference' : 'candidate' }));
  const qtyFields = options.strict ? [...IAS_QTY_FIELDS] : ['loadedQty'];

  const aggregate = (entries, fields) => {
    const map = new Map();
    for (const entry of entries) {
      const key = fields.map(field => canon(entry[field])).join('\u0000');
      const current = map.get(key) || { rows: 0, sums: Object.fromEntries(qtyFields.map(f => [f, 0])), entry };
      current.rows += 1;
      for (const field of qtyFields) current.sums[field] += Number(entry[field]) || 0;
      map.set(key, current);
    }
    return map;
  };
  const diffMaps = (refAgg, candAgg, fields) => {
    const out = { missing: [], extra: [], qtyDiffs: [], rowDiffs: [] };
    for (const [key, value] of refAgg) {
      const other = candAgg.get(key);
      if (!other) { out.missing.push({ key, fields, ...value }); continue; }
      for (const field of qtyFields) {
        if (!canonEqual(canon(value.sums[field]), canon(other.sums[field]))) {
          out.qtyDiffs.push({ key, fields, field, reference: value.sums[field], candidate: other.sums[field] });
        }
      }
      if (options.strict && value.rows !== other.rows) out.rowDiffs.push({ key, fields, reference: value.rows, candidate: other.rows });
    }
    for (const [key, value] of candAgg) if (!refAgg.has(key)) out.extra.push({ key, fields, ...value });
    return out;
  };

  const detailRef = aggregate(ref, identity);
  const detailCand = aggregate(cand, identity);
  const detail = diffMaps(detailRef, detailCand, identity);
  const lineFields = ['ocode', 'model', 'ccode'];
  const line = diffMaps(aggregate(ref, lineFields), aggregate(cand, lineFields), lineFields);
  const total = list => list.reduce((acc, entry) => acc + (Number(entry.loadedQty) || 0), 0);
  return {
    referenceRows: ref.length, candidateRows: cand.length,
    identityFields: identity, coverage,
    detail, line,
    totals: { loadedQty: { reference: total(ref), candidate: total(cand) } },
  };
}

/* ------------------------- EŞLEŞTİRME MOTORU SONUCU ------------------------- */

/* Her ASAS siparişi için BL'ın Backlog eşleştirmesi (findAntrepoHits) ne
   döndürüyor: parsiyel sayısı, toplam yüklenen adet, statüler. */
function matchSummary(orders, map, ctx) {
  const { parseLib, rule, canon } = ctx;
  const out = new Map();
  const stats = { orders: 0, matched: 0, unmatched: 0, ambiguous: 0 };
  for (const order of Array.isArray(orders) ? orders : []) {
    const key = orderKey(parseLib, rule, order);
    const hits = parseLib.findAntrepoHits(map || {}, order, { rule });
    stats.orders += 1;
    if (hits.length) stats.matched += 1; else stats.unmatched += 1;
    if (hits.length > 1) stats.ambiguous += 1;
    const statuses = [...new Set(hits.map(hit => canon(hit.statu)))].sort().join(' + ');
    const loaded = hits.reduce((acc, hit) => acc + (Number(hit.loadedQty) || 0), 0);
    const previous = out.get(key);
    // Aynı anahtarda birden fazla sipariş satırı varsa aynı hit kümesini paylaşır.
    out.set(key, previous || { hits: hits.length, loaded, statuses });
  }
  return { byKey: out, stats };
}

function compareMatches(referenceSummary, candidateSummary, ctx) {
  const { canon } = ctx;
  const diffs = [];
  let compared = 0;
  for (const [key, ref] of referenceSummary.byKey) {
    const cand = candidateSummary.byKey.get(key);
    if (!cand) continue; // sipariş kapsam farkı ASAS karşılaştırmasında raporlanır
    compared += 1;
    const fields = [];
    if (ref.hits !== cand.hits) fields.push(['parsiyel', ref.hits, cand.hits]);
    if (!canonEqual(canon(ref.loaded), canon(cand.loaded))) fields.push(['yüklenen adet', ref.loaded, cand.loaded]);
    if (ref.statuses !== cand.statuses) fields.push(['statü', ref.statuses, cand.statuses]);
    for (const [field, a, b] of fields) diffs.push({ key, field, reference: a, candidate: b });
  }
  return { compared, diffs, referenceStats: referenceSummary.stats, candidateStats: candidateSummary.stats };
}

/* --------------------------- HAM SATIR (DB⇄DB) --------------------------- */

/* Sorgunun döndürdüğü (IAS iş granülüne normalize edilmiş) satırları sıralı
   kanonik çoklu-küme olarak karşılaştırır. Sütun sırası/başlıkları farklıysa da
   yakalanır. */
function compareRawRows(referenceRows, candidateRows, ctx) {
  const { canon } = ctx;
  const sig = row => JSON.stringify(Object.keys(row || {}).sort().map(key => [key, canon(row[key])]));
  const count = rows => {
    const map = new Map();
    for (const row of Array.isArray(rows) ? rows : []) { const key = sig(row); map.set(key, (map.get(key) || 0) + 1); }
    return map;
  };
  const a = count(referenceRows), b = count(candidateRows);
  const onlyReference = [], onlyCandidate = [];
  for (const [key, n] of a) { const m = b.get(key) || 0; if (n > m) onlyReference.push({ row: key, count: n - m }); }
  for (const [key, n] of b) { const m = a.get(key) || 0; if (n > m) onlyCandidate.push({ row: key, count: n - m }); }
  const headers = rows => [...new Set((Array.isArray(rows) ? rows : []).flatMap(row => Object.keys(row || {})))].sort();
  return {
    referenceRows: (referenceRows || []).length, candidateRows: (candidateRows || []).length,
    referenceHeaders: headers(referenceRows), candidateHeaders: headers(candidateRows),
    onlyReference, onlyCandidate,
    identical: !onlyReference.length && !onlyCandidate.length,
  };
}

function ordersFingerprint(orders, ctx) {
  const { parseLib, rule, canon } = ctx;
  const fields = scalarFields(orders || []);
  return fingerprint((orders || []).map(order => orderKey(parseLib, rule, order) + fields.map(f => canon(order[f])).join('|')).sort());
}
function iasFingerprint(map, ctx) {
  const { canon } = ctx;
  return fingerprint(iasEntries(map).map(entry => [...IAS_IDENTITY_FIELDS, ...IAS_QTY_FIELDS].map(f => canon(entry[f])).join('|')).sort());
}

module.exports = {
  FABRIC_ORDER_FIELDS, IAS_IDENTITY_FIELDS, IAS_QTY_FIELDS, ASAS_QTY_FIELDS,
  createCanon, canonEqual, orderKey, displayKey,
  compareOrders, compareIas, matchSummary, compareMatches, compareRawRows,
  ordersFingerprint, iasFingerprint, iasEntries,
};
