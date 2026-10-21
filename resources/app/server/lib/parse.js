// Bu dosya, LCW-Order-Control.html içindeki parse mantığının birebir
// (fonksiyon isimleri ve davranışları korunarak) Node.js tarafına taşınmış halidir.
// Amaç: Excel dosyalarını tarayıcıya yüklemek yerine doğrudan ağ sürücüsünden okumak.

const BLDateDimension = require('../../public/date-dimension');

let _xlsx = null;
// Saat dilimi kaymasına karşı okuma/yazma kancaları ilk kullanımda kurulur.
// Kanca idempotenttir; hangi modül önce çağırırsa orada bir kez takılır.
function getXLSX() { if (!_xlsx) { _xlsx = require('xlsx'); try { require('../../public/excel-date-utils').installSheetJsHooks(_xlsx); } catch (_) {} } return _xlsx; }
const BLBusinessRules = require('../../public/business-rules');
const BLCanonicalFields = require('./canonical-fields');
const BLCpReadinessEngine = require('../../public/cp-readiness-engine');

const LICMAP = {};
['FC Barcelona', 'Marvel', 'Sonic The Hedgehog', 'Warner Bros', 'Lucas', 'Disney', 'Hotwheels', 'Paris Saint Germain'].forEach(l => LICMAP[l] = 'DTR');
['Minecraft', 'Brawl Stars', 'Formula 1', 'X Box'].forEach(l => LICMAP[l] = 'FASHION UK');
['Real Madrid', 'Manchester City', 'Stumble Guys', 'Fortnite', 'Garfield', 'Grinch', 'Naruto', 'Nickelodeon', 'Smiley', 'Universal', 'Sponge Bob', 'Avatar The Last Airbender'].forEach(l => LICMAP[l] = 'ERMODA');
['Playstation', 'Netflix'].forEach(l => LICMAP[l] = 'FAN MANIA');
['Liverpool', 'Dragon Ball', 'One Piece', 'Shelby'].forEach(l => LICMAP[l] = 'ULUPINAR');

const COUNTRY_MAP = { 'HINDISTAN': 'India', 'BANGLADES': 'Bangladesh', 'CIN': 'China', 'TURKIYE': 'Turkey', 'MISIR': 'Egypt', 'FAS': 'Morocco', 'MYANMAR': 'Myanmar', 'ENDONEZYA': 'Indonesia' };

function norm(s) { return String(s == null ? '' : s).trim(); }
// Saf fonksiyon; ASAS/Antrepo eşleştirmesinde aynı kısa değerler (üretici,
// statü, ülke…) satır başına onlarca kez normalleştiriliyordu. Kısa metinler
// sınırlı bir bellekte tutulur; sonuç birebir aynıdır.
const TURKNORM_CACHE = new Map();
const TURKNORM_PAIRS = [['İ', 'I'], ['I', 'I'], ['Ş', 'S'], ['Ç', 'C'], ['Ö', 'O'], ['Ü', 'U'], ['Ğ', 'G']];
function turknorm(s) {
  const raw = String(s == null ? '' : s);
  const cacheable = raw.length <= 160;
  if (cacheable) { const hit = TURKNORM_CACHE.get(raw); if (hit !== undefined) return hit; }
  let x = raw.toUpperCase();
  TURKNORM_PAIRS.forEach(([a, b]) => { x = x.split(a).join(b); });
  x = x.replace(/\s+/g, ' ').trim();
  if (cacheable) { if (TURKNORM_CACHE.size >= 50000) TURKNORM_CACHE.clear(); TURKNORM_CACHE.set(raw, x); }
  return x;
}

// ASAS ↔ IAS EŞLEŞTİRME ANAHTARI.
//
// Bu anahtar kullanıcı düzenlemelerinin saklandığı orderLineKey'den bilerek
// ayrıdır. Üretim eşleşmesinde üç alan birlikte zorunludur. Model/Ürün Adı ve
// Renk Kod yalnız NFC + dış boşluk temizliğiyle birebir karşılaştırılır.
//
// Sipariş Kod ise Excel / DAX katmanında sayı, "1234567" veya "1234567.00"
// biçiminde dönebildiği için yalnız tamamen sayısal gösterimlerde aynı iş koduna
// çevrilir. A-001 gibi alfasayısal kodlar A001 ile eşit sayılmaz. Üç alanın
// tamamı aynı değilse IAS kaydı kesinlikle bağlanmaz.
function exactMatchValue(value) {
  return String(value == null ? '' : value).normalize('NFC').trim();
}
function exactOrderCodeKey(value) { return exactMatchValue(value); }
function exactModelKey(value) { return exactMatchValue(value); }
function exactCcodeKey(value) { return exactMatchValue(value); }
function antrepoMatchKey(ocode, model, ccode) {
  return JSON.stringify([
    exactOrderCodeKey(ocode),
    exactModelKey(model),
    exactCcodeKey(ccode),
  ]);
}

// Eski kademeli yardımcılar yalnız geriye dönük test/teşhis kodu içindir. Uygulama
// veri üretirken bunları kullanmaz; üretim akışı her zaman antrepoMatchKey ile katı
// üçlü eşleşme yapar.
function matchModelKey(value) {
  return turknorm(value);
}
function matchCcodeKey(value) {
  const text = String(value == null ? '' : value).trim();
  if (!text) return '';
  if (/^\d+([.,]\d+)?$/.test(text)) {
    const digits = text.split(/[.,]/)[0].replace(/^0+(?=\d)/, '');
    if (digits) return digits;
  }
  return turknorm(text);
}

// Sipariş kodu iki AYRI modelden geliyor (ASAS_30 ve IASv2) ve aynı sipariş
// farklı biçimlerde dönebiliyor: sayı, "1234567", "1234567.00", "1.234.569",
// "0001234570", " 1234567 ". Model sonucu CSV olarak okunduğu için her hücre
// metindir; Number() bu biçimlerin bir kısmında NaN üretiyordu. NaN anahtarlar
// hem Antrepo satırlarını kaybediyor hem de aynı renkteki farklı siparişleri
// "NaN|RENK" altında birbirine karıştırıyordu. Sonuç: CP'de yanlış "Üretimde".
// Bu yüzden sipariş kodu her iki tarafta da TEK bir kurala göre normalize edilir.
function orderCodeKey(value) {
  if (value == null) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? String(Math.trunc(Math.abs(value))) : '';
  const text = String(value).trim();
  if (!text) return '';
  // Bilimsel gösterim (1.23457E+06) doğrudan sayıya çevrilir.
  if (/^[+-]?\d+([.,]\d+)?[eE][+-]?\d+$/.test(text)) {
    const n = Number(text.replace(',', '.'));
    return Number.isFinite(n) ? String(Math.trunc(Math.abs(n))) : '';
  }
  const cleaned = text.replace(/[^\d.,]/g, '');
  if (cleaned) {
    const sepPos = Math.max(cleaned.lastIndexOf('.'), cleaned.lastIndexOf(','));
    let intPart = cleaned;
    if (sepPos >= 0) {
      const decimals = cleaned.slice(sepPos + 1);
      // Ayraçtan sonrası tam 3 hane VE bütün dizi binlik desenine uyuyorsa
      // ("1.234.569", "1,234,569") bu bir binlik ayracıdır, ondalık değil.
      const isThousandSep = /^\d{3}$/.test(decimals) && /^\d{1,3}([.,]\d{3})+$/.test(cleaned);
      intPart = isThousandSep ? cleaned : cleaned.slice(0, sepPos);
    }
    const digits = intPart.replace(/\D/g, '').replace(/^0+(?=\d)/, '');
    if (digits) return digits;
  }
  // Hiç rakam içermeyen (gerçekten alfasayısal) kodlar olduğu gibi normalize edilir.
  return turknorm(text);
}
// Sipariş kodunun sayısal karşılığı. ocode alanının TİPİ değişmez (her yerde sayı
// olarak kullanılıyor: overrides sözlükleri, onaylar, DB); yalnız NaN üreten
// biçimler artık doğru sayıya çevrilir.
function toOrderCodeNumber(value) {
  const key = orderCodeKey(value);
  if (/^\d+$/.test(key)) return Number(key);
  return Math.trunc(Number(value));
}

// SİPARİŞ SATIRI KİMLİĞİ: Sipariş Kodu + Model Adı + Renk Kodu.
//
// Bir sipariş kodunun altında AYNI renk koduna sahip birden fazla model olabiliyor.
// Yalnız kod+renk ile eşleştirmek, o durumda yanlış satırın Antrepo/kumaş bilgisini
// getiriyordu. Programdaki bütün sipariş eşlemeleri artık bu üçlü anahtarı kullanır.
//
// Bu anahtar yalnız kullanıcı düzenlemeleri ve eski kayıt uyumluluğu içindir;
// ASAS ↔ IAS üretim eşleştirmesinde kullanılmaz. Üretim eşleşmesi antrepoMatchKey
// ile kayıpsız ve yalnız tam üçlü kimlik üzerinden yapılır.
function orderLineKey(ocode, model, ccode) {
  return `${orderCodeKey(ocode)}|${turknorm(model)}|${turknorm(ccode)}`;
}
// ASAS sipariş nesnesinden (parseASASRows çıktısı).
function orderLineKeyOf(order) {
  if (!order) return '';
  return orderLineKey(order.ocode, order.model, order.ccode);
}
// CP satırından (buildCPRowsFromASAS çıktısı) — sütun adları farklı.
function rowLineKey(row) {
  if (!row) return '';
  return orderLineKey(row['Order Code'], row['Model Name'], row['C.Code']);
}

// CP görselleri PLM ID + Colour Code kimliğine bağlıdır.
// Sayısal PLM değerlerinde Excel/JSON kaynaklı 123, 123.0 ve 000123
// gösterimleri aynı model kimliği kabul edilir; alfanümerik değerlerde ise
// Türkçe büyük/küçük harf ve boşluk farkları normalize edilir.
function normalizePlmImageId(value) {
  let text = norm(value);
  if (!text) return '';
  if (/^\d+(?:\.0+)?$/.test(text)) {
    text = text.replace(/\.0+$/, '').replace(/^0+(?=\d)/, '');
  }
  return turknorm(text);
}
function normalizeCpImageColourCode(value) {
  const text = norm(value);
  return text ? turknorm(text) : '';
}
// v4.61-v4.62 PLM-only key: read-only migration compatibility.
function plmImageKey(value) {
  const id = normalizePlmImageId(value);
  return id ? `plm:${id}` : '';
}
function plmColourImageKey(plmId, colourCode) {
  const id = normalizePlmImageId(plmId);
  const colour = normalizeCpImageColourCode(colourCode);
  return id && colour ? `plm:${id}|colour:${colour}` : '';
}
function plmColourImageNameKey(plmId, colourCode, colourName) {
  const base = plmColourImageKey(plmId, colourCode);
  const name = normalizeCpImageColourCode(colourName);
  return base && name ? `${base}|name:${name}` : base;
}
/* v6.38 — PLM GÖRSELİ "VAR MI" SORUSUNUN TEK DOĞRU CEVABI.
   Görsel silindiğinde renk düzeyindeki anahtara BOŞ değer (mezar taşı) yazılır;
   kayıt tamamen silinmez, çünkü boş değer "kullanıcı bunu kaldırdı" demektir ve
   eski PLM-only anahtara geri düşmeyi engeller.
   Hata buradaydı: PLM senkronu ve istemcideki "eksikleri tamamla" listesi
   YALNIZ eski PLM-only anahtara bakıyordu. Mezar taşı renk anahtarında durduğu
   için model ya hiç "eksik" sayılmıyor, ya da çekilen görsel eski anahtara
   yazılıp mezar taşı tarafından gölgeleniyordu — görsel indiriliyor, diske
   yazılıyor ama ekranda asla görünmüyordu.
   KULLANICI KARARI (v6.38): silinen görsel EKSİK sayılır ve yeniden yüklenir.
   Bu yüzden mezar taşı artık "var" değil "eksik" anlamına gelir. */
function plmImageKeysFor(map, plmId) {
  const id = normalizePlmImageId(plmId);
  if (!id || !map) return [];
  const legacy = `plm:${id}`;
  const colourPrefix = `${legacy}|colour:`;
  return Object.keys(map).filter(key => key === legacy || key.indexOf(colourPrefix) === 0);
}
// Bu PLM için kullanıcının açıkça sildiği (mezar taşı) bir kayıt var mı?
function plmImageDeleted(map, plmId) {
  return plmImageKeysFor(map, plmId).some(key => String(map[key] == null ? '' : map[key]).trim() === '');
}
// Görsel gerçekten KULLANILABİLİR durumda mı? Silinmişse hayır — yeniden
// yüklenmesi gerekir.
function plmImageUsable(map, plmId) {
  const keys = plmImageKeysFor(map, plmId);
  if (!keys.length) return false;
  if (plmImageDeleted(map, plmId)) return false;
  return keys.some(key => String(map[key] == null ? '' : map[key]).trim() !== '');
}
function plmImageRef(map, order) {
  if (!map || !order) return undefined;
  const namedKey = plmColourImageNameKey(order.plm, order.ccode, order.colour || order.color);
  if (namedKey && Object.prototype.hasOwnProperty.call(map, namedKey)) return map[namedKey];
  const key = plmColourImageKey(order.plm, order.ccode);
  // Yeni PLM+Colour Code anahtarı boş string taşıyabilir. Bu, eski PLM-only
  // veya sipariş-satırı bağlantısına geri düşmeden görselin açıkça
  // kaldırıldığını belirtir.
  if (key && Object.prototype.hasOwnProperty.call(map, key)) return map[key];
  /* PLM ingest renk adını biliyorsa name-specific key yazar. CP/Orders veya
     bazı alt detay projeksiyonları ise yalnız PLM ID + Renk Kodu taşır.
     Kod anahtarı yoksa aynı kod altındaki named kayıtlar TEK bir ref'e
     çözülüyorsa onu kullan. Farklı ref'ler varsa seçim yapma; yanlış renge
     görsel bağlamak sessiz bir veri hatası olur. Named tombstone varsa legacy
     PLM-only kaydına geri düşme. */
  if (key) {
    const prefix = `${key}|name:`;
    const namedKeys = Object.keys(map).filter(candidate => candidate.indexOf(prefix) === 0);
    if (namedKeys.length) {
      const refs = [...new Set(namedKeys.map(candidate => String(map[candidate] == null ? '' : map[candidate]).trim()))];
      return refs.length === 1 ? refs[0] : undefined;
    }
  }
  // v4.61-v4.62 arasında PLM ID ile kaydedilmiş görseller kaybolmasın.
  const legacyPlmKey = plmImageKey(order.plm);
  if (legacyPlmKey && Object.prototype.hasOwnProperty.call(map, legacyPlmKey)) return map[legacyPlmKey];
  // v4.57-v4.60 arasında kaydedilmiş sipariş+model+renk bağlantıları da
  // yalnız geçiş uyumluluğu için okunur.
  return overrideGet(map, order);
}

// KULLANICI DÜZENLEMELERİNİN ANAHTARI.
//
// Notlar, alt üretici, Supp. FOB, teslim tipi, lisansör ve tarih
// revizyonları eskiden yalnız sipariş koduyla saklanıyordu; bir siparişin altındaki
// bütün model/renk satırları aynı değeri paylaşıyordu. Supp. FOB ve FOB model ve
// modelin rengine göre değiştiği için bu yanlıştı.
//
// Artık yazma her zaman ÜÇLÜ anahtara (sipariş + model + renk kodu) yapılır.
// Okuma önce üçlü anahtarı, bulamazsa ESKİ sipariş kodu anahtarını dener; böylece
// bugüne kadar kaydedilmiş hiçbir veri (özellikle alt üretici bilgisi) kaybolmaz.
// Bir satır ilk kez düzenlendiğinde kendi üçlü anahtarını kazanır.
function overrideKeyOf(order) {
  return orderLineKeyOf(order);
}
// Sözlükte satıra ait değer var mı? (üçlü → eski sipariş kodu sırasıyla)
function overrideHas(map, order) {
  if (!map || !order) return false;
  const lineKey = overrideKeyOf(order);
  if (lineKey && Object.prototype.hasOwnProperty.call(map, lineKey)) return true;
  return Object.prototype.hasOwnProperty.call(map, order.ocode);
}
// Sözlükten satıra ait değer. Üçlü anahtar varsa o kazanır.
function overrideGet(map, order) {
  if (!map || !order) return undefined;
  const lineKey = overrideKeyOf(order);
  if (lineKey && Object.prototype.hasOwnProperty.call(map, lineKey)) return map[lineKey];
  return map[order.ocode];
}

// ASAS - Fabric eski gevşek alan çözümlemesinde çelişki koruması (v4.32).
// Bu yardımcı IAS/Backlog üretim eşleştirmesinde kullanılmaz; IAS tarafı v4.37'de
// yalnız antrepoMatchKey üzerinden tam üçlü eşleşmeye geçirilmiştir.
function antrepoEntryConflicts(entry, target) {
  if (!entry) return true;
  const entryModel = matchModelKey(entry.model), targetModel = matchModelKey(target && target.model);
  if (entryModel && targetModel && entryModel !== targetModel) return true;
  const entryCcode = matchCcodeKey(entry.ccode), targetCcode = matchCcodeKey(target && target.ccode);
  if (entryCcode && targetCcode && entryCcode !== targetCcode) return true;
  return false;
}

function antrepoStatusKey(value) {
  const key = turknorm(value);
  if (!key) return '';
  if (key.includes('YUKLEME')) return 'YUKLEME OPERASYONLARI';
  if (key.includes('YOL') && key.includes('OPERASYON')) return 'YOL OPERASYONLARI';
  if ((key.includes('GUMRUK') || key.includes('LIMAN')) && key.includes('OPERASYON')) return 'GUMRUK LIMAN OPERASYONLARI';
  if (key.includes('RETAIL') && (key.includes('AKTAR') || key.includes('BEKLE'))) return 'RETAILE AKTARIM BEKLENIYOR';
  if (key.includes('DEPO')) return 'DEPODA';
  if (key.includes('URETIM')) return 'URETIMDE';
  return key;
}

// CP/Genel Bakış aynı siparişe ait tek bir IAS satırı göstermek zorunda olduğu için
// en güncel satırı seçer. Backlog bu seçimi KULLANMAZ; bütün parsiyelleri ayrı satır
// olarak işler. En güncel satır belirlenirken önce Tahmini Antrepo Giriş Tarihi,
// tarihler eşitse IAS kaynağındaki satır sırası dikkate alınır. Hiçbir alan başka
// bir IAS satırından tamamlanmaz.
function mergeAntrepoEntries(current, incoming) {
  if (!current) return incoming;
  if (!incoming) return current;
  const currentOrd = Number.isFinite(Number(current._ord)) ? Number(current._ord) : -1;
  const incomingOrd = Number.isFinite(Number(incoming._ord)) ? Number(incoming._ord) : -1;
  if (incomingOrd !== currentOrd) return incomingOrd > currentOrd ? incoming : current;
  const currentRow = Number.isFinite(Number(current._sourceRow)) ? Number(current._sourceRow) : -1;
  const incomingRow = Number.isFinite(Number(incoming._sourceRow)) ? Number(incoming._sourceRow) : -1;
  return incomingRow >= currentRow ? incoming : current;
}

const ANTREPO_LOOKUP_CACHE = new WeakMap();
function buildAntrepoLookup(antrepoMap, ruleValue) {
  if (!antrepoMap || typeof antrepoMap !== 'object') return { byLine: new Map() };
  const signature = antrepoMatchConfigSignature(ruleValue);
  let cache = ANTREPO_LOOKUP_CACHE.get(antrepoMap);
  if (!cache) { cache = new Map(); ANTREPO_LOOKUP_CACHE.set(antrepoMap, cache); }
  if (cache.has(signature)) return cache.get(signature);
  const config = normalizeAntrepoMatchConfig(ruleValue);
  const byLine = new Map();
  for (const value of Object.values(antrepoMap)) {
    if (!value || typeof value !== 'object') continue;
    const key = dynamicAntrepoMatchKey(value, 'ias', config);
    if (!key) continue;
    if (!byLine.has(key)) byLine.set(key, []);
    byLine.get(key).push(value);
  }
  const lookup = { byLine, config };
  cache.set(signature, lookup);
  return lookup;
}


// VERİ EŞLEŞTİRME KURALLARI (v7.82 — kaynak güdümlü, N veritabanı).
//
// Kural artık "ASAS ile IAS" diye iki sabit tarafa yazılmaz. Bir koşul, her biri
// BİR KAYNAĞA bağlı 2+ OPERANDDAN oluşur; bütün koşullar AND ile bağlıdır ve
// değerler birebir karşılaştırılır. Üçüncü bir veritabanı eklemek yeni bir kod
// dalı değil, yeni bir kaynak kaydı demektir.
//
// Çalışma anındaki birleştirme hâlâ İKİ VERİ KÜMESİNİ birleştirir (sipariş
// satırları ↔ antrepo satırları); fakat hangi koşulun bu ikiliyi kısıtladığı
// operandların ROLÜNDEN okunur, `condition.asas`/`condition.ias` gibi sabit
// alan adlarından değil. Başka bir ikili yüklendiğinde aynı mekanizma çalışır.
const ANTREPO_MATCH_RULES = ['order+model+ccode']; // eski API/test uyumluluğu
const DEFAULT_ANTREPO_MATCH_RULE = 'order+model+ccode';
const ANTREPO_MATCH_RULE_LABELS = {
  'order+model+ccode': 'Sipariş Kod + Model Adı + Renk Kod',
  custom: 'Manuel veri eşleştirme koşulları',
};

/* Rol, bir kaynağın hangi veri kümesini taşıdığıdır. Eşleştirme motoru
   operandları rol üzerinden bulur; 'ias' eski çağrı yerlerinde 'antrepo'nun
   takma adıdır. */
const MATCH_ROLE_ALIASES = Object.freeze({ ias: 'antrepo', antrepo: 'antrepo', asas: 'asas', intake: 'intake' });
/* Rol başına mantıksal varsayılan kaynak kimliği. Eski (v1) kayıtlarda kaynak
   kimliği hiç yazılmıyordu; taşırken bunlar kullanılır ve sunucudaki kaynak
   kataloğu bu kimlikleri gerçek bağlantıların takma adı olarak tanır. */
const DEFAULT_MATCH_SOURCE_IDS = Object.freeze({ asas: 'asas', antrepo: 'ias' });
function matchRoleKey(value) {
  const raw = String(value == null ? '' : value).trim().toLowerCase();
  return MATCH_ROLE_ALIASES[raw] || raw;
}
function defaultMatchSourceId(role) {
  return DEFAULT_MATCH_SOURCE_IDS[matchRoleKey(role)] || matchRoleKey(role) || '';
}

const DEFAULT_ANTREPO_MATCH_CONDITIONS = Object.freeze([
  Object.freeze({ id: 'ocode', asas: Object.freeze({ header: 'Sipariş Kod' }), ias: Object.freeze({ header: 'Sipariş Kod' }) }),
  Object.freeze({ id: 'model', asas: Object.freeze({ header: 'Model Adı' }), ias: Object.freeze({ header: 'Ürün Ad' }) }),
  Object.freeze({ id: 'ccode', asas: Object.freeze({ header: 'Renk Kod' }), ias: Object.freeze({ header: 'Renk Kod' }) }),
]);

function matchConditionId(value, index) {
  const raw = String(value == null ? '' : value).trim().replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  return raw || `condition-${index + 1}`;
}
function emptyMatchSide() {
  return { sourceId: '', role: '', header: '', canonicalHeader: '', table: '', name: '', kind: 'column', unresolved: '' };
}
function normalizeMatchOperand(value, fallback = {}) {
  const raw = value && typeof value === 'object' ? value : {};
  const header = norm(raw.header || raw.canonicalHeader || fallback.header || '');
  const role = matchRoleKey(raw.role || fallback.role || '');
  return {
    sourceId: norm(raw.sourceId || raw.source || fallback.sourceId || '') || defaultMatchSourceId(role),
    role,
    header,
    canonicalHeader: norm(raw.canonicalHeader || header),
    table: norm(raw.table),
    name: norm(raw.name),
    kind: 'column',
    // Yapılandırılmış sütun kaybolduysa sunucu bunu işaretler. Motor bu durumda
    // sessizce başka bir alana KAYMAZ; eşleşme kurulmaz ve kullanıcı düzeltir.
    unresolved: norm(raw.unresolved),
  };
}
function hasMatchColumn(operand) {
  return Boolean(operand && (operand.header || operand.name));
}
/** Bir koşulun verilen role bağlı operandı. Eski `.asas`/`.ias` gövdelerini de tanır. */
function matchOperandForRole(condition, role) {
  if (!condition) return null;
  const wanted = matchRoleKey(role);
  const operands = Array.isArray(condition.operands) ? condition.operands : [];
  const hit = operands.find(operand => matchRoleKey(operand && operand.role) === wanted && hasMatchColumn(operand));
  if (hit) return hit;
  const legacy = wanted === 'antrepo' ? condition.ias : (wanted === 'asas' ? condition.asas : null);
  return hasMatchColumn(legacy) ? normalizeMatchOperand(legacy, { role: wanted }) : null;
}
/** Belirli bir kaynağın operandı; yoksa aynı roldeki operanda düşer. */
function matchOperandForSource(condition, sourceId, role = '') {
  const operands = Array.isArray(condition && condition.operands) ? condition.operands : [];
  const wantedId = norm(sourceId);
  const exact = wantedId && operands.find(operand => norm(operand && operand.sourceId) === wantedId && hasMatchColumn(operand));
  return exact || matchOperandForRole(condition, role);
}
/** İki veri kümesini gerçekten kısıtlayan koşullar. Diğerleri başka bir ikiliye aittir. */
function matchConditionsForPair(config, leftRole = 'asas', rightRole = 'antrepo') {
  const conditions = Array.isArray(config && config.conditions) ? config.conditions : [];
  return conditions.filter(condition =>
    matchOperandForRole(condition, leftRole) && matchOperandForRole(condition, rightRole));
}
/** Sunucunun çözemediği (kaynağı/sütunu kaybolmuş) operandlar. */
function unresolvedMatchOperands(value) {
  const config = normalizeAntrepoMatchConfig(value);
  const out = [];
  for (const condition of config.conditions) {
    for (const operand of condition.operands) {
      if (!operand.unresolved) continue;
      out.push({
        conditionId: condition.id,
        sourceId: operand.sourceId,
        role: operand.role,
        label: operand.canonicalHeader || operand.header || operand.name || '',
        reason: operand.unresolved,
      });
    }
  }
  return out;
}
function matchSourcesFromConditions(conditions, declared) {
  const known = new Map();
  for (const entry of (Array.isArray(declared) ? declared : [])) {
    const id = norm(entry && entry.id);
    if (!id) continue;
    known.set(id, {
      id,
      role: matchRoleKey(entry.role),
      profileId: norm(entry.profileId),
      label: norm(entry.label),
      connectionId: norm(entry.connectionId),
      kind: norm(entry.kind) || 'database',
    });
  }
  const out = [];
  const seen = new Set();
  for (const condition of conditions) {
    for (const operand of condition.operands) {
      const id = operand.sourceId;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const meta = known.get(id);
      out.push(meta ? { ...meta, role: meta.role || operand.role } : {
        id, role: operand.role, profileId: '', label: '', connectionId: '', kind: 'database',
      });
    }
  }
  return out;
}
function normalizeMatchCondition(condition, index) {
  if (!condition || typeof condition !== 'object') return null;
  let operands = Array.isArray(condition.operands)
    ? condition.operands.map(operand => normalizeMatchOperand(operand))
    : [];
  if (!operands.length) {
    // v1 gövdesi: iki sabit taraf. Rolleriyle birlikte operanda taşınır.
    operands = [
      normalizeMatchOperand(condition.asas, { role: 'asas', header: condition.asasHeader || '' }),
      normalizeMatchOperand(condition.ias, { role: 'antrepo', header: condition.iasHeader || '' }),
    ];
  }
  operands = operands.filter(hasMatchColumn);
  // Aynı kaynak bir koşulda iki kez yer alamaz: kendi kendisiyle karşılaştırma
  // her satırı eşleştirir ve kuralı sessizce etkisizleştirir.
  const seenSource = new Set();
  operands = operands.filter(operand => {
    const key = operand.sourceId || operand.role;
    if (seenSource.has(key)) return false;
    seenSource.add(key);
    return true;
  });
  // Bir koşul en az iki tarafı bağlar; tek operand hiçbir şeyi kısıtlamaz.
  if (operands.length < 2) return null;
  return {
    id: matchConditionId(condition.id, index),
    operands,
    normalization: condition.normalization === 'colour' ? 'colour' : '',
  };
}
function withLegacyMatchAliases(condition) {
  const asas = matchOperandForRole(condition, 'asas');
  const ias = matchOperandForRole(condition, 'antrepo');
  // `.asas` / `.ias` KALDIRILMADI. Eski çağrı yerleri, testler ve kayıtlı
  // yapılandırmalar bu iki adı okumaya devam eder; artık operandların rol
  // izdüşümüdür, ayrı bir gerçek değil.
  return { ...condition, asas: asas || emptyMatchSide(), ias: ias || emptyMatchSide() };
}
// defaultAntrepoMatchConfig() normalize içinden çağrılamaz (özyineleme); varsayılan
// koşullar bu yardımcıdan gelir.
function defaultMatchConditions() {
  const out = [];
  DEFAULT_ANTREPO_MATCH_CONDITIONS.forEach((condition, index) => {
    const normalized = normalizeMatchCondition(condition, index);
    if (normalized) out.push(normalized);
  });
  return out;
}
function defaultAntrepoMatchConfig() {
  return normalizeAntrepoMatchConfig({ version: 2, conditions: DEFAULT_ANTREPO_MATCH_CONDITIONS });
}
function normalizeAntrepoMatchConfig(value) {
  const raw = value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  const source = raw && Array.isArray(raw.conditions) ? raw.conditions : DEFAULT_ANTREPO_MATCH_CONDITIONS;
  const seen = new Set();
  const conditions = [];
  source.forEach((condition, index) => {
    const normalized = normalizeMatchCondition(condition, index);
    if (!normalized) return;
    let id = normalized.id;
    while (seen.has(id)) id = `${id}-${index + 1}`;
    seen.add(id);
    conditions.push({ ...normalized, id });
  });

  // v4.41 ve öncesindeki kurulumlarda varsayılan üçlünün antrepo model başlığı
  // yanlışlıkla "Model Adı" kanoniğiyle saklanabiliyordu. Yalnız sistemin eski
  // varsayılan kimliklerine sahip tam üçlüyü yeni "Ürün Ad" kanoniğine taşırız;
  // kullanıcının farklı kimliklerle kurduğu manuel koşullara dokunmayız.
  const legacyDefault = [
    ['ocode', 'Sipariş Kod', 'Sipariş Kod'],
    ['model', 'Model Adı', 'Model Adı'],
    ['ccode', 'Renk Kod', 'Renk Kod'],
  ];
  const headerOf = operand => (operand ? (operand.canonicalHeader || operand.header) : '');
  const isLegacyDefault = conditions.length === legacyDefault.length && conditions.every((condition, index) => {
    const [id, left, right] = legacyDefault[index];
    return condition.id === id
      && headerOf(matchOperandForRole(condition, 'asas')) === left
      && headerOf(matchOperandForRole(condition, 'antrepo')) === right;
  });
  if (isLegacyDefault) {
    conditions[1] = {
      ...conditions[1],
      operands: conditions[1].operands.map(operand => (matchRoleKey(operand.role) === 'antrepo'
        ? { ...operand, header: 'Ürün Ad', canonicalHeader: 'Ürün Ad' }
        : operand)),
    };
  }

  const finalConditions = (conditions.length ? conditions : defaultMatchConditions()).map(withLegacyMatchAliases);
  return {
    version: 2,
    sources: matchSourcesFromConditions(finalConditions, raw && raw.sources),
    conditions: finalConditions,
  };
}
// Eski kod ve testler bu fonksiyondan metin bekler. Yeni üretim akışı config
// nesnesini normalizeAntrepoMatchConfig ile kullanır.
function normalizeAntrepoMatchRule() {
  return DEFAULT_ANTREPO_MATCH_RULE;
}
function matchRuleOf(value) {
  if (value && typeof value === 'object' && Array.isArray(value.conditions)) return normalizeAntrepoMatchConfig(value);
  if (value && typeof value === 'object' && value.antrepoMatchConfig) return normalizeAntrepoMatchConfig(value.antrepoMatchConfig);
  return defaultAntrepoMatchConfig();
}
function matchOperandLabel(operand, fallback = '') {
  if (!operand) return fallback;
  return operand.canonicalHeader || operand.header || operand.name || fallback;
}
function antrepoMatchConfigLabel(value) {
  const config = normalizeAntrepoMatchConfig(value);
  return config.conditions.map((condition, index) => condition.operands
    .map((operand, position) => matchOperandLabel(operand, `${operand.sourceId || operand.role || 'kaynak'} ${index + 1}.${position + 1}`))
    .join(' = ')).join(' + ');
}
function antrepoMatchConfigSignature(value) {
  const config = normalizeAntrepoMatchConfig(value);
  // İmza SIRALIDIR ve operand başına kaynak kimliğini de taşır: aynı sütun adı
  // farklı kaynaklardan geldiğinde arama tablosu yeniden kurulmalıdır.
  return JSON.stringify(config.conditions.map(condition => [
    condition.id,
    condition.operands.map(operand => [
      operand.sourceId || '',
      operand.role || '',
      operand.canonicalHeader || operand.header || '',
      operand.table || '',
      operand.name || '',
    ]),
    condition.normalization || '',
  ]));
}
function isDefaultAntrepoMatchConfig(value) {
  const config = normalizeAntrepoMatchConfig(value);
  const expected = [
    ['Sipariş Kod', 'Sipariş Kod'],
    ['Model Adı', 'Ürün Ad'],
    ['Renk Kod', 'Renk Kod'],
  ];
  return config.conditions.length === expected.length && config.conditions.every((condition, index) => {
    const left = condition.asas.canonicalHeader || condition.asas.header;
    const right = condition.ias.canonicalHeader || condition.ias.header;
    return left === expected[index][0] && right === expected[index][1];
  });
}
function canonicalMatchValue(record, role, header) {
  const key = turknorm(header);
  if (!record || !key) return '';
  // Otomatik sorguda seçilen sütun zaten başka bir kanonik başlıkla geliyorsa
  // SUMMARIZECOLUMNS aynı modeli ikinci kez projekte etmez. Bu durumda ham çıktı
  // değerini başlık adıyla saklanan kaynak sözlüğünden okuruz. Değerin kendisine
  // hiçbir tolerans/normalizasyon uygulanmaz; yalnız başlık çözümlemesi yapılır.
  const sourceValues = record._sourceValues && typeof record._sourceValues === 'object' ? record._sourceValues : {};
  if (Object.prototype.hasOwnProperty.call(sourceValues, header)) return sourceValues[header];
  const sourceHeader = Object.keys(sourceValues).find(name => turknorm(name) === key);
  if (sourceHeader) return sourceValues[sourceHeader];
  if (key === 'SIPARIS KOD' || key === 'SIPARIS KODU' || key === 'ORDER CODE') {
    return record._matchOcode != null ? record._matchOcode : record.ocode;
  }
  if (key === 'MODEL ADI' || key === 'URUN ADI' || key === 'URUN AD' || key === 'MODEL NAME' || key === 'PRODUCT NAME') return record.model;
  if (key === 'RENK KOD' || key === 'RENK KODU' || key === 'COLOUR CODE' || key === 'COLOR CODE') return record.ccode;
  if (key === 'RENK' || key === 'RENK TANIM' || key === 'RENK TANIMI' || key === 'COLOUR' || key === 'COLOR') return record.colour;
  const extra = record._cpExtra && typeof record._cpExtra === 'object' ? record._cpExtra : {};
  if (Object.prototype.hasOwnProperty.call(extra, header)) return extra[header];
  return '';
}
function isOrderCodeMatchSide(condition, side) {
  const header = turknorm(side && (side.canonicalHeader || side.header || side.name));
  return String(condition && condition.id || '').toLowerCase() === 'ocode'
    || header === 'SIPARIS KOD' || header === 'SIPARIS KODU' || header === 'ORDER CODE';
}
function orderCodeMatchValue(value) {
  if (value == null) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? orderCodeKey(value) : '';
  const text = exactMatchValue(value);
  if (!text) return '';
  // Yalnız tamamı sayısal bir Excel/DAX gösterimi ise temsil biçimini birleştir.
  // A-001 gibi alfasayısal sipariş kodları A001 ile kesinlikle aynı sayılmaz.
  const numericDisplay = /^[+-]?(?:\d{1,3}(?:[.,]\d{3})+|\d+)(?:[.,]\d+)?(?:[eE][+-]?\d+)?$/;
  return numericDisplay.test(text) ? orderCodeKey(text) : text;
}
function normalizedConditionMatchValue(value, condition, side) {
  // Sipariş kodu Excel, DAX ve CSV katmanlarında 1234567 / 1234567.00 / sayı
  // biçimlerinde gelebilir. Bunlar aynı iş anahtarıdır; yalnız temsil biçimini
  // birleştiririz. Alfasayısal kod, model adı ve renk kodunda tolerans/fuzzy yoktur.
  if (condition && condition.normalization === 'colour') {
    return String(value == null ? '' : value).normalize('NFC').trim()
      .replace(/\s+/g, ' ').toUpperCase();
  }
  return isOrderCodeMatchSide(condition, side) ? orderCodeMatchValue(value) : exactMatchValue(value);
}
function matchValueFor(record, role, condition) {
  // Taraf, sabit bir alan adından değil OPERANDIN ROLÜNDEN bulunur; böylece
  // aynı motor üçüncü bir kaynak eklendiğinde de çalışır.
  const side = matchOperandForRole(condition, role) || emptyMatchSide();
  const canonicalHeader = side.canonicalHeader || side.header || '';
  const canonicalKey = turknorm(canonicalHeader);
  const conditionId = String(condition && condition.id || '').toLowerCase();
  const isCanonicalIdentity = (
    (conditionId === 'ocode' && (canonicalKey === 'SIPARIS KOD' || canonicalKey === 'SIPARIS KODU' || canonicalKey === 'ORDER CODE'))
    || (conditionId === 'model' && (canonicalKey === 'MODEL ADI' || canonicalKey === 'URUN AD' || canonicalKey === 'URUN ADI' || canonicalKey === 'MODEL NAME' || canonicalKey === 'PRODUCT NAME'))
    || (conditionId === 'ccode' && (canonicalKey === 'RENK KOD' || canonicalKey === 'RENK KODU' || canonicalKey === 'COLOUR CODE' || canonicalKey === 'COLOR CODE'))
  );

  // Varsayılan Sipariş Kod + Model/Ürün Adı + Renk Kod üçlüsünde ekrana ve rapora
  // gelen kanonik iş alanları tek otoritedir. Data Model sorgusundan kalmış gizli
  // __MATCH_* projeksiyonları bu üç alanı gölgeleyemez; aksi halde ekranda aynı
  // görünen ASAS/Antrepo satırları eşleşmiyordu. Özel kullanıcı koşulları ise
  // _matchValues üzerinden çalışmaya devam eder.
  if (isCanonicalIdentity) {
    return normalizedConditionMatchValue(canonicalMatchValue(record, role, canonicalHeader), condition, side);
  }
  const values = record && record._matchValues && typeof record._matchValues === 'object' ? record._matchValues : {};
  if (Object.prototype.hasOwnProperty.call(values, condition.id)) {
    return normalizedConditionMatchValue(values[condition.id], condition, side);
  }
  return normalizedConditionMatchValue(canonicalMatchValue(record, role, canonicalHeader), condition, side);
}
function dynamicAntrepoMatchKey(record, role, value) {
  const config = normalizeAntrepoMatchConfig(value);
  // Yalnız BU İKİLİYİ (sipariş satırları ↔ antrepo satırları) kısıtlayan koşullar
  // anahtara girer. Başka bir kaynak çiftine ait koşul burada kısıt üretmez; ikili
  // için hiç koşul kalmadıysa anahtar boştur ve HİÇBİR ŞEY eşleşmez — koşulsuz bir
  // kural her satırı her siparişe bağlardı.
  const conditions = matchConditionsForPair(config, 'asas', 'antrepo');
  if (!conditions.length) return '';
  const values = conditions.map(condition => matchValueFor(record, role, condition));
  if (values.some(v => !v)) return '';
  return JSON.stringify(values);
}
// Aynı ASAS satırından üretilen CP, Sipariş Özeti ve Backlog satırlarını nesne
// kimliğiyle birbirine bağlar. Referans enumerable değildir; API/Excel çıktısına
// sızmaz. Bu sayede aynı Sipariş Kod + Model + Renk Kod üçlüsüne sahip fakat
// kullanıcı tanımlı ek koşullarla ayrılan satırlar birbirinin operasyon bilgisini
// alamaz. Satır kopyalandığında attachSourceOrderRef() ilk kaynak satır referansını korur.
function sourceOrderRef(value) {
  return value && value.__sourceOrder ? value.__sourceOrder : value;
}
function attachSourceOrderRef(target, source) {
  if (!target || typeof target !== 'object') return target;
  Object.defineProperty(target, '__sourceOrder', {
    value: sourceOrderRef(source), enumerable: false, configurable: true,
  });
  return target;
}

function findAntrepoHit(antrepoMap, orderOrCode, options) {
  if (!antrepoMap || typeof antrepoMap !== 'object') return null;
  const opts = (options && typeof options === 'object') ? options : {};
  const diag = opts.diag;
  const count = key => { if (diag && typeof diag === 'object') diag[key] = (diag[key] || 0) + 1; };
  const isOrder = orderOrCode && typeof orderOrCode === 'object';
  if (!isOrder) { count('targetIncomplete'); return null; }
  const config = matchRuleOf(opts.rule || opts.config);
  const key = dynamicAntrepoMatchKey(orderOrCode, 'asas', config);
  if (!key) { count('targetIncomplete'); return null; }

  const hits = buildAntrepoLookup(antrepoMap, config).byLine.get(key) || [];
  if (!hits.length) { count('unmatched'); return null; }
  if (hits.length > 1) count('ambiguous');
  const hit = hits.reduce((acc, entry) => mergeAntrepoEntries(acc, entry), null);
  const legacyDefault = isDefaultAntrepoMatchConfig(config);
  return hit ? {
    ...hit,
    _matchLevel: legacyDefault ? 'line' : 'all-conditions',
    _matchRule: legacyDefault ? DEFAULT_ANTREPO_MATCH_RULE : 'custom',
    _matchConditionCount: config.conditions.length,
  } : null;
}

// Backlog için bütün eşleşen IAS parsiyellerini döndürür. Burada en yeni satırı
// seçme, alan birleştirme, kademeli eşleşme veya tekilleştirme yapılmaz. Her IAS
// kaynak satırı bağımsızdır ve kaynak sırasıyla korunur.
function findAntrepoHits(antrepoMap, orderOrCode, options) {
  if (!antrepoMap || typeof antrepoMap !== 'object') return [];
  const opts = (options && typeof options === 'object') ? options : {};
  const diag = opts.diag;
  const count = key => { if (diag && typeof diag === 'object') diag[key] = (diag[key] || 0) + 1; };
  if (!orderOrCode || typeof orderOrCode !== 'object') { count('targetIncomplete'); return []; }
  const config = matchRuleOf(opts.rule || opts.config);
  const key = dynamicAntrepoMatchKey(orderOrCode, 'asas', config);
  if (!key) { count('targetIncomplete'); return []; }
  const source = buildAntrepoLookup(antrepoMap, config).byLine.get(key) || [];
  if (!source.length) { count('unmatched'); return []; }
  if (source.length > 1) count('ambiguous');
  const legacyDefault = isDefaultAntrepoMatchConfig(config);
  return source
    .map((entry, index) => ({
      ...entry,
      _lookupIndex: index,
      _matchLevel: legacyDefault ? 'line' : 'all-conditions',
      _matchRule: legacyDefault ? DEFAULT_ANTREPO_MATCH_RULE : 'custom',
      _matchConditionCount: config.conditions.length,
    }))
    .sort((a, b) => {
      const ar = Number.isFinite(Number(a._sourceRow)) ? Number(a._sourceRow) : Number(a._lookupIndex);
      const br = Number.isFinite(Number(b._sourceRow)) ? Number(b._sourceRow) : Number(b._lookupIndex);
      return ar - br;
    });
}

const isProductionStatus = BLBusinessRules.isProductionStatus;
const DEFAULT_TRANSIT_DAYS = BLBusinessRules.DEFAULT_TRANSIT_DAYS;
const normalizeTransitDelType = BLBusinessRules.normalizeTransitDelType;
const transitCountryKey = BLBusinessRules.transitCountryKey;
function findTransitRule(rules, exFactory, season, country, delType) {
  return BLBusinessRules.findTransitRule(rules, exFactory, season, country, delType, dateOrdinal);
}
function defaultTransitDays(delType) { return BLBusinessRules.defaultTransitDays(delType); }
function resolveTransitDays(options) { return BLBusinessRules.resolveTransitDays(options, dateOrdinal); }
function roundHalfUp(value, decimals = 2) { return BLBusinessRules.roundHalfUp(value, decimals); }
function licensorOf(license) { return LICMAP[String(license || '').trim()] || ''; }
function pricingLicensorForLicense(license, rules, fallback) {
  const resolved = BLBusinessRules.resolveLicenseLicensor(license, rules);
  // Ambiguity is NOT a missing result: when more than one distinct Licensor is
  // applicable, falling back to the catalogue would silently collapse the choice
  // into a single value (often DTR) and then produce a commission-free Supp. FOB.
  // The row stays unresolved until a Licensor is picked explicitly.
  if (BLBusinessRules.isUnresolvedLicensorStatus(resolved.status)) return '';
  // Pricing rules may extend/override the catalogue, but an empty rule result
  // must not erase the established License -> Licensor mapping. CP, Orders and
  // Backlog all rely on this canonical value for the DTR Manufacturer -> Sub Mfr rule.
  return resolved.displayValue || norm(fallback) || licensorOf(license);
}
function isDTR(license) { return licensorOf(license) === 'DTR'; }
function pricingKeyPart(v) { return turknorm(v); }
function pricingCountryGroup(raw) {
  const x = pricingKeyPart(raw).replace(/[\s_]+/g, '-');
  if (!x) return '';
  return x === 'TR' || x === 'TURKIYE' || x === 'TURKEY' ? 'TR' : 'NON-TR';
}
function pricingDateIso(v) {
  const d = parseDateOnly(v);
  if (!d) return '';
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function normalizePricingRuleSeasons(value) {
  const raw = Array.isArray(value) ? value : (value == null || value === '' ? [] : [value]);
  const seen = new Set(), out = [];
  for (const item of raw) {
    const text = norm(item), key = pricingKeyPart(text);
    if (text && key && !seen.has(key)) { seen.add(key); out.push(text); }
  }
  return out.sort((a, b) => a.localeCompare(b, 'tr'));
}
function pricingRuleSeasonMatches(rule, season) {
  const seasons = normalizePricingRuleSeasons(rule && rule.seasons != null ? rule.seasons : rule && rule.season);
  if (!seasons.length) return true;
  const key = pricingKeyPart(season);
  return !!key && seasons.some(v => pricingKeyPart(v) === key);
}
function findSuppFobRule(rules, opd, country, season, manufacturer, license) {
  const day = dateOrdinal(opd);
  const countryGroup = pricingCountryGroup(country);
  const mk = pricingKeyPart(manufacturer), ck = pricingKeyPart(license);
  return (Array.isArray(rules) ? rules : []).find(r => {
    const start = dateOrdinal(r && r.opdStart), end = dateOrdinal(r && r.opdEnd);
    const dateMatches = (start == null && end == null) || (day != null && (start == null || day >= start) && (end == null || day <= end));
    return dateMatches && pricingRuleSeasonMatches(r, season) &&
      BLBusinessRules.pricingRuleCommissionForCountry(r, countryGroup) != null &&
      pricingKeyPart(r && (r.manufacturer != null ? r.manufacturer : r.licensor)) === mk &&
      pricingKeyPart(r && r.license) === ck;
  }) || null;
}
const decimalFraction = BLBusinessRules.decimalFraction;
const roundFractionHalfUp = BLBusinessRules.roundFractionHalfUp;
const calculateSuppFobWithRule = BLBusinessRules.calculateSuppFobWithRule;
function calculateSuppFobByRule(fob, opd, country, season, manufacturer, license, rules) {
  const rule = findSuppFobRule(rules, opd, country, season, manufacturer, license);
  if (!rule) return { value: null, rule: null };
  return { value: calculateSuppFobWithRule(fob, rule, country), rule };
}
function normalizeSuppFobMeta(meta) {
  if (!meta || typeof meta !== 'object') return null;
  const out = { source: meta.source === 'rule' ? 'rule' : 'manual' };
  if (meta.ruleId != null) out.ruleId = String(meta.ruleId);
  ['opdStart', 'opdEnd', 'countryGroup', 'commissionGroup', 'manufacturer', 'licensor', 'license'].forEach(k => {
    if (meta[k] != null) out[k] = String(meta[k]);
  });
  if (!out.manufacturer && meta.licensor != null) out.manufacturer = String(meta.licensor);
  const seasons = normalizePricingRuleSeasons(meta.seasons != null ? meta.seasons : meta.season);
  if (seasons.length) out.seasons = seasons;
  ['royalty', 'trCommission', 'ydCommission', 'commission', 'effectiveRoyalty', 'hologramCost'].forEach(k => {
    if (meta[k] == null || String(meta[k]).trim() === '') return;
    const value = Number(meta[k]);
    if (Number.isFinite(value)) out[k] = value;
  });
  if (meta.applied === true) out.applied = true;
  return out;
}
// License Royalty v2: ülke kuralın boyutu değil, komisyon varyantıdır. Meta,
// istemcideki automaticSuppFobRuleMeta ile aynı efektif oranı taşır.
function automaticRuleMeta(rule, applied, country) {
  if (!rule) return null;
  const group = BLBusinessRules.pricingRuleCountryGroup(country) || pricingCountryGroup(rule.countryGroup);
  const commissionGroup = group === 'TR' ? 'TR' : 'YD';
  const licensor = String(rule.manufacturer != null ? rule.manufacturer : (rule.licensor || ''));
  const optional = value => value == null || String(value).trim() === '' || !Number.isFinite(Number(value)) ? null : Number(value);
  return {
    source: 'rule',
    ruleId: String(rule.id || ''),
    opdStart: pricingDateIso(rule.opdStart),
    opdEnd: pricingDateIso(rule.opdEnd),
    seasons: normalizePricingRuleSeasons(rule.seasons != null ? rule.seasons : rule.season),
    countryGroup: commissionGroup === 'TR' ? 'TR' : 'Non-TR',
    commissionGroup,
    manufacturer: licensor,
    licensor,
    license: String(rule.license || ''),
    royalty: Number(rule.royalty),
    trCommission: optional(rule.trCommission),
    ydCommission: optional(rule.ydCommission),
    commission: BLBusinessRules.pricingRuleCommissionForCountry(rule, commissionGroup),
    effectiveRoyalty: BLBusinessRules.pricingRuleEffectiveRoyalty(rule, commissionGroup),
    hologramCost: BLBusinessRules.pricingRuleHologramForCountry(rule, commissionGroup),
    applied: applied === true,
  };
}
function countryEN(raw) { return COUNTRY_MAP[turknorm(raw)] || raw; }
function makeDateOnly(y, m, d) {
  y = Number(y); m = Number(m); d = Number(d);
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return null;
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d ? dt : null;
}

// Excel/JSON tarihleri saat dilimine göre bir gün kaymamalı. SheetJS bazı tarihleri
// UTC gece yarısı, bazı kurulumlarda ise yerel gece yarısı olarak Date nesnesine çevirir.
// Hangi gece yarısının kullanıldığını tespit edip yalnızca takvim gününü koruyoruz.
function dateOnlyFromDateObject(v) {
  if (!(v instanceof Date) || isNaN(v)) return null;
  const localMidnight = v.getHours() === 0 && v.getMinutes() === 0 && v.getSeconds() === 0 && v.getMilliseconds() === 0;
  const utcMidnight = v.getUTCHours() === 0 && v.getUTCMinutes() === 0 && v.getUTCSeconds() === 0 && v.getUTCMilliseconds() === 0;
  if (utcMidnight && !localMidnight) return makeDateOnly(v.getUTCFullYear(), v.getUTCMonth() + 1, v.getUTCDate());
  return makeDateOnly(v.getFullYear(), v.getMonth() + 1, v.getDate());
}

function excelSerialToDateOnly(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  if (getXLSX().SSF && typeof getXLSX().SSF.parse_date_code === 'function') {
    const dc = getXLSX().SSF.parse_date_code(n);
    if (dc) return makeDateOnly(dc.y, dc.m, dc.d);
  }
  const utc = new Date(Math.round((n - 25569) * 86400000));
  return makeDateOnly(utc.getUTCFullYear(), utc.getUTCMonth() + 1, utc.getUTCDate());
}

function parseDateOnly(v) {
  if (v instanceof Date) return dateOnlyFromDateObject(v);
  if (v == null || v === '') return null;

  if (typeof v === 'number' && Number.isFinite(v)) {
    const whole = Math.trunc(v);
    if (whole >= 10000101 && whole <= 99991231) {
      return makeDateOnly(Math.trunc(whole / 10000), Math.trunc((whole % 10000) / 100), whole % 100);
    }
    if (v > 0 && v < 3000000) return excelSerialToDateOnly(v);
    return null;
  }

  const s = String(v).trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return makeDateOnly(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{2}|\d{4})(?:\s|$)/);
  if (m) {
    const y = +m[3] < 100 ? 2000 + +m[3] : +m[3];
    return makeDateOnly(y, +m[2], +m[1]);
  }
  // Salt ISO tarihini saat dilimine sokmadan doğrudan takvim tarihi olarak kur.
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return makeDateOnly(+m[1], +m[2], +m[3]);
  // ISO tarih-saat JSON'dan geldiyse gerçek anı yerel takvim gününe çevir. Bu, örneğin
  // 19.10.2026 yerel gece yarısının JSON'da 18.10.2026T21:00:00Z görünmesini düzeltir.
  if (/^\d{4}-\d{1,2}-\d{1,2}T/.test(s)) {
    const dt = new Date(s);
    return dateOnlyFromDateObject(dt);
  }
  const n = Number(s.replace(',', '.'));
  if (Number.isFinite(n)) return parseDateOnly(n);
  return null;
}

function toDateOnly(v) { return parseDateOnly(v); }
function dateOrdinal(v) {
  const d = parseDateOnly(v);
  return d ? Math.trunc(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000) : null;
}
function daysBetween(a, b) {
  const aa = dateOrdinal(a), bb = dateOrdinal(b);
  return aa == null || bb == null ? null : bb - aa;
}
function mondayOf(v) {
  const d = parseDateOnly(v); if (!d) return null;
  const day = (d.getDay() + 6) % 7;
  const m = new Date(d); m.setDate(d.getDate() - day); return m;
}
function yyyymmdd(v) { return parseDateOnly(v); }
function parseDateFlexible(v) { return parseDateOnly(v); }
function findAnchorRow(rows, anchors, maxScan) {
  for (let i = 0; i < Math.min(rows.length, maxScan || 25); i++) {
    const cells = (rows[i] || []).map(c => norm(c));
    if (anchors.every(a => cells.includes(a))) return i;
  }
  return -1;
}

function objectRowsToMatrix(records) {
  const rows = Array.isArray(records) ? records : [];
  const headers = [];
  const seen = new Set();
  rows.forEach(record => {
    if (!record || typeof record !== 'object' || Array.isArray(record)) return;
    Object.keys(record).forEach(key => {
      const name = norm(key);
      if (name && !seen.has(name)) { seen.add(name); headers.push(name); }
    });
  });
  return [headers, ...rows.map(record => headers.map(header => record && Object.prototype.hasOwnProperty.call(record, header) ? record[header] : null))];
}

function isMainFabricFlag(value) {
  if (value === true) return true;
  if (typeof value === 'number') return Number.isFinite(value) && value === 1;
  const text = norm(value).replace(',', '.');
  if (!text) return false;
  if (/^1(?:\.0+)?$/.test(text)) return true;
  const key = turknorm(text);
  return key === 'EVET' || key === 'YES' || key === 'TRUE';
}

function parseASASMatrix(rows, ruleValue) {
  const hIdx = findAnchorRow(rows, ['Sipariş Kod'], 25);
  if (hIdx < 0) return null;
  const header = rows[hIdx].map(h => norm(h));
  const idx = {}; header.forEach((h, i) => { if (h) idx[h] = i; });
  const g = (row, name) => idx[name] != null ? row[idx[name]] : null;
  const licensorColumn = header.findIndex(name => BLCanonicalFields.canonicalId('cp', name) === 'licensor');
  const canonHeader = (v) => turknorm(v).replace(/[^A-Z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
  const headerKeys = Object.keys(idx);
  const findHeaderFuzzy = patterns => {
    for (const terms of patterns) {
      const hit = headerKeys.find(k => { const c = canonHeader(k); return terms.every(t => c.includes(t)); });
      if (hit) return hit;
    }
    return null;
  };
  const resolveHeader = (exactNames, patterns) => {
    for (const exact of exactNames) if (idx[exact] != null) return exact;
    return findHeaderFuzzy(patterns);
  };
  const merkezSevkeHazirHeader = resolveHeader(
    ['Kalan Alım Sipariş Miktarı_Merkez Sevke Hazır Depo'],
    [['KALAN','MERKEZ','SEVKE','HAZIR'], ['MERKEZ','SEVKE','HAZIR','DEPO']]);
  const shipConfHeader = resolveHeader(
    ['Buying Son Onay Tarihi'],
    [['BUYING','SON','ONAY','TARIH'], ['BUYING','APPROVAL','DATE'], ['SON','ONAY','TARIH']]);
  const initialInspectionHeader = resolveHeader(
    ['Initial Inspection Geçme Tarih', 'Initial Inspection Tarih', 'Initial Inspection Tarihi', 'Initial Inspection'],
    [['INITIAL','INSPECTION','GECME','TARIH'], ['INITIAL','INSPECTION','TARIH'], ['INITIAL','INSPECTION','DATE']]);
  const technicalImageHeader = resolveHeader(
    ['Teknik Görsel', 'Teknik Resim'],
    [['TEKNIK','GORSEL'], ['TEKNIK','RESIM'], ['TECHNICAL','IMAGE'], ['TECHNICAL','PICTURE']]);
  const plmCodeHeader = resolveHeader(
    ['Plm Kod', 'PLM Kod'],
    [['PLM','KOD'], ['PLM','CODE'], ['PLM','ID']]);
  const productDescriptionHeader = resolveHeader(
    ['Ürün Ana Tanım', 'Ürün Tanım', 'Ürün Tanımı'],
    [['URUN','ANA','TANIM'], ['URUN','TANIM'], ['PRODUCT','DESCRIPTION'], ['PRODUCT','DEFINITION']]);
  const fabricHeaders = {
    main: resolveHeader(['Ana Kumaş Mı'], [['ANA','KUMAS','MI'], ['MAIN','FABRIC'], ['IS','MAIN','FABRIC']]),
    fabricCategory: resolveHeader(['Kumaş Kategorisi'], [['KUMAS','KATEGORI'], ['FABRIC','CATEGORY']]),
    fabricSupplierCountry: resolveHeader(['Kumaşçı Ülkesi'], [['KUMASCI','ULKE'], ['FABRIC','SUPPLIER','COUNTRY'], ['MILL','COUNTRY']]),
    fabricSupplier: resolveHeader(['Kumaşçı'], [['KUMASCI'], ['FABRIC','SUPPLIER'], ['FABRIC','MILL']]),
    kumasTipi: resolveHeader(['Kumaş Tipi'], [['KUMAS','TIP'], ['KUMAS','CINS'], ['FABRIC','TYPE']]),
    iplikNo: resolveHeader(['İplik No'], [['IPLIK','NO'], ['YARN','COUNT'], ['YARN','NO']]),
    fabricWeight: resolveHeader(['Gramaj', 'Kumaş Gramajı'], [['GRAMAJ'], ['GSM'], ['FABRIC','WEIGHT'], ['GR','M2']]),
    karisim: resolveHeader(['Karışım'], [['KARISIM'], ['KOMPOZISYON'], ['COMPOSITION'], ['BLEND']]),
  };
  const gFuzzy = (row, realHeader) => realHeader != null && idx[realHeader] != null ? row[idx[realHeader]] : null;
  const cpExtraHeaders = header.filter(name => /^__CPX_/i.test(name));
  const matchHeaders = header.filter(name => /^__MATCH_/i.test(name));
  const activeConfig = matchRuleOf(ruleValue);
  const matchSourceHeaders = [...new Set(activeConfig.conditions
    .map(condition => condition.asas.canonicalHeader || condition.asas.header)
    .filter(name => name && idx[name] != null))];
  const toOrder = (row, sourceRow) => {
    const mainFabric = Boolean(fabricHeaders.main) && isMainFabricFlag(gFuzzy(row, fabricHeaders.main));
    return {
      ocode: toOrderCodeNumber(g(row, 'Sipariş Kod')),
      _matchOcode: exactOrderCodeKey(g(row, 'Sipariş Kod')),
      colour: norm(g(row, 'Renk')), ccode: norm(g(row, 'Renk Kod')),
      qty: Number(g(row, 'Net Alım Sipariş Miktarı')) || 0,
      kalan: Number(g(row, 'Kalan Alım Sipariş Miktarı')) || 0,
      antrepo: Number(g(row, 'Antrepoya Giren Miktar')) || 0,
      merkezSevkeHazirKalan: Number(gFuzzy(row, merkezSevkeHazirHeader)) || 0,
      fob: Number(g(row, 'FOB Fiyatı')),
      plm: gFuzzy(row, plmCodeHeader), ozel: norm(g(row, 'Özel Kod 1')),
      technicalImageUrl: norm(gFuzzy(row, technicalImageHeader)),
      manufacturer: norm(g(row, 'Üretici')), season: norm(g(row, 'Sezon')),
      category: norm(g(row, 'Ürün Klasman')), merch: norm(g(row, 'Merch Alt Grup Kod')).toUpperCase(),
      ageGroup: norm(g(row, 'Merch Marka Yaş Grup Kod')).toUpperCase(),
      buyerGrup: norm(g(row, 'Buyer Grup (TR)')), countryRaw: norm(g(row, 'Siparişin Üretildiği Ülke')),
      license: norm(g(row, 'Lisans')), licensor: licensorColumn < 0 ? '' : norm(row[licensorColumn]), model: norm(g(row, 'Model Adı')),
      productDescription: norm(gFuzzy(row, productDescriptionHeader)),
      ex: yyyymmdd(g(row, 'Orijinal Exfactory Merch Tarih')),
      retail: yyyymmdd(g(row, 'Retail Depo Tarih Yıl Ay Gün')),
      mb: yyyymmdd(g(row, 'Model Bütçe Tarih Yıl Ay Gün')),
      opd: yyyymmdd(g(row, 'Sipariş Yerleştirme MerchTarih')),
      shipConf: shipConfHeader ? yyyymmdd(g(row, shipConfHeader)) : null,
      initialInspection: initialInspectionHeader ? yyyymmdd(gFuzzy(row, initialInspectionHeader)) : null,
      originalExFactoryDate: yyyymmdd(g(row, 'Initial Inspection Geçme Tarih Gün Ay Yıl')),
      buyer: norm(g(row, 'Buyer')),
      line: norm(g(row, 'Line')),
      // ASAS aynı sipariş satırını kumaş bileşeni kadar çoğaltabilir. Yalnız
      // "Ana Kumaş Mı" = 1 satırındaki bilgiler siparişe bağlanır; 0 satırları
      // operasyonel siparişi çoğaltmaz ve kumaş alanlarını doldurmaz.
      fabricCategory: mainFabric ? norm(gFuzzy(row, fabricHeaders.fabricCategory)) : '',
      fabricSupplierCountry: mainFabric ? norm(gFuzzy(row, fabricHeaders.fabricSupplierCountry)) : '',
      fabricSupplier: mainFabric ? norm(gFuzzy(row, fabricHeaders.fabricSupplier)) : '',
      kumasTipi: mainFabric ? norm(gFuzzy(row, fabricHeaders.kumasTipi)) : '',
      iplikNo: mainFabric ? norm(gFuzzy(row, fabricHeaders.iplikNo)) : '',
      fabricWeight: mainFabric ? norm(gFuzzy(row, fabricHeaders.fabricWeight)) : '',
      karisim: mainFabric ? norm(gFuzzy(row, fabricHeaders.karisim)) : '',
      _isMainFabric: mainFabric,
      _sourceRow: Number(sourceRow) || null,
      _cpExtra: Object.fromEntries(cpExtraHeaders.map(name => [name, g(row, name)])),
      _sourceValues: Object.fromEntries(matchSourceHeaders.map(name => [name, g(row, name)])),
      _sourceFields: Object.fromEntries(header.map((name, index) => [name, row[index]]).filter(([name]) => !!name)),
      _matchValues: Object.fromEntries(matchHeaders.map(name => [name.replace(/^__MATCH_/i, ''), g(row, name)])),
    };
  };
  const fabricValueFields = ['fabricCategory', 'fabricSupplierCountry', 'fabricSupplier', 'kumasTipi', 'iplikNo', 'fabricWeight', 'karisim'];
  // Aynı sipariş kimliğinin tekrar eden satırlarını ayırt etmek için kullanılan
  // boyut imzası: bilinen ASAS boyut alanları + kumaş alanları. Miktarlar ve
  // CP'ye eklenen Database/Horizon sütunları (__CPX_) imzaya girmez.
  const dimensionSignatureFields = ['season', 'model', 'ccode', 'colour', 'manufacturer', 'category', 'merch', 'ageGroup',
    'buyerGrup', 'countryRaw', 'license', 'licensor', 'productDescription', 'buyer', 'line', 'ozel', 'plm',
    'ex', 'retail', 'mb', 'opd', 'shipConf', ...fabricValueFields, '_isMainFabric'];
  const dimensionSignature = order => JSON.stringify(dimensionSignatureFields.map(field => {
    const value = order[field];
    return value instanceof Date ? value.getTime() : (value == null ? '' : String(value));
  }));
  const quantityFields = ['qty', 'kalan', 'antrepo', 'merkezSevkeHazirKalan'];
  const quantityHeaders = {
    qty: 'Net Alım Sipariş Miktarı', kalan: 'Kalan Alım Sipariş Miktarı',
    antrepo: 'Antrepoya Giren Miktar', merkezSevkeHazirKalan: merkezSevkeHazirHeader,
  };
  const blankSourceValue = value => value == null || (typeof value === 'string' && value.trim() === '');
  const signatureByOrder = new Map();
  const seen = new Map();
  const duplicateMainDetailByKey = new Map();
  let mainFabricRows = 0, ignoredNonMainRows = 0, duplicateMainRows = 0, sourceRowCount = 0;
  for (let r = hIdx + 1; r < rows.length; r++) {
    const row = rows[r]; if (!row) continue;
    const oc = g(row, 'Sipariş Kod'); if (oc == null || oc === '') continue;
    sourceRowCount++;
    const order = toOrder(row, r + 1);
    if (fabricHeaders.main) {
      if (order._isMainFabric) mainFabricRows++;
      else ignoredNonMainRows++;
    }
    // Rapor satırı kimliği sabit üçlüyle korunur; kullanıcı aynı üçlü altında ek
    // koşullarla ayrılan satırlar seçtiyse dinamik anahtar da kimliğe eklenir.
    const baseKey = antrepoMatchKey(oc, order.model, order.ccode);
    const dynamicKey = dynamicAntrepoMatchKey(order, 'asas', activeConfig);
    const key = `${baseKey}\u0000${dynamicKey || `__row_${r}`}`;
    const current = seen.get(key);
    if (!current) {
      seen.set(key, order);
      signatureByOrder.set(order, dimensionSignature(order));
      continue;
    }
    // CP'ye eklenen Database/Horizon sütunu (__CPX_), SUMMARIZECOLUMNS'ta gruplama
    // sütunu olduğu için aynı siparişi değer bazında birden fazla satıra bölebilir
    // (ör. boş değerli satır + dolu satır). Bilinen boyutları birebir aynı, yalnız
    // __CPX_ değeri ve miktarları farklı olan satırlar aynı siparişin PARÇALARIDIR:
    // miktarlar toplanır. Miktarları birebir aynı olan tekrarlar sipariş miktarını
    // tekrar eder; __CPX_ farkı olmayan birebir kimlik tekrarlarında ilk kayıt korunur.
    const cpExtraDiffers = cpExtraHeaders.some(name => {
      const a = current._cpExtra && current._cpExtra[name], b = order._cpExtra && order._cpExtra[name];
      const text = value => value instanceof Date ? String(value.getTime()) : (value == null ? '' : String(value).trim());
      return text(a) !== text(b);
    });
    if (cpExtraDiffers && signatureByOrder.get(current) === dimensionSignature(order)
      && quantityFields.some(field => (Number(current[field]) || 0) !== (Number(order[field]) || 0))) {
      quantityFields.forEach(field => {
        current[field] = (Number(current[field]) || 0) + (Number(order[field]) || 0);
        const header = quantityHeaders[field];
        if (header && current._sourceFields && Object.prototype.hasOwnProperty.call(current._sourceFields, header)) {
          current._sourceFields[header] = current[field];
        }
      });
      if (!Number.isFinite(current.fob) && Number.isFinite(order.fob)) current.fob = order.fob;
    }
    if (order._isMainFabric) {
      if (current._isMainFabric) {
        duplicateMainRows++;
        const detailKey = baseKey || key;
        let detail = duplicateMainDetailByKey.get(detailKey);
        if (!detail) {
          detail = {
            order: current,
            sourceRows: new Set([current._sourceRow].filter(Boolean)),
          };
          duplicateMainDetailByKey.set(detailKey, detail);
        }
        if (order._sourceRow) detail.sourceRows.add(order._sourceRow);
      }
      for (const field of fabricValueFields) {
        const incoming = norm(order[field]);
        if (incoming || !current._isMainFabric) current[field] = incoming;
      }
      current._isMainFabric = true;
    }
    // Aynı sipariş/model/renk birden fazla kumaş satırına çoğaldığında Teknik
    // Resim bağlantısı yalnız sonraki satırda dolu olabilir. İlk dolu ASAS
    // bağlantısını sipariş kimliğinde koru.
    if (!current.technicalImageUrl && order.technicalImageUrl) current.technicalImageUrl = order.technicalImageUrl;
    // Database/Horizon sütunlarının (__CPX_) ve ham kaynak alanlarının değeri de
    // yalnız sonraki tekrar satırında dolu olabilir; ilk satır boşsa ilk dolu
    // değer korunur. Aksi halde ASAS'ta verisi olan sütun CP'de boş görünüyordu.
    for (const bag of ['_cpExtra', '_sourceFields']) {
      const target = current[bag], incoming = order[bag];
      if (!target || !incoming) continue;
      for (const [name, value] of Object.entries(incoming)) {
        if (blankSourceValue(target[name]) && !blankSourceValue(value)) target[name] = value;
      }
    }
  }
  const orders = [...seen.values()].map(order => {
    const out = { ...order };
    delete out._isMainFabric;
    delete out._sourceRow;
    return out;
  });
  const warnings = [];
  const warningDetails = [];
  if (idx['Net Alım Sipariş Miktarı'] == null) {
    // Bu alan bulunamazsa qty=0 olur ve aşağıdaki "qty>0" filtresi (satır ~991)
    // TÜM siparişleri iptal/pasif veri sanıp sessizce eler — kullanıcı hiçbir uyarı
    // görmeden boş bir CP/Backlog ile karşılaşır. Kaynak sütun adı değişmiş/kaldırılmışsa
    // bu görünür olmalı.
    warnings.push('ASAS sonucunda "Net Alım Sipariş Miktarı" alanı bulunamadı; tüm siparişler sıfır miktarlı sayılıp elendi. Field Mapping içinde bu alanı ASAS bağlantısına eşleyin.');
  }
  if (!fabricHeaders.main) {
    warnings.push('ASAS sonucunda "Ana Kumaş Mı" alanı bulunamadı; kumaş bilgileri uygulanmadı. Field Mapping içinde bu alanı ASAS bağlantısına eşleyin.');
  } else {
    const missingDetails = Object.entries(fabricHeaders).filter(([key, value]) => key !== 'main' && !value).map(([key]) => ({
      fabricCategory: 'Kumaş Kategorisi', fabricSupplierCountry: 'Kumaşçı Ülkesi', fabricSupplier: 'Kumaşçı',
      kumasTipi: 'Kumaş Tipi', iplikNo: 'İplik No', fabricWeight: 'Gramaj', karisim: 'Karışım',
    })[key]);
    if (missingDetails.length) warnings.push(`ASAS sonucunda şu kumaş alanları bulunamadı: ${missingDetails.join(', ')}.`);
    const duplicateIdentityCount = duplicateMainDetailByKey.size || duplicateMainRows;
    if (duplicateIdentityCount) {
      const message = `${duplicateIdentityCount} sipariş kimliğinde birden fazla Ana Kumaş Mı = 1 satırı bulundu; ilk kaydın boş alanları sonraki ana kumaş satırıyla tamamlandı.`;
      warnings.push(message);
      warningDetails.push({
        id: 'asas-duplicate-main-fabric',
        message,
        title: 'Birden Fazla Ana Kumaş Kaydı',
        source: 'ASAS',
        columns: [
          { key: 'orderCode', label: 'Sipariş Kod' },
          { key: 'model', label: 'Model Adı' },
          { key: 'colourCode', label: 'Renk Kod' },
          { key: 'manufacturer', label: 'Üretici' },
          { key: 'sourceRows', label: 'ASAS Satırları' },
          { key: 'fabricCategory', label: 'Kumaş Kategorisi' },
          { key: 'fabricSupplierCountry', label: 'Kumaşçı Ülkesi' },
          { key: 'fabricSupplier', label: 'Kumaşçı' },
          { key: 'fabricType', label: 'Kumaş Tipi' },
          { key: 'yarnNo', label: 'İplik No' },
          { key: 'weight', label: 'Gramaj' },
          { key: 'composition', label: 'Karışım' },
        ],
        rows: [...duplicateMainDetailByKey.values()].map(detail => {
          const order = detail.order || {};
          return {
            orderCode: order.ocode == null ? '' : String(order.ocode),
            model: norm(order.model),
            colourCode: norm(order.ccode),
            manufacturer: norm(order.manufacturer),
            sourceRows: [...detail.sourceRows].sort((a, b) => a - b).join(', '),
            fabricCategory: norm(order.fabricCategory),
            fabricSupplierCountry: norm(order.fabricSupplierCountry),
            fabricSupplier: norm(order.fabricSupplier),
            fabricType: norm(order.kumasTipi),
            yarnNo: norm(order.iplikNo),
            weight: norm(order.fabricWeight),
            composition: norm(order.karisim),
          };
        }),
      });
    }
  }
  // Sipariş adeti 0 olan satırlar iptal/pasif veri olarak CP/Backlog'dan elenir.
  const filteredOrders = orders.filter(o => o.qty > 0 && turknorm(o.buyerGrup) !== 'YARDIM');
  const exFactoryInherited = inheritMissingExFactory(filteredOrders);
  return {
    header,
    orders: filteredOrders,
    exFactoryInherited,
    fabricHeaderInfo: {
      source: 'ASAS',
      matchingRule: 'Sipariş Kod + Model Adı + Renk Kod; yalnız Ana Kumaş Mı = 1',
      mainFlagHeader: fabricHeaders.main || '',
      mainRowCount: mainFabricRows,
      ignoredNonMainRows,
      duplicateMainRows: duplicateMainDetailByKey.size || duplicateMainRows,
      duplicateMainSourceRows: duplicateMainRows,
      // Refresh maliyeti ölçümü: ASAS'ın kumaş bileşeni başına çoğalttığı satır
      // sayısı ile tekilleştirilmiş sipariş kimliği sayısı. Oran 1'e yakınsa
      // kumaş sütunlarının sorguya etkisi küçüktür.
      sourceRowCount,
      orderIdentityCount: seen.size,
      rowsPerOrderIdentity: seen.size ? Math.round((sourceRowCount / seen.size) * 100) / 100 : null,
      resolvedHeaders: { ...fabricHeaders },
      warnings,
      warningDetails,
    },
  };
}


/* ASAS bazen aynı PO'nun bir renginde yükleme terminini (Orijinal Exfactory)
   boş verir. Aynı Sipariş Kodu altında tarihi olan renk varsa boş renk o
   tarihi alır (birden çok farklı tarih varsa en erken olanı). Kaynak veri
   sorunu görünür kalsın diye sipariş _exInheritedFrom taşır ve liste döner;
   ASAS'ın kendi değeri (_asasEx) boş bırakılmaz, yerine bu tarih yazılır ki
   revizyon/plan karşılaştırmaları tutarlı kalsın. */
function inheritMissingExFactory(orders) {
  const byCode = new Map();
  for (const o of orders) {
    if (!(o.ex instanceof Date) || Number.isNaN(o.ex.getTime())) continue;
    const key = String(o.ocode);
    const prev = byCode.get(key);
    if (!prev || o.ex < prev.ex) byCode.set(key, o);
  }
  const inherited = [];
  for (const o of orders) {
    if (o.ex instanceof Date && !Number.isNaN(o.ex.getTime())) continue;
    const donor = byCode.get(String(o.ocode));
    if (!donor) continue;
    o.ex = new Date(donor.ex.getTime());
    o._exInheritedFrom = { ccode: donor.ccode, colour: donor.colour };
    inherited.push({ ocode: o.ocode, model: o.model, ccode: o.ccode, fromCcode: donor.ccode, ex: o.ex });
  }
  return inherited;
}

function parseASASWorkbook(wb, ruleValue) {
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = getXLSX().utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null });
  return parseASASMatrix(rows, ruleValue);
}

function parseASASRows(records, ruleValue) {
  return parseASASMatrix(objectRowsToMatrix(records), ruleValue);
}


function parseFabricWorkbook(wb) {
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = getXLSX().utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null });
  const hIdx = findAnchorRow(rows, ['Sipariş Kod'], 30);
  if (hIdx < 0) {
    const error = new Error('ASAS - Fabric dosyasında "Sipariş Kod" sütunu bulunamadı.');
    error.code = 'FABRIC_HEADER_MISSING';
    throw error;
  }
  const header = rows[hIdx].map(h => norm(h));
  const idx = {}; header.forEach((h, i) => { if (h) idx[h] = i; });
  const canon = v => turknorm(v).replace(/[^A-Z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
  const headerKeys = Object.keys(idx);
  const findHeader = patterns => {
    for (const terms of patterns) {
      const hit = headerKeys.find(k => { const c = canon(k); return terms.every(t => c.includes(t)); });
      if (hit) return hit;
    }
    return null;
  };
  const resolved = {
    orderCode: idx['Sipariş Kod'] != null ? 'Sipariş Kod' : findHeader([['SIPARIS','KOD'], ['ORDER','CODE']]),
    model: idx['Model Adı'] != null ? 'Model Adı' : findHeader([['MODEL','AD'], ['MODEL','NAME'], ['STYLE','NAME'], ['URUN','AD']]),
    ccode: idx['Renk Kod'] != null ? 'Renk Kod' : findHeader([['RENK','KOD'], ['COLOUR','CODE'], ['COLOR','CODE']]),
    colour: idx['Renk'] != null ? 'Renk' : (idx['Renk Tanım'] != null ? 'Renk Tanım' : findHeader([['RENK','TANIM'], ['RENK'], ['COLOUR'], ['COLOR']])),
    anaKumasMi: idx['Ana Kumaş Mı'] != null ? 'Ana Kumaş Mı' : findHeader([['ANA','KUMAS','MI'], ['MAIN','FABRIC']]),
    fabricCategory: idx['Kumaş Kategorisi'] != null ? 'Kumaş Kategorisi' : findHeader([['KUMAS','KATEGORI'], ['FABRIC','CATEGORY']]),
    fabricSupplierCountry: idx['Kumaşçı Ülkesi'] != null ? 'Kumaşçı Ülkesi' : findHeader([['KUMASCI','ULKE'], ['FABRIC','SUPPLIER','COUNTRY'], ['MILL','COUNTRY']]),
    fabricSupplier: idx['Kumaşçı'] != null ? 'Kumaşçı' : findHeader([['KUMASCI'], ['FABRIC','SUPPLIER'], ['FABRIC','MILL']]),
    kumasTipi: idx['Kumaş Tipi'] != null ? 'Kumaş Tipi' : findHeader([['KUMAS','TIP'], ['KUMAS','CINS'], ['FABRIC','TYPE']]),
    iplikNo: idx['İplik No'] != null ? 'İplik No' : findHeader([['IPLIK','NO'], ['YARN','COUNT'], ['YARN','NO']]),
    fabricWeight: idx['Gramaj'] != null ? 'Gramaj' : (idx['Kumaş Gramajı'] != null ? 'Kumaş Gramajı' : findHeader([['GRAMAJ'], ['GSM'], ['FABRIC','WEIGHT'], ['GR','M2']])),
    karisim: idx['Karışım'] != null ? 'Karışım' : findHeader([['KARISIM'], ['KOMPOZISYON'], ['COMPOSITION'], ['BLEND']]),
  };
  const required = ['orderCode', 'model', 'ccode', 'anaKumasMi'];
  const missing = Object.keys(resolved).filter(k => !resolved[k]);
  const missingRequired = required.filter(k => !resolved[k]);
  if (missingRequired.length) {
    const error = new Error('ASAS - Fabric dosyasında eşleştirme için "Sipariş Kod", "Model Adı", "Renk Kod" ve "Ana Kumaş Mı" sütunları zorunludur.');
    error.code = 'FABRIC_KEY_HEADER_MISSING';
    error.missing = missingRequired;
    throw error;
  }
  const get = (row, name) => name && idx[name] != null ? row[idx[name]] : null;
  const entries = {};
  let dataRows = 0, mainRows = 0, ignoredNonMainRows = 0, ignoredMissingIdentityRows = 0;
  for (let r = hIdx + 1; r < rows.length; r++) {
    const row = rows[r]; if (!row) continue;
    const rawCode = get(row, resolved.orderCode);
    if (rawCode == null || rawCode === '' || !Number.isFinite(Number(rawCode))) continue;
    dataRows += 1;
    const rawMain = norm(get(row, resolved.anaKumasMi)).replace(',', '.');
    if (Number(rawMain) !== 1) { ignoredNonMainRows += 1; continue; }
    const fabModel = norm(get(row, resolved.model));
    const fabCcode = norm(get(row, resolved.ccode));
    if (!fabModel || !fabCcode) { ignoredMissingIdentityRows += 1; continue; }
    mainRows += 1;
    const colour = norm(get(row, resolved.colour));
    const key = orderLineKey(rawCode, fabModel, fabCcode);
    const incoming = {
      ocode: orderCodeKey(rawCode), model: fabModel, ccode: fabCcode, colour,
      fabricCategory: norm(get(row, resolved.fabricCategory)),
      fabricSupplierCountry: norm(get(row, resolved.fabricSupplierCountry)),
      fabricSupplier: norm(get(row, resolved.fabricSupplier)),
      kumasTipi: norm(get(row, resolved.kumasTipi)),
      iplikNo: norm(get(row, resolved.iplikNo)),
      fabricWeight: norm(get(row, resolved.fabricWeight)),
      karisim: norm(get(row, resolved.karisim)),
    };
    const current = entries[key] || {
      fabricCategory: '', fabricSupplierCountry: '', fabricSupplier: '',
      kumasTipi: '', iplikNo: '', fabricWeight: '', karisim: '',
    };
    // Aynı sipariş-model-renk için birden fazla ana kumaş satırı gelirse boş değerler,
    // daha önce bulunan dolu bilgiyi silmez. Böylece sonuç kaynak sırasından bağımsız kalır.
    entries[key] = {
      ocode: current.ocode || incoming.ocode,
      model: current.model || incoming.model,
      ccode: current.ccode || incoming.ccode,
      colour: current.colour || incoming.colour,
      fabricCategory: current.fabricCategory || incoming.fabricCategory,
      fabricSupplierCountry: current.fabricSupplierCountry || incoming.fabricSupplierCountry,
      fabricSupplier: current.fabricSupplier || incoming.fabricSupplier,
      kumasTipi: current.kumasTipi || incoming.kumasTipi,
      iplikNo: current.iplikNo || incoming.iplikNo,
      fabricWeight: current.fabricWeight || incoming.fabricWeight,
      karisim: current.karisim || incoming.karisim,
    };
  }
  const warnings = [];
  const optionalLabels = {
    fabricCategory: 'Kumaş Kategorisi', fabricSupplierCountry: 'Kumaşçı Ülkesi',
    fabricSupplier: 'Kumaşçı', kumasTipi: 'Kumaş Tipi', iplikNo: 'İplik No',
    fabricWeight: 'Gramaj', karisim: 'Karışım',
  };
  Object.entries(optionalLabels).forEach(([key, label]) => {
    if (!resolved[key]) warnings.push(`ASAS - Fabric dosyasında "${label}" sütunu bulunamadı.`);
  });
  if (ignoredMissingIdentityRows) warnings.push(`${ignoredMissingIdentityRows} ana kumaş satırı Model Adı veya Renk Kod boş olduğu için eşleştirilmedi.`);
  const populatedEntryCount = Object.values(entries)
    .filter(entry => entry.fabricCategory || entry.fabricSupplierCountry || entry.fabricSupplier || entry.kumasTipi || entry.iplikNo || entry.fabricWeight || entry.karisim)
    .length;
  return {
    entries,
    meta: {
      header, resolved, missing, dataRows, mainRows, ignoredNonMainRows, ignoredMissingIdentityRows,
      entryCount: populatedEntryCount,
      keyedRowCount: Object.keys(entries).length,
      matchingRule: 'Sipariş Kod + Model Adı + Renk Kod; yalnız Ana Kumaş Mı = 1',
      warnings,
    },
  };
}

// Yeni kumaş kayıtları yalnız Sipariş Kod + Model Adı + Renk Kod üçlüsüyle yazılır.
// Eski sürümlerde kaydedilmiş gevşek anahtarlar, mevcut kullanıcı verisini kaybetmemek
// için yalnız okuma sırasında geriye dönük uyumluluk olarak tutulur.
const FABRIC_LOOKUP_CACHE = new WeakMap();
function buildFabricLookup(entries) {
  const cached = FABRIC_LOOKUP_CACHE.get(entries);
  if (cached) return cached;
  const byLine = new Map(), byOrderCcode = new Map(), byOrderColour = new Map();
  for (const [key, value] of Object.entries(entries)) {
    if (!value || typeof value !== 'object') continue;
    const parts = String(key).split('|');
    const code = orderCodeKey(value.ocode != null ? value.ocode : parts[0]);
    if (!code) continue;
    const model = norm(value.model), ccode = norm(value.ccode), colour = norm(value.colour);
    if (model && ccode && !byLine.has(orderLineKey(code, model, ccode))) byLine.set(orderLineKey(code, model, ccode), value);
    if (ccode && !byOrderCcode.has(`${code}|${turknorm(ccode)}`)) byOrderCcode.set(`${code}|${turknorm(ccode)}`, value);
    const colourKey = `${code}|${turknorm(colour || parts.slice(1).join('|'))}`;
    if (!byOrderColour.has(colourKey)) byOrderColour.set(colourKey, value);
  }
  const lookup = { byLine, byOrderCcode, byOrderColour };
  FABRIC_LOOKUP_CACHE.set(entries, lookup);
  return lookup;
}
function findFabricEntry(entries, order) {
  const code = orderCodeKey(order && order.ocode);
  if (!code) return null;
  const lookup = buildFabricLookup(entries);
  const model = norm(order.model), ccode = norm(order.ccode);
  const lineIdentified = entry => !!(entry && norm(entry.model) && norm(entry.ccode));
  if (model && ccode) {
    const hit = lookup.byLine.get(orderLineKey(code, model, ccode));
    if (hit) return hit;
    const byCcode = lookup.byOrderCcode.get(`${code}|${turknorm(ccode)}`);
    if (byCcode && !lineIdentified(byCcode) && !antrepoEntryConflicts(byCcode, { model, ccode })) return byCcode;
    const byColour = lookup.byOrderColour.get(`${code}|${turknorm(order.colour)}`);
    if (byColour && !lineIdentified(byColour) && !antrepoEntryConflicts(byColour, { model, ccode })) return byColour;
    return null;
  }
  if (ccode) {
    const hit = lookup.byOrderCcode.get(`${code}|${turknorm(ccode)}`);
    if (hit && !antrepoEntryConflicts(hit, { model, ccode })) return hit;
  }
  const loose = lookup.byOrderColour.get(`${code}|${turknorm(order.colour)}`);
  return (loose && !antrepoEntryConflicts(loose, { model, ccode })) ? loose : null;
}

const FABRIC_VALUE_FIELDS = ['fabricCategory', 'fabricSupplierCountry', 'fabricSupplier', 'kumasTipi', 'iplikNo', 'fabricWeight', 'karisim'];
function fabricValuesFrom(entry) {
  const source = entry && typeof entry === 'object' ? entry : {};
  return Object.fromEntries(FABRIC_VALUE_FIELDS.map(key => [key, norm(source[key])]));
}
function applyFabricEntries(orders, entries) {
  const source = entries && typeof entries === 'object' ? entries : {};
  return (Array.isArray(orders) ? orders : []).map(order => ({
    ...order,
    ...fabricValuesFrom(findFabricEntry(source, order)),
  }));
}
function applyFabricEntriesToLflRows(rows, entries) {
  const source = entries && typeof entries === 'object' ? entries : {};
  const fabricStoreIsAuthoritative = Object.keys(source).length > 0;
  return (Array.isArray(rows) ? rows : []).map(row => {
    const existing = {
      fabricCategory: row && row.fabricCategory,
      fabricSupplierCountry: row && row.fabricSupplierCountry,
      fabricSupplier: row && row.fabricSupplier,
      kumasTipi: row && (row.kumasTipi || row.fabricType),
      iplikNo: row && (row.iplikNo || row.yarnCount),
      fabricWeight: row && row.fabricWeight,
      karisim: row && (row.karisim || row.fabricBlend),
    };
    const hit = findFabricEntry(source, {
      ocode: row && row.orderCode,
      model: row && row.modelName,
      ccode: row && (row.colourCode || row.ccode),
      colour: row && row.colour,
    });
    // Ayrı kumaş kaynağı yüklüyse tek otorite odur: tam üçlü kimlikte Ana Kumaş Mı=1
    // kaydı bulunmayan LFL satırında, ASAS/LFL satırından kalmış olabilecek yan kumaş
    // değerleri korunmaz. Kumaş kaynağı hiç yoksa doğrudan LFL dosyasındaki alanlar
    // geriye dönük uyumluluk için kullanılmaya devam eder.
    const values = hit ? fabricValuesFrom(hit) : fabricValuesFrom(fabricStoreIsAuthoritative ? null : existing);
    return { ...row, ...values };
  });
}

// Antrepo sütunlarının çözümlenmesi.
//
// v4.10'a kadar sütunlar BİREBİR ada göre aranıyordu (`idx['Renk Tanım']` gibi) ve
// başlık bir harf bile farklıysa ("Renk Tanımı", "Sipariş Kodu", "Renk") anahtar
// satırı hiç bulunamıyor, fonksiyon SESSİZCE boş harita döndürüyordu. Boş harita =
// CP'deki bütün siparişlerin "Üretimde" fallback'ine düşmesi, üstelik tek bir uyarı
// bile üretmeden. Artık: önce birebir ad, sonra takma ad, sonra içerme denenir ve
// sonuç ne olursa olsun teşhis bilgisi haritaya iliştirilir.
const ANTREPO_COLUMN_RULES = {
  importFile: {
    exact: ['İthalat Dosya No'],
    aliases: ['ITHALATDOSYANO', 'IMPORTFILENO', 'IMPORTFILENUMBER', 'DOSYANO'],
    contains: ['ITHALATDOSYA', 'IMPORTFILE'],
  },
  containerNo: {
    exact: ['Konteyner No'],
    aliases: ['KONTEYNERNO', 'KONTEYNUMARASI', 'CONTAINERNO', 'CONTAINERNUMBER'],
    contains: ['KONTEYNER', 'CONTAINER'],
  },
  // Gemi Ad, model-fields.js antrepo kataloğundaki 'IAS Parsiyel Kimliği'
  // alanıdır (takma adlar aynı liste). Zorunlu değildir; yalnız parsiyelin
  // hangi gemide taşındığını Global Flow gibi tüketicilere taşır.
  vesselName: {
    exact: ['Gemi Ad'],
    aliases: ['GEMIAD', 'GEMIADI', 'VESSELNAME', 'SHIPNAME'],
    contains: ['GEMIAD', 'VESSELNAME', 'SHIPNAME'],
  },
  ocode: {
    exact: ['Sipariş Kod'],
    aliases: ['SIPARISKOD', 'SIPARISKODU', 'SIPARISNO', 'ORDERCODE', 'ORDERNO', 'ORDERNUMBER'],
    contains: ['SIPARISKOD', 'ORDERCODE'],
    required: true,
  },
  model: {
    // IAS tarafında bu sütunun adı 'Ürün Adı'dır (ASAS'ta 'Model Adı'). Sorgu
    // çıktısı yeniden adlandırılmadan geldiğinde de tanınması gerekir.
    exact: ['Model Adı', 'Ürün Adı', 'Ürün Ad'],
    aliases: ['MODELADI', 'MODELADI2', 'MODELNAME', 'MODEL', 'STYLENAME', 'URUNADI', 'PRODUCTNAME'],
    contains: ['MODELADI', 'MODELNAME', 'STYLENAME', 'URUNADI'],
    required: true,
  },
  ccode: {
    exact: ['Renk Kod'],
    aliases: ['RENKKOD', 'RENKKODU', 'COLOURCODE', 'COLORCODE'],
    contains: ['RENKKOD', 'COLOURCODE', 'COLORCODE'],
    required: true,
  },
  colour: {
    exact: ['Renk Tanım'],
    aliases: ['RENKTANIM', 'RENKTANIMI', 'RENKACIKLAMA', 'RENK', 'COLOUR', 'COLOR', 'COLOURDESCRIPTION', 'COLORDESCRIPTION'],
    contains: ['RENKTANIM', 'RENKACIKLAMA', 'COLOURDESC', 'COLORDESC'],
    // "Renk Kod" rengin kendisi değildir; renk sütunu ararken dışlanır.
    exclude: ['KOD', 'CODE'],
  },
  statu: {
    exact: ['Supplier Portal Statü'],
    aliases: ['SUPPLIERPORTALSTATU', 'SUPPLIERPORTALSTATUS', 'PORTALSTATU', 'STATU', 'STATUS', 'GUNCELDURUM', 'DURUM'],
    contains: ['PORTALSTAT', 'STATU', 'STATUS', 'DURUM'],
    required: true,
  },
  arr: {
    exact: ['Tahmini Antrepo Giriş Tarihi'],
    aliases: ['TAHMINIANTREPOGIRISTARIHI', 'ANTREPOGIRISTARIHI', 'ESTIMATEDARRIVALDATE', 'ESTIMATEDARRIVAL'],
    contains: ['ANTREPOGIRIS', 'ESTIMATEDARRIVAL', 'ARRIVALDATE'],
  },
  handover: {
    exact: ['HANDOVER Tarihi'],
    aliases: ['HANDOVERTARIHI', 'HANDOVERDATE', 'HANDOVER'],
    contains: ['HANDOVER'],
  },
  vasita: {
    exact: ['Vasita Tanim'],
    aliases: ['VASITATANIM', 'VASITA', 'VEHICLE', 'TASIMASEKLI', 'SEVKSEKLI', 'DELIVERYTYPE'],
    contains: ['VASITA', 'VEHICLE', 'TASIMA'],
  },
  loadedQty: {
    exact: ['Yükleme Toplam Adet'],
    aliases: ['YUKLEMETOPLAMADET', 'YUKLENENTOPLAMADET', 'LOADINGTOTALQUANTITY', 'LOADEDQUANTITY', 'SHIPMENTQUANTITY'],
    contains: ['YUKLEMETOPLAMADET', 'YUKLENENTOPLAM', 'LOADEDQUANTITY', 'SHIPMENTQUANTITY'],
  },
  iasOrderQty: {
    exact: ['Net Alım Sipariş Miktarı'],
    aliases: ['NETALIMSIPARISMIKTARI', 'ORDERQUANTITY'],
    contains: ['NETALIMSIPARISMIKTARI', 'ORDERQUANTITY'],
  },
};

function antrepoHeaderKey(value) {
  return turknorm(value).replace(/[^A-Z0-9]+/g, '');
}

// Bir kural için başlık listesinden en uygun sütunu seçer. Sıra önemlidir:
// birebir ad > takma ad > içerme. Belirsizlik olduğunda ilk sütun kazanır.
function resolveAntrepoColumn(header, rule) {
  for (const name of rule.exact || []) {
    const at = header.indexOf(name);
    if (at >= 0) return at;
  }
  const keys = header.map(antrepoHeaderKey);
  const blocked = (index) => (rule.exclude || []).some(word => keys[index].includes(word));
  for (const alias of rule.aliases || []) {
    for (let i = 0; i < keys.length; i++) {
      if (keys[i] === alias && !blocked(i)) return i;
    }
  }
  for (const part of rule.contains || []) {
    for (let i = 0; i < keys.length; i++) {
      if (keys[i].includes(part) && !blocked(i)) return i;
    }
  }
  return -1;
}

// Anahtar satırı: katı kimlik alanlarının üçü de çözülebilen ilk satır.
function findAntrepoHeaderRow(rows, maxScan, ruleValue = null) {
  const config = matchRuleOf(ruleValue);
  const usesColourDescription = config.conditions.some(condition => condition.normalization === 'colour');
  for (let i = 0; i < Math.min(rows.length, maxScan || 25); i++) {
    const header = (rows[i] || []).map(cell => norm(cell));
    if (!header.some(Boolean)) continue;
    const ocodeAt = resolveAntrepoColumn(header, ANTREPO_COLUMN_RULES.ocode);
    const modelAt = resolveAntrepoColumn(header, ANTREPO_COLUMN_RULES.model);
    const colourAt = resolveAntrepoColumn(header, usesColourDescription ? ANTREPO_COLUMN_RULES.colour : ANTREPO_COLUMN_RULES.ccode);
    if (ocodeAt >= 0 && modelAt >= 0 && colourAt >= 0) return i;
  }
  return -1;
}

// Teşhis bilgisi haritaya SAYILMAYAN (non-enumerable) bir alan olarak iliştirilir;
// böylece Object.keys/entries ile dönen mevcut kodların hiçbiri etkilenmez.
function attachAntrepoMeta(map, meta) {
  Object.defineProperty(map, '__antrepoMeta', { value: meta, enumerable: false, configurable: true });
  return map;
}
function antrepoParseMeta(map) {
  return (map && typeof map === 'object' && map.__antrepoMeta) || null;
}

function parseAntrepoMatrix(rows, ruleValue) {
  const list = Array.isArray(rows) ? rows : [];
  const activeConfig = matchRuleOf(ruleValue);
  const usesColourDescription = activeConfig.conditions.some(condition => condition.normalization === 'colour');
  const hIdx = findAntrepoHeaderRow(list, 25, activeConfig);
  if (hIdx < 0) {
    const firstRow = (list[0] || []).map(cell => norm(cell)).filter(Boolean);
    const colourLabel = usesColourDescription ? 'Renk Tanım' : 'Renk Kod';
    return attachAntrepoMeta({}, {
      ok: false, rowCount: Math.max(0, list.length - 1), dataRows: 0,
      columns: firstRow, resolved: {}, missing: ['Sipariş Kod', 'Model Adı / Ürün Adı', colourLabel],
      reason: `IAS sonucunda katı eşleştirme için Sipariş Kod, Ürün Adı/Model Adı ve ${colourLabel} sütunları birlikte bulunamadı.`,
    });
  }
  const header = list[hIdx].map(h => norm(h));
  const at = {};
  const resolved = {};
  const missing = [];
  for (const [field, rule] of Object.entries(ANTREPO_COLUMN_RULES)) {
    const index = resolveAntrepoColumn(header, rule);
    at[field] = index;
    if (index >= 0) resolved[field] = header[index];
    else if (rule.required && !(usesColourDescription && field === 'ccode')) missing.push((rule.exact || [field])[0]);
  }
  const cell = (row, field) => (at[field] >= 0 ? row[at[field]] : null);
  // Bazı kaynaklarda ayrı bir "Renk Kod" sütunu yoktur; yalnız "Model Kod - Renk
  // Kod" gibi birleşik bir sütun bulunur. "RENKKOD" alt dizisini içerdiği için
  // içerme kuralı bu sütunu ccode olarak seçer, ama ham hücre değeri
  // "MODELKODU-RENKKODU" biçimindedir. Saf Renk Kod'u izole etmek için son
  // tireden sonraki kısım alınır; birebir/takma ad eşleşen gerçek Renk Kod
  // sütunları bundan etkilenmez.
  const ccodeHeaderKey = at.ccode >= 0 ? antrepoHeaderKey(header[at.ccode]) : '';
  const ccodeIsModelColourCompound = ccodeHeaderKey.includes('MODEL') && ccodeHeaderKey.includes('RENKKOD');
  const extractCcode = row => {
    const raw = norm(cell(row, 'ccode'));
    if (ccodeIsModelColourCompound && raw && raw.includes('-')) return raw.slice(raw.lastIndexOf('-') + 1).trim();
    return raw;
  };
  const cpExtraHeaders = header.filter(name => /^__CPX_/i.test(name));
  const cpExtraIdx = cpExtraHeaders.map(name => [name, header.indexOf(name)]);
  const matchHeaders = header.filter(name => /^__MATCH_/i.test(name));
  const matchIdx = matchHeaders.map(name => [name.replace(/^__MATCH_/i, ''), header.indexOf(name)]);
  const matchSourceHeaders = [...new Set(activeConfig.conditions
    .map(condition => condition.ias.canonicalHeader || condition.ias.header)
    .filter(name => name && header.includes(name)))];

  const map = Object.create(null);
  let dataRows = 0;
  let blankStatus = 0;
  let blankLoadedQty = 0;
  let blankIasOrderQty = 0;
  const blankLoadedQtyRows = [];
  const blankIasOrderQtyRows = [];
  const warningDetailLimit = 5000;
  let partialIdentityRows = 0;
  let blankPartialIdentity = 0;
  // Kaç satırda üçlü anahtar (sipariş + model + renk kodu) kurulabildi? Bu sayı
  // sıfırsa IAS eşlemesinde Model Adı / Renk Kod alanları seçilmemiş demektir.
  let lineKeyRows = 0;
  let matchableRows = 0;
  // Statü dağılımı: hangi Supplier Portal Statü değerlerinin modelden GERÇEKTEN
  // geldiğini gösterir. Bir statü burada hiç görünmüyorsa sorun eşleştirmede
  // değil, sorgunun o satırları hiç getirmemesindedir (ufuk koşulu ya da
  // SUMMARIZECOLUMNS'ın ilişkisiz satırları elemesi).
  const statusCounts = new Map();
  for (let r = hIdx + 1; r < list.length; r++) {
    const row = list[r]; if (!row) continue;
    const oc = cell(row, 'ocode');
    if (oc == null || oc === '') continue;
    dataRows++;
    const importFile = norm(cell(row, 'importFile'));
    const containerNo = norm(cell(row, 'containerNo'));
    const vesselName = norm(cell(row, 'vesselName'));
    const colour = norm(cell(row, 'colour'));
    const model = norm(cell(row, 'model'));
    const ccode = extractCcode(row);
    const statu = norm(cell(row, 'statu'));
    if (!statu) blankStatus++;
    if (model && (usesColourDescription ? colour : ccode)) lineKeyRows++;
    const statusLabel = statu || '(boş)';
    statusCounts.set(statusLabel, (statusCounts.get(statusLabel) || 0) + 1);
    const arr = at.arr >= 0 ? parseDateFlexible(cell(row, 'arr')) : null;
    const handover = at.handover >= 0 ? parseDateFlexible(cell(row, 'handover')) : null;
    const vasita = norm(cell(row, 'vasita'));
    const loadedRaw = cell(row, 'loadedQty');
    const loadedQty = loadedRaw == null || loadedRaw === '' ? null : Number(loadedRaw);
    const loadedQtyInvalid = !(Number.isFinite(loadedQty) && loadedQty >= 0);
    if (loadedQtyInvalid) blankLoadedQty++;
    const iasOrderQtyRaw = cell(row, 'iasOrderQty');
    const iasOrderQty = iasOrderQtyRaw == null || iasOrderQtyRaw === '' ? null : Number(iasOrderQtyRaw);
    const iasOrderQtyInvalid = at.iasOrderQty >= 0 && !(Number.isFinite(iasOrderQty) && iasOrderQty > 0);
    if (iasOrderQtyInvalid) blankIasOrderQty++;
    const warningRow = () => ({
      sourceRow: r + 1,
      orderCode: oc == null ? '' : String(oc),
      model,
      colourCode: ccode,
      colour,
      status: statu,
      importFile,
      containerNo,
      vehicle: vasita,
      estimatedArrival: arr ? yyyymmdd(arr) : '',
      loadedQty: loadedRaw == null ? '' : String(loadedRaw),
      iasOrderQty: iasOrderQtyRaw == null ? '' : String(iasOrderQtyRaw),
    });
    if (loadedQtyInvalid && blankLoadedQtyRows.length < warningDetailLimit) blankLoadedQtyRows.push(warningRow());
    if (iasOrderQtyInvalid && blankIasOrderQtyRows.length < warningDetailLimit) blankIasOrderQtyRows.push(warningRow());
    const incoming = {
      ocode: orderCodeKey(oc), _matchOcode: exactOrderCodeKey(oc), colour, model, ccode,
      importFile, containerNo, vesselName,
      statu, arr, vasita, handover,
      loadedQty: Number.isFinite(loadedQty) && loadedQty >= 0 ? loadedQty : null,
      iasOrderQty: Number.isFinite(iasOrderQty) && iasOrderQty > 0 ? iasOrderQty : null,
      _ord: arr ? arr.getTime() : -1,
      _sourceRow: r,
      _cpExtra: Object.fromEntries(cpExtraIdx.map(([name, index]) => [name, index >= 0 ? row[index] : null])),
      _sourceValues: Object.fromEntries(matchSourceHeaders.map(name => [name, row[header.indexOf(name)]])),
      _sourceFields: Object.fromEntries(header.map((name, index) => [name, row[index]]).filter(([name]) => !!name)),
      _matchValues: Object.fromEntries(matchIdx.map(([id, index]) => [id, index >= 0 ? row[index] : null])),
    };
    const dynamicKey = dynamicAntrepoMatchKey(incoming, 'ias', activeConfig);
    // Seçili koşullardan biri boşsa bu IAS satırı hiçbir ASAS satırına bağlanamaz.
    if (!dynamicKey) continue;
    matchableRows++;

    // Her model sonuç satırı tek başına bir IAS parsiyelidir. İthalat Dosya No
    // veya Konteyner No aynı olsa bile satırlar farklı yükleme taleplerini/miktarları
    // temsil edebilir; burada hiçbir tekilleştirme ya da alan birleştirme yapılmaz.
    // Gerçek satır granülü sorgu katmanında fact tablo üzerinden korunur.
    if (importFile) partialIdentityRows++;
    else blankPartialIdentity++;

    // Harita anahtarı eşleşme anahtarı değildir; yalnız kaynak satır kimliğidir.
    // Böylece aynı Sipariş Kod + Ürün Ad + Renk Kod üçlüsündeki bütün satırlar,
    // hatta diğer alanları tamamen aynı olsa bile, bağımsız parsiyel olarak korunur.
    // Null-prototype harita ve kaynak satır numarası, __proto__/constructor gibi
    // özel nesne anahtarlarından kaynaklanabilecek satır kaybını da engeller.
    map[`__ias_row_${r}`] = incoming;
  }
  return attachAntrepoMeta(map, {
    ok: !missing.length, rowCount: Math.max(0, list.length - hIdx - 1), dataRows,
    keyCount: Object.keys(map).length, blankStatus, blankLoadedQty, blankIasOrderQty,
    iasOrderQtyColumnPresent: at.iasOrderQty >= 0, lineKeyRows, matchableRows,
    pivotIdentityFillCount: 0,
    partialIdentityRows, blankPartialIdentity,
    warningDetailRows: {
      blankLoadedQty: blankLoadedQtyRows,
      blankIasOrderQty: blankIasOrderQtyRows,
      limit: warningDetailLimit,
    },
    statusCounts: [...statusCounts.entries()].sort((a, b) => b[1] - a[1]),
    columns: header.filter(Boolean), resolved, missing,
    reason: missing.length ? `Zorunlu Antrepo sütunları çözülemedi: ${missing.join(', ')}.` : '',
  });
}

function parseAntrepoWorkbook(wb, ruleValue) {
  const sheetName = wb.SheetNames.find(n => /antrepo/i.test(n)) || wb.SheetNames[0];
  const rows = getXLSX().utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, raw: true, defval: null });
  return parseAntrepoMatrix(rows, ruleValue);
}

function parseAntrepoRows(records, ruleValue) {
  return parseAntrepoMatrix(objectRowsToMatrix(records), ruleValue);
}


// Not: orijinal tarayıcı sürümünde bu fonksiyon global `state.overrides`'a yazıyordu.
// Burada saf hale getirdik: submap/suppfobmap'i döndürür, çağıran taraf overrides'a uygular.
function parseCPUpdateWorkbook(wb) {
  const sheetName = wb.SheetNames[0];
  const rows = getXLSX().utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, raw: true, defval: null });
  const hIdx = findAnchorRow(rows, ['Supplier', 'PO'], 10);
  if (hIdx < 0) return { sub: 0, fob: 0, submap: {}, suppfobmap: {} };
  const header = rows[hIdx].map(h => norm(h));
  const idx = {}; header.forEach((h, i) => { if (h) idx[h] = i; });
  let nsub = 0, nfob = 0;
  const submap = {}, suppfobmap = {};
  for (let r = hIdx + 1; r < rows.length; r++) {
    const row = rows[r]; if (!row) continue;
    const supplier = idx['Supplier'] != null ? norm(row[idx['Supplier']]) : '';
    const mfob = idx['Manufacturer FOB'] != null ? Number(row[idx['Manufacturer FOB']]) : null;
    [idx['PO'], idx['PO2']].forEach(ci => {
      if (ci == null) return;
      const oc = row[ci]; if (oc == null || oc === '') return;
      const ocN = Math.trunc(Number(oc));
      if (supplier) { submap[ocN] = supplier; nsub++; }
      if (mfob != null && !isNaN(mfob)) { suppfobmap[ocN] = roundHalfUp(mfob, 2); nfob++; }
    });
  }
  return { sub: nsub, fob: nfob, submap, suppfobmap };
}

// ELLE REVİZE EDİLEN TARİHLER.
//
// CP'de Ex-factory / Retail / In-Store elle revize edilebiliyor. v4.15'e kadar bu
// revizyon yalnız tarayıcıda yaşıyordu ve her yenilemede kayboluyordu. Artık
// overrides.datemap'te kalıcı: model yenilemesi ASAS'tan gelen tarihi getirse de
// revize değer korunur.
//
// ASAS'tan gelen ORİJİNAL tarih siparişin üstünde _asasEx/_asasRetail/_asasMb
// olarak saklanır. Hem "eski → yeni" gösterimi hem de Ex-Factory renklendirmesi
// (geçmiş / bu hafta / gelecek hafta) her zaman bu orijinal değere bakar.
const DATE_OVERRIDE_TARGETS = [['ex', '_asasEx'], ['retail', '_asasRetail'], ['mb', '_asasMb']];

function applyDateOverrides(orders, overrides) {
  const map = overrides && overrides.datemap;
  const list = Array.isArray(orders) ? orders : [];
  if (!map || typeof map !== 'object') return list;
  return list.map(order => {
    const record = overrideGet(map, order);
    if (!record || typeof record !== 'object') return order;
    const next = {
      ...order,
      _asasEx: parseDateOnly(order.ex) || null,
      _asasRetail: parseDateOnly(order.retail) || null,
      _asasMb: parseDateOnly(order.mb) || null,
    };
    let touched = false;
    for (const [field, _baselineKey] of DATE_OVERRIDE_TARGETS) {
      if (!Object.prototype.hasOwnProperty.call(record, field)) continue;
      const parsed = parseDateFlexible(record[field]);
      if (!parsed) continue;
      next[field] = parsed;
      touched = true;
    }
    return touched ? next : order;
  });
}

// Sipariş üstündeki ASAS orijinali; revizyon yoksa geçerli değerin kendisidir.
// Sonuç her zaman gün bazına indirgenir: saat bileşeni taşıyan bir tarih JSON'a
// çevrilirken yerel saate göre bir gün kayabiliyor ve "eski → yeni" farkı ile
// hücre boşaltılınca geri konan değer bir gün sapıyordu.
function asasBaseline(order, field, baselineKey) {
  const value = Object.prototype.hasOwnProperty.call(order, baselineKey) ? order[baselineKey] : order[field];
  return parseDateOnly(value) || null;
}

function computeFlags(row, transitRules, todayValue = new Date()) {
  return BLBusinessRules.computePriorityFlags({
    exFactory: row['Ex-factory'],
    retailDate: row['Retail Date'],
    inStoreDate: row['In-Store (Model Budget)'],
    antArrival: row['Ant. Arrival'],
    handoverDate: row['HANDOVER Tarihi'],
    shipConfirmationDate: row['Buying Son Onay Tarihi'],
    // Eksik Yükleme üretimde değildir. Ortak operasyonel signal motoru bu
    // statüyü, siparişin tamamı ASAS Ex-Factory tarihinde yüklenmiş varsayımıyla hesaplar.
    status: row['STATUS'],
    shortage: Number(row._logisticShortageQty) > 0,
    shortageQty: row._logisticShortageQty,
    shortageNote: Number(row._logisticShortageQty) > 0 && row._logisticAllPartialsInWarehouse === true,
    delType: row['Del. Type'],
    season: row.Season,
    country: row.Country,
    rules: transitRules,
    today: todayValue,
  }, dateOrdinal);
}
function applyFormulas(row, transitRules, includePriority = true) {
  const cf = computeFlags(row, transitRules);
  // CP/Orders Priority artık legacy operational warning text değildir.
  // Sunucu base/system Action Priority üretir; browser kişisel checklist/custom
  // rule overlay'ini aynı cp-readiness motorunun üstünde uygular.
  const decision = includePriority ? BLCpReadinessEngine.analyzeOrder(row, {
    transitRules: Array.isArray(transitRules) ? transitRules : [],
    today: dateOrdinal(new Date()),
    dateOrdinal,
  }) : null;
  if(includePriority)row['Priority'] = decision && decision.priority ? decision.priority : 'ON_TRACK';
  else delete row['Priority'];
  row['Ex→Retail'] = cf.exr == null ? '' : cf.exr;
  // LT (OPD → Ex-Factory) de CP/Orders payload'ının gerçek türev alanıdır.
  // İstemcide hesaplanıyor olsa da sunucudan boş gelmesi revizyon karşılaştırmasında
  // “eski→—” gibi sahte bir fark oluşturabiliyordu.
  const opd = parseDateOnly(row['OPD']);
  const exf = parseDateOnly(row['Ex-factory']);
  row['LT'] = opd && exf ? daysBetween(opd, exf) : '';
  return { ...cf, actionPriority: row['Priority'], decision };
}

const RETAIL_WAITING_THRESHOLD_RATE = 0.05;

// "Kalan Alım Sipariş Miktarı_Merkez Sevke Hazır Depo" henüz antrepoya hiç
// girmemiş miktarı ("Kalan Alım Sipariş Miktarı": üretim / eksik yükleme) da
// içerir. Retaile aktarım bekleyen miktar yalnız antrepoya girmiş ama merkez
// sevke hazır depoya geçmemiş kısımdır: Kalan_Merkez − Kalan Alım. Aksi halde
// yalnız eksik yüklemesi kalan bir siparişin (ör. 1289816: 465 − 465 = 0)
// Depoda parsiyelleri yanlışlıkla Retaile Aktarım Bekleniyor oluyordu.
function retailWaitingQty(order) {
  const readyDepotRemainingQty = Math.max(0, Number(order && order.merkezSevkeHazirKalan) || 0);
  const notArrivedQty = Math.max(0, Number(order && order.kalan) || 0);
  return Math.max(0, readyDepotRemainingQty - notArrivedQty);
}

function shouldWaitForRetail(order) {
  const orderQty = Math.max(0, Number(order && order.qty) || 0);
  return orderQty > 0 && retailWaitingQty(order) > orderQty * RETAIL_WAITING_THRESHOLD_RATE;
}

function deriveOperationalStatus(baseStatus, order) {
  let status = baseStatus || '';
  // Yalnız IAS'ta Depoda görünen siparişler için ASAS database alanı değerlendirilir.
  // Retaile aktarım bekleyen miktar (Kalan_Merkez − Kalan Alım) sipariş toplamının
  // %5'inden BÜYÜKSE sipariş henüz retaile aktarılamamıştır. Eşik tam %5 ise
  // Depoda statüsü korunur. Bu kural sentetik Üretimde satırı oluşturmaz.
  if (turknorm(status) === 'DEPODA' && shouldWaitForRetail(order)) {
    status = 'Retaile Aktarım Bekleniyor';
  }
  return status;
}

// CP Logistic görünümü, Backlog ile aynı parsiyel veri modelini kullanır fakat CP'nin
// tek sipariş satırı yapısını bozmaz. Segmentler ana satıra özet olarak bağlanır ve
// arayüzde açıldığında ayrı detay satırları hâlinde gösterilir.
//
// Öncelik sırası kullanıcı kuralıdır:
//   1) Üretimde kalan miktar + Ex-Factory'den hesaplanan antrepo tarihi
//   2) Üretimi bitmiş fakat henüz depoya ulaşmamış IAS parsiyelleri
//   3) Depoda / Retaile Aktarım Bekleniyor parsiyelleri
function cpLogisticPriority(segment) {
  if (!segment || segment._segmentKind === 'production' || segment._segmentKind === 'shortage' || antrepoStatusKey(segment._status) === 'URETIMDE' || isShortageStatus(segment._status)) return 1;
  const statusKey = antrepoStatusKey(segment._status);
  if (statusKey === 'DEPODA' || statusKey === 'RETAILE AKTARIM BEKLENIYOR') return 3;
  return 2;
}
// Eski çalışma zamanı anlık görüntülerinde (vesselName alanı eklenmeden önce
// parse edilmiş IAS satırları) gemi adı _sourceFields başlıklarından aynı
// ANTREPO_COLUMN_RULES.vesselName kuralıyla çözülür; paralel eşleme yoktur.
function antrepoVesselName(ias) {
  if (!ias) return '';
  if (ias.vesselName != null) return norm(ias.vesselName) || '';
  const fields = ias._sourceFields && typeof ias._sourceFields === 'object' ? ias._sourceFields : null;
  if (!fields) return '';
  const headers = Object.keys(fields).map(name => norm(name));
  const at = resolveAntrepoColumn(headers, ANTREPO_COLUMN_RULES.vesselName);
  return at >= 0 ? (norm(fields[Object.keys(fields)[at]]) || '') : '';
}
function cpLogisticSegmentsForOrder(segments) {
  const source = Array.isArray(segments) ? segments : [];
  return source.slice().sort((a, b) => {
    const priorityDiff = cpLogisticPriority(a) - cpLogisticPriority(b);
    if (priorityDiff) return priorityDiff;
    const aDate = dateOrdinal(a && a._arr), bDate = dateOrdinal(b && b._arr);
    if (aDate != null || bDate != null) {
      if (aDate == null) return 1;
      if (bDate == null) return -1;
      if (aDate !== bDate) return aDate - bDate;
    }
    return (Number(a && a._segmentIndex) || 0) - (Number(b && b._segmentIndex) || 0);
  }).map(segment => {
    const ias = segment && segment._iasRow ? segment._iasRow : null;
    return {
      id: `${segment && segment._segmentKind === 'production' ? 'production' : (segment && segment._segmentKind === 'shortage' ? 'shortage' : 'partial')}-${Number(segment && segment._segmentIndex) || 0}`,
      kind: segment && segment._segmentKind === 'production' ? 'production' : (segment && segment._segmentKind === 'shortage' ? 'shortage' : 'partial'),
      partialNo: segment && segment._segmentKind === 'ias' ? (Number(segment._segmentIndex) || 0) + 1 : null,
      // Buyer Log'un IAS kaydı olmadan açtığı bakiye satırı. 'warehouse' (ASAS'ta
      // kapanmış bakiye) adet hesaplarında depoya ulaşmış sayılır, bu yüzden kind
      // 'partial' kalır; ama bir IAS parsiyeli DEĞİLDİR ve öyle etiketlenmemelidir.
      synthetic: syntheticSegmentKind(segment),
      userShortage: Boolean(segment && segment._userShortage),
      priority: cpLogisticPriority(segment),
      quantity: Math.max(0, Number(segment && segment.qty) || 0),
      status: norm(segment && segment._status) || 'Durum Belirsiz',
      arrival: toDateOnly(segment && segment._arr) || null,
      delType: norm(segment && segment._delType),
      handover: ias ? (toDateOnly(ias.handover) || null) : null,
      sourceRow: ias && Number.isFinite(Number(ias._sourceRow)) ? Number(ias._sourceRow) : null,
      // Parsiyel kimliği: aynı sipariş altındaki parsiyeller Global Flow'da
      // ayrı sevkiyat birimi olarak konumlanır; gemi adı aynı gemideki
      // parsiyelleri tek araçta toplar.
      importFile: ias ? (norm(ias.importFile) || '') : '',
      containerNo: ias ? (norm(ias.containerNo) || '') : '',
      vesselName: antrepoVesselName(ias),
    };
  });
}
function cpLogisticSummary(segments, orderQty) {
  const list = cpLogisticSegmentsForOrder(segments);
  const primary = list[0] || null;
  const partials = list.filter(item => item.kind === 'partial');
  const statusSource = partials.length ? partials : list.filter(item => item.kind !== 'shortage');
  const unique = values => [...new Set(values.map(norm).filter(Boolean))];
  const loadedQty = partials.reduce((sum, item) => sum + item.quantity, 0);
  return {
    segments: list,
    primary,
    productionQty: list.filter(item => item.kind === 'production').reduce((sum, item) => sum + item.quantity, 0),
    shortageQty: list.filter(item => item.kind === 'shortage').reduce((sum, item) => sum + item.quantity, 0),
    loadedQty,
    partialCount: partials.length,
    totalQty: Math.max(0, Number(orderQty) || 0),
    remainingQty: Math.max(0, Math.max(0, Number(orderQty) || 0) - loadedQty),
    // STATUS hücresi gerçek parsiyelleri özetler: farklı durumlar ayrı ayrı,
    // aynı durumlar tek kez görünür. Sentetik production/shortage satırları ancak
    // gerçek parsiyel yoksa fallback olarak kullanılır.
    statuses: unique(statusSource.map(item => item.status)),
    allPartialsInWarehouse: partials.length > 0 && partials.every(item => turknorm(item.status) === 'DEPODA'),
    delTypes: unique(list.map(item => item.delType)),
    arrivals: list.map(item => item.arrival).filter(Boolean),
  };
}

// overrides: {notesmap, submap, suppfobmap, delmap} - DB'den gelir, tarayıcıdaki state.overrides'ın karşılığı
// CP ve Siparişler aynı satır üreticisini kullanır. CP yalnız aktif siparişleri,
// Siparişler ise kendi ASAS ufkundaki aktif + pasif siparişlerin tamamını listeler.
function buildOrderRowsFromASAS(asasOrders, antrepoMap, overrides, options = {}) {
  const ov = overrides || {};
  const includeInactive = options.includeInactive === true;
  const source = Array.isArray(asasOrders) ? asasOrders : [];
  const filtered = source.filter(o => includeInactive || Number(o && o.kalan) > 0);
  // Görselleri PLM ID + Colour Code kimliğinde bir kez çözümleriz.
  // Öncelik: yeni birleşik anahtar (boş tombstone dahil) → v4.61-v4.62
  // PLM-only anahtarı → v4.57-v4.60 sipariş+model+renk anahtarı.
  const imageByIdentity = new Map(), resolvedImageKeys = new Set();
  filtered.forEach(order => {
    const key = plmColourImageKey(order.plm, order.ccode);
    if (!key) return;
    const imageMap = ov.imagemap || {};
    if (Object.prototype.hasOwnProperty.call(imageMap, key)) {
      imageByIdentity.set(key, norm(imageMap[key]));
      resolvedImageKeys.add(key);
      return;
    }
    const legacyPlmKey = plmImageKey(order.plm);
    if (legacyPlmKey && Object.prototype.hasOwnProperty.call(imageMap, legacyPlmKey)) {
      imageByIdentity.set(key, norm(imageMap[legacyPlmKey]));
      resolvedImageKeys.add(key);
      return;
    }
    if (resolvedImageKeys.has(key) || imageByIdentity.get(key)) return;
    const legacyRef = norm(overrideGet(imageMap, order));
    if (legacyRef) imageByIdentity.set(key, legacyRef);
  });
  const logisticByOrder = new Map();
  buildBacklogOperationalRows(filtered, antrepoMap, ov).forEach(segment => {
    const source = sourceOrderRef(segment);
    if (!source) return;
    if (!logisticByOrder.has(source)) logisticByOrder.set(source, []);
    logisticByOrder.get(source).push(segment);
  });
  return filtered.map((o, i) => {
    const derivedLicensor = norm(o.licensor) || pricingLicensorForLicense(o.license, ov.pricingRules);
    const hasLicensorOverride = overrideHas(ov.licensormap || {}, o);
    // Non-DTR manufacturer maintenance is an LFL classification rule. It must not
    // overwrite or lock the CP/Genel Bakış Licensor field.
    const licensor = o.license && hasLicensorOverride ? norm(overrideGet(ov.licensormap, o)) : derivedLicensor;
    const isActive = Number(o && o.kalan) > 0;
    // Pasif bir siparişte IAS kaydı bulunmasa bile sentetik bir Üretimde satırı
    // oluşturulmaz. Mevcut gerçek parsiyeller korunur; aksi halde durum Pasif'tir.
    const rawLogisticSegments = logisticByOrder.get(o) || [];
    const orderLogisticSegments = isActive
      ? rawLogisticSegments
      : rawLogisticSegments.filter(segment => segment && segment._segmentKind === 'ias');
    const logistic = cpLogisticSummary(orderLogisticSegments, o.qty);
    // Shortage sentetik bir operasyon notudur; CP/Orders STATUS alanına yazılmaz.
    // Ana durum, gerçek IAS parsiyellerinden (veya gerçek üretim satırından) gelir.
    const primary = logistic.segments.find(segment => segment.kind !== 'shortage') || logistic.primary;
    const primarySegment = orderLogisticSegments.find(segment => {
      if (!primary) return false;
      const kind = segment._segmentKind === 'production' ? 'production' : (segment._segmentKind === 'shortage' ? 'shortage' : 'partial');
      const partialNo = segment._segmentKind === 'ias' ? (Number(segment._segmentIndex) || 0) + 1 : null;
      return kind === primary.kind && partialNo === primary.partialNo;
    }) || null;
    const primaryIas = primarySegment && primarySegment._iasRow ? primarySegment._iasRow : null;
    const status = primary ? primary.status : (isActive ? 'Üretimde' : 'Pasif');
    const ant = primary ? primary.arrival : null;
    const handover = primary ? primary.handover : null;
    const delType = primary ? primary.delType : backlogProductionDelType(o, ov);
    const sub = licensor === 'DTR' ? norm(o.manufacturer) : norm(overrideGet(ov.submap, o));
    const fobRounded = isFinite(o.fob) ? roundHalfUp(o.fob, 2) : null;
    const hasSuppfobOverride = overrideHas(ov.suppfobmap, o);
    const suppfobOverride = overrideGet(ov.suppfobmap, o);
    const suppFobMeta = normalizeSuppFobMeta(overrideGet(ov.suppfobmetamap || {}, o));
    const isRuleOverride = !!(hasSuppfobOverride && suppFobMeta && suppFobMeta.source === 'rule');
    const priced = calculateSuppFobByRule(fobRounded, o.opd, o.countryRaw, o.season, licensor, o.license, ov.pricingRules);
    // Öncelik: siparişe uygulanmış değer > OPD aralığı+ülke grubu+Licensor+License kuralı > DTR için FOB > boş.
    const suppfob = hasSuppfobOverride && !isRuleOverride ? suppfobOverride : (priced.value != null ? priced.value : (licensor === 'DTR' ? fobRounded : null));
    const notesRec = overrideGet(ov.notesmap, o) || {};
    const imageKey = plmColourImageKey(o.plm, o.ccode);
    const imageRef = imageKey ? (imageByIdentity.get(imageKey) || '') : '';
    const row = {
      _id: i, _matchOcode: exactOrderCodeKey(o._matchOcode != null ? o._matchOcode : o.ocode),
      _isActive: isActive, 'Active/Inactive': isActive ? 'Active' : 'Inactive',
      _imageKey: imageKey, _imageRef: imageRef, _imageUrl: imageRef ? `/api/cp-images/${encodeURIComponent(imageRef)}` : '',
      Priority: '', Season: o.season, Country: countryEN(o.countryRaw), Manufacturer: o.manufacturer,
      'Sub-Manufacturer': sub, Licensor: licensor, License: o.license, Category: o.category, 'Special Code': o.ozel,
      'PLM ID': (o.plm != null && !isNaN(Number(o.plm))) ? Math.trunc(Number(o.plm)) : '',
      'Model Name': o.model, 'Ürün Tanım': o.productDescription || '', 'C.Code': o.ccode, Colour: o.colour, 'Order Code': o.ocode,
      'FOB ($)': fobRounded, 'Supp. FOB': suppfob != null ? suppfob : null,
      _suppFobManual: hasSuppfobOverride && !isRuleOverride,
      _suppFobRule: ((!hasSuppfobOverride || isRuleOverride) && priced.rule) ? priced.rule.id || true : null,
      _suppFobMeta: ((!hasSuppfobOverride || isRuleOverride) && priced.rule) ? automaticRuleMeta(priced.rule, isRuleOverride, o.countryRaw) : (isRuleOverride ? null : suppFobMeta),
      _suppFobOverride: hasSuppfobOverride, _licensorManual: hasLicensorOverride, _licensorSource:norm(o.licensor), _nonDtrManufacturerRule: false,
      OPD: o.opd, 'Original Ex-factory': o.originalExFactoryDate || null, 'Ex-factory': o.ex,
      // Revizyon oku ve Ex-Factory renklendirmesi için ASAS orijinalleri.
      _asasExFactory: asasBaseline(o, 'ex', '_asasEx'),
      _asasRetailDate: asasBaseline(o, 'retail', '_asasRetail'),
      _asasInStore: asasBaseline(o, 'mb', '_asasMb'),
      'HANDOVER Tarihi': handover, 'Retail Date': o.retail, 'Ex→Retail': '',
      'Buying Son Onay Tarihi': o.shipConf, 'In-Store (Model Budget)': o.mb,
      // Üretici kartı termin performansı için ilk söz (gizli alan).
      _initialInspection: o.initialInspection || null,
      'Order Quantity': o.qty, 'Shipment Quantity': logistic.loadedQty, 'Remaining Units': logistic.remainingQty, '%': o.qty ? (o.qty - logistic.remainingQty) / o.qty : '',
      STATUS: status, 'Ant. Arrival': ant, 'Del. Type': delType,
      _logisticSegments: logistic.segments,
      _logisticStatusValues: logistic.statuses,
      _logisticDelTypeValues: logistic.delTypes,
      _logisticArrivalValues: logistic.arrivals,
      _logisticProductionQty: logistic.productionQty,
      _logisticShortageQty: logistic.shortageQty,
      _logisticRemainingQty: logistic.remainingQty,
      _logisticLoadedQty: logistic.loadedQty,
      _logisticPartialCount: logistic.partialCount,
      _logisticAllPartialsInWarehouse: logistic.allPartialsInWarehouse,
      _logisticTotalQty: logistic.totalQty,
      Notes: notesRec.Notes || '', 'Ek Not': notesRec.EkNot || '',
      _notesAt: notesRec.NotesAt || '', _ekNotAt: notesRec.EkNotAt || '',
      // v7.29 — not yazarı. Overview yalnız KENDİ notlarını gösterir; CP ve
      // Orders herkesin notunu göstermeye devam eder.
      _notesBy: notesRec.NotesBy || '', _notesByName: notesRec.NotesByName || '',
      _ekNotBy: notesRec.EkNotBy || '', _ekNotByName: notesRec.EkNotByName || '',
      'Merch Marka Yaş Grup Kod': o.ageGroup, 'Merch Alt Grup Kod': o.merch,
      'Buyer': o.buyer, 'Buyer Grup (TR)': o.buyerGrup, 'Line': o.line,
      'Kumaş Kategorisi': o.fabricCategory, 'Kumaşçı Ülkesi': o.fabricSupplierCountry, 'Kumaşçı': o.fabricSupplier,
      'Kumaş Tipi': o.kumasTipi, 'İplik No': o.iplikNo, 'Gramaj': o.fabricWeight, 'Karışım': o.karisim,
      ...(o._cpExtra || {}), ...cpIasExtraValues(primaryIas, orderLogisticSegments),
    };
    // Kullanıcı tanımlı boş not sütunları (Packet 9): değerler notesmap gibi
    // sipariş+model+renk anahtarıyla saklanır, ham ASAS satırına yazılmaz.
    const noteColumnDefs = Array.isArray(ov.noteColumnDefs) ? ov.noteColumnDefs : [];
    if (noteColumnDefs.length) {
      const noteColumnRec = overrideGet(ov.noteColumnValues || {}, o) || {};
      noteColumnDefs.forEach(def => { row[def.id] = noteColumnRec[def.id] || ''; });
    }
    applyFormulas(row, ov.transitRules, options.includePriority!==false&&(!options.priorityForActiveOnly||row._isActive));
    if (!isActive && options.includePriority!==false) row.Priority = '';
    return attachSourceOrderRef(row, o);
  });
}

// IAS bağlantısından CP'ye eklenen Database/Horizon sütunları (__CPX_) önce CP
// ana satırını belirleyen parsiyelden okunur. Ana satır Üretimde bakiyesi ise
// (IAS satırı yoktur) veya o parsiyelde değer boşsa, siparişin diğer IAS
// parsiyellerindeki ilk dolu değer kullanılır; kaynakta verisi olan sütun boş kalmaz.
function cpIasExtraValues(primaryIas, segments) {
  const out = { ...(primaryIas && primaryIas._cpExtra || {}) };
  const blank = value => value == null || (typeof value === 'string' && value.trim() === '');
  (Array.isArray(segments) ? segments : []).forEach(segment => {
    const extra = segment && segment._iasRow && segment._iasRow._cpExtra;
    if (!extra) return;
    for (const [name, value] of Object.entries(extra)) {
      if (blank(out[name]) && !blank(value)) out[name] = value;
      else if (!Object.prototype.hasOwnProperty.call(out, name)) out[name] = value;
    }
  });
  return out;
}

function buildCPRowsFromASAS(asasOrders, antrepoMap, overrides) {
  return buildOrderRowsFromASAS(asasOrders, antrepoMap, overrides, { includeInactive: false });
}

function buildOrdersRowsFromASAS(asasOrders, antrepoMap, overrides) {
  return buildOrderRowsFromASAS(asasOrders, antrepoMap, overrides, { includeInactive: true, includePriority:false });
}

// CP ve Orders aynı ASAS/IAS kapsamını kullanıyorsa pahalı lojistik eşleştirmesi,
// pricing ve formül hesaplarını iki kez yapma. Orders'ın tam satırı bir kez
// üretilir; CP yalnız aktif satırların ayrı üst-seviye kopyasını alır. İçteki
// salt-okunur lojistik dizileri paylaşılabilir, ancak _id ve _canEdit gibi ekran
// alanları iki modülün birbirini değiştirmemesi için bağımsız kalır.
function buildSharedOrderProjectionRowsFromASAS(asasOrders, antrepoMap, overrides) {
  const orders = buildOrderRowsFromASAS(asasOrders, antrepoMap, overrides, { includeInactive: true, priorityForActiveOnly:true });
  const cp = orders.filter(row => row && row._isActive).map((row, index) => ({ ...row, _id:index }));
  orders.forEach(row=>{delete row.Priority;});
  return { cp, orders };
}

// The opening dashboard only needs dimensions and totals. Building the full order
// summary performs warehouse matching, pricing-rule evaluation and date formulas for
// every historic order even though none of those fields are rendered on first paint.
// Keep the startup projection deliberately small so phones can parse and paint it
// quickly; the full Orders projection remains available on demand.
function buildOverviewSummaryRowsFromASAS(asasOrders, overrides) {
  const ov = overrides || {};
  return (Array.isArray(asasOrders) ? asasOrders : []).map((o, i) => {
    const derivedLicensor = norm(o.licensor) || pricingLicensorForLicense(o.license, ov.pricingRules);
    const licensor = o.license && overrideHas(ov.licensormap || {}, o)
      ? norm(overrideGet(ov.licensormap, o))
      : derivedLicensor;
    const sub = licensor === 'DTR' ? norm(o.manufacturer) : norm(overrideGet(ov.submap, o));
    return {
      _id: i,
      'Active/Inactive': Number(o.kalan) > 0 ? 'Active' : 'Inactive',
      'Merch Alt Grup Kod': o.merch,
      'Merch Marka Yaş Grup Kod': o.ageGroup,
      'Buyer Grup (TR)': o.buyerGrup,
      Buyer: o.buyer,
      Season: o.season,
      Country: countryEN(o.countryRaw),
      Manufacturer: o.manufacturer,
      'Sub-Manufacturer': sub,
      Licensor: licensor,
      License: o.license,
      Category: o.category,
      Line: o.line,
      // Collection Product Main Definition suggestions are sourced from the
      // canonical ASAS productDescription field. Keep it in this lightweight
      // Overview projection so /api/data/collection-catalog does not need the
      // heavy Orders projection just to build autocomplete values.
      productDescription: o.productDescription || '',
      'FOB ($)': isFinite(o.fob) ? roundHalfUp(o.fob, 2) : null,
      'Order Quantity': o.qty,
      Remaining: o.kalan,
    };
  });
}

function buildOrderSummaryRowsFromASAS(asasOrders, antrepoMap, overrides) {
  const ov = overrides;
  const matchRule = matchRuleOf(ov);
  const T = toDateOnly(new Date());
  const built = asasOrders.map(o => {
    const derivedLicensor = norm(o.licensor) || pricingLicensorForLicense(o.license, ov.pricingRules);
    const hasLicensorOverride = overrideHas(ov.licensormap || {}, o);
    const licensor = o.license && hasLicensorOverride ? norm(overrideGet(ov.licensormap, o)) : derivedLicensor;
    const hit = findAntrepoHit(antrepoMap, o, { rule: matchRule });
    const isActive = o.kalan > 0;
    let status = deriveOperationalStatus((hit && hit.statu) ? hit.statu : (isActive ? 'Üretimde' : ''), o);
    let ant = hit ? hit.arr : null;
    let delType = hit ? (hit.vasita || '') : '';
    // Sipariş özetinde kullanıcı tarafından kaydedilen Del. Type değeri her zaman önceliklidir.
    if (ov.delmap && overrideHas(ov.delmap, o)) {
      delType = overrideGet(ov.delmap, o) || '';
    }
    if (!delType && status === 'Üretimde') delType = 'Gemi';
    const sub = licensor === 'DTR' ? norm(o.manufacturer) : norm(overrideGet(ov.submap, o));
    const fobRounded = isFinite(o.fob) ? roundHalfUp(o.fob, 2) : null;
    const hasSuppfobOverride = overrideHas(ov.suppfobmap, o);
    const suppFobMeta = normalizeSuppFobMeta(overrideGet(ov.suppfobmetamap || {}, o));
    const isRuleOverride = !!(hasSuppfobOverride && suppFobMeta && suppFobMeta.source === 'rule');
    const priced = calculateSuppFobByRule(fobRounded, o.opd, o.countryRaw, o.season, licensor, o.license, ov.pricingRules);
    const suppfob = hasSuppfobOverride && !isRuleOverride ? overrideGet(ov.suppfobmap, o) : (priced.value != null ? priced.value : (licensor === 'DTR' ? fobRounded : null));
    let risk;
    if (!isActive) risk = '5-Closed';
    else if (o.mb && o.mb < T) risk = '1-Missed in-store';
    else if (o.retail && o.retail < T) risk = '2-Retail date passed';
    else if (o.ex && o.ex < T) risk = '3-Overdue at factory';
    else risk = '4-On track';
    const exRetail = (o.ex && o.retail) ? daysBetween(o.ex, o.retail) : '';
    const daysToGo = o.ex ? daysBetween(T, o.ex) : '';
    const delivPct = o.qty ? (o.antrepo / o.qty) : '';
    const row = {
      _matchOcode: exactOrderCodeKey(o._matchOcode != null ? o._matchOcode : o.ocode),
      'Active/Inactive': isActive ? 'Active' : 'Inactive', 'Merch Alt Grup Kod': o.merch, 'Buyer Grup (TR)': o.buyerGrup,
      Season: o.season, Country: countryEN(o.countryRaw), Manufacturer: o.manufacturer, 'Sub-Manufacturer': sub,
      Licensor: licensor, License: o.license, Category: o.category, 'Model Name': o.model, 'C.Code': o.ccode, Colour: o.colour,
      'PLM ID': (o.plm != null && !isNaN(Number(o.plm))) ? Math.trunc(Number(o.plm)) : '', 'Special Code': o.ozel,
      'Order Code': o.ocode, 'FOB ($)': fobRounded, 'Supp. FOB': suppfob != null ? suppfob : null,
      _suppFobManual: hasSuppfobOverride && !isRuleOverride,
      _suppFobRule: ((!hasSuppfobOverride || isRuleOverride) && priced.rule) ? priced.rule.id || true : null,
      _suppFobMeta: ((!hasSuppfobOverride || isRuleOverride) && priced.rule) ? automaticRuleMeta(priced.rule, isRuleOverride, o.countryRaw) : (isRuleOverride ? null : suppFobMeta),
      _suppFobOverride: hasSuppfobOverride, _licensorManual: hasLicensorOverride, _licensorSource:norm(o.licensor), _nonDtrManufacturerRule: false,
      OPD: o.opd, 'Original Ex-factory': o.originalExFactoryDate || null, 'Ex-factory': o.ex, 'Retail Date': o.retail, 'Ex→Retail': exRetail, 'In-Store (Model Budget)': o.mb, 'Days to go': daysToGo,
      'Merch Marka Yaş Grup Kod': o.ageGroup, 'Buyer': o.buyer, 'Line': o.line,
      'Kumaş Kategorisi': o.fabricCategory, 'Kumaşçı Ülkesi': o.fabricSupplierCountry, 'Kumaşçı': o.fabricSupplier,
      'Kumaş Tipi': o.kumasTipi, 'İplik No': o.iplikNo, 'Gramaj': o.fabricWeight, 'Karışım': o.karisim,
      'Order Quantity': o.qty, Received: o.antrepo, Remaining: o.kalan, '%': o.qty ? (o.qty - o.kalan) / o.qty : '', 'Deliv.%': delivPct,
      Risk: risk, Priority: '', STATUS: status, 'Ant. Arrival': ant, 'Del. Type': delType, _sevSort: isActive ? 0 : 1
    };
    // Backlog dışa aktarımı sipariş özetindeki Priority değerini birebir kullanır.
    applyFormulas(row, ov.transitRules);
    return attachSourceOrderRef(row, o);
  });
  const sev = { '1-Missed in-store': 1, '2-Retail date passed': 2, '3-Overdue at factory': 3, '4-On track': 4, '5-Closed': 5 };
  built.sort((a, b) => (a._sevSort - b._sevSort) || (sev[a.Risk] - sev[b.Risk]) || 0);
  built.forEach((r, i) => { r._id = i; delete r._sevSort; });
  return built;
}

// Backlog'un ASAS–IAS operasyon mantığı v4.42'de sıfırdan kurulmuştur.
// Aşağıdaki yardımcı yalnız üretimde kalan satırların tahmini antrepo tarihini
// Ex-Factory + ülke/yükleme tipine uygun mevcut yol süresi kuralıyla hesaplar.
// Sayfa filtreleri ve Excel şablonu bu tarihin tüketicisidir; burada eski Backlog
// statü kovası, tek satır seçimi veya parsiyel birleştirme kuralı bulunmaz.
function estimateAntrepoDate(exFactoryDate, delType, fallbackDays=DEFAULT_TRANSIT_DAYS['Gemi'], context={}){
  const base = toDateOnly(exFactoryDate) || parseDateFlexible(exFactoryDate);
  if(!base) return null;
  const resolved = resolveTransitDays({
    delType,
    exFactory: exFactoryDate,
    season: context.season,
    country: context.country,
    status: context.status || 'Üretimde',
    rules: context.rules,
    forceRules: context.forceRules === true,
  });
  const days = resolved.days != null ? resolved.days : fallbackDays;
  if(days == null) return null;
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return toDateOnly(d);
}
// EŞLEŞTİRME DENETİMİ (v4.37).
//
// "Eşleşmiyor" bilgisi tek başına yetmiyor: üç alandan HANGİSİ tutmuyor sorusunun
// yanıtı gerekiyor. Bu fonksiyon her alan için iki taraftaki değerleri ayrı ayrı
// karşılaştırır ve örnek verir. Hiçbir tahmin yapmaz, yalnız sayar.
function auditAntrepoMatching(orders, antrepoMap, rule) {
  const asasRows = Array.isArray(orders) ? orders : [];
  const iasRows = Object.values(antrepoMap && typeof antrepoMap === 'object' ? antrepoMap : {})
    .filter(value => value && typeof value === 'object');
  const config = matchRuleOf(rule);
  // Denetim, EŞLEŞTİRMENİN KENDİSİYLE aynı koşul kümesini ölçer: yalnız bu iki veri
  // kümesini kısıtlayan koşullar. Başka bir kaynak çiftine ait koşulu buraya almak
  // "ortak değer yok" diyen anlamsız bir satır üretirdi.
  const conditions = matchConditionsForPair(config, 'asas', 'antrepo');

  const fields = {};
  for (const condition of conditions) {
    const asasSide = matchOperandForRole(condition, 'asas');
    const iasSide = matchOperandForRole(condition, 'antrepo');
    const asasValues = new Map(), iasValues = new Map();
    let asasEmpty = 0, iasEmpty = 0;
    for (const row of asasRows) {
      const value = matchValueFor(row, 'asas', condition);
      if (!value) { asasEmpty++; continue; }
      if (!asasValues.has(value)) asasValues.set(value, value);
    }
    for (const row of iasRows) {
      const value = matchValueFor(row, 'ias', condition);
      if (!value) { iasEmpty++; continue; }
      if (!iasValues.has(value)) iasValues.set(value, value);
    }
    const shared = [...asasValues.keys()].filter(key => iasValues.has(key));
    fields[condition.id] = {
      id: condition.id,
      label: `${matchOperandLabel(asasSide)} = ${matchOperandLabel(iasSide)}`,
      asasLabel: matchOperandLabel(asasSide),
      iasLabel: matchOperandLabel(iasSide),
      asasRows: asasRows.length, iasRows: iasRows.length,
      asasEmpty, iasEmpty,
      asasDistinct: asasValues.size, iasDistinct: iasValues.size,
      shared: shared.length,
      asasOnly: [...asasValues.keys()].filter(key => !iasValues.has(key)).slice(0, 8),
      iasOnly: [...iasValues.keys()].filter(key => !asasValues.has(key)).slice(0, 8),
    };
  }

  const firstCondition = conditions[0] || null;
  const iasByAnchor = new Map();
  if (firstCondition) {
    for (const entry of iasRows) {
      const anchor = matchValueFor(entry, 'ias', firstCondition);
      if (!anchor) continue;
      if (!iasByAnchor.has(anchor)) iasByAnchor.set(anchor, []);
      iasByAnchor.get(anchor).push(entry);
    }
  }

  let matched = 0, unmatched = 0;
  const samples = [];
  for (const order of asasRows) {
    if (findAntrepoHit(antrepoMap, order, { rule: config })) { matched++; continue; }
    unmatched++;
    if (!firstCondition || samples.length >= 12) continue;
    const anchor = matchValueFor(order, 'asas', firstCondition);
    const others = iasByAnchor.get(anchor);
    if (!others || !others.length) continue;
    const asasValues = Object.fromEntries(conditions.map(condition => [condition.id, matchValueFor(order, 'asas', condition)]));
    const mismatch = conditions
      .filter(condition => {
        const mine = asasValues[condition.id];
        return !mine || !others.some(entry => matchValueFor(entry, 'ias', condition) === mine);
      })
      .map(condition => condition.id);
    samples.push({
      anchor,
      asas: asasValues,
      ias: others.slice(0, 3).map(entry => ({
        values: Object.fromEntries(conditions.map(condition => [condition.id, matchValueFor(entry, 'ias', condition)])),
        statu: norm(entry.statu),
      })),
      mismatch,
    });
  }

  return {
    rule: isDefaultAntrepoMatchConfig(config) ? DEFAULT_ANTREPO_MATCH_RULE : 'custom',
    config,
    ruleLabel: antrepoMatchConfigLabel(config),
    conditions: conditions.map(condition => ({
      id: condition.id,
      asasLabel: matchOperandLabel(matchOperandForRole(condition, 'asas')),
      iasLabel: matchOperandLabel(matchOperandForRole(condition, 'antrepo')),
      operands: condition.operands.map(operand => ({
        sourceId: operand.sourceId, role: operand.role, label: matchOperandLabel(operand), unresolved: operand.unresolved || '',
      })),
    })),
    // Kuralda hiç uygulanabilir koşul kalmadıysa bunu SÖYLERİZ: bu durumda hiçbir
    // satır eşleşmez ve sebebi "veri kirli" değil, kuralın kendisidir.
    inapplicable: config.conditions.length - conditions.length,
    unresolved: unresolvedMatchOperands(config),
    totals: { asasRows: asasRows.length, iasRows: iasRows.length, matched, unmatched },
    fields,
    samples,
  };
}

function backlogOrderIdentity(order) {
  const source = sourceOrderRef(order) || order || {};
  return antrepoMatchKey(source._matchOcode != null ? source._matchOcode : source.ocode, source.model, source.ccode);
}

function backlogProductionDelType(order, overrides) {
  const manual = overrides && overrides.delmap ? overrideGet(overrides.delmap, order) : '';
  return normalizeTransitDelType(manual) || norm(manual) || 'Gemi';
}

function backlogPartialStatus(entry, order) {
  const sourceStatus = norm(entry && entry.statu) || 'Durum Belirsiz';
  // Depoda parsiyelleri, ASAS database'deki merkez sevke hazır depo bakiyesi
  // sipariş toplamının %5'ini aşıyorsa Retaile Aktarım Bekleniyor olur.
  // Diğer IAS statüleri aynen korunur.
  return deriveOperationalStatus(sourceStatus, order);
}

// IAS kaydı olmayan, Buyer Log'un ASAS bakiyesi için açtığı satır türü ('' = gerçek IAS parsiyeli).
function syntheticSegmentKind(segment) {
  const kind = segment && segment._segmentKind;
  return kind === 'production' || kind === 'shortage' || kind === 'warehouse' ? kind : '';
}

function backlogSegment(order, values) {
  const quantity = Math.max(0, Number(values && values.quantity) || 0);
  const requestedKind = values && values.kind;
  // 'warehouse': pasif siparişin (ASAS kalan = 0) sentetik bakiye satırı. Üretim
  // aşamasında DEĞİLDİR; miktarı depo tarafında sayılır, kalan üretim miktarına
  // eklenmez. Gerçek IAS parsiyelleri her zaman 'ias' olarak kalır.
  const kind = requestedKind === 'ias' ? 'ias'
    : (requestedKind === 'shortage' ? 'shortage'
      : (requestedKind === 'warehouse' ? 'warehouse' : 'production'));
  const status = norm(values && values.status) || (kind === 'production' ? 'Üretimde' : (kind === 'shortage' ? SHORTAGE_STATUS : (kind === 'warehouse' ? WAREHOUSE_STATUS : 'Durum Belirsiz')));
  const arrival = toDateOnly(values && values.arrival) || null;
  const delType = norm(values && values.delType);
  const iasRow = values && values.iasRow ? values.iasRow : null;
  const result = {
    ...order,
    qty: quantity,
    kalan: kind === 'production' ? quantity : 0,
    antrepo: (antrepoStatusKey(status) === 'DEPODA' || antrepoStatusKey(status) === 'RETAILE AKTARIM BEKLENIYOR') ? quantity : 0,
    merkezSevkeHazirKalan: antrepoStatusKey(status) === 'RETAILE AKTARIM BEKLENIYOR' ? quantity : 0,
    _status: status,
    _arr: arrival,
    _delType: delType,
    _iasRow: iasRow,
    _segmentKind: kind,
    _segmentIndex: Number(values && values.index) || 0,
    _orderQty: Math.max(0, Number(values && values.orderQty) || Number(order && order.qty) || 0),
    _asasKalan: Math.max(0, Number(order && order.kalan) || 0),
    _loadedQty: kind === 'ias' ? quantity : 0,
    // Kullanıcının CP'de "Eksik Adet" olarak işaretlediği Buyer Log bakiyesi.
    _userShortage: Boolean(values && values.userShortage),
  };
  return attachSourceOrderRef(result, order);
}

const PRODUCTION_REMAINDER_TOLERANCE_RATE = 0.05;
const SHORTAGE_REMAINDER_RATE = 0.10;
const SHORTAGE_STATUS = 'Eksik Yükleme';
const WAREHOUSE_STATUS = 'Depoda';
const WAREHOUSE_SHORTAGE_STATUS = 'Depoda - Eksik Yükleme';

function isShortageStatus(value) {
  return BLBusinessRules.isShortageStatus(value);
}

function isWarehouseShortageStatus(value) {
  return BLBusinessRules.isWarehouseShortageStatus(value);
}

function userMarkedShortage(order, overrides) {
  const map = overrides && overrides.shortagemap;
  if (!map || typeof map !== 'object') return false;
  const record = overrideGet(map, order);
  return Boolean(record && typeof record === 'object');
}

function backlogRemainderStatus(orderQty, remainder, hasHits) {
  const total = Math.max(0, Number(orderQty) || 0);
  const balance = Math.max(0, Number(remainder) || 0);
  if (!hasHits) return 'Üretimde';
  if (total > 0 && balance <= total * SHORTAGE_REMAINDER_RATE) return SHORTAGE_STATUS;
  return 'Üretimde';
}

function backlogOrderQuantityFromAntrepo(order, _hits) {
  // Fonksiyon adı geriye uyumluluk için korunuyor; sipariş toplamının tek yetkili
  // kaynağı artık her zaman ASAS Net Alım Sipariş Miktarıdır. Antrepo yalnız
  // parsiyel bazındaki Yükleme Toplam Adet değerlerini sağlar.
  return Math.max(0, Number(order && order.qty) || 0);
}

function backlogProductionRemainder(orderQty, hits) {
  const total = Math.max(0, Number(orderQty) || 0);
  const loaded = (Array.isArray(hits) ? hits : [])
    .reduce((sum, entry) => sum + Math.max(0, Number(entry && entry.loadedQty) || 0), 0);
  return {
    total,
    loaded,
    remainder: Math.max(0, total - loaded),
  };
}

// Backlog ve CP Logistic operasyon veri modeli:
// - Sipariş toplamı her zaman ASAS Net Alım Sipariş Miktarıdır.
// - Eşleşen her IAS satırı bağımsız bir parsiyel olarak korunur.
// - Parsiyel miktarı yalnız Antrepo Yükleme Toplam Adet alanından alınır.
// - Kalan bakiye = ASAS Net Alım Sipariş Miktarı - parsiyellerin toplamı.
// - Bakiye sipariş toplamının %5'ine EŞİT veya daha büyükse ayrı sentetik satır
//   oluşturulur. %5'in altındaki fark tolerans kabul edilir.
// - Eşleşen IAS parsiyeli varken bakiye toplamın %10'una EŞİT veya daha azsa
//   sentetik satır Eksik Yükleme; %10'dan büyükse Üretimde olur.
// - IAS kaydı yoksa ASAS toplamının tamamı Üretimde kabul edilir.
// CP ana satırı tek kalır ve parsiyeller açılır lojistik detayı olarak gösterilir.
// ASAS bir siparişi TEK satırda verir; Backlog aynı siparişi IAS parsiyelleri ve
// sentetik bakiye satırı olarak böler. "Kalan Alım Sipariş Miktarı" ve
// "Kalan Alım Sipariş Miktarı_Merkez Sevke Hazır Depo" ASAS'ın sipariş düzeyindeki
// değerleridir: satırlara parsiyel adedi olarak KOPYALANMAZ, siparişin bütün
// satırlarına dağıtılır ve sütun toplamı her zaman ASAS değerine eşit kalır.
// Dağıtım henüz merkez depoya ulaşmamış miktardan başlar (Üretimde / Eksik
// Yükleme bakiyesi → yoldaki parsiyeller → Retaile Aktarım Bekleniyor → Depoda);
// her satır kendi Adet'i kadar pay alır. Dağıtım, filtrelemeden ÖNCE siparişin
// tam segment kümesi üzerinde yapılır; filtrelenmiş/önizleme listeleri aynı
// payları gösterir.
function asasAllocationRank(segment) {
  if (!segment || segment._segmentKind !== 'ias') return 0;
  const statusKey = antrepoStatusKey(segment._status);
  if (statusKey === 'RETAILE AKTARIM BEKLENIYOR') return 2;
  if (statusKey === 'DEPODA') return 3;
  return 1;
}
function asasAllocationText(value) {
  return turknorm(value);
}
function compareAsasAllocationText(a, b) {
  const aa = asasAllocationText(a), bb = asasAllocationText(b);
  return aa < bb ? -1 : (aa > bb ? 1 : 0);
}
function compareAsasAllocationSegments(a, b) {
  const rankDiff = asasAllocationRank(a) - asasAllocationRank(b);
  if (rankDiff) return rankDiff;

  // Aynı operasyon seviyesindeki parsiyeller kaynak satır sırasına göre değil,
  // iş kimliklerine göre sıralanır. Böylece IAS Database ve Antrepo Excel aynı
  // parsiyelleri farklı sırada döndürse bile ASAS kalan miktarı aynı parsiyellere
  // düşer. Daha ileri antrepo tarihi önce gelir; tarih yoksa tarihli parsiyellerin
  // arkasında kalır.
  const aArrival = dateOrdinal(a && a._arr);
  const bArrival = dateOrdinal(b && b._arr);
  if (aArrival !== bArrival) {
    if (aArrival == null) return 1;
    if (bArrival == null) return -1;
    return bArrival - aArrival;
  }

  let diff = compareAsasAllocationText(a && a._status, b && b._status);
  if (diff) return diff;
  diff = compareAsasAllocationText(a && a._delType, b && b._delType);
  if (diff) return diff;

  const aIas = a && a._iasRow || {};
  const bIas = b && b._iasRow || {};
  for (const field of ['importFile', 'containerNo', 'vesselName']) {
    diff = compareAsasAllocationText(aIas[field], bIas[field]);
    if (diff) return diff;
  }

  const aHandover = dateOrdinal(aIas.handover);
  const bHandover = dateOrdinal(bIas.handover);
  if (aHandover !== bHandover) {
    if (aHandover == null) return 1;
    if (bHandover == null) return -1;
    return bHandover - aHandover;
  }

  // Son bağlayıcı olarak parsiyel miktarı kullanılır. Kaynak index / _sourceRow
  // bilerek kullanılmaz; bunlar Database ve Excel'de aynı işi farklı sıraya
  // sokabilen teknik kimliklerdir.
  const qtyDiff = Math.max(0, Number(b && b.qty) || 0) - Math.max(0, Number(a && a.qty) || 0);
  return qtyDiff;
}
function allocateAsasOrderQuantity(segments, total, field) {
  let left = Math.max(0, Number(total) || 0);
  const ordered = segments
    .slice()
    .sort(compareAsasAllocationSegments);
  ordered.forEach(segment => {
    const take = Math.min(left, Math.max(0, Number(segment.qty) || 0));
    segment[field] = take;
    left -= take;
  });
  // ASAS değeri satır adetlerinin toplamını aşıyorsa fark kaybolmaz; toplamın
  // ASAS ile birebir kalması için ilk dağıtım satırına yazılır.
  if (left > 0 && ordered.length) ordered[0][field] += left;
}
function allocateAsasOrderQuantities(segments, order) {
  if (!Array.isArray(segments) || !segments.length) return;
  allocateAsasOrderQuantity(segments, order && order.kalan, '_asasRemainingQty');
  allocateAsasOrderQuantity(segments, order && order.merkezSevkeHazirKalan, '_asasReadyDepotRemainingQty');
}

function buildBacklogOperationalRows(asasOrders, antrepoMap, overrides) {
  const config = matchRuleOf(overrides);
  const out = [];
  for (const order of Array.isArray(asasOrders) ? asasOrders : []) {
    const orderStart = out.length;
    const hits = findAntrepoHits(antrepoMap, order, { config });
    const orderQty = backlogOrderQuantityFromAntrepo(order, hits);
    if (!(orderQty > 0)) continue;
    // Pasiflik ASAS'ta sipariş seviyesinde kesin bir durumdur: Kalan Alım Sipariş
    // Miktarı 0 ise siparişin üretim bakiyesi kalmamıştır (bkz. buildOrderRowsFromASAS).
    const isPassiveOrder = !(Number(order && order.kalan) > 0);

    const balance = backlogProductionRemainder(orderQty, hits);
    const preparedHits = hits.map((entry, index) => ({
      entry,
      index,
      status: backlogPartialStatus(entry, order),
    }));
    const allPartialsInWarehouse = preparedHits.length > 0
      && preparedHits.every(item => antrepoStatusKey(item.status) === 'DEPODA');
    const shouldCreateProduction = !hits.length
      || (balance.remainder > 0
        && balance.remainder >= orderQty * PRODUCTION_REMAINDER_TOLERANCE_RATE);

    // Kalan bakiye her zaman ilk önceliktedir. Parsiyel mevcut olsa bile ASAS
    // toplamı ile Antrepo parsiyel toplamı arasındaki fark %5'e EŞİT veya daha
    // büyükse ayrı satır oluşturulur. Fark %10'a EŞİT veya daha azsa bu satır
    // üretim değil Eksik Yükleme olarak sınıflandırılır.
    if (shouldCreateProduction) {
      const remainderQty = hits.length ? balance.remainder : orderQty;
      if (remainderQty > 0) {
        let remainderStatus = backlogRemainderStatus(orderQty, remainderQty, hits.length > 0);
        // Eksik Yükleme bakiyesi bulunan siparişin gerçek IAS parsiyellerinin
        // tamamı Depoda ise ana durum bunu açıkça göstermelidir.
        if (isShortageStatus(remainderStatus) && allPartialsInWarehouse) {
          remainderStatus = WAREHOUSE_SHORTAGE_STATUS;
        }
        // Pasif sipariş (ASAS kalan = 0) üretimde değildir: ASAS siparişin üretim
        // bakiyesini kapatmıştır. Sentetik bakiye satırı bu yüzden hiçbir koşulda
        // Üretimde olamaz; canonical operasyon aşaması Depoda'dır. Eksik Yükleme
        // sınıflandırması bir üretim aşaması değil operasyonel istisnadır ve
        // olduğu gibi korunur.
        if (isPassiveOrder && isProductionStatus(remainderStatus)) {
          remainderStatus = deriveOperationalStatus(WAREHOUSE_STATUS, order);
        }
        // Kullanıcı bu siparişin bakiyesini "Eksik Adet" olarak işaretlediyse
        // (yüklenmeyecek) Üretimde yerine Eksik Yükleme olur; parsiyellerin
        // tamamı depodaysa Depoda - Eksik Yükleme. İşaret yalnız Buyer Log'un
        // açtığı Üretimde bakiyesini değiştirir; gerçek IAS satırlarına dokunmaz.
        let userShortage = false;
        if (isProductionStatus(remainderStatus) && userMarkedShortage(order, overrides)) {
          remainderStatus = allPartialsInWarehouse ? WAREHOUSE_SHORTAGE_STATUS : SHORTAGE_STATUS;
          userShortage = true;
        }
        const segmentKind = isShortageStatus(remainderStatus) ? 'shortage'
          : (isProductionStatus(remainderStatus) ? 'production' : 'warehouse');
        const delType = backlogProductionDelType(order, overrides);
        const arrival = estimateAntrepoDate(order.ex, delType, null, {
          season: order.season,
          country: order.countryRaw,
          // Eksik Yükleme üretim statüsü değildir. Tahmini antrepo, siparişin
          // tamamı Ex-Factory tarihinde yüklenmiş kabul edilerek aynı dinamik
          // ülke/sezon/yükleme tipi transit kuralıyla hesaplanır.
          status: remainderStatus,
          rules: overrides && overrides.transitRules,
          forceRules: true,
        });
        out.push(backlogSegment(order, {
          kind: segmentKind,
          index: 0,
          quantity: remainderQty,
          status: remainderStatus,
          arrival,
          delType,
          orderQty,
          userShortage,
        }));
      }
    }

    preparedHits.forEach(({ entry, index, status }) => {
      const loadedQty = Math.max(0, Number(entry && entry.loadedQty) || 0);
      out.push(backlogSegment(order, {
        kind: 'ias',
        index,
        quantity: loadedQty,
        status,
        arrival: entry && entry.arr,
        delType: entry && entry.vasita,
        iasRow: entry,
        orderQty,
      }));
    });
    allocateAsasOrderQuantities(out.slice(orderStart), order);
  }
  return out;
}

function sumQty(list){ return list.reduce((s,o)=>s+(Number(o && o.qty)||0),0); }
function countDistinctOrders(list){ return new Set((list||[]).map(backlogOrderIdentity).filter(Boolean)).size; }
function toISODateLocal(d){
  if(!(d instanceof Date) || isNaN(d)) return null;
  const p = x => String(x).padStart(2,'0');
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`;
}
function isoWeekNum(d){ return BLDateDimension.isoWeekNumber(d) || 0; }
// ISO hafta-yılı ile Collection'ın hafta→ay ataması aynı merkezi tarih boyutundan gelir.
function isoWeekYear(d){ return BLDateDimension.isoWeekYear(d) || 0; }
const MONTH_NAMES = [...BLDateDimension.MONTHS_TR];
function monthLabel(d){ return BLDateDimension.monthLabel(d,'tr'); }
function weekLabel(d){ return BLDateDimension.weekLabel(d,'tr'); }

// Backlog'da gruplanabilecek boyutlar. Her biri yeni operasyon satırından bir
// etiket üretir. 'antrepoDate' özel bir boyuttur: tek seviye değil, seçilirse
// Ay → Hafta → Net Tarih olarak 3 kademeli aç/kapa (drill-down) üretir.
// "Güncel Durum" boyutu, Antrepo raporundaki ham durum metnini olduğu gibi gösterir
// (Üretimde / Yükleme Operasyonları / Yol Operasyonları / Depoda vb. ayrı ayrı kalır).
// Üretimde ve parsiyel statüleri yalnız buildBacklogOperationalRows() içinde oluşturulur.
const BACKLOG_DIMENSIONS = {
  ageGroup: o => o.ageGroup || '(boş)',
  merch: o => o.merch || '(boş)',
  season: o => o.season || '(boş)',
  country: o => countryEN(o.countryRaw) || '(boş)',
  status: o => o._status,
  buyer: o => o.buyer || '(boş)',
  buyerGrup: o => o.buyerGrup || '(boş)',
  category: o => o.category || '(boş)',
  manufacturer: o => o.manufacturer || '(boş)',
  subManufacturer: o => o._subManufacturer || '(boş)',
  line: o => o.line || '(boş)',
  vehicle: o => o._delType || '(boş)',
};
const BACKLOG_DIM_LABELS = {
  ageGroup: 'Merch Marka Yaş Grup Kod', merch: 'Merch Alt Grup Kod', season: 'Sezon',
  country: 'Ülke', status: 'Güncel Durum', buyer: 'Buyer', buyerGrup: 'Buying Group',
  category: 'Ürün Klasman', manufacturer: 'Üretici', subManufacturer: 'Alt Üretici', line: 'Line', vehicle: 'Vasıta Tipi', antrepoDate: 'Antrepo Giriş Tarihi',
};

const BACKLOG_CUSTOM_DIM_PREFIX = 'custom:';
function backlogCustomDimensionId(source, header) {
  return `${BACKLOG_CUSTOM_DIM_PREFIX}${source}:${Buffer.from(String(header || ''), 'utf8').toString('base64url')}`;
}
function backlogRawFieldLabel(value) {
  if (value == null || value === '') return '(boş)';
  if (value instanceof Date && !isNaN(value)) return toISODateLocal(value);
  const text = norm(value);
  return text || '(boş)';
}
function backlogSourceHeaders(asasOrders, antrepoMap, source) {
  const headers = new Set();
  const visit = row => {
    const fields = row && row._sourceFields;
    if (!fields || typeof fields !== 'object') return;
    Object.keys(fields).forEach(header => { if (header && !String(header).startsWith('__')) headers.add(String(header)); });
  };
  if (source === 'asas') (Array.isArray(asasOrders) ? asasOrders : []).forEach(visit);
  else if (antrepoMap && typeof antrepoMap.values === 'function') {
    for (const rows of antrepoMap.values()) (Array.isArray(rows) ? rows : [rows]).forEach(visit);
  } else if (antrepoMap && typeof antrepoMap === 'object') {
    Object.keys(antrepoMap).filter(key=>key!=='__antrepoMeta').forEach(key=>{
      const rows=antrepoMap[key];
      (Array.isArray(rows)?rows:[rows]).forEach(visit);
    });
  }
  return [...headers].sort((a, b) => a.localeCompare(b, 'tr', { sensitivity: 'base' })).slice(0, 500);
}
function backlogCustomDimensionContext(asasOrders, antrepoMap) {
  const customDimensions = [];
  const dimensions = { ...BACKLOG_DIMENSIONS };
  const labels = { ...BACKLOG_DIM_LABELS };
  for (const source of ['asas', 'antrepo']) {
    for (const header of backlogSourceHeaders(asasOrders, antrepoMap, source)) {
      const id = backlogCustomDimensionId(source, header);
      const sourceLabel = source === 'asas' ? 'ASAS' : 'Antrepo';
      const label = `${sourceLabel} · ${header}`;
      customDimensions.push({ id, source, header, label });
      labels[id] = label;
      dimensions[id] = segment => {
        const row = source === 'asas' ? (sourceOrderRef(segment) || segment) : (segment && segment._iasRow);
        return backlogRawFieldLabel(row && row._sourceFields ? row._sourceFields[header] : null);
      };
    }
  }
  return { customDimensions, dimensions, labels };
}

// Antrepo Giriş Tarihi'ni, kullanıcının seçtiği kademelere (levels: 'year','month','week','day'
// alt kümesi, bu sırayla) göre iç içe gruplar. 'year' seçilmemişse ay/hafta etiketleri yıldan
// bağımsız olur (aynı ay/hafta numarası farklı yıllardan gelen siparişlerle birleşir) — bu
// kasıtlı bir davranış, kullanıcı "sadece Hafta" gibi sade görünümler isteyebiliyor.
function buildAntrepoDateTree(orders, levels, remainingDims, dimensions=BACKLOG_DIMENSIONS){
  if(!levels || !levels.length) return remainingDims && remainingDims.length ? buildBacklogTree(orders, remainingDims, 0, [], dimensions) : null;
  const level = levels[0];
  const rest = levels.slice(1);
  const groups = {};
  orders.forEach(o=>{
    let key, label, sortKey;
    const period=BLDateDimension.describe(o&&o._arr);
    if(!period.valid){
      key = '(belirsiz)'; label = 'Tarih Belirsiz'; sortKey = 'zzzz';
    } else if(level==='year'){
      key=String(period.periodYear);label=key;sortKey=key;
    } else if(level==='month'){
      key=period.monthKey;label=period.monthLabelTr;sortKey=period.monthKey;
    } else if(level==='week'){
      key=period.weekKey;label=period.weekLabelTr;sortKey=period.weekKey;
    } else if(level==='day'){
      key=period.dateKey;label=period.dateKey;sortKey=period.dateKey;
    } else {
      key='x';label='';sortKey='x';
    }
    if(!groups[key]) groups[key] = { label, sortKey, list: [] };
    groups[key].list.push(o);
  });
  return Object.values(groups)
    .sort((a,b)=> a.sortKey==='zzzz'?1 : b.sortKey==='zzzz'?-1 : (a.sortKey<b.sortKey?-1:a.sortKey>b.sortKey?1:0))
    .map(g=>backlogNode(g.label, g.list,
      (g.sortKey==='zzzz') ? (remainingDims && remainingDims.length ? buildBacklogTree(g.list, remainingDims, 0, [], dimensions) : null) : buildAntrepoDateTree(g.list, rest, remainingDims, dimensions)));
}
function buildBacklogTree(orders, dims, dimIdx, antrepoDateLevels, dimensions=BACKLOG_DIMENSIONS){
  if(dimIdx >= dims.length) return null;
  const dim = dims[dimIdx];
  if(dim === 'antrepoDate') return buildAntrepoDateTree(orders, antrepoDateLevels, dims.slice(dimIdx+1), dimensions);
  const getter = dimensions[dim];
  if(!getter) return buildBacklogTree(orders, dims, dimIdx+1, antrepoDateLevels, dimensions);
  const groups = {};
  orders.forEach(o=>{ const k = getter(o); (groups[k]=groups[k]||[]).push(o); });
  return Object.entries(groups)
    .map(([label, sub])=>backlogNode(label, sub, buildBacklogTree(sub, dims, dimIdx+1, antrepoDateLevels, dimensions)))
    .sort((a,b)=> b.qty-a.qty);
}

// Bir pivot düğümü. Düğümün ALTINDAKİ SATIRLAR düğümün üstünde taşınır, ancak
// sayılmayan (non-enumerable) bir alanda: JSON yanıtına girmez, yalnız sunucu
// içindeki detay çözümlemesi kullanır.
//
// v4.32 öncesinde düğüm yalnız _orderRefs (tekilleştirilmiş SİPARİŞ KODU listesi)
// taşıyordu ve detay penceresi o kodlara ait BÜTÜN satırları geri getiriyordu.
// Bir sipariş kodunun altında birden fazla model/renk satırı olduğu için, "Depoda"
// grubunun detayında o siparişin Üretimde olan diğer satırları da görünüyordu.
function backlogNode(label, list, children) {
  const node = { label, qty: sumQty(list), orders: countDistinctOrders(list), rows: list.length, children };
  Object.defineProperty(node, '_list', { value: list, enumerable: false, configurable: true });
  return node;
}

// Düğüm yolu ("2-0-3") ağaçta çözülür. İstemcideki flattenBacklogTree ile aynı
// indeksleme kullanılır, böylece tıklanan satır ile sunucudaki düğüm birebir aynıdır.
function backlogNodeAtPath(tree, path) {
  const parts = String(path == null ? '' : path).split('-').filter(p => p !== '').map(Number);
  if (!parts.length || parts.some(n => !Number.isInteger(n) || n < 0)) return null;
  let nodes = tree, node = null;
  for (const index of parts) {
    if (!Array.isArray(nodes) || !nodes[index]) return null;
    node = nodes[index];
    nodes = node.children;
  }
  return node;
}

// Backlog ekranı ve Excel detay raporu aynı satır kümesini kullanmalıdır.
// Bu yardımcı; Retail, Antrepo, Buying Group ve boyut filtrelerini tek bir yerde
// uygular. Böylece aynı Sipariş Koduna ait fakat filtre dışındaki renk/tarih satırları
// Excel detayına yanlışlıkla geri eklenmez.
function filterBacklogOrders(asasOrders, antrepoMap, overrides, opts, dimensions=BACKLOG_DIMENSIONS) {
  opts = opts || {};
  const retailFrom = opts.retailFrom ? parseDateFlexible(opts.retailFrom) : null;
  const retailTo = opts.retailTo ? parseDateFlexible(opts.retailTo) : null;
  const buyerGrupList = Array.isArray(opts.buyerGrup) ? opts.buyerGrup : (opts.buyerGrup ? String(opts.buyerGrup).split(',') : []);
  const buyerGrupFilterSet = buyerGrupList.filter(Boolean).length ? new Set(buyerGrupList.filter(Boolean).map(turknorm)) : null;

  // Backlog filtreleri artık ASAS sipariş satırlarını değil, sıfırdan oluşturulan
  // operasyon satırlarını süzer. Her IAS parsiyeli ve varsa üretim bakiyesi ayrı
  // satırdır; ekran, detay ve Excel aynı satır kümesini kullanır.
  const operationalRows = buildBacklogOperationalRows(asasOrders, antrepoMap, overrides);
  operationalRows.forEach(segment => {
    const order = sourceOrderRef(segment) || segment;
    segment._subManufacturer = backlogSubManufacturer(order, overrides);
  });
  const inWindow = operationalRows.filter(o => {
    const retail = toDateOnly(o.retail);
    if (!retail) return false;
    if (retailFrom && retail < retailFrom) return false;
    if (retailTo && retail > retailTo) return false;
    return true;
  });

  const inStoreFrom = opts.inStoreFrom ? parseDateFlexible(opts.inStoreFrom) : null;
  const inStoreTo = opts.inStoreTo ? parseDateFlexible(opts.inStoreTo) : null;
  const inStoreFiltered = (inStoreFrom || inStoreTo) ? inWindow.filter(o => {
    const inStore = toDateOnly(o.mb);
    if (!inStore) return false;
    if (inStoreFrom && inStore < inStoreFrom) return false;
    if (inStoreTo && inStore > inStoreTo) return false;
    return true;
  }) : inWindow;

  const exFactoryFrom = opts.exFactoryFrom ? parseDateFlexible(opts.exFactoryFrom) : null;
  const exFactoryTo = opts.exFactoryTo ? parseDateFlexible(opts.exFactoryTo) : null;
  // Kanonik, güncel/revize Exfactory; IAS handover tarihi ayrı kalır.
  const exFactoryFiltered = (exFactoryFrom || exFactoryTo) ? inStoreFiltered.filter(o => {
    const exFactory = toDateOnly(o.ex);
    return !!exFactory && (!exFactoryFrom || exFactory >= exFactoryFrom) && (!exFactoryTo || exFactory <= exFactoryTo);
  }) : inStoreFiltered;

  const antrepoFrom = opts.antrepoFrom ? parseDateFlexible(opts.antrepoFrom) : null;
  const antrepoTo = opts.antrepoTo ? parseDateFlexible(opts.antrepoTo) : null;
  const antrepoFiltered = (antrepoFrom || antrepoTo) ? exFactoryFiltered.filter(o => {
    const antrepo = toDateOnly(o._arr);
    if (!antrepo) return false;
    if (antrepoFrom && antrepo < antrepoFrom) return false;
    if (antrepoTo && antrepo > antrepoTo) return false;
    return true;
  }) : exFactoryFiltered;

  const windowed = antrepoFiltered;
  const buyerGrupFiltered = buyerGrupFilterSet
    ? antrepoFiltered.filter(o => buyerGrupFilterSet.has(turknorm(o.buyerGrup)))
    : antrepoFiltered;

  const dimFilters = opts.dimFilters || {};
  const dimFilterSets = {};
  Object.keys(dimFilters).forEach(dim => {
    if (dim === 'antrepoDate') return;
    const raw = dimFilters[dim];
    const vals = (Array.isArray(raw) ? raw : []).filter(v => v != null && v !== '');
    if (vals.length && dimensions[dim]) dimFilterSets[dim] = new Set(vals);
  });
  const dimFiltered = Object.keys(dimFilterSets).length
    ? buyerGrupFiltered.filter(o => Object.entries(dimFilterSets).every(([dim, set]) => set.has(dimensions[dim](o))))
    : buyerGrupFiltered;

  const dateFilter = dimFilters.antrepoDate;
  const dateGran = dateFilter && BACKLOG_DATE_GRANS.includes(dateFilter.granularity) ? dateFilter.granularity : null;
  const dateValues = dateGran && Array.isArray(dateFilter.values) ? dateFilter.values.filter(v => v != null && v !== '') : [];
  const filtered = dateValues.length
    ? dimFiltered.filter(o => dateValues.includes(backlogDateBucketKey(o, dateGran)))
    : dimFiltered;

  return { filtered, windowed, retailFrom, retailTo, inStoreFrom, inStoreTo, exFactoryFrom, exFactoryTo, antrepoFrom, antrepoTo };
}

// Her boyut için sipariş kümesinde GERÇEKTEN bulunan değerler.
// Backlog filtre panelleri bunları kullanır; böylece sayfa CP veri kümesinden
// tamamen bağımsızdır ve listede görünen her değer raporda da vardır.
// Antrepo Giriş Tarihi'nin kademe anahtarları. Backlog'un tarih filtresi, CP'deki
// tarih sütunu filtresiyle aynı mantıkta çalışsın diye yıl/ay/hafta/gün kovaları
// üzerinden filtrelenebilir.
const BACKLOG_DATE_GRANS = ['year', 'month', 'week', 'day'];
function backlogDateBucketKey(order, gran) {
  return BLDateDimension.bucketKey(order && order._arr, gran);
}
function backlogDateValues(orders) {
  const out = {};
  for (const gran of BACKLOG_DATE_GRANS) {
    const seen = new Set();
    for (const order of orders) {
      const key = backlogDateBucketKey(order, gran);
      if (key) seen.add(key);
    }
    out[gran] = [...seen].sort();
  }
  return out;
}

function backlogDimValues(orders, dimensions=BACKLOG_DIMENSIONS) {
  const out = {};
  for (const dim of Object.keys(dimensions)) {
    const seen = new Set();
    const accessor = dimensions[dim];
    for (const order of orders) {
      const value = accessor(order);
      if (value != null && value !== '') seen.add(String(value));
    }
    out[dim] = [...seen].sort((a, b) => String(a).localeCompare(String(b), 'tr'));
  }
  out.antrepoDate = backlogDateValues(orders);
  return out;
}

// groupBy: örn. ['status','antrepoDate'] — sıralama, gruplama hiyerarşisinin sırasını belirler.
function buildBacklogGrouped(asasOrders, antrepoMap, overrides, opts) {
  opts = opts || {};
  const custom = backlogCustomDimensionContext(asasOrders, antrepoMap);
  const dims = (opts.groupBy || []).filter(d => custom.dimensions[d] || d === 'antrepoDate');
  const { filtered, windowed, retailFrom, retailTo, inStoreFrom, inStoreTo, exFactoryFrom, exFactoryTo, antrepoFrom, antrepoTo } = filterBacklogOrders(asasOrders, antrepoMap, overrides, opts, custom.dimensions);

  const antrepoDateLevels = (opts.antrepoDateLevels && opts.antrepoDateLevels.length) ? opts.antrepoDateLevels : ['year','month','week','day'];
  const tree = dims.length ? buildBacklogTree(filtered, dims, 0, antrepoDateLevels, custom.dimensions) : null;

  return {
    retailFrom: retailFrom ? toISODateLocal(retailFrom) : null,
    retailTo: retailTo ? toISODateLocal(retailTo) : null,
    inStoreFrom: inStoreFrom ? toISODateLocal(inStoreFrom) : null,
    inStoreTo: inStoreTo ? toISODateLocal(inStoreTo) : null,
    exFactoryFrom: exFactoryFrom ? toISODateLocal(exFactoryFrom) : null,
    exFactoryTo: exFactoryTo ? toISODateLocal(exFactoryTo) : null,
    antrepoFrom: antrepoFrom ? toISODateLocal(antrepoFrom) : null,
    antrepoTo: antrepoTo ? toISODateLocal(antrepoTo) : null,
    buyerGrup: opts.buyerGrup || null,
    groupBy: dims,
    dimLabels: custom.labels,
    customDimensions: custom.customDimensions,
    totalQty: sumQty(filtered),
    totalOrders: countDistinctOrders(filtered),
    // Filtre panelleri için: tüm seçenekler (tarih penceresi içinde) ve şu anki
    // filtrelerden sonra hâlâ veri getiren değerler.
    dimValues: backlogDimValues(windowed, custom.dimensions),
    dimValuesActive: backlogDimValues(filtered, custom.dimensions),
    totalRows: filtered.length,
    tree,
  };
}

// Backlog pivot'unda tıklanan bir düğümün (örn. "Depoda / Eylül 2025") altındaki ham sipariş
// detaylarını, kullanıcının istediği sütun setiyle döner. Düğüm, istemcideki satır yolu
// (path) ile ve pivotla AYNI filtre seçenekleriyle sunucuda yeniden çözülür.
function backlogSubManufacturer(order, overrides) {
  if (!order) return '';
  const derivedLicensor = pricingLicensorForLicense(order.license, overrides && overrides.pricingRules);
  const hasLicensorOverride = overrideHas((overrides && overrides.licensormap) || {}, order);
  const licensor = order.license && hasLicensorOverride ? norm(overrideGet(overrides.licensormap, order)) : derivedLicensor;
  if (licensor === 'DTR') return norm(order.manufacturer);
  return overrides && overrides.submap ? norm(overrideGet(overrides.submap, order)) : '';
}

// selector:
//   { path, ...filtre seçenekleri }  → pivotta tıklanan düğümün TAM satır kümesi (v4.32)
//   { identities:[{orderCode,modelName,colourCode}, ...] } → CP/Siparişler seçiminin tam satır kimlikleri
//   [sipariş kodu, ...]              → eski çağrı biçimi; sipariş kodunun tüm satırları
function buildBacklogDetailRows(asasOrders, antrepoMap, overrides, selector, options) {
  let source;
  if (selector && typeof selector === 'object' && Array.isArray(selector.identities)) {
    const fallbackByKey = new Map();
    const wanted = new Set(selector.identities.map(item => {
      const orderCode = item && (item.orderCode ?? item.ocode);
      const modelName = item && (item.modelName ?? item.model);
      const colourCode = item && (item.colourCode ?? item.ccode ?? item.colorCode);
      if (!orderCodeKey(orderCode) || !turknorm(modelName) || !turknorm(colourCode)) return '';
      const key = orderLineKey(orderCode, modelName, colourCode);
      if (item && item.fallback && typeof item.fallback === 'object') fallbackByKey.set(key, item.fallback);
      return key;
    }).filter(Boolean));
    source = buildBacklogOperationalRows(
      (Array.isArray(asasOrders) ? asasOrders : []).filter(order => wanted.has(orderLineKeyOf(order))),
      antrepoMap,
      overrides
    );
    // Çift tıklanan Orders/CP satırında görünen çözülmüş değerler, ASAS'taki
    // eşleşen alan boş kaldığında yalnızca sunum fallback'i olarak kullanılır.
    // Operasyonel segment, miktar, IAS status ve Antrepo tarihleri sunucu
    // hesabından gelmeye devam eder.
    source.forEach(segment => {
      const order = sourceOrderRef(segment) || segment;
      const key = orderLineKeyOf(order);
      const fb = fallbackByKey.get(key);
      if (!fb) return;
      const map = {
        season:'Season', countryRaw:'Country', manufacturer:'Manufacturer', license:'License',
        category:'Category', ozel:'Special Code', plm:'PLM ID', model:'Model Name', ccode:'C.Code',
        colour:'Colour', fob:'FOB ($)', opd:'OPD', ex:'Ex-factory', retail:'Retail Date',
        mb:'In-Store (Model Budget)', shipConf:'Buying Son Onay Tarihi', line:'Line', buyer:'Buyer', buyerGrup:'Buyer Grup (TR)'
      };
      for (const [prop,field] of Object.entries(map)) {
        const current = order[prop];
        const incoming = fb[field];
        const blank = current == null || current === '' || (prop==='fob' && !Number.isFinite(Number(current)));
        if (blank && incoming != null && incoming !== '') {
          order[prop] = incoming;
        }
      }
    });
  } else if (Array.isArray(selector)) {
    const wanted = new Set(selector.map(v => orderCodeKey(v)).filter(Boolean));
    source = buildBacklogOperationalRows(
      (Array.isArray(asasOrders) ? asasOrders : []).filter(o => wanted.has(orderCodeKey(o.ocode))),
      antrepoMap,
      overrides
    );
  } else {
    const opts = selector && typeof selector === 'object' ? selector : {};
    const custom = backlogCustomDimensionContext(asasOrders, antrepoMap);
    const { filtered } = filterBacklogOrders(asasOrders, antrepoMap, overrides, opts, custom.dimensions);
    const dims = (opts.groupBy || []).filter(d => custom.dimensions[d] || d === 'antrepoDate');
    const levels = (opts.antrepoDateLevels && opts.antrepoDateLevels.length) ? opts.antrepoDateLevels : ['year','month','week','day'];
    const tree = dims.length ? buildBacklogTree(filtered, dims, 0, levels, custom.dimensions) : null;
    const node = tree ? backlogNodeAtPath(tree, opts.path) : null;
    source = node ? node._list : filtered;
  }

  // Rapor penceresi ile Backlog Excel'i AYNI eşlemeyi kullanır (bkz.
  // backlogTemplateRowsFromSegments). CP notu yalnız bu detayda görünen
  // siparişler için çözülür; tüm sipariş kümesi için CP kurmak gereksiz olurdu.
  const orderRefs = [];
  const seenOrders = new Set();
  source.forEach(segment => {
    const order = sourceOrderRef(segment) || segment;
    if (order && !seenOrders.has(order)) { seenOrders.add(order); orderRefs.push(order); }
  });
  const cpMap = new Map();
  buildCPRowsFromASAS(orderRefs, antrepoMap, overrides).forEach(row => {
    const ref = sourceOrderRef(row);
    if (ref) cpMap.set(ref, row);
  });
  return backlogTemplateRowsFromSegments(source, overrides, cpMap).map(row => {
    // _backlogExcel yalnız Excel yazıcısının işine yarar; iç meta istenmediyse
    // yanıtı şişirmesin. Rapor penceresi (includeInternalMeta) aynı satırları
    // standart Backlog Excel'ine aktarır: meta olmadan _BL_ACTUAL_ANTREPO /
    // _BL_HANDOVER_DATE / _BL_SHIP_CONFIRMATION_DATE boş kalıyor ve parsiyel
    // satırlarının ANTREPO GİRİŞ TARİHİ ile ANTREPO-RETAIL formülleri boş çıkıyordu.
    const { _backlogExcel, _plmId, _colourCode, _modelName, _imageRef, _partial, ...rest } = row;
    if(options&&options.includeInternalMeta)return {...rest,_plmId,_colourCode,_modelName,_imageRef,_partial,_backlogExcel};
    return rest;
  });
}


function backlogYearMonth(d){
  return BLDateDimension.bucketKey(d,'month');
}
function backlogYearWeek(d){
  const key=BLDateDimension.bucketKey(d,'week');
  return key ? key.replace('-W','-') : '';
}
// Canonical Backlog risk consumes structured operational signals only.
// Legacy CP Priority display text is not a business-logic input anywhere.
function backlogRiskFromSignals(signals, transitOverdue){
  const active = Array.isArray(signals) && signals.some(item => item && item.code);
  return (active || transitOverdue === true) ? 'VAR' : 'YOK';
}

// Üretim sonrası transit gecikmesi Backlog'a özgü bir override'dır.
//
// IAS parsiyeli oluştuysa sipariş üretimden çıkmıştır. Bu noktada hedef tarihe
// yetişme hesabından bağımsız ikinci bir kontrol gerekir: gerçekleşen yükleme
// tarihinden (öncelik HANDOVER; yoksa geçerli Ex-Factory) itibaren tanımlı yol
// süresi dolduğu halde parsiyel hâlâ Depoda / Retaile Aktarım Bekleniyor
// aşamasına gelmediyse satır Risk Var olmalıdır. IAS'ın "Tahmini Antrepo Giriş
// Tarihi" bu kontrolde kullanılmaz; kaynak tarih sonradan ileri alınırsa gerçek
// transit gecikmesini gizlememelidir.
function backlogTransitOverdueInfo({ isPartial, isInWarehouse, isRetailWaiting, loadDate, transitDays, todayValue = new Date() } = {}) {
  if (!isPartial || isInWarehouse || isRetailWaiting) return { overdue: false, expectedArrival: null, overdueDays: 0 };
  const load = toDateOnly(loadDate);
  const loadOrdinal = dateOrdinal(loadDate);
  const todayOrdinal = dateOrdinal(todayValue);
  const days = Number(transitDays);
  if (!load || loadOrdinal == null || todayOrdinal == null || !Number.isFinite(days) || days < 0) {
    return { overdue: false, expectedArrival: null, overdueDays: 0 };
  }
  const expectedOrdinal = loadOrdinal + days;
  const overdueDays = todayOrdinal - expectedOrdinal;
  const expectedArrival = new Date(load);
  expectedArrival.setDate(expectedArrival.getDate() + days);
  return {
    overdue: overdueDays > 0,
    expectedArrival: toDateOnly(expectedArrival),
    overdueDays: Math.max(0, overdueDays),
  };
}

function buildBacklogTemplateRows(asasOrders, antrepoMap, overrides, filterOrOcodes, extraColumns, options = {}) {
  const customDimensions = backlogCustomDimensionContext(asasOrders, antrepoMap).dimensions;
  const sourceSegments = Array.isArray(filterOrOcodes)
    ? (() => {
        const wanted = new Set((filterOrOcodes || []).map(v => orderCodeKey(v)).filter(Boolean));
        return buildBacklogOperationalRows(
          (Array.isArray(asasOrders) ? asasOrders : []).filter(o => wanted.has(orderCodeKey(o.ocode))),
          antrepoMap,
          overrides
        );
      })()
    : filterBacklogOrders(asasOrders, antrepoMap, overrides, filterOrOcodes || {}, customDimensions).filtered;

  const requestedLimit = Number(options && options.limit);
  const selectedSegments = Number.isFinite(requestedLimit) && requestedLimit > 0
    ? sourceSegments.slice(0, Math.floor(requestedLimit))
    : sourceSegments;

  // Kullanıcı notları CP'den okunmaya devam eder; ASAS–IAS statü, miktar, tarih ve
  // vasıta kararlarının hiçbiri CP/Sipariş Özeti satırından alınmaz.
  // Önceden burada filtre dışındaki bütün ASAS siparişleri tekrar CP satırına
  // çevriliyordu. Yalnız rapora girecek siparişleri dönüştürmek büyük Backlog
  // Excel'lerinde hazırlık süresini belirgin biçimde azaltır.
  const cpOrders = [], seenOrders = new Set();
  selectedSegments.forEach(segment => {
    const order = sourceOrderRef(segment) || segment;
    if (order && !seenOrders.has(order)) { seenOrders.add(order); cpOrders.push(order); }
  });
  const cpMap = new Map();
  const sourceRows=options.includeSourceDetails===true
    ? buildOrdersRowsFromASAS(cpOrders, antrepoMap, overrides)
    : buildCPRowsFromASAS(cpOrders, antrepoMap, overrides);
  sourceRows.forEach(row => {
    const source = sourceOrderRef(row);
    if (source) cpMap.set(source, row);
  });

  const rows = backlogTemplateRowsFromSegments(selectedSegments, overrides, cpMap, extraColumns, options);
  Object.defineProperty(rows, 'totalRows', { value: sourceSegments.length, enumerable: false });
  return rows;
}

/* Segment -> BACKLOG_TEMPLATE_HEADERS satırı.
   Bu eşleme TEK YERDE durur. Eskiden Backlog Excel'i ile CP/Siparişler'deki
   "Sipariş Backlog Raporu" penceresi iki ayrı eşleme kullanıyordu ve rapor
   penceresinin anahtarları başlık listesiyle tutmuyordu ('GÜNCEL DURUM' ↔
   'GÜNCEL DURUM\n(STATUS)', 'Adet' ↔ 'Sipariş Adeti', 'Buyer Grup' ↔
   'Buyer Grup (TR)' …): parsiyel satırları çiziliyor ama hücrelerin çoğu boş
   kalıyordu. Artık ikisi de bu fonksiyondan geçiyor, ayrışamazlar. */
function backlogTemplateRowsFromSegments(sourceSegments, overrides, cpMap, extraColumns, options = {}) {
  const cp = cpMap instanceof Map ? cpMap : new Map();
  const requestedColumns = (Array.isArray(extraColumns) ? extraColumns : []).filter(column =>
    column && (column.source === 'asas' || column.source === 'antrepo') && column.header && column.label
  );
  return (Array.isArray(sourceSegments) ? sourceSegments : []).map(segment => {
    const order = sourceOrderRef(segment) || segment;
    const ias = segment._iasRow || null;
    const segmentQty = Math.max(0, Number(segment.qty) || 0);
    const isProduction = segment._segmentKind === 'production';
    const isShortage = segment._segmentKind === 'shortage' || isShortageStatus(segment._status);
    const statusKey = antrepoStatusKey(segment._status);
    const isInWarehouse = statusKey === 'DEPODA';
    const isRetailWaiting = statusKey === 'RETAILE AKTARIM BEKLENIYOR';
    const effectiveDelType = normalizeTransitDelType(segment._delType) || norm(segment._delType);
    const backlogAntrepoDate = toDateOnly(segment._arr);
    const backlogRetailDate = toDateOnly(order.retail);
    const antRetail = !isInWarehouse && backlogAntrepoDate && backlogRetailDate
      ? daysBetween(backlogRetailDate, backlogAntrepoDate)
      : '';

    /* v6.35 — İKİ EX-FACTORY SÜTUNU AYRIŞTIRILDI.
       Eskiden 'Orijinal Exfactory Merch Tarih' ve 'REVİZE YÜKLEME TARİHİ
       (EX-FACTORY)' sütunlarının İKİSİ de order.ex okuyordu. order.ex ise
       applyDateOverrides'tan geçmiş, yani CP'de girilen revizyonu TAŞIYAN
       değerdir: "Orijinal" sütunu orijinali göstermiyor ve iki sütun her zaman
       birbirinin aynısı çıkıyordu.

       Yeni kaynaklar:
       · Orijinal  → her zaman ASAS'ın kendi tarihi (asasBaseline; revizyon yoksa
         zaten geçerli değerin kendisidir).
       · Revize    → her satırda Buyer Log'un geçerli Ex-Factory tarihi. Kullanıcı
         revizyonu varsa applyDateOverrides sonrası order.ex bunu taşır; yoksa
         ASAS tarihine eşittir.
       · Gerçek yükleme → IAS parsiyelinde HANDOVER ayrı bir operasyonel kaynaktır.
         Revised Shipment Date alanını ezmez; transit gecikmesi ve Excel iç
         metadatasında actualLoadDate olarak kullanılmaya devam eder. */
    const asasExDate = asasBaseline(order, 'ex', '_asasEx');
    const isPartial = !isProduction && !isShortage;
    const partialLoadDate = isPartial && ias ? toDateOnly(ias.handover) : null;
    const revisedExFactoryDate = toDateOnly(order.ex) || asasExDate || null;
    const actualLoadDate = isPartial ? (partialLoadDate || revisedExFactoryDate) : revisedExFactoryDate;

    // Üretim sonrası parsiyellerde de ülke/sezon/yükleme tipine göre tanımlanmış
    // Transfer Lead Time kuralını çöz. Önceki davranış non-production satırlarda
    // doğrudan genel varsayılana düşüyor ve kullanıcı tanımlı 70/80/... günlük
    // kuralı transit gecikmesi hesabında görünmez kılıyordu.
    const transitInfo = resolveTransitDays({
      delType: effectiveDelType,
      exFactory: actualLoadDate || revisedExFactoryDate || order.ex,
      season: order.season,
      country: order.countryRaw,
      status: segment._status,
      rules: overrides && overrides.transitRules,
      // Backlog satırı hangi operasyon segmentinde olursa olsun aynı merkezi
      // Transfer Lead Time registry'sini çözsün. Bu yalnız bu çağrı noktasının
      // lookup davranışıdır; resolveTransitDays'in legacy global guard'ı korunur.
      forceRules: true,
    });

    const transitOverdue = backlogTransitOverdueInfo({
      isPartial,
      isInWarehouse,
      isRetailWaiting,
      loadDate: actualLoadDate,
      transitDays: transitInfo.days,
    });

    const priorityInput = {
      'Ex-factory': order.ex,
      'Retail Date': order.retail,
      'In-Store (Model Budget)': order.mb,
      'Ant. Arrival': backlogAntrepoDate,
      'HANDOVER Tarihi': ias ? (ias.handover || null) : null,
      'Buying Son Onay Tarihi': order.shipConf || null,
      // Shortage operasyonel transit hesabında üretim gibi değil, siparişin
      // tamamı Ex-Factory tarihinde yüklenmiş kabul edilerek hesaplanır.
      STATUS: segment._status,
      'Del. Type': effectiveDelType,
      Season: order.season,
      Country: countryEN(order.countryRaw),
    };
    const priorityFlags = computeFlags(priorityInput, overrides && overrides.transitRules);
    const operationalSignals = Array.isArray(priorityFlags.signals) ? priorityFlags.signals : [];
    // Risk artık display Priority metnini parse etmez. Aynı kanonik business
    // flags/signal çıktısı hem CP hem Backlog kararına kaynak olur.
    const riskValue = backlogRiskFromSignals(operationalSignals, transitOverdue.overdue);
    const cpRow = cp.get(order) || {};

    const receivedQty = (isProduction || isShortage) ? 0 : segmentQty;
    const warehouseQty = (isInWarehouse || isRetailWaiting) ? segmentQty : 0;
    // ASAS sipariş düzeyi kalan miktarlarının bu satıra düşen payı
    // (bkz. allocateAsasOrderQuantities). Pay bilgisi taşımayan eski segmentlerde
    // önceki davranış korunur.
    const asasRemainingQty = segment._asasRemainingQty != null
      ? segment._asasRemainingQty
      : (isProduction ? segmentQty : 0);
    const asasReadyDepotRemainingQty = segment._asasReadyDepotRemainingQty != null
      ? segment._asasReadyDepotRemainingQty
      : (isRetailWaiting ? segmentQty : 0);

    const result = {
      'Sezon': order.season,
      'Sipariş Yerleştirme MerchTarih': order.opd,
      'Siparişin Üretildiği Ülke': countryEN(order.countryRaw),
      'Buyer': order.buyer,
      'Buyer Grup (TR)': order.buyerGrup,
      'Lisans': order.license,
      'Üretici': order.manufacturer,
      'Alt Üretici': backlogSubManufacturer(order, overrides),
      'Line': order.line,
      'Ürün Klasman': order.category,
      'Sipariş Kod': order.ocode,
      'Özel Kod 1': order.ozel,
      'Model Adı': order.model,
      'Renk Kod': order.ccode,
      'Renk': order.colour,
      'Orijinal Exfactory Merch Ay': backlogYearMonth(asasExDate),
      'Orijinal Exfactory Merch Tarih': asasExDate,
      'Retail Depo Merch Yil Ay': backlogYearMonth(order.retail),
      'Retail Depo Tarih Yıl Ay Gün': order.retail,
      'Model Bütçe Merch Yil Ay': backlogYearMonth(order.mb),
      'Model Bütçe Tarih Yıl Ay Gün': order.mb,
      'Model Bütçe Yil Hafta': backlogYearWeek(order.mb),
      'Retail Depo Merch Yil Hafta': backlogYearWeek(order.retail),
      // Net sipariş miktarı her satırda ASAS'tan gelen toplam sipariş miktarıdır.
      // Satırın kendi operasyon miktarı yeni Adet sütununda gösterilir: IAS
      // parsiyelinde Yükleme Toplam Adet, sentetik Üretimde/Eksik Yükleme
      // satırında ise toplam sipariş miktarı eksi parsiyel toplamıdır.
      'Net Alım Sipariş Miktarı': Math.max(0, Number(segment._orderQty) || Number(order.qty) || 0),
      'Adet': segmentQty,
      'Gelen Alım Sipariş Miktarı Merkez Sevke Hazır Depo': warehouseQty,
      'Kalan Alım Sipariş Miktarı': asasRemainingQty,
      'FOB Fiyatı': isFinite(order.fob) ? roundHalfUp(order.fob, 2) : null,
      'Net Gelen Alım Sipariş Miktarı': receivedQty,
      'Kalan Alım Sipariş Miktarı_Merkez Sevke Hazır Depo': asasReadyDepotRemainingQty,
      'GÜNCEL DURUM\n(STATUS)': segment._status,
      'REVİZE YÜKLEME TARİHİ\n(EX-FACTORY)': revisedExFactoryDate,
      'RİSK\n(PRIORITY)': riskValue,
      'ANTREPO GİRİŞ TARİHİ': backlogAntrepoDate || null,
      'YÜKLEME TİPİ': effectiveDelType,
      'ANTREPO-RETAIL': antRetail,
      'Üretici Tükleme Tipi Teyidi': 'VAR',
      'buying note': cpRow.Notes || '',
      // Alt detay tablolarının görseli ve PLM köprüsünü, açık CP filtresine
      // bağımlı kalmadan doğrudan kaynak siparişten çözebilmesi için görünmeyen
      // kimlikler. BACKLOG_TEMPLATE_HEADERS'a eklenmezler; yalnız istemci
      // eşleştirme katmanı tarafından okunurlar.
      _plmId: order.plm || '',
      _colourCode: order.ccode || '',
      _modelName: order.model || '',
      _imageRef: plmImageRef(overrides && overrides.imagemap, order) || '',
      // Parsiyel kimliği (Global Flow). Excel başlıklarına eklenmez.
      _partial: {
        kind: isProduction ? 'production' : (segment._segmentKind === 'shortage' ? 'shortage' : 'partial'),
        partialNo: segment._segmentKind === 'ias' ? (Number(segment._segmentIndex) || 0) + 1 : null,
        synthetic: syntheticSegmentKind(segment),
        userShortage: Boolean(segment._userShortage),
        importFile: ias ? (norm(ias.importFile) || '') : '',
        containerNo: ias ? (norm(ias.containerNo) || '') : '',
        vesselName: antrepoVesselName(ias),
        sourceRow: ias && Number.isFinite(Number(ias._sourceRow)) ? Number(ias._sourceRow) : null,
      },
      _backlogExcel: {
        transitDays: transitInfo.days,
        // Hangi Transfer Lead Time kuralının uygulandığı da taşınır: Excel'in
        // Ayarlar sayfasındaki yol süresi tablosu bu kimliğe göre kurulur ve
        // BACKLOG sayfasındaki formül o satırın Gün hücresine bağlanır.
        transitRule: transitInfo.rule ? {
          delType: normalizeTransitDelType(transitInfo.rule.delType) || norm(transitInfo.rule.delType),
          seasons: transitInfo.rule.seasons != null ? transitInfo.rule.seasons : (transitInfo.rule.season != null ? transitInfo.rule.season : ''),
          countries: transitInfo.rule.countries != null ? transitInfo.rule.countries : (transitInfo.rule.country != null ? transitInfo.rule.country : ''),
          exfStart: transitInfo.rule.exfStart || null,
          exfEnd: transitInfo.rule.exfEnd || null,
          days: Number(transitInfo.rule.days),
        } : null,
        actualAntrepoDate: (isProduction || isShortage) ? null : (backlogAntrepoDate || null),
        handoverDate: ias ? (ias.handover || null) : null,
        actualLoadDate: isPartial ? (actualLoadDate || null) : null,
        expectedTransitArrival: transitOverdue.expectedArrival || null,
        transitOverdue: transitOverdue.overdue === true,
        transitOverdueDays: transitOverdue.overdueDays,
        shipConfirmationDate: order.shipConf || null,
        // ASAS'ta bu rengin Ex-Factory'si boştu; aynı PO'nun diğer renginden alındı.
        exFactoryInheritedFrom: order._exInheritedFrom ? (order._exInheritedFrom.ccode || '') : '',
        originalDelType: effectiveDelType,
        segmentKind: segment._segmentKind,
        sourceOrderQty: segment._orderQty,
        sourceAsasRemainingQty: segment._asasKalan,
        loadedQty: segment._loadedQty,
        /* Teslimat Riski Analizi structured operational signal'ları tüketir.
           Legacy CP Priority warning metni artık payload'a taşınmaz: Priority
           Buyer Log genelinde yalnız Unified Action Priority anlamına gelir. */
        mag: order.merch || '',
        mmyg: order.ageGroup || '',
        signals: operationalSignals,
      },
    };
    requestedColumns.forEach(column => {
      const source = column.source === 'asas' ? order : ias;
      const fields = source && source._sourceFields;
      result[column.label] = fields && Object.prototype.hasOwnProperty.call(fields, column.header)
        ? fields[column.header]
        : '';
    });
    // Harita detayları CP kataloğunu gösterir. Aynı Backlog hedefinden zaten
    // hesaplanan salt-okunur sipariş alanlarını yalnız talep edildiğinde taşı.
    // İç ASAS/IAS verisi ve sipariş-seviyesi lojistik özetleri payload'a girmez.
    if(options.includeSourceDetails===true){
      result._detailSource=Object.fromEntries(Object.entries(cpRow).filter(([key])=>!key.startsWith('_')));
    }
    return result;
  });
}

module.exports = {
  pricingLicensorForLicense, automaticRuleMeta,
  countryEN,
  parseASASWorkbook, parseASASRows, parseFabricWorkbook, applyFabricEntries, applyFabricEntriesToLflRows, parseAntrepoWorkbook, parseAntrepoRows, parseCPUpdateWorkbook,
  buildCPRowsFromASAS, buildOrdersRowsFromASAS, buildSharedOrderProjectionRowsFromASAS, buildOverviewSummaryRowsFromASAS, buildOrderSummaryRowsFromASAS, buildBacklogOperationalRows, buildBacklogGrouped, buildBacklogDetailRows, buildBacklogTemplateRows, backlogCustomDimensionContext, computeFlags, applyFormulas, deriveOperationalStatus, shouldWaitForRetail, isShortageStatus, isWarehouseShortageStatus, backlogRemainderStatus, findAntrepoHit, findAntrepoHits, backlogOrderQuantityFromAntrepo, backlogProductionRemainder, PRODUCTION_REMAINDER_TOLERANCE_RATE, SHORTAGE_REMAINDER_RATE, SHORTAGE_STATUS, WAREHOUSE_STATUS, WAREHOUSE_SHORTAGE_STATUS, BACKLOG_DIM_LABELS,
  orderCodeKey, toOrderCodeNumber, antrepoParseMeta, dateOrdinal,
  orderLineKey, orderLineKeyOf, rowLineKey, normalizePlmImageId, normalizeCpImageColourCode, plmImageKey, plmColourImageKey, plmColourImageNameKey, plmImageRef, plmImageKeysFor, plmImageDeleted, plmImageUsable, overrideKeyOf, overrideHas, overrideGet,
  antrepoEntryConflicts, backlogNodeAtPath,
  ANTREPO_MATCH_RULES, ANTREPO_MATCH_RULE_LABELS, DEFAULT_ANTREPO_MATCH_RULE, normalizeAntrepoMatchRule,
  DEFAULT_ANTREPO_MATCH_CONDITIONS, defaultAntrepoMatchConfig, normalizeAntrepoMatchConfig, antrepoMatchConfigLabel, antrepoMatchConfigSignature, isDefaultAntrepoMatchConfig,
  MATCH_ROLE_ALIASES, matchRoleKey, defaultMatchSourceId, normalizeMatchOperand, matchOperandForRole, matchOperandForSource, matchOperandLabel, matchConditionsForPair, unresolvedMatchOperands,
  dynamicAntrepoMatchKey, matchValueFor, orderCodeMatchValue,
  antrepoMatchKey, exactMatchValue, exactOrderCodeKey, exactModelKey, exactCcodeKey,
  auditAntrepoMatching,
  applyDateOverrides, asasBaseline, backlogTemplateRowsFromSegments,
  findTransitRule, resolveTransitDays, defaultTransitDays, normalizeTransitDelType, roundHalfUp, backlogRiskFromSignals,
  parseDateOnly, antrepoStatusKey,
};
