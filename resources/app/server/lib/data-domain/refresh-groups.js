'use strict';

/* ===================================================================
   YENİLEME GRUPLARI (P6)

   Kullanıcı brief'i §22–§23: "Kullanıcı istediği modülleri tek refresh
   altında bağlayabilsin. Bundan daha karmaşık configuration istemiyorum."

   Bu yüzden burada BİLEREK az şey var: ad + modül listesi. Zamanlama,
   koşul, öncelik, bağımlılık yok. Otomatik yenileme zaten ayrı bir ayar
   (Kaynak Veri şeridindeki periyot) ve onu buraya kopyalamak §49'daki
   "aynı config'in üç yerde bulunması" sorununu yeniden üretirdi.

   HEDEF LİSTESİ UYDURULMAZ. Bir grup yalnız /api/refresh'in gerçekten
   kabul ettiği hedefleri taşıyabilir (source-filter-readiness.SUPPORTED_TARGETS).
   Aksi hâlde kullanıcı INTAKE'i bir gruba koyar, "Yenile" der ve hiçbir şey
   olmaz — çünkü INTAKE kendi ayrı akışından gelir. Sessiz bir hiçlik yerine
   grubu kurarken söylenir.

   ÇALIŞTIRMA KİŞİSEL, TANIM ORTAK. Yenileme zaten kullanıcı başına çalışır
   (her kullanıcı kendi Horizon'uyla kendi anlık görüntüsünü çeker); ama
   "Buying Core" gibi bir grup ekip genelinde anlamlıdır. Bu yüzden tanım
   paylaşılan ayarlarda tutulur, çalıştırma kullanıcının kendi bağlamında olur.

   SAF MODÜL: disk ve ağ yok.
   =================================================================== */

const { SUPPORTED_TARGETS } = require('../source-filter-readiness');
const { withLinkedTargets } = require('../model-scopes');

const MAX_GROUPS = 12;
const MAX_NAME = 60;

function clean(value) { return String(value == null ? '' : value).replace(/\s+/g, ' ').trim(); }

/** Bir gruba konabilecek modüller. Tek doğruluk kaynağı. */
function refreshableModules() { return SUPPORTED_TARGETS.slice(); }

function normalizeModuleIds(raw) {
  const allowed = new Set(SUPPORTED_TARGETS);
  const seen = new Set();
  const out = [];
  for (const value of Array.isArray(raw) ? raw : []) {
    const moduleId = clean(value).toLowerCase();
    if (!allowed.has(moduleId) || seen.has(moduleId)) continue;
    seen.add(moduleId);
    out.push(moduleId);
  }
  // Bağlı modüller (Orders · Backlog · LFL · Price & Supplier) tek yenilemedir:
  // gruba biri konursa hepsi gelir; grup tanımı gerçekte ne yenilendiğini söyler.
  const linked = withLinkedTargets(out);
  // Sıralama SUPPORTED_TARGETS'a göre sabitlenir: aynı grup her ekranda aynı
  // sırada görünsün, kullanıcı seçim sırasını hatırlamak zorunda kalmasın.
  return SUPPORTED_TARGETS.filter(moduleId => linked.includes(moduleId));
}

function normalizeGroup(raw) {
  const item = raw && typeof raw === 'object' ? raw : {};
  return {
    id: clean(item.id).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40)
      || `rg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    name: clean(item.name).slice(0, MAX_NAME),
    moduleIds: normalizeModuleIds(item.moduleIds),
    updatedAt: clean(item.updatedAt).slice(0, 40),
  };
}

/**
 * Kayıt listesini normalleştirir. Adı veya modülü olmayan grup DÜŞÜRÜLÜR:
 * çalıştırıldığında hiçbir şey yapmayan bir grup, kullanıcı için bozuk bir
 * düğmeden başka bir şey değil.
 */
function normalizeGroups(raw) {
  const seenIds = new Set();
  const seenNames = new Set();
  return (Array.isArray(raw) ? raw : [])
    .map(normalizeGroup)
    .filter(group => {
      if (!group.name || !group.moduleIds.length) return false;
      const nameKey = group.name.toLocaleLowerCase('tr');
      if (seenIds.has(group.id) || seenNames.has(nameKey)) return false;
      seenIds.add(group.id);
      seenNames.add(nameKey);
      return true;
    })
    .slice(0, MAX_GROUPS);
}

/**
 * Kaydetmeden önceki insan okunur doğrulama. normalizeGroups sessizce
 * düşürür; bu ise kullanıcıya NEDEN kabul edilmediğini söyler.
 */
function validateGroups(raw) {
  const problems = [];
  const list = Array.isArray(raw) ? raw : [];
  if (list.length > MAX_GROUPS) problems.push(`En fazla ${MAX_GROUPS} yenileme grubu tanımlanabilir.`);

  const names = new Set();
  list.forEach((entry, index) => {
    const group = normalizeGroup(entry);
    const label = group.name || `#${index + 1}`;
    if (!group.name) problems.push(`${index + 1}. grubun adı boş.`);
    else {
      const key = group.name.toLocaleLowerCase('tr');
      if (names.has(key)) problems.push(`"${group.name}" adı birden fazla grupta kullanılmış.`);
      names.add(key);
    }
    if (!group.moduleIds.length) {
      const requested = (Array.isArray(entry && entry.moduleIds) ? entry.moduleIds : []).map(clean).filter(Boolean);
      const rejected = requested.filter(moduleId => !SUPPORTED_TARGETS.includes(moduleId.toLowerCase()));
      problems.push(rejected.length
        ? `"${label}" grubundaki ${rejected.join(', ')} yenileme akışına dahil değil; bu modüller kendi ekranlarından yenilenir.`
        : `"${label}" grubunda hiç modül seçilmemiş.`);
    }
  });
  return { ok: problems.length === 0, problems };
}

/** Bir grubun /api/refresh'e gönderilecek hedefleri. */
function targetsFor(groups, groupId) {
  const group = normalizeGroups(groups).find(entry => entry.id === clean(groupId));
  return group ? group.moduleIds.slice() : [];
}

module.exports = {
  MAX_GROUPS, MAX_NAME,
  refreshableModules, normalizeModuleIds, normalizeGroup, normalizeGroups,
  validateGroups, targetsFor,
};
