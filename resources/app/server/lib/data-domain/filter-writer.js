'use strict';

/* ===================================================================
   ORTAK MODÜL FİLTRESİNİ DÜZENLE (P3 — yazma tarafı)

   Bugün bir modülün ORTAK filtresini düzenlemenin tek yolu 1.619 satırlık
   "Horizon ve Bağlantı" modalı. Kişisel Horizon'un ise sayfa rozetinde iyi
   çalışan bir düzenleyicisi zaten var.

   Bu dosya YALNIZ ortak katmanı yazar. Kişisel katman user-preferences'ta
   yaşamaya devam eder ve mevcut rozet düzenleyicisiyle yönetilir. İkisini
   tek yazma yoluna sıkıştırmak, "hangi katmanı düzenliyorum?" belirsizliğini
   —düzeltmeye çalıştığımız sorunu— yeni ekranda yeniden üretirdi.

   PAYLAŞIM SEMANTİĞİ (§19). Bir kapsam birden çok modülü besleyebilir; o
   kapsamın ufkunu değiştirmek HEPSİNİ etkiler. Kullanıcıya iki seçenek:

     mode 'shared' → kapsamı olduğu gibi güncelle (hepsi etkilenir)
     mode 'split'  → bu modülü kendi kapsamına ayır (diğerleri eskisini korur)

   Hangisinin seçildiği SUNUCUYA açıkça gelir. Varsayılan uydurmak —örneğin
   "tek modülse güncelle, çoksa ayır"— kullanıcının farkında olmadığı bir
   karar vermek olurdu.

   SAF MODÜL: disk, ağ, db.js yok.
   =================================================================== */

const modelScopes = require('../model-scopes');
const modelHorizon = require('../modelHorizon');
const sourceProfiles = require('./source-profiles');
const bindingWriter = require('./binding-writer');

const MODES = Object.freeze(['shared', 'split']);
const MAX_NAME = 80;

function clean(value) { return String(value == null ? '' : value).replace(/\s+/g, ' ').trim(); }
function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }

function normalizeScopesFor(item, scopes) {
  /* Park edilmiş modüller burada da geçirilir: bir filtreyi kaydetmek, kullanıcının
     kapattığı bir beslemeyi geri açmamalı. */
  return modelScopes.normalizeScopes(scopes, item.role, item.horizon, modelHorizon.normalizeHorizon,
    bindingWriter.parkedModuleIds(item));
}

/** Filtrenin sorguyu gerçekten sınırlayıp sınırlamadığı; kaydetmeyi engellemez. */
function describeBounds(definition) {
  try {
    const built = modelHorizon.buildHorizonFilter(definition || {});
    return { bounded: Boolean(clean(built.expression)), error: '' };
  } catch (error) {
    return { bounded: false, error: String(error && error.message || error) };
  }
}

/**
 * @returns {{ok:boolean, code:string, message:string, items:Array, warnings:string[]}}
 */
function planFilterChange(items, { sourceId, moduleId, definition, mode = 'shared', name = null } = {}) {
  const list = Array.isArray(items) ? items : [];
  const wantedSource = clean(sourceId);
  const wantedModule = clean(moduleId);
  const warnings = [];

  const index = list.findIndex(item => item && clean(item.id) === wantedSource);
  if (index < 0) return { ok: false, code: 'SOURCE_NOT_FOUND', message: 'Kaynak bulunamadı.', items: list, warnings };

  const item = clone(list[index]);
  const profile = sourceProfiles.fromLegacyRole(item.role);
  if (!profile) {
    return { ok: false, code: 'SOURCE_PROFILE_UNKNOWN', message: 'Bu kaynağın türü tanınmıyor; filtresi bu ekrandan düzenlenemez.', items: list, warnings };
  }
  if (!profile.feedableModules.includes(wantedModule)) {
    return { ok: false, code: 'MODULE_NOT_FEEDABLE', message: `${item.name || item.id} kaynağı "${wantedModule}" modülünü besleyemez.`, items: list, warnings };
  }
  if (!MODES.includes(mode)) {
    return { ok: false, code: 'FILTER_MODE_INVALID', message: 'Geçersiz kaydetme biçimi.', items: list, warnings };
  }

  const scopes = clone(item.scopes) || [];
  const ownerIndex = scopes.findIndex(scope => (scope.targets || []).includes(wantedModule));
  if (ownerIndex < 0) {
    /* Modül bu kaynağa bağlı değil. Filtreyi yine de yazmak, görünmeyen bir
       ayar bırakmak olurdu; kullanıcı önce bağlantıyı açmalı. */
    return {
      ok: false, code: 'BINDING_NOT_FOUND',
      message: `"${wantedModule}" şu an ${item.name || item.id} kaynağına bağlı değil. Önce bağlantıyı açın.`,
      items: list, warnings,
    };
  }

  // Ufku normalleştir: kaydedilen şey, sorguyu üretecek olanın birebir aynısı.
  let normalizedHorizon;
  try { normalizedHorizon = modelHorizon.normalizeHorizon(definition); }
  catch (error) {
    return { ok: false, code: 'FILTER_INVALID', message: String(error && error.message || error), items: list, warnings };
  }

  const bounds = describeBounds(normalizedHorizon);
  if (!bounds.bounded) {
    /* Sınırsız filtre KAYDEDİLEBİLİR ama yenileme onu reddeder
       (source-filter-readiness). Sessizce kaydedip kullanıcıyı yenilemede
       şaşırtmak yerine burada söylenir. */
    warnings.push(bounds.error
      ? `Filtre tamamlanmamış: ${bounds.error} Bu hâliyle yenileme çalışmaz.`
      : 'Bu filtre sorguyu sınırlamıyor; bu hâliyle yenileme çalışmaz.');
  }

  const owner = scopes[ownerIndex];
  const sharedWith = (owner.targets || []).filter(target => target !== wantedModule);
  const linkedGroup = modelScopes.LINKED_ROLES.has(String(item.role || '').toLowerCase()) && modelScopes.isLinkedTarget(wantedModule);

  if (linkedGroup) {
    /* BAĞLI MODÜLLER (Orders · Backlog · LFL · Price & Supplier) tek ufuk
       taşır; "yalnız bu modül için ayır" burada anlamsızdır — normalizasyon
       ayrılan modülü gruba geri katar ve kullanıcının yazdığı ufuk sessizce
       kaybolabilirdi. Bu yüzden iki biçim de aynı işi yapar: grubun bütün
       üyeleri yeni ufku alır, gruba ait olmayan ortaklar (CP) eski ufkunda
       kalır. */
    const members = scopes.flatMap(scope => (scope.targets || []).filter(target => modelScopes.isLinkedTarget(target)));
    const peers = members.filter(target => target !== wantedModule);
    const outsiders = sharedWith.filter(target => !modelScopes.isLinkedTarget(target));
    const pureOwner = !outsiders.length;
    const next = scopes.map(scope => ({ ...scope, targets: (scope.targets || []).filter(target => !modelScopes.isLinkedTarget(target)) }))
      .filter(scope => scope.targets.length);
    const linkedScope = {
      ...owner,
      id: pureOwner ? owner.id : `sc_${Math.random().toString(36).slice(2, 9)}`,
      name: name == null ? (pureOwner ? owner.name : '') : clean(name).slice(0, MAX_NAME),
      targets: [...new Set(members)],
      horizon: normalizedHorizon,
    };
    const at = next.findIndex(scope => scope.id === owner.id);
    if (at >= 0) next.splice(at + 1, 0, linkedScope); else next.push(linkedScope);
    scopes.length = 0;
    scopes.push(...next);
    if (peers.length) {
      warnings.push(`Bu filtre bağlı ${peers.length + 1} modülün ortak ufkudur (${[wantedModule, ...peers].map(target => modelScopes.TARGET_LABELS[target] || target).join(', ')}); değişiklik hepsini birlikte etkiler.`);
    }
  } else if (mode === 'shared') {
    if (sharedWith.length) {
      warnings.push(`Bu filtre ${sharedWith.length + 1} modül tarafından paylaşılıyor; değişiklik hepsini etkiler.`);
    }
    scopes[ownerIndex] = {
      ...owner,
      name: name == null ? owner.name : clean(name).slice(0, MAX_NAME),
      horizon: normalizedHorizon,
    };
  } else {
    if (!sharedWith.length) {
      /* Zaten tek başına: ayırmak yeni bir kapsam üretip aynı sonucu verirdi
         ama kapsam kimliğini gereksiz yere değiştirirdi. Ortak yol kullanılır. */
      scopes[ownerIndex] = {
        ...owner,
        name: name == null ? owner.name : clean(name).slice(0, MAX_NAME),
        horizon: normalizedHorizon,
      };
    } else {
      scopes[ownerIndex] = { ...owner, targets: sharedWith };
      scopes.push({
        id: `sc_${Math.random().toString(36).slice(2, 9)}`,
        name: name == null ? '' : clean(name).slice(0, MAX_NAME),
        targets: [wantedModule],
        enabled: owner.enabled !== false,
        limitToCpOrders: false,
        horizon: normalizedHorizon,
      });
      warnings.push(`"${wantedModule}" kendi filtresine ayrıldı; diğer ${sharedWith.length} modül eski filtreyi kullanmaya devam ediyor.`);
    }
  }

  item.scopes = normalizeScopesFor(item, scopes);

  /* normalizeScopes kapsamları yeniden düzenleyebilir (Orders ayrılması,
     priceanalysis eklenmesi). Yazdığımız ufkun hedef modülde GERÇEKTEN
     geçerli olduğunu doğrula — aksi hâlde sessizce başka bir kapsama düşmüş
     olabilirdi ve kullanıcı kaydettiğini sanırdı. */
  const applied = item.scopes.find(scope => (scope.targets || []).includes(wantedModule));
  if (!applied) {
    return { ok: false, code: 'FILTER_NOT_APPLIED', message: 'Filtre kaydedilemedi: modül normalleştirmeden sonra bu kapsamda bulunamadı.', items: list, warnings };
  }
  // Modül bulundu ama normalizasyon onu BAŞKA bir ufka taşıdıysa (ör. bağlı
  // grubun birleşmesi) kaydedildi sanılmamalı.
  if (JSON.stringify(modelHorizon.normalizeHorizon(applied.horizon)) !== JSON.stringify(normalizedHorizon)) {
    return { ok: false, code: 'FILTER_NOT_APPLIED', message: 'Filtre kaydedilemedi: modül normalleştirmeden sonra farklı bir ufukla eşleşti.', items: list, warnings };
  }

  const next = list.slice();
  next[index] = item;
  return { ok: true, code: 'OK', message: '', items: next, warnings, appliedScopeId: applied.id };
}

/** Bir modülün ortak filtresini paylaşan diğer modüller — uyarı metni için. */
function sharedModules(items, sourceId, moduleId) {
  const item = (Array.isArray(items) ? items : []).find(entry => entry && clean(entry.id) === clean(sourceId));
  if (!item) return [];
  const owner = (item.scopes || []).find(scope => (scope.targets || []).includes(clean(moduleId)));
  return owner ? (owner.targets || []).filter(target => target !== clean(moduleId)) : [];
}

module.exports = { MODES, planFilterChange, sharedModules, describeBounds };
