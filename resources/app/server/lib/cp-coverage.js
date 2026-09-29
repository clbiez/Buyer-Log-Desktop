'use strict';

/* ===================================================================
   CP KAPSAM DENETİMİ (v20260929)

   Kullanıcı kararı: "Diğer modüllerin verisinin içinde zaten CP verisi
   mevcut olacak, diğer modüller daha geniş kapsamlı sadece. Diğer modülleri
   yenilediğimde genel filtre, CP filtremin dışında kalırsa bunda uyarı
   versin."

   Tek yenileme motoru CP'yi ve bağlı grubu (genel filtre) aynı işte çeker.
   CP gruptan ayrı, daha dar bir filtreyle çalışıyorsa CP'nin her satırı
   genel veride de bulunmalıdır. Bulunmuyorsa genel filtre CP'yi
   kapsamıyordur: aynı sipariş CP'de görünür ama Siparişler/Backlog/LFL'de
   görünmez. Denetim filtre metnini yorumlamaz — iki sorgunun GERÇEK
   sonucunu karşılaştırır; bu yüzden VEYA grupları, tarih pencereleri ya da
   kişisel ufuk gibi durumlarda da doğru sonuç verir.

   SAF MODÜL: disk, ağ, db.js yok.
   =================================================================== */

const MAX_SAMPLE = 8;
// CP'nin kıyaslandığı "genel" veri: bağlı grubun sipariş satırı taşıyan hedefleri.
const GENERAL_TARGET_ORDER = Object.freeze(['orders', 'backlog', 'priceanalysis']);

function clean(value) { return String(value == null ? '' : value).trim().toUpperCase(); }
function rowKey(row) { return `${clean(row && row.ocode)}|${clean(row && row.colour)}`; }

/**
 * @param {Array} cpRows       CP hedefinin ASAS satırları
 * @param {Array} generalRows  bağlı grubun (genel filtrenin) ASAS satırları
 * @returns {{checked:boolean, cpRowCount:number, outsideCount:number, outsideOrderCount:number, sampleOrderCodes:string[]}}
 */
function assessCoverage(cpRows, generalRows) {
  if (!Array.isArray(cpRows) || !Array.isArray(generalRows)) {
    return { checked: false, cpRowCount: 0, outsideCount: 0, outsideOrderCount: 0, sampleOrderCodes: [] };
  }
  // Aynı satır dizisi: CP ile genel veri tek sorgudan geliyor, taşma olamaz.
  if (cpRows === generalRows) {
    return { checked: true, cpRowCount: cpRows.length, outsideCount: 0, outsideOrderCount: 0, sampleOrderCodes: [] };
  }
  const general = new Set();
  for (const row of generalRows) general.add(rowKey(row));
  let outsideCount = 0;
  const orders = new Set();
  const sample = [];
  for (const row of cpRows) {
    if (general.has(rowKey(row))) continue;
    outsideCount += 1;
    const code = String(row && row.ocode == null ? '' : row.ocode).trim();
    if (code && !orders.has(code)) {
      orders.add(code);
      if (sample.length < MAX_SAMPLE) sample.push(code);
    }
  }
  return { checked: true, cpRowCount: cpRows.length, outsideCount, outsideOrderCount: orders.size, sampleOrderCodes: sample };
}

/**
 * Yenileme sonucundaki hedef satırlarından denetimi kurar.
 * @param {Object}   ordersByTarget  { cp:[...], orders:[...], ... }
 * @param {string[]} linkedTargets   ASAS bağlı grubunun üyeleri
 * @returns {null | {generalTarget:string, ...assessCoverage}}
 */
function assessRefresh(ordersByTarget, linkedTargets) {
  const byTarget = ordersByTarget && typeof ordersByTarget === 'object' ? ordersByTarget : {};
  const members = Array.isArray(linkedTargets) ? linkedTargets : [];
  // CP gruba bağlıysa genel filtreyi zaten kullanıyor: denetlenecek bir şey yok.
  if (members.includes('cp')) return null;
  const generalTarget = GENERAL_TARGET_ORDER.find(target => members.includes(target) && Array.isArray(byTarget[target]));
  if (!generalTarget || !Array.isArray(byTarget.cp)) return null;
  return { generalTarget, ...assessCoverage(byTarget.cp, byTarget[generalTarget]) };
}

function warningText(result, language = 'tr') {
  if (!result || !result.checked || !result.outsideCount) return '';
  const codes = (result.sampleOrderCodes || []).join(', ');
  const more = result.outsideOrderCount > (result.sampleOrderCodes || []).length ? '…' : '';
  if (language === 'en') {
    return `The general (linked modules) filter does not cover your CP filter: ${result.outsideCount.toLocaleString('en-GB')} CP rows in ${result.outsideOrderCount.toLocaleString('en-GB')} orders${codes ? ` (${codes}${more})` : ''} are missing from Orders · Backlog · LFL · Price & Supplier. Widen the general filter in Data Management so it contains CP.`;
  }
  return `Genel (bağlı modüller) filtresi CP filtrenizi kapsamıyor: CP'deki ${result.outsideCount.toLocaleString('tr-TR')} satır / ${result.outsideOrderCount.toLocaleString('tr-TR')} sipariş${codes ? ` (${codes}${more})` : ''} Siparişler · Backlog · LFL · Fiyat & Üretici verisinde yok. Veri Yönetimi'nde genel filtreyi CP'yi içerecek şekilde genişletin.`;
}

module.exports = { MAX_SAMPLE, GENERAL_TARGET_ORDER, assessCoverage, assessRefresh, warningText };
