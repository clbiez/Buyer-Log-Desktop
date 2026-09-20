'use strict';

const modelHorizon = require('./modelHorizon');

const MAIN_TARGETS = ['cp', 'orders', 'backlog', 'lfl'];
const SUPPORTED_TARGETS = [...MAIN_TARGETS, 'priceanalysis'];
const TARGET_LABELS_TR = { cp: 'CP / Genel Bakış', orders: 'Siparişler', backlog: 'Backlog', lfl: 'LFL', priceanalysis: 'Price & Supplier Analysis' };
const TARGET_LABELS_EN = { cp: 'CP / Overview', orders: 'Orders', backlog: 'Backlog', lfl: 'LFL', priceanalysis: 'Price & Supplier Analysis' };

function normalizeTargets(targets) {
  const list = Array.isArray(targets) && targets.length ? targets : MAIN_TARGETS;
  return [...new Set(list.map(value => String(value || '').trim()).filter(value => SUPPORTED_TARGETS.includes(value)))];
}

function effectiveScopes(item) {
  if (Array.isArray(item && item.scopes) && item.scopes.length) return item.scopes;
  return [{ enabled: true, targets: SUPPORTED_TARGETS, horizon: item && item.horizon || {} }];
}

function scopeHasExplicitFilter(item, scope) {
  if (item && item.mode === 'manual') return Boolean(String(item.query || '').trim());
  try {
    const built = modelHorizon.buildHorizonFilter(scope && scope.horizon || item && item.horizon || {});
    return Boolean(String(built && built.expression || '').trim());
  } catch (_) {
    // A partly configured condition is not considered safe. The user must finish
    // entering the field/value before the application is allowed to query data.
    return false;
  }
}

function inspectSourceFilterReadiness(items, targets, options = {}) {
  const requestedTargets = normalizeTargets(targets);
  // Bu koşul yalnız ASAS Data Model Connection'a karşı sınırsız/pahalı bir DAX
  // sorgusu çalışmasını önlemek içindir. ASAS Kaynağı Excel seçiliyse hiçbir
  // Database sorgusu çalışmaz; dosyadan okuma sınırsız sorgu riski taşımaz,
  // bu yüzden filtre zorunluluğu bu modda uygulanmaz.
  if (options && options.asasSourceMode === 'excel') {
    const targetState = {};
    for (const target of requestedTargets) targetState[target] = { covered: true, filtered: true, connectionIds: [] };
    return {
      ready: true,
      required: false,
      requestedTargets,
      missingTargets: [],
      filteredTargets: requestedTargets,
      hasActiveAsasConnection: false,
      targetState,
    };
  }
  const activeAsas = (Array.isArray(items) ? items : []).filter(item => item && item.role === 'asas' && item.refreshEnabled !== false);
  const targetState = {};

  for (const target of requestedTargets) {
    const candidates = [];
    for (const item of activeAsas) {
      for (const scope of effectiveScopes(item)) {
        if (!scope || scope.enabled === false || !(scope.targets || []).includes(target)) continue;
        candidates.push({ item, scope, filtered: scopeHasExplicitFilter(item, scope) });
      }
    }
    targetState[target] = {
      covered: candidates.length > 0,
      filtered: candidates.some(candidate => candidate.filtered),
      connectionIds: [...new Set(candidates.map(candidate => String(candidate.item.id || '')).filter(Boolean))],
    };
  }

  const missingTargets = requestedTargets.filter(target => !targetState[target].filtered);
  const filteredTargets = requestedTargets.filter(target => targetState[target].filtered);
  return {
    ready: missingTargets.length === 0,
    required: missingTargets.length > 0,
    requestedTargets,
    missingTargets,
    filteredTargets,
    hasActiveAsasConnection: activeAsas.length > 0,
    targetState,
  };
}

function readinessMessage(status, lang = 'tr') {
  const english = lang === 'en';
  const labels = english ? TARGET_LABELS_EN : TARGET_LABELS_TR;
  const targets = (status && status.missingTargets || []).map(target => labels[target] || target).join(', ');
  if (english) {
    return `No data was loaded because an explicit filter is required in Horizon and Connection${targets ? ` for: ${targets}` : ''}. Add at least one complete condition, then run Refresh.`;
  }
  return `Veri yüklenmedi. Horizon ve Bağlantı alanında${targets ? ` şu ekranlar için` : ''} en az bir tamamlanmış filtre koşulu tanımlanmalıdır${targets ? `: ${targets}` : ''}. Filtreyi kaydettikten sonra Yenile'yi çalıştırın.`;
}

module.exports = {
  MAIN_TARGETS,
  /* /api/refresh'in kabul ettiği hedeflerin KANONİK listesi. Yenileme grupları
     bunu okur; ayrı bir liste tutmak, gruba konabilen ama yenilenemeyen bir
     modül (ör. INTAKE, kendi ayrı akışından gelir) yaratırdı. */
  SUPPORTED_TARGETS,
  inspectSourceFilterReadiness,
  readinessMessage,
  scopeHasExplicitFilter,
};
