'use strict';

/* Buyer Log v9.50 — CP OTOMASYON VERİ KATMANI
 *
 * Otomasyon ekranındaki `source: 'cp'` satırlarına, CP Overview'daki
 * "Bugünün Üretim Öncelikleri" panelinin ürettiği alanları ekler. Böylece
 * kullanıcı ekranda gördüğü önceliği filtre koşulu olarak kurabilir ve
 * takip e-postası oluşturabilir.
 *
 * KANONİK KAYNAK, SIFIR KOPYA KURAL: hesap public/cp-readiness-engine.js'te,
 * teslimat sonucu onun üzerinden public/backlog-delivery-engine.js'te. Burada
 * risk/ETA/öncelik YENİDEN HESAPLANMAZ, yalnız düz alana çevrilir.
 *
 * SUNUCUNUN GÖREMEDİĞİ TEK ŞEY: kontrol listesi cevapları.
 * "PPS işaretlendi mi?" cevabı kullanıcının kendi tarayıcısında, kişiye özel
 * saklanır (BLStorage). Sunucu onu okuyamaz — bu yüzden kontrol listesine
 * BAĞLI öncelik yükseltmeleri burada UYGULANMAZ ve bu alan `Öncelik Kaynağı`
 * ile açıkça "kontrol listesi hariç" olarak işaretlenir. Sessizce ekranla
 * farklı bir öncelik üretmek, bu zincirdeki en pahalı hata türüdür.
 *
 * v7.0.290 — Aksiyon Önceliği artık YALNIZ kullanıcının kurallarından gelir
 * (cp-readiness-engine.js). Çağıran sahibin etkin kurallarını ve checklist
 * cevaplarını (`rules`, `answers`) verirse aynı kural motoru (cp-rules-engine)
 * burada da uygulanır; ekran ile otomasyon aynı önceliği görür.
 *
 * Yetki: bu dosya yetki uygulamaz; çağıran (agentPlatformDataset →
 * agentVisibleRows) satırları zaten kullanıcının yetkili olduğu kümeye
 * indirmiştir.
 */

const Engine = require('../../public/cp-readiness-engine.js');
const Rules = require('../../public/cp-rules-engine.js');

/* Otomasyon satırına eklenen alan adları — kullanıcı bunları filtre kurarken
   ve e-posta raporu alanı seçerken görüyor. */
const FIELDS = Object.freeze({
  priority: 'Aksiyon Önceliği',
  priorityCode: 'Aksiyon Önceliği Kodu',
  prioritySource: 'Öncelik Kaynağı',
  calculationStatus: 'Hesaplama Durumu Kodu',
  outcome: 'Teslimat Sonucu',
  outcomeCode: 'Teslimat Sonucu Kodu',
  stage: 'Teslimat Aşaması',
  riskReasons: 'Risk Sebepleri',
  daysToLoad: 'Yüklemeye Kalan Gün',
  loadWindow: 'Yükleme Penceresi',
  orderAge: 'Sipariş Yaşı (Gün)',
  eta: 'Tahmini Antrepo (ETA)',
  targetType: 'Hedef Tarih Tipi',
  targetDate: 'Hedef Tarih',
  buffer: 'Tampon Gün',
  latestSafeLoad: 'En Geç Yükleme Günü',
  transitRuleMissing: 'Yol Süresi Kuralı Eksik',
  dateSync: 'Tarih Senkronu',
});

const PRIORITY_LABELS_TR = Engine.PRIORITY_LABELS.tr;
const OUTCOME_LABELS_TR = Object.freeze({
  ON_TRACK: 'Zamanında Yetişecek', AT_RISK: 'Riskli', EXPECTED_LATE: 'Gecikmesi Bekleniyor',
  ALREADY_LATE: 'Zaten Gecikmiş', UNKNOWN: 'Hesaplanamıyor',
});

function ordinalToISO(value) {
  if (value == null || !Number.isFinite(Number(value))) return '';
  const date = new Date(Number(value) * 86400000);
  return isNaN(date) ? '' : date.toISOString().slice(0, 10);
}

function analysisFields(analysis, matched, rulesApplied) {
  const ruleReasons = (matched || []).map(rule => String(rule.reasonTr || rule.name || '').trim()).filter(Boolean);
  return {
    [FIELDS.priorityCode]: analysis.priority,
    [FIELDS.priority]: PRIORITY_LABELS_TR[analysis.priority] || analysis.priority,
    [FIELDS.prioritySource]: rulesApplied ? 'Kullanıcı kuralları' : 'Kural uygulanmadı',
    [FIELDS.calculationStatus]: analysis.calculationStatus || (analysis.deliveryOutcome === 'UNKNOWN' ? 'UNKNOWN' : 'KNOWN'),
    [FIELDS.outcomeCode]: analysis.deliveryOutcome,
    [FIELDS.outcome]: OUTCOME_LABELS_TR[analysis.deliveryOutcome] || analysis.deliveryOutcome,
    [FIELDS.stage]: Engine.PRIORITY_LABELS.tr[analysis.stage] || analysis.stage,
    [FIELDS.riskReasons]: [...ruleReasons, ...analysis.riskReasons.map(key => Engine.RISK_REASON_LABELS.tr[key] || key)].join(' · '),
    [FIELDS.daysToLoad]: analysis.daysToLoad == null ? '' : analysis.daysToLoad,
    [FIELDS.loadWindow]: Engine.LOAD_WINDOW_LABELS.tr[analysis.loadWindow] || analysis.loadWindow,
    [FIELDS.orderAge]: analysis.orderAgeDays == null ? '' : analysis.orderAgeDays,
    [FIELDS.eta]: ordinalToISO(analysis.eta),
    [FIELDS.targetType]: analysis.targetType === 'inStore' ? 'In Store' : 'Retail Depo',
    [FIELDS.targetDate]: ordinalToISO(analysis.targetDate),
    [FIELDS.buffer]: analysis.scheduleBufferDays == null ? '' : analysis.scheduleBufferDays,
    [FIELDS.latestSafeLoad]: ordinalToISO(analysis.latestSafeLoadDate),
    [FIELDS.transitRuleMissing]: analysis.transitRuleMissing ? 'Evet' : 'Hayır',
    [FIELDS.dateSync]: Engine.DATE_SYNC_LABELS.tr[analysis.dateSync.status] || analysis.dateSync.status,
  };
}

/* CP satırlarını analiz alanlarıyla zenginleştirir. Kaynak satır MUTASYONA
   UĞRAMAZ ve var olan bir anahtarın üstüne YAZILMAZ (CP bir gün aynı adlı bir
   sütun eklerse otomasyon sessizce yalan söylemesin). */
function enrichRows(rows, options) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return [];
  const opts = options || {};
  const ctx = {
    today: opts.today == null ? Engine.defaultOrdinal(new Date()) : opts.today,
    dateOrdinal: opts.dateOrdinal || Engine.defaultOrdinal,
    transitRules: opts.transitRules || [],
    settings: opts.settings || {},
  };
  const rules = Array.isArray(opts.rules) ? opts.rules : null;
  const prepared = rules && Rules.prepareEvaluation ? Rules.prepareEvaluation(rules) : null;
  return list.map(row => {
    const analysis = Engine.analyzeOrder(row, ctx);
    let matched = [];
    if (rules) {
      const evaluated = Rules.evaluateOrder(analysis, { rules, preparedRules: prepared, answers: opts.answers || {},
        checklistEnabled: opts.checklistEnabled !== false, today: ctx.today });
      analysis.priority = evaluated.priority;
      matched = evaluated.matched || [];
    }
    const merged = { ...row };
    for (const [key, value] of Object.entries(analysisFields(analysis, matched, Boolean(rules)))) {
      if (Object.prototype.hasOwnProperty.call(merged, key)) continue;
      merged[key] = value;
    }
    return merged;
  });
}

module.exports = { FIELDS, enrichRows, ordinalToISO };
