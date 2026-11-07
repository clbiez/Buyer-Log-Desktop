'use strict';
// Complete only the batches the unchanged npm runner did not execute after a
// failure. Preserve that failure and every native Node exit code; never report
// this continuation as a successful npm test. No test or runner is rewritten.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');
const app=process.cwd(),out=__dirname,runner=path.join(app,'tests/run-tests.js');
const source=fs.readFileSync(runner,'utf8'),canonical=fs.readFileSync(path.join(out,'full.log'),'utf8');
if(!canonical.includes('başarısız. ZIP teslim edilmemeli.'))throw Error('A failed canonical npm run is required');
const context={require,__dirname:path.dirname(runner),process:{argv:[process.execPath,runner],env:process.env,execPath:process.execPath},console};
const boundary=source.indexOf('const startedAt =');if(boundary<0)throw Error('Runner planning boundary changed');
vm.runInNewContext(source.slice(0,boundary)+';this.plan={files:tests.length,testConcurrency,batches};',context);
const plan=JSON.parse(JSON.stringify(context.plan));
const summary=text=>Object.fromEntries([...text.matchAll(/^(?:ℹ |# )(tests|pass|fail|cancelled|skipped|todo) (\d+)$/gm)].map(m=>[m[1],Number(m[2])]));
const finished=[...canonical.matchAll(/\[Buyer Log tests\] Batch (\d+)\/(\d+) süresi:/g)].map(m=>Number(m[1]));
const completed=Math.max(0,...finished);if(!completed||completed>=plan.batches.length)throw Error('No unexecuted batch remains');
const starts=[...canonical.matchAll(/\[Buyer Log tests\] Batch (\d+)\/(\d+) \(\d+ dosya\)/g)];
const report={schemaVersion:1,synthetic:true,canonicalNpmPassed:false,runnerSha256:crypto.createHash('sha256').update(source).digest('hex'),
  files:plan.files,testConcurrency:plan.testConcurrency,plannedBatches:plan.batches.length,canonicalCompletedBatches:completed,batches:[],allBatchesRun:false};
for(let i=0;i<completed;i++){
  const slice=canonical.slice(starts[i].index,starts[i+1]?.index??canonical.length);
  report.batches.push({batch:i+1,files:plan.batches[i].length,origin:'npm test',exitCode:slice.includes(`Batch ${i+1} başarısız`)?1:0,...summary(slice),log:'full.log'});
}
const persist=()=>fs.writeFileSync(path.join(out,'full-batch-results.json'),JSON.stringify(report,null,2)+'\n');persist();
for(let i=completed;i<plan.batches.length;i++){
  const log=`full-batch-${i+1}.log`,fd=fs.openSync(path.join(out,log),'wx'),args=['--test',`--test-concurrency=${plan.testConcurrency}`,...plan.batches[i]];
  const started=Date.now();let result;
  try{result=spawnSync(process.execPath,args,{cwd:app,env:{...process.env,BUYER_LOG_TEST_SUITE:'1'},stdio:['ignore',fd,fd],windowsHide:true});}
  finally{fs.closeSync(fd);}
  report.batches.push({batch:i+1,files:plan.batches[i].length,origin:'native continuation',exitCode:result.status,signal:result.signal,
    error:result.error?.message,elapsedMs:Date.now()-started,...summary(fs.readFileSync(path.join(out,log),'utf8')),log,args});
  persist();console.log(`Continuation batch ${i+1}/${plan.batches.length}: exit ${result.status}`);
}
report.allBatchesRun=report.batches.length===plan.batches.length;
report.total={tests:0,pass:0,fail:0,skipped:0,cancelled:0};
for(const batch of report.batches)for(const key of Object.keys(report.total))report.total[key]+=batch[key]||0;
persist();process.exitCode=report.batches.some(batch=>batch.exitCode!==0)?1:0;
