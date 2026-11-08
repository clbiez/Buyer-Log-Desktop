'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict'),vm=require('node:vm'),{MessageChannel}=require('node:worker_threads');
const pins=JSON.parse(fs.readFileSync(path.join(__dirname,'pins.json'),'utf8'));
function preflight(){for(const [name,sha]of Object.entries(pins.files))assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(pins.root,name))).digest('hex'),sha,name+' source drift');}
const Lazy=require('./lazy-row.cjs');
function cloneFailure(value){try{structuredClone(value);return null;}catch(error){return {name:error.name,message:error.message};}}
async function run(){
 preflight();const Runtime=require(path.join(pins.root,'public/cp-decision-runtime.js')),Engine=require(path.join(pins.root,'public/cp-readiness-engine.js'));
 const {extractFunction}=require(path.join(pins.root,'tests/helpers/app-main-functions.js')),app=fs.readFileSync(path.join(pins.root,'public/app-main.js'),'utf8');
 const F=Engine.FIELDS,source=Array.from({length:128},(_,i)=>({[F.orderCode]:'DUPLICATE',[F.qty]:10,[F.exFactory]:'2026-10-05',[F.status]:'Üretimde',_id:i+1})),rows=source.map((record,ordinal)=>Lazy.fromRecord(record,ordinal).row),nativeThrows=[];
 const rowFailure=cloneFailure(rows[0]);assert.equal(rowFailure?.name,'DataCloneError');assert.deepEqual(structuredClone(source[0]),source[0]);
 let terminated=false;
 const runtime=Runtime.create({contextKey:()=> 'synthetic-fixed-context',analyzeRow:Engine.analyzeOrder,summarize:Engine.summarizeAnalyses,yieldTask:async()=>{},
  workerFactory(){
   const {port1,port2}=new MessageChannel(),worker={onmessage:null,onerror:null,onmessageerror:null,
    postMessage(message){try{port1.postMessage(message);}catch(error){nativeThrows.push({type:message.type,name:error.name});throw error;}},
    terminate(){terminated=true;port1.close();port2.close();}};
   port2.on('message',message=>{assert.equal(message.type,'begin','Proxy batch must fail native postMessage before being delivered');port2.postMessage({id:message.id,ok:true,result:true,executionMs:0});});
   port1.on('message',message=>worker.onmessage?.({data:message}));return worker;
  }});
 let model,stats;try{model=await runtime.computeAsync(rows,{today:20000});stats=runtime.getStats();}finally{runtime.dispose();}
 assert.equal(nativeThrows.length,1);assert.deepEqual(nativeThrows[0],{type:'batch',name:'DataCloneError'});assert.equal(stats.failed,1);assert.equal(stats.fallbackJobs,1);assert.equal(stats.workerJobs,0);assert.equal(stats.completed,1);assert.equal(terminated,true);
 assert.deepEqual(JSON.parse(JSON.stringify(model)),JSON.parse(JSON.stringify(Engine.analyze(source,{today:20000}))));
 const state={overrides:{notesmap:{}},cpDirty:new Set(),cp:{rows:rows.slice(0,2)}},before=state.cp;let worked=false;
 const context=vm.createContext({state,structuredClone,cpBulkPreparing:false,lineKeyOfRow:row=>row[F.orderCode]});vm.runInContext(extractFunction(app,'withCpBulkDraft')+'\nglobalThis.run=withCpBulkDraft;',context);
 let bulkFailure=null;try{context.run(['DUPLICATE'],()=>{worked=true;});}catch(error){bulkFailure={name:error.name,message:error.message};}
 assert.equal(bulkFailure?.name,'DataCloneError');assert.equal(worked,false);assert.equal(state.cp,before);assert.equal(context.cpBulkPreparing,false);
 state.cp={rows:source.slice(0,2)};const ordinary=state.cp,receipt=context.run(['DUPLICATE'],()=> 'ordinary-ok');assert.equal(receipt.value,'ordinary-ok');assert.equal(receipt.rows.length,2);assert.equal(state.cp,ordinary);
 return {classification:'Hard rejection for existing default CP; no performance acceptance',rows:rows.length,source:'tiny synthetic native fixture, not official 30k',
  nativeStructuredClone:rowFailure,actualRuntime:{nativeThrows,stats,terminated,resultEquivalentAfterExistingFallback:true,warning:'The fallback already exists in production; this probe does not add or accept it as a Proxy solution.'},
  actualWithCpBulkDraft:{failure:bulkFailure,workCallbackCalled:worked,sourceRestored:true,ordinaryControlRows:receipt.rows.length},node:process.version};
}
module.exports={run,preflight};
