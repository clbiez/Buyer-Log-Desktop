'use strict';
const crypto=require('crypto');
const commandHash=value=>crypto.createHash('sha256').update(String(value)).digest('hex');

// The original native OAB planner/worker, shared by HTTP and Office adapters.
// Auth transports, batch verification, cache and snapshot semantics stay native.
function createOabBatchService(deps) {
  const jobStore=deps.jobStore || require('./oab-job-store').createOabJobStore();
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
  function checkpointJob(job) {
    try {return jobStore.checkpoint(job.userId,job);}
    catch(error){logRuntimeFailure('oabBatchReceipt',error);throw serviceError('OAB_JOB_STORE_FAILED',503);}
  }
  function assertJobAuthority(job) {
    if (job.authorityLost) throw serviceError(job.authorityErrorCode || 'OAB_ACCESS_REVOKED');
    try {let current=assertAccess({id:job.userId});
      const durable=jobStore.get(job.userId,job.jobId,{includePlan:false});
      if(!durable||durable.interrupted)throw serviceError('OAB_BATCH_INTERRUPTED',409);
      current=assertAccess({id:job.userId});
      job.cancelled=!!(job.cancelled||durable.cancelled); if (job.authorityGuard) job.authorityGuard(current);return current;}
    catch(error) {job.authorityLost=true;job.authorityErrorCode=/^(OFFICE_[A-Z_]+|OAB_BATCH_INTERRUPTED|OAB_JOB_STORE_INVALID|OAB_ACCESS_REVOKED|OAB_CONTINUATION_CHANGED)$/.test(String(error?.code))?error.code:error?.code==='SHARED_WRITE_BUSY'?'OAB_JOB_STORE_BUSY':'OAB_JOB_STORE_FAILED';throw serviceError(job.authorityErrorCode);}
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
    snapshotSaved: job.snapshotSaved,
    snapshotErrorCode: job.snapshotErrorCode,
    interrupted: !!job.interrupted,
    persistence: 'native-job-receipt',
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
      if (job.cancelled) break;
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
      checkpointJob(job);
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
        const persisted=oabSessionStore.update(userId, current => {
        const previous = job.mergeWithSnapshot ? current : null;
        const prevSnapshot = previous && previous.snapshot ? previous.snapshot : null;
        const prevSelection = previous && previous.selection ? previous.selection : {};
        const combined = prevSnapshot
          ? oabBatch.mergeSnapshotRows(prevSnapshot.rows, merged.rows)
          : { rows: merged.rows };
        const fields = prevSnapshot
          ? [...new Set([...(prevSnapshot.fields || []), ...merged.fields])]
          : merged.fields;
        return {
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
        };
        }, {expectedFingerprint:job.snapshotFingerprint,assertAuthority:()=>assertJobAuthority(job)});
        job.savedSnapshotFingerprint=persisted?.sourceFingerprint || null;
        job.snapshotSaved = true;
      } catch (error) {
        job.snapshotSaved = false;
        job.snapshotErrorCode = error?.code === 'OAB_SNAPSHOT_CHANGED' ? 'OAB_SNAPSHOT_CHANGED' : job.authorityLost ? job.authorityErrorCode || 'OAB_ACCESS_REVOKED' : 'OAB_SNAPSHOT_SAVE_FAILED';
        if (!job.errorCode) {job.errorCode=job.snapshotErrorCode;job.error=job.snapshotErrorCode;}
        logRuntimeFailure('oabBatchSnapshot', error);
      }
    }
    try {checkpointJob(job);}
    catch(error) {job.errorCode='OAB_JOB_STORE_FAILED';job.error='OAB_JOB_STORE_FAILED';logRuntimeFailure('oabBatchReceipt',error);}
    finally {jobStore.release(userId,job.jobId);}
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
  function continuationState(profile,jobId,options={}) {
    let current=assertAccess(profile);options.assertAuthority?.(current);
    if(!/^[A-Za-z0-9_-]{1,100}$/.test(current.id))throw serviceError('OAB_CONTINUATION_UNAVAILABLE',403);
    if(!['desktop','browser'].includes(options.transport))throw serviceError('OAB_TRANSPORT_REQUIRED',422);
    const parent=jobStore.get(current.id,jobId),latest=jobStore.latest(current.id,{includePlan:false});
    if(!parent||parent.jobId!==latest?.jobId||parent.running||!parent.interrupted||parent.cancelled||!parent.planHash||parent.transport!==options.transport||!Array.isArray(parent.plannedCombinations)||!parent.plannedCombinations.length||parent.plannedCombinations.length>400)throw serviceError('OAB_CONTINUATION_UNAVAILABLE',409);
    if(oabSessionStore.fingerprint(current.id)!==parent.snapshotFingerprint)throw serviceError('OAB_CONTINUATION_CHANGED',409);
    const validated=oabBatch.planFromCombinations(oabStaticMetadata.planningMetadata(),parent.plannedCombinations);
    const key=item=>JSON.stringify([item.seasonRef,item.merchSubGroupRef,item.buyerGroupRef]);
    if(validated.error||validated.skipped.length||validated.combinations.length!==parent.plannedCombinations.length||JSON.stringify(validated.combinations.map(key))!==JSON.stringify(parent.plannedCombinations.map(key)))throw serviceError('OAB_CONTINUATION_CHANGED',409);
    const approved=new Set(validated.combinations.map(key)),covered=new Set(),results=jobStore.results(current.id,jobId);
    if(!Array.isArray(results))throw serviceError('OAB_CONTINUATION_UNAVAILABLE',409);
    // Only actual captured sources prove completion, including empty results.
    // Failure counters, speculative probe state and a newer snapshot do not.
    for(const result of results){
      const refs=result.buyerGroupRefs;
      if(!Array.isArray(refs)||!refs.length||refs.length>400)throw serviceError('OAB_JOB_RESULT_INVALID',409);
      for(const buyerGroupRef of refs){const identity=key({seasonRef:result.seasonRef,merchSubGroupRef:result.merchSubGroupRef,buyerGroupRef});if(!approved.has(identity)||covered.has(identity))throw serviceError('OAB_JOB_RESULT_INVALID',409);covered.add(identity);}
    }
    const pending=validated.combinations.filter(item=>!covered.has(key(item))),built=pending.length?oabBuildPlan({combinations:pending}):{selection:parent.selection,plan:{combinations:[],skipped:[],error:''},groups:[],capability:oabStore.loadBatchCapability(),skipped:[],error:'',combinationCount:0};
    let cachedCount=0;
    if(!parent.forceRefresh)for(const item of pending){const cacheKey=oabStore.cacheKeyOf(item.seasonRef,item.merchSubGroupRef,item.buyerGroupRef);if(cacheKey&&oabStore.get(cacheKey)?.fresh)cachedCount++;}
    const publicPlan={ok:true,jobId,retainedCombinationCount:covered.size,retainedResultCount:results.length,combinationCount:pending.length,combinations:pending,requestCount:pending.length,cachedCount,pendingCount:pending.length-cachedCount,estimateSeconds:oabBatch.estimateSeconds(pending.length-cachedCount),worstCaseRequestCount:pending.length,worstCaseSeconds:oabBatch.estimateSeconds(pending.length-cachedCount),batchUnproven:false,forceRefresh:!!parent.forceRefresh,maxCombinations:400};
    current=assertAccess(profile);options.assertAuthority?.(current);
    const final=jobStore.latest(current.id,{includePlan:false});
    if(final?.jobId!==parent.jobId||final.revision!==parent.revision||oabSessionStore.fingerprint(current.id)!==parent.snapshotFingerprint)throw serviceError('OAB_CONTINUATION_CHANGED',409);
    current=assertAccess(profile);options.assertAuthority?.(current);
    const sourceFingerprint=commandHash(JSON.stringify({parentId:jobId,revision:parent.revision,planHash:parent.planHash,resultRefs:parent.resultRefs,snapshotFingerprint:parent.snapshotFingerprint,transport:options.transport,authority:userAccess.publicProfile?.(current)||current,publicPlan}));
    return {parent,results,built,sourceFingerprint,publicPlan,authorityFingerprint:commandHash(JSON.stringify(userAccess.publicProfile?.(current)||current))};
  }
  function continuationPlan(profile,jobId,options={}) {
    const state=continuationState(profile,jobId,options);return {...state.publicPlan,sourceFingerprint:state.sourceFingerprint};
  }
  function continueJob(profile,body={},options={}) {
    const current=assertAccess(profile);options.assertAuthority?.(current);
    if(!/^[A-Za-z0-9_-]{1,100}$/.test(current.id))throw serviceError('OAB_CONTINUATION_UNAVAILABLE',403);
    if(options.confirmed!==true)throw serviceError('OAB_APPROVAL_REQUIRED',409);
    if(!/^[a-f0-9]{64}$/.test(body.sourceFingerprint||''))throw serviceError('OAB_CONTINUATION_CHANGED',409);
    if(!['desktop','browser'].includes(options.transport))throw serviceError('OAB_TRANSPORT_REQUIRED',422);
    const commandKey='native-continuation:'+body.jobId+':'+body.sourceFingerprint,commandId='oab_'+commandHash(current.id+'|'+commandKey).slice(0,40);
    const previous=jobStore.get(current.id,commandId);
    const actor=assertAccess(current);options.assertAuthority?.(actor);
    if(previous){if(previous.resumedFrom!==body.jobId||previous.continuationFingerprint!==body.sourceFingerprint||previous.transport!==options.transport)throw serviceError('OAB_CONTINUATION_CHANGED',409);return {started:true,reused:true,job:oabBatchPublicJob(previous)};}
    const state=continuationState(current,body.jobId,options);
    if(body.sourceFingerprint!==state.sourceFingerprint)throw serviceError('OAB_CONTINUATION_CHANGED',409);
    return start(current,{combinations:state.built.plan.combinations,forceRefresh:!!state.parent.forceRefresh},{...options,commandKey,assertAuthority:actor=>{
      if(commandHash(JSON.stringify(userAccess.publicProfile?.(actor)||actor))!==state.authorityFingerprint)throw serviceError('OAB_CONTINUATION_CHANGED',409);
      options.assertAuthority?.(actor);
    }},state);
  }
  function start(profile,body={},options={},continuation=null) {
    const currentUser=assertAccess(profile);
    if (!['desktop','browser'].includes(options.transport)) throw serviceError('OAB_TRANSPORT_REQUIRED',422);
    if (options.assertAuthority) options.assertAuthority(currentUser);
    if(options.commandKey!==undefined && (typeof options.commandKey!=='string'||!options.commandKey||options.commandKey.length>240))throw serviceError('OAB_JOB_COMMAND_INVALID',422);
    const requestBody=Object.fromEntries(['seasonRefs','merchSubGroupRefs','buyerGroupRefs','allBuyerGroups','combinations','forceRefresh'].filter(name=>body?.[name]!==undefined).map(name=>[name,name==='combinations'&&Array.isArray(body[name])?body[name].map(item=>Object.fromEntries(['seasonRef','merchSubGroupRef','buyerGroupRef'].filter(key=>item?.[key]!==undefined).map(key=>[key,item[key]]))):body[name]]));
    const requestFingerprint=commandHash(JSON.stringify({body:requestBody,transport:options.transport})),commandId=options.commandKey?'oab_'+commandHash(currentUser.id+'|'+options.commandKey).slice(0,40):null;
    if(commandId){const prior=jobStore.get(currentUser.id,commandId,{includePlan:false});const latest=assertAccess(currentUser);options.assertAuthority?.(latest);if(prior){if(prior.requestFingerprint!==requestFingerprint)throw serviceError('OAB_JOB_COMMAND_CHANGED',409);assertAccess(currentUser);options.assertAuthority?.(currentUser);return {started:true,reused:true,job:oabBatchPublicJob(prior)};}}
    const durable=jobStore.latest(currentUser.id,{includePlan:false});
    const liveActor=assertAccess(currentUser);options.assertAuthority?.(liveActor);
    if(durable?.running)throw serviceError('OAB_BATCH_IN_PROGRESS',409,{job:oabBatchPublicJob(durable)});
    const existing = oabBatchJobs.get(currentUser.id);
    if (existing && existing.running) throw serviceError('OAB_BATCH_IN_PROGRESS',409,{job:oabBatchPublicJob(existing)});
    const built = continuation?.built || oabBuildPlan(body || {});
    if (built.error) throw serviceError('OAB_PARAMS_REQUIRED',400,{details:{field:built.error}});
    if (!built.combinationCount && !continuation) {
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
      jobId: commandId || 'oab_'+crypto.randomUUID(),
      userId: currentUser.id,
      running: true, cancelled: false,
      startedAt: new Date().toISOString(), finishedAt: null,
      forceRefresh: Boolean(body && body.forceRefresh),
      // Background combinations keep the transport of the request that started them.
      transport: options.transport,
      authorityGuard: options.assertAuthority, authorityLost: false,
      selection: continuation?.parent.selection || built.selection,
      plannedCombinations: continuation?.parent.plannedCombinations || built.plan.combinations,
      // Açık kombinasyon listesi = "yeniden dene": sonuç eldeki snapshot'ın
      // üzerine EKLENİR, yerine geçmez.
      mergeWithSnapshot: continuation ? !!continuation.parent.mergeWithSnapshot : Array.isArray(body && body.combinations) && body.combinations.length > 0,
      queue: [], total: 0, completed: 0, fromCacheCount: 0, rowCount: 0,
      currentLabel: '', results: [], failures: [], merged: null,
      skipped: built.skipped.slice(0, 200),
      batchedBuyerGroups: built.capability.state,
      error: '', errorCode: '',
      snapshotFingerprint: oabSessionStore.fingerprint(currentUser.id),
      snapshotSaved: null, snapshotErrorCode: '',
      ...(continuation?{resumedFrom:continuation.parent.jobId,continuationFingerprint:continuation.sourceFingerprint}:{}),
    };
    // Toplu mod denenecekse önce YETENEK DOĞRULANIR; kuyruk sonuca göre kurulur.
    const multiGroups = built.groups.filter(group => group.buyerGroupRefs.length > 1);
    if (continuation) {
      // Resume exact unverified triples through the original worker. Do not
      // repeat its capability probe or reset already captured result chunks.
      job.results=continuation.results;
      job.rowCount=job.results.reduce((n,result)=>n+result.rows.length,0);
      job.fromCacheCount=job.results.filter(result=>result.fromCache).length;
      job.completed=job.results.length;
      job.queue=built.plan.combinations.map(item=>({...item,buyerGroupRefs:[item.buyerGroupRef]}));
      job.total=job.completed+job.queue.length;
    } else if (built.useBatched && built.capability.state === 'unknown' && multiGroups.length) {
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
    let reserved;
    try {reserved=jobStore.reserve(currentUser.id,job,{requestFingerprint,expectedLatest:continuation?{jobId:continuation.parent.jobId,revision:continuation.parent.revision}:undefined,beforeReserve:()=>{
      if(continuation&&oabSessionStore.fingerprint(currentUser.id)!==continuation.parent.snapshotFingerprint)throw serviceError('OAB_CONTINUATION_CHANGED',409);
      userAccess.appendAudit(assertAccess(currentUser),continuation?'OAB_BATCH_CONTINUE':'OAB_BATCH_START',job.jobId,{combinations:built.combinationCount,requests:job.total,batched:job.batchedBuyerGroups,...(continuation?{resumedFrom:continuation.parent.jobId,retained:continuation.results.length}:{})});
    },assertAuthority:()=>{const current=assertAccess(currentUser);options.assertAuthority?.(current);if(continuation&&oabSessionStore.fingerprint(currentUser.id)!==continuation.parent.snapshotFingerprint)throw serviceError('OAB_CONTINUATION_CHANGED',409);}});}
    catch(error){if(error.code==='OAB_BATCH_IN_PROGRESS')throw serviceError(error.code,409,{job:oabBatchPublicJob(error.job)});throw error;}
    if(reserved.reused)return {started:true,reused:true,job:oabBatchPublicJob(reserved.job)};
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
        try {checkpointJob(job);}catch(error){job.errorCode='OAB_JOB_STORE_FAILED';job.error='OAB_JOB_STORE_FAILED';job.queue=[];logRuntimeFailure('oabBatchReceipt',error);}
      }
      await runOabBatchJob(job, currentUser);
    })();

    return {started:true,job:oabBatchPublicJob(job)};
  }
  function status(profile,jobId) {
    const current=assertAccess(profile),live=oabBatchJobs.get(current.id),saved=jobId?jobStore.get(current.id,jobId,{includePlan:false}):jobStore.latest(current.id,{includePlan:false}),job=live&&live.jobId===saved?.jobId?live:saved;
    assertAccess(current);
    const payload={ok:true,job:oabBatchPublicJob(job)};
    if (job && !job.running) {
      let merged=job.merged;
      if(!merged){try{const recovered=jobStore.results(current.id,job.jobId);if(recovered!==null)merged=oabBatch.mergeReportResults(recovered);}catch(error){payload.resultErrorCode=error.code==='OAB_JOB_RESULT_INVALID'?'OAB_JOB_RESULT_INVALID':'OAB_JOB_RESULT_UNAVAILABLE';}}
      payload.resultAvailable=!!merged;
      if (merged) {payload.rows=merged.rows;payload.fields=merged.fields;payload.sources=merged.sources;payload.fetchedAt=job.interrupted?merged.sources.at(-1)?.fetchedAt||null:job.finishedAt;}
    }
    assertAccess(current);return payload;
  }
  function receipt(profile,jobId) {
    const current=assertAccess(profile),saved=jobId?jobStore.get(current.id,jobId,{includePlan:false}):jobStore.latest(current.id,{includePlan:false});
    assertAccess(current);return {ok:true,job:oabBatchPublicJob(saved),sourceFingerprint:commandHash(JSON.stringify({ownerId:current.id,jobId:jobId||null,receipt:saved}))};
  }
  function resultReport(profile,jobId) {
    const current=assertAccess(profile),saved=jobStore.resultReceipt(current.id,jobId);
    assertAccess(current);
    const merged=Array.isArray(saved.results)?oabBatch.mergeReportResults(saved.results):null;
    assertAccess(current);return {ok:true,job:oabBatchPublicJob(saved.job),sourceFingerprint:commandHash(JSON.stringify({ownerId:current.id,jobId,receipt:saved.job})),resultAvailable:!!merged,...(merged?{rows:merged.rows,fields:merged.fields,sources:merged.sources,fetchedAt:merged.sources.at(-1)?.fetchedAt||saved.job?.finishedAt||null}:{})};
  }
  function completedSnapshot(profile,jobId) {
    const current=assertAccess(profile);
    if(!/^[A-Za-z0-9_-]{1,100}$/.test(current.id))throw serviceError('OAB_CONTINUATION_UNAVAILABLE',403);
    const job=jobStore.get(current.id,jobId,{includePlan:false});
    assertAccess(current);
    if(!job||job.running||job.interrupted||job.snapshotSaved!==true||!/^[a-f0-9]{64}$/.test(job.savedSnapshotFingerprint||''))throw serviceError('OAB_JOB_RESULT_UNAVAILABLE',409);
    const state=oabSessionStore.readCurrent(current.id,{expectedFingerprint:job.savedSnapshotFingerprint,assertAuthority:()=>assertAccess(current)});
    assertAccess(current);return {ok:true,state};
  }
  function cancel(profile) {
    const current=assertAccess(profile),saved=jobStore.cancel(current.id,{assertAuthority:()=>assertAccess(current),beforeCancel:job=>userAccess.appendAudit(assertAccess(current),'OAB_BATCH_CANCEL',job.jobId,{completed:job.completed,total:job.total})}),live=oabBatchJobs.get(current.id);
    assertAccess(current);
    if(saved.job && live?.jobId===saved.job.jobId)live.cancelled=!!saved.job.cancelled;
    return {ok:true,cancelled:saved.cancelled,job:oabBatchPublicJob(live?.jobId===saved.job?.jobId?live:saved.job)};
  }
  function resetCapability(profile) {
    const current=assertAccess(profile),capability=oabStore.resetBatchCapability();
    userAccess.appendAudit(current,'OAB_BATCH_CAPABILITY_RESET','oab',capability);
    return {ok:true,capability};
  }
  return Object.freeze({buildPlan:oabBuildPlan,plan,start,status,cancel,resetCapability,continuationPlan,continueJob,completedSnapshot,receipt,resultReport});
}
module.exports={createOabBatchService};
