'use strict';
// Kısmi sevk + üretim bakiyeli satırda birincil segment: CP okuma modeli ↔ Siparişler ↔ ham projeksiyon (parse.js). node primary.js <APP> <SOURCE> <out.json>
const L=require('../6f/lib.js'),fs=require('fs'),path=require('path'),zlib=require('zlib');
const [APP,SOURCE,OUT]=process.argv.slice(2);const rep={};
const walk=(d,out=[])=>{for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,e.name);if(e.isDirectory())walk(p,out);else out.push(p);}return out;};
const iso=d=>{const p=n=>String(n).padStart(2,'0');return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`;};
(async()=>{const app=await L.createApp({APP,source:SOURCE,env:{},label:'primary'});
  const req=async(u,b)=>{for(let a=0;;a++){const r=await fetch(app.base+u,{method:'POST',headers:{cookie:app.cookie,'Content-Type':'application/json'},body:JSON.stringify(b)});if(r.status===503&&a<4)continue;return {status:r.status,json:await r.json().catch(()=>null)};}};
  try{await L.boot(app);
    await req('/api/read-model/cp/computed',{version:1,lang:'tr'});
    let row=null;for(let off=0;off<25000&&!row;off+=1000){const r=await req('/api/read-model/cp/query',{version:1,lang:'tr',query:{version:1,columns:[],base:[],groups:{},today:iso(new Date()),offset:off,limit:1000}});row=(r.json.result.rows||[]).find(x=>Array.isArray(x._logisticSegments)&&x._logisticSegments.some(s=>s.kind==='partial')&&x._logisticSegments.some(s=>s.kind==='production')&&x._logisticSegments.find(s=>s.kind==='partial').status!=='Üretimde');}
    if(!row){rep.error='parsiyel+üretim (parsiyel durumu farklı) satır bulunamadı';return;}
    const pick=x=>x&&{STATUS:x.STATUS,'Del. Type':x['Del. Type'],'Ant. Arrival':x['Ant. Arrival'],segments:(x._logisticSegments||[]).map(s=>({kind:s.kind,status:s.status,delType:s.delType,arrival:s.arrival}))};
    rep.cpReadModel=pick(row);rep.key={code:row['Order Code'],model:row['Model Name'],ccode:row['C.Code']};
    const o=await req('/api/read-model/orders/query',{version:1,offset:0,limit:50,filters:[{key:'Order Code',op:'in',values:[String(row['Order Code'])]}]});
    rep.ordersReadModel=(o.json&&o.json.result&&o.json.result.rows||[]).filter(x=>x['C.Code']===row['C.Code']).map(pick);
    // Ham projeksiyon dosyaları (parse.js tam kurulum)
    const files=walk(app.root).filter(p=>/page-cache/.test(p)&&/\/(cp|orders)\.json\.gz$/.test(p));rep.files=files.map(f=>path.relative(app.root,f));
    for(const f of files){const doc=JSON.parse(zlib.gunzipSync(fs.readFileSync(f)).toString('utf8'));const list=(doc.rows||[]).filter(x=>String(x['Order Code'])===String(row['Order Code'])&&x['C.Code']===row['C.Code']);rep['raw:'+path.basename(f)]=list.map(pick);}
  }catch(e){rep.error=String(e.stack||e).slice(0,500);}finally{fs.writeFileSync(OUT,JSON.stringify(rep,null,1));await app.stop();}})();
