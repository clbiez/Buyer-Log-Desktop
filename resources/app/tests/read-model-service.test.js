'use strict';
/* WS1 (#1073): okuma modeli motoru, yetki süzmesi, nesil geçersizleşmesi ve
   POST /api/read-model/:module/query sözleşmesi. */
const test=require('node:test'),assert=require('node:assert/strict');
const zlib=require('node:zlib'),crypto=require('node:crypto');
const express=require('express');
const tasks=require('../server/lib/compute-tasks'),access=require('../server/lib/compute-access');
const engine=require('../server/lib/read-model/query-engine');
const worker=require('../server/lib/read-model/read-model-worker');
const {createReadModelService}=require('../server/lib/read-model/read-model-service');
const registerRoutes=require('../server/routes/read-model-routes');

function source(){
  const rows=Array.from({length:40},(_,i)=>({ocode:7000+i,model:'Model '+i,ccode:'R'+(i%3),colour:'Red',buyer:i%2?'Buyer A':'Buyer B',merch:'M',ageGroup:'A',buyerGrup:'G',
    license:['Disney','Marvel'][i%2],manufacturer:'Demo',season:['S6','W6','S7'][i%3],countryRaw:'TURKIYE',qty:100+i,kalan:10+i,fob:5+i,ex:new Date(2026,i%12,3),retail:new Date(2026,6,1),mb:new Date(2026,8,1)}));
  return {loadedAt:'r1',asasOrders:rows,asasOrdersByTarget:{cp:rows,orders:rows},antrepoMap:{},lflRows:[]};
}
function accessContext(src,{all=false,id='a'}={}){
  return access.createAccessContext({userId:id,systemRole:all?'moderator':'buyer',manageAll:all,viewScope:{all,mode:all?'ALL':'CUSTOM',buyers:['Buyer A']},
    editScopes:{buyers:['Buyer A']},authority:Object.fromEntries(src.asasOrders.map(row=>[row.ocode,[row]])),profiles:[]});
}
// Sunucunun bugünkü kullanıcıya özel projeksiyon yolu: scopedOrders → filterRows.
function projectionFor(user,module='cp'){
  const src=source(),rows=tasks.buildProjections(src,{modules:[module],overrides:{},horizons:{},access:accessContext(src,{all:user.all,id:user.id})})[module].rows;
  const buffer=zlib.gzipSync(Buffer.from(tasks.serialize({rows},'projection')));
  return {rows,buffer,checksum:crypto.createHash('sha256').update(buffer).digest('hex')};
}
const users={
  moderator:{id:'moderator',all:true,areas:['cp','orders','overview'],status:'ACTIVE',enabled:true},
  buyerA:{id:'buyerA',all:false,areas:['cp','orders'],status:'ACTIVE',enabled:true},
  viewer:{id:'viewer',all:false,areas:['overview'],status:'ACTIVE',enabled:true},
};
let harnessId=0;
function harness({generation=`g${++harnessId}-${process.pid}`}={}){
  const state={generation,stale:0,loads:0,revoked:new Set()};
  const guard={capture(req,area){
    const profile=req.currentUser;
    if(!profile||profile.status!=='ACTIVE')throw Object.assign(Error('Oturumunuz artık geçerli değil. / Your session is no longer valid.'),{code:'SESSION_REQUIRED',statusCode:401});
    if(!profile.areas.includes(area))throw Object.assign(Error('Bu alana erişim yetkiniz yok. / You do not have access to this area.'),{code:'AREA_FORBIDDEN',statusCode:403,errorEn:'You do not have access to this area.'});
    const key=JSON.stringify({userId:profile.id,accessHash:profile.all?'all':'scoped'});
    const check=()=>{if(state.revoked.has(profile.id))throw Object.assign(Error('Veri veya yetki sürümü değişti. / The data or permission generation changed.'),{code:'COMPUTE_STALE_GENERATION',statusCode:409});};
    return {profile,key,assertBuild:check,assertResponse:check};
  }};
  const loadProjection=async(req,module)=>{
    state.loads++;
    if(state.stale>0){state.stale--;throw Object.assign(Error('stale'),{code:'COMPUTE_STALE_GENERATION',statusCode:409});}
    const projection=projectionFor(req.currentUser,module);
    return {value:{buffer:projection.buffer,uncompressedBytes:projection.buffer.length*10},manifest:{activeGeneration:state.generation,modules:{[module]:{checksum:projection.checksum}}},
      assertResponse(){},release(){}};
  };
  const computeCalls=[];
  const runCompute=async(task,payload)=>{computeCalls.push({hasBuffer:Boolean(payload.buffer)});return {value:worker.execute(task,{...payload}),release(){}};};
  const service=createReadModelService({guard,loadProjection,runCompute});
  return {state,service,computeCalls,guard,loadProjection,runCompute};
}
const req=user=>({currentUser:user});
const parse=out=>JSON.parse(out.body);

test('engine filters, sorts, windows and aggregates while keeping edit flags',()=>{
  const {rows}=projectionFor(users.moderator);
  const dataset=engine.prepareDataset(JSON.parse(tasks.serialize({rows},'projection')));
  const result=JSON.parse(engine.serializeResult(engine.executeQuery(dataset,{version:1,filters:[{key:'Season',op:'in',values:['S6','S7']}],
    sort:{key:'Order Quantity',dir:-1},offset:2,limit:3,fields:['Order Code','Order Quantity','Ex-factory'],
    aggregates:{sums:['Order Quantity'],groupBy:[{key:'Buyer',sums:['Order Quantity']}]}})));
  const matching=rows.filter(row=>['S6','S7'].includes(row.Season)).sort((a,b)=>b['Order Quantity']-a['Order Quantity']);
  assert.equal(result.total,matching.length);
  assert.deepEqual(result.rows.map(row=>row['Order Code']),matching.slice(2,5).map(row=>row['Order Code']));
  assert.deepEqual(Object.keys(result.rows[0]).sort(),['Ex-factory','Order Code','Order Quantity','_canEdit','_rowIndex'].sort());
  assert.match(result.rows[0]['Ex-factory'],/^\d{4}-\d{2}-\d{2}$/);
  assert.equal(result.aggregates.sums['Order Quantity'],matching.reduce((sum,row)=>sum+row['Order Quantity'],0));
  assert.equal(result.aggregates.groups[0].groups.reduce((sum,group)=>sum+group.count,0),matching.length);
  assert.ok(result.rows.every(row=>row._canEdit===true));
});

test('invalid queries and unsupported client-only filters are rejected with 400 codes',()=>{
  const bad=[null,[],{},{version:2},{version:1,extra:true},{version:1,limit:1001},{version:1,offset:-1},{version:1,filters:[{key:'X',op:'like'}]},
    {version:1,filters:[{key:'__proto__',op:'blank'}]},{version:1,filters:[{key:'X',op:'in',values:[{}]}]},{version:1,sort:{key:'X',dir:2}},
    {version:1,filters:[{key:'X',op:'display-in',values:[],granularity:'decade'}]},{version:1,aggregates:{groupBy:[{key:'X',limit:0}]}},
    {version:1,filters:[{key:'X',op:'numeric',rule:{op:'regex'}}]},{version:1,search:{text:5}}];
  for(const query of bad)assert.throws(()=>engine.validateQuery(query),error=>error.code==='READ_MODEL_QUERY_INVALID'&&error.statusCode===400,JSON.stringify(query));
  const unsupported=[{version:1,filters:[{key:'Priority',op:'in',values:['A']}]},{version:1,sort:{key:'Priority',dir:1}},
    {version:1,columns:[{k:'STATUS',type:'status'}],filters:[{key:'STATUS',op:'display-in',values:['x']}]},
    {version:1,columns:[{k:'F',type:'formula'}],filters:[{key:'F',op:'display-in',values:['x']}]},
    // Formül/görsel/kişisel not değerleri projeksiyonda yoktur: her op ve sıralamada reddedilir.
    ...['range','numeric','eq','in','blank','not-blank'].flatMap(op=>[{key:'__f_fc_a'},{key:'F'}].map(({key})=>({version:1,columns:[{k:'F',type:'formula'}],
      filters:[{key,op,...(op==='numeric'?{rule:{op:'gt',a:1}}:op==='eq'?{value:'1'}:op==='in'?{values:['1']}:{})}]}))),
    {version:1,columns:[{k:'N',type:'text',personalNote:true}],filters:[{key:'N',op:'blank'}]},
    {version:1,sort:{key:'__f_fc_a',dir:1}},{version:1,sort:{key:'__picture',dir:1}}];
  for(const query of unsupported)assert.throws(()=>engine.validateQuery(query),error=>error.code==='READ_MODEL_FILTER_UNSUPPORTED'&&error.statusCode===400,JSON.stringify(query));
});

test('authorization: rows outside the user scope never reach the window or the aggregates',async()=>{
  const {service}=harness();
  const query={version:1,limit:1000,fields:['Buyer','Order Quantity'],aggregates:{sums:['Order Quantity'],groupBy:[{key:'Buyer'}]}};
  const scoped=parse(await service.query(req(users.buyerA),'cp',query)),full=parse(await service.query(req(users.moderator),'cp',query));
  const allRows=projectionFor(users.moderator).rows,visible=allRows.filter(row=>row.Buyer==='Buyer A');
  assert.ok(visible.length>0&&visible.length<allRows.length);
  assert.equal(full.total,allRows.length);
  assert.equal(scoped.total,visible.length);
  assert.ok(scoped.rows.every(row=>row.Buyer==='Buyer A'));
  assert.equal(scoped.aggregates.count,visible.length);
  assert.equal(scoped.aggregates.sums['Order Quantity'],visible.reduce((sum,row)=>sum+row['Order Quantity'],0));
  assert.deepEqual(scoped.aggregates.groups[0].groups.map(group=>group.value),['Buyer A']);
  // Kapsam dışı satıra yönelik açık filtre de boş döner: sızıntı yok.
  const probe=parse(await service.query(req(users.buyerA),'cp',{version:1,filters:[{key:'Buyer',op:'eq',value:'Buyer B'}],aggregates:{sums:['Order Quantity']}}));
  assert.equal(probe.total,0);assert.equal(probe.aggregates.sums['Order Quantity'],0);
  // _canEdit, kullanıcının düzenleme kapsamından gelir ve korunur.
  assert.ok(scoped.rows.every(row=>row._canEdit===true));
});

test('authorization: forbidden area is 403 before query validation; cache never crosses users',async()=>{
  const {service,computeCalls}=harness();
  await assert.rejects(service.query(req(users.viewer),'cp',{version:99}),error=>error.statusCode===403&&error.code==='AREA_FORBIDDEN');
  await assert.rejects(service.query(req(users.viewer),'nope',{version:1}),error=>error.statusCode===404);
  const query={version:1,aggregates:{sums:['Order Quantity']}};
  const a=await service.query(req(users.moderator),'cp',query);
  const b=await service.query(req(users.buyerA),'cp',query);
  assert.equal(a.cached,false);assert.equal(b.cached,false);
  assert.notEqual(parse(a).total,parse(b).total);
  const again=await service.query(req(users.buyerA),'cp',query);
  assert.equal(again.cached,true);assert.equal(again.body,b.body);
  assert.equal(computeCalls.length,4,'each user loads its own dataset once');
});

test('authority change during the read is refused (409) instead of answering with the old scope',async()=>{
  const {service,state}=harness();
  const realQuery=service.query;
  state.revoked.add('buyerA');
  await assert.rejects(realQuery(req(users.buyerA),'cp',{version:1}),error=>error.code==='COMPUTE_STALE_GENERATION');
});

test('generation change invalidates cached results and reloads the dataset',async()=>{
  const {service,state,computeCalls}=harness();
  const query={version:1,limit:5};
  const first=await service.query(req(users.moderator),'cp',query);
  assert.equal((await service.query(req(users.moderator),'cp',query)).cached,true);
  assert.equal(service.stats().entries,1);
  state.generation+='-next';
  const next=await service.query(req(users.moderator),'cp',query);
  assert.equal(next.cached,false);assert.notEqual(next.generation,first.generation);
  assert.equal(service.stats().entries,1,'older generation of the same scope is evicted');
  assert.deepEqual(computeCalls.map(call=>call.hasBuffer),[false,true,false,true]);
  // Aynı nesilde ikinci farklı sorgu: veri kümesi işçide hazır, buffer gönderilmez.
  await service.query(req(users.moderator),'cp',{version:1,limit:6});
  assert.deepEqual(computeCalls.slice(4).map(call=>call.hasBuffer),[false]);
});

async function withServer(deps,fn){
  const app=express();
  app.use((request,_res,next)=>{request.currentUser=users[request.headers['x-test-user']]||null;next();});
  const service=registerRoutes(app,deps);
  // server.js sırası: rota global 100 MB JSON ayrıştırıcısından ÖNCE kaydolur.
  app.use(express.json({limit:'100mb'}));
  const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
  const base=`http://127.0.0.1:${server.address().port}`;
  const post=(module,body,user='moderator',raw)=>fetch(`${base}/api/read-model/${module}/query`,{method:'POST',headers:{'content-type':'application/json','x-test-user':user},body:raw??JSON.stringify(body)});
  try{await fn(post,service);}finally{await new Promise(resolve=>server.close(resolve));}
}
function routeDeps(h){
  return {userAccess:{prepareComputeAccessContext:async()=>{},sessionProfile:request=>request.currentUser,hasArea:(profile,area)=>profile.areas.includes(area)},
    apiError:(res,err,message)=>res.status(err?.statusCode||500).json({error:message,code:err?.code||'INTERNAL_ERROR'}),
    getComputeReadGuard:()=>h.guard,ensureComputedProjection:h.loadProjection,runReadModelCompute:h.runCompute};
}

test('HTTP contract: 200 shape, 400 invalid, 403 forbidden, 404 unknown, 401 no session',async()=>{
  const h=harness();
  await withServer(routeDeps(h),async post=>{
    const ok=await post('cp',{version:1,limit:2,fields:['Order Code'],aggregates:{sums:['Order Quantity']}});
    assert.equal(ok.status,200);assert.equal(ok.headers.get('cache-control'),'no-store');
    const body=await ok.json();
    assert.equal(body.ok,true);assert.equal(body.version,1);assert.equal(body.module,'cp');assert.match(body.generation,/^g\d+-\d+:[a-f0-9]{16}$/);
    assert.equal(body.result.rows.length,2);assert.equal(body.result.limit,2);assert.ok(body.result.total>2);assert.equal(typeof body.timing.queryMs,'number');
    const invalid=await post('cp',{version:1,limit:5000});
    assert.equal(invalid.status,400);const invalidBody=await invalid.json();
    assert.equal(invalidBody.code,'READ_MODEL_QUERY_INVALID');assert.ok(invalidBody.error&&invalidBody.errorEn);
    assert.equal((await post('cp',null,'moderator','{nope')).status,400);
    const unsupported=await post('cp',{version:1,filters:[{key:'Priority',op:'in',values:['x']}]});
    assert.equal(unsupported.status,400);assert.equal((await unsupported.json()).code,'READ_MODEL_FILTER_UNSUPPORTED');
    const forbidden=await post('cp',{version:99},'viewer');
    assert.equal(forbidden.status,403);assert.equal((await forbidden.json()).code,'AREA_FORBIDDEN');
    assert.equal((await post('cp',null,'viewer','{nope')).status,403,'403 precedes body parsing');
    const oversized=await post('cp',null,'moderator',JSON.stringify({version:1,filters:[{key:'Buyer',op:'in',values:['x'.repeat(3*1024*1024)]}]}));
    assert.equal(oversized.status,413);assert.equal((await oversized.json()).code,'READ_MODEL_BODY_TOO_LARGE');
    assert.equal((await post('backlog',{version:1})).status,404);
    assert.equal((await post('cp',{version:1},'nobody')).status,401);
  });
});

test('HTTP contract: stale generation is retried, then surfaces as 409',async()=>{
  const h=harness();
  await withServer(routeDeps(h),async post=>{
    h.state.stale=2;
    assert.equal((await post('cp',{version:1,limit:1})).status,200);
    h.state.stale=5;
    const stale=await post('cp',{version:1,limit:1});
    assert.equal(stale.status,409);assert.equal((await stale.json()).code,'COMPUTE_STALE_GENERATION');
  });
});

test('route module and service expose the same module → area map',()=>{
  assert.deepEqual(registerRoutes.AREAS,require('../server/lib/read-model/read-model-service').AREAS);
});

test('server.js registers the read model route before the global 100 MB JSON parser',()=>{
  const source=require('node:fs').readFileSync(require('node:path').join(__dirname,'..','server','server.js'),'utf8');
  const route=source.indexOf("require('./routes/read-model-routes')(app,"),parser=source.indexOf("app.use(express.json({ limit: '100mb' }));");
  assert.ok(route>0&&parser>0&&route<parser,'route must be registered before the global JSON parser');
});
