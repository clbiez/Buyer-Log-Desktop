'use strict';

/* ===================================================================
   BAĞLI GRUBA EKLE / GRUPTAN AYIR — KALDIRILDI (v2026-10-30)

   v20260929'da üyelik düzenlenebilirdi. Kullanıcı kararıyla ufuklar iki
   sabit gruba indirildi: CP ayrı, "Diğer modüller" (Siparişler · Backlog ·
   LFL · Fiyat & Üretici; IAS'ta Siparişler · Backlog) tek ortak ufuk.
   Üyelik model-scopes.normalizeLinkedTargets'ta sabittir.

   Uç (source-workflow 'link' planlayıcısı) eski istemciler için durur ama
   her isteği açık bir kodla reddeder; sessizce "değişiklik yok" demez.
   Eskiden saklanan modül filtreleri (linkRestore) SİLİNMEZ.

   SAF MODÜL: disk, ağ, db.js yok.
   =================================================================== */

const modelScopes = require('../model-scopes');

function clean(value) { return String(value == null ? '' : value).trim(); }

/**
 * @returns {{ok:boolean, code:string, message:string, items:Array, warnings:string[]}}
 */
function planLinkChange(items, { sourceId } = {}) {
  const list = Array.isArray(items) ? items : [];
  const warnings = [];
  const item = list.find(entry => entry && clean(entry.id) === clean(sourceId));
  if (!item) return { ok: false, code: 'SOURCE_NOT_FOUND', message: 'Kaynak bulunamadı.', items: list, warnings };
  if (!modelScopes.LINKED_ROLES.has(clean(item.role).toLowerCase())) {
    return { ok: false, code: 'LINK_NOT_SUPPORTED', message: `${item.name || item.id} kaynağında bağlı grup yoktur; modüller kendi filtreleriyle çalışır.`, items: list, warnings };
  }
  return { ok: false, code: 'LINK_FIXED', message: 'Ufuklar sabittir: CP ayrı, diğer modüller tek ortak ufukta çalışır; modül gruba eklenip çıkarılamaz.', items: list, warnings };
}

module.exports = { planLinkChange };
