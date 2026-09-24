'use strict';
const fs=require('fs');
const path=require('path');
const { Readable }=require('stream');
const { pipeline }=require('stream/promises');
const { safeArtifactPath }=require('./manifest');

function parseGitHubSource(source){
  const match=/^github:([A-Za-z0-9-]+)\/([A-Za-z0-9_.-]+)$/.exec(String(source||'').trim());
  if(!match||match[1].startsWith('-')||match[1].endsWith('-')||['.','..'].includes(match[2])||match[2].endsWith('.git'))throw Object.assign(new Error('Public GitHub release kaynağı github:owner/repo biçiminde olmalı.'),{code:'UPDATE_GITHUB_SOURCE_INVALID'});
  return {owner:match[1],repo:match[2]};
}
function githubAssetUrl(source,channel,version,artifact){
  const {owner,repo}=parseGitHubSource(source),safe=safeArtifactPath(artifact);
  if(!['test','stable'].includes(channel)||!/^releases\/BuyerLog-[0-9A-Za-z.+-]+\.zip$/.test(safe)||safe!==`releases/BuyerLog-${version}.zip`)
    throw Object.assign(new Error('GitHub artifact yolu manifest ile eşleşmiyor.'),{code:'UPDATE_ARTIFACT_PATH'});
  return `https://github.com/${owner}/${repo}/releases/download/${channel}-v${version}/${path.posix.basename(safe)}`;
}
function fetchTransports(){
  const transports=[];
  try{
    const electron=require('electron');
    if(electron&&electron.net&&typeof electron.net.fetch==='function')transports.push({name:'electron-net',fetch:(url,options)=>electron.net.fetch(url,options)});
  }catch(_){}
  if(typeof fetch==='function')transports.push({name:'node-fetch',fetch:(url,options)=>fetch(url,options)});
  return transports;
}
async function fetchPublic(url,timeoutMs){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
  if(timer.unref)timer.unref();
  const options={signal:controller.signal,headers:{'Accept':'application/octet-stream','Cache-Control':'no-cache'},redirect:'follow'};
  let lastError=null;
  try{
    const transports=fetchTransports();
    if(!transports.length)throw Object.assign(new Error('Kullanılabilir HTTPS indirme altyapısı yok.'),{code:'UPDATE_SOURCE_TRANSPORT_UNAVAILABLE'});
    for(const transport of transports){
      try{
        const response=await transport.fetch(url,options);
        if(!response.ok)throw Object.assign(new Error(`GitHub release HTTP ${response.status}`),{code:'UPDATE_SOURCE_HTTP',status:response.status});
        const final=new URL(response.url);
        if(final.protocol!=='https:'||!(final.hostname==='github.com'||final.hostname==='raw.githubusercontent.com'||final.hostname.endsWith('.githubusercontent.com')))
          throw Object.assign(new Error('GitHub indirme yönlendirmesi güvenli değil.'),{code:'UPDATE_SOURCE_REDIRECT'});
        return {response,controller,timer,transport:transport.name};
      }catch(error){
        lastError=Object.assign(error||new Error('GitHub indirme hatası.'),{transport:transport.name});
        if(controller.signal.aborted)break;
      }
    }
    throw lastError||Object.assign(new Error('GitHub indirme bağlantısı kurulamadı.'),{code:'UPDATE_SOURCE_FETCH_FAILED'});
  }catch(error){clearTimeout(timer);throw error;}
}
class GitHubReleaseProvider{
  constructor(source,options={}){this.source=source;this.identity=parseGitHubSource(source);this.timeoutMs=Number(options.timeoutMs)||5000;this.artifactTimeoutMs=Number(options.artifactTimeoutMs)||15*60*1000;}
  async readManifest(channel){
    if(!['test','stable'].includes(channel))throw Object.assign(new Error('Update channel geçersiz.'),{code:'UPDATE_CHANNEL_INVALID'});
    const {owner,repo}=this.identity;
    const file=`https://raw.githubusercontent.com/${owner}/${repo}/main/${channel}/latest.json?at=${Date.now()}`;
    const {response,timer}=await fetchPublic(file,this.timeoutMs);
    try{return {file,raw:await response.text()};}finally{clearTimeout(timer);}
  }
  async copyArtifact(channel,artifact,destination,version){
    const url=githubAssetUrl(this.source,channel,version,artifact);
    const {response,controller,timer}=await fetchPublic(url,this.artifactTimeoutMs);
    try{
      if(!response.body)throw Object.assign(new Error('GitHub artifact içeriği boş.'),{code:'UPDATE_DOWNLOAD_FAILED'});
      await fs.promises.mkdir(path.dirname(destination),{recursive:true});
      await pipeline(Readable.fromWeb(response.body),fs.createWriteStream(destination,{flags:'wx'}),{signal:controller.signal});
      return fs.promises.stat(destination);
    }finally{clearTimeout(timer);}
  }
}
module.exports={GitHubReleaseProvider,parseGitHubSource,githubAssetUrl,fetchTransports,fetchPublic};
