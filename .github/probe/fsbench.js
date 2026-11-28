'use strict';
// Küçük dosya G/Ç mikro ölçümü (CI teşhisi): N dosya yaz → rename → oku → sil; dizin argümanı.
const fs=require('fs'),path=require('path');
const root=fs.mkdtempSync(path.join(process.argv[2],'fsbench-'));const N=4000;const t0=performance.now();
for(let i=0;i<N;i++){const f=path.join(root,'f'+i+'.json');fs.writeFileSync(f+'.tmp',JSON.stringify({i,pad:'x'.repeat(512)}));fs.renameSync(f+'.tmp',f);}
const t1=performance.now();for(let i=0;i<N;i++)JSON.parse(fs.readFileSync(path.join(root,'f'+i+'.json'),'utf8'));
const t2=performance.now();fs.rmSync(root,{recursive:true,force:true});const t3=performance.now();
console.log(JSON.stringify({dir:process.argv[2],files:N,writeRenameMs:Math.round(t1-t0),readMs:Math.round(t2-t1),rmMs:Math.round(t3-t2),totalMs:Math.round(t3-t0)}));
