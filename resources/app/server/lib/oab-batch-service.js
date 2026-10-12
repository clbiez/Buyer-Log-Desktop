'use strict';

// The original native OAB planner/worker, shared by HTTP and Office adapters.
// Auth transports, batch verification, cache and snapshot semantics stay native.
function createOabBatchService(deps) {
  const {ensurePassConnected,fetchOabReportWithLoginRecovery,logRuntimeFailure,
    oabBatch,oabSessionStore,oabStaticMetadata,oabStore,redactSecrets,userAccess}=deps;
  for (const key of ['profileById','hasArea','hasCapability','appendAudit']) {
    if (typeof userAccess?.[key] !== 'function') throw new TypeError('OAB native access service required: '+key);
  }
  function serviceError(code,statusCode=403,extra={}) {return Object.assign(new Error(code),{code,statusCode,...extra});}
  function assertAccess(profile) {
    const id=profile?.id, current=id && userAccess.profileById(id);
    if (!current || current.id!==id || current.enabled===false || !userAccess.hasArea(current,'overview') || !userAccess.hasCapability(current,'OAB.VIEW')) throw serviceError('OAB_ACCESS_REVOKED');
    return current;
  }
  function assertJobAuthority(job) {
    if (job.authorityLost) throw serviceError(job.authorityErrorCode || 'OAB_ACCESS_REVOKED');
    try {const current=assertAccess({id:job.userId}); if (job.authorityGuard) job.authorityGuard(current);return current;}
    catch(error) {job.authorityLost=true;job.authorityErrorCode=/^OFFICE_[A-Z_]+$/.test(String(error?.code))?error.code:'OAB_ACCESS_REVOKED';throw serviceError(job.authorityErrorCode);}
  }
/* ===================================================================
   v7.20 — OAB ÇOKLU SEÇİM: ARKA PLAN TOPLU ÇEKME

   Kullanıcı talebi: Season / MAG / Buyer Group çoklu seçilebilsin, seçilen
   kombinasyonların tamamı OAB'dan çekilip TEK rapor olarak gösterilsin.

   NEDEN ARKA PLAN İŞİ: tek OAB rapor çağrısı kullanıcının ortamında 15-25
   saniye sürebiliyor. Mevcut batch sıralama, kısmi başarı ve iptal semantiği
   korunur; authentication transport değişikliği bu planlama davranışını değiştirmez. HTTP
   isteğini açık tutmak hem tarayıcıyı hem sunucuyu kilitlerdi; iş kimlikli bir
   arka plan işi olarak yürür, istemci ilerlemeyi ayrı bir uçtan okur.

   VERİ KAYBI YOK (§142): kısmi başarı korunur. Başarısız kombinasyon ADIYLA
   raporlanır; başarılı olanlar atılmaz. İptal edilen iş, o ana kadar çekilmiş
   kombinasyonları yine döndürür.
   =================================================================== */
const oabBatchJobs = new Map(); // userId -> job
const OAB_BATCH_MAX_COMBINATIONS = 400; // kaçak bir "hepsini seç" işini sınırlar

function oabCombinationLabel(item) {
  const labels = oabStaticMetadata.labelsFor(item);
  const buyer = Array.isArray(item.buyerGroupRefs) && item.buyerGroupRefs.length > 1
    ? `${item.buyerGroupRefs.length} Buyer Group`
    : labels.buyerGroup;
  return [labels.season, labels.mag, buyer].filter(Boolean).join(' · ');
}
function oabBatchPublicJob(job) {
  if (!job) return null;
  return {
    jobId: job.jobId,
    running: job.running,
    cancelled: job.cancelled,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    total: job.total,
    completed: job.completed,
    fromCache: job.fromCacheCount,
    currentLabel: job.currentLabel,
    rowCount: job.rowCount,
    failures: job.failures,
    skipped: job.skipped,
    batchedBuyerGroups: job.batchedBuyerGroups,
    error: job.error,
    errorCode: job.errorCode,
  };
}
// Tek bir (Sezon, MAG, BuyerGroup listesi) isteğini çeker. Cache yalnız TEK
// buyer group'lu istekler için kullanılır: mevcut cache anahtarı üçlü bazlıdır
// ve toplu bir yanıtı tek anahtara yazmak sessiz veri karışması olurdu.
async function oabFetchOneCombination(userId, currentUser, item, forceRefresh, transport, job) {
  assertJobAuthority(job);
  const single = !Array.isArray(item.buyerGroupRefs) || item.buyerGroupRefs.length <= 1;
  const buyerGroupRef = single
    ? (Array.isArray(item.buyerGroupRefs) ? item.buyerGroupRefs[0] : item.buyerGroupRef)
    : '';
  if (single) {
    const key = oabStore.cacheKeyOf(item.seasonRef, item.merchSubGroupRef, buyerGroupRef);
    if (!forceRefresh && key) {
      const cached = oabStore.get(key);
      if (cached && cached.fresh) {
        return { seasonRef:item.seasonRef, merchSubGroupRef:item.merchSubGroupRef, buyerGroupRef, buyerGroupRefs:[buyerGroupRef], rows:cached.rows, fields:cached.fields, fromCache:true, fetchedAt:cached.fetchedAt };
      }
    }
  }
  const params = single
    ? { seasonRef:item.seasonRef, merchSubGroupRef:item.merchSubGroupRef, buyerGroupRef }
    : { seasonRef:item.seasonRef, merchSubGroupRef:item.merchSubGroupRef, buyerGroupRefs:item.buyerGroupRefs };
  const assertAuthority = () => assertJobAuthority(job);
  await ensurePassConnected(userId, params, transport, assertAuthority);
  assertJobAuthority(job);
  const rows = await fetchOabReportWithLoginRecovery(userId, params, transport, assertAuthority);
  assertJobAuthority(job);
  const fields = [...new Set(rows.flatMap(row => Object.keys(row || {})))];
  let fetchedAt = new Date().toISOString();
  if (single) {
    const key = oabStore.cacheKeyOf(item.seasonRef, item.merchSubGroupRef, buyerGroupRef);
    if (key) {
      const saved = oabStore.set(key, { rows, fields, params: { seasonRef:item.seasonRef, merchSubGroupRef:item.merchSubGroupRef, buyerGroupRef } });
      if (saved && saved.fetchedAt) fetchedAt = saved.fetchedAt;
    }
  }
  return { seasonRef:item.seasonRef, merchSubGroupRef:item.merchSubGroupRef, buyerGroupRef, buyerGroupRefs: single ? [buyerGroupRef] : item.buyerGroupRefs, rows, fields, fromCache:false, fetchedAt };
}
/* Toplu BuyerGroupRefs yeteneğini BİR KEZ dener ve YANIT İÇERİĞİNDEN doğrular.
   Doğrulanamazsa (parametre yok sayılmış, alan yok, tek grup dönmüş) yetenek
   'unsupported' yazılır ve kombinasyon başına isteğe düşülür. Doğrulama
   başarısızsa çekilen satırlar ATILIR: yarım veriyi rapora katmak, kullanıcıya
   sessizce eksik rapor vermek olurdu. */
async function oabProbeBatchedBuyerGroups(userId, group, transport, job) {
  const probe = await oabFetchOneCombination(userId, null, { seasonRef:group.seasonRef, merchSubGroupRef:group.merchSubGroupRef, buyerGroupRefs:group.buyerGroupRefs }, true, transport, job);
  const verdict = oabBatch.verifyBatchedBuyerGroupResponse(probe.rows, group.buyerGroupRefs);
  assertJobAuthority(job);
  oabStore.saveBatchCapability({ state: verdict.verified ? 'supported' : 'unsupported', reason: verdict.reason, distinctGroups: verdict.distinct });
  return { verdict, result: verdict.verified ? probe : null };
}
async function runOabBatchJob(job, currentUser) {
  const userId = job.userId;
  try {
    for (const item of job.queue) {
      if (job.cancelled) break;
      assertJobAuthority(job);
      job.currentLabel = oabCombinationLabel(item);
      try {
        const result = await oabFetchOneCombination(userId, currentUser, item, job.forceRefresh, job.transport, job);
        assertJobAuthority(job);
        job.results.push(result);
        job.rowCount += result.rows.length;
        if (result.fromCache) job.fromCacheCount += 1;
      } catch (error) {
        if (error?.code === 'OAB_ACCESS_REVOKED') {job.authorityLost=true;job.authorityErrorCode='OAB_ACCESS_REVOKED';}
        /* Tek kombinasyonun hatası bütün işi çöpe atmaz; adıyla raporlanır.

           v7.23: hata kaydı KOMBİNASYON REFERANSLARINI taşır. Kullanıcı
           "yeniden dene" dediğinde yalnız bu üçlüler istenir. Toplu (çok
           Buyer Group'lu) bir istekte hata, kapsadığı bütün üçlüleri etkiler. */
        const refs = (Array.isArray(item.buyerGroupRefs) && item.buyerGroupRefs.length
          ? item.buyerGroupRefs
          : [item.buyerGroupRef]).filter(value => value != null && value !== '');
        job.failures.push({
          label: oabCombinationLabel(item),
          code: String(error && error.code || 'OAB_COMBINATION_FAILED'),
          message: redactSecrets(String(error && error.message || error)).slice(0, 300),
          combinations: refs.map(buyerGroupRef => ({
            seasonRef: item.seasonRef,
            merchSubGroupRef: item.merchSubGroupRef,
            buyerGroupRef,
            label: oabCombinationLabel({ seasonRef: item.seasonRef, merchSubGroupRef: item.merchSubGroupRef, buyerGroupRef }),
          })),
        });
        if (job.authorityLost || error && (error.code === 'OAB_ACCESS_REVOKED' || error.code === 'OAB_AUTH_REQUIRED' || error.code === 'OAB_AUTH_EXPIRED')) {
          job.error = redactSecrets(String(error.message || error)).slice(0, 300);
          job.errorCode = String(error.code);
          break;
        }
      }
      job.completed += 1;
      job.currentLabel = '';
    }
  } catch (error) {
    job.error = redactSecrets(String(error && error.message || error)).slice(0, 300);
    job.errorCode = String(error && error.code || 'OAB_BATCH_FAILED');
  } finally {
    job.running = false;
    job.finishedAt = new Date().toISOString();
    const merged = oabBatch.mergeReportResults(job.results);
    job.merged = merged;
    if (merged.rows.length || job.results.length) {
      try {
        /* v7.23 — KISMİ İŞ SNAPSHOT'I EZMEZ.

           Yeniden deneme işi yalnız başarısız üçlüleri çeker. Sonucu doğrudan
           yazmak, kullanıcının elindeki tüm raporu (başarıyla çekilmiş diğer
           kombinasyonlar dâhil) silerdi. Kalıcı snapshot bu yüzden eldekiyle
           BİRLEŞTİRİLİR; seçim de birleşiktir ki açılışta aynı kapsam geri
           yüklensin. */
        assertJobAuthority(job);
        const previous = job.mergeWithSnapshot ? oabSessionStore.load(userId) : null;
        const prevSnapshot = previous && previous.snapshot ? previous.snapshot : null;
        const prevSelection = previous && previous.selection ? previous.selection : {};
        const combined = prevSnapshot
          ? oabBatch.mergeSnapshotRows(prevSnapshot.rows, merged.rows)
          : { rows: merged.rows };
        const fields = prevSnapshot
          ? [...new Set([...(prevSnapshot.fields || []), ...merged.fields])]
          : merged.fields;
        oabSessionStore.save(userId, {
          selection: prevSnapshot ? {
            seasonRefs: oabBatch.mergeRefLists(prevSelection.seasonRefs, job.selection.seasonRefs),
            merchSubGroupRefs: oabBatch.mergeRefLists(prevSelection.merchSubGroupRefs, job.selection.merchSubGroupRefs),
            buyerGroupRefs: oabBatch.mergeRefLists(prevSelection.buyerGroupRefs, job.selection.buyerGroupRefs),
            allBuyerGroups: Boolean(prevSelection.allBuyerGroups),
          } : job.selection,
          rows: combined.rows,
          fields,
          fetchedAt: job.finishedAt,
          fromCache: !prevSnapshot && job.fromCacheCount === job.results.length && job.results.length > 0,
        });
      } catch (error) { logRuntimeFailure('oabBatchSnapshot', error); }
    }
  }
}
// Planı hesaplar: kaç istek, tahmini süre, kaçı önbellekten gelecek, hangi
// kombinasyonlar karşılıksız. İstemcideki tahmin bu UÇTAN gelir; ekranda
// gösterilen sayı ile gerçekte çekilen sayı ayrışamaz.
function oabBuildPlan(body) {
  const selection = {
    seasonRefs: Array.isArray(body.seasonRefs) ? body.seasonRefs : [],
    merchSubGroupRefs: Array.isArray(body.merchSubGroupRefs) ? body.merchSubGroupRefs : [],
    buyerGroupRefs: Array.isArray(body.buyerGroupRefs) ? body.buyerGroupRefs : [],
    allBuyerGroups: Boolean(body.allBuyerGroups),
  };
  /* v7.23 — AÇIK KOMBİNASYON LİSTESİ.

     "Başarısızları yeniden dene" tam bir yeniden planlama yapmamalı: yalnız
     alınamayan üçlüler istenmelidir. Aksi halde zaten elde olan kombinasyonlar
     yeniden çekilir, kullanıcı dakikalarca bekler ve eldeki rapor bir süre
     eksik kalır. Liste yine de metadata ile DOĞRULANIR — istemciden gelen bir
     üçlü doğrudan PASS'e sorulmaz. */
  const explicit = Array.isArray(body.combinations) ? body.combinations : null;
  const plan = explicit
    ? oabBatch.planFromCombinations(oabStaticMetadata.planningMetadata(), explicit)
    : oabBatch.planCombinations(oabStaticMetadata.planningMetadata(), selection);
  /* Açık liste geldiğinde seçim, listenin KENDİSİNDEN türetilir. Aksi halde
     yeniden deneme işi BOŞ bir seçimle kaydedilir; snapshot geri yüklenirken
     hangi filtrelerle çekildiği bilinemez ve son rapor açılışta kaybolur. */
  if (explicit) {
    selection.seasonRefs = oabBatch._uniqueRefs(plan.combinations.map(item => item.seasonRef));
    selection.merchSubGroupRefs = oabBatch._uniqueRefs(plan.combinations.map(item => item.merchSubGroupRef));
    selection.buyerGroupRefs = oabBatch._uniqueRefs(plan.combinations.map(item => item.buyerGroupRef));
    selection.allBuyerGroups = false;
  }
  const capability = oabStore.loadBatchCapability();
  // 'unknown' iken de toplu mod DENENECEĞİ için plan ona göre gösterilir; ilk
  // istekte doğrulanmazsa iş kendini kombinasyon başına moda çevirir ve
  // ilerleme toplamı güncellenir.
  const useBatched = capability.state !== 'unsupported';
  const groups = oabBatch.groupBySeasonMag(plan.combinations);
  const requestCount = useBatched ? groups.length : plan.combinations.length;
  let cachedCount = 0;
  if (!useBatched) {
    for (const item of plan.combinations) {
      const key = oabStore.cacheKeyOf(item.seasonRef, item.merchSubGroupRef, item.buyerGroupRef);
      const cached = key ? oabStore.get(key) : null;
      if (cached && cached.fresh) cachedCount += 1;
    }
  }
  const pending = Math.max(0, requestCount - cachedCount);
  /* EN KÖTÜ DURUM AYRICA HESAPLANIR.

     Yetenek henüz 'unknown' iken plan toplu modu VARSAYAR ve 164 kombinasyon
     "4 istek · ~80 sn" görünür. Doğrulama başarısız olursa aynı iş 164 istek,
     yani ~55 dakikadır. İyimser sayıyı tek başına göstermek, kullanıcıyı
     onaysız biçimde saatlik bir işe sokardı. Bu yüzden onay eşiği DAİMA en
     kötü duruma bakar; ekranda da ikisi birden yazılır. */
  const worstCaseRequests = capability.state === 'supported' ? requestCount : plan.combinations.length;
  const worstCasePending = Math.max(0, worstCaseRequests - (capability.state === 'supported' ? cachedCount : 0));
  return {
    selection, plan, groups, capability, useBatched,
    combinationCount: plan.combinations.length,
    requestCount, cachedCount, pendingCount: pending,
    estimateSeconds: oabBatch.estimateSeconds(pending),
    worstCaseRequestCount: worstCaseRequests,
    worstCaseSeconds: oabBatch.estimateSeconds(worstCasePending),
    batchUnproven: capability.state === 'unknown' && worstCaseRequests > requestCount,
    skipped: plan.skipped.map(item => ({ ...item, label: oabCombinationLabel(item) })),
    error: plan.error,
  };
}

  function plan(body={}) {
    const built=oabBuildPlan(body);
    return {ok:!built.error,error:built.error||undefined,combinationCount:built.combinationCount,requestCount:built.requestCount,cachedCount:built.cachedCount,pendingCount:built.pendingCount,estimateSeconds:built.estimateSeconds,worstCaseRequestCount:built.worstCaseRequestCount,worstCaseSeconds:built.worstCaseSeconds,batchUnproven:built.batchUnproven,useBatched:built.useBatched,capability:built.capability,skipped:built.skipped.slice(0,200),skippedCount:built.skipped.length,maxCombinations:OAB_BATCH_MAX_COMBINATIONS};
  }
  function start(profile,body={},options={}) {
    const currentUser=assertAccess(profile);
    if (!['desktop','browser'].includes(options.transport)) throw serviceError('OAB_TRANSPORT_REQUIRED',422);
    if (options.assertAuthority) options.assertAuthority(currentUser);
    const existing = oabBatchJobs.get(currentUser.id);
    if (existing && existing.running) throw serviceError('OAB_BATCH_IN_PROGRESS',409,{job:oabBatchPublicJob(existing)});
    const built = oabBuildPlan(body || {});
    if (built.error) throw serviceError('OAB_PARAMS_REQUIRED',400,{details:{field:built.error}});
    if (!built.combinationCount) {
      throw serviceError('OAB_NO_VALID_COMBINATION',400,{skipped:built.skipped.slice(0,50)});
    }
    if (built.combinationCount > OAB_BATCH_MAX_COMBINATIONS) {
      throw serviceError('OAB_BATCH_TOO_LARGE',400,{details:{combinationCount:built.combinationCount,maxCombinations:OAB_BATCH_MAX_COMBINATIONS}});
    }
    // Authentication is checked by the first real combination fetch, so
    // cached-only plans never need a session. Desktop clients sign in through
    // the hidden Electron OAB session before starting; browser mode keeps the
    // v7.0.80 existing-browser behaviour.
    const job = {
      jobId: `oab_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      userId: currentUser.id,
      running: true, cancelled: false,
      startedAt: new Date().toISOString(), finishedAt: null,
      forceRefresh: Boolean(body && body.forceRefresh),
      // Background combinations keep the transport of the request that started them.
      transport: options.transport,
      authorityGuard: options.assertAuthority, authorityLost: false,
      selection: built.selection,
      // Açık kombinasyon listesi = "yeniden dene": sonuç eldeki snapshot'ın
      // üzerine EKLENİR, yerine geçmez.
      mergeWithSnapshot: Array.isArray(body && body.combinations) && body.combinations.length > 0,
      queue: [], total: 0, completed: 0, fromCacheCount: 0, rowCount: 0,
      currentLabel: '', results: [], failures: [], merged: null,
      skipped: built.skipped.slice(0, 200),
      batchedBuyerGroups: built.capability.state,
      error: '', errorCode: '',
    };
    // Toplu mod denenecekse önce YETENEK DOĞRULANIR; kuyruk sonuca göre kurulur.
    const multiGroups = built.groups.filter(group => group.buyerGroupRefs.length > 1);
    if (built.useBatched && built.capability.state === 'unknown' && multiGroups.length) {
      job.queue = built.groups.map(group => ({ ...group }));
      job.total = job.queue.length;
      job.probe = multiGroups[0];
    } else if (built.useBatched && built.capability.state === 'supported') {
      job.queue = built.groups.map(group => ({ ...group }));
      job.total = job.queue.length;
    } else {
      job.queue = built.plan.combinations.map(item => ({ ...item, buyerGroupRefs: [item.buyerGroupRef] }));
      job.total = job.queue.length;
    }
    userAccess.appendAudit(currentUser, 'OAB_BATCH_START', job.jobId, { combinations: built.combinationCount, requests: job.total, batched: job.batchedBuyerGroups });
    oabBatchJobs.set(currentUser.id, job);
    // İş arka planda yürür; istek hemen döner.
    void (async () => {
      if (job.probe) {
        try {
          const { verdict, result } = await oabProbeBatchedBuyerGroups(job.userId, job.probe, job.transport, job);
          assertJobAuthority(job);
          job.batchedBuyerGroups = verdict.verified ? 'supported' : 'unsupported';
          if (verdict.verified && result) {
            job.results.push(result); job.rowCount += result.rows.length; job.completed += 1;
            job.queue = job.queue.filter(group => !(group.seasonRef === job.probe.seasonRef && group.merchSubGroupRef === job.probe.merchSubGroupRef));
          } else {
            // Toplu mod doğrulanmadı: kuyruk kombinasyon başına yeniden kurulur.
            job.queue = built.plan.combinations.map(item => ({ ...item, buyerGroupRefs: [item.buyerGroupRef] }));
            job.completed = 0; job.results = []; job.rowCount = 0;
            job.total = job.queue.length;
          }
        } catch (error) {
          // Doğrulama isteği başarısız olsa da iş kombinasyon başına devam
          // eder; bu kayıt yalnız bilgilendirmedir, yeniden denenecek bir
          // kombinasyon listesi taşımaz (kuyruk zaten yeniden kuruluyor).
          if (error?.code === 'OAB_ACCESS_REVOKED') {job.authorityLost=true;job.authorityErrorCode='OAB_ACCESS_REVOKED';}
          if (job.authorityLost) { job.errorCode = String(error.code); job.error = String(error.message); job.queue = []; }
          else {
          job.failures.push({ label: oabCombinationLabel(job.probe), code: String(error && error.code || 'OAB_BATCH_PROBE_FAILED'), message: redactSecrets(String(error && error.message || error)).slice(0, 300), combinations: [] });
          job.queue = built.plan.combinations.map(item => ({ ...item, buyerGroupRefs: [item.buyerGroupRef] }));
          job.completed = 0; job.results = []; job.rowCount = 0; job.total = job.queue.length;
          }
        }
        job.probe = null;
      }
      await runOabBatchJob(job, currentUser);
    })();

    return {started:true,job:oabBatchPublicJob(job)};
  }
  function status(profile) {
    const current=assertAccess(profile),job=oabBatchJobs.get(current.id);
    const payload={ok:true,job:oabBatchPublicJob(job)};
    if (job && !job.running && job.merged) {payload.rows=job.merged.rows;payload.fields=job.merged.fields;payload.sources=job.merged.sources;payload.fetchedAt=job.finishedAt;}
    return payload;
  }
  function cancel(profile) {
    const current=assertAccess(profile),job=oabBatchJobs.get(current.id);
    if (!job || !job.running) return {ok:true,cancelled:false,job:oabBatchPublicJob(job)};
    job.cancelled = true;
    userAccess.appendAudit(current,'OAB_BATCH_CANCEL',job.jobId,{completed:job.completed,total:job.total});
    return {ok:true,cancelled:true,job:oabBatchPublicJob(job)};
  }
  function resetCapability(profile) {
    const current=assertAccess(profile),capability=oabStore.resetBatchCapability();
    userAccess.appendAudit(current,'OAB_BATCH_CAPABILITY_RESET','oab',capability);
    return {ok:true,capability};
  }
  return Object.freeze({buildPlan:oabBuildPlan,plan,start,status,cancel,resetCapability});
}
module.exports={createOabBatchService};
