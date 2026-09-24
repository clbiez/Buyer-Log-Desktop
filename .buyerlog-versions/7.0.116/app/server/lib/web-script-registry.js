'use strict';

/* ===================================================================
   v6.41 — DÜZENLENEBİLİR YERLEŞİK WEB BETİKLERİ KAYIT DEFTERİ

   Buyer Log'un dış sitelerle konuşan akışları agent-browser-connector içinde
   gömülü duruyor. Dış sitenin yapısı değişince bunları düzeltmek yeni sürüm
   gerektiriyordu; kullanıcı bunları Automations Terminal'den düzenleyebilmek
   istedi.

   TEMEL KURAL: FABRİKA KODUNA DOKUNULMAZ.
   Bağlayıcıdaki (connector) ifade üreticileri olduğu gibi kalır ve override
   yokken birebir eskisi gibi çalışır. Kullanıcının yazdığı sürüm yalnız üst
   katmandır. Böylece bozuk bir düzenleme kalıcı hasar veremez ve "Varsayılana
   dön" her zaman çalışır.

   SÖZLEŞME: kullanıcı kodu, tarayıcıda çalışan bir async fonksiyon GÖVDESİdir.
   `params` nesnesini alır ve bir sonuç nesnesi döndürür. Parametreler metin
   araya sıkıştırmayla değil veri olarak taşınır; kullanıcı tırnak kaçışlarıyla
   uğraşmak zorunda kalmaz.
   =================================================================== */

const store = require('./web-script-store');

// Kullanıcı kodunu tarayıcıda çalıştırılabilir bir ifadeye sarar.
// JSON.stringify çıktısındaki '<' kaçırılır: aksi halde sayfaya enjekte edilen
// metin içinde </script> gibi bir dizi ayrıştırmayı bozabilir.
function wrapUserScript(code, params) {
  const payload = JSON.stringify(params == null ? {} : params).replace(/</g, '\\u003c');
  return `(async function(params){\n${code}\n}).call(window, ${payload})`;
}

/* Her kayıt:
   id          — kalıcı kimlik (kayıtlarda ve arayüzde kullanılır)
   label       — kullanıcıya görünen ad
   description — ne işe yaradığı ve ne zaman düzenlenmesi gerekebileceği
   params      — kullanıcı kodunun elinde bulunan alanlar (arayüzde gösterilir)
   returns     — beklenen sonuç şekli; sözleşmeyi bozan düzenlemeyi önler
   factory     — fabrika ifadesini üreten bağlayıcı fonksiyonunun adı
*/
const SCRIPTS = Object.freeze([
  Object.freeze({
    id: 'corenectum.image.fetch',
    label: 'CoreNectum · Model görseli indirme',
    description: 'PLM Attachment adresinden model görselini indirir ve base64 olarak döndürür. CoreNectum görsel adresini veya kimlik doğrulamasını değiştirirse burası güncellenir.',
    params: Object.freeze(['url']),
    returns: '{ok:true, mimeType, base64} veya {ok:false, code, error}',
    factory: 'coreNectumImageFetchExpression',
  }),
  /* v11.00 — 'corenectum.image.optimize' kaldırıldı. İndirme ve küçültme artık
     TEK ifadede yapılıyor (coreNectumFetchOptimizeExpression), ayrı bir optimize
     turu yok. Girdi burada bırakılsaydı kullanıcıya düzenlenebilir görünen ama
     hiçbir akışa bağlı olmayan bir script kalırdı. Boyut sınırı ayarı
     'corenectum.image.fetch' üzerinden geçmeye devam ediyor. */
  Object.freeze({
    id: 'umbrella.qtx.download',
    label: 'Umbrella · QTX dosyası indirme',
    description: 'Umbrella QTX Library içinde arama yapıp eşleşen tek kaydı bulur. mode="trigger" iken tarayıcı indirmesini başlatır (v6.41); mode="fetch" iken (v6.55) dosyanın gerçek baytlarını yakalayıp base64 olarak döndürür — Buyer Log bunu kalıcı olarak kaydeder. Umbrella arayüzü değişirse burası güncellenir.',
    params: Object.freeze(['colourCode', 'mode']),
    returns: '{ok:true, filename, base64?} veya {ok:false, code, message}',
    factory: 'umbrellaQtxDownloadExpression',
  }),
]);

function byId(id) {
  const key = String(id == null ? '' : id).trim();
  return SCRIPTS.find(item => item.id === key) || null;
}

// Arayüz için: her betiğin kimliği, açıklaması ve o an hangi kaynaktan
// çalıştığı (fabrika mı, kullanıcı sürümü mü).
function publicList() {
  return SCRIPTS.map(item => {
    const override = store.overrideFor(item.id);
    return {
      id: item.id,
      label: item.label,
      description: item.description,
      params: [...item.params],
      returns: item.returns,
      source: override ? 'override' : 'factory',
      updatedAt: override ? override.updatedAt : '',
      updatedBy: override ? override.updatedBy : '',
      revision: override ? override.revision : 0,
      code: override ? override.code : '',
    };
  });
}

/* Çalışma zamanının tek giriş noktası.
   Override yoksa fabrika ifadesi AYNEN döner — yani bu özellik kapalıyken
   davranış hiç değişmez. Override varsa kullanıcı kodu sarmalanıp kullanılır.
   Override bozuksa fabrikaya dönülür ve sebep raporlanır; dış akışın tamamen
   durması, bozuk bir düzenlemeden daha kötü olurdu. */
function expressionFor(id, params, factoryExpression) {
  const entry = byId(id);
  if (!entry) return { expression: factoryExpression, source: 'factory' };
  const override = store.overrideFor(id);
  if (!override) return { expression: factoryExpression, source: 'factory' };
  const check = store.validateCode(override.code);
  if (!check.ok) return { expression: factoryExpression, source: 'factory_fallback', error: check.error };
  return { expression: wrapUserScript(override.code, params), source: 'override' };
}

module.exports = { SCRIPTS, byId, publicList, expressionFor, wrapUserScript };
