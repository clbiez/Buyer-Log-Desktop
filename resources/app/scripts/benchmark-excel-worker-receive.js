'use strict';
// Taze süreçte yalnız sabit, sentetik startup fixture'ını ölçer.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),v8=require('node:v8');
const {performance}=require('node:perf_hooks');
const source=path.resolve(process.argv[2]||''),file=path.join(source,'ASAS - Demo.xlsx');
if(path.basename(source)!=='source'||path.dirname(path.dirname(source))!==os.tmpdir()||!path.basename(path.dirname(source)).startsWith('buyerlog-startup-'))throw Error('Synthetic startup fixture required');
const manifest=JSON.parse(fs.readFileSync(path.join(source,'benchmark-fixture.json'),'utf8'));
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
if(manifest.synthetic!==true||sha(fs.readFileSync(file))!==manifest.hashes?.['ASAS - Demo.xlsx'])throw Error('Synthetic source checksum mismatch');
(async()=>{
 const {createExcelWorkerClient}=require('../server/excel-worker-client'),client=createExcelWorkerClient({maxWorkers:1});let metrics;
 const start=performance.now(),result=await client.runExcelTask('parseAsasFile',{fullPath:file},{onMetrics:value=>{metrics=value;}}),totalMs=performance.now()-start;
 if(result.parsedAsas?.orders?.length!==manifest.rows||metrics?.resultTransport!=='message-port')throw Error('Incomplete native worker measurement');
 const typedBytes=v8.serialize(result);
 process.stdout.write(JSON.stringify({status:'passed',revision:require('node:child_process').execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8',cwd:path.join(__dirname,'..')}).trim(),
   environment:{platform:process.platform,node:process.version,availableParallelism:os.availableParallelism()},sourceSha256:manifest.hashes['ASAS - Demo.xlsx'],rows:manifest.rows,totalMs,metrics,resultV8Bytes:typedBytes.length,resultSha256:sha(typedBytes)})+'\n');
})().catch(error=>{process.stderr.write(String(error.stack||error)+'\n');process.exitCode=1;});
