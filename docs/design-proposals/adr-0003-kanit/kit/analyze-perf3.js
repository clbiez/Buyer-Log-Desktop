'use strict';
// perf3/fresh2 blok sonuçlarının kol özeti. node analyze-perf3.js <DIR>  (DIR: b<blok>-<kol>.perf.json, b<blok>-<kol>.fresh.json)
// Kol başına tür başına medyan (ham örnekler ayrıca), A/A gürültü bandı = |birleşik − A/A| medyan farkı. Kolda 200 dönmeyen tür → N/A.
const fs=require('fs'),path=require('path');const DIR=process.argv[2];
const med=a=>{const s=a.filter(Number.isFinite).sort((x,y)=>x-y);if(!s.length)return null;const m=s.length>>1;return s.length%2?s[m]:(s[m-1]+s[m])/2;};
const r0=x=>x==null?'—':Math.round(x);
const files=fs.readdirSync(DIR);const arms={};
for(const f of files){const m=/^b(\d+)-(\w+)\.(perf|fresh)\.json$/.exec(f);if(!m)continue;let j;try{j=JSON.parse(fs.readFileSync(path.join(DIR,f),'utf8'));}catch(_){continue;}
  const a=arms[m[2]]||(arms[m[2]]={perf:[],fresh:[]});a[m[3]].push({block:+m[1],...j});}
const out=[];const kinds=new Set();for(const a of Object.values(arms))for(const p of a.perf)for(const s of p.saves||[])kinds.add(s.kind);
const pick=(a,fn)=>a.perf.flatMap(fn);
const table={};
for(const [arm,a] of Object.entries(arms)){const t=table[arm]={version:(a.perf[0]||{}).version,runs:a.perf.length,errors:a.perf.flatMap(p=>p.errors||[]).length+a.fresh.flatMap(p=>p.errors||[]).length};
  t.coldOrders=pick(a,p=>[p.startup&&p.startup.cold&&p.startup.cold.ordersFirstRowMs]);t.warmOrders=pick(a,p=>[p.startup&&p.startup.warm&&p.startup.warm.ordersFirstRowMs]);
  t.coldServer=pick(a,p=>[p.startup&&p.startup.cold&&p.startup.cold.serverReadyMs]);t.warmServer=pick(a,p=>[p.startup&&p.startup.warm&&p.startup.warm.serverReadyMs]);
  t.seriesCpu=pick(a,p=>[p.serverCpuSeriesMs]);
  t.s503=pick(a,p=>(p.saves||[]).map(s=>(s.save&&s.save.status===503?1:0)+((s.cp&&s.cp.attempts||1)-1)+((s.orders&&s.orders.attempts||1)-1)+(s.cp&&s.cp.status===503?1:0))).reduce((x,y)=>x+y,0);
  t.kinds={};for(const k of kinds){const ss=pick(a,p=>(p.saves||[]).filter(s=>s.kind===k));const ok=ss.filter(s=>s.save&&s.save.status===200);
    t.kinds[k]=ok.length?{n:ok.length,ack:ok.map(s=>s.ackMs),cp:ok.map(s=>s.cpReadyMs),orders:ok.map(s=>s.ordersReadyMs),cpu:ok.map(s=>s.cpuMs)}:{na:[...new Set(ss.map(s=>s.na||(s.save&&(s.save.status+' '+(s.save.code||'')))))].join(', ')||'koşu yok'};}
  const tr=a.fresh.flatMap(f=>f.trials||[]);t.fresh={n:tr.length,cpState:tr.map(x=>x.cpState),cpDom:tr.map(x=>x.cpDom),ordersState:tr.map(x=>x.ordersState),ordersDom:tr.map(x=>x.ordersDom),ack:tr.map(x=>x.ackMs),missing:tr.filter(x=>x.cpDom==null||x.ordersDom==null).length};}
fs.writeFileSync(path.join(DIR,'perf-ozet.json'),JSON.stringify(table,null,1));
const A=Object.keys(table).sort();out.push('kollar: '+A.map(k=>`${k}=${table[k].version} (${table[k].runs} koşu, hata ${table[k].errors})`).join(' · '));
const row=(label,fn)=>out.push(`| ${label} | `+A.map(k=>fn(table[k])).join(' | ')+' |');
out.push('','| ölçüt (medyan ms) | '+A.join(' | ')+' |','|---|'+A.map(()=>'---').join('|')+'|');
row('soğuk: süreç → /api/status',t=>r0(med(t.coldServer)));row('soğuk: Siparişler ilk satır',t=>r0(med(t.coldOrders)));
row('ılık: süreç → /api/status',t=>r0(med(t.warmServer)));row('ılık: Siparişler ilk satır',t=>r0(med(t.warmOrders)));
for(const k of kinds){for(const [m,lab] of [['ack','ack'],['cp','kendi CP hazır'],['orders','Siparişler hazır'],['cpu','pencere CPU-ms']])row(`${k}: ${lab}`,t=>t.kinds[k].na?`N/A (${t.kinds[k].na})`:r0(med(t.kinds[k][m])));}
row('diğer istemci Del. Type: ack',t=>r0(med(t.fresh.ack)));row('diğer istemci: CP state',t=>r0(med(t.fresh.cpState)));row('diğer istemci: CP DOM',t=>r0(med(t.fresh.cpDom)));
row('diğer istemci: Siparişler state',t=>r0(med(t.fresh.ordersState)));row('diğer istemci: Siparişler DOM',t=>r0(med(t.fresh.ordersDom)));row('diğer istemci: 90 sn içinde görünmeyen',t=>`${t.fresh.missing}/${t.fresh.n}`);
row('kayıt serisi toplam sunucu CPU-ms',t=>r0(med(t.seriesCpu)));row('503 (toplam)',t=>t.s503);
console.log(out.join('\n'));
