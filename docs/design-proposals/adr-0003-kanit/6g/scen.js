'use strict';
// Gerçek sunucu senaryoları (bayrak açık; repo dışı). node scen.js <APP> <SOURCE> <out.json>
const L=require('../6f/lib.js'),fs=require('fs'),path=require('path'),crypto=require('crypto');
const [APP,SOURCE,OUT]=process.argv.slice(2);
const DIR=path.dirname(path.resolve(OUT)),CTL=path.join(DIR,'ctl.json'),HLOG=path.join(DIR,'hook.log');
fs.writeFileSync(CTL,'{}');try{fs.unlinkSync(HLOG);}catch(_){}
const env={BUYER_LOG_CP_ROWPATCH_LEGACY:'1',HOOK_CTL:CTL,HOOK_LOG:HLOG,NODE_OPTIONS:'-r '+path.join(__dirname,'hook.js')};
const setCtl=o=>{fs.writeFileSync(CTL,JSON.stringify(o));return L.delay(600);};
const today=()=>{const d=new Date(Date.now()+(JSON.parse(fs.readFileSync(CTL,'utf8')).clockOffsetMs||0)),p=n=>String(n).padStart(2,'0');return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`;};
const rep={steps:[],checks:[],errors:[]};const save=()=>fs.writeFileSync(OUT,JSON.stringify(rep,null,1));
(async()=>{
  const app=await L.createApp({APP,source:SOURCE,env,label:'scen'});
  const sessions={};
  const req=async(who,method,u,body,headers={})=>{const t=performance.now();const r=await fetch(app.base+u,{method,headers:{cookie:sessions[who],'Content-Type':'application/json',...headers},...(body!==undefined?{body:JSON.stringify(body)}:{})});const text=await r.text();let json=null;try{json=JSON.parse(text);}catch(_){}
    return {ms:Math.round(performance.now()-t),status:r.status,json,text:text.slice(0,200),etag:r.headers.get('etag')};};
  const login=async(who,userId,password)=>{const r=await fetch(app.base+'/api/user-login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(userId==='moderator'?{userId,password,newPassword:password}:{username:userId,password,newPassword:password})});if(!r.ok)throw Error('login '+who+' '+r.status+' '+(await r.text()).slice(0,200));sessions[who]=String(r.headers.get('set-cookie')||'').split(';')[0];};
  const st={tuples:new Map(),token:null};
  const computed=async(who='A')=>{const r=await req(who,'POST','/api/read-model/cp/computed',{version:1,lang:'tr',...(st.token?{since:st.token}:{})});
    if(r.status!==200)return {status:r.status,code:r.json&&r.json.code};const c=r.json.columns;if(!c.delta)st.tuples.clear();for(const row of c.rows)st.tuples.set(String(row[0]),JSON.stringify(row));for(const id of c.removed||[])st.tuples.delete(String(id));st.token=c.token;
    const t=r.json.timing||{};return {status:200,ms:r.ms,delta:c.delta,rows:c.rows.length,inc:t.phases&&t.phases.incremental||null,decisionMs:t.phases&&t.phases.decisionMs,hostMs:t.phases&&t.phases.hostMs,rowPatch:t.service&&t.service.rowPatch||null,lease:t.service&&t.service.leaseMs};};
  const digest=()=>crypto.createHash('sha1').update([...st.tuples.keys()].sort().map(id=>st.tuples.get(id)).join('\n')).digest('hex');
  const window_=async(who='A')=>{const r=await req(who,'POST','/api/read-model/cp/query',{version:1,lang:'tr',query:{version:1,columns:[],base:[],groups:{},today:today(),offset:0,limit:1000}});if(r.status!==200)throw Error('cp/query '+r.status+' '+r.text);return r.json.result.rows;};
  const strip=row=>{const o={...row};delete o._rowIndex;return JSON.stringify(o,Object.keys(o).sort());};
  const body=(row,extra)=>({model:row['Model Name'],ccode:row['C.Code'],notes:{Notes:row.Notes||'',NotesHtml:'',EkNot:row['Ek Not']||'',EkNotHtml:''},delType:row['Del. Type']||undefined,...extra});
  const touched=new Set();
  async function step(name,fn){const t=Date.now();let out;try{out=await fn();}catch(e){out={error:String(e.stack||e).slice(0,400)};rep.errors.push(name+': '+out.error);}rep.steps.push({name,ms:Date.now()-t,...out});save();console.log(name,JSON.stringify(out).slice(0,400));return out;}
  // Kontrol noktası: sunucuyu yeniden başlat (bellek günlüğü ve işçi gider) → soğuk tam hesap = karşılaştırma tabanı.
  async function checkpoint(name,{kill=false}={}){
    await L.delay(kill?0:15000);
    const before={digest:digest(),count:st.tuples.size,rows:new Map((await window_()).filter(r=>touched.has(String(r._id))).map(r=>[String(r._id),strip(r)]))};
    await app.stop(kill?'SIGKILL':'SIGTERM');await app.start();await login('A','moderator','synthetic-startup-only-123');
    st.token=null;const cold=await computed();const afterRows=new Map((await window_()).filter(r=>touched.has(String(r._id))).map(r=>[String(r._id),strip(r)]));
    const rowDiff=[...before.rows].filter(([id,v])=>afterRows.get(id)!==v).map(([id])=>id);
    const res={name,kill,pilotDigest:before.digest,coldDigest:digest(),equal:before.digest===digest(),count:before.count,coldStatus:cold.status,touched:touched.size,rowDiff};
    rep.checks.push(res);save();console.log('CHECK',JSON.stringify(res));
    await login('B','mod2','synthetic-startup-only-456');return res;}
  try{
    await L.boot(app);
    // İkinci kullanıcı (moderatör) ve yetkisiz alıcı.
    sessions.A=app.cookie;
    const mk=await req('A','POST','/api/users',{username:'mod2',displayName:'Mod 2',title:'T',password:'synthetic-startup-only-456',systemRole:'moderator',reason:'pilot test ikinci kullanıcı',confirmCritical:true});
    const me=await req('A','GET','/api/current-user');const meId=me.json&&((me.json.user&&me.json.user.id)||(me.json.profile&&me.json.profile.id)||me.json.id);
    const mk2=await req('A','POST','/api/users',{username:'buyer3',displayName:'Buyer 3',title:'T',password:'synthetic-startup-only-789',systemRole:'buyer',managerId:meId});
    rep.users={mod2:mk.status,buyer3:mk2.status,meId:Boolean(meId),mkText:mk.status===200||mk.status===201?'':mk.text,mk2Text:mk2.status<300?'':mk2.text};save();
    await login('B','mod2','synthetic-startup-only-456');
    try{await login('C','buyer3','synthetic-startup-only-789');}catch(e){rep.errors.push('login C: '+e.message);}
    await step('P0 A açılış',async()=>({open:await computed()}));
    let rows=await window_();const byId=new Map(rows.map(r=>[String(r._id),r]));
    const pick=i=>rows[(i*397+11)%rows.length];
    // Opsiyonu paylaşan satırlar (FIELDS optionId = indeks 10).
    const byOpt=new Map();for(const [id,json] of st.tuples){const opt=JSON.parse(json)[10];if(!opt||!byId.has(id))continue;if(!byOpt.has(opt))byOpt.set(opt,[]);byOpt.get(opt).push(id);}
    const shared=[...byOpt.values()].find(ids=>ids.length>=2);
    const edit=async(who,row,extra,headers)=>{touched.add(String(row._id));return req(who,'PATCH','/api/overrides/'+row['Order Code'],body(row,extra),headers);};
    await step('P1 ardışık 3 kayıt (her biri okuma)',async()=>{const out=[];for(let i=0;i<3;i++){const s=await edit('A',pick(i),{suppFob:100+i,suppFobMeta:{source:'manual'}});out.push({save:s.status,read:await computed()});}return {out};});
    await step('P2a /batch (5 satır, 2 Del. Type değişimi)',async()=>{const items=[3,4,5,6,7].map((i,k)=>{const r=pick(i);touched.add(String(r._id));return {orderCode:r['Order Code'],patch:{model:r['Model Name'],ccode:r['C.Code'],suppFob:200+k,suppFobMeta:{source:'manual'},...(k<2?{delType:r['Del. Type']==='Uçak'?'Gemi':'Uçak'}:{})}};});
      const s=await req('A','POST','/api/overrides/batch',{items});return {save:s.status,text:s.status===200?'':s.text,read:await computed()};});
    await step('P2b /batch-suppfob (5 satır)',async()=>{const items=[8,9,10,11,12].map((i,k)=>{const r=pick(i);touched.add(String(r._id));return {orderCode:r['Order Code'],model:r['Model Name'],ccode:r['C.Code'],suppFob:300+k};});
      const s=await req('A','POST','/api/overrides/batch-suppfob',{items});return {save:s.status,text:s.status===200?'':s.text,read:await computed()};});
    await step('P2c aynı opsiyon: biri düzenlenir (Del. Type)',async()=>{if(!shared)return {skip:'opsiyon paylaşan satır yok'};const r=byId.get(shared[0]);shared.forEach(id=>touched.add(id));
      const s=await edit('A',r,{delType:r['Del. Type']==='Kamyon'?'Gemi':'Kamyon'});return {save:s.status,ids:shared.length,read:await computed()};});
    await step('P3a importance tek başına',async()=>{const r=pick(13);touched.add(String(r._id));const s=await req('A','PATCH','/api/overrides/'+r['Order Code'],{model:r['Model Name'],ccode:r['C.Code'],importance:'regular'});return {save:s.status,text:s.status===200?'':s.text,read:await computed()};});
    await step('P3b importance + Supp. FOB aynı kayıtta',async()=>{const r=pick(14);touched.add(String(r._id));const s=await req('A','PATCH','/api/overrides/'+r['Order Code'],{model:r['Model Name'],ccode:r['C.Code'],importance:'regular',suppFob:444,suppFobMeta:{source:'manual'}});return {save:s.status,text:s.status===200?'':s.text,read:await computed()};});
    await step('P3c importance sonrası başka alan',async()=>{const s=await edit('A',pick(13),{suppFob:445,suppFobMeta:{source:'manual'}});return {save:s.status,read:await computed()};});
    await step('P4a 409 bayat revizyon',async()=>{const r=pick(15);const s=await req('A','PATCH','/api/overrides/'+r['Order Code'],body(r,{suppFob:555,suppFobMeta:{source:'manual'}}),{'If-Match':'"1"'});return {save:s.status,code:s.json&&s.json.code,read:await computed()};});
    await step('P4b yetkisiz kullanıcı',async()=>{if(!sessions.C)return {skip:'C oturumu yok'};const r=pick(16);const s=await req('C','PATCH','/api/overrides/'+r['Order Code'],body(r,{suppFob:556,suppFobMeta:{source:'manual'}}));return {save:s.status,code:s.json&&s.json.code,read:await computed()};});
    await step('P5 başka kullanıcı (B) Supp. FOB + Del. Type',async()=>{const r1=pick(17),r2=pick(18);touched.add(String(r1._id));touched.add(String(r2._id));const s1=await req('B','PATCH','/api/overrides/'+r1['Order Code'],body(r1,{suppFob:666,suppFobMeta:{source:'manual'}}));
      const s2=await req('B','PATCH','/api/overrides/'+r2['Order Code'],body(r2,{delType:r2['Del. Type']==='Uçak'?'Gemi':'Uçak'}));return {saves:[s1.status,s2.status],read:await computed()};});
    await step('P5b A kendi kaydı (B sonrası)',async()=>{const s=await edit('A',pick(19),{suppFob:667,suppFobMeta:{source:'manual'}});return {save:s.status,read:await computed()};});
    await step('P6 yapılandırma: transit kuralı',async()=>{const g=await req('A','GET','/api/transit-rules');const rules=(g.json&&g.json.rules)||[];const next=rules.length?rules.map((r,i)=>i?r:{...r,days:Number(r.days||0)+9}):[{id:'pilot-t',seasons:[],countries:[],delType:'',days:21,exfStart:'',exfEnd:''}];
      const p=await req('A','PUT','/api/transit-rules',{rules:next},g.etag?{'If-Match':g.etag}:{});const s=await edit('A',pick(20),{suppFob:777,suppFobMeta:{source:'manual'}});return {put:p.status,putText:p.status===200?'':p.text,save:s.status,read:await computed()};});
    await checkpoint('K1 (P1–P6)');
    await step('P7 gün dönümü (+1 gün) + kayıt',async()=>{await setCtl({clockOffsetMs:864e5});await login('A','moderator','synthetic-startup-only-123');await login('B','mod2','synthetic-startup-only-456');const r0=await computed();const s=await edit('A',pick(21),{suppFob:888,suppFobMeta:{source:'manual'}});return {readBefore:r0,save:s.status,read:await computed()};});
    await checkpoint('K2 (gün dönümü)');
    await step('P8a enjeksiyon: günlük kaydı istisnası',async()=>{await setCtl({clockOffsetMs:864e5,recordThrow:true});const s=await edit('A',pick(22),{suppFob:901,suppFobMeta:{source:'manual'}});const read=await computed();await setCtl({clockOffsetMs:864e5});return {save:s.status,read};});
    await step('P8b enjeksiyon: settle bozuk satır → doğrulama uyuşmazlığı',async()=>{await setCtl({clockOffsetMs:864e5,settleCorrupt:true});const s=await edit('A',pick(23),{suppFob:902,suppFobMeta:{source:'manual'}});const r1=await computed();await L.delay(12000);await setCtl({clockOffsetMs:864e5});const r2=await computed();return {save:s.status,first:r1,afterSettle:r2};});
    await step('P8c enjeksiyon: yeniden yazım başarısız (settle ok:false)',async()=>{await setCtl({clockOffsetMs:864e5,settleFail:true});const s=await edit('A',pick(24),{suppFob:903,suppFobMeta:{source:'manual'}});const r1=await computed();await L.delay(12000);await setCtl({clockOffsetMs:864e5});const r2=await computed();return {save:s.status,first:r1,afterSettle:r2};});
    await checkpoint('K3 (enjeksiyonlar)');
    await step('P9 kayıt sonrası süreç öldürme',async()=>{const r=pick(25);const s=await edit('A',r,{suppFob:999,suppFobMeta:{source:'manual'}});return {save:s.status};});
    const k4=await checkpoint('K4 (SIGKILL hemen kayıttan sonra)',{kill:true});
    // Öldürme sonrası soğuk okuma tabanı ikinci bir temiz yeniden başlatmayla doğrulanır.
    await checkpoint('K5 (K4 sonrası temiz yeniden başlatma)');
    const after=await window_();const r25=after.find(r=>String(r._id)===String(pick(25)._id));rep.killValue=r25&&r25['Supp. FOB'];save();
  }catch(e){rep.errors.push(String(e.stack||e).slice(0,600));}
  finally{save();await app.stop();}
})();
