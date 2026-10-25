'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const A=require('../public/license-atlas-engine'),cards=require('../server/lib/license-cards'),{createLicenseCardService}=require('../server/lib/license-card-service');
const copy=v=>JSON.parse(JSON.stringify(v));
const atlas=()=>({license:{id:'reference',name:'Reference',color:'#123a78',color2:'#2450b8',manufacturerVisible:true,stages:[{id:'concept',title:'Concept',icon:'lightbulb',enabled:true,manufacturerVisible:true,note:'SECRET',supplierShowSourceNote:false,submissions:[{id:'route',method:'email',manufacturerVisible:true}]}],addresses:[],portal:{url:''}}});
function fixture(){
 let state=cards.appendDiscovered({_revision:4,_revisions:{pricingRules:9},pricingRules:[{id:'unrelated',royalty:12}]},[{license:'One',licensor:'Owner'},{license:'Two',licensor:'Owner'}]).overrides;
 let writes=0,commits=0,publications=[],notifications=[];
 const service=createLicenseCardService({loadOverrides:()=>state,saveOverrides:(next,expected,lease)=>{lease.assertAuthority();assert.equal(expected,state._revision);writes++;state=copy({...next,_revision:state._revision+1});return state;},mutate:(_,work)=>work({commit:async()=>{commits++;}}),publish:async(_,change)=>{publications.push(change);return {ok:true};},changed:async(_,entity)=>notifications.push(entity)});
 return {service,get state(){return state;},get writes(){return writes;},get commits(){return commits;},publications,notifications,entries:()=>cards.responseOf(state,true).cards.map(c=>({id:c.id,editToken:c.editToken,processAtlas:atlas()}))};
}
test('complete tree batches commit once, publish both profiles and retain every royalty rule',async()=>{
 const f=fixture(),before=copy(f.state),result=await f.service.updateAtlasBatch({id:'editor'},f.entries());
 assert.equal(f.writes,1);assert.equal(f.commits,1);assert.equal(result.updated,2);
 assert.equal(f.state._revisions.licenseCards,before._revisions.licenseCards+1);assert.equal(f.state._revisions.pricingRules,9);assert.deepEqual(f.state.pricingRules,before.pricingRules);
 assert.equal(f.publications[0].cards.length,2);assert.deepEqual(f.notifications,['licenseCards']);
 for(const c of f.state.licenseCards.items)assert.equal(c.processAtlas.license.color,'#123a78');
});
test('a conflict or invalid second tree prevents all writes, publications and notifications',async()=>{
 for(const failure of ['conflict','invalid']){
  const f=fixture(),before=copy(f.state),entries=f.entries();if(failure==='conflict')entries[1].editToken='stale';else entries[1].processAtlas.license.portal.url='javascript:alert(1)';
  await assert.rejects(f.service.updateAtlasBatch({id:'editor'},entries),{code:failure==='conflict'?'REVISION_CONFLICT':'LICENSE_ATLAS_INVALID'});
  assert.equal(f.writes,0);assert.equal(f.commits,0);assert.deepEqual(f.publications,[]);assert.deepEqual(f.notifications,[]);assert.deepEqual(f.state,before);
 }
});
test('bulk updates recheck authority and reject duplicate identities or missing scoped tokens',async()=>{
 const f=fixture(),entries=f.entries();
 await assert.rejects(f.service.updateAtlasBatch({id:'editor'},entries,{assertAuthority:()=>{throw Object.assign(new Error(),{code:'FORBIDDEN'});}}),{code:'FORBIDDEN'});
 await assert.rejects(f.service.updateAtlasBatch({id:'editor'},[entries[0],entries[0]]),{code:'LICENSE_ATLAS_INVALID'});
 delete entries[1].editToken;await assert.rejects(f.service.updateAtlasBatch({id:'editor'},entries),{code:'LICENSE_ATLAS_INVALID'});assert.equal(f.writes,0);
});
test('Process Studio metadata and source-note visibility survive normalization',()=>{
 const data=atlas();data.license.internalNotes='SECRET LICENSE NOTE';data.license.stages[0].internalNotes='SECRET STAGE NOTE';data.license.i18n={en:{internalNotes:'SECRET ENGLISH NOTE'}};data.license.workflowTemplate={id:'tpl',name:'Full tree',appliedAt:'2026-10-20'};
 data.processTemplates=[{id:'tpl',name:'Full tree',savedAt:'2026-10-20',stages:copy(data.license.stages),addresses:[]}];
 data.stageClipboard={sourceLicense:'Reference',stage:copy(data.license.stages[0]),addresses:[]};
 const normalized=A.normalize(data);assert.equal(normalized.license.internalNotes,'SECRET LICENSE NOTE');assert.equal(normalized.license.i18n.en.internalNotes,'SECRET ENGLISH NOTE');assert.equal(normalized.license.stages[0].internalNotes,'SECRET STAGE NOTE');assert.equal(normalized.processTemplates[0].stages[0].icon,'lightbulb');assert.equal(normalized.stageClipboard.stage.title,'Concept');assert.deepEqual(normalized.license.workflowTemplate,data.license.workflowTemplate);
 const projected=A.project({id:'bound',license:'Bound license',processAtlas:normalized});assert.equal(projected.id,'bound');assert.equal(projected.color,'#123a78');assert.equal(projected.stages[0].enabled,true);assert.equal(projected.stages[0].submissions[0].id,'route');assert.ok(!JSON.stringify(projected).includes('SECRET'));
 data.license.stages[0].supplierShowSourceNote=true;assert.equal(A.project({processAtlas:data}).stages[0].note,'SECRET');
 data.license.color='red;position:fixed';assert.throws(()=>A.normalize(data),{code:'LICENSE_ATLAS_INVALID'});
});
test('uploaded presentation and complete workflow code remain byte-for-byte intact',()=>{
 const html=fs.readFileSync(path.join(__dirname,'./fixtures/retired-ui/license-atlas/index.html'),'utf8');
 const digest=text=>crypto.createHash('sha256').update(text).digest('hex');
 const scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
 const styles=[...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map(m=>m[1]);
 assert.equal(digest(scripts.join('\n')),'9f2a6c2124468bd50fc22a08ebdfff06e039a3a3c83d71ce6213ed67ccfcdf2f');assert.equal(digest(styles.join('\n')),'688c6395bea4ca92fea5440aad8339a08ff4cb20a2cb44bd4175c295733e1784');
 assert.deepEqual(JSON.parse(html.match(/<script id="seed" type="application\/json">([\s\S]*?)<\/script>/)[1]).licenses,[]);
 const shell=fs.readFileSync(path.join(__dirname,'./fixtures/retired-ui/license-atlas-shell.js'),'utf8');assert.ok(!shell.includes('allow-same-origin'));assert.match(shell,/event.source!==frame.contentWindow/);
});
test('an explicit source-note opt-out overrides the legacy sharing flag',()=>{
 const a=atlas();a.license.stages[0].supplierShowNotes=true;a.license.stages[0].supplierShowSourceNote=false;
 assert.equal(A.project({processAtlas:a}).stages[0].note,'');delete a.license.stages[0].supplierShowSourceNote;assert.equal(A.project({processAtlas:a}).stages[0].note,'SECRET');
});
test('legacy independent asset and address libraries merge without identity collisions or loss on subsequent saves',()=>{
 const W=require('./fixtures/retired-ui/license-atlas-workspace');
 const make=(id,data,text)=>({id,license:id,processAtlas:{...atlas(),visualLibrary:[{id:'guide',name:'Visual',data}],sharedAddresses:[{id:'address',label:'Office',text,manufacturerVisible:true}],customSelectOptions:{recipientType:[{value:'custom',label:text,side:id==='One'?'left':'right'}]}}});
 const a=make('One','data:image/png;base64,AAAA','Office One'),b=make('Two','data:image/png;base64,BBBB','Office Two');
 for(const c of [a,b]){c.processAtlas.license.stages[0].visualGuideId='guide';c.processAtlas.license.stages[0].submissions[0].addressId='address';c.processAtlas.license.stages[0].submissions[0].recipientType='custom';}
 const db=W.merge([a,b]);assert.equal(db.visualLibrary.length,2);assert.equal(db.sharedAddresses.length,2);assert.equal(db.customSelectOptions.recipientType.length,2);
 for(const l of db.licenses){const st=l.stages[0],r=st.submissions[0];assert.equal(db.visualLibrary.find(v=>v.id===st.visualGuideId).data,l.id==='One'?a.processAtlas.visualLibrary[0].data:b.processAtlas.visualLibrary[0].data);assert.equal(db.sharedAddresses.find(v=>v.id===r.addressId).text,'Office '+l.id);assert.equal(db.customSelectOptions.recipientType.find(v=>v.value===r.recipientType).label,'Office '+l.id);}
 const persisted=db.licenses.map(l=>({id:l.id,license:l.name,processAtlas:A.normalize({license:l,visualLibrary:db.visualLibrary,sharedAddresses:db.sharedAddresses,customSelectOptions:db.customSelectOptions,processTemplates:db.processTemplates})}));
 const again=W.merge(persisted);assert.equal(again.visualLibrary.length,2);assert.equal(again.sharedAddresses.length,2);assert.deepEqual(again.licenses.map(l=>l.stages),db.licenses.map(l=>l.stages));
});
test('producer projection respects private local address precedence and excludes unused custom labels',()=>{
 const data=atlas();data.license.addresses=[{id:'same',label:'Private',text:'SECRET',manufacturerVisible:false}];data.sharedAddresses=[{id:'same',label:'Other',text:'Wrong public address',manufacturerVisible:true}];data.license.stages[0].submissions[0].addressId='same';data.customSelectOptions={method:[{value:'unused',label:'SECRET OPTION'}]};
 const out=A.project({processAtlas:data});assert.equal(out.stages[0].submissions[0].addressId,'');assert.deepEqual(out.addresses,[]);assert.ok(!JSON.stringify(out).includes('SECRET'));
});
test('independent large asset libraries keep their own card budget when one tree changes',()=>{
 const W=require('./fixtures/retired-ui/license-atlas-workspace');
 const originals=['One','Two','Three'].map((id,index)=>({id,license:id,processAtlas:{...atlas(),visualLibrary:[{id:'visual',name:id,data:'data:image/png;base64,'+String(index+1).repeat(700000)}]}}));
 for(const c of originals)c.processAtlas.license.stages[0].visualGuideId='visual';
 const db=W.merge(originals);assert.equal(db.visualLibrary.length,3);
 for(const l of db.licenses){const scoped=W.metadata(db,l,db,l.id);assert.equal(scoped.visualLibrary.length,1);const normalized=A.normalize({license:l,...scoped});assert.equal(normalized.visualLibrary[0].name,l.id);}
});
