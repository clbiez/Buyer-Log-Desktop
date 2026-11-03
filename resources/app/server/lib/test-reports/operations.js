'use strict';
// Owner-private work history. Business writes still go through the report service.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {SERVER_DATA_ROOT,atomicWriteJson,atomicWriteBuffer}=require('../../user-data');
const {withFileLeaseSync}=require('../shared-file-transaction');
const ROOT=path.join(SERVER_DATA_ROOT,'document-review-operations');
const MAX_OPERATIONS=100,MAX_OWNER_BYTES=1024*1024*1024;
const error=(code,statusCode=404)=>Object.assign(new Error(code),{code,statusCode});
const clean=(value,max=300)=>String(value??'').slice(0,max);
const clone=value=>JSON.parse(JSON.stringify(value));
function ownerPath(owner){if(!String(owner||''))throw error('TEST_REPORT_FORBIDDEN',403);return path.join(ROOT,crypto.createHash('sha256').update(String(owner)).digest('hex'));}
function directory(owner,id){if(!/^[a-f0-9]{32}$/.test(String(id)))throw error('TEST_REPORT_OPERATION_NOT_FOUND');return path.join(ownerPath(owner),id);}
function read(file){try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch(err){if(err.code==='ENOENT')return null;throw error('TEST_REPORT_OPERATION_INVALID',422);}}
function list(owner){const root=ownerPath(owner);let dirs;try{dirs=fs.readdirSync(root);}catch(err){if(err.code==='ENOENT')return [];throw err;}return dirs.filter(id=>/^[a-f0-9]{32}$/.test(id)).map(id=>read(path.join(root,id,'summary.json'))).filter(item=>item&&item.owner===String(owner)).map(({owner,...item})=>item).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));}
function captureUnchecked(session,phase){
 if(!session.operationId)return null;
 const owner=session.userId,id=session.operationId,dir=directory(owner,id);
 fs.mkdirSync(dir,{recursive:true,mode:0o700});
 return withFileLeaseSync(path.join(dir,'snapshot.json'),()=>{
  const previous=read(path.join(dir,'summary.json'));
  if(previous&&previous.owner!==owner)throw error('TEST_REPORT_OPERATION_NOT_FOUND');
  const files=[];
  for(const [fileId,file] of session.files){
   if(!/^[a-f0-9]{24}$/.test(fileId))throw error('TEST_REPORT_OPERATION_INVALID',422);
   const filename=path.join(dir,fileId+'.bin');
   if(!fs.existsSync(filename))atomicWriteBuffer(filename,file.buffer);
   const {buffer,...metadata}=file;files.push([fileId,metadata]);
  }
  const snapshot={owner,operationId:id,files,reports:session.reports,sources:session.sources||[],aiCandidates:[...session.aiCandidates],assessment:session.assessment||null,inputFiles:session.inputFiles||[]};
  const now=new Date().toISOString();
  atomicWriteJson(path.join(dir,'snapshot.json'),snapshot);
  const summary={id,owner,createdAt:previous?.createdAt||now,updatedAt:now,phase:phase||previous?.phase||'parsed',
   name:snapshot.inputFiles.map(file=>file.name).join(', ').slice(0,500),fileCount:snapshot.inputFiles.length,reportCount:session.reports.length,bytes:session.bytes,
   reports:session.reports.map(report=>report.talepNo).filter(Boolean).slice(0,12)};
  atomicWriteJson(path.join(dir,'summary.json'),summary);
  return summary;
 });
}
function assertExists(owner,id){const summary=read(path.join(directory(owner,id),'summary.json'));if(!summary||summary.owner!==String(owner))throw error('TEST_REPORT_OPERATION_NOT_FOUND');return summary;}
function capture(session,phase){
 if(!session.operationId)return null;
 return withFileLeaseSync(path.join(ownerPath(session.userId),'catalog.json'),()=>{if(assertExists(session.userId,session.operationId).phase==='committed')throw error('TEST_REPORT_OPERATION_COMMITTED',409);return captureUnchecked(session,phase);});
}
function withCommit(session,apply){
 if(!session.operationId)return apply();
 return withFileLeaseSync(path.join(ownerPath(session.userId),'catalog.json'),()=>{
  if(assertExists(session.userId,session.operationId).phase==='committed')throw error('TEST_REPORT_OPERATION_COMMITTED',409);
  const result=apply();
  try{captureUnchecked(session,'committed');}catch(_){result.operationArchiveWarning=true;}
  return result;
 });
}
function create(session,inputFiles){
 const root=ownerPath(session.userId);fs.mkdirSync(root,{recursive:true,mode:0o700});
 return withFileLeaseSync(path.join(root,'catalog.json'),()=>{
  const existing=list(session.userId);
  if(existing.length>=MAX_OPERATIONS||existing.reduce((sum,item)=>sum+Number(item.bytes||0),0)+session.bytes>MAX_OWNER_BYTES)throw error('TEST_REPORT_OPERATION_CAPACITY',413);
  session.operationId=session.id;session.inputFiles=inputFiles;
  try{return captureUnchecked(session,'parsed');}catch(err){fs.rmSync(directory(session.userId,session.id),{recursive:true,force:true});delete session.operationId;throw err;}
 });
}
function load(owner,id){const dir=directory(owner,id),snapshot=read(path.join(dir,'snapshot.json')),summary=read(path.join(dir,'summary.json'));
 if(!snapshot||!summary||snapshot.owner!==String(owner)||summary.owner!==String(owner))throw error('TEST_REPORT_OPERATION_NOT_FOUND');
 let total=0;
 const files=new Map((snapshot.files||[]).map(([fileId,meta])=>{
  if(!/^[a-f0-9]{24}$/.test(fileId))throw error('TEST_REPORT_OPERATION_INVALID',422);
  const buffer=fs.readFileSync(path.join(dir,fileId+'.bin'));total+=buffer.length;
  if(buffer.length>40*1024*1024||total>300*1024*1024||crypto.createHash('sha256').update(buffer).digest('hex')!==meta.hash)throw error('TEST_REPORT_OPERATION_INVALID',422);
  return [fileId,{...meta,buffer}];
 }));
 const draft=read(path.join(dir,'draft.json'))||{revision:0,draft:{}};
 return {...snapshot,userId:String(owner),files,bytes:total,aiCandidates:new Map(snapshot.aiCandidates||[]),summary,draft};
}
function cleanDraft(input){
 const raw=input&&typeof input==='object'?input:{};
 return {note:clean(raw.note,8000),tab:['report','files','activity'].includes(raw.tab)?raw.tab:'report',activeEntry:clean(raw.activeEntry,100),
  typeMap:raw.typeMap&&typeof raw.typeMap==='object'?Object.fromEntries(Object.entries(raw.typeMap).slice(0,100).map(([key,value])=>[clean(key,80),clean(value,160)])):{},
  entries:(Array.isArray(raw.entries)?raw.entries:[]).filter(item=>item&&typeof item==='object').slice(0,500).map(item=>({reportId:clean(item.reportId,80),scope:clean(item.scope,60),chosen:clean(item.chosen),itemId:clean(item.itemId,160),status:clean(item.status,80),element:clean(item.element,60),manualAdded:item.manualAdded===true,manual:item.manual===true,partOf:clean(item.partOf,100)}))};
}
function saveDraft(owner,id,body){
 const dir=directory(owner,id);
 return withFileLeaseSync(path.join(ownerPath(owner),'catalog.json'),()=>{assertExists(owner,id);return withFileLeaseSync(path.join(dir,'draft.json'),()=>{
  const summary=read(path.join(dir,'summary.json'));if(!summary||summary.owner!==String(owner))throw error('TEST_REPORT_OPERATION_NOT_FOUND');
  const current=read(path.join(dir,'draft.json'))||{revision:0,draft:{}};
  if(body.expectedRevision!==current.revision)throw error('TEST_REPORT_OPERATION_CONFLICT',409);
  const next={revision:current.revision+1,draft:cleanDraft(body.draft)};
  atomicWriteJson(path.join(dir,'draft.json'),next);return clone(next);
 });});
}
function remove(owner,id){const dir=directory(owner,id),summary=read(path.join(dir,'summary.json'));if(!summary||summary.owner!==String(owner))throw error('TEST_REPORT_OPERATION_NOT_FOUND');
 return withFileLeaseSync(path.join(ownerPath(owner),'catalog.json'),()=>{fs.rmSync(dir,{recursive:true,force:true});return {ok:true};});}
module.exports={create,capture,withCommit,load,list,saveDraft,remove,assertExists,MAX_OPERATIONS};
