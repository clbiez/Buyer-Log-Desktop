'use strict';
// #902 inceleme bulgusu (Codex, doğrulandı): LFL yüklemesi snapshot'ı aktif
// runtime'ın kopyası (`next`) ile kaydeder. saveRuntimeModelSnapshot yalnız
// aktif runtime için compute kaynağını yayımlar; descriptor sayılamaz olduğundan
// Object.assign ile de taşınmaz. Her yükleme yayımlanmamış bir replika bırakıyor
// (2 GiB bütçe) ve worker eski LFL neslini okumaya devam ediyordu.
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {extractFunction}=require('./helpers/app-main-functions'),source=require('./helpers/server-source')();
const order=(extra={})=>({'Order Code':'PO1',fob:10,...extra});

test('LFL upload adopts the saved runtime copy through the compute-aware helper after the save',async()=>{
 const routes=new Map(),runtime={loadedAt:'v1',lflLoadedAt:'v1',lflRows:[order()],sources:{lfl:'old.xlsx'}},calls=[];let saved;
 require('../server/routes/lfl-routes')({get(){},post:(url,...handlers)=>routes.set(url,handlers)},{
  sourceUserId:()=> 'buyer',cacheForUser:()=>runtime,initialDataLoadPromises:new Map(),ensureDataLoaded:async()=>{},
  runExcelTask:async()=>({rows:[order({fob:20})],meta:{}}),withFabricDimensions:meta=>meta,
  saveRuntimeModelSnapshot:async(_id,next)=>{calls.push('save');saved=next;},
  adoptSavedRuntime:async(id,target,next)=>{calls.push('adopt');assert.equal(id,'buyer');assert.equal(target,runtime);assert.equal(next,saved);Object.assign(target,next);return target;},
  userAccess:{requireArea:()=>()=>{},appendAudit(){},filterRowsByScope:(_user,rows)=>rows},
  attachModelImageIdentities:rows=>rows,modelImageIdentityOrders:()=>[],sendDateSafeJson:(res,data)=>res.json(data),apiError:(res,error)=>res.status(500).json({error:error.message}),
 });
 const res={code:200,status(code){this.code=code;return this;},json(data){this.data=data;}};
 await routes.get('/api/lfl/upload').at(-1)({body:{name:'new.xlsx',dataBase64:'AA=='},currentUser:{id:'buyer'}},res);
 assert.equal(res.code,200);assert.deepEqual(calls,['save','adopt']);assert.equal(runtime.lflRows[0].fob,20);
});

function helper(runtime,published){
 const context={cacheForUser:()=>runtime,serverCompute:()=>({publishSource:async descriptor=>{published.push(descriptor);return descriptor;}}),
  rememberComputeSource:(id,target,descriptor)=>published.push(['remember',id,target===runtime,descriptor.generation])};
 vm.createContext(context);vm.runInContext(extractFunction(source,'adoptSavedRuntime')+';globalThis.adopt=adoptSavedRuntime;',context);
 return context.adopt;
}

test('adopting a saved runtime copy publishes its prepared compute source on the active runtime',async()=>{
 const runtime={lflRows:[]},next={lflRows:[order()]},descriptor={ownerId:'buyer',generation:'g2'},published=[];
 Object.defineProperty(next,'_computeSourceDescriptor',{value:descriptor,enumerable:false,configurable:true});
 await helper(runtime,published)('buyer',runtime,next);
 assert.equal(runtime.lflRows,next.lflRows);
 assert.equal(runtime._computeSourceDescriptor,descriptor,'the active runtime carries the published descriptor');
 assert.equal(Object.keys(runtime).includes('_computeSourceDescriptor'),false,'the descriptor stays non-enumerable');
 assert.deepEqual(published,[descriptor,['remember','buyer',true,'g2']]);
});

test('a copy without a prepared compute source is applied without publishing',async()=>{
 const runtime={a:1},published=[];
 await helper(runtime,published)('buyer',runtime,{a:2});
 assert.equal(runtime.a,2);assert.deepEqual(published,[]);
});
