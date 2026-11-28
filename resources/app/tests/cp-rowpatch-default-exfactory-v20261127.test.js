'use strict';
/* ADR-0003 §6F pilotu varsayılan (2026-11-27): eski kayıt yolları satır yaması günlüğüne her zaman yazar — GERÇEK SUNUCU.
 *
 * Neden bu test: #1236 bayrağı kaldırılınca çalışma zamanı anahtarı kalmaz. Geri dönüş yolu güvenli tam hesaptır
 * (zincir yok / doğrulama uyuşmazlığı → kira + tam kurulum). Önceki kanıt (30k demo fixture) Ex-factory'yi gerçek sunucuda
 * sınayamadı: demo satırlarının tamamı yükleme onayından OTOMATİK Ex-factory taşır, sunucu yazımdan önce 409 döner.
 * Bu test sentetik kaynakta yükleme onayı ('Buying Son Onay Tarihi') boş satırlar üretir; böylece Ex-factory elle
 * düzenlenebilir ve şunlar gerçek sunucuda sabitlenir:
 *   1) Supp. FOB kaydı (PATCH, gövdede delType yok) sonrası CP okuması satır yaması yoluna girer (varsayılan açık).
 *   2) Elle düzenlenebilir satırda Ex-factory (PATCH ve /batch) 2xx; sonraki okuma da satır yaması yolunda (2026-11-28,
 *      İş 2: lojistik segmentler artımlı yeniden kurulur, parse.refreshCpLogisticRow) ve değer görünür.
 *   3) Otomatik (yükleme onaylı) satırda Ex-factory yazımı 409 AUTOMATIC_DATE_READ_ONLY; değer korunur.
 *   4) Projeksiyon önbelleği silinip sıfırdan tam kurulum (yeniden başlatma) tabanı: dokunulan satırlar alan alan
 *      (Ex-factory, Ant. Arrival, STATUS, Del. Type, Supp. FOB …) ve tüm satırların karar demeti birebir.
 * Beklenen değerler artımlı fonksiyondan GEÇMEZ: taban sıfırdan tam kurulumdur. */
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),net=require('node:net');
const {spawn,spawnSync}=require('node:child_process');
const XLSX=require('xlsx');
const {compactRefreshStatus}=require('../scripts/lib/startup-benchmark');

const APP=path.join(__dirname,'..');
const PASSWORD='cp-rowpatch-default-test-123';
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const iso=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const SHIP_CONF='Buying Son Onay Tarihi'; // i18n-ignore — ASAS kaynak başlığı

async function freePort(){const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const {port}=s.address();await new Promise(r=>s.close(r));return port;}
const walk=(dir,out=[])=>{for(const e of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory())walk(p,out);else out.push(p);}return out;};

// Sentetik kaynak: demo üreticisi + her 4. ASAS satırında yükleme onayı boş (Ex-factory elle düzenlenebilir).
function syntheticSource(root){
  const dir=path.join(root,'source');
  const g=spawnSync(process.execPath,[path.join(APP,'scripts','generate-demo-data.js'),dir,'--rows','400','--seed','7'],{cwd:APP,encoding:'utf8'});
  assert.equal(g.status,0,g.stderr);
  const file=fs.readdirSync(dir).map(f=>path.join(dir,f)).find(f=>/^ASAS/i.test(path.basename(f)));
  const wb=XLSX.readFile(file),name=wb.SheetNames[0],aoa=XLSX.utils.sheet_to_json(wb.Sheets[name],{header:1,raw:true,defval:null});
  const h=aoa.findIndex(row=>Array.isArray(row)&&row.includes(SHIP_CONF));assert.ok(h>=0,'ASAS yükleme onayı sütunu');
  const col=aoa[h].indexOf(SHIP_CONF);let cleared=0;
  for(let i=h+1;i<aoa.length;i++)if((i-h)%4===1&&aoa[i]&&aoa[i][col]!=null){aoa[i][col]=null;cleared++;}
  assert.ok(cleared>10,'yükleme onayı boş satır üretildi');
  const out=XLSX.utils.book_new();XLSX.utils.book_append_sheet(out,XLSX.utils.aoa_to_sheet(aoa),name);XLSX.writeFile(out,file,{bookType:'xlsx'});
  return dir;
}

function sandbox(){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'buyerlog-cp-rowpatch-default-'));
  const source=syntheticSource(root);
  fs.mkdirSync(path.join(root,'local'),{recursive:true});
  fs.writeFileSync(path.join(root,'local','data-cleanup-state.json'),JSON.stringify({schemaVersion:1,lastCheckAt:new Date().toISOString()})+'\n');
  const env={...process.env,BUYER_LOG_CENTRAL_IAM_ENABLED:'0',BUYER_LOG_SERVER_DATA_ROOT:path.join(root,'data'),BUYER_LOG_AUTH_DATA_ROOT:path.join(root,'data'),
    BUYER_LOG_DATA_ROOT:path.join(root,'app'),BUYER_LOG_LOCAL_DATA_ROOT:path.join(root,'local'),BUYER_LOG_LOCAL_DB:path.join(root,'local','BuyerLogLocal.db'),
    BUYER_LOG_CONFIG_PATH:path.join(root,'config.json'),BUYER_LOG_TEMP_ROOT:path.join(root,'tmp')};
  let server=null,log='',base='',cookie='';
  const box={root,
    get log(){return log;},
    async start(){
      const port=await freePort();base=`http://127.0.0.1:${port}`;
      fs.writeFileSync(env.BUYER_LOG_CONFIG_PATH,JSON.stringify({port,host:'127.0.0.1',sourceFolder:source}));
      server=spawn(process.execPath,[path.join(APP,'server','server.js')],{cwd:APP,env,stdio:['ignore','pipe','pipe']});
      server.stdout.on('data',c=>{log+=c;});server.stderr.on('data',c=>{log+=c;});
      let ready=false;
      for(let i=0;i<240&&!ready;i++){if(server.exitCode!==null)break;try{ready=(await fetch(base+'/api/status')).status<500;}catch(_){await delay(250);}}
      assert.ok(ready,'server did not start\n'+log.slice(-4000));
      const login=await fetch(base+'/api/user-login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({userId:'moderator',password:PASSWORD,newPassword:PASSWORD})});
      assert.equal(login.status,200,'login failed');cookie=String(login.headers.get('set-cookie')||'').split(';')[0];
    },
    async stop(){
      if(!server||server.exitCode!==null)return;
      const exited=new Promise(r=>server.once('exit',r));server.kill('SIGTERM');
      await Promise.race([exited,delay(8000)]);if(server.exitCode===null){server.kill('SIGKILL');await exited;}
    },
    async get(url){const r=await fetch(base+url,{headers:{cookie},signal:AbortSignal.timeout(60000)});return r.json().catch(()=>({}));},
    async send(url,body,method='POST'){
      for(let attempt=0;;attempt++){
        const r=await fetch(base+url,{method,headers:{cookie,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(120000)});
        const json=await r.json().catch(()=>({}));
        if(r.status===503&&/read-model/.test(url)&&attempt<20){await delay(500);continue;}
        return {status:r.status,body:json};
      }
    },
  };
  return box;
}

const FIELDS=['_id','Order Code','Model Name','C.Code','Ex-factory','Ant. Arrival','STATUS','HANDOVER Tarihi','Del. Type','Supp. FOB','Notes','_exFactoryRevision'];
async function cpRows(box){
  const out=[];
  for(let offset=0;;offset+=1000){
    const r=await box.send('/api/read-model/cp/query',{version:1,lang:'tr',query:{version:1,columns:[],base:[],groups:{},today:iso(new Date()),offset,limit:1000,fields:FIELDS}});
    assert.equal(r.status,200,'cp/query '+JSON.stringify(r.body).slice(0,200));
    out.push(...r.body.result.rows);if(r.body.result.rows.length<1000)return out;
  }
}
async function computed(box){
  const r=await box.send('/api/read-model/cp/computed',{version:1,lang:'tr'});
  assert.equal(r.status,200,'cp/computed '+JSON.stringify(r.body).slice(0,200));
  return {rowPatch:r.body.timing&&r.body.timing.service&&r.body.timing.service.rowPatch||null,tuples:new Map(r.body.columns.rows.map(x=>[String(x[0]),JSON.stringify(x)]))};
}
const viaRowPatch=read=>Boolean(read.rowPatch&&read.rowPatch.steps>0);
const line=row=>({model:row['Model Name'],ccode:row['C.Code']});
const strip=row=>{const o={...row};delete o._rowIndex;return o;};

test('CP satır yaması varsayılan: Supp. FOB ve Ex-factory yama yolunda; otomatik Ex-factory 409; sıfırdan tam kurulumla birebir',{timeout:600000},async t=>{
  const box=sandbox();t.after(async()=>{await box.stop();fs.rmSync(box.root,{recursive:true,force:true});});
  await box.start();
  const refresh=await box.send('/api/refresh',{});assert.ok(refresh.status<300,'refresh');
  for(let i=0;i<1200;i++){const st=compactRefreshStatus(await box.get('/api/refresh-status'));if(!st.running){assert.equal(st.error||null,null,'refresh');break;}await delay(250);}
  await box.stop();await box.start();
  await computed(box);
  const rows=await cpRows(box);
  const manual=rows.filter(r=>r['Ex-factory']&&!(r._exFactoryRevision&&r._exFactoryRevision.source==='loading-approval'));
  const automatic=rows.filter(r=>r._exFactoryRevision&&r._exFactoryRevision.source==='loading-approval');
  assert.ok(manual.length>=3,`elle düzenlenebilir Ex-factory satırı var (${manual.length})`);
  assert.ok(automatic.length>=1,'otomatik Ex-factory satırı var');
  const used=new Set();const take=list=>{const row=list.find(r=>!used.has(String(r['Order Code'])));assert.ok(row,'aday');used.add(String(row['Order Code']));return row;};
  const fobRow=take(rows),exRow=take(manual),exBatchRow=take(manual),autoRow=take(automatic);

  // 1) Supp. FOB (gövdede delType yok) → satır yaması yolu (varsayılan; bayrak yok).
  const fob=await box.send('/api/overrides/'+fobRow['Order Code'],{...line(fobRow),notes:{Notes:fobRow.Notes||'',NotesHtml:'',EkNot:'',EkNotHtml:''},suppFob:123.25,suppFobMeta:{source:'manual'}},'PATCH');
  assert.equal(fob.status,200,'Supp. FOB kaydı');
  const afterFob=await computed(box);
  assert.equal(viaRowPatch(afterFob),true,'Supp. FOB sonrası okuma satır yaması yolunda: '+JSON.stringify(afterFob.rowPatch));

  // 2) Elle düzenlenebilir Ex-factory: PATCH ve /batch → 2xx, okuma satır yaması yolunda (segmentler artımlı yeniden kurulur).
  const shift=(row,days)=>{const d=new Date(row['Ex-factory']);d.setDate(d.getDate()+days);return iso(d);};
  const exTarget=shift(exRow,10),exBatchTarget=shift(exBatchRow,-12);
  const ex=await box.send('/api/overrides/'+exRow['Order Code'],{...line(exRow),dates:{exFactory:exTarget}},'PATCH');
  assert.ok(ex.status>=200&&ex.status<300,'Ex-factory PATCH 2xx: '+JSON.stringify(ex.body).slice(0,200));
  const afterEx=await computed(box);
  assert.equal(viaRowPatch(afterEx),true,'Ex-factory sonrası okuma satır yaması yolunda: '+JSON.stringify(afterEx.rowPatch));
  const exBatch=await box.send('/api/overrides/batch',{items:[{orderCode:exBatchRow['Order Code'],patch:{...line(exBatchRow),dates:{exFactory:exBatchTarget}}}]});
  assert.ok(exBatch.status>=200&&exBatch.status<300,'Ex-factory /batch 2xx: '+JSON.stringify(exBatch.body).slice(0,200));
  const afterExBatch=await computed(box);
  assert.equal(viaRowPatch(afterExBatch),true,'Ex-factory /batch sonrası okuma satır yaması yolunda: '+JSON.stringify(afterExBatch.rowPatch));

  // 2b) Del. Type (PATCH, /batch) ve "Kaynağa dön" (delType:null) → satır yaması yolunda (İş 2); doğruluk 4)'te tabanla.
  const delRow=take(rows),delBatchRow=take(rows),revertRow=take(rows);
  for(const [label,send] of [
    ['Del. Type PATCH',()=>box.send('/api/overrides/'+delRow['Order Code'],{...line(delRow),delType:'Uçak'},'PATCH')],
    ['Del. Type /batch',()=>box.send('/api/overrides/batch',{items:[{orderCode:delBatchRow['Order Code'],patch:{...line(delBatchRow),delType:'TIR'}}]})],
    ['Del. Type yaz',()=>box.send('/api/overrides/'+revertRow['Order Code'],{...line(revertRow),delType:'Uçak'},'PATCH')],
    ['Del. Type kaynağa dön',()=>box.send('/api/overrides/'+revertRow['Order Code'],{...line(revertRow),delType:null},'PATCH')],
  ]){
    const response=await send();
    assert.ok(response.status>=200&&response.status<300,label+' 2xx: '+JSON.stringify(response.body).slice(0,200));
    const read=await computed(box);
    assert.equal(viaRowPatch(read),true,label+' sonrası okuma satır yaması yolunda: '+JSON.stringify(read.rowPatch));
  }

  // 3) Otomatik (yükleme onaylı) Ex-factory: 409, değer korunur.
  const auto=await box.send('/api/overrides/'+autoRow['Order Code'],{...line(autoRow),dates:{exFactory:shift(autoRow,5)}},'PATCH');
  assert.equal(auto.status,409);assert.equal(auto.body.code,'AUTOMATIC_DATE_READ_ONLY');

  await delay(1500);
  const session=await computed(box);
  const byId=list=>new Map(list.map(r=>[String(r._id),strip(r)]));
  const live=byId(await cpRows(box));
  const ids=[fobRow,exRow,exBatchRow,autoRow,delRow,delBatchRow,revertRow].map(r=>String(r._id));
  assert.equal(String(live.get(String(exRow._id))['Ex-factory']).slice(0,10),exTarget,'Ex-factory PATCH değeri görünür');
  assert.equal(String(live.get(String(exBatchRow._id))['Ex-factory']).slice(0,10),exBatchTarget,'Ex-factory /batch değeri görünür');
  assert.equal(live.get(String(autoRow._id))['Ex-factory'],autoRow['Ex-factory'],'otomatik Ex-factory korunur');
  assert.equal(Number(live.get(String(fobRow._id))['Supp. FOB']),123.25);

  // 4) Bağımsız taban: projeksiyon önbelleği silinir, yeniden başlatma + sıfırdan tam kurulum.
  await box.stop();
  for(const f of walk(box.root).filter(p=>/page-cache/.test(p)&&/manifest\.json(\.bak)?$/.test(p)))fs.rmSync(path.dirname(f),{recursive:true,force:true});
  await box.start();
  const full=await computed(box);
  assert.equal(viaRowPatch(full),false,'taban tam kurulum');
  const baseline=byId(await cpRows(box));
  for(const id of ids)assert.deepEqual(live.get(id),baseline.get(id),`satır ${id} alan alan sıfırdan tam kurulumla aynı`);
  assert.equal(session.tuples.size,full.tuples.size);
  const tupleDiff=[...full.tuples.keys()].filter(id=>session.tuples.get(id)!==full.tuples.get(id));
  assert.deepEqual(tupleDiff.slice(0,5),[],'tüm satırların karar demeti sıfırdan tam kurulumla aynı');
});
