/* Merge legacy card-scoped atlas libraries without losing assets or crossing identities. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.BLLicenseAtlasWorkspace=api;})(typeof window==='object'?window:globalThis,()=>{
 'use strict';
 const copy=v=>JSON.parse(JSON.stringify(v));
 const stable=v=>Array.isArray(v)?v.map(stable):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])])):v;
 const signature=v=>JSON.stringify(stable(Object.fromEntries(Object.entries(v).filter(([k])=>k!=='id'))));
 function merge(cards,library={licenses:[]}){
  const db={version:2,licenses:[],sharedAddresses:[],visualLibrary:[],customSelectOptions:{},processTemplates:[],stageClipboard:null,ownership:{},presetTemplateIds:[]};
  const add=(list,item,prefix,key='id')=>{const found=list.find(x=>signature({...x,id:x[key]})===signature({...item,id:item[key]}));if(found)return found[key];let id=item[key],counter=0;while(list.some(x=>x[key]===id))id=`${prefix}-${item[key]}-${++counter}`;list.push({...copy(item),[key]:id});return id;};
  let clipboardTime='';
  for(const c of cards){
   const a=c.processAtlas||{},prefix=c.id,addresses=new Map(),visuals=new Map(),options={};
   const owned=db.ownership[c.id]={sharedAddresses:[],visualLibrary:[],processTemplates:[],customSelectOptions:{}};
   for(const item of a.sharedAddresses||[]){const id=add(db.sharedAddresses,item,prefix);addresses.set(item.id,id);owned.sharedAddresses.push(id);}
   for(const item of a.visualLibrary||[]){const id=add(db.visualLibrary,item,prefix);visuals.set(item.id,id);owned.visualLibrary.push(id);}
   for(const [key,items] of Object.entries(a.customSelectOptions||{})){const list=db.customSelectOptions[key]??=[];options[key]=new Map();for(const item of items){const existing=list.find(x=>x.value===item.value&&signature({...x,value:undefined})===signature({...item,value:undefined}));let value=existing?.value||item.value;if(!existing){let n=0;while(list.some(x=>x.value===value))value=`${prefix}-${item.value}-${++n}`;list.push({...copy(item),value});}options[key].set(item.value,value);(owned.customSelectOptions[key]??=[]).push(value);}}
   const option=(o,key)=>{if(options[key]?.has(o[key]))o[key]=options[key].get(o[key]);};
   const stages=(items,local=[])=>{const localIds=new Set(local.map(x=>x.id));return (items||[]).map(item=>{const st=copy(item);if(visuals.has(st.visualGuideId))st.visualGuideId=visuals.get(st.visualGuideId);option(st,'approver');st.submissions=(st.submissions||[]).map(r=>{if(!localIds.has(r.addressId)&&addresses.has(r.addressId))r.addressId=addresses.get(r.addressId);for(const k of ['recipientType','method','timing'])option(r,k);return r;});return st;});};
   const matches=(library.licenses||[]).filter(l=>String(l.name).trim().toLocaleUpperCase('en-US')===String(c.license).trim().toLocaleUpperCase('en-US'));
   const license=copy(a.license||(matches.length===1?matches[0]:{category:'',symbol:'✦',stages:[],addresses:[],portal:{url:'',notes:''}}));
   license.id=c.id;license.name=c.license;license.agency=c.licensor===undefined?license.agency||'':c.licensor||'';license.addresses??=[];license.portal??={url:'',notes:''};license.stages=stages(license.stages,license.addresses);option(license,'category');
   for(const t of a.processTemplates||[]){const item={...copy(t),stages:stages(t.stages,t.addresses)};const id=add(db.processTemplates,item,prefix);owned.processTemplates.push(id);if(license.workflowTemplate?.id===t.id)license.workflowTemplate.id=id;}
   if(a.stageClipboard&&String(c.updatedAt||'')>=clipboardTime){db.stageClipboard={...copy(a.stageClipboard),stage:stages([a.stageClipboard.stage],a.stageClipboard.addresses)[0]};clipboardTime=String(c.updatedAt||'');}
   db.licenses.push(license);
  }
  for(const l of library.licenses||[]){const id='library-'+l.id;if(db.processTemplates.some(t=>t.id===id))continue;db.processTemplates.push({id,name:l.name,version:2,stages:copy(l.stages||[]),addresses:copy(l.addresses||[])});db.presetTemplateIds.push(id);}
  return db;
 }
 // Persist each card's assets plus the assets its tree/templates reference. This avoids
 // multiplying independently imported images across every card's existing 2 MB budget.
 function metadata(db,license,baseline,ownerId){
  const owned=baseline.ownership?.[license.id]||{},owners=Object.values(baseline.ownership||{}),presets=new Set(db.presetTemplateIds||[]);
  const include=(kind,id,refs=new Set())=>(owned[kind]||[]).includes(id)||refs.has(id)||(license.id===ownerId&&!owners.some(o=>(o[kind]||[]).includes(id)));
  const processTemplates=(db.processTemplates||[]).filter(t=>!presets.has(t.id)&&include('processTemplates',t.id,new Set([license.workflowTemplate?.id])));
  const stages=[...(license.stages||[]),...processTemplates.flatMap(t=>t.stages||[])],routes=stages.flatMap(s=>s.submissions||[]);
  const visualIds=new Set(stages.map(s=>s.visualGuideId)),addressIds=new Set(routes.map(r=>r.addressId));
  const customSelectOptions={};
  for(const [key,items] of Object.entries(db.customSelectOptions||{})){
   const refs=new Set(key==='category'?[license.category]:key==='approver'?stages.map(s=>s.approver):routes.map(r=>r[key]));
   customSelectOptions[key]=items.filter(item=>(owned.customSelectOptions?.[key]||[]).includes(item.value)||refs.has(item.value)||(license.id===ownerId&&!owners.some(o=>(o.customSelectOptions?.[key]||[]).includes(item.value))));
  }
  return {processTemplates,customSelectOptions,stageClipboard:db.stageClipboard,visualLibrary:(db.visualLibrary||[]).filter(v=>include('visualLibrary',v.id,visualIds)),sharedAddresses:(db.sharedAddresses||[]).filter(a=>include('sharedAddresses',a.id,addressIds))};
 }
 // Legacy backups have operational agency names; only canonical IDs or unique
 // names/licensors identify a target. Preview every fan-out before applying.
 function recovery(cards,backup){
  const fail=()=>{throw Object.assign(new Error('LICENSE_ATLAS_INVALID'),{code:'LICENSE_ATLAS_INVALID'});};
  if(!backup||!Array.isArray(backup.licenses)||!backup.licenses.length||backup.licenses.length>500)fail();
  const key=v=>String(v||'').trim().toUpperCase().replace(/[İŞÇÖÜĞ]/g,c=>({'İ':'I','Ş':'S','Ç':'C','Ö':'O','Ü':'U','Ğ':'G'}[c])).replace(/\s+/g,' ');
  const changes=[],claimed=new Set(),unmatched=[];
  for(const l of backup.licenses){
   if(!l||typeof l.name!=='string'||!Array.isArray(l.stages)||!Array.isArray(l.addresses))fail();
   const named=cards.filter(c=>key(c.license)===key(l.name)),bound=named.find(c=>c.id===l.id);
   let targets=bound?[bound]:named;
   if(!bound&&named.length>1){const sameName=backup.licenses.filter(x=>key(x.name)===key(l.name));if(sameName.length>1){targets=named.filter(c=>key(c.licensor)===key(l.agency));if(targets.length!==1)fail();}}
   if(!targets.length){unmatched.push(l.name);continue;}
   for(const c of targets){if(claimed.has(c.id))fail();claimed.add(c.id);
    const assets=backup.ownership?.[l.id]?metadata(backup,l,backup,l.id):Object.fromEntries(['sharedAddresses','visualLibrary','customSelectOptions','processTemplates','stageClipboard'].filter(k=>Object.hasOwn(backup,k)).map(k=>[k,copy(backup[k])]));
    changes.push({id:c.id,editToken:c.editToken,license:c.license,licensor:c.licensor,processAtlas:{version:1,license:{...copy(l),id:c.id,name:c.license,agency:c.licensor},...assets}});
   }
  }
  return {changes,unmatched};
 }
 return {merge,metadata,recovery};
});
