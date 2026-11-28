// Priority/karar etkisi: main okuma modeli satırı (R) ↔ aynı satır yeni birincil segment kuralıyla (U), aynı motor.
const APP=process.argv[2],rows=require(process.argv[3]);
const BR=require(APP+'/public/business-rules.js'),CRE=require(APP+'/public/cp-readiness-engine.js');
const ord=v=>{if(v==null||v==='')return null;const s=String(v).slice(0,10);const m=s.match(/^(\d{4})-(\d{2})-(\d{2})$/);if(!m){const d=new Date(v);return isNaN(d)?null:Math.trunc(Date.UTC(d.getFullYear(),d.getMonth(),d.getDate())/864e5);}return Math.trunc(Date.UTC(+m[1],m[2]-1,+m[3])/864e5);};
const today=ord(process.env.TODAY||'2026-11-28');
const ruleSets={'tek kural 35 gün':[{id:'t',delType:'',days:35}],'Gemi70/Uçak15/TIR20':[{id:'g',delType:'Gemi',days:70},{id:'u',delType:'Uçak',days:15},{id:'t',delType:'TIR',days:20}]};
const cat=segs=>{const st=s=>BR.operationalStageOf(s.status);const p=segs.filter(s=>s.kind==='partial'),prod=segs.some(s=>s.kind==='production'),sh=segs.some(s=>s.kind==='shortage');
 if(!p.length)return prod?'yalnız üretim':'diğer';if(sh)return 'kıtlık + parsiyel';
 if(prod){if(p.every(s=>st(s)==='PRODUCTION'&&!(s.quantity>0)))return 'miktar-0 parsiyel + üretim';if(p.some(s=>st(s)==='IN_WAREHOUSE'))return 'üretim + depoda';return 'üretim + yolda/yüklemede';}
 return 'üretimsiz parsiyel';};
const out={};
for(const [rsName,rules] of Object.entries(ruleSets)){const res=out[rsName]={};
 for(const row of rows){const segs=row._logisticSegments||[];if(!segs.length)continue;const c=cat(segs);const r=res[c]=res[c]||{n:0,stageChg:0,outcome:{},critical:{lost:0,gained:0,both:0},reasons:{}};r.n++;
  const p=BR.selectPrimaryLogisticSegment(segs);const nu={...row,STATUS:p.status,'Ant. Arrival':p.arrival,'Del. Type':BR.normalizeTransitDelType(p.delType)||p.delType,'HANDOVER Tarihi':p.handover};
  const a=CRE.analyzeOrder(row,{transitRules:rules,today,dateOrdinal:ord}),b=CRE.analyzeOrder(nu,{transitRules:rules,today,dateOrdinal:ord});
  if(a.stage!==b.stage)r.stageChg++;
  if(a.deliveryOutcome!==b.deliveryOutcome){const k=a.deliveryOutcome+'→'+b.deliveryOutcome;r.outcome[k]=(r.outcome[k]||0)+1;}
  const crit=x=>x.daysToLoad!=null&&x.daysToLoad<0&&(x.deliveryOutcome==='EXPECTED_LATE'||x.deliveryOutcome==='ALREADY_LATE');
  if(crit(a)&&!crit(b))r.critical.lost++;else if(!crit(a)&&crit(b))r.critical.gained++;else if(crit(a))r.critical.both++;
  const ra=new Set(a.riskReasons),rb=new Set(b.riskReasons);for(const x of rb)if(!ra.has(x))r.reasons['+'+x]=(r.reasons['+'+x]||0)+1;for(const x of ra)if(!rb.has(x))r.reasons['-'+x]=(r.reasons['-'+x]||0)+1;}}
console.log(JSON.stringify(out,null,1));
