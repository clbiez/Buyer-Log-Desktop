'use strict';

/* CP/Siparişler SİPARİŞ BAZLI düzenlemelerinin yetki sınırı.

   Notlar, ek not, not sütunları, alt üretici, lisans veren, Supp. FOB,
   teslimat tipi ve tarih revizeleri tüm cihazlara eşitlenir; ancak bir
   kullanıcıya YALNIZ kendi veri kapsamındaki siparişlerin kayıtları gösterilir.
   Yazma uçlarının yanıtı ve görsel akışları tüm override belgesini taşıyordu;
   kapsam dışı siparişlerin notları böylece yetkisiz kullanıcıya ulaşıyordu.
   Ortak ayarlar (royalty, yol süreleri…) ve model görsel haritası kırpılmaz. */

const ORDER_SCOPED_MAPS = Object.freeze(['notesmap', 'noteColumnValues', 'submap', 'suppfobmap', 'suppfobmetamap', 'delmap', 'licensormap', 'datemap', 'shortagemap']);

function orderCodeOfKey(key) {
  const code = Number(String(key == null ? '' : key).split('|')[0].replace(/\./g, '').trim());
  return Number.isFinite(code) && code > 0 ? code : null;
}

function scopeOverridesForViewer(overrides, canViewOrderCode) {
  if (!overrides || typeof overrides !== 'object' || typeof canViewOrderCode !== 'function') return overrides;
  const cache = new Map();
  const visible = key => {
    const code = orderCodeOfKey(key);
    if (code == null) return false;
    if (!cache.has(code)) cache.set(code, Boolean(canViewOrderCode(code)));
    return cache.get(code);
  };
  const out = { ...overrides };
  for (const name of ORDER_SCOPED_MAPS) {
    const map = overrides[name];
    if (!map || typeof map !== 'object' || Array.isArray(map)) continue;
    const next = {};
    for (const [key, value] of Object.entries(map)) if (visible(key)) next[key] = value;
    out[name] = next;
  }
  return out;
}

module.exports = { ORDER_SCOPED_MAPS, orderCodeOfKey, scopeOverridesForViewer };
