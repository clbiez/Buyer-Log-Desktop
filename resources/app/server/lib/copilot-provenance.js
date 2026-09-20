'use strict';

/* AJAN DEĞİŞİKLİĞİNİN İZİ: "bu notu kim yazdı, ajan mı önerdi?"
 *
 * Onayla akışı, Copilot'a KENDİ yazma yolunu vermeyerek güvende kalıyor:
 * öneri onaylanınca kullanıcının elle düzenlerken kullandığı aynı uç
 * (PATCH /api/overrides/:orderCode) çağrılıyor. Bunun bedeli, sunucunun
 * yazmaya bakınca elle yapılan düzenleme ile onaylanmış öneriyi ayırt
 * edememesiydi. Audit kaydı vardı ve eksiksizdi; eksik olan BAĞLANTIydı.
 *
 * Çözüm, ayrı bir kayıt üretmek değil GERÇEK yazmayı etiketlemek — mevcut
 * mail-intelligence akışının deseni (ORDER_UPDATE + source:'MAIL_INTELLIGENCE').
 * İki kural bunu güvenli tutuyor:
 *
 *   1) KAYNAK istemciden gelir, AKTÖR oturumdan. İstemcinin bildirdiği bir
 *      kimliğe güvenilseydi, provenance bir kanıt değil bir iddia olurdu.
 *   2) origin bir AUDIT alanıdır, VERİ değil. Yama gövdesinden ayıklanmazsa
 *      sipariş kaydına anlamsız bir alan olarak girer ve senkronla bütün
 *      cihazlara yayılırdı.
 *
 * Saf modül: rota bunu çağırır, test canlı koşturur.
 */

const MAX_PROPOSAL_ID = 120;
const MAX_ACTION_TYPE = 60;

/* Yamayı ikiye ayırır: kaydedilecek VERİ ve yalnız audit'e giden KAYNAK.
   Dönen patch her zaman yeni bir nesnedir; çağıranın gövdesi değişmez. */
function splitOrigin(body) {
  const source = body && typeof body === 'object' ? body : {};
  const { origin, ...patch } = source;
  return { origin, patch };
}

/* Kaynağı audit ayrıntısına çevirir. Tanınmayan ya da eksik bir kaynak null
   döner: yanlış provenance, hiç provenance olmamasından kötüdür. */
function originMeta(origin) {
  if (!origin || typeof origin !== 'object' || Array.isArray(origin)) return null;
  if (String(origin.source || '') !== 'copilot') return null;
  const proposalId = String(origin.proposalId == null ? '' : origin.proposalId).trim().slice(0, MAX_PROPOSAL_ID);
  const actionType = String(origin.type == null ? '' : origin.type).trim().slice(0, MAX_ACTION_TYPE);
  return { source: 'COPILOT', proposalId: proposalId || null, actionType: actionType || null };
}

/* Rotanın tek çağrısı: yama, audit ayrıntısı ve alan listesi birlikte üretilir
   ki üçü birbirinden kopmasın. */
function describeWrite(body, { excludeFields } = {}) {
  const { origin, patch } = splitOrigin(body);
  const skip = excludeFields instanceof RegExp ? excludeFields : /^expected/;
  return {
    patch,
    origin: originMeta(origin),
    fields: Object.keys(patch).filter(key => !skip.test(key)),
  };
}

module.exports = { splitOrigin, originMeta, describeWrite };
