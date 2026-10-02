'use strict';

/* Yol Süreleri › İthalat Yol Süresi Analizi — doğrudan Buyer Log verisinden.
 *
 * Excel yüklemesi gerekmez. Buyer Log'un Backlog için zaten okuduğu ASAS
 * siparişleri ve IAS (Antrepo) parsiyelleri kullanılır: her parsiyel bir
 * sevkiyattır; ülke eşleşen ASAS siparişinin "Siparişin Üretildiği Ülke"
 * alanından, taşıt "Vasita Tanim"dan, tarihler IAS satırından gelir.
 * Eşleştirme Backlog ile aynı kanonik yoldur (parse.findAntrepoHits). */

const parseLib = require('./parse');
const BLTransitAnalysis = require('../../public/transit-analysis');

const TR = { 'İ': 'I', 'I': 'I', 'ı': 'I', 'Ş': 'S', 'ş': 'S', 'Ç': 'C', 'ç': 'C', 'Ö': 'O', 'ö': 'O', 'Ü': 'U', 'ü': 'U', 'Ğ': 'G', 'ğ': 'G' };
function headerKey(value) {
  const text = String(value == null ? '' : value);
  // Dashboard/Data Model başlıkları "Ithalat.ETA Tarih" gibi tablo önekiyle gelebilir.
  const last = text.includes('.') ? text.slice(text.lastIndexOf('.') + 1) : text;
  return last.replace(/[İIıŞşÇçÖöÜüĞğ]/g, c => TR[c] || c).toUpperCase().replace(/[^A-Z0-9]+/g, '');
}
/* Birebir (normalize) başlık eşleşmesi: "Tahmini Antrepo Giriş Tarihi" asla
   gerçekleşen antrepo girişi sayılmaz. */
const SOURCE_FIELDS = Object.freeze({
  loadingRequest: ['Yükleme Talep Tarih', 'Yükleme Talep Tarihi', 'Loading Request Date'],
  eta: ['ETA Tarih', 'ETA Tarihi', 'ETA Date', 'ETA'],
  actualLoading: ['Fiili Yükleme Tarih', 'Fiili Yükleme Tarihi', 'Actual Loading Date'],
  actualEntry: ['Antrepo Giriş Tarih', 'Antrepo Giriş Tarihi', 'Tema Depo Giriş Tarih', 'Tema Depo Giriş Tarihi', 'Warehouse Entry Date'],
});
const SOURCE_KEYS = Object.fromEntries(Object.entries(SOURCE_FIELDS).map(([k, list]) => [k, new Set(list.map(headerKey))]));
const ARRIVED_STATUSES = new Set(['DEPODA', 'RETAILE AKTARIM BEKLENIYOR']);

function isoDate(value) {
  const d = parseLib.parseDateOnly(value);
  if (!d) return '';
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function sourceValue(entry, field) {
  const fields = entry && entry._sourceFields;
  if (!fields || typeof fields !== 'object') return null;
  const wanted = SOURCE_KEYS[field];
  for (const [name, value] of Object.entries(fields)) {
    if (value != null && value !== '' && wanted.has(headerKey(name))) return value;
  }
  return null;
}

function collectShipments(orders, antrepoMap, overrides) {
  const seen = new Set();
  const out = [];
  for (const order of Array.isArray(orders) ? orders : []) {
    for (const entry of parseLib.findAntrepoHits(antrepoMap, order, { rule: overrides })) {
      const id = entry._sourceRow != null ? `row:${entry._sourceRow}` : null;
      if (id && seen.has(id)) continue; // aynı IAS satırı birden çok ASAS satırına bağlanırsa bir kez sayılır
      if (id) seen.add(id);
      const actualEntry = isoDate(sourceValue(entry, 'actualEntry'));
      const arrived = !!actualEntry || ARRIVED_STATUSES.has(parseLib.antrepoStatusKey(entry.statu));
      out.push({
        country: order.countryRaw || '',
        vehicle: entry.vasita || '',
        qty: Number(entry.loadedQty) || 0,
        arrived,
        loadingRequest: isoDate(sourceValue(entry, 'loadingRequest')),
        handover: isoDate(entry.handover),
        actualLoading: isoDate(sourceValue(entry, 'actualLoading')),
        eta: isoDate(sourceValue(entry, 'eta')),
        // Gerçekleşen giriş sütunu yoksa, antrepoya girmiş parsiyelde IAS'ın
        // "Tahmini Antrepo Giriş Tarihi" son bilinen giriş tarihidir.
        warehouseEntry: actualEntry || (arrived ? isoDate(entry.arr) : ''),
        entryIsActual: !!actualEntry,
      });
    }
  }
  return out;
}

function buildLiveAnalysis({ orders, antrepoMap, overrides, today, sourceLabel } = {}) {
  const shipments = collectShipments(orders, antrepoMap, overrides);
  const analysis = BLTransitAnalysis.buildFromShipments(shipments, {
    today, sourceLabel: sourceLabel || 'Buyer Log IAS (Antrepo) parsiyelleri', generatedAt: new Date().toISOString(),
  });
  analysis.columns = {
    loadingRequest: shipments.some(s => s.loadingRequest),
    eta: shipments.some(s => s.eta),
    handover: shipments.some(s => s.handover),
    actualLoading: shipments.some(s => s.actualLoading),
    actualEntry: shipments.some(s => s.entryIsActual),
  };
  return analysis;
}

module.exports = { SOURCE_FIELDS, headerKey, collectShipments, buildLiveAnalysis };
