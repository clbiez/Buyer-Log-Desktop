'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const A=require('../public/license-atlas-engine'),cards=require('../server/lib/license-cards'),sync=require('../server/lib/license-card-sync');
const atlas=()=>({version:1,license:{id:'demo',name:'Demo',manufacturerVisible:true,requirements:'private requirements',portal:{url:'https://example.com',notes:'private portal',manufacturerVisible:false},addresses:[{id:'office',label:'Office',text:'private address',manufacturerVisible:false}],stages:[{id:'pps',title:'PPS',enabled:true,manufacturerVisible:true,note:'PRIVATE SOURCE',description:'PRIVATE DESCRIPTION',approvalNotes:'PRIVATE APPROVAL',supplierShowNotes:false,supplierShowApprovalNotes:false,supplierInstructions:'Send two samples',submissions:[{id:'mail',method:'email',label:'Send',recipient:'demo@example.com',manufacturerVisible:true,addressId:'office',note:'PRIVATE ROUTE',supplierInstructions:'public route'}]}]}});
test('producer projection is an allowlist, excluding private card and atlas fields',()=>{
 const data=atlas();data.license.portalUsername='PRIVATE LOGIN';data.license.royalty=12;
 const out=A.project({license:'Demo',licensor:'Owner',processAtlas:data,workingNotes:'PRIVATE CARD',accessReference:'PRIVATE PASSWORD',rules:[{royalty:12}]}),encoded=JSON.stringify(out);
 for(const secret of ['PRIVATE','private requirements','private address','private portal','royalty','portalUsername','workingNotes','accessReference'])assert.ok(!encoded.includes(secret),secret);
 assert.equal(out.stages[0].supplierInstructions,'Send two samples');assert.equal(out.stages[0].submissions[0].addressId,'');
 assert.equal(A.project({license:'Demo',processAtlas:{...data,license:{...data.license,manufacturerVisible:false}}}),null);
 data.license.stages[0].manufacturerVisible=false;assert.equal(A.project({processAtlas:data}).stages.length,0);
});
test('atlas validation rejects unsafe URLs, oversized data and duplicate identities',()=>{
 for(const url of ['javascript:alert(1)','https://user:password@example.com','file:///private']){
  const data=atlas();data.license.portal.url=url;assert.throws(()=>A.normalize(data),{code:'LICENSE_ATLAS_INVALID'});
 }
 const data=atlas();data.license.stages.push(data.license.stages[0]);assert.throws(()=>A.normalize(data),{code:'LICENSE_ATLAS_INVALID'});
 assert.throws(()=>A.normalize({version:1,license:{...atlas().license,requirements:'x'.repeat(14000)}}),{code:'LICENSE_ATLAS_INVALID'});
});
test('atlas edits use existing card revision, survive peer publication and never change royalty',()=>{
 const current=cards.appendDiscovered({_revisions:{pricingRules:8},pricingRules:[{id:'existing',royalty:7}]},[{license:'Demo',licensor:'Owner'}]).overrides;
 const id=current.licenseCards.items[0].id;
 const updated=cards.updateCard(current,id,{revision:1,profile:{processAtlas:atlas()}},{});
 assert.deepEqual(updated.overrides.pricingRules,current.pricingRules);assert.equal(updated.overrides._revisions.pricingRules,8);assert.equal(updated.rulesChanged,false);
 assert.equal(sync.profileSnapshot(updated.card).processAtlas.license.stages[0].title,'PPS');
 const staged=sync.stageChange(updated.overrides,{card:updated.card,actorId:'editor'});
 assert.equal(staged.licenseCardOutbox[id].fields.profile.processAtlas.license.stages[0].title,'PPS');
 const received=sync.applyRecords(current,{[id]:{profile:sync.profileSnapshot(updated.card)}},{});
 assert.deepEqual(received.overrides.licenseCards.items[0].processAtlas,updated.card.processAtlas);
 assert.deepEqual(received.overrides.pricingRules,current.pricingRules);
 assert.throws(()=>cards.updateCard(updated.overrides,id,{revision:1,profile:{processAtlas:atlas()}},{}),{code:'REVISION_CONFLICT'});
 assert.equal(current.licenseCards.items[0].processAtlas,undefined);
});
test('bundled atlas library retains all 18 uploaded process maps and validates',()=>{
 const library=require('../server/lib/license-atlas-library.json');assert.equal(library.licenses.length,18);
 for(const license of library.licenses){const out=A.normalize({license});assert.equal(out.license.stages.length,license.stages.length);assert.equal(out.license.addresses.length,license.addresses.length);assert.equal(A.project({processAtlas:out}),null);}
});
test('scoped edit tokens detect atlas changes and older peer profiles preserve the atlas',()=>{
 const current=cards.appendDiscovered({_revisions:{},pricingRules:[]},[{license:'Demo',licensor:'Owner'}]).overrides;
 const card=cards.responseOf(current,true).cards[0],id=card.id;
 const first=cards.updateCard(current,id,{editToken:card.editToken,profile:{processAtlas:atlas()}},{}).overrides;
 assert.throws(()=>cards.updateCard(first,id,{editToken:card.editToken,profile:{workingNotes:'stale'}},{}),{code:'REVISION_CONFLICT'});
 const legacy=sync.profileSnapshot(card);delete legacy.processAtlas;legacy.workingNotes='An older client changed a note';
 const received=sync.applyRecords(first,{[id]:{profile:legacy}},{}).overrides;
 assert.deepEqual(received.licenseCards.items[0].processAtlas,first.licenseCards.items[0].processAtlas);
 const cleared=sync.applyRecords(received,{[id]:{profile:{...legacy,processAtlas:null}}},{}).overrides;
 assert.equal(cleared.licenseCards.items[0].processAtlas,null);
});
test('sharing defaults to private and only explicitly selected route/address data is exported',()=>{
 const data=atlas(),l=data.license;delete l.manufacturerVisible;assert.equal(A.project({processAtlas:data}),null);
 l.manufacturerVisible=true;delete l.stages[0].manufacturerVisible;assert.equal(A.project({processAtlas:data}).stages.length,0);
 l.stages[0].manufacturerVisible=true;delete l.stages[0].submissions[0].manufacturerVisible;assert.equal(A.project({processAtlas:data}).stages[0].submissions.length,0);
 l.stages[0].submissions[0].manufacturerVisible=true;l.addresses[0].manufacturerVisible=true;
 assert.equal(A.project({processAtlas:data}).addresses[0].text,'private address');
});
test('export HTML escapes source content and contains only the producer projection',()=>{
 const data=atlas();data.license.stages[0].title='</script><img src=x onerror=alert(1)>';
 const html=A.exportHTML([{license:'Demo',processAtlas:data}],'en');
 assert.ok(html.includes('&lt;/script&gt;'));assert.ok(!html.includes('PRIVATE'));assert.ok(!html.includes('onerror=alert(1)>'));
 assert.match(html,/Content-Security-Policy/);assert.match(html,/script-src 'none'/);
});
