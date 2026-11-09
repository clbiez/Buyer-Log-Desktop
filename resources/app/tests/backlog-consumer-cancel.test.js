'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../public/backlog-overview.js'),'utf8');
const helpers=source.slice(source.indexOf('function requestAborted()'),source.indexOf('function cancelFilterValues('));
const rows=source.slice(source.indexOf('const rowsCache=new Map()'),source.indexOf('\nfunction queryParams()'));
function setup(){
 const requests=[],calendars=[],context={window:{BLMerchCalendarRuntime:{apply:value=>calendars.push(value)}},URLSearchParams,AbortController,DOMException,
 fetch:(url,options)=>new Promise((resolve,reject)=>{requests.push({url,signal:options.signal,finish:body=>resolve({ok:true,json:async()=>body}),fail:()=>reject(Error('offline'))});})};
 vm.createContext(context);vm.runInContext(helpers+rows,context);return {api:context.window.BLBacklogRows,requests,calendars};
}
test('shared browser fetch survives one departure and aborts when the last consumer leaves',async()=>{
 const f=setup(),a=new AbortController(),b=new AbortController(),one=f.api.loadData({q:1},{signal:a.signal}),two=f.api.loadData({q:1},{signal:b.signal});
 a.abort();await assert.rejects(one,{name:'AbortError'});assert.equal(f.requests.length,1);assert.equal(f.requests[0].signal.aborted,false);
 b.abort();await assert.rejects(two,{name:'AbortError'});assert.equal(f.requests[0].signal.aborted,true);
 const retry=f.api.loadData({q:1});assert.equal(f.requests.length,2);f.requests[1].finish({rows:[2]});assert.equal((await retry).rows[0],2);
 f.requests[0].finish({rows:[1],merchCalendar:'obsolete'});await new Promise(setImmediate);assert.deepEqual(f.calendars,[]);assert.equal((await f.api.loadData({q:1})).rows[0],2);
});
test('non-opted-in browser consumer retains shared completion and normal results remain cached',async()=>{
 const f=setup(),a=new AbortController(),one=f.api.loadData({q:1},{signal:a.signal}),two=f.api.loadData({q:1});a.abort();await assert.rejects(one,{name:'AbortError'});assert.equal(f.requests[0].signal.aborted,false);
 f.requests[0].finish({rows:[2],rowsRevision:'r'});const result=await two;assert.equal(await f.api.loadData({q:1}),result);assert.equal(f.requests.length,1);assert.equal(f.requests[0].signal.aborted,false);
});
test('failed browser fetch can be retried, and pre-aborted consumers admit no HTTP request',async()=>{
 const f=setup(),a=new AbortController();a.abort();assert.throws(()=>f.api.loadData({q:1},{signal:a.signal}),{name:'AbortError'});assert.equal(f.requests.length,0);
 const one=f.api.loadData({q:1});f.requests[0].fail();await assert.rejects(one,/offline/);const two=f.api.loadData({q:1});f.requests[1].finish({rows:[3]});assert.equal((await two).rows[0],3);
});
