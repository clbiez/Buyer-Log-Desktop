'use strict';
// Test-only IAM, anonymous engine and temporary filesystem. Never a production server.
const express=require('express');
const path=require('node:path');
const {createAgentOfficeStore}=require('../../server/lib/agent-office-store');
const {createAgentOfficeSync}=require('../../server/lib/agent-office-sync');
const {createAgentOfficeService}=require('../../server/lib/agent-office-service');
const register=require('../../server/routes/agent-office-routes');
const profiles={owner:{id:'owner',enabled:true,systemRole:'buyer',displayName:'Anonymous owner'},moderator:{id:'moderator',enabled:true,systemRole:'moderator',displayName:'Anonymous moderator'},peer:{id:'peer',enabled:true,systemRole:'buyer',displayName:'Anonymous peer'}};
const userAccess={profileById:id=>profiles[id],hasArea:(p,area)=>p.id!=='peer'||area==='koleksiyon',hasCapability:()=>false,appendAudit:()=>{},requireModerator:(req,res,next)=>req.currentUser.systemRole==='moderator'?next():res.status(403).json({code:'OFFICE_MODERATOR_REQUIRED'})};
const root=process.argv[2],shared=process.argv[3],device=process.argv[4];
const store=createAgentOfficeStore({root:path.join(root,'private')});
const sync=createAgentOfficeSync({store,localRoot:path.join(root,'sync'),getSharedRoot:async()=>shared,profileById:userAccess.profileById,deviceId:device});
const engine={ask:async(owner,input)=>({structured:{ok:true},data:{answer:'Anonymous fixture response',perspectives:input.context.participants.map(p=>p.id+'|Fixture'),references:[],confidence:'MEDIUM'},model:{label:'TEST ONLY'}}),cancel:()=>true};
const service=createAgentOfficeService({store,sync,userAccess,engine,getOperationalData:async()=>({cpRows:[],cpAvailable:true,sourceUpdatedAt:'2026-10-10T00:00:00Z',reports:{reports:{},links:{}},checklist:{answers:{},definitions:[]}})});
const app=express();
app.use((req,res,next)=>{req.currentUser=profiles[req.headers['x-test-user']];next();});
register(app,{express,service,userAccess,listOwners:async()=>Object.keys(profiles)});
const server=app.listen(0,'127.0.0.1',()=>process.send({type:'ready',port:server.address().port,pid:process.pid}));
process.on('message',async message=>{
  if(message.type==='role'){profiles[message.owner].systemRole=message.role;process.send({type:'role',id:message.id});}
  if(message.type==='stop'){service.stop();server.close(()=>process.exit(0));}
});
