'use strict';
// Root-only tiny native boundary proof. Not a timing/30k/browser benchmark.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const at=process.argv.indexOf('--label'),label=at>=0?process.argv[at+1]:null;assert.ok(/^[A-Za-z0-9_-]{1,8}$/.test(label),'unique short --label required');
assert.equal(process.env.READY_MODEL_COST_LOCK,'held','root must serialize with existing measurement lock');
const output=path.join(__dirname,'r',label);assert.ok(!fs.existsSync(output),'preserve prior evidence; label must be new');fs.mkdirSync(output,{recursive:true});
const report={status:'running',startedAt:new Date().toISOString(),preparation:'only root executes',classification:'inadmissible default CP candidate; boundary proof only'};
require('./boundaries.cjs').run().then(evidence=>{report.status='observed-rejection';report.evidence=evidence;}).catch(error=>{report.status='failed';report.error={name:error.name,message:error.message,stack:error.stack};process.exitCode=1;}).finally(()=>{report.finishedAt=new Date().toISOString();fs.writeFileSync(path.join(output,'result.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify({status:report.status,file:path.join(output,'result.json')}));});
