'use strict';
// Inspect before execution. Synthetic diagnostic only; no server, network,
// releases or real user databases. Exit 0 means the unfixed defect reproduced.
// Usage: node docs/audits/nd-003-wal-tail-repro.cjs /absolute/path/resources/app
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const appRoot=path.resolve(process.argv[2]||path.join(__dirname,'../../resources/app'));
if(!fs.existsSync(path.join(appRoot,'server/lib/local-db.js')))throw Error('Expected application root is missing');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'buyerlog-handoff-wal-tail-'));
for(const key of Object.keys(process.env))if(key.startsWith('BUYER_LOG_'))delete process.env[key];
for(const [key,name] of Object.entries({BUYER_LOG_DATA_ROOT:'app',BUYER_LOG_LOCAL_DATA_ROOT:'local',BUYER_LOG_SERVER_DATA_ROOT:'server',BUYER_LOG_AUTH_DATA_ROOT:'local/auth',BUYER_LOG_TEMP_ROOT:'temp',APPDATA:'appdata',LOCALAPPDATA:'localappdata'})){
  process.env[key]=path.join(root,name);fs.mkdirSync(process.env[key],{recursive:true});
}
process.env.TMPDIR=process.env.TEMP=process.env.TMP=process.env.BUYER_LOG_TEMP_ROOT;
process.env.BUYER_LOG_CENTRAL_IAM_ENABLED='0';process.env.BUYER_LOG_CONFIG_PATH=path.join(root,'config.json');fs.writeFileSync(process.env.BUYER_LOG_CONFIG_PATH,'{}');
(async()=>{
 try{
  const {createLocalDb}=require(path.join(appRoot,'server/lib/local-db'));
  const file=path.join(root,'local','synthetic.db'),db=createLocalDb(file);
  await db.ensure();await db.queuePatch({id:'before',patch:{n:1}});
  fs.appendFileSync(file+'.wal','{"v":1,"op":"pat');
  await db.queuePatch({id:'after',patch:{n:2}});
  const warm=(await db.read()).records.after?.n,cold=(await createLocalDb(file).read()).records.after?.n??null;
  const evidence={classification:'Confirmed defect, NOT FIXED',acknowledged:true,warm,cold,expectedAfterFix:2,platform:process.platform,node:process.version};
  console.log(JSON.stringify(evidence,null,2));assert.equal(warm,2);assert.equal(cold,null,'This diagnostic expects the current defect; convert it to a survival regression when fixing');
 }finally{fs.rmSync(root,{recursive:true,force:true});}
})().catch(error=>{console.error(error.code||error.name,error.message);process.exitCode=1;});
