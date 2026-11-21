'use strict';
// node scripts/benchmark-plm-image-row-resolution.js [baseline-ref] [row-count] [pairs]
// PLM SYNC görsel senkronu sonrası satır görsel çözümü — L2 A/B.
// İstemci: applySyncedPlmImages satır döngüsünün çağırdığı
//   BLModelImageCache.resolveImageRef + hasImageKey (yayımlanmış kayıt haritası).
// Sunucu: buildBacklogTemplateRows (her satırda plmImageRef).
// Deterministik sentetik demo veri; zamanlamadan önce çıktı eşdeğerliği doğrulanır.
// Senaryolar: "mixed" (satırların bir kısmının görseli yok → eski tam tarama yolu)
// ve "allHit" (tüm satırların kod anahtarı var → indeks kurulumunun ek maliyeti).
const assert=require('node:assert/strict'),path=require('node:path'),Module=require('node:module'),{spawnSync}=require('node:child_process'),{performance}=require('node:perf_hooks');
const revision=process.argv[2]||'origin/main',count=Number(process.argv[3])||30000,pairs=Math.max(3,Number(process.argv[4])||3);
const repoRoot=path.resolve(__dirname,'../../..');
function loadAt(rel){
  const filename=require.resolve(path.join('..',rel));
  const snap=spawnSync('git',['show',`${revision}:resources/app/${rel}`],{encoding:'utf8',cwd:repoRoot,maxBuffer:64*1024*1024});
  if(snap.status!==0)throw Error(snap.stderr);
  const m=new Module(filename,module);m.filename=filename;m.paths=Module._nodeModulePaths(path.dirname(filename));m._compile(snap.stdout,filename);
  return {before:m.exports,current:require(filename)};
}
const cacheMods=loadAt('public/model-image-cache.js'),parseMods=loadAt('server/lib/parse.js');

function fixture(allHit){
  const orders=[],imagemap={};
  for(let i=0;i<count;i++){
    const plm=String(1000000+i),ccode=['01','02','03'][i%3],colour=['BLACK','NAVY','ECRU'][i%3];
    // Sipariş biçimi scripts/benchmark-backlog-analysis.js fixture'ıyla aynıdır.
    orders.push({ocode:100000+i,model:'DEMO-'+i,plm,ccode,colour,season:'S'+i%10,countryRaw:'TURKIYE',manufacturer:'DEMO',category:'KNIT',merch:'12',ageGroup:'A1',buyer:'BUYER-'+i%20,buyerGrup:'KIDS',line:'LINE',qty:100,kalan:i%7===0?0:100,opd:new Date(2026,0,1),ex:new Date(2026,10,1),retail:new Date(2026,11,1),mb:new Date(2026,11,15),merkezSevkeHazirKalan:0});
    const k=`plm:${plm}|colour:${ccode}`;
    if(allHit||i%3===0)imagemap[k]='ci_c'+i;                       // kod anahtarı
    else if(i%3===1)imagemap[`${k}|name:${colour}`]='ci_n'+i;     // yalnız adlı kayıt
    // i%3===2 (mixed): görseli yok
  }
  for(let i=0;i<count;i++)imagemap[`plm:${5000000+i}|colour:09|name:RED`]='ci_x'+i; // başka modeller
  return {orders,imagemap};
}
function clientRun(lib,fx){
  const cache=lib.createModelImageCache({});cache.setRegistryMap(fx.imagemap);
  const out=new Array(fx.orders.length);
  for(let i=0;i<fx.orders.length;i++){const o=fx.orders[i];const ref=cache.resolveImageRef(fx.imagemap,o.plm,o.ccode,'');out[i]=cache.hasImageKey(fx.imagemap,o.plm,o.ccode,'')?ref:null;}
  return out;
}
const antrepoCache=new WeakMap();
function antrepoFor(lib,orders){
  let byOrders=antrepoCache.get(lib);if(!byOrders)antrepoCache.set(lib,byOrders=new Map());
  if(!byOrders.has(orders))byOrders.set(orders,lib.parseAntrepoRows(orders.flatMap(order=>[30,20].map((qty,i)=>({'Sipariş Kod':order.ocode,'Ürün Ad':order.model,'Renk Kod':order.ccode,'Supplier Portal Statü':i?'Yol Operasyonları':'Depoda','Yükleme Toplam Adet':qty,'Net Alım Sipariş Miktarı':100,'Tahmini Antrepo Giriş Tarihi':'2026-11-15','HANDOVER Tarihi':'2026-11-01','Vasita Tanim':'TIR',Container:'DEMO-'+i})))));
  return byOrders.get(orders);
}
function serverRun(lib,fx){
  const overrides={imagemap:fx.imagemap,notesmap:{},submap:{},suppfobmap:{},suppfobmetamap:{},delmap:{},licensormap:{},datemap:{},pricingRules:[],transitRules:[],antrepoMatchConfig:lib.defaultAntrepoMatchConfig()};
  const rows=lib.buildBacklogTemplateRows(fx.orders,antrepoFor(lib,fx.orders),overrides,{});
  assert.ok(rows.length>=fx.orders.length*0.5,'backlog fixture must produce rows');
  return rows.map(r=>r&&r._imageRef);
}
const median=a=>{const s=[...a].sort((x,y)=>x-y);return s[Math.floor(s.length/2)];};
const time=fn=>{const t=performance.now();fn();return Math.round(performance.now()-t);};
const result={revision,rows:count,pairs,scenarios:{}};
for(const scenario of ['mixed','allHit']){
  const fx=fixture(scenario==='allHit');
  // Eşdeğerlik: küçük dilimde (Main tam tarama yolu pahalı) birebir aynı çıktı.
  const small={orders:fx.orders.slice(0,600),imagemap:fx.imagemap};
  assert.deepEqual(clientRun(cacheMods.current,small),clientRun(cacheMods.before,small),'client parity '+scenario);
  assert.deepEqual(serverRun(parseMods.current,small),serverRun(parseMods.before,small),'server parity '+scenario);
  // Main'in mixed senaryosu tam boyutta dakikalar sürer; aynı yol küçük dilimde
  // ölçülür ve satır sayısına doğrusal ölçeklenir (yöntem çıktıda belirtilir).
  const mainRows=scenario==='mixed'?Math.min(count,1500):count,mainFx=mainRows===count?fx:{orders:fx.orders.slice(0,mainRows),imagemap:fx.imagemap};
  const scale=count/mainRows;
  for(const side of ['client','server']){
    const run=side==='client'?clientRun:serverRun,mods=side==='client'?cacheMods:parseMods;
    run(mods.current,fx);run(mods.before,mainFx); // ısınma
    const main=[],cand=[];
    for(let p=0;p<pairs;p++){
      const order=p%2===0?['main','cand']:['cand','main']; // dönüşümlü
      for(const which of order){
        if(which==='main')main.push(Math.round(time(()=>run(mods.before,mainFx))*scale));
        else cand.push(time(()=>run(mods.current,fx)));
      }
    }
    result.scenarios[`${scenario}.${side}`]={mainMedianMs:median(main),candidateMedianMs:median(cand),mainSamplesMs:main,candidateSamplesMs:cand,mainMeasuredRows:mainRows,mainScaledLinearly:scale!==1,pass:median(cand)<=median(main)};
  }
}
result.pass=Object.values(result.scenarios).every(s=>s.pass);
console.log(JSON.stringify(result,null,1));
if(!result.pass)process.exitCode=1;
