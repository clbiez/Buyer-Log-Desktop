'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../public/backlog-chart.js'),'utf8');
const turn=()=>new Promise(setImmediate);
test('chart supersession and disabling detach requests; late success/error cannot overwrite the current panel',async()=>{
 const requests=[],host={hidden:false,innerHTML:''},c={AbortController,DOMException,URLSearchParams,console,
 document:{readyState:'loading',addEventListener(){},documentElement:{lang:'en'},body:{dataset:{activeTab:'backlog'}},getElementById:id=>id==='backlogChartPanel'?host:null},
 BLBacklogChartContext:{language:()=> 'en',queryParams:()=>({format:'json'})},BLBacklogRows:{loadData:(_params,{signal})=>new Promise((resolve,reject)=>requests.push({signal,resolve,reject}))}};
 vm.createContext(c);vm.runInContext(source,c);const api=c.BLBacklogChart;api.saveState({enabled:true});
 const old=api.render();await turn();const current=api.render();await turn();assert.equal(requests[0].signal.aborted,true);
 requests[1].resolve({headers:[],rows:[]});await current;const currentHtml=host.innerHTML;assert.match(currentHtml,/No date field/);
 requests[0].reject(Error('obsolete error'));await old;assert.equal(host.innerHTML,currentHtml);
 const late=api.render();await turn();api.saveState({enabled:false});await api.render();assert.equal(requests[2].signal.aborted,true);assert.equal(host.hidden,true);
 const hiddenHtml=host.innerHTML;requests[2].resolve({headers:['date'],rows:[{date:'2026-11-09'}]});await late;assert.equal(host.innerHTML,hiddenHtml);assert.equal(host.hidden,true);
});
