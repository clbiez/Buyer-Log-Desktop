'use strict';

/* The Fabric Card library is a shared business resource, not Collection edit
 * permission. Every ACTIVE authenticated user may read and edit fabric cards;
 * all other module permission boundaries remain unchanged. */
module.exports=function registerFabricCardRoutes(app,deps){
  const {apiError,express,fabricCards,requestRevision,userAccess,onChanged,getPendingCount}=deps;
  function assertActive(req){
    const current=userAccess.sessionProfile?userAccess.sessionProfile(req):req.currentUser;
    if(!current || !req.currentUser || current.id!==req.currentUser.id || current.enabled===false || current.status==='DISABLED')
      throw Object.assign(new Error('Oturum geçerli değil. / Session is no longer valid.'),{code:'FABRIC_SESSION_INVALID',statusCode:403});
    return current;
  }
  function reportError(res,err,fallback){
    if(err && err.code==='FABRIC_CARD_CONFLICT'){
      return res.status(409).json({error:err.message,code:err.code,current:err.current||null});
    }
    return apiError(res,err,fallback);
  }
  async function publish(req){
    let syncState={pending:false};
    try {syncState=await fabricCards.flushOutbox?.()||syncState;}
    catch(error){syncState={pending:true,errorCode:error&&error.code||'FABRIC_SYNC_PENDING'};}
    try {const count=Number(await getPendingCount?.()||0);syncState={...syncState,pending:syncState.pending||count>0,queuedEvents:count};}
    catch(_){syncState={...syncState,pending:true};}
    onChanged?.(req);
    return syncState;
  }
  app.get('/api/fabric-cards',async(req,res)=>{
    try{
      assertActive(req);
      const stored=await fabricCards.loadFabricCardsAsync();
      assertActive(req);
      const result=fabricCards.publicCards(stored);const count=Number(await getPendingCount?.()||0);
      assertActive(req);
      res.set('Cache-Control','no-store').json({...result,sharingPending:count>0||result.pendingCodes.length>0});
    }catch(error){reportError(res,error,'Kumaş kartları okunamadı.');}
  });
  app.post('/api/fabric-cards',express.json({limit:'2mb'}),async(req,res)=>{
    try{
      assertActive(req);
      const items=req.body&&req.body.items;
      if(!Array.isArray(items)||items.length>200)return res.status(400).json({error:'items dizisi (en fazla 200) gerekli. / Expected an items array (max 200).',code:'VALIDATION_ERROR'});
      const stored=await fabricCards.upsertFabricCards(items,req.currentUser,requestRevision(req),{
        onlyMissing:Boolean(req.body.onlyMissing),assertAuthority:()=>assertActive(req)
      });
      assertActive(req);
      userAccess.appendAudit(req.currentUser,'FABRIC_CARD_UPSERT','fabric-cards',{count:stored.updated});
      const sync=stored.updated?await publish(req):{pending:false};
      const result=fabricCards.publicCards(await fabricCards.loadFabricCardsAsync());
      res.set('ETag','"'+result.revision+'"').json({ok:true,...result,updated:stored.updated,skipped:stored.skipped,sync});
    }catch(error){reportError(res,error,'Kumaş kartları kaydedilemedi.');}
  });
  app.post('/api/fabric-cards/:code/resolve',express.json({limit:'16kb'}),async(req,res)=>{
    try{
      assertActive(req);
      const input=req.body||{},choice=input.choice,expectedRemoteRevisionId=input.expectedRemoteRevisionId;
      if(!['mine','remote'].includes(choice)||typeof expectedRemoteRevisionId!=='string')
        return res.status(400).json({code:'VALIDATION_ERROR',error:'Conflict choice and remote revision required.'});
      const saved=await fabricCards.resolveFabricConflict(req.params.code,choice,expectedRemoteRevisionId,req.currentUser,{
        assertAuthority:()=>assertActive(req)
      });
      assertActive(req);
      userAccess.appendAudit(req.currentUser,'FABRIC_CARD_CONFLICT_RESOLVED','fabric-cards',{
        code:String(req.params.code||''),choice,resolved:saved.resolved
      });
      const sync=saved.resolved&&choice==='mine'?await publish(req):{pending:false};
      if(saved.resolved&&choice==='remote')onChanged?.(req);
      const result=fabricCards.publicCards(await fabricCards.loadFabricCardsAsync());
      res.set('Cache-Control','no-store').json({ok:true,...result,resolved:saved.resolved,choice,sync});
    }catch(error){reportError(res,error,'Kumaş kartı çakışması çözülemedi.');}
  });
  app.delete('/api/fabric-cards/:code',async(req,res)=>{
    try{
      assertActive(req);
      const expectedRevisionId=String(req.query&&req.query.expectedRevisionId||'');
      const stored=await fabricCards.deleteFabricCard(req.params.code,req.currentUser,requestRevision(req),{
        assertAuthority:()=>assertActive(req),
        ...(Object.hasOwn(req.query||{},'expectedRevisionId')?{expectedRevisionId}:{})
      });
      assertActive(req);
      userAccess.appendAudit(req.currentUser,'FABRIC_CARD_DELETE','fabric-cards',{code:String(req.params.code||''),deleted:stored.deleted});
      const sync=stored.deleted?await publish(req):{pending:false};
      const result=fabricCards.publicCards(await fabricCards.loadFabricCardsAsync());
      res.set('ETag','"'+result.revision+'"').json({ok:true,...result,deleted:stored.deleted,sync});
    }catch(error){reportError(res,error,'Kumaş kartı silinemedi.');}
  });
};
