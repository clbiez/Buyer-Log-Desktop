'use strict';
// Run under the shared flock. Every arm is a fresh process and data root.
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const output=path.resolve(process.argv[2]);fs.mkdirSync(output,{recursive:true});
const main=process.argv[3],candidate=process.argv[4],kind=process.argv[5]||'ab';
for(const count of [1,100,1000])for(let pair=1;pair<=3;pair++)for(const arm of ['main','candidate']){
 const file=path.join(output,`${kind}-${count}-${pair}-${arm}.json`);
 const app=arm==='main'||kind==='aa'?main:candidate;
 const run=spawnSync(process.execPath,[path.join(__dirname,'phase6c-http-acceptance.cjs'),app,file,String(count)],{env:process.env,stdio:'inherit'});
 if(run.status!==0){console.error(`Stopped on failed arm ${file}`);process.exit(run.status||1);}
}
