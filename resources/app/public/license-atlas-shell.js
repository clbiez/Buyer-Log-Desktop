/* Buyer Log owns data, access and transactions; the isolated uploaded Atlas owns presentation. */
(() => {
 'use strict';
 const A=window.BLLicenseAtlasEngine,E=window.BLLicenseCardsEngine,wire='buyer-log-license-atlas-v1';
 const copy=v=>JSON.parse(JSON.stringify(v)),equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
 let componentPending=null;
 let frame,host,ctx,ready=false,dirty=false,busy=false,library=null,libraryPending=null,baseline=null,baseCards=[],generation=0,recoveryPlan=null;
 const T=(tr,en)=>ctx?.locale==='en'?en:tr;
 const metaKeys=['sharedAddresses','visualLibrary','customSelectOptions','processTemplates','stageClipboard'];
 function post(action,payload={}){if(ready)frame.contentWindow.postMessage({wire,action,...payload},'*');}
 function commerce(cards){const percent=v=>v==null||v===''?'—':`${Number(v).toLocaleString(ctx.locale==='en'?'en-US':'tr-TR')}%`,cost=v=>v==null||v===''?'—':`$${Number(v).toLocaleString(ctx.locale==='en'?'en-US':'tr-TR',{maximumFractionDigits:4})}`;
  return Object.fromEntries(cards.map(c=>[c.id,{count:(c.rules||[]).length,start:E.latestContract(c.rules)?.opdStart||'',contracts:[E.latestContract(c.rules)].filter(Boolean).map(r=>({scope:(r.seasons?.length?r.seasons.join(', '):r.season||T('Tüm sezonlar','All seasons'))+(r.countryGroup?` · ${r.countryGroup}`:''),range:`${r.opdStart||'−∞'} → ${r.opdEnd||'+∞'}`,rates:[{label:'Royalty',value:percent(r.royalty)},{label:T('TR komisyon','TR commission'),value:percent(r.trCommission)},{label:T('YD komisyon','International commission'),value:percent(r.ydCommission)},{label:T('Hologram / adet','Hologram / unit'),value:cost(r.hologramCost)}]}))}]));
 }
 function prepareLicense(value){
  const l=copy(value);l.manufacturerVisible=l.manufacturerVisible!==false;l.supplierShowRequirements=l.supplierShowRequirements!==false;
  l.portal=l.portal||{url:'',notes:''};l.portal.manufacturerVisible=l.portal.manufacturerVisible===true;
  for(const a of l.addresses||[])a.manufacturerVisible=a.manufacturerVisible!==false;
  for(const st of l.stages||[]){st.manufacturerVisible=st.manufacturerVisible!==false;st.supplierShowApprovalNotes=st.supplierShowApprovalNotes!==false;st.supplierShowSourceNote=Object.hasOwn(st,'supplierShowSourceNote')?st.supplierShowSourceNote===true:st.supplierShowNotes!==false;delete st.supplierShowNotes;for(const r of st.submissions||[]){r.manufacturerVisible=r.manufacturerVisible!==false;r.supplierShowNotes=r.supplierShowNotes!==false;}}
  return l;
 }
 function build(cards){
  const prepared=cards.map(c=>!c.processAtlas?c:{...c,processAtlas:{...c.processAtlas,license:prepareLicense(c.processAtlas.license),sharedAddresses:(c.processAtlas.sharedAddresses||[]).map(a=>({...a,manufacturerVisible:a.manufacturerVisible!==false})),processTemplates:(c.processAtlas.processTemplates||[]).map(t=>({...t,...{stages:prepareLicense({stages:t.stages,addresses:[]}).stages}}))}});
  const db=window.BLLicenseAtlasWorkspace.merge(prepared,{licenses:(library?.licenses||[]).map(prepareLicense)});db.licenses=db.licenses.map(prepareLicense);return db;
 }
 async function mount(target){
  try{
   if(!componentPending)componentPending=Promise.all(['index.html','integration.css','integration.js'].map(async name=>{const response=await fetch(`license-atlas/${name}`,{credentials:'same-origin',cache:'no-store'});if(!response.ok)throw new Error('ATLAS_COMPONENT_LOAD');return response.text();})).catch(error=>{componentPending=null;throw error;});
   const [html,css,js]=await componentPending;
   if(frame!==target)return;
   target.srcdoc=html.replace('<link rel="stylesheet" href="integration.css">',()=>`<style>${css}</style>`).replace('<script src="integration.js"></script>',()=>`<script>${js}</script>`);
  }catch(error){host.querySelector('.lcAtlasCommerce').textContent=ctx.failMessage(error);}
 }
 async function ensureLibrary(){if(library)return;if(!libraryPending)libraryPending=ctx.api('/api/license-cards/atlas-library').then(v=>{library=v;}).catch(error=>{library={licenses:[]};throw error;}).finally(()=>libraryPending=null);await libraryPending;}
 async function sync(){
  if(!ready||!ctx.data)return;const version=++generation;
  try{await ensureLibrary();if(version!==generation)return;if(!dirty&&!busy){baseline=build(ctx.data.cards);baseCards=copy(ctx.data.cards);}
   post('init',{db:baseline||build(ctx.data.cards),commerce:commerce(ctx.data.cards),canEdit:ctx.data.canEdit,locale:ctx.locale,environment:environment(),error:ctx.error||''});
  }catch(error){ctx.showError(ctx.failMessage(error));}
 }
 async function saveAtlas(db,details=false){
  if(busy)return;if(!ctx.data?.canEdit||!baseline){post('failed',{error:ctx.failMessage({status:403})});return;}
  busy=true;const current=ctx,original=baseline;
  try{
   if(!db||!Array.isArray(db.licenses)||db.licenses.length!==original.licenses.length||new Set(db.licenses.map(l=>l.id)).size!==db.licenses.length)throw Object.assign(new Error(),{code:'LICENSE_ATLAS_INVALID'});
   const globalChanged=metaKeys.some(k=>!equal(db[k],original[k]));
   const changes=[];
   for(const l of db.licenses){const before=original.licenses.find(x=>x.id===l.id),card=baseCards.find(c=>c.id===l.id);if(!before||!card)throw Object.assign(new Error(),{code:'LICENSE_ATLAS_INVALID'});
    const draft=details?current.businessDraft():null;const detail=draft?.baseCard?.id===l.id?draft:null;
    if(detail&&detail.editToken!==card.editToken)throw Object.assign(new Error(),{code:'REVISION_CONFLICT',status:409});
    if(globalChanged||!equal(l,before)||detail){const atlas={version:1,license:{...l,id:card.id,name:card.license}};Object.assign(atlas,window.BLLicenseAtlasWorkspace.metadata(db,l,original,current.selected||baseCards[0]?.id));changes.push({id:card.id,editToken:detail?.editToken||card.editToken,processAtlas:A.normalize(atlas),...(detail?{profile:detail.profile,rules:detail.rules}:{})});}
   }
   if(!changes.length){dirty=false;post('saved',{db:baseline,commerce:commerce(ctx.data.cards)});return;}
   const result=await current.api('/api/license-cards/atlas-batch',{method:'PUT',body:JSON.stringify({changes})});
   dirty=false;current.accept(result);ctx.data=result;ctx.error='';baseline=build(result.cards);baseCards=copy(result.cards);post('saved',{db:baseline,commerce:commerce(result.cards)});
  }catch(error){post('failed',{error:current.failMessage(error)});}
  finally{busy=false;}
 }
 function exportSupplier(id=''){
  if(dirty||busy)return;
  const selected=ctx.data.cards.filter(c=>!id||c.id===id),licenses=selected.map(c=>A.project(c.processAtlas?{...c,processAtlas:{...c.processAtlas,license:prepareLicense(c.processAtlas.license),sharedAddresses:(c.processAtlas.sharedAddresses||[]).map(a=>({...a,manufacturerVisible:a.manufacturerVisible!==false}))}}:c,ctx.locale)).filter(Boolean);
  if(!licenses.length){ctx.showError(T('Üreticiye açık kayıt yok. Lisans bilgileri → Üretici görünümü bölümünden paylaşımı açıp atlası kaydedin.','No supplier-visible records. Enable sharing in License details → Supplier view and save the atlas.'));return;}
  const publicCards=licenses.map(l=>{
   for(const st of l.stages){if(st.note)st.supplierInstructions=[st.supplierInstructions,st.note].filter(Boolean).join('\n\n');for(const r of st.submissions)r.note=[r.supplierInstructions,r.note].filter(Boolean).join('\n\n');}
   const {visualLibrary,customSelectOptions,...license}=l;
   return {id:l.id,license:l.name,licensor:l.agency,processAtlas:{license,visualLibrary,customSelectOptions}};
  });
  const payload=window.BLLicenseAtlasWorkspace.merge(publicCards);
  post('supplier',{payload:{version:1,audience:'supplier',exportedAt:new Date().toISOString(),licenses:payload.licenses,visualLibrary:payload.visualLibrary,customSelectOptions:payload.customSelectOptions}});
 }
 function environment(){
  const style=getComputedStyle(document.documentElement),tokens={};
  for(const name of ['--bg','--paper','--card2','--card','--ink','--muted','--line','--acc','--shadow-1','--shadow-2','--r-md','--r-lg']){const value=style.getPropertyValue(name).trim();if(value)tokens[name]=value;}
  return {theme:document.documentElement.dataset.theme||'light',locale:document.documentElement.lang==='en'?'en':'tr',tokens};
 }
 new MutationObserver(()=>post('environment',{environment:environment()})).observe(document.documentElement,{attributes:true,attributeFilter:['data-theme','style','lang']});
 function previewRecovery(backup){
  recoveryPlan=null;
  if(dirty||busy||!ctx.data?.canEdit)return;
  try{const plan=window.BLLicenseAtlasWorkspace.recovery(ctx.data.cards,backup);
   if(plan.unmatched.length){post('recoveryPlan',{error:T('Buyer Log’da bulunmayan lisanslar: ','Licenses missing from Buyer Log: ')+plan.unmatched.join(', ')});return;}
   if(!plan.changes.length)throw Object.assign(new Error(),{code:'LICENSE_ATLAS_INVALID'});
   recoveryPlan=plan.changes.map(c=>{const atlas=A.normalize(c.processAtlas);return {...c,processAtlas:A.normalize({...atlas,license:prepareLicense(atlas.license),sharedAddresses:atlas.sharedAddresses.map(a=>({...a,manufacturerVisible:a.manufacturerVisible!==false}))})};});
   post('recoveryPlan',{items:recoveryPlan.map(c=>({license:c.license,licensor:c.licensor}))});
  }catch(error){post('recoveryPlan',{error:ctx.failMessage(error)});}
 }
 async function applyRecovery(){
  if(busy)return;if(!recoveryPlan||dirty||!ctx.data?.canEdit){post('failed',{error:ctx.failMessage({status:403})});return;}busy=true;
  try{const result=await ctx.api('/api/license-cards/atlas-batch',{method:'PUT',body:JSON.stringify({changes:recoveryPlan})});
   ctx.accept(result);ctx.data=result;baseline=build(result.cards);baseCards=copy(result.cards);recoveryPlan=null;
   post('saved',{db:baseline,commerce:commerce(result.cards),recovery:true});
  }catch(error){post('failed',{error:ctx.failMessage(error)});}finally{busy=false;}
 }
 window.addEventListener('message',event=>{
  if(!frame||event.source!==frame.contentWindow||event.data?.wire!==wire)return;
  const m=event.data;
  if(m.action==='ready'){ready=true;sync();}
  if(m.action==='dirty')dirty=m.dirty===true;
  if(m.action==='discarded'){dirty=false;ctx.reload();}
  if(m.action==='save')saveAtlas(m.db,m.details===true);
  if(m.action==='businessBegin')post('business',{html:ctx.businessBegin(m.id)});
  if(m.action==='businessInput')ctx.businessInput(m);
  if(m.action==='businessRefresh')post('business',{html:ctx.businessView()});
  if(m.action==='businessAdd')post('business',{html:ctx.businessAdd()});
  if(m.action==='businessCancel')ctx.businessCancel();
  if(m.action==='recoveryPreview')previewRecovery(m.backup);
  if(m.action==='recoveryApply')applyRecovery();
  if(m.action==='recoveryCancel')recoveryPlan=null;
  if(m.action==='select'&&ctx.data?.cards.some(c=>c.id===m.id)){ctx.selected=m.id;ctx.selectOnly(m.id);}
  if(m.action==='refresh'&&!dirty&&!busy&&ctx.data?.canEdit){library=null;ctx.action('refresh');}
  if(m.action==='export')exportSupplier(typeof m.id==='string'?m.id:'');

 });
 window.addEventListener('beforeunload' ,event=>{if(dirty){event.preventDefault();event.returnValue='';}});
 window.BLLicenseAtlasShell={
  render(element,context){ctx=context;host=element;if(!frame||!host.contains(frame)){ready=false;dirty=false;host.innerHTML='<div class="lcAtlasShell"><iframe class="lcAtlasFrame" sandbox="allow-scripts allow-downloads allow-modals allow-popups allow-popups-to-escape-sandbox" title="License Atlas"></iframe><div class="lcAtlasCommerce"></div></div>';frame=host.querySelector('iframe');mount(frame);}
   const target=host.querySelector('.lcAtlasCommerce');target.innerHTML='';
   if(!context.data){target.innerHTML='<div class="lcNotice" role="status"><span></span><button class="tbtn" data-lc-action="retry"></button></div>';target.querySelector('span').textContent=context.error||T('Lisanslar yükleniyor…','Loading licenses…');target.querySelector('button').textContent=T('Yeniden dene','Retry');target.querySelector('button').hidden=!context.error;}
   sync();
  },
  exportSupplier,hasUnsaved:()=>dirty||busy,
 };
})();
