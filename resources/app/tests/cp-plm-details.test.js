'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const ROOT=path.join(__dirname,'..');
const read=rel=>fs.readFileSync(path.join(ROOT,rel),'utf8');
const moduleText=read('public/cp-plm-details.js');
function create(rows,entries){
  const calls=[],window={document:{documentElement:{lang:'tr'}},BLCollectionArtworkDetail:{
    summaryFor:entry=>entry.isSetStyle?entry.artworkSummary:entry.hasPrint?entry.summary:'Baskı yok'
  }};
  const context=vm.createContext({window,Date,Set,Map,Promise,Number,String,JSON,Array,fetch:async(url,opts)=>{
    const batch=JSON.parse(opts.body).plmIds;calls.push(batch);
    const selected=Object.fromEntries(batch.filter(k=>entries[k]).map(k=>[k,entries[k]]));
    return {ok:true,json:async()=>({ok:true,entries:selected})};
  }});
  vm.runInContext(moduleText,context);
  return {api:window.BLCPPlmDetails,calls};
}
test('Artwork and Fabric are real CP columns and available in Orders through shared descriptors',()=>{
  const app=read('public/app-main.js'),html=read('public/index.html');
  assert.match(app,/\{k:'Artwork Detail', label:'Artwork Detail', type:'ro'/);
  assert.match(app,/\{k:'Fabric \(PLM\)', label:'Fabric \(PLM\)', type:'ro'/);
  assert.match(app,/function ordersColumnsFromCp\(cpCols\)/);
  assert.match(app,/function renderCPNow\(\)\{\s*if\(!state.cp\) return;\s*cpPlmDetailsSync\(\)/);
  assert.match(app,/function renderOrdersNow\(\)\{\s*if\(!state.orders\)return;\s*cpPlmDetailsSync\(\)/);
  assert.match(html,/src="cp-plm-details.js/);
  assert.match(html,/src="plm-bom.js/);
});
test('Bulk projection shares one PLM ID across CP orders and returns empty on missing BOM',async()=>{
  const cp=[{'PLM ID':'00201','Order Code':'100'},{'PLM ID':'201','Order Code':'101'}];
  const orders=[{'PLM ID':'300','Order Code':'102'}];
  const entries={201:{styleId:'S201',fabric:'Orme,150 gsm,100% Cotton',summary:'Ön: 1 | Toplam: 1',hasPrint:true}};
  const {api,calls}=create(cp,entries);
  await api.sync({cpRows:cp,ordersRows:orders});
  assert.equal(calls.length,1);
  assert.deepEqual([...calls[0]].sort(),['201','300']);
  assert.equal(cp[0]['Artwork Detail'],'Ön: 1 | Toplam: 1');
  assert.equal(cp[1]['Fabric (PLM)'],'Orme,150 gsm,100% Cotton');
  assert.equal(orders[0]['Artwork Detail'],'');
});
test('Refresh after PLM SYNC replaces source values without modifying ASAS columns',async()=>{
  const row={'PLM ID':'101','Model Name':'MODEL','Karışım':'100% Pamuk'};
  const entries={101:{styleId:'S101',fabric:'Old',hasPrint:false}};
  const {api,calls}=create([row],entries);
  await api.sync({cpRows:[row]});
  assert.equal(row['Artwork Detail'],'Baskı yok');
  entries[101]={styleId:'S101',fabric:'New',hasPrint:true,summary:'Arka: 1'};
  await api.refresh();
  assert.equal(row['Fabric (PLM)'],'New');
  assert.equal(row['Artwork Detail'],'Arka: 1');
  assert.equal(row['Karışım'],'100% Pamuk');
  assert.equal(calls.length,2);
});
test('Independent PLM property choices and authorized shared BOM source',()=>{
  const app=read('public/app-main.js'),route=read('server/routes/plm-sync-routes.js');
  const store=read('server/lib/plm-bom-store.js'),sync=read('server/lib/plm-bom-sync.js');
  assert.match(app,/key:'artwork',label:en\?'Artwork Details'/);
  assert.match(app,/key:'fabric',label:en\?'Fabric Details'/);
  assert.match(app,/async function cpPlmSyncDetailsRun/);
  assert.match(app,/if\(cpDetails\)\{/);
  assert.match(route,/api\/plm-sync\/fetch', userAccess\.requireAnyArea\('koleksiyon', 'cp', 'orders'\)/);
  assert.match(route,/api\/plm-sync\/bom\/batch/);
  assert.match(store,/fabric: text\(raw && raw\.fabric, 10000\)/);
  assert.match(sync,/fabric:target\.fabric/);
});
