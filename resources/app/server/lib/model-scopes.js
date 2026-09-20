'use strict';

/*
 * Kapsamlar (scopes): bir bağlantının hedef başına ayrı ufku.
 *
 * Önceki tasarımda her bağlantının TEK bir ufku vardı; ASAS'tan gelen aynı satır
 * kümesi hem CP/Backlog'u hem LFL'i besliyordu. Ama bu sayfaların veri ihtiyacı
 * farklı: CP kayan bir operasyon penceresi ister, LFL karşılaştırdığı sezonların
 * tamamını ister, Backlog ise ikisinden de farklı olabilir.
 *
 * Kapsam = { hedefler, ufuk }. Bir kapsam birden çok hedefi besleyebilir; o zaman
 * tek sorgu çalışır ve sonuç paylaşılır. Hedefler ayrı kapsamlara konursa her biri
 * kendi koşullarıyla ayrı sorgu olur.
 *
 * Rol → izin verilen hedefler:
 *   asas    → cp, orders, backlog, lfl, priceanalysis
 *   antrepo → cp, orders, backlog          (IAS yalnız bu üç sayfa için çalışır)
 *   intake  → intake                      (INTAKE kendi veritabanı bağlantısından gelir)
 *
 * Kumaş bilgileri ayrı bir rol/hedef değildir; ana ASAS sorgusunun alanlarıdır.
 */

const SCOPE_TARGETS = ['cp', 'orders', 'backlog', 'lfl', 'priceanalysis', 'intake'];

const ROLE_TARGETS = {
  asas: ['cp', 'orders', 'backlog', 'lfl', 'priceanalysis'],
  antrepo: ['cp', 'orders', 'backlog'],
  intake: ['intake'],
  custom: [],
};

const TARGET_LABELS = {
  cp: 'CP',
  orders: 'Orders / Siparişler',
  backlog: 'Backlog',
  lfl: 'LFL',
  priceanalysis: 'Price & Supplier Analysis',
  intake: 'INTAKE',
};

function allowedTargets(role) {
  return Object.prototype.hasOwnProperty.call(ROLE_TARGETS, role)
    ? ROLE_TARGETS[role].slice()
    : [];
}

function normalizeTargets(raw, role) {
  const allowed = new Set(allowedTargets(role));
  const seen = new Set();
  const out = [];
  for (const value of Array.isArray(raw) ? raw : []) {
    const target = String(value == null ? '' : value).trim();
    if (!allowed.has(target) || seen.has(target)) continue;
    seen.add(target);
    out.push(target);
  }
  return out;
}

// Orders/Siparişler ufku CP'den bağımsız düzenlenmelidir. Eski kayıtlarda
// hedef henüz yoksa CP kapsamının bir kopyasıyla başlatılır; aynı kapsamda gelirse
// diğer hedeflerden ayrılarak tek başına tutulur.
function isolateOrdersScope(scopes, role, fallbackHorizon, normalizeHorizon, detached = null) {
  if (!allowedTargets(role).includes('orders')) return scopes;
  const list = Array.isArray(scopes) ? scopes.map(scope => ({
    ...scope,
    targets: Array.isArray(scope.targets) ? scope.targets.slice() : [],
    horizon: normalizeHorizon(scope.horizon),
  })) : [];
  let ordersScope = list.find(scope => scope.targets.includes('orders')) || null;
  const source = ordersScope || list.find(scope => scope.targets.includes('cp')) || list[0] || null;
  const out = [];
  for (const scope of list) {
    const withoutOrders = scope.targets.filter(target => target !== 'orders');
    if (withoutOrders.length) out.push({ ...scope, targets: withoutOrders });
    if (scope === ordersScope) ordersScope = { ...scope, targets: ['orders'] };
  }
  if (!ordersScope) {
    /* v7.81: kullanıcı bu beslemeyi BİLEREK kapattıysa geri yaratılmaz.
       Aksi hâlde Veri Yönetimi'nden kapatılan IAS → Siparişler bağlantısı bir
       sonraki okumada kendiliğinden geri gelirdi — kapatma düğmesi hiç
       çalışmamış gibi görünürdü. Eski kayıtlarda bu küme boştur; davranış
       aynen korunur. */
    if (detached && detached.has('orders')) return dedupeTargets(out);
    ordersScope = {
      id: `sc_${Math.random().toString(36).slice(2, 9)}`,
      name: '',
      targets: ['orders'],
      enabled: source ? source.enabled !== false : true,
      limitToCpOrders: false,
      horizon: normalizeHorizon(source ? source.horizon : fallbackHorizon),
    };
  }
  out.push(ordersScope);
  return dedupeTargets(out);
}

/**
 * Kapsam listesini normalleştirir.
 * Liste boşsa, bağlantının mevcut tek ufkundan izin verilen tüm hedefleri kapsayan
 * bir kapsam üretilir — böylece eski kayıtlar davranış değiştirmeden çalışmaya devam eder.
 */
function normalizeScopes(raw, role, fallbackHorizon, normalizeHorizon, detachedTargets = null) {
  const allowed = allowedTargets(role);
  if (!allowed.length) return [];
  /* detachedTargets: kullanıcının Veri Yönetimi'nden bilerek kapattığı modüller
     (park edilmiş bağlantılar). Bu fonksiyonun "eski kayıt kurtarma" dalları
     yalnız bu küme dışındaki hedefler için çalışır. */
  const detached = new Set((Array.isArray(detachedTargets) ? detachedTargets : [])
    .map(value => String(value == null ? '' : value).trim()).filter(Boolean));

  const list = (Array.isArray(raw) ? raw : []).map(entry => {
    const item = entry && typeof entry === 'object' ? entry : {};
    return {
      id: String(item.id || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40)
        || `sc_${Math.random().toString(36).slice(2, 9)}`,
      name: String(item.name == null ? '' : item.name).replace(/\s+/g, ' ').trim().slice(0, 80),
      targets: normalizeTargets(item.targets, role),
      enabled: item.enabled !== false,
      // Ayrı kumaş rolü kaldırıldı. Antrepo ve ASAS kapsamları kendi ufuklarıyla
      // çalışır; CP sipariş koduna göre özel daraltma uygulanmaz.
      limitToCpOrders: false,
      horizon: normalizeHorizon(item.horizon),
    };
  }).filter(scope => scope.targets.length).slice(0, 12);

  if (list.length) {
    // Horizon, Price & Supplier Analysis için ayrı bir hedef olarak görünür;
    // eski bağlantılarda ise ilk ASAS kapsamından güvenli bir başlangıç alır.
    if (role === 'asas' && !detached.has('priceanalysis') && !list.some(scope => scope.targets.includes('priceanalysis'))) {
      const index = list.findIndex(scope => scope.targets.length);
      if (index >= 0) list[index] = { ...list[index], targets: [...list[index].targets, 'priceanalysis'] };
    }
    return isolateOrdersScope(dedupeTargets(list), role, fallbackHorizon, normalizeHorizon, detached);
  }

  const remaining = allowed.filter(target => !detached.has(target));
  // Her hedefi kapatılmış bir kaynak hiçbir sayfayı beslemez. Burada "eski kayıt"
  // kurtarması yapmak, kullanıcının kapattığı her şeyi geri açmak olurdu.
  if (!remaining.length) return [];
  const fallback = [{
    id: `sc_${Math.random().toString(36).slice(2, 9)}`,
    name: '',
    targets: remaining,
    enabled: true,
    limitToCpOrders: false,
    horizon: normalizeHorizon(fallbackHorizon),
  }];
  return isolateOrdersScope(fallback, role, fallbackHorizon, normalizeHorizon, detached);
}

// Bir hedef yalnız bir kapsama ait olabilir; aksi hâlde hangi sorgunun beslediği
// belirsizleşir. Çakışmada ilk kapsam kazanır.
function dedupeTargets(scopes) {
  const taken = new Set();
  return scopes.map(scope => {
    const targets = scope.targets.filter(target => !taken.has(target));
    targets.forEach(target => taken.add(target));
    return { ...scope, targets };
  }).filter(scope => scope.targets.length);
}

/** Etkin kapsamlardan hedef → kapsam eşlemesi. */
function scopeByTarget(scopes) {
  const map = new Map();
  for (const scope of Array.isArray(scopes) ? scopes : []) {
    if (scope.enabled === false) continue;
    for (const target of scope.targets || []) if (!map.has(target)) map.set(target, scope);
  }
  return map;
}

/** Kapsamın okunabilir adı; kullanıcı ad vermediyse hedeflerinden üretilir. */
function scopeLabel(scope) {
  if (scope && String(scope.name || '').trim()) return String(scope.name).trim();
  return (scope && scope.targets || []).map(target => TARGET_LABELS[target] || target).join(' + ') || '—';
}

module.exports = {
  SCOPE_TARGETS, ROLE_TARGETS, TARGET_LABELS,
  allowedTargets, normalizeTargets, normalizeScopes, isolateOrdersScope, dedupeTargets, scopeByTarget, scopeLabel,
};
