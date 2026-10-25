(function(root){
 'use strict';
 const Policy=root.BLFileParserPolicy,script=document.currentScript?.src||location.href,queue=[];let active=0,queuedBytes=0;
 function pump(){while(active<2&&queue.length){const job=queue.shift();queuedBytes-=job.buffer.byteLength;job.signal?.removeEventListener('abort',job.cancelQueued);active++;let worker,timer,done=false;
  const finish=(error,value)=>{if(done)return;done=true;clearTimeout(timer);job.signal?.removeEventListener('abort',abort);worker?.terminate();job.buffer=null;active--;error?job.reject(error):job.resolve(value);pump();};
  const abort=()=>finish(Policy.fail('FILE_PARSE_CANCELLED'));
  try{const url=new URL('file-parser-worker.js',script);url.search=new URL(script).search;worker=new Worker(url);worker.onmessage=event=>{const message=event.data;message?.ok?finish(null,message.workbook):finish(Object.assign(new Error(message?.error?.message||Policy.fail().message),{code:message?.error?.code||'FILE_PARSE_FAILED'}));};worker.onerror=()=>finish(Policy.fail('FILE_PARSE_FAILED'));timer=setTimeout(()=>finish(Policy.fail('FILE_PARSE_TIMEOUT')),Policy.LIMITS.timeoutMs);job.signal?.addEventListener('abort',abort,{once:true});if(job.signal?.aborted){abort();continue;}worker.postMessage({buffer:job.buffer,options:job.options,output:job.output},[job.buffer]);}catch(error){finish(error);}
 }}
 async function readWorkbook(input,options={},control={}){
  if(control.signal?.aborted)throw Policy.fail('FILE_PARSE_CANCELLED');if(Number(input?.size)>Policy.LIMITS.bytes)throw Policy.fail();
  const bytes=input&&typeof input.arrayBuffer==='function'?new Uint8Array(await input.arrayBuffer()):input instanceof ArrayBuffer?new Uint8Array(input):ArrayBuffer.isView(input)?new Uint8Array(input.buffer,input.byteOffset,input.byteLength):null;
  Policy.inspectBytes(bytes);if(control.signal?.aborted)throw Policy.fail('FILE_PARSE_CANCELLED');if(queue.length>=8||queuedBytes+bytes.byteLength>64*1024*1024)throw Policy.fail('FILE_PARSE_BUSY');
  const buffer=bytes.slice().buffer;
  return new Promise((resolve,reject)=>{const job={buffer,options,output:control.output==='exceljs-model'?'exceljs-model':'sheetjs',signal:control.signal,resolve,reject};job.cancelQueued=()=>{const index=queue.indexOf(job);if(index<0)return;queue.splice(index,1);queuedBytes-=job.buffer.byteLength;job.buffer=null;reject(Policy.fail('FILE_PARSE_CANCELLED'));};job.signal?.addEventListener('abort',job.cancelQueued,{once:true});queue.push(job);queuedBytes+=buffer.byteLength;pump();});
 }
 root.BLFileParser=Object.freeze({readWorkbook,readExcelJsModel:(input,control={})=>readWorkbook(input,{cellDates:true,cellNF:true},{...control,output:'exceljs-model'})});
})(window);
