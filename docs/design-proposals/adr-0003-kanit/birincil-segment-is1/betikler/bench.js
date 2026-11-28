// L2 mikro A/B: prepareCpRows (sunucu) + rebuildCpLogisticCaches (istemci) 24.982 satır, main ↔ aday dönüşümlü.
const path=require('path');const [MAIN,CAND,ROWS]=process.argv.slice(2);const rows=require(ROWS);const json=JSON.stringify(rows);
function load(app){const prep=require(path.join(app,'server/lib/read-model/overview-row-prep.js'));
 const {loadAppMainFunctions}=require(path.join(app,'tests/helpers/app-main-functions.js'));
 const BR=require(path.join(app,'public/business-rules.js'));
 const c=loadAppMainFunctions(['norm','toNum','turknorm','makeDateOnly','dateOnlyFromDateObject','excelSerialToDateOnly','coerceDateLoose','normalizeTransitDelType','cpLogisticSegments','rebuildCpLogisticCaches'],{BLBusinessRules:BR,ISO_DAY_CACHE_MAX:20000,_isoDayCache:new Map()});
 return {prep,c};}
const arms={A:load(MAIN),B:load(CAND)};const res={A:{prep:[],client:[]},B:{prep:[],client:[]}};
const order=process.env.ORDER||'ABBAABBAABBA';
for(const arm of order){const {prep,c}=arms[arm];if(global.gc)global.gc();
 let r=JSON.parse(json);let t=process.hrtime.bigint();prep.prepareCpRows(r);res[arm].prep.push(Number(process.hrtime.bigint()-t)/1e6);
 r=JSON.parse(json);if(global.gc)global.gc();t=process.hrtime.bigint();for(const row of r)if(c.cpLogisticSegments(row).length)c.rebuildCpLogisticCaches(row);res[arm].client.push(Number(process.hrtime.bigint()-t)/1e6);}
const med=a=>{const s=a.slice().sort((x,y)=>x-y);return s[s.length>>1];};
console.log(JSON.stringify({order,median:{A:{prep:med(res.A.prep),client:med(res.A.client)},B:{prep:med(res.B.prep),client:med(res.B.client)}},raw:res}));
