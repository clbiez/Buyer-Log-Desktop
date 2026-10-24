'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),{performance}=require('node:perf_hooks');
const {createLocalDb}=require(path.resolve(process.argv[2] || path.join(__dirname,'../../resources/app'),'server/lib/local-db'));
(async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'buyerlog-wal-bench-')),file=path.join(root,'BuyerLogLocal.db');
 try{
  const db=createLocalDb(file);await db.ensure();
  await db.transaction(state=>{for(let i=0;i<30000;i++)state.records['seed-'+i]={model:'DEMO-'+i,n:i};});
  await db.queuePatch({id:'sample',patch:{n:0}});
  const read=fs.readFile,samples=[];let reads=0,bytes=0;
  fs.readFile=async function(target,...rest){const value=await read.call(this,target,...rest);if(String(target)===file+'.wal'){reads++;bytes+=Buffer.byteLength(value);}return value;};
  try{for(let i=1;i<=120;i++){const start=performance.now();await db.queuePatch({id:'sample',patch:{n:i}});samples.push(performance.now()-start);}}finally{fs.readFile=read;}
  const sorted=[...samples].sort((a,b)=>a-b),cold=await createLocalDb(file).read();
  if(cold.records.sample.n!==120)throw Error('Cold replay differs');
  const result={platform:process.platform,node:process.version,cpu:os.cpus()[0].model,seedRecords:30000,samples:120,walReadCalls:reads,walReadBytes:bytes,p50Ms:sorted[60],p95Ms:sorted[114],rawMs:samples,coldValue:cold.records.sample.n};
  await fs.writeFile(process.argv[3] || path.join(os.tmpdir(),'buyerlog-wal-benchmark.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({...result,rawMs:undefined}));
 }finally{await fs.rm(root,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
