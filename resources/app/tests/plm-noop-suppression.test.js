'use strict';
const test=require('node:test'); const assert=require('node:assert/strict');
const {diffPlmRecords,plmFingerprint}=require('../server/lib/plm-sync-v2');
test('PLM property order, trim and file order differences are no-op',()=>{
  const a={plmId:' 1 ',styleName:' Shirt ',files:['b.pdf','a.pdf'],plmDocuments:[{id:'2',name:'B'},{id:'1',name:'A'}],updatedAt:'old'};
  const b={styleName:'Shirt',plmId:'1',files:['a.pdf','b.pdf'],plmDocuments:[{name:'A',id:'1'},{name:'B',id:'2'}],updatedAt:'new'};
  assert.equal(plmFingerprint(a),plmFingerprint(b));
  const diff=diffPlmRecords({1:a},{1:b}); assert.equal(diff.changedCount,0); assert.equal(diff.unchanged.length,1);
});
