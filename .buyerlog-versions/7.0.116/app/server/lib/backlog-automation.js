'use strict';

/* Buyer Log v9.47 — BACKLOG OTOMASYON & TAKİP MERKEZİ (veri katmanı)
 *
 * Otomasyon, teslimat riskini KENDİ hesaplamaz. Backlog Intelligence'ın
 * (public/backlog-delivery-engine.js) çıktısı tek kanonik kaynaktır; bu dosya
 * yalnız o çıktıyı mevcut otomasyon boru hattının anlayacağı biçime —
 * satır üstünde düz alanlara — çevirir.
 *
 * Bu yüzden burada:
 *  - risk/ETA/transit/yükleme/teslimat kuralı YENİDEN YAZILMAZ,
 *  - eşik uydurulmaz,
 *  - hesaplanamayan sipariş zorla bir risk kategorisine sokulmaz (UNKNOWN
 *    UNKNOWN kalır),
 *  - kaynak iş verisi (tarih, status, adet) DEĞİŞTİRİLMEZ; yalnız yeni
 *    anahtarlar eklenir ve mevcut bir anahtarın üstüne asla yazılmaz.
 *
 * Yetki: bu dosya yetki uygulamaz. Çağıran taraf (server.js
 * agentPlatformDataset → agentVisibleRows) satırları zaten kullanıcının
 * yetkili olduğu kümeye indirmiştir; zenginleştirme o kümenin dışına çıkmaz.
 */

const Engine = require('../../public/backlog-delivery-engine.js');
const BR = require('../../public/business-rules.js');

/* Otomasyon satırına eklenen alan adları. Kullanıcı bunları filtre kurarken ve
   e-posta raporu alanı seçerken görüyor — Backlog başlıklarıyla aynı dilde. */
const FIELDS = Object.freeze({
  outcome: 'Teslimat Sonucu',
  outcomeCode: 'Teslimat Sonucu Kodu',
  riskCause: 'Risk Sebebi',
  riskCauseCode: 'Risk Sebebi Kodu',
  stage: 'Teslimat Aşaması',
  stageCode: 'Teslimat Aşaması Kodu',
  eta: 'Tahmini Antrepo (ETA)',
  etaSource: 'ETA Kaynağı',
  targetType: 'Hedef Tarih Tipi',
  targetDate: 'Hedef Tarih',
  buffer: 'Tampon Gün',
  latestSafeLoad: 'En Geç Yükleme Günü',
  loadingVariance: 'Yükleme Sapma Gün',
  transitVariance: 'Yol Süresi Sapma Gün',
  loadingPerformance: 'Yükleme Performansı',
  confidence: 'Güven Seviyesi',
  transitRuleMissing: 'Yol Süresi Kuralı Eksik',
  owner: 'Sorumlu Taraf',
  language: 'İletişim Dili',
});

const ETA_SOURCE_LABELS = Object.freeze({
  ias: 'Gerçekleşen (IAS)', calculated: 'Hesaplanan', estimated: 'Tahmini', none: '',
});
const LOADING_LABELS_TR = Object.freeze({
  ON_TIME: 'Zamanında', EARLY: 'Erken', LATE: 'Geç', NOT_LOADED: 'Yüklenmedi', UNKNOWN: '',
});

/* Kök sebep → sorumlu taraf. Kullanıcı değiştirebilsin diye VARSAYILAN;
   çağıran `routing` ile ezebilir. Burada bir iş kuralı üretilmiyor, yalnız
   "bu sebebi kim çözer" sorusunun varsayılan cevabı veriliyor. */
const DEFAULT_OWNER_ROUTING = Object.freeze({
  LATE_LOADING: 'supplier',
  NOT_YET_LOADED: 'supplier',
  PRODUCTION_DELAY: 'supplier',
  TRANSIT_DELAY: 'import',
  CUSTOMS_DELAY: 'import',
  RETAIL_TRANSFER_DELAY: 'import',
  INSUFFICIENT_TRANSIT_BUFFER: 'merchandiser',
  TARGET_DATE_PASSED: 'merchandiser',
  MISSING_DATE: 'merchandiser',
  MISSING_TRANSIT_RULE: 'buyer',
  UNKNOWN: 'merchandiser',
});
const OWNER_LABELS = Object.freeze({
  supplier: 'Üretici', merchandiser: 'Merchandiser', buyer: 'Buyer', import: 'İthalat', none: '',
});

function ordinalToISO(value) {
  if (value == null || !Number.isFinite(Number(value))) return '';
  const date = new Date(Number(value) * 86400000);
  return isNaN(date) ? '' : date.toISOString().slice(0, 10);
}

/* TR/EN kararı TEK yerde verilir: üretim ülkesi Türkiye ise Türkçe, değilse
   İngilizce. Otomasyon şablonları bu fonksiyonu çağırır, kendi tahminini
   yürütmez. */
function resolveCommunicationLanguage(row) {
  const country = row && (row[Engine.FIELDS.country] ?? row['Siparişin Üretildiği Ülke']);
  const key = BR.transitCountryKey ? BR.transitCountryKey(country) : String(country || '').toUpperCase();
  return key === 'TURKEY' ? 'tr' : 'en';
}

function ownerForCause(cause, routing) {
  const table = routing && typeof routing === 'object' ? routing : DEFAULT_OWNER_ROUTING;
  const key = String(cause || 'UNKNOWN');
  const owner = table[key] || DEFAULT_OWNER_ROUTING[key] || 'none';
  return OWNER_LABELS[owner] === undefined ? 'none' : owner;
}

/* Bir analiz sonucunu düz otomasyon alanlarına çevirir. */
function analysisFields(analysis, row, options) {
  const lang = 'tr';
  const owner = analysis.deliveryOutcome === 'ON_TRACK' || analysis.deliveryOutcome === 'UNKNOWN'
    ? 'none'
    : ownerForCause(analysis.riskCause, options && options.routing);
  return {
    [FIELDS.outcomeCode]: analysis.deliveryOutcome,
    [FIELDS.outcome]: Engine.OUTCOME_LABELS[lang][analysis.deliveryOutcome] || analysis.deliveryOutcome,
    [FIELDS.riskCauseCode]: analysis.riskCause || '',
    [FIELDS.riskCause]: analysis.riskCause ? (Engine.RISK_CAUSE_LABELS[lang][analysis.riskCause] || analysis.riskCause) : '',
    [FIELDS.stageCode]: analysis.stage,
    [FIELDS.stage]: Engine.STAGE_LABELS[lang][analysis.stage] || analysis.stage,
    [FIELDS.eta]: ordinalToISO(analysis.eta),
    [FIELDS.etaSource]: ETA_SOURCE_LABELS[analysis.etaSource] || '',
    [FIELDS.targetType]: analysis.targetType === 'inStore' ? 'In Store' : 'Retail Depo',
    [FIELDS.targetDate]: ordinalToISO(analysis.targetDate),
    [FIELDS.buffer]: analysis.scheduleBufferDays == null ? '' : analysis.scheduleBufferDays,
    [FIELDS.latestSafeLoad]: ordinalToISO(analysis.latestSafeLoadDate),
    [FIELDS.loadingVariance]: analysis.loadingVarianceDays == null ? '' : analysis.loadingVarianceDays,
    [FIELDS.transitVariance]: analysis.transitVarianceDays == null ? '' : analysis.transitVarianceDays,
    [FIELDS.loadingPerformance]: LOADING_LABELS_TR[analysis.loadingPerformance] || '',
    [FIELDS.confidence]: analysis.confidence,
    [FIELDS.transitRuleMissing]: analysis.transitRuleMissing ? 'Evet' : 'Hayır',
    [FIELDS.owner]: OWNER_LABELS[owner] || '',
    [FIELDS.language]: resolveCommunicationLanguage(row),
  };
}

/* Backlog satırlarını teslimat analizi alanlarıyla zenginleştirir.
   Kaynak satır MUTASYONA UĞRAMAZ; kopya döner ve var olan bir anahtarın
   üstüne yazmaz (Backlog şablonu bir gün aynı adlı bir sütun eklerse
   otomasyon sessizce yalan söylemesin). */
function enrichRows(rows, options) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return [];
  const opts = options || {};
  const ctx = {
    today: opts.today == null ? Engine.defaultOrdinal(new Date()) : opts.today,
    dateOrdinal: opts.dateOrdinal || Engine.defaultOrdinal,
    settings: opts.settings || {},
  };
  return list.map(row => {
    const analysis = Engine.analyzeOrder(row, ctx);
    const merged = { ...row };
    const fields = analysisFields(analysis, row, opts);
    for (const [key, value] of Object.entries(fields)) {
      if (Object.prototype.hasOwnProperty.call(merged, key)) continue;
      merged[key] = value;
    }
    return merged;
  });
}

module.exports = {
  FIELDS, DEFAULT_OWNER_ROUTING, OWNER_LABELS,
  enrichRows, resolveCommunicationLanguage, ownerForCause, ordinalToISO,
};
