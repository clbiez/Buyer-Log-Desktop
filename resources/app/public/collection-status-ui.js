'use strict';
(function(root,factory){
  const api=factory();root.BLCollectionStatusUI=api;
  setTimeout(function(){if(root.BLCollectionStatusRuntime)api.bind(root.BLCollectionStatusRuntime);},0);
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  function esc(value){return String(value==null?'':value).replace(/[&<>"']/g,function(ch){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch];});}
  function bind(runtime){const button=document.getElementById('kolManageStatusesBtn');if(!button||button.dataset.statusBound==='1')return;button.dataset.statusBound='1';button.addEventListener('click',function(){open(runtime);});}
  function swatches(runtime,input,onPick){const wrap=document.createElement('div');wrap.className='kolStatusSwatches';(runtime.presetColors()||[]).forEach(function(color){const button=document.createElement('button');button.type='button';button.className='kolStatusSwatch';button.style.setProperty('--swatch',color);button.title=color;button.addEventListener('click',function(){input.value=color;onPick(color);});wrap.appendChild(button);});return wrap;}
  function openDelete(runtime,parent,name){
    document.getElementById('_kolStatusDeleteModal')?.remove();
    const usage=runtime.usage(name),entries=runtime.getCatalog().filter(function(entry){return entry.name!==name;}),overlay=document.createElement('div'),en=runtime.language()==='en';overlay.id='_kolStatusDeleteModal';overlay.className='warnOverlay';overlay.dataset.uiMigrated='commercial';
    overlay.innerHTML='<div class="modalCard kolStatusDeleteModal" role="dialog" aria-modal="true"><div class="modalTitle">'+esc(en?'Delete status':'Status sil')+'<button type="button" data-close>×</button></div><p>'+esc(usage?(en?usage+' record(s) use “'+name+'”. Choose a replacement before deleting.':usage+' kayıt “'+name+'” durumunu kullanıyor. Silmeden önce yerine geçecek statusu seç.'):(en?'This status is not used by any record.':'Bu status hiçbir kayıtta kullanılmıyor.'))+'</p>'+(usage?'<label class="kolStatusReplacement"><span>'+esc(en?'Replacement status':'Yerine geçecek status')+'</span><select data-replacement><option value="">'+esc(en?'Choose status':'Status seç')+'</option>'+entries.map(function(entry){return '<option value="'+esc(entry.name)+'">'+esc(runtime.displayLabel(entry.name))+'</option>';}).join('')+'</select></label>':'')+'<div class="modalFoot"><button type="button" class="tbtn" data-close>'+esc(en?'Cancel':'Vazgeç')+'</button><button type="button" class="tbtn actionDanger" data-confirm '+(usage&&!entries.length?'disabled':'')+'>'+esc(en?'Delete':'Sil')+'</button></div></div>';
    document.body.appendChild(overlay);const close=function(){window.BLLayerSystem?.closeDialog(overlay);overlay.remove();};window.BLLayerSystem?.openDialog(overlay,{onClose:close});Array.from(overlay.querySelectorAll('[data-close]')).forEach(function(b){b.addEventListener('click',close);});overlay.addEventListener('click',function(e){if(e.target===overlay)close();});
    overlay.querySelector('[data-confirm]')?.addEventListener('click',function(){try{runtime.remove(name,usage?overlay.querySelector('[data-replacement]').value:'');close();render(parent,runtime);}catch(error){runtime.notify(error.message||String(error));}});
  }
  function render(modal,runtime){
    const en=runtime.language()==='en',host=modal.querySelector('[data-status-list]'),entries=runtime.getCatalog();host.innerHTML='';
    entries.forEach(function(entry){
      const row=document.createElement('div');row.className='kolStatusManagerRow';row.style.setProperty('--ui-series-color',entry.color);
      row.innerHTML='<span class="kolStatusManagerDot"></span><input type="text" class="kolStatusNameInput" value="'+esc(entry.name)+'" aria-label="'+esc(en?'Status name':'Status adı')+'"><input type="color" class="kolStatusColorInput" value="'+esc(entry.color)+'" aria-label="'+esc(en?'Status color':'Status rengi')+'"><span class="kolStatusUsage">'+runtime.usage(entry.name)+' '+esc(en?'records':'kayıt')+'</span><button type="button" class="tbtn" data-rename>'+esc(en?'Save':'Kaydet')+'</button><button type="button" class="tbtn actionDanger" data-delete>'+esc(en?'Delete':'Sil')+'</button>';
      const nameInput=row.querySelector('.kolStatusNameInput'),colorInput=row.querySelector('.kolStatusColorInput');
      row.insertBefore(swatches(runtime,colorInput,function(color){try{runtime.setColor(entry.name,color);render(modal,runtime);}catch(error){runtime.notify(error.message||String(error));}}),row.querySelector('[data-rename]'));
      colorInput.addEventListener('change',function(){try{runtime.setColor(entry.name,colorInput.value);render(modal,runtime);}catch(error){runtime.notify(error.message||String(error));}});
      row.querySelector('[data-rename]').addEventListener('click',function(){try{runtime.rename(entry.name,nameInput.value);render(modal,runtime);}catch(error){runtime.notify(error.message||String(error));}});
      row.querySelector('[data-delete]').addEventListener('click',function(){openDelete(runtime,modal,entry.name);});host.appendChild(row);
    });
    const addName=modal.querySelector('[data-add-name]'),addColor=modal.querySelector('[data-add-color]'),old=modal.querySelector('[data-add-swatches]');if(old)old.remove();
    const sw=swatches(runtime,addColor,function(color){addColor.value=color;});sw.dataset.addSwatches='1';addColor.after(sw);
    const addButton=modal.querySelector('[data-add]');addButton.onclick=function(){try{runtime.add(addName.value,addColor.value);addName.value='';render(modal,runtime);}catch(error){runtime.notify(error.message||String(error));}};
  }
  function open(runtime){
    if(!runtime.canEdit()){runtime.notify(runtime.language()==='en'?'This Collection page is view-only.':'Bu Koleksiyon sayfası yalnız görüntülenebilir.');return;}
    document.getElementById('_kolStatusManagerModal')?.remove();
    const en=runtime.language()==='en',modal=document.createElement('div');modal.id='_kolStatusManagerModal';modal.className='warnOverlay';modal.dataset.uiMigrated='commercial';
    modal.innerHTML='<div class="modalCard kolStatusManagerModal" role="dialog" aria-modal="true"><div class="modalTitle">'+esc(en?'Manage Statuses':'Statusları Yönet')+'<button type="button" data-close>×</button></div><p class="kolStatusManagerHint">'+esc(en?'These colors are shared by Collection, Overview and Excel exports.':'Bu renkler Collection, Overview ve Excel dışa aktarımlarında ortak kullanılır.')+'</p><div class="kolStatusManagerList" data-status-list></div><div class="kolStatusAddRow"><input type="text" data-add-name placeholder="'+esc(en?'New status name':'Yeni status adı')+'"><input type="color" data-add-color value="#667085"><button type="button" class="tbtn primary" data-add>'+esc(en?'Add Status':'Status Ekle')+'</button></div><div class="modalFoot"><button type="button" class="tbtn" data-close>'+esc(en?'Close':'Kapat')+'</button></div></div>';
    document.body.appendChild(modal);const close=function(){window.BLLayerSystem?.closeDialog(modal);modal.remove();};window.BLLayerSystem?.openDialog(modal,{onClose:close});Array.from(modal.querySelectorAll('[data-close]')).forEach(function(b){b.addEventListener('click',close);});modal.addEventListener('click',function(e){if(e.target===modal)close();});render(modal,runtime);
  }
  return {bind:bind,open:open};
});
