'use strict';
// Fresh-process synthetic audit microbenchmark. No real data or credentials.
// node scripts/benchmark-audit-details.js --app-root <before-or-after-app> --rows 30000
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const arg=(name,fallback)=>{const i=process.argv.indexOf(name);return i<0?fallback:process.argv[i+1];};
const app=path.resolve(arg('--app-root',path.join(__dirname,'..'))),rows=Number(arg('--rows',30000));
if(!Number.isSafeInteger(rows)||rows<1)throw Error('Invalid synthetic row count');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'buyerlog-audit-benchmark-'));
Object.assign(process.env,{BUYER_LOG_CENTRAL_IAM_ENABLED:'0',BUYER_LOG_AUTH_DATA_ROOT:root,BUYER_LOG_SERVER_DATA_ROOT:root,
  BUYER_LOG_DATA_ROOT:path.join(root,'app'),BUYER_LOG_LOCAL_DATA_ROOT:path.join(root,'local'),
  BUYER_LOG_CONFIG_PATH:path.join(root,'config.json'),BUYER_LOG_TEMP_ROOT:path.join(root,'tmp')});
try{
  const ua=require(path.join(app,'server/lib/user-access')),store=ua.loadStore();
  store.orderAccess=Object.fromEntries(Array.from({length:rows},(_,i)=>['DEMO-'+i,{ownerId:'demo-buyer',canEdit:true}]));
  ua.saveStore(store,store._revision);
  const access=ua.buildUserAccess({}),file=path.join(root,'user-audit.jsonl'),measurements=[];
  for(const action of ['LOGIN','LOGOUT','PASSWORD_SETUP']){
    const started=performance.now(),ok=access.appendAudit({id:'moderator',displayName:'Synthetic moderator',role:'moderator'},action,'session'),ms=performance.now()-started;
    if(!ok)throw Error('Synthetic audit failed');
    const line=fs.readFileSync(file,'utf8').trim().split('\n').at(-1),record=JSON.parse(line);
    measurements.push({action,ms,bytes:Buffer.byteLength(line+'\n'),detailsNull:record.details===null,containsOrderAccess:line.includes('orderAccess')});
  }
  process.stdout.write(JSON.stringify({synthetic:true,platform:process.platform,node:process.version,rows,measurements})+'\n');
}finally{fs.rmSync(root,{recursive:true,force:true});}
