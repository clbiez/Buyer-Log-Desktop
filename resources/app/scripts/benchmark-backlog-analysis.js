'use strict';
// node scripts/benchmark-backlog-analysis.js [baseline-ref] [order-count]
// Deterministic synthetic sources; compare output parity before timing.
const assert=require('node:assert/strict'),path=require('node:path'),Module=require('node:module'),{spawnSync}=require('node:child_process'),{performance}=require('node:perf_hooks');
const filename=require.resolve('../server/lib/parse'),current=require(filename),revision=process.argv[2]||'origin/main',count=Number(process.argv[3])||3000;
const snapshot=spawnSync('git',['show',revision+':resources/app/server/lib/parse.js'],{encoding:'utf8',cwd:path.resolve(__dirname,'../../..')});
if(snapshot.status!==0)throw Error(snapshot.stderr);
const baseline=new Module(filename,module);baseline.filename=filename;baseline.paths=Module._nodeModulePaths(path.dirname(filename));baseline._compile(snapshot.stdout,filename);
const before=baseline.exports;
const orders=Array.from({length:count},(_,i)=>({ocode:100000+i,model:'DEMO-'+i,ccode:'01',colour:'BLACK',season:'S'+i%10,countryRaw:'TURKIYE',manufacturer:'DEMO',category:'KNIT',merch:'12',ageGroup:'A1',buyer:'BUYER-'+i%20,buyerGrup:'KIDS',line:'LINE',qty:100,kalan:i%7===0?0:100,opd:new Date(2026,0,1),ex:new Date(2026,10,1),retail:new Date(2026,11,1),mb:new Date(2026,11,15),merkezSevkeHazirKalan:0,_sourceFields:Object.fromEntries(Array.from({length:40},(_,j)=>['DEMO_FIELD_'+j,j===0?'S'+i%10:'VALUE-'+i%5]))}));
const map=current.parseAntrepoRows(orders.flatMap(order=>[30,20].map((qty,i)=>({'Sipariş Kod':order.ocode,'Ürün Ad':order.model,'Renk Kod':order.ccode,'Supplier Portal Statü':i?'Yol Operasyonları':'Depoda','Yükleme Toplam Adet':qty,'Net Alım Sipariş Miktarı':100,'Tahmini Antrepo Giriş Tarihi':'2026-11-15','HANDOVER Tarihi':'2026-11-01','Vasita Tanim':'TIR',Container:'DEMO-'+i}))));
const overrides={notesmap:{100000:{Notes:'DEMO NOTE'}},submap:{},suppfobmap:{},suppfobmetamap:{},delmap:{},licensormap:{},datemap:{},pricingRules:[],transitRules:[],antrepoMatchConfig:current.defaultAntrepoMatchConfig()};
const cp=(header,values,rest={})=>({id:'cp:'+header,values,...rest});
const raw=current.backlogCustomDimensionContext(orders,map).customDimensions;
const filters=[[],[cp('Sezon',['S0'])],[cp('Buyer',['BUYER-0'])],[cp('buying note',[''])],[cp('GÜNCEL DURUM\n(STATUS)',['Depoda'])],[cp('RİSK\n(PRIORITY)',['VAR'])],[{id:raw.find(column=>column.source==='asas'&&column.header==='DEMO_FIELD_0').id,values:['S0']}],[{id:raw.find(column=>column.source==='antrepo'&&column.header==='Container').id,values:['']}],[cp('missing',[''])],[cp('REVİZE YÜKLEME TARİHİ\n(EX-FACTORY)',[],{from:'2026-11-01',to:'2026-11-01'})]];
const small=orders.slice(0,Math.min(120,count));
for(const analysisFilters of filters){
 const opts={groupBy:['buyer','status'],analysisFilters};
 assert.deepEqual(JSON.parse(JSON.stringify(current.buildBacklogTemplateRows(small,map,overrides,opts))),JSON.parse(JSON.stringify(before.buildBacklogTemplateRows(small,map,overrides,opts))));
 const a=current.buildBacklogGrouped(small,map,overrides,{...opts,lazyDimensions:true}),b=before.buildBacklogGrouped(small,map,overrides,opts);
 for(const key of ['totalQty','totalRows','totalOrders','tree'])assert.deepEqual(JSON.parse(JSON.stringify(a[key])),JSON.parse(JSON.stringify(b[key])),key);
}
const opts={groupBy:['buyer','status'],analysisFilters:[cp('Sezon',['S0'])]};
const time=fn=>{fn();const samples=[];let result;for(let i=0;i<3;i++){const start=performance.now();result=fn();samples.push(performance.now()-start);}return {ms:Math.round(samples.sort((a,b)=>a-b)[1]),rows:Array.isArray(result)?result.length:result.totalRows,bytes:Array.isArray(result)?Buffer.byteLength(JSON.stringify(result)):undefined};};
console.log(JSON.stringify({sourceOrders:count,parityCases:filters.length,pivotBefore:time(()=>before.buildBacklogGrouped(orders,map,overrides,opts)),pivotAfter:time(()=>current.buildBacklogGrouped(orders,map,overrides,{...opts,lazyDimensions:true})),overviewBefore:time(()=>before.buildBacklogTemplateRows(orders,map,overrides,{})),overviewAfter:time(()=>current.buildBacklogTemplateRows(orders,map,overrides,opts)),detailBefore:time(()=>before.buildBacklogTemplateRows(orders,map,overrides,opts)),detailAfter:time(()=>current.buildBacklogTemplateRows(orders,map,overrides,opts))},null,2));
