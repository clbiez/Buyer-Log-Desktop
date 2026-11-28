// Risk/sinyal taraması: main okuma modeli satırı (R) ↔ yeni birincil (U). Sinyal ve risk sebebi bazında eklenen/kalkan.
const APP=process.argv[2],rows=require(process.argv[3]);
const MAINAPP=process.env.MAINAPP;const BR=require(APP+'/public/business-rules.js'),CRE=require(APP+'/public/cp-readiness-engine.js');const CREm=require(MAINAPP+'/public/cp-readiness-engine.js');
const ord=v=>{if(v==null||v==='')return null;const s=String(v).slice(0,10);const m=s.match(/^(\d{4})-(\d{2})-(\d{2})$/);if(!m){const d=new Date(v);return isNaN(d)?null:Math.trunc(Date.UTC(d.getFullYear(),d.getMonth(),d.getDate())/864e5);}return Math.trunc(Date.UTC(+m[1],m[2]-1,+m[3])/864e5);};
const today=ord(process.env.TODAY||'2026-11-28');
const sets={'Gemi70/Uçak15/TIR20':[{id:'g',delType:'Gemi',days:70},{id:'u',delType:'Uçak',days:15},{id:'t',delType:'TIR',days:20}],'kural yok':[]};
const st=s=>BR.operationalStageOf(s.status);
const cat=segs=>{const p=segs.filter(s=>s.kind==='partial'),prod=segs.some(s=>s.kind==='production');if(!p.length||!prod)return 'diğer';
 if(p.every(s=>st(s)==='PRODUCTION'&&!(s.quantity>0)))return 'miktar-0 parsiyel + üretim';if(p.some(s=>st(s)==='IN_WAREHOUSE'))return 'üretim + depoda';return 'üretim + yolda/yüklemede';};
const out={};
for(const [name,rules] of Object.entries(sets)){const res=out[name]={};
 for(const row of rows){const segs=row._logisticSegments||[];if(!segs.length)continue;const c=cat(segs);const p=BR.selectPrimaryLogisticSegment(segs);
  const nu={...row,STATUS:p.status,'Ant. Arrival':p.arrival,'Del. Type':BR.normalizeTransitDelType(p.delType)||p.delType,'HANDOVER Tarihi':p.handover};
  const a=CREm.analyzeOrder(row,{transitRules:rules,today,dateOrdinal:ord}),b=CRE.analyzeOrder(nu,{transitRules:rules,today,dateOrdinal:ord});
  const codes=x=>new Set([...(x.signals||[]).map(s=>'sinyal:'+s.code),...x.riskReasons.map(r=>'sebep:'+r),'sonuç:'+x.deliveryOutcome]);
  const A=codes(a),B=codes(b);const r=res[c]=res[c]||{n:0};r.n++;
  for(const k of A)if(!B.has(k)){const q=r['- '+k]=r['- '+k]||0;r['- '+k]=q+1;}
  for(const k of B)if(!A.has(k)){r['+ '+k]=(r['+ '+k]||0)+1;}}}
console.log(JSON.stringify(out,null,1));
