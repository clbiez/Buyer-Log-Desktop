const path=require('path'),[MAIN,CAND,ROWS]=process.argv.slice(2);const rows=require(ROWS);
const prep=require(path.join(CAND,'server/lib/read-model/overview-row-prep.js'));const R=JSON.parse(JSON.stringify(rows));prep.prepareCpRows(R);
const B={A:require(path.join(MAIN,'public/business-rules.js')),B:require(path.join(CAND,'public/business-rules.js'))};
const ordD=v=>{if(v==null||v==='')return null;if(typeof v==='number')return v;const d=v instanceof Date?v:new Date(v);return isNaN(d)?null:Math.trunc(Date.UTC(d.getFullYear(),d.getMonth(),d.getDate())/864e5);};
const today=ordD(new Date());const TR=[{id:'g',delType:'Gemi',days:70}];
const run=arm=>{const t=process.hrtime.bigint();for(let k=0;k<4;k++)for(const r of R)B[arm].computePriorityFlags({exFactory:r['Ex-factory'],retailDate:r['Retail Date'],inStoreDate:r['In-Store (Model Budget)'],antArrival:r['Ant. Arrival'],handoverDate:r['HANDOVER Tarihi'],shipConfirmationDate:r['Buying Son Onay Tarihi'],status:r.STATUS,shortage:Number(r._logisticShortageQty)>0,shortageQty:r._logisticShortageQty,logisticSegments:r._logisticSegments,delType:r['Del. Type'],season:r.Season,country:r.Country,rules:TR,today},ordD);return Number(process.hrtime.bigint()-t)/1e6/4;};
const res={A:[],B:[]};for(const a of 'ABBAABBAABBAABBAABBA'){if(global.gc)global.gc();res[a].push(run(a));}
const med=a=>a.slice().sort((x,y)=>x-y)[a.length>>1];console.log('computePriorityFlags ms/25k satır  main',med(res.A).toFixed(1),'aday',med(res.B).toFixed(1),'| main',res.A.map(x=>x.toFixed(0)).join(','),'| aday',res.B.map(x=>x.toFixed(0)).join(','));
