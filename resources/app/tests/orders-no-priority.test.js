'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../public/app-main.js'),'utf8');
function fn(name){const start=source.indexOf(`function ${name}(`);assert.ok(start>=0);const end=source.indexOf('\n}',start);return source.slice(start,end+2);}
test('Orders columns omit priority without changing CP definitions or other columns',()=>{
  const cols=[{k:'Priority'},{k:'Season'},{k:'STATUS'}],context={ORDERS_STATUS_COL:{k:'Active/Inactive'}};
  vm.createContext(context);vm.runInContext(fn('ordersColumnsFromCp')+';globalThis.build=ordersColumnsFromCp;',context);
  assert.deepEqual(Array.from(context.build(cols),c=>c.k),['Active/Inactive','Season','STATUS']);
  assert.deepEqual(cols.map(c=>c.k),['Priority','Season','STATUS']);
});
test('Orders never invokes the personal decision engine, including old callers and exports',()=>{
  const context={state:{orders:{rows:[{}]}},window:{BLCpAssistant:{computeDecisionsForRows(){throw new Error('Orders invoked priority engine');}}}};
  vm.createContext(context);vm.runInContext(fn('syncUnifiedPrioritiesForTable')+';globalThis.sync=syncUnifiedPrioritiesForTable;',context);
  assert.equal(context.sync('orders'),true);
  assert.doesNotMatch(fn('renderOrdersNow'),/ensureUnifiedPrioritiesForTable|actionPriorityCounts|qfgSeg\('orders','pri'/);
});
test('old priority filters and sort cannot silently hide or reorder Orders',()=>{
  const context={state:{colFilters:{orders:{Priority:{values:new Set(['CRITICAL'])},STATUS:{values:new Set(['Production'])}}},ordersSort:{key:'Priority',dir:'asc'}},document:{getElementById(){return null;}},norm:v=>String(v||'')};
  vm.createContext(context);vm.runInContext(fn('migrateLegacyOrdersQuickFilters')+';globalThis.migrate=migrateLegacyOrdersQuickFilters;',context);
  context.migrate();
  assert.equal(context.state.colFilters.orders.Priority,undefined);assert.ok(context.state.colFilters.orders.STATUS);
  assert.equal(context.state.ordersSort.key,null);
});
