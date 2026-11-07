'use strict';
// Sentetik authority, taze süreç ve iki kolda da önceden hazırlanmış aynı havuz.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),{performance}=require('node:perf_hooks');
const app=path.resolve(process.argv[2]||path.join(__dirname,'..')),root=fs.mkdtempSync(path.join(os.tmpdir(),'buyerlog-authority-ready-'));
const sha=value=>crypto.createHash('sha256').update(value).digest('hex'),delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
for(const [key,part]of Object.entries({BUYER_LOG_DATA_ROOT:'app',BUYER_LOG_LOCAL_DATA_ROOT:'local',BUYER_LOG_SERVER_DATA_ROOT:'server',BUYER_LOG_TEMP_ROOT:'temp'})){process.env[key]=path.join(root,part);fs.mkdirSync(process.env[key],{recursive:true});}
delete process.env.BUYER_LOG_AUTH_DATA_ROOT;process.env.BUYER_LOG_CONFIG_PATH=path.join(root,'config.json');
(async()=>{
 let compute,timer;
 try{
  const access=require(path.join(app,'server/lib/compute-access')),count=30000;
  compute=require(path.join(app,'server/lib/compute-runtime')).getComputeService();await compute.warm();
  const authority=Object.fromEntries(Array.from({length:count},(_,i)=>[String(4100000+i),[{buyer:'Synthetic Buyer '+i%7,merch:'M'+i%5,ageGroup:'A'+i%5,buyerGrup:'G'+i%7}]]));
  const input={userId:'demo',systemRole:'moderator',manageAll:true,viewScope:{all:true},editScopes:{all:true},authority,profiles:[]};
  await delay(20);const gaps=[];let previous=performance.now(),metrics=null;
  timer=setInterval(()=>{const now=performance.now();gaps.push(now-previous);previous=now;},10);
  const start=performance.now();
  if(access.prepareAuthority)await access.prepareAuthority(authority,{hashAuthority:value=>compute.hashAccessAuthority(value,{onMetrics:value=>{metrics=value;}})});
  const context=access.createAccessContext(input),readinessMs=performance.now()-start;
  await delay(20);clearInterval(timer);timer=null;
  if(Object.keys(context.authority).length!==count)throw Error('Incomplete authority');
  const codeSha256=Object.fromEntries(['compute-access','compute-service','compute-runtime','compute-access-middleware','user-access'].map(name=>{const file=path.join(app,'server/lib',name+'.js');return [name,fs.existsSync(file)?sha(fs.readFileSync(file)):null];}));
  process.stdout.write(JSON.stringify({status:'passed',synthetic:true,rows:count,readinessMs,maxGapMs:Math.max(0,...gaps),gapsMs:gaps,metrics,resultSha256:sha(JSON.stringify(context)),codeSha256,harnessSha256:sha(fs.readFileSync(__filename)),revision:require('node:child_process').execFileSync('git',['rev-parse','HEAD'],{cwd:app,encoding:'utf8'}).trim(),platform:process.platform,node:process.version,availableParallelism:os.availableParallelism()})+'\n');
 }finally{clearInterval(timer);await compute?.close();fs.rmSync(root,{recursive:true,force:true});}
})().catch(error=>{process.stderr.write(String(error.stack||error)+'\n');process.exitCode=1;});
