'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../public/overview-global-flow.js'),'utf8');
test('covered Overview does not load Global Flow before the startup curtain is dismissed',()=>{
  let guard={dataset:{}};
  const context={state:{workspaceActive:true,collapsed:false,inView:true},document:{hidden:false,getElementById:()=>guard}};
  vm.runInNewContext(source.slice(source.indexOf('function isLive()'),source.indexOf('async function refresh(',source.indexOf('function isLive()'))),context);
  assert.equal(context.isLive(),false);guard.dataset.leaving='1';assert.equal(context.isLive(),true);
  guard=null;assert.equal(context.isLive(),true);context.state.workspaceActive=false;assert.equal(context.isLive(),false);
  assert.match(source,/addEventListener\('bl:startup-complete',[\s\S]*?state\.dirty[\s\S]*?refresh\(false\)/);
});
