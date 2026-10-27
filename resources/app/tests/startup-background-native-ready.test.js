'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const app=fs.readFileSync(path.join(__dirname,'../public/app-main.js'),'utf8');
const source=app.slice(app.indexOf('function scheduleStartupScreenReady('),app.indexOf("window.addEventListener('DOMContentLoaded'",app.indexOf('function scheduleStartupScreenReady(')));
test('an unattached native startup tab completes even when animation frames never arrive',()=>{
  const tasks=[];let frames=0,ready=false;
  const context={URLSearchParams,location:{search:'?startupWarm=1'},setTimeout:fn=>tasks.push(fn),requestAnimationFrame:()=>frames++};
  vm.runInNewContext(source,context);context.scheduleStartupScreenReady(()=>{ready=true;});
  assert.equal(frames,0);assert.equal(tasks.length,1);tasks[0]();assert.equal(ready,true);
});
test('the visible primary screen still waits for two paint frames',()=>{
  const frames=[];let ready=false;
  const context={URLSearchParams,location:{search:'?module=overview'},setTimeout:()=>assert.fail('visible startup must wait for paint'),requestAnimationFrame:fn=>frames.push(fn)};
  vm.runInNewContext(source,context);context.scheduleStartupScreenReady(()=>{ready=true;});
  frames.shift()();assert.equal(ready,false);frames.shift()();assert.equal(ready,true);
});
