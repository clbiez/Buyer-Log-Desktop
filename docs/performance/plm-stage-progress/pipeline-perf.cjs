'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),Module=require('node:module');
const [variant,sizeText]=process.argv.slice(2),size=Number(sizeText),repo=process.cwd(),app=path.join(repo,'resources/app'),work=path.join(repo,'work/plm-progress');
const data=fs.mkdtempSync(path.join(work,'perf-data-'));
process.env.BUYER_LOG_SERVER_DATA_ROOT=path.join(data,'server');process.env.BUYER_LOG_LOCAL_DATA_ROOT=path.join(data,'local');process.env.BUYER_LOG_TEMP_ROOT=path.join(data,'temp');
for(const folder of [process.env.BUYER_LOG_SERVER_DATA_ROOT,process.env.BUYER_LOG_LOCAL_DATA_ROOT,process.env.BUYER_LOG_TEMP_ROOT])fs.mkdirSync(folder,{recursive:true});
function load(local,backup){if(variant==='candidate')return require(path.join(app,local));const filename=path.join(app,local),module=new Module(filename);module.filename=filename;module.paths=Module._nodeModulePaths(path.dirname(filename));module._compile(fs.readFileSync(path.join(work,backup),'utf8'),filename);return module.exports;}
const service=load('server/lib/plm-image-sync-service.js','base-image-service.js');
const registry=load('server/lib/job-registry.js','base-job-registry.js').createJobRegistry();
const server=fs.readFileSync(variant!=='candidate'?path.join(work,'base-server.js'):path.join(app,'server/server.js'),'utf8');
const start=server.indexOf('function reportImageProgress('),source=server.slice(start,server.indexOf('// İstek gövdesinden',start));
let legacy;
const report=new Function('plmJobs','setModelOperationProgress',source+'\nreturn reportImageProgress;')(registry,(id,p)=>legacy=p);
const job=registry.create('demo',{kind:'plm-images',total:size});
const ingestLib=require(path.join(app,'server/lib/plm-image-ingest')),ownership=require(path.join(app,'server/lib/plm-image-ownership'));
let state=ownership.emptyStore(),seq=0,peakRss=0;const files=new Map(),imagemap={},calls={styleList:0,metadata:0,downloads:0};
const ingest=ingestLib.createPlmImageIngest({ownership:{...ownership,loadOwnership:()=>state,saveOwnership:s=>(state=s)},getImage:id=>files.get(id)?{item:files.get(id),full:id}:null,readImageBytes:found=>found.item.buffer,saveImage:payload=>{const id='ci_'+(++seq),buffer=Buffer.from(payload.base64,'base64'),item={id,url:'/api/collection-images/'+id,mimeType:payload.mimeType,size:buffer.length,buffer};files.set(id,item);return item;},deleteImage:id=>files.delete(id),patchLinks:links=>{for(const link of links)imagemap[ingestLib.canonicalKeyFor(link)]=link.imageRef;return {overrides:{imagemap},updated:links.length};}});
const requests=Array.from({length:size},(_,i)=>({plmId:String(2100000+i),colourCode:'CVL'}));
const fixtureHash=crypto.createHash('sha256').update(JSON.stringify(requests)).digest('hex');
const attachment=id=>'https://mym-api.lcwaikiki.com/lcw/live/corenectum/service/api/Attachment/GetAttachment/'+id;
function sample(){peakRss=Math.max(peakRss,process.memoryUsage().rss);}
(async()=>{
 const timer=setInterval(sample,5),cpu=process.cpuUsage(),started=performance.now();sample();
 const result=await service.runPlmImageSync({requests,mode:'all',ingest,imagemap,store:state,
 styleListLookup:async codes=>{calls.styleList++;return {data:{coreNectumResultData:{styleListResult:codes.map(plmCode=>({plmCode,styleId:plmCode,model:{imageUrl:attachment(plmCode)}}))}}};},
 styleImagesLookup:async id=>{calls.metadata++;return {data:{styleImages:{StyleImages:[{imageUrl:attachment(id)}]}}};},
 downloadImage:async url=>{calls.downloads++;const buffer=Buffer.concat([Buffer.from('89504e470d0a1a0a0000000d49484452','hex'),Buffer.alloc(2048),Buffer.from(url)]);return {buffer,size:buffer.length,mimeType:'image/png'};},
 onProgress:p=>{report({currentUser:{id:'demo'}},job,p);sample();}});
 const elapsedMs=performance.now()-started,cpuUsed=process.cpuUsage(cpu);sample();clearInterval(timer);
 const digest=crypto.createHash('sha256').update(JSON.stringify({counts:result.counts,outcomes:result.outcomes.map(x=>[x.plmId,x.status,x.imageRef,x.contentHash]),imagemap})).digest('hex');
 const tempFiles=fs.existsSync(path.join(data,'temp'))?fs.readdirSync(path.join(data,'temp')).length:0;
 console.log(JSON.stringify({variant,size,fixtureHash,elapsedMs,cpuMs:(cpuUsed.user+cpuUsed.system)/1000,peakRss,maxRss:process.resourceUsage().maxRSS*1024,calls,digest,tempFiles,records:result.outcomes.length}));
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>fs.rmSync(data,{recursive:true,force:true}));
