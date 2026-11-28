const rows=require('fs').readFileSync(process.argv[2],'utf8').trim().split('\n').map(JSON.parse);
const med=a=>{const s=a.slice().sort((x,y)=>x-y);return s.length%2?s[s.length>>1]:(s[s.length/2-1]+s[s.length/2])/2;};
const blocks=[...new Set(rows.map(r=>r.block))];const out=[];
for(const b of blocks){const rs=rows.filter(r=>r.block===b);const arms=[...new Set(rs.map(r=>r.arm))];const o={block:b};
 for(const k of ['build','prep','client','decide','cpuMs']){const [x,y]=arms.map(a=>med(rs.filter(r=>r.arm===a).map(r=>r[k])));o[k]=`${x.toFixed(0)} → ${y.toFixed(0)} (${(y-x>=0?'+':'')+(y-x).toFixed(0)}, ${((y-x)/x*100).toFixed(1)}%)`;}
 out.push(o);}
console.table(out);console.log('runtime',rows[0].runtime,'cp',rows[0].cp,'orders',rows[0].orders);
