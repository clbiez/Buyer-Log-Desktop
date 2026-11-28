const A=require('/tmp/claude-0/m/main.json'),B=require('/tmp/claude-0/m/cand.json');const BR=require('/home/user/Buyer-Log-Desktop/resources/app/public/business-rules.js');
const st=s=>BR.operationalStageOf(s);
const cat=segs=>{const p=segs.filter(s=>s[0]==='partial'),prod=segs.some(s=>s[0]==='production'),sh=segs.some(s=>s[0]==='shortage');
 if(!p.length)return prod?'yalnız üretim':'diğer';if(sh)return 'kıtlık + parsiyel';
 if(prod){if(p.every(s=>st(s[1])==='PRODUCTION'&&!(s[5]>0)))return 'miktar-0 parsiyel + üretim';if(p.some(s=>st(s[1])==='IN_WAREHOUSE'))return 'üretim + depoda';return 'üretim + yolda/yüklemede';}
 return 'üretimsiz parsiyel';};
const norm=v=>String(v==null?'':v);const out={cp:{},orders:{},cpRawVsRm:{},segChanged:0};
for(const [k,a] of Object.entries(A.rows)){const b=B.rows[k];const c=cat(a.segs);
 if(JSON.stringify(a.segs)!==JSON.stringify(b.segs))out.segChanged++;
 const o=out.cp[c]=out.cp[c]||{n:0};o.n++;for(const f of ['STATUS','DT','ANT','HO','PR'])if(norm(a.rm[f])!==norm(b.rm[f]))o[f]=(o[f]||0)+1;
 const r=out.orders[c]=out.orders[c]||{n:0};r.n++;for(const f of ['STATUS','DT','ANT','HO'])if(norm(a.raw[f])!==norm(b.raw[f]))r[f]=(r[f]||0)+1;
 const x=out.cpRawVsRm[c]=out.cpRawVsRm[c]||{n:0};x.n++;const fold=v=>norm(v).toLocaleUpperCase('tr-TR');for(const f of ['STATUS','DT','ANT','HO'])if(fold(b.rm[f])!==fold(b.raw[f]))x[f]=(x[f]||0)+1;}
let ordChg={n:0};for(const [k,a] of Object.entries(A.orders)){const b=B.orders[k];if(!b){ordChg.missing=(ordChg.missing||0)+1;continue;}ordChg.n++;for(const f of ['STATUS','DT','ANT','HO','PR'])if(norm(a[f])!==norm(b[f]))ordChg[f]=(ordChg[f]||0)+1;}
out.ordersModuleAll=ordChg;console.log(JSON.stringify(out,null,1));
