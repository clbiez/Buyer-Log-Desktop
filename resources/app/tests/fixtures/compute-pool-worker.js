'use strict';
const {parentPort,threadId}=require('node:worker_threads');
let active=0;
parentPort.on('message',async message=>{
  if(message.type!=='run')return;
  active++;const concurrent=active;
  try{
    await new Promise(resolve=>setTimeout(resolve,Number(message.payload?.delayMs)||0));
    if(message.task==='read-capability'){
      const handle=message.payload.fileHandle;
      let data;try{data=await handle.readFile();}finally{await handle.close();}
      const bytes=Uint8Array.from(data);
      parentPort.postMessage({type:'result',id:message.id,ok:true,value:{bytes:bytes.buffer},metrics:{retainedBytes:0,outputBytes:bytes.byteLength}},[bytes.buffer]);
    }else parentPort.postMessage({type:'result',id:message.id,ok:true,value:{threadId,value:message.payload?.value,concurrent},metrics:{retainedBytes:0,outputBytes:0}});
  }catch(error){parentPort.postMessage({type:'result',id:message.id,ok:false,error:{message:error.message},metrics:{retainedBytes:0,outputBytes:0}});}
  finally{active--;}
});
