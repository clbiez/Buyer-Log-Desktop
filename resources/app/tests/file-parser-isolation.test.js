'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs'),XLSX=require('xlsx'),Zip=require('../public/vendor/jszip.min.js'),Policy=require('../public/file-parser-policy'),{createParserClient}=require('../server/lib/parser-process-client');
const fixture=path.join(__dirname,'helpers/parser-process-fixture.cjs');
test('compressed entry expansion, file bytes and declared workbook ranges are bounded without truncating valid data',async()=>{
 assert.throws(()=>Policy.inspectBytes(Buffer.alloc(0)),{code:'FILE_PARSE_LIMIT'});assert.throws(()=>Policy.inspectBytes(Buffer.alloc(Policy.LIMITS.bytes+1)),{code:'FILE_PARSE_LIMIT'});
 const zip=new Zip();zip.file('sheet.xml','synthetic');const bytes=await zip.generateAsync({type:'nodebuffer'});assert.equal(Policy.inspectBytes(bytes).zip,true);
 const central=bytes.indexOf(Buffer.from([0x50,0x4b,0x01,0x02]));bytes.writeUInt32LE(Policy.LIMITS.expandedBytes+1,central+24);assert.throws(()=>Policy.inspectBytes(bytes),{code:'FILE_PARSE_LIMIT'});
 const wb={SheetNames:['safe'],Sheets:{safe:{'!ref':'A1:B2',A1:{v:1}}}};assert.equal(Policy.inspectWorkbook(wb),wb);wb.Sheets.safe['!fullref']='A1:A'+(Policy.LIMITS.rows+1);assert.throws(()=>Policy.inspectWorkbook(wb),{code:'FILE_PARSE_LIMIT'});
});
test('ZIP preflight rejects local allocation lies and verifies actual inflate output, including streamed descriptors',async()=>{
 const verify=require('../server/lib/zip-parser-validation').verify,zip=new Zip();zip.file('safe.xml','x'.repeat(32768));const bytes=await zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'}),central=bytes.indexOf(Buffer.from([0x50,0x4b,0x01,0x02]));
 assert.equal(verify(bytes).expandedBytes,32768);
 const localLie=Buffer.from(bytes);localLie.writeUInt32LE(Policy.LIMITS.expandedBytes+1,22);assert.throws(()=>Policy.inspectBytes(localLie),{code:'FILE_PARSE_ZIP'});
 const bothLie=Buffer.from(bytes);bothLie.writeUInt32LE(0,22);bothLie.writeUInt32LE(0,central+24);assert.equal(Policy.inspectBytes(bothLie).expandedBytes,0);assert.throws(()=>verify(bothLie),{code:'FILE_PARSE_ZIP'},'bounded native inflate rejects underestimated metadata before SheetJS');
 const streamed=await zip.generateAsync({type:'nodebuffer',compression:'DEFLATE',streamFiles:true});assert.equal(verify(streamed).expandedBytes,32768);const descriptor=streamed.indexOf(Buffer.from([0x50,0x4b,0x07,0x08]));assert.ok(descriptor>0);streamed.writeUInt32LE(0,descriptor+12);assert.throws(()=>Policy.inspectBytes(streamed),{code:'FILE_PARSE_ZIP'});
 const unicode=new Zip();unicode.file('ş.xml','safe');const extra=await unicode.generateAsync({type:'nodebuffer',compression:'DEFLATE'}),nameLength=extra.readUInt16LE(26);assert.ok(extra.readUInt16LE(28)>0);extra.writeUInt16LE(1,30+nameLength);assert.throws(()=>Policy.inspectBytes(extra),{code:'FILE_PARSE_ZIP'},'ZIP64 overrides are unsupported within the bounded workbook format');
});
test('a timed-out parser process leaves the parent responsive and releases its slot before the next job',async()=>{
 const client=createParserClient({workerFile:fixture,timeoutMs:2000});let ticks=0;const timer=setInterval(()=>ticks++,5);
 try{await assert.rejects(client.run('spin',{ms:2000},{timeoutMs:100}),{code:'FILE_PARSE_TIMEOUT'});assert.ok(ticks>=5);assert.deepEqual(await client.run('echo',{buffer:Buffer.alloc(3)}),{bytes:3});assert.deepEqual(client.stats(),{active:false,pending:0,queuedBytes:0});}finally{clearInterval(timer);}
});
test('queued parsing is byte bounded, cancellable, and survives child exit without leaking a slot',async()=>{
 const client=createParserClient({workerFile:fixture,maxQueuedBytes:1024,timeoutMs:2000}),first=client.run('spin',{ms:400}),abort=new AbortController(),second=client.run('echo',{buffer:Buffer.alloc(600)},{signal:abort.signal});const cancelled=assert.rejects(second,{code:'FILE_PARSE_CANCELLED'});
 await assert.rejects(client.run('echo',{buffer:Buffer.alloc(600)}),{code:'FILE_PARSE_BUSY'});abort.abort();await cancelled;await first;await assert.rejects(client.run('crash',{}),{code:'FILE_PARSE_EXIT'});assert.deepEqual(await client.run('echo',{}),{bytes:0});assert.equal(client.stats().active,false);
});
test('actual child parser retains TL formula/date contracts and rejects malformed input without mutating any set',async()=>{
 const client=createParserClient(),buffer=require('./helpers/endeksmatik-tl-fixture').buildLegacyTlWorkbook({layout:'w6',season:'WORKER FIXTURE'}),pure=require('../server/lib/endeksmatik').parseImportWorkbook(buffer,'fixture.xlsx'),parsed=await client.run('endeksmatik',{buffer,name:'fixture.xlsx'});
 // Upload timestamps are intentionally generated at parse time, not business inputs.
 assert.ok(Number.isFinite(Date.parse(parsed.snapshot.generatedAt)));
 const omit=value=>JSON.parse(JSON.stringify(value,(key,item)=>['importedAt','createdAt','uploadedAt','validatedAt','generatedAt'].includes(key)?undefined:item));assert.deepEqual(omit(parsed),omit(pure));
 await assert.rejects(client.run('endeksmatik',{buffer:Buffer.from('not an Excel model'),name:'bad.xlsx'}));assert.equal(client.stats().active,false);
});
test('application workbook reads use the patched reader in a worker; every browser PDF entry disables eval',()=>{
 assert.equal(XLSX.version,'0.20.3');const root=path.join(__dirname,'../public'),worker=fs.readFileSync(path.join(root,'file-parser-worker.js'),'utf8');assert.match(worker,/vendor\/xlsx-reader\.min\.js/);assert.match(worker,/inspectWorkbook/);
 for(const file of ['app-main.js','excel-import-wizard.js','open-costing.js','fx.js','pricing-desk.js','transit-analysis-ui.js']){const source=fs.readFileSync(path.join(root,file),'utf8');assert.doesNotMatch(source,/XLSX\.read\(/,file);}
 for(const file of ['app-main.js','layout-document-reader.js','layout-control.js']){const source=fs.readFileSync(path.join(root,file),'utf8');for(const call of source.matchAll(/getDocument\(([^\n]*?)\)\.promise/g))assert.match(call[1],/isEvalSupported:false/,file);}
});
test('isolated mail sources keep their evidence file identifiers in the parent staging namespace',async()=>{
 const crypto=require('node:crypto'),files=new Map(),stage=file=>{const id=crypto.randomBytes(12).toString('hex');files.set(id,file);return id;},buffer=Buffer.from('From: fixture@example.invalid\r\nTo: buyer@example.invalid\r\nSubject: Synthetic report\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nSynthetic unrecognized report body');
 const out=await require('../server/lib/test-reports/extract').processFiles([{name:'fixture.eml',buffer}],{stage});assert.ok(files.size>0);const sources=out.files.flatMap(file=>file.sources);assert.ok(sources.length>0);
 for(const source of sources)assert.ok(files.has(source.fileId),'source evidence must resolve in the actual parent session, not the terminated child');
 for(const file of out.files)if(file.ai?.uploadId)assert.ok(files.has(file.ai.uploadId));
});
