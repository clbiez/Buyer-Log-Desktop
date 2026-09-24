'use strict';

/* ===================================================================
   ÇIKTI SAKLAMA — KISA ÖMÜRLÜ, KULLANICIYA KAPALI, SINIRLI

   Cevap üretilirken çıktı modeli hazırlanıyor ama kullanıcı indirmeyi
   isteyene kadar dosya yazılmıyor. Aradaki model bir yerde durmak zorunda.

   NEDEN KALICI DEPO DEĞİL. Bu bir iş kaydı değil, bir cevabın geçici
   yansıması. Diske yazmak yedekleme, senkron, temizlik ve saklama süresi
   soruları açardı; taşıdığı veri ise zaten override store'unda ve kaynak
   dosyalarda duruyor. Süreç yeniden başlarsa çıktı kaybolur — kullanıcı
   soruyu tekrar sorar, bu kabul edilebilir bir bedel.

   YETKİ BURADA KRİTİK. Kimlik tahmin edilemez olsa bile TEK BAŞINA yeterli
   sayılmaz: her okuma, isteyen kullanıcının o çıktının SAHİBİ olduğunu
   doğrular. Aksi hâlde bir kimliği ele geçiren ya da tahmin eden biri
   başkasının kapsamındaki veriyi indirebilirdi — üstelik yetki katmanına
   hiç uğramadan.

   SINIRLAR GERÇEK. Kapaksız bir bellek deposu, uzun süre açık kalan bir
   sunucuda sessizce büyür ve bir gün süreci öldürür.
   =================================================================== */

const crypto = require('crypto');

const DEFAULT_TTL_MS = 30 * 60 * 1000;   // 30 dakika: bir cevabı indirmek için fazlasıyla yeterli
const DEFAULT_MAX_PER_USER = 10;
const DEFAULT_MAX_TOTAL = 120;

function createExportStore(options = {}) {
  const ttlMs = Number(options.ttlMs) > 0 ? Number(options.ttlMs) : DEFAULT_TTL_MS;
  const maxPerUser = Number(options.maxPerUser) > 0 ? Number(options.maxPerUser) : DEFAULT_MAX_PER_USER;
  const maxTotal = Number(options.maxTotal) > 0 ? Number(options.maxTotal) : DEFAULT_MAX_TOTAL;
  const now = typeof options.now === 'function' ? options.now : () => Date.now();
  const newId = typeof options.newId === 'function' ? options.newId : () => crypto.randomBytes(16).toString('hex');

  /* Ekleme sırası korunur (Map): en eskiyi düşürmek için ayrı bir sıralama
     tutmaya gerek kalmıyor. */
  const items = new Map();

  function expired(entry, at) { return at - entry.at > ttlMs; }

  function sweep(at) {
    for (const [id, entry] of items) if (expired(entry, at)) items.delete(id);
    // Kullanıcı başına kapak: aynı kullanıcının en eskisi düşer.
    const perUser = new Map();
    for (const [id, entry] of items) {
      const list = perUser.get(entry.ownerId) || [];
      list.push(id);
      perUser.set(entry.ownerId, list);
    }
    for (const list of perUser.values()) {
      while (list.length > maxPerUser) items.delete(list.shift());
    }
    // Genel kapak: kim olursa olsun en eski düşer.
    while (items.size > maxTotal) items.delete(items.keys().next().value);
  }

  return {
    get size() { return items.size; },

    /* Sahipsiz çıktı SAKLANMAZ: sahibi olmayan bir kaydın yetki kontrolü
       yapılamaz, dolayısıyla güvenli biçimde okunamaz. */
    put(ownerId, model) {
      const owner = String(ownerId == null ? '' : ownerId).trim();
      if (!owner || !model) return null;
      const at = now();
      const id = newId();
      items.set(id, { ownerId: owner, model, at });
      sweep(at);
      return items.has(id) ? id : null;
    },

    /* Okuma iki koşulu birlikte arar: kayıt taze OLACAK ve isteyen SAHİBİ
       olacak. Sahiplik uyuşmazlığı, yok olan bir kayıttan ayırt edilmez —
       çağırana 404 döndürmesi için; "bu kimlik var ama senin değil" demek,
       başkasının çıktısının varlığını sızdırırdı. */
    get(ownerId, id) {
      const owner = String(ownerId == null ? '' : ownerId).trim();
      const key = String(id == null ? '' : id).trim();
      if (!owner || !key) return null;
      const entry = items.get(key);
      if (!entry) return null;
      const at = now();
      if (expired(entry, at)) { items.delete(key); return null; }
      if (entry.ownerId !== owner) return null;
      return entry.model;
    },

    clear() { items.clear(); },
  };
}

module.exports = { createExportStore, DEFAULT_TTL_MS, DEFAULT_MAX_PER_USER, DEFAULT_MAX_TOTAL };
