'use strict';
/* Stored PLM assets for Office: BOM summaries and technical sheet status are
   read from Buyer Log's own stores (no PLM request); a status read never
   migrates the model files index. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'bl-plm-assets-'));
for(const key of ['BUYER_LOG_DATA_ROOT','BUYER_LOG_LOCAL_DATA_ROOT','BUYER_LOG_SERVER_DATA_ROOT','BUYER_LOG_AUTH_DATA_ROOT'])process.env[key]=root;
const {createStore}=require('../server/lib/plm-bom-store'),ownership=require('../server/lib/plm-technical-sheet-ownership'),{normalizePlmId}=require('../server/lib/plm-id');
const {createToolRegistry}=require('../server/lib/agent-tool-registry'),{registerPlmAssetTools}=require('../server/lib/agent-plm-asset-tools');
test.after(()=>fs.rmSync(root,{recursive:true,force:true}));
const profile={id:'demo',enabled:true},ctx={ownerId:profile.id,profile};
function setup(index){
  const bomStore=createStore(path.join(root,'plm-bom-'+Math.random().toString(36).slice(2)+'.json'));
  bomStore.saveResults([{plmId:'1234567',styleId:'99001',fabric:'DEMO %100 Pamuk',components:[{componentCode:'A1',description:'DEMO'}],placements:[]}]);
  const registry=createToolRegistry({userAccess:{profileById:()=>profile,hasArea:()=>true,appendAudit:()=>{}}});
  registerPlmAssetTools(registry,{bomStore,normalizePlmId,readModelFilesIndex:()=>index,fileExists:item=>item.exists!==false,ownership});
  return registry;
}
test('BOM read returns stored summaries only and lists missing PLM IDs',async()=>{
  const registry=setup([]),result=await registry.execute('collection.plm.bom.read',{plmIds:['1234567','7654321']},ctx);
  assert.equal(result.data.entries.length,1);assert.equal(result.data.entries[0].styleId,'99001');assert.equal(result.data.entries[0].fabric,'DEMO %100 Pamuk');
  assert.equal(result.data.entries[0].componentCount,1);assert.deepEqual(result.data.missing,['7654321']);
  assert.equal(result.data.entries[0].components,undefined,'full component lists do not leave the tool');
  await assert.rejects(registry.execute('collection.plm.bom.read',{plmIds:[]},ctx),{code:'OFFICE_TOOL_SCHEMA'});
});
test('technical sheet status uses the native resolver on a copy and never migrates the index',async()=>{
  const index=[{id:'f1',plmId:'1234567',modelKey:'legacy-key',plmSource:'technical-sheet',plmLanguage:'tr'},{id:'f2',plmId:'2222222',modelKey:ownership.canonicalTechnicalSheetKey('2222222'),plmSource:'technical-sheet',exists:false}];
  const before=JSON.stringify(index),registry=setup(index);
  const result=await registry.execute('collection.plm.techsheet.status',{plmIds:['1234567','2222222','3333333']},ctx);
  const byId=Object.fromEntries(result.data.items.map(item=>[item.plmId,item]));
  assert.equal(byId['1234567'].status,'ready');assert.equal(byId['2222222'].status,'stale');assert.equal(byId['3333333'].status,'missing');
  assert.equal(JSON.stringify(index),before,'the legacy entry was not migrated by a read');
});
