'use strict';
// Birincil segment ölçümü: CP okuma modeli (cp/query), CP karar (cp/computed), ham cp ve orders projeksiyonu.
// node dump.js <APP> <SOURCE> <out.json>
const L=require('./lib.js'),fs=require('fs'),path=require('path'),zlib=require('zlib');
const [APP,SOURCE,OUT]=process.argv.slice(2);
const walk=(d,out=[])=>{for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,e.name);if(e.isDirectory())walk(p,out);else out.push(p);}return out;};
const iso=d=>{const p=n=>String(n).padStart(2,'0');return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`;};
const day=v=>v?String(v).slice(0,10):null;
const pick=x=>x&&{STATUS:x.STATUS||'',DT:x['Del. Type']||'',ANT:day(x['Ant. Arrival']),HO:day(x['HANDOVER Tarihi']),PR:x.Priority||null};
(async()=>{const app=await L.createApp({APP,source:SOURCE,env:{},label:'dump'});
  const req=async(u,b)=>{for(let a=0;;a++){const r=await fetch(app.base+u,{method:'POST',headers:{cookie:app.cookie,'Content-Type':'application/json'},body:JSON.stringify(b)});if(r.status===503&&a<8){await L.delay(500);continue;}return {status:r.status,json:await r.json().catch(()=>null)};}};
  const rep={rows:{},orders:{}};const full=[];
  try{await L.boot(app);
    const comp=await req('/api/read-model/cp/computed',{version:1,lang:'tr'});const f=comp.json.columns.fields;
    const tuples=new Map((comp.json.columns.rows||[]).map(x=>[String(x[0]),Object.fromEntries(f.map((k,i)=>[k,x[i]]))]));
    // Siparişler projeksiyonunu da kurdur.
    await fetch(app.base+'/api/page-projection/orders',{headers:{cookie:app.cookie}}).then(r=>r.arrayBuffer()).catch(()=>null);
    const files=walk(app.root).filter(p=>/page-cache/.test(p));
    const load=name=>{const fp=files.find(p=>p.endsWith('/'+name+'.json.gz'));return fp?JSON.parse(zlib.gunzipSync(fs.readFileSync(fp)).toString('utf8')).rows||[]:[];};
    const key=r=>`${r['Order Code']}|${r['C.Code']}|${r['Model Name']}`;
    const raw=new Map(load('cp').map(r=>[key(r),r]));
    for(const r of load('orders'))rep.orders[key(r)]=pick(r);
    for(let off=0;off<40000;off+=1000){const r=await req('/api/read-model/cp/query',{version:1,lang:'tr',query:{version:1,columns:[],base:[],groups:{},today:iso(new Date()),offset:off,limit:1000}});
      const rows=r.json&&r.json.result&&r.json.result.rows||[];if(!rows.length)break;
      for(const row of rows){full.push(row);const k=key(row),rw=raw.get(k),t=tuples.get(String(row._id))||{};
        rep.rows[k]={segs:(row._logisticSegments||[]).map(s=>[s.kind,s.status,s.delType,day(s.arrival),day(s.handover),s.quantity,s.synthetic||'']),
          rm:{...pick(row),PR:t.priority||null},raw:pick(rw)};}}
    rep.files=files.map(p=>path.basename(p));
    if(process.env.FULL)fs.writeFileSync(process.env.FULL,JSON.stringify(full));
  }catch(e){rep.error=String(e.stack||e).slice(0,600);}finally{fs.writeFileSync(OUT,JSON.stringify(rep));await app.stop();}
  console.log('rows',Object.keys(rep.rows).length,'orders',Object.keys(rep.orders).length,rep.error||'');})();
