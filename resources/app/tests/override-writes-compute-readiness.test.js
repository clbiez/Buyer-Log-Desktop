'use strict';
/* #1071 — Kayıt, arka plan hesap işçisinin hazırlığına bağlı olmamalı ("anında kayıt + senkron").

   L2 koşusunda (#1102 adayı, 30k) POST /api/overrides/batch-suppfob 46 ms'de 0,1 KB'lık bir hata
   yanıtıyla reddedildi ("Supp. FOB düzenlemeleri kaydedilemedi."); aynı anda günlükte compute
   havuzu hataları vardı. Zincir: yetki özeti (orderAccess) yeni nesneyle değişince
   prepareComputeAccessContext özetini compute havuzunda hesaplatır; iş kuyrukta/çalışırken
   userAccess.computeAccessContext() eşzamanlı çağrıya COMPUTE_ACCESS_NOT_READY (503) atar.
   Kayıt rotaları yazmadan ÖNCE pageProjectionContext() → computeAccessContext() çağırıyordu;
   böylece hesap işçisinin kuyruğu/hatası kullanıcı kaydını reddettiriyordu.

   Testler yetki özeti işini (hashAccessAuthority) bir kapı dosyası varken askıda tutar (yük
   altında kuyrukta bekleyen işin en kötü hâli):
   1) kayıt rotaları yine de kaydeder;
   2) bu pencerede artımlı önbellek yaması atlanır, ama sonraki okuma eski değeri DÖNDÜRMEZ:
      yazım _revisions.orders/suppFob sayacını artırır, bu sayaçlar projeksiyon bağlam özetindedir,
      eski nesil özet eşleşmediği için okunmaz ve projeksiyon yeni bağlamla yeniden kurulur. */
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),net=require('node:net');
const {spawn,spawnSync}=require('node:child_process');

const APP=path.join(__dirname,'..');
const PASSWORD='compute-readiness-test-123';
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));

async function freePort(){
  const socket=net.createServer();await new Promise(resolve=>socket.listen(0,'127.0.0.1',resolve));
  const {port}=socket.address();await new Promise(resolve=>socket.close(resolve));return port;
}

// Kapı dosyası varken yalnız yetki özeti işi bekler; diğer hesaplar normal çalışır.
function sandbox(t,{sourceFolder=null}={}){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'buyerlog-write-readiness-'));
  const gate=path.join(root,'hold-authority-hash');
  const preload=path.join(root,'hold-authority-hash.js');
  fs.writeFileSync(preload,`'use strict';
const fs=require('node:fs');
const service=require(${JSON.stringify(path.join(APP,'server','lib','compute-service.js'))});
const original=service.createComputeService;
service.createComputeService=options=>{
  const created=original(options),hash=created.hashAccessAuthority;
  created.hashAccessAuthority=async(...args)=>{while(fs.existsSync(${JSON.stringify(gate)}))await new Promise(resolve=>setTimeout(resolve,25));return hash(...args);};
  return created;
};
`);
  fs.mkdirSync(path.join(root,'local'),{recursive:true});
  fs.writeFileSync(path.join(root,'local','data-cleanup-state.json'),JSON.stringify({schemaVersion:1,lastCheckAt:new Date().toISOString()})+'\n');
  const env={...process.env,BUYER_LOG_CENTRAL_IAM_ENABLED:'0',BUYER_LOG_SERVER_DATA_ROOT:path.join(root,'data'),BUYER_LOG_AUTH_DATA_ROOT:path.join(root,'data'),
    BUYER_LOG_DATA_ROOT:path.join(root,'app'),BUYER_LOG_LOCAL_DATA_ROOT:path.join(root,'local'),BUYER_LOG_LOCAL_DB:path.join(root,'local','BuyerLogLocal.db'),
    BUYER_LOG_CONFIG_PATH:path.join(root,'config.json'),BUYER_LOG_TEMP_ROOT:path.join(root,'tmp')};
  let server=null,log='',base='',cookie='';
  const box={root,gate,
    hold(){fs.writeFileSync(gate,'');},release(){fs.rmSync(gate,{force:true});},
    get log(){return log;},
    async start(){
      const port=await freePort();base=`http://127.0.0.1:${port}`;
      fs.writeFileSync(env.BUYER_LOG_CONFIG_PATH,JSON.stringify({port,host:'127.0.0.1',...(sourceFolder?{sourceFolder}:{})}));
      server=spawn(process.execPath,['--require',preload,path.join(APP,'server','server.js')],{cwd:APP,env,stdio:['ignore','pipe','pipe']});
      server.stdout.on('data',chunk=>{log+=chunk;});server.stderr.on('data',chunk=>{log+=chunk;});
      let ready=false;
      for(let i=0;i<240&&!ready;i++){
        if(server.exitCode!==null)break;
        try{ready=(await fetch(base+'/api/status')).status<500;}catch(_){await delay(250);}
      }
      assert.ok(ready,'server did not start\n'+log.slice(-4000));
      const login=await fetch(base+'/api/user-login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({userId:'moderator',password:PASSWORD,newPassword:PASSWORD})});
      assert.equal(login.status,200,'login failed');
      cookie=String(login.headers.get('set-cookie')||'').split(';')[0];
    },
    async stop(){
      if(!server||server.exitCode!==null)return;
      const exited=new Promise(resolve=>server.once('exit',resolve));server.kill('SIGTERM');
      await Promise.race([exited,delay(8000)]);if(server.exitCode===null){server.kill('SIGKILL');await exited;}
    },
    async send(url,body,method='POST'){
      const response=await fetch(base+url,{method,headers:{cookie,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(60000)});
      return {status:response.status,body:await response.json().catch(()=>({}))};
    },
    async get(url,timeout=120000){
      const response=await fetch(base+url,{headers:{cookie},signal:AbortSignal.timeout(timeout)});
      return {status:response.status,cache:response.headers.get('x-page-cache'),generation:response.headers.get('x-page-cache-generation'),body:await response.json().catch(()=>({}))};
    },
    // Hesap rotası yetki hazırlığını başlatır; kapı kapalıyken bu istek bekler.
    startPendingRead(){const controller=new AbortController();const done=fetch(base+'/api/page-projection/cp',{headers:{cookie},signal:controller.signal}).then(r=>r.arrayBuffer()).catch(()=>{});return {controller,done};},
  };
  t.after(async()=>{box.release();await box.stop();fs.rmSync(root,{recursive:true,force:true});});
  return box;
}

test('override writes succeed while the compute access authority is still being prepared',{timeout:120000},async t=>{
  const box=sandbox(t);box.hold();await box.start();
  const pending=box.startPendingRead();t.after(()=>pending.controller.abort());
  await delay(500);

  const suppFob=await box.send('/api/overrides/batch-suppfob',{items:[{orderCode:910001,model:'M1',ccode:'C1',suppFob:12.5,suppFobMeta:{source:'manual'}}]});
  assert.equal(suppFob.status,200,'batch-suppfob: '+JSON.stringify(suppFob.body));
  assert.equal(suppFob.body.updated,1);

  const rows=await box.send('/api/overrides/rows',{items:[{orderCode:910002,patch:{model:'M2',ccode:'C2',delType:'SEA'},base:{delType:''}}]});
  assert.equal(rows.status,200,'rows: '+JSON.stringify(rows.body));
  assert.equal(rows.body.applied.filter(item=>!item.noop).length,1);

  const batch=await box.send('/api/overrides/batch',{items:[{orderCode:910003,patch:{model:'M3',ccode:'C3',delType:'AIR'}}]});
  assert.equal(batch.status,200,'batch: '+JSON.stringify(batch.body));

  const single=await box.send('/api/overrides/910004',{model:'M4',ccode:'C4',delType:'AIR'},'PATCH');
  assert.equal(single.status,200,'patch: '+JSON.stringify(single.body));
});

test('a save made while access is not ready is not served stale: the next projection read returns the new value',{timeout:300000},async t=>{
  const fixture=fs.mkdtempSync(path.join(os.tmpdir(),'buyerlog-write-readiness-src-'));
  t.after(()=>fs.rmSync(fixture,{recursive:true,force:true}));
  const generated=spawnSync(process.execPath,[path.join(APP,'scripts','generate-demo-data.js'),fixture,'--rows','220','--seed','7'],{cwd:APP,encoding:'utf8'});
  assert.equal(generated.status,0,generated.stderr);
  const box=sandbox(t,{sourceFolder:fixture});
  await box.start();
  assert.equal((await box.send('/api/refresh',{})).status<300,true);
  for(let i=0;i<480;i++){
    const status=await box.get('/api/refresh-status');
    if(status.body&&!status.body.running){assert.ok(!status.body.error,JSON.stringify(status.body.error));break;}
    await delay(250);
  }
  // Önbelleği ısıt: aynı bağlamla ikinci okuma önbellekten gelir.
  const first=await box.get('/api/page-projection/cp');
  assert.equal(first.status,200,JSON.stringify(first.body).slice(0,300));
  const warm=await box.get('/api/page-projection/cp');
  assert.equal(warm.cache,'hit','projection cache is warm before the save');
  const rowsOf=read=>read.body.rows||[];
  const target=rowsOf(warm).find(row=>Number.isFinite(Number(row['Order Code']))&&row['Model Name']&&row['C.Code']);
  assert.ok(target,'fixture has a CP row');
  const orderCode=Number(target['Order Code']),model=String(target['Model Name']),ccode=String(target['C.Code']);
  const sameLine=row=>Number(row['Order Code'])===orderCode&&String(row['Model Name'])===model&&String(row['C.Code'])===ccode;
  const value=Math.round((Number(target['Supp. FOB'])||0)*100+4321)/100;

  // Yeniden başlatma yetki özeti için yeni (hazırlanmamış) bir nesne verir; kapı onu askıda tutar.
  await box.stop();box.hold();await box.start();
  const pending=box.startPendingRead();t.after(()=>pending.controller.abort());
  await delay(800);
  const saved=await box.send('/api/overrides/batch-suppfob',{items:[{orderCode,model,ccode,suppFob:value,suppFobMeta:{source:'manual'}}]});
  assert.equal(saved.status,200,'batch-suppfob: '+JSON.stringify(saved.body));
  assert.equal(saved.body.updated,1);
  assert.match(box.log,/writeProjectionContext: /,'the save ran inside the not-ready window (cache patch skipped)');

  box.release();await pending.done;
  const after=await box.get('/api/page-projection/cp');
  assert.equal(after.status,200);
  const row=rowsOf(after).find(sameLine);
  assert.ok(row,'saved row is still in the projection');
  assert.equal(Number(row['Supp. FOB']),value,'next read returns the saved value, not the stale cached one');
  assert.ok(warm.generation,'warm read reports its cache generation');
  assert.notEqual(after.generation,warm.generation,'the pre-save cache generation is not served');
});
