'use strict';
const assert = require('node:assert/strict');
function deferred() { let resolve, reject; const promise = new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject}; }
const flush=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
function fixture() {
  let time=0,id=0;const timers=new Map(),gets=[],events=[],messages=[];
  let context={actor:'actor-a',source:'source-a',authority:'grant-a',valid:true};
  const clock={now:()=>time,setTimeout(fn,ms){const key=++id;timers.set(key,{at:time+ms,fn});return key;},clearTimeout(key){timers.delete(key);}};
  const api=require('../../../public/shared-revision-poller.js');
  const poller=api.create({...clock,readContext:()=>context,fetch:(url,options)=>{const d=deferred();gets.push({url,options,...d});return d.promise;},onRevisions:detail=>events.push(detail),publish:message=>messages.push(message),newGeneration:()=>`generation-${++id}`});
  async function tick(ms=0){const target=time+ms;let guard=0;for(;;){await flush();let next;for(const [key,t] of timers)if(t.at<=target&&(!next||t.at<next[1].at))next=[key,t];if(!next)break;assert.ok(++guard<1000,'timer runaway');time=next[1].at;timers.delete(next[0]);next[1].fn();}time=target;await flush();}
  async function reply(index,revision,entities={quotation:{revision}}){gets[index].resolve({ok:true,json:async()=>({schemaVersion:1,revision,entities})});await flush();}
  return {poller,gets,events,messages,timers,tick,reply,setContext:value=>{context=value;},context:()=>context};
}
module.exports={fixture,deferred,flush};
