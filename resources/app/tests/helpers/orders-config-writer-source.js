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
const isPacket=fs.existsSync(path.join(packetRoot,'base/app-main.js'));
const {extractFunction}=require(path.join(appRoot,'tests/helpers/app-main-functions.js'));
function read(file){try{return fs.readFileSync(file,'utf8');}catch(error){throw setupError('cannot read '+file+': '+error.code);}}
const sourcePaths={
 app:process.env.BL_RETIREMENT_APP_SOURCE||path.join(isPacket?packetRoot:appRoot,isPacket?'app-main.js':'public/app-main.js'),
};
const candidateApp=read(sourcePaths.app);
const behaviorBaseline=process.env.BL_CONFIG_BEHAVIOR_BASELINE==='1';
function readPinnedOriginal(kind){
 const env=kind==='app'?'BL_RETIREMENT_BASE_APP_SOURCE':'BL_RETIREMENT_BASE_IAM_SOURCE';
 const file=process.env[env]||(isPacket?path.join(packetRoot,kind==='app'?'base/app-main.js':'iam/base/user-access-ui.js'):null);
 if(!file&&kind!=='app')throw setupError('behavior baseline needs '+env);
 const text=file?read(file):require('../fixtures/orders-ui/historical-source.cjs').read('5829fcf4fa4ec9b7bfb1815bb43577943177dd38','public/app-main.js'),expected='d0885781d9b9a5e88135a1fd7a7c9c309603d4f4484191219079408ad1237810';
 const actual=crypto.createHash('sha256').update(text).digest('hex');if(actual!==expected)throw setupError(kind+' original source pin mismatch: '+actual);
 return text;
}
const existingAppNames=['modelConnLoad','modelConnSave','refreshPricingRulesFromServer','persistPricingRules'];
function exactSwap(candidate,original,names){
 let result=candidate;
 for(const name of names){
  const oldBody=extractFunction(original,name),newBody=extractFunction(result,name),at=result.indexOf(newBody);
  if(at<0||result.indexOf(newBody,at+newBody.length)!==-1)throw setupError('non-unique exact function '+name);
  result=result.slice(0,at)+oldBody+result.slice(at+newBody.length);
  if(extractFunction(result,name)!==oldBody)throw setupError('original function substitution failed: '+name);
 }
 return result;
}
const source=behaviorBaseline?exactSwap(candidateApp,readPinnedOriginal('app'),existingAppNames):candidateApp;
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
 // Getters expose actual lexical bindings for assertions/fixture setup; the
 // function under test still resolves the real declarations, not mock guards.
 vm.runInContext(lifecycle+'\n'+bindings.map(name=>`Object.defineProperty(globalThis,${JSON.stringify(name)},{configurable:true,get:()=>${name},set:value=>{${name}=value;}});`).join('\n'),context);
 Object.assign(context,initial);
}
module.exports={appRoot,source,candidateApp,sourcePaths,behaviorBaseline,extractFunction,installLifecycle,readPinnedOriginal};
