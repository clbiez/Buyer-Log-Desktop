'use strict';

const crypto = require('crypto');
/* Okuma sırasında türetilen kapsam kimliği KARARLI olmalıdır: kimlik sayfa
   önbelleğinin bağlam özetine ve kullanıcı ufuk ayarlarına girer. Rastgele
   kimlik her okumada değişip önbelleği hiç okunamaz hâle getiriyordu. */
function stableScopeId(seed) {
  return `sc_${crypto.createHash('sha1').update(JSON.stringify(seed)).digest('hex').slice(0, 10)}`;
}

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
// v20260928 — ASAS rolünde bu kural linkScopeTargets ile genişletildi; burada
// kalan yol yalnız IAS (antrepo) içindir.
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
      id: stableScopeId(['orders', role, source ? source.id : '']),
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

/* ===================================================================
   BAĞLI MODÜLLER — TEK UFUK, TEK YENİLEME (v20260928)

   Kullanıcı kararı: "Orders, Price & Supplier Analysis, LFL Analysis ve
   Backlog sayfalarının yenileme komutu ve horizonları birbirine bağlansın;
   tek yenilemeyle hepsine veri gitsin."

   Bu dört sayfa aynı ASAS satır evreninin farklı görünümleridir. Ayrı
   ufuklarla çalıştıklarında aynı sipariş bir sayfada var, ötekinde yok
   görünüyordu ve her sayfa ayrı yenilenmek zorundaydı.

   Kural (yalnız ASAS rolü): bağlı hedeflerin hepsi TEK bir kapsamda durur.
   Tek kapsam = tek DAX sorgusu = tek sonuç; dördünü birlikte yenilemek
   birini yenilemekle aynı sorguyu çalıştırır.

   CP bu gruba GİRMEZ: Orders ufkunun CP'den bağımsız düzenlenmesi (v4.71)
   bilinçli bir karardı ve korunur. IAS (antrepo) kapsamları yalnız ASAS
   siparişlerini zenginleştirir; sayfanın satır evrenini belirlemedikleri
   için eski Orders ayrıştırma kuralıyla devam eder.

   Eski kayıtların birleşmesi: bağlı sayfaların EN ÇOĞUNUN kullandığı ufuk
   kazanır (eşitlikte Orders → Backlog → LFL → Price & Supplier sırası).
   Böylece en az sayıda sayfanın verisi değişir.
   =================================================================== */
const LINKED_TARGETS = Object.freeze(['orders', 'backlog', 'lfl', 'priceanalysis']);
const LINKED_ROLES = new Set(['asas']);
// normalizeScopes'un eski kayıtlarda kendiliğinden eklediği hedefler.
const LINKED_AUTO_TARGETS = Object.freeze(['orders', 'priceanalysis']);

function isLinkedTarget(target) { return LINKED_TARGETS.includes(String(target == null ? '' : target).trim()); }

/** Hedef listesinde bağlı bir modül varsa grubun tamamı eklenir (yenileme hedefleri için). */
function withLinkedTargets(targets) {
  const list = (Array.isArray(targets) ? targets : [])
    .map(value => String(value == null ? '' : value).trim()).filter(Boolean);
  const out = [...new Set(list)];
  if (out.some(isLinkedTarget)) for (const target of LINKED_TARGETS) if (!out.includes(target)) out.push(target);
  return out;
}

function linkScopeTargets(scopes, role, fallbackHorizon, normalizeHorizon, detached = null) {
  const linked = allowedTargets(role).filter(isLinkedTarget);
  const skipped = detached instanceof Set ? detached : new Set();
  const list = dedupeTargets((Array.isArray(scopes) ? scopes : []).map(scope => ({
    ...scope,
    targets: Array.isArray(scope.targets) ? scope.targets.slice() : [],
    horizon: normalizeHorizon(scope.horizon),
  })));
  /* Oylama KAPSAM değil UFUK üzerindendir: aynı ufku taşıyan iki ayrı kapsam
     (ör. CP+Backlog ile tek başına Orders) aynı ufka oy verir. Eşitlikte
     LINKED_TARGETS sırasında önce gelen sayfanın ufku kazanır (Orders). */
  const votes = new Map();
  for (const scope of list) {
    const members = scope.targets.filter(target => linked.includes(target));
    if (!members.length) continue;
    const signature = JSON.stringify(scope.horizon);
    const entry = votes.get(signature) || { count: 0, rank: Infinity, scopes: [] };
    entry.count += members.length;
    entry.rank = Math.min(entry.rank, ...members.map(target => LINKED_TARGETS.indexOf(target)));
    entry.scopes.push(scope);
    votes.set(signature, entry);
  }
  let chosen = null;
  for (const entry of votes.values()) {
    if (!chosen || entry.count > chosen.count || (entry.count === chosen.count && entry.rank < chosen.rank)) chosen = entry;
  }
  // Aynı ufku taşıyanlar içinde yalnız bağlı sayfalardan oluşan kapsam tercih
  // edilir: kimliği ve adı olduğu gibi korunabilir.
  const winner = chosen
    ? (chosen.scopes.find(scope => scope.targets.every(target => linked.includes(target))) || chosen.scopes[0])
    : null;
  const present = new Set(list.flatMap(scope => scope.targets).filter(target => linked.includes(target)));
  // Kapatılmış (park edilmiş) bir besleme kendiliğinden geri gelmez.
  const members = linked.filter(target => present.has(target)
    || (LINKED_AUTO_TARGETS.includes(target) && !skipped.has(target)));
  const out = [];
  let linkedScope = null;
  if (members.length) {
    if (winner) {
      const pure = winner.targets.every(target => linked.includes(target));
      linkedScope = {
        ...winner,
        // Karışık kapsamdan ayrılan grup kaynak kapsamın kimliğini KOPYALAMAZ:
        // aynı kimliği taşıyan iki kapsam önbellek ve FilterSet eşlemesini
        // birbirine karıştırırdı.
        id: pure ? winner.id : stableScopeId(['linked', role, winner.id]),
        name: pure ? winner.name : '',
        targets: members,
      };
    } else {
      const source = list.find(scope => scope.targets.includes('cp')) || list[0] || null;
      linkedScope = {
        id: stableScopeId(['orders', role, source ? source.id : '']),
        name: '',
        targets: members,
        enabled: source ? source.enabled !== false : true,
        limitToCpOrders: false,
        horizon: normalizeHorizon(source ? source.horizon : fallbackHorizon),
      };
    }
  }
  for (const scope of list) {
    const rest = scope.targets.filter(target => !linked.includes(target));
    if (rest.length) out.push({ ...scope, targets: rest });
    if (linkedScope && scope === winner) out.push(linkedScope);
  }
  if (linkedScope && !winner) out.push(linkedScope);
  return dedupeTargets(out);
}

function separateScopeTargets(scopes, role, fallbackHorizon, normalizeHorizon, detached = null) {
  return LINKED_ROLES.has(role)
    ? linkScopeTargets(scopes, role, fallbackHorizon, normalizeHorizon, detached)
    : isolateOrdersScope(scopes, role, fallbackHorizon, normalizeHorizon, detached);
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

  const list = (Array.isArray(raw) ? raw : []).map((entry, index) => {
    const item = entry && typeof entry === 'object' ? entry : {};
    return {
      id: String(item.id || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40)
        || stableScopeId(['scope', role, index, item.name || '', item.targets || []]),
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
    // Price & Supplier Analysis eski ASAS kayıtlarında hedef olarak yoktur;
    // bağlı grup onu kendiliğinden kapsar (bkz. LINKED_AUTO_TARGETS). Grubun
    // ufkunu seçerken sayılmaz — sayılsaydı ilk kapsama eklenip oylamayı
    // CP'nin ufku lehine bozardı.
    return separateScopeTargets(dedupeTargets(list), role, fallbackHorizon, normalizeHorizon, detached);
  }

  const remaining = allowed.filter(target => !detached.has(target));
  // Her hedefi kapatılmış bir kaynak hiçbir sayfayı beslemez. Burada "eski kayıt"
  // kurtarması yapmak, kullanıcının kapattığı her şeyi geri açmak olurdu.
  if (!remaining.length) return [];
  const fallback = [{
    id: stableScopeId(['fallback', role, remaining]),
    name: '',
    targets: remaining,
    enabled: true,
    limitToCpOrders: false,
    horizon: normalizeHorizon(fallbackHorizon),
  }];
  return separateScopeTargets(fallback, role, fallbackHorizon, normalizeHorizon, detached);
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
  LINKED_TARGETS, LINKED_ROLES, isLinkedTarget, withLinkedTargets, linkScopeTargets,
};
