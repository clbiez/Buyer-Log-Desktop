'use strict';
// UNRUN V3 additions; all V1/V2 UI assertions remain byte-exact.
const nativeTest=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const test=(name,body)=>nativeTest(name,{timeout:5000},body);
const f=require('./ui-fixture.cjs'),c=f.composition;
test('V3 uses exact corrected d088 source and preserves the whole pending-profile target guard',()=>{
 assert.equal(f.hash(c.source),'d0885781d9b9a5e88135a1fd7a7c9c309603d4f4484191219079408ad1237810');
 const actual=f.extractFunction(c.source,'loadFromServer'),composed=f.extractFunction(c.patched,'loadFromServer');
 assert.equal(composed,actual);
 assert.ok(actual.includes("      const preferencesPage=activeProfilePage();\n      await ensureOrdersFullBeforePreferences();\n      if(activeProfilePage()!==preferencesPage)throw ordersFullActionError('ORDERS_FULL_STALE');"));
 for(const [file,sha] of [['tests/orders-ui-command.test.cjs','837d8e5578820edd1e6e33b12f8f744b7751db43e0e36bcac40e26a96ecf27cd'],
  ['tests/orders-ui-lifecycle-composition.test.cjs','974a3d3413c5774dbd21f2c593a90e78f67feaa19f28dfd27dfafe0b42eaa98f']])
  assert.equal(f.hash(fs.readFileSync(path.join(__dirname,'..',file))),sha,file+' retained exact assertions');
});
test('actual current installLifecycle supplies actual missing dependencies and exports IAM IIFE extraction',()=>{
 const context=vm.createContext({state:{orders:{rows:[]}},appLang:'en'});
 c.installLifecycle(context);
 assert.equal(context.AbortController,AbortController);assert.ok(context._ordersFullViewControllers instanceof WeakMap);
 const declaration=c.source.match(/^const projectionRequestGeneration=(\{[^;\n]+\});$/m);assert.ok(declaration);
 const expected=vm.runInNewContext('('+declaration[1]+')');
 assert.equal(JSON.stringify(context.projectionRequestGeneration),JSON.stringify(expected));
 for(const name of ['ordersProjectionIsThin','ordersFullActionError'])assert.equal(context[name].toString(),f.extractFunction(c.source,name));
 const iam=fs.readFileSync(path.join(c.APP,'public/user-access-ui.js'),'utf8');assert.equal(f.hash(iam),c.PINS.iamRetired);
 for(const name of ['beforeIamProfileApply','checkIamSession']){
  const body=c.extractIamFunction(iam,name);assert.ok(body.startsWith((name==='checkIamSession'?'async ':'')+'function '+name+'('));
 }
});
test('actual existing pending-profile regression runs unchanged against the selected V3 source',async()=>{
 // Reuse the ACTUAL current regression/helper bodies. No second handwritten
 // loader or watered-down assertion reproduces the expected implementation.
 const regression=fs.readFileSync(path.join(c.APP,'tests/orders-source-retirement.test.js'),'utf8');
 assert.equal(f.hash(regression),'70e8b1bb8ef2808eda77d242337f1da639bee47d5628294d601a5b8183bc5627');
 const names=regression.match(/^const names=\[[^\n]+\];$/m),turn=regression.match(/^const turn=[^\n]+;$/m);assert.ok(names);assert.ok(turn);
 const marker="test('retired-source fresh full wait cannot apply the profile after its target page changed',async()=>{";
 const at=regression.indexOf(marker);assert.ok(at>=0);assert.equal(regression.indexOf(marker,at+marker.length),-1);
 const run=f.extractFunction('async function runExistingProfileTargetRegression(){'+regression.slice(at+marker.length),'runExistingProfileTargetRegression');
 const context=vm.createContext({source:c.selectedSource,extractFunction:f.extractFunction,installLifecycle:c.installLifecycle,
  assert,vm,AbortController,Promise,Set,WeakMap,setImmediate});
 const helpers=['deferred','fixture','bootstrap'].map(name=>f.extractFunction(regression,name));
 vm.runInContext([names[0],turn[0],...helpers,run,'globalThis.runProfileTarget=runExistingProfileTargetRegression;'].join('\n'),context);
 await context.runProfileTarget();
});
