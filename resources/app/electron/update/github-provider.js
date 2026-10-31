'use strict';
const fs=require('fs');
const path=require('path');
const { safeArtifactPath }=require('./manifest');

function parseGitHubSource(source){
  const match=/^github:([A-Za-z0-9-]+)\/([A-Za-z0-9_.-]+)$/.exec(String(source||'').trim());
  if(!match||match[1].startsWith('-')||match[1].endsWith('-')||['.','..'].includes(match[2])||match[2].endsWith('.git'))throw Object.assign(new Error('Public GitHub release kaynağı github:owner/repo biçiminde olmalı.'),{code:'UPDATE_GITHUB_SOURCE_INVALID'});
  return {owner:match[1],repo:match[2]};
}
function validateArtifact(channel,version,artifact){
  const safe=safeArtifactPath(artifact);
  if(!['test','stable'].includes(channel)||!/^releases\/BuyerLog-[0-9A-Za-z.+-]+\.zip$/.test(safe)||safe!==`releases/BuyerLog-${version}.zip`)
    throw Object.assign(new Error('GitHub artifact yolu manifest ile eşleşmiyor.'),{code:'UPDATE_ARTIFACT_PATH'});
  return safe;
}
function githubAssetUrl(source,channel,version,artifact){
  const {owner,repo}=parseGitHubSource(source),safe=validateArtifact(channel,version,artifact);
  return `https://github.com/${owner}/${repo}/releases/download/${channel}-v${version}/${path.posix.basename(safe)}`;
}
function githubRawArtifactUrl(source,channel,version,artifact){
  const {owner,repo}=parseGitHubSource(source),safe=validateArtifact(channel,version,artifact);
  return `https://raw.githubusercontent.com/${owner}/${repo}/raw-dist/${channel}/${path.posix.basename(safe)}?v=${encodeURIComponent(version)}`;
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
// "fetch failed" tek başına teşhis vermez; asıl ağ hatası (ECONNRESET, ETIMEDOUT,
// sertifika, net::ERR_*) error.cause içindedir ve log'a bu kod yazılır.
function networkCause(error){
  const cause=error&&error.cause;
  return {code:String(cause&&cause.code||error&&error.code||'').slice(0,120),message:String(cause&&cause.message||error&&error.message||'').slice(0,300)};
}
async function fetchPublic(url,timeoutMs,extraHeaders){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
  if(timer.unref)timer.unref();
  const options={signal:controller.signal,headers:{'Accept':'application/octet-stream','Cache-Control':'no-cache',...(extraHeaders||{})},redirect:'follow'};
  const failures=[];
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
        const cause=networkCause(error);
        failures.push(transport.name+':'+(cause.code||cause.message));
        lastError=Object.assign(error||new Error('GitHub indirme hatası.'),{transport:transport.name,transportCode:cause.code,transportCause:cause.message,transportFailures:failures.join(' | ').slice(0,300)});
        if(controller.signal.aborted)break;
      }
    }
    throw lastError||Object.assign(new Error('GitHub indirme bağlantısı kurulamadı.'),{code:'UPDATE_SOURCE_FETCH_FAILED'});
  }catch(error){clearTimeout(timer);throw error;}
}
class GitHubReleaseProvider{
  constructor(source,options={}){this.source=source;this.identity=parseGitHubSource(source);this.timeoutMs=Number(options.timeoutMs)||5000;this.artifactTimeoutMs=Number(options.artifactTimeoutMs)||15*60*1000;this.maxAttempts=Number(options.maxAttempts)||6;this.wait=typeof options.wait==='function'?options.wait:ms=>new Promise(resolve=>{const t=setTimeout(resolve,ms);if(t.unref)t.unref();});}
  async readManifest(channel){
    if(!['test','stable'].includes(channel))throw Object.assign(new Error('Update channel geçersiz.'),{code:'UPDATE_CHANNEL_INVALID'});
    const {owner,repo}=this.identity;
    const file=`https://raw.githubusercontent.com/${owner}/${repo}/main/${channel}/latest.json?at=${Date.now()}`;
    const {response,timer}=await fetchPublic(file,this.timeoutMs);
    try{return {file,raw:await response.text()};}finally{clearTimeout(timer);}
  }
  /* 184 MB'lık paket tek bağlantıda iner; dengesiz ağda bağlantı koparsa önceki
     sürüm her denemede baştan başlıyordu. Artık geçici ağ hatasında kısa bekleyip
     aynı .partial dosyasına HTTP Range ile kaldığı yerden devam edilir. Sunucu
     Range'i yok sayarsa (200) dosya baştan yazılır. Bütünlük değişmez: bitince
     updater boyut ve SHA-256'yı manifest ile doğrular. 4xx (408/429 hariç) kalıcıdır. */
  async copyArtifact(channel,artifact,destination,version){
    const urls=[
      {name:'raw-mirror',url:githubRawArtifactUrl(this.source,channel,version,artifact)},
      {name:'github-release',url:githubAssetUrl(this.source,channel,version,artifact)},
    ];
    await fs.promises.mkdir(path.dirname(destination),{recursive:true});
    let lastError=null;
    for(const candidate of urls){
      try{fs.rmSync(destination,{force:true});}catch(_){}
      let attempt=0;
      for(;;){
        attempt++;
        let timer=null;
        try{
          const have=fileSize(destination);
          const fetched=await fetchPublic(candidate.url,this.artifactTimeoutMs,have>0?{'Range':`bytes=${have}-`}:null);
          const {response,controller}=fetched;timer=fetched.timer;
          if(!response.body)throw Object.assign(new Error('GitHub artifact içeriği boş.'),{code:'UPDATE_DOWNLOAD_FAILED'});
          const resumed=have>0&&response.status===206&&rangeStart(response.headers.get('content-range'))===have;
          if(response.status===206&&!resumed){
            // Beklenmeyen aralık: yanlış yere eklememek için dosya silinir, sonraki deneme baştan iner.
            try{response.body.cancel();}catch(_){}
            try{fs.rmSync(destination,{force:true});}catch(_){}
            throw Object.assign(new Error('GitHub artifact aralığı beklenen yerden başlamıyor.'),{code:'UPDATE_RANGE_MISMATCH'});
          }
          // Parçalar tek tek yazılıp beklenir: bağlantı koptuğunda o ana kadar inen
          // baytlar dosyada kalır ve sonraki deneme tam oradan devam eder.
          const handle=await fs.promises.open(destination,resumed?'a':'w');
          const reader=response.body.getReader();
          try{for(;;){const {done,value}=await reader.read();if(done)break;if(value&&value.byteLength)await handle.write(value);}}
          finally{try{reader.releaseLock();}catch(_){}await handle.close();}
          const stat=await fs.promises.stat(destination);
          return Object.assign(stat,{attempts:attempt,artifactSource:candidate.name});
        }catch(error){
          const cause=networkCause(error);
          lastError=Object.assign(error||new Error('GitHub artifact indirilemedi.'),{artifactSource:candidate.name,attempts:attempt});
          if(!lastError.transportCode&&cause.code)lastError.transportCode=cause.code;
          if(!lastError.transportCause&&cause.message)lastError.transportCause=cause.message;
          if(!retryable(error)||attempt>=this.maxAttempts){try{fs.rmSync(destination,{force:true});}catch(_){}break;}
          await this.wait(Math.min(15000,1000*2**(attempt-1)));
        }finally{
          if(timer)clearTimeout(timer);
        }
      }
    }
    throw lastError||Object.assign(new Error('GitHub artifact indirilemedi.'),{code:'UPDATE_DOWNLOAD_FAILED'});
  }
}
function fileSize(file){try{return fs.statSync(file).size;}catch(_){return 0;}}
function rangeStart(header){const m=/^bytes (\d+)-/i.exec(String(header||''));return m?Number(m[1]):-1;}
function retryable(error){
  if(!error)return false;
  if(error.code==='UPDATE_SOURCE_REDIRECT'||error.code==='UPDATE_SOURCE_TRANSPORT_UNAVAILABLE')return false;
  if(error.code==='UPDATE_SOURCE_HTTP')return error.status===408||error.status===429||error.status>=500;
  return true;
}
module.exports={GitHubReleaseProvider,networkCause,parseGitHubSource,githubAssetUrl,githubRawArtifactUrl,fetchTransports,fetchPublic};
