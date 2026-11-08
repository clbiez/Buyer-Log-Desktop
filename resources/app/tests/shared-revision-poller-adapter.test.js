'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {browser}=require('./fixtures/shared-revision-poller/adapter.cjs');
const {flush}=require('./fixtures/shared-revision-poller/clock.cjs');
const {verify}=require('../../../scripts/prototypes/shell06-revision-poller-20261108/recipe.cjs');
test('exact recipe has two anchored edits and keeps actual revision consumer',()=>{assert.equal(verify().edits.length,2);});
test('actual poll/SSE blocks: one leader polls and every consumer gets equal revision-only events',async()=>{
 const b=browser();const a=b.tab('a'),c=b.tab('c'),d=b.tab('d');await b.tick(2500);
 assert.equal(b.sources.length,1);assert.equal(b.gets.length,1);await b.reply(0,0);b.sources[0].open();await b.tick(7000);assert.equal(b.gets.length,2);await b.reply(1,1);await flush();
 for(const t of [a,c,d]){assert.deepEqual(t.events.map(e=>e.changed),[['quotation','pricingRules']]);assert.deepEqual(t.outputs,['quotation','licenseCards']);t.stop();}
});
test('actual coordinator releases existing lock, aborts old GET and catches up on successor',async()=>{
 const b=browser();const a=b.tab('a'),c=b.tab('c');await b.tick(2500);b.sources[0].open();await flush();a.stop();
 assert.equal(b.gets[0].options.signal.aborted,true);await b.tick();assert.equal(b.sources.length,2);assert.equal(b.sources[0].closed,true);assert.equal(b.gets.length,2);
 await b.reply(0,99);await b.reply(1,1);await flush();assert.equal(c.events.length,0,'late old leader did not publish');c.stop();
});
test('actual SSE error/open gap catches up; teardown cancels SSE retry',async()=>{
 const b=browser();const a=b.tab('a');await b.tick(2500);await b.reply(0,0);b.sources[0].open();b.sources[0].error();await b.tick(1000);assert.equal(b.sources.length,2);
 b.sources[1].open();await b.tick();assert.equal(b.gets.length,2);await b.reply(1,1);assert.ok(a.outputs.includes('quotation'));
 b.sources[1].error();a.stop();await b.tick(60000);assert.equal(b.sources.length,2);
});
for(const config of [{channel:false},{locks:false},{channel:false,locks:false}])test('missing browser APIs retain explicit per-page fallback '+JSON.stringify(config),async()=>{
 const b=browser(config);const a=b.tab('a'),c=b.tab('c');await b.tick(2500);assert.equal(b.sources.length,2);assert.equal(b.gets.length,2);await b.tick(7000);assert.equal(b.gets.length,2,'fallback is still serial within each page');a.stop();c.stop();
});
test('actual context subscription and pagehide/BFCache lifecycle reject late JSON',async()=>{
 const b=browser();const a=b.tab('a');await b.tick(2500);a.change({...a.port.value,actor:'new-actor'});assert.equal(b.gets[0].options.signal.aborted,true);await b.reply(0,99);await b.tick();assert.equal(b.gets.length,2);
 const event=new Event('pagehide');Object.defineProperty(event,'persisted',{value:true});a.window.dispatchEvent(event);assert.equal(b.gets[1].options.signal.aborted,true);await b.reply(1,98);
 const show=new Event('pageshow');Object.defineProperty(show,'persisted',{value:true});a.window.dispatchEvent(show);await b.tick();assert.equal(b.gets.length,3);await b.reply(2,1);assert.equal(a.events.length,0);a.stop();
});
test('a follower context change requests a fresh baseline from the existing SSE leader',async()=>{
 const b=browser();const a=b.tab('a'),c=b.tab('c');await b.tick();await b.reply(0,0);
 a.change({...a.port.value,authority:'new-grant'});await b.tick();await b.reply(1,0);
 // Follower changes after the leader response, so its old baseline is cleared.
 c.change({...c.port.value,authority:'new-grant'});await b.tick();await b.tick(7000);await b.reply(2,1);await flush();
 assert.deepEqual(c.events.map(e=>e.revisions.revision),[1]);a.stop();c.stop();
});
test('late old SSE callbacks after stop cannot announce or update consumers',async()=>{
 const b=browser();const a=b.tab('a'),c=b.tab('c');await b.tick();await b.reply(0,0);const old=b.sources[0];a.stop();await b.tick();
 old.open();old.message({area:'orders',mode:'patch',rowPatches:[{id:'late'}]});old.error();await b.tick(1000);
 assert.equal(a.outputs.includes('patch'),false);assert.equal(c.outputs.includes('patch'),false);assert.equal(b.sources.length,2);c.stop();
});
test('missing helper asset explicitly preserves the legacy per-page timer',async()=>{
 const b=browser({helperAsset:false});const a=b.tab('a'),c=b.tab('c');await b.tick(2500);assert.equal(b.sources.length,1);assert.equal(b.gets.length,2);
 assert.equal(b.gets[0].options.signal,undefined);await b.tick(7000);assert.equal(b.gets.length,4,'no serialized guarantee is claimed for a missing helper asset');a.stop();c.stop();
});
test('per-page API fallback also works without crypto.randomUUID',async()=>{
 const b=browser({locks:false,uuid:false});const a=b.tab('a'),c=b.tab('c');await b.tick();assert.equal(b.sources.length,2);assert.equal(b.gets.length,2);await b.reply(0,0);await b.reply(1,0);a.stop();c.stop();
});
