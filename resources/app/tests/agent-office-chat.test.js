'use strict';
/* Sade Agent Ofisi sohbeti: LCW AI yalnız yönlendirir (cevap / iş / soru) ve
   gerekirse diğer agentları konuşmaya katar. Yönlendirici kararı sahibin gerçek
   agent ve araç listesiyle sınırlanır; iş planlayıcı yalnız seçilen araçları
   görür; okuma adımları hemen ilerler, değiştiren adım onay bekler. LCW AI
   burada sahte bir motordur: şirket servisine bağlanılmaz. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'bl-office-lifecycle-'));
for(const key of ['BUYER_LOG_DATA_ROOT','BUYER_LOG_LOCAL_DATA_ROOT','BUYER_LOG_SERVER_DATA_ROOT','BUYER_LOG_AUTH_DATA_ROOT'])process.env[key]=root;
const db=require('../server/db');
const {createToolRegistry}=require('../server/lib/agent-tool-registry'),{createAgentOfficeStore}=require('../server/lib/agent-office-store'),{createAgentOfficeService}=require('../server/lib/agent-office-service');
const {createAgentRuntime}=require('../server/lib/agent-runtime'),runtimeStore=require('../server/lib/agent-workflow-store'),{createPolicyEngine}=require('../server/lib/agent-policy-engine');
const {createJobRegistry}=require('../server/lib/job-registry'),{createRouteRuns}=require('../server/lib/agent-native-route-runs'),ownership=require('../server/lib/plm-technical-sheet-ownership');
const {registerPlmAssetTools}=require('../server/lib/agent-plm-asset-tools'),{registerOrderTools,COLUMNS_TOOL_ID}=require('../server/lib/agent-order-tools');
test.after(()=>fs.rmSync(root,{recursive:true,force:true}));
let seq=0;
const settle=()=>new Promise(r=>setTimeout(r,25));
function world(t,engine){
  const profile={id:'chat-'+(++seq),enabled:true,areas:['cp','koleksiyon']};
  const access={profileById:id=>id===profile.id?profile:null,publicProfile:p=>({...p}),hasArea:(p,a)=>p.areas.includes(a),hasCapability:()=>true,appendAudit:()=>{}};
  const store=createAgentOfficeStore({root:path.join(root,profile.id,'office')}),runsRoot=path.join(root,profile.id,'native-runs');
  const files=path.join(root,profile.id,'files');fs.mkdirSync(files,{recursive:true});
  let index=[],release=()=>{};const connector={hold:false};
  const bom={_revision:1,models:{'100001':{plmId:'100001',styleId:'S-1',summary:'DEMO'},'100002':{plmId:'100002',styleId:'S-2',summary:'DEMO'}}};
  let service,jobs,runs,registry,downloads=0;
  // One "process": PLM job registry, route runs, tool registry and Office service.
  function boot(){
    jobs=createJobRegistry();runs=createRouteRuns({jobs,root:runsRoot});
    async function withPlmJob(req,meta,fn){const job=jobs.create(req.currentUser.id,meta);
      try{const result=await fn({id:job.id,report:p=>jobs.update(req.currentUser.id,job.id,p||{}),fail:f=>jobs.addFailure(req.currentUser.id,job.id,f||{}),cancelled:()=>jobs.isCancelled(req.currentUser.id,job.id)});jobs.finish(req.currentUser.id,job.id,{status:'succeeded'});return {job:jobs.describe(req.currentUser.id,job.id),result};}
      catch(err){jobs.finish(req.currentUser.id,job.id,{status:'failed',error:err.message});throw err;}}
    const plm=require('../server/routes/plm-sync-routes')({post:()=>{},get:()=>{}},{
      MODEL_FILES_ROOT:files,crypto,fs,express:{json:()=>(_q,_s,n)=>n()},userAccess:{requireArea:()=>(_q,_s,n)=>n(),requireAnyArea:()=>(_q,_s,n)=>n(),appendAudit:()=>{}},
      agentBrowserConnector:{downloadCoreNectumTechnicalSheets:async(_u,items)=>{downloads++;if(connector.hold)await new Promise(r=>{release=r;});
        return {requested:items.length,files:items.filter(i=>i.plmId==='100001').map(i=>({plmId:i.plmId,styleId:i.styleId,base64:Buffer.from('%PDF DEMO').toString('base64')})),failed:items.filter(i=>i.plmId!=='100001').map(i=>({plmId:i.plmId,code:'CORENECTUM_STYLE_NOT_FOUND'}))};}},
      automationError:(res,err)=>res.status(err.statusCode||500).json({code:err.code}),apiError:()=>{},clearModelOperationProgress:()=>{},setModelOperationProgress:()=>{},ensureModelFilesRoot:()=>{},
      loadPlmStyleLinks:()=>({links:{'100001':{styleId:'S-1'},'100002':{styleId:'S-2'}}}),modelStoredFileExists:item=>fs.existsSync(path.join(files,item.storedName)),
      normalizePlmId:v=>String(v||'').replace(/\D/g,''),plmJobs:jobs,publicModelFileMeta:item=>({id:item.id,plmId:item.plmId}),
      readModelFilesIndex:()=>JSON.parse(JSON.stringify(index)),writeModelFilesIndex:next=>{index=JSON.parse(JSON.stringify(next));},resolveStoredFile:(dir,name)=>path.join(dir,path.basename(name)),
      safeMailFilename:name=>String(name).replace(/[^\w.-]/g,'_'),technicalSheetOwnership:ownership,withPlmJob,getModelImageSettings:()=>({}),qtxStore:{},upsertPlmStyleLinks:()=>null});
    registry=createToolRegistry({userAccess:access,authorizeCapability:(c,a)=>service.taskAuthorize(c,a),authorizePendingCapability:(c,r)=>service.taskAuthorizePending(c,r)});
    const mutation=(ctx,work)=>store.withProfileMutation(ctx.ownerId,ctx.input.officeAgentId,ctx.input.officeAgentRevision,()=>{ctx.assertAuthority();return work();});
    registerPlmAssetTools(registry,{bomStore:{load:()=>bom},normalizePlmId:v=>String(v||'').replace(/\D/g,''),readModelFilesIndex:()=>index,fileExists:item=>fs.existsSync(path.join(files,item.storedName)),ownership,
      technicalSheets:plm.technicalSheets,routeRuns:runs,withAgentMutation:mutation});
    registerOrderTools(registry,{withAgentMutation:mutation,noteColumns:{snapshot:ids=>db.noteColumnSnapshot(ids),normalize:c=>db.normalizeNoteColumnDefs(c),replace:(_p,c,r)=>db.replaceNoteColumnDefs(c,r),restore:(_p,s,r)=>db.restoreNoteColumnDefs(s,r)}});
    const runtime=createAgentRuntime({store:runtimeStore,toolRegistry:registry,policyEngine:createPolicyEngine({userAccess:access})});
    service=createAgentOfficeService({store,userAccess:access,toolRegistry:registry,runtime,runtimeStore,engine,getOperationalData:async()=>({})});
    t.after(()=>service.stop());
  }
  boot();
  return {profile,store,connector,get service(){return service;},get downloads(){return downloads;},index:()=>index,release:()=>release(),
    restart(){service.stop();boot();}};
}

function fakeEngine(script){
  const calls=[];
  return {calls,ask:async(_owner,input)=>{calls.push(input);const reply=script[input.source];const data=typeof reply==='function'?reply(input):reply;
    return data?{structured:{ok:true},data,text:JSON.stringify(data)}:{structured:{ok:false},text:''};},askWithFiles:async()=>{throw new Error('unused');},cancel:()=>false};
}
async function team(w){
  const ada=await w.store.createProfile(w.profile.id,{name:'Ada',role:'Merchandiser',areas:['cp']});
  const beril=await w.store.createProfile(w.profile.id,{name:'Beril',role:'Collection',areas:['collection']});
  return {ada,beril};
}
const msgs=async(w,conv)=>(await w.store.messages(w.profile.id,conv.id,{limit:50})).messages;

test('a question that spans two areas becomes a team conversation with one shared reply',async t=>{
  let a;const engine=fakeEngine({'agent-chat-route':()=>({mode:'reply',agentIds:[a.ada.id,a.beril.id],lead:a.ada.id,note:'Beril\'i de dahil ediyorum, koleksiyon tarafı onda.'}),
    'agent-office':input=>({answer:'DEMO ortak cevap',perspectives:input.context.participants.map(p=>p.id+'|DEMO görüş'),confidence:'MEDIUM'})});
  const w=world(t,engine);a=await team(w);
  const result=await w.service.officeChat(w.profile,{text:'Koleksiyonda sipariş yerleşmemiş modeller ve CP riskleri neler?',agentId:a.ada.id});
  assert.deepEqual([...result.conversation.profileIds].sort(),[a.ada.id,a.beril.id].sort());
  const list=await msgs(w,result.conversation);
  const join=list.find(m=>m.role==='system'&&JSON.parse(m.text).type==='join');
  assert.deepEqual(JSON.parse(join.text).agentIds,[a.beril.id]);
  assert.ok(list.indexOf(join)>list.findIndex(m=>m.role==='user'),'the join note follows the owner\'s message');
  assert.equal(list.at(-1).text,'DEMO ortak cevap');
  assert.equal(list.at(-1).provenance.perspectives.length,2,'each agent speaks in the reply');
  const routeCall=engine.calls.find(c=>c.source==='agent-chat-route');
  assert.ok(routeCall.context.agents.every(agent=>Array.isArray(agent.toolIds)),'router sees each agent\'s tools');
  // The topic continues with both agents; a follow-up keeps the team.
  const next=await w.service.officeChat(w.profile,{text:'Peki öncelik ne olmalı?',conversationId:result.conversation.id});
  assert.equal(next.conversation.profileIds.length,2);
});

test('a read request is planned with only the routed tools and finishes without approval',async t=>{
  let a,plannerTools;const engine=fakeEngine({'agent-chat-route':()=>({mode:'task',agentIds:[a.ada.id],lead:a.ada.id,toolIds:['collection.plm.bom.read'],brief:'100001 ve 100002 BOM özetini oku'}),
    'agent-task':input=>{plannerTools=input.context.tools.map(tool=>tool.id);return {planJson:JSON.stringify({steps:[{id:'bom',toolId:'collection.plm.bom.read',args:{plmIds:['100001','100002']}}]})};}});
  const w=world(t,engine);a=await team(w);
  const result=await w.service.officeChat(w.profile,{text:'100001 ve 100002 için BOM bilgisine bak',agentId:a.ada.id});
  assert.deepEqual(plannerTools,['collection.plm.bom.read'],'planner sees only the routed tool');
  assert.equal(result.task.status,'completed');
  const card=(await msgs(w,result.conversation)).map(m=>m.role==='system'?JSON.parse(m.text):null).find(m=>m?.type==='task');
  assert.equal(card.taskId,result.task.id);
});

test('a change waits on the approval card and runs only with the previewed fingerprint',async t=>{
  let a;const engine=fakeEngine({'agent-chat-route':()=>({mode:'task',agentIds:[a.ada.id],lead:a.ada.id,toolIds:[COLUMNS_TOOL_ID],brief:'DEMO Sohbet not sütununu ekle'}),
    'agent-task':()=>({planJson:JSON.stringify({steps:[{id:'cols',toolId:COLUMNS_TOOL_ID,args:{columns:[...db.loadOverrides().noteColumnDefs.map(({id,label})=>({id,label})),{label:'DEMO Sohbet'}]}}]})})});
  const w=world(t,engine);a=await team(w);
  const before=db.loadOverrides().noteColumnDefs.length;
  const result=await w.service.officeChat(w.profile,{text:'Siparişlere DEMO Sohbet adında not sütunu ekle',agentId:a.ada.id});
  assert.equal(result.task.status,'waiting_approval');
  assert.equal(db.loadOverrides().noteColumnDefs.length,before,'nothing changes before approval');
  await assert.rejects(w.service.officeChatApprove(w.profile,result.task.id,{confirmed:true,fingerprint:'wrong'}),{code:'OFFICE_APPROVAL_REQUIRED'});
  const done=await w.service.officeChatApprove(w.profile,result.task.id,{confirmed:true,fingerprint:result.task.steps[0].preview.fingerprint});
  assert.equal(done.status,'completed');assert.equal(db.loadOverrides().noteColumnDefs.length,before+1);
});

test('invented agents or tools never reach the conversation or the planner; a missing identifier asks one question',async t=>{
  let a;const engine=fakeEngine({'agent-chat-route':input=>/sor/.test(input.task)?{mode:'clarify',agentIds:[a.ada.id],lead:a.ada.id,note:'Hangi sipariş kodu?'}:{mode:'task',agentIds:['ghost',a.ada.id],lead:'ghost',toolIds:['evil.tool']},
    'agent-office':{answer:'DEMO cevap',confidence:'LOW'}});
  const w=world(t,engine);a=await team(w);
  const result=await w.service.officeChat(w.profile,{text:'Her şeyi sil',agentId:a.ada.id});
  assert.deepEqual(result.conversation.profileIds,[a.ada.id]);
  assert.equal(engine.calls.some(c=>c.source==='agent-task'),false,'no plan without a valid tool');
  const asked=await w.service.officeChat(w.profile,{text:'Notu güncelle, sor bana',agentId:a.ada.id});
  assert.equal(asked.message.text,'Hangi sipariş kodu?');
});
