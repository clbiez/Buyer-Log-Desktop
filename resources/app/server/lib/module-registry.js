'use strict';

/* ===================================================================
   BUYER LOG MODULE REGISTRY (v9.21)

   Ajan için Buyer Log bir "black box" olmaktan çıkmalı: hangi modüller var,
   her biri hangi veriyi taşıyor, ne yapabiliyor, hangi yetki alanına ve hangi
   ekrana bağlı. Bunlar bugüne kadar üç ayrı yerde ÖRTÜK duruyordu —
   userAccess alanları, index.html sekmeleri ve agent-tool-registry'nin dataset
   listesi — ve hiçbiri diğerini bilmiyordu.

   Burası o üçünü BİRLEŞTİREN tanım katmanı. Kendi doğrusunu uydurmaz:
   alan/rota/dataset adları gerçek kaynaklarla eşleşmek zorundadır ve
   validate() bunu sınar. Yeni bir modül eklendiğinde test kırılır; yani
   modül kaydedilmeden ajan onu görmez, ama geliştirici de unutamaz.

   NEDEN AYRI BİR DOSYA: ajanın tool listesini daraltabilmesi için (§22)
   "hangi modül hangi araçları ve datasetleri sunuyor" sorusunun ucuz ve
   deterministik bir cevabı olmalı. Bunu LLM'e ezberletmek yerine veri
   olarak veriyoruz.
   =================================================================== */

const DATASETS = Object.freeze(['cp', 'orders', 'backlog', 'lfl', 'collection', 'asas', 'ias']);

/* Yetenek sözlüğü. Serbest metin DEĞİL: kapalı bir liste, çünkü tool
   keşfi bunlara göre süzecek. Yeni yetenek eklemek bilinçli bir karar olmalı. */
const CAPABILITIES = Object.freeze([
  'read',            // dataset okunabilir
  'filter',          // ekranda filtre uygulanabilir
  'select',          // satır seçilebilir
  'sort',            // sıralanabilir
  'patch-row',       // satır alanı güncellenebilir
  'note',            // not yazılabilir
  'export',          // Excel/CSV dışa aktarım
  'import',          // dosyadan içe aktarım
  'plm-sync',        // PLM'den bilgi/görsel/dosya çekilebilir
  'refresh',         // kaynak veri yenilenebilir
  'compare',         // karşılaştırma üretebilir
  'analyze',         // analiz/metrik üretebilir
  'automate',        // otomasyon tarifi hedefi olabilir
  'view',            // kayıtlı görünüm oluşturulabilir
]);

const MODULES = Object.freeze([
  {
    id: 'overview', agentFilter: false, tableKey: null, label: { tr: 'Genel Bakış', en: 'Overview' },
    area: 'overview', route: 'overview',
    datasets: ['cp', 'orders', 'collection'],
    capabilities: ['read', 'analyze', 'compare', 'view'],
    summary: { tr: 'Özet göstergeler ve koleksiyon özeti.', en: 'Summary indicators and collection overview.' },
  },
  {
    id: 'cp', agentFilter: true, tableKey: 'cp', label: { tr: 'CP Tracker', en: 'CP Tracker' },
    area: 'cp', route: 'cp',
    datasets: ['cp'],
    capabilities: ['read', 'filter', 'select', 'sort', 'patch-row', 'note', 'export', 'plm-sync', 'refresh', 'analyze', 'automate', 'view'],
    summary: { tr: 'Sipariş takibi: not, Supp. FOB, tarih, durum.', en: 'Order tracking; notes, Supp. FOB, dates and status are edited here.' },
  },
  {
    id: 'orders', agentFilter: true, tableKey: 'orders', label: { tr: 'Siparişler', en: 'Orders' },
    area: 'orders', route: 'orders',
    datasets: ['orders'],
    capabilities: ['read', 'filter', 'select', 'sort', 'patch-row', 'note', 'export', 'plm-sync', 'refresh', 'analyze', 'automate', 'view'],
    summary: { tr: 'Sipariş kırılımı ve üretici ataması.', en: 'Order breakdown and manufacturer assignment.' },
  },
  {
    id: 'koleksiyon', agentFilter: false, tableKey: 'kol', label: { tr: 'Koleksiyon', en: 'Collection' },
    area: 'koleksiyon', route: 'koleksiyon',
    datasets: ['collection'],
    capabilities: ['read', 'filter', 'select', 'sort', 'patch-row', 'export', 'import', 'plm-sync', 'compare', 'analyze', 'view'],
    summary: { tr: 'Sezon koleksiyonu: PLM, görsel, fiyat.', en: 'Season collection; PLM data, images and price fields live here.' },
  },
  {
    id: 'quotations', agentFilter: false, tableKey: null, label: { tr: 'Quotations', en: 'Quotations' },
    // Quotations/Pricing History are first-class screens but intentionally share
    // Collection authorization. They do not invent a second permission domain.
    area: 'koleksiyon', route: 'quotations',
    datasets: ['collection'],
    capabilities: ['read', 'filter', 'select', 'sort', 'patch-row', 'export', 'compare', 'analyze'],
    summary: { tr: 'Fiyat talepleri, teklifler, onay/Drop.', en: 'Pricing requests, quotations and approval/drop decisions.' },
  },
  {
    id: 'pricinghistory', agentFilter: false, tableKey: null, label: { tr: 'Fiyat Geçmişi', en: 'Pricing History' },
    area: 'koleksiyon', route: 'pricinghistory',
    datasets: ['collection'],
    capabilities: ['read', 'filter', 'sort', 'export', 'compare', 'analyze'],
    summary: { tr: 'Fiyat geçmişi, benchmark, trend.', en: 'Historical prices, benchmarks and trends from quotations.' },
  },
  {
    id: 'priceanalysis', agentFilter: false, tableKey: null, label: { tr: 'Fiyat & Üretici Analizi', en: 'Price & Supplier Analysis' },
    area: 'priceanalysis', route: 'priceanalysis',
    datasets: ['cp', 'orders', 'collection'],
    capabilities: ['read', 'analyze', 'compare'],
    summary: { tr: 'Fiyat ve üretici karşılaştırmaları.', en: 'Price and supplier comparisons.' },
  },
  {
    // Genel LCW AI çalışma alanı. Kendi yetki alanı yoktur: oturum açmış her
    // kullanıcıya açıktır, kapısı LCW AI kurumsal girişidir. Kayıt defteri
    // gerçek bir alana bağlanmak zorunda olduğu için Overview alanını paylaşır.
    id: 'lcwai', agentFilter: false, tableKey: null, label: { tr: 'LCW AI', en: 'LCW AI' },
    area: 'overview', route: 'lcwai',
    datasets: [],
    capabilities: ['analyze'],
    summary: { tr: 'AI asistanı.', en: 'General AI assistant.' },
  },
  {
    // Like LCW AI, the private office has no new business permission area.
    // Dataset access remains subject to the current owner's source permissions.
    id: 'agentoffice', agentFilter: false, tableKey: null, label: { tr: 'Agent Ofisi', en: 'Agent Office' },
    area: 'overview', route: 'agentoffice', datasets: [],
    capabilities: ['analyze', 'compare', 'export'],
    summary: { tr: 'Kalıcı agent hafızası, koordinasyon ve yetkili operasyon analizi.', en: 'Persistent agent memory, coordination and authorized operational analysis.' },
  },
  {
    // v7.0.229 — eski E-Mail Grupları. Siparişler verisini okuduğu için
    // ayrı bir yetki alanı açmaz; Siparişler alanını paylaşır.
    id: 'manufacturers', agentFilter: false, tableKey: null, label: { tr: 'Üreticiler', en: 'Manufacturers' },
    area: 'orders', route: 'manufacturers',
    datasets: ['orders'],
    capabilities: ['read', 'analyze', 'patch-row', 'import'],
    summary: { tr: 'Üretici kartları.', en: 'Manufacturer cards.' },
  },
  {
    id: 'licensecards', agentFilter: false, tableKey: null, label: { tr: 'Lisans kartları', en: 'License cards' },
    area: 'orders', anyAreas: ['orders', 'cp', 'source'], route: 'licensecards',
    datasets: ['asas', 'cp', 'orders'],
    capabilities: ['read', 'refresh', 'analyze'],
    summary: { tr: 'Lisansör, portal ve royalty sözleşme geçmişi.', en: 'Licensors, portals and royalty contract history.' },
  },
  {
    id: 'lfl', agentFilter: false, tableKey: 'lfl', label: { tr: 'LFL Analizi', en: 'LFL Analysis' },
    area: 'lfl', route: 'lfl',
    datasets: ['lfl'],
    capabilities: ['read', 'filter', 'sort', 'export', 'analyze', 'compare'],
    summary: { tr: 'Like-for-like sezon karşılaştırması.', en: 'Like-for-like season comparison.' },
  },
  {
    id: 'opencosting', agentFilter: false, tableKey: null, label: { tr: 'Ön Maliyet', en: 'Open Costing' },
    area: 'opencosting', route: 'opencosting',
    datasets: ['cp', 'orders'],
    capabilities: ['read', 'filter', 'export', 'analyze'],
    summary: { tr: 'Ön maliyet hesapları.', en: 'Open costing calculations.' },
  },
  {
    id: 'backlog', agentFilter: false, tableKey: 'backlog', label: { tr: 'Backlog', en: 'Backlog' },
    area: 'backlog', route: 'backlog',
    datasets: ['backlog'],
    capabilities: ['read', 'filter', 'sort', 'export', 'analyze', 'automate'],
    summary: { tr: 'Açık sipariş bakiyesi.', en: 'Open order backlog.' },
  },
  {
    id: 'shipping', agentFilter: true, tableKey: 'ship', label: { tr: 'Nakliye Kıyaslama', en: 'Shipping Comparison' },
    area: 'shipping', route: 'shipping',
    datasets: ['cp', 'orders'],
    capabilities: ['read', 'filter', 'select', 'sort', 'patch-row', 'export', 'compare', 'analyze', 'view'],
    summary: { tr: 'Domestic ile gemi/uçak landed maliyet kıyası.', en: 'Domestic landed versus sea/sea+air/air landed cost comparison.' },
  },
  {
    id: 'automations', agentFilter: false, tableKey: null, label: { tr: 'Otomasyonlar', en: 'Automations' },
    area: 'automations', route: 'automations',
    datasets: [],
    capabilities: ['read', 'automate'],
    summary: { tr: 'Zamanlanmış/koşullu otomasyonlar.', en: 'Scheduled and conditional automation recipes.' },
  },
  /* v7.81 — Kaynak Veri artık gerçek bir ekran: Veri Yönetimi.
     Önceden route=null idi, çünkü kaynak ayarları bir çekmece ve bir modalın
     içinde yaşıyordu. Yetki alanı adı ('source') DEĞİŞMEDİ: o bir izin
     anahtarıdır ve sunucuda ~40 yerde kullanılır. Değişen yalnız kullanıcıya
     görünen etiket ve artık gidilebilir bir ekranın olması. */
  {
    id: 'source', agentFilter: false, tableKey: null, label: { tr: 'Veri Yönetimi', en: 'Data Management' },
    area: 'source', route: 'source',
    datasets: ['asas', 'ias'],
    capabilities: ['read', 'refresh', 'import', 'analyze'],
    summary: { tr: 'Veritabanı, bağlantı, filtre ve yenileme.', en: 'Databases, module connections, filters and refresh in one screen.' },
  },
  /* Ekranı olmayan ama ajanın bilmesi gereken kaynaklar. route=null olması
     "bu modüle gidilemez" demektir; UI komut katmanı buna bakar. */
  {
    id: 'agents', agentFilter: false, tableKey: null, label: { tr: 'Agent Workflow Studio', en: 'Agent Workflow Studio' },
    area: 'agents', route: null,
    datasets: [],
    capabilities: ['read', 'automate'],
    summary: { tr: 'Ajan iş akışları ve tarayıcı otomasyonu.', en: 'Agent workflows and browser automation.' },
  },
]);

function clean(value) { return String(value == null ? '' : value).trim(); }
function clone(value) { return JSON.parse(JSON.stringify(value)); }

function list() { return MODULES.map(clone); }
function ids() { return MODULES.map(module => module.id); }
function get(id) {
  const wanted = clean(id).toLowerCase();
  const found = MODULES.find(module => module.id === wanted);
  return found ? clone(found) : null;
}
function label(id, language = 'tr') {
  const module = get(id);
  return module ? (module.label[language] || module.label.tr) : '';
}
/* Kullanıcının GERÇEKTEN erişebildiği modüller. Ajan yetkisi olmayan bir
   modülü keşfetmemeli: aksi hâlde "yapabilirim" deyip 403 alır. */
function forProfile(profile, userAccess) {
  if (!userAccess || typeof userAccess.hasArea !== 'function') return list();
  return list().filter(module => (module.anyAreas || [module.area]).some(area => userAccess.hasArea(profile, area)));
}
function withCapability(capability) {
  const wanted = clean(capability);
  return list().filter(module => module.capabilities.includes(wanted));
}
function withDataset(dataset) {
  const wanted = clean(dataset).toLowerCase();
  return list().filter(module => module.datasets.includes(wanted));
}
/* Ajana verilecek özet. Tam kaydı değil, karar için gerekeni döndürür —
   token bütçesi burada başlar (§31). */
function describe(id, language = 'tr') {
  const module = get(id);
  if (!module) return null;
  return {
    id: module.id,
    label: module.label[language] || module.label.tr,
    summary: module.summary[language] || module.summary.tr,
    datasets: module.datasets,
    capabilities: module.capabilities,
    route: module.route,
    // İstemci tablosunun anahtarı: filtre/seçim komutları buna yazar.
    tableKey: module.tableKey,
    /* Ajan bu ekranı ui.filter ile filtreleyebilir mi? capabilities'teki
       'filter' KULLANICI için doğrudur; bu alan AJANIN yolu için. */
    agentFilter: module.agentFilter === true,
    navigable: module.route != null,
  };
}
function catalog(language = 'tr', profile = null, userAccess = null) {
  const visible = profile && userAccess ? forProfile(profile, userAccess) : list();
  // The catalog is a table of contents; detailed summaries stay in describe().
  return visible.map(module => {
    const { summary, ...entry } = describe(module.id, language);
    return entry;
  });
}

/* Kayıt defteri gerçekle ayrışırsa sessizce yanlış cevap üretir. Bu yüzden
   doğrulama bir TEST yardımcısı değil, modülün kendi sözleşmesidir:
   çağıran taraf (server açılışı ya da test) gerçek alan/rota/dataset
   listelerini verir, burada karşılaştırılır. */
function validate({ areas = null, routes = null, datasets = DATASETS } = {}) {
  const problems = [];
  const seen = new Set();
  for (const module of MODULES) {
    if (seen.has(module.id)) problems.push(`Yinelenen modül kimliği: ${module.id}`);
    seen.add(module.id);
    if (!module.label || !module.label.tr || !module.label.en) problems.push(`${module.id}: iki dilde etiket gerekli.`);
    if (!module.summary || !module.summary.tr || !module.summary.en) problems.push(`${module.id}: iki dilde özet gerekli.`);
    for (const capability of module.capabilities) {
      if (!CAPABILITIES.includes(capability)) problems.push(`${module.id}: bilinmeyen yetenek "${capability}".`);
    }
    for (const dataset of module.datasets) {
      if (!datasets.includes(dataset)) problems.push(`${module.id}: bilinmeyen dataset "${dataset}".`);
    }
    if (module.tableKey != null && typeof module.tableKey !== 'string') problems.push(`${module.id}: tableKey ya bir dize ya null olmalı.`);
    if (module.agentFilter && !module.tableKey) problems.push(`${module.id}: ajan filtresi için tableKey zorunlu.`);
    if (module.agentFilter && !module.capabilities.includes('filter')) problems.push(`${module.id}: ajan filtreleyemez çünkü modül zaten filtrelenebilir değil.`);
    if (areas && !areas.includes(module.area)) problems.push(`${module.id}: "${module.area}" gerçek bir yetki alanı değil.`);
    if (routes && module.route != null && !routes.includes(module.route)) problems.push(`${module.id}: "${module.route}" gerçek bir ekran değil.`);
  }
  if (areas) {
    for (const area of areas) {
      if (!MODULES.some(module => module.area === area)) problems.push(`"${area}" yetki alanı hiçbir modüle bağlı değil — ajan o alanı keşfedemez.`);
    }
  }
  if (routes) {
    for (const route of routes) {
      if (!MODULES.some(module => module.route === route)) problems.push(`"${route}" ekranı kayıt defterinde yok — ajan oraya gidemez.`);
    }
  }
  return { ok: problems.length === 0, problems };
}

module.exports = {
  DATASETS, CAPABILITIES,
  list, ids, get, label, describe, catalog,
  forProfile, withCapability, withDataset, validate,
};
