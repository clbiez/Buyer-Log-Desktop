'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {fixture}=require('./fixtures/orders-model-action-closure/native-fixture.cjs'),{extractFunction}=require('./helpers/app-main-functions');
const source=fs.readFileSync(path.join(__dirname,'../public/app-main.js'),'utf8');
for(const tab of ['cp','orders'])test('full '+tab+' model actions preserve access independently of the other table',{timeout:5000},async()=>{
 const f=fixture({active:false,tab});f.c.window.BLCanAccessArea=area=>area===tab||area==='source';
 if(tab==='cp')f.state.orders=null;
 await f.open();await f.chooseField();await f.save();
 assert.equal(f.patches.length,1);assert.equal(f.patches[0].command.op,'update');assert.equal(f.serverItems[0].cpColumns.length,1);
});
for(const tab of ['cp','orders'])test('full model actions reject current '+tab+' access revocation even when the other table remains allowed',{timeout:5000},async()=>{
 const f=fixture({active:false,tab});await f.open();await f.chooseField();f.c.window.BLCanAccessArea=area=>area!==tab;
 await f.save();assert.equal(f.patches.length,0,'revoked current table must not dispatch');
});
test('an own modelConnections notification cannot interrupt the add/remove source move',{timeout:5000},async()=>{
 const f=fixture({active:true});f.c.window.BL_CLIENT_ID='synthetic-model-own-window';let reloads=0;
 f.c.loadFromServer=async()=>{reloads++;};vm.runInContext(extractFunction(source,'refreshSharedMasterClient'),f.c);
 const start=source.indexOf('  const handle=payload=>{',source.indexOf('function initLiveSync(){')),end=source.indexOf('  const channel=',start);assert.ok(start>=0&&end>start);
 const notifications=[];
 const handle=Function('window','refreshSharedMasterClient','let liveSyncConnected=false;'+source.slice(start,end)+';return handle;')(f.c.window,area=>{
  const promise=f.c.refreshSharedMasterClient(area);notifications.push(promise);return promise;
 });
 await f.open();await f.chooseConnection('b');await f.chooseField();
 const hold=f.hold(r=>r.opts.method==='PATCH'&&r.body.cpColumn.op==='add','http'),pending=f.save();
 const request=await hold.entered;
 handle({area:'modelConnections',originClientId:request.opts.headers['X-Client-Id']||''});
 await Promise.allSettled(notifications);hold.release();await pending;
 assert.deepEqual(f.patches.map(p=>p.command.op),['add','remove'],'both committed move stages must finish despite an own notification');
 assert.equal(notifications.length,0);assert.equal(reloads,0);assert.equal(f.serverItems[0].cpColumns.length,0);assert.equal(f.serverItems[1].cpColumns.length,1);
 const writes=f.requests.filter(r=>r.opts.method==='PATCH');assert.equal(writes.length,2);
 for(const write of writes){assert.equal(write.opts.headers['X-Client-Id'],'synthetic-model-own-window');assert.ok(write.body.expectedSourceRevision);}
});
