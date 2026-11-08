'use strict';
// PREPARED ONLY. Guards/private Orders formula adapter, separate from counts.
const assert=require('node:assert/strict');
function once(source,before,after){const at=source.indexOf(before);assert.ok(at>=0,'provider seam missing');assert.equal(source.indexOf(before,at+before.length),-1,'provider seam ambiguous');return source.slice(0,at)+after+source.slice(at+before.length);}
const helpers=`const _ordersRequireFullSynchronousRead=()=>{
  if(ordersProjectionIsThin())throw Object.assign(ordersFullActionError('ORDERS_FULL_STALE'),{code:'ORDERS_FULL_REQUIRED'});
};
// Private named renderer only. The loader must already certify its finite plan.
const _applyOrdersFormulaColumnsForCurrentView=()=>{
  try{
    const fc=window.BLFormulaColumns;if(!fc)return;
    fc.refresh('orders',state.orders&&Array.isArray(state.orders.rows)?state.orders.rows:[]);
  }catch(error){if(error?.code==='ORDERS_FULL_REQUIRED')throw error;}
};
`;
const tableWrapper=`const _ordersFullScreenTable=window.BLAIScreenData.table;
window.BLAIScreenData.table=function(tab,opts={}){
  if(tab==='orders'&&!opts?.columnsOnly)_ordersRequireFullSynchronousRead();
  return _ordersFullScreenTable.call(this,tab,opts);
};
`;
const formulaRowsWrapper=`const _ordersFullFormulaRows=window.BLFormulaRows.orders;
window.BLFormulaRows.orders=()=>{_ordersRequireFullSynchronousRead();return _ordersFullFormulaRows();};
`;
const publicFormulaWrapper=`const _ordersFullApplyFormulaColumns=applyFormulaColumns;
window.applyFormulaColumns=function(tableKey){
  if(tableKey==='orders')_ordersRequireFullSynchronousRead();
  return _ordersFullApplyFormulaColumns(tableKey);
};`;
function app(source){
 source=once(source,'  freeze:{} };\n\nvar startupPageProfileReady','  freeze:{} };\n\n'+helpers+'\nvar startupPageProfileReady');
 source=once(source,"};\n// Üst çubuktaki LCW AI düğmesi:","};\n"+tableWrapper+'// Üst çubuktaki LCW AI düğmesi:');
 const rows="window.BLFormulaRows = {\n  cp: () => (state.cp && Array.isArray(state.cp.rows) ? state.cp.rows : []),\n  orders: () => (state.orders && Array.isArray(state.orders.rows) ? state.orders.rows : []),\n  ship: () => (Array.isArray(shipRows) ? shipRows : []),\n};\n";
 source=once(source,rows,rows+formulaRowsWrapper);
 source=once(source,'window.applyFormulaColumns = applyFormulaColumns;',publicFormulaWrapper);
 source=once(source,"  applyFormulaColumns('orders');","  _applyOrdersFormulaColumnsForCurrentView();");
 return source;
}
function formula(source){return once(source,"      try { const rows = provider(); return Array.isArray(rows) ? rows : []; } catch (_) { return []; }",
 "      try { const rows = provider(); return Array.isArray(rows) ? rows : []; } catch (error) { if (error && error.code === 'ORDERS_FULL_REQUIRED') throw error; return []; }");}
module.exports={app,formula,helpers,tableWrapper,formulaRowsWrapper,publicFormulaWrapper};
