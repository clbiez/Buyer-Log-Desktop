'use strict';
// Pilot bağımsız gölge: pilot sonucu (V1/T1, sanal yol) ↔ V3/T3 (projeksiyon önbelleği silinip tam kurulum). node shadow3.js <APP> <SOURCE> <out.json> <on|off>
const L=require('../6f/lib.js'),fs=require('fs'),path=require('path');
const [APP,SOURCE,OUT,ARM]=process.argv.slice(2);
const env=ARM==='on'?{BUYER_LOG_CP_ROWPATCH_LEGACY:'1'}:{};
const rep={arm:ARM,edits:[],reads:[],checks:{},errors:[]};const save=()=>fs.writeFileSync(OUT,JSON.stringify(rep,null,1));
const walk=(d,out=[])=>{for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,e.name);if(e.isDirectory())walk(p,out);else out.push(p);}return out;};
const iso=d=>{const p=n=>String(n).padStart(2,'0');return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`;};
(async()=>{
  const app=await L.createApp({APP,source:SOURCE,env,label:'sh3'});
  const req=async(method,u,body)=>{for(let a=0;;a++){const r=await fetch(app.base+u,{method,headers:{cookie:app.cookie,'Content-Type':'application/json'},...(body!==undefined?{body:JSON.stringify(body)}:{})});const t=await r.text();if(r.status===503&&a<5&&method==='POST'&&/read-model/.test(u)){await L.delay(500);continue;}let j=null;try{j=JSON.parse(t);}catch(_){}return {status:r.status,json:j,text:t.slice(0,200),retries:a};}};
  const page=async off=>{const r=await req('POST','/api/read-model/cp/query',{version:1,lang:'tr',query:{version:1,columns:[],base:[],groups:{},today:iso(new Date()),offset:off,limit:1000}});if(r.status!==200)throw Error('cp/query '+r.status+r.text);return r.json.result.rows;};
  const win=async()=>{const out=[];for(let off=0;off<3000;off+=1000)out.push(...await page(off));return out;};
  const computed=async()=>{const r=await req('POST','/api/read-model/cp/computed',{version:1,lang:'tr'});if(r.status!==200)throw Error('computed '+r.status);const t=r.json.timing||{};rep.reads.push({rowPatch:t.service&&t.service.rowPatch,lease:t.service&&t.service.leaseMs,retries:r.retries});return new Map(r.json.columns.rows.map(x=>[String(x[0]),JSON.stringify(x)]));};
  const touched=new Map();const tag=(r,k)=>touched.set(String(r._id),k);
  const snap=rows=>new Map(rows.filter(r=>touched.has(String(r._id))).map(r=>{const o={...r};delete o._rowIndex;return [String(r._id),o];}));
  const diff=(a,b)=>{const out={};for(const [id,x] of a){const y=b.get(id);if(!y){out[id+':'+touched.get(id)]=['<yok>'];continue;}const d=[...new Set([...Object.keys(x),...Object.keys(y)])].filter(k=>JSON.stringify(x[k])!==JSON.stringify(y[k]));if(d.length)out[id+':'+touched.get(id)]=d.map(k=>/^_logistic/.test(k)?k:`${k}=${JSON.stringify(x[k])}→${JSON.stringify(y[k])}`);}return out;};
  try{
    await L.boot(app);await computed();
    const rows=await win();const pick=i=>rows[(i*397+11)%rows.length];
    const body=(r,x)=>({model:r['Model Name'],ccode:r['C.Code'],notes:{Notes:r.Notes||'',NotesHtml:'',EkNot:r['Ek Not']||'',EkNotHtml:''},...x}); // #1243 sonrası istemci: delType yalnız açık niyetle
    const E=async(kind,r,fn)=>{tag(r,kind);const s=await fn(r);rep.edits.push({kind,id:String(r._id),status:s.status,text:s.status===200?'':s.text});save();await L.delay(400);};
    // Aşama 1: pilot yoluna giren (artımlı güvenli) kayıtlar
    await E('Supp. FOB PATCH (delType yok)',pick(0),r=>req('PATCH','/api/overrides/'+r['Order Code'],body(r,{suppFob:123.4,suppFobMeta:{source:'manual'}})));
    await E('not /batch',pick(1),r=>req('POST','/api/overrides/batch',{items:[{orderCode:r['Order Code'],patch:{model:r['Model Name'],ccode:r['C.Code'],notes:{Notes:'gölge not',NotesHtml:'gölge not'}}}]}));
    {const a=pick(2),b=pick(3);tag(a,'/batch-suppfob 2 satır');tag(b,'/batch-suppfob 2 satır');const s=await req('POST','/api/overrides/batch-suppfob',{items:[a,b].map((r,k)=>({orderCode:r['Order Code'],model:r['Model Name'],ccode:r['C.Code'],suppFob:200+k}))});rep.edits.push({kind:'/batch-suppfob',status:s.status});}
    await E('POST /rows not',pick(4),r=>req('POST','/api/overrides/rows',{items:[{orderCode:r['Order Code'],patch:{model:r['Model Name'],ccode:r['C.Code'],notes:{Notes:'satır kaydı notu'}},base:{notes:{Notes:r.Notes||''}}}]}));
    await E('Retail PATCH',pick(5),r=>{const d=new Date(r['Retail Date']||Date.now());d.setDate(d.getDate()+21);return req('PATCH','/api/overrides/'+r['Order Code'],{model:r['Model Name'],ccode:r['C.Code'],dates:{retailDate:iso(d)}});});
    await E('In-Store PATCH',pick(6),r=>{const d=new Date(r['In-Store (Model Budget)']||Date.now());d.setDate(d.getDate()+14);return req('PATCH','/api/overrides/'+r['Order Code'],{model:r['Model Name'],ccode:r['C.Code'],dates:{inStoreDate:iso(d)}});});
    await E('Supp. FOB + not aynı satır ardışık',pick(7),async r=>{await req('PATCH','/api/overrides/'+r['Order Code'],body(r,{suppFob:77.7,suppFobMeta:{source:'manual'}}));return req('POST','/api/overrides/batch',{items:[{orderCode:r['Order Code'],patch:{model:r['Model Name'],ccode:r['C.Code'],notes:{Notes:'ardışık',NotesHtml:'ardışık'}}}]});});
    const T1=await computed(),V1=snap(await win());rep.pilotRead=rep.reads[rep.reads.length-1];
    // Aşama 2: tam kuruluma düşen (Del. Type) — pilot sonucundan SONRA
    await E('Del. Type POST /rows (tam yol)',pick(8),r=>req('POST','/api/overrides/rows',{items:[{orderCode:r['Order Code'],patch:{model:r['Model Name'],ccode:r['C.Code'],delType:r['Del. Type']==='Uçak'?'Gemi':'Uçak'},base:{delType:null}}]}));
    await L.delay(25000);const T2=await computed(),V2=snap(await win());
    // Bağımsız taban: projeksiyon önbelleği silinir, tam kurulum
    await app.stop();for(const f of walk(app.root).filter(p=>/page-cache/.test(p)&&/manifest\.json(\.bak)?$/.test(p)))fs.rmSync(path.dirname(f),{recursive:true,force:true});
    await app.start();await app.login();const T3=await computed(),V3=snap(await win());
    const phase1=[...touched.entries()].filter(([,k])=>!/Del\. Type/.test(k)).map(([id])=>id);
    const tdiff=(a,b,ids)=>ids.filter(id=>a.get(id)!==b.get(id)).map(id=>id+':'+touched.get(id));
    const allDiff=(a,b,skip)=>[...b.keys()].filter(id=>!skip.has(id)&&a.get(id)!==b.get(id)).length;
    const later=new Set([...touched.entries()].filter(([,k])=>/Del\. Type/.test(k)).map(([id])=>id));
    rep.checks={
      v1_v3_phase1:diff(new Map([...V1].filter(([id])=>phase1.includes(id))),V3),
      v2_v3_all:diff(V2,V3),
      t1_t3_phase1:tdiff(T1,T3,phase1),
      t1_t3_allRows_exceptLater:allDiff(T1,T3,later),
      t2_t3_allRows:allDiff(T2,T3,new Set()),
      totalRows:T3.size};
  }catch(e){rep.errors.push(String(e.stack||e).slice(0,600));}
  finally{save();await app.stop();}
})();
