'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {fixture,deferred,flush}=require('./fixtures/shared-revision-poller/clock.cjs');
test('cold start preserves 2500ms and serial cadence never overlaps a slow GET',async()=>{
 const f=fixture();f.poller.start();await f.tick(2499);assert.equal(f.gets.length,0);await f.tick(1);assert.equal(f.gets.length,1);
 await f.tick(7500);assert.equal(f.gets.length,1);await f.reply(0,0);await f.tick();assert.equal(f.gets.length,2,'overdue next poll runs after settlement');
 await f.reply(1,1);assert.deepEqual(f.events.map(e=>e.changed),[['quotation']]);f.poller.dispose();
});
test('stop aborts late JSON, a new lease catches up only after old work settles',async()=>{
 const f=fixture(),json=deferred();f.poller.start({catchUp:true});await f.tick();f.gets[0].resolve({ok:true,json:()=>json.promise});await flush();
 f.poller.stop();assert.equal(f.gets[0].options.signal.aborted,true);f.poller.start({catchUp:true});await f.tick();assert.equal(f.gets.length,1);
 json.resolve({schemaVersion:1,revision:90,entities:{quotation:{revision:90}}});await f.tick();assert.equal(f.messages.length,0);assert.equal(f.gets.length,2);
 await f.reply(1,1);assert.equal(f.messages.length,1);assert.equal(f.messages[0].revisions.revision,1);f.poller.dispose();
});
for(const field of ['actor','source','authority'])test(`${field} transition aborts, clears the comparison baseline and rejects stale results`,async()=>{
 const f=fixture();f.poller.start({catchUp:true});await f.tick();await f.reply(0,4);await f.tick(7000);
 f.setContext({...f.context(),[field]:'new-'+field});f.poller.contextChanged();assert.equal(f.gets[1].options.signal.aborted,true);
 await f.reply(1,99);await f.tick();assert.equal(f.messages.length,1);assert.equal(f.gets.length,3);await f.reply(2,1);assert.equal(f.events.length,0);f.poller.dispose();
});
test('context changed without notification is still checked after JSON and before publication',async()=>{
 const f=fixture();f.poller.start({catchUp:true});await f.tick();f.setContext({...f.context(),authority:'revoked',valid:false});await f.reply(0,9);await f.tick(30000);
 assert.equal(f.messages.length,0);assert.equal(f.events.length,0);assert.equal(f.gets.length,1);f.poller.dispose();
});
test('offline abort, reconnect and foreground/native activity request immediate serialized catch-up',async()=>{
 const f=fixture();f.poller.start({catchUp:true});await f.tick();f.poller.setOnline(false);assert.equal(f.gets[0].options.signal.aborted,true);
 await f.reply(0,20);await f.tick(30000);assert.equal(f.gets.length,1);f.poller.setOnline(true);await f.tick();await f.reply(1,1);
 f.poller.setActive(false);await f.tick(7000);await f.reply(2,1);f.poller.setActive(true);await f.tick();assert.equal(f.gets.length,4);await f.reply(3,2);
 assert.deepEqual(f.events.map(e=>e.revisions.revision),[2]);f.poller.dispose();
});
test('error backoff resets on recovery; idle backoff caps at the existing 7 seconds',async()=>{
 const f=fixture();f.poller.start({catchUp:true});await f.tick();f.gets[0].reject(Error('offline'));await f.tick(999);assert.equal(f.gets.length,1);
 await f.tick(1);f.gets[1].resolve({ok:false,status:503});await f.tick(1999);assert.equal(f.gets.length,2);await f.tick(1);await f.reply(2,1);
 await f.tick(7000);await f.reply(3,2);await f.tick(3500);await f.reply(4,2);await f.tick(6999);assert.equal(f.gets.length,5);await f.tick(1);assert.equal(f.gets.length,6);f.poller.dispose();
});
test('timeout aborts an outstanding request, dispose is terminal and idempotent',async()=>{
 const f=fixture();f.poller.start({catchUp:true});await f.tick();await f.tick(10000);assert.equal(f.gets[0].options.signal.aborted,true);assert.equal(f.gets.length,1);
 f.poller.dispose();f.poller.dispose();f.poller.start({catchUp:true});await f.reply(0,99);await f.tick(60000);assert.equal(f.messages.length,0);assert.equal(f.gets.length,1);assert.equal(f.timers.size,0);
});
test('only revision scalars cross the channel; replay and decreasing snapshots do not dispatch',async()=>{
 const f=fixture();f.poller.start({catchUp:true});await f.tick();await f.reply(0,1,{quotation:{revision:1,owner:'secret',profile:{credential:'secret'}}});
 assert.deepEqual(f.messages[0].revisions,{schemaVersion:1,revision:1,entities:{quotation:{revision:1}}});assert.doesNotMatch(JSON.stringify(f.messages),/actor|authority|source-a|secret|profile|owner/);
 f.poller.stop();const hint={type:'shared-revisions',generation:'other',sequence:1,revisions:{schemaVersion:1,revision:2,entities:{quotation:{revision:2}}}};
 assert.equal(f.poller.receive(hint),true);assert.equal(f.poller.receive(hint),false);assert.equal(f.events.length,1);
 assert.equal(f.poller.receive({...hint,sequence:2,revisions:{schemaVersion:1,revision:0,entities:{quotation:{revision:0}}}}),false);
 f.setContext({...f.context(),valid:false});assert.equal(f.poller.receive({...hint,sequence:3}),false);assert.equal(f.events.length,1);f.poller.dispose();
});
test('malformed metadata cannot smuggle data or prototype keys into an event',async()=>{
 const f=fixture();const envelope=entities=>({type:'shared-revisions',generation:'g',sequence:1,revisions:{schemaVersion:1,revision:1,entities}});
 for(const entities of [{quotation:{revision:-1}},{quotation:{revision:Infinity}},JSON.parse('{"__proto__":{"revision":1}}'),{quotation:{revision:1},'bad key':{revision:1}}])assert.equal(f.poller.receive(envelope(entities)),false);
 assert.equal(f.events.length,0);f.poller.dispose();
});
test('grant expiry is checked for every hint even when authority and revision have not changed',async()=>{
 const f=fixture(),base=f.context();const hint={type:'shared-revisions',generation:'g',sequence:1,revisions:{schemaVersion:1,revision:1,entities:{quotation:{revision:1}}}};
 assert.equal(f.poller.receive(hint),true);f.setContext({...base,valid:false});assert.equal(f.poller.receive({...hint,sequence:2,revisions:{...hint.revisions,revision:2,entities:{quotation:{revision:2}}}}),false);
 f.setContext({...base,valid:true});f.poller.contextChanged();assert.equal(f.poller.receive({...hint,sequence:3}),true);assert.equal(f.events.length,0,'renewal starts a fresh comparison scope');f.poller.dispose();
});
test('malformed JSON and unsupported endpoint recover without POST or a fabricated revision',async()=>{
 const f=fixture();f.poller.start({catchUp:true});await f.tick();f.gets[0].resolve({ok:true,json:async()=>{throw SyntaxError('bad JSON');}});
 await f.tick(1000);f.gets[1].resolve({ok:false,status:404});await f.tick(2000);await f.reply(2,1);assert.equal(f.messages.length,1);assert.equal(f.events.length,0);
 for(const g of f.gets){assert.equal(g.options.method,undefined);assert.match(g.url,/^\/api\/shared-revisions\?_=/);assert.equal(g.options.credentials,'same-origin');}f.poller.dispose();
});
test('reentrant authority change during dispatch prevents publication of that old result',async()=>{
 const api=require('../public/shared-revision-poller.js');let context={actor:'a',source:'s',authority:'v1',valid:true};const messages=[],jobs=[],responses=[];let id=0;
 const p=api.create({readContext:()=>context,newGeneration:()=>String(++id),now:()=>0,setTimeout:(fn,ms)=>{jobs.push({fn,ms,id:++id});return id;},clearTimeout:key=>{const x=jobs.find(j=>j.id===key);if(x)x.cancelled=true;},fetch:async()=>responses.shift(),publish:x=>messages.push(x),onRevisions:()=>{context={...context,authority:'v2'};p.contextChanged();}});
 responses.push({ok:true,json:async()=>({schemaVersion:1,revision:0,entities:{quotation:{revision:0}}})},{ok:true,json:async()=>({schemaVersion:1,revision:1,entities:{quotation:{revision:1}}})});
 p.start({catchUp:true});jobs.find(j=>j.ms===0&&!j.cancelled).fn();await flush();assert.equal(messages.length,1);p.catchUp();jobs.filter(j=>j.ms===0&&!j.cancelled).at(-1).fn();await flush();assert.equal(messages.length,1);p.dispose();
});
for(const operation of ['share','receive'])test(`a context change discovered by ${operation} re-arms leader catch-up`,async()=>{
 const f=fixture();f.poller.start({catchUp:true});await f.tick();await f.reply(0,0);
 f.setContext({...f.context(),source:'new-source-without-notification'});
 if(operation==='share')f.poller.share();else f.poller.receive({type:'shared-revisions',generation:'g',sequence:1,revisions:{schemaVersion:1,revision:0,entities:{quotation:{revision:0}}}});
 await f.tick();assert.equal(f.gets.length,2,'context observation must not leave the leader timer cleared');f.poller.dispose();
});
