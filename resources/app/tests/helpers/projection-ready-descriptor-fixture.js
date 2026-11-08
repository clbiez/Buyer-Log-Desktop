'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {fixture,sha,clone}=require('./projection-view-cache-fixture');
const builder=require('../../server/lib/projection-ready-json'),schemas=require('../../public/module-projection-schema');
function producer(){return{builder,schemas};}
async function readyFixture(t){
 const f=fixture(t);f.full.rows[0].__CPX_DESCRIPTOR=0;f.full.rows[1].__CPX_DESCRIPTOR=false;
 await f.start();const p=f.pin(),{builder,schemas}=producer();
 const definitions=[JSON.parse('{"id":"descriptor","header":"__CPX_DESCRIPTOR","label":"Synthetic metadata","role":"asas","group":"","dataType":"Double","sourceMetadata":{"zero":0,"flag":false,"nil":null},"percentageScale":0,"__proto__":{"own":true},"constructor":"raw"}')];
 const schema=schemas.build({module:'orders',rows:f.full.rows,modelColumns:definitions,modelSchemaKnown:true,canExpose:true,
  scopePolicy:{schemaSource:'target',targetKnown:true,bindingsKnown:true,cpSchemaAllowed:true}});
 assert.ok(schema,'actual schema helper');
 const text=JSON.stringify(f.full),viewInfo={ownerId:f.owner,actorId:'actor',sourceKey:p.sourceProjectionKey,sourceGeneration:p.generation,
  accessHash:'synthetic-access',planEpoch:0,fullJsonSha256:sha(text),fullJsonBytes:Buffer.byteLength(text)};
 const result=await builder.prepareReadyJson(f.full,{schema,omittedKeys:['__CPX_DESCRIPTOR'],viewInfo});
 assert.equal(result.kind,'ready',result.reason);
 const e={buffer:result.buffer,bytes:result.buffer.length,uncompressedBytes:result.uncompressedBytes,checksum:result.checksum,
  registryKeys:result.registryKeys,info:result.info};
 return{...f,p,e,result};
}
module.exports={readyFixture,producer,sha,clone};
