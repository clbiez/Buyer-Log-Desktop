'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
test('native CP writes coalesce by full line identity; captured callbacks settle only after one batch ACK',async()=>{
 const sent=[],context={window:{},state:{storeRevisions:{orders:7,suppFob:3}},appLang:'en',showToast(){},loadFromServer:async()=>{},fetchJSON:async(url,opts)=>{sent.push({url,opts});return {revision:8,revisions:{orders:8,suppFob:4}};}};
 vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(__dirname,'../public/override-sync.js'),'utf8'),context);
 let settled=0;const captured=context.window.captureOverrideBatch(()=>{
  for(const patch of [{model:'M',ccode:'01',dates:{retailDate:'2026-11-01'}},{model:'M',ccode:'01',dates:{inStoreDate:'2026-11-15'},suppFob:4,suppFobMeta:{source:'manual'}},{model:'M',ccode:'02',importance:'regular'}])context.window.enqueueOverrideMutation('orders','/api/overrides/123',{method:'PATCH',body:JSON.stringify(patch)}).then(()=>settled++);
 });
 assert.equal(sent.length,0);assert.equal(settled,0);assert.equal(captured.items.length,2);assert.deepEqual(JSON.parse(JSON.stringify(captured.items[0].patch.dates)),{retailDate:'2026-11-01',inStoreDate:'2026-11-15'});
 const data=await context.window.enqueueOverrideMutation('orders','/api/overrides/batch',{method:'POST',expectedRevision:6,headers:{'X-Supp-Fob-Revision':'2'},body:JSON.stringify({items:captured.items})});
 assert.equal(sent.length,1);assert.equal(sent[0].opts.expectedRevision,6);assert.equal(sent[0].opts.headers['X-Supp-Fob-Revision'],'2');assert.equal(settled,0);captured.resolve(data);await Promise.resolve();assert.equal(settled,3);assert.equal(context.state.storeRevisions.orders,8);
});
