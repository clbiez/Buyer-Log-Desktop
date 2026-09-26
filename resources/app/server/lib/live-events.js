'use strict';

/* ===================================================================
   v6.44 — CANLI SENKRONİZASYON (Server-Sent Events)

   Kullanıcı sorusu: "birden fazla sekme/ekip üyesi aynı anda açıkken, biri
   bir hücreyi değiştirdiğinde diğerleri bunu otomatik görebilir mi?"

   Kapsam kararları (kullanıcı onayladı):
     · Ekip çapında (tek kullanıcının sekmeleri değil, tüm bağlı kullanıcılar)
     · Sessizce arka planda otomatik yenileme (onay istenmez)
     · Yalnız hücre/override değişiklikleri (CP, Koleksiyon vb.) — ASAS/IAS
       kaynak yenilemesi (performRefresh) bu kapsamda DEĞİL, o zaten kendi
       zamanlayıcısına ve kilidine sahip.

   TASARIM
   · Tek yönlü (sunucu → istemci). Yazma hâlâ normal REST isteğiyle olur;
     bu modül yalnız değişiklik sinyalini anlık yayınlar. Çift yönlü senkron
     (WebSocket, OT/CRDT) BİLEREK kurulmadı: eşzamanlı düzenleme birleştirme
     kendi başına büyük bir risk sınıfı taşır ve mevcut "revizyon çakışması"
     koruması (RevisionConflictError) zaten çakışan yazmaları sessizce
     ezilmekten koruyor — bu modül onun YERİNE değil, YANINA (fark edilme
     süresini kısaltmak için) eklendi.
   · THROTTLE: aynı alanda kısa sürede birden çok yazma olursa tek bir
     sinyalde birleştirilir.
   · originClientId taşınır: yazan sekme kendi event'ini görmezden gelebilir.

   ===================================================================
   v7.19 — SİNYAL DEĞİL, DEĞİŞİKLİĞİN KENDİSİ TAŞINIR.

   Saha bulgusu (kullanıcı): "bir kullanıcı bir veri girişi yaptığında diğer
   kullanıcıların ekranı anlık kilitleniyor."

   Sebep: olay yalnız "orders alanında bir şey değişti" diyordu. İstemci bunu
   alınca elinde başka bilgi olmadığı için TAM KAYNAK YENİLEMESİ yapıyordu:
   sunucuda ASAS/Antrepo yeniden sorgulanıyor, karşılaştırma koşuyor, snapshot
   ve page cache yeniden kuruluyor; istemcide salt-okunur kilit devreye
   giriyordu. Tek bir not yazımı, açık olan HER oturumda dakikalarca süren bir
   yenileme başlatıyordu. Oysa bir hücre düzenlemesi ASAS'ı ya da Antrepo'yu
   hiç değiştirmez; yalnız ortak override deposunu değiştirir.

   Artık olay değişikliğin kendisini taşır:
     mode:'patch'  → { rowPatches:[{orderCode, patch}] }. İstemci yalnız o
                     satırları yerinde günceller. Kaynak sorgusu yok, kilit
                     yok, kaydırma ve seçim kaybı yok.
     mode:'reload' → yama olarak ifade edilemeyen yapısal değişiklik. İstemci
                     HAFİF yeniden yükleme yapar; tam kaynak yenilemesi ASLA.

   YETKİ (§32): SSE tek bir yayın akışıdır, abonelerin yetkileri farklıdır.
   Alan değerleri (Supp. FOB fiyatı, notlar, tarihler) kapsam dışı bir aboneye
   gitmemelidir. Bu yüzden yama her aboneye AYRI AYRI süzülerek yazılır;
   süzgeci server.js sağlar (setPatchAuthorizer). Süzme sonrası eline hiçbir
   yama kalmayan abone için olay hiç gönderilmez.
   =================================================================== */

// v7.19: 2500 ms'lik bekleme, her olayın karşı ekranda TAM YENİLEME başlattığı
// dönemden kalmaydı — amaç pahalı işi seyreltmekti. Artık olay yalnız satır
// yaması taşıyor ve uygulanması ölçülen 1 ms sürüyor, dolayısıyla bu kadar
// beklemenin bedeli var, faydası yok: kullanıcı "canlı görmek" istiyor.
// Kısa bir pencere, art arda kaydedilen hücreleri hâlâ tek olayda birleştirir.
// v20260926: 800 → 300 ms. İstemci yazmaları zaten 350–500 ms biriktirir; 800 ms
// aynı bilgisayardaki diğer sekmede gecikmeyi gereksiz uzatıyordu. Aynı turdaki
// ardışık yazımlar yine tek olayda birleşir.
const THROTTLE_MS = 300;

const clients = new Set(); // { res, id, req }
const pendingByArea = new Map(); // key -> { timer, originClientId, area, meta, rowPatches, mode }

// server.js, aboneye gitmeden önce yamayı o abonenin veri kapsamına göre süzer.
// Kurulmadıysa güvenli taraf seçilir: alan değerleri hiç yayınlanmaz.
let patchAuthorizer = null;
function setPatchAuthorizer(fn) { patchAuthorizer = typeof fn === 'function' ? fn : null; }

function addClient(res, id, meta) {
  const entry = { res, id: String(id || ''), req: meta && meta.req ? meta.req : null };
  clients.add(entry);
  return entry;
}

function removeClient(entry) {
  clients.delete(entry);
}

function writeEvent(res, payload) {
  try {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  } catch (_) {
    // Bağlantı zaten kopmuşsa yazma sessizce yok sayılır; 'close' olayı
    // temizliği zaten yapacak.
  }
}

// Aynı satırın aynı tur içinde birden çok yaması gelirse SONUNCUSU değil,
// BİRLEŞİMİ geçerlidir: kullanıcı önce notu sonra tarihi kaydettiyse ikisi de
// karşı ekrana ulaşmalı. Anahtar satır kimliğidir (sipariş + model + renk).
function patchIdentityKey(item) {
  const patch = item && item.patch || {};
  const model = String(patch.modelName != null ? patch.modelName : (patch.model != null ? patch.model : '')).trim();
  const ccode = String(patch.ccode != null ? patch.ccode : (patch.colourCode != null ? patch.colourCode : (patch.colorCode != null ? patch.colorCode : ''))).trim();
  return `${String(item && item.orderCode)}${model}${ccode}`;
}
function mergeRowPatches(existing, incoming) {
  const byKey = new Map();
  for (const list of [existing || [], incoming || []]) {
    for (const item of list) {
      if (!item) continue;
      const key = patchIdentityKey(item);
      const previous = byKey.get(key);
      // notes iki ayrı alan taşır (Notes / EkNot); üstteki nesne alttakini
      // tümüyle ezmesin diye ayrıca birleştirilir.
      const notes = { ...(previous && previous.patch && previous.patch.notes || {}), ...(item.patch && item.patch.notes || {}) };
      const patch = { ...(previous && previous.patch || {}), ...(item.patch || {}) };
      if (Object.keys(notes).length) patch.notes = notes;
      byKey.set(key, { orderCode: item.orderCode, patch });
    }
  }
  return [...byKey.values()];
}
/* v7.21 — Koleksiyon satırları farklı kimliklenir (workspace içi satır id'si)
   ve yaması kısmi alan değil, satırın TAMAMIDIR. Bu yüzden birleştirme de
   farklıdır: aynı satırın ikinci yaması birincisinin YERİNE geçer — satırın
   son hâli zaten tek doğrudur. */
function mergeCollectionPatches(existing, incoming) {
  const byKey = new Map();
  for (const list of [existing || [], incoming || []]) {
    for (const item of list) {
      if (!item || !item.key) continue;
      byKey.set(String(item.key), item);
    }
  }
  return [...byKey.values()];
}
function mergeFor(area, existing, incoming) {
  return area === 'collection' ? mergeCollectionPatches(existing, incoming) : mergeRowPatches(existing, incoming);
}

/* Değişiklik bildirir.
   area: 'orders' (CP/Siparişler/Backlog paylaşımlı overrides) veya
         'collection' (bir Koleksiyon workspace'i).
   meta.ownerId    → Koleksiyon için hangi workspace'in değiştiği.
   meta.rowPatches → [{orderCode, patch}]. Verilirse olay yama olarak gider.
                     Verilmezse yapısal değişiklik varsayılır ve hafif yeniden
                     yükleme istenir. */
function notifyChange(area, originClientId, meta) {
  const key = meta && meta.ownerId ? `${area}:${meta.ownerId}` : area;
  const existing = pendingByArea.get(key);
  if (existing) {
    clearTimeout(existing.timer);
  }
  const originId = (existing && existing.originClientId === originClientId) || !existing
    ? originClientId
    : null; // birden fazla farklı kaynak birleştiyse "kendi event'i" varsayımı güvenilmez olur
  const incoming = Array.isArray(meta && meta.rowPatches) ? meta.rowPatches : null;
  // Turda TEK BİR yapısal değişiklik olsa bile bütün tur yeniden yüklemeye
  // düşer: yarım yama uygulamak sessiz veri sapması demektir.
  const mode = (existing && existing.mode === 'reload') || !incoming ? 'reload' : 'patch';
  const rowPatches = mode === 'patch' ? mergeFor(area, existing && existing.rowPatches, incoming) : null;
  const timer = setTimeout(() => flushAreaKey(key), THROTTLE_MS);
  pendingByArea.set(key, { timer, originClientId: originId, area, meta, rowPatches, mode });
}

function flushAreaKey(key) {
  const pending = pendingByArea.get(key);
  pendingByArea.delete(key);
  if (!pending) return;
  const meta = pending.meta;
  const base = {
    area: pending.area,
    ownerId: meta && meta.ownerId ? meta.ownerId : null,
    at: new Date().toISOString(),
    originClientId: pending.originClientId,
  };
  for (const entry of clients) {
    if (pending.mode !== 'patch') { writeEvent(entry.res, { ...base, mode: 'reload' }); continue; }
    // §32: satır değerleri yalnız o veriyi görebilen aboneye gider. Süzgeç
    // alanı da alır: sipariş kapsamı ile Koleksiyon erişimi farklı kurallardır.
    const allowed = patchAuthorizer ? patchAuthorizer(entry, pending.rowPatches, base) : [];
    if (!Array.isArray(allowed) || !allowed.length) continue; // görebileceği bir şey değişmedi
    writeEvent(entry.res, { ...base, mode: 'patch', rowPatches: allowed });
  }
}

function clientCount() {
  return clients.size;
}

// Sync Status uses the same already-authorized SSE connection as the rest of
// the live UI. The caller supplies the access check because this module does
// not own Buyer Log's permission model.
function notifySyncStatus(status, canSee = () => true) {
  const payload = { area: 'sync', mode: 'status', at: new Date().toISOString(), status };
  for (const entry of clients) {
    try { if (canSee(entry)) writeEvent(entry.res, payload); } catch (_) {}
  }
}

module.exports = { addClient, removeClient, notifyChange, notifySyncStatus, clientCount, setPatchAuthorizer, mergeRowPatches, mergeCollectionPatches };
