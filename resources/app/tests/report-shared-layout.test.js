'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'bl-report-layout-'));
for(const key of ['BUYER_LOG_DATA_ROOT','BUYER_LOG_LOCAL_DATA_ROOT','BUYER_LOG_SERVER_DATA_ROOT','BUYER_LOG_AUTH_DATA_ROOT'])process.env[key]=root;
test.after(()=>fs.rmSync(root,{recursive:true,force:true}));
const schema=require('../server/lib/table-report-layouts'),db=require('../server/db'),sync=require('../server/lib/shared-sync-policy');
const layout={'["model",0]':[['Model Name'],['PLM ID'],['Colour']]};
test('shared layout validates bounded field IDs and rejects duplicate or executable configuration',()=>{
 assert.equal(schema.slot('cp','extended'),'cp.extended');assert.throws(()=>schema.slot('../','all'));
 assert.throws(()=>schema.layout({'model':[['A'],['A'],[]]}));assert.throws(()=>schema.layout({'model':[[],[],{},[]]}));
 assert.throws(()=>schema.layout(JSON.parse('{"__proto__":[[],[],[]]}')));assert.throws(()=>schema.layout({'model':[[{html:'x'}],[],[]]}));
 assert.deepEqual(JSON.parse(JSON.stringify(schema.layout(layout))),layout);
});
test('publishing is revision checked, durable and does not overwrite another table or unrelated rules',()=>{
 const first=db.replaceTableReportLayout({table:'cp',view:'extended',layout,expectedId:''},{id:'moderator'}),entry=first.slots['cp.extended'];
 assert.ok(entry.id);assert.equal(entry.updatedBy,'moderator');
 for(const view of ['focus','extended','all','custom'])assert.equal(first.slots['cp.'+view].id,entry.id);
 assert.throws(()=>db.replaceTableReportLayout({table:'cp',view:'extended',layout:{},expectedId:''},{id:'moderator'}),e=>e.code==='REPORT_LAYOUT_CONFLICT');
 const second=db.replaceTableReportLayout({table:'orders',view:'focus',layout:{},expectedId:''},{id:'moderator'});
 assert.deepEqual(second.slots['cp.extended'],entry);assert.ok(second.slots['orders.focus'].id);
 assert.deepEqual(db.loadOverrides().tableReportLayouts,second);
 const third=db.replaceTableReportLayout({table:'cp',view:'extended',layout:{},expectedId:entry.id},{id:'moderator'});
 assert.notEqual(third.slots['cp.extended'].id,entry.id);assert.equal(Object.keys(third.slots['cp.extended'].layout).length,0);
});
test('published layouts use master authority transport and the HTTP writer requires Moderator',()=>{
 const server=fs.readFileSync(path.join(__dirname,'../server/server.js'),'utf8');
 assert.match(server,/app\.put\('\/api\/table-report-layouts', userAccess\.requireModerator/);
 assert.match(server,/publishSharedMasterChange\('tableReportLayouts',req\)/);
 assert.deepEqual(sync.sanitizeOverridesMaster({tableReportLayouts:{version:1,slots:{}},notesmap:{private:'secret'}}),{tableReportLayouts:{version:1,slots:{}}});
 assert.deepEqual(sync.sanitizeOverridesBusiness({tableReportLayouts:{version:1,slots:{}}}),{});
});

test('master checkpoint round-trip carries layout identity without leaking personal overrides',()=>{
 const published={version:1,slots:{'cp.custom':{id:'publication',layout,updatedAt:'2026-11-16',updatedBy:'moderator'}}};
 const master=sync.masterRecordsFromState({records:{'store:overrides.json':{tableReportLayouts:published,notesmap:{private:'demo'},_revision:9}}});
 const received=sync.scopeCheckpointRecords('master',JSON.parse(JSON.stringify(master)));
 assert.deepEqual(schema.normalize(received['store:overrides.json'].tableReportLayouts),schema.normalize(published));
 assert.equal(received['store:overrides.json'].notesmap,undefined);assert.deepEqual(sync.scopeCheckpointRecords('business',master),{});
});
