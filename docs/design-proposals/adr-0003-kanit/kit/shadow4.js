'use strict';
// #1236 bağımsız gölge (6j/shadow3.js + #1241/#1243 koruma kontrolleri). node shadow4.js <APP> <SOURCE> <out.json> <on|off>
// Taban: projeksiyon önbelleği silinip sıfırdan tam kurulum (V3/T3). Aşama 1 = pilot (artımlı güvenli) kayıtlar → V1/T1.
// Aşama 2 = U2 (mod2) Del. Type, U1 Ex-factory; U1 aynı satıra Supp. FOB + not (gövdede delType yok) → V2/T2.
// Kontroller: V1↔V3 (aşama-1 satırları alan alan), T1↔T3 (tüm satırlar, aşama-2 satırları hariç), V2↔V3, T2↔T3 (tüm satırlar),
// Del. Type / Ex-factory sonrası okuma rowPatch.steps (pilot yolu) içermemeli, U2'nin Del. Type'ı U1 kayıtlarından sonra korunmalı.
const L=require('./lib.js'),fs=require('fs'),path=require('path');
const [APP,SOURCE,OUT,ARM]=process.argv.slice(2);
const env=ARM==='on'?{BUYER_LOG_CP_ROWPATCH_LEGACY:'1'}:{};
const rep={arm:ARM,runtime:{exec:process.execPath,node:process.versions.node,electron:process.versions.electron||null,NODE_OPTIONS:process.env.NODE_OPTIONS||''},edits:[],reads:[],checks:{},errors:[]};
const save=()=>fs.writeFileSync(OUT,JSON.stringify(rep,null,1));
const walk=(d,out=[])=>{for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,e.name);if(e.isDirectory())walk(p,out);else out.push(p);}return out;};
const iso=d=>{const p=n=>String(n).padStart(2,'0');return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`;};
(async()=>{
  const app=await L.createApp({APP,source:SOURCE,env,label:'sh4'});let cookieB='';
  const req=async(method,u,body,cookie=app.cookie)=>{for(let a=0;;a++){const r=await fetch(app.base+u,{method,headers:{cookie,'Content-Type':'application/json'},...(body!==undefined?{body:JSON.stringify(body)}:{})});const t=await r.text();if(r.status===503&&a<8&&method==='POST'&&/read-model/.test(u)){await L.delay(500);continue;}let j=null;try{j=JSON.parse(t);}catch(_){}return {status:r.status,json:j,text:t.slice(0,200),retries:a};}};
  const page=async off=>{const r=await req('POST','/api/read-model/cp/query',{version:1,lang:'tr',query:{version:1,columns:[],base:[],groups:{},today:iso(new Date()),offset:off,limit:1000}});if(r.status!==200)throw Error('cp/query '+r.status+r.text);return r.json.result.rows;};
  const win=async()=>{const out=[];for(let off=0;off<3000;off+=1000)out.push(...await page(off));return out;};
  const computed=async label=>{const r=await req('POST','/api/read-model/cp/computed',{version:1,lang:'tr'});if(r.status!==200)throw Error('computed '+r.status);const t=r.json.timing||{};
    rep.reads.push({label,rowPatch:t.service&&t.service.rowPatch||null,datasetRowPatch:t.rowPatch||null,lease:t.service&&t.service.leaseMs,reloaded:t.datasetReloaded,retries:r.retries});save();return new Map(r.json.columns.rows.map(x=>[String(x[0]),JSON.stringify(x)]));};
  const touched=new Map();const tag=(r,k)=>touched.set(String(r._id),touched.has(String(r._id))?touched.get(String(r._id))+' + '+k:k);
  const snap=rows=>new Map(rows.filter(r=>touched.has(String(r._id))).map(r=>{const o={...r};delete o._rowIndex;return [String(r._id),o];}));
  const diff=(a,b)=>{const out={};for(const [id,x] of a){const y=b.get(id);if(!y){out[id+':'+touched.get(id)]=['<yok>'];continue;}const d=[...new Set([...Object.keys(x),...Object.keys(y)])].filter(k=>JSON.stringify(x[k])!==JSON.stringify(y[k]));if(d.length)out[id+':'+touched.get(id)]=d.map(k=>/^_logistic/.test(k)?k:`${k}=${JSON.stringify(x[k])}→${JSON.stringify(y[k])}`);}return out;};
  const pilotHit=r=>Boolean(r&&r.rowPatch&&r.rowPatch.steps>0);
  try{
    await L.boot(app);
    await req('POST','/api/users',{username:'mod2',displayName:'Mod 2',title:'T',password:'synthetic-startup-only-456',systemRole:'moderator',reason:'doğrulama',confirmCritical:true});
    {const lb=await fetch(app.base+'/api/user-login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'mod2',password:'synthetic-startup-only-456',newPassword:'synthetic-startup-only-456'})});cookieB=String(lb.headers.get('set-cookie')||'').split(';')[0];rep.mod2Login=lb.status;}
    await computed('open');
    const rows=await win();const pick=i=>rows[(i*397+11)%rows.length];
    const body=(r,x)=>({model:r['Model Name'],ccode:r['C.Code'],notes:{Notes:r.Notes||'',NotesHtml:'',EkNot:r['Ek Not']||'',EkNotHtml:''},...x}); // #1243 sonrası istemci: delType yalnız açık niyetle
    const E=async(kind,r,fn)=>{tag(r,kind);const s=await fn(r);rep.edits.push({kind,id:String(r._id),status:s.status,text:s.status===200?'':s.text});save();await L.delay(400);return s;};
    // Aşama 1: pilot yoluna giren (artımlı güvenli) kayıtlar
    await E('Supp. FOB PATCH (delType yok)',pick(0),r=>req('PATCH','/api/overrides/'+r['Order Code'],body(r,{suppFob:123.4,suppFobMeta:{source:'manual'}})));
    await E('not /batch',pick(1),r=>req('POST','/api/overrides/batch',{items:[{orderCode:r['Order Code'],patch:{model:r['Model Name'],ccode:r['C.Code'],notes:{Notes:'gölge not',NotesHtml:'gölge not'}}}]}));
    {const a=pick(2),b=pick(3);tag(a,'/batch-suppfob 2 satır');tag(b,'/batch-suppfob 2 satır');const s=await req('POST','/api/overrides/batch-suppfob',{items:[a,b].map((r,k)=>({orderCode:r['Order Code'],model:r['Model Name'],ccode:r['C.Code'],suppFob:200+k}))});rep.edits.push({kind:'/batch-suppfob',status:s.status});}
    await E('POST /rows not',pick(4),r=>req('POST','/api/overrides/rows',{items:[{orderCode:r['Order Code'],patch:{model:r['Model Name'],ccode:r['C.Code'],notes:{Notes:'satır kaydı notu'}},base:{notes:{Notes:r.Notes||''}}}]}));
    await E('Retail PATCH',pick(5),r=>{const d=new Date(r['Retail Date']||Date.now());d.setDate(d.getDate()+21);return req('PATCH','/api/overrides/'+r['Order Code'],{model:r['Model Name'],ccode:r['C.Code'],dates:{retailDate:iso(d)}});});
    await E('In-Store PATCH',pick(6),r=>{const d=new Date(r['In-Store (Model Budget)']||Date.now());d.setDate(d.getDate()+14);return req('PATCH','/api/overrides/'+r['Order Code'],{model:r['Model Name'],ccode:r['C.Code'],dates:{inStoreDate:iso(d)}});});
    await E('Supp. FOB + not aynı satır ardışık',pick(7),async r=>{await req('PATCH','/api/overrides/'+r['Order Code'],body(r,{suppFob:77.7,suppFobMeta:{source:'manual'}}));return req('POST','/api/overrides/batch',{items:[{orderCode:r['Order Code'],patch:{model:r['Model Name'],ccode:r['C.Code'],notes:{Notes:'ardışık',NotesHtml:'ardışık'}}}]});});
    const T1=await computed('pilot T1'),V1=snap(await win());rep.pilotRead=rep.reads[rep.reads.length-1];
    // Aşama 2a: U2 Del. Type (PATCH, açık niyet) → U1 okuması pilot yoluna girmemeli
    // Del. Type satırı: tüm lojistik segmentleri üretim olan satır (Del. Type delmap'ten türer; gerçekleşmiş IAS parsiyeli kaynaktan gelir).
    const segQ=await req('POST','/api/read-model/cp/query',{version:1,lang:'tr',query:{version:1,columns:[],base:[],groups:{},today:iso(new Date()),offset:0,limit:1000,fields:['_id','Order Code','Model Name','C.Code','Del. Type','Ex-factory','_logisticSegments','_exFactoryRevision']}});
    const segRows=segQ.status===200?segQ.json.result.rows:[];const prodOnly=segRows.filter(r=>Array.isArray(r._logisticSegments)&&r._logisticSegments.length&&r._logisticSegments.every(s=>s.kind==='production')&&r['Del. Type']==='Gemi'&&!touched.has(String(r._id)));
    rep.segmentField=segRows.some(r=>Array.isArray(r._logisticSegments));
    const rD=prodOnly.length?rows.find(r=>String(r._id)===String(prodOnly[3%prodOnly.length]._id))||pick(8):pick(8),newDel=rD['Del. Type']==='Uçak'?'Gemi':'Uçak';rep.delTypeRow={id:String(rD._id),before:rD['Del. Type'],u2:newDel,prodOnly:prodOnly.length>0};
    const ovFile=path.join(app.root,'data','overrides.json');const delKey=r=>Object.keys((JSON.parse(fs.readFileSync(ovFile,'utf8')).delmap)||{}).filter(k=>k.startsWith(String(r['Order Code'])+'|'));
    const delStored=r=>{const m=JSON.parse(fs.readFileSync(ovFile,'utf8')).delmap||{};return Object.fromEntries(delKey(r).map(k=>[k,m[k]]));};
    await E('U2 Del. Type PATCH (tam yol)',rD,r=>req('PATCH','/api/overrides/'+r['Order Code'],{model:r['Model Name'],ccode:r['C.Code'],delType:newDel},cookieB));
    await L.delay(1500);await computed('after U2 Del. Type');rep.checks.delTypeReadPilot=pilotHit(rep.reads[rep.reads.length-1]);
    // Aşama 2b: U1 Ex-factory PATCH → pilot yoluna girmemeli
    rep.delTypeStoredAfterU2=delStored(rD);
    // Ex-factory: otomatik (yükleme onayı) olmayan ilk aday; 409 AUTOMATIC_DATE_READ_ONLY adaylar atlanır (veri değişmez).
    let rX=null;rep.exFactorySkipped=[];
    const allSeg=[];for(let off=0;off<30000;off+=1000){const r=await req('POST','/api/read-model/cp/query',{version:1,lang:'tr',query:{version:1,columns:[],base:[],groups:{},today:iso(new Date()),offset:off,limit:1000,fields:['_id','Order Code','Model Name','C.Code','Ex-factory','_exFactoryRevision']}});if(r.status!==200)break;allSeg.push(...r.json.result.rows);if(r.json.result.rows.length<1000)break;}
    rep.exFactoryScan={rows:allSeg.length,automatic:allSeg.filter(r=>r._exFactoryRevision&&r._exFactoryRevision.source==='loading-approval').length,withEx:allSeg.filter(r=>r['Ex-factory']).length};
    const exCand=allSeg.filter(r=>r['Ex-factory']&&!(r._exFactoryRevision&&r._exFactoryRevision.source==='loading-approval'));rep.exFactoryCandidates=exCand.length;
    for(let k=0;k<Math.min(60,exCand.length)&&!rX;k++){const c0=exCand[(k*37+5)%exCand.length];const c=rows.find(r=>String(r._id)===String(c0._id))||c0;if(touched.has(String(c._id))||String(c._id)===String(rD._id))continue;const d=new Date(c['Ex-factory']||Date.now());d.setDate(d.getDate()+10);
      const s=await req('PATCH','/api/overrides/'+c['Order Code'],{model:c['Model Name'],ccode:c['C.Code'],dates:{exFactory:iso(d)}});
      if(s.status===200){rX=c;tag(c,'U1 Ex-factory PATCH (tam yol)');rep.exFactoryRow={id:String(c._id),before:c['Ex-factory'],target:iso(d)};rep.edits.push({kind:'U1 Ex-factory PATCH (tam yol)',id:String(c._id),status:200});}
      else rep.exFactorySkipped.push({id:String(c._id),status:s.status,code:s.json&&s.json.code});}
    if(!rX){rep.exFactoryRow=null;rep.exFactoryNote='30k fixture: elle düzenlenebilir Ex-factory satırı yok (tümü yükleme onayı); sunucu yazımdan önce 409 AUTOMATIC_DATE_READ_ONLY döner';}save();
    if(rX){await L.delay(1500);await computed('after Ex-factory');rep.checks.exFactoryReadPilot=pilotHit(rep.reads[rep.reads.length-1]);}
    // Aşama 2c: U1 aynı Del. Type satırına Supp. FOB + not (delType göndermez) → U2'nin Del. Type'ı korunmalı
    await E('U1 Supp. FOB (U2 Del. Type satırı)',rD,r=>req('PATCH','/api/overrides/'+r['Order Code'],body(r,{suppFob:55.5,suppFobMeta:{source:'manual'}})));
    await E('U1 not /batch (U2 Del. Type satırı)',rD,r=>req('POST','/api/overrides/batch',{items:[{orderCode:r['Order Code'],patch:{model:r['Model Name'],ccode:r['C.Code'],notes:{Notes:'u1 not',NotesHtml:'u1 not'}}}]}));
    rep.delTypeStoredAfterU1=delStored(rD);
    await L.delay(25000);const T2=await computed('T2'),V2=snap(await win());
    rep.checks.delTypeAfterU1Saves=V2.get(String(rD._id))&&V2.get(String(rD._id))['Del. Type'];
    rep.checks.exFactoryAfter=rX&&V2.get(String(rX._id))&&V2.get(String(rX._id))['Ex-factory'];
    // Bağımsız taban: projeksiyon önbelleği silinir, tam kurulum
    await app.stop();const removed=[];for(const f of walk(app.root).filter(p=>/page-cache/.test(p)&&/manifest\.json(\.bak)?$/.test(p))){removed.push(path.relative(app.root,path.dirname(f)));fs.rmSync(path.dirname(f),{recursive:true,force:true});}
    rep.cacheRemoved=removed;
    await app.start();await app.login();const T3=await computed('V3 full'),V3=snap(await win());
    const later=new Set([String(rD._id),...(rX?[String(rX._id)]:[])]);
    const phase1=[...touched.keys()].filter(id=>!later.has(id));
    const tdiff=(a,b,ids)=>ids.filter(id=>a.get(id)!==b.get(id)).map(id=>id+':'+touched.get(id));
    const allDiff=(a,b,skip)=>[...b.keys()].filter(id=>!skip.has(id)&&a.get(id)!==b.get(id)).length;
    Object.assign(rep.checks,{
      v1_v3_phase1:diff(new Map([...V1].filter(([id])=>phase1.includes(id))),V3),
      v2_v3_all:diff(V2,V3),
      t1_t3_phase1:tdiff(T1,T3,phase1),
      t1_t3_allRows_exceptLater:allDiff(T1,T3,later),
      t2_t3_allRows:allDiff(T2,T3,new Set()),
      delTypeV3:V3.get(String(rD._id))&&V3.get(String(rD._id))['Del. Type'],
      totalRows:T3.size,pilotT1:pilotHit(rep.pilotRead)});
  }catch(e){rep.errors.push(String(e.stack||e).slice(0,600));}
  finally{save();await app.stop();}
})();
