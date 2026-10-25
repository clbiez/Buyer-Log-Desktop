'use strict';
module.exports=async()=>{const fixture=await require('./operations-fixture.cjs')();await fixture.tab('cp');await fixture.page.locator('#cpTable tbody tr[data-id]').first().waitFor();await fixture.tab('koleksiyon');await fixture.page.evaluate(()=>{kolNextId=100001;kolRows=state.cp.rows.slice(0,12).map(cpRowToKolRow);kolPictureHidden=true;renderKol();});return fixture;};
