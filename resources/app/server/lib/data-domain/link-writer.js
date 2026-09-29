'use strict';

/* ===================================================================
   BAĞLI GRUBA EKLE / GRUPTAN AYIR (v20260929)

   Kullanıcı kararı: "Modüller birbirine bağlı olduğu için hepsini tek
   filtreleme altına topla. Eğer kullanıcı herhangi bir sayfayı bu
   linklemeden ayırmak isterse bunu yapabilsin. Veya geri ekleyebilsin."

   Bağlı grup = bir ASAS bağlantısında TEK filtreyi (tek kapsam, tek sorgu)
   paylaşan modüller. Üyelik bağlantı kaydındaki `linkedTargets` dizisinde
   durur; normalizeScopes üyeleri tek kapsamda tutar.

   GRUBA EKLE: modül kendi kapsamından çıkar ve grubun filtresini kullanır.
     Kendi filtresi SİLİNMEZ; linkRestore'da saklanır. Kullanıcı dar bir CP
     filtresini gruba katıp vazgeçerse filtresi geri gelmeli.
   GRUPTAN AYIR: modül kendi kapsamına çıkar. Saklanmış bir filtresi varsa o
     geri gelir; yoksa grubun o anki filtresinin kopyasıyla başlar — veri
     kapsamı ayrılma anında değişmez, kullanıcı sonra daraltır/genişletir.

   Yenileme bu karardan ETKİLENMEZ: tek yenileme motoru bütün modülleri
   birlikte yeniler (model-scopes REFRESH_TARGETS). Ayrılan modül yalnız
   kendi filtresiyle ayrı bir sorgu olur.

   SAF MODÜL: disk, ağ, db.js yok.
   =================================================================== */

const modelScopes = require('../model-scopes');
const modelHorizon = require('../modelHorizon');
const bindingWriter = require('./binding-writer');

function clean(value) { return String(value == null ? '' : value).trim(); }
function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
function label(moduleId) { return modelScopes.TARGET_LABELS[moduleId] || moduleId; }
function newScopeId(taken) {
  for (;;) {
    const id = `sc_${Math.random().toString(36).slice(2, 9)}`;
    if (!taken.has(id)) return id;
  }
}

/**
 * @returns {{ok:boolean, code:string, message:string, items:Array, warnings:string[]}}
 */
function planLinkChange(items, { sourceId, moduleId, linked, now = null } = {}) {
  const list = Array.isArray(items) ? items : [];
  const wantedSource = clean(sourceId);
  const wantedModule = clean(moduleId);
  const warnings = [];

  const index = list.findIndex(item => item && clean(item.id) === wantedSource);
  if (index < 0) return { ok: false, code: 'SOURCE_NOT_FOUND', message: 'Kaynak bulunamadı.', items: list, warnings };
  const item = clone(list[index]);
  const role = clean(item.role).toLowerCase();
  if (!modelScopes.LINKED_ROLES.has(role)) {
    return { ok: false, code: 'LINK_NOT_SUPPORTED', message: `${item.name || item.id} kaynağında bağlı grup yoktur; modüller kendi filtreleriyle çalışır.`, items: list, warnings };
  }
  if (!modelScopes.allowedTargets(role).includes(wantedModule)) {
    return { ok: false, code: 'MODULE_NOT_FEEDABLE', message: `${item.name || item.id} kaynağı "${wantedModule}" modülünü besleyemez.`, items: list, warnings };
  }
  if (typeof linked !== 'boolean') {
    return { ok: false, code: 'VALIDATION_ERROR', message: 'linked (boolean) zorunlu.', items: list, warnings };
  }

  const scopes = (clone(item.scopes) || []).map(scope => ({ ...scope, targets: (scope.targets || []).slice() }));
  const owner = scopes.find(scope => scope.targets.includes(wantedModule));
  if (!owner) {
    return {
      ok: false, code: 'BINDING_NOT_FOUND',
      message: `${label(wantedModule)} şu an ${item.name || item.id} kaynağına bağlı değil. Önce bağlantıyı açın.`,
      items: list, warnings,
    };
  }

  const members = modelScopes.linkedTargetsOf(item);
  const restore = bindingWriter.normalizeParked(item.linkRestore);
  const at = now || new Date().toISOString();

  if (linked) {
    if (members.includes(wantedModule)) return { ok: true, code: 'NO_CHANGE', message: '', items: list, warnings };
    // Modülün kendi filtresini sakla: gruptan tekrar ayrılırsa geri gelir.
    const saved = {
      moduleId: wantedModule, scopeId: owner.id || '', scopeName: owner.name || '',
      horizon: owner.horizon || item.horizon || {}, parkedAt: at,
    };
    owner.targets = owner.targets.filter(target => target !== wantedModule);
    const host = scopes.find(scope => scope.targets.some(target => members.includes(target)));
    if (host) host.targets.push(wantedModule);
    else owner.targets.push(wantedModule);            // grup boştu: modül grubu tek başına kurar
    item.linkedTargets = [...members, wantedModule];
    item.linkRestore = bindingWriter.normalizeParked([...restore.filter(entry => entry.moduleId !== wantedModule), saved]);
    if (host) {
      warnings.push(`${label(wantedModule)} bağlı gruba katıldı ve artık grubun filtresini${host.name ? ` ("${host.name}")` : ''} kullanıyor. Önceki filtresi saklandı; gruptan ayrılırsa geri gelir.`);
    }
  } else {
    if (!members.includes(wantedModule)) return { ok: true, code: 'NO_CHANGE', message: '', items: list, warnings };
    const saved = restore.find(entry => entry.moduleId === wantedModule) || null;
    owner.targets = owner.targets.filter(target => target !== wantedModule);
    const taken = new Set(scopes.filter(scope => scope.targets.length).map(scope => clean(scope.id)));
    scopes.push({
      id: saved && saved.scopeId && !taken.has(saved.scopeId) ? saved.scopeId : newScopeId(taken),
      name: saved ? saved.scopeName : '',
      targets: [wantedModule],
      enabled: owner.enabled !== false,
      limitToCpOrders: false,
      // Saklanmış filtre yoksa grubun filtresinin KOPYASI: ayrılma anında
      // modülün veri kapsamı değişmez.
      horizon: clone(saved ? saved.horizon : owner.horizon) || {},
    });
    item.linkedTargets = members.filter(target => target !== wantedModule);
    item.linkRestore = bindingWriter.normalizeParked(restore.filter(entry => entry.moduleId !== wantedModule));
    warnings.push(saved
      ? `${label(wantedModule)} bağlı gruptan ayrıldı; önceki filtresi${saved.scopeName ? ` ("${saved.scopeName}")` : ''} geri geldi. Yenileme yine ortaktır.`
      : `${label(wantedModule)} bağlı gruptan ayrıldı; grubun filtresinin bir kopyasıyla kendi filtresini kullanır. Yenileme yine ortaktır.`);
  }

  item.scopes = modelScopes.normalizeScopes(scopes.filter(scope => scope.targets.length), role, item.horizon,
    modelHorizon.normalizeHorizon, bindingWriter.parkedModuleIds(item), item.linkedTargets);

  /* Normalizasyon sonrası sonucu DOĞRULA: bağlanan modül grubun kapsamında,
     ayrılan modül grubun dışında olmalı. Aksi hâlde kullanıcı işlemin
     yapıldığını sanıp farklı bir sorgu görürdü. */
  const ownerAfter = item.scopes.find(scope => (scope.targets || []).includes(wantedModule));
  const peers = item.linkedTargets.filter(target => target !== wantedModule);
  const sharesWithPeers = Boolean(ownerAfter && (ownerAfter.targets || []).some(target => peers.includes(target)));
  const presentPeers = peers.filter(target => item.scopes.some(scope => (scope.targets || []).includes(target)));
  if (!ownerAfter || (linked && presentPeers.length && !sharesWithPeers) || (!linked && sharesWithPeers)) {
    return { ok: false, code: 'LINK_NOT_APPLIED', message: 'Bağlı grup değişikliği uygulanamadı: modül normalleştirmeden sonra beklenen kapsamda değil.', items: list, warnings };
  }

  const next = list.slice();
  next[index] = item;
  return { ok: true, code: 'OK', message: '', items: next, warnings };
}

module.exports = { planLinkChange };
