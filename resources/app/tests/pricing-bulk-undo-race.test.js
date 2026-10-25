'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../public/pricing-desk.js'),'utf8');
test('a new price edit during bulk Undo keeps its own history group after ACK',async()=>{
 const start=source.indexOf('  async function undoLast('),end=source.indexOf('\n  /* ================= MASA',start);assert.ok(start>=0&&end>start);
 let release;const req={id:'request',ownerId:'owner',items:[{id:'line',rev:2,price:'4'}]},old={requestId:'request',entries:[{lineId:'line',prev:{price:'2'}}],bulkGuard:{user:'buyer',owner:'owner',revisions:{line:2}}},newer={requestId:'request',entries:[{lineId:'line',prev:{price:'4'}}]},state={undo:[old]},api={requests:()=>[req],currentUserId:()=> 'buyer',canEdit:()=>true,applyPricesBatch:()=>new Promise(resolve=>release=resolve),renderDetail(){}};
 const ctx={Q:()=>api,state,toast(){},L:(_tr,en)=>en,clean:String};vm.createContext(ctx);vm.runInContext(source.slice(start,end),ctx);
 const pending=ctx.undoLast();state.undo.push(newer);release({ok:true});assert.equal(await pending,true);assert.deepEqual(state.undo,[newer]);
});
