/* Personal order annotations: separate from shared CP/Orders overrides.
   This module never modifies a business row or sends private text to shared APIs. */
(function(root,factory){
  'use strict';
  var api=factory(root);
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root&&root.document){root.BLPrivateOrderNotes=api;api.install();}
})(typeof window!=='undefined'?window:null,function(root){
  'use strict';
  var PREFIX='bl.privateOrderNotes.v1.';
  var LIMIT=4000;
  function keyFor(lineKey){
    var identity=String(lineKey||'');
    return identity&&identity.length<=500?PREFIX+encodeURIComponent(identity):'';
  }
  function read(storage,lineKey){
    var key=keyFor(lineKey);
    return key&&storage&&typeof storage.getItem==='function'?String(storage.getItem(key)||''):'';
  }
  function write(storage,lineKey,value){
    var key=keyFor(lineKey),text=String(value==null?'':value).trim();
    if(!key||!storage||typeof storage.setItem!=='function'||typeof storage.removeItem!=='function')throw new Error('Personal note storage is unavailable.');
    if(text.length>LIMIT)throw new Error('Personal note is too long.');
    if(text)storage.setItem(key,text);else storage.removeItem(key);
    return text;
  }
  function esc(value){
    return String(value==null?'':value).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});
  }
  function words(en,tr,eng){return en?eng:tr;}
  function display(text,en){
    return String(text||'').replace(/\s+/g,' ').trim()||words(en,'Kişisel not ekle…','Add private note…');
  }
  function cellHtml(row,lineKey,lang){
    if(!keyFor(lineKey))return '<td class="viewOnlyCell">—</td>';
    var en=lang==='en';
    var value=read(root&&root.BLStorage,lineKey);
    var preview=display(value,en);
    var title=words(en,'Kişisel Not · Yalnızca siz görebilirsiniz','Private Note · Visible only to you');
    var model=String(row&&row['Model Name']||''),order=String(row&&row['Order Code']||'');
    return '<td class="editTd personalOrderNoteCell"><button type="button" class="noteCellTrigger'+(value?'':' empty')+'" data-bl-private-note-key="'+esc(lineKey)+'" data-bl-private-note-lang="'+(en?'en':'tr')+'" data-bl-private-note-order="'+esc(order)+'" data-bl-private-note-model="'+esc(model)+'" aria-label="'+esc(title+': '+preview)+'" title="'+esc(value||title)+'"><svg class="ic noteCellIcon" aria-hidden="true"><use href="#i-pencil"/></svg><span class="noteCellText">'+esc(preview)+'</span></button></td>';
  }
  function openEditor(button){
    if(!root||!root.document||!button)return;
    var doc=root.document,key=button.dataset.blPrivateNoteKey;
    if(!keyFor(key))return;
    var owner=String(root.BL_USER_CONTEXT&&root.BL_USER_CONTEXT.id||'');
    if(!owner||owner==='anonymous')return;
    var en=button.dataset.blPrivateNoteLang==='en';
    var initial=read(root.BLStorage,key);
    var previousFocus=doc.activeElement;
    var existing=doc.getElementById('_personalOrderNoteModal');
    if(existing)existing.remove();
    var modal=doc.createElement('div');
    modal.id='_personalOrderNoteModal';
    modal.className='warnOverlay blMotionOverlay';
    modal.dataset.uiMigrated='note-editor';
    var subtitle=[button.dataset.blPrivateNoteOrder,button.dataset.blPrivateNoteModel].filter(Boolean).join(' · ');
    modal.innerHTML='<div class="modalCard noteEditorCard" role="dialog" aria-modal="true" aria-labelledby="_personalOrderNoteTitle">'+
      '<div class="uiDialogHead"><div style="min-width:0"><div class="modalTitle" id="_personalOrderNoteTitle">'+esc(words(en,'Kişisel Not','Private Note'))+'</div>'+
      '<div class="uiDialogSub">'+esc(subtitle)+'</div></div>'+
      '<button type="button" class="notesEditorClose" aria-label="'+esc(words(en,'Kapat','Close'))+'"><svg class="ic"><use href="#i-x"/></svg></button></div>'+
      '<div class="noteEditorBody"><textarea class="noteEditorArea" maxlength="'+LIMIT+'" aria-labelledby="_personalOrderNoteTitle" spellcheck="true" placeholder="'+esc(words(en,'Kişisel notunuzu yazın…','Write your private note…'))+'"></textarea>'+
      '<div class="noteEditorHint">'+esc(words(en,'Bu not yalnızca size aittir; ortak sipariş verilerini değiştirmez. Silmek için alanı boşaltın. Ctrl+Enter ile kaydedin.','Only you can see this note. It does not change shared order data. Clear the field to delete it. Press Ctrl+Enter to save.'))+'</div></div>'+
      '<div class="uiDialogFoot"><button type="button" class="tbtn notesEditorCancel" data-ui-variant="quiet">'+esc(words(en,'Vazgeç','Cancel'))+'</button>'+
      '<button type="button" class="navActionBtn pri notesEditorSave" data-ui-variant="primary"><svg class="ic"><use href="#i-device-floppy"/></svg> '+esc(words(en,'Notu Kaydet','Save Note'))+'</button></div></div>';
    doc.body.appendChild(modal);
    root.BLMotionPlus&&root.BLMotionPlus.play&&root.BLMotionPlus.play('overlay',modal.querySelector('.modalCard'));
    var area=modal.querySelector('textarea');
    area.value=initial;
    var close=function(){modal.remove();if(previousFocus&&previousFocus.isConnected&&previousFocus.focus)previousFocus.focus();};
    var save=function(){
      // Owner and row identity are captured by a rendered, current table cell.
      if(owner!==String(root.BL_USER_CONTEXT&&root.BL_USER_CONTEXT.id||'')){
        root.alert(words(en,'Kullanıcı değişti. Notu yeniden açın.','The user changed. Reopen the note.'));return;
      }
      try{
        var value=write(root.BLStorage,key,area.value);
        doc.querySelectorAll('[data-bl-private-note-key]').forEach(function(other){
          if(other.dataset.blPrivateNoteKey!==key)return;
          var otherEn=other.dataset.blPrivateNoteLang==='en';
          var preview=display(value,otherEn);
          var title=words(otherEn,'Kişisel Not · Yalnızca siz görebilirsiniz','Private Note · Visible only to you');
          other.classList.toggle('empty',!value);
          other.title=value||title;
          other.setAttribute('aria-label',title+': '+preview);
          var label=other.querySelector('.noteCellText');if(label)label.textContent=preview;
        });
        close();
      }catch(error){
        root.alert(words(en,'Not kaydedilemedi. Kişisel depolama alanını kontrol edin.','The note could not be saved. Check personal storage.'));
      }
    };
    modal.querySelector('.notesEditorClose').addEventListener('click',close);
    modal.querySelector('.notesEditorCancel').addEventListener('click',close);
    modal.querySelector('.notesEditorSave').addEventListener('click',save);
    modal.addEventListener('click',function(event){if(event.target===modal)close();});
    modal.addEventListener('keydown',function(event){
      if(event.key==='Escape'){event.preventDefault();close();}
      else if(event.key==='Enter'&&(event.ctrlKey||event.metaKey)){event.preventDefault();save();}
      else if(event.key==='Tab'){
        var controls=[].slice.call(modal.querySelectorAll('button:not(:disabled),textarea:not(:disabled)'));
        var first=controls[0],last=controls[controls.length-1];
        if(event.shiftKey&&doc.activeElement===first){event.preventDefault();last.focus();}
        else if(!event.shiftKey&&doc.activeElement===last){event.preventDefault();first.focus();}
      }
    });
    area.focus();area.setSelectionRange(area.value.length,area.value.length);
  }
  function install(){
    root.document.addEventListener('click',function(event){
      var trigger=event.target&&event.target.closest&&event.target.closest('[data-bl-private-note-key]');
      if(!trigger)return;
      event.preventDefault();event.stopPropagation();
      openEditor(trigger);
    },true);
  }
  return {PREFIX:PREFIX,LIMIT:LIMIT,keyFor:keyFor,read:read,write:write,cellHtml:cellHtml,install:install};
});
