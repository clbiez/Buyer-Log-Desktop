'use strict';
const path=require('node:path'),{fork}=require('node:child_process'),Policy=require('../../public/file-parser-policy');
function createParserClient({workerFile=path.join(__dirname,'../workers/file-parser-process.js'),maxPending=8,maxQueuedBytes=64*1024*1024,timeoutMs=Policy.LIMITS.timeoutMs}={}){
 const queue=[];let active=false,queuedBytes=0;
 function run(operation,payload,{signal,timeoutMs:deadline=timeoutMs}={}){
  if(signal?.aborted)return Promise.reject(Policy.fail('FILE_PARSE_CANCELLED'));
  const limits=['endeksmatik','endeksmatik-legacy'].includes(operation)?Policy.ENDEKSMATIK_LIMITS:Policy.LIMITS;
  const size=payload?.buffer?.byteLength||0;if(size>limits.bytes)return Promise.reject(Policy.fail());
  if(queue.length>=maxPending||queuedBytes+size>maxQueuedBytes)return Promise.reject(Policy.fail('FILE_PARSE_BUSY'));
  return new Promise((resolve,reject)=>{const job={operation,payload,signal,deadline:Math.max(1,Math.min(120000,Number(deadline)||timeoutMs)),size,resolve,reject};job.abort=()=>{const index=queue.indexOf(job);if(index>=0){queue.splice(index,1);queuedBytes-=job.size;job.payload=null;reject(Policy.fail('FILE_PARSE_CANCELLED'));}};signal?.addEventListener('abort',job.abort,{once:true});queue.push(job);queuedBytes+=size;pump();});
 }
 function pump(){
  if(active||!queue.length)return;const job=queue.shift();queuedBytes-=job.size;job.signal?.removeEventListener('abort',job.abort);active=true;
  let child,timer,settled=false,completed=false,value,error;const finish=(err,result)=>{if(settled)return;settled=true;error=err;value=result;clearTimeout(timer);job.signal?.removeEventListener('abort',abort);job.payload=null;if(child?.pid&&child.exitCode===null){child.kill();}else complete();};
  const complete=()=>{if(completed)return;completed=true;if(!settled){settled=true;error=Policy.fail('FILE_PARSE_EXIT');}clearTimeout(timer);job.signal?.removeEventListener('abort',abort);job.payload=null;active=false;error?job.reject(error):job.resolve(value);pump();};
  const abort=()=>finish(Policy.fail('FILE_PARSE_CANCELLED'));
  try{
   child=fork(workerFile,[],{windowsHide:true,serialization:'advanced',execArgv:[`--max-old-space-size=${['endeksmatik','endeksmatik-legacy'].includes(job.operation)?768:256}`],env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},stdio:['ignore','ignore','ignore','ipc']});
   child.once('error',err=>finish(err));child.once('close',complete);child.once('message',message=>message?.ok?finish(null,message.result):finish(Object.assign(new Error(message?.error?.message||'Dosya okunamadı. / The file could not be read.'),{code:message?.error?.code||'FILE_PARSE_FAILED',statusCode:message?.error?.statusCode||422,details:message?.error?.details})));
   timer=setTimeout(()=>finish(Policy.fail('FILE_PARSE_TIMEOUT')),job.deadline);job.signal?.addEventListener('abort',abort,{once:true});if(job.signal?.aborted){abort();return;}child.send({operation:job.operation,payload:job.payload});
  }catch(err){finish(err);}
 }
 return {run,stats:()=>({active,pending:queue.length,queuedBytes})};
}
async function readFileBounded(file){
 const handle=await require('node:fs/promises').open(file,'r');try{const stat=await handle.stat();if(!stat.isFile()||stat.size>Policy.LIMITS.bytes)throw Policy.fail();const buffer=Buffer.alloc(stat.size+1);let offset=0;while(offset<buffer.length){const {bytesRead}=await handle.read(buffer,offset,buffer.length-offset,null);if(!bytesRead)break;offset+=bytesRead;}if(offset>stat.size)throw Policy.fail();return buffer.subarray(0,offset);}finally{await handle.close();}
}
module.exports={createParserClient,readFileBounded,...createParserClient()};
