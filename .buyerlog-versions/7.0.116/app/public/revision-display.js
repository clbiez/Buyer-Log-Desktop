/* ---------------------------------------------------------------------------
   MANUEL TARİH REVİZYONU — karşılaştırma mantığı.

   CP'de Ex-factory / Retail / In-Store tarihleri elle revize edilebiliyor. Bu
   revizyonlar sunucuya YAZILMIYOR (syncOverrideToServer gövdesinde tarih alanı
   yok): oturum içi bir "ne olurdu" denemesi. Ama hücre doğrudan değiştiği için
   verinin nereden nereye geldiği görünmüyordu.

   Bu modül, hangi hücrenin revize edildiğini ve orijinal değerin ne olduğunu
   belirler. Hücrenin nasıl çizildiği (rozet, tarih biçimi, ok) index.html'de
   kalır; buradaki mantık saf ve testlidir.

   Etkilenen alanlar:
     · elle girilen tarihin kendisi,
     · retail ↔ in-store eşleşmesi (biri değişince diğeri ±14 gün kayar),
     · applyFormulas'ın yeniden hesapladığı türevler: Priority, Ex→Retail, LT.
--------------------------------------------------------------------------- */
(function (global) {
  'use strict';

  const KEYS = ['Ex-factory', 'Retail Date', 'In-Store (Model Budget)', 'Ex→Retail', 'LT', 'Priority'];
  const DATE_KEYS = ['Ex-factory', 'Retail Date', 'In-Store (Model Budget)'];
  const DATE_KEY_SET = new Set(DATE_KEYS);

  // Sunucu, ASAS'tan gelen ORİJİNAL tarihi bu alanlarda gönderir. Elle yapılan
  // revizyon overrides.datemap'te kalıcı olduğu için satırdaki asıl alan revize
  // değeri taşır; karşılaştırma temeli buradan okunur.
  const BASELINE_FIELDS = {
    'Ex-factory': '_asasExFactory',
    'Retail Date': '_asasRetailDate',
    'In-Store (Model Budget)': '_asasInStore',
  };

  // Saat/dakika farkları revizyon sayılmamalı: karşılaştırma gün bazındadır.
  function dayValue(value) {
    if (value == null || value === '') return null;
    const date = (value instanceof Date) ? value : new Date(value);
    if (!(date instanceof Date) || isNaN(date.getTime())) return null;
    return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  }

  function valuesEqual(a, b) {
    if (a instanceof Date || b instanceof Date) {
      const aDay = dayValue(a), bDay = dayValue(b);
      if (aDay == null && bDay == null) return true;
      if (aDay == null || bDay == null) return false;
      return aDay === bDay;
    }
    const at = (a == null || a === '') ? '' : String(a);
    const bt = (b == null || b === '') ? '' : String(b);
    return at === bt;
  }

  /** Bir tarih alanının veritabanından gelen orijinali. */
  function baselineDate(row, key) {
    if (!row) return null;
    const field = BASELINE_FIELDS[key];
    if (!field) return null;
    return Object.prototype.hasOwnProperty.call(row, field) ? row[field] : row[key];
  }

  /**
   * Revizyon öncesi hâli temsil eden gölge satır. Tarih alanları ASAS
   * orijinalleriyle değiştirilir, sonra türevler (Priority, Ex→Retail, LT)
   * applyDerived ile yeniden hesaplanır. Orijinaller satır ömrü boyunca
   * değişmediği için sonuç satırda önbelleklenir.
   */
  function baselineRow(row, applyDerived) {
    if (!row) return null;
    if (row._revBaseRow) return row._revBaseRow;
    const base = Object.assign({}, row);
    for (const key of DATE_KEYS) base[key] = baselineDate(row, key);
    if (typeof applyDerived === 'function') applyDerived(base);
    try {
      Object.defineProperty(row, '_revBaseRow', { value: base, enumerable: false, configurable: true });
    } catch (_) { row._revBaseRow = base; }
    return base;
  }

  /**
   * Verilen CANLI değeri temel satırla karşılaştırır. Türev alanlar (Ex→Retail, LT,
   * Priority) ekranda computeFlags ile anlık hesaplandığı için ham row[key] bazen
   * bir render geriden gelebilir veya (LT gibi) sunucu payload'ında hiç bulunmayabilir.
   * Bu yardımcı, revizyon rozetinin ekrandaki gerçek hesapla aynı değeri kullanmasını sağlar.
   */
  function infoValue(row, key, base, currentValue) {
    if (!row || !base) return null;
    if (!KEYS.includes(key)) return null;
    const from = base[key];
    const to = currentValue;
    if (valuesEqual(from, to)) return null;
    return { from, to };
  }

  /** Döner: {from, to} veya null (revizyon yok / değer orijinaline dönmüş). */
  function info(row, key, base) {
    return infoValue(row, key, base, row && row[key]);
  }

  /** Satırda revize edilmiş alan var mı? */
  function hasAny(row, base) {
    return KEYS.some(key => info(row, key, base) != null);
  }

  /** Hangi tarih alanları elle revize edilmiş? Sunucuya gönderilecek gövde için. */
  function revisedDateKeys(row) {
    if (!row) return [];
    return DATE_KEYS.filter(key => !valuesEqual(baselineDate(row, key), row[key]));
  }

  function isDateKey(key) {
    return DATE_KEY_SET.has(key);
  }

  const api = { KEYS, DATE_KEYS, BASELINE_FIELDS, valuesEqual, baselineDate, baselineRow, info, infoValue, hasAny, revisedDateKeys, isDateKey };

  if (typeof module === 'object' && module.exports) module.exports = api;
  else global.BLRevision = api;
})(typeof window !== 'undefined' ? window : globalThis);

/* v7.64 — Shared column labels are display-only. Load the canonical label
   layer before table modules render; it observes later dynamic table headers too. */
(function loadCanonicalColumnLabels(global){
  'use strict';
  if(!global||!global.document||global.BLColumnLabels)return;
  try{
    if(global.document.querySelector('script[data-bl-canonical-column-labels]'))return;
    var script=global.document.createElement('script');
    script.src='canonical-column-labels.js?rev=7.64'+(global.BL_ASSET_VERSION?'&v='+encodeURIComponent(global.BL_ASSET_VERSION):'');
    script.setAttribute('data-bl-canonical-column-labels','1');
    (global.document.head||global.document.documentElement).appendChild(script);
  }catch(_){ }
})(typeof window!=='undefined'?window:null);
