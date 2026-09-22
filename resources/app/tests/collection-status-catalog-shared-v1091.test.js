'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const store=require('../server/lib/collection-workspaces.js');

test('shared Collection workspace seeds and carries canonical status catalog',()=>{
  const workspace=store.defaultWorkspace('status-test');
  assert.equal(workspace.statusCatalog.length,12);
  assert.equal(workspace.statusCatalog[6].name,'Capacity Request');
});

test('legacy row status is added to catalog instead of becoming orphaned',()=>{
  const catalog=store.normalizeStatusCatalog(undefined,[{id:1,durum:'Legacy Review'}]);
  assert.ok(catalog.some(entry=>entry.name==='Legacy Review'));
});

test('status color structural change does not rewrite business rows',()=>{
  const current={...store.defaultWorkspace('status-test'),initialized:true,_revision:3,rows:[{id:1,_rev:2,durum:'Fiyatlamada',modelKod:'M1'}]};
  const nextCatalog=current.statusCatalog.map(entry=>entry.name==='Fiyatlamada'?{...entry,color:'#123ABC'}:entry);
  const result=store.applyRowChanges(current,{baseRevision:3,structure:{statusCatalog:nextCatalog}});
  assert.equal(result.changed,true);
  assert.equal(result.rowPatches,null);
  assert.equal(result.saved.rows[0].modelKod,'M1');
  assert.equal(result.saved.rows[0]._rev,2);
  assert.equal(result.saved.statusCatalog.find(entry=>entry.name==='Fiyatlamada').color,'#123ABC');
});
