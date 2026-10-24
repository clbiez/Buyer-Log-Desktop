'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),assets=require('../server/lib/license-card-assets'),register=require('../server/routes/license-card-routes');
test('shared license images recheck the current session after asynchronous loading and before sending bytes',async()=>{
 const oldRead=assets.read;try{for(const revoked of [false,true]){let release,live={id:'a',enabled:true},sent=false,status=200,body;const handlers={},app={get:(url,...args)=>{handlers[url]=args.at(-1);},post(){},put(){},delete(){}},userAccess={requireAnyArea:()=>()=>{},requirePermission:()=>()=>{},hasPermission:()=>false,hasArea:()=>true,profileById:()=>({id:'a',enabled:true}),sessionProfile:()=>live};
 register(app,{userAccess,service:{}});assets.read=()=>new Promise(resolve=>{release=resolve;});const response={status:value=>{status=value;return response;},json:value=>{body=value;return response;},set:()=>response,end:()=>{sent=true;}};
 const pending=handlers['/api/license-cards/assets/:name']({params:{name:'fixture.png'},currentUser:{id:'a'}},response);if(revoked)live=null;release({type:'image/png',bytes:Buffer.from('fixture')});await pending;
 assert.equal(sent,!revoked);assert.equal(status,revoked?403:200);if(revoked)assert.equal(body.code,'OFFICE_TOOL_FORBIDDEN');
 }}finally{assets.read=oldRead;}
});
