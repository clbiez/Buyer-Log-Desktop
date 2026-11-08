'use strict';
const fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../../../public/backlog-overview.js'),'utf8');
const start=source.indexOf('const rowsQueryKey='),end=source.indexOf('\nfunction loadData(',start);
if(start<0||end<start)throw Error('Missing current rowsQueryKey anchors');
const keyForQuery=vm.runInNewContext(source.slice(start,end)+'\nrowsQueryKey;');
const identity=(patch={})=>({scope:'demo-scope',user:'demo-user',session:'demo-session',generation:1,revision:'demo-r1',...patch});
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const flush=()=>new Promise(setImmediate);
function harness(options={}){
  let {createRequestLifecycle}=require('../../../public/backlog-request-lifecycle.js'),parseCalls=0;
  if(options.observeParse){
    const sandbox={module:{exports:{}},AbortController,Error,TypeError,JSON:{stringify:JSON.stringify,parse(text){parseCalls++;return JSON.parse(text);}}};
    vm.runInNewContext(fs.readFileSync(require.resolve('../../../public/backlog-request-lifecycle.js'),'utf8'),sandbox);
    createRequestLifecycle=sandbox.module.exports.createRequestLifecycle;
  }
  const requests=[],published=[];
  const lifecycle=createRequestLifecycle({keyForQuery,isCurrent:()=>true,...options,
    request(params,{signal,identity}){
      const headers=deferred(),body=deferred();
      // Controlled bodies may be delivered after cancellation to test hostile timing.
      headers.promise.catch(()=>{});body.promise.catch(()=>{});
      const record={params,identity,signal,textReads:0,body,
        respond(value,{ok=true,status=200}={}){headers.resolve({ok,status,text(){record.textReads++;return body.promise;}});if(value!==undefined)body.resolve(JSON.stringify(value));},
        fail:headers.reject};
      record.resolve=record.respond;
      signal.addEventListener('abort',()=>{
        if(!options.ignoreAbort){const error=new Error('Synthetic abort');error.name='AbortError';headers.reject(error);body.reject(error);}
      },{once:true});
      requests.push(record);return headers.promise;
    },
    publish(body,context){published.push({body,context});options.publish?.(body,context);}
  });
  return {lifecycle,requests,published,get parseCalls(){return parseCalls;},subscribe:(params={q:'demo'},context=identity())=>lifecycle.subscribe(params,context)};
}
module.exports={keyForQuery,identity,deferred,flush,harness};
