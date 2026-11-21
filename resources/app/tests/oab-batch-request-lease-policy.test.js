'use strict';
// Saha bulgusu (7.0.363, Windows): OAB satırları çekildi ama iş
// OAB_JOB_STORE_BUSY ile bitti. Arka plan işi, başlatan HTTP isteğinin
// "nonblocking" dosya kilidi politikasını (server.js middleware) miras alıyordu;
// başka bir sürecin kısa süreli kilidi veya Windows'un geçici EPERM'i sınırlı
// bekleme yerine anında SHARED_WRITE_BUSY üretiyordu.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawn}=require('node:child_process');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'bl-oab-lease-policy-'));for(const key of ['BUYER_LOG_DATA_ROOT','BUYER_LOG_LOCAL_DATA_ROOT','BUYER_LOG_SERVER_DATA_ROOT'])process.env[key]=root;
const {createOabJobStore}=require('../server/lib/oab-job-store');
const {runWithNonblockingFileLeases}=require('../server/lib/shared-file-transaction');
const batch=require('../server/lib/oab-batch'),snapshots=require('../server/lib/oab-session-store'),{createOabBatchService}=require('../server/lib/oab-batch-service');
test.after(()=>fs.rmSync(root,{recursive:true,force:true}));

// Başka bir Buyer Log sürecini taklit eder: kilidi kısa süre tutar, sonra bırakır.
function holdLeaseInPeerProcess(target,holdMs){
  const script=`const fs=require('fs'),os=require('os'),path=require('path'),crypto=require('crypto');
const lockDir=process.argv[1]+'.write-lock';
for(;;){try{fs.mkdirSync(lockDir);break;}catch(error){if(error.code!=='EEXIST')throw error;Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,2);}}
const now=new Date().toISOString();
fs.writeFileSync(path.join(lockDir,'owner.json'),JSON.stringify({protocolVersion:2,threadId:0,threadSlot:0,token:crypto.randomUUID(),instanceId:crypto.randomUUID(),machine:os.hostname(),pid:process.pid,createdAt:now,startedAt:now,resource:process.argv[1]}));
process.stdout.write('ready');
setTimeout(()=>{fs.unlinkSync(path.join(lockDir,'owner.json'));fs.rmdirSync(lockDir);},Number(process.argv[2]));`;
  const child=spawn(process.execPath,['-e',script,target,String(holdMs)],{stdio:['ignore','pipe','inherit']});
  return new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>reject(new Error('peer lease holder exited early: '+code)));child.stdout.once('data',()=>resolve(child));});
}

test('background OAB job does not inherit the HTTP nonblocking lease policy; a brief peer lease is waited out',async()=>{
  const owner='lease_policy',dir=path.join(root,owner),store=createOabJobStore({root:dir}),profile={id:owner,enabled:true};
  const pointer=path.join(dir,require('node:crypto').createHash('sha256').update(owner).digest('hex'),'latest.json');
  let peer=null,calls=0;
  const native=createOabBatchService({jobStore:store,userAccess:{profileById:()=>profile,hasArea:()=>true,hasCapability:()=>true,appendAudit:()=>{}},oabBatch:batch,oabSessionStore:snapshots,
    oabStaticMetadata:{planningMetadata:()=>({seasonRefs:()=>['S7','W7'],magRefsForSeason:()=>['M'],buyerGroupRefsFor:()=>['A']}),labelsFor:item=>({season:item.seasonRef,mag:item.merchSubGroupRef,buyerGroup:item.buyerGroupRef})},
    oabStore:{loadBatchCapability:()=>({state:'unsupported'}),cacheKeyOf:()=>'',get:()=>null},ensurePassConnected:async()=>{},
    fetchOabReportWithLoginRecovery:async(_id,params)=>{
      calls+=1;
      // İlk kombinasyon döndükten hemen sonra iş kaydı checkpoint'i bu kilide çarpar.
      if(calls===1)peer=await holdLeaseInPeerProcess(pointer,300);
      return [{Qty:calls,Sezon:params.seasonRef,'Merch Alt Grup':params.merchSubGroupRef,'Buyer Grup Tanımı':params.buyerGroupRef}];
    },
    redactSecrets:String,logRuntimeFailure:()=>{}});
  // server.js her HTTP isteğini bu politikayla çalıştırır.
  runWithNonblockingFileLeases(()=>native.start(profile,{seasonRefs:['S7','W7'],merchSubGroupRefs:['M'],buyerGroupRefs:['A']},{transport:'desktop'}));
  let status;
  const deadline=Date.now()+15000;
  while(Date.now()<deadline){status=native.status(profile);if(!status.job.running)break;await new Promise(resolve=>setTimeout(resolve,10));}
  if(peer&&peer.exitCode===null)await new Promise(resolve=>peer.once('exit',resolve));
  assert.equal(status.job.running,false);
  assert.equal(status.job.errorCode,'',`iş ${status.job.errorCode} ile bitti`);
  assert.equal(status.job.completed,2);
  assert.equal(status.job.snapshotSaved,true);
  assert.equal(status.rows.length,2);
  assert.equal(snapshots.load(owner).snapshot.rows.length,2);
});
