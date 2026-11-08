'use strict';
// In-memory preparation recipe. Root alone decides/adopts actual integration.
// Does NOT claim this bounded set covers every browser event initiator.
const {strict:assert}=require('node:assert');
const sync=['syncCpModelColumns','syncOrdersColumnsFromCp','applyCoreAutoFilterState',
  'reloadPersistedTableColumnStateAfterHydration','toggleOrdersQuickExFactory','toggleOrdersActiveQuick'];
function patch(source,extractFunction){
  for(const name of sync){const old=extractFunction(source,name),at=old.indexOf('{');
    const next=old.slice(0,at+1)+'\n  assertOrdersFiniteMutationAllowed();'+old.slice(at+1);
    assert.equal(source.split(old).length,2,name+' unique actual declaration');source=source.replace(old,next);}
  for(const name of ['removeActiveFilterToken','clearTableFilters','setPartialView']){
    const old=extractFunction(source,name),at=old.indexOf('){');assert.ok(at>=0,name);
    const next=old.slice(0,at+2)+"\n  if(tableKey==='orders')assertOrdersFiniteMutationAllowed();"+old.slice(at+2);
    assert.equal(source.split(old).length,2,name+' unique actual declaration');source=source.replace(old,next);
  }
  const name='migrateLegacyOrdersQuickFilters',old=extractFunction(source,name),at=old.indexOf('{');
  source=source.replace(old,old.slice(0,at+1)+'\n  if(ordersProjectionIsThin()){assertOrdersFiniteViewCurrent();return;}'+old.slice(at+1));
  const render=extractFunction(source,'renderOrdersNow');assert.ok(render.includes('if(!state.orders)return;'));
  source=source.replace(render,render.replace('if(!state.orders)return;','if(!state.orders)return;\n  assertOrdersFiniteViewCurrent();'));
  return source;
}
module.exports={sync,patch};
