'use strict';
// V1 (sanal/pilot) ↔ V2 (yeniden yazılmış gerçek nesil) ↔ V3 (önbellek silinip tam kurulum), alan düzeyinde. node kill.js <APP> <SOURCE> <out.json> <on|off>
const L=require('../6f/lib.js'),fs=require('fs'),path=require('path');
const [APP,SOURCE,OUT,ARM]=process.argv.slice(2);
const env=ARM==='off'?{}:{BUYER_LOG_CP_ROWPATCH_LEGACY:'1'};
const rep={arm:ARM,edits:[],diffs:{},errors:[]};const save=()=>fs.writeFileSync(OUT,JSON.stringify(rep,null,1));
const walk=(d,out=[])=>{for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,e.name);if(e.isDirectory())walk(p,out);else out.push(p);}return out;};
(async()=>{
  const app=await L.createApp({APP,source:SOURCE,env,label:'kill'});
  const today=()=>{const d=new Date(),p=n=>String(n).padStart(2,'0');return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`;};
  const req=async(method,u,body)=>{const r=await fetch(app.base+u,{method,headers:{cookie:app.cookie,'Content-Type':'application/json'},...(body!==undefined?{body:JSON.stringify(body)}:{})});const t=await r.text();let j=null;try{j=JSON.parse(t);}catch(_){}return {status:r.status,json:j,text:t.slice(0,200)};};
  rep.retries503=0;const win=async()=>{for(let a=0;;a++){const r=await req('POST','/api/read-model/cp/query',{version:1,lang:'tr',query:{version:1,columns:[],base:[],groups:{},today:today(),offset:0,limit:1000}});if(r.status===503&&a<3){rep.retries503++;continue;}if(r.status!==200)throw Error('q '+r.status+r.text);return r.json.result.rows;}};
  const touched=new Set();const snap=rows=>new Map(rows.filter(r=>touched.has(String(r._id))).map(r=>{const o={...r};delete o._rowIndex;return [String(r._id),o];}));
  const diff=(a,b)=>{const out={};for(const [id,x] of a){const y=b.get(id)||{};const keys=new Set([...Object.keys(x),...Object.keys(y)]);const d=[...keys].filter(k=>JSON.stringify(x[k])!==JSON.stringify(y[k])).map(k=>({k,a:x[k],b:y[k]}));if(d.length)out[id]=d;}return out;};
  try{
    await L.boot(app);await req('POST','/api/read-model/cp/computed',{version:1,lang:'tr'});
    const rows=await win();const pick=i=>rows[(i*397+11)%rows.length];
    const body=(r,x)=>({model:r['Model Name'],ccode:r['C.Code'],notes:{Notes:r.Notes||'',NotesHtml:'',EkNot:r['Ek Not']||'',EkNotHtml:''},delType:r['Del. Type']||undefined,...x});
    const kinds=[
      ['patch suppFob',r=>req('PATCH','/api/overrides/'+r['Order Code'],body(r,{suppFob:111,suppFobMeta:{source:'manual'}}))],
      ['patch delType',r=>req('PATCH','/api/overrides/'+r['Order Code'],body(r,{delType:r['Del. Type']==='Uçak'?'Gemi':'Uçak'}))],
      ['patch notes',r=>req('PATCH','/api/overrides/'+r['Order Code'],body(r,{notes:{Notes:'pilot not',NotesHtml:'',EkNot:'',EkNotHtml:''}}))],
      ['batch suppFob+delType',r=>req('POST','/api/overrides/batch',{items:[{orderCode:r['Order Code'],patch:{model:r['Model Name'],ccode:r['C.Code'],suppFob:222,suppFobMeta:{source:'manual'},delType:'Kamyon'}}]})],
      ['batch-suppfob',r=>req('POST','/api/overrides/batch-suppfob',{items:[{orderCode:r['Order Code'],model:r['Model Name'],ccode:r['C.Code'],suppFob:333}]})],
      ['patch importance',r=>req('PATCH','/api/overrides/'+r['Order Code'],{model:r['Model Name'],ccode:r['C.Code'],importance:'regular'})],
      ['patch importance+suppFob',r=>req('PATCH','/api/overrides/'+r['Order Code'],{model:r['Model Name'],ccode:r['C.Code'],importance:'regular',suppFob:444,suppFobMeta:{source:'manual'}})],
    ];
    for(const [i,[name,fn]] of kinds.entries()){const r=pick(i);touched.add(String(r._id));const s=await fn(r);rep.edits.push({name,id:String(r._id),code:r['Order Code'],status:s.status,text:s.status===200?'':s.text});}
    save();
    const V1=snap(await win());await L.delay(20000);
    const c=await req('POST','/api/read-model/cp/computed',{version:1,lang:'tr'});rep.v2Timing=c.json&&c.json.timing&&c.json.timing.service;
    const V2=snap(await win());
    await app.stop();
    const files=walk(app.root).filter(p=>/manifest/.test(path.basename(p))&&/projection|page/i.test(p));rep.cacheFiles=files.map(f=>path.relative(app.root,f));
    for(const f of files)fs.rmSync(path.dirname(f),{recursive:true,force:true});
    await app.start();await app.login();await req('POST','/api/read-model/cp/computed',{version:1,lang:'tr'});
    const V3=snap(await win());
    rep.diffs={v1_v2:diff(V1,V2),v2_v3:diff(V2,V3),v1_v3:diff(V1,V3)};
  }catch(e){rep.errors.push(String(e.stack||e).slice(0,500));}
  finally{save();await app.stop();}
})();
