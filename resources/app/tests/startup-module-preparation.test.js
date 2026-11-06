'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { create } = require('../public/startup-module-preparation');
const steps = () => ['cp', 'orders', 'koleksiyon'].map(module => ({ module }));

test('module states publish only actual transitions and snapshots cannot change live state', () => {
  const changes = [], runtime = create({ onChange: value => changes.push(value) });
  assert.equal(runtime.snapshot().cp.status, 'pending');
  runtime.setStatus('cp', 'loading'); runtime.setStatus('cp', 'loading');
  runtime.setStatus('cp', 'error', 'LOAD_FAILED');
  assert.equal(runtime.snapshot().cp.error, 'LOAD_FAILED');
  runtime.setStatus('cp', 'loading'); runtime.setStatus('cp', 'ready');
  assert.equal(changes.length, 4);
  assert.equal(runtime.snapshot().cp.error, '');
  const copy = runtime.snapshot(); copy.cp.status = 'error';
  assert.equal(runtime.snapshot().cp.status, 'ready');
  assert.equal(runtime.setStatus('admin', 'ready'), false);
  assert.equal(runtime.setStatus('cp', 'unknown'), false);
});
test('default order stays CP, Orders, Collection without history or intent', () => {
  const runtime = create(), queue = steps();
  assert.deepEqual(Array.from({ length: 3 }, () => runtime.takeNext(queue).module), ['cp', 'orders', 'koleksiyon']);
  assert.equal(runtime.takeNext(queue), undefined);
});
test('recent use orders pending modules, with stable ties and bounded validated history', () => {
  const runtime = create({ now: () => 100, readHistory: () => ({ cp: 10, orders: 90, koleksiyon: 90, admin: Infinity }) });
  const queue = steps();
  assert.deepEqual(Array.from({ length: 3 }, () => runtime.takeNext(queue).module), ['orders', 'koleksiyon', 'cp']);
});
test('the latest opening intent wins, is reread before every pending step, and expires', () => {
  let now = 100;
  const runtime = create({ now: () => now, readHistory: () => ({ orders: 90 }) });
  const queue = steps(); runtime.noteIntent('koleksiyon');
  assert.equal(runtime.takeNext(queue).module, 'koleksiyon');
  runtime.noteIntent('orders'); runtime.noteIntent('cp');
  assert.equal(runtime.takeNext(queue).module, 'cp', 'later intent wins even within the same millisecond');
  now += 30001;
  const fresh = steps();
  assert.equal(runtime.takeNext(fresh).module, 'orders', 'expired intent no longer outranks last use');
});
test('opening a supported module persists a small history and failed storage cannot block navigation', () => {
  const writes = [], runtime = create({ now: () => 42, writeHistory: value => writes.push(value) });
  assert.equal(runtime.noteOpened('orders'), true);
  assert.equal(runtime.noteOpened('source'), false);
  assert.deepEqual(writes, [{ orders: 42 }]);
  assert.equal(create({ writeHistory: () => { throw Error('quota'); } }).noteOpened('cp'), true);
});
test('malformed or unavailable preference storage preserves the bounded default policy', () => {
  for (const readHistory of [() => { throw Error('storage'); }, () => null, () => [], () => ({ cp: NaN, orders: -1, koleksiyon: 'bad' })]) {
    const runtime = create({ readHistory }), queue = steps();
    assert.deepEqual(Array.from({ length: 3 }, () => runtime.takeNext(queue).module), ['cp', 'orders', 'koleksiyon']);
  }
});

function revealHarness(complete=false) {
  const app=fs.readFileSync(path.join(__dirname,'../public/app-main.js'),'utf8');
  const start=app.indexOf('function afterStartupReveal('),end=app.indexOf('const CORE_FILTER_AUTO_KEY',start);
  assert.ok(start>=0&&end>start);
  const frames=[],listeners=new Map();
  const context={startupRevealPromise:null,requestAnimationFrame:fn=>frames.push(fn),window:{BL_STARTUP_COMPLETE:complete,addEventListener:(type,fn)=>listeners.set(type,fn)}};
  vm.runInNewContext(app.slice(start,end),context);
  return {context,frames,dispatch(type){const fn=listeners.get(type);listeners.delete(type);fn?.();}};
}
test('background callbacks wait for actual dismissal and two paint frames, not just the ready event', async () => {
  const h=revealHarness(),calls=[];
  const a=h.context.afterStartupReveal(()=>calls.push('a')),b=h.context.afterStartupReveal(()=>calls.push('b'));
  h.dispatch('bl:startup-ready');assert.equal(h.frames.length,0);assert.deepEqual(calls,[]);
  h.dispatch('bl:startup-complete');assert.equal(h.frames.length,1);
  h.frames.shift()();assert.deepEqual(calls,[]);assert.equal(h.frames.length,1);
  h.frames.shift()();await Promise.all([a,b]);assert.deepEqual(calls,['a','b']);
  await h.context.afterStartupReveal(()=>calls.push('c'));assert.deepEqual(calls,['a','b','c']);
});
test('a callback registered after dismissal still waits for paint without missing a past event', async () => {
  const h=revealHarness(true);let called=false;
  const pending=h.context.afterStartupReveal(()=>{called=true;});
  assert.equal(called,false);h.frames.shift()();assert.equal(called,false);h.frames.shift()();await pending;assert.equal(called,true);
});
test('module-use history stays local and isolated between two real BLStorage user namespaces', () => {
  const source=fs.readFileSync(path.join(__dirname,'../public/user-storage.js'),'utf8'),native=new Map();
  function storage(id){
    const localStorage={getItem:key=>native.get(key)??null,setItem:(key,value)=>native.set(key,String(value)),removeItem:key=>native.delete(key),key:index=>[...native.keys()][index],get length(){return native.size;}};
    const window={localStorage,BL_USER_CONTEXT:{id},addEventListener(){}};
    vm.runInNewContext(source,{window,localStorage,fetch(){throw Error('Local history must not make a network request');}});
    return window.BLStorage;
  }
  const a=storage('buyer-a'),b=storage('buyer-b'),key='lcw.startup.moduleLastUsed.v1';
  assert.equal(a.isUserScoped(key),true);assert.equal(a.isSynced(key),false);
  a.setItem(key,JSON.stringify({cp:42}));b.setItem(key,JSON.stringify({orders:99}));
  assert.deepEqual(JSON.parse(a.getItem(key)),{cp:42});assert.deepEqual(JSON.parse(b.getItem(key)),{orders:99});
  assert.equal(native.has(key),false);
  assert.deepEqual(JSON.parse(storage('buyer-a').getItem(key)),{cp:42});
});
