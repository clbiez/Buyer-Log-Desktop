'use strict';
/* İşçi görevi 'read-model-cp-query' (#1078, WS5 alt PR 2): CP pencereli okuma.
 * Hesaplanmış sütunlar cp-computed-task.ensureComputed ile AYNI barındırıcı ve
 * AYNI önbellekten gelir (bağlam/cevap/gün değişmediyse yeniden hesaplanmaz).
 * Değerler paylaşılan veri kümesi satırlarına YAZILMAZ: sorgu `computedOf(row)` ile okur
 * (Genel Bakış ve diğer kapsamlar aynı veri kümesini kullanır).
 *
 * payload: cp-computed-task ile aynı { dataset, scopeKey, lang, context, tasks } +
 *   { kind:'query'|'facets', request:<cp-query.js sürüm 1 gövdesi> }
 * Sonuç: { result, timing } · query sonucunda `computed`: pencere satırlarının
 *   hesaplanmış sütun kayıtları (cp-computed FIELDS sırasıyla JSON dizileri; ids ile hizalı). */
const {performance}=require('node:perf_hooks');
const {ensureComputed,FIELDS}=require('./cp-computed-task');
const cpQuery=require('./cp-query');

function helpersFor(entry,current){
  const win=entry.host.window,OD=win.BLOrderDecisionEngine,Model=win.BLOverviewModel;
  const codes=OD&&typeof OD.priorityIds==='function'?OD.priorityIds():(OD&&Array.isArray(OD.ACTION_PRIORITIES)?OD.ACTION_PRIORITIES.slice():[]);
  return {
    computedOf:row=>current.out.get(row)||null,
    // app-main.js actionPriorityCode / priorityRank / actionPriorityCodes (kullanıcının kataloğu).
    code:value=>Model.actionPriorityCode(value,OD)||'',
    rank:code=>code&&OD&&typeof OD.priorityRank==='function'?OD.priorityRank(code):Number.POSITIVE_INFINITY,
    codes:()=>codes.slice(),
  };
}

async function execute(payload,deps){
  const started=performance.now();
  if(!payload||(payload.kind!=='query'&&payload.kind!=='facets'))throw Object.assign(new Error('Invalid compute request'),{code:'COMPUTE_JOB_INVALID'});
  const computed=await ensureComputed(payload,deps);
  if(computed.missing)return {missing:computed.missing,warm:computed.warm};
  const {dataset,entry,current,hostMs,loads}=computed;
  const computeMs=performance.now()-started;
  const helpers=helpersFor(entry,current);
  const queryStarted=performance.now();
  let result;
  if(payload.kind==='facets')result=cpQuery.runCpFacets(dataset,payload.request,helpers);
  else{
    result=cpQuery.runCpQuery(dataset,payload.request,helpers);
    // Kimlik isteği (fields) hesaplanmış sütun taşımaz.
    if(!(payload.request&&payload.request.fields))result.computed=result.ids.map(id=>current.serialized.get(id)||null);
    result.computedFields=FIELDS;
  }
  return {result,timing:{loadMs:loads.cp||0,computeMs,queryMs:performance.now()-queryStarted,totalMs:performance.now()-started,
    rows:current.rows.length,reused:computed.reused,phases:{hostMs,...(computed.reused?{}:current.phases)},datasetReloaded:Boolean(loads.cp)}};
}
module.exports={execute};
