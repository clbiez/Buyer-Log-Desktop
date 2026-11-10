'use strict';
const fs=require('node:fs'),fsp=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict'),Module=require('node:module'),{execFileSync}=require('node:child_process');
const repo=path.resolve(__dirname,'../../..'),app=path.join(repo,'resources/app'),base='0f0b986770a721c52f68755e5c7befe12662ee26';
function load(relative,variant){const file=path.join(repo,relative);if(variant==='candidate')return require(file);const m=new Module(file,module);m.filename=file;m.paths=Module._nodeModulePaths(path.dirname(file));m._compile(execFileSync('git',['show',base+':'+relative],{cwd:repo,encoding:'utf8'}),file);return m.exports;}
const {createSyncSettings}=require(path.join(app,'server/lib/sync-settings'));
const outputRoot=path.join(repo,'work/importance-sync-benchmark');fs.mkdirSync(outputRoot,{recursive:true});
const fixture=Array.from({length:200},(_,i)=>({id:'cp-order:'+String(7000000+i)+'|DEMO|BLUE',patch:{dates:{ex:'2026-12-01'},subManufacturer:'DEMO'},userId:'owner'}));
async function run(variant,round){
 const root=path.join(outputRoot,'bench-'+variant+'-'+round);await fsp.mkdir(root,{recursive:true});const shared=path.join(root,'shared');await fsp.mkdir(shared);
 const policy=load('resources/app/server/lib/shared-sync-policy.js',variant),{createLocalDb}=load('resources/app/server/lib/local-db.js',variant),devices=[];
 for(const name of ['a','b']){const db=createLocalDb(path.join(root,name,'BuyerLogLocal.db'));db.setTransportFilter(d=>policy.filterDeltas([d]).length>0);db.setSharedOwnerResolver(()=>({known:true,allowed:true}));const sync=createSyncSettings({localDataRoot:path.join(root,name,'settings'),localDb:db,filterIncomingDeltas:d=>policy.filterDeltas(d,'incoming'),filterOutgoingDeltas:d=>policy.filterDeltas(d,'outgoing')});await sync.save(shared);devices.push({db,sync});}
 const [a,b]=devices,metrics=[];
 async function send(name,items){const start=performance.now();await a.db.queuePatches(items);const uploaded=await a.sync.syncOnce(),downloaded=await b.sync.syncOnce();const ms=performance.now()-start;assert.equal(uploaded.online,true);assert.equal(downloaded.online,true);const state=await b.db.read();for(const item of items)for(const [k,v]of Object.entries(item.patch))assert.deepEqual(state.records[item.id][k],v);metrics.push({name,ms,uploadedPackages:uploaded.uploadedPackages,downloadedPackages:downloaded.downloadedPackages,written:uploaded.networkBytesWritten,read:downloaded.networkBytesRead});}
 await send('first',fixture.slice(0,1));
 for(let i=0;i<5;i++)await send('repeat-'+i,[{...fixture[0],patch:{dates:{ex:'2026-12-'+String(i+2).padStart(2,'0')}}}]);
 await send('batch200',fixture);
 const idle=await b.sync.syncOnce();assert.equal(idle.downloadedPackages,0);
 if(variant==='candidate'){for(const importance of ['bts','regular',null])await send('importance-'+String(importance),[{...fixture[0],patch:{importance}}]);for(const m of metrics.filter(x=>x.name.startsWith('importance')))assert.equal(m.uploadedPackages,1);}
 const result={variant,round,metrics,idleDownloads:idle.downloadedPackages,rss:process.memoryUsage().rss};
 await fsp.rm(root,{recursive:true,force:true});return result;
}
(async()=>{const results=[];for(let i=0;i<3;i++)for(const variant of (process.env.BENCH_VARIANTS||'baseline,candidate').split(',')){const r=await run(variant,i);results.push(r);console.log(variant,i,JSON.stringify(r.metrics));}fs.writeFileSync(path.join(outputRoot,process.env.BENCH_OUTPUT||'transport-results.json'),JSON.stringify({base,runtime:process.version,fixtureHash:crypto.createHash('sha256').update(JSON.stringify(fixture)).digest('hex'),results},null,2));})().catch(e=>{console.error(e);process.exitCode=1;});
