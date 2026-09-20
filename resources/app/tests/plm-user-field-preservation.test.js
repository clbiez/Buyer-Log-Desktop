'use strict';
const test=require('node:test'); const assert=require('node:assert/strict');
const {mergePlmOwned}=require('../server/lib/plm-sync-v2');
test('PLM merge updates PLM-owned fields and preserves Buyer Log-owned fields',()=>{
  const before={plmId:'1',url:'old',plmImage:'old.jpg',buyerNotes:'keep',manualPricing:2.15,confirmedManufacturer:'KEEP',targetPrice:1.9,userTags:['vip']};
  const incoming={plmId:'1',url:'new',plmImage:null,buyerNotes:'overwrite?',manualPricing:99,confirmedManufacturer:'BAD',targetPrice:99};
  const out=mergePlmOwned(before,incoming);
  assert.equal(out.url,'new'); assert.equal(out.plmImage,'old.jpg','transient empty PLM response must not wipe valid image');
  assert.equal(out.buyerNotes,'keep'); assert.equal(out.manualPricing,2.15); assert.equal(out.confirmedManufacturer,'KEEP'); assert.equal(out.targetPrice,1.9); assert.deepEqual(out.userTags,['vip']);
});
