'use strict';
// ISOLATED TEST CHILD ONLY. Never loaded by Buyer Log; preparer has not run it.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict'),vm=require('node:vm');
const pins=JSON.parse(fs.readFileSync(path.join(__dirname,'pins.json'),'utf8'));
function read(name){const value=fs.readFileSync(path.join(pins.root,name),'utf8');assert.equal(crypto.createHash('sha256').update(value).digest('hex'),pins.files[name],name+' drift');return value;}
const raw=read('public/app-main.js');read('tests/helpers/app-main-functions.js');
const {extractFunction}=require(path.join(pins.root,'tests/helpers/app-main-functions.js'));
const source=process.env.BL6A_PROFILE_REJECTION_DRAFT==='1'?require('./draft.cjs').patch(raw):raw;
function arg(name){const at=process.argv.indexOf(name);assert.ok(at>=0);return process.argv[at+1];}
const scenario=arg('--case'),moduleName=arg('--module'),lang=arg('--lang');
const alreadyStarted=process.argv.includes('--started');
assert.ok(['reject','success','repeat','automations','denied'].includes(scenario));assert.ok(['cp','orders','koleksiyon','shipping','automations'].includes(moduleName));assert.ok(['tr','en'].includes(lang));
const events=[],unhandled=[],handledLate=[];
// Only this disposable child observes native unhandledRejection for JSON proof.
// It does not alter the production function/source or install production hooks.
process.on('unhandledRejection',(reason,promise)=>{unhandled.push({message:String(reason?.message||reason),code:reason?.code||null});});
process.on('rejectionHandled',()=>handledLate.push(true));
function classes(initial=[]){const values=new Set(initial);return {values,add:value=>values.add(value),remove:value=>values.delete(value),toggle:(value,on)=>on?values.add(value):values.delete(value)};}
function node(tab){return {dataset:{tab},classList:classes(tab==='overview'?['active']:[]),style:{},attributes:{},setAttribute(key,value){this.attributes[key]=value;},removeAttribute(key){delete this.attributes[key];}};}
const names=['overview','cp','orders','koleksiyon','shipping','automations'],buttons=new Map(names.map(name=>[name,node(name)])),views=new Map(names.map(name=>['view-'+name,node(name)])),bar=node('vf');
const document={body:{dataset:{activeTab:'overview'}},getElementById:id=>views.get(id)||null,
 querySelector:selector=>selector==='nav.tabs button.active'?buttons.get(document.body.dataset.activeTab):selector==='.vfBar'?bar:null,
 querySelectorAll:selector=>selector==='nav.tabs button[data-tab]'?[...buttons.values()]:selector==='main section'?[...views.values()]:[]};
const permissions=new Map((scenario==='denied'?['cp']:[moduleName]).map(area=>[area,true])),authChecks=[];
const assertArea=area=>{if(permissions.get(area)!==true)throw Error('SYNTHETIC_AUTH_DENIED:'+area);};
let profileResolve,profileReject;
const originalProfilePromise=new Promise((resolve,reject)=>{profileResolve=resolve;profileReject=reject;});
const firstVisit=scenario!=='repeat',favoritePages=new Set(firstVisit?[]:[moduleName]);
const state={cp:scenario==='repeat'?{rows:[{_id:1,'Order Code':'synthetic-full'}]}:null,orders:scenario==='repeat'?{rows:[{_id:1,'Order Code':'synthetic-full'}]}:null,overviewDeferred:false};
const window={BL_USER_CONTEXT:{id:'synthetic-profile-fixture'},BLCanAccessArea:area=>{authChecks.push(area);return permissions.get(area)===true;},
 buyerLogDesktop:{workspace:{setModule:tab=>events.push('desktop:'+tab)}},BLModulePreparation:{noteOpened:tab=>events.push('opened:'+tab)},
 BLPerf:{ensureFeature:feature=>{events.push('feature:'+feature);return Promise.resolve();},isFeatureLoaded:feature=>feature==='deferredUi'},
 BLExceptionInboxView:{sync:()=>events.push('inbox')},initAutomationStudio:()=>events.push('automation-init'),initAiAutomationImport:()=>events.push('automation-import')};
const render=(name,area)=>()=>{assertArea(area);events.push('render:'+name);};
const globals={window,document,state,appLang:lang,startupReadySignaled:alreadyStarted,startupPageProfileReady:null,startupViewResume:null,
 backgroundWarmupUnrendered:new Set(),_deferredTabRenders:new Set(),_favoritesAppliedPages:favoritePages,kolFabricRepaintPending:false,kolQuoteIndexCache:{},
 currentActiveTab:()=>document.body.dataset.activeTab,showToast:(message,options)=>events.push({toast:message,kind:options?.kind||null}),
 applyProfilesForCurrentPage:()=>{assertArea(moduleName);events.push('profiles-start');return originalProfilePromise;},
 applyStoredProfilesForCurrentPage:()=>{assertArea(moduleName);events.push('apply-stored');},
 ensureCpLoaded:options=>{assertArea('cp');events.push({load:'cp',options});state.cp={rows:[{_id:1,'Order Code':'synthetic-full'}]};return Promise.resolve(true);},
 ensureOrdersLoaded:options=>{assertArea('orders');events.push({load:'orders',options});state.orders={rows:[{_id:1,'Order Code':'synthetic-full'}]};return Promise.resolve(true);},
 ensureCollectionCatalogLoaded:options=>{assertArea('koleksiyon');events.push({load:'collection',options:options||null});return Promise.resolve(true);},
 ensureCollectionMasterCatalogLoaded:()=>{assertArea('koleksiyon');events.push('collection-master');return Promise.resolve(true);},
 renderCP:render('cp','cp'),renderOrders:render('orders','orders'),renderKol:render('koleksiyon','koleksiyon'),renderShipTable:render('shipping','shipping'),
 flushDeferredRenderForTab:tab=>events.push('flush:'+tab),syncTableToolbarActions:tab=>events.push('toolbar:'+tab),syncNavExcelButtonLabel:tab=>events.push('excel:'+tab),syncActivePageTitle:()=>events.push('title'),
 closeAllColumnPanels:()=>events.push('panels-close'),setTimeout};
globals.saveWorkspaceResume=()=>events.push('workspace-save');globals.workspaceResume=()=>({save:tab=>events.push('workspace-resume:'+tab)});
const context=vm.createContext(globals);
vm.runInContext(extractFunction(source,'ordersFullActionError')+'\n'+extractFunction(source,'switchTab')+'\nglobalThis.run=switchTab;',context);
const report={scenario,module:moduleName,lang,alreadyStarted,candidate:process.env.BL6A_PROFILE_REJECTION_DRAFT==='1',sourceSha256:pins.files['public/app-main.js'],status:'running'};
(async()=>{
 const returned=context.run(moduleName);report.immediate={returnedType:typeof returned,returnedFalse:returned===false,activeTab:document.body.dataset.activeTab,events:events.slice(),favoriteMarked:favoritePages.has(moduleName)};
 report.startupPromisePreserved=context.startupPageProfileReady===originalProfilePromise;
 let startupOutcome='none';
 // A synthetic startup owner observes the ORIGINAL promise, preserving its
 // reject contract while exposing all otherwise-unhandled derived observers.
 if(context.startupPageProfileReady)context.startupPageProfileReady.then(()=>{startupOutcome='resolved';},()=>{startupOutcome='rejected';});
 if(scenario==='reject')profileReject(Object.assign(Error(''),{code:'SYNTHETIC_PROFILE_REJECT'}));else profileResolve(true);
 await new Promise(resolve=>setImmediate(resolve));await new Promise(resolve=>setImmediate(resolve));await new Promise(resolve=>setTimeout(resolve,10));
 report.startupOutcome=startupOutcome;report.events=events;report.authChecks=authChecks;report.permissions=Object.fromEntries(permissions);
 report.activeTab=document.body.dataset.activeTab;report.favoriteMarked=favoritePages.has(moduleName);report.unhandled=unhandled;report.handledLate=handledLate.length;
 report.expectedLocalizedMessage=context.ordersFullActionError('ORDERS_FULL_STALE').message;report.status='observed';
})().catch(error=>{report.status='fixture-failed';report.error={message:error.message,stack:error.stack};process.exitCode=1;}).finally(()=>{process.stdout.write(JSON.stringify(report)+'\n');});
