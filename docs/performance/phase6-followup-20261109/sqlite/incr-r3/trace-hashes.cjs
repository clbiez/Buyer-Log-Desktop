'use strict';
const path=require('node:path'),{execFileSync}=require('node:child_process');
const root=execFileSync('git',['rev-parse','--show-toplevel'],{cwd:__dirname,encoding:'utf8'}).trim();
const {event,query,hash}=require(path.join(root,'scripts/prototypes/sqlite-decision-20261109/workload.cjs'));
const result=[];
for(const size of [1000,10000,200000]){
 let index=size;const trace=[];
 for(let i=0;i<300;i++){const slot=i%10;trace.push(slot<5?{method:'get',id:event(i%size,size).id}:slot<7?{method:'filter',query:query(i,size)}:slot===7?{method:'pending',limit:100}:slot===8?{method:'queuePatch',item:event(index++,size,'mixed')}:{method:'queuePatches',items:Array.from({length:20},()=>event(index++,size,'mixed'))});}
 const ids=Array.from({length:630},(_,i)=>`mixed-${size+i}`);trace.push({method:'markSynced',ids},{method:'markAcknowledged',ids:[ids[0]]},{method:'markAcknowledgedThrough',lastSequence:size+630},{method:'compact',keepUploadedTail:1000});
 result.push({size,seedEvents:size,seedBatch:10000,seedUploadedFraction:.8,mixedOperations:300,addedEvents:index-size,mixedAndMutationTailSha256:hash(trace),counts:{get:150,filter:60,pending:30,singleWrite:30,batch20:30},tail:['three repeated full reads','upload','single ACK','ACK-through','compaction','full oracle','close','fresh process reopen']});
}
console.log(JSON.stringify(result,null,2));
