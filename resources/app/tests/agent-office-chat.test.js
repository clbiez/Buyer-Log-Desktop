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
  // A follow-up continues the conversation: the earlier answer is passed in full, in order.
  const long='DEMO ortak cevap '+'x'.repeat(3000);engine.calls.length=0;
  const authority=w.service.memoryFingerprint(w.profile);
  await w.store.appendMessage(w.profile.id,result.conversation.id,{role:'assistant',text:'REVOKED PRICE ANSWER',profileIds:[a.ada.id],requestId:'r-old',authorizationFingerprint:'an-earlier-authority'});
  await w.store.appendMessage(w.profile.id,result.conversation.id,{role:'assistant',text:long,profileIds:[a.ada.id],requestId:'r-demo',authorizationFingerprint:authority,
    provenance:{emailDrafts:[{to:['supplier@example.com'],cc:['merch@example.com'],subject:'DEMO status',body:'Dear supplier'}]}});
  await w.service.officeChat(w.profile,{text:'Taslaklar nerede?',agentId:a.ada.id,conversationId:result.conversation.id});
  const follow=engine.calls.find(c=>c.source==='agent-office');
  assert.ok(follow.guide.startsWith('=== RECENT CONVERSATION ===\n--- owner ---\nKoleksiyonda'),'oldest first');
  assert.ok(follow.guide.includes(long),'the earlier answer is not cut to an excerpt');
  assert.ok(!follow.guide.includes('REVOKED PRICE ANSWER'),'an answer written under other permissions never goes back to LCW AI');
  assert.ok(follow.guide.includes('[draft 1]\nTo: supplier@example.com\nCc: merch@example.com\nSubject: DEMO status\nDear supplier'),'earlier drafts stay in the history so they can be edited');assert.ok(!follow.guide.includes('Taslaklar nerede?'),'the current message is the request, not history');
  assert.deepEqual(follow.context.recentConversation,[{messages:3}]);
  // The topic continues with both agents; a follow-up keeps the team.
  const next=await w.service.officeChat(w.profile,{text:'Peki öncelik ne olmalı?',conversationId:result.conversation.id});
  assert.equal(next.conversation.profileIds.length,2);
});

test('a read request is planned with only the routed tools and finishes without approval',async t=>{
  let a,plannerTools;const engine=fakeEngine({'agent-chat-route':()=>({mode:'task',agentIds:[a.ada.id],lead:a.ada.id,toolIds:['collection.plm.bom.read'],brief:'100001 ve 100002 BOM özetini oku'}),
    'agent-task':input=>{plannerTools=input.context.tools.map(tool=>tool.id);return {planJson:JSON.stringify({steps:[{id:'bom',toolId:'collection.plm.bom.read',args:{plmIds:['100001','100002']}}]})};},
    'agent-office':()=>({answer:'100001 için BOM özeti DEMO; 100002 bulunamadı.',confidence:'MEDIUM',emailDrafts:[JSON.stringify({to:['DEMO Supplier <supplier@example.com>'],cc:['[adres]'],subject:'BOM 100002',body:'Merhaba'})]})});
  const w=world(t,engine);a=await team(w);
  const result=await w.service.officeChat(w.profile,{text:'100001 ve 100002 için BOM bilgisine bak',agentId:a.ada.id});
  assert.deepEqual(plannerTools,['collection.plm.bom.read'],'planner sees only the routed tool');
  assert.equal(result.task.status,'completed');
  assert.equal(engine.calls.find(c=>c.source==='agent-chat-route').reasoningLevel,'Low','routing is a quick decision');
  const list=await msgs(w,result.conversation);
  const card=list.map(m=>m.role==='system'?JSON.parse(m.text):null).find(m=>m?.type==='task');
  assert.equal(card.taskId,result.task.id);
  // The lead writes the actual answer from the verified step results, after the card, without repeating the owner's message.
  const answer=engine.calls.find(c=>c.source==='agent-office');
  assert.equal(answer.task,'100001 ve 100002 için BOM bilgisine bak');
  assert.match(answer.guide,/=== 1\. collection\.plm\.bom\.read ===\n/);assert.match(answer.guide,/100001/);
  assert.deepEqual(answer.context.taskResults,[{taskId:result.task.id,lead:a.ada.id}]);
  assert.equal(list.filter(m=>m.role==='user').length,1,'the owner\'s message is not duplicated');
  assert.equal(list.at(-1).text,'100001 için BOM özeti DEMO; 100002 bulunamadı.');
  assert.deepEqual(list.at(-1).provenance.emailDrafts,[{to:['DEMO Supplier <supplier@example.com>'],cc:[],subject:'BOM 100002',body:'Merhaba',missingRecipient:false,droppedAddresses:1}],'drafts are saved with the answer, sanitized');assert.equal(result.message.id,list.at(-1).id);
  await w.service.officeChatAdvance(w.profile,result.task.id);
  assert.equal(engine.calls.filter(c=>c.source==='agent-office').length,1,'a task is answered once');
});

test('step results reach the answer without internal tokens and within the size limit',()=>{
  const {stepResultsText}=require('../server/lib/agent-office-chat');
  const text=stepResultsText({steps:[{toolId:'cp.records.read',status:'completed',result:{verified:true,rollbackToken:'SECRET-TOKEN',data:{rows:[{order:'7300001'}]}}},
    {toolId:'orders.records.read',status:'failed',result:{verified:true,data:{rows:[]}}},
    {toolId:'manufacturer.cards.read',status:'completed',result:{verified:true,data:{text:'x'.repeat(50000)}}}]});
  assert.doesNotMatch(text,/SECRET-TOKEN|rollbackToken/);
  assert.match(text,/=== 1\. cp\.records\.read ===\n\{"rows":\[\{"order":"7300001"\}\]\}/,'a single row stays JSON');
  const table=stepResultsText({steps:[{toolId:'cp.records.read',status:'completed',result:{verified:true,data:{revision:4,rows:[{order:'7300001',exf:'2026-10-12'},{order:'7300002',note:'a|b'}]}}}]});
  assert.equal(table,'=== 1. cp.records.read ===\n{"revision":4}\nrows:\nTABLE order | exf | note\n7300001 | 2026-10-12 | \n7300002 |  | a b','row lists become a compact table');
  assert.doesNotMatch(text,/orders\.records\.read/,'failed steps are not facts');
  assert.match(text,/=== 3\. manufacturer\.cards\.read \(truncated\) ===/);assert.ok(text.length<23000);
  assert.ok(text.includes('x'.repeat(21000)),'a single large result gets the budget the small ones leave');
});

test('the answer prompt carries the results and a human voice, and stays under the LCW AI prompt limit',()=>{
  const {buildPrompt}=require('../server/lib/lcwai/lcwai-prompt'),config=require('../server/lib/lcwai/lcwai-config');
  const out=buildPrompt({source:'agent-office',lang:'tr',task:'Bu haftanın siparişleri için e-posta taslakları',guide:'=== 1. cp.records.read ===\n'+'y'.repeat(24000),
    context:{taskResults:[{taskId:'t1',lead:'a1'}],findings:Array.from({length:40},(_,i)=>({id:'f'+i,text:'z'.repeat(1500)}))}});
  assert.match(out.prompt,/doğrulanmış sonuçlarını içerir/);assert.match(out.prompt,/iş arkadaşısın/);
  assert.equal(out.truncated,false);assert.ok(out.prompt.length<=config.LIMITS.maxPromptChars);
  assert.match(out.prompt,/=== KULLANICI İSTEĞİ ===/,'the request and answer format are never cut off');
  const huge=buildPrompt({source:'agent-office',lang:'tr',task:'Otomasyon kuralı ile geciken siparişler için tedarikçiye mail taslağı yaz '+'k'.repeat(3800),guide:'g'.repeat(40000),
    context:{findings:Array.from({length:40},(_,i)=>({id:'f'+i,text:'z'.repeat(1500)}))}});
  assert.equal(huge.truncated,true);assert.ok(huge.prompt.length<=config.LIMITS.maxPromptChars);
  assert.match(huge.prompt,/=== CEVAP BİÇİMİ[\s\S]*"emailDrafts"/,'an oversized prompt is cut in the middle; the answer format at the end survives');assert.match(huge.prompt,/…\[cut\]/);
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
  // The owner talks about something else before approving: the answer still belongs to the original request.
  await w.store.appendMessage(w.profile.id,result.conversation.id,{role:'user',text:'Arada başka bir soru',requestId:'r-other'});
  const done=await w.service.officeChatApprove(w.profile,result.task.id,{confirmed:true,fingerprint:result.task.steps[0].preview.fingerprint});
  assert.equal(done.status,'completed');assert.equal(db.loadOverrides().noteColumnDefs.length,before+1);
  const last=(await msgs(w,result.conversation)).at(-1);
  assert.ok(last.role==='system'&&/OFFICE_AI/.test(last.text),'after approval the lead tries to write the answer; a failed answer is noted, the change stays done');
  const answers=()=>engine.calls.filter(c=>c.source==='agent-office');
  assert.equal(answers().length,1);assert.equal(answers()[0].task,'Siparişlere DEMO Sohbet adında not sütunu ekle');
  assert.ok(!answers()[0].guide||!answers()[0].guide.includes('Arada başka bir soru'),'messages written after the request are not its history');
  const users=(await msgs(w,result.conversation)).filter(m=>m.role==='user').map(m=>m.text);
  assert.deepEqual(users,['Siparişlere DEMO Sohbet adında not sütunu ekle','Arada başka bir soru'],'the request is not appended again');
  await w.service.officeChatAdvance(w.profile,result.task.id);
  assert.equal(answers().length,1,'a failed answer is tried once, not on every poll');
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

test('when the conversation is full the agent doing the work opens its own conversation',async t=>{
  let a,extra;const engine=fakeEngine({'agent-chat-route':input=>input.context.currentParticipants.length<4?{mode:'reply',agentIds:[a.ada.id,a.beril.id,...extra.slice(0,2).map(x=>x.id)],lead:a.ada.id}:{mode:'reply',agentIds:[extra[2].id],lead:extra[2].id},
    'agent-office':{answer:'DEMO',confidence:'LOW'}});
  const w=world(t,engine);a=await team(w);
  extra=[];for(const name of ['Mert','Ahmet','Deniz'])extra.push(await w.store.createProfile(w.profile.id,{name,areas:['cp']}));
  const first=await w.service.officeChat(w.profile,{text:'DEMO ekip',agentId:a.ada.id});
  assert.equal(first.conversation.profileIds.length,4);
  const next=await w.service.officeChat(w.profile,{text:'DEMO Deniz işi',conversationId:first.conversation.id});
  assert.notEqual(next.conversation.id,first.conversation.id);
  assert.ok(next.conversation.profileIds.includes(extra[2].id),'the lead is a participant');
});

test('an agent described in plain words becomes a draft limited to the owner\'s areas; nothing is saved by the draft',async t=>{
  let a,seen;const engine=fakeEngine({'agent-profile-draft':input=>{seen=input.context;return {name:'Mert',role:'Test Uzmanı',areas:['cp','shipping','collection','ghost'],instructions:'Test raporlarını incele, siparişle eşleştir, CP\'ye işle.',summary:'Mert testleri takip eder.'};}});
  const w=world(t,engine);a=await team(w);
  const before=(await w.store.records(w.profile.id)).filter(d=>d.kind==='profile').length;
  const result=await w.service.officeAgentDraft(w.profile,{text:'Mert testlerle ilgilensin'});
  assert.deepEqual(result.draft.areas,['cp','collection'],'only areas the owner can access');
  assert.ok(seen.areas.every(area=>['cp','collection'].includes(area.key)),'LCW AI only sees allowed areas');
  assert.equal((await w.store.records(w.profile.id)).filter(d=>d.kind==='profile').length,before,'a draft saves nothing');
  const edit=await w.service.officeAgentDraft(w.profile,{text:'Haftalık özet de hazırlasın',agentId:a.ada.id});
  assert.equal(edit.agentId,a.ada.id);assert.equal(edit.revision,a.ada.revision);
  assert.equal(seen.current.name,'Ada','editing merges into the current profile');
  assert.ok(a.ada.areas.every(area=>edit.draft.areas.includes(area)),'training an agent never narrows its areas');
});

test('a memory the agent noticed is saved only when the owner keeps it, linked to its reply',async t=>{
  let a;const engine=fakeEngine({'agent-chat-route':()=>({mode:'reply',agentIds:[a.ada.id],lead:a.ada.id}),
    'agent-office':{answer:'Tamam, pazartesi hazırlarım.',memoryCandidates:['Haftalık kontrol pazartesi sabahı hazırlanır.'],confidence:'MEDIUM'}});
  const w=world(t,engine);a=await team(w);
  const result=await w.service.officeChat(w.profile,{text:'Bundan sonra haftalık kontrolü pazartesi sabahı hazırla',agentId:a.ada.id});
  assert.deepEqual(result.message.provenance.memoryCandidates,['Haftalık kontrol pazartesi sabahı hazırlanır.']);
  assert.equal((await w.store.records(w.profile.id)).filter(d=>d.kind==='memory'&&d.text.includes('pazartesi')).length,0,'not saved by itself');
  const saved=await w.service.learn(w.profile,a.ada.id,{text:'Haftalık kontrol pazartesi sabahı hazırlanır.',type:'preference',approved:true});
  assert.equal(saved.approved,true);assert.equal(saved.authorizationFingerprint||'','','an owner-kept preference does not expire with an access change');
});

test('attached reports are read and matched by the test engine, workbooks are stored; only ids and summaries reach LCW AI',async t=>{
  const {prepareAttachments}=require('../server/lib/agent-office-chat');
  const calls=[],profile={id:'owner-x'};
  const deps={qualityService:{parse:async(_p,files)=>{calls.push(['parse',files.map(f=>f.name)]);return {sessionId:'s'.repeat(32),files};},extractAi:async()=>{calls.push(['ai']);}},
    qualityTools:{inspect:async()=>({matches:[{talepNo:'T-1',outcome:{status:'fail'},level:'exact',candidates:[{orderKey:'k1',identity:{orderCode:'7300001'}}]}]})},
    artifacts:{put:async(_p,buffer,name)=>{calls.push(['put',name,buffer.length]);return {id:'a'.repeat(32)};}},canReadDocuments:async()=>true,canStoreWorkbooks:async()=>true,engine:{},staging:{dropSession:id=>calls.push(['drop',id])}};
  const files=[{name:'DEMO-rapor.pdf',base64:Buffer.from('%PDF').toString('base64')},{name:'DEMO-kur.xlsx',base64:Buffer.from('PK').toString('base64')}];
  const out=await prepareAttachments(profile,files,deps);
  assert.deepEqual(out.map(item=>item.kind),['test-documents','workbook']);
  assert.deepEqual(out[0].matches,[{talepNo:'T-1',outcome:'fail',level:'exact',orders:['7300001']}]);
  assert.equal(JSON.stringify(out).includes('%PDF'),false,'file content never goes to the summary');
  await assert.rejects(prepareAttachments(profile,[{name:'virus.exe',base64:'AA=='}],deps),{code:'OFFICE_ATTACHMENT_TYPE'});
  await assert.rejects(prepareAttachments(profile,[files[0]],{...deps,canReadDocuments:async()=>false}),{code:'OFFICE_ATTACHMENT_AGENT_REQUIRED'});
  await assert.rejects(prepareAttachments(profile,[files[1]],{...deps,canStoreWorkbooks:async()=>false}),{code:'OFFICE_TOOL_FORBIDDEN'},'workbooks need the same right as the Data Management upload');
  await assert.rejects(prepareAttachments(profile,[files[0]],{...deps,qualityTools:{inspect:async()=>{throw Object.assign(new Error('x'),{code:'TEST_REPORT_PREVIEW_CHANGED'});}}}),{code:'TEST_REPORT_PREVIEW_CHANGED'});
  assert.deepEqual(calls.at(-1),['drop','s'.repeat(32)],'a failed read drops the staged documents');
  calls.length=0;let stamp=1;
  await assert.rejects(prepareAttachments(profile,files,{...deps,assertAuthority:()=>{if(calls.some(c=>c[0]==='parse')&&stamp++)throw Object.assign(new Error('x'),{code:'OFFICE_PREVIEW_CHANGED'});}}),{code:'OFFICE_PREVIEW_CHANGED'});
  assert.equal(calls.some(c=>c[0]==='put'),false,'an access change stops before anything else is stored');
  calls.length=0;
  await prepareAttachments(profile,Array.from({length:6},(_,i)=>({name:'r'+i+'.pdf',base64:'JVBERg=='})),deps);
  assert.equal(calls.some(c=>c[0]==='ai'),false,'more than five documents are read locally only');
  // The router and the planner see the attachment ids.
  let a,routerSaw,plannerSaw;const engine=fakeEngine({'agent-chat-route':input=>{routerSaw=input.context.attachments;return {mode:'task',agentIds:[a.ada.id],lead:a.ada.id,toolIds:['collection.plm.bom.read'],brief:'DEMO'};},
    'agent-task':input=>{plannerSaw=input.context.attachments;return {planJson:JSON.stringify({steps:[]})};}});
  const w=world(t,engine);a=await team(w);
  const result=await w.service.officeChat(w.profile,{text:'',attachments:out,agentId:a.ada.id});
  assert.equal(routerSaw[1].artifactId,'a'.repeat(32));assert.equal(plannerSaw[0].sessionId,'s'.repeat(32));
  const user=(await msgs(w,result.conversation)).find(m=>m.role==='user');
  assert.match(user.text,/DEMO-rapor\.pdf, DEMO-kur\.xlsx/);
  assert.equal(result.task,null);
  assert.ok((await msgs(w,result.conversation)).some(m=>m.role==='system'&&JSON.parse(m.text).type==='task-empty'),'an empty plan asks the owner for details instead of failing');
});

test('a stakeholder document is matched before the reply: a card shows the verified rows and the agent gets them as evidence',async t=>{
  const {prepareAttachments}=require('../server/lib/agent-office-chat');
  const analysis={kind:'document-orders',docKind:'ex-factory-revision',request:'EXF 2 hafta ertelensin',summary:'DEMO',files:['DEMO.xlsx'],totals:{rows:1,matched:1,ambiguous:0,unmatched:0,high:1,medium:0,low:0,unknown:0},
    rows:[{line:1,match:'order-code',orderCode:'7300001',model:'DEMO KAZAK',colour:'C1',currentExFactory:'2026-11-20',requestedExFactory:'2026-12-05',latestSafeLoad:'2026-11-28',shiftDays:15,slackDays:-7,risk:'high'}],compact:'1|7300001|DEMO KAZAK|C1|2026-11-20→2026-12-05|+15d|safe 2026-11-28|high|order-code'};
  const calls=[];
  const out=await prepareAttachments({id:'o'},[{name:'DEMO.xlsx',base64:'UEs='},{name:'DEMO.csv',base64:Buffer.from('a,b').toString('base64')}],{analyzeDocuments:async list=>{calls.push(list.length);return analysis;},
    canStoreWorkbooks:async()=>false,canReadDocuments:async()=>false,artifacts:{put:async()=>{throw new Error('not allowed');}}});
  assert.deepEqual(out.map(i=>i.kind),['document-orders'],'without the upload right the workbook is analysed but not stored');assert.deepEqual(calls,[2]);
  let a,routerSaw,evidence;const engine=fakeEngine({'agent-chat-route':input=>{routerSaw=input.context.attachments[0];return {mode:'reply',agentIds:[a.ada.id],lead:a.ada.id};},
    'agent-office':input=>{evidence=input.context.evidenceAttachments;return {answer:'7300001 yüksek riskli.',confidence:'MEDIUM'};}});
  const w=world(t,engine);a=await team(w);
  const result=await w.service.officeChat(w.profile,{text:'Bu revizeye göre risk analizi yap',attachments:[...out,{kind:'workbook',artifactId:'b'.repeat(32),name:'DEMO.xlsx'}],agentId:a.ada.id});
  assert.equal(routerSaw.rows[0].risk,'high');assert.equal('compact' in routerSaw,false);
  assert.match(evidence[0].id,/^document-orders-1$/);assert.match(JSON.stringify(evidence[0].text),/safe 2026-11-28\|high/);
  const list=await msgs(w,result.conversation),card=list.map(m=>m.role==='system'?JSON.parse(m.text):null).find(m=>m?.type==='document-orders');
  assert.equal(card.rows[0].orderCode,'7300001');assert.ok(list.findIndex(m=>m.role==='system'&&JSON.parse(m.text).type==='document-orders')>list.findIndex(m=>m.role==='user'));
  assert.equal(result.message.text,'7300001 yüksek riskli.');
  assert.match(list.find(m=>m.role==='user').text,/Ekler: DEMO\.xlsx$/,'each file is named once');
});

test('a failed document analysis does not block the test report reader',async()=>{
  const {prepareAttachments}=require('../server/lib/agent-office-chat');const calls=[];
  const out=await prepareAttachments({id:'o'},[{name:'DEMO-test.pdf',base64:'JVBERg=='}],{analyzeDocuments:async()=>{throw Object.assign(new Error('x'),{code:'OFFICE_AI_CONTRACT_INVALID'});},
    canReadDocuments:async()=>true,qualityService:{parse:async()=>{calls.push('parse');return {sessionId:'s'.repeat(32)};},extractAi:async()=>{}},qualityTools:{inspect:async()=>({matches:[]})},engine:{},staging:{dropSession:()=>{}}});
  assert.deepEqual(out.map(i=>i.kind),['test-documents']);assert.deepEqual(calls,['parse']);
  await assert.rejects(prepareAttachments({id:'o'},[{name:'DEMO.csv',base64:'YSxi'}],{analyzeDocuments:async()=>{throw Object.assign(new Error('x'),{code:'OFFICE_AI_CONTRACT_INVALID'});}}),{code:'OFFICE_AI_CONTRACT_INVALID'},'with nothing else to show, the analysis error is reported');
});

test('the daily brief lists CP critical, today and this-week orders with reasons and unordered collection options, once a day',async t=>{
  const w=world(t,fakeEngine({}));await team(w);let scans=0;
  w.service.scan=async()=>{scans++;return {sourceUpdatedAt:'2026-10-15T06:00:00Z',changes:[{}, {}],
    orders:[{orderKey:'k1',identity:{orderCode:'7300001',colourCode:'C1'},analysis:{modelName:'DEMO KAZAK'},dimensions:{manufacturer:'DEMO TRIKO'}},{orderKey:'k2',identity:{orderCode:'7300002',modelName:'DEMO HIRKA',colourCode:'C2'}}],
    findings:[{code:'CP_PRIORITY',orderKey:'k2',severity:'ACTION_TODAY',title:{tr:'Bugün Aksiyon',en:'Action Today'},reasons:[{title:{tr:'Numune onayı yok',en:'No sample approval'}}]},
      {code:'CP_PRIORITY',orderKey:'k1',severity:'CRITICAL',title:{tr:'Kritik',en:'Critical'},reasons:[]},{code:'CP_PRIORITY',orderKey:'k3',severity:'ACTION_THIS_WEEK',title:{tr:'Bu Hafta Aksiyon',en:'Action This Week'}},
      {code:'CP_PRIORITY',orderKey:'k4',severity:'WATCH',title:{tr:'İzlemede',en:'Watch'}},{code:'QUANTITY_REVIEW',orderKey:'k1',severity:'MEDIUM'}],
    decisionSupport:{collectionPipeline:[{season:'6S27',status:'Fiyatlama',options:20,unlinked:12,missingSupplier:4},{season:'6W26',status:'Sipariş',options:5,unlinked:0,missingSupplier:0}]}};};
  const brief=await w.service.officeChatBrief(w.profile);
  assert.deepEqual(brief.counts,{critical:1,today:1,week:1,changes:2},'the CP engine vocabulary is counted, watch-only orders are not');
  assert.deepEqual(brief.top.map(item=>[item.severity,item.level,item.orderCode]),[['CRITICAL',4,'7300001'],['ACTION_TODAY',3,'7300002'],['ACTION_THIS_WEEK',2,'']],'most severe first');
  assert.deepEqual(brief.top[1].reasons,[{tr:'Numune onayı yok',en:'No sample approval'}]);
  assert.deepEqual([brief.top[0].model,brief.top[0].colour,brief.top[0].supplier],['DEMO KAZAK','C1','DEMO TRIKO'],'the model comes from the CP analysis, the supplier from the order');
  assert.deepEqual(brief.collection,[{season:'6S27',status:'Fiyatlama',options:20,unlinked:12,missingSupplier:4}]);
  await w.service.officeChatBrief(w.profile);assert.equal(scans,1,'computed once a day');
  await w.service.officeChatBrief(w.profile,{refresh:true});assert.equal(scans,2,'refresh recomputes');
  w.profile.areas=['koleksiyon'];await w.service.officeChatBrief(w.profile);assert.equal(scans,3,'a permission change recomputes the saved brief');
});

test('CP action priorities rank with the general severities',()=>{
  const {severityLevel,PRIORITY}=require('../server/lib/agent-office-intelligence');
  assert.deepEqual(['CRITICAL','ACTION_TODAY','HIGH','ACTION_THIS_WEEK','MEDIUM','WATCH','ON_TRACK','UNKNOWN'].map(severityLevel),[4,3,3,2,2,1,0,0]);
  assert.ok(PRIORITY.ACTION_TODAY>PRIORITY.HIGH&&PRIORITY.ACTION_THIS_WEEK>PRIORITY.MEDIUM&&PRIORITY.ACTION_THIS_WEEK<PRIORITY.HIGH,'findings sort today/this-week actions above watch items');
  const src=require('fs').readFileSync(require('path').join(__dirname,'..','server','lib','agent-office-service.js'),'utf8');
  assert.match(src,/result\.findings\.filter\(f=>severityLevel\(f\.severity\)>=/,'background assistant alerts use the shared level, so ACTION_TODAY orders alert');
});

test('pricing packages come from the verified suggestion result, not from LCW AI text',()=>{
  const {pricingPackages}=require('../server/lib/agent-office-chat');
  const job={steps:[{toolId:'pricing.suppliers.suggest',status:'completed',result:{verified:true,data:{currentSeason:'6S27',suppliers:[
    {name:'ALPHA',classifications:[{name:'KAZAK',index:-20,price:8,groupPrice:10,pricedModels:2}],models:[{rowId:'k1',plmId:'900001',model:'DEMO A',colourCode:'C1'},{plmId:'no-row'}],modelsTruncated:false},
    {name:'EMPTY',classifications:[],models:[]}]}}},{toolId:'collection.records',status:'completed',result:{verified:true,data:{rows:[]}}},
    {toolId:'pricing.suppliers.suggest',status:'failed',result:{data:{suppliers:[{name:'FAILED',models:[{rowId:'x'}]}]}}}]};
  assert.deepEqual(pricingPackages(job),[{supplier:'ALPHA',season:'6S27',classifications:[{name:'KAZAK',index:-20}],rowIds:['k1'],models:[{plmId:'900001',model:'DEMO A',colourCode:'C1'}],modelCount:1,truncated:false}]);
});

test('the pricing card refuses another owner\'s Collection page and matches rows by id and PLM ID',()=>{
  const src=require('fs').readFileSync(require('path').join(__dirname,'..','public','agent-office.js'),'utf8'),main=require('fs').readFileSync(require('path').join(__dirname,'..','public','app-main.js'),'utf8');
  assert.match(src,/if\(!root\.BLCollection\?\.isOwnWorkspace\?\.\(\)\)throw/);
  assert.match(src,/wanted\.has\(String\(row\.id\)\)&&\(!wanted\.get\(String\(row\.id\)\)\|\|plmOf\(row\)===wanted\.get\(String\(row\.id\)\)\)/);
  assert.match(main,/isOwnWorkspace\(\)\{ return kolWorkspaceMode==='single'&&kolIsOwnWorkspace\(\); \}/);
  assert.match(main,/mfrKey\(m\.name\)===mfrKey\(name\)/,'supplier preselect is Turkish-case and whitespace tolerant');
});
