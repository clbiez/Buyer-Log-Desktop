'use strict';
// Full production HTTP route + IAM + JSON + CP mirror + local WAL, synthetic only.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {fork}=require('node:child_process'),{performance}=require('node:perf_hooks');
const app=path.resolve(process.argv[2]||path.join(__dirname,'..'));
const output=path.resolve(process.argv[3]||'/tmp/buyerlog-6c-http.json');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'buyerlog-6c-http-')),port=6500+Math.floor(Math.random()*500),base=`http://127.0.0.1:${port}`;
const XLSX=require('xlsx'),demo=require(path.join(app,'scripts/generate-demo-data')).build({rows:1000,seed:952,today:new Date('2026-11-09T00:00:00Z')});
const env={...process.env,NODE_ENV:'test',BL_AUTOMATION_RUN:'0',BL_AUTOEXIT:'0',BUYER_LOG_CENTRAL_IAM_ENABLED:'0',BUYER_LOG_CONFIG_PATH:path.join(root,'config.json')};
for(const [key,dir]of Object.entries({BUYER_LOG_SERVER_DATA_ROOT:'server',BUYER_LOG_AUTH_DATA_ROOT:'server',BUYER_LOG_DATA_ROOT:'data',BUYER_LOG_LOCAL_DATA_ROOT:'local',BUYER_LOG_TEMP_ROOT:'temp'})){env[key]=path.join(root,dir);fs.mkdirSync(env[key],{recursive:true});}
const source=path.join(root,'source');fs.mkdirSync(source);
fs.writeFileSync(env.BUYER_LOG_CONFIG_PATH,JSON.stringify({port,host:'127.0.0.1',sourceFolder:source,refreshWithExcel:false,updates:{enabled:false}}));
const header=demo.asas[2],codes=[];
for(let i=3;i<demo.asas.length;i++){
 const code=810000+i-3;codes.push(code);
 for(const [key,value]of Object.entries({'Sipariş Kod':code,'Model Adı':`SYNTHETIC BATCH ${i-3}`,'Buying Son Onay Tarihi':null,'Renk Kod':'BLK','Renk':'BLACK','Net Alım Sipariş Miktarı':100,'Kalan Alım Sipariş Miktarı':100,'Antrepoya Giren Miktar':0,'Lisans':''}))if(header.includes(key))demo.asas[i][header.indexOf(key)]=value;
}
for(const [name,sheet,rows]of [['ASAS.xlsx','ASAS',demo.asas],['Antrepo.xlsx','Antrepo',demo.antrepo]]){const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(rows),sheet);XLSX.writeFile(wb,path.join(source,name));}
const log=fs.openSync(path.join(root,'server.log'),'a'),child=fork(path.join(app,'server/server.js'),[],{cwd:app,env,execArgv:['--require',path.join(__dirname,'phase6c-http-preload.cjs')],stdio:['ignore',log,log,'ipc']});
let cookie,seq=0;const waiters=new Map();child.on('message',m=>{const waiter=waiters.get(m.id);if(waiter){waiters.delete(m.id);m.error?waiter.reject(Object.assign(new Error(m.error.message),m.error)):waiter.resolve(m.result);}});
function command(command){return new Promise((resolve,reject)=>{const id=++seq;waiters.set(id,{resolve,reject});child.send({id,command});});}
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
// Compare independently generated server timestamps by type; values/IDs,
// user/owner metadata, revisions, order and receipt flags remain in the oracle.
function oracle(value){
 if(Array.isArray(value))return value.map(oracle);
 if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,/^(NotesAt|EkNotAt|markedAt|updatedAt|_updatedAt)$/.test(key)&&typeof value[key]==='string'&&/^\d{4}-\d\d-\d\dT/.test(value[key])?'SERVER_TIMESTAMP':oracle(value[key])]));
 return value;
}
async function api(url,body,method=body?'POST':'GET',expected=200,headers={}){const response=await fetch(base+url,{method,headers:{cookie,'Content-Type':'application/json',...headers},body:body===undefined?undefined:JSON.stringify(body)});const result=await response.json();assert.equal(response.status,expected,JSON.stringify(result));return result;}
const result={app,root,runtime:process.versions,platform:process.platform,fixtureHash:hash(demo),rows:[],acceptance:[]};
(async()=>{
 for(let i=0;i<300;i++){if(child.exitCode!==null)throw Error('server exited: '+fs.readFileSync(path.join(root,'server.log'),'utf8'));try{if((await fetch(base+'/api/health')).status<500)break;}catch{}await new Promise(r=>setTimeout(r,100));}
 const login=await fetch(base+'/api/user-login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({userId:'moderator',password:'synthetic-6c-only',newPassword:'synthetic-6c-only'})});assert.equal(login.status,200,await login.clone().text());cookie=login.headers.get('set-cookie').split(';')[0];
 await api('/api/refresh',{},'POST',202);for(let i=0;i<400;i++){if(!(await api('/api/refresh-status')).running)break;await new Promise(r=>setTimeout(r,100));}
 const cp=await api('/api/data/cp');assert.equal(cp.rows.length,1000);
 await new Promise(resolve=>setTimeout(resolve,5000)); // Let unchanged 4s startup maintenance complete on both arms.
 for(const count of (process.argv[4] ? [Number(process.argv[4])] : [1,100,1000]))for(const phase of ['cold','warm']){
  const items=codes.slice(0,count).map((orderCode,i)=>({orderCode,patch:{notes:{Notes:`SYNTHETIC ${phase} ${i}`},dates:i%2?{retailDate:'2026-12-01'}:{inStoreDate:'2026-12-15'},shortage:i%2===0}}));
  await command('start');const started=performance.now();const ack=await api('/api/overrides/batch',{items});const ackMs=performance.now()-started;const measurement=await command('finish');
  result.rows.push({count,phase,fixtureHash:hash(items),ackMs,...measurement,records:undefined,events:undefined,businessHash:hash(oracle(measurement.records)),eventHash:hash(oracle(measurement.events)),eventCount:measurement.events.length,updated:ack.updated,skipped:ack.skipped,ackHash:hash(oracle(ack))});
  assert.equal(ack.updated,count);assert.equal(measurement.replayEqual,true);
 }
 const repeated=[{orderCode:codes[0],patch:{notes:{Notes:'first'},dates:{retailDate:'2026-12-03'}}},{orderCode:codes[0],patch:{notes:{Notes:''},dates:{inStoreDate:null},suppFob:0}},{orderCode:codes[1],patch:{shortage:false,subManufacturer:null}}];
 const ack=await api('/api/overrides/batch',{items:repeated});assert.equal(ack.updated,3);await command('start');const final=await command('finish');assert.equal(final.replayEqual,true);result.acceptance.push('repeat-ID, heterogeneous subfields, false/zero/null/empty, replay');
 const revision=ack.revision;await api('/api/overrides/batch',{items:repeated},'POST',409,{'If-Match':String(revision-1)});result.acceptance.push('revision/CAS rejection');
 const partial=await api('/api/overrides/batch',{items:[{orderCode:codes[0],patch:{notes:{Notes:'valid'}}},{orderCode:'invalid',patch:{notes:{Notes:'ignored'}}}]});assert.equal(partial.updated,1);assert.ok(partial.skipped.length);result.acceptance.push('partial ACK with invalid row');
 const empty=await api('/api/overrides/batch',{items:[]});assert.equal(empty.updated,0);result.acceptance.push('empty/no-op ACK');
 result.ok=true;
})().catch(error=>{result.ok=false;result.error={message:error.message,stack:error.stack};process.exitCode=1;}).finally(async()=>{
 fs.writeFileSync(output,JSON.stringify(result,null,2)+'\n');child.kill('SIGTERM');await new Promise(resolve=>{child.once('exit',resolve);setTimeout(()=>{child.kill('SIGKILL');resolve();},5000).unref();});fs.closeSync(log);console.log(output);
});
