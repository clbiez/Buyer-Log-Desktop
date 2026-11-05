'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../public/license-cards.js'),'utf8');
const storageSource=fs.readFileSync(path.join(__dirname,'../public/user-storage.js'),'utf8');
const prefsRoot=fs.mkdtempSync(path.join(require('node:os').tmpdir(),'license-favorites-'));
process.env.BUYER_LOG_SERVER_DATA_ROOT=prefsRoot;
test.after(()=>fs.rmSync(prefsRoot,{recursive:true,force:true}));
const KEY='buyerlog.favorites.licenseCards.v1';
const initial={canEdit:false,cards:[{id:'alpha',license:'Alpha',licensor:'Agency',rules:[]},{id:'beta',license:'Beta',licensor:'Agency',rules:[]},{id:'gamma',license:'Gamma',licensor:'Agency',rules:[]}]};
function page(uid='buyer-a',native=new Map(),remote=new Map()){
 const listeners={},writes=[],host={dataset:{},getClientRects:()=>[{}],querySelector:()=>null,querySelectorAll:()=>[],addEventListener(){},contains:()=>false,set innerHTML(value){this.html=value;}};
 const localStorage={getItem:k=>native.get(k)??null,setItem:(k,v)=>native.set(k,String(v)),removeItem:k=>native.delete(k),key:i=>[...native.keys()][i],get length(){return native.size;}};
 const window={localStorage,BL_USER_CONTEXT:{id:uid},BLLicenseCardsEngine:require('../public/license-cards-engine'),addEventListener:(name,cb)=>{listeners[name]=cb;}};
 const context={window,localStorage,document:{getElementById:()=>host,activeElement:null,addEventListener(){}},CSS:{escape:v=>v},appLang:'en',Intl,setTimeout,showToast(){},fetch:async(url,options={})=>{
  if(url==='/api/user-preferences'){
   if(options.method==='PUT'){const entries=JSON.parse(options.body).entries;remote.set(uid,{...remote.get(uid),...entries});writes.push(entries);}
   return {ok:true,json:async()=>({entries:remote.get(uid)||{}})};
  }
  assert.equal(options.method||'GET','GET','favorites must not write shared cards');
  return {ok:true,json:async()=>JSON.parse(JSON.stringify(initial))};
 }};
 vm.runInNewContext(storageSource,context);
 vm.runInNewContext(source.replace('window.initLicenseCardsPage=','window.favoriteTests={S,act};window.initLicenseCardsPage='),context);
 return {window,host,writes,listeners,state:window.favoriteTests.S,open:()=>window.initLicenseCardsPage(),act:(lcAct,id)=>window.favoriteTests.act({dataset:{lcAct,id}}),hydrateAfter(promise){context.hydrateUserPreferencesAfterUi=()=>promise;},lang(value){context.appLang=value;window.BLLicenseCardsPage.renderLanguage();}};
}
test('read-only users keep favorites across reloads and accounts remain isolated on the same device',async()=>{
 const native=new Map(),remote=new Map(),a=page('buyer-a',native,remote);await a.open();
 a.act('favorite','alpha');assert.match(a.host.html,/data-lc-act="favorite"[^>]+aria-pressed="true"/);
 await a.window.BLStorage.flushPending();assert.equal(a.writes.length,1);assert.deepEqual(JSON.parse(a.writes[0][KEY].value),['alpha']);
 assert.equal(require('../server/lib/user-preferences').isSyncedKey(KEY),true);
 const reload=page('buyer-a',native,remote);await reload.open();reload.act('selectFavorites');assert.deepEqual([...reload.state.selected],['alpha']);
 const b=page('buyer-b',native,remote);await b.open();b.act('selectFavorites');assert.equal(b.state.selected.size,0);
 b.act('favorite','beta');await b.window.BLStorage.flushPending();assert.deepEqual(JSON.parse(remote.get('buyer-a')[KEY].value),['alpha']);
});
test('account favorites hydrate into an empty cache and add to the atlas selection across filters, ignoring removed cards',async()=>{
 const remote=new Map([['buyer-a',{[KEY]:{value:JSON.stringify(['alpha','beta','removed']),updatedAt:'2026-11-05T12:00:00Z'}}]]),p=page('buyer-a',new Map(),remote);
 await p.window.BLStorage.hydrate();await p.open();assert.equal(p.state.selected.size,0,'stars do not change an existing selection automatically');
 p.state.query='Gamma';p.state.licensor='Other';p.state.status='noMap';p.state.selected.add('gamma');p.act('selectFavorites');
 assert.deepEqual([...p.state.selected].sort(),['alpha','beta','gamma']);
 p.act('clearSelection');assert.equal(p.state.selected.size,0);p.state.query='';p.state.licensor=null;p.state.status='all';
 p.act('favorite','alpha');p.act('selectFavorites');assert.deepEqual([...p.state.selected],['beta']);
});
test('favorites filter, labels and empty state follow the active language; malformed preferences are safe',async()=>{
 const p=page();p.window.BLStorage.setItem(KEY,'{}');await p.open();p.act('favoritesOnly');assert.match(p.host.html,/No matching licenses/);
 p.act('favoritesOnly');p.act('favorite','alpha');p.act('favoritesOnly');assert.match(p.host.html,/>Alpha</);assert.doesNotMatch(p.host.html,/>Beta</);
 assert.match(p.host.html,/Select favorites/);p.lang('tr');assert.match(p.host.html,/Favorileri seç/);assert.match(p.host.html,/Favorilerim/);assert.match(p.host.html,/Favorilerimden çıkar/);
 await p.window.BLStorage.flushPending();
});
test('merged rows retain favorites of their members and select the current visible card once',async()=>{
 const p=page();await p.open();p.state.data.cards=[initial.cards[0],{...initial.cards[1],license:'Alpha',licensor:'Agency alias'}];
 p.window.BLBusinessRules={licensorMergeKey:()=> 'agency',licensorGroupKey:()=> 'agency'};
 p.window.BLStorage.setItem(KEY,JSON.stringify(['beta']));p.act('selectFavorites');assert.equal(p.state.selected.size,1);
 const id=[...p.state.selected][0];p.act('favorite',id);assert.deepEqual(JSON.parse(p.window.BLStorage.getItem(KEY)),[]);
 await p.window.BLStorage.flushPending();
});
test('late startup hydration and another tab update the stars without changing the atlas selection',async()=>{
 const p=page();let finish;p.hydrateAfter(new Promise(resolve=>{finish=resolve;}));await p.open();
 p.window.BLStorage.setItem(KEY,JSON.stringify(['alpha']));finish();await new Promise(resolve=>setImmediate(resolve));
 assert.match(p.host.html,/data-id="alpha" aria-pressed="true"/);assert.equal(p.state.selected.size,0);
 p.window.BLStorage.setItem(KEY,JSON.stringify(['beta']));p.listeners.storage({key:p.window.BLStorage.actualKey(KEY)});
 assert.match(p.host.html,/data-id="beta" aria-pressed="true"/);assert.match(p.host.html,/data-id="alpha" aria-pressed="false"/);
 await p.window.BLStorage.flushPending();
});
test('a failed personal write keeps the previous favorites and never changes shared records',async()=>{
 const p=page();await p.open();p.window.BLStorage.setItem=()=>{throw new Error('Quota exceeded');};
 p.act('favorite','alpha');p.act('selectFavorites');assert.equal(p.state.selected.size,0);assert.equal(p.writes.length,0);
});
test('a click before startup hydration keeps the favorites that are still arriving from the account',async()=>{
 const p=page();let finish;p.hydrateAfter(new Promise(resolve=>{finish=resolve;}));await p.open();
 const adding=p.act('favorite','beta');assert.equal(p.window.BLStorage.getItem(KEY),null);
 p.window.BLStorage.native.setItem(p.window.BLStorage.actualKey(KEY),JSON.stringify(['alpha']));finish();await adding;
 assert.deepEqual(JSON.parse(p.window.BLStorage.getItem(KEY)),['alpha','beta']);
 await p.act('selectFavorites');assert.deepEqual([...p.state.selected],['alpha','beta']);await p.window.BLStorage.flushPending();
});
