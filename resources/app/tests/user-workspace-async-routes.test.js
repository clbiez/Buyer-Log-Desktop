'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),fsp=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),vm=require('node:vm');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'bl-workspace-routes-'));process.env.BUYER_LOG_SERVER_DATA_ROOT=root;
const prefs=require('../server/lib/user-preferences'),{withFileLeaseAsync}=require('../server/lib/shared-file-transaction');
test.after(()=>fs.rmSync(root,{recursive:true,force:true}));
const server=fs.readFileSync(path.join(__dirname,'../server/server.js'),'utf8'),admin=fs.readFileSync(path.join(__dirname,'../server/routes/horizon-routes.js'),'utf8');
const file=id=>path.join(root,'user-preferences',prefs.safeId(id)+'.json'),deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
function fixture(){
 const handlers=new Map(),state={profile:{id:'buyer',systemRole:'buyer'},target:{id:'target',displayName:'Synthetic target'},manage:true,audits:[]},app=Object.fromEntries(['get','put','post'].map(method=>[method,(url,...handlersForRoute)=>handlers.set(method+' '+url,handlersForRoute.at(-1))]));
 const userAccess={sessionProfile:()=>state.profile,roleWorkspaceEntriesAsync:async()=>({}),appendAudit:(...args)=>state.audits.push(args),profileById:()=>state.target,canManageTarget:()=>state.manage};
 const context={app,express:{json:()=>()=>{}},userPreferences:prefs,userAccess,apiError:(res,error)=>res.status(error.statusCode||500).json({code:error.code})};
 vm.runInNewContext(server.slice(server.indexOf('function assertPreferenceOwner('),server.indexOf("app.put('/api/user-preferences'")),context);
 vm.runInNewContext(server.slice(server.indexOf('const USER_WORKSPACE_MODULES'),server.indexOf('// ---- Ön Ayar Paylaşımı:')),context);
 vm.runInNewContext(admin.slice(admin.indexOf('function assertHorizonManager('),admin.lastIndexOf('\n};')),context);
 const response=()=>({statusCode:200,body:null,status(n){this.statusCode=n;return this;},set(){return this;},json(body){this.body=body;return this;}});
 return {state,run:async(method,url,body={},params={module:'cp'})=>{const req={currentUser:state.profile,body,params},res=response();await handlers.get(method+' '+url)(req,res);return res;}};
}
async function hold(target){const entered=deferred(),release=deferred(),done=withFileLeaseAsync(target,async()=>{entered.resolve();await release.promise;});await entered.promise;return {release:release.resolve,done};}

test('personal horizon HTTP waits for persistence and ignores a body owner override',async()=>{
 const f=fixture(),lock=await hold(file('buyer'));let completed=false;
 const pending=f.run('put','/api/user-workspace/:module/horizon',{userId:'foreign',horizon:{groups:['Synthetic']}}).finally(()=>{completed=true;});
 await new Promise(setImmediate);assert.equal(completed,false);lock.release();await lock.done;const result=await pending;
 assert.equal(result.statusCode,200);assert.deepEqual(result.body.savedHorizon.groups,['Synthetic']);assert.deepEqual(JSON.parse((await prefs.loadAsync('buyer')).entries[prefs.horizonKey('cp')].value).groups,['Synthetic']);await assert.rejects(fsp.access(file('foreign')),{code:'ENOENT'});
});
for(const [method,url,body]of [['put','/api/user-workspace/:module/horizon',{horizon:{groups:['Denied']}}],['post','/api/user-workspace/:module/reset',{categories:['horizon']}]])test('personal '+method+' rechecks the actual session after waiting',async()=>{
 const f=fixture();await prefs.saveHorizonAsync('buyer','cp',{groups:['Original']});const before=await fsp.readFile(file('buyer')),lock=await hold(file('buyer'));
 const pending=f.run(method,url,body);f.state.profile=null;lock.release();await lock.done;const result=await pending;
 assert.equal(result.statusCode,403);assert.equal(result.body.code,'USER_PREFS_FORBIDDEN');assert.deepEqual(await fsp.readFile(file('buyer')),before);assert.equal(f.state.audits.length,0);
});
for(const [method,url,body]of [['put','/api/iam/users/:id/horizon',{module:'cp',horizon:{groups:['Denied']}}],['post','/api/iam/users/:id/horizon/reset',{module:'cp'}]])test('manager '+method+' rechecks current manage-target authority after waiting',async()=>{
 const f=fixture();await prefs.saveHorizonAsync('target','cp',{groups:['Original']});const before=await fsp.readFile(file('target')),lock=await hold(file('target'));
 const pending=f.run(method,url,body,{id:'target'});f.state.manage=false;lock.release();await lock.done;const result=await pending;
 assert.equal(result.statusCode,403);assert.equal(result.body.code,'USER_NOT_MANAGEABLE');assert.deepEqual(await fsp.readFile(file('target')),before);assert.equal(f.state.audits.length,0);
});

test('workspace GET uses one async snapshot and a current session profile',async()=>{
 const f=fixture();await prefs.saveHorizonAsync('buyer','cp',{groups:['Current']});const result=await f.run('get','/api/user-workspace/:module');
 assert.equal(result.statusCode,200);assert.equal(result.body.userId,'buyer');assert.deepEqual(result.body.savedHorizon.groups,['Current']);assert.deepEqual(result.body.horizon.groups,['Current']);
});
