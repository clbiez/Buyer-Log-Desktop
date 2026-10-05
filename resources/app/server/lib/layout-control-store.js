'use strict';

const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
const {SERVER_DATA_ROOT,atomicWriteJson}=require('../user-data');
const {readJsonWithValidatedBackup}=require('./safe-json-read');

const ROOT=path.join(SERVER_DATA_ROOT,'layout-control-history');
const SCHEMA_VERSION=1;
const MAX_RUNS=100;
const MAX_CHECKS=120;

function clean(value,max=500){return String(value==null?'':value).trim().slice(0,max);}
function list(value,maxItems=30,maxChars=500){
  return (Array.isArray(value)?value:[]).slice(0,maxItems).map(item=>clean(item,maxChars)).filter(Boolean);
}
function number(value){const n=Number(value);return Number.isFinite(n)&&n>=0?Math.floor(n):0;}
function ownerKey(ownerId){return crypto.createHash('sha256').update(clean(ownerId,500)||'default').digest('hex').slice(0,32);}
function fileFor(ownerId){return path.join(ROOT,ownerKey(ownerId)+'.json');}
function emptyStore(){return {schemaVersion:SCHEMA_VERSION,runs:[],revision:0,updatedAt:null};}
function status(value,allowed,fallback){const v=clean(value,30).toUpperCase();return allowed.includes(v)?v:fallback;}
function normalizeCheck(raw){
  const item=raw&&typeof raw==='object'?raw:{};
  return {
    rule:clean(item.rule,100),
    category:clean(item.category,80),
    status:status(item.status,['MATCH','MISMATCH','REVIEW','NOT_CHECKED'],'REVIEW'),
    expected:list(item.expected,20,500),
    actual:list(item.actual,20,500),
    detail:clean(item.detail,1200),
    source:clean(item.source,120),
  };
}
function normalizeSummary(raw){
  const item=raw&&typeof raw==='object'?raw:{};
  return {
    passed:number(item.passed),review:number(item.review),errors:number(item.errors),notChecked:number(item.notChecked),
    status:status(item.status,['APPROVED','REVIEW','ERROR'],'REVIEW'),
  };
}
function summaryFromChecks(checks,raw){
  const list=Array.isArray(checks)?checks:[];
  if(!list.length)return normalizeSummary(raw);
  const out={passed:0,review:0,errors:0,notChecked:0,status:'APPROVED'};
  for(const check of list){
    if(check.status==='MATCH')out.passed+=1;
    else if(check.status==='MISMATCH')out.errors+=1;
    else if(check.status==='REVIEW')out.review+=1;
    else if(check.status==='NOT_CHECKED')out.notChecked+=1;
  }
  out.status=out.errors?'ERROR':(out.review?'REVIEW':'APPROVED');
  return out;
}
function normalizeRun(raw,nowFallback){
  const item=raw&&typeof raw==='object'?raw:{};
  const checks=(Array.isArray(item.checks)?item.checks:[]).slice(0,MAX_CHECKS).map(normalizeCheck).filter(check=>check.rule);
  return {
    id:clean(item.id,80),
    at:clean(item.at,40)||nowFallback||new Date().toISOString(),
    referenceAt:clean(item.referenceAt,40)||clean(item.at,40)||nowFallback||new Date().toISOString(),
    fileName:path.basename(clean(item.fileName,220)||'layout.pdf'),
    documentType:status(item.documentType,['CARE_LABEL','PRICE_TAG','UNKNOWN'],'UNKNOWN'),
    modelCodes:list(item.modelCodes,12,120),
    colourCodes:list(item.colourCodes,12,80),
    summary:summaryFromChecks(checks,item.summary),
    checks,
    aiFindings:checks.filter(check=>check.source==='LCW AI'||check.rule.startsWith('AI_VISUAL_')).slice(0,30),
    referenceRowCount:number(item.referenceRowCount),
  };
}
function normalizeStore(raw){
  const source=raw&&typeof raw==='object'&&!Array.isArray(raw)?raw:{};
  return {
    schemaVersion:SCHEMA_VERSION,
    runs:(Array.isArray(source.runs)?source.runs:[]).slice(0,MAX_RUNS).map(item=>normalizeRun(item,source.updatedAt)),
    revision:number(source.revision),
    updatedAt:clean(source.updatedAt,40)||null,
  };
}
function load(ownerId){
  const file=fileFor(ownerId);
  fs.mkdirSync(ROOT,{recursive:true});
  return readJsonWithValidatedBackup(file,{
    fallback:emptyStore,
    normalize:normalizeStore,
    restore:value=>atomicWriteJson(file,value),
  });
}
function persist(ownerId,store){
  const file=fileFor(ownerId);
  fs.mkdirSync(ROOT,{recursive:true});
  const next={
    schemaVersion:SCHEMA_VERSION,
    runs:(store.runs||[]).slice(0,MAX_RUNS),
    revision:number(store.revision)+1,
    updatedAt:new Date().toISOString(),
  };
  atomicWriteJson(file,next);
  return next;
}
function add(ownerId,payload){
  const store=load(ownerId), now=new Date().toISOString();
  const run=normalizeRun({...payload,id:'layout_'+Date.now().toString(36)+'_'+crypto.randomBytes(5).toString('hex'),at:now,referenceAt:now},now);
  store.runs=[run,...store.runs.filter(item=>item.id!==run.id)].slice(0,MAX_RUNS);
  const saved=persist(ownerId,store);
  return {run,revision:saved.revision,updatedAt:saved.updatedAt};
}
function listRuns(ownerId,limit=30){
  const store=load(ownerId), cap=Math.max(1,Math.min(MAX_RUNS,number(limit)||30));
  return {runs:store.runs.slice(0,cap),revision:store.revision,updatedAt:store.updatedAt};
}
function clear(ownerId){
  const store=load(ownerId),count=store.runs.length;
  store.runs=[];
  const saved=persist(ownerId,store);
  return {cleared:count,revision:saved.revision,updatedAt:saved.updatedAt};
}

module.exports={ROOT,SCHEMA_VERSION,MAX_RUNS,MAX_CHECKS,ownerKey,fileFor,emptyStore,normalizeSummary,summaryFromChecks,normalizeRun,normalizeStore,load,add,listRuns,clear};
