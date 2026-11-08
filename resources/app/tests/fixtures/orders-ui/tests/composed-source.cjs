'use strict';
// Source preparation only. Root executes this adapter later under its lock.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),cp=require('node:child_process'),assert=require('node:assert/strict');
const APP=process.env.BUYER_LOG_ACTUAL_APP_ROOT||path.resolve(__dirname,'../../../..');
const ROOT=path.resolve(APP,'../..'),packet=path.resolve(__dirname,'..');
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const PINS=Object.freeze({legacy:'ad985cfd3345de35a8c105539d430fa11f1bbd329cedcd3b3896efdcc989a515',retirement:'54f6484b4582fbcff16fd033fa61a048da53f239664a61196d70c5345e462f99',correctedRetirement:'d0885781d9b9a5e88135a1fd7a7c9c309603d4f4484191219079408ad1237810',
 quick:'db4d1cd592d9c758a43451af780d90895d0337e8f2b4abe51930255fdad06f6d',bar:'779e7fa88778922315ca0b47c47bd74e7bc230069b161cbd18a070fd4b99e8e6',
 extractor:'278ae4c5bc56da6858e1cd3af2ece9c4f5cd507d4e9577bb6ee5ae2d0a427fb1',lifecycleHelper:'9808ba5f0828a127eb6d511e99e9c935a424a699920e726c313ff54a0604e566',
 uiHelper:'d2be71d483553a601604ac31f850de97aa1f572dde32ba9c2108bcaa2ec29b29',recipe:'752114cbe903916b1b2bc82bc98b7d78bcf219e24b135fa536ed8dad319999e4',seam:'6223cd7ea1c054f4134ab070bf66e619ed4bf507005cb4d0f6308893911fb221',
 iamLegacy:'4396e4586ab2726160f55cf386e83bef7391f8ba47e670b5df8869d68a4346a1',iamRetired:'9611525e3614d53c8002b4deba68ae3c8b8d5ffa7061e6474bf3d7409e57e994'});
function setup(ok,message){if(!ok)throw Object.assign(Error('ORDERS_UI_V3_SETUP: '+message),{code:'ORDERS_UI_V3_SETUP'});}
function read(file){
 const rel=path.relative(APP,file).replace(/\\/g,'/');
 if(['public/app-main.js','public/quick-filter-groups.js'].includes(rel))return require('../../orders-ready-integration/source.cjs').base(rel);
 return fs.readFileSync(file,'utf8');
}
function pinned(file,sha){const text=read(file);setup(hash(text)===sha,file+' pin');return text;}
function gitRead(ref,file){return require('../historical-source.cjs').read(ref,file);}
function original(file,sha){const actual=read(path.join(APP,file));if(hash(actual)===sha)return actual;const text=gitRead('0d127f58db13051d4714abf54fed3b6c000a7607',file);setup(hash(text)===sha,file+' original Git pin');return text;}
setup(process.env.BL_RETIREMENT_BEHAVIOR_BASELINE!=='1','UI RED must keep the real new retirement bodies; do not enable retirement legacy substitution');
const legacySource=original('public/app-main.js',PINS.legacy),quickSource=original('public/quick-filter-groups.js',PINS.quick),barSource=original('public/selection-action-bar.js',PINS.bar);
const retirementPath=process.env.BUYER_LOG_UI_RETIREMENT_SOURCE||null;
const retirementRef=process.env.BUYER_LOG_UI_RETIREMENT_REF||'5829fcf4fa4ec9b7bfb1815bb43577943177dd38';
const source=retirementPath?read(retirementPath):gitRead(retirementRef,'public/app-main.js');
setup(hash(source)===PINS.correctedRetirement,'origin remains exact d0885781 with the pending profile-target guard');
const preUiSource=require('../historical-source.cjs').configurationBase();
setup(hash(preUiSource)===PINS.retirement,'only the exact reviewed configuration delta may precede UI composition');
pinned(path.join(APP,'tests/helpers/app-main-functions.js'),PINS.extractor);
const {extractFunction}=require(path.join(APP,'tests/helpers/app-main-functions.js'));
const seam=pinned(path.join(packet,'snippets/app-ui-seam.js'),PINS.seam);
pinned(path.join(packet,'snippets/ui-patch-recipe.cjs'),PINS.recipe);
pinned(path.join(packet,'candidate/orders-ui-command.js'),PINS.uiHelper);
const recipe=require('../snippets/ui-patch-recipe.cjs');
const patched=recipe.app(preUiSource,extractFunction,seam),quickPatched=recipe.quick(quickSource),barPatched=recipe.selectionBar(barSource);
const baseline=process.env.BUYER_LOG_UI_USE_BASELINE==='1',product=process.env.BUYER_LOG_UI_USE_PRODUCT==='1';
setup(!(baseline&&product),'baseline and product modes are exclusive');
const actualApp=read(path.join(APP,'public/app-main.js'));
setup(actualApp===preUiSource||actualApp===patched,'actual app must equal the exact configured baseline or its exact UI composition');
for(const [file,before,after] of [['public/quick-filter-groups.js',quickSource,quickPatched],['public/selection-action-bar.js',barSource,barPatched]]){
 const actual=read(path.join(APP,file));setup(actual===before||actual===after,'unknown actual UI source drift '+file);if(product)setup(actual===after,'product must equal exact composition '+file);
}
if(product){setup(actualApp===patched,'actual product app must equal every byte of UI(retirement)');
 setup(read(path.join(APP,'public/orders-ui-command.js'))===read(path.join(packet,'candidate/orders-ui-command.js')),'actual UI helper bytes');}
const selectedSource=baseline?preUiSource:product?actualApp:patched;
// Reuse the actual current retirement adapter unchanged. It installs the actual
// lexical lifecycle declarations, including real abort/subscriber variables.
// In final adopted tests it reads the actual composed app; no app snapshot is
// needed. The frozen pre-UI retirement source can be loaded from a Git ref.
const frozenHelperPath=path.join(__dirname,'helpers/orders-retirement-source.js');pinned(frozenHelperPath,PINS.lifecycleHelper);
const actualHelperPath=path.join(APP,'tests/helpers/orders-retirement-source.js');pinned(actualHelperPath,PINS.lifecycleHelper);
const helperPath=product?actualHelperPath:frozenHelperPath;
const lifecycleStart=preUiSource.indexOf('let ordersLoadPromise=null;'),lifecycleEnd=preUiSource.indexOf('let cpLoadPromise=null;',lifecycleStart);
setup(lifecycleStart>=0&&lifecycleEnd>lifecycleStart,'retirement lifecycle bounds');
const lifecycle=preUiSource.slice(lifecycleStart,lifecycleEnd);
const helperAppPath=(actualApp===preUiSource||actualApp===patched)?path.join(APP,'public/app-main.js'):retirementPath;
setup(Boolean(helperAppPath),'use an explicit pinned retirement source path until retirement has been adopted');
const iamPath=path.join(APP,'public/user-access-ui.js'),iamSha=hash(read(iamPath));
setup(iamSha===PINS.iamLegacy||iamSha===PINS.iamRetired,'unknown actual IAM source drift');if(product)setup(iamSha===PINS.iamRetired,'adopt the separate exact IAM retirement patch before product UI evidence');
const overrides={BL_RETIREMENT_APP_ROOT:APP,BL_RETIREMENT_APP_SOURCE:helperAppPath,BL_RETIREMENT_IAM_SOURCE:iamPath,BL_RETIREMENT_BEHAVIOR_BASELINE:'0'},previous={};
let retirement;
try{for(const [key,value] of Object.entries(overrides)){previous[key]=process.env[key];process.env[key]=value;}retirement=require(helperPath);}
finally{for(const key of Object.keys(overrides)){if(previous[key]===undefined)delete process.env[key];else process.env[key]=previous[key];}}
const hs=retirement.candidateApp.indexOf('let ordersLoadPromise=null;'),he=retirement.candidateApp.indexOf('let cpLoadPromise=null;',hs);
setup(retirement.candidateApp.slice(hs,he)===lifecycle,'reused adapter must install exact frozen lifecycle declarations');
for(const name of ['ensureOrdersFullForAction','ensureOrdersLoaded','fetchOrdersProjection','loadFromServer','hydrateUserPreferencesAfterUi'])
 assert.equal(extractFunction(selectedSource,name),extractFunction(preUiSource,name),'UI composition preserves actual configured lifecycle body '+name);
const api=product?require(path.join(APP,'public/orders-ui-command.js')):require('../candidate/orders-ui-command.js');
module.exports={APP,ROOT,PINS,hash,source,preUiSource,legacySource,quickSource,barSource,patched,quickPatched,barPatched,selectedSource,baseline,product,seam,api,extractFunction,
 installLifecycle:retirement.installLifecycle,extractIamFunction:retirement.extractIamFunction,lifecycle,retirementPath,retirementRef,compositionReceipt:Object.freeze({retirementGitRef:retirementRef,retirementSha256:hash(source),preUiSourceSha256:hash(preUiSource),uiAppSha256:hash(patched),quickSha256:hash(quickPatched),barSha256:hash(barPatched),lifecycleSha256:hash(lifecycle)})};
