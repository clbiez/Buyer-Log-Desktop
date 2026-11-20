'use strict';
/* #1071 — Kayıt, arka plan hesap işçisinin hazırlığına bağlı olmamalı ("anında kayıt + senkron").

   L2 koşusunda (#1102 adayı, 30k) POST /api/overrides/batch-suppfob 46 ms'de 0,1 KB'lık bir hata
   yanıtıyla reddedildi ("Supp. FOB düzenlemeleri kaydedilemedi."); aynı anda günlükte compute
   havuzu hataları vardı. Zincir: yetki özeti (orderAccess) yeni nesneyle değişince
   prepareComputeAccessContext özetini compute havuzunda hesaplatır; iş kuyrukta/çalışırken
   userAccess.computeAccessContext() eşzamanlı çağrıya COMPUTE_ACCESS_NOT_READY (503) atar.
   Kayıt rotaları yazmadan ÖNCE pageProjectionContext() → computeAccessContext() çağırıyordu;
   böylece hesap işçisinin kuyruğu/hatası kullanıcı kaydını reddettiriyordu.

   Test, yetki özeti işini (hashAccessAuthority) hiç bitmeyecek biçimde askıda tutar (yük altında
   kuyrukta bekleyen işin en kötü hâli) ve kayıt rotalarının yine de kaydettiğini doğrular. */
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),net=require('node:net');
const {spawn}=require('node:child_process');

const APP=path.join(__dirname,'..');
const PASSWORD='compute-readiness-test-123';
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));

async function freePort(){
  const socket=net.createServer();await new Promise(resolve=>socket.listen(0,'127.0.0.1',resolve));
  const {port}=socket.address();await new Promise(resolve=>socket.close(resolve));return port;
}

test('override writes succeed while the compute access authority is still being prepared',{timeout:120000},async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'buyerlog-write-readiness-'));
  const hang=path.join(root,'hang-authority-hash.js');
  // Yalnız yetki özeti işi askıda; diğer hesaplar normal çalışır.
  fs.writeFileSync(hang,`'use strict';
const service=require(${JSON.stringify(path.join(APP,'server','lib','compute-service.js'))});
const original=service.createComputeService;
service.createComputeService=options=>{const created=original(options);created.hashAccessAuthority=()=>new Promise(()=>{});return created;};
`);
  const port=await freePort(),base=`http://127.0.0.1:${port}`;
  fs.mkdirSync(path.join(root,'local'),{recursive:true});
  fs.writeFileSync(path.join(root,'local','data-cleanup-state.json'),JSON.stringify({schemaVersion:1,lastCheckAt:new Date().toISOString()})+'\n');
  fs.writeFileSync(path.join(root,'config.json'),JSON.stringify({port,host:'127.0.0.1'}));
  const env={...process.env,BUYER_LOG_CENTRAL_IAM_ENABLED:'0',BUYER_LOG_SERVER_DATA_ROOT:path.join(root,'data'),BUYER_LOG_AUTH_DATA_ROOT:path.join(root,'data'),
    BUYER_LOG_DATA_ROOT:path.join(root,'app'),BUYER_LOG_LOCAL_DATA_ROOT:path.join(root,'local'),BUYER_LOG_LOCAL_DB:path.join(root,'local','BuyerLogLocal.db'),
    BUYER_LOG_CONFIG_PATH:path.join(root,'config.json'),BUYER_LOG_TEMP_ROOT:path.join(root,'tmp')};
  let log='';
  const server=spawn(process.execPath,['--require',hang,path.join(APP,'server','server.js')],{cwd:APP,env,stdio:['ignore','pipe','pipe']});
  server.stdout.on('data',chunk=>{log+=chunk;});server.stderr.on('data',chunk=>{log+=chunk;});
  t.after(async()=>{
    if(server.exitCode===null){const exited=new Promise(resolve=>server.once('exit',resolve));server.kill('SIGTERM');await Promise.race([exited,delay(8000)]);if(server.exitCode===null)server.kill('SIGKILL');}
    fs.rmSync(root,{recursive:true,force:true});
  });
  let ready=false;
  for(let i=0;i<240&&!ready;i++){
    if(server.exitCode!==null)break;
    try{ready=(await fetch(base+'/api/status')).status<500;}catch(_){await delay(250);}
  }
  assert.ok(ready,'server did not start\n'+log.slice(-4000));
  const login=await fetch(base+'/api/user-login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({userId:'moderator',password:PASSWORD,newPassword:PASSWORD})});
  assert.equal(login.status,200,'login failed');
  const cookie=String(login.headers.get('set-cookie')||'').split(';')[0];
  const headers={cookie,'Content-Type':'application/json'};

  // Hesap rotası yetki hazırlığını başlatır; hash işi askıda kaldığı için bu istek bekler.
  const pendingRead=new AbortController();
  fetch(base+'/api/page-projection/cp',{headers:{cookie},signal:pendingRead.signal}).catch(()=>{});
  t.after(()=>pendingRead.abort());
  await delay(500);

  const post=async(url,body,method='POST')=>{
    const response=await fetch(base+url,{method,headers,body:JSON.stringify(body),signal:AbortSignal.timeout(30000)});
    return {status:response.status,body:await response.json().catch(()=>({}))};
  };

  const suppFob=await post('/api/overrides/batch-suppfob',{items:[{orderCode:910001,model:'M1',ccode:'C1',suppFob:12.5,suppFobMeta:{source:'manual'}}]});
  assert.equal(suppFob.status,200,'batch-suppfob: '+JSON.stringify(suppFob.body));
  assert.equal(suppFob.body.updated,1);

  const rows=await post('/api/overrides/rows',{items:[{orderCode:910002,patch:{model:'M2',ccode:'C2',delType:'SEA'},base:{delType:''}}]});
  assert.equal(rows.status,200,'rows: '+JSON.stringify(rows.body));
  assert.equal(rows.body.applied.filter(item=>!item.noop).length,1);

  const batch=await post('/api/overrides/batch',{items:[{orderCode:910003,patch:{model:'M3',ccode:'C3',delType:'AIR'}}]});
  assert.equal(batch.status,200,'batch: '+JSON.stringify(batch.body));

  const single=await post('/api/overrides/910004',{model:'M4',ccode:'C4',delType:'AIR'},'PATCH');
  assert.equal(single.status,200,'patch: '+JSON.stringify(single.body));
});
