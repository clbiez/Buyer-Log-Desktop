'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const source=require('./helpers/server-source')();
test('health is a small non-cached liveness response and never reads user/source stores',()=>{
  const at=source.indexOf("app.get('/api/health'");assert.ok(at>0,'health endpoint must exist');const end=source.indexOf('\n});',at)+4;let handler,body,cacheControl;
  const forbidden=()=>{throw Error('Health must not read private state');};
  const context={app:{get:(_path,fn)=>handler=fn},APP_VERSION:'synthetic-version',loadOverrides:forbidden,cacheForUser:forbidden,userAccess:new Proxy({}, {get:forbidden})};
  vm.createContext(context);vm.runInContext(source.slice(at,end),context);
  const response={set:(key,value)=>{if(key==='Cache-Control')cacheControl=value;return response;},json:value=>{body=value;}};handler({},response);
  assert.equal(body.ok,true);assert.equal(body.app,'Buyer Log');assert.equal(body.appVersion,'synthetic-version');assert.deepEqual(Object.keys(body).sort(),['app','appVersion','ok']);assert.equal(cacheControl,'no-store');assert.ok(Buffer.byteLength(JSON.stringify(body))<256);
});
