/* Buyer Log v9.46 — BACKLOG TESLİMAT YORUM ÜRETECİ
 *
 * Otomatik yorumlar (§24), kullanıcı tercihiyle aç/kapa (§25) ve kullanıcının
 * kod yazmadan tanımladığı kendi kuralları (§26–27).
 *
 * İKİ SERT KURAL:
 * 1) Yorumların tamamı DETERMİNİSTİK. Sayı, yüzde, sınıflandırma ve sipariş
 *    listesi motordan gelir; LLM hiçbir aşamada devrede değildir (§54).
 * 2) Her yorum KENDİ sipariş listesini taşır. "21 sipariş riskli" yazan bir
 *    yorum tıklandığında tam olarak o 21 sipariş açılmalıdır (§31, §64) —
 *    metni üretip listeyi ayrıca hesaplamak iki sayının ayrışması demekti.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.BLBacklogDeliveryInsights = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const SEVERITIES = Object.freeze(['critical', 'warning', 'watch', 'information', 'positive']);
  const SEVERITY_RANK = Object.freeze({ critical: 0, warning: 1, watch: 2, information: 3, positive: 4 });

  // §25 — kullanıcı bu listeden istediğini kapatabilir. Varsayılan açık/kapalı
  // durumu spec'teki işaretli kutularla birebir aynı.
  const INSIGHT_TYPES = Object.freeze([
    { id: 'deliveryOutcome', default: true },
    { id: 'lateLoading', default: true },
    { id: 'transitDelay', default: true },
    { id: 'notYetLoaded', default: true },
    { id: 'productionRisk', default: true },
    { id: 'customsRisk', default: true },
    { id: 'retailTransferRisk', default: true },
    { id: 'supplierConcentration', default: true },
    { id: 'countryRisk', default: true },
    { id: 'buyerRisk', default: true },
    { id: 'buyerGroupRisk', default: true },
    { id: 'magAnalysis', default: true },
    { id: 'mmygAnalysis', default: true },
    { id: 'lineAnalysis', default: true },
    { id: 'seasonAnalysis', default: true },
    { id: 'loadingTypeAnalysis', default: true },
    { id: 'dataQuality', default: true },
    { id: 'positiveSummary', default: false },
    { id: 'lowVolumeExceptions', default: false },
  ]);
  const INSIGHT_TYPE_LABELS = Object.freeze({
    tr: {
      deliveryOutcome: 'Teslimat Sonucu', lateLoading: 'Geç Yükleme', transitDelay: 'Transit Gecikmesi',
      notYetLoaded: 'Henüz Yüklenmedi', productionRisk: 'Üretim Riski', customsRisk: 'Gümrük Riski',
      retailTransferRisk: 'Retaile Aktarım Riski', supplierConcentration: 'Üretici Yoğunlaşması',
      countryRisk: 'Ülke Riski', buyerRisk: 'Buyer Riski', buyerGroupRisk: 'Buying Group Riski',
      magAnalysis: 'MAG Analizi', mmygAnalysis: 'MMYG Analizi', lineAnalysis: 'Line Analizi',
      seasonAnalysis: 'Sezon Analizi', loadingTypeAnalysis: 'Yükleme Tipi Analizi',
      dataQuality: 'Veri Kalitesi', positiveSummary: 'Olumlu / Zamanında Özeti', lowVolumeExceptions: 'Düşük Hacimli İstisnalar',
    },
    en: {
      deliveryOutcome: 'Delivery Outcome', lateLoading: 'Late Loading', transitDelay: 'Transit Delay',
      notYetLoaded: 'Not Yet Loaded', productionRisk: 'Production Risk', customsRisk: 'Customs Risk',
      retailTransferRisk: 'Retail Transfer Risk', supplierConcentration: 'Supplier Concentration',
      countryRisk: 'Country Risk', buyerRisk: 'Buyer Risk', buyerGroupRisk: 'Buyer Group Risk',
      magAnalysis: 'MAG Analysis', mmygAnalysis: 'MMYG Analysis', lineAnalysis: 'Line Analysis',
      seasonAnalysis: 'Season Analysis', loadingTypeAnalysis: 'Loading Type Analysis',
      dataQuality: 'Data Quality', positiveSummary: 'Positive / On Track Summary', lowVolumeExceptions: 'Low Volume Exceptions',
    },
  });

  const RISK_OUTCOMES = new Set(['AT_RISK', 'EXPECTED_LATE', 'ALREADY_LATE']);
  const num = value => { const n = Number(value); return Number.isFinite(n) ? n : 0; };
  const distinctOrders = list => new Set(list.map(item => item.orderKey).filter(Boolean)).size;
  const sumQty = list => list.reduce((total, item) => total + num(item.qty), 0);

  function defaultPreferences() {
    const out = {};
    INSIGHT_TYPES.forEach(type => { out[type.id] = type.default; });
    return out;
  }

  function makeInsight(spec) {
    const orders = spec.orders || [];
    return {
      id: spec.id,
      type: spec.type,
      severity: SEVERITIES.includes(spec.severity) ? spec.severity : 'information',
      message: spec.message,
      qty: sumQty(orders),
      orderCount: distinctOrders(orders),
      rowCount: orders.length,
      orders,
      custom: Boolean(spec.custom),
    };
  }

  /* ---------------------------------------------------------------- yerelleştirme */
  function formatter(lang) {
    const en = String(lang || 'tr').toLowerCase().startsWith('en');
    const locale = en ? 'en-GB' : 'tr-TR';
    return {
      en,
      n: value => Math.round(num(value)).toLocaleString(locale),
      pct: value => (en
        ? `${num(value).toLocaleString(locale, { maximumFractionDigits: 1 })}%`
        : `%${num(value).toLocaleString(locale, { maximumFractionDigits: 1 })}`),
    };
  }

  /* =================================================================
     HAZIR YORUMLAR
     ================================================================= */
  function generate(model, options) {
    const opts = options || {};
    const prefs = { ...defaultPreferences(), ...(opts.preferences || {}) };
    const f = formatter(opts.lang);
    const orders = (model && model.orders) || [];
    const totalQty = model && model.totals ? model.totals.qty : 0;
    const out = [];
    const enabled = type => prefs[type] !== false;
    const pick = predicate => orders.filter(predicate);

    /* §22/§24 — sonuç özeti */
    if (enabled('deliveryOutcome')) {
      const risky = pick(order => RISK_OUTCOMES.has(order.deliveryOutcome));
      if (risky.length) {
        const late = pick(order => order.deliveryOutcome === 'EXPECTED_LATE' || order.deliveryOutcome === 'ALREADY_LATE');
        out.push(makeInsight({
          id: 'deliveryOutcome.risk', type: 'deliveryOutcome', severity: late.length ? 'critical' : 'warning',
          orders: risky,
          message: f.en
            ? `${f.n(distinctOrders(risky))} orders (${f.n(sumQty(risky))} units) are at risk of missing the target date; ${f.n(distinctOrders(late))} of them are already expected to be late.`
            : `${f.n(distinctOrders(risky))} sipariş (${f.n(sumQty(risky))} adet) hedef tarihe yetişememe riski taşıyor; bunların ${f.n(distinctOrders(late))} tanesinin gecikmesi bekleniyor.`,
        }));
      }
    }

    /* §12 — henüz yüklenmemiş ve yetişmeyecek olanlar */
    if (enabled('notYetLoaded')) {
      const notLoaded = pick(order => order.actualLoadDate == null && (order.stage === 'PRODUCTION' || order.stage === 'LOADING' || order.stage === 'SHORTAGE'));
      const notLoadedLate = notLoaded.filter(order => order.deliveryOutcome === 'EXPECTED_LATE' || order.deliveryOutcome === 'ALREADY_LATE');
      if (notLoaded.length) {
        out.push(makeInsight({
          id: 'notYetLoaded.main', type: 'notYetLoaded', severity: notLoadedLate.length ? 'critical' : 'watch',
          orders: notLoadedLate.length ? notLoadedLate : notLoaded,
          message: f.en
            ? `${f.n(distinctOrders(notLoaded))} orders are still in production or pre-loading. Given their loading type and target date, ${f.n(distinctOrders(notLoadedLate))} are not expected to arrive on time.`
            : `${f.n(distinctOrders(notLoaded))} sipariş hâlâ üretim/depo öncesi aşamada. Mevcut yükleme tipi ve hedef tarih dikkate alındığında ${f.n(distinctOrders(notLoadedLate))} siparişin zamanında yetişmesi beklenmiyor.`,
        }));
      }
    }

    /* §10 — zamanında yüklendi AMA transit aştı (ayrı kategori) */
    if (enabled('transitDelay')) {
      const delayed = pick(order => order.loadingPerformance === 'LOADED_ON_TIME'
        && (order.postProductionTransitOverdue === true
          || (order.transitVarianceDays != null && order.transitVarianceDays > 0)));
      const delayedRisky = delayed.filter(order => RISK_OUTCOMES.has(order.deliveryOutcome));
      if (delayed.length) {
        out.push(makeInsight({
          id: 'transitDelay.main', type: 'transitDelay', severity: delayedRisky.length ? 'critical' : 'warning',
          orders: delayedRisky.length ? delayedRisky : delayed,
          message: f.en
            ? `${f.n(distinctOrders(delayed))} orders were loaded on time but have exceeded their planned transit time; ${f.n(distinctOrders(delayedRisky))} of them now risk missing the target date.`
            : `${f.n(distinctOrders(delayed))} sipariş zamanında yüklenmesine rağmen planlanan transit süresini aşmış durumda. Bu siparişlerin ${f.n(distinctOrders(delayedRisky))} tanesi hedef tarihe yetişememe riski taşıyor.`,
        }));
      }
    }

    /* §17/§21 — yolda ve sağlıklı olanlar */
    if (enabled('positiveSummary')) {
      const inTransit = pick(order => order.stage === 'IN_TRANSIT');
      const healthy = inTransit.filter(order => order.deliveryOutcome === 'ON_TRACK');
      if (inTransit.length) {
        out.push(makeInsight({
          id: 'positive.transit', type: 'positiveSummary', severity: 'positive', orders: healthy,
          message: f.en
            ? `${f.n(distinctOrders(healthy))} of the ${f.n(distinctOrders(inTransit))} orders in transit are within their planned transit time and have enough time left for the target date.`
            : `Yolda bulunan ${f.n(distinctOrders(inTransit))} siparişin ${f.n(distinctOrders(healthy))} tanesinde mevcut transit süresi plan dahilinde ve hedef tarihe yeterli zaman bulunuyor.`,
        }));
      }
    }

    /* §9 — geç yükleme */
    if (enabled('lateLoading')) {
      const late = pick(order => order.loadingPerformance === 'LOADED_LATE');
      if (late.length) {
        const lateRisky = late.filter(order => RISK_OUTCOMES.has(order.deliveryOutcome));
        out.push(makeInsight({
          id: 'lateLoading.main', type: 'lateLoading', severity: lateRisky.length ? 'warning' : 'watch',
          orders: lateRisky.length ? lateRisky : late,
          message: f.en
            ? `${f.n(distinctOrders(late))} orders were loaded later than planned; ${f.n(distinctOrders(lateRisky))} of them are at risk for the target date.`
            : `${f.n(distinctOrders(late))} sipariş planlanan tarihten geç yüklendi; ${f.n(distinctOrders(lateRisky))} tanesi hedef tarih açısından risk taşıyor.`,
        }));
      }
    }

    /* §12 — üretim gecikmesi (kanonik 9 gün kuralı) */
    if (enabled('productionRisk')) {
      const overdue = pick(order => order.riskReasons.includes('PRODUCTION_DELAY'));
      if (overdue.length) {
        out.push(makeInsight({
          id: 'productionRisk.main', type: 'productionRisk', severity: 'warning', orders: overdue,
          message: f.en
            ? `${f.n(distinctOrders(overdue))} orders are still in production even though their Ex-Factory date has passed by more than 9 days.`
            : `${f.n(distinctOrders(overdue))} sipariş, Ex-Factory tarihi 9 günden fazla geçmiş olmasına rağmen hâlâ üretimde.`,
        }));
      }
    }

    /* §19 — gümrük/liman */
    if (enabled('customsRisk')) {
      const customs = pick(order => order.stage === 'CUSTOMS');
      const customsRisky = customs.filter(order => RISK_OUTCOMES.has(order.deliveryOutcome));
      if (customs.length) {
        out.push(makeInsight({
          id: 'customsRisk.main', type: 'customsRisk', severity: customsRisky.length ? 'warning' : 'information',
          orders: customsRisky.length ? customsRisky : customs,
          message: f.en
            ? `${f.n(distinctOrders(customs))} orders are in customs or port operations; ${f.n(distinctOrders(customsRisky))} of them have a critical amount of time left before the target date.`
            : `${f.n(distinctOrders(customs))} sipariş gümrük/liman operasyonlarında bulunuyor. Bunların ${f.n(distinctOrders(customsRisky))} tanesinde hedef tarihe kalan süre kritik seviyede.`,
        }));
      }
    }

    /* §20 — retaile aktarım bekleyenler */
    if (enabled('retailTransferRisk')) {
      const waiting = pick(order => order.stage === 'AWAITING_RETAIL_TRANSFER');
      const waitingRisky = waiting.filter(order => RISK_OUTCOMES.has(order.deliveryOutcome));
      if (waiting.length) {
        out.push(makeInsight({
          id: 'retailTransfer.main', type: 'retailTransferRisk', severity: waitingRisky.length ? 'warning' : 'information',
          orders: waitingRisky.length ? waitingRisky : waiting,
          message: f.en
            ? `${f.n(distinctOrders(waiting))} orders have reached the warehouse but are still waiting for retail transfer; ${f.n(distinctOrders(waitingRisky))} of them are close to their target date.`
            : `${f.n(distinctOrders(waiting))} sipariş depoya ulaşmış ancak henüz retaile aktarılmamış durumda; ${f.n(distinctOrders(waitingRisky))} tanesi hedef tarihe çok yaklaşmış.`,
        }));
      }
    }

    /* §24 — boyut yoğunlaşmaları. Aynı üretici deseni tüm kırılımlarda geçerli:
       "toplamın %X'i ama riskin %Y'si" ancak Y anlamlı biçimde X'ten büyükse
       yorum üretilir; aksi hâlde bu bir bulgu değil, gürültüdür. */
    const dimensionInsights = [
      { dim: 'manufacturer', type: 'supplierConcentration' },
      { dim: 'country', type: 'countryRisk' },
      { dim: 'buyer', type: 'buyerRisk' },
      { dim: 'buyerGroup', type: 'buyerGroupRisk' },
      { dim: 'mag', type: 'magAnalysis' },
      { dim: 'mmyg', type: 'mmygAnalysis' },
      { dim: 'line', type: 'lineAnalysis' },
      { dim: 'season', type: 'seasonAnalysis' },
      { dim: 'loadingType', type: 'loadingTypeAnalysis' },
    ];
    const lateQtyTotal = orders.filter(order => order.deliveryOutcome === 'EXPECTED_LATE' || order.deliveryOutcome === 'ALREADY_LATE')
      .reduce((total, order) => total + num(order.qty), 0);
    dimensionInsights.forEach(({ dim, type }) => {
      if (!enabled(type)) return;
      const buckets = (model && model.dimensions && model.dimensions[dim]) || [];
      if (!buckets.length || !lateQtyTotal) return;
      const ranked = buckets.slice().sort((a, b) =>
        (b.outcomes.EXPECTED_LATE.qty + b.outcomes.ALREADY_LATE.qty) - (a.outcomes.EXPECTED_LATE.qty + a.outcomes.ALREADY_LATE.qty));
      const top = ranked[0];
      if (!top) return;
      const topLateQty = top.outcomes.EXPECTED_LATE.qty + top.outcomes.ALREADY_LATE.qty;
      if (!topLateQty) return;
      const lateShare = topLateQty / lateQtyTotal * 100;
      const totalShare = totalQty > 0 ? top.total.qty / totalQty * 100 : 0;
      // Yoğunlaşma yalnız gerçekten orantısızsa bildirilir.
      if (lateShare < 20 || lateShare <= totalShare * 1.2) return;
      const bucketOrders = orders.filter(order => order.dims[dim] === top.name
        && (order.deliveryOutcome === 'EXPECTED_LATE' || order.deliveryOutcome === 'ALREADY_LATE'));
      out.push(makeInsight({
        id: `${type}.concentration`, type, severity: 'warning', orders: bucketOrders,
        message: f.en
          ? `${top.name} accounts for ${f.pct(totalShare)} of the filtered backlog but ${f.pct(lateShare)} of the expected-late quantity.`
          : `${top.name}, filtrelenen toplam backlog'un ${f.pct(totalShare)}'ini oluşturmasına rağmen gecikmesi beklenen miktarın ${f.pct(lateShare)}'ini oluşturuyor.`,
      }));
    });

    /* §44 — veri kalitesi */
    if (enabled('dataQuality')) {
      const unknown = pick(order => order.deliveryOutcome === 'UNKNOWN');
      if (unknown.length) {
        out.push(makeInsight({
          id: 'dataQuality.unknown', type: 'dataQuality', severity: 'information', orders: unknown,
          message: f.en
            ? `${f.n(distinctOrders(unknown))} orders are missing at least one field required for a delivery prediction and are classified as Unknown.`
            : `${f.n(distinctOrders(unknown))} siparişte teslimat tahmini için gerekli alanlardan en az biri eksik; bu siparişler Hesaplanamıyor olarak sınıflandırıldı.`,
        }));
      }
    }

    /* §21 — yetişecekler de görünür olmalı */
    if (enabled('positiveSummary')) {
      const onTrack = pick(order => order.deliveryOutcome === 'ON_TRACK');
      if (onTrack.length) {
        out.push(makeInsight({
          id: 'positive.onTrack', type: 'positiveSummary', severity: 'positive', orders: onTrack,
          message: f.en
            ? `${f.n(distinctOrders(onTrack))} orders (${f.n(sumQty(onTrack))} units) are expected to reach the target date on time.`
            : `${f.n(distinctOrders(onTrack))} sipariş (${f.n(sumQty(onTrack))} adet) hedef tarihe zamanında ulaşması bekleniyor.`,
        }));
      }
    }

    return sortInsights(out);
  }

  function sortInsights(list) {
    return list.slice().sort((a, b) =>
      (SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]) || (b.qty - a.qty));
  }

  /* =================================================================
     KULLANICI TANIMLI YORUMLAR (§26–27)

     Kullanıcı kod yazmaz: alan + operatör + değer üçlüsünden koşul kurar.
     Kural YALNIZ analiz modelinin (yani yetki + filtre uygulanmış veri)
     üzerinde çalışır — kendi veri kaynağını açamaz (§28).
     ================================================================= */
  const CONDITION_FIELDS = Object.freeze([
    'stage', 'deliveryOutcome', 'riskCause', 'loadingPerformance', 'loadingType', 'confidence',
    'buyer', 'buyerGroup', 'mag', 'mmyg', 'line', 'season', 'country', 'manufacturer', 'subManufacturer', 'category',
    'transitVarianceDays', 'loadingVarianceDays', 'scheduleBufferDays', 'remainingDays', 'plannedTransitDays', 'actualTransitDays', 'qty',
  ]);
  const NUMERIC_FIELDS = new Set(['transitVarianceDays', 'loadingVarianceDays', 'scheduleBufferDays', 'remainingDays', 'plannedTransitDays', 'actualTransitDays', 'qty']);
  const OPERATORS = Object.freeze(['eq', 'ne', 'in', 'gt', 'gte', 'lt', 'lte']);

  function fieldValue(order, field) {
    if (!order) return null;
    if (Object.prototype.hasOwnProperty.call(order, field)) return order[field];
    if (order.dims && Object.prototype.hasOwnProperty.call(order.dims, field)) return order.dims[field];
    return null;
  }
  function matchesCondition(order, condition) {
    if (!condition || !condition.field) return true;
    const value = fieldValue(order, condition.field);
    const numeric = NUMERIC_FIELDS.has(condition.field);
    if (numeric) {
      if (value == null) return false;              // eksik sayı koşulu KARŞILAMAZ (uydurma yok)
      const left = Number(value), right = Number(condition.value);
      if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
      switch (condition.operator) {
        case 'gt': return left > right;
        case 'gte': return left >= right;
        case 'lt': return left < right;
        case 'lte': return left <= right;
        case 'ne': return left !== right;
        default: return left === right;
      }
    }
    const left = String(value == null ? '' : value);
    if (condition.operator === 'in') {
      const list = Array.isArray(condition.value) ? condition.value : String(condition.value || '').split(',');
      return list.map(item => String(item).trim()).filter(Boolean).includes(left);
    }
    // riskCause tek değer taşır ama riskReasons çoklu olabilir: ikisini de dene.
    if (condition.field === 'riskCause' && Array.isArray(order.riskReasons)) {
      const wanted = String(condition.value == null ? '' : condition.value);
      const hit = order.riskReasons.includes(wanted);
      return condition.operator === 'ne' ? !hit : hit;
    }
    const right = String(condition.value == null ? '' : condition.value);
    return condition.operator === 'ne' ? left !== right : left === right;
  }

  function normalizeRule(rule, index) {
    const item = rule && typeof rule === 'object' ? rule : {};
    const conditions = (Array.isArray(item.conditions) ? item.conditions : [])
      .filter(condition => condition && CONDITION_FIELDS.includes(condition.field) && OPERATORS.includes(condition.operator))
      .map(condition => ({ field: condition.field, operator: condition.operator, value: condition.value }));
    return {
      id: String(item.id || `custom-${index}`),
      name: String(item.name || '').trim() || `Custom ${index + 1}`,
      enabled: item.enabled !== false,
      severity: SEVERITIES.includes(item.severity) ? item.severity : 'warning',
      measure: item.measure === 'quantity' ? 'quantity' : 'orders',
      groupBy: CONDITION_FIELDS.includes(item.groupBy) ? item.groupBy : '',
      showTop: Math.max(1, Math.min(20, Number(item.showTop) || 5)),
      messageTemplate: String(item.messageTemplate || '').trim(),
      conditions,
    };
  }

  function renderTemplate(template, values) {
    return String(template || '').replace(/\{(\w+)\}/g, (match, key) =>
      (Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : match));
  }

  function evaluateCustom(model, rules, options) {
    const opts = options || {};
    const f = formatter(opts.lang);
    const orders = (model && model.orders) || [];
    const list = (Array.isArray(rules) ? rules : []).map(normalizeRule).filter(rule => rule.enabled && rule.conditions.length);
    const out = [];
    list.forEach(rule => {
      const matched = orders.filter(order => rule.conditions.every(condition => matchesCondition(order, condition)));
      if (!matched.length) return;
      const count = rule.measure === 'quantity' ? sumQty(matched) : distinctOrders(matched);
      let groupText = '';
      if (rule.groupBy) {
        const buckets = new Map();
        matched.forEach(order => {
          const key = String(fieldValue(order, rule.groupBy) || '(Boş)');
          if (!buckets.has(key)) buckets.set(key, []);
          buckets.get(key).push(order);
        });
        groupText = [...buckets.entries()]
          .map(([key, items]) => ({ key, value: rule.measure === 'quantity' ? sumQty(items) : distinctOrders(items) }))
          .sort((a, b) => b.value - a.value)
          .slice(0, rule.showTop)
          .map(item => `${item.key} (${f.n(item.value)})`)
          .join(', ');
      }
      const message = rule.messageTemplate
        ? renderTemplate(rule.messageTemplate, { count: f.n(count), qty: f.n(sumQty(matched)), orders: f.n(distinctOrders(matched)), group: groupText, name: rule.name })
        : (f.en
          ? `${rule.name}: ${f.n(count)} ${rule.measure === 'quantity' ? 'units' : 'orders'} matched.${groupText ? ` Top: ${groupText}.` : ''}`
          : `${rule.name}: ${f.n(count)} ${rule.measure === 'quantity' ? 'adet' : 'sipariş'} eşleşti.${groupText ? ` En yüksek: ${groupText}.` : ''}`);
      out.push(makeInsight({ id: `custom.${rule.id}`, type: 'custom', severity: rule.severity, orders: matched, message, custom: true }));
    });
    return sortInsights(out);
  }

  function build(model, options) {
    const opts = options || {};
    const auto = generate(model, opts);
    const custom = evaluateCustom(model, opts.customRules, opts);
    return sortInsights([...auto, ...custom]);
  }

  return {
    SEVERITIES, SEVERITY_RANK, INSIGHT_TYPES, INSIGHT_TYPE_LABELS,
    CONDITION_FIELDS, NUMERIC_FIELDS, OPERATORS,
    defaultPreferences, generate, evaluateCustom, build, normalizeRule, matchesCondition, sortInsights,
  };
});
