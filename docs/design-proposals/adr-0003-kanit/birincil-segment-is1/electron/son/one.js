// Tek örnek (taze süreç): 30k kaynak → CP+Siparişler projeksiyon kurulumu (buildSharedOrderProjectionRowsFromASAS)
// + okuma modeli hazırlığı (prepareCpRows) + istemci rebuildCpLogisticCaches (aynı V8). node one.js <APP> <SRC>
const path=require('path'),[APP,SRC]=process.argv.slice(2);
const parse=require(path.join(APP,'server/lib/parse.js'));const prep=require(path.join(APP,'server/lib/read-model/overview-row-prep.js'));
const XLSX=require(path.join(APP,'node_modules/xlsx'));const BR=require(path.join(APP,'public/business-rules.js'));
const {loadAppMainFunctions}=require(path.join(APP,'tests/helpers/app-main-functions.js'));
const cfg=parse.defaultAntrepoMatchConfig();
const asas=parse.parseASASWorkbook(XLSX.readFile(path.join(SRC,'ASAS - Demo.xlsx'),{cellDates:true}),cfg);
const ant=parse.parseAntrepoWorkbook(XLSX.readFile(path.join(SRC,'Antrepo - Demo.xlsx'),{cellDates:true}),cfg);
const orders=asas.orders||asas;const map=ant.map||ant;
const ov={antrepoMatchConfig:cfg,submap:{},delmap:{},suppfobmap:{},suppfobmetamap:{},notesmap:{},licensormap:{},pricingRules:[],transitRules:[],datemap:{}};
const ms=t=>Number(process.hrtime.bigint()-t)/1e6;
const REPB=Number(process.env.REPB||1);const buildS=[];let shared,t;for(let i=0;i<REPB;i++){if(global.gc)global.gc();t=process.hrtime.bigint();shared=parse.buildSharedOrderProjectionRowsFromASAS(parse.applyDateOverrides(orders,ov),map,ov);buildS.push(ms(t));}const build=buildS.slice().sort((x,y)=>x-y)[buildS.length>>1];
const json=JSON.stringify(shared.cp);let rows;const REP=Number(process.env.REP||7);const med=a=>a.slice().sort((x,y)=>x-y)[a.length>>1];const prepS=[];for(let i=0;i<REP;i++){rows=JSON.parse(json);if(global.gc)global.gc();t=process.hrtime.bigint();prep.prepareCpRows(rows);prepS.push(ms(t));}const prepMs=med(prepS);
const c=loadAppMainFunctions(['norm','toNum','turknorm','makeDateOnly','dateOnlyFromDateObject','excelSerialToDateOnly','coerceDateLoose','normalizeTransitDelType','cpLogisticSegments','rebuildCpLogisticCaches'],{BLBusinessRules:BR,ISO_DAY_CACHE_MAX:20000,_isoDayCache:new Map()});
const clientS=[];for(let i=0;i<REP;i++){rows=JSON.parse(json);if(global.gc)global.gc();t=process.hrtime.bigint();for(const r of rows)if(c.cpLogisticSegments(r).length)c.rebuildCpLogisticCaches(r);clientS.push(ms(t));}const client=med(clientS);
const segs=shared.cp.map(r=>r._logisticSegments||[]).filter(s=>s.length);const selS=[];for(let i=0;i<REP;i++){t=process.hrtime.bigint();for(const s of segs)BR.selectPrimaryLogisticSegment?BR.selectPrimaryLogisticSegment(s):(s.filter(x=>x&&x.kind==='partial')[0]||s.find(x=>x&&x.kind!=='shortage')||s[0]);selS.push(ms(t));}const select=med(selS);
// Karar (cp/computed sıcak yolu): hazırlanmış satırlarda cp-readiness analyzeOrder (computePriorityFlags + teslimat).
const CRE=require(path.join(APP,'public/cp-readiness-engine.js'));const TR=[{id:'g',delType:'Gemi',days:70},{id:'u',delType:'Uçak',days:15},{id:'t',delType:'TIR',days:20}];
const ordD=v=>{if(v==null||v==='')return null;const d=v instanceof Date?v:new Date(v);return isNaN(d)?null:Math.trunc(Date.UTC(d.getFullYear(),d.getMonth(),d.getDate())/864e5);};
const prepared=JSON.parse(json);prep.prepareCpRows(prepared);const todayO=ordD(new Date());const decS=[];for(let i=0;i<REP;i++){if(global.gc)global.gc();t=process.hrtime.bigint();for(const r of prepared)CRE.analyzeOrder(r,{transitRules:TR,today:todayO,dateOrdinal:ordD});decS.push(ms(t));}const decide=med(decS);
const cu=process.cpuUsage();
process.stdout.write(JSON.stringify({cp:shared.cp.length,orders:shared.orders.length,build,buildS,prep:prepMs,client,select,decide,decS,prepS,clientS,cpuMs:(cu.user+cu.system)/1000,runtime:process.versions.electron?'electron '+process.versions.electron:'node '+process.versions.node})+'\n');
