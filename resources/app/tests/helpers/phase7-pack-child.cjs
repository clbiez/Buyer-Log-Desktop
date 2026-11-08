'use strict';
const path=require('node:path'),fsp=require('node:fs/promises');
const [app,root,phase,device]=process.argv.slice(2),open=fsp.open;
fsp.open=async function(...args){
 const file=String(args[0]);
 const isTarget=phase==='pack-sync'?file.endsWith('.blpack'):file.includes('/'+phase+'/')&&file.endsWith('.tmp');
 if(isTarget&&phase!=='pack-sync'){process.send({phase});await new Promise(()=>{});}
 const handle=await open.apply(this,args);
 if(isTarget&&phase==='pack-sync')handle.sync=async()=>{process.send({phase});await new Promise(()=>{});};
 return handle;
};
const shared=require(path.join(app,'server/lib/shared-image-store')).createSharedImageStore({getSharedSyncRoot:async()=>root,getDeviceId:()=>device});
const entries=Array.from({length:5},(_,i)=>({canonicalKey:'plm:'+i,source:'PLM',mimeType:'image/jpeg',buffer:Buffer.alloc(4096,i)}));
shared.publish(entries).then(result=>{process.send({done:result});process.disconnect();},error=>{process.send({error:error.code||error.message});process.exitCode=1;process.disconnect();});
