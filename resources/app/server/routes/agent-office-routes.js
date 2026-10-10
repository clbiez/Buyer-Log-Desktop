'use strict';

const { error, text } = require('../lib/agent-office-store');
const { publicError, isLcwAiError } = require('../lib/lcwai/lcwai-errors');

module.exports = function registerAgentOfficeRoutes(app, deps) {
  const { express, service, userAccess } = deps, base = '/api/agent-office';
  const json = express.json({limit:'512kb'});
  app.use(base, (req,res,next) => {
    if (!req.currentUser?.id || req.currentUser.enabled === false) return res.status(401).json({ok:false,code:'USER_LOGIN_REQUIRED'});
    res.set('Cache-Control','no-store'); next();
  });
  function fail(res,err) {
    if(res.headersSent)return;
    if(isLcwAiError(err))return res.status(err.statusCode || 502).json({ok:false,...publicError(err)});
    const code=/^OFFICE_|^AI_AUTOMATION_/.test(err?.code || '')?err.code:'OFFICE_INTERNAL';
    return res.status(code==='OFFICE_INTERNAL'?500:(err.statusCode || 400)).json({ok:false,code,error:code});
  }
  const wrap = fn => async(req,res)=>{try{await fn(req,res);}catch(err){fail(res,err);}};
  const audit=(req,action,target,detail)=>userAccess.appendAudit(req.currentUser,action,target,detail);
  const stream = work => wrap(async(req,res)=>{
    const controller=new AbortController();
    res.on('close',()=>{if(!res.writableEnded)controller.abort();});
    res.type('application/x-ndjson');res.set('X-Accel-Buffering','no');res.flushHeaders?.();
    const send=event=>{if(!res.destroyed&&!res.writableEnded)res.write(JSON.stringify(event)+'\n');};
    try{const result=await work(req,controller.signal,event=>send({type:'progress',...event}));send({type:'result',result});}
    catch(err){send({type:'error',error:isLcwAiError(err)?publicError(err):{code:/^OFFICE_|^AI_AUTOMATION_/.test(err.code || '')?err.code:'OFFICE_AI_FAILED'}});}
    finally{if(!res.destroyed)res.end();}
  });
  app.get(base+'/notifications',wrap(async(req,res)=>res.json({ok:true,...await service.notifications(req.currentUser)})));
  app.get(base+'/state',wrap(async(req,res)=>res.json({ok:true,state:await service.state(req.currentUser)})));
  app.post(base+'/profiles',json,wrap(async(req,res)=>res.status(201).json({ok:true,profile:await service.createProfile(req.currentUser,req.body || {})})));
  app.put(base+'/profiles/:id',json,wrap(async(req,res)=>res.json({ok:true,profile:await service.updateProfile(req.currentUser,req.params.id,req.body || {})})));
  app.delete(base+'/profiles/:id',wrap(async(req,res)=>{
    const previous=await service.store.get(req.currentUser.id,'profile',req.params.id);
    await service.store.save(req.currentUser.id,'profile',{...previous,deleted:true},{expectedRevision:previous.revision});
    const state=await service.store.state(req.currentUser.id);
    for(const watcher of state.watches.filter(item=>item.profileId===previous.id))await service.store.save(req.currentUser.id,'watch',{...watcher,enabled:false});
    audit(req,'AGENT_PROFILE_ARCHIVE',previous.id,{transcriptsPreserved:true});res.json({ok:true});
  }));
  app.post(base+'/profiles/:id/memory',json,wrap(async(req,res)=>res.status(201).json({ok:true,memory:await service.learn(req.currentUser,req.params.id,req.body || {})})));
  app.put(base+'/memory/:id',json,wrap(async(req,res)=>{
    const memory=await service.store.editMemory(req.currentUser.id,req.params.id,req.body || {});
    audit(req,'AGENT_MEMORY_EDIT',memory.id,{revision:memory.revision,deleted:memory.deleted,active:memory.active});res.json({ok:true,memory});
  }));
  app.get(base+'/conversations/:id/messages',wrap(async(req,res)=>res.json({ok:true,...await service.store.messages(req.currentUser.id,req.params.id,{
    before:text(req.query.before,120),query:text(req.query.query,160),limit:req.query.limit})})));
  app.post(base+'/run',json,stream((req,signal,onProgress)=>service.run(req.currentUser,{...req.body,signal},onProgress)));
  app.post(base+'/cancel',json,wrap(async(req,res)=>res.json({ok:true,cancelled:service.engineOf().cancel(req.currentUser.id,text(req.body?.requestId,120))})));
  app.post(base+'/report',json,wrap(async(req,res)=>{const result=await service.scan(req.currentUser,req.body?.scope);const {snapshots,...report}=result;res.attachment('Buyer-Log-Operational-Review.json').json(report);}));
  app.post(base+'/scan',json,wrap(async(req,res)=>{
    const result=await service.scan(req.currentUser,req.body?.scope,{force:req.body?.force===true});
    const start=Math.max(0,Number(req.body?.offset)||0),limit=Math.max(1,Math.min(100,Number(req.body?.limit)||50));
    const {snapshots,orders,findings,...summary}=result;
    res.json({ok:true,analysis:{...summary,findings:findings.slice(start,start+limit),findingCount:findings.length,hasMore:start+limit<findings.length,orders:orders.slice(0,30)}});
  }));
  app.post(base+'/watches',json,wrap(async(req,res)=>res.status(201).json({ok:true,watch:await service.watch(req.currentUser,req.body || {})})));
  app.put(base+'/watches/:id',json,wrap(async(req,res)=>{
    const previous=await service.store.get(req.currentUser.id,'watch',req.params.id);
    const watch=await service.store.save(req.currentUser.id,'watch',{...previous,enabled:req.body?.enabled===true},{expectedRevision:previous.revision});
    audit(req,'AGENT_WATCH_UPDATE',watch.id,{enabled:watch.enabled});res.json({ok:true,watch});
  }));
  app.post(base+'/watches/check',wrap(async(req,res)=>{await service.checkWatches(req.currentUser);res.json({ok:true});}));
  app.post(base+'/alerts/:id/dismiss',wrap(async(req,res)=>{
    const previous=await service.store.get(req.currentUser.id,'alert',req.params.id);
    await service.store.save(req.currentUser.id,'alert',{...previous,dismissed:true});res.json({ok:true});
  }));
  app.put(base+'/layout',json,wrap(async(req,res)=>{
    const state=await service.store.state(req.currentUser.id),office=service.store.normalizeOffice(req.body || {});
    const saved=await service.store.save(req.currentUser.id,'office',{...office,id:'layout'},{expectedRevision:req.body?.revision ?? state.office.revision ?? 0});
    res.json({ok:true,office:saved});
  }));
  app.get(base+'/sync/keys',wrap(async(req,res)=>res.json({ok:true,keys:await service.sync.keysFor(userAccess.profileById(req.currentUser.id))})));
  app.post(base+'/sync/keys/trust',json,wrap(async(req,res)=>res.json(await service.sync.approveKey(userAccess.profileById(req.currentUser.id),req.body || {}))));
  app.post(base+'/sync',json,wrap(async(req,res)=>res.json({ok:true,sync:await service.syncNow(req.currentUser,Array.isArray(req.body?.owners)?req.body.owners:[])})));
  app.get(base+'/catalog',wrap(async(req,res)=>res.json({ok:true,catalog:await service.sync.catalog()})));
  app.post(base+'/profiles/:id/publish',json,wrap(async(req,res)=>res.json({ok:true,entry:await service.publish(req.currentUser,req.params.id,req.body?.confirmed)})));
  app.delete(base+'/profiles/:id/publish',wrap(async(req,res)=>{
    const profile=await service.store.get(req.currentUser.id,'profile',req.params.id);
    await service.sync.publishCatalog(req.currentUser,{ownerId:req.currentUser.id,profile:{id:profile.id},deleted:true});
    audit(req,'AGENT_CATALOG_UNPUBLISH',profile.id,{});res.json({ok:true});
  }));
  app.post(base+'/catalog/copy',json,wrap(async(req,res)=>res.status(201).json({ok:true,profile:await service.copyAgent(req.currentUser,text(req.body?.ownerId,160),text(req.body?.profileId,120),req.body?.mode)})));
  app.post(base+'/training/preview',json,wrap(async(req,res)=>res.json({ok:true,preview:await service.trainingPreview(req.currentUser,req.body || {})})));
  app.get(base+'/training/part',wrap(async(req,res)=>{
    const part=await service.archivePart(req.currentUser,{ownerId:req.query.ownerId,profileIds:req.query.profileId?[req.query.profileId]:[],index:req.query.index});
    res.type('text/markdown').attachment(part.name).send(part.buffer);
  }));
  app.post(base+'/training/review',json,stream((req,signal,onProgress)=>service.reviewArchive(req.currentUser,{...req.body,signal},onProgress)));
  app.get(base+'/moderation/owners',userAccess.requireModerator,wrap(async(req,res)=>res.json({ok:true,owners:await deps.listOwners(req.currentUser)})));
  app.get(base+'/moderation/:owner',userAccess.requireModerator,wrap(async(req,res)=>res.json({ok:true,state:await service.moderation(req.currentUser,req.params.owner)})));
  app.get(base+'/moderation/:owner/conversations/:id/messages',userAccess.requireModerator,wrap(async(req,res)=>{
    if(!userAccess.profileById(req.params.owner))throw error('OFFICE_OWNER_NOT_FOUND',404);
    const data=await service.store.messages(req.params.owner,req.params.id,{before:text(req.query.before,120),limit:req.query.limit});
    audit(req,'AGENT_TRAINING_MESSAGES_READ',req.params.owner,{conversationId:req.params.id,count:data.messages.length});res.json({ok:true,...data});
  }));
  app.post(base+'/moderation/merge/preview',userAccess.requireModerator,json,wrap(async(req,res)=>res.json({ok:true,preview:await service.mergePreview(req.currentUser,req.body?.selections)})));
  app.post(base+'/moderation/merge',userAccess.requireModerator,json,wrap(async(req,res)=>res.status(201).json({ok:true,profile:await service.merge(req.currentUser,req.body || {})})));
  app.post(base+'/jobs/:id/automation/preview',json,wrap(async(req,res)=>{
    if(!service.canAutomate(userAccess.profileById(req.currentUser.id)))throw error('OFFICE_AUTOMATION_FORBIDDEN',403);
    const job=await service.store.get(req.currentUser.id,'job',req.params.id);
    if(!job.proposedAutomation)throw error('OFFICE_AUTOMATION_NOT_FOUND',404);
    const preview=await deps.validateAutomation(req.currentUser,job.proposedAutomation.code);
    res.json({ok:true,preview,fingerprint:require('../lib/agent-office-store').hash(JSON.stringify(preview))});
  }));
  app.post(base+'/jobs/:id/automation/apply',json,wrap(async(req,res)=>{
    if(!service.canAutomate(userAccess.profileById(req.currentUser.id)) || req.body?.confirmed!==true)throw error('OFFICE_APPROVAL_REQUIRED',403);
    const job=await service.store.get(req.currentUser.id,'job',req.params.id);
    if(!job.proposedAutomation)throw error('OFFICE_AUTOMATION_NOT_FOUND',404);
    const preview=await deps.validateAutomation(req.currentUser,job.proposedAutomation.code);
    if(require('../lib/agent-office-store').hash(JSON.stringify(preview))!==req.body.fingerprint)throw error('OFFICE_PREVIEW_CHANGED',409);
    const result=await deps.applyAutomation(req.currentUser,job.proposedAutomation.code);
    audit(req,'AGENT_AUTOMATION_DRAFT_CREATE',job.id,{enabled:false});res.json({ok:true,result});
  }));
};
