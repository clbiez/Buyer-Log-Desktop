'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const app=fs.readFileSync(path.join(__dirname,'../public/app-main.js'),'utf8');
const bridge=fs.readFileSync(path.join(__dirname,'../public/checklist-supplier-sync.js'),'utf8');
function fn(source,name){const start=source.indexOf('function '+name+'(');assert.ok(start>=0,name);const end=source.indexOf('\n}',start);return source.slice(start,end+2);}
function fixture({legacy=false}={}){
 const row={},rows=[row],decision={byRow:new WeakMap()},calls=[],state={renderWrapped:false};let active='overview';
 const c={Set,root:null,state,currentRows:()=>rows,currentActiveTab:()=>active,refreshAssistantView:()=>calls.push('async'),
  refreshColumns:options=>{assert.equal(options.render,false);assert.equal(options.decision,decision);row.checklist='pending';calls.push('prepare');},
  renderCPNow:function(){calls.push(['render',row.checklist,this?.marker,arguments[0]]);},
  BLCpAssistant:{peekDecisionsForRows:()=>decision},DEFERRED_TAB_RENDERERS:{cp:'renderCPNow'},_deferredTabRenders:new Set()};
 c.root=c;c.window=c;vm.createContext(c);
 vm.runInContext(['runDeferredRender','deferRenderForTab','flushDeferredRenderForTab','renderCP'].map(name=>fn(app,name)).join('\n'),c);
 if(legacy){delete c.renderCPNow;c.renderCP=()=>calls.push(['legacy',row.checklist]);}
 // App handlers and debouncers can capture this function before the lazy bridge loads.
 const captured=c.renderCP;
 const wrap=bridge.slice(bridge.indexOf('  function wrapRender()'),bridge.indexOf('\n  function onDecisionChanged('));
 vm.runInContext(wrap,c);c.wrapRender();
 return {c,row,calls,captured,activate:()=>{active='cp';}};
}
test('a captured native CP renderer applies checklist fields on its first visible render',()=>{
 const f=fixture();f.activate();f.captured();
 assert.equal(f.calls.find(Array.isArray)?.[1],'pending','deferred native rendering must prepare the actual row before reading its checklist');
 assert.equal(f.calls.filter(call=>call==='prepare').length,1);
});
test('hidden CP stays deferred and receives checklist fields when flushed',()=>{
 const f=fixture();f.captured();assert.deepEqual(f.calls,[],'hidden tabs must not compute or render checklist rows');
 assert.equal(f.c._deferredTabRenders.has('cp'),true);f.activate();f.c.flushDeferredRenderForTab('cp');
 assert.equal(f.calls.find(Array.isArray)?.[1],'pending');
});
test('the actual renderer wrapper preserves receiver/arguments and installs once',()=>{
 const f=fixture(),wrapped=f.c.renderCPNow;f.c.wrapRender();assert.equal(f.c.renderCPNow,wrapped);
 f.c.renderCPNow.call({marker:'native-context'},'payload');
 assert.deepEqual(f.calls.find(Array.isArray),['render','pending','native-context','payload']);
});
test('older hosts without a deferred native renderer retain the direct render hook',()=>{
 const f=fixture({legacy:true});f.c.renderCP();
 assert.deepEqual(f.calls.find(Array.isArray),['legacy','pending']);
});
