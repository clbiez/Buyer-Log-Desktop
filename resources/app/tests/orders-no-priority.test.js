'use strict';
/* Siparişler (Orders) ve öncelik sözleşmesi.
   v20261116: Kullanıcı kararıyla Priority Siparişler'e GERİ eklendi; checklist
   (ve onun kanıtı PLM numune sütunu) Siparişler'de yine YOKTUR. Öncelik CP'nin
   checklist'li kişisel karar motoruyla (computeDecisionsForRows) DEĞİL,
   checklist hariç worker yoluyla (scheduleOrdersPriorities → BLOrdersPriority)
   hesaplanır; 50k satırda ana iş parçacığı donmaz (tests/orders-priority-20261116). */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../public/app-main.js'),'utf8');
function fn(name){const start=source.indexOf(`function ${name}(`);assert.ok(start>=0);const end=source.indexOf('\n}',start);return source.slice(start,end+2);}
test('Orders columns keep Priority but omit the checklist evidence column without changing CP definitions',()=>{
  const cols=[{k:'Priority'},{k:'PLM Sample',type:'plmSample'},{k:'Season'},{k:'STATUS'}],context={ORDERS_STATUS_COL:{k:'Active/Inactive'}};
  vm.createContext(context);vm.runInContext(fn('ordersColumnsFromCp')+';globalThis.build=ordersColumnsFromCp;',context);
  assert.deepEqual(Array.from(context.build(cols),c=>c.k),['Priority','Active/Inactive','Season','STATUS']);
  assert.deepEqual(cols.map(c=>c.k),['Priority','PLM Sample','Season','STATUS']);
});
test('Orders never invokes the checklist-aware personal decision engine; priority comes from the checklist-free worker path',()=>{
  const context={state:{orders:{rows:[{}]}},window:{BLCpAssistant:{computeDecisionsForRows(){throw new Error('Orders invoked CP decision engine');}}}};
  vm.createContext(context);vm.runInContext(fn('syncUnifiedPrioritiesForTable')+';globalThis.sync=syncUnifiedPrioritiesForTable;',context);
  assert.equal(context.sync('orders'),true);
  const render=fn('renderOrdersNow');
  assert.doesNotMatch(render,/ensureUnifiedPrioritiesForTable|actionPriorityCounts|qfgSeg\('orders','pri'/,'render does not block on priorities');
  assert.match(render,/void scheduleOrdersPriorities\(\);/);
  assert.doesNotMatch(fn('scheduleOrdersPriorities'),/computeDecisionsForRows/);
});
test('Priority filters and sort stay valid on Orders now that the column is back',()=>{
  const context={state:{colFilters:{orders:{Priority:{values:new Set(['CRITICAL'])},STATUS:{values:new Set(['Production'])}}},ordersSort:{key:'Priority',dir:'asc'}},document:{getElementById(){return null;}},norm:v=>String(v||'')};
  vm.createContext(context);vm.runInContext(fn('migrateLegacyOrdersQuickFilters')+';globalThis.migrate=migrateLegacyOrdersQuickFilters;',context);
  context.migrate();
  assert.ok(context.state.colFilters.orders.Priority);assert.ok(context.state.colFilters.orders.STATUS);
  assert.equal(context.state.ordersSort.key,'Priority');
});
