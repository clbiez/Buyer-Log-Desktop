/* Buyer Log v9.48 — CP ÜRETİM HAZIRLIK / ÖNCELİK MOTORU
 *
 * "Bugün hangi siparişlere bakmalıyım?" sorusunun deterministik cevabı.
 *
 * ÜÇ KANONİK KAYNAK, SIFIR KOPYA KURAL:
 *  1) Gecikme/transit kuralları  → public/business-rules.js (computePriorityFlags)
 *  2) Teslimat sonucu/ETA        → public/backlog-delivery-engine.js
 *  3) Satır şeması               → server/lib/parse.js buildOrderRowsFromASAS
 *
 * Teslimat riski BURADA YENİDEN SINIFLANDIRILMAZ. CP satırı, teslimat
 * motorunun okuduğu şekle çevrilir ve AYNI fonksiyon çağrılır; böylece
 * Backlog Teslimat Analizi ile CP Overview asla farklı sonuç veremez.
 *
 * VERİ SINIRI — DÜRÜSTLÜK KURALI:
 * CP veri modelinde numune (PPS/S-Off/Proto/Fit/Size Set), test, kumaş
 * HAZIRLIK statüsü, aksesuar statüsü, üretim aşaması (kesim/dikim/ütü/paket),
 * üretici yükleme teyidi ve Merchandiser ALANLARI YOKTUR.
 * Bu motor onları TAHMİN ETMEZ ve "yok" saymaz: `UNAVAILABLE_DIMENSIONS`
 * altında açıkça raporlar. Var olmayan veriden "PPS eksik" uyarısı üretmek,
 * bu zincirdeki en pahalı hata türüdür.
 *
 * SAF: DOM yok, fetch yok, AI yok.
 */
(function (root, factory) {
  const isNode = typeof require === 'function' && typeof module === 'object';
  const api = factory(
    isNode ? require('./business-rules') : (root && root.BLBusinessRules),
    isNode ? require('./backlog-delivery-engine') : (root && root.BLBacklogDeliveryEngine),
    isNode ? require('./order-decision-engine') : (root && root.BLOrderDecisionEngine)
  );
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.BLCpReadinessEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (businessRules, deliveryEngine, decisionEngine) {
  'use strict';

  const BR = businessRules || {};
  const DE = deliveryEngine || {};
  const OD = decisionEngine || {};
  /* Teslimat motoru olmadan bu motorun söyleyecek bir şeyi yoktur: her sipariş
     "Hesaplanamıyor" çıkar. Bu SESSİZ olmamalı — canlıda tam olarak böyle
     oldu (v9.48: motor lazy-yükleme listesine eklenmemişti ve panel 1431
     siparişin hepsini UNKNOWN gösterdi, hiçbir hata görünmedi). */
  const deliveryEngineReady = typeof DE.analyzeOrder === 'function';

  /* CP satırının GERÇEK anahtarları (parse.js buildOrderRowsFromASAS). */
  const F = Object.freeze({
    orderCode: 'Order Code',
    model: 'Model Name',
    colourCode: 'C.Code',
    colour: 'Colour',
    status: 'STATUS',
    priority: 'Priority',
    orderDate: 'OPD',
    exFactory: 'Ex-factory',
    handover: 'HANDOVER Tarihi',
    shipConfirmation: 'Buying Son Onay Tarihi',
    retail: 'Retail Date',
    inStore: 'In-Store (Model Budget)',
    antArrival: 'Ant. Arrival',
    delType: 'Del. Type',
    qty: 'Order Quantity',
    shipped: 'Shipment Quantity',
    remaining: 'Remaining Units',
    season: 'Season',
    country: 'Country',
    buyer: 'Buyer',
    buyerGroup: 'Buyer Grup (TR)',
    mag: 'Merch Alt Grup Kod',
    mmyg: 'Merch Marka Yaş Grup Kod',
    line: 'Line',
    category: 'Category',
    manufacturer: 'Manufacturer',
    subManufacturer: 'Sub-Manufacturer',
    licensor: 'Licensor',
    shortageQty: '_logisticShortageQty',
    shortageAllInWarehouse: '_logisticAllPartialsInWarehouse',
    /* ASAS DB'nin KENDİ tarihleri. parse.js bunları her satıra yazıyor
       (buildOrderRowsFromASAS → asasBaseline). Buyer Log'da bir tarih revize
       edilince görünen sütun değişir ama bu alanlar ASAS'ın hâlâ ne dediğini
       taşır — tarih senkronu tam olarak bu ikisinin farkıdır. */
    asasExFactory: '_asasExFactory',
    asasRetail: '_asasRetailDate',
    asasInStore: '_asasInStore',
  });

  /* Tarih senkronu (§25). Kaynak ASAS DB'dir: Buyer Log revizyonu
     ASAS'a yansımadıysa iki sistem farklı tarih söylüyor demektir. */
  const DATE_SYNC_STATES = Object.freeze(['MATCH', 'REVISED_IN_BUYER_LOG', 'UNKNOWN']);
  const DATE_SYNC_LABELS = Object.freeze({
    tr: { MATCH: 'Tarihler uyumlu', REVISED_IN_BUYER_LOG: 'Buyer Log\'da revize, ASAS eski', UNKNOWN: 'Karşılaştırılamıyor' },
    en: { MATCH: 'Dates match', REVISED_IN_BUYER_LOG: 'Revised in Buyer Log, ASAS old', UNKNOWN: 'Not comparable' },
  });
  const DATE_SYNC_FIELDS = Object.freeze([
    Object.freeze({ key: 'exFactory', current: 'exFactory', baseline: 'asasExFactory', tr: 'Ex-Factory', en: 'Ex-Factory' }),
    Object.freeze({ key: 'retail', current: 'retail', baseline: 'asasRetail', tr: 'Retail Depo', en: 'Retail Warehouse' }),
    Object.freeze({ key: 'inStore', current: 'inStore', baseline: 'asasInStore', tr: 'In Store', en: 'In Store' }),
  ]);

  function dateSyncOf(row, ord) {
    const differences = [];
    let comparable = 0;
    for (const field of DATE_SYNC_FIELDS) {
      const current = ord(row && row[F[field.current]]);
      const baseline = ord(row && row[F[field.baseline]]);
      if (current == null || baseline == null) continue;
      comparable += 1;
      if (current !== baseline) differences.push({ key: field.key, current, baseline, deltaDays: current - baseline });
    }
    if (!comparable) return { status: 'UNKNOWN', differences: [] };
    return { status: differences.length ? 'REVISED_IN_BUYER_LOG' : 'MATCH', differences };
  }

  /* CP'de veri karşılığı OLMAYAN analiz boyutları. Ekran bunları "kapalı"
     değil, "veri yok" olarak göstermek zorundadır. */
  const UNAVAILABLE_DIMENSIONS = Object.freeze([
    Object.freeze({ key: 'samples', tr: 'Numune onayları (PPS, S/Off, Proto, Fit, Size Set)', en: 'Sample approvals (PPS, S/Off, Proto, Fit, Size Set)' }),
    Object.freeze({ key: 'tests', tr: 'Test talebi ve sonucu', en: 'Test requirement and result' }),
    Object.freeze({ key: 'fabricReadiness', tr: 'Kumaş hazırlık statüsü (CP yalnız kumaş özelliklerini taşır)', en: 'Fabric readiness status (CP carries only fabric attributes)' }),
    Object.freeze({ key: 'accessories', tr: 'Aksesuar hazırlık statüsü', en: 'Accessory readiness status' }),
    Object.freeze({ key: 'productionStage', tr: 'Üretim aşaması (kesim, dikim, ütü, paket)', en: 'Production stage (cutting, sewing, finishing, packing)' }),
    Object.freeze({ key: 'supplierConfirmation', tr: 'Üretici yükleme teyidi', en: 'Supplier loading confirmation' }),
    Object.freeze({ key: 'merchandiser', tr: 'Sipariş bazında Merchandiser ataması (takip e-posta grubu üzerinden yapılıyor)', en: 'Per-order merchandiser assignment (handled through the follow-up mail group)' }),
    Object.freeze({ key: 'revisionHistory', tr: 'Revizyon geçmişi (yalnız güncel ASAS/Buyer Log farkı görülebiliyor, kaç kez revize edildiği değil)', en: 'Revision history (only the current ASAS/Buyer Log difference is visible, not how many times it was revised)' }),
  ]);

  /* Yükleme geri sayımı kovaları. Eşikler tek yerde. */
  const LOAD_WINDOWS = Object.freeze(['OVERDUE', 'W0_2', 'W2_4', 'W4_6', 'W6_8', 'W8_PLUS', 'UNKNOWN']);
  const LOAD_WINDOW_LABELS = Object.freeze({
    tr: { OVERDUE: 'Gecikmiş', W0_2: '0–2 hafta', W2_4: '2–4 hafta', W4_6: '4–6 hafta', W6_8: '6–8 hafta', W8_PLUS: '8+ hafta', UNKNOWN: 'Tarih yok' },
    en: { OVERDUE: 'Overdue', W0_2: '0–2 weeks', W2_4: '2–4 weeks', W4_6: '4–6 weeks', W6_8: '6–8 weeks', W8_PLUS: '8+ weeks', UNKNOWN: 'No date' },
  });

  // Compatibility: UNKNOWN remains exposed to old UI callers as a data-quality
  // bucket, but it is no longer a valid action severity.
  const ACTION_PRIORITIES = Object.freeze((OD.ACTION_PRIORITIES || ['CRITICAL', 'ACTION_TODAY', 'ACTION_THIS_WEEK', 'WATCH', 'ON_TRACK']).slice());
  const PRIORITIES = Object.freeze([...ACTION_PRIORITIES, 'UNKNOWN']);
  const PRIORITY_LABELS = Object.freeze({
    tr: { CRITICAL: 'Kritik', ACTION_TODAY: 'Bugün Aksiyon', ACTION_THIS_WEEK: 'Bu Hafta Aksiyon', WATCH: 'İzlemede', ON_TRACK: 'Yolunda', UNKNOWN: 'Hesaplanamıyor' },
    en: { CRITICAL: 'Critical', ACTION_TODAY: 'Action Today', ACTION_THIS_WEEK: 'Action This Week', WATCH: 'Watch', ON_TRACK: 'On Track', UNKNOWN: 'Unknown' },
  });

  const RISK_REASONS = Object.freeze([
    'ALREADY_LATE_FOR_TARGET', 'EXPECTED_LATE_FOR_TARGET',
    'EX_FACTORY_OVERDUE', 'HANDOVER_PENDING',
    'STALE_ORDER_NOT_LOADED', 'LOADING_WINDOW_IMMINENT',
    'MISSING_TRANSIT_RULE', 'MISSING_DATE', 'DATE_SYNC_MISMATCH',
  ]);
  const RISK_REASON_LABELS = Object.freeze({
    tr: {
      ALREADY_LATE_FOR_TARGET: 'Hedef tarih için zaten gecikmiş',
      EXPECTED_LATE_FOR_TARGET: 'Hedef tarihe yetişmesi beklenmiyor',
      EX_FACTORY_OVERDUE: 'Ex-Factory tarihi geçmiş, sipariş hâlâ üretimde',
      HANDOVER_PENDING: 'Yükleme onayı verildi, Handover bekleniyor',
      STALE_ORDER_NOT_LOADED: 'Sipariş yaşlanmış, hâlâ yüklenmemiş',
      LOADING_WINDOW_IMMINENT: 'Yükleme penceresi çok yakın',
      MISSING_TRANSIT_RULE: 'Yol süresi kuralı tanımsız',
      MISSING_DATE: 'Zorunlu tarih eksik',
      DATE_SYNC_MISMATCH: 'Buyer Log ve ASAS tarihi farklı',
    },
    en: {
      ALREADY_LATE_FOR_TARGET: 'Already late for the target date',
      EXPECTED_LATE_FOR_TARGET: 'Not expected to make the target date',
      EX_FACTORY_OVERDUE: 'Ex-Factory date passed, still in production',
      HANDOVER_PENDING: 'Loading confirmed, Handover pending',
      STALE_ORDER_NOT_LOADED: 'Order has aged and is still not loaded',
      LOADING_WINDOW_IMMINENT: 'Loading window is imminent',
      MISSING_TRANSIT_RULE: 'Transit time rule is not defined',
      MISSING_DATE: 'A required date is missing',
      DATE_SYNC_MISMATCH: 'Buyer Log and ASAS dates differ',
    },
  });

  /* Eşikler tek yerde ve çağıran tarafından ezilebilir (§6, §16). */
  const DEFAULT_SETTINGS = Object.freeze({
    targetType: 'retail',              // 'retail' | 'inStore'
    requireTransitRule: true,          // kural yoksa hesaplama YAPMA
    staleOrderAgeDays: 30,             // "sipariş yaşlandı" eşiği
    imminentLoadDays: 14,              // yükleme penceresi yakın
    criticalLoadDays: 3,               // yükleme çok yakın
    actionThisWeekDays: 7,
  });

  const EMPTY = '—';
  const text = value => String(value == null ? '' : value).trim();
  const num = value => { const n = Number(value); return Number.isFinite(n) ? n : 0; };
  const dimKey = value => text(value) || EMPTY;

  function defaultOrdinal(value) {
    if (value == null || value === '') return null;
    const date = value instanceof Date ? value : new Date(value);
    if (!date || isNaN(date)) return null;
    return Math.round(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000);
  }

  function loadWindowOf(daysToLoad) {
    if (daysToLoad == null) return 'UNKNOWN';
    if (daysToLoad < 0) return 'OVERDUE';
    if (daysToLoad <= 14) return 'W0_2';
    if (daysToLoad <= 28) return 'W2_4';
    if (daysToLoad <= 42) return 'W4_6';
    if (daysToLoad <= 56) return 'W6_8';
    return 'W8_PLUS';
  }

  /* CP satırını teslimat motorunun okuduğu şekle çevirir.
     DİKKAT: CP'de "orijinal" ve "revize" yükleme tarihi AYRI TUTULMAZ; tek bir
     Ex-Factory vardır. Bu yüzden ikisi de aynı değere bağlanır ve yükleme
     sapması CP'den ÖLÇÜLEMEZ (motor bunu kendiliğinden UNKNOWN yapar).
     Uydurma bir "planlanan" tarih üretmiyoruz. */
/* `Ant. Arrival` HER ZAMAN gerçek bir antrepo girişi DEĞİLDİR: sipariş hâlâ
   üretimdeyken CP formülleri onu varsayılan yol süresinden TÜRETİR. Türetilmiş
   bir tarihi "gerçekleşen" diye teslimat motoruna vermek, kural tanımsızken bile
   yüksek güvenli sahte bir ETA üretirdi. Bu yüzden yalnız sipariş fiilen
   sevk edilmiş/varmışsa gerçek kabul edilir. */
  const PRE_LOAD_STAGES = Object.freeze(new Set(['PRODUCTION', 'LOADING', 'SHORTAGE', 'UNKNOWN']));
  function actualAntrepoOf(row, stage) {
    return PRE_LOAD_STAGES.has(stage) ? null : (row && row[F.antArrival]);
  }

  function toDeliveryRow(row, transitDays, transitRule, stage, operationalSignals) {
    const DF = DE.FIELDS || {};
    const exFactory = row && row[F.exFactory];
    const actualAntrepo = actualAntrepoOf(row, stage || (DE.stageOf ? DE.stageOf(row && row[F.status]) : 'UNKNOWN'));
    return {
      [DF.status]: row && row[F.status],
      [DF.revisedLoad]: exFactory,
      [DF.plannedLoad]: exFactory,
      [DF.antrepo]: actualAntrepo,
      [DF.delType]: row && row[F.delType],
      [DF.retail]: row && row[F.retail],
      [DF.inStore]: row && row[F.inStore],
      [DF.qty]: row && row[F.qty],
      [DF.orderQty]: row && row[F.qty],
      [DF.orderCode]: row && row[F.orderCode],
      [DF.model]: row && row[F.model],
      [DF.colourCode]: row && row[F.colourCode],
      [DF.season]: row && row[F.season],
      [DF.country]: row && row[F.country],
      [DF.buyer]: row && row[F.buyer],
      [DF.buyerGroup]: row && row[F.buyerGroup],
      [DF.manufacturer]: row && row[F.manufacturer],
      [DF.subManufacturer]: row && row[F.subManufacturer],
      [DF.line]: row && row[F.line],
      [DF.category]: row && row[F.category],
      _backlogExcel: {
        transitDays,
        transitRule,
        handoverDate: row && row[F.handover],
        actualAntrepoDate: actualAntrepo,
        priority: row && row[F.priority], // legacy display only; decision logic uses signals
        signals: Array.isArray(operationalSignals) ? operationalSignals : [],
        mag: row && row[F.mag],
        mmyg: row && row[F.mmyg],
      },
    };
  }

  function analyzeOrder(row, ctx) {
    const context = ctx || {};
    const ord = typeof context.dateOrdinal === 'function' ? context.dateOrdinal : defaultOrdinal;
    const settings = { ...DEFAULT_SETTINGS, ...(context.settings || {}) };
    const today = context.today == null ? defaultOrdinal(new Date()) : context.today;

    const status = text(row && row[F.status]);
    const qty = Math.max(0, num(row && row[F.qty]));
    const orderDate = ord(row && row[F.orderDate]);
    const exFactory = ord(row && row[F.exFactory]);
    const retailDate = ord(row && row[F.retail]);
    const inStoreDate = ord(row && row[F.inStore]);

    const orderAgeDays = orderDate != null && today != null ? today - orderDate : null;
    const daysToLoad = exFactory != null && today != null ? exFactory - today : null;
    const loadWindow = loadWindowOf(daysToLoad);
    const weeksToLoad = daysToLoad == null ? null : Math.floor(daysToLoad / 7);

    /* Yol süresi: KANONİK kural motorundan. Kural yoksa gün sayısı üretme. */
    const transitInfo = BR.resolveTransitDays ? BR.resolveTransitDays({
      delType: row && row[F.delType],
      exFactory: row && row[F.exFactory],
      season: row && row[F.season],
      country: row && row[F.country],
      status,
      rules: context.transitRules,
      // Readiness hem üretim hem de yükleme/transit sonrası aşamaları analiz eder.
      // Merkezi resolver'ın legacy production-only guard'ını global olarak
      // değiştirmeden, bu çağrı noktasında tanımlı Transfer Lead Time Rule'u
      // her operasyon aşamasında aratırız. Kural gerçekten yoksa resolver yine
      // fallback gün + rule:null döndürür ve requireTransitRule bunu missing sayar.
      forceRules: true,
    }, ord) : null;
    const transitRule = transitInfo && transitInfo.rule ? transitInfo.rule : null;
    const transitDays = transitInfo && Number.isFinite(Number(transitInfo.days)) ? Number(transitInfo.days) : null;

    /* CP operasyon sinyalleri KANONİK business-rules motorundan gelir.
       Handover şartları burada TEKRAR YAZILMAZ: structured HANDOVER_PENDING
       sinyalini besleyen computePriorityFlags().handoverWarning aynı boolean
       kaynaktır. CP Priority hücresi ise bu sinyalden türeyen Unified Action
       Priority'yi gösterir. `today` analiz bağlamında ordinal olabilir;
       computePriorityFlags tüm
       tarihleri dateOrdinal ile normalize ettiği için ordinal sayıları olduğu
       gibi geçiren küçük adaptör kullanılır. */
    const canonicalOrdinal = value => (typeof value === 'number' && Number.isFinite(value) ? value : ord(value));
    const shortageQty = row && row[F.shortageQty];
    const cpOperationalFlags = BR.computePriorityFlags ? BR.computePriorityFlags({
      exFactory: row && row[F.exFactory],
      retailDate: row && row[F.retail],
      inStoreDate: row && row[F.inStore],
      antArrival: row && row[F.antArrival],
      handoverDate: row && row[F.handover],
      shipConfirmationDate: row && row[F.shipConfirmation],
      status,
      shortage: Number(shortageQty) > 0,
      shortageQty,
      shortageNote: Number(shortageQty) > 0 && row && row[F.shortageAllInWarehouse] === true,
      delType: row && row[F.delType],
      season: row && row[F.season],
      country: row && row[F.country],
      rules: context.transitRules,
      today,
    }, canonicalOrdinal) : null;
    const handoverWarning = Boolean(cpOperationalFlags && cpOperationalFlags.handoverWarning);

    /* Teslimat sonucu KANONİK motordan; burada yeniden sınıflandırılmaz. */
    const stageFromStatus = DE.stageOf ? DE.stageOf(status) : 'UNKNOWN';
    const delivery = DE.analyzeOrder
      ? DE.analyzeOrder(toDeliveryRow(row, transitDays, transitRule, stageFromStatus, cpOperationalFlags && cpOperationalFlags.signals), {
        today, dateOrdinal: ord,
        settings: { targetType: settings.targetType, requireTransitRule: settings.requireTransitRule },
      })
      : null;

    const deliveryOutcome = delivery ? delivery.deliveryOutcome : 'UNKNOWN';
    const stage = delivery ? delivery.stage : stageFromStatus;
    const preLoad = stage === 'PRODUCTION' || stage === 'LOADING' || stage === 'SHORTAGE';

    /* Risk sebepleri: yalnız GERÇEK sinyallerden. Veri yoksa sebep üretilmez. */
    const reasons = [];
    if (deliveryOutcome === 'ALREADY_LATE') reasons.push('ALREADY_LATE_FOR_TARGET');
    else if (deliveryOutcome === 'EXPECTED_LATE') reasons.push('EXPECTED_LATE_FOR_TARGET');
    if (preLoad && daysToLoad != null && daysToLoad < 0) reasons.push('EX_FACTORY_OVERDUE');
    if (handoverWarning) reasons.push('HANDOVER_PENDING');
    if (preLoad && orderAgeDays != null && orderAgeDays >= settings.staleOrderAgeDays && (daysToLoad == null || daysToLoad <= settings.imminentLoadDays)) reasons.push('STALE_ORDER_NOT_LOADED');
    if (preLoad && daysToLoad != null && daysToLoad >= 0 && daysToLoad <= settings.imminentLoadDays) reasons.push('LOADING_WINDOW_IMMINENT');
    if (delivery && delivery.transitRuleMissing) reasons.push('MISSING_TRANSIT_RULE');
    if (exFactory == null || (retailDate == null && inStoreDate == null)) reasons.push('MISSING_DATE');

    /* Action Priority tek kanonik resolver'dan gelir. UNKNOWN artık bir
       severity değil calculationStatus'tur. Structured reasons/signals action
       floor üretir; AT_RISK tek başına escalation yapmaz. */
    const dateSync = dateSyncOf(row, ord);
    if (dateSync.status === 'REVISED_IN_BUYER_LOG') reasons.push('DATE_SYNC_MISMATCH');

    const canonicalSignals = Array.isArray(cpOperationalFlags && cpOperationalFlags.signals)
      ? cpOperationalFlags.signals
      : [];
    const decisionAction = OD.resolveActionPriority ? OD.resolveActionPriority({
      deliveryOutcome,
      preLoad,
      daysToLoad,
      settings,
      reasons,
      signals: canonicalSignals,
    }) : {
      priority: deliveryOutcome === 'UNKNOWN' ? 'WATCH' : 'ON_TRACK',
      calculationStatus: deliveryOutcome === 'UNKNOWN' ? 'UNKNOWN' : 'KNOWN',
      reasons: reasons.map(code => ({ code })),
    };
    const priority = decisionAction.priority;
    const calculationStatus = decisionAction.calculationStatus;
    const structuredReasons = decisionAction.reasons || [];


    const result = {
      dateSync,
      orderKey: `${text(row && row[F.orderCode])}|${dimKey(row && row[F.model])}|${dimKey(row && row[F.colourCode])}`,
      orderCode: text(row && row[F.orderCode]),
      modelName: text(row && row[F.model]),
      colourCode: text(row && row[F.colourCode]),
      qty, status, stage,
      orderDate, orderAgeDays,
      plannedLoadDate: exFactory, daysToLoad, weeksToLoad, loadWindow,
      retailDate, inStoreDate,
      transitDays, transitRuleDefined: Boolean(transitRule), transitRuleMissing: Boolean(delivery && delivery.transitRuleMissing),
      eta: delivery ? delivery.eta : null,
      etaSource: delivery ? delivery.etaSource : 'none',
      targetType: delivery ? delivery.targetType : settings.targetType,
      targetDate: delivery ? delivery.targetDate : null,
      scheduleBufferDays: delivery ? delivery.scheduleBufferDays : null,
      latestSafeLoadDate: delivery ? delivery.latestSafeLoadDate : null,
      deliveryOutcome,
      deliveryRiskCause: delivery ? delivery.riskCause : null,
      confidence: delivery ? delivery.confidence : 'LOW',
      handoverWarning,
      calculationStatus,
      priority, riskReasons: reasons,
      signals: canonicalSignals,
      actionReasons: structuredReasons,
      decision: {
        calculationStatus,
        action: { priority, reasons: structuredReasons },
        delivery: { outcome: deliveryOutcome, eta: delivery ? delivery.eta : null, targetDate: delivery ? delivery.targetDate : null, bufferDays: delivery ? delivery.scheduleBufferDays : null },
      },
      cpPriority: text(row && row[F.priority]),
      dims: {
        buyer: dimKey(row && row[F.buyer]),
        buyerGroup: dimKey(row && row[F.buyerGroup]),
        mag: dimKey(row && row[F.mag]),
        mmyg: dimKey(row && row[F.mmyg]),
        line: dimKey(row && row[F.line]),
        season: dimKey(row && row[F.season]),
        country: dimKey(row && row[F.country]),
        manufacturer: dimKey(row && row[F.manufacturer]),
        subManufacturer: dimKey(row && row[F.subManufacturer]),
        category: dimKey(row && row[F.category]),
      },
    };
    // Drill-down için ham satır; sayımlara karışmasın diye enumerable değil.
    Object.defineProperty(result, 'sourceRow', { value: row, enumerable: false });
    return result;
  }

  /* -------------------------------------------------------- toplulaştırma */
  function emptyMeasure() { return { rows: 0, qty: 0, orders: new Set() }; }
  function addMeasure(measure, analysis) {
    measure.rows += 1;
    measure.qty += analysis.qty;
    measure.orders.add(analysis.orderKey);
  }
  function sealMeasure(measure, totalQty) {
    return { rows: measure.rows, orders: measure.orders.size, qty: measure.qty, qtyShare: totalQty > 0 ? measure.qty / totalQty * 100 : 0 };
  }
  function bucketList(map, totalQty) {
    return [...map.entries()]
      .map(([name, measure]) => ({ name, ...sealMeasure(measure, totalQty) }))
      .sort((a, b) => b.qty - a.qty || b.rows - a.rows);
  }
  function touch(map, key) { if (!map.has(key)) map.set(key, emptyMeasure()); return map.get(key); }

  /* Hafta pencereleri: bugünden itibaren kayan 7/14 gün. Takvim haftası değil —
     "bu hafta yüklenecek" sorusu operasyonel olarak geri sayımdır. */
  function loadingPlanBuckets(analyses, today) {
    const plan = {
      thisWeek: { rows: [], label: 'THIS_WEEK' },
      nextWeek: { rows: [], label: 'NEXT_WEEK' },
      nextTwoWeeks: { rows: [], label: 'NEXT_2_WEEKS' },
      overdue: { rows: [], label: 'OVERDUE' },
    };
    for (const analysis of analyses) {
      const days = analysis.daysToLoad;
      if (days == null) continue;
      if (days < 0) { plan.overdue.rows.push(analysis); continue; }
      if (days <= 6) plan.thisWeek.rows.push(analysis);
      else if (days <= 13) plan.nextWeek.rows.push(analysis);
      if (days <= 13) plan.nextTwoWeeks.rows.push(analysis);
    }
    const summarize = bucket => {
      const byOutcome = new Map();
      let qty = 0;
      const orders = new Set();
      for (const analysis of bucket.rows) {
        qty += analysis.qty;
        orders.add(analysis.orderKey);
        addMeasure(touch(byOutcome, analysis.deliveryOutcome), analysis);
      }
      const summary = {
        label: bucket.label, rows: bucket.rows.length, orders: orders.size, qty,
        byOutcome: bucketList(byOutcome, qty),
      };
      Object.defineProperty(summary, 'items', { value: bucket.rows, enumerable: false });
      return summary;
    };
    return {
      thisWeek: summarize(plan.thisWeek),
      nextWeek: summarize(plan.nextWeek),
      nextTwoWeeks: summarize(plan.nextTwoWeeks),
      overdue: summarize(plan.overdue),
    };
  }

  function analyze(rows, ctx) {
    const context = ctx || {};
    const list = Array.isArray(rows) ? rows : [];
    const today = context.today == null ? defaultOrdinal(new Date()) : context.today;
    const settings = { ...DEFAULT_SETTINGS, ...(context.settings || {}) };
    const analyses = list.map(row => analyzeOrder(row, { ...context, today, settings }));

    let totalQty = 0;
    const orders = new Set();
    const byPriority = new Map();
    const unknownCalculation = emptyMeasure();
    const byOutcome = new Map();
    const byLoadWindow = new Map();
    const byStage = new Map();
    const byDateSync = new Map();
    const reasonCounts = new Map();
    const dimensionMaps = { buyer: new Map(), buyerGroup: new Map(), manufacturer: new Map(), country: new Map(), season: new Map(), line: new Map(), category: new Map(), mag: new Map(), mmyg: new Map() };
    const missing = { exFactory: 0, retail: 0, inStore: 0, orderDate: 0, transitRule: 0, manufacturer: 0, country: 0 };

    for (const analysis of analyses) {
      totalQty += analysis.qty;
      orders.add(analysis.orderKey);
      addMeasure(touch(byPriority, analysis.priority), analysis);
      if (analysis.calculationStatus === 'UNKNOWN') addMeasure(unknownCalculation, analysis);
      addMeasure(touch(byOutcome, analysis.deliveryOutcome), analysis);
      addMeasure(touch(byLoadWindow, analysis.loadWindow), analysis);
      addMeasure(touch(byStage, analysis.stage), analysis);
      addMeasure(touch(byDateSync, analysis.dateSync.status), analysis);
      for (const reason of analysis.riskReasons) reasonCounts.set(reason, (reasonCounts.get(reason) || 0) + 1);
      for (const [key, map] of Object.entries(dimensionMaps)) addMeasure(touch(map, analysis.dims[key]), analysis);
      if (analysis.plannedLoadDate == null) missing.exFactory += 1;
      if (analysis.retailDate == null) missing.retail += 1;
      if (analysis.inStoreDate == null) missing.inStore += 1;
      if (analysis.orderDate == null) missing.orderDate += 1;
      if (analysis.transitRuleMissing) missing.transitRule += 1;
      if (analysis.dims.manufacturer === EMPTY) missing.manufacturer += 1;
      if (analysis.dims.country === EMPTY) missing.country += 1;
    }

    const priorityGroups = {};
    for (const key of ACTION_PRIORITIES) priorityGroups[key] = analyses.filter(item => item.priority === key);
    priorityGroups.UNKNOWN = analyses.filter(item => item.calculationStatus === 'UNKNOWN');

    const model = {
      generatedFor: today,
      settings,
      totals: { rows: analyses.length, orders: orders.size, qty: totalQty },
      priorities: [...bucketList(byPriority, totalQty), { name: 'UNKNOWN', ...sealMeasure(unknownCalculation, totalQty) }],
      deliveryOutcome: bucketList(byOutcome, totalQty),
      loadWindows: bucketList(byLoadWindow, totalQty),
      stages: bucketList(byStage, totalQty),
      dateSync: {
        buckets: bucketList(byDateSync, totalQty),
        // Hangi tarih alanının kaç siparişte ayrıştığı — drill-down için.
        byField: DATE_SYNC_FIELDS.map(field => ({
          key: field.key, tr: field.tr, en: field.en,
          rows: analyses.filter(item => item.dateSync.differences.some(diff => diff.key === field.key)).length,
        })),
      },
      riskReasons: [...reasonCounts.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
      dimensions: Object.fromEntries(Object.entries(dimensionMaps).map(([key, map]) => [key, bucketList(map, totalQty)])),
      loadingPlan: loadingPlanBuckets(analyses, today),
      dataQuality: {
        missing,
        unavailableDimensions: UNAVAILABLE_DIMENSIONS,
        unknownPriority: analyses.filter(item => item.calculationStatus === 'UNKNOWN').length,
        // Kurulum hatası veri kalitesi sorunu gibi görünmemeli: ayrı raporlanır.
        deliveryEngineMissing: !deliveryEngineReady,
      },
    };
    Object.defineProperty(model, 'orders', { value: analyses, enumerable: false });
    Object.defineProperty(model, 'priorityGroups', { value: priorityGroups, enumerable: false });
    return model;
  }

/* Öncelik sayımlarını mevcut analiz nesnelerinden YENİDEN kurar.
   Kullanıcı kuralları (cp-rules-engine) bir siparişin önceliğini yükselttikten
   sonra çağrılır: aksi hâlde ekrandaki çipler kural uygulanmadan önceki
   sayıları gösterir, tablo ise yeni önceliği — aynı ekranda iki farklı cevap.
   Teslimat sonucu, ETA ve risk sebepleri BURADA DEĞİŞMEZ; yalnız öncelik
   kovaları yeniden sayılır. */
  function recount(model) {
    if (!model || !model.orders) return model;
    const analyses = model.orders;
    const totalQty = model.totals ? model.totals.qty : analyses.reduce((sum, item) => sum + item.qty, 0);
    const byPriority = new Map();
    const unknownCalculation = emptyMeasure();
    for (const analysis of analyses) {
      addMeasure(touch(byPriority, analysis.priority), analysis);
      if (analysis.calculationStatus === 'UNKNOWN') addMeasure(unknownCalculation, analysis);
    }
    const priorityGroups = {};
    for (const key of ACTION_PRIORITIES) priorityGroups[key] = analyses.filter(item => item.priority === key);
    priorityGroups.UNKNOWN = analyses.filter(item => item.calculationStatus === 'UNKNOWN');
    const next = { ...model, priorities: [...bucketList(byPriority, totalQty), { name: 'UNKNOWN', ...sealMeasure(unknownCalculation, totalQty) }] };
    next.dataQuality = { ...model.dataQuality, unknownPriority: analyses.filter(item => item.calculationStatus === 'UNKNOWN').length };
    Object.defineProperty(next, 'orders', { value: analyses, enumerable: false });
    Object.defineProperty(next, 'priorityGroups', { value: priorityGroups, enumerable: false });
    return next;
  }

  /* Aksiyon gerektirenler tablosu (§63). Sıralama: en acil önce, sonra en
     yakın yükleme, sonra en büyük adet. `limit` YALNIZ listeyi kısaltır;
     sayımlar tam kümeden gelir (v9.46 dersi). */
  function needsAttention(model, options) {
    const opts = options || {};
    const limit = Math.max(1, Number(opts.limit) || 200);
    const rank = { CRITICAL: 0, ACTION_TODAY: 1, ACTION_THIS_WEEK: 2, WATCH: 3, ON_TRACK: 4 };
    const all = (model && model.orders ? model.orders : []).filter(item =>
      OD.needsAttention ? OD.needsAttention(item.decision || item) : item.priority !== 'ON_TRACK');
    const sorted = all.slice().sort((a, b) =>
      ((rank[a.priority] == null ? 99 : rank[a.priority]) - (rank[b.priority] == null ? 99 : rank[b.priority]))
      || ((a.daysToLoad == null ? 1e9 : a.daysToLoad) - (b.daysToLoad == null ? 1e9 : b.daysToLoad))
      || (b.qty - a.qty));
    const list = sorted.slice(0, limit);
    Object.defineProperty(list, 'total', { value: all.length, enumerable: false });
    Object.defineProperty(list, 'totalQty', { value: all.reduce((sum, item) => sum + item.qty, 0), enumerable: false });
    return list;
  }

  return {
    FIELDS: F, UNAVAILABLE_DIMENSIONS,
    LOAD_WINDOWS, LOAD_WINDOW_LABELS, ACTION_PRIORITIES, PRIORITIES, PRIORITY_LABELS,
    RISK_REASONS, RISK_REASON_LABELS, DEFAULT_SETTINGS,
    DATE_SYNC_STATES, DATE_SYNC_LABELS, DATE_SYNC_FIELDS, dateSyncOf,
    analyzeOrder, analyze, recount, needsAttention, needsAttentionSort: needsAttention,
    loadWindowOf, defaultOrdinal, toDeliveryRow,
  };
});
