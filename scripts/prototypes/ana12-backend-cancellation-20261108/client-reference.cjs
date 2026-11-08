'use strict';
// Materialize the pinned client contribution in /tmp; preserve every assertion.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{execFileSync}=require('node:child_process'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'../../..'),pin='6060c6b0e66a65ef0b8f5c2c4ee4e44f193f8f7b';
const destination=fs.mkdtempSync(path.join(os.tmpdir(),'ana12-client-reference-'));
const files=execFileSync('git',['ls-tree','-r','--name-only',pin],{cwd:root,encoding:'utf8'}).trim().split('\n').filter(file=>
 file==='resources/app/public/backlog-request-lifecycle.js'||file.startsWith('resources/app/tests/ana12-request-lifecycle-')||file.startsWith('resources/app/tests/fixtures/ana12-request-lifecycle/'));
// Current pinned production sources support the original VM source assertions.
const publicFiles=['backlog-overview.js','backlog-chart.js','backlog-plan-actual.js'];
for(const name of publicFiles){const relative='resources/app/public/'+name,target=path.join(destination,relative);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(path.join(root,relative),target);}
const sha256={};for(const file of files){const bytes=execFileSync('git',['show',pin+':'+file],{cwd:root});const target=path.join(destination,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,bytes);sha256[file]=crypto.createHash('sha256').update(bytes).digest('hex');}
const tests=files.filter(file=>file.endsWith('.test.js')).map(file=>path.join(destination,file));
console.log(JSON.stringify({pin,destination,assertionsChanged:false,sha256}));
try{execFileSync(process.execPath,['--test','--test-reporter=tap','--test-concurrency=1',...tests],{cwd:root,stdio:'inherit'});}
catch(error){process.exitCode=error.status||1;}
