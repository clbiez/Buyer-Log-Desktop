// Aynı süreçte karar (analyzeOrder) main ↔ aday, dönüşümlü; hazırlanmış 30k CP satırı.
const path=require('path'),[MAIN,CAND,ROWS]=process.argv.slice(2);
const rows=require(ROWS);const prep=require(path.join(CAND,'server/lib/read-model/overview-row-prep.js'));const json=JSON.stringify(rows);
const E={A:require(path.join(MAIN,'public/cp-readiness-engine.js')),B:require(path.join(CAND,'public/cp-readiness-engine.js'))};
const TR=[{id:'g',delType:'Gemi',days:70},{id:'u',delType:'Uçak',days:15},{id:'t',delType:'TIR',days:20}];
const ordD=v=>{if(v==null||v==='')return null;const d=v instanceof Date?v:new Date(v);return isNaN(d)?null:Math.trunc(Date.UTC(d.getFullYear(),d.getMonth(),d.getDate())/864e5);};
const today=ordD(new Date());const res={A:[],B:[]};const set={A:JSON.parse(json),B:JSON.parse(json)};prep.prepareCpRows(set.A);prep.prepareCpRows(set.B);
for(const arm of (process.env.ORDER||'ABBAABBAABBAABBA')){if(global.gc)global.gc();const t=process.hrtime.bigint();for(const r of set[arm])E[arm].analyzeOrder(r,{transitRules:process.env.NORULE?[]:TR,today,dateOrdinal:ordD});res[arm].push(Number(process.hrtime.bigint()-t)/1e6);}
const med=a=>a.slice().sort((x,y)=>x-y)[a.length>>1];console.log(JSON.stringify({A:med(res.A).toFixed(1),B:med(res.B).toFixed(1),rawA:res.A.map(x=>x.toFixed(0)).join(','),rawB:res.B.map(x=>x.toFixed(0)).join(',')}));
