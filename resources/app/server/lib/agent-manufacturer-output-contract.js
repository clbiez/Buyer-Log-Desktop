'use strict';
const {object,string,array}=require('./agent-capability-contract'),{error,hash}=require('./agent-office-store');
const required=properties=>({...object(properties),required:Object.keys(properties)}),count={type:'integer',minimum:0},text=max=>string(max),id={...text(160),minLength:1,pattern:'^[A-Za-z0-9_.:-]+$'},nullableText={type:['string','null'],maxLength:80},flag={type:'boolean'},MAX_BYTES=128*1024;
const fingerprint={...text(64),pattern:'^[a-f0-9]{64}$'};
const lock=required({userId:id,userName:text(240),at:text(80)}),heading=required({id,name:{...text(120),minLength:1},order:{...count,maximum:199}});
const record=required({id,manufacturer:text(240),dtrStatus:{enum:['DTR','NON-DTR']},dtrStatusAssigned:flag,aliases:array(text(240),30),origin:{enum:['','asas','manual']},email:text(2000),contact:text(240),phone:text(80),note:text(2000),countryId:text(160),typeId:text(160),createdAt:text(80),createdBy:text(160),createdByName:text(240),updatedAt:text(80),updatedBy:text(160),updatedByName:text(240),lock:{anyOf:[lock,{type:'null'}]}});
const readSchema=required({verified:{enum:[true]},data:{anyOf:[required({record,revision:count,sourceFingerprint:fingerprint}),required({countries:array(heading,50),types:array(heading,50),countryTotal:count,typeTotal:count,countriesTruncated:flag,typesTruncated:flag,records:array(record,250),revision:count,sourceFingerprint:fingerprint,updatedAt:nullableText,lockTtlMs:count,total:count,offset:count,returnedCount:count,nextOffset:count,hasMore:flag,truncated:flag})]}});
function assertWritableRevision(revision){if(!Number.isSafeInteger(revision)||revision<0||revision>Number.MAX_SAFE_INTEGER-3)throw error('OFFICE_RESOURCE_REVISION_INVALID',409);}
function writeSchema(operation){return required({verified:{enum:[true]},data:required({recordId:id,revision:count,operation:{enum:[operation]}}),rollbackToken:required({id,expectedRevision:count,before:{anyOf:[record,{type:'null'}]},index:{type:'integer',minimum:-1},deletedAt:nullableText})});}
function projectDirectory(native,args){
 const sourceFingerprint=hash(JSON.stringify({...native,records:native.records.map(({lock,...record})=>record)}));
 if(args.sourceFingerprint!==undefined&&args.sourceFingerprint!==sourceFingerprint)throw error('OFFICE_PREVIEW_CHANGED',409);
 if(args.expectedRevision!==undefined&&args.expectedRevision!==native.revision)throw error('OFFICE_PREVIEW_CHANGED',409);
 if(args.recordId){if(args.offset!==undefined||args.limit!==undefined)throw error('OFFICE_TOOL_SCHEMA',422);const record=native.records.find(record=>record.id===args.recordId);if(!record)throw error('OFFICE_NOT_FOUND',404);return {record,revision:native.revision,sourceFingerprint};}
 const offset=args.offset||0,limit=args.limit||250,data={countries:native.countries.slice(0,50),types:native.types.slice(0,50),countryTotal:native.countries.length,typeTotal:native.types.length,countriesTruncated:native.countries.length>50,typesTruncated:native.types.length>50,records:[],revision:native.revision,sourceFingerprint,updatedAt:native.updatedAt,lockTtlMs:native.lockTtlMs,total:native.records.length,offset,returnedCount:0,nextOffset:offset,hasMore:offset<native.records.length,truncated:native.records.length>0};
 for(const record of native.records.slice(offset,offset+limit)){
  const records=[...data.records,record],next={...data,records,returnedCount:records.length,nextOffset:offset+records.length,hasMore:offset+records.length<native.records.length,truncated:records.length<native.records.length};
  if(Buffer.byteLength(JSON.stringify({verified:true,data:next}))>MAX_BYTES)break;Object.assign(data,next);
 }
 return data;
}
module.exports={readSchema,writeSchema,projectDirectory,assertWritableRevision,MAX_BYTES};
