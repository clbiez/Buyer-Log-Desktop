'use strict';

const crypto = require('crypto');

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalize(value[key])]));
  }
  return value;
}

function queryFingerprint(plan) {
  const canonical = JSON.stringify(canonicalize(plan || {}));
  return crypto.createHash('sha256').update(canonical, 'utf8').digest('hex');
}

/* Tek bir yenileme koşumu boyunca özdeş sorgu planlarını tek sorguya indirir.
   Koordinatör her yenilemede yeniden kurulur; yani burada tutulan şey kalıcı
   bir önbellek değil, O KOŞUMUN kendi sonucudur.

   v7.81 — ZAMANLAMAYA BAĞIMLILIK KALDIRILDI.

   Önceki hâlde kayıt `finally` içinde siliniyordu; yani birleştirme yalnız
   plan HÂLÂ UÇUŞTAYKEN gelen ikinci çağrı için çalışıyordu. Ölçüm: aynı ufka
   sahip CP ve Orders kapsamları eşzamanlılık 2'de tek sorguya iniyor ama
   eşzamanlılık 1'de (ya da kapsam sayısı eşzamanlılık sınırını aştığında)
   ikinci kez sorguya gidiyordu — aynı veriyi, aynı anda, iki kez.

   Sonuç koşum boyunca tutulur. Bu, ek bellek YÜKÜ getirmez: runRoleScopes
   zaten bütün kapsam sonuçlarını aynı anda elinde tutuyor, burada saklanan
   aynı nesne referansıdır.

   HATA SAKLANMAZ: başarısız bir plan kayıttan düşer, böylece geçici bir arıza
   koşumun geri kalanını zehirlemez. */
function createSourceQueryCoordinator() {
  const results = new Map();
  let actualRequests = 0;
  let reusedRequests = 0;
  async function run(plan, executor) {
    const fingerprint = queryFingerprint(plan);
    if (results.has(fingerprint)) {
      reusedRequests += 1;
      return results.get(fingerprint);
    }
    actualRequests += 1;
    const promise = Promise.resolve().then(executor).catch(error => {
      results.delete(fingerprint);
      throw error;
    });
    results.set(fingerprint, promise);
    return promise;
  }
  return {
    run,
    fingerprint: queryFingerprint,
    /* `retained`: bu koşum için tutulan farklı plan sayısı. Eski adı `inFlight`
       idi ve artık yalan söylerdi — kayıtlar tamamlandıktan sonra da durur.
       Metriği okuyan bir istemci yok; ad doğru olsun diye değiştirildi. */
    metrics: () => ({ actualRequests, reusedRequests, retained: results.size }),
    clear: () => results.clear(),
  };
}

function normalizeHorizonGroup(group, allowedTargets = []) {
  const source = group && typeof group === 'object' ? group : {};
  const targets = [...new Set((Array.isArray(source.moduleIds) ? source.moduleIds : source.targets || [])
    .map(value => String(value || '').toLowerCase().trim())
    .filter(value => !allowedTargets.length || allowedTargets.includes(value)))];
  const horizon = source.horizon && typeof source.horizon === 'object'
    ? { ...source.horizon }
    : {};
  delete horizon.groupId;
  delete horizon.linkedGroupId;
  return {
    id: String(source.id || '').trim().slice(0, 100),
    name: String(source.name || '').trim().slice(0, 120),
    moduleIds: targets,
    connectionId: String(source.connectionId || '').trim().slice(0, 160),
    horizon,
    updatedAt: String(source.updatedAt || ''),
  };
}

function normalizeHorizonGroups(value, allowedTargets = []) {
  const items = Array.isArray(value) ? value : [];
  const seen = new Set();
  return items.map(item => normalizeHorizonGroup(item, allowedTargets))
    .filter(item => item.id && item.name && item.moduleIds.length)
    .filter(item => { if (seen.has(item.id)) return false; seen.add(item.id); return true; });
}

module.exports = { canonicalize, queryFingerprint, createSourceQueryCoordinator, normalizeHorizonGroup, normalizeHorizonGroups };
