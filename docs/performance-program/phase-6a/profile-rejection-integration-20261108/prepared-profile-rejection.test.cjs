'use strict';
// PREPARED ONLY. Root later runs serially; every real switchTab call lives in
// its own child so baseline native unhandled events become bounded JSON proof.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const candidate=process.env.BL6A_PROFILE_REJECTION_DRAFT==='1',artifactRoot=process.env.BL6A_PROFILE_REJECTION_ARTIFACTS||path.join(__dirname,'artifacts');
let sequence=0;
function probe(scenario,moduleName,lang='en',mode=candidate,started=false){
 const args=[path.join(__dirname,'switch-tab-probe.cjs'),'--case',scenario,'--module',moduleName,'--lang',lang,...(started?['--started']:[])];
 const child=spawnSync(process.execPath,args,{encoding:'utf8',timeout:10000,maxBuffer:64*1024,env:{...process.env,BL6A_PROFILE_REJECTION_DRAFT:mode?'1':'0'}});
 fs.mkdirSync(artifactRoot,{recursive:true});const file=path.join(artifactRoot,[process.pid,++sequence,mode?'draft':'baseline',scenario,moduleName,lang,started?'late':'startup'].join('-')+'.json');
 const evidence={status:child.status,signal:child.signal,error:child.error?String(child.error):null,stdout:child.stdout,stderr:child.stderr};fs.writeFileSync(file,JSON.stringify(evidence,null,2)+'\n',{flag:'wx',mode:0o600});
 assert.equal(child.status,0,'fixture failed; inspect '+file+' '+child.stderr);const report=JSON.parse(child.stdout);assert.equal(report.status,'observed','whole-function fixture error: '+JSON.stringify(report.error));return report;
}
function noPartial(report){assert.equal(report.events.includes('apply-stored'),false);assert.equal(report.events.some(event=>typeof event==='string'&&event.startsWith('render:')),false);}
for(const moduleName of ['cp','orders','koleksiyon','shipping'])for(const lang of ['tr','en'])test(moduleName+' '+lang+' actual whole switchTab rejection: original startup rejects, no apply/render/unhandled, one localized message',()=>{
 const report=probe('reject',moduleName,lang);assert.equal(report.immediate.returnedType,'undefined');assert.equal(report.immediate.activeTab,moduleName);
 assert.equal(report.startupPromisePreserved,true);assert.equal(report.startupOutcome,'rejected');assert.equal(report.favoriteMarked,true,'existing favorite marker policy is not redesigned');
 noPartial(report);assert.deepEqual(report.unhandled,[],'native child unhandled-rejection evidence is preserved in artifacts');assert.equal(report.handledLate,0);
 const toasts=report.events.filter(event=>event&&typeof event==='object'&&'toast' in event);assert.equal(toasts.length,1,'one profile failure has multiple rejected observer branches, but one toast');
 assert.equal(toasts[0].toast,report.expectedLocalizedMessage);assert.equal(toasts[0].kind,'error');assert.match(toasts[0].toast,lang==='en'?/Orders/:/Sipariş/);
 assert.deepEqual(report.authChecks,[moduleName]);assert.deepEqual(report.permissions,{[moduleName]:true});
});
for(const moduleName of ['cp','orders','koleksiyon','shipping'])test(moduleName+' actual whole switchTab success keeps synchronous navigation and the existing awaited render',()=>{
 const report=probe('success',moduleName);assert.equal(report.immediate.returnedType,'undefined');assert.equal(report.immediate.activeTab,moduleName);
 assert.ok(report.immediate.events.includes('opened:'+moduleName));assert.equal(report.immediate.events.includes('apply-stored'),false);assert.equal(report.immediate.events.some(event=>typeof event==='string'&&event.startsWith('render:')),false);
 assert.equal(report.startupPromisePreserved,true);assert.equal(report.startupOutcome,'resolved');assert.equal(report.events.filter(event=>event==='apply-stored').length,1);assert.equal(report.events.filter(event=>event==='render:'+moduleName).length,1);
 assert.equal(report.events.some(event=>event&&typeof event==='object'&&'toast' in event),false);assert.deepEqual(report.unhandled,[]);
});
test('running Orders switch handles derived rejection while preserving an untouched null startup promise',()=>{
 const report=probe('reject','orders','en',candidate,true);assert.equal(report.startupPromisePreserved,false);assert.equal(report.startupOutcome,'none');noPartial(report);assert.deepEqual(report.unhandled,[]);
 assert.equal(report.events.filter(event=>event&&typeof event==='object'&&'toast' in event).length,1);
});
function comparable(report){const {candidate:_candidate,...rest}=report;return rest;}
test('actual repeated full Collection success remains synchronous and byte-for-behavior equal to baseline',()=>{
 const baseline=probe('repeat','koleksiyon','en',false),draft=probe('repeat','koleksiyon','en',true);
 assert.ok(draft.immediate.events.includes('render:koleksiyon'));assert.equal(draft.events.includes('profiles-start'),false);assert.deepEqual(comparable(draft),comparable(baseline));
});
test('actual non-data Automations branch and synchronous API behavior remain unchanged',()=>{
 const baseline=probe('automations','automations','en',false),draft=probe('automations','automations','en',true);
 assert.deepEqual(comparable(draft),comparable(baseline));assert.equal(draft.immediate.returnedType,'undefined');assert.equal(draft.events.includes('automation-init'),true);assert.equal(draft.events.includes('automation-import'),true);
 assert.equal(draft.events.includes('profiles-start'),false);assert.deepEqual(draft.authChecks,['automations']);assert.deepEqual(draft.permissions,{automations:true});
});
test('actual module permission denial stays effective; explicit CP-only permission never admits Orders',()=>{
 for(const mode of [false,true]){const report=probe('denied','orders','en',mode);assert.equal(report.immediate.returnedFalse,true);assert.equal(report.activeTab,'overview');assert.equal(report.events.includes('profiles-start'),false);
  assert.equal(report.events.some(event=>typeof event==='string'&&event.startsWith('desktop:')),false);assert.deepEqual(report.authChecks,['orders']);assert.deepEqual(report.permissions,{cp:true});assert.deepEqual(report.unhandled,[]);}
});
test('patch changes only switchTab; public sync getters/CP/clipboard source outside it are untouched',()=>{
 const pins=JSON.parse(fs.readFileSync(path.join(__dirname,'pins.json'),'utf8')),source=fs.readFileSync(path.join(pins.root,'public/app-main.js'),'utf8');
 const {extractFunction}=require(path.join(pins.root,'tests/helpers/app-main-functions.js')),before=extractFunction(source,'switchTab'),changed=require('./draft.cjs').patch(source),after=extractFunction(changed,'switchTab');
 assert.notEqual(after,before);assert.equal(changed.replace(after,'__SWITCH_TAB__'),source.replace(before,'__SWITCH_TAB__'));assert.match(after,/^function switchTab\(tab\)/);assert.doesNotMatch(after,/^async function/);
 assert.ok(after.includes('const profileReady=profileFirstVisit?applyProfilesForCurrentPage(true):Promise.resolve();'));assert.ok(after.includes('startupPageProfileReady=profileReady;'));
});
