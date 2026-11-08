'use strict';
// Test-only source adapter. No app/runtime changes or source rewrites.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),vm=require('node:vm');
function setupError(message){return Object.assign(new Error('RETIREMENT_TEST_SETUP: '+message),{code:'RETIREMENT_TEST_SETUP'});}
function validAppRoot(dir){return fs.existsSync(path.join(dir,'tests/helpers/app-main-functions.js'))&&fs.existsSync(path.join(dir,'public/app-main.js'));}
function findAppRoot(){
 if(process.env.BL_RETIREMENT_APP_ROOT){const dir=path.resolve(process.env.BL_RETIREMENT_APP_ROOT);if(!validAppRoot(dir))throw setupError('invalid BL_RETIREMENT_APP_ROOT');return dir;}
 for(const start of [__dirname,process.cwd()]){
  let dir=path.resolve(start);
  for(;;){for(const candidate of [dir,path.join(dir,'resources/app')])if(validAppRoot(candidate))return candidate;const parent=path.dirname(dir);if(parent===dir)break;dir=parent;}
 }
 throw setupError('run from the repository/app directory or set BL_RETIREMENT_APP_ROOT; no repository is inferred from a /tmp name');
}
const appRoot=findAppRoot(),packetRoot=path.resolve(__dirname,'../..');
const isPacket=fs.existsSync(path.join(packetRoot,'base/app-main.js'))&&fs.existsSync(path.join(packetRoot,'iam/base/user-access-ui.js'));
const {extractFunction}=require(path.join(appRoot,'tests/helpers/app-main-functions.js'));
function read(file){try{return fs.readFileSync(file,'utf8');}catch(error){throw setupError('cannot read '+file+': '+error.code);}}
const sourcePaths={
 app:process.env.BL_RETIREMENT_APP_SOURCE||path.join(isPacket?packetRoot:appRoot,isPacket?'app-main.js':'public/app-main.js'),
 iam:process.env.BL_RETIREMENT_IAM_SOURCE||path.join(isPacket?packetRoot:appRoot,isPacket?'iam/user-access-ui.js':'public/user-access-ui.js'),
};
const candidateApp=read(sourcePaths.app),candidateIam=read(sourcePaths.iam);
const behaviorBaseline=process.env.BL_RETIREMENT_BEHAVIOR_BASELINE==='1';
function readPinnedOriginal(kind){
 const env=kind==='app'?'BL_RETIREMENT_BASE_APP_SOURCE':'BL_RETIREMENT_BASE_IAM_SOURCE';
 const file=process.env[env]||(isPacket?path.join(packetRoot,kind==='app'?'base/app-main.js':'iam/base/user-access-ui.js'):null);
 if(!file)throw setupError('behavior baseline needs '+env+' when tests are adopted outside this packet');
 const text=read(file),expected=kind==='app'?'ad985cfd3345de35a8c105539d430fa11f1bbd329cedcd3b3896efdcc989a515':'4396e4586ab2726160f55cf386e83bef7391f8ba47e670b5df8869d68a4346a1';
 const actual=crypto.createHash('sha256').update(text).digest('hex');if(actual!==expected)throw setupError(kind+' original source pin mismatch: '+actual);
 return text;
}
const existingAppNames=['ensureOrdersLoaded','ensureOrdersFullForAction','loadFromServer','hydrateUserPreferencesAfterUi','fetchOrdersProjection'];
function extractIamFunction(text,name){
 const escaped=name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
 const found=new RegExp('^([ \t]*)(?=(?:async )?function '+escaped+'\\s*\\()','m').exec(text);
 if(!found)throw setupError('IAM function missing '+name);
 try{return extractFunction(text.slice(found.index+found[1].length),name);}catch(error){throw setupError('IAM extraction '+name+': '+error.message);}
}
function exactSwap(candidate,original,names,extract=extractFunction){
 let result=candidate;
 for(const name of names){
  const oldBody=extract(original,name),newBody=extract(result,name),at=result.indexOf(newBody);
  if(at<0||result.indexOf(newBody,at+newBody.length)!==-1)throw setupError('non-unique exact function '+name);
  result=result.slice(0,at)+oldBody+result.slice(at+newBody.length);
  if(extract(result,name)!==oldBody)throw setupError('original function substitution failed: '+name);
 }
 return result;
}
const source=behaviorBaseline?exactSwap(candidateApp,readPinnedOriginal('app'),existingAppNames):candidateApp;
const iamSource=behaviorBaseline?exactSwap(candidateIam,readPinnedOriginal('iam'),['checkIamSession'],extractIamFunction):candidateIam;
// Execute these exact candidate declarations in both modes; original function
// bodies can therefore fail behavior assertions, not missing-new-helper errors.
const start=candidateApp.indexOf('let ordersLoadPromise=null;'),end=candidateApp.indexOf('let cpLoadPromise=null;',start);
if(start<0||end<=start)throw setupError('candidate lifecycle declaration boundaries missing');
const lifecycle=candidateApp.slice(start,end);
for(const name of ['retireOrdersProjectionSource','ordersProjectionMustLoadFull','ensureOrdersFullBeforePreferences']){
 try{extractFunction(lifecycle,name);}catch(error){throw setupError('candidate helper missing '+name+': '+error.message);}
}
const bindings=['ordersLoadPromise','_ordersProjectionClient','_ordersAcceptedReceipt','_ordersUiSessionEpoch','_ordersProjectionSourceEpoch','_ordersFiniteLoadAbort','_ordersPromotionAbort','_ordersLoadFlight','_ordersPromotionSubscribers','_ordersGlobalUpdateDepth','_ordersRetiredFiniteView','_ordersColdFiniteClosed'];
function installLifecycle(context,initial={}){
 // Older extracted-function fixtures must load the actual new dependencies,
 // never permissive substitute guards. Explicit test doubles remain owned by
 // their existing fixture; otherwise use the real production declarations.
 if(!context.window)context.window={};
 if(!context.AbortController)context.AbortController=AbortController;
 if(!context._ordersFullViewControllers)context._ordersFullViewControllers=new WeakMap();
 if(!context.projectionRequestGeneration){
  const declared=candidateApp.match(/^const projectionRequestGeneration=(\{[^;\n]+\});$/m);
  if(!declared)throw setupError('actual projection request counters missing');
  context.projectionRequestGeneration=vm.runInContext('('+declared[1]+')',context);
 }
 for(const name of ['ordersProjectionIsThin','ordersFullActionError'])
  if(vm.runInContext('typeof '+name,context)==='undefined')vm.runInContext(extractFunction(candidateApp,name),context);
 // Getters expose actual lexical bindings for assertions/fixture setup; the
 // function under test still resolves the real declarations, not mock guards.
 vm.runInContext(lifecycle+'\n'+bindings.map(name=>`Object.defineProperty(globalThis,${JSON.stringify(name)},{configurable:true,get:()=>${name},set:value=>{${name}=value;}});`).join('\n'),context);
 Object.assign(context,initial);
}
module.exports={appRoot,source,iamSource,candidateApp,candidateIam,sourcePaths,behaviorBaseline,extractFunction,extractIamFunction,installLifecycle};
