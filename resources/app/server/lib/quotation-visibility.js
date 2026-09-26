'use strict';

/* QUOTATION / FİYAT GEÇMİŞİ GÖRÜNÜRLÜĞÜ (kullanıcı kararı: "yetkisi olmayan
   görmesin").

   Fiyat talepleri üretici tekliflerini ve hedef fiyatları taşır; ticari olarak
   hassastır. Bir kayıt şu kişilere görünür:
     · kaydın sahibi, editörleri ve Moderatör (düzenleme hakkı olanlar),
     · Koleksiyon kaynaklı kayıtta: kayıt sahibinin Koleksiyonuna görüntüleme
       ya da düzenleme yetkisi verilmiş kullanıcılar (rol/hiyerarşi kayıt
       açmaz — Koleksiyon izin kuralıyla aynı),
     · CP kaynaklı kayıtta: kalemlerindeki siparişlerden en az biri kendi veri
       kapsamında olan kullanıcılar (ya da tüm siparişleri yönetme yetkisi).
   Sipariş kapsamı Moderatörün yetkili ASAS görüntüsünden türetilir. */

function orderCodeOf(item) {
  const code = Number(String(item && item.orderCode != null ? item.orderCode : '').replace(/\./g, '').trim());
  return Number.isFinite(code) && code > 0 ? code : null;
}

function createQuotationVisibility({ canEdit, collectionAccessLevel, hasPermission, authoritativeOrderRows, canEditOrder } = {}) {
  function visibleTo(profile, request) {
    if (!profile || !request) return false;
    if (typeof canEdit === 'function' && canEdit(profile, request)) return true;
    if (request.source === 'collection') {
      return Boolean(request.ownerId && typeof collectionAccessLevel === 'function' && collectionAccessLevel(profile, request.ownerId));
    }
    if (typeof hasPermission === 'function' && hasPermission(profile, 'manageAllOrders')) return true;
    return (Array.isArray(request.items) ? request.items : []).some(item => {
      const code = orderCodeOf(item);
      if (code == null || typeof authoritativeOrderRows !== 'function') return false;
      const rows = authoritativeOrderRows(code) || [];
      return rows.some(order => typeof canEditOrder === 'function' && canEditOrder(profile, order));
    });
  }
  return { visibleTo };
}

module.exports = { createQuotationVisibility, orderCodeOf };
