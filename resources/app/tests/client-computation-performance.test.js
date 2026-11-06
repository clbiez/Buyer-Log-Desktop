'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),zlib=require('node:zlib');
const {Worker}=require('node:worker_threads');
const ROOT=path.join(__dirname,'..'),Groups=require('../public/collection-model-groups');
const APP=fs.readFileSync(path.join(ROOT,'public/app-main.js'),'utf8');
function block(source,start,end){const a=source.indexOf(start),b=source.indexOf(end,a+start.length);assert.ok(a>=0&&b>a);return source.slice(a,b);}
function serverCatalog(){
  const source=fs.readFileSync(path.join(ROOT,'server/server.js'),'utf8');
  const common=path.join(ROOT,'server/lib/collection-catalog.js');
  return new Function('canonicalFields','BLBusinessRules','collectionCatalog',block(source,'const COLLECTION_CATALOG_FIELDS','async function buildResponse')+';return {buildCollectionCatalogs,COLLECTION_CATALOG_SCHEMA_VERSION};')(
    require('../server/lib/canonical-fields'),require('../public/business-rules'),fs.existsSync(common)?require(common):null);
}
async function workerCatalog(rows){
  const worker=new Worker(path.join(ROOT,'server/projection-worker.js'),{workerData:{modules:['collection-catalog'],catalogOrdersBuffer:zlib.gzipSync(JSON.stringify({rows}))}});
  try{return await new Promise((resolve,reject)=>{worker.once('message',resolve);worker.once('error',reject);worker.once('exit',code=>{if(code)reject(Error('worker exit '+code));});});}
  finally{await worker.terminate();}
}
test('real projection worker and server share complete v3 catalog semantics across canonical fields',async()=>{
  const server=serverCatalog();
  for(const seed of [1,7,41]){
    const rows=Array.from({length:48},(_,i)=>({
      Category:[' Tişört ','tişört','A-B','AB','A B'][i%5],
      'Merch Alt Grup Kod':'MAG '+((i*seed)%4),'Merch Marka Yaş Grup Kod':'MMYG '+(i%3),
      'Buyer Grup (TR)':'ÖRME','Buyer':'Buyer '+(i%5),manufacturer:['Factory A','Factory 10','Factory 2'][i%3],
      season:['S7','W6','S2028','Summer'][i%4],license:['','Brand 1','Brand 2'][i%3],licensor:'DTR',country:'Bangladesh',
      line:i%2?' Basic ':'basic',productDescription:[' T-SHIRT ','t-shirt','KAZAK'][i%3],
    }));
    const result=await workerCatalog(rows);assert.equal(result.ok,true,result.error);
    const payload=JSON.parse(zlib.gunzipSync(result.compressed['collection-catalog'].buffer));
    assert.equal(payload.catalogSchemaVersion,server.COLLECTION_CATALOG_SCHEMA_VERSION);
    assert.deepEqual(payload.catalogs,server.buildCollectionCatalogs(rows));
    assert.deepEqual(payload.catalogs.manufacturer,['Factory 2','Factory 10','Factory A']);
  }
});
test('shared chronological sorting constructs one Collator and preserves exact stable order',()=>{
  let constructed=0,compared=0;
  const context={module:{exports:{}},Intl:{Collator:class{constructor(...args){constructed++;const c=new Intl.Collator(...args);this.compare=(a,b)=>{compared++;return c.compare(a,b);};}}}};
  vm.runInNewContext(fs.readFileSync(path.join(ROOT,'public/chronological-values.js'),'utf8'),context);
  const api=context.module.exports;
  const reference=(a,b,direction=1)=>{
    const l=api.chronologyParts(a),r=api.chronologyParts(b),dir=direction<0?-1:1;
    if(l&&r)return (l.kind===r.kind?l.order-r.order:l.kind==='season'?-1:1)*dir;
    if(Boolean(l)!==Boolean(r))return l?-1:1;
    return String(a??'').trim().localeCompare(String(b??'').trim(),'tr',{numeric:true,sensitivity:'base'})*dir;
  };
  const values=[null,undefined,'',0,false,' S7 ','W6','S2027','W2026','June 2027','HAZİRAN 2027','2027-06-01','İ','I','ı','i','Ç','C','ş','s','A-1','A 1','A 01','😀'];
  for(let i=0;i<200;i++)values.push(['Factory ','Ürün ','A-','ÖRME '][i%4]+((i*41)%97));
  for(const direction of [1,-1,0]){
    for(const a of values.slice(0,30))for(const b of values.slice(0,30))assert.equal(Math.sign(api.compareChronologicalValues(a,b,direction)),Math.sign(reference(a,b,direction)));
    assert.deepEqual(values.slice().sort((a,b)=>api.compareChronologicalValues(a,b,direction)),values.slice().sort((a,b)=>reference(a,b,direction)));
  }
  assert.equal(constructed,1,'locale/options must be compiled once');assert.ok(compared>100);
});
test('revision readers preserve falsy overrides, first-parent and local structural changes',()=>{
  assert.equal(typeof Groups.valueReaderForRevision,'function');assert.equal(typeof Groups.invalidateValueReader,'function');
  const rows=[{id:1,modelGroupId:0,modelGroupRole:'parent',modelSharedValues:{fabric:'First',pricing:{A:'1'}}},
    {id:2,modelGroupId:'0',modelGroupRole:'variant',fabric:'Own',quantity:0,variantOverrides:{not:'',targetPrice:0,pricing:null,flag:false}},
    {id:3,modelGroupId:0,modelGroupRole:'parent',modelSharedValues:{fabric:'Duplicate'}},
    {id:4,modelGroupId:'missing',modelGroupRole:'variant',fabric:'Orphan'}];
  const check=revision=>{const read=Groups.valueReaderForRevision(rows,revision);for(const row of rows)for(const key of ['fabric','quantity','pricing','not','targetPrice','flag','absent'])assert.deepEqual(read(row,key),Groups.effectiveValue(row,key,rows));return read;};
  const first=check(5);assert.equal(first,check(5));
  rows[0].modelSharedValues.fabric='Edited';assert.equal(first(rows[1],'fabric'),'Edited');
  rows[0]={...rows[0],modelSharedValues:{fabric:'Replaced'}};Groups.invalidateValueReader(rows);assert.notEqual(first,check(5));
  const second=check(5);rows.splice(0,1);Groups.invalidateValueReader(rows);assert.notEqual(second,check(5));
  const third=check(5);rows[1]={...rows[1],modelSharedValues:{fabric:'New revision'}};assert.notEqual(third,check(6));
  rows[1].modelGroupRole='variant';Groups.invalidateValueReader(rows);check(6);
  assert.notEqual(check(6),Groups.valueReaderForRevision(rows.slice(),6));
});
test('revision reader builds the parent index only when inheritance is actually needed',()=>{
  const parent={id:1,modelGroupId:'g',modelGroupRole:'parent',modelSharedValues:{fabric:'Model'}};
  const variant={id:2,modelGroupId:'g',modelGroupRole:'variant',quantity:0,variantOverrides:{not:'',flag:false,pricing:null}};
  const rows=[parent,variant];let scans=0;
  rows.forEach=callback=>{scans++;Array.prototype.forEach.call(rows,callback);};
  const read=Groups.valueReaderForRevision(rows,1);assert.equal(scans,0);
  assert.equal(read(variant,'not'),'');assert.equal(read(variant,'flag'),false);assert.equal(read(variant,'pricing'),null);
  assert.equal(read(parent,'fabric'),'Model');assert.equal(read(variant,'quantity'),0);assert.equal(scans,0);
  assert.equal(read(variant,'fabric'),'Model');assert.equal(scans,1);
  assert.equal(read,Groups.valueReaderForRevision(rows,1));read(variant,'fabric');assert.equal(scans,1);
  Groups.createValueReader(rows);assert.equal(scans,2,'an explicit read-only operation still creates its own fresh index');
});
test('Collection consumer uses revision index and invalidates replacement paths before derived reads',()=>{
  const value=block(APP,'function kolEffectiveValue','function kolEffectiveEndeksmatikRow');
  assert.match(value,/valueReaderForRevision/);
  const normalize=block(APP,'function kolNormalizeModelGroups','function kolLinkImportedColourVariants');assert.match(normalize,/invalidateValueReader/);
  const conflicts=block(APP,'function kolReportConflicts','function kolWorkspaceSetReadonly');assert.match(conflicts,/invalidateValueReader/);
  const save=block(APP,'kolWorkspaceSavePromise=(async()=>','function ',);assert.match(save,/invalidateValueReader/);
  const remote=block(APP,'function kolApplyRemotePatches','function kolHighlightRemoteRows');
  assert.ok(remote.indexOf('invalidateValueReader')>remote.indexOf('applied++;appliedItems.push(item)'));
  assert.ok(remote.indexOf('invalidateValueReader')<remote.indexOf('kolSyncLicensorsFromRules'));
  const legacy={effectiveValue:()=>0};const read=new Function('window','kolRows','kolWorkspaceRevision',value+';return kolEffectiveValue;')({BLCollectionModelGroups:legacy},[],1);
  assert.equal(read({},'quantity'),0,'existing API fallback keeps falsy values');
});
