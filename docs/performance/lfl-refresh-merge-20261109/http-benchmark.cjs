'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),assert=require('node:assert/strict'),{spawn}=require('node:child_process'),{once}=require('node:events');
const [app,budget,output]=process.argv.slice(2),XLSX=require(path.join(app,'node_modules/xlsx'));
const root=fs.mkdtempSync(path.join(os.tmpdir(),'bl944-http-')),env={...process.env,LFL_BENCH_BUDGET:budget};
for(const key of ['BUYER_LOG_DATA_ROOT','BUYER_LOG_SERVER_DATA_ROOT','BUYER_LOG_LOCAL_DATA_ROOT','BUYER_LOG_TEMP_ROOT']){env[key]=path.join(root,key);fs.mkdirSync(env[key],{recursive:true});}
env.BUYER_LOG_CONFIG_PATH=path.join(root,'config.json');fs.mkdirSync(path.join(root,'source'));
fs.writeFileSync(env.BUYER_LOG_CONFIG_PATH,JSON.stringify({port:6492,sourceFolder:path.join(root,'source')}));
const fd=fs.openSync(path.join(root,'server.log'),'a');
const server=spawn(process.execPath,['--expose-gc',path.join(__dirname,'preload.cjs')],{cwd:app,env,stdio:['ignore',fd,fd]});
const base='http://127.0.0.1:6492';let cookie;
const result={app,budget:Number(budget),root,node:process.version,samples:[]};
async function api(url,body){const r=await fetch(base+url,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(cookie?{cookie}:{})},body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json()};}
const sha=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
(async()=>{
 let ready=false;for(let i=0;i<200;i++){try{if((await fetch(base+'/api/health')).status<500){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,100));}assert.ok(ready);
 const login=await fetch(base+'/api/user-login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({userId:'moderator',newPassword:'demo-lfl-recovery-123',password:'demo-lfl-recovery-123'})});assert.equal(login.status,200);cookie=login.headers.get('set-cookie').split(';')[0];
 const rows=[['ORDER CODE','MAG','MMYG','KLASMAN','SEZON','IN STORE','FOB','ORDER QUANTITY','MANUFACTURER','COUNTRY','BUYING GROUP','BUYER']];
 for(let i=0;i<30000;i++)rows.push(['DEMO-'+i,'CU4E','DEMO','K.KOL LİSANS','S6','2026-02-10',10+(i%10),100,'DEMO A','CHINA','DEMO','DEMO']);
 result.rowCount=rows.length-1;result.fixtureHash=sha(rows);
 const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet(rows),'Demo');
 const upload=await api('/api/lfl/upload',{name:'demo-lfl.xlsx',dataBase64:XLSX.write(book,{type:'buffer',bookType:'xlsx'}).toString('base64')});assert.equal(upload.status,200,JSON.stringify(upload));
 let first;
 for(const kind of ['cold','saved','rebuild','rebuild','rebuild','rebuild','rebuild']){
  const before=(await api('/__lfl_bench/gc')).body;await api('/__lfl_bench/reset');
  const started=performance.now(),response=await api('/api/collection-lfl-reference'+(kind==='rebuild'?'?rebuild=1':'')),elapsedMs=performance.now()-started;
  const metrics=(await api('/__lfl_bench/read')).body;
  const summary=response.body.references;
  const item={kind,elapsedMs,status:response.status,code:response.body.code,summaryHash:summary?sha(summary):null,referenceCount:summary?.length,before,metrics};result.samples.push(item);
  if(Number(budget)===160&&response.status!==200){assert.equal(response.body.code,'COMPUTE_JOB_TOO_LARGE');break;}
  assert.equal(response.status,200,JSON.stringify(response));assert.ok(summary.length);
  assert.ok(summary.some(x=>x.average===14.5));
  if(first)assert.deepEqual(summary,first);else first=summary;
 }
 result.postGc=(await api('/__lfl_bench/gc')).body;
})().then(()=>{result.ok=true;}).catch(error=>{result.error=error.stack;process.exitCode=1;}).finally(async()=>{
 const exited=once(server,'exit');server.kill();await exited;fs.closeSync(fd);fs.writeFileSync(output,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({output,ok:result.ok,error:result.error,samples:result.samples.map(x=>({kind:x.kind,status:x.status,ms:x.elapsedMs,gap:x.metrics.maxGapMs}))}));
});
