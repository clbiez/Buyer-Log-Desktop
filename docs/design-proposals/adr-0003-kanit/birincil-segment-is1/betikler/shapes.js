const d=require(process.argv[2]);const BR=require('/home/user/Buyer-Log-Desktop/resources/app/public/business-rules.js');
const cnt={},stg=s=>BR.operationalStageOf(s);
for(const [k,r] of Object.entries(d.rows)){const sh=r.segs.map(s=>s[0]+':'+stg(s[1])+(s[5]>0?'':'(0)')+(s[6]?'/'+s[6]:''));const key=[...new Set(sh)].sort().join(' + ');cnt[key]=(cnt[key]||0)+1;}
console.log(Object.entries(cnt).sort((a,b)=>b[1]-a[1]).map(([k,v])=>v+'\t'+k).join('\n'));
