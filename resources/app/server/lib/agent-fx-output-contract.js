'use strict';
const {object,string,array}=require('./agent-capability-contract'),{validate}=require('./agent-tool-schema');
const req=p=>({...object(p),required:Object.keys(p)}),count={type:'integer',minimum:0},flag={type:'boolean'},sha={...string(64),pattern:'^[a-f0-9]{64}$'},text=string(10000),nullableText={type:['string','null'],maxLength:10000},rate={type:['number','string','null'],maxLength:10000},dict=items=>({type:'object',additionalProperties:items}),months=dict(dict(rate)),omissions=req({fields:count,currencies:count,months:count,rates:count});
const snapshot=req({base:text,currencies:array(text,1000000),months,updatedAt:nullableText,sourceType:nullableText,sourceModifiedAt:nullableText,_revision:count,_updatedAt:nullableText,sourceFileAvailable:flag,omissions});
const readOutput=req({verified:{enum:[true]},data:snapshot}),dry=req({verified:{enum:[true]},preview:req({before:snapshot,next:snapshot,impact:req({months:array(string(7),200),currencies:array(string(3),200),recalculates:array(string(100),2),scope:{enum:['shared-source']}})}),fingerprint:sha}),output=req({verified:{enum:[true]},data:req({revision:count,rates:months,omissions}),rollbackToken:req({section:{enum:['fx']},expectedRevision:count,artifactId:{...string(32),pattern:'^[a-f0-9]{32}$'}})});
const safe=k=>!['__proto__','prototype','constructor'].includes(k);
function project(native){
 const data={base:native.base,currencies:[],months:{},_revision:native._revision,sourceFileAvailable:!!native.sourceFile,omissions:{fields:0,currencies:0,months:0,rates:0}};
 for(const key of ['updatedAt','sourceType','sourceModifiedAt','_updatedAt']){try{validate(nullableText,native[key]);data[key]=native[key];}catch(_){data[key]=null;data.omissions.fields++;}}
 for(const value of native.currencies){try{validate(text,value);data.currencies.push(value);}catch(_){data.omissions.currencies++;}}
 for(const [month,values]of Object.entries(native.months)){if(!safe(month)||!values||typeof values!=='object'||Array.isArray(values)){data.omissions.months++;continue;}const rates={};for(const [currency,value]of Object.entries(values)){try{if(!safe(currency))throw Error('unsafe key');validate(rate,value);rates[currency]=value;}catch(_){data.omissions.rates++;}}data.months[month]=rates;}
 for(const key of Object.keys(native))if(!['base','currencies','months','updatedAt','sourceType','sourceModifiedAt','sourceFile','_revision','_updatedAt'].includes(key))data.omissions.fields++;
 return data;
}
const projectPreview=native=>({before:project(native.before),next:project(native.next),impact:native.impact});
module.exports={readOutput,dry,output,project,projectPreview};
