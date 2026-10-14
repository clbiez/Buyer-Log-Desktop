'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const APP=fs.readFileSync(path.join(__dirname,'../public/app-main.js'),'utf8');
const start=APP.indexOf('async function waitForStartupPrimaryScreen(){');
const end=APP.indexOf("window.addEventListener('DOMContentLoaded', async () => {",start);
const block=APP.slice(start,end).trim();
test('a pending Overview projection cannot prevent UI_READY or personal settings hydration', async()=>{
  assert.ok(start>0&&end>start,'startup function exists');
  assert.doesNotMatch(block,/return ensureOverviewLoaded\(|return ensureCpLoaded\(|return ensureOrdersLoaded\(/);
  const context={
    state:{overviewDeferred:true,cp:null,orders:null},
    window:{BLPerf:{mark(){}}},
    currentActiveTab:()=> 'overview'
  };
  const fn=vm.runInNewContext(block+';waitForStartupPrimaryScreen',context);
  assert.equal(await fn(),true);
  const boot=APP.slice(end,APP.indexOf('async function refreshFolderLabel()',end));
  const ready=boot.indexOf("mark?.('UI_READY')");
  const hydrate=boot.indexOf('void hydrateUserPreferencesAfterUi();');
  const firstProjection=boot.indexOf("if(currentActiveTab()==='overview')void ensureOverviewCpDependency()");
  assert.ok(ready>=0&&hydrate>ready&&firstProjection>hydrate,'user settings starts after UI_READY but before source projections');
  assert.match(boot,/await waitForStartupPrimaryScreen\(\)/);
  assert.match(boot,/if\(state\.overviewDeferred&&currentActiveTab\(\)==='overview'\)void ensureOverviewLoaded\(\)/);
});
test('CP and Orders deep links do not hold the shell while their projections are pending', async()=>{
  const context={state:{overviewDeferred:false,cp:null,orders:null},window:{BLPerf:{mark(){}}},currentActiveTab:()=> 'cp'};
  const fn=vm.runInNewContext(block+';waitForStartupPrimaryScreen',context);
  assert.equal(await fn(),true);
  context.currentActiveTab=()=> 'orders';
  assert.equal(await fn(),true);
  assert.match(APP,/if\(tab==='cp'&&!state\.cp\)\{/);
  assert.match(APP,/if\(tab==='orders'&&!state\.orders\)\{/);
});
