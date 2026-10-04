'use strict';

/* ===================================================================
   ÜRETİCİ E-POSTA GRUPLARI — ORTAK DEPO (v7.32)

   Kullanıcı talebi (birebir):
     "Prepaire e-mail alanındaki üretici e-posta verilerini ayrı bir ekranda
      takip etmek istiyorum. source Data ekranına e-mail groups adı altında bir
      buton ekle, üretici e-posta adreslerini gruplayarak organize edebileyim.
      Gruplamayı ülke olarak ve Dokuma / Örme / Triko / Denim gibi gruplarla
      yöneteceğim. Bu başlıkları dilediğim gibi ekle/çıkar şeklinde
      düzenleyeceğim. Bu alan kullanıcılar arasında görünür olsun, herkesin
      girdiği veri ortak alanda görünür durumda olsun."
     "birisi bir e posta kaydını düzenliyorken, diğer kullanıcılar için edit
      özelliğini o e posta kaydında kapat. o an kimin editledigi de diger
      kisiler tarafından görülsün. son güncelleme tarihi kayıt bazlı görünür
      olsun."

   TASARIM KARARLARI

   1) ORTAK ALAN. Veri kullanıcı çalışma alanında değil, paylaşılan sunucu
      dosyasında durur; herkes aynı kaydı görür. Yazma işlemleri dosya
      kirasıyla (withFileLeaseSync) ve revizyon kontrolüyle korunur: ağ
      klasöründe iki Buyer Log aynı anda yazarsa biri sessizce kaybolmaz.

   2) KİLİDİN SÜRESİ VARDIR. "Düzenleyen varken diğerlerine kapat" isteğinin
      en tehlikeli yanı budur: süresiz bir kilit, tarayıcısını kapatan
      kullanıcının kaydı HERKESE KALICI OLARAK kilitlemesi demektir. Kilit bu
      yüzden LOCK_TTL_MS sonunda kendiliğinden düşer ve düzenleme ekranı açık
      durdukça kalp atışıyla tazelenir. Süresi geçmiş kilit, kimse elle
      müdahale etmeden devralınabilir.

   3) YETKİ SUNUCUDA (§32). Kaydı yalnız kilidi TUTAN kullanıcı
      değiştirebilir. İstemcinin "ben kilitliyim" demesi yeterli değildir;
      her yazma isteğinde kilit sunucuda doğrulanır.

   4) BAŞLIK SİLMEK VERİ KAYBETTİRMEZ (§142). İçinde kayıt olan bir ülke ya da
      tür başlığı silinemez; kaç kayıt bağlı olduğu söylenir. Aksi hâlde
      kayıtlar sahipsiz kalır ve ekranda hiçbir grupta görünmezdi.
   =================================================================== */

const fs = require('fs');
const path = require('path');
const { SERVER_DATA_ROOT, atomicWriteJson } = require('../user-data');
const { withFileLeaseSync } = require('./shared-file-transaction');
const { readJsonWithValidatedBackup } = require('./safe-json-read');
const manufacturerCards = require('../../public/manufacturer-cards-engine.js');

const FILE = path.join(SERVER_DATA_ROOT, 'email-groups.json');
/* Delta motoruna taşınmış belge. Kimlik veri köküne göreli yol; db.js'teki
   ortak store koleksiyonuyla aynı uzayda durur. */
const DOCUMENT_ID = 'email-groups.json';
const { createDocumentApi } = require('./delta-store');
let documents = createDocumentApi(null);
function attachDeltaStore(store) { documents = createDocumentApi(store); return documents; }
const MAX_RECORDS = 20000;
const MAX_HEADINGS = 200;
/* Kilit ömrü. Düzenleme penceresi açıkken istemci ~20 saniyede bir tazeler;
   iki dakika, tarayıcı çökse bile kaydın makul sürede serbest kalması ile
   düzenleme sırasında kilidin elden gitmemesi arasındaki dengedir. */
const LOCK_TTL_MS = 120000;

function clean(value, max = 500) { return String(value == null ? '' : value).trim().slice(0, max); }
function cleanId(value) { return clean(value, 160).replace(/[^A-Za-z0-9_.:-]/g, '_'); }
function cleanObject(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function now() { return new Date().toISOString(); }
function newId(prefix) { return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`; }
function turkishKey(value) { return clean(value, 300).toLocaleLowerCase('tr-TR'); }

function storeError(message, code, statusCode, extra = {}) {
  return Object.assign(new Error(message), { code, statusCode, ...extra });
}

/* İlk açılışta boş bir ekran yerine kullanıcının saydığı türler hazır gelir;
   hepsi silinebilir/yeniden adlandırılabilir. Ülke başlığı ÖNERİLMEZ: ülke
   listesi kuruluşa göre değişir, uydurma bir liste yazmak yanlış olurdu. */
const DEFAULT_TYPES = ['Dokuma', 'Örme', 'Triko', 'Denim'];

function defaultStore() {
  return {
    schemaVersion: 1,
    countries: [],
    types: DEFAULT_TYPES.map((name, index) => ({ id: `type-${turkishKey(name).replace(/[^a-z0-9]+/g, '')}`, name, order: index })),
    records: [],
    // Silinen kaydın kimliği → silinme zamanı. Senkron birleşimi (local-db
    // DOCUMENT_LIST_MERGE) başka cihazdaki eski kopyanın kaydı diriltmesini
    // bununla engeller.
    deletedRecords: {},
    _revision: 0,
    _updatedAt: null,
  };
}
const MAX_DELETED_RECORDS = 2000;
function normalizeDeletedRecords(value) {
  const src = cleanObject(value);
  return Object.fromEntries(Object.entries(src)
    .map(([id, at]) => [cleanId(id), clean(at, 80)]).filter(([id, at]) => id && at)
    .sort((a, b) => String(b[1]).localeCompare(String(a[1]))).slice(0, MAX_DELETED_RECORDS));
}
function withoutDeleted(records, deletedRecords) {
  return records.filter(record => !(deletedRecords[record.id] && String(deletedRecords[record.id]) >= String(record.updatedAt || '')));
}

function normalizeHeading(value, index) {
  const src = cleanObject(value);
  const name = clean(src.name, 120);
  return name ? { id: cleanId(src.id) || newId('h'), name, order: Number.isFinite(Number(src.order)) ? Number(src.order) : index } : null;
}
function normalizeHeadings(list) {
  const seen = new Set();
  return (Array.isArray(list) ? list : [])
    .slice(0, MAX_HEADINGS)
    .map(normalizeHeading)
    .filter(item => {
      if (!item) return false;
      const key = turkishKey(item.name);
      if (seen.has(key)) return false; // aynı ad iki kez eklenmesin
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, 'tr'))
    .map((item, index) => ({ ...item, order: index }));
}

/* Kilit yalnız SÜRESİ GEÇMEMİŞSE geçerlidir. */
function activeLock(lock, at = Date.now()) {
  const src = cleanObject(lock);
  const userId = cleanId(src.userId);
  const stamp = Date.parse(src.at || '');
  if (!userId || !Number.isFinite(stamp)) return null;
  if (at - stamp > LOCK_TTL_MS) return null;
  return { userId, userName: clean(src.userName, 240), at: new Date(stamp).toISOString() };
}

/* v7.0.229 — ÜRETİCİ KARTI. Kayıt artık ASAS üreticisinin kartıdır:
   `manufacturer` ASAS'taki TAM addır; eski/alternatif yazımlar `aliases`
   içinde tutulur ki otomasyon ve kurallar eski adla gelen siparişi de aynı
   karta bağlasın. `origin` kaydın ASAS'tan mı (öncelikli) yoksa elle mi
   açıldığını söyler. */
const MAX_ALIASES = 30;
function normalizeAliases(value, manufacturer) {
  const list = Array.isArray(value) ? value : String(value == null ? '' : value).split(/[;\n]+/);
  const own = manufacturerCards.nameKey(manufacturer), seen = new Set(own ? [own] : []);
  const out = [];
  for (const item of list) {
    const name = clean(item, 240), key = manufacturerCards.nameKey(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
    if (out.length >= MAX_ALIASES) break;
  }
  return out;
}
function normalizeRecord(value) {
  const src = cleanObject(value);
  const createdAt = clean(src.createdAt, 80) || now();
  const manufacturer = clean(src.manufacturer, 240);
  return {
    id: cleanId(src.id) || newId('em'),
    manufacturer,
    aliases: normalizeAliases(src.aliases, manufacturer),
    origin: ['asas', 'manual'].includes(clean(src.origin, 20)) ? clean(src.origin, 20) : '',
    email: clean(src.email, 2000),
    contact: clean(src.contact, 240),
    phone: clean(src.phone, 80),
    note: clean(src.note, 2000),
    countryId: cleanId(src.countryId),
    typeId: cleanId(src.typeId),
    createdAt,
    createdBy: cleanId(src.createdBy),
    createdByName: clean(src.createdByName, 240),
    updatedAt: clean(src.updatedAt, 80) || createdAt,
    updatedBy: cleanId(src.updatedBy),
    updatedByName: clean(src.updatedByName, 240),
    lock: activeLock(src.lock),
  };
}

function normalizeStore(raw) {
  const base = defaultStore();
  return {
    ...base,
    ...cleanObject(raw),
    schemaVersion: 1,
    countries: normalizeHeadings(raw && raw.countries),
    types: normalizeHeadings(raw && raw.types),
    deletedRecords: normalizeDeletedRecords(raw && raw.deletedRecords),
    records: withoutDeleted((Array.isArray(raw && raw.records) ? raw.records : []).slice(0, MAX_RECORDS).map(normalizeRecord), normalizeDeletedRecords(raw && raw.deletedRecords)),
    _revision: Math.max(0, Number(raw && raw._revision) || 0),
  };
}

function loadStore() {
  // Delta yetkili fazda kayıt motordan gelir; aynı normalizasyondan geçtiği
  // için biçim iki kaynakta da birebir aynıdır. Delta bilmiyorsa eski dosyaya
  // düşülür — geçiş sırasında veri görünmez olamaz.
  const fromDelta = documents.read(DOCUMENT_ID);
  if (fromDelta) return normalizeStore(fromDelta);
  return readJsonWithValidatedBackup(FILE, {
    fallback: () => defaultStore(),
    normalize: normalizeStore,
    restore: value => atomicWriteJson(FILE, value),
  });
}

/* Yazma. Revizyon beklenenden farklıysa başka biri araya girmiştir; üzerine
   yazmak yerine 409 döner (sessiz üzerine yazma yok). expectedRevision null
   ise denetim atlanır — bunu yalnız kilit tazeleme gibi çekişmesiz işlemler
   kullanır. */
function saveStore(next, expectedRevision) {
  return withFileLeaseSync(FILE, () => {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    const current = loadStore();
    if (expectedRevision != null) {
      const expected = Math.max(0, Number(expectedRevision) || 0);
      if (current._revision !== expected) {
        throw storeError('E-posta grupları başka bir kullanıcı tarafından değiştirildi. Ekranı yenileyip tekrar deneyin.',
          'REVISION_CONFLICT', 409, { expectedRevision: expected, currentRevision: current._revision });
      }
    }
    // Kayıt ekleme gibi güvenli append işlemleri güncel store lease altında
    // kurar; iki kullanıcı farklı üretici eklediğinde ikinci eski snapshot
    // birincinin kaydını ezmez.
    const resolved = typeof next === 'function' ? next(current) : next;
    const saved = {
      schemaVersion: 1,
      countries: normalizeHeadings(resolved.countries),
      types: normalizeHeadings(resolved.types),
      records: (Array.isArray(resolved.records) ? resolved.records : []).slice(0, MAX_RECORDS).map(normalizeRecord),
      deletedRecords: normalizeDeletedRecords(resolved.deletedRecords !== undefined ? resolved.deletedRecords : current.deletedRecords),
      _revision: current._revision + 1,
      _updatedAt: now(),
    };
    if (documents.writesLegacy) atomicWriteJson(FILE, saved);
    documents.mirror(DOCUMENT_ID, saved);
    return saved;
  });
}

/* ---------------- okuma ---------------- */

function publicStore(store = loadStore()) {
  return {
    countries: store.countries,
    types: store.types,
    records: store.records,
    revision: store._revision,
    updatedAt: store._updatedAt,
    lockTtlMs: LOCK_TTL_MS,
  };
}

/* ---------------- kilit ---------------- */

function recordIndex(store, id) {
  const key = cleanId(id);
  const index = store.records.findIndex(item => item.id === key);
  if (index < 0) throw storeError('E-posta kaydı bulunamadı.', 'EMAIL_RECORD_NOT_FOUND', 404);
  return index;
}

/* Kilidi almaya çalışır. Başkası tutuyorsa KİMİN tuttuğu bildirilir; kullanıcı
   "neden düzenleyemiyorum" sorusunu ekranda görür. */
function acquireLock(id, actor) {
  const store = loadStore();
  const index = recordIndex(store, id);
  const record = store.records[index];
  const held = activeLock(record.lock);
  const me = cleanId(actor && actor.id);
  if (held && held.userId !== me) {
    throw storeError(`Bu kaydı şu anda ${held.userName || held.userId} düzenliyor.`, 'EMAIL_RECORD_LOCKED', 409, { lock: held });
  }
  const records = store.records.slice();
  records[index] = { ...record, lock: { userId: me, userName: clean(actor && actor.name, 240), at: now() } };
  const saved = saveStore({ ...store, records }, store._revision);
  return { record: saved.records[index], revision: saved._revision };
}

function releaseLock(id, actor) {
  const store = loadStore();
  const index = recordIndex(store, id);
  const record = store.records[index];
  const held = activeLock(record.lock);
  const me = cleanId(actor && actor.id);
  // Kendi kilidini bırakabilir; süresi geçmiş kilit zaten yok sayılır.
  if (held && held.userId !== me) {
    throw storeError(`Bu kaydın kilidi ${held.userName || held.userId} kullanıcısında.`, 'EMAIL_RECORD_LOCKED', 409, { lock: held });
  }
  const records = store.records.slice();
  records[index] = { ...record, lock: null };
  const saved = saveStore({ ...store, records }, store._revision);
  return { record: saved.records[index], revision: saved._revision };
}

/* Yazmadan önce kilit doğrulaması — YETKİ SUNUCUDA (§32). */
function assertHoldsLock(record, actor) {
  const held = activeLock(record.lock);
  const me = cleanId(actor && actor.id);
  if (!held) throw storeError('Bu kaydın düzenleme kilidi sizde değil. Kaydı düzenlemek için yeniden açın.', 'EMAIL_RECORD_LOCK_REQUIRED', 409);
  if (held.userId !== me) throw storeError(`Bu kaydı şu anda ${held.userName || held.userId} düzenliyor.`, 'EMAIL_RECORD_LOCKED', 409, { lock: held });
}

/* ---------------- kayıtlar ---------------- */

function createRecord(input, actor, expectedRevision) {
  const stamp = now();
  const record = normalizeRecord({
    ...cleanObject(input),
    id: '',
    createdAt: stamp, createdBy: actor && actor.id, createdByName: actor && actor.name,
    updatedAt: stamp, updatedBy: actor && actor.id, updatedByName: actor && actor.name,
    lock: null,
  });
  if (!record.manufacturer && !record.email) {
    throw storeError('Üretici adı veya e-posta adresi zorunludur.', 'VALIDATION_ERROR', 400);
  }
  // Yeni ID her çağrıda benzersizdir; bu nedenle stale genel revizyon, farklı
  // bir yeni kaydı reddetmek yerine güncel listeye güvenle eklenebilir. Mevcut
  // kayıt düzenlemeleri hâlâ expectedRevision + record lock ile korunur.
  const saved = saveStore(current => {
    if (current.records.length >= MAX_RECORDS) throw storeError('E-posta kaydı sınırına ulaşıldı.', 'EMAIL_RECORD_LIMIT', 409);
    return { ...current, records: [...current.records, record] };
  }, null);
  return { record: saved.records.find(item => item.id === record.id), revision: saved._revision };
}

function updateRecord(id, patch, actor, expectedRevision) {
  const store = loadStore();
  const index = recordIndex(store, id);
  const record = store.records[index];
  assertHoldsLock(record, actor);
  const src = cleanObject(patch);
  const next = normalizeRecord({
    ...record,
    // Yalnız gönderilen alanlar değişir; kimlik ve oluşturma bilgisi korunur.
    ...Object.fromEntries(['manufacturer', 'aliases', 'origin', 'email', 'contact', 'phone', 'note', 'countryId', 'typeId']
      .filter(field => Object.prototype.hasOwnProperty.call(src, field))
      .map(field => [field, src[field]])),
    id: record.id,
    createdAt: record.createdAt, createdBy: record.createdBy, createdByName: record.createdByName,
    updatedAt: now(), updatedBy: actor && actor.id, updatedByName: actor && actor.name,
    // Kaydettikten sonra kilit bırakılır: kayıt başkalarına açılır.
    lock: null,
  });
  const records = store.records.slice();
  records[index] = next;
  const saved = saveStore({ ...store, records }, expectedRevision);
  return { record: saved.records[index], revision: saved._revision };
}

function deleteRecord(id, actor, expectedRevision) {
  const store = loadStore();
  const index = recordIndex(store, id);
  assertHoldsLock(store.records[index], actor);
  const records = store.records.filter((_, position) => position !== index);
  const deletedRecords = { ...(store.deletedRecords || {}), [store.records[index].id]: now() };
  const saved = saveStore({ ...store, records, deletedRecords }, expectedRevision);
  return { deleted: true, revision: saved._revision };
}

/* ---------------- başlıklar ---------------- */

function headingField(kind) {
  if (kind === 'country') return { list: 'countries', ref: 'countryId', label: 'Ülke' };
  if (kind === 'type') return { list: 'types', ref: 'typeId', label: 'Grup' };
  throw storeError('Geçersiz başlık türü.', 'VALIDATION_ERROR', 400);
}

function replaceHeadings(kind, list, expectedRevision) {
  const field = headingField(kind);
  const store = loadStore();
  const next = normalizeHeadings(list);
  /* SİLİNEN BAŞLIKTA KAYIT VARSA İŞLEM DURUR. Kayıtları sahipsiz bırakmak,
     onları ekranda hiçbir grupta göstermemek demekti (§142). */
  const keep = new Set(next.map(item => item.id));
  const orphaned = new Map();
  for (const record of store.records) {
    const ref = record[field.ref];
    if (!ref || keep.has(ref)) continue;
    orphaned.set(ref, (orphaned.get(ref) || 0) + 1);
  }
  if (orphaned.size) {
    const names = [...orphaned.entries()].map(([id, count]) => {
      const heading = store[field.list].find(item => item.id === id);
      return `${heading ? heading.name : id} (${count} kayıt)`;
    });
    throw storeError(`Silinmek istenen ${field.label.toLocaleLowerCase('tr-TR')} başlıklarında kayıt var: ${names.join(', ')}. Önce kayıtları başka bir başlığa taşıyın.`,
      'EMAIL_HEADING_IN_USE', 409, { inUse: [...orphaned.keys()] });
  }
  const saved = saveStore({ ...store, [field.list]: next }, expectedRevision);
  return { [field.list]: saved[field.list], revision: saved._revision };
}

/* ---------------- Prepare E-Mail kayıtlarının taşınması (v7.35) ----------

   Kullanıcı talebi (birebir): "Manufacturer Email Groups alanına, Prepare
   E-Mail alanındaki kayıtları taşı."

   Prepare E-Mail'in üretici listesi KULLANICININ KENDİ tarayıcı çalışma
   alanındadır; sunucu onu okuyamaz. Bu yüzden aday listesini istemci gönderir,
   birleştirmeyi sunucu yapar. Birleştirme tek bir yazma işleminde olur:
   20 kayıt 20 ayrı istek olsaydı, ortadaki bir hata yarım taşınmış bir liste
   bırakırdı.

   ÜZERİNE YAZILMAZ (§142/§152). Kurallar:
     · Ortak alanda o üretici yoksa → yeni kayıt eklenir.
     · Varsa ve adresi BOŞSA, adayda adres varsa → yalnız boş alan doldurulur.
       Bu bir kazançtır, kayıp değil.
     · Varsa ve adresi FARKLIYSA → HİÇBİR ŞEY yapılmaz; çakışma adıyla
       bildirilir. Hangi adresin doğru olduğuna program karar veremez.
     · Kaydı o an başkası düzenliyorsa → dokunulmaz, atlananlar bildirilir.
   Hiçbir kayıt silinmez; taşıma yalnız ekler ve boş alan doldurur. */
/* Üretici adı eşleştirme anahtarı. turkishKey tek başına YETMEZ: Türkçe
   küçültmede "ELSIWA" → "elsıwa" olur, kullanıcının yazdığı "elsiwa" ile
   eşleşmez ve aynı üretici ikinci kez kaydedilirdi. Noktalı/noktasız i tek
   harfe indirgenir ve aradaki fazla boşluklar toplanır. */
function mailKey(value) { return clean(value, 320).toLowerCase(); }
function matchKey(value) {
  return turkishKey(value).replace(/[ıi]/g, 'i').replace(/\s+/g, ' ').trim();
}

function importRecords(list, actor, expectedRevision) {
  const store = loadStore();
  const byName = new Map();
  for (const record of store.records) {
    const key = matchKey(record.manufacturer);
    if (key && !byName.has(key)) byName.set(key, record);
  }
  const stamp = now();
  const added = [], filled = [], conflicts = [], locked = [], unchanged = [];
  const seenInBatch = new Set();
  const records = store.records.slice();
  const indexOfId = id => records.findIndex(item => item.id === id);

  for (const value of Array.isArray(list) ? list.slice(0, MAX_RECORDS) : []) {
    const src = cleanObject(value);
    const manufacturer = clean(src.manufacturer, 240);
    const email = clean(src.email, 2000);
    if (!manufacturer && !email) continue;
    const key = matchKey(manufacturer) || matchKey(email);
    // Aynı üretici aday listesinde iki kez geçebilir (eski eşleme + liste).
    if (seenInBatch.has(key)) continue;
    seenInBatch.add(key);

    const existing = byName.get(key);
    if (!existing) {
      if (records.length >= MAX_RECORDS) break;
      const record = normalizeRecord({
        manufacturer, email, contact: clean(src.contact, 240), phone: clean(src.phone, 80),
        note: clean(src.note, 2000),
        id: '', createdAt: stamp, createdBy: actor && actor.id, createdByName: actor && actor.name,
        updatedAt: stamp, updatedBy: actor && actor.id, updatedByName: actor && actor.name, lock: null,
      });
      records.push(record);
      byName.set(key, record);
      added.push(record.manufacturer || record.email);
      continue;
    }
    // E-posta adresi Türkçe kurala göre küçültülmez: "INFO@" → "ınfo@" olur
    // ve aynı adres farklı sanılırdı. Adresler ASCII küçük harfle karşılaştırılır.
    if (!email || mailKey(existing.email) === mailKey(email)) { unchanged.push(existing.manufacturer); continue; }
    if (existing.email) { conflicts.push({ manufacturer: existing.manufacturer, current: existing.email, incoming: email }); continue; }
    if (activeLock(existing.lock) && activeLock(existing.lock).userId !== cleanId(actor && actor.id)) {
      locked.push(existing.manufacturer); continue;
    }
    const index = indexOfId(existing.id);
    if (index < 0) continue;
    const next = { ...existing, email, updatedAt: stamp, updatedBy: cleanId(actor && actor.id), updatedByName: clean(actor && actor.name, 240) };
    records[index] = next;
    byName.set(key, next);
    filled.push(next.manufacturer);
  }

  const summary = { added, filled, conflicts, locked, unchanged };
  // Değişiklik yoksa yazma yapılmaz: gereksiz revizyon artışı diğer
  // kullanıcıların ekranını boş yere tazelerdi.
  if (!added.length && !filled.length) return { summary, revision: store._revision };
  const saved = saveStore({ ...store, records }, expectedRevision);
  return { summary, revision: saved._revision };
}

/* ---------------- ASAS üreticileriyle eşleme (v7.0.229) ----------------

   Kullanıcı talebi: "Buyer Log'a ASAS'ta olmayan bir üretici de eklenebilir
   ancak öncelik ASAS'ta olanlardan yana olmalı. Yoksa formüller ve kurallar
   çalışmaz. Üreticilerin isimleri tam ve doğru yazılmalı."

   createFromAsas: kartı olmayan ASAS üreticileri için TAM ASAS adıyla kart
   açar. Aynı ad (ya da alternatif adı) zaten bir kartta varsa dokunulmaz.
   Ülke başlığı ASAS ülkesinden bulunur; yoksa açılır.
   linkRecord: ASAS'ta karşılığı olmayan kartı seçilen ASAS adına bağlar; eski
   ad alternatif ad olarak korunur (veri kaybı yok, §142). */
function createFromAsas(list, actor) {
  const stamp = now();
  const summary = { added: [], unchanged: [] };
  const saved = saveStore(current => {
    const records = current.records.slice();
    const countries = current.countries.slice();
    const taken = manufacturerCards.buildDirectoryIndex(records);
    const countryByKey = new Map(countries.map(item => [manufacturerCards.nameKey(item.name), item]));
    for (const value of Array.isArray(list) ? list.slice(0, MAX_RECORDS) : []) {
      const src = cleanObject(value);
      const manufacturer = clean(src.manufacturer, 240);
      const key = manufacturerCards.nameKey(manufacturer);
      if (!key) continue;
      if (taken.has(key)) { summary.unchanged.push(manufacturer); continue; }
      if (records.length >= MAX_RECORDS) break;
      let countryId = '';
      const countryName = clean(src.countryName, 120), countryKey = manufacturerCards.nameKey(countryName);
      if (countryKey) {
        let heading = countryByKey.get(countryKey);
        if (!heading && countries.length < MAX_HEADINGS) {
          heading = { id: newId('h'), name: countryName, order: countries.length };
          countries.push(heading);
          countryByKey.set(countryKey, heading);
        }
        countryId = heading ? heading.id : '';
      }
      const record = normalizeRecord({
        manufacturer, origin: 'asas', email: '', countryId, typeId: cleanId(src.typeId),
        id: '', createdAt: stamp, createdBy: actor && actor.id, createdByName: actor && actor.name,
        updatedAt: stamp, updatedBy: actor && actor.id, updatedByName: actor && actor.name, lock: null,
      });
      records.push(record);
      taken.set(key, record);
      summary.added.push(manufacturer);
    }
    return { ...current, countries, records };
  }, null);
  return { summary, revision: saved._revision };
}

function linkRecord(id, asasName, actor) {
  const name = clean(asasName, 240);
  if (!manufacturerCards.nameKey(name)) throw storeError('ASAS üretici adı zorunludur.', 'VALIDATION_ERROR', 400);
  const saved = saveStore(current => {
    const index = recordIndex(current, id);
    const record = current.records[index];
    const held = activeLock(record.lock);
    if (held && held.userId !== cleanId(actor && actor.id)) {
      throw storeError(`Bu kaydı şu anda ${held.userName || held.userId} düzenliyor.`, 'EMAIL_RECORD_LOCKED', 409, { lock: held });
    }
    const other = current.records.find((item, position) => position !== index
      && [item.manufacturer].concat(item.aliases || []).some(value => manufacturerCards.nameKey(value) === manufacturerCards.nameKey(name)));
    if (other) throw storeError(`"${name}" zaten "${other.manufacturer}" kartına bağlı.`, 'MANUFACTURER_ALREADY_LINKED', 409);
    const records = current.records.slice();
    records[index] = normalizeRecord({
      ...record,
      manufacturer: name,
      aliases: [record.manufacturer].concat(record.aliases || []),
      origin: 'asas',
      updatedAt: now(), updatedBy: actor && actor.id, updatedByName: actor && actor.name,
    });
    return { ...current, records };
  }, null);
  return { record: saved.records.find(item => item.id === cleanId(id)), revision: saved._revision };
}

module.exports = {
  attachDeltaStore, createFromAsas, linkRecord, normalizeAliases,
  FILE, LOCK_TTL_MS, DEFAULT_TYPES,
  loadStore, saveStore, publicStore, defaultStore,
  normalizeHeadings, normalizeRecord, activeLock,
  acquireLock, releaseLock, assertHoldsLock,
  createRecord, updateRecord, deleteRecord, replaceHeadings, importRecords,
};
