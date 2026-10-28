'use strict';
// Measured root cause (30k demo orders): a cold Backlog read re-parsed Excel with a
// new loadedAt, so every later launch's snapshot runtime mismatched the page cache
// and CP/Orders/Overview were rebuilt and re-serialised on the server (multi-second
// event-loop stalls). Readers of confirmed CP data now reuse the page cache.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');
const SERVER=read('server/server.js'),APP=read('public/app-main.js'),LAYOUT=read('public/layout-control.js'),INBOX=read('public/exception-inbox-view.js');

test('Backlog endpoints hydrate the model snapshot before falling back to an Excel read', () => {
  assert.doesNotMatch(SERVER,/if\(!runtime\.asasOrders\) await loadFromDisk\(id,false\);/);
  assert.equal((SERVER.match(/if\(!runtime\.asasOrders\) await ensureBacklogRuntime\(id\);/g)||[]).length,2);
  const helper=SERVER.slice(SERVER.indexOf('async function ensureBacklogRuntime(id){'),SERVER.indexOf('// KUR.xlsx seçili kaynak klasöründen'));
  assert.match(helper,/const runtime=await ensureDataLoaded\(id\);\s*if\(runtime&&runtime\.loadedAt&&Array\.isArray\(runtime\.asasOrders\)\)return runtime;\s*return loadFromDisk\(id,false\);/);
});

test('ensureBacklogRuntime keeps the legacy Excel read only when no snapshot exists', async () => {
  const helper=SERVER.slice(SERVER.indexOf('async function ensureBacklogRuntime(id){'),SERVER.indexOf('// KUR.xlsx seçili kaynak klasöründen'));
  for(const [snapshot,expected] of [[{loadedAt:'2026-10-28T10:00:00.000Z',asasOrders:[]},'snapshot'],[{loadedAt:null,asasOrders:[]},'excel']]){
    const calls=[];const context={ensureDataLoaded:async()=>{calls.push('snapshot');return snapshot;},loadFromDisk:async()=>{calls.push('excel');return {};}};
    vm.createContext(context);vm.runInContext(helper,context);await context.ensureBacklogRuntime('moderator');
    assert.equal(calls.at(-1),expected);
  }
});

test('exception inbox and layout control read confirmed CP from the page cache first', () => {
  const bridge=APP.slice(APP.indexOf('window.BLExceptionInboxBridge={'),APP.indexOf('function renderOverviewNow(){'));
  assert.match(bridge,/let response=await fetch\('\/api\/page-projection\/cp',\{cache:'no-store',signal\}\);\s*if\(response\.status===404\)response=await fetch\('\/api\/data\/cp',\{cache:'no-store',signal\}\);/);
  assert.match(LAYOUT,/let response=await fetch\('\/api\/page-projection\/cp',\{credentials:'same-origin',cache:'no-store'\}\);\s*if\(response\.status===404\)response=await fetch\('\/api\/data\/cp'/);
});

test('an Orders-only data change does not re-read the CP exception inbox; bursts coalesce', () => {
  assert.match(INBOX,/timer=setTimeout\(\(\)=>\{timer=0;void refresh\(\);\},invalidate\?1200:180\);/);
  assert.match(INBOX,/if\(name==='bl:global-flow-data-changed'&&\(event\.detail\?\.reason==='priority-ready'\|\|\(Array\.isArray\(tables\)&&!tables\.includes\('cp'\)\)\)\)return;/);
});
