// Karar/risk etkisi ayrıntı: satır sayıları, yön, örnekler. node prio2.js <APP> <main-full.json>
const APP=process.argv[2],rows=require(process.argv[3]);
const BR=require(APP+'/public/business-rules.js'),CRE=require(APP+'/public/cp-readiness-engine.js');
const ord=v=>{if(v==null||v==='')return null;const s=String(v).slice(0,10);const m=s.match(/^(\d{4})-(\d{2})-(\d{2})$/);if(!m){const d=new Date(v);return isNaN(d)?null:Math.trunc(Date.UTC(d.getFullYear(),d.getMonth(),d.getDate())/864e5);}return Math.trunc(Date.UTC(+m[1],m[2]-1,+m[3])/864e5);};
const today=ord('2026-11-28');const rules=[{id:'g',delType:'Gemi',days:70},{id:'u',delType:'Uçak',days:15},{id:'t',delType:'TIR',days:20}];
const st=s=>BR.operationalStageOf(s.status);
const cat=segs=>{const p=segs.filter(s=>s.kind==='partial'),prod=segs.some(s=>s.kind==='production');if(!p.length||!prod)return null;
 if(p.every(s=>st(s)==='PRODUCTION'&&!(s.quantity>0)))return 'miktar-0 parsiyel + üretim';if(p.some(s=>st(s)==='IN_WAREHOUSE'))return 'üretim + depoda';return 'üretim + yolda/yüklemede';};
const d=v=>v?String(v).slice(0,10):'—';const res={};
for(const row of rows){const segs=row._logisticSegments||[];const c=cat(segs);if(!c)continue;const r=res[c]=res[c]||{n:0,degisen:0,yon:{},sinyalEklenen:{},sinyalKalkan:{},ornek:[]};r.n++;
 const p=BR.selectPrimaryLogisticSegment(segs);const nu={...row,STATUS:p.status,'Ant. Arrival':p.arrival,'Del. Type':BR.normalizeTransitDelType(p.delType)||p.delType,'HANDOVER Tarihi':p.handover};
 const a=CRE.analyzeOrder(row,{transitRules:rules,today,dateOrdinal:ord}),b=CRE.analyzeOrder(nu,{transitRules:rules,today,dateOrdinal:ord});
 const ra=new Set(a.riskReasons),rb=new Set(b.riskReasons);const add=[...rb].filter(x=>!ra.has(x)),rem=[...ra].filter(x=>!rb.has(x));
 const changed=a.deliveryOutcome!==b.deliveryOutcome||add.length||rem.length;if(!changed)continue;r.degisen++;
 const k=a.deliveryOutcome+' → '+b.deliveryOutcome;r.yon[k]=(r.yon[k]||0)+1;add.forEach(x=>r.sinyalEklenen[x]=(r.sinyalEklenen[x]||0)+1);rem.forEach(x=>r.sinyalKalkan[x]=(r.sinyalKalkan[x]||0)+1);
 if(r.ornek.length<2&&a.deliveryOutcome!==b.deliveryOutcome)r.ornek.push({satir:`${row['Order Code']}/${row['C.Code']}`,exFactory:d(row['Ex-factory']),retail:d(row['Retail Date']),
  segmentler:segs.map(s=>`${s.kind}:${s.status}:${s.quantity}:${s.delType}:${d(s.arrival)}:HO ${d(s.handover)}`),
  once:`${row.STATUS} · ${row['Del. Type']} · ${d(row['Ant. Arrival'])} → ${a.deliveryOutcome} [${a.riskReasons.join(',')}]`,sonra:`${nu.STATUS} · ${nu['Del. Type']} · ${d(nu['Ant. Arrival'])} → ${b.deliveryOutcome} [${b.riskReasons.join(',')}]`});}
console.log(JSON.stringify(res,null,1));
