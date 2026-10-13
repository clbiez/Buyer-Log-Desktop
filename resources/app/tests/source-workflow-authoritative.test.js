'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),Module=require('node:module');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'bl-source-journal-'));for(const key of ['BUYER_LOG_DATA_ROOT','BUYER_LOG_LOCAL_DATA_ROOT','BUYER_LOG_SERVER_DATA_ROOT','BUYER_LOG_AUTH_DATA_ROOT'])process.env[key]=root;
const local=require('../server/lib/local-db'),delta=require('../server/lib/delta-store'),{createSourceWorkflowService}=require('../server/lib/source-workflow-service'),adapter=require('../server/lib/data-domain/legacy-adapter');
test.after(()=>fs.rmSync(root,{recursive:true,force:true}));
function database(){const file=path.resolve(__dirname,'../server/db.js'),instance=new Module(file,module);instance.filename=file;instance.paths=Module._nodeModulePaths(path.dirname(file));instance._compile(fs.readFileSync(file,'utf8'),file);return instance.exports;}
const H=season=>({table:'ASAS',groups:[{id:'g',conditions:[{id:'c',field:'Season',op:'in',valueType:'text',values:[season]}]}]});
const initial=()=>[{id:'journal-asas',name:'Demo ASAS',server:'s',catalog:'c',role:'asas',scopes:[{id:'core',targets:['cp','orders','backlog','lfl','priceanalysis'],horizon:H('W26')}]},{id:'journal-ias',name:'Demo IAS',server:'s',catalog:'c',role:'antrepo',scopes:[{id:'core',targets:['cp','backlog','orders'],horizon:H('W26')}]}];
for(const mode of ['delta','delta-only'])test(mode+' uses actual fresh journal state, native target CAS, peer preservation and restart-safe inverse',async()=>{
 const file=path.join(root,mode,'journal.db'),a=delta.createDeltaStore({localDb:local.createLocalDb(file),mode}),b=delta.createDeltaStore({localDb:local.createLocalDb(file),mode});assert.equal((await a.hydrate()).ok,true);assert.equal((await b.hydrate()).ok,true);
 const first=database(),second=database();first.attachDeltaStore(a);second.attachDeltaStore(b);await first.mutateModelConnections(options=>first.replaceModelConnections(initial(),null,options));await b.hydrate();
 const left=createSourceWorkflowService({db:first}),right=createSourceWorkflowService({db:second}),args={sourceId:'journal-ias',moduleId:'cp',mode:'split',definition:H('W27')},before=(await left.snapshot()).items.find(item=>item.id===args.sourceId),preview=await left.preview('filter',args);
 await second.mutateModelConnections(options=>{const store=second.loadModelConnections();store.items.find(item=>item.id==='journal-asas').name='Peer native change';return second.replaceModelConnections(store.items,store.revision,options);});
 const saved=await left.update('filter',args,preview.sourceRevision);assert.equal(saved.verified,true);assert.equal((await left.snapshot()).items.find(item=>item.id==='journal-asas').name,'Peer native change');
 const restarted=database();restarted.attachDeltaStore(delta.createDeltaStore({localDb:local.createLocalDb(file),mode}));const afterRestart=createSourceWorkflowService({db:restarted});await afterRestart.restore(before,saved.sourceRevision);const restored=(await afterRestart.snapshot()).items.find(item=>item.id===args.sourceId);assert.deepEqual(restored.scopes,before.scopes);assert.notEqual(adapter.configRevision(restored),preview.sourceRevision);
 await assert.rejects(right.update('filter',args,preview.sourceRevision),{code:'SOURCE_CHANGED'});assert.equal((await right.snapshot()).items.find(item=>item.id==='journal-asas').name,'Peer native change');
});
test('native hydration and journal flush failure fail closed before reading or writing source facts',async()=>{
 const db=database(),store={isAuthoritative:true,flush:async()=>({ok:false}),hydrate:async()=>({ok:true})};db.attachDeltaStore(store);const service=createSourceWorkflowService({db});await assert.rejects(service.snapshot(),{code:'SHARED_SYNC_READ_FAILED'});await assert.rejects(service.update('binding',{sourceId:'x',moduleId:'orders',enabled:false},'old'),{code:'SHARED_SYNC_READ_FAILED'});
 store.flush=async()=>({ok:true});store.hydrate=async()=>({ok:false});await assert.rejects(service.snapshot(),{code:'SHARED_SYNC_READ_FAILED'});
});
test('native source deletion/recreation retains a monotonic receipt and invalidates old fingerprints',async()=>{
 const db=database();db.attachDeltaStore(null);const before=db.replaceModelConnections(initial()).items.find(item=>item.id==='journal-ias'),fingerprint=adapter.configRevision(before);db.replaceModelConnections(initial().filter(item=>item.id!==before.id));const next=db.replaceModelConnections(initial()).items.find(item=>item.id===before.id);assert.ok(next._configVersion>before._configVersion);assert.notEqual(adapter.configRevision(next),fingerprint);
});
