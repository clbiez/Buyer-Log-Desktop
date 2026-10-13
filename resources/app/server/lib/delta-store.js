'use strict';

const crypto = require('crypto');
const { getBuyerLogInstanceId } = require('./shared-file-transaction');
const { equalMeaningful } = require('./plm-sync-v2');

/* ===================================================================
   ORTAK İŞ VERİSİNİN DELTA MOTORUNA TAŞINMASI — UYUMLULUK KATMANI

   MEVCUT DURUM. Ortak iş verisi (overrides, PLM linkleri, e-posta grupları,
   quotation'lar…) uygulama klasörünün içindeki SERVER_DATA_ROOT'ta JSON
   dosyaları olarak duruyor. Paket ağ klasöründen çalıştığı için bu dosyalar
   SMB üzerinde ve her kullanıcı aynı dosyaya yazıyor; eşzamanlılık dosya
   başına tek bir mkdir kilidiyle sağlanıyor.

   ÖLÇÜLEN PROBLEM. Tek bir kayıt 52 senkron dosya sistemi çağrısı yapıyor ve
   bu süre boyunca sunucu HİÇ KİMSEYE yanıt vermiyor. Kilit kullanıcıları
   doğrusal sıraya diziyor: yerel diskte 4. kullanıcı 4×, 3 ms ağ gecikmesinde
   yaklaşık 19. eşzamanlı kullanıcıda kilit zaman aşımı (409) başlıyor.

   HEDEF MİMARİ. Yazma yerel DB'ye gider (ağ beklemez, journal'a yazılır),
   arka plan sync delta paketlerini ortak klasöre taşır. Alan bazlı merge,
   bugünkü "tüm dosyayı ez" davranışından daha doğrudur: iki kullanıcı farklı
   kayıtları aynı anda güncellediğinde biri diğerini kaybetmez.

   NEDEN TEK ADIMDA GEÇİLMİYOR. sharedSyncFolder üretimde AYARLANMAMIŞ
   durumda ("Sync klasörü ayarlanmadı."). Veri bugün delta motoruna taşınsaydı
   her kullanıcı bir ada olur ve ortak veri paylaşılmayı bırakırdı. Bu yüzden
   geçiş fazlı ve her fazı geri alınabilir:

     shadow      Eski JSON yetkili; okuma ve yazma bugünkü gibi. Delta motoru
                 yalnız bir AYNA kopya alır. Kullanıcı için hiçbir şey
                 değişmez; eşleme ve journal gerçek trafikle doğrulanır.
     delta       Delta motoru yetkili; eski JSON geri dönüş için yazılmaya
                 devam eder. Sync hub'ı yapılandırılıp çalıştığı KANITLANDIKTAN
                 sonra açılır.
     delta-only  Eski JSON yazımı bırakılır. Ağ yazması buradan itibaren
                 kalkar — ölçülen 156 ms'lik donma da burada kaybolur.

   Varsayılan shadow'dur ve üretimde davranışı değiştirmez.

   AYNA YAZIMI ASLA KULLANICININ KAYDINI DÜŞÜREMEZ. Delta tarafı hata verirse
   yutulur ve raporlanır; eski JSON yazması her hâlükârda tamamlanır. Veri
   kaybetmemek, aynayı tutarlı tutmaktan önce gelir.
   =================================================================== */

const MODES = Object.freeze(['shadow', 'delta', 'delta-only']);
const DEFAULT_MODE = 'shadow';
const MIRROR_RETRY_DELAYS_MS = Object.freeze([50, 150, 350, 750, 1500]);

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

function resolveMode(value) {
  const raw = String(value == null ? '' : value).trim().toLowerCase();
  return MODES.includes(raw) ? raw : DEFAULT_MODE;
}

function recordKey(collection, id) {
  const name = String(collection || '');
  // Anahtar ilk iki noktadan ayrıştırıldığı için koleksiyon adı iki nokta
  // içeremez; içerirse kayıtlar sessizce yanlış koleksiyona düşer.
  if (!name || name.includes(':')) throw new Error(`delta-store: koleksiyon adı iki nokta içeremez: ${name}`);
  return `${name}:${id}`;
}

/* Delta motorunun kayıt modeli düz alanlardan oluşur; iç içe nesneler alan
   bazlı merge'den yararlanamaz. Bu yüzden bir koleksiyon, kimliği olan düz
   kayıtlardan oluşmalıdır — plm-style-links'in links haritası gibi. */
function flatten(value) {
  const out = {};
  for (const [key, item] of Object.entries(value && typeof value === 'object' ? value : {})) {
    if (key.startsWith('_')) continue;
    out[key] = item === undefined ? null : item;
  }
  return out;
}

function createDeltaStore({ localDb, mode = DEFAULT_MODE, onError = null, onTrace = null } = {}) {
  if (!localDb) throw new Error('delta-store: localDb gerekli.');
  let active = resolveMode(mode);
  /* Çalışan küme bellekte tutulur. İki sebeple:

     1) Mevcut store API'si SENKRON (loadPlmStyleLinks vb.) ve senkron route
        handler'larından çağrılıyor. Yerel DB okuması async olduğu için, okuma
        yolunu async'e çevirmek bütün çağrı zincirini değiştirmeyi gerektirirdi.
     2) Daha doğrusu da bu: local-first bir uygulamada dayanıklı günlük diskte,
        çalışan küme bellekte durur. Okuma dosya değil O(1) bellek erişimidir.

     Bellek diskin ARKASINDAN gider, önünden değil: her yazma önce yerel DB'ye
     gider, bellek ondan sonra güncellenir. Uzak delta uygulandıktan sonra
     hydrate() yeniden çağrılır. */
  const memory = new Map();
  let hydrated = false;
  let mirrorTail = Promise.resolve(), pendingMirrors = 0;
  const inflight = new Set(); // diske henüz inmemiş ayna yazımları
  const report = (stage, error) => {
    try { if (typeof onError === 'function') onError(stage, error); } catch (_) { /* raporlama ikinci bir hata üretmemeli */ }
  };
  const trace = (event, detail = {}, force = false) => {
    const logger = typeof onTrace === 'function' ? onTrace : (force || process.env.BUYER_LOG_DEBUG_SYNC === '1' ? console.log : null);
    if (!logger) return;
    const fields = { instanceId: getBuyerLogInstanceId(), pid: process.pid, ...detail };
    try { logger(`[SYNC] ${event} ${Object.entries(fields).map(([key, value]) => `${key}=${String(value)}`).join(' ')}`); } catch (_) {}
  };

  const isAuthoritativeNow = () => active === 'delta' || active === 'delta-only';
  const writesLegacyNow = () => active === 'shadow' || active === 'delta';
  function setMode(nextMode) {
    active = resolveMode(nextMode);
    trace('mode:changed', { mode: active }, true);
    return active;
  }

  /* Aynalama arka planda çalışır; başka bir Buyer Log instance'ı yerel DB
     kiracısını kısa süreli tuttuğunda aynayı bırakmak, değişikliği delta
     günlüğünden düşürür. Yalnızca açıkça geçici olan lease çakışmasını retry
     et. Disk dolu, bozuk veri veya izin hataları hemen raporlanmalıdır. */
  async function queueMirrorPatches(items, invocationId, assertCurrent) {
    for (let attempt = 0; ; attempt += 1) {
      try { return await localDb.queuePatches(items, {assertCurrent}); }
      catch (error) {
        if (error && error.code === 'SHARED_WRITE_BUSY' && attempt < MIRROR_RETRY_DELAYS_MS.length) {
          trace('mirror:retry', { invocation: invocationId, attempt: attempt + 1, delayMs: MIRROR_RETRY_DELAYS_MS[attempt] }, true);
          await sleep(MIRROR_RETRY_DELAYS_MS[attempt]);
          continue;
        }
        throw error;
      }
    }
  }

  /* Aynayı günceller. Hiçbir koşulda fırlatmaz: çağıran kod eski JSON yazmasını
     bunun sonucuna bakmadan tamamlamalıdır. */
  async function mirror(collection, entries, { userId = null, guardSource = false, guardCollection = false, assertAuthority, guardDocumentIds = [] } = {}) {
    /* v2 no-op suppression. A caller may hand us a full source map; that must
       not turn into one journal event per record. Compare only fields supplied
       by the caller against the hydrated working set and persist meaningful
       differences. When hydration is unavailable we deliberately fall back to
       the old safe behaviour rather than assuming equality. */
    const effectiveEntries = {};
    let unchanged = 0;
    const bucket = hydrated ? memory.get(collection) : null;
    const expected = guardSource && isAuthoritativeNow() ? Object.fromEntries((guardCollection ? [...(bucket?.entries()||[])] : [...new Set([...Object.keys(entries||{}),...guardDocumentIds])].map(id=>[id,bucket?.get(id)||null])).map(([id,value])=>[id,value?{...value}:null])) : null;
    const assertCurrent=expected||assertAuthority?state=>{
      // Trusted native callback runs under the real journal transaction lease,
      // after queue waits/retries and before any operation is appended.
      assertAuthority?.();if(!expected)return;
      const actual={};
      if(guardCollection)for(const [key,value]of Object.entries(state.records||{})){if(key.startsWith(collection+':')&&!value._deleted)actual[key.slice(collection.length+1)]=flatten(value);}
      else for(const id of Object.keys(expected)){const value=state.records?.[recordKey(collection,id)];actual[id]=value&&!value._deleted?flatten(value):null;}
      if(!equalMeaningful(expected,actual))throw Object.assign(new Error('Shared source changed before journal commit.'),{code:'OFFICE_PREVIEW_CHANGED',statusCode:409});
    }:undefined;
    for (const [rawId, rawValue] of Object.entries(entries || {})) {
      const id = String(rawId || '').trim();
      if (!id) continue;
      const incoming = flatten(rawValue);
      const current = bucket && bucket.get(id);
      if (!current) { effectiveEntries[id] = incoming; continue; }
      const patch = {};
      for (const [key, value] of Object.entries(incoming)) {
        if (!equalMeaningful(current[key], value)) patch[key] = value;
      }
      if (Object.keys(patch).length) effectiveEntries[id] = patch;
      else unchanged += 1;
    }
    const items = Object.entries(effectiveEntries).map(([id, patch]) => ({
      id: recordKey(collection, id), entityType: collection, userId, patch,
    }));
    if (!items.length) return { mirrored: 0, applied: 0, unchanged, ok: true };
    const invocationId = crypto.randomUUID();
    /* Bellek İLK await'ten ÖNCE, yani çağıranın gözünde senkron olarak
       güncellenir. Ayna çağrısı bekletilmeden başlatıldığı (void) ve yazma
       yolları senkron olduğu için, güncellemeyi disk yazmasından sonraya
       bırakmak "kaydet, hemen oku, ESKİ değeri gör" penceresi açıyordu.
       Yazma başarısız olursa staged değer geri alınır; böylece diskte olmayan
       bir değer kalıcı olarak okunmaz. */
    const rollback = stage(collection, effectiveEntries);
    const inflightEntry = { collection, entries: effectiveEntries };
    inflight.add(inflightEntry);
    if (pendingMirrors === 1) trace('mirror:single-flight', { invocation: invocationId, collection }, true);
    pendingMirrors += 1;
    const run = mirrorTail.catch(() => {}).then(async () => {
      trace('mirror:start', { invocation: invocationId, collection, items: items.length, queued: pendingMirrors - 1 });
      try {
        const result = await queueMirrorPatches(items, invocationId, assertCurrent);
        trace('mirror:success', { invocation: invocationId, collection, items: items.length });
        return { mirrored: items.length, applied: result.count, unchanged, ok: true };
      } catch (error) {
        rollback();
        report(`mirror:${collection}`, error);
        trace('mirror:failed', { invocation: invocationId, collection, error: error.message || error }, true);
        return { mirrored: 0, ok: false, error };
      } finally {
        pendingMirrors -= 1;
        inflight.delete(inflightEntry);
      }
    });
    mirrorTail = run.catch(() => {});
    return run;
  }

  /* Belleğe yazar ve önceki hâli geri yükleyen bir geri alma işlevi döndürür. */
  function stage(collection, entries) {
    const bucket = memory.get(collection) || new Map();
    const previous = [];
    for (const [rawId, value] of Object.entries(entries || {})) {
      const id = String(rawId || '').trim();
      if (!id) continue;
      const prior = bucket.has(id) ? bucket.get(id) : undefined;
      const staged = { ...(prior || {}), ...flatten(value) };
      previous.push([id, prior, staged]);
      bucket.set(id, staged);
    }
    memory.set(collection, bucket);
    return () => {
      for (const [id, value, staged] of previous) {
        if (bucket.get(id) !== staged) continue;
        if (value === undefined) bucket.delete(id); else bucket.set(id, value);
      }
    };
  }

  /* Koleksiyon başına tek kayıtlık meta (revision, updatedAt). delta-only
     fazında eski JSON hiç yazılmadığı için revizyon sayacı orada donardı;
     istemciler değişikliği fark edemez, saved view'lar bayat kalırdı. Meta
     ayrı bir koleksiyonda tutulur, böylece iş kayıtlarının arasına karışmaz. */
  /* Sonek, önek DEĞİL: kayıt anahtarı "koleksiyon:kimlik" biçiminde ve ilk
     iki noktadan ayrıştırılıyor. "meta:plm-style-link" gibi bir ad, koleksiyonu
     "meta" diye okutup meta kaydını iş kayıtlarından ayırt edilemez hâle
     getiriyordu. Koleksiyon adları iki nokta içermemelidir. */
  const metaCollection = collection => `${collection}__meta`;
  function readMetaSync(collection) {
    const bucket = hydrated && memory.get(metaCollection(collection));
    return bucket && bucket.get('store') ? { ...bucket.get('store') } : null;
  }
  async function writeMeta(collection, patch) {
    return mirror(metaCollection(collection), { store: patch });
  }

  /* Yerel DB'deki bütün delta kayıtlarını belleğe yükler. Açılışta ve uzak
     delta uygulandıktan sonra çağrılır. Tek bir DB okuması yapar. */
  async function hydrate() {
    try {
      const state = await localDb.read();
      memory.clear();
      for (const [key, value] of Object.entries(state.records || {})) {
        const at = key.indexOf(':');
        if (at <= 0 || (value && value._deleted)) continue;
        const collection = key.slice(0, at), id = key.slice(at + 1);
        if (!memory.has(collection)) memory.set(collection, new Map());
        memory.get(collection).set(id, flatten(value));
      }
      // Diske henüz inmemiş (yoldaki) yazımlar yeniden uygulanır: aksi hâlde arka
      // plan senkronunun hydrate'i yeni kaydı bellekten düşürüyor, sonraki kayıt
      // bu bayat bellekten hesaplanıp kaydı kalıcı olarak siliyordu.
      for (const item of inflight) stage(item.collection, item.entries);
      hydrated = true;
      return { ok: true, collections: memory.size, records: [...memory.values()].reduce((sum, bucket) => sum + bucket.size, 0) };
    } catch (error) {
      report('hydrate', error);
      // hydrated false kalır: okuyucular eski dosyaya düşer, boş veri görmez.
      return { ok: false, error };
    }
  }

  /* Senkron okuma. null döndürmek "delta bu koleksiyonu bilmiyor" demektir ve
     çağıranın eski dosyaya düşmesi gerektiğini söyler. Hydrate edilmemişken ya
     da koleksiyon boşken daima null döner — böylece bir yükleme hatası asla
     "veri silinmiş" gibi görünmez. */
  function readAllSync(collection) {
    if (!hydrated) return null;
    const bucket = memory.get(collection);
    if (!bucket || !bucket.size) return null;
    const out = {};
    for (const [id, value] of bucket) out[id] = { ...value };
    return out;
  }

  async function removeMirrored(collection, ids = []) {
    const list = [...new Set((Array.isArray(ids) ? ids : []).map(id => String(id || '').trim()).filter(Boolean))];
    if (!list.length) return { removed: 0, ok: true };
    try {
      for (const id of list) await localDb.tombstone({ id: recordKey(collection, id), entityType: collection });
      const bucket = memory.get(collection);
      if (bucket) for (const id of list) bucket.delete(id);
      return { removed: list.length, ok: true };
    } catch (error) {
      report(`remove:${collection}`, error);
      return { removed: 0, ok: false, error };
    }
  }

  /* Delta motorundaki koleksiyonu, eski JSON'daki haritayla aynı biçimde
     döndürür. Kayıt yoksa null döner — çağıran eski dosyaya düşer, yani
     geçiş sırasında hiçbir veri görünmez olmaz. */
  async function readAll(collection) {
    try {
      const state = await localDb.read();
      const prefix = `${collection}:`;
      const out = {};
      let found = 0;
      for (const [key, value] of Object.entries(state.records || {})) {
        if (!key.startsWith(prefix) || value && value._deleted) continue;
        out[key.slice(prefix.length)] = flatten(value);
        found += 1;
      }
      return found ? out : null;
    } catch (error) {
      report(`read:${collection}`, error);
      return null;
    }
  }

  /* Eski dosyadaki mevcut veriyi bir kez delta motoruna tohumlar. İşaret
     state.migrations altında tutulur, yani tekrar çalışmaz ve mevcut kayıtları
     ezmez. Eski dosya YERİNDE BIRAKILIR; geri dönüş her zaman mümkündür. */
  async function seedOnce(collection, entries, { userId = null } = {}) {
    const marker = `deltaStoreSeed:${collection}`;
    try {
      const state = await localDb.read();
      if (state.migrations && state.migrations[marker]) return { seeded: 0, skipped: true };
      const result = await mirror(collection, entries, { userId });
      // İşaret YALNIZ ayna gerçekten yazıldığında konur. Aksi hâlde başarısız
      // bir tohumlama kendini "tamamlandı" diye işaretler ve bir daha hiç
      // denenmezdi; koleksiyon delta motorunda kalıcı olarak boş kalırdı.
      if (!result.ok) return { seeded: 0, skipped: false, error: result.error };
      await localDb.transaction(async next => {
        next.migrations = { ...(next.migrations || {}), [marker]: { at: new Date().toISOString(), count: result.mirrored, mode: active } };
        return null;
      });
      return { seeded: result.mirrored, skipped: false };
    } catch (error) {
      report(`seed:${collection}`, error);
      return { seeded: 0, skipped: false, error };
    }
  }

  /* Kayıt bazlı tohumlama. seedOnce koleksiyona tek bir işaret koyar; sonradan
     yeni bir store taşındığında o işaret yüzünden hiç tohumlanmaz. Buradaki
     koşul işaret değil kaydın kendisi: yalnız delta'da HİÇ bulunmayan (ve
     silinmemiş) kimlikler taşınır. Bu doğal olarak idempotenttir ve
     kullanıcının sonradan yaptığı bir değişikliği asla geri almaz. */
  async function seedMissing(collection, entries) {
    try {
      const state = await localDb.read();
      const missing = {};
      for (const [id, value] of Object.entries(entries || {})) {
        if (!String(id || '').trim()) continue;
        const key = recordKey(collection, id);
        if (state.records && state.records[key]) continue;
        if (state.tombstones && state.tombstones[key]) continue;
        missing[id] = value;
      }
      const ids = Object.keys(missing);
      if (!ids.length) return { seeded: 0, ids: [] };
      const result = await mirror(collection, missing);
      return result.ok ? { seeded: ids.length, ids } : { seeded: 0, ids: [], error: result.error };
    } catch (error) {
      report(`seedMissing:${collection}`, error);
      return { seeded: 0, ids: [], error };
    }
  }

  async function flush() {
    // Central Master publication must never overtake a queued local mirror.
    // Awaiting the single-flight tail guarantees the journal/local DB contains
    // every save that was staged before the publication cycle started.
    await mirrorTail.catch(() => {});
    return { ok: pendingMirrors === 0, pending: pendingMirrors };
  }

  return { get mode() { return active; }, get isAuthoritative() { return isAuthoritativeNow(); }, get writesLegacy() { return writesLegacyNow(); }, setMode, mirror, flush, removeMirrored, readAll, readAllSync, readMetaSync, writeMeta, hydrate, seedOnce, seedMissing, recordKey, get isHydrated() { return hydrated; } };
}

/* ===================================================================
   BELGE ADAPTÖRÜ

   Store modüllerinin çoğu tek bir JSON belgesini yönetiyor: oku, değiştir,
   kilit altında yaz. Hepsi aynı üç soruyu soruyor — "delta yetkili mi?",
   "eski dosyayı hâlâ yazmalı mıyım?", "kayıt delta'da var mı?" — ve aynı
   revizyon sarmalamasına ihtiyaç duyuyor. Bu adaptör o mantığı tek yerde
   tutar; yeni bir store taşınırken kopyalanacak bir şey olmaz.

   Revizyon üstverisi neden sarmalanıyor: delta kayıtları alt çizgiyle başlayan
   alanları taşımaz, çünkü motorun kendi _revision ve _fieldRevisions alanları
   orada duruyor ve belgenin kendi _revision'ı onlarla çakışırdı. Sarmalama
   olmadan delta-only fazında sayaç her okumada sıfırlanır, iyimser kilitleme
   (409) çalışmaz olurdu.
   =================================================================== */
const DOCUMENT_REVISION_META = 'storeRevisionMeta';

function toDocumentRecord(value) {
  const out = {};
  for (const [key, item] of Object.entries(value && typeof value === 'object' ? value : {})) {
    if (!key.startsWith('_')) out[key] = item;
  }
  out[DOCUMENT_REVISION_META] = {
    revision: Number(value && value._revision) || 0,
    revisions: (value && value._revisions) || null,
    updatedAt: (value && value._updatedAt) || null,
  };
  return out;
}

function fromDocumentRecord(record) {
  const meta = record && record[DOCUMENT_REVISION_META];
  const out = {};
  for (const [key, item] of Object.entries(record || {})) {
    if (key !== DOCUMENT_REVISION_META && !key.startsWith('_')) out[key] = item;
  }
  out._revision = Number(meta && meta.revision) || 0;
  if (meta && meta.revisions) out._revisions = meta.revisions;
  if (meta && meta.updatedAt) out._updatedAt = meta.updatedAt;
  return out;
}

function createDocumentApi(store, collection = 'store') {
  const mirrorDocuments=(values,options)=>{
    if(!store)return Promise.resolve({mirrored:0,applied:0,unchanged:0,ok:true});
    return Promise.resolve(store.mirror(collection,Object.fromEntries(Object.entries(values).map(([id,value])=>[id,toDocumentRecord(value)])),options)).catch(error=>({mirrored:0,ok:false,error}));
  };
  return {
    async refresh() {
      if (!store || !store.isAuthoritative) return;
      const flushed = await store.flush();
      const hydrated = await store.hydrate();
      if (!flushed.ok || !hydrated.ok) throw Object.assign(new Error('Authoritative shared source unavailable.'), { code: 'SHARED_SYNC_READ_FAILED', statusCode: 503 });
    },
    get attached() { return Boolean(store); },
    get isAuthoritative() { return Boolean(store && store.isAuthoritative); },
    /* Eski dosya yazılmaya devam etmeli mi? delta-only dışında daima evet. */
    get writesLegacy() { return !store || store.writesLegacy; },
    /* Delta'daki belge, ya da "delta bu belgeyi bilmiyor" için null. Çağıran
       null gördüğünde eski dosyaya düşer; veri hiçbir fazda görünmez olmaz. */
    read(id) {
      if (!store || !store.isAuthoritative) return null;
      const records = store.readAllSync(collection);
      const record = records && records[id];
      return record && Object.keys(record).length ? fromDocumentRecord(record) : null;
    },
    exists(id) { return Boolean(this.read(id)); },
    /* Delta yetkiliyken belge kimliklerini listeler. Dosya sistemi artık tek
       kaynak olmadığı için, "bütün çalışma alanlarını gez" gibi toplu bakım
       işleri diskteki adlarla delta'daki kayıtları birleştirmek zorundadır. */
    keys(prefix = '') {
      if (!store || !store.isAuthoritative) return [];
      const records = store.readAllSync(collection) || {};
      return Object.keys(records).filter(id => !prefix || String(id).startsWith(prefix));
    },
    /* Eski çağrılar dönüş değerini kullanmadan ateşle-unut devam eder. Yeni
       çağrılar ise ortak veri için journal sonucunu bekleyebilir. */
    mirror(id,value,options){return mirrorDocuments({[id]:value},options);},
    // Trusted native services may commit related documents in one journal
    // transaction; models never choose document IDs or write payloads.
    mirrorMany:mirrorDocuments,
  };
}

module.exports = {
  MODES, DEFAULT_MODE, resolveMode, createDeltaStore, recordKey, flatten,
  DOCUMENT_REVISION_META, toDocumentRecord, fromDocumentRecord, createDocumentApi,
};
