'use strict';
// PREPARED ONLY. Intentionally NONFORMAL; run exclusively through run-diagnostic.py.
// The benchmark module has exactly one source edit. Its filename, relative
// requires, input checks, result extraction, assertions and cleanup stay native.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),Module=require('node:module');
const cp=require('node:child_process'),assert=require('node:assert/strict');
const packet=__dirname,m=JSON.parse(fs.readFileSync(path.join(packet,'prepared-manifest.json'),'utf8'));
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const dir=path.resolve(process.env.ORDERS_DIAGNOSTIC_DIR||'');
assert.ok(dir.startsWith(packet+path.sep+'runs'+path.sep),'private diagnostic directory required');
assert.equal(process.env.TZ,'Europe/Istanbul');assert.equal(process.env.PLAYWRIGHT_MODULE,path.join(packet,'playwright-profile-wrapper.cjs'));
assert.equal(process.env.FIRST_TRANSITION_EXTRA_NAV,undefined,'no extra navigation');
function save(name,value){const file=path.join(dir,name),tmp=file+'.partial';fs.writeFileSync(tmp,JSON.stringify(value,null,2)+'\n');fs.renameSync(tmp,file);}
const code=fs.readFileSync(m.originalFilename);assert.equal(sha(code),m.originalSourceSha256);
const original=code.toString('utf8'),old=m.change.old;assert.equal(original.split(old).length-1,1);
const derived=original.replace(old,m.change.new);assert.equal(sha(derived),m.derivedSourceSha256);
assert.equal(sha(fs.readFileSync(path.join(packet,'source-snapshots/single-orders-derived.js'))),m.derivedSourceSha256);
assert.equal(sha(fs.readFileSync(m.input.path)),m.input.sha256);
assert.equal(sha(fs.readFileSync(m.observer.path)),m.observer.sha256);
for(const relative of ['resources/app/scripts/lib/startup-benchmark.js','resources/app/scripts/lib/first-transition-probe.js']){
 const file=path.join(m.arms.A.checkout,relative);assert.equal(sha(fs.readFileSync(file)),m.sourcePins.A[relative].sha256);
}
const arm=process.env.ORDERS_DIAGNOSTIC_ARM;assert.ok(['A','B'].includes(arm));
const sourceServer=path.join(m.arms[arm].appRoot,'server/server.js'),spawn=cp.spawn;
let serverSpawns=0;const children=[];
function startTicks(pid){try{return fs.readFileSync('/proc/'+pid+'/stat','utf8').split(') ')[1].split(' ')[19];}catch(_){return null;}}
cp.spawn=function(command,args,options){
 const isServer=command===process.execPath&&Array.isArray(args)&&args.length===1&&args[0]===sourceServer;
 if(isServer){
  assert.equal(++serverSpawns,1,'one fresh server required');
  const s=fs.statfsSync(dir),free=Number(s.bavail)*Number(s.bsize),minimum=Number(process.env.ORDERS_DIAGNOSTIC_POSTCOPY_MIN_BYTES);
  assert.ok(Number.isSafeInteger(minimum)&&minimum>0);save('last-before-server-admission.json',{freeBytes:free,requiredBytes:minimum,admitted:free>=minimum,at:new Date().toISOString()});
  assert.ok(free>=minimum,'Disk admission refused immediately before app start');
 }
 const child=spawn.apply(this,arguments);
 const observed={pid:child.pid||null,startTicks:child.pid?startTicks(child.pid):null,executable:path.basename(String(command)),isServer,spawnedAt:new Date().toISOString()};
 children.push(observed);save('child-processes.json',children);
 child.once('error',error=>{observed.spawnError={code:error.code||null,message:error.message};save('child-processes.json',children);});
 child.once('exit',(code,signal)=>{observed.exitCode=code;observed.signal=signal;observed.exitedAt=new Date().toISOString();save('child-processes.json',children);});
 if(isServer){
  const identity={pid:child.pid,startTicks:startTicks(child.pid),command:process.execPath,entry:sourceServer,spawnedAt:new Date().toISOString()};
  save('server-process.json',identity);
  child.once('error',error=>save('server-spawn-error.json',{code:error.code||null,message:error.message}));
  child.once('exit',(code,signal)=>save('server-exit.json',{...identity,exitCode:code,signal,exitedAt:new Date().toISOString()}));
 }
 return child;
};
process.on('exit',code=>save('launcher-exit.json',{code,serverSpawns,at:new Date().toISOString()}));
save('derived-probe.json',{classification:m.classification,arm,node:{execPath:process.execPath,version:process.version},originalFilename:m.originalFilename,originalSourceSha256:m.originalSourceSha256,derivedSourceSha256:m.derivedSourceSha256,exactChange:m.change,appRoot:m.arms[arm].appRoot,input:m.input.path,startedAt:new Date().toISOString()});
const benchmark=new Module(m.originalFilename,module);benchmark.filename=m.originalFilename;
benchmark.paths=Module._nodeModulePaths(path.dirname(m.originalFilename));
process.argv=[process.execPath,m.originalFilename,...process.argv.slice(2)];
benchmark._compile(derived,m.originalFilename);
