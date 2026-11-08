'use strict';
// Native test fault traps only. No alternative parser/schema algorithm.
const {workerData}=require('node:worker_threads'),path=require('node:path');
const fixture=workerData?.projectionSchemaPreparation;
if(fixture){
 if(fixture.forbidCpBuild){
  const parse=require(path.join(fixture.app,'server/lib/parse'));
  for(const name of ['buildCPRowsFromASAS','buildSharedOrderProjectionRowsFromASAS'])parse[name]=()=>{throw Object.assign(Error('Unexpected CP parser call in Orders-only native job'),{code:'COMPUTE_WORKER_FAILED'});};
 }
 if(fixture.failSchemaSource){
  const actual=require(path.join(fixture.app,'server/lib/compute-module-schemas'));
  actual.buildModuleSchemas=()=>{throw Object.assign(Error('Synthetic callback-source failure'),{code:'COMPUTE_WORKER_FAILED'});};
 }
}
