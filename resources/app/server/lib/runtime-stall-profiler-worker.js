'use strict';
// Inspector responses, summaries and profile files belong to this control
// worker. Quiet rotations reuse the enabled profiler instead of rebuilding
// its code cache; no profile object is cloned back to the HTTP event loop.
const fs=require('node:fs'),path=require('node:path');
const {isMainThread,parentPort,workerData}=require('node:worker_threads');
function createProfilerController({session,dir=null,keep=3,samplingUs=5000}={}){
  let running=false,serial=0;
  const post=(method,params={})=>new Promise((resolve,reject)=>{
    try{session.post(method,params,(error,result)=>error?reject(error):resolve(result));}catch(error){reject(error);}
  });
  async function resume(){await post('Profiler.setSamplingInterval',{interval:samplingUs});await post('Profiler.start');running=true;}
  async function stop(){if(!running)return null;running=false;return post('Profiler.stop');}
  function save(profile){
    if(!dir)return '';
    try{
      fs.mkdirSync(dir,{recursive:true});
      const name='stall-'+new Date().toISOString().replace(/[:.]/g,'-')+'-'+(++serial)+'.cpuprofile';
      fs.writeFileSync(path.join(dir,name),JSON.stringify(profile));
      const files=fs.readdirSync(dir).filter(file=>file.endsWith('.cpuprofile')).sort();
      for(const file of files.slice(0,Math.max(0,files.length-keep)))try{fs.unlinkSync(path.join(dir,file));}catch(_){}
      return name;
    }catch(_){return '';}
  }
  async function execute(operation,payload={}){
    const logs=[];
    if(operation==='start'){await post('Profiler.enable');await resume();}
    else if(operation==='rotate'){
      if(running){await stop();await resume();}
    }else if(operation==='capture'){
      if(running){
        const result=await stop();
        if(result?.profile){
          const {summarizeProfile,formatLine}=require('./runtime-pressure-monitor');
          const summary=summarizeProfile(result.profile),file=save(result.profile);
          logs.push(formatLine('stall-profile',{blockedMs:payload.blockedMs,sampledMs:summary.totalMs,...(file?{file}:{})}));
          summary.functions.forEach((item,index)=>logs.push(`[RUNTIME] stall-profile top${index+1} ${item.ms}ms ${item.pct}% ${item.label}`));
          summary.stacks.forEach((item,index)=>logs.push(`[RUNTIME] stall-profile stack${index+1} ${item.ms}ms ${item.chain.join(' < ')}`));
        }
        await resume();
      }
    }else if(operation==='close'){
      try{await stop();await post('Profiler.disable');}catch(_){}finally{running=false;session.disconnect();}
    }else throw Error('Invalid profiler operation');
    return {running,logs};
  }
  return {execute};
}
module.exports={createProfilerController};
if(!isMainThread&&parentPort&&workerData?.buyerLogStallProfiler===true){
  const session=new (require('node:inspector').Session)();session.connectToMainThread();
  const controller=createProfilerController({session,dir:workerData.dir,keep:workerData.keep,samplingUs:workerData.samplingUs});
  let queue=Promise.resolve();
  parentPort.on('message',message=>{
    queue=queue.then(async()=>{
      if(!Number.isSafeInteger(message?.id)||message.id<1||!['start','rotate','capture','close'].includes(message.operation))throw Error('Invalid profiler message');
      try{const result=await controller.execute(message.operation,message.payload);parentPort.postMessage({id:message.id,ok:true,...result});}
      catch(_){parentPort.postMessage({id:message.id,ok:false});}
      if(message.operation==='close')parentPort.close();
    }).catch(()=>{parentPort.close();});
  });
}
