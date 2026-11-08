/* Existing compact action bar. Copy/Excel delegate to native actions;
   CP/Orders selection details use the shared scoped selection API. */
(function selectionActionBar(root){
  'use strict';
  const doc=root.document;if(!doc)return;
  const en=()=>typeof appLang!=='undefined'&&appLang==='en';
  const T=(tr,eng)=>en()?eng:tr;
  const selected=key=>{
    try{
      if(key==='cp')return typeof state!=='undefined'&&state.cpSelected?state.cpSelected.size:0;
      if(key==='orders')return typeof state!=='undefined'&&state.ordersSelected?state.ordersSelected.size:0;
      if(key==='koleksiyon')return typeof kolSelected!=='undefined'&&kolSelected?kolSelected.size:0;
    }catch(_){}
    return 0;
  };
  const PAGES=Object.freeze({
    cp:{unit:['satır seçili','rows selected'],actions:[['copy','navCopy'],['excel','cpExcelBtn'],['tools','cpToolsBtn']]},
    orders:{unit:['satır seçili','rows selected'],actions:[['copy','navCopy'],['excel','navExcelBtn'],['tools','ordersToolsBtn']]},
    koleksiyon:{unit:['model seçili','models selected'],actions:[['copy','kolCopySelectedBtn'],['excel','kolExcelBtn'],['tools','kolToolsBtn']]},
  });
  const ACTIONS=Object.freeze({
    copy:{icon:'#i-copy',label:['Kopyala','Copy']},
    excel:{icon:'#i-file-export',label:['Excel','Excel']},
    tools:{icon:'#i-bl-tools',label:['Araçlar','Tools']},
  });
  let panel=null,lastSignature='',host=null,bar=null,lastKey='',lastCount=0,lastLang='',dismissedAt='',queued=false,poll=0;

  function mount(){
    host=doc.createElement('div');
    host.className='blSelectionBarHost';
    bar=doc.createElement('div');
    bar.className='blSelectionBar';
    bar.id='blSelectionBar';
    bar.setAttribute('role','region');
    bar.hidden=true;
    host.appendChild(bar);
    doc.body.appendChild(host);
    panel=doc.createElement('div');panel.className='blSelectionPopover';panel.hidden=true;host.appendChild(panel);
    panel.addEventListener('click',event=>{
      event.stopPropagation();const button=event.target.closest('button');if(!button)return;
      const change=()=>{
      if(button.dataset.selectionRemove!==undefined){root.BLManagedSelection?.remove(lastKey,button.dataset.selectionRemove);drawPanel();schedule();}
      if(button.dataset.selectionClose!==undefined)closePanel(true);
      };
      if(lastKey==='orders'&&button.dataset.selectionRemove!==undefined&&typeof root.BLOrdersUiChange==='function')return root.BLOrdersUiChange('orders','orders.selection.popover',button,
        ()=>root.BLOrdersUiCommand.intent([button],()=>[button.dataset.selectionRemove,button.dataset.selectionClose]),change);
      return change();
    });
    doc.addEventListener('click',event=>{if(!host.contains(event.target))closePanel();});
    doc.addEventListener('keydown',event=>{if(event.key==='Escape'&&!panel.hidden){event.preventDefault();closePanel(true);}});
    bar.addEventListener('click',event=>{
      const button=event.target.closest('button');
      if(!button)return;
      // Menü tetikleyicileri belge tıklamasıyla kapanmasın diye olay burada durur.
      event.stopPropagation();
      const change=()=>{
      if(button.dataset.selectionDetails!==undefined){
        if(panel.hidden){drawPanel();panel.hidden=false;bar.querySelector('[data-selection-details]')?.setAttribute('aria-expanded','true');root.BLMotionPlus?.play?.('overlay',panel);panel.querySelector('button')?.focus();}else closePanel(true);
        return;
      }
      if(button.dataset.selectionDismiss!==undefined){if(lastKey==='cp'||lastKey==='orders'){root.BLManagedSelection?.clear(lastKey);schedule();return;}dismissedAt=lastKey+':'+lastCount;hide();return;}
      const target=doc.getElementById(button.dataset.selectionTarget||'');
      if(target&&!target.disabled)target.click();
      schedule();
      };
      const needsFull=button.dataset.selectionDismiss!==undefined||(button.dataset.selectionDetails!==undefined&&panel.hidden);
      if(lastKey==='orders'&&needsFull&&typeof root.BLOrdersUiChange==='function')return root.BLOrdersUiChange('orders','orders.selection.bar',button,
        ()=>root.BLOrdersUiCommand.intent([button],()=>[button.dataset.selectionDetails,button.dataset.selectionDismiss,button.dataset.selectionTarget]),change);
      return change();
    });
  }
  function closePanel(focus=false){
    if(panel)panel.hidden=true;
    bar?.querySelector('[data-selection-details]')?.setAttribute('aria-expanded','false');
    if(focus)bar?.querySelector('[data-selection-details]')?.focus();
  }
  const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function snapshot(){return (lastKey==='cp'||lastKey==='orders')?root.BLManagedSelection?.snapshot(lastKey):null;}
  function drawPanel(){
    const data=snapshot();if(!data)return;
    const hiddenIds=new Set(data.hidden.map(row=>String(row._id)));
    const close=T('Kapat','Close'),remove=T('Seçimi kaldır','Remove selection');
    panel.innerHTML=`<div class="blSelectionPopoverHead"><b>${T('Seçili satırlar','Selected rows')}</b><button class="iconbtn" data-selection-close aria-label="${close}">×</button></div><div class="blSelectionPopoverSummary">${data.rows.length} ${T('seçili','selected')} · ${data.hidden.length} ${T('filtre dışında','outside filters')}</div><div class="blSelectionPopoverList">${data.rows.map(row=>`<div class="blSelectionPopoverRow"><div><b>${escape(row['Model Name']||row['Order Code']||row._id)}</b><small>${escape(row['Order Code']||row['Special Code']||'')} · ${hiddenIds.has(String(row._id))?T('Filtre dışında','Outside filters'):T('Görünür','Visible')}</small></div><button class="iconbtn" data-selection-remove="${escape(row._id)}" aria-label="${remove}">×</button></div>`).join('')}</div>`;
  }
  function hide(){
    closePanel();
    if(!bar||bar.hidden)return;
    bar.hidden=true;
    if(poll){root.clearInterval(poll);poll=0;}
  }
  function render(key,count){
    const page=PAGES[key];
    const items=page.actions.map(([action,id])=>{
      const target=doc.getElementById(id);
      if(!target)return '';
      const meta=ACTIONS[action],label=T(meta.label[0],meta.label[1]);
      return `<button type="button" class="tbtn blSelectionAction" data-selection-target="${id}"${target.disabled?' disabled':''}><svg class="ic" aria-hidden="true"><use href="${meta.icon}"/></svg><span>${label}</span></button>`;
    }).join('');
    const data=snapshot(),hidden=data?.hidden.length||0;
    const details=T('Seçili satırları göster','Show selected rows');
    const badge=hidden?`<button type="button" class="blSelectionHidden" data-selection-details title="${details}">${hidden} ${T('filtre dışında','outside filters')}</button>`:'';
    const dismiss=data?T('Tüm seçimleri temizle','Clear all selections'):T('Seçim çubuğunu gizle','Hide selection bar');
    bar.setAttribute('aria-label',T('Seçili satır işlemleri','Selected row actions'));
    bar.innerHTML=`<button type="button" class="blSelectionCount" data-selection-details aria-expanded="false" aria-label="${details}"${data?'':' disabled'}><b>${count.toLocaleString(en()?'en-US':'tr-TR')}</b> ${T(page.unit[0],page.unit[1])}${data?' ▴':''}</button>${badge}<span class="blSelectionDivider" aria-hidden="true"></span>${items}<button type="button" class="iconbtn blSelectionDismiss" data-selection-dismiss title="${dismiss}" aria-label="${dismiss}"><svg class="ic" aria-hidden="true"><use href="#i-x"/></svg></button>`;
  }
  function update(){
    queued=false;
    if(!bar)return;
    const key=String(doc.body&&doc.body.dataset.activeTab||'');
    const count=PAGES[key]?selected(key):0;
    const signature=key+':'+count;
    // Seçim boşalınca gizleme unutulur; aynı sayıda yeni seçim çubuğu yeniden gösterir.
    if(!count)dismissedAt='';
    if(!count||dismissedAt===signature){hide();lastKey=key;lastCount=count;return;}
    if(dismissedAt&&dismissedAt!==signature)dismissedAt='';
    const lang=en()?'en':'tr';
    const oldKey=lastKey;lastKey=key;
    const data=snapshot();
    const signatureRows=data?data.rows.map(row=>String(row._id)).join(',')+'|'+data.hidden.map(row=>String(row._id)).join(','):'';
    const changed=signatureRows!==lastSignature||key!==oldKey||count!==lastCount||lang!==lastLang||bar.hidden;
    lastKey=key;lastCount=count;lastLang=lang;
    if(!changed)return;
    if(oldKey!==key)closePanel();
    lastSignature=signatureRows;
    const wasHidden=bar.hidden;
    const panelOpen=!panel.hidden;
    render(key,count);
    if(panelOpen){drawPanel();bar.querySelector('[data-selection-details]')?.setAttribute('aria-expanded','true');}
    bar.hidden=false;
    if(wasHidden)root.BLMotionPlus?.play?.('overlay',bar);
    // Seçim kodla temizlenirse (işlem sonrası) çubuk da kapanır; yalnız görünürken yoklanır.
    if(!poll)poll=root.setInterval(schedule,700);
  }
  function schedule(){
    if(queued)return;
    queued=true;
    root.requestAnimationFrame(update);
  }
  function init(){
    mount();
    for(const type of ['change','click','keyup','pointerup'])doc.addEventListener(type,event=>{
      if(bar&&bar.contains(event.target))return;
      schedule();
    },true);
    new root.MutationObserver(schedule).observe(doc.body,{attributes:true,attributeFilter:['data-active-tab']});
    doc.addEventListener('bl:language-changed',schedule);
    schedule();
  }
  root.BLSelectionBar=Object.freeze({refresh:schedule});
  if(doc.readyState==='loading')doc.addEventListener('DOMContentLoaded',init,{once:true});
  else init();
})(typeof window!=='undefined'?window:globalThis);
