'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const ownership=require('../server/lib/cp-field-ownership'),access=require('../server/lib/compute-access');
test('pooled code decisions match the exact per-line ownership rule for owners, managers, moderators and malformed codes',()=>{
 const authority={101:[{buyer:'Alice'}],102:[{buyer:'Alice'},{buyer:'Bob'}],103:[{buyer:'Unknown'}]},profiles=[{id:'a',username:'Alice'},{id:'b',username:'Bob'}];
 const codes=[' 101 ','101','000101','102','103','404','x|y','../101',null,12,{},'1'.repeat(21)];
 for(const [userId,systemRole]of [['a','buyer'],['b','buyer'],['m','manager'],['moderator','moderator'],['','buyer']]){
  const resolve=ownership.createOwnershipResolver(authority,profiles),expected=[...new Set(codes.map(value=>String(value??'').trim()).filter(value=>/^\d{1,20}$/.test(value)))].filter(code=>!resolve({recordId:`cp-order:${code}||`,userId,systemRole}).allowed);
  const context=access.createAccessContext({userId,systemRole,manageAll:true,authority,profiles});
  assert.deepEqual(ownership.deniedOrderCodes(resolve,{userId,systemRole},codes),expected);
  assert.deepEqual(access.sharedEditDeniedCodes(context,codes),expected);
 }
});
test('HTTP code hints use the guarded common pool and ready bytes, without iterating ownership on the server thread',async()=>{
 const source=require('./helpers/server-source')(),start=source.indexOf("app.post('/api/cp-shared-edit'"),end=source.indexOf('\n});',start)+4;
 let handler,task,sent;const forbidden=()=>{throw Error('Main-thread code ownership loop is forbidden');};
 const context={app:{post:(_path,...args)=>{handler=args.at(-1);}},userAccess:{requireArea:()=>null,sharedEditDeniedOrderCodes:forbidden},express:{json:()=>null},CP_SHARED_EDIT_MAX_CODES:200000,
  computeReads:{run:async(_req,area,name,parts,options)=>{task={area,name,parts,options};return {value:{buffer:new ArrayBuffer(1)}};}},sendComputedResponse:(_req,_res,lease)=>{sent=lease;},apiError:(_res,error)=>{throw error;}};
 vm.runInNewContext(source.slice(start,end),context);
 await handler({body:{codes:['101','102']},currentUser:{id:'a'}},{set(){return this;},json(){}});
 assert.equal(task.area,'cp');assert.equal(task.name,'cp-shared-edit-codes');assert.deepEqual(Array.from(task.parts.codes),['101','102']);assert.equal(task.options.cache,false);assert.ok(sent);
});
