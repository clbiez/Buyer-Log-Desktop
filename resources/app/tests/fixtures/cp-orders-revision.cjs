'use strict';

// Synthetic current-format payloads only. These are not a future thin/delta schema.
function fixtures() {
  const cpRows = [
    {_id: 1, 'Order Code': 'DEMO-001', 'Model Name': 'Demo A', 'C.Code': '001', _canEdit: true, _canEditShared: false},
    {_id: 2, 'Order Code': 'DEMO-001', 'Model Name': 'Demo A', 'C.Code': '002', _canEdit: false, _canEditShared: false},
  ];
  const ordersRows = [
    {_id: 3, 'Order Code': 'DEMO-002', 'Model Name': 'Demo B', 'C.Code': '003', 'Order Quantity': 0, _canEdit: true},
  ];
  return {
    state: {
      cp: {rows: cpRows}, orders: {rows: []}, orderSummary: {rows: []},
      cpSelected: new Set([1]), cpDirty: new Set([1]), ordersSelected: new Set([3]),
      ordersLogisticExpanded: new Set([3]),
    },
    loaded: {orders: ordersRows},
    deferred: {orderSummaryDeferred: true},
    projection: {rows: ordersRows, collectionCatalogs: {}},
  };
}

module.exports = {fixtures};
