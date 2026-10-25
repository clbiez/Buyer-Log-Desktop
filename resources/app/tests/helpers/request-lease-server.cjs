'use strict';
const http=require('node:http'),path=require('node:path');
const fs=require('node:fs');
const root=process.argv[2];process.env.BUYER_LOG_SERVER_DATA_ROOT=root;
const appRoot=process.env.BL_LEASE_SOURCE_ROOT||path.resolve(__dirname,'../..');
const fabric=require(path.join(appRoot,'server/lib/fabric-cards'));
const checklist=require(path.join(appRoot,'server/lib/checklist-supplier-store'));
const prefs=require(path.join(appRoot,'server/lib/user-preferences'));
const server=http.createServer(async(req,res)=>{
  try{
    let result;
    if(req.url==='/health')result={ok:true};
    else if(req.url==='/write/fabric')result=await fabric.upsertFabricCards([{code:'1001',summary:'Synthetic fabric'}],{id:'demo'});
    else if(req.url==='/write/checklist')result=await checklist.replaceDefinitions([{id:'demo',name:'Synthetic checklist',kind:'checklist'}],{id:'demo'});
    else if(req.url==='/write/preferences')result=await (prefs.mergeAsync||prefs.merge)('demo',{'lcw.todo.demo':{value:'Synthetic note'}});
    else if(req.url==='/read')result=fabric.publicCards();
    else {res.statusCode=404;result={error:'not-found'};}
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify(result));
  }catch(error){res.statusCode=error.statusCode||500;res.end(JSON.stringify({code:error.code,error:error.message}));}
});
server.listen(0,'127.0.0.1',()=>process.send({port:server.address().port,targets:{fabric:fabric.FILE,checklist:checklist.FILE,preferences:require('node:path').join(root,'user-preferences/demo.json')}}));
process.once('message',()=>server.close(()=>process.disconnect()));
