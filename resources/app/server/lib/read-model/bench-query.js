'use strict';
/* D1 ölçümü (#1073): 30k satırlık CP projeksiyonunda tipik filtre + sıralama +
   200 satırlık pencere süresi, gerçek okuma modeli işçisinde ölçülür.
   Çalıştırma (resources/app içinden):
     node server/lib/read-model/bench-query.js [--rows 30000] [--iterations 40] [--seed 7]
   Çıktı: senaryo başına işçi içi sorgu süresi ve ana iş parçacığından görülen
   gidiş-dönüş süresi için p50/p95 (ms) + ham örnekler JSON. Sonuç önbelleği
   kapalıdır (her ölçüm gerçek hesaplamadır). Çalışma zamanında yüklenmez. */
const zlib=require('node:zlib');
const {performance}=require('node:perf_hooks');
const tasks=require('../compute-tasks');
const {createComputePool}=require('../compute-pool');
const {readModelPoolOptions}=require('./read-model-pool');
const {createReadModelService}=require('./read-model-service');

function arg(name,fallback){const i=process.argv.indexOf(`--${name}`);return i>0?Number(process.argv[i+1]):fallback;}
function rng(seed){let x=seed>>>0||1;return ()=>{x^=x<<13;x>>>=0;x^=x>>>17;x^=x<<5;x>>>=0;return x/4294967296;};}
function fixture(count,seed){
  const r=rng(seed),pick=list=>list[Math.floor(r()*list.length)];
  const seasons=['S5','W5','S6','W6','S7','W7'],countries=['TURKIYE','BANGLADESH','CHINA','EGYPT','INDIA','PAKISTAN'];
  const licenses=['Disney','Marvel','Barbie','Lisanssız','Pokemon','Star Wars','Hello Kitty'],buyers=Array.from({length:24},(_,i)=>`Buyer ${i}`);
  const words=['Kız Çocuk Tişört','Erkek Çocuk Şort','Bebek Örme Elbise','Sweatshirt Kapüşonlu','İnce Hırka','Pijama Takım','Eşofman Altı'];
  const rows=Array.from({length:count},(_,i)=>({ocode:1000000+i,model:`${pick(words)} ${i%977}`,ccode:pick(['R','K','B','N','Y']),colour:pick(['Red','Blue','Lacivert','Ekru']),
    buyer:pick(buyers),merch:`M${Math.floor(r()*40)}`,ageGroup:pick(['A','B','C']),buyerGrup:`G${Math.floor(r()*8)}`,license:pick(licenses),manufacturer:`Tedarikçi ${Math.floor(r()*300)}`,
    season:pick(seasons),countryRaw:pick(countries),qty:Math.floor(r()*5000),kalan:Math.floor(r()*3000),fob:Math.round(r()*2000)/100,
    ex:new Date(2026,Math.floor(r()*12),1+Math.floor(r()*27)),retail:new Date(2026+Math.floor(r()*2),Math.floor(r()*12),1+Math.floor(r()*27)),mb:new Date(2027,Math.floor(r()*12),2)}));
  return {loadedAt:'bench',asasOrders:rows,asasOrdersByTarget:{cp:rows,orders:rows},antrepoMap:{},lflRows:[]};
}
const percentile=(values,p)=>{const s=[...values].sort((a,b)=>a-b);return s[Math.min(s.length-1,Math.ceil(p/100*s.length)-1)];};
const round=value=>Math.round(value*100)/100;
const CP_COLUMNS=[{k:'Order Quantity',type:'int'},{k:'Ex-factory',type:'exfactory'},{k:'Retail Date',type:'retailEdit'},{k:'FOB ($)',type:'money'},{k:'Order Code',type:'ordercode'}];
const FIELDS=['_id','Season','Country','Buyer','License','Model Name','Order Code','Order Quantity','Remaining Units','FOB ($)','Ex-factory','Retail Date'];
const SCENARIOS=[
  ['sort-only (Season) + window 200',i=>({sort:{key:'Season',dir:i%2?1:-1}})],
  ['quick filters (Country eq + Buyer in) + sort qty',i=>({filters:[{key:'Country',op:'eq',value:'CHINA'},{key:'Buyer',op:'in',values:[`Buyer ${i%24}`,`Buyer ${(i+5)%24}`,`Buyer ${(i+11)%24}`]}],sort:{key:'Order Quantity',dir:-1}})],
  ['search text + sort Ex-factory',i=>({search:{text:['hırka','şort','elbise','pijama'][i%4]},sort:{key:'Ex-factory',dir:1}})],
  ['date month + numeric rule + groupBy Buyer',i=>({filters:[{key:'Ex-factory',op:'display-in',granularity:'month',values:[`2026-0${1+i%9}`,`2026-1${i%3}`]},{key:'Order Quantity',op:'numeric',rule:{op:'gte',a:String(1000+i)}}],
    sort:{key:'FOB ($)',dir:-1},aggregates:{sums:['Order Quantity','Remaining Units'],groupBy:[{key:'Buyer',sums:['Order Quantity']}]}})],
  ['deep scroll window (offset 20000) sort License',i=>({sort:{key:'License',dir:1},offset:20000+i})],
];

async function main(){
  const count=arg('rows',30000),iterations=arg('iterations',40),seed=arg('seed',7);
  const built=tasks.buildProjections(fixture(count,seed),{modules:['cp'],overrides:{},horizons:{}}).cp.rows;
  const json=Buffer.from(tasks.serialize({rows:built},'projection')),buffer=zlib.gzipSync(json,{level:4});
  const pool=createComputePool(readModelPoolOptions());
  const service=createReadModelService({maxEntries:0,
    guard:{capture:()=>({key:'["bench"]',assertResponse(){},assertBuild(){}})},
    loadProjection:async()=>({value:{buffer,uncompressedBytes:json.length},manifest:{activeGeneration:'bench',modules:{cp:{checksum:'bench'}}},release(){},assertResponse(){}}),
    runCompute:(task,payload,options)=>pool.run(task,payload,options)});
  const out={rows:built.length,projectionBytes:json.length,gzipBytes:buffer.length,iterations,node:process.version,platform:`${process.platform}-${process.arch}`,scenarios:[]};
  try{
    const coldStart=performance.now();
    const cold=await service.query({},'cp',{version:1,limit:200,fields:FIELDS});
    out.coldLoad={roundTripMs:round(performance.now()-coldStart),workerLoadMs:round(cold.timing.loadMs),workerQueryMs:round(cold.timing.queryMs)};
    for(const [name,make] of SCENARIOS){
      const worker=[],roundTrip=[];let total=0;
      for(let i=-3;i<iterations;i++){
        const query={version:1,columns:CP_COLUMNS,limit:200,fields:FIELDS,...make(Math.abs(i))};
        const started=performance.now(),result=await service.query({},'cp',query),elapsed=performance.now()-started;
        if(i<0)continue;
        worker.push(round(result.timing.queryMs));roundTrip.push(round(elapsed));total=JSON.parse(result.body).total;
      }
      out.scenarios.push({name,lastTotal:total,workerQueryMs:{p50:percentile(worker,50),p95:percentile(worker,95)},roundTripMs:{p50:percentile(roundTrip,50),p95:percentile(roundTrip,95)},samples:{worker,roundTrip}});
    }
  }finally{await pool.close();}
  process.stdout.write(JSON.stringify(out,null,process.argv.includes('--pretty')?2:0)+'\n');
}
if(require.main===module)main().catch(error=>{console.error(error);process.exitCode=1;});
module.exports={fixture,SCENARIOS};
