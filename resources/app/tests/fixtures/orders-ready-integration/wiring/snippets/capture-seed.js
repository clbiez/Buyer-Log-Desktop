// Inactive classic-script declarations. No index/perf-runtime integration.
// Root imports these lazily only after reviewing every activation prerequisite.
function captureOrdersFiniteInputs(){
  const fail=()=>{throw Object.assign(Error('UNREADY_CLIENT'),{code:'UNREADY_CLIENT'});};
  const actor=state.currentUser&&state.currentUser.id,other=window.BL_USER_CONTEXT&&window.BL_USER_CONTEXT.id;
  if(actor==null||String(actor)!==String(other)||window.BLCanAccessArea?.('orders')!==true
    ||window.BL_CP_SOURCE_FILTER_REQUIRED!==false||window.BL_HAS_CACHED_MODEL_DATA!==true||!coreFilterAutoReady)fail();
  // No row reads, inferred horizons, sample rows, labels-as-scope or CP build.
  // The actual sourceUserId(profile) and guard.stamp(profile) both use profile.id.
  const field=(value,key)=>{
    if(!value||![Object.prototype,null].includes(Object.getPrototypeOf(value)))fail();
    const d=Object.getOwnPropertyDescriptor(value,key);if(!d||!Object.prototype.hasOwnProperty.call(d,'value'))fail();return d.value;
  };
  const data=(value,seen=new WeakSet(),depth=0)=>{
    if(depth>16)fail();
    if(value===null||typeof value==='string'||typeof value==='boolean'||(typeof value==='number'&&Number.isFinite(value)))return value;
    if(!value||typeof value!=='object'||seen.has(value))fail();seen.add(value);
    try{
      if(value instanceof Set){if(value.size>4096)fail();return [...value].map(v=>data(v,seen,depth+1));}
      if(Array.isArray(value)){
        if(value.length>4096||Reflect.ownKeys(value).length!==value.length+1)fail();
        const out=[];for(let i=0;i<value.length;i++){
          const d=Object.getOwnPropertyDescriptor(value,String(i));if(!d||!d.enumerable||!Object.prototype.hasOwnProperty.call(d,'value'))fail();
          out.push(data(d.value,seen,depth+1));}return out;
      }
      if(![Object.prototype,null].includes(Object.getPrototypeOf(value)))fail();
      const out={};for(const key of Reflect.ownKeys(value)){if(typeof key!=='string')fail();const d=Object.getOwnPropertyDescriptor(value,key);
        if(!d.enumerable||!Object.prototype.hasOwnProperty.call(d,'value'))fail();
        Object.defineProperty(out,key,{value:data(d.value,seen,depth+1),enumerable:true});}return out;
    }finally{seen.delete(value);}
  };
  const controls={};
  for(const id of ['ordersSearch','ordersFCountry','ordersFLicense','ordersFDelType','ordersFStatus','ordersFSeason']){
    const el=document.getElementById(id);if(!el||typeof el.value!=='string')fail();controls[id]=el.value;
  }
  if(!Array.isArray(ORDERS_COLS)||!Array.isArray(CP_MODEL_COLUMN_DEFS)||!(colmgr.orders.hidden instanceof Set))fail();
  const columns=ORDERS_COLS.map(c=>{
    const k=field(c,'k'),label=field(c,'label'),out={k,label};
    if(Object.prototype.hasOwnProperty.call(c,'modelCustom')&&field(c,'modelCustom')===true){out.modelCustom=true;out.modelColumnId=field(c,'modelColumnId');}
    return out;
  });
  const bucket=state.colFilters.orders;if(!bucket||![Object.prototype,null].includes(Object.getPrototypeOf(bucket)))fail();
  const filterKeys=[...new Set([...Object.keys(bucket),...CP_SEARCH_KEYS,...ORDERS_MIRROR_COLS,
    ...Object.values(ORDERS_DIM_META).map(meta=>meta.col),'Country','License','Active/Inactive','_id'])];
  const bindings=Object.keys(window.BLCanonicalFields.fields).map(id=>{
    const b=window.BLCanonicalFields.bindingFor('orders',id);return b?{id,semantic:b.semantic,keys:[...b.keys]}:{id};
  });
  return {actorId:String(actor),ownerId:String(actor),allowed:true,hydrated:true,columns,
    modelDefinitions:data(CP_MODEL_COLUMN_DEFS),hiddenKeys:[...colmgr.orders.hidden],filterKeys,
    sortKeys:state.ordersSort.key==null?[]:[state.ordersSort.key],
    // Current pricing/transit/normalizer consumers use native/canonical keys.
    // The compiler keeps ALL unknown/native keys independently of these lists.
    ruleKeys:['OPD','Country','Season','Licensor','License','FOB ($)','Supp. FOB'],operationKeys:[],
    settings:data({controls,filters:bucket,sort:state.ordersSort,check:state.checkFilter.orders,quickActive:state.ordersQuickActive,
      quickExf:state.ordersQuickExf,dims:ordersDimFilters,dimMeta:ORDERS_DIM_META,searchKeys:CP_SEARCH_KEYS,mirrorKeys:ORDERS_MIRROR_COLS,
      selection:state.ordersSelected,order:colmgr.orders.order,partial:partialViewEnabled('orders'),bindings,
      pricing:state.overrides.pricingRules,transit:state.overrides.transitRules,nonDtr:state.overrides.nonDtrManufacturers,
      multipliers:state.overrides.landedMultipliers,freight:state.overrides.freightRates||null,
      modelScopes:state.modelScopes,modelHorizons:state.modelHorizons,storeRevisions:state.storeRevisions,
      sourceFilterStatus:window.BL_CP_SOURCE_FILTER_STATUS||null}),
    // Do not call definitions() alone: it converts unknown storage to [].
    formulaStorage:BLStorage.getItem('bl.formulaColumns.orders.v1')};
}

function assertOrdersFiniteMutationAllowed(){
  // Synchronous sinks fail BEFORE their old body. Async UI initiators must
  // await ensureOrdersFullForAction and revalidate their target before calling.
  if(ordersProjectionIsThin())throw Object.assign(ordersFullActionError('ORDERS_FULL_STALE'),{code:'ORDERS_FULL_REQUIRED'});
}

function assertOrdersFiniteViewCurrent(){
  if(!ordersProjectionIsThin())return;
  if(!_ordersCurrentFiniteReceipt)throw ordersFullActionError('ORDERS_FULL_STALE');
  _ordersCurrentFiniteReceipt.assertCurrent();
}

function captureOrdersColdEligibility(){
  // Actual user-storage migration namespaces, not another formula registry.
  // Scope/audit only the current account, its supported Moderator aliases and
  // the old device-wide Orders key. Other accounts are neither read nor copied.
  const fail=()=>{throw Object.assign(Error('UNKNOWN_FORMULA_STORAGE'),{code:'UNKNOWN_FORMULA_STORAGE'});};
  const storage=window.BLStorage,native=storage&&storage.native,formula=window.BLFormulaColumns;
  if(!storage||!native||typeof storage.actualKey!=='function'||!formula||typeof formula.storageKey!=='function'
    ||formula.storageKey('orders')!=='bl.formulaColumns.orders.v1'||typeof native.getItem!=='function'||typeof native.key!=='function')fail();
  if(!['interactive','complete'].includes(document.readyState))fail();
  if(document.getElementById('_formulaColumnModal')||document.getElementById('_cpModelColumnModal')||cpLoadPromise)fail();
  const id=String(state.currentUser&&state.currentUser.id||''),uid=id.replace(/[^A-Za-z0-9_-]/g,'_');if(!id||uid==='anonymous')fail();
  const logical='bl.formulaColumns.orders.v1',scoped='bl.user.'+uid+'.';
  if(storage.actualKey(logical)!==scoped+logical)fail();
  const roots=['',scoped];if(uid==='moderator')roots.push('bl.user.gokberk.','bl.user.Gokberk.','bl.user.g_kberk.','bl.user.G_kberk.');
  const belongs=key=>roots.some(root=>key===root+'bl.formulaColumns.orders'||key.startsWith(root+'bl.formulaColumns.orders.'));
  if(!Number.isSafeInteger(native.length)||native.length<0||native.length>4096)fail();
  const names=new Set([logical,scoped+logical]);for(const root of roots)names.add(root+logical);
  for(let i=0;i<native.length;i++){const key=native.key(i);if(typeof key!=='string')fail();if(belongs(key))names.add(key);}
  const reads=[{source:'effective-current',key:logical,raw:storage.getItem(logical)}];
  for(const key of [...names].sort())reads.push({source:'native-current-or-legacy',key,raw:native.getItem(key)});
  // getItem includes inherited in-memory defaults. Check the persisted raw
  // defaults too: a parse failure in user-storage must not look like absence.
  const roleKey=scoped+'__roleWorkspaceDefaults.v1',raw=native.getItem(roleKey);
  if(raw!==null){const value=JSON.parse(raw);if(!value||Array.isArray(value)||typeof value!=='object')fail();
    for(const key of Object.keys(value))if(key==='bl.formulaColumns.orders'||key.startsWith('bl.formulaColumns.orders.')){
      const entry=value[key];if(!entry||typeof entry!=='object'||Array.isArray(entry)||!Object.prototype.hasOwnProperty.call(entry,'value'))fail();
      reads.push({source:'role-default-current-or-legacy',key,raw:entry.value});
    }
  }
  return {reads};
}

async function waitOrdersColdEligibility(){
  // This awaits the real current hydration, not a caller boolean. Existing
  // BLStorage's beforeApply full barrier still governs any later hydration.
  if(!authHydrationPromise)throw Object.assign(Error('UNREADY_CLIENT'),{code:'UNREADY_CLIENT'});
  const result=await authHydrationPromise;
  if(!result||cpLoadPromise)throw Object.assign(Error('UNREADY_CLIENT'),{code:'UNREADY_CLIENT'});
}
