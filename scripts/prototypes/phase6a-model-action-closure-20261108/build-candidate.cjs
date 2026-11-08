'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'../../..'),app=path.join(root,'resources/app');
const {extractFunction}=require(path.join(app,'tests/helpers/app-main-functions.js'));
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const base=fs.readFileSync(path.join(app,'public/app-main.js'),'utf8');
assert.equal(hash(base),'b6659e5c522d8584cceaf5414e4f70e0e30b7ffc24d3d2de9c0bf5b6469bf666','fixed ea493898 app source; review drift, do not repin');
let source=base;const edits=[];
function edit(old,next){assert.equal(source.split(old).length,2,'unique source anchor');source=source.replace(old,next);edits.push({old,next});}
edit('async function writeCpModelColumn(sourceId, cpColumn){',fs.readFileSync(path.join(__dirname,'action-ownership.js'),'utf8')+'\nasync function writeCpModelColumn(sourceId, cpColumn){');
edit(extractFunction(source,'writeCpModelColumn'),fs.readFileSync(path.join(__dirname,'write-candidate.js'),'utf8').trim());
edit('async function removeCpModelColumn(id,rerenderFn){\n  const def=',`async function removeCpModelColumn(id,rerenderFn){
  if(ordersProjectionIsThin())return window.BLOrdersUiChange('orders','orders.model-column.remove','cp-model-action',()=>()=>true,()=>removeCpModelColumn(id,rerenderFn));
  const action=captureCpModelAction();
  const def=`);
edit("    const saved=await writeCpModelColumn(def.connectionId,{op:'remove',id});\n    forgetPersistedColumnKeys", "    action.assert();\n    const saved=await writeCpModelColumn(def.connectionId,{op:'remove',id},action);\n    action.assert();\n    forgetPersistedColumnKeys");
edit("async function openCpModelColumnModal(editId,rerenderFn){\n  document.getElementById('_cpModelColumnModal')?.remove();\n  try{await modelConnLoad();}catch(err){showToast(err.message||String(err));return;}",`async function openCpModelColumnModal(editId,rerenderFn){
  if(ordersProjectionIsThin())return window.BLOrdersUiChange('orders','orders.model-column.open','cp-model-action',()=>()=>true,()=>openCpModelColumnModal(editId,rerenderFn));
  const oldModal=document.getElementById('_cpModelColumnModal');
  const opening=captureCpModelAction(()=>document.getElementById('_cpModelColumnModal')===oldModal);
  try{await loadCpModelActionConfiguration(opening);opening.assert();}catch(err){showToast(err.message||String(err));return;}
  oldModal?.remove();`);
edit("  const key=value=>String(value||'').toLocaleLowerCase('tr-TR')",`  const controls=[...modal.querySelectorAll('input,select,textarea')];
  const modalNodes=[list,search,status,...controls];
  const modalDomCurrent=()=>modal.isConnected&&document.getElementById('_cpModelColumnModal')===modal
    &&modalNodes.every(node=>node.isConnected&&modal.querySelector('#'+node.id)===node);
  const modalAction=captureCpModelAction(modalDomCurrent);
  let schemaRequest=0,draftVersion=0;
  controls.forEach(node=>{node.addEventListener('input',()=>draftVersion++);node.addEventListener('change',()=>draftVersion++);});
  const modalCurrent=()=>{try{modalAction.assert();return true;}catch(_){return false;}};
  const key=value=>String(value||'').toLocaleLowerCase('tr-TR')`);
edit('  const render=()=>{const q=key(search.value);', '  const render=()=>{if(!modalCurrent())return;const q=key(search.value);');
edit("btn.addEventListener('click',()=>{selectedField={table:btn.dataset.table,name:btn.dataset.name,kind:'column'};render();})", "btn.addEventListener('click',()=>{if(!modalCurrent())return;draftVersion++;selectedField={table:btn.dataset.table,name:btn.dataset.name,kind:'column'};render();})");
const schemaLine=source.split('\n').find(line=>line.startsWith('  const loadSchema=async()=>{const conn=connections.find'));
edit(schemaLine,`  const loadSchema=async()=>{
    if(!modalCurrent())return;
    const connectionId=selectedConnectionId,sequence=++schemaRequest;
    const conn=connections.find(c=>c.id===connectionId);if(!conn)return;
    const current=()=>modalCurrent()&&sequence===schemaRequest&&connectionId===selectedConnectionId
      &&modal.querySelector('#_cpModelConnection').value===connectionId;
    schemaEntries=[];
    list.innerHTML=\`<div class="modelConnHint">\${escapeHtml(appLang==='en'?'Loading columns…':'Sütunlar yükleniyor…')}</div>\`;
    try{
      const res=await fetch('/api/model-connections/schema',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({server:conn.server,catalog:conn.catalog})});
      if(!current())return;
      const data=await res.json().catch(()=>({}));
      if(!current())return;
      if(!res.ok)throw new Error(data.error||res.statusText);
      schemaEntries=Array.isArray(data.columns)?data.columns:[];render();
    }catch(err){if(current())list.innerHTML=\`<div class="modelConnResult bad">\${escapeHtml(err.message||String(err))}</div>\`;}
  };`);
edit("modal.querySelector('#_cpModelConnection').addEventListener('change',e=>{selectedConnectionId=e.target.value;selectedField=null;loadSchema();});", "modal.querySelector('#_cpModelConnection').addEventListener('change',e=>{if(!modalCurrent())return;selectedConnectionId=e.target.value;selectedField=null;loadSchema();});");
edit("const btn=e.currentTarget;btn.disabled=true;status.textContent=appLang==='en'?'Saving…':'Kaydediliyor…';try{",`const btn=e.currentTarget;if(btn.disabled)return;
    const version=draftVersion,selected=JSON.stringify([selectedConnectionId,selectedField]);
    const values=JSON.stringify(controls.map(node=>[node.value,node.checked]));
    let action;
    try{modalAction.assert();action=captureCpModelAction(()=>modalDomCurrent()
      &&draftVersion===version&&JSON.stringify([selectedConnectionId,selectedField])===selected
      &&JSON.stringify(controls.map(node=>[node.value,node.checked]))===values
      &&controls.every(node=>node.isConnected)&&[...modal.querySelectorAll('input,select,textarea')].every((node,i)=>node===controls[i])
      &&modal.querySelectorAll('input,select,textarea').length===controls.length);}catch(err){status.textContent=err.message||String(err);return;}
    const connectionId=selectedConnectionId,field={...selectedField};
    btn.disabled=true;status.textContent=appLang==='en'?'Saving…':'Kaydediliyor…';try{`);
edit("previous.connectionId!==selectedConnectionId);\n      const entry={kind:'column',table:selectedField.table,name:selectedField.name};", "previous.connectionId!==connectionId);\n      action.assert();\n      const entry={kind:'column',table:field.table,name:field.name};");
edit("?await writeCpModelColumn(selectedConnectionId,{op:'add',label,labelEn,labelTr,group,entry})\n        :await writeCpModelColumn(selectedConnectionId,{op:'update',id:editId,label,labelEn,labelTr,group,entry});\n      if(movingSource)await writeCpModelColumn(previous.connectionId,{op:'remove',id:editId});", "?await writeCpModelColumn(connectionId,{op:'add',label,labelEn,labelTr,group,entry},action)\n        :await writeCpModelColumn(connectionId,{op:'update',id:editId,label,labelEn,labelTr,group,entry},action);\n      action.assert();\n      if(movingSource){await writeCpModelColumn(previous.connectionId,{op:'remove',id:editId},action);action.assert();}");
edit("  loadSchema(); setTimeout(()=>modal.querySelector(appLang==='en'?'#_cpModelLabelEn':'#_cpModelLabelTr').focus(),0);", "  loadSchema(); setTimeout(()=>{if(modalCurrent())modal.querySelector(appLang==='en'?'#_cpModelLabelEn':'#_cpModelLabelTr').focus();},0);");
let load=extractFunction(source,'modelConnLoad');
const newLoad=load.replace('async function modelConnLoad(){',`async function modelConnLoad(privateRequest=null){
  const continuation=_cpModelLoadRequests.get(privateRequest);
  _cpModelLoadRequests.delete(privateRequest);`)
 .replace("  const data=await res.json().catch(()=>({}));", "  continuation?.action.assert();\n  const data=await res.json().catch(()=>({}));\n  continuation?.action.assert();")
 .replace('  let change=null;', '  continuation?.beforeApply(next);\n  let change=null;')
 .replace('    Object.assign(modelConnState,next);modelConnState.loaded=true;', '    continuation?.beforeCommit(intent);\n    Object.assign(modelConnState,next);modelConnState.loaded=true;\n    continuation?.applied(intent);');
edit(load,newLoad);
// All other bytes, including imports, activation and #916, must round trip.
let reversed=source;for(const e of [...edits].reverse()){assert.equal(reversed.split(e.next).length,2);reversed=reversed.replace(e.next,e.old);}assert.equal(reversed,base);
const output=path.join(__dirname,'app-main.js');
fs.writeFileSync(output,source);
fs.writeFileSync(path.join(__dirname,'patch-recipe.json'),JSON.stringify({baseCommit:'ea49389836dba23f0970a974b4c0185f1b36ec0e',baseSha256:hash(base),candidateSha256:hash(source),edits},null,2)+'\n');
const diff=spawnSync('diff',['-u','--suppress-blank-empty','--label','a/resources/app/public/app-main.js','--label','b/resources/app/public/app-main.js',path.join(app,'public/app-main.js'),output],{encoding:'utf8'});
assert.equal(diff.status,1,'candidate must produce an applicable source diff');
fs.writeFileSync(path.join(__dirname,'app-main.patch'),diff.stdout);
console.log(JSON.stringify({baseSha256:hash(base),candidateSha256:hash(source),exactReverse:true,edits:edits.length}));
