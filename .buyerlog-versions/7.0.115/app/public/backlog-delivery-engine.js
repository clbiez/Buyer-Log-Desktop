/* Buyer Log v9.46 — BACKLOG TESLİMAT RİSKİ ANALİZ MOTORU
 *
 * "Sipariş nerede? Zamanında yüklendi mi? Yolda yeterli süresi var mı? Hedef
 * tarihe yetişecek mi? Risk sebebi ne?" — bu zincirin deterministik cevabı.
 *
 * TEK KANONİK KAYNAK. Gecikme/transit kuralları BURADA YENİDEN YAZILMAZ:
 * public/business-rules.js (BLBusinessRules) uygulamanın tek kural motorudur ve
 * Transfer Lead Time kurallarını (ülke+sezon+yükleme tipi+Ex-Factory aralığı →
 * gün), 14 günlük In-Store tamponunu, 9 günlük üretim gecikmesini ve 3 günlük
 * handover eşiğini zaten tanımlar. Bu motor onun ÜZERİNE oturur: aynı hesabın
 * sayısal çıktısını sipariş bazında sınıflandırır ve toplulaştırır.
 *
 * SAF: DOM yok, fetch yok, tarih ayrıştırma çağıranın enjekte ettiği kanonik
 * dateOrdinal ile yapılır (tarayıcıda app-main.js'in, Node'da parse.js'in aynı
 * fonksiyonu). Bu sayede Node testleri gerçek kuralları çalıştırır.
 *
 * AI YOK: sınıflandırma, ETA, yüzde ve sayıların tamamı kuraldan gelir.
 */
(function (root, factory) {
  const isNode = typeof require === 'function' && typeof module === 'object';
  const api = factory(
    isNode ? require('./business-rules') : (root && root.BLBusinessRules),
    isNode ? require('./order-decision-engine') : (root && root.BLOrderDecisionEngine)
  );
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.BLBacklogDeliveryEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (businessRules, decisionEngine) {
  'use strict';

  const BR = businessRules || {};
  const OD = decisionEngine || {};

  /* ---------------------------------------------------------------- alanlar
     Backlog şablon satırının GERÇEK anahtarları (server/lib/parse.js
     backlogTemplateRowsFromSegments). Tahmin edilmez, birebir kullanılır. */
  const F = Object.freeze({
    status: 'GÜNCEL DURUM\n(STATUS)',
    revisedLoad: 'REVİZE YÜKLEME TARİHİ\n(EX-FACTORY)',
    plannedLoad: 'Orijinal Exfactory Merch Tarih',
    antrepo: 'ANTREPO GİRİŞ TARİHİ',
    antrepoRetail: 'ANTREPO-RETAIL',
    delType: 'YÜKLEME TİPİ',
    retail: 'Retail Depo Tarih Yıl Ay Gün',
    inStore: 'Model Bütçe Tarih Yıl Ay Gün',
    qty: 'Adet',
    orderQty: 'Net Alım Sipariş Miktarı',
    orderCode: 'Sipariş Kod',
    model: 'Model Adı',
    colourCode: 'Renk Kod',
    season: 'Sezon',
    country: 'Siparişin Üretildiği Ülke',
    buyer: 'Buyer',
    buyerGroup: 'Buyer Grup (TR)',
    manufacturer: 'Üretici',
    subManufacturer: 'Alt Üretici',
    line: 'Line',
    category: 'Ürün Klasman',
  });

  /* ------------------------------------------------------------- aşamalar */
  const STAGES = Object.freeze(['PRODUCTION', 'LOADING', 'IN_TRANSIT', 'CUSTOMS', 'IN_WAREHOUSE', 'AWAITING_RETAIL_TRANSFER', 'SHORTAGE', 'UNKNOWN']);
  const STAGE_LABELS = Object.freeze({
    tr: { PRODUCTION: 'Üretimde', LOADING: 'Yükleme Operasyonları', IN_TRANSIT: 'Yolda', CUSTOMS: 'Gümrük-Liman', IN_WAREHOUSE: 'Depoda', AWAITING_RETAIL_TRANSFER: 'Retaile Aktarım Bekliyor', SHORTAGE: 'Eksik Yükleme', UNKNOWN: 'Durum Belirsiz' },
    en: { PRODUCTION: 'In Production', LOADING: 'Loading Operations', IN_TRANSIT: 'In Transit', CUSTOMS: 'Customs & Port', IN_WAREHOUSE: 'In Warehouse', AWAITING_RETAIL_TRANSFER: 'Awaiting Retail Transfer', SHORTAGE: 'Shortage', UNKNOWN: 'Status Unknown' },
  });
  // Henüz sevk edilmemiş aşamalar: bunlarda "en geç yükleme günü" anlamlıdır.
  const PRE_LOAD_STAGES = Object.freeze(new Set(['PRODUCTION', 'LOADING', 'SHORTAGE']));
  const ARRIVED_STAGES = Object.freeze(new Set(['IN_WAREHOUSE', 'AWAITING_RETAIL_TRANSFER']));

  /* ------------------------------------------------------------- sonuçlar */
  const OUTCOMES = Object.freeze(['ON_TRACK', 'AT_RISK', 'EXPECTED_LATE', 'ALREADY_LATE', 'UNKNOWN']);
  const OUTCOME_LABELS = Object.freeze({
    tr: { ON_TRACK: 'Zamanında Yetişecek', AT_RISK: 'Riskli', EXPECTED_LATE: 'Gecikmesi Bekleniyor', ALREADY_LATE: 'Zaten Gecikmiş', UNKNOWN: 'Hesaplanamıyor' },
    en: { ON_TRACK: 'On Track', AT_RISK: 'At Risk', EXPECTED_LATE: 'Expected Late', ALREADY_LATE: 'Already Late', UNKNOWN: 'Unknown' },
  });

  /* --------------------------------------------------------- risk sebepleri */
  const RISK_CAUSES = Object.freeze([
    'LATE_LOADING', 'NOT_YET_LOADED', 'PRODUCTION_DELAY', 'TRANSIT_DELAY', 'CUSTOMS_DELAY',
    'RETAIL_TRANSFER_DELAY', 'INSUFFICIENT_TRANSIT_BUFFER', 'TARGET_DATE_PASSED',
    'MISSING_DATE', 'MISSING_TRANSIT_RULE', 'UNKNOWN',
  ]);
  const RISK_CAUSE_LABELS = Object.freeze({
    tr: {
      LATE_LOADING: 'Geç Yükleme', NOT_YET_LOADED: 'Henüz Yüklenmedi', PRODUCTION_DELAY: 'Üretim Gecikmesi',
      TRANSIT_DELAY: 'Transit Gecikmesi', CUSTOMS_DELAY: 'Gümrük/Liman Gecikmesi',
      RETAIL_TRANSFER_DELAY: 'Retaile Aktarım Gecikmesi', INSUFFICIENT_TRANSIT_BUFFER: 'Yetersiz Transit Süresi',
      TARGET_DATE_PASSED: 'Hedef Tarih Geçti', MISSING_DATE: 'Eksik Tarih', MISSING_TRANSIT_RULE: 'Transit Süresi Yok', UNKNOWN: 'Belirsiz',
    },
    en: {
      LATE_LOADING: 'Late Loading', NOT_YET_LOADED: 'Not Yet Loaded', PRODUCTION_DELAY: 'Production Delay',
      TRANSIT_DELAY: 'Transit Delay', CUSTOMS_DELAY: 'Customs Delay',
      RETAIL_TRANSFER_DELAY: 'Retail Transfer Delay', INSUFFICIENT_TRANSIT_BUFFER: 'Insufficient Transit Buffer',
      TARGET_DATE_PASSED: 'Target Date Passed', MISSING_DATE: 'Missing Date', MISSING_TRANSIT_RULE: 'No Transit Rule', UNKNOWN: 'Unknown',
    },
  });

  /* ------------------------------------------------------- yükleme başarımı */
  const LOADING_OUTCOMES = Object.freeze(['LOADED_ON_TIME', 'LOADED_LATE', 'NOT_LOADED_SAFE', 'NOT_LOADED_AT_RISK', 'NOT_LOADED_EXPECTED_LATE', 'UNKNOWN']);
  const LOADING_LABELS = Object.freeze({
    tr: { LOADED_ON_TIME: 'Zamanında Yüklendi', LOADED_LATE: 'Geç Yüklendi', NOT_LOADED_SAFE: 'Yüklenmedi — Güvenli', NOT_LOADED_AT_RISK: 'Yüklenmedi — Riskli', NOT_LOADED_EXPECTED_LATE: 'Yüklenmedi — Gecikecek', UNKNOWN: 'Hesaplanamıyor' },
    en: { LOADED_ON_TIME: 'Loaded On Time', LOADED_LATE: 'Loaded Late', NOT_LOADED_SAFE: 'Not Loaded — Safe', NOT_LOADED_AT_RISK: 'Not Loaded — At Risk', NOT_LOADED_EXPECTED_LATE: 'Not Loaded — Expected Late', UNKNOWN: 'Unknown' },
  });

  /* ------------------------------------------------------------- boyutlar */
  const DIMENSIONS = Object.freeze(['buyer', 'buyerGroup', 'mag', 'mmyg', 'line', 'season', 'country', 'manufacturer', 'subManufacturer', 'category', 'loadingType', 'stage']);
  const DIMENSION_LABELS = Object.freeze({
    tr: { buyer: 'Buyer', buyerGroup: 'Buying Group', mag: 'MAG', mmyg: 'MMYG', line: 'Line', season: 'Sezon', country: 'Ülke', manufacturer: 'Üretici', subManufacturer: 'Alt Üretici', category: 'Ürün Klasman', loadingType: 'Yükleme Tipi', stage: 'Güncel Durum' },
    en: { buyer: 'Buyer', buyerGroup: 'Buying Group', mag: 'MAG', mmyg: 'MMYG', line: 'Line', season: 'Season', country: 'Country', manufacturer: 'Manufacturer', subManufacturer: 'Sub-Manufacturer', category: 'Product Class', loadingType: 'Loading Type', stage: 'Current Stage' },
  });

  /* --------------------------------------------------------------- ayarlar
     Eşiklerin tamamı KANONİK kurallardan gelir; uydurulmuş sabit yoktur:
     · requiredBufferInStore 14  → BLBusinessRules MB Delay kuralı
     · productionOverdueDays 9   → Discount kuralı
     · handoverOverdueDays 3     → Handover kuralı
     · atRiskBufferDays 5        → Excel RİSK sütunu (ANTREPO-RETAIL > 5)
     Hepsi çağıran tarafından değiştirilebilir (kullanıcı ayarı). */
  const DEFAULT_SETTINGS = Object.freeze({
    targetType: 'retail',
    // Yol süresi kuralı tanımlı değilse hesap YAPILMAZ (kullanıcı talebi).
    requireTransitRule: true,
    requiredBufferRetail: 0,
    requiredBufferInStore: 14,
    atRiskBufferDays: 5,
    watchBufferDays: 10,
    transitToleranceDays: 0,
    lateLoadingToleranceDays: 0,
    productionOverdueDays: 9,
    handoverOverdueDays: 3,
  });

  const EMPTY = '(Boş)';
  const text = value => String(value == null ? '' : value).trim();
  const num = value => { const n = Number(value); return Number.isFinite(n) ? n : 0; };
  const dimKey = value => text(value).replace(/[ıİ]/g, 'I').toUpperCase().replace(/Ş/g, 'S').replace(/Ç/g, 'C').replace(/Ö/g, 'O').replace(/Ü/g, 'U').replace(/Ğ/g, 'G').replace(/\s+/g, ' ');

  function defaultOrdinal(value) {
    if (value == null || value === '') return null;
    const date = value instanceof Date ? value : new Date(value);
    if (!date || isNaN(date)) return null;
    return Math.round(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000);
  }

  function stageOf(status) {
    if (BR.operationalStageOf) return BR.operationalStageOf(status);
    const key = BR.turkNorm ? BR.turkNorm(status) : text(status).toUpperCase();
    if (!key) return 'UNKNOWN';
    if (BR.isWarehouseShortageStatus && BR.isWarehouseShortageStatus(status)) return 'SHORTAGE';
    if (BR.isShortageStatus && BR.isShortageStatus(status)) return 'SHORTAGE';
    if (BR.isProductionStatus && BR.isProductionStatus(status)) return 'PRODUCTION';
    if (key === 'YUKLEME OPERASYONLARI') return 'LOADING';
    if (key === 'YOL OPERASYONLARI' || key === 'YOLDA') return 'IN_TRANSIT';
    if (key === 'GUMRUK-LIMAN OPERASYONLARI' || key === 'GUMRUK LIMAN OPERASYONLARI') return 'CUSTOMS';
    if (key === 'RETAILE AKTARIM BEKLENIYOR') return 'AWAITING_RETAIL_TRANSFER';
    if (key === 'DEPODA') return 'IN_WAREHOUSE';
    return 'UNKNOWN';
  }

  function priorityTokens(value) {
    return text(value).split(/[|+,;/\\\n&]/).map(part => (BR.turkNorm ? BR.turkNorm(part) : part.trim().toUpperCase())).filter(Boolean);
  }

  /* =================================================================
     SİPARİŞ BAZINDA ANALİZ
     ================================================================= */
  function analyzeOrder(row, context) {
    const ctx = context || {};
    const ord = typeof ctx.dateOrdinal === 'function' ? ctx.dateOrdinal : defaultOrdinal;
    const settings = { ...DEFAULT_SETTINGS, ...(ctx.settings || {}) };
    const today = ctx.today == null ? defaultOrdinal(new Date()) : ctx.today;
    const meta = (row && row._backlogExcel) || {};

    const status = text(row && row[F.status]);
    const stage = stageOf(status);
    const loadingTypeRaw = text(row && row[F.delType]);
    const loadingType = (BR.normalizeTransitDelType && BR.normalizeTransitDelType(loadingTypeRaw)) || loadingTypeRaw;
    const qty = Math.max(0, num(row && row[F.qty]));

    const targetType = settings.targetType === 'inStore' ? 'inStore' : 'retail';
    const targetDate = ord(row && row[targetType === 'inStore' ? F.inStore : F.retail]);
    const plannedLoadDate = ord(row && row[F.plannedLoad]);
    const revisedLoadDate = ord(row && row[F.revisedLoad]);
    const actualLoadDate = ord(meta.handoverDate);
    const actualAntrepoDate = ord(meta.actualAntrepoDate);
    const rowAntrepoDate = ord(row && row[F.antrepo]);
    /* Number(null) === 0 tuzağı: transit süresi TANIMSIZ olan bir siparişi
       "0 gün transit" saymak, sahte bir ETA ve sahte bir "yetişiyor" sonucu
       üretirdi. Eksik veri eksik kalmalı (bkz. kullanıcı talebi §43). */
    const rawTransitDays = (meta.transitDays == null || meta.transitDays === '' || !Number.isFinite(Number(meta.transitDays)))
      ? null : Number(meta.transitDays);
    /* requireTransitRule (varsayılan AÇIK — kullanıcı talebi):
       "Nakliye Tipine Göre Ülke Bazlı Yol Süreleri" ekranında bu siparişe
       uyan bir kural TANIMLI DEĞİLSE hesap yapılmaz. BLBusinessRules kural
       bulamayınca yükleme tipinin genel varsayılanına (Gemi 70 gün gibi)
       düşer; o varsayılan bir TAHMİNDİR, kullanıcının girdiği bir süre
       değildir. Onun üzerinden ETA/risk üretmek, kullanıcıya girmediği bir
       veriyi girmiş gibi göstermek olurdu. Bunun yerine sipariş
       "Hesaplanamıyor" kalır ve eksik bilgi olarak raporlanır. */
    const transitRuleDefined = Boolean(meta.transitRule);
    const requireRule = settings.requireTransitRule !== false;
    const transitRuleMissing = requireRule && !transitRuleDefined;
    const plannedTransitDays = transitRuleMissing ? null : rawTransitDays;

    const isProduction = stage === 'PRODUCTION';
    const isLoading = stage === 'LOADING';
    const isShortage = stage === 'SHORTAGE';
    const preLoad = PRE_LOAD_STAGES.has(stage);
    const arrived = actualAntrepoDate != null || ARRIVED_STAGES.has(stage);

    /* ETA — gerçekleşmiş antrepo tarihi her zaman önceliklidir. LOADING için
       eski motorda hiç ETA yolu yoktu; bu yüzden Loading Operations siparişi
       transit kuralı ve hedef tarihi mevcut olsa bile UNKNOWN kalıyordu.
       Handover gerçekleşmişse fiili yükleme bazıdır. Handover yoksa ürün henüz
       çıkmadığı için geçmiş Ex-Factory bugüne taşınır: MAX(Today, Ex-Factory).
       Üretim ve shortage'ın mevcut davranışı korunur. */
    let eta = null, etaSource = null;
    /* etaSource='ias': tarih IAS'tan geliyor ('Tahmini Antrepo Giriş Tarihi').
       Bu tarih GELECEKTE de olabilir — yani "gerçekleşmiş varış" demek DEĞİL,
       yalnız kaynağı bizim hesabımız değil demek. Gerçekten varmış olma
       koşulu aşağıda ayrıca (eta <= bugün) sınanır. */
    if (actualAntrepoDate != null) { eta = actualAntrepoDate; etaSource = 'ias'; }
    else if (isLoading && actualLoadDate != null && plannedTransitDays != null) {
      eta = actualLoadDate + plannedTransitDays; etaSource = 'calculated';
    } else if ((isProduction || isLoading || isShortage) && revisedLoadDate != null && plannedTransitDays != null) {
      const movePastLoadToToday = (isProduction || isLoading) && today != null && revisedLoadDate < today;
      const base = movePastLoadToToday ? today : revisedLoadDate;
      eta = base + plannedTransitDays; etaSource = 'calculated';
    } else if (rowAntrepoDate != null && !transitRuleMissing) {
      /* Satırdaki 'ANTREPO GİRİŞ TARİHİ' üretim/eksik yükleme satırlarında
         sunucunun KENDİ tahminidir (Ex-Factory + transit). Yol süresi kuralı
         tanımlı değilken o tahmin de varsayılan süreye dayanır; kullanılırsa
         "kural yoksa hesaplama" kuralı arka kapıdan delinmiş olurdu. */
      eta = rowAntrepoDate; etaSource = 'estimated';
    }

    const requiredBuffer = targetType === 'inStore' ? num(settings.requiredBufferInStore) : num(settings.requiredBufferRetail);
    const scheduleBufferDays = targetDate != null && eta != null ? targetDate - eta : null;
    const remainingDays = targetDate != null && today != null ? targetDate - today : null;
    const latestSafeLoadDate = targetDate != null && plannedTransitDays != null ? targetDate - plannedTransitDays - requiredBuffer : null;

    const loadingVarianceDays = actualLoadDate != null && plannedLoadDate != null ? actualLoadDate - plannedLoadDate : null;
    let actualTransitDays = null;
    if (actualLoadDate != null && actualAntrepoDate != null) actualTransitDays = actualAntrepoDate - actualLoadDate;
    else if (actualLoadDate != null && !arrived && today != null) actualTransitDays = today - actualLoadDate;
    const transitVarianceDays = actualTransitDays != null && plannedTransitDays != null ? actualTransitDays - plannedTransitDays : null;
    // Backlog satır üreticisi post-production transit override'ını tek kaynakta
    // hesaplayıp meta ile taşır. Elle kurulmuş/legacy satırlar için aynı koşulun
    // güvenli fallback'i: yükleme gerçekleşmiş, depoya ulaşılmış bir aşamada
    // değil ve yükleme + planlanan transit süresi bugünün gerisinde.
    const warehouseReceived = ARRIVED_STAGES.has(stage);
    const calculatedTransitOverdue = actualLoadDate != null
      && plannedTransitDays != null
      && today != null
      && actualAntrepoDate == null
      && !preLoad
      && !warehouseReceived
      && today > actualLoadDate + plannedTransitDays;
    const postProductionTransitOverdue = meta.transitOverdue === true || calculatedTransitOverdue;

    /* Yükleme başarımı */
    let loadingPerformance = 'UNKNOWN';
    if (actualLoadDate != null && plannedLoadDate != null) {
      loadingPerformance = loadingVarianceDays > num(settings.lateLoadingToleranceDays) ? 'LOADED_LATE' : 'LOADED_ON_TIME';
    } else if (actualLoadDate != null) {
      loadingPerformance = 'LOADED_ON_TIME';
    } else if (preLoad) {
      if (latestSafeLoadDate == null || today == null) loadingPerformance = 'UNKNOWN';
      else if (today > latestSafeLoadDate) loadingPerformance = 'NOT_LOADED_EXPECTED_LATE';
      else if (latestSafeLoadDate - today <= num(settings.atRiskBufferDays)) loadingPerformance = 'NOT_LOADED_AT_RISK';
      else loadingPerformance = 'NOT_LOADED_SAFE';
    }

    /* Teslimat sonucu */
    const missing = [];
    if (targetDate == null) missing.push(targetType === 'inStore' ? F.inStore : F.retail);
    if (!loadingType) missing.push(F.delType);
    // "Kural tanımlı değil" ile "süre hiç yok" ayrı sorunlardır; kullanıcıya
    // hangisini düzelteceğini söyleyebilmek için ayrı raporlanır.
    if (transitRuleMissing) missing.push('transitRule');
    else if (plannedTransitDays == null) missing.push('transitDays');
    if (eta == null) missing.push(F.antrepo);

    let deliveryOutcome = 'UNKNOWN';
    if (targetDate != null && eta != null) {
      const effective = scheduleBufferDays - requiredBuffer;
      if (effective < 0) {
        /* "Zaten gecikmiş" ile "gecikmesi bekleniyor" ayrımı: yalnız hedef
           tarih geçmişse ya da varış GERÇEKLEŞMİŞSE (IAS tarihi bugünü
           geçmişse) olmuş bir gecikmeden söz edilebilir. Gelecek tarihli bir
           IAS kaydına "zaten gecikti" demek yanlış olurdu. */
        const alreadyHappened = (today != null && targetDate < today)
          || (etaSource === 'ias' && eta != null && today != null && eta <= today);
        deliveryOutcome = alreadyHappened ? 'ALREADY_LATE' : 'EXPECTED_LATE';
      } else if (effective <= num(settings.atRiskBufferDays)) {
        deliveryOutcome = 'AT_RISK';
      } else {
        deliveryOutcome = 'ON_TRACK';
      }
    }
    // Hedef tarih hâlâ teorik olarak yetişebilir görünse bile planlanan transit
    // süresi fiilen aşılmış ve ürün depoya girmemişse "On Track" deneme.
    if (postProductionTransitOverdue && deliveryOutcome === 'ON_TRACK') deliveryOutcome = 'AT_RISK';

    /* Risk sebebi — yalnız riskli/geciken siparişlerde anlamlıdır. */
    const operationalSignals = Array.isArray(meta.signals) ? meta.signals.filter(item => item && item.code) : [];
    const signalCodes = new Set(operationalSignals.map(item => item.code));
    const riskReasons = [];
    let riskCause = null;
    if (deliveryOutcome === 'UNKNOWN') {
      riskCause = (missing.includes('transitRule') || missing.includes('transitDays')) && targetDate != null
        ? 'MISSING_TRANSIT_RULE' : 'MISSING_DATE';
      riskReasons.push(riskCause);
    } else if (deliveryOutcome !== 'ON_TRACK') {
      if (today != null && targetDate != null && targetDate < today && !arrived) riskReasons.push('TARGET_DATE_PASSED');
      if (stage === 'AWAITING_RETAIL_TRANSFER' || signalCodes.has('ANTREPO_DELAY')) riskReasons.push('RETAIL_TRANSFER_DELAY');
      if (stage === 'CUSTOMS') riskReasons.push('CUSTOMS_DELAY');
      if (postProductionTransitOverdue || (transitVarianceDays != null && transitVarianceDays > num(settings.transitToleranceDays))) riskReasons.push('TRANSIT_DELAY');
      if (loadingPerformance === 'LOADED_LATE') riskReasons.push('LATE_LOADING');
      if (isProduction && plannedLoadDate != null && today != null && today - plannedLoadDate > num(settings.productionOverdueDays)) riskReasons.push('PRODUCTION_DELAY');
      if (preLoad && actualLoadDate == null) {
        riskReasons.push(latestSafeLoadDate != null && today != null && today > latestSafeLoadDate ? 'INSUFFICIENT_TRANSIT_BUFFER' : 'NOT_YET_LOADED');
      }
      // AT_RISK is a delivery assessment, not by itself an action signal.
      // Only a concrete operational/root-cause reason may escalate it.
      if (!riskReasons.length && deliveryOutcome !== 'AT_RISK') riskReasons.push('UNKNOWN');
      riskCause = riskReasons[0] || null;
    }

    /* Güven seviyesi: hangi veriye dayanıyoruz? */
    let confidence = 'LOW';
    if (deliveryOutcome === 'UNKNOWN') confidence = 'LOW';
    else if (etaSource === 'ias') confidence = 'HIGH';
    else if (actualLoadDate != null || (revisedLoadDate != null && plannedTransitDays != null)) confidence = 'MEDIUM';

    // Unified Action Priority: delivery outcome, stage timing and structured
    // operational/root-cause signals feed the same resolver used by CP.
    const daysToLoad = plannedLoadDate != null && today != null ? plannedLoadDate - today : null;
    const actionDecision = OD.resolveActionPriority ? OD.resolveActionPriority({
      deliveryOutcome,
      preLoad,
      daysToLoad,
      settings: { criticalLoadDays: 3, actionThisWeekDays: 7 },
      reasons: riskReasons,
      signals: operationalSignals,
    }) : { priority: deliveryOutcome === 'UNKNOWN' ? 'WATCH' : 'ON_TRACK', calculationStatus: deliveryOutcome === 'UNKNOWN' ? 'UNKNOWN' : 'KNOWN', reasons: [] };

    const result = {
      orderKey: `${text(row && row[F.orderCode])}|${dimKey(row && row[F.model])}|${dimKey(row && row[F.colourCode])}`,
      orderCode: text(row && row[F.orderCode]),
      modelName: text(row && row[F.model]),
      colourCode: text(row && row[F.colourCode]),
      qty, status, stage, loadingType,
      targetType, targetDate, plannedLoadDate, revisedLoadDate, actualLoadDate,
      actualAntrepoDate, plannedTransitDays, actualTransitDays,
      loadingVarianceDays, transitVarianceDays,
      postProductionTransitOverdue,
      eta, etaSource, latestSafeLoadDate, remainingDays, scheduleBufferDays, requiredBuffer,
      deliveryOutcome, loadingPerformance, riskCause, riskReasons, confidence,
      calculationStatus: actionDecision.calculationStatus,
      actionPriority: actionDecision.priority, actionReasons: actionDecision.reasons || [],
      signals: operationalSignals,
      decision: {
        calculationStatus: actionDecision.calculationStatus,
        action: { priority: actionDecision.priority, reasons: actionDecision.reasons || [] },
        delivery: { outcome: deliveryOutcome, eta, targetDate, bufferDays: scheduleBufferDays },
      },
      transitRuleDefined, transitRuleMissing, fallbackTransitDays: rawTransitDays,
      missingFields: missing,
      // Compatibility field: eski CP warning metni değil, aynı unified Action
      // Priority sonucu döner. Yeni tüketiciler actionPriority/decision.action'ı kullanır.
      priority: actionDecision.priority,
      dims: {
        buyer: text(row && row[F.buyer]) || EMPTY,
        buyerGroup: text(row && row[F.buyerGroup]) || EMPTY,
        mag: text(meta.mag) || EMPTY,
        mmyg: text(meta.mmyg) || EMPTY,
        line: text(row && row[F.line]) || EMPTY,
        season: text(row && row[F.season]) || EMPTY,
        country: text(row && row[F.country]) || EMPTY,
        manufacturer: text(row && row[F.manufacturer]) || EMPTY,
        subManufacturer: text(row && row[F.subManufacturer]) || EMPTY,
        category: text(row && row[F.category]) || EMPTY,
        loadingType: loadingType || EMPTY,
        stage,
      },
    };
    /* Ham satır referansı: bir yoruma tıklandığında AYNI siparişlerin mevcut
       Backlog detay tablosunda açılabilmesi için gerekli (§31). Sayılabilir
       DEĞİL — JSON.stringify ve Object.keys çıktısını şişirmesin. */
    Object.defineProperty(result, 'sourceRow', { value: row, enumerable: false, writable: false });
    return result;
  }

  /* =================================================================
     TOPLULAŞTIRMA — TEK GEÇİŞ
     ================================================================= */
  function blankMeasure() { return { qty: 0, orders: new Set(), rows: 0 }; }
  function addMeasure(measure, analysis) { measure.qty += analysis.qty; measure.rows += 1; if (analysis.orderKey) measure.orders.add(analysis.orderKey); }
  function sealMeasure(measure, totalQty) {
    return { qty: measure.qty, orders: measure.orders.size, rows: measure.rows, qtyShare: totalQty > 0 ? measure.qty / totalQty * 100 : 0 };
  }
  function blankOutcomeSet() { const out = {}; OUTCOMES.forEach(key => { out[key] = blankMeasure(); }); return out; }
  function sealOutcomeSet(set, totalQty) { const out = {}; OUTCOMES.forEach(key => { out[key] = sealMeasure(set[key], totalQty); }); return out; }

  function analyze(rows, options) {
    const opts = options || {};
    const settings = { ...DEFAULT_SETTINGS, ...(opts.settings || {}) };
    const ord = typeof opts.dateOrdinal === 'function' ? opts.dateOrdinal : defaultOrdinal;
    const today = opts.today == null ? defaultOrdinal(new Date()) : opts.today;
    const ctx = { dateOrdinal: ord, settings, today };
    const list = Array.isArray(rows) ? rows : [];

    const orders = [];
    const totals = blankMeasure();
    const outcomes = blankOutcomeSet();
    const loading = {}; LOADING_OUTCOMES.forEach(key => { loading[key] = blankMeasure(); });
    const causes = new Map();
    const stages = new Map();
    const stageOutcome = new Map();
    const dims = {}; DIMENSIONS.forEach(dim => { dims[dim] = new Map(); });
    const etaSources = { ias: blankMeasure(), calculated: blankMeasure(), estimated: blankMeasure(), none: blankMeasure() };
    const confidences = { HIGH: blankMeasure(), MEDIUM: blankMeasure(), LOW: blankMeasure() };
    const missingCounts = new Map();
    const transitDelayed = blankMeasure();      // zamanında yüklendi AMA transit aşıldı
    const transitDelayedAtRisk = blankMeasure();
    const missingTransitRule = blankMeasure();  // yol süresi kuralı tanımsız
    const missingRuleKeys = new Map();          // hangi ülke+yükleme tipi için eksik

    for (const row of list) {
      const analysis = analyzeOrder(row, ctx);
      orders.push(analysis);
      addMeasure(totals, analysis);
      addMeasure(outcomes[analysis.deliveryOutcome], analysis);
      addMeasure(loading[analysis.loadingPerformance], analysis);
      addMeasure(etaSources[analysis.etaSource || 'none'], analysis);
      addMeasure(confidences[analysis.confidence], analysis);

      if (!stages.has(analysis.stage)) stages.set(analysis.stage, blankMeasure());
      addMeasure(stages.get(analysis.stage), analysis);
      if (!stageOutcome.has(analysis.stage)) stageOutcome.set(analysis.stage, blankOutcomeSet());
      addMeasure(stageOutcome.get(analysis.stage)[analysis.deliveryOutcome], analysis);

      analysis.riskReasons.forEach(cause => {
        if (!causes.has(cause)) causes.set(cause, blankMeasure());
        addMeasure(causes.get(cause), analysis);
      });
      analysis.missingFields.forEach(field => {
        if (!missingCounts.has(field)) missingCounts.set(field, blankMeasure());
        addMeasure(missingCounts.get(field), analysis);
      });
      /* Yol süresi kuralı eksikse: hangi ülke + yükleme tipi kombinasyonu için
         kural tanımlanması gerektiğini de topla — kullanıcı "eksik" uyarısını
         görünce doğrudan hangi kuralı gireceğini bilsin. */
      if (analysis.transitRuleMissing) {
        addMeasure(missingTransitRule, analysis);
        const comboKey = `${analysis.dims.country}|${analysis.dims.loadingType}`;
        if (!missingRuleKeys.has(comboKey)) {
          missingRuleKeys.set(comboKey, { country: analysis.dims.country, loadingType: analysis.dims.loadingType, measure: blankMeasure() });
        }
        addMeasure(missingRuleKeys.get(comboKey).measure, analysis);
      }

      // §10 — zamanında yüklenmiş ama yolda planı aşmış siparişler ayrı kategori.
      if (analysis.loadingPerformance === 'LOADED_ON_TIME' && analysis.transitVarianceDays != null
        && analysis.transitVarianceDays > num(settings.transitToleranceDays)) {
        addMeasure(transitDelayed, analysis);
        if (analysis.deliveryOutcome === 'AT_RISK' || analysis.deliveryOutcome === 'EXPECTED_LATE' || analysis.deliveryOutcome === 'ALREADY_LATE') {
          addMeasure(transitDelayedAtRisk, analysis);
        }
      }

      DIMENSIONS.forEach(dim => {
        const label = analysis.dims[dim] || EMPTY, key = dimKey(label) || EMPTY;
        let bucket = dims[dim].get(key);
        if (!bucket) { bucket = { key, name: label, total: blankMeasure(), outcomes: blankOutcomeSet(), lateLoading: blankMeasure(), transitDelay: blankMeasure() }; dims[dim].set(key, bucket); }
        addMeasure(bucket.total, analysis);
        addMeasure(bucket.outcomes[analysis.deliveryOutcome], analysis);
        if (analysis.loadingPerformance === 'LOADED_LATE') addMeasure(bucket.lateLoading, analysis);
        if (analysis.riskReasons.includes('TRANSIT_DELAY')) addMeasure(bucket.transitDelay, analysis);
      });
    }

    const totalQty = totals.qty;
    const sealedDims = {};
    DIMENSIONS.forEach(dim => {
      sealedDims[dim] = [...dims[dim].values()].map(bucket => ({
        key: bucket.key, name: bucket.name,
        total: sealMeasure(bucket.total, totalQty),
        outcomes: sealOutcomeSet(bucket.outcomes, totalQty),
        lateLoading: sealMeasure(bucket.lateLoading, totalQty),
        transitDelay: sealMeasure(bucket.transitDelay, totalQty),
      })).sort((a, b) => b.total.qty - a.total.qty || a.name.localeCompare(b.name, 'tr-TR'));
    });

    const riskOrders = orders.filter(item => item.deliveryOutcome === 'ALREADY_LATE' || item.deliveryOutcome === 'EXPECTED_LATE' || item.deliveryOutcome === 'AT_RISK');
    const outcomeRank = { ALREADY_LATE: 0, EXPECTED_LATE: 1, AT_RISK: 2 };
    const topRiskOrders = riskOrders.slice().sort((a, b) =>
      (outcomeRank[a.deliveryOutcome] - outcomeRank[b.deliveryOutcome])
      || ((a.scheduleBufferDays == null ? 0 : a.scheduleBufferDays) - (b.scheduleBufferDays == null ? 0 : b.scheduleBufferDays))
      || (b.qty - a.qty)).slice(0, 200);

    return {
      context: {
        targetType: settings.targetType, today, settings,
        rowCount: list.length, generatedAt: new Date().toISOString(),
      },
      orders,
      totals: sealMeasure(totals, totalQty),
      deliveryOutcome: sealOutcomeSet(outcomes, totalQty),
      loadingPerformance: Object.fromEntries(LOADING_OUTCOMES.map(key => [key, sealMeasure(loading[key], totalQty)])),
      transitPerformance: {
        loadedOnTimeButDelayed: sealMeasure(transitDelayed, totalQty),
        loadedOnTimeButDelayedAtRisk: sealMeasure(transitDelayedAtRisk, totalQty),
      },
      stages: [...stages.entries()].map(([key, measure]) => ({
        key, total: sealMeasure(measure, totalQty),
        outcomes: sealOutcomeSet(stageOutcome.get(key) || blankOutcomeSet(), totalQty),
      })).sort((a, b) => STAGES.indexOf(a.key) - STAGES.indexOf(b.key)),
      rootCauses: [...causes.entries()].map(([key, measure]) => ({ key, ...sealMeasure(measure, totalQty) }))
        .sort((a, b) => b.qty - a.qty),
      dimensions: sealedDims,
      etaSources: Object.fromEntries(Object.entries(etaSources).map(([key, measure]) => [key, sealMeasure(measure, totalQty)])),
      confidence: Object.fromEntries(Object.entries(confidences).map(([key, measure]) => [key, sealMeasure(measure, totalQty)])),
      dataQuality: {
        missing: [...missingCounts.entries()].map(([field, measure]) => ({ field, ...sealMeasure(measure, totalQty) })).sort((a, b) => b.rows - a.rows),
        unknown: sealMeasure(outcomes.UNKNOWN, totalQty),
        transitRule: {
          ...sealMeasure(missingTransitRule, totalQty),
          combos: [...missingRuleKeys.values()]
            .map(item => ({ country: item.country, loadingType: item.loadingType, ...sealMeasure(item.measure, totalQty) }))
            .sort((a, b) => b.rows - a.rows),
        },
      },
      topRiskOrders,
    };
  }

  /* =================================================================
     NEEDS ATTENTION — buyer'ın sabah listesi
     ================================================================= */
  /* limit YALNIZ listelenen satır sayısını kısar; grup SAYILARI her zaman
     tam kümeden gelir. (Eskiden limit sayıyı da kısıyordu: ekranda "200
     aksiyon" yazıyordu ama gerçek sayı daha yüksekti — rapor sayısını
     güvenilmez yapan bir hataydı.) */
  function needsAttention(model, options) {
    const opts = options || {};
    const limit = Math.max(1, Math.min(100000, Number(opts.limit) || 50));
    const groups = { CRITICAL: [], ACTION_TODAY: [], ACTION_THIS_WEEK: [], WATCH: [], ON_TRACK: [] };
    (model && model.orders ? model.orders : []).forEach(order => {
      const key = OD.normalizePriority ? OD.normalizePriority(order.actionPriority || (order.decision && order.decision.action && order.decision.action.priority), 'WATCH')
        : (order.actionPriority || 'WATCH');
      (groups[key] || groups.WATCH).push(order);
    });
    const rank = (a, b) => {
      const ar = OD.priorityRank ? OD.priorityRank(a.actionPriority) : 99;
      const br = OD.priorityRank ? OD.priorityRank(b.actionPriority) : 99;
      return (ar - br)
        || ((a.scheduleBufferDays == null ? 9999 : a.scheduleBufferDays) - (b.scheduleBufferDays == null ? 9999 : b.scheduleBufferDays))
        || (b.qty - a.qty);
    };
    const counts = {}, quantities = {};
    Object.keys(groups).forEach(key => {
      counts[key] = groups[key].length;
      quantities[key] = groups[key].reduce((total, order) => total + (Number(order.qty) || 0), 0);
      groups[key] = groups[key].sort(rank).slice(0, limit);
    });
    // Backwards-compatible aliases for legacy Backlog UI/tests. New code must
    // use ACTION_* names.
    groups.ACT_TODAY = [...groups.CRITICAL, ...groups.ACTION_TODAY].sort(rank).slice(0, limit);
    groups.ACT_THIS_WEEK = groups.ACTION_THIS_WEEK;
    counts.ACT_TODAY = counts.CRITICAL + counts.ACTION_TODAY;
    counts.ACT_THIS_WEEK = counts.ACTION_THIS_WEEK;
    quantities.ACT_TODAY = quantities.CRITICAL + quantities.ACTION_TODAY;
    quantities.ACT_THIS_WEEK = quantities.ACTION_THIS_WEEK;
    Object.defineProperty(groups, 'counts', { value: counts, enumerable: false });
    Object.defineProperty(groups, 'quantities', { value: quantities, enumerable: false });
    return groups;
  }

  return {
    FIELDS: F, STAGES, STAGE_LABELS, OUTCOMES, OUTCOME_LABELS, RISK_CAUSES, RISK_CAUSE_LABELS,
    LOADING_OUTCOMES, LOADING_LABELS, DIMENSIONS, DIMENSION_LABELS, DEFAULT_SETTINGS,
    PRE_LOAD_STAGES, ARRIVED_STAGES,
    stageOf, analyzeOrder, analyze, needsAttention, defaultOrdinal, dimKey,
  };
});
