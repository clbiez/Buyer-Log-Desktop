const fs=require('fs'),path=require('path');const D=path.dirname(__filename);
const med=a=>{const s=[...a].sort((x,y)=>x-y);return s.length?s[s.length>>1]:null;};
const out={open:{},scroll:{}};
for(const mod of ['cp','orders'])for(const who of ['main','cand']){
  const rows=[];for(const i of [1,2,3,4,5,6]){const f=path.join(D,`open-${who}-${mod}-${i}.json`);if(!fs.existsSync(f))continue;const r=JSON.parse(fs.readFileSync(f));const m=r.measurements.find(x=>x.module===mod)||{};rows.push({pair:i,status:r.status,elapsedMs:+(m.elapsedMs||0).toFixed(1),startupCompleteMs:+(m.startupCompleteMs||0).toFixed(1),maxLongTaskMs:m.maxLongTaskMs,longTaskTotalMs:+(m.longTaskTotalMs||0).toFixed(1),rendererRssBytes:m.rendererRssBytes,rows:m.rows});}
  out.open[`${mod}/${who}`]={raw:rows,median:{elapsedMs:med(rows.map(r=>r.elapsedMs)),startupCompleteMs:med(rows.map(r=>r.startupCompleteMs)),maxLongTaskMs:med(rows.map(r=>r.maxLongTaskMs)),longTaskTotalMs:med(rows.map(r=>r.longTaskTotalMs)),rendererRssBytes:med(rows.map(r=>r.rendererRssBytes))}};
}
for(const who of ['main','cand']){const rows=[];for(const i of [1,2,3]){const f=path.join(D,`scroll-${who}-${i}.log`);if(!fs.existsSync(f))continue;let j;try{const t=fs.readFileSync(f,"utf8");j=JSON.parse(t.slice(t.indexOf("{")));}catch(_){continue;}if(j.scroll)rows.push({pair:i,...j.scroll});}
  out.scroll[who]={raw:rows,median:Object.fromEntries(['totalMs','maxFrameMs','medianFrameMs','longTaskCount','longTaskTotalMs','maxLongTaskMs'].map(k=>[k,med(rows.map(r=>r[k]))]))};}
console.log(JSON.stringify(out,null,1));
