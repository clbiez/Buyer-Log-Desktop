'use strict';
// P1 lojistik segment düzeltmesi doğrulaması (repo dışı). node fixv.js <APP> <SOURCE> <out.json>
const L=require('../6f/lib.js'),fs=require('fs'),path=require('path');
const [APP,SOURCE,OUT]=process.argv.slice(2);
const rep={app:APP,edits:[],events:[],checks:{},errors:[]};const save=()=>fs.writeFileSync(OUT,JSON.stringify(rep,null,1));
const walk=(d,out=[])=>{for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,e.name);if(e.isDirectory())walk(p,out);else out.push(p);}return out;};
const iso=d=>{const p=n=>String(n).padStart(2,'0');return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`;};
(async()=>{
  const app=await L.createApp({APP,source:SOURCE,env:{},label:'fixv'});
  const S={};
  const req=async(who,method,u,body,headers={})=>{const r=await fetch(app.base+u,{method,headers:{cookie:S[who],'Content-Type':'application/json',...headers},...(body!==undefined?{body:JSON.stringify(body)}:{})});const t=await r.text();let j=null;try{j=JSON.parse(t);}catch(_){}return {status:r.status,json:j,text:t.slice(0,240)};};
  const login=async(who,user,pw,byName)=>{const r=await fetch(app.base+'/api/user-login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(byName?{username:user,password:pw,newPassword:pw}:{userId:user,password:pw,newPassword:pw})});if(!r.ok)throw Error('login '+who+' '+r.status);S[who]=String(r.headers.get('set-cookie')||'').split(';')[0];};
  const page=async off=>{for(let a=0;;a++){const r=await req('A','POST','/api/read-model/cp/query',{version:1,lang:'tr',query:{version:1,columns:[],base:[],groups:{},today:iso(new Date()),offset:off,limit:1000}});if(r.status===503&&a<4){await L.delay(500);continue;}if(r.status!==200)throw Error('cp/query '+r.status+r.text);return r.json.result.rows;}};
  const win=async()=>{const out=[];for(let off=0;off<5000;off+=1000)out.push(...await page(off));return out;};
  const tuples=async()=>{for(let a=0;;a++){const r=await req('A','POST','/api/read-model/cp/computed',{version:1,lang:'tr'});if(r.status===503&&a<4){await L.delay(500);continue;}if(r.status!==200)throw Error('computed '+r.status);return new Map(r.json.columns.rows.map(x=>[String(x[0]),JSON.stringify(x)]));}};
  const ordersRows=async codes=>{const r=await req('A','POST','/api/read-model/orders/query',{version:1,offset:0,limit:500,filters:[{key:'Order Code',op:'in',values:codes.map(String)}]});return r.status===200?(r.json.result&&r.json.result.rows||[]):{status:r.status,text:r.text};};
  const touched=new Map();const tag=(row,kind)=>touched.set(String(row._id),kind);
  const snap=rows=>new Map(rows.filter(r=>touched.has(String(r._id))).map(r=>{const o={...r};delete o._rowIndex;return [String(r._id),o];}));
  const diff=(a,b)=>{const out={};for(const [id,x] of a){const y=b.get(id);if(!y){out[id]=[{k:'<missing>'}];continue;}const keys=new Set([...Object.keys(x),...Object.keys(y)]);const d=[...keys].filter(k=>JSON.stringify(x[k])!==JSON.stringify(y[k])).map(k=>({k,a:x[k],b:y[k]}));if(d.length)out[id]=d;}return out;};
  const short=d=>Object.fromEntries(Object.entries(d).map(([id,list])=>[id+':'+touched.get(id),list.map(x=>/^_logistic/.test(x.k)?x.k:`${x.k}=${JSON.stringify(x.a)}→${JSON.stringify(x.b)}`)]));
  const segs=r=>Array.isArray(r._logisticSegments)?r._logisticSegments:[];
  const partialsOf=r=>segs(r).filter(s=>s.kind==='partial');
  try{
    await L.boot(app);S.A=app.cookie;
    await req('A','POST','/api/users',{username:'mod2',displayName:'Mod 2',title:'T',password:'synthetic-startup-only-456',systemRole:'moderator',reason:'doğrulama',confirmCritical:true});
    await login('B','mod2','synthetic-startup-only-456',true);
    await tuples();
    const rows=await win();rep.rows=rows.length;{const c={};for(const r of rows){const g=segs(r);const k=`parsiyel=${g.filter(x=>x.kind==='partial').length} üretim=${g.filter(x=>x.kind==='production').length} kıtlık=${g.filter(x=>x.kind==='shortage').length} onay=${r['Buying Son Onay Tarihi']?1:0}`;c[k]=(c[k]||0)+1;}rep.shapes=c;const oc=new Map();for(const r of rows)oc.set(r['Order Code'],(oc.get(r['Order Code'])||0)+1);rep.multiLineOrders=[...oc.values()].filter(n=>n>1).length;}
    // SSE: A dinler, B'nin olaylarını görür.
    const ac=new AbortController();
    (async()=>{try{const r=await fetch(app.base+'/api/live-events',{headers:{cookie:S.A},signal:ac.signal});const rd=r.body.getReader();let buf='';for(;;){const {value,done}=await rd.read();if(done)break;buf+=Buffer.from(value).toString('utf8');let i;while((i=buf.indexOf('\n\n'))>=0){const chunk=buf.slice(0,i);buf=buf.slice(i+2);const data=chunk.split('\n').filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trim()).join('');if(data){try{const p=JSON.parse(data);if(p.area==='orders')rep.events.push({t:Date.now(),mode:p.mode||null,rowPatches:Array.isArray(p.rowPatches)?p.rowPatches.length:null});}catch(_){}}}}}catch(_){}})();
    const used=new Set();const find=(fn,label)=>{const r=rows.find(r=>!used.has(String(r._id))&&fn(r));if(r)used.add(String(r._id));else rep.errors.push('aday yok: '+label);return r;};
    const noApproval=r=>!r['Buying Son Onay Tarihi']&&!(r._exFactoryRevision&&r._exFactoryRevision.source==='loading-approval');
    const prodOnly=(free)=>find(r=>segs(r).length&&segs(r).every(s=>s.kind==='production')&&(!free||noApproval(r)),'yalnız üretim'+(free?' (onaysız)':''));
    const partialShip=find(r=>partialsOf(r).length===1&&segs(r).some(s=>s.kind==='production'),'kısmi sevk (yüklenmiş+üretim)');
    const multiSeg=find(r=>partialsOf(r).length>=2&&noApproval(r),'çoklu segment');
    const fullShip=find(r=>partialsOf(r).length>=1&&!segs(r).some(s=>s.kind==='production'||s.kind==='shortage'),'tam sevk');
    const p1=prodOnly(),p3=prodOnly(),p4=prodOnly(),p5=prodOnly(),p6=prodOnly(),p7=prodOnly();
    const approval=find(r=>r['Buying Son Onay Tarihi'],'otomatik yükleme onayı');
    const byCode=new Map();for(const r of rows){if(used.has(String(r._id)))continue;const k=String(r['Order Code']);if(!byCode.has(k))byCode.set(k,[]);byCode.get(k).push(r);}
    const colours=[...byCode.values()].find(l=>new Set(l.map(r=>r['C.Code'])).size>=2);if(colours)colours.forEach(r=>used.add(String(r._id)));else rep.errors.push('aday yok: aynı sipariş farklı renk');
    const before=new Map(rows.map(r=>[String(r._id),r]));
    const body=(r,x)=>({model:r['Model Name'],ccode:r['C.Code'],notes:{Notes:r.Notes||'',NotesHtml:'',EkNot:r['Ek Not']||'',EkNotHtml:''},delType:r['Del. Type']||undefined,...x});
    const other=d=>d==='Uçak'?'Gemi':'Uçak';
    const exf=(r,days)=>{const d=new Date(r['Ex-factory']||Date.now());d.setDate(d.getDate()+days);return iso(d);};
    const E=async(kind,who,r,fn)=>{if(!r)return;tag(r,kind);const s=await fn(r);rep.edits.push({kind,who,id:String(r._id),code:r['Order Code'],status:s.status,code2:s.json&&s.json.code||'',text:s.status===200?'':s.text});save();await L.delay(300);};
    const patch=(who,r,x)=>req(who,'PATCH','/api/overrides/'+r['Order Code'],body(r,x));
    await E('kısmi sevk: Del. Type','A',partialShip,r=>patch('A',r,{delType:other(r['Del. Type'])}));
    await E('çoklu segment: Ex-factory','A',multiSeg,r=>patch('A',r,{dates:{exFactory:exf(r,9)}}));
    await E('tam sevk: Del. Type','A',fullShip,r=>patch('A',r,{delType:other(r['Del. Type'])}));
    await E('yalnız üretim: Del. Type (PATCH)','A',p1,r=>patch('A',r,{delType:other(r['Del. Type'])}));
    {let ok=false;for(let k=0;k<40&&!ok;k++){const r=prodOnly();if(!r)break;const s=await patch('A',r,{dates:{exFactory:exf(r,-12)}});if(s.status===200){tag(r,'yalnız üretim: Ex-factory (PATCH)');rep.edits.push({kind:'yalnız üretim: Ex-factory (PATCH)',id:String(r._id),status:200,tries:k+1});ok=true;}}if(!ok)rep.errors.push('Ex-factory kabul eden satır bulunamadı (40 aday, hepsi 409)');save();}
    await E('yalnız üretim: Retail','A',p3,r=>patch('A',r,{dates:{retailDate:exf(r,40)}}));
    await E('yalnız üretim: In-Store','A',p4,r=>patch('A',r,{dates:{inStoreDate:exf(r,50)}}));
    await E('POST /rows: Del. Type','A',p6,r=>req('A','POST','/api/overrides/rows',{items:[{orderCode:r['Order Code'],patch:{model:r['Model Name'],ccode:r['C.Code'],delType:other(r['Del. Type'])},base:{delType:null}}]}));
    await E('otomatik onaylı satır: Ex-factory','A',approval,r=>patch('A',r,{dates:{exFactory:exf(r,5)}}));
    if(colours)await E('aynı sipariş renk 1: Del. Type (renk 2 değişmemeli)','A',colours[0],r=>patch('A',r,{delType:other(r['Del. Type'])}));
    if(colours)tag(colours[1],'aynı sipariş renk 2 (dokunulmadı)');
    const fobA=find(r=>r['Del. Type'],'Supp. FOB satırı (A)');
    await E('Supp. FOB (A, gerçek istemci gövdesi, delType mevcut değer)','A',fobA,r=>patch('A',r,{suppFob:321.5,suppFobMeta:{source:'manual'}}));
    const V1=snap(await win());
    await L.delay(25000);
    const V2=snap(await win()),T2=await tuples();const codes=[...new Set([...touched.keys()].map(id=>before.get(id)['Order Code']))];const O2=await ordersRows(codes);
    // Aşama 1b: başka kullanıcı (B) — A'nın bağlamını kaydırır; A'nın sonraki okuması tam kurulum (bu yüzden V2'den SONRA).
    const evMark=rep.events.length;
    await E('başka kullanıcı (B): Del. Type','B',p7,r=>patch('B',r,{delType:other(r['Del. Type'])}));
    const fobRow=find(r=>r['Del. Type'],'Supp. FOB satırı');
    await E('Supp. FOB (B, gerçek istemci gövdesi, delType mevcut değer)','B',fobRow,r=>patch('B',r,{suppFob:321.5,suppFobMeta:{source:'manual'}}));
    await L.delay(1500);rep.eventsAfterB=rep.events.slice(evMark);
    // Aşama 2: güvensiz yama (tarih temizleme) + geri döndürme; tam kuruluma düşer, sonra V2c.
    await E('tarih temizle (Retail) + geri döndür','A',p5,async r=>{const a=await patch('A',r,{dates:{retailDate:''}});rep.edits.push({kind:'  temizle',status:a.status,text:a.status===200?'':a.text});await L.delay(800);return patch('A',r,{dates:{retailDate:iso(new Date(r['Retail Date']||Date.now()))}});});
    await L.delay(25000);const V2c=snap(await win());
    // Normal yeniden başlatma
    await app.stop();await app.start();await login('A','moderator','synthetic-startup-only-123');
    const V2b=snap(await win());
    // SIGKILL: kayıttan hemen sonra
    const killRow=find(r=>segs(r).length&&segs(r).every(s=>s.kind==='production'),'öldürme satırı');tag(killRow,'SIGKILL öncesi Del. Type');
    const ks=await patch('A',killRow,{delType:other(killRow['Del. Type'])});rep.edits.push({kind:'SIGKILL öncesi Del. Type',id:String(killRow._id),status:ks.status});
    await app.stop('SIGKILL');await app.start();await login('A','moderator','synthetic-startup-only-123');
    const VK=snap(await win());
    // Tam kurulum tabanı: projeksiyon önbelleği silinir
    await app.stop();
    for(const f of walk(app.root).filter(p=>/page-cache/.test(p)&&/manifest\.json(\.bak)?$/.test(p)))fs.rmSync(path.dirname(f),{recursive:true,force:true});
    await app.start();await login('A','moderator','synthetic-startup-only-123');
    const T3=await tuples(),V3=snap(await win()),O3=await ordersRows(codes);
    const tdiff=[...touched.keys()].filter(id=>T2.get(id)!==T3.get(id));
    const allT=[...T3.keys()].filter(id=>T2.get(id)!==T3.get(id)).length;
    const omap=o=>Array.isArray(o)?new Map(o.map(r=>[`${r['Order Code']}|${r['C.Code']}|${r['Model Name']}`,(({_rowIndex,_id,...x})=>x)(r)])):new Map();
    const od=(()=>{const a=omap(O2),b=omap(O3);const out={};for(const [k,x] of a){const y=b.get(k)||{};const d=Object.keys({...x,...y}).filter(f=>JSON.stringify(x[f])!==JSON.stringify(y[f]));if(d.length)out[k]=d;}return {rows2:a.size,rows3:b.size,diff:out};})();
    // IAS parsiyelleri: kullanıcı düzenlemesi parsiyel kaynak değerlerini değiştirmez
    const partialChange={};for(const id of touched.keys()){const b0=before.get(id),b3=(await Promise.resolve(V3.get(id)));if(!b0||!b3)continue;const p0=JSON.stringify(partialsOf(b0).map(({id,partialNo,quantity,status,arrival,handover,delType,sourceRow})=>({id,partialNo,quantity,status,arrival,handover,delType,sourceRow})));const p3=JSON.stringify(partialsOf(b3).map(({id,partialNo,quantity,status,arrival,handover,delType,sourceRow})=>({id,partialNo,quantity,status,arrival,handover,delType,sourceRow})));if(p0!==p3)partialChange[id+':'+touched.get(id)]={before:JSON.parse(p0),after:JSON.parse(p3)};}
    rep.segmentDetail=Object.fromEntries([...touched.keys()].filter(id=>partialsOf(before.get(id)).length).map(id=>[id+':'+touched.get(id),{before:segs(before.get(id)).map(x=>({kind:x.kind,status:x.status,delType:x.delType,arrival:x.arrival})),v3:V3.get(id)&&segs(V3.get(id)).map(x=>({kind:x.kind,status:x.status,delType:x.delType,arrival:x.arrival})),rowV3:V3.get(id)&&{dt:V3.get(id)['Del. Type'],st:V3.get(id).STATUS,arr:V3.get(id)['Ant. Arrival']}}]));
    rep.checks={v1_v2:short(diff(V1,V2)),v2c_v3:short(diff(V2c,V3)),v2_v3:short(diff(V2,V3)),v2restart_v3:short(diff(V2b,V3)),kill_v3:short(diff(VK,V3)),
      tuplesTouchedDiff:tdiff.map(id=>id+':'+touched.get(id)),tuplesAllDiff:allT,orders:od,partialChange,
      values:Object.fromEntries([...touched.keys()].map(id=>[id+':'+touched.get(id),{before:{dt:before.get(id)['Del. Type'],exf:before.get(id)['Ex-factory'],arr:before.get(id)['Ant. Arrival'],st:before.get(id).STATUS},v2:V2.get(id)&&{dt:V2.get(id)['Del. Type'],exf:V2.get(id)['Ex-factory'],arr:V2.get(id)['Ant. Arrival'],st:V2.get(id).STATUS},v3:V3.get(id)&&{dt:V3.get(id)['Del. Type'],exf:V3.get(id)['Ex-factory'],arr:V3.get(id)['Ant. Arrival'],st:V3.get(id).STATUS}}]))};
    ac.abort();
  }catch(e){rep.errors.push(String(e.stack||e).slice(0,600));}
  finally{save();await app.stop();}
})();
