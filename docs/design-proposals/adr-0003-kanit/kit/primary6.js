'use strict';
// Birincil segment: tipik parsiyel durumlar için CP okuma modeli (partials[0]) ↔ ham projeksiyon (parse.js) değerleri + karar. node primary3.js <APP> <SOURCE> <out.json>
const L=require('./lib.js'),fs=require('fs'),path=require('path'),zlib=require('zlib');
const [APP,SOURCE,OUT]=process.argv.slice(2);const rep={cats:{},counts:{},diff:{},prioDist:{},rawPrioDist:{},dtSamples:[]};
const walk=(d,out=[])=>{for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,e.name);if(e.isDirectory())walk(p,out);else out.push(p);}return out;};
const iso=d=>{const p=n=>String(n).padStart(2,'0');return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`;};
const st=s=>String(s||'').toLocaleUpperCase('tr-TR');
const cat=segs=>{const prod=segs.some(s=>s.kind==='production'),parts=segs.filter(s=>s.kind==='partial');if(!parts.length)return prod?'yalnız üretim':'diğer';
  const ware=parts.every(s=>/DEPODA|RETAIL/.test(st(s.status))),transit=parts.some(s=>!/DEPODA|RETAIL|ÜRETİMDE/.test(st(s.status))),partProd=parts.some(s=>/ÜRETİMDE/.test(st(s.status)));
  if(prod)return ware?'depoda + üretim':transit?'yolda + üretim':partProd?'parsiyel(Üretimde) + üretim':'karışık + üretim';
  return ware?'hepsi depoda':transit?'hepsi yolda (ya da kısmen)':'diğer parsiyel';};
(async()=>{const app=await L.createApp({APP,source:SOURCE,env:{},label:'p3'});
  const req=async(u,b)=>{for(let a=0;;a++){const r=await fetch(app.base+u,{method:'POST',headers:{cookie:app.cookie,'Content-Type':'application/json'},body:JSON.stringify(b)});if(r.status===503&&a<5){await L.delay(500);continue;}return {status:r.status,json:await r.json().catch(()=>null)};}};
  try{await L.boot(app);
    const comp=await req('/api/read-model/cp/computed',{version:1,lang:'tr'});const f=comp.json.columns.fields;const tuples=new Map((comp.json.columns.rows||[]).map(x=>[String(x[0]),Object.fromEntries(f.map((k,i)=>[k,x[i]]))]));
    const files=walk(app.root).filter(p=>/page-cache/.test(p)&&/\/cp\.json\.gz$/.test(p));const raw=JSON.parse(zlib.gunzipSync(fs.readFileSync(files[0])).toString('utf8')).rows||[];
    const rawBy=new Map(raw.map(r=>[`${r['Order Code']}|${r['C.Code']}|${r['Model Name']}`,r]));
    const pick=x=>x&&{STATUS:x.STATUS,'Del. Type':x['Del. Type'],'Ant. Arrival':String(x['Ant. Arrival']||'').slice(0,10)||null,HANDOVER:String(x['HANDOVER Tarihi']||'').slice(0,10)||null,Priority:x.Priority||null};
    for(let off=0;off<25000;off+=1000){const r=await req('/api/read-model/cp/query',{version:1,lang:'tr',query:{version:1,columns:[],base:[],groups:{},today:iso(new Date()),offset:off,limit:1000}});const rows=r.json&&r.json.result&&r.json.result.rows||[];if(!rows.length)break;
      for(const row of rows){const segs=Array.isArray(row._logisticSegments)?row._logisticSegments:[];const c=cat(segs);rep.counts[c]=(rep.counts[c]||0)+1;const list=rep.cats[c]=rep.cats[c]||[];const rwx=rawBy.get(`${row["Order Code"]}|${row["C.Code"]}|${row["Model Name"]}`);const tx=tuples.get(String(row._id))||{};const A={...pick(row),Priority:tx.priority||null},B=pick(rwx)||{};const d=rep.diff[c]=rep.diff[c]||{n:0};d.n++;for(const k of ["STATUS","Del. Type","Ant. Arrival","HANDOVER","Priority"]){const norm=v=>String(v==null?"":v).toUpperCase().replace(/[İI]/g,"I").replace(/Ç/g,"C");if(norm(A[k])!==norm(B[k]))d[k]=(d[k]||0)+1;}rep.prioDist[A.Priority]=(rep.prioDist[A.Priority]||0)+1;rep.rawPrioDist[B.Priority]=(rep.rawPrioDist[B.Priority]||0)+1;if(c.startsWith('parsiyel')&&String(A['Del. Type']).toUpperCase().replace(/[İI]/g,'I').replace(/Ç/g,'C')!==String(B['Del. Type']).toUpperCase().replace(/[İI]/g,'I').replace(/Ç/g,'C')&&rep.dtSamples.length<6)rep.dtSamples.push({key:row['Order Code']+'/'+row['C.Code'],A:A['Del. Type'],B:B['Del. Type'],segs:segs.map(s=>s.kind+':'+s.status+':'+s.delType+':'+s.qty)});if(A.Priority!==B.Priority){const pk=A.Priority+"->"+B.Priority;d.pairs=d.pairs||{};d.pairs[pk]=(d.pairs[pk]||0)+1;}if(list.length>=2)continue;
        const rw=rawBy.get(`${row['Order Code']}|${row['C.Code']}|${row['Model Name']}`);const t=tuples.get(String(row._id))||{};
        list.push({key:`${row['Order Code']}/${row['C.Code']}`,segments:segs.map(s=>({kind:s.kind,status:s.status,delType:s.delType,arrival:String(s.arrival||'').slice(0,10),handover:String(s.handover||'').slice(0,10)||null,qty:s.quantity})),
          cpReadModel_partials0:{...pick(row),Priority:t.priority||null},raw_parseJs:pick(rw)});}}
  }catch(e){rep.error=String(e.stack||e).slice(0,400);}finally{fs.writeFileSync(OUT,JSON.stringify(rep,null,1));await app.stop();}})();
