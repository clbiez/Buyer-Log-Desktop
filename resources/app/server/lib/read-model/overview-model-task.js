'use strict';
/* Okuma modeli işçisinde Genel Bakış modeli görevi (#1074).
 *
 * Yük (payload):
 *  { parts:'fast'|'full', cp:null|{datasetKey,scopeKey,buffer?}, overview:null|{datasetKey,scopeKey,buffer?},
 *    contextKey, context?:{userId,lang,entries,answers,managedRules,plm,transitRules},
 *    filters:{main,bg}, lang }
 * Veri kümeleri WS1 işçisinin önbelleğinde tutulur. Genel Bakış özet satırları WS1
 * ile aynı anahtarı paylaşır; CP satırları tarayıcı biçimine getirildiği için
 * ayrı ('cp-overview') anahtardadır. Karar katmanı satırları değiştirmez. Eksik veri kümesi ya da bağlam için
 * {missing:[...]} döner, servis yalnız eksik olanı gönderip yeniden ister.
 * Karar barındırıcısı (kullanıcı bağlamı + dil) anahtarıyla küçük LRU'da tutulur.
 */
const {performance}=require('node:perf_hooks');
const {createDecisionHost}=require('./overview-decision-host');
const {computeOverviewModel}=require('./overview-model');
const {prepareCpRows}=require('./overview-row-prep');
const MAX_HOSTS=4;
const hosts=new Map();

function hostFor(key){const entry=hosts.get(key);if(entry){hosts.delete(key);hosts.set(key,entry);}return entry||null;}
function rememberHost(key,host){
  hosts.set(key,host);
  while(hosts.size>MAX_HOSTS)hosts.delete(hosts.keys().next().value);
}

function datasetFor(spec,{cache,engine},missing,name,loads){
  if(!spec)return null;
  let dataset=cache.get(spec.datasetKey);
  if(dataset)return dataset;
  if(!spec.buffer){missing.push(name);return null;}
  const started=performance.now();
  dataset=engine.decodeDataset(spec.buffer);spec.buffer=null;
  // CP satırları tarayıcının gördüğü biçime getirilir; bu kopya WS1 sorgularıyla paylaşılmaz.
  if(name==='cp')prepareCpRows(dataset.rows);
  cache.set(spec.datasetKey,spec.scopeKey,dataset);
  loads[name]=performance.now()-started;
  return dataset;
}

async function execute(payload,deps){
  const started=performance.now(),missing=[],loads={};
  const cp=datasetFor(payload.cp,deps,missing,'cp',loads);
  const overview=datasetFor(payload.overview,deps,missing,'overview',loads);
  const full=payload.parts!=='fast';
  const hostKey=payload.cp&&full?`${payload.contextKey}|${payload.lang==='en'?'en':'tr'}`:'';
  let host=hostKey?hostFor(hostKey):null;
  if(hostKey&&!host&&!payload.context)missing.push('context');
  if(missing.length)return {missing};
  let hostMs=0;
  if(hostKey&&!host){
    const hostStarted=performance.now();
    host=await createDecisionHost({...payload.context,lang:payload.lang});
    hostMs=performance.now()-hostStarted;
    rememberHost(hostKey,host);
  }
  const computeStarted=performance.now(),phases={};
  const model=await computeOverviewModel({cpRows:cp?cp.rows:null,summaryRows:overview?overview.rows:null,filters:payload.filters||{},host,full,phases,
    transitRules:payload.context?payload.context.transitRules:host?.window?.state?.overrides?.transitRules});
  const computeMs=performance.now()-computeStarted;
  return {body:deps.engine.serializeResult(model),timing:{loadMs:(loads.cp||0)+(loads.overview||0),queryMs:computeMs,totalMs:performance.now()-started,
    rows:(cp?cp.rows.length:0)+(overview?overview.rows.length:0),parts:full?'full':'fast',
    // Soğuk hesap dağılımı (#1074): veri kümesi çözme + satır hazırlığı, barındırıcı kurulumu, karar + özet, İstisna Kutusu.
    phases:{cpLoadMs:loads.cp||0,overviewLoadMs:loads.overview||0,hostMs:hostMs||0,...phases}}};
}
function clearHosts(){hosts.clear();}
function hostCount(){return hosts.size;}
module.exports={execute,clearHosts,hostCount,MAX_HOSTS};
