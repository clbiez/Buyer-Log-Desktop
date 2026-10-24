'use strict';
const fs=require('node:fs'),path=require('node:path');
const {withFileLeaseSync,withFileLeaseAsync}=require('../../server/lib/shared-file-transaction');
const [mode,target,countRaw]=process.argv.slice(2);
(async()=>{
 if(mode==='kill-metadata'){
  const rename=fs.renameSync;fs.renameSync=(source,destination)=>{if(destination===path.join(target+'.write-lock','owner.json')){process.send({staged:source});Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,60000);}return rename(source,destination);};
  await withFileLeaseAsync(target,()=>{}, {logger:()=>{}});
 }else if(mode==='hold'){
  await withFileLeaseAsync(target,async()=>{process.send({entered:true});await new Promise(resolve=>process.once('message',resolve));},{staleMs:5000,logger:()=>{}});
 }else{
  const generations=[];
  for(let i=0;i<Number(countRaw||1);i++){
   const operation=lease=>{const value=Number(fs.readFileSync(target,'utf8'));Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,2);lease?.assertOwned();fs.writeFileSync(target,String(value+1));generations.push(lease?.generation);};
   if(mode==='sync')withFileLeaseSync(target,operation,{timeoutMs:10000,logger:()=>{}});
   else await withFileLeaseAsync(target,operation,{timeoutMs:10000,logger:()=>{}});
  }
  process.send({generations});
 }
})().then(()=>process.disconnect()).catch(error=>{process.send({error:error.message,code:error.code});process.exitCode=1;process.disconnect();});
