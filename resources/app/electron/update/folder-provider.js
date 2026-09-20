'use strict';
const fs = require('fs');
const path = require('path');
const { pipeline } = require('stream/promises');
const { safeArtifactPath } = require('./manifest');

function expandEnv(value, env=process.env) {
  return String(value || '').replace(/%([^%]+)%/g, (_m,key)=>env[key] == null ? _m : env[key]);
}
function timeoutError() { return Object.assign(new Error('Güncelleme kaynağı zaman aşımına uğradı.'),{code:'UPDATE_SOURCE_TIMEOUT'}); }
function withTimeout(promise, ms) {
  if (!(ms>0)) return promise;
  return Promise.race([promise,new Promise((_,reject)=>{const t=setTimeout(()=>reject(timeoutError()),ms); if(t.unref)t.unref();})]);
}
class FolderReleaseProvider {
  constructor(source, options={}) {
    this.source=path.resolve(expandEnv(source)); this.timeoutMs=Number(options.timeoutMs)||5000; this.artifactTimeoutMs=Math.max(60000,Number(options.artifactTimeoutMs)||15*60*1000);
  }
  channelRoot(channel){ return path.join(this.source,channel); }
  async readManifest(channel){
    const file=path.join(this.channelRoot(channel),'latest.json');
    const raw=await withTimeout(fs.promises.readFile(file,'utf8'),this.timeoutMs);
    return { file, raw };
  }
  artifactPath(channel,artifact){
    const safe=safeArtifactPath(artifact); if(!safe) throw Object.assign(new Error('Artifact yolu güvenli değil.'),{code:'UPDATE_ARTIFACT_PATH'});
    const root=path.resolve(this.channelRoot(channel)), full=path.resolve(root,...safe.split('/'));
    if(full!==root && !full.startsWith(root+path.sep)) throw Object.assign(new Error('Artifact release root dışına çıkamaz.'),{code:'UPDATE_ARTIFACT_PATH'});
    return full;
  }
  async copyArtifact(channel,artifact,destination){
    const source=this.artifactPath(channel,artifact); await fs.promises.mkdir(path.dirname(destination),{recursive:true});
    const input=fs.createReadStream(source),output=fs.createWriteStream(destination,{flags:'wx'});
    const timer=setTimeout(()=>{const error=timeoutError();input.destroy(error);output.destroy(error);},this.artifactTimeoutMs); if(timer.unref)timer.unref();
    try{await pipeline(input,output);return await fs.promises.stat(destination);}finally{clearTimeout(timer);}
  }
}
module.exports={FolderReleaseProvider,expandEnv,withTimeout};
