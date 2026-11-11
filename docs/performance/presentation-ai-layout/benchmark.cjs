'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{performance}=require('node:perf_hooks');
const results=[];
for(const count of [24,240,30000]){
 const layout={columns:3,cardFields:['fit'],studio:{matrix:true,subtitleFields:['fabric'],manualPages:Array.from({length:Math.ceil(count/6)},(_,i)=>({title:'Private source group '+i+' '+ 'X'.repeat(180),tokens:Array.from({length:Math.min(6,count-i*6)},(_,j)=>'KOL-'+(i*6+j+1))}))}};
 const before=JSON.stringify(layout);
 for(let pair=0;pair<3;pair++)for(const base of [true,false]){
  const start=performance.now();let encoded;
  for(let n=0;n<100;n++){
   const safe=base?layout:JSON.parse(JSON.stringify({...layout,studio:{...layout.studio,manualPages:[]}}));encoded=JSON.stringify({layout:safe,fields:['fit','fabric']});
  }
  const ms=(performance.now()-start)/100;
  assert.equal(JSON.stringify(layout),before,'request preparation preserves the draft');
  assert.equal(encoded.includes('Private source group'),base,'source-derived groups are omitted only in the candidate');
  assert.ok(base||ms<50,'new request preparation budget');
  results.push({count,pair,base,preparationMs:ms,requestBytes:Buffer.byteLength(encoded)});
 }
}
fs.writeFileSync(path.join(__dirname,'samples.json'),JSON.stringify(results,null,2)+'\n');console.log(JSON.stringify(results));
