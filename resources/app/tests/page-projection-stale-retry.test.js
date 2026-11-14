'use strict';
// CP açıkken eşzamanlı kayıt/senkron yazımı veri sürümünü değiştirince hazır
// ekran okuması COMPUTE_STALE_GENERATION (409) ile düşüyordu; CP ekranı
// "CP hazırlanamadı / Hazır ekran önbelleği okunamadı" hatasına dönüyordu.
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const source=require('./helpers/server-source')();
function loadRoute(ensure){
  let handler,sent=null,apiFailure=null;
  const context={app:{get:(_route,...args)=>handler=args.at(-1)},userAccess:{hasArea:()=>true},
    PAGE_PROJECTION_AREAS:{cp:'cp'},PAGE_PROJECTION_TARGETS:{cp:['cp']},sourceFilterReadiness:()=>({ready:true}),
    PAGE_PROJECTION_STALE_ATTEMPTS:3,ensureComputedProjection:ensure,
    sendComputedResponse:(_req,_res,lease)=>{sent=lease;},apiError:(_res,error)=>{apiFailure=error;}};
  const start=source.indexOf("app.get('/api/page-projection/:module'");assert.ok(start>0);
  const end=source.indexOf('\n});',start)+4;vm.createContext(context);vm.runInContext(source.slice(start,end),context);
  const res={status:()=>res,json:()=>res,set:()=>res,headersSent:false};
  return {run:()=>handler({params:{module:'cp'},query:{}},res),result:()=>({sent,apiFailure})};
}
const stale=()=>Object.assign(Error('stale'),{code:'COMPUTE_STALE_GENERATION',statusCode:409});
test('page projection retries a read that raced with a data write',async()=>{
  let calls=0;const route=loadRoute(async()=>{calls++;if(calls<3)throw stale();return {value:{buffer:Buffer.from('x')},cacheState:'miss'};});
  await route.run();
  assert.equal(calls,3);assert.equal(route.result().apiFailure,null);assert.ok(route.result().sent);
});
test('page projection stale retries are bounded and other errors are not retried',async()=>{
  let calls=0;let route=loadRoute(async()=>{calls++;throw stale();});
  await route.run();assert.equal(calls,3);assert.equal(route.result().apiFailure.code,'COMPUTE_STALE_GENERATION');
  calls=0;route=loadRoute(async()=>{calls++;throw Object.assign(Error('io'),{code:'EIO'});});
  await route.run();assert.equal(calls,1);assert.equal(route.result().apiFailure.code,'EIO');
});
test('a failed background CP reload keeps the already loaded CP table visible',()=>{
  const main=fs.readFileSync(path.join(__dirname,'..','public','app-main.js'),'utf8');
  const start=main.indexOf('async function ensureCpLoaded(');const body=main.slice(start,main.indexOf('\n  return cpLoadPromise;',start));
  assert.match(body,/const keepVisible=Boolean\(state\.cp\)/);
  assert.match(body,/if\(currentActiveTab\(\)==='cp'&&!keepVisible\)renderCorePageLoadingState\('cp'\)/);
  assert.match(body,/if\(keepVisible&&state\.cp\)\{[^}]*setStatus\('cp','ready'\)/);
});
