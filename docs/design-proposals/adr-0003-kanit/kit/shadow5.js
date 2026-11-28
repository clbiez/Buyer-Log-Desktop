'use strict';
// Nihai doğrulama (A) gölge eşitliği: shadow4 kapsamı + Kaynağa dön (PATCH ve POST /rows), geri al/yinele, IAS parsiyelli
// satır Del. Type + Eksik Adet işareti, mevcut kıtlık (shortage) segmentli satır, çoklu renk (kardeş renk etkilenmez),
// POST /rows Supp. FOB/Del. Type (base'li). node shadow5.js <APP> <SOURCE> <out.json>
// Eşitlik: V2 (artımlı, kayıtlardan sonra) ↔ V4 (yeniden başlatma, önbellek korunur) ↔ V3 (projeksiyon önbelleği silinip
// sıfırdan tam kurulum); dokunulan + kardeş satırlar alan alan (tüm sayfalar), cp/computed tüm satırlar. Anlamsal kontroller
// ayrıca raporlanır (ör. "Kaynağa dön" sonrası delmap satır anahtarı yok). Uç nokta/niyet sürümde yoksa durum kodu kaydedilir.
const L=require('./lib.js'),fs=require('fs'),path=require('path');
const [APP,SOURCE,OUT]=process.argv.slice(2);
const pkg=JSON.parse(fs.readFileSync(path.join(APP,'package.json'),'utf8'));
const rep={app:APP,version:pkg.version,runtime:{exec:process.execPath,node:process.versions.node,electron:process.versions.electron||null,NODE_OPTIONS:process.env.NODE_OPTIONS||''},edits:[],reads:[],checks:{},semantic:{},errors:[]};
const save=()=>fs.writeFileSync(OUT,JSON.stringify(rep,null,1));
const walk=(d,out=[])=>{for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,e.name);if(e.isDirectory())walk(p,out);else out.push(p);}return out;};
const iso=d=>{const p=n=>String(n).padStart(2,'0');return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`;};
const FIELDS=['_id','Order Code','Model Name','C.Code','Del. Type','Ex-factory','_logisticSegments','_exFactoryRevision','Notes','Ek Not','Supp. FOB'];
(async()=>{
  const app=await L.createApp({APP,source:SOURCE,label:'sh5'});
  const req=async(method,u,body,cookie=app.cookie)=>{for(let a=0;;a++){const r=await fetch(app.base+u,{method,headers:{cookie,'Content-Type':'application/json'},...(body!==undefined?{body:JSON.stringify(body)}:{})});const t=await r.text();if(r.status===503&&a<8&&method==='POST'&&/read-model/.test(u)){await L.delay(500);continue;}let j=null;try{j=JSON.parse(t);}catch(_){}return {status:r.status,json:j,text:t.slice(0,240),retries:a};}};
  const q=async(off,fields)=>{const r=await req('POST','/api/read-model/cp/query',{version:1,lang:'tr',query:{version:1,columns:[],base:[],groups:{},today:iso(new Date()),offset:off,limit:1000,...(fields?{fields}:{})}});if(r.status!==200)throw Error('cp/query '+r.status+r.text);return r.json.result.rows;};
  const all=async fields=>{const out=[];for(let off=0;;off+=1000){const rows=await q(off,fields);out.push(...rows);if(rows.length<1000)break;}return out;};
  const computed=async label=>{const r=await req('POST','/api/read-model/cp/computed',{version:1,lang:'tr'});if(r.status!==200)throw Error('computed '+r.status);const t=r.json.timing||{};
    rep.reads.push({label,rowPatch:t.service&&t.service.rowPatch||null,datasetRowPatch:t.rowPatch||null,reloaded:t.datasetReloaded,retries:r.retries});save();return new Map(r.json.columns.rows.map(x=>[String(x[0]),JSON.stringify(x)]));};
  const touched=new Map();const tag=(r,k)=>touched.set(String(r._id),touched.has(String(r._id))?touched.get(String(r._id))+' + '+k:k);
  const snap=async()=>new Map((await all()).filter(r=>touched.has(String(r._id))).map(r=>{const o={...r};delete o._rowIndex;return [String(r._id),o];}));
  const diff=(a,b)=>{const out={};for(const [id,x] of a){const y=b.get(id);if(!y){out[id+':'+touched.get(id)]=['<yok>'];continue;}const d=[...new Set([...Object.keys(x),...Object.keys(y)])].filter(k=>JSON.stringify(x[k])!==JSON.stringify(y[k]));if(d.length)out[id+':'+touched.get(id)]=d.map(k=>/^_logistic/.test(k)?k:`${k}=${JSON.stringify(x[k])}→${JSON.stringify(y[k])}`);}return out;};
  const allDiff=(a,b)=>[...b.keys()].filter(id=>a.get(id)!==b.get(id));
  const ovFile=()=>JSON.parse(fs.readFileSync(path.join(app.root,'data','overrides.json'),'utf8'));
  const delStored=r=>{const m=ovFile().delmap||{};return Object.fromEntries(Object.keys(m).filter(k=>k===String(r['Order Code'])||k.startsWith(String(r['Order Code'])+'|')).map(k=>[k,m[k]]));};
  const line=r=>({model:r['Model Name'],ccode:r['C.Code']});
  const E=async(kind,r,fn)=>{tag(r,kind);const s=await fn(r);rep.edits.push({kind,id:String(r._id),status:s.status,code:s.json&&s.json.code||null,text:s.status===200?'':s.text});save();await L.delay(400);return s;};
  const PATCH=(r,x)=>req('PATCH','/api/overrides/'+r['Order Code'],{...line(r),...x});
  const ROWS=(r,patch,base)=>req('POST','/api/overrides/rows',{items:[{orderCode:r['Order Code'],patch:{...line(r),...patch},base}]});
  try{
    await L.boot(app);
    await computed('open');
    const meta=await all(FIELDS);const byId=new Map(meta.map(r=>[String(r._id),r]));
    const kinds=r=>Array.isArray(r._logisticSegments)?r._logisticSegments.map(s=>s.kind):[];
    const editableEx=r=>r['Ex-factory']&&!(r._exFactoryRevision&&r._exFactoryRevision.source==='loading-approval');
    const free=r=>!touched.has(String(r._id));
    const byOrder=new Map();for(const r of meta){const k=String(r['Order Code']);if(!byOrder.has(k))byOrder.set(k,[]);byOrder.get(k).push(r);}
    const pool={
      prodOnly:meta.filter(r=>kinds(r).length&&kinds(r).every(k=>k==='production')),
      iasPartial:meta.filter(r=>kinds(r).includes('partial')&&kinds(r).includes('production')),
      shortage:meta.filter(r=>kinds(r).includes('shortage')),
      multiColor:[...byOrder.values()].filter(list=>list.length>=2&&list.every(r=>kinds(r).length&&kinds(r).every(k=>k==='production'))),
    };
    rep.pool=Object.fromEntries(Object.entries(pool).map(([k,v])=>[k,v.length]));rep.rows=meta.length;save();
    const take=(list,i=0)=>{for(let k=0;k<list.length;k++){const r=list[(i*397+11+k)%list.length];if(free(r))return r;}return null;};
    const nextDel=v=>v==='Uçak'?'Gemi+Uçak':'Uçak';
    // 1 · shadow4 aşama-1 kayıtları (pilot yolu)
    await E('Supp. FOB PATCH',take(pool.prodOnly,0),r=>PATCH(r,{notes:{Notes:r.Notes||'',NotesHtml:'',EkNot:r['Ek Not']||'',EkNotHtml:''},suppFob:123.4,suppFobMeta:{source:'manual'}}));
    await E('not /batch',take(pool.prodOnly,1),r=>req('POST','/api/overrides/batch',{items:[{orderCode:r['Order Code'],patch:{...line(r),notes:{Notes:'gölge not',NotesHtml:'gölge not'}}}]}));
    {const a=take(pool.prodOnly,2);tag(a,'/batch-suppfob');const b=take(pool.prodOnly,3);tag(b,'/batch-suppfob');const s=await req('POST','/api/overrides/batch-suppfob',{items:[a,b].map((r,k)=>({orderCode:r['Order Code'],...line(r),suppFob:200+k}))});rep.edits.push({kind:'/batch-suppfob 2 satır',status:s.status,text:s.status===200?'':s.text});}
    {const items=[4,5,6,7,8].map(i=>take(pool.prodOnly,i));for(const r of items)tag(r,'toplu not /batch 5');const s=await req('POST','/api/overrides/batch',{items:items.map(r=>({orderCode:r['Order Code'],patch:{...line(r),notes:{Notes:'toplu',NotesHtml:'toplu'}}}))});rep.edits.push({kind:'toplu not /batch 5 satır',status:s.status});}
    await E('POST /rows not',take(pool.prodOnly,9),r=>ROWS(r,{notes:{Notes:'satır kaydı notu'}},{notes:{Notes:r.Notes||''}}));
    // 2 · Del. Type (tam yol): PATCH ve POST /rows
    const rD=take(pool.prodOnly,10);rep.semantic.delTypeBefore={id:String(rD._id),value:rD['Del. Type']};
    await E('Del. Type PATCH',rD,r=>PATCH(r,{delType:nextDel(r['Del. Type'])}));
    const rDr=take(pool.prodOnly,11);
    await E('Del. Type POST /rows',rDr,r=>ROWS(r,{delType:nextDel(r['Del. Type'])},{}));
    // 3 · Kaynağa dön (BL-028): PATCH null; POST /rows null (base = kayıtlı değer); kardeş renk korunur
    const mc=pool.multiColor.find(list=>list.every(free))||null;let rRev=null,rSib=null;
    if(mc){rRev=mc[0];rSib=mc[1];tag(rSib,'kardeş renk (dokunulmadı)');rep.semantic.revert={id:String(rRev._id),before:rRev['Del. Type'],sibling:String(rSib._id),siblingBefore:rSib['Del. Type']};
      await E('çoklu renk: Del. Type PATCH (renk 1)',rRev,r=>PATCH(r,{delType:nextDel(r['Del. Type'])}));
      rep.semantic.revert.storedAfterSet=delStored(rRev);
      await E('Kaynağa dön PATCH (delType:null)',rRev,r=>PATCH(r,{delType:null}));
      rep.semantic.revert.storedAfterRevert=delStored(rRev);}
    else rep.semantic.revert={na:'30k fixture: tüm renkleri yalnız üretim segmentli çoklu renk siparişi yok'};
    const rRr=take(pool.prodOnly,12);{const v=nextDel(rRr['Del. Type']);await E('Del. Type POST /rows (kaynağa dön öncesi)',rRr,r=>ROWS(r,{delType:v},{}));
      await E('Kaynağa dön POST /rows (delType:null, base)',rRr,r=>ROWS(r,{delType:null},{delType:v}));rep.semantic.revertRows={id:String(rRr._id),before:rRr['Del. Type'],stored:delStored(rRr)};}
    // 4 · Geri al / yinele: set → kaynağa dön → geri al (önceki override açık değerle) → yinele (yeniden temizle) → geri al
    const rU=take(pool.prodOnly,13);{const v=nextDel(rU['Del. Type']);rep.semantic.undo={id:String(rU._id),before:rU['Del. Type'],set:v,steps:[]};
      for(const [k,x] of [['set',{delType:v}],['kaynağa dön',{delType:null}],['geri al',{delType:v}],['yinele',{delType:null}],['geri al 2',{delType:v}]]){const s=await E('geri al zinciri: '+k,rU,r=>PATCH(r,x));rep.semantic.undo.steps.push({k,status:s.status,stored:delStored(rU)});}}
    // 5 · IAS parsiyelli satır: Del. Type (üretim segmentine) + Eksik Adet işareti / kaldırma
    const rI=take(pool.iasPartial,0);
    if(rI){rep.semantic.iasPartial={id:String(rI._id),before:rI['Del. Type'],segments:rI._logisticSegments.map(s=>[s.kind,s.delType,s.status])};
      await E('IAS parsiyelli: Del. Type PATCH',rI,r=>PATCH(r,{delType:'Uçak'}));
      const rS=take(pool.iasPartial,1);
      if(rS){const prod=rS._logisticSegments.find(s=>s.kind==='production');rep.semantic.shortageMark={id:String(rS._id),qty:prod&&prod.quantity};
        await E('IAS parsiyelli: Eksik Adet işaretle',rS,r=>PATCH(r,{shortage:{marked:true,qty:prod?prod.quantity:0}}));
        const rS2=take(pool.iasPartial,2);if(rS2){const p2=rS2._logisticSegments.find(s=>s.kind==='production');
          await E('Eksik Adet işaretle → kaldır',rS2,async r=>{await PATCH(r,{shortage:{marked:true,qty:p2?p2.quantity:0}});return PATCH(r,{shortage:null});});}}}
    else rep.semantic.iasPartial={na:'30k fixture: parsiyel + üretim segmentli satır yok'};
    // 6 · Mevcut kıtlık (shortage) segmentli satır: Del. Type
    const rK=take(pool.shortage,0);
    if(rK){rep.semantic.shortageRow={id:String(rK._id),segments:rK._logisticSegments.map(s=>[s.kind,s.delType])};await E('kıtlık segmentli satır: Del. Type PATCH',rK,r=>PATCH(r,{delType:'Gemi+Tır'}));}
    else rep.semantic.shortageRow={na:'30k fixture: shortage segmentli satır yok'};
    // 7 · Düzenlenebilir Ex-factory (yükleme onaylı satırlar 409 AUTOMATIC_DATE_READ_ONLY ile atlanır)
    let rX=null;rep.exFactorySkipped=[];const exCand=meta.filter(r=>editableEx(r)&&free(r));
    for(let k=0;k<Math.min(60,exCand.length)&&!rX;k++){const c=exCand[(k*37+5)%exCand.length];if(!free(c))continue;const d=new Date(c['Ex-factory']);d.setDate(d.getDate()+10);
      const s=await PATCH(c,{dates:{exFactory:iso(d)}});if(s.status===200){rX=c;tag(c,'Ex-factory PATCH');rep.edits.push({kind:'Ex-factory PATCH',id:String(c._id),status:200});rep.semantic.exFactory={id:String(c._id),before:c['Ex-factory'],target:iso(d)};}
      else rep.exFactorySkipped.push({id:String(c._id),status:s.status,code:s.json&&s.json.code});}
    if(!rX)rep.semantic.exFactory={na:'düzenlenebilir Ex-factory satırı yok'};
    // 8 · Del. Type satırına sonradan Supp. FOB + not (delType göndermez) → Del. Type korunur
    await E('Supp. FOB (Del. Type satırı)',rD,r=>PATCH(r,{notes:{Notes:r.Notes||'',NotesHtml:'',EkNot:r['Ek Not']||'',EkNotHtml:''},suppFob:55.5,suppFobMeta:{source:'manual'}}));
    await E('not /batch (Del. Type satırı)',rD,r=>req('POST','/api/overrides/batch',{items:[{orderCode:r['Order Code'],patch:{...line(r),notes:{Notes:'u1 not',NotesHtml:'u1 not'}}}]}));
    rep.semantic.delTypeStored=delStored(rD);save();
    await L.delay(25000);const T2=await computed('T2 artımlı'),V2=await snap();
    // Yeniden başlatma eşitliği (önbellek korunur)
    await app.stop();await app.start();await app.login();const T4=await computed('T4 yeniden başlatma'),V4=await snap();
    // Bağımsız taban: projeksiyon önbelleği silinir, tam kurulum
    await app.stop();const removed=[];for(const f of walk(app.root).filter(p=>/page-cache/.test(p)&&/manifest\.json(\.bak)?$/.test(p))){removed.push(path.relative(app.root,path.dirname(f)));fs.rmSync(path.dirname(f),{recursive:true,force:true});}
    rep.cacheRemoved=removed;await app.start();await app.login();const T3=await computed('T3 tam kurulum'),V3=await snap();
    const val=(V,r,k)=>r&&V.get(String(r._id))&&V.get(String(r._id))[k];
    Object.assign(rep.checks,{
      v2_v3:diff(V2,V3),v4_v3:diff(V4,V3),v2_v4:diff(V2,V4),
      t2_t3_rows:allDiff(T2,T3).length,t4_t3_rows:allDiff(T4,T3).length,t2_t3_sample:allDiff(T2,T3).slice(0,10),
      totalRows:T3.size,touched:touched.size});
    Object.assign(rep.semantic,{
      delTypeV3:val(V3,rD,'Del. Type'),
      revertV3:rRev?{row:val(V3,rRev,'Del. Type'),sibling:val(V3,rSib,'Del. Type'),siblingUnchanged:val(V3,rSib,'Del. Type')===rep.semantic.revert.siblingBefore,lineKeyRemoved:!Object.keys(rep.semantic.revert.storedAfterRevert||{}).some(k=>k.includes('|'))}:null,
      revertRowsV3:val(V3,rRr,'Del. Type'),
      undoV3:val(V3,rU,'Del. Type'),
      iasPartialV3:rI?(V3.get(String(rI._id))||{})._logisticSegments?.map(s=>[s.kind,s.delType,s.status]):null,
      shortageRowV3:rK?(V3.get(String(rK._id))||{})._logisticSegments?.map(s=>[s.kind,s.delType]):null,
      exFactoryV3:rX?val(V3,rX,'Ex-factory'):null});
    rep.pass=rep.errors.length===0&&Object.keys(rep.checks.v2_v3).length===0&&Object.keys(rep.checks.v4_v3).length===0&&rep.checks.t2_t3_rows===0&&rep.checks.t4_t3_rows===0;
  }catch(e){rep.errors.push(String(e.stack||e).slice(0,800));rep.pass=false;}
  finally{save();await app.stop();}
})();
