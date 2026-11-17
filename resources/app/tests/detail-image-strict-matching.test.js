'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {createModelImageCache}=require('../public/model-image-cache');
const canonical=require('../public/canonical-fields');
const app=fs.readFileSync(require.resolve('../public/app-main.js'),'utf8');
function setup(){
 const cache=createModelImageCache(globalThis);
 cache.setRegistryMap({'plm:101|colour:CVL':'summer','plm:202|colour:CVL':'winter','plm:101':'old-model-only'});
 const records=[{plmId:'101',colourCode:'CVL',specialCode:'S7A',season:'S7',modelName:'SAME'}, {plmId:'202',colourCode:'CVL',specialCode:'W7A',season:'W7',modelName:'SAME'}];
 return {cache,records,index:cache.buildDetailIndex(records)};
}
test('PLM + colour wins; special + colour and season + name + colour distinguish reused names',()=>{
 const {cache,index}=setup(),url=id=>cache.resolveDetailSource(index,id);
 assert.equal(url({plmId:'202',specialCode:'S7A',colourCode:'CVL'}),'/api/collection-images/winter');
 assert.equal(url({specialCode:'W7A',colourCode:'CVL'}),'/api/collection-images/winter');
 assert.equal(url({season:'W7',modelName:'TKM,SAME',colourCode:'CVL'}),'/api/collection-images/winter');
 assert.equal(url({season:'S7',modelName:'SAME',colourCode:'CVL'}),'/api/collection-images/summer');
});
test('old name-only, PLM-only, row refs and missing colour cannot return images',()=>{
 const {cache,index}=setup();
 for(const id of [{modelName:'SAME',colourCode:'CVL'},{plmId:'101'}, {plmId:'101',colourCode:'HRC'}, {season:'W8',modelName:'SAME',colourCode:'CVL',_imageRef:'summer',_imageUrl:'/old'}])assert.equal(cache.resolveDetailSource(index,id),'');
});
test('ambiguous special code stops resolution even if season fallback is unique',()=>{
 const {cache,records}=setup();records.push({plmId:'303',colourCode:'CVL',specialCode:'W7A',season:'W8',modelName:'SAME'});
 assert.equal(cache.resolveDetailSource(cache.buildDetailIndex(records),{specialCode:'W7A',season:'W7',modelName:'SAME',colourCode:'CVL'}),'');
});
test('duplicate records are safe; ambiguous season/name refuses to guess',()=>{
 const {cache,records}=setup();records.push({...records[1]});
 assert.equal(cache.resolveDetailIdentity(cache.buildDetailIndex(records),{season:'W7',modelName:'SAME',colourCode:'CVL'}).plmId,'202');
 records.push({...records[1],plmId:'303'});
 assert.equal(cache.resolveDetailIdentity(cache.buildDetailIndex(records),{season:'W7',modelName:'SAME',colourCode:'CVL'}),null);
});
test('collection originals require a complete matching key; ambiguous registry entries block fallback',()=>{
 const {cache}=setup();const index=cache.buildDetailIndex([{plmId:'404',colourCode:'CVL',originalImage:'/api/collection-images/manual'},{modelName:'SAME',colourCode:'CVL',originalImage:'/old'}]);
 assert.equal(cache.resolveDetailSource(index,{plmId:'404',colourCode:'CVL'}),'/api/collection-images/manual');
 assert.equal(cache.resolveDetailSource(index,{season:'W8',modelName:'SAME',colourCode:'CVL'}),'');
 cache.setRegistryMap({'plm:404|colour:CVL|name:A':'a','plm:404|colour:CVL|name:B':'b'});
 assert.equal(cache.resolveDetailSource(index,{plmId:'404',colourCode:'CVL'}),'');
});
test('real app index reads canonical OAB/Collection and ignores persisted CP _imageUrl',()=>{
 const {cache}=setup();const context={window:{BLCanonicalFields:canonical,BLModelImageCache:cache},state:{overrides:{},cp:{rows:[{'Model Name':'SAME',Season:'W7','PLM ID':'202','C.Code':'CVL','Special Code':'W7A',_imageUrl:'/wrong'}]},orders:{rows:[]},asasOrders:[]},kolRows:[]};
 vm.createContext(context);
 vm.runInContext(app.slice(app.indexOf('function detailRowImageIdentity'),app.indexOf('// Detay tablosunun başlıkları')),context);
 const row={'Option Adı':'TKM,SAME',Sezon:'W7','Özel Kod':'W7A','Renk Kodu':'CVL'};
 const id=context.detailRowImageIdentity(row);
 assert.equal(id.specialCode,'W7A');assert.equal(id.season,'W7');assert.equal(id.modelName,'TKM,SAME');
 assert.equal(context.detailImageUrlFrom(context.buildDetailImageIndex(),id),'/api/collection-images/winter');
 cache.setRegistryMap({});
 assert.equal(context.detailImageUrlFrom(context.buildDetailImageIndex(),id),'');
});

test('original Collection images can match special/colour or season/name/colour without PLM',()=>{
 const {cache}=setup(),index=cache.buildDetailIndex([
  {specialCode:'W9A',colourCode:'CVL',originalImage:'/api/collection-images/special'},
  {season:'W9',modelName:'NEW',colourCode:'CVL',originalImage:'/api/collection-images/season'}
 ]);
 assert.equal(cache.resolveDetailSource(index,{specialCode:'W9A',colourCode:'CVL'}),'/api/collection-images/special');
 assert.equal(cache.resolveDetailSource(index,{season:'W9',modelName:'NEW',colourCode:'CVL'}),'/api/collection-images/season');
 assert.equal(cache.resolveDetailSource(index,{modelName:'NEW',colourCode:'CVL'}),'');
});
test('PLM SYNC detail scope excludes unresolved names, including an empty registered scope',()=>{
 const {cache}=setup(),context={window:{BLCanonicalFields:canonical,BLModelImageCache:cache},state:{cp:{rows:[{'PLM ID':'202','C.Code':'CVL','Model Name':'SAME',Season:'W7','Special Code':'W7A'}]},orders:{rows:[]},asasOrders:[]},kolRows:[],norm:v=>String(v||'').trim(),turknorm:v=>String(v||'').toUpperCase()};
 vm.createContext(context);
 vm.runInContext(app.slice(app.indexOf('function detailRowImageIdentity'),app.indexOf('// Detay tablosunun başlıkları')),context);
 vm.runInContext(app.slice(app.indexOf('function registerModelAssetScopeHost'),app.indexOf('/* Ana tabloların kapsam sağlayıcıları')),context);
 vm.runInContext(app.slice(app.indexOf('function modelAssetIdentitiesFromHost'),app.indexOf('function registerCurrentViewModelAssetProvider')),context);
 const host={dataset:{}};
 let list=context.registerModelAssetScopeHost(host,{identities:[{styleName:'SAME',colourCode:'CVL'},{styleName:'SAME',season:'W7',colourCode:'CVL'}]});
 assert.equal(list.length,1);assert.equal(list[0].plmId,'202');
 context.registerModelAssetScopeHost(host,{identities:[{styleName:'SAME',colourCode:'CVL'}]});
 assert.equal(context.modelAssetIdentitiesFromHost(host).length,0);
});

test('silent completion cannot infer an old PLM from a detail thumbnail name',()=>{
 const context={window:{},norm:v=>String(v||'').trim(),normalizePlmLinkId:v=>/^\d+$/.test(String(v||''))?String(v):''};
 vm.createContext(context);
 vm.runInContext(app.slice(app.indexOf('function silentImageThumbIdentity'),app.indexOf('/* Görünür satırlar önce',app.indexOf('function silentImageThumbIdentity'))),context);
 assert.equal(context.silentImageThumbIdentity({dataset:{modelId:'SAME',modelName:'SAME',colourCode:'CVL'}}).plmId,'');
 assert.equal(context.silentImageThumbIdentity({dataset:{plmId:'202',colourCode:'CVL'}}).plmId,'202');
 const source=app.slice(app.indexOf('function silentImageEntry(raw)'),app.indexOf('const BLSilentImageComplete='));
 assert.doesNotMatch(source,/modelAssetCanonicalPlmId/);
 assert.match(source,/detailImageUrlFrom\(null,/);
});
