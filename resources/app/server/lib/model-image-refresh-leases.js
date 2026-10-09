'use strict';

/* Lokal görseller ağdan bağımsızdır. Dağıtık kira yalnız gerçekten paylaşılan
 * Koleksiyon satırları için gerekir. Bırakma sabit paralellikle yürütülür;
 * tek bir yavaş OneDrive unlink'i diğer 1.000 kilidin bırakılmasını bekletmez.
 */
const DEFAULT_CONCURRENCY = 8;
function workersFor(length, requested) {
  return Math.min(Math.max(1, Math.trunc(Number(requested) || DEFAULT_CONCURRENCY)), Math.max(1, length), 16);
}
async function releaseLeasesBounded(held, concurrency = DEFAULT_CONCURRENCY) {
  const entries = Array.isArray(held) ? held : [];
  let cursor = 0, errors = 0;
  await Promise.all(Array.from({ length: workersFor(entries.length, concurrency) }, async () => {
    for (;;) {
      const index = cursor++;
      if (index >= entries.length) return;
      try { await entries[index].lease.release(); }
      catch (_) { errors++; }
    }
  }));
  return { released: entries.length, errors };
}
async function acquireCollectionRefreshLeases(items, options = {}) {
  const list = Array.isArray(items) ? items : [];
  const keys = options.eligibleKeys instanceof Set ? options.eligibleKeys : new Set();
  const ownerId = String(options.ownerId || '').trim();
  const gated = ownerId ? list.filter(item => item && keys.has(item.key)) : [];
  // Kişisel CP / Orders / paylaşılmamış Koleksiyon burada hiçbir SMB/OneDrive
  // erişimi yapmadan doğrudan üst kaynağa geçer.
  if (!gated.length) return { held: list, busy: [], release: async () => ({ released: 0, errors: 0 }), protectedCount: 0 };
  if (typeof options.available === 'function' && !(await options.available())) {
    return { held: list, busy: [], release: async () => ({ released: 0, errors: 0 }), protectedCount: 0 };
  }
  const leasedKeys = new Set(gated.map(item => item.key));
  const localOnly = list.filter(item => !item || !leasedKeys.has(item.key));
  const obtained = [], busy = [];
  let cursor = 0;
  await Promise.all(Array.from({ length: workersFor(gated.length, options.concurrency) }, async () => {
    for (;;) {
      const index = cursor++;
      if (index >= gated.length) return;
      const item = gated[index];
      try {
        // Sahip öneki: farklı Koleksiyonların aynı PLM'i birbirini engellemez.
        const lease = await options.acquire('collection:' + ownerId + ':' + item.key, item);
        if (lease && lease.acquired) obtained.push({ item, lease });
        else busy.push(item);
      } catch (_) {
        // Paylaşılan disk erişilemiyorsa yerel işlem çalışabilmeli.
        localOnly.push(item);
      }
    }
  }));
  return {
    held: [...localOnly, ...obtained.map(entry => entry.item)],
    busy,
    protectedCount: obtained.length,
    release: () => releaseLeasesBounded(obtained, options.concurrency),
  };
}
module.exports = { DEFAULT_CONCURRENCY, releaseLeasesBounded, acquireCollectionRefreshLeases };
