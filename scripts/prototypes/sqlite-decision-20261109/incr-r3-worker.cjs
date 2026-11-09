'use strict';
// Same 300 operation distribution and seed batches as the archived benchmark.
// Full envelope and receipt checks supplement its independent business oracle.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {performance}=require('node:perf_hooks');
const {event,query,CLOCK,DEVICE,projection,hash}=require('./workload.cjs');
const {oracle}=require('./oracle.cjs');
const RealDate=Date;
// Fix generated persistence metadata only. Lease/recovery Date and Date.now
// retain real wall time; freezing those would invalidate production controls.
global.Date=class extends RealDate{constructor(...args){
 const caller=new Error().stack.split('\n')[2]||'';
 const metadata=/local-db\.js:|compat-transitions\.cjs:|sqlite-compat\.cjs:|r2-pinned\.cjs:/.test(caller);
 super(...(args.length?args:metadata?[CLOCK]:[]));
}};
assert.equal(Date.now,RealDate.now,'real lease timeout clock');
assert(new Date().getTime()>CLOCK,'unrelated wall time remains real');
const args=JSON.parse(process.argv[2]);
let sqlStats={rows:0,allMs:0,envelopeMs:0,envelopeBytes:0};
const {DatabaseSync}=require('node:sqlite'),originalPrepare=DatabaseSync.prototype.prepare;
DatabaseSync.prototype.prepare=function(...args){const statement=originalPrepare.apply(this,args);const originalAll=statement.all.bind(statement);statement.all=(...params)=>{const t=performance.now(),rows=originalAll(...params);sqlStats.rows+=rows.length;sqlStats.allMs+=performance.now()-t;return rows;};return statement;};
const stringify=JSON.stringify;
JSON.stringify=function(value,...args){if(value&&value.syncLedger&&!Object.hasOwn(value,'records')){const t=performance.now(),body=stringify(value,...args);sqlStats.envelopeMs+=performance.now()-t;sqlStats.envelopeBytes=Buffer.byteLength(body);return body;}return stringify(value,...args);};
function canonical(value){if(Array.isArray(value))return value.map(canonical);if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])]));return value;}
const fullHash=v=>hash(canonical(v));
function io(){return Object.fromEntries(fs.readFileSync('/proc/self/io','utf8').trim().split('\n').map(x=>{const [k,v]=x.split(':');return[k,Number(v)];}));}
const delta=(a,b)=>Object.fromEntries(Object.keys(b).map(k=>[k,b[k]-(a[k]||0)]));
function disk(dir){let files=[];for(const e of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory())for(const f of disk(p).files)files.push({...f,path:e.name+'/'+f.path});else{const s=fs.statSync(p);files.push({path:e.name,bytes:s.size,allocated:s.blocks*512});}}return {files,totalBytes:files.reduce((n,f)=>n+f.bytes,0)};}
function open(){if(args.engine==='local'){const {open}=require('./adapters.cjs');const wrapper=open('local',args.folder);return {s:wrapper.db,close:()=>wrapper.close(),filter:q=>wrapper.filter(q),compact:()=>wrapper.compact()};}const sqlite=args.engine==='r2'?require(args.r2Loader).sqlite:require('./sqlite-compat.cjs').sqlite;const s=sqlite(path.join(args.folder,'prototype.sqlite'));return {s,close:()=>s.close(),filter:q=>s.filter(q),compact:()=>s.compact()};}
const changes=s=>s.db?.prepare?Number(s.db.prepare('SELECT total_changes() n').get().n):0;
async function run(){
 const connectStart=performance.now();const {s,close,filter,compact}=open();const connectionMs=performance.now()-connectStart;
 if(args.mode==='seed'){
  await s.ensure();if(args.engine==='local')await s.transaction(state=>{state.deviceId=DEVICE;});else await s.initialize();
  const start=performance.now();
  for(let i=0;i<args.size;i+=10000)await s.queuePatches(Array.from({length:Math.min(10000,args.size-i)},(_,j)=>event(i+j,args.size)));
  await s.markSynced(Array.from({length:Math.floor(args.size*.8)},(_,i)=>`seed-${i}`));
  const seedMs=performance.now()-start,state=await s.read();assert.equal(hash(projection(state.records)),oracle(args.size,0));
  const result={seedMs,stateHash:fullHash(state),businessHash:hash(projection(state.records)),disk:disk(args.folder),versions:process.versions};close();return result;
 }
 if(args.mode==='verify'){const state=await s.read(),result={stateHash:fullHash(state),businessHash:hash(projection(state.records)),disk:disk(args.folder)};if(s.db)assert.equal(s.db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');close();return result;}
 const samples={},receipts=crypto.createHash('sha256');let peakHeap=0,gap=0,last=performance.now();
 async function measure(kind,fn){const beforeIo=io(),beforeCpu=process.cpuUsage(),beforeChanges=changes(s);sqlStats={rows:0,allMs:0,envelopeMs:0,envelopeBytes:0};const start=performance.now();const result=await fn();const ms=performance.now()-start;const entry={ms,cpu:process.cpuUsage(beforeCpu),io:delta(beforeIo,io()),dml:changes(s)-beforeChanges,...sqlStats};(samples[kind]??=[]).push(entry);peakHeap=Math.max(peakHeap,process.memoryUsage().heapUsed);await new Promise(r=>setImmediate(r));gap=Math.max(gap,performance.now()-last);last=performance.now();return result;}
 global.gc?.();const memoryBefore=process.memoryUsage(),cpuStart=process.cpuUsage(),ioStart=io(),start=performance.now();
 // Includes ensure/replay and complete state. SQLite connection construction is
 // already complete above; connectionMs is recorded separately by caller below.
 let state=await measure('coldFullReady',async()=>{await s.ensure();return s.read();});const initialHash=fullHash(state);state=null;
 let eventIndex=args.size,checksum=0;
 const mixedStart=performance.now();
 for(let i=0;i<300;i++){
  const slot=i%10,kind=slot<5?'get':slot<7?'filter':slot===7?'pending':slot===8?'singleWrite':'batch20';
  const result=await measure(kind,async()=>{
   if(kind==='get')return (await s.read()).records[event(i%args.size,args.size).id]||null;
   if(kind==='filter')return filter(query(i,args.size));
   if(kind==='pending')return s.pending(100);
   if(kind==='singleWrite')return s.queuePatch(event(eventIndex++,args.size,'mixed'));
   return s.queuePatches(Array.from({length:20},()=>event(eventIndex++,args.size,'mixed')));
  });
  if(kind==='singleWrite'||kind==='batch20')receipts.update(stringify(canonical(result)));
  else checksum+=kind==='get'?(result?._revision||0):result.length;
  if(i%10===9)process.send?.({progress:`${args.engine} ${args.size}: ${i+1}/300`});
 }
 const mixedMs=performance.now()-mixedStart;
 for(let i=0;i<3;i++)await measure('repeatFullRead',()=>s.read());
 const ids=Array.from({length:630},(_,i)=>`mixed-${args.size+i}`);
 receipts.update(stringify(canonical(await measure('upload',()=>s.markSynced(ids)))));
 receipts.update(stringify(canonical(await measure('singleAck',()=>s.markAcknowledged([ids[0]])))));
 receipts.update(stringify(canonical(await measure('ackThrough',()=>s.markAcknowledgedThrough(args.size+630)))));
 const beforeCompactDisk=disk(args.folder);
 await measure('compact',compact);
 const timedCpu=process.cpuUsage(cpuStart),timedIo=delta(ioStart,io()),elapsedMs=performance.now()-start;
 global.gc?.();const memoryAfter=process.memoryUsage(),peakRssBytes=process.resourceUsage().maxRSS*1024;
 state=await s.read();assert.equal(hash(projection(state.records)),oracle(args.size,630));
 const stateHash=fullHash(state),businessHash=hash(projection(state.records));const integrity=s.db?s.db.prepare('PRAGMA integrity_check').get().integrity_check:null;
 close();return {connectionMs,coldOpenToFullReadyMs:connectionMs+samples.coldFullReady[0].ms,initialHash,stateHash,businessHash,receiptHash:receipts.digest('hex'),checksum,samples,mixedMs,elapsedMs,timedCpu,timedIo,memoryBefore,memoryAfter,peakHeap,peakRssBytes,maxEventLoopGapMs:gap,beforeCompactDisk,disk:disk(args.folder),integrity,versions:process.versions};
}
const begin=performance.now();run().then(result=>{result.workerMs=performance.now()-begin;process.send?.({result});process.disconnect?.();}).catch(error=>{console.error(error.stack);process.exitCode=1;process.disconnect?.();});
