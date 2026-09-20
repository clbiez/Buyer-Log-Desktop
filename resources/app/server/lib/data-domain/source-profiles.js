'use strict';

/* ===================================================================
   KAYNAK PROFİLLERİ (Data Management P0)

   NEDEN BU DOSYA VAR

   Bugün bir veri kaynağının ne olduğu ve neyi besleyebileceği üç ayrı
   dosyaya GÖMÜLÜ durumda:

     · db.js               → role ∈ {asas, antrepo, intake}   (enum)
     · model-scopes.js     → ROLE_TARGETS                     (hangi sayfalar)
     · model-fields.js     → FIELD_CATALOGUE                  (hangi alanlar)

   Bu yüzden yeni bir veritabanı eklemek üç dosyada kod değişikliği
   gerektiriyor. Profil, o üç bilgiyi TEK bir veri kaydında toplar:
   "bu kaynak ne tür veri taşır, hangi modülleri besleyebilir, alanları
   hangi kataloğa göre eşlenir, sorgusu nasıl kurulur".

   BU DOSYA YENİ BİR DOĞRULUK UYDURMAZ. Her profil bugünkü role'ün
   birebir karşılığıdır ve validate() gerçek kaynaklarla (model-scopes,
   model-fields) karşılaştırarak bunu sınar. Profil listesi gerçekle
   ayrışırsa test kırılır; yani sessizce yanlış cevap üretemez.

   Yeni bir kaynak türü eklemek = buraya bir kayıt eklemek. Kod dalı
   (`if (role === 'NEW_DB')`) yazmak gerekmez.
   =================================================================== */

/* Sorgu motoru: kaynağın hangi teknolojiyle okunduğu.
   Kapalı liste, çünkü her biri ayrı bir çalıştırıcıya karşılık gelir. */
const ENGINES = Object.freeze([
  'tabular-dax',      // SSAS Tabular / Power BI XMLA — server/lib/modelQuery.js
  'tabular-pivot',    // Aynı sunucu, pivot (filters/rows/measures) — intake-report.js
  'relational-sql',    // SQL Server / ODBC / OLE DB — database-connector.js
  'excel-file',       // Kaynak klasördeki çalışma kitabı — parse.js / refreshExcel.js
  'powerbi-dashboard' // Tarayıcı oturumu üzerinden — power-bi-import-dashboard.js
]);

/* Veri şekli: sonucun uygulamaya nasıl döndüğü.
   'rows'  → düz satır kümesi, alan eşlemesi anlamlı
   'pivot' → boyut/ölçü raporu, alan kimliği sourceUniqueName ile taşınır */
const SHAPES = Object.freeze(['rows', 'pivot']);

const PROFILES = Object.freeze([
  {
    id: 'asas-orders',
    legacyRole: 'asas',
    label: { tr: 'Sipariş Verisi', en: 'Order Data' },
    summary: {
      tr: 'Sipariş satırları, fiyat, miktar, tarih ve kumaş bilgisi. CP, Siparişler, Backlog, LFL ve Fiyat Analizi bu kaynaktan beslenir.',
      en: 'Order lines, price, quantity, dates and fabric details. CP, Orders, Backlog, LFL and Price Analysis are fed from this source.',
    },
    engine: 'tabular-dax',
    shape: 'rows',
    // model-fields.js içindeki katalog anahtarı. fieldsForRole(role) bunu okur.
    fieldCatalogue: 'asas',
    // model-scopes.js ROLE_TARGETS.asas ile birebir aynı olmak ZORUNDA (validate).
    feedableModules: ['cp', 'orders', 'backlog', 'lfl', 'priceanalysis'],
    /* ZORUNLU besleme: bu modüller ASAS olmadan hiç çalışamaz — sipariş
       satırının kendisi buradan gelir. Bağlantı kapatılamaz. */
    requiredModules: ['cp', 'orders', 'backlog', 'lfl', 'priceanalysis'],
    capabilities: ['field-mapping', 'filters', 'manual-query', 'extra-columns', 'schema-discovery'],
  },
  {
    id: 'ias-warehouse',
    legacyRole: 'antrepo',
    label: { tr: 'Antrepo Verisi', en: 'Bonded Warehouse Data' },
    summary: {
      tr: 'IAS parsiyel satırları: yükleme, konteyner, gemi, ETA ve antrepo giriş durumu.',
      en: 'IAS partial shipment rows: loading, container, vessel, ETA and bonded warehouse status.',
    },
    engine: 'tabular-dax',
    shape: 'rows',
    fieldCatalogue: 'antrepo',
    feedableModules: ['cp', 'orders', 'backlog'],
    /* ZORUNLU besleme: CP ve Backlog antrepo satırı olmadan eksik veri gösterir.
       SİPARİŞLER LİSTEDE YOKTUR — bilinçli olarak. Siparişler ekranı IAS'siz de
       anlamlıdır: ASAS sipariş satırlarını göstermeye ve yenilemeye devam eder,
       yalnız antrepo/sevkiyat sütunları boş kalır ve bunu bildirir. "orders"
       burada kilitli olsaydı, kullanıcı hiç kullanmadığı bir veriyi her
       yenilemede sorgulamak zorunda kalırdı. */
    requiredModules: ['cp', 'backlog'],
    /* 'extra-columns' BURADA DA VAR. Antrepo sütunları CP Tracker'a
       eklenebiliyor ve bugün kullanılıyor: /api/data cpColumns'ı role
       BAKMADAN topluyor (server.js) ve CP tablosundaki sütun ekleme ekranı
       kaynak listesinde IAS'ı da sunuyor. Bu satır olmadan yeni düzenleyici
       "bu kaynakta CP sütunu kavramı yok" deyip çalışan bir özelliği
       reddediyordu — canlı doğrulamada bir sütunu taşırken yakalandı. */
    capabilities: ['field-mapping', 'filters', 'manual-query', 'extra-columns', 'schema-discovery'],
  },
  {
    id: 'intake-budget',
    legacyRole: 'intake',
    label: { tr: 'Bütçe Raporu', en: 'Budget Report' },
    summary: {
      tr: 'WSSI alım bütçesi pivot raporu. Boyut ve ölçüler rapor tanımından gelir; düz satır tablosu değildir.',
      en: 'WSSI intake budget pivot report. Dimensions and measures come from the report definition; it is not a flat row table.',
    },
    engine: 'tabular-pivot',
    shape: 'pivot',
    fieldCatalogue: 'intake',
    feedableModules: ['intake'],
    // Tek hedefi budur; kapatmak kaynağı işlevsiz bırakırdı (kaldırmak istiyorsa siler).
    requiredModules: ['intake'],
    // Pivot raporunda serbest DAX ve CP sütunu kavramı yoktur.
    capabilities: ['field-mapping', 'filters', 'schema-discovery'],
  },
  {
    id: 'custom-database',
    legacyRole: 'custom',
    label: { tr: 'Özel Database', en: 'Custom Database' },
    summary: {
      tr: "Excel Workbook Connection metadata’sından veya doğrudan database tanımından eklenen bağımsız database bağlantısı.",
      en: 'A standalone database connection added from Excel Workbook Connection metadata or a direct database definition.',
    },
    engine: 'relational-sql',
    shape: 'rows',
    fieldCatalogue: '',
    feedableModules: [],
    requiredModules: [],
    capabilities: ['manual-query'],
    creationMethods: ['excel'],
  },
]);

/* Kullanımdan kaldırılmış ama eski kayıtlarda karşılaşılabilen roller.
   Profil listesine GİRMEZ: hiçbir yenileme akışına katılmazlar. Adapter
   bunları tanır ve 'retired' işaretiyle taşır, silmez (§15). */
const RETIRED_ROLES = Object.freeze(['fabric']);

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function clean(value) { return String(value == null ? '' : value).trim(); }

function list() { return PROFILES.map(clone); }
function ids() { return PROFILES.map(profile => profile.id); }

function get(id) {
  const wanted = clean(id);
  const found = PROFILES.find(profile => profile.id === wanted);
  return found ? clone(found) : null;
}

/** Eski `role` değerinden profil. Adapter'ın ana giriş noktası. */
function fromLegacyRole(role) {
  const wanted = clean(role);
  const found = PROFILES.find(profile => profile.legacyRole === wanted);
  return found ? clone(found) : null;
}

/** Profilden eski `role` değeri. toLegacy yönü için. */
function toLegacyRole(profileId) {
  const profile = get(profileId);
  return profile ? profile.legacyRole : '';
}

function isRetiredRole(role) { return RETIRED_ROLES.includes(clean(role)); }

function label(profileId, language = 'tr') {
  const profile = get(profileId);
  return profile ? (profile.label[language] || profile.label.tr) : '';
}

function hasCapability(profileId, capability) {
  const profile = get(profileId);
  return Boolean(profile && profile.capabilities.includes(clean(capability)));
}

/**
 * Bir profilin belirli bir modülü besleyip besleyemeyeceği.
 * Matris arayüzü boş hücre ile "kapalı toggle"ı bununla ayırır: false dönen
 * hücre kapalı bir anahtar değil, YAPISAL OLARAK İMKÂNSIZ bir hücredir.
 */
function canFeed(profileId, moduleId) {
  const profile = get(profileId);
  return Boolean(profile && profile.feedableModules.includes(clean(moduleId)));
}

/**
 * Bu besleme İŞ KURALI GEREĞİ kapatılamaz mı?
 *
 * Bu bir İŞ kararıdır, depo davranışının ölçümü DEĞİL. Önceki sürüm kilidi
 * normalizeScopes'u simüle ederek ölçüyordu; o yöntem "hangi hedefi eski
 * kayıtlar için geri ekliyoruz" sorusunu cevaplıyordu, "hangi modül bu veri
 * olmadan çalışamaz" sorusunu değil. İkisi aynı değil: normalizasyon IAS →
 * Siparişler bağlantısını geri ekliyordu, oysa Siparişler antrepo verisi
 * olmadan da doğru çalışır.
 *
 * Kural burada, veri olarak durur; koda dağılmaz (§8, §9).
 */
function isModuleRequired(profileId, moduleId) {
  const profile = get(profileId);
  return Boolean(profile && (profile.requiredModules || []).includes(clean(moduleId)));
}

/** Kullanıcının kapatabileceği modüller: besleyebildikleri eksi zorunlular. */
function detachableModules(profileId) {
  const profile = get(profileId);
  if (!profile) return [];
  const required = profile.requiredModules || [];
  return profile.feedableModules.filter(moduleId => !required.includes(moduleId));
}

/** Bir modülü besleyebilen bütün profiller. */
function profilesForModule(moduleId) {
  const wanted = clean(moduleId);
  return list().filter(profile => profile.feedableModules.includes(wanted));
}

/** Herhangi bir profilin besleyebildiği modüllerin birleşimi. */
function feedableModules() {
  const out = [];
  for (const profile of PROFILES) {
    for (const moduleId of profile.feedableModules) if (!out.includes(moduleId)) out.push(moduleId);
  }
  return out;
}

/**
 * Profil listesinin gerçekle uyumunu sınar.
 *
 * Çağıran taraf gerçek kaynakları enjekte eder (model-scopes, model-fields).
 * Bu dosya onları require ETMEZ: böylece profil kaydı testte sahte kaynaklarla
 * da sınanabilir ve bir döngüsel bağımlılık doğmaz.
 *
 *   roleTargets   : model-scopes.ROLE_TARGETS
 *   fieldsForRole : model-fields.fieldsForRole
 *   scopeTargets  : model-scopes.SCOPE_TARGETS
 */
function validate({ roleTargets = null, fieldsForRole = null, scopeTargets = null } = {}) {
  const problems = [];
  const seenIds = new Set();
  const seenRoles = new Set();

  for (const profile of PROFILES) {
    if (seenIds.has(profile.id)) problems.push(`Yinelenen profil kimliği: ${profile.id}`);
    seenIds.add(profile.id);

    if (seenRoles.has(profile.legacyRole)) problems.push(`${profile.id}: "${profile.legacyRole}" rolü başka bir profile de bağlı.`);
    seenRoles.add(profile.legacyRole);

    if (!profile.label || !profile.label.tr || !profile.label.en) problems.push(`${profile.id}: iki dilde etiket gerekli.`);
    if (!profile.summary || !profile.summary.tr || !profile.summary.en) problems.push(`${profile.id}: iki dilde özet gerekli.`);
    if (!ENGINES.includes(profile.engine)) problems.push(`${profile.id}: bilinmeyen sorgu motoru "${profile.engine}".`);
    if (!SHAPES.includes(profile.shape)) problems.push(`${profile.id}: bilinmeyen veri şekli "${profile.shape}".`);

    /* Zorunlu bir modül beslenemiyorsa kural kendi kendini yer: arayüz hem
       "kapatılamaz" der hem de hiç bağlı olmayan bir hücre gösterir. */
    for (const moduleId of profile.requiredModules || []) {
      if (!profile.feedableModules.includes(moduleId)) {
        problems.push(`${profile.id}: "${moduleId}" zorunlu sayılıyor ama bu kaynak onu besleyemiyor.`);
      }
    }

    if (scopeTargets) {
      for (const moduleId of profile.feedableModules) {
        if (!scopeTargets.includes(moduleId)) problems.push(`${profile.id}: "${moduleId}" gerçek bir kapsam hedefi değil.`);
      }
    }

    // Asıl doğrulama: profil, bugünkü rolün beslediği sayfa listesinin AYNISINI
    // taşımalı. Bir fark, arayüzün imkânsız bir hücreyi açık göstermesi (veya
    // gerçek bir bağlantıyı gizlemesi) demektir.
    if (roleTargets) {
      const actual = Array.isArray(roleTargets[profile.legacyRole]) ? roleTargets[profile.legacyRole] : null;
      if (!actual) {
        problems.push(`${profile.id}: "${profile.legacyRole}" rolü model-scopes içinde tanımlı değil.`);
      } else {
        const missing = actual.filter(target => !profile.feedableModules.includes(target));
        const extra = profile.feedableModules.filter(target => !actual.includes(target));
        if (missing.length) problems.push(`${profile.id}: rol şu hedefleri besliyor ama profil saymıyor: ${missing.join(', ')}`);
        if (extra.length) problems.push(`${profile.id}: profil şu hedefleri sayıyor ama rol beslemiyor: ${extra.join(', ')}`);
      }
    }

    // Alan kataloğu gerçekten var mı? Boş katalog, otomatik eşlemenin neye karşı
    // eşleştireceğini bilememesi demektir.
    if (fieldsForRole && profile.capabilities.includes('field-mapping')) {
      let fields = [];
      try { fields = fieldsForRole(profile.fieldCatalogue) || []; } catch (_) { fields = []; }
      if (!Array.isArray(fields) || !fields.length) {
        problems.push(`${profile.id}: "${profile.fieldCatalogue}" alan kataloğu boş veya bulunamadı.`);
      }
    }
  }

  if (roleTargets) {
    for (const role of Object.keys(roleTargets)) {
      if (isRetiredRole(role)) continue;
      if (!PROFILES.some(profile => profile.legacyRole === role)) {
        problems.push(`"${role}" rolünün profili yok — bu kaynak yeni ekranda hiç görünmez.`);
      }
    }
  }

  return { ok: problems.length === 0, problems };
}

module.exports = {
  ENGINES, SHAPES, RETIRED_ROLES,
  list, ids, get, label,
  fromLegacyRole, toLegacyRole, isRetiredRole,
  hasCapability, canFeed, profilesForModule, feedableModules,
  isModuleRequired, detachableModules,
  validate,
};
