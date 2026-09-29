'use strict';

/* ===================================================================
   MODÜL BAĞLANTISINI AÇ / KAPAT (P5) — ilk yazma yolu

   §11'İN SÖZÜ: "IAS → Orders bağlantısını kapatırsam IAS silinmemeli.
   Bağlantı, şema, alan eşlemesi ve diğer modül bağlantıları korunmalı.
   Tekrar bağlandığında eski ayarlar yeniden kullanılabilmeli."

   Bugünkü depoda bunun önünde GERÇEK bir engel var: bir modül bağlantısı
   ayrı bir kayıt değil, bir kapsamın targets[] dizisindeki bir eleman.
   Son hedefi de çıkarınca kapsam tamamen kayboluyor — ve onunla birlikte
   o kapsamın FİLTRESİ de. Bu yüzden kapatılan bağlantı "park edilir":
   kapsam kimliği, adı ve ufku saklanır, tekrar açıldığında aynen geri gelir.

   KİLİTLİ HEDEFLER — İŞ KURALIDIR, DEPO DAVRANIŞI DEĞİL.

   Bu dosyanın ilk sürümü kilidi ÖLÇÜYORDU: kapatmayı simüle edip
   normalizeScopes hedefi geri ekliyor mu diye bakıyordu. Ölçüm doğruydu ama
   YANLIŞ SORUYU cevaplıyordu. normalizeScopes'un geri ekleme dalları eski
   kayıtların çalışmaya devam etmesi için var; "bu modül bu veri olmadan
   çalışamaz" demek değiller. Nitekim ölçüm IAS → Siparişler'i kilitli
   gösteriyordu, oysa Siparişler antrepo verisi olmadan da doğru çalışır:
   ASAS sipariş satırlarını gösterir ve yeniler, yalnız antrepo sütunları
   boş kalır.

   Kilit artık source-profiles.js'teki requiredModules kaydından okunur:

     asas-orders   → cp, orders, backlog, lfl, priceanalysis  (hepsi zorunlu)
     ias-warehouse → cp, backlog                              (orders SERBEST)
     intake-budget → intake

   Kapatılan hedefin normalizasyonda geri doğmaması için park listesi
   modelScopes.normalizeScopes'a "detached" olarak geçirilir; böylece kural
   tek yerde durur ve iki uç birbirini yalanlamaz.

   SAF MODÜL: disk, ağ, db.js yok.
   =================================================================== */

const modelScopes = require('../model-scopes');
const modelHorizon = require('../modelHorizon');
const sourceProfiles = require('./source-profiles');

const MAX_PARKED = 24;

function clean(value) { return String(value == null ? '' : value).trim(); }
function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }

function normalizeScopesFor(item, scopes, detached = null) {
  return modelScopes.normalizeScopes(scopes, item.role, item.horizon, modelHorizon.normalizeHorizon,
    detached || parkedModuleIds(item), item.linkedTargets);
}

/** Kaydın "bilerek kapatılmış" modülleri — normalizasyonun geri ekleme dallarını susturur. */
function parkedModuleIds(item) {
  return normalizeParked(item && item.parkedBindings).map(entry => entry.moduleId);
}

function scopeTargets(scopes) {
  const out = new Set();
  for (const scope of Array.isArray(scopes) ? scopes : []) {
    for (const target of (scope && scope.targets) || []) out.add(clean(target));
  }
  return out;
}

function withoutTarget(scopes, moduleId) {
  return (Array.isArray(scopes) ? scopes : []).map(scope => ({
    ...scope,
    targets: (scope.targets || []).filter(target => clean(target) !== moduleId),
  })).filter(scope => scope.targets.length);
}

/**
 * Bu hedef kapatılabilir mi? Cevap kaynağın PROFİLİNDEN gelir (bkz. dosya başlığı).
 * Zaten kapalı olan bir hedef "kilitli" sayılmaz: kilit, kapatmayı engeller —
 * geri açmayı değil.
 */
function isTargetLocked(item, moduleId) {
  const wanted = clean(moduleId);
  if (!scopeTargets(item.scopes).has(wanted)) return false;      // zaten kapalı
  const profile = sourceProfiles.fromLegacyRole(item && item.role);
  return Boolean(profile && sourceProfiles.isModuleRequired(profile.id, wanted));
}

/** Bir kaynağın her hedefi için kilit durumu — arayüz toggle'ı buna göre çizer. */
function lockedTargets(item) {
  const profile = sourceProfiles.fromLegacyRole(item && item.role);
  if (!profile) return [];
  return profile.feedableModules.filter(moduleId => isTargetLocked(item, moduleId));
}

function normalizeParked(raw) {
  const seen = new Set();
  return (Array.isArray(raw) ? raw : []).map(entry => {
    const item = entry && typeof entry === 'object' ? entry : {};
    const moduleId = clean(item.moduleId).slice(0, 40);
    if (!moduleId || seen.has(moduleId)) return null;
    seen.add(moduleId);
    return {
      moduleId,
      scopeId: clean(item.scopeId).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40),
      scopeName: clean(item.scopeName).slice(0, 80),
      horizon: modelHorizon.normalizeHorizon(item.horizon),
      parkedAt: clean(item.parkedAt).slice(0, 40),
    };
  }).filter(Boolean).slice(0, MAX_PARKED);
}

/* -------------------------------------------------------------------
   PLANLAMA — yazmaz, yeni bir items dizisi döndürür.
   ------------------------------------------------------------------- */

/**
 * @returns {{ok:boolean, code:string, message:string, items:Array}}
 */
function planBindingChange(items, { sourceId, moduleId, enabled, now = null } = {}) {
  const list = Array.isArray(items) ? items : [];
  const wantedSource = clean(sourceId);
  const wantedModule = clean(moduleId);
  const index = list.findIndex(item => item && clean(item.id) === wantedSource);

  if (index < 0) {
    return { ok: false, code: 'SOURCE_NOT_FOUND', message: 'Kaynak bulunamadı.', items: list };
  }
  const item = clone(list[index]);
  const profile = sourceProfiles.fromLegacyRole(item.role);
  if (!profile) {
    return { ok: false, code: 'SOURCE_PROFILE_UNKNOWN', message: 'Bu kaynağın türü tanınmıyor; bağlantısı bu ekrandan değiştirilemez.', items: list };
  }
  if (!profile.feedableModules.includes(wantedModule)) {
    /* İMKÂNSIZ hücre. Arayüz bunu zaten toggle olarak çizmez; yine de sunucu
       tarafında reddedilir — istemciye güvenilmez (CLAUDE.md §10). */
    return {
      ok: false, code: 'MODULE_NOT_FEEDABLE',
      message: `${item.name || item.id} kaynağı "${wantedModule}" modülünü besleyemez.`,
      items: list,
    };
  }

  const parked = normalizeParked(item.parkedBindings);
  const present = scopeTargets(item.scopes).has(wantedModule);
  const otherParked = parked.filter(entry => entry.moduleId !== wantedModule).map(entry => entry.moduleId);

  if (enabled === false) {
    if (!present) return { ok: true, code: 'NO_CHANGE', message: '', items: list };
    if (isTargetLocked(item, wantedModule)) {
      const label = modelScopes.TARGET_LABELS[wantedModule] || wantedModule;
      return {
        ok: false, code: 'BINDING_LOCKED',
        message: `${label} bu veri olmadan çalışamaz; ${item.name || profile.label.tr} bağlantısı kapatılamaz.`,
        items: list,
      };
    }
    // Kapsam kimliğini, adını ve UFKUNU sakla: §11'in "eski ayarlar yeniden
    // kullanılabilsin" sözü buna bağlı.
    const owner = (item.scopes || []).find(scope => (scope.targets || []).includes(wantedModule)) || {};
    // Kapatılan hedef, normalizasyona GİRERKEN zaten "detached" sayılmalı; yoksa
    // isolateOrdersScope onu aynı çağrı içinde geri yaratır.
    item.scopes = normalizeScopesFor(item, withoutTarget(item.scopes, wantedModule),
      [...otherParked, wantedModule]);
    item.parkedBindings = normalizeParked([
      ...parked.filter(entry => entry.moduleId !== wantedModule),
      {
        moduleId: wantedModule,
        scopeId: owner.id || '',
        scopeName: owner.name || '',
        horizon: owner.horizon || item.horizon || {},
        parkedAt: now || new Date().toISOString(),
      },
    ]);
  } else {
    if (present) return { ok: true, code: 'NO_CHANGE', message: '', items: list };
    const saved = parked.find(entry => entry.moduleId === wantedModule) || null;
    const scopes = clone(item.scopes) || [];
    // Aynı kimlikli kapsam hâlâ duruyorsa hedef ona geri katılır; böylece
    // modül eskisi gibi aynı sorguyu paylaşır (tek sorgu, tek sonuç).
    const host = saved && saved.scopeId ? scopes.find(scope => clean(scope.id) === saved.scopeId) : null;
    if (host) {
      host.targets = [...host.targets, wantedModule];
    } else {
      scopes.push({
        id: (saved && saved.scopeId) || `sc_${Math.random().toString(36).slice(2, 9)}`,
        name: (saved && saved.scopeName) || '',
        targets: [wantedModule],
        enabled: true,
        limitToCpOrders: false,
        /* Kayıtlı ufuk yoksa BOŞ bırakılır — uydurulmaz. Filtresiz bir kaynak
           zaten yenilenemez ve ekran "filtre gerekli" der; kullanıcıdan bilinçli
           bir kapsam kararı istenir. Sessizce başka bir modülün filtresini
           kopyalamak, beklenmedik hacimde sorgu demek olurdu. */
        horizon: (saved && saved.horizon) || {},
      });
    }
    // Geri açılan hedef artık park listesinde DEĞİL; normalizasyona da öyle girer.
    item.scopes = normalizeScopesFor(item, scopes, otherParked);
    item.parkedBindings = normalizeParked(parked.filter(entry => entry.moduleId !== wantedModule));
  }

  const next = list.slice();
  next[index] = item;
  return { ok: true, code: 'OK', message: '', items: next };
}

module.exports = {
  MAX_PARKED,
  isTargetLocked, lockedTargets, normalizeParked, parkedModuleIds,
  planBindingChange,
};
