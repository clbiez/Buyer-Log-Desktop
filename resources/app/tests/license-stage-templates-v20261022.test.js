'use strict';
// Manual licensor, stage templates (one edit → every linked license), ASAS refresh
// feedback and the supplier atlas drawer layout.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const cards=require('../server/lib/license-cards'),sync=require('../server/lib/license-card-sync'),policy=require('../server/lib/shared-sync-policy');
const A=require('../public/license-atlas-engine'),S=require('../public/license-supplier-atlas');
const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');
const NOW='2026-10-22T10:00:00.000Z';
const base=()=>cards.appendDiscovered({_revision:0,_revisions:{pricingRules:1},pricingRules:[]},[{license:'NORTH STAR',licensor:'Demo Licensing'},{license:'ORBIT CLUB',licensor:'Demo Studio'},{license:'BLUE HARBOR',licensor:''}],'2026-01-01T00:00:00Z').overrides;
const tokenOf=(ov,id)=>cards.responseOf(ov,true).cards.find(c=>c.id===id).editToken;
const byLicense=(ov,license,licensor)=>cards.stateOf(ov).items.find(c=>c.license===license&&(licensor==null||c.licensor===licensor));
const atlasWith=(card,stages)=>({version:1,license:{id:card.id,name:card.license,agency:card.licensor,stages,addresses:[],portal:{url:'',notes:''}},sharedAddresses:[],visualLibrary:[]});

test('an empty licensor is assigned in place; a set licensor is never renamed', () => {
  let ov=base();const blue=byLicense(ov,'BLUE HARBOR');
  assert.throws(()=>cards.setLicensor(ov,blue.id,{editToken:'stale',licensor:'Demo Rights'},NOW),{code:'REVISION_CONFLICT'});
  assert.throws(()=>cards.setLicensor(ov,blue.id,{editToken:tokenOf(ov,blue.id),licensor:'  '},NOW),{code:'LICENSE_LICENSOR_INVALID'});
  const r=cards.setLicensor(ov,blue.id,{editToken:tokenOf(ov,blue.id),licensor:'Demo Rights'},NOW);ov=r.overrides;
  assert.equal(r.card.id,blue.id,'assigning keeps the id');assert.equal(byLicense(ov,'BLUE HARBOR').licensor,'Demo Rights');
  assert.equal(cards.revisionOf(ov,'licenseCards'),cards.revisionOf(base(),'licenseCards')+1);
  const north=byLicense(ov,'NORTH STAR');
  assert.throws(()=>cards.setLicensor(ov,north.id,{editToken:tokenOf(ov,north.id),licensor:'DTR'},NOW),{code:'LICENSE_LICENSOR_LOCKED'});
  assert.throws(()=>cards.setLicensor(ov,north.id,{editToken:tokenOf(ov,north.id),licensor:'demo licensing',mode:'add'},NOW),{code:'LICENSE_LICENSOR_EXISTS'});
});

test('another licensor gets its own row; profile and map are copied only on request', () => {
  let ov=base();const north=byLicense(ov,'NORTH STAR');
  north.contactName='Ada';north.processAtlas=A.normalize(atlasWith(north,[{id:'s1',title:'Konsept',approver:'licensor',submissions:[]}]));
  const plain=cards.setLicensor(ov,north.id,{editToken:tokenOf(ov,north.id),licensor:'DTR',mode:'add'},NOW);
  assert.notEqual(plain.card.id,north.id);assert.equal(plain.card.contactName,'');assert.equal(plain.card.processAtlas,undefined);
  const copied=cards.setLicensor(ov,north.id,{editToken:tokenOf(ov,north.id),licensor:'DTR',mode:'add',copy:true},NOW);ov=copied.overrides;
  assert.equal(copied.card.contactName,'Ada');assert.equal(copied.card.processAtlas.license.agency,'DTR');
  assert.deepEqual(cards.stateOf(ov).items.filter(c=>c.license==='NORTH STAR').map(c=>c.licensor).sort(),['DTR','Demo Licensing'],'two licensors → two rows');
});

test('saving a stage template updates every linked stage and leaves the others alone', () => {
  let ov=base();const north=byLicense(ov,'NORTH STAR'),orbit=byLicense(ov,'ORBIT CLUB');
  const template={id:'tpl-pps',name:'PPS onayı',stage:{title:'PPS',approver:'LCW',testRequired:true,submissions:[{id:'r1',method:'physical',recipientType:'LCW',addressId:'adr1',qty:'2'}]},addresses:[{id:'adr1',label:'LCW Depo',text:'Demo Cad. 1'},{id:'unused',label:'X',text:'Y'}]};
  let r=cards.saveTemplate(ov,{template},NOW);ov=r.overrides;
  const saved=cards.templatesOf(ov).items[0];assert.equal(saved.name,'PPS onayı');assert.deepEqual(saved.addresses.map(a=>a.id),['adr1'],'only used addresses travel');
  assert.equal(r.cards.length,0,'nothing linked yet');
  const linked=cards.applyTemplate({id:'n-pps',enabled:false},saved,A.normalize(atlasWith(north,[])));
  byLicense(ov,'NORTH STAR').processAtlas=A.normalize({...atlasWith(north,[{id:'own',title:'Konsept',approver:'licensor',submissions:[]},linked]),license:{...atlasWith(north,[]).license,stages:[{id:'own',title:'Konsept',approver:'licensor',submissions:[]},linked],addresses:[{id:'adr1',label:'LCW Depo',text:'Demo Cad. 1'}]}});
  byLicense(ov,'ORBIT CLUB').processAtlas=A.normalize(atlasWith(orbit,[{id:'o-pps',title:'PPS',approver:'LCW',submissions:[]}]));
  assert.equal(byLicense(ov,'NORTH STAR').processAtlas.license.stages[1].templateId,'tpl-pps','normalize keeps the link');
  assert.throws(()=>cards.saveTemplate(ov,{template:{...template,stage:{...template.stage,title:'PPS v2'}},expectedUpdatedAt:'old'},NOW),{code:'REVISION_CONFLICT'});
  assert.throws(()=>cards.saveTemplate(ov,{template:{...template,id:'other',name:'pps ONAYI'}},NOW),{code:'LICENSE_TEMPLATE_NAME'});
  r=cards.saveTemplate(ov,{template:{...template,stage:{...template.stage,title:'PPS v2',approver:'mixed'},addresses:[{id:'adr1',label:'LCW Depo',text:'Yeni Cad. 2'}]},expectedUpdatedAt:saved.updatedAt},'2026-10-22T11:00:00.000Z');ov=r.overrides;
  assert.deepEqual(r.cards.map(c=>c.license),['NORTH STAR'],'only the linked license changes');
  const stages=byLicense(ov,'NORTH STAR').processAtlas.license.stages;
  assert.deepEqual(stages.map(s=>[s.id,s.title,s.approver,s.enabled!==false]),[['own','Konsept','licensor',true],['n-pps','PPS v2','mixed',false]],'content follows the template; id and on/off stay');
  const adr=byLicense(ov,'NORTH STAR').processAtlas.license.addresses;
  assert.equal(adr.find(a=>a.id==='tpl-tpl-pps-adr1').text,'Yeni Cad. 2','the template address travels under its own id');
  assert.equal(adr.find(a=>a.id==='adr1').text,'Demo Cad. 1','the license’s own address with the same id is never overwritten');
  assert.equal(stages[1].submissions[0].addressId,'tpl-tpl-pps-adr1');
  assert.equal(byLicense(ov,'ORBIT CLUB').processAtlas.license.stages[0].title,'PPS','unlinked stages keep their own content');
  const del=cards.deleteTemplate(ov,'tpl-pps',{expectedUpdatedAt:cards.templatesOf(ov).items[0].updatedAt},NOW);
  const after=byLicense(del.overrides,'NORTH STAR').processAtlas.license.stages[1];
  assert.equal(after.title,'PPS v2');assert.equal(after.templateId,undefined,'deleting unlinks and keeps the step');
  assert.equal(cards.templatesOf(del.overrides).items.length,0);
});

test('templates sync as one record: staged, allowed by the peer policy, newest wins', () => {
  const ov=base(),t=cards.saveTemplate(ov,{template:{id:'tpl-a',name:'A',stage:{title:'A',approver:'LCW',submissions:[]}}},NOW).overrides;
  const staged=sync.stageChange(t,{cards:[],stageTemplates:cards.templatesOf(t),actorId:'u1'});
  assert.equal(staged.licenseCardOutbox[sync.TEMPLATES_ID].fields.templates.items[0].id,'tpl-a');
  const delta=policy.sanitizeDelta({id:'license-card:stage-templates',patch:{templates:cards.templatesOf(t),pricingRules:[{id:'x'}]}});
  assert.deepEqual(Object.keys(delta.patch),['templates']);assert.equal(policy.classifyRecordId('license-card:stage-templates'),'SHARED_BUSINESS');
  const applied=sync.applyRecords(ov,{[sync.TEMPLATES_ID]:{templates:cards.templatesOf(t)}},{});
  assert.equal(cards.templatesOf(applied.overrides).items[0].name,'A');
  const older=sync.applyRecords(applied.overrides,{[sync.TEMPLATES_ID]:{templates:{items:[],updatedAt:'2020-01-01T00:00:00Z'}}},{});
  assert.equal(older.changed,false,'an older template set never replaces a newer one');
});

test('the supplier file never carries the template link', () => {
  const card={id:'c',license:'NORTH STAR',licensor:'Demo',processAtlas:atlasWith({id:'c',license:'NORTH STAR',licensor:'Demo'},[{id:'s',title:'PPS',approver:'LCW',templateId:'tpl-secret',submissions:[]}])};
  const html=S.buildHTML(S.project([card]).licenses,{lang:'tr'});
  assert.ok(!html.includes('tpl-secret'));
});

test('supplier atlas: each license is an in-place drawer with fixed, aligned route columns', () => {
  const card={id:'c',license:'NORTH STAR',licensor:'Demo',processAtlas:atlasWith({id:'c',license:'NORTH STAR',licensor:'Demo'},[{id:'s',title:'PPS',approver:'LCW',submissions:[{id:'r',method:'physical',recipientType:'LCW',qty:'2',timing:'approval'}]}])};
  const html=S.buildHTML(S.project([card,{id:'d',license:'ORBIT',licensor:'X'}]).licenses,{lang:'en'});
  assert.equal((html.match(/<details class="lic"/g)||[]).length,2);
  assert.ok(!/<a href="#l\d/.test(html)&&!html.includes('<article'),'no jump links to separate sections');
  assert.match(html,/\.lic::details-content\{block-size:0/);assert.match(html,/\.lic\[open\]::details-content\{block-size:auto\}/);
  assert.match(html,/\.route\{display:grid;grid-template-columns:180px minmax\(0,1fr\) 200px/);
  assert.match(html,/\.route \.tags\{display:flex;flex-wrap:wrap;justify-content:flex-end/);
  assert.ok(!html.includes('style="grid-column'),'no ad-hoc inline column overrides');
  // #654: aşamalar katlanabilir oldu; ipucu lisans + aşama tıklamasını birlikte anlatır.
  assert.match(html,/Click a license to see its map, then a step number or title to toggle its details\./);
  assert.match(html,/<meta http-equiv="Content-Security-Policy" content="default-src 'none';/);assert.ok(!/<script/i.test(html));
});

test('client: ASAS refresh is queued with feedback; licensor and templates are editable', () => {
  const src=read('public/license-cards.js'),map=read('public/license-map-editor.js'),routes=read('server/routes/license-card-routes.js');
  assert.match(src,/if\(refresh\)S\.refreshNext=true;\s*if\(S\.pending\)return S\.pending;/,'a refresh during a load is queued, not dropped');
  assert.match(src,/if\(refresh\)toast\(\.\.\.refreshMessage\(data\)\)/);assert.match(src,/LICENSE_SOURCE_UNAVAILABLE/);
  assert.match(src,/data-lc-licensor=/);assert.match(src,/\/licensor`,\{method:'PUT'/);assert.match(src,/data-lc-act="addLicensor"/);
  assert.match(src,/data-lc-act="templates"/);assert.match(src,/'\/api\/license-cards\/stage-templates',\{method:'POST'/);
  assert.match(map,/window\.BLLicenseMapEditor=\{open,openTemplates,/);
  assert.match(map,/const lockedStage=s=>S\.mode==='map'&&Boolean\(templateOf\(s\)\)/,'a linked step is edited only through its template');
  assert.match(routes,/app\.put\('\/api\/license-cards\/:id\/licensor'/);assert.match(routes,/app\.post\('\/api\/license-cards\/stage-templates'/);
  assert.ok(routes.indexOf("'/api/license-cards/stage-templates'")<routes.indexOf("app.put('/api/license-cards/:id'"),'template routes precede the :id route');
});

test('an assigned licensor survives ASAS still reporting the license without one (no duplicate id)', () => {
  let ov=base();const blue=byLicense(ov,'BLUE HARBOR');
  ov=cards.setLicensor(ov,blue.id,{editToken:tokenOf(ov,blue.id),licensor:'Demo Rights'},NOW).overrides;
  const again=cards.appendDiscovered(ov,[{license:'BLUE HARBOR',licensor:''}],NOW);
  const ids=cards.stateOf(again.overrides).items.map(c=>c.id);
  assert.equal(new Set(ids).size,ids.length);assert.equal(again.added,0);
  assert.equal(byLicense(again.overrides,'BLUE HARBOR').licensor,'Demo Rights');
});

test('a linked stage always carries its template content, whatever the client sends', () => {
  let ov=base();const north=byLicense(ov,'NORTH STAR');
  ov=cards.saveTemplate(ov,{template:{id:'tpl-x',name:'X',stage:{title:'Template title',approver:'LCW',submissions:[]}}},NOW).overrides;
  const drifted=atlasWith(north,[{id:'s1',title:'Edited by hand',approver:'licensor',templateId:'tpl-x',submissions:[]},{id:'s2',title:'Gone',templateId:'tpl-missing',submissions:[]}]);
  const r=cards.updateCard(ov,north.id,{editToken:tokenOf(ov,north.id),profile:{processAtlas:drifted}},{});
  const stages=r.card.processAtlas.license.stages;
  assert.deepEqual([stages[0].title,stages[0].approver,stages[0].templateId],['Template title','LCW','tpl-x']);
  assert.equal(stages[1].title,'Gone');assert.equal(stages[1].templateId,undefined,'a link to a missing template is dropped');
});

test('templates created or deleted on two devices at once are merged, not overwritten', () => {
  const ov=base(),t1={id:'t1',name:'T1',stage:{title:'A',approver:'LCW',submissions:[]}},t2={id:'t2',name:'T2',stage:{title:'B',approver:'LCW',submissions:[]}};
  const a=cards.saveTemplate(ov,{template:t1},'2026-10-22T10:00:00.000Z').overrides;
  const b=cards.saveTemplate(ov,{template:t2},'2026-10-22T10:01:00.000Z').overrides;
  const merged=sync.applyRecords(a,{[sync.TEMPLATES_ID]:{templates:cards.templatesOf(b)}},{}).overrides;
  assert.deepEqual(cards.templatesOf(merged).items.map(t=>t.id).sort(),['t1','t2']);
  const removed=cards.deleteTemplate(b,'t2',{expectedUpdatedAt:'2026-10-22T10:01:00.000Z'},'2026-10-22T10:05:00.000Z').overrides;
  const after=sync.applyRecords(merged,{[sync.TEMPLATES_ID]:{templates:cards.templatesOf(removed)}},{}).overrides;
  assert.deepEqual(cards.templatesOf(after).items.map(t=>t.id),['t1'],'a deletion reaches the peer through its tombstone');
});

test('route timing and address accept manual labels that reach the supplier file', () => {
  const map=read('public/license-map-editor.js');
  assert.match(map,/<option value="__new__">\$\{esc\(T\('＋ Yeni etiket…','＋ New label…'\)\)\}/);
  assert.match(map,/<option value="__new__">\$\{esc\(T\('＋ Yeni adres…','＋ New address…'\)\)\}/);
  assert.match(map,/select\(p\+'\.timing','timing',r\.timing\|\|'approval',T\('Zaman','Timing'\),\{custom:true\}\)/);
  const atlas={version:1,license:{id:'c',name:'L',stages:[{id:'s',title:'S',approver:'LCW',submissions:[{id:'r',method:'physical',recipientType:'LCW',timing:'Kargo sonrası',addressId:'a1'}]}],addresses:[{id:'a1',label:'Somerbond UK',text:'Demo Street 1'}],portal:{url:'',notes:''}},sharedAddresses:[],visualLibrary:[],customSelectOptions:{timing:[{value:'Kargo sonrası',label:'Kargo sonrası'},{value:'Unused',label:'Unused'}]}};
  const normalized=A.normalize(atlas);assert.equal(normalized.customSelectOptions.timing.length,2);
  const html=S.buildHTML(S.project([{id:'c',license:'L',licensor:'X',processAtlas:normalized}]).licenses,{lang:'tr'});
  assert.ok(html.includes('Kargo sonrası')&&html.includes('Somerbond UK')&&html.includes('Demo Street 1'));
  assert.ok(!html.includes('Unused'),'unused custom labels stay private');
});
