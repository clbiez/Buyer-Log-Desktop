'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {accessForTask}=require('../server/lib/compute-task-access');
const policy=require('../server/lib/compute-access'),tasks=require('../server/lib/compute-tasks');
const raw=[{ocode:101,model:'Demo',ccode:'01',buyer:'Demo',merch:'M',ageGroup:'A',buyerGrup:'G',qty:10,kalan:10,fob:4},{ocode:102,model:'Foreign',ccode:'01',buyer:'Other',qty:10,kalan:10,fob:4}];
const source={asasOrders:raw,antrepoMap:{}};
test('task access sends authority only to computations that use code editing or shared ownership',()=>{
 for(const moderator of [false,true]){
  const context=policy.createAccessContext({userId:'a',systemRole:moderator?'moderator':'buyer',manageAll:moderator,viewScope:{mode:'CUSTOM',buyers:['Demo']},editScopes:{buyers:['Demo']},authority:{101:[raw[0]],102:[raw[1]]},profiles:[{id:'a',username:'Demo'},{id:'b',username:'Other'}]});
  for(const task of ['backlog-export','backlog-map-details','projection-plan','source-info','cp-image-registry','collection-lfl-source-info','collection-lfl-references']){
   const compact=accessForTask(context,task,{});assert.deepEqual(compact.authority,{});assert.deepEqual(compact.ownershipProfiles,[]);assert.equal(compact.viewScope,context.viewScope);assert.equal(compact.accessHash,context.accessHash);
  }
  const params={access:context,headers:[],overrides:{},horizons:{},options:{},sourceColumns:[],includeSourceDetails:true};
  assert.deepEqual(tasks.buildBacklog('export',source,{...params,access:accessForTask(context,'backlog-export',params)}),tasks.buildBacklog('export',source,params));
  for(const modules of [['cp'],['orders'],['overview'],['order-summary'],['cp','orders']])for(const sharedHints of [false,true]){
   const input={...params,modules,sharedHints},compact=accessForTask(context,'projections',input);
   assert.deepEqual(tasks.buildProjections(source,{...input,access:compact}),tasks.buildProjections(source,input));
   if(!moderator&&(modules.includes('cp')||modules.includes('order-summary')))assert.equal(compact.authority,context.authority);
  }
  const codeHints=accessForTask(context,'cp-shared-edit-codes',{});if(moderator)assert.deepEqual(codeHints.authority,{});else assert.equal(codeHints.authority,context.authority);
  const shared=accessForTask(context,'projection-envelope',{legacyModule:'cp'});
  assert.deepEqual(policy.sharedRows(shared,[{'Order Code':101,'Model Name':'Demo','C.Code':'01'}]),policy.sharedRows(context,[{'Order Code':101,'Model Name':'Demo','C.Code':'01'}]));
  if(!moderator)assert.equal(shared.authority,context.authority);
  assert.equal(accessForTask(context,'unknown-future-task',{}),context);
 }
});
