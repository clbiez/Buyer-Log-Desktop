'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync(require.resolve('../public/checklist-supplier-sync'),'utf8');
test('unclassified and failed PDF classification still reaches an explicit document preview',async()=>{
  for(const outcome of ['UNKNOWN','error']) {
    const opened=[],released=[],file={name:'scan.pdf'};
    const context={root:{BLPerf:{ensureFeature:async()=>{}},BLLayoutReader:{classify:async()=>{if(outcome==='error')throw Error('offline');return outcome;},release:async f=>released.push(f)}},toast:()=>{},T:(tr,en)=>en,openTestReportImport:async files=>opened.push(...files)};
    vm.createContext(context);
    vm.runInContext('let documentRouting=false;'+source.slice(source.indexOf('async function routeCpDocuments('),source.indexOf('  function activeTab()',source.indexOf('async function routeCpDocuments('))),context);
    await context.routeCpDocuments([file]);
    assert.deepEqual(opened,[file]);assert.deepEqual(released,[file]);
  }
});
