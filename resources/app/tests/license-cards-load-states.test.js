'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../public/license-cards.js'),'utf8');
function page(){
 let response={ok:false,status:503,code:'LICENSE_SOURCE_UNAVAILABLE'},hold=null,calls=0,methods=[];
 const host={dataset:{},getClientRects:()=>[{}],querySelector:()=>null,querySelectorAll:()=>[],addEventListener(){},contains:()=>false,set innerHTML(value){this.html=value;}};
 const window={BLLicenseCardsEngine:require('../public/license-cards-engine'),BLUI:require('../public/ui-primitives')};
 const context={window,document:{getElementById:()=>host,activeElement:null,addEventListener(){}},CSS:{escape:v=>v},appLang:'en',Intl,setTimeout,showToast(){},fetch:async(_url,options={})=>{calls++;methods.push(options.method||'GET');if(hold){const wait=hold;hold=null;await wait;}return {ok:response.ok,status:response.status,json:async()=>response.ok?response.data:{code:response.code}};}};
 vm.runInNewContext(source.replace('window.initLicenseCardsPage=','window.loadStateTests={S,load,act};window.initLicenseCardsPage='),context);
 return {window,host,methods,get calls(){return calls;},get state(){return window.loadStateTests.S;},respond(value){response=value;},hold(p){hold=p;},open:()=>window.initLicenseCardsPage(),refresh:()=>window.loadStateTests.load(true),retry:()=>window.loadStateTests.act({dataset:{lcAct:'retry'}}),lang(value){context.appLang=value;window.BLLicenseCardsPage.renderLanguage();}};
}
const empty={revision:1,cards:[],canEdit:true};
test('initial load failure replaces skeleton with shared error/retry and translates without fetching',async()=>{
 const p=page();await p.open();assert.doesNotMatch(p.host.html,/lcSkeleton/);assert.match(p.host.html,/uiState--error/);assert.match(p.host.html,/Load CP or Orders/);assert.match(p.host.html,/Retry/);const calls=p.calls;p.lang('tr');assert.match(p.host.html,/Önce CP veya Orders/);assert.equal(p.calls,calls);
});
test('only pending first load shows skeleton; retry success shows successful empty state',async()=>{
 const p=page();let release;p.hold(new Promise(resolve=>{release=resolve;}));const pending=p.open();assert.match(p.host.html,/lcSkeleton/);assert.match(p.host.html,/aria-busy="true"/);release();await pending;assert.doesNotMatch(p.host.html,/lcSkeleton/);p.respond({ok:true,data:empty});await p.open();assert.match(p.host.html,/No license cards yet/);assert.doesNotMatch(p.host.html,/uiState--error|lcSkeleton/);
});
test('failed background fetch keeps loaded content and exposes retry/freshness notice',async()=>{
 const p=page();p.respond({ok:true,data:empty});await p.open();p.respond({ok:false,status:503,code:'LICENSE_SOURCE_UNAVAILABLE'});await p.window.BLLicenseCardsPage.invalidate();assert.match(p.host.html,/No license cards yet/);assert.match(p.host.html,/previously loaded/);assert.match(p.host.html,/data-lc-act="retry"/);assert.doesNotMatch(p.host.html,/lcSkeleton/);p.lang('tr');assert.match(p.host.html,/Önceki yüklenen/);
});
test('failed explicit refresh keeps data, marks it stale and clears notice after retry',async()=>{
 const p=page();p.respond({ok:true,data:empty});await p.open();const before=p.state.data;p.respond({ok:false,status:503,code:'LICENSE_SOURCE_UNAVAILABLE'});await p.refresh();assert.equal(p.state.data,before);assert.equal(p.state.stale,true);assert.match(p.host.html,/previously loaded/);p.respond({ok:true,data:{...empty,revision:2}});await p.retry();assert.equal(p.state.stale,false);assert.doesNotMatch(p.host.html,/previously loaded|lcSkeleton/);assert.deepEqual(p.methods,['GET','POST','POST'],'retry repeats the failed source refresh rather than hiding failure with cached GET data');
});
