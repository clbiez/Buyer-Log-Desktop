'use strict';
// Taze süreç; sentetik 30k authority/Endeksmatik girdisi, sabit tarih.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto'),zlib=require('node:zlib'),v8=require('node:v8');
const {performance}=require('node:perf_hooks');
const app=path.resolve(process.argv[2]||path.join(__dirname,'..')),kind=process.argv[3];
if(!['status','authority','backlog-params'].includes(kind))throw Error('Unsupported synthetic benchmark');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'buyerlog-compute-context-')),sha=value=>crypto.createHash('sha256').update(value).digest('hex');
for(const [name,part] of Object.entries({BUYER_LOG_DATA_ROOT:'app',BUYER_LOG_LOCAL_DATA_ROOT:'local',BUYER_LOG_SERVER_DATA_ROOT:'server',BUYER_LOG_TEMP_ROOT:'temp'})){process.env[name]=path.join(root,part);fs.mkdirSync(process.env[name],{recursive:true});}
delete process.env.BUYER_LOG_AUTH_DATA_ROOT;process.env.BUYER_LOG_CONFIG_PATH=path.join(root,'config.json');
const count=30000;
try{
 let elapsedMs,value,encodedBytes=null,sourceFile;
 if(kind==='status'){
  const record=i=>['DEMO AGE '+i%5,'DEMO MAG '+i%7,'DEMO SUPPLY '+i%3,'DEMO GROUP '+i%11,'DEMO CLASS '+i,.4,.3,.2,.1,[100,110],[100,110],[100,110],[100,110]];
  const fixture={schemaVersion:1,months:['202501','202502'],records:Array.from({length:count},(_,i)=>record(i)),fx:{},season:'DEMO',sourceFile:'Synthetic.xlsx',sourceUpdatedAt:'2026-11-05',generatedAt:'2026-11-05T12:00:00Z'};
  fs.writeFileSync(path.join(root,'server/endeksmatik-snapshot.json.gz'),zlib.gzipSync(JSON.stringify(fixture)));
  sourceFile=path.join(app,'server/lib/endeksmatik.js');const engine=require(sourceFile),started=performance.now();value=engine.publicStatus();elapsedMs=performance.now()-started;
  if(value.recordCount!==count)throw Error('Synthetic status row mismatch');
 }else{
  const authority=Object.fromEntries(Array.from({length:count},(_,i)=>[String(4100000+i),[{buyer:'Synthetic Buyer '+i%7,merch:'M'+i%5,ageGroup:'A'+i%5,buyerGrup:'G'+i%7}]]));
  sourceFile=path.join(app,'server/lib/compute-access.js');const access=require(sourceFile),input={userId:'demo',systemRole:'moderator',manageAll:true,viewScope:{all:true},editScopes:{all:true},authority,profiles:[]};
  if(kind==='authority'){const started=performance.now();value=access.createAccessContext(input);elapsedMs=performance.now()-started;}
  else{
   const context=access.createAccessContext(input),helper=path.join(app,'server/lib/compute-task-access.js');
   const params={access:fs.existsSync(helper)?require(helper).accessForTask(context,'backlog-export',{}):context,overrides:{},options:{},headers:[]};
   const started=performance.now(),encoded=Uint8Array.from(v8.serialize(params)).buffer;elapsedMs=performance.now()-started;encodedBytes=encoded.byteLength;
   value={accessHash:params.access.accessHash,viewScope:params.access.viewScope};
  }
 }
 const codeSha256=Object.fromEntries(['compute-access','compute-task-access','compute-service','endeksmatik'].map(name=>{const file=path.join(app,'server/lib',name+'.js');return [name,fs.existsSync(file)?sha(fs.readFileSync(file)):null];}));
 process.stdout.write(JSON.stringify({synthetic:true,kind,rows:count,elapsedMs,encodedBytes,resultSha256:sha(JSON.stringify(value)),sourceSha256:sha(fs.readFileSync(sourceFile)),codeSha256,harnessSha256:sha(fs.readFileSync(__filename)),revision:require('node:child_process').execFileSync('git',['rev-parse','HEAD'],{cwd:app,encoding:'utf8'}).trim(),platform:process.platform,node:process.version,availableParallelism:os.availableParallelism(),cpuQuota:fs.readFileSync('/sys/fs/cgroup/cpu.max','utf8').trim()})+'\n');
}finally{fs.rmSync(root,{recursive:true,force:true});}
