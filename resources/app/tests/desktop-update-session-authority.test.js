'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
function fixture({actor='buyer',claimed='moderator',status='ACTIVE',enabled=true}={}){
 const root=path.resolve(__dirname,'..'),main=fs.readFileSync(path.join(root,'electron/main.js'),'utf8'),server=fs.readFileSync(path.join(root,'server/server.js'),'utf8');
 const profiles=[{id:'moderator',role:'moderator',systemRole:'moderator',status:actor==='moderator'?status:'ACTIVE',enabled:actor==='moderator'?enabled:true},{id:'buyer',role:'buyer',systemRole:'buyer',status:'ACTIVE',enabled:true}];
 const access={readStore:()=>({moderator:profiles[0],users:[profiles[1]]}),sessionProfile:req=>{
  const profile=profiles.find(p=>req.headers.cookie==='bl_user_session=valid-'+p.id);
  return profile&&profile.enabled!==false&&profile.status==='ACTIVE'?profile:null;
 }};
 let route,pickerCalled=false;
 const backendContext={app:{post:(_route,_parser,handler)=>route=handler},express:{json:()=>()=>{}},desktopBridgeAuthorized:()=>true,userAccess:access,require:()=>access};
 const start=server.indexOf("app.post('/api/internal/desktop/update-authority'"),end=server.indexOf('// Geçit:',start);
 vm.runInNewContext(server.slice(start,end),backendContext);
 const context={backend:{running:true,origin:'http://127.0.0.1:6303'},desktopBridgeSecret:'synthetic-desktop-secret',activeBuyerLogContents:()=>({session:{cookies:{get:async()=>actor?[{name:'bl_user_session',value:'valid-'+actor}]:[]}}}),fetch:async(_url,options)=>{
  const response={status:200};const res={status(code){response.status=code;return this;},set(){return this;},json(body){response.body=body;return this;}};
  route({body:JSON.parse(options.body),headers:{cookie:options.headers.Cookie||options.headers.cookie||''}},res);
  return {ok:response.status<400,json:async()=>response.body};
 }};
 const begin=main.indexOf('async function verifyUpdateModerator('),finish=main.indexOf('async function currentRendererUserId(',begin);
 vm.runInNewContext(main.slice(begin,finish),context);
 return {authorize:()=>context.verifyUpdateModerator(claimed),invoke:async()=>{if(await context.verifyUpdateModerator(claimed))pickerCalled=true;return pickerCalled;}};
}
test('a buyer renderer cannot use a claimed moderator ID to open the privileged patch picker',async()=>{
 assert.equal(await fixture().invoke(),false);
});
test('only the active moderator session authorizes its own update operation',async()=>{
 assert.equal(await fixture({actor:'moderator',claimed:'moderator'}).authorize(),true);
 assert.equal(await fixture({actor:'buyer',claimed:'buyer'}).authorize(),false);
 assert.equal(await fixture({actor:null}).authorize(),false);
 for(const options of [{enabled:false},{status:'INACTIVE'}])assert.equal(await fixture({actor:'moderator',claimed:'moderator',...options}).authorize(),false);
});
