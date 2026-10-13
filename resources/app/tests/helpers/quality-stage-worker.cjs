'use strict';
const path=require('path'),libs=path.resolve(__dirname,'../../server/lib');
if(process.env.QUALITY_TEST_MODE==='answer-race') {
  const leases=require(path.join(libs,'shared-file-transaction')),real=leases.withFileLeaseSync;
  leases.withFileLeaseSync=(file,operation,options)=>real(file,()=>{
    process.send({type:'held'});Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,650);return operation();
  },options);
  const checklist=require(path.join(libs,'checklist-supplier-store'));
  process.on('message',message=>{try{const result=checklist.applyEntries([message.entry],{id:message.owner},{source:'test_report'});process.send({type:'done',revision:result.revision});}catch(err){process.send({type:'error',code:err.code||err.message});}});
}else {
  const staging=require(path.join(libs,'test-reports/staging')),service=require(path.join(libs,'test-reports/service')).createService({authorizedOrders:async()=>new Map()});
  staging.getSession('not-a-session','none'); // start before the other process uploads
  process.on('message',message=>{try{
    const session=staging.getSession(message.sessionId,message.owner);
    if(message.action==='update')service.acceptAi({id:message.owner},{sessionId:message.sessionId,fileName:'report.png',data:message.data});
    process.send({type:'done',exists:!!session,reports:session?.reports.length});
  }catch(err){process.send({type:'error',code:err.code||err.message});}});
}
process.send({type:'ready'});
