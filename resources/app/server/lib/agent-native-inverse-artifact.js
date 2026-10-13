'use strict';
const artifacts=require('./agent-artifact-store'),zlib=require('node:zlib'),{error}=require('./agent-office-store');
const LIMIT=256*1024*1024,KIND='agent-native-inverse';
async function archive(ctx,toolId,before){
 const frame={ownerId:ctx.ownerId,jobId:ctx.input.officeJobId,stepId:ctx.input.officeStepId,toolId,before},bytes=Buffer.from(JSON.stringify(frame));if(bytes.length>LIMIT)throw error('OFFICE_ARTIFACT_LIMIT',413);
 const meta=await artifacts.put(ctx.profile,zlib.gzipSync(bytes),'native-before.json.gz',KIND);ctx.assertAuthority();if(!/^[a-f0-9]{32}$/.test(meta?.id))throw error('OFFICE_ARTIFACT_CHANGED',409);return meta.id;
}
function restore(ctx,toolId,token){
 if(!token.artifactId)return token;
 const {buffer}=artifacts.read(ctx.profile,token.artifactId,KIND);let frame;try{frame=JSON.parse(zlib.gunzipSync(buffer,{maxOutputLength:LIMIT}));}catch(_){throw error('OFFICE_ROLLBACK_INVALID',409);}
 if(frame.ownerId!==ctx.ownerId||frame.jobId!==ctx.input?.officeJobId||frame.stepId!==ctx.input?.officeStepId||frame.toolId!==toolId)throw error('OFFICE_ROLLBACK_INVALID',409);
 return {...token,before:frame.before};
}
module.exports={archive,restore};
