'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {preferenceProjection}=require('../server/lib/test-reports/revision');
test('opening windows and updating notification history do not invalidate an unchanged document review',()=>{
 const before={_revision:1,entries:{'lcw.cp.checklist.v1':{value:'{"key":{"state":"open"}}',at:'old'},'lcw.corePageFilters.auto.v1':{value:'before'},'lcw.notifications.history.v1':{value:'[]'}}};
 const after=structuredClone(before);after._revision=2;after.entries['lcw.corePageFilters.auto.v1'].value='after';after.entries['lcw.notifications.history.v1'].value='["notice"]';after.entries['lcw.cp.checklist.v1'].at='new';
 assert.deepEqual(preferenceProjection(before),preferenceProjection(after));
 for(const key of ['lcw.backlog.autoState.v1','lcw.backlog.columnWidths.v1','lcw.cp.dimFilters.v1','lcw.koleksiyon.pricingExcelColumns.v1','lcw.overview.bgDimFilters.v1','lcw.overview.dimFilters.v1','lcw.todo.pages.v1','lcw.todo.text.v1'])after.entries[key]={value:'hydrated defaults'};
 assert.deepEqual(preferenceProjection(before),preferenceProjection(after),'reload hydration must not invalidate unchanged CP evidence');
 after.entries['lcw.cp.checklist.v1'].value='{"key":{"state":"rejected"}}';assert.notDeepEqual(preferenceProjection(before),preferenceProjection(after));
 after.entries['lcw.cp.rules.priority.v1']={value:'changed rules'};assert.notDeepEqual(preferenceProjection(before),preferenceProjection(after));
 const formula=structuredClone(before);formula.entries['lcw.formula.columns.v1']={value:'new formula'};assert.notDeepEqual(preferenceProjection(before),preferenceProjection(formula));
 const removed=structuredClone(before);delete removed.entries['lcw.cp.checklist.v1'];assert.notDeepEqual(preferenceProjection(before),preferenceProjection(removed));
});
