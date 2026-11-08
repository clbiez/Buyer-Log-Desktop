// INACTIVE app-local declarations. capture-seed.js is copied byte-exact from
// the adopted parallel handoff, not a new app/runtime or a new field inventory.
function ordersHasPotentialReadyModelKey(){
  // App-local cheap decline; no finite script import, schema request, row scan
  // or #891 inventory read. Passing is NOT a producer-schema/authority proof.
  try{
    if(!Array.isArray(ORDERS_COLS)||!Array.isArray(CP_MODEL_COLUMN_DEFS)||!(colmgr.orders.hidden instanceof Set))return false;
    const value=(object,key)=>{const d=object&&Object.getOwnPropertyDescriptor(object,key);return d&&Object.prototype.hasOwnProperty.call(d,'value')?d.value:undefined;};
    return ORDERS_COLS.some(column=>{
      const key=value(column,'k'),id=value(column,'modelColumnId');
      return value(column,'modelCustom')===true&&typeof key==='string'&&key.startsWith('__CPX_')&&colmgr.orders.hidden.has(key)
        &&CP_MODEL_COLUMN_DEFS.some(def=>value(def,'header')===key&&value(def,'id')===id);
    });
  }catch(_){return false;}
}
function captureOrdersQuickFilterEvidence(){
  const fail=()=>{throw Object.assign(Error('UNKNOWN_ORDERS_QFG'),{code:'UNKNOWN_ORDERS_QFG'});};
  const storage=window.BLStorage,native=storage&&storage.native,qfg=window.BLQuickFilterGroups;
  if(!storage||!native||typeof storage.actualKey!=='function'||typeof native.getItem!=='function'
    ||typeof native.key!=='function'||typeof qfg?.config!=='function')fail();
  const id=String(state.currentUser&&state.currentUser.id||''),uid=id.replace(/[^A-Za-z0-9_-]/g,'_');
  if(!id||uid==='anonymous')fail();
  const logical='bl.quickFilterGroups.orders.v1',scoped='bl.user.'+uid+'.';
  if(storage.actualKey(logical)!==scoped+logical)fail();
  const roots=['',scoped];if(uid==='moderator')roots.push('bl.user.gokberk.','bl.user.Gokberk.','bl.user.g_kberk.','bl.user.G_kberk.');
  const belongs=key=>roots.some(root=>key===root+'bl.quickFilterGroups.orders'||key.startsWith(root+'bl.quickFilterGroups.orders.'));
  if(!Number.isSafeInteger(native.length)||native.length<0||native.length>4096)fail();
  const names=new Set(roots.map(root=>root+logical));
  for(let i=0;i<native.length;i++){const key=native.key(i);if(typeof key!=='string')fail();if(belongs(key))names.add(key);}
  const reads=[{source:'effective-current',key:logical,raw:storage.getItem(logical)}];
  for(const key of [...names].sort())reads.push({source:'native-current-or-legacy',key,raw:native.getItem(key)});
  const defaults=native.getItem(scoped+'__roleWorkspaceDefaults.v1');
  if(defaults!==null){
    if(typeof defaults!=='string'||defaults.length>65536)fail();
    const parsed=JSON.parse(defaults);if(!parsed||Array.isArray(parsed)||typeof parsed!=='object')fail();
    for(const key of Object.keys(parsed))if(key==='bl.quickFilterGroups.orders'||key.startsWith('bl.quickFilterGroups.orders.')){
      const entry=parsed[key];if(!entry||Array.isArray(entry)||typeof entry!=='object'||!Object.prototype.hasOwnProperty.call(entry,'value'))fail();
      reads.push({source:'role-default-current-or-legacy',key,raw:entry.value});
    }
  }
  for(const item of reads){
    if(item.raw===null)continue; // Exact real QFG absence means its empty default.
    if(typeof item.raw!=='string'||item.raw.length>65536)fail();
    const parsed=JSON.parse(item.raw);
    // Unlike QFG config(), malformed/missing extra never becomes a silent [].
    if(!parsed||Array.isArray(parsed)||typeof parsed!=='object'||!Array.isArray(parsed.extra)||parsed.extra.length!==0
      ||!Array.isArray(parsed.hidden)||parsed.hidden.some(value=>typeof value!=='string')
      ||Object.keys(parsed).some(key=>key!=='hidden'&&key!=='extra'))fail();
  }
  const config=qfg.config('orders');
  if(!config||!Array.isArray(config.extra)||config.extra.length!==0||!Array.isArray(config.hidden)
    ||config.hidden.some(value=>typeof value!=='string'))fail();
  const result={config,reads};if(JSON.stringify(result).length>65536)fail();return result;
}
function captureOrdersReadyInputs(){
  const captured=captureOrdersFiniteInputs(),qfg=captureOrdersQuickFilterEvidence();
  captured.operationKeys=[...qfg.config.extra]; // First scope requires exactly [].
  captured.settings.quickFilterGroups=qfg;
  captured.settings.lifecycle={sourceEpoch:_ordersProjectionSourceEpoch,sessionEpoch:_ordersUiSessionEpoch,page:activeProfilePage()};
  return captured;
}
function ordersReadyFirstSliceEligible(){
  try{
    if(state.orders||currentActiveTab()!=='orders'||ordersProjectionMustLoadFull()||!ordersHasPotentialReadyModelKey())return false;
    const input=captureOrdersReadyInputs(),s=input.settings;
    return state.ordersSelected instanceof Set&&state.ordersSelected.size===0&&s.partial===false
      &&Object.values(s.controls).every(value=>value==='')&&Object.keys(s.filters).length===0
      &&s.sort.key==null&&s.check===''&&s.quickActive.length===0&&s.quickExf===''
      &&Object.keys(s.dims).length===0;
  }catch(_){return false;}
}
function captureOrdersReadyLoadLease(){
  const flight=_ordersLoadFlight;
  if(!flight||!ordersLoadFlightCurrent(flight)||window.BLCanAccessArea?.('orders')!==true)throw ordersFullActionError('ORDERS_FULL_STALE');
  return {flight,actorId:String(state.currentUser?.id),contextId:String(window.BL_USER_CONTEXT?.id),page:activeProfilePage()};
}
function ordersReadyLoadLeaseCurrent(lease){
  return Boolean(lease&&ordersLoadFlightCurrent(lease.flight)&&lease.actorId===String(state.currentUser?.id)
    &&lease.contextId===String(window.BL_USER_CONTEXT?.id)&&lease.page===activeProfilePage()&&window.BLCanAccessArea?.('orders')===true);
}
// This is source/config continuity only, never accepted.assertCurrent(). The
// actual UI's pending DOM value may differ while native promotion is awaited.
function captureOrdersReadySource(accepted){
  const profile=state.currentUser,userContext=window.BL_USER_CONTEXT;
  const epoch=_ordersProjectionSourceEpoch,sessionEpoch=_ordersUiSessionEpoch,parent=accepted.parent;
  const stable=()=>{
    const input=captureOrdersReadyInputs(),s={...input.settings};
    for(const key of ['controls','filters','sort','check','quickActive','quickExf','dims','selection','partial'])delete s[key];
    return JSON.stringify({columns:input.columns,modelDefinitions:input.modelDefinitions,hiddenKeys:input.hiddenKeys,
      ruleKeys:input.ruleKeys,operationKeys:input.operationKeys,formulaStorage:input.formulaStorage,settings:s});
  };
  const config=stable();
  return ()=>{
    if(!parent||epoch!==_ordersProjectionSourceEpoch||sessionEpoch!==_ordersUiSessionEpoch
      ||profile!==state.currentUser||userContext!==window.BL_USER_CONTEXT
      ||String(state.currentUser?.id)!==parent.token.actorId||String(window.BL_USER_CONTEXT?.id)!==parent.token.actorId
      ||window.BLCanAccessArea?.('orders')!==true||stable()!==config)throw ordersFullActionError('ORDERS_FULL_STALE');
    return Object.freeze({allowed:true,actorId:parent.token.actorId,ownerId:parent.token.ownerId,sourceEpoch:epoch,sessionEpoch,
      sourceId:parent.token.sourceProjectionKey,generation:parent.token.sourceGeneration,sourceRevision:parent.token.sourceRevision,
      moduleInputKey:parent.token.moduleInputKey,accessHash:parent.token.accessHash,guardStamp:parent.guardStamp,
      fullGzipChecksum:parent.fullGzipChecksum,rawJsonSha256:parent.fullJsonSha256,planHash:parent.planHash});
  };
}
function bindOrdersReadyUiController(view,accepted,nativeController){
  // nativeController must be the real BLOrdersFullPromotion.create instance;
  // its actual normalize/publication adapter remains a separate root seam.
  if(!view||!Array.isArray(view.rows)||accepted?.mode!=='ready'||!accepted.parent
    ||typeof nativeController?.ensure!=='function')throw ordersFullActionError('ORDERS_FULL_STALE');
  accepted.assertCurrent();
  const readSource=captureOrdersReadySource(accepted);
  let lastFull=null;
  const ui=window.BLOrdersUiCommand.createPrivateSource({moduleNow:()=>state.orders,sourceNow:readSource,lastFull:()=>lastFull});
  const controller=Object.freeze({ensure:async options=>{
    const full=await nativeController.ensure(options);full.assertCurrent();lastFull=full;return full;
  },captureUiSource:()=>ui.capture(),readSource});
  // Register a still-private prospective view before the root's synchronous
  // state CAS. Nothing here publishes rows or requires a half-installed thin.
  _ordersFullViewControllers.set(view,controller);return controller;
}
