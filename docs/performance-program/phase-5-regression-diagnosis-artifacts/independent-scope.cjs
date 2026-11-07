'use strict';
// Read-only supplemental experiment, using the exact committed native fixture.
// Change Horizon and Buyer independently, without query filters masking either.
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const file='/workspace/Buyer-Log-Desktop/resources/app/tests/phase5-regression-behavior.test.js';
const extra=`
test('native unfiltered Backlog independently enforces target, Horizon and Buyer',async t=>{
 const f=await fixture(t);
 async function read(){
  const lease=await f.service.run('backlog-export',f.descriptor,f.c.api.params(f.profile,f.descriptor,'backlog-export',{options:{},sourceColumns:[]}));
  try{return decode(lease.value).rows;}finally{lease.release();}
 }
 const ordinary=await read();assert.deepEqual([...new Set(ordinary.map(r=>r['Sipariş Kod']))].sort(),[1001,1004]);
 assert.ok(ordinary.every(r=>r.Buyer==='Buyer A'));assert.equal(ordinary.reduce((n,r)=>n+r.Adet,0),200);
 f.horizons.backlog={seasons:['W6']};const horizon=await read();assert.deepEqual(horizon.map(r=>r['Sipariş Kod']),[1003]);
 f.horizons.backlog={seasons:['S7']};f.setAccess({systemRole:'buyer',viewScope:{buyers:['Foreign Buyer']},authority:{},profiles:[]});
 const foreign=await read();assert.deepEqual(foreign.map(r=>r['Sipariş Kod']),[1002]);assert.ok(foreign.every(r=>r.Buyer==='Foreign Buyer'));
 console.log('NATIVE_SCOPE '+JSON.stringify({ordinaryCodes:[1001,1004],ordinaryQuantity:200,horizonOnlyCodes:[1003],buyerOnlyCodes:[1002]}));
});`;
const loaded=new Module(file,module);loaded.filename=file;loaded.paths=Module._nodeModulePaths(path.dirname(file));loaded._compile(fs.readFileSync(file,'utf8')+extra,file);
