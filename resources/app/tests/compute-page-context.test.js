'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),crypto=require('node:crypto');
const {extractFunction}=require('./helpers/app-main-functions'),source=require('./helpers/server-source')();
test('persisted page context includes resolved view/edit scope and authoritative order generation',()=>{
  let accessHash='view-scope-1';
  const context={sourceUserId:()=> 'a',loadOverrides:()=>({}),loadModelConnections:()=>({items:[],revision:1}),
    userAccess:{roleWorkspaceEntries:()=>[],publicProfile:()=>({id:'a',role:'buyer',status:'ACTIVE',scopes:{buyers:['Same legacy scope']}}),computeAccessContext:()=>({accessHash})},
    userPreferences:{applyHorizonOverrides:()=>[]},sourceFilterReadiness:()=>({ready:true}),sourceFolderForUser:()=>'',pageProjectionCache:{CACHE_SCHEMA_VERSION:2},stableHashValue:value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex')};
  vm.createContext(context);vm.runInContext(extractFunction(source,'pageProjectionContext')+';globalThis.read=pageProjectionContext;',context);
  const original=context.read({id:'a'}).contextHash;accessHash='view-scope-2';assert.notEqual(context.read({id:'a'}).contextHash,original);
  accessHash='authority-3';assert.notEqual(context.read({id:'a'}).contextHash,original);
});
