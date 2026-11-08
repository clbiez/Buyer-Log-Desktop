'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),cp=require('node:child_process');
const fork=cp.fork,spawned=[];cp.fork=function(...args){const child=fork.apply(this,args);spawned.push({child,args});return child;};
const Parser=require('../server/lib/parser-process-client');cp.fork=fork;
const eml=i=>({name:`report-${i}.eml`,buffer:Buffer.from(`From: fixture@example.invalid\r\nSubject: Synthetic ${i}\r\nContent-Type: text/plain\r\n\r\nSynthetic report ${i}`)});
test('INT-11: queued interactive work passes background imports without preempting active work',async()=>{
 const client=Parser.createParserClient({workerFile:path.join(__dirname,'helpers/parser-process-fixture.cjs')}),order=[];
 const first=client.run('spin',{ms:100}).then(()=>order.push('active'));
 const background=client.run('echo',{}, {priority:'background'}).then(()=>order.push('background'));
 const interactive=client.run('echo',{}, {priority:'interactive'}).then(()=>order.push('interactive'));
 await Promise.all([first,background,interactive]);assert.deepEqual(order,['active','interactive','background']);
});
test('INT-11: five small reports use two fresh bounded processes and keep parent evidence IDs',async()=>{
 const start=spawned.length,staged=new Map();
 const output=await require('../server/lib/test-reports/isolated-extract').processFiles(Array.from({length:5},(_,i)=>eml(i)),{stage:file=>{const id='parent-'+staged.size;staged.set(id,file);return id;}});
 assert.equal(output.files.length,5);assert.equal(spawned.length-start,2);
 for(const file of output.files)for(const source of file.sources)assert.ok(staged.has(source.fileId));
 await require('../server/lib/test-reports/isolated-extract').processFiles([eml(9)]);
 assert.equal(spawned.length-start,3,'the next job cannot inherit a previous process');
 for(const {args} of spawned.slice(start))assert.deepEqual(args[2].execArgv,['--max-old-space-size=256']);
});
test('INT-11: batch admission checks count, aggregate bytes and every ZIP before extraction',async()=>{
 await assert.rejects(Parser.run('test-report-batch',{files:Array.from({length:5},(_,i)=>eml(i))}),{code:'FILE_PARSE_LIMIT'});
 await assert.rejects(Parser.run('test-report-batch',{files:[eml(1),{name:'bad.zip',buffer:Buffer.from('PKbad zip')}]}),{code:'FILE_PARSE_ZIP'});
 assert.deepEqual(Parser.stats(),{active:false,pending:0,queuedBytes:0});
});
