/* Buyer Log seçim çubuğu · CP / Siparişler / Koleksiyon.
   Satır işaretlenince tablonun altında kayarak gelir: seçim sayısı + Kopyala,
   Excel ve Araçlar. Kendi iş mantığı yoktur; yalnız sayfadaki GERÇEK düğmelere
   tıklar, onların etkin/pasif durumunu yansıtır. Seçim değişmeden kapatılırsa
   bir sonraki seçim değişikliğine kadar gizli kalır. */
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
  let host=null,bar=null,lastKey='',lastCount=0,lastLang='',dismissedAt='',queued=false,poll=0;

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
    bar.addEventListener('click',event=>{
      const button=event.target.closest('button');
      if(!button)return;
      // Menü tetikleyicileri belge tıklamasıyla kapanmasın diye olay burada durur.
      event.stopPropagation();
      if(button.dataset.selectionDismiss!==undefined){dismissedAt=lastKey+':'+lastCount;hide();return;}
      const target=doc.getElementById(button.dataset.selectionTarget||'');
      if(target&&!target.disabled)target.click();
      schedule();
    });
  }
  function hide(){
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
    const dismiss=T('Seçim çubuğunu gizle','Hide selection bar');
    bar.setAttribute('aria-label',T('Seçili satır işlemleri','Selected row actions'));
    bar.innerHTML=`<span class="blSelectionCount" aria-live="polite"><b>${count.toLocaleString(en()?'en-US':'tr-TR')}</b> ${T(page.unit[0],page.unit[1])}</span><span class="blSelectionDivider" aria-hidden="true"></span>${items}<button type="button" class="iconbtn blSelectionDismiss" data-selection-dismiss title="${dismiss}" aria-label="${dismiss}"><svg class="ic" aria-hidden="true"><use href="#i-x"/></svg></button>`;
  }
  function update(){
    queued=false;
    if(!bar)return;
    const key=String(doc.body&&doc.body.dataset.activeTab||'');
    const count=PAGES[key]?selected(key):0;
    const signature=key+':'+count;
    if(!count||dismissedAt===signature){hide();lastKey=key;lastCount=count;return;}
    if(dismissedAt&&dismissedAt!==signature)dismissedAt='';
    const lang=en()?'en':'tr';
    const changed=key!==lastKey||count!==lastCount||lang!==lastLang||bar.hidden;
    lastKey=key;lastCount=count;lastLang=lang;
    if(!changed)return;
    const wasHidden=bar.hidden;
    render(key,count);
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
