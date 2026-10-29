/* Buyer Log komut paleti (Ctrl+Shift+K / Cmd+Shift+K).
   Görünür bir arama kutusu eklemez (v7.26'da başlıktaki arama kutusu kullanıcı
   talebiyle kaldırıldı); yalnız kısayolla açılan bir katmandır. Modüllere ray
   düğmeleri üzerinden gider, böylece her modülün kendi tembel açılışı korunur.
   DOM ilk açılışta kurulur (perf-runtime ile uyumlu). */
(function(root){
  'use strict';
  const doc=root.document;
  if(!doc)return;
  const isEn=()=>String(doc.documentElement.lang||'tr').toLowerCase().startsWith('en');
  const L=(tr,en)=>isEn()?en:tr;
  const fold=value=>String(value||'').toLocaleLowerCase('tr-TR').normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/ı/g,'i');
  let overlay=null,input=null,list=null,items=[],active=0,lastTrigger=null;
  const RECENT_KEY='buyerlog.workspace.commandPalette.recent.v1';

  function click(selector){const el=doc.querySelector(selector);if(el&&!el.disabled&&!el.hidden&&el.style?.display!=='none'&&el.getAttribute('aria-disabled')!=='true'){el.click();return true;}return false;}
  function tabAllowed(button){return Boolean(button&&!button.disabled&&!button.hidden&&button.style?.display!=='none'&&button.getAttribute('aria-hidden')!=='true'&&root.BLCanAccessArea?.(button.dataset.tab));}
  function recent(){try{const value=JSON.parse((root.BLStorage||root.localStorage)?.getItem(RECENT_KEY)||'[]');return Array.isArray(value)?[...new Set(value.filter(x=>typeof x==='string'))].slice(0,5):[];}catch(_){return [];}}
  function remember(tab){try{(root.BLStorage||root.localStorage)?.setItem(RECENT_KEY,JSON.stringify([tab,...recent().filter(x=>x!==tab)].slice(0,5)));}catch(_){}}
  function goTab(tab){const button=doc.querySelector(`nav.tabs button[data-tab="${tab}"]`);if(!tabAllowed(button))return false;button.click();if(doc.body?.dataset?.activeTab===tab){remember(tab);return true;}return false;}
  function afterTab(tab,selector){if(!goTab(tab))return;let tries=0;const tick=()=>{if(doc.body?.dataset?.activeTab!==tab||!tabAllowed(doc.querySelector(`nav.tabs button[data-tab="${tab}"]`)))return;if(click(selector))return;if(++tries<20)root.setTimeout(tick,150);};root.setTimeout(tick,120);}

  function commands(){
    const modules=[...doc.querySelectorAll('nav.tabs button[data-tab]')].filter(tabAllowed).map(b=>{
      const label=(b.querySelector('span')?.textContent||b.title||b.dataset.tab).trim();
      return {id:'tab.'+b.dataset.tab,tab:b.dataset.tab,group:L('Modüller','Modules'),label,hint:L('Git','Go'),keywords:b.dataset.tab,run:()=>goTab(b.dataset.tab)};
    });
    const actions=[
      {label:L("CP Tracker'da ara (Ctrl+K)",'Search in CP Tracker (Ctrl+K)'),hint:'CP',keywords:'cp search ara tablo',run:()=>{goTab('cp');root.setTimeout(()=>doc.getElementById('cpSearch')?.focus(),60);}},
      {label:L('Veri modelinden güncelle','Refresh from data model'),hint:L('Veri','Data'),keywords:'refresh yenile sync',run:()=>click('#topRefreshBtn')},
      {label:L('Tüm değişiklikleri kaydet','Save all changes'),hint:L('Kayıt','Save'),keywords:'save kaydet',run:()=>click('#saveAllBtn')},
      {label:L('Backlog sunum raporunu aç','Open Backlog presentation report'),hint:'Backlog',keywords:'backlog rapor report html pdf sunum presentation',run:()=>afterTab('backlog','#backlogPresentBtn'),when:()=>tabAllowed(doc.querySelector('nav.tabs button[data-tab="backlog"]'))},
      {label:L('Excel Backlog V3 indir','Download Excel Backlog V3'),hint:'Backlog',keywords:'excel backlog v3 export indir',run:()=>afterTab('backlog','#backlogExportV3Btn'),when:()=>tabAllowed(doc.querySelector('nav.tabs button[data-tab="backlog"]'))},
      {label:L('Temayı değiştir','Change theme'),hint:L('Görünüm','View'),keywords:'tema theme dark karanlık light aydınlık',run:()=>click('#railThemeBtn')}, // i18n-ignore: arama anahtar kelimeleri görünmez
      {label:L('Dili değiştir (TR/EN)','Switch language (TR/EN)'),hint:L('Görünüm','View'),keywords:'dil language english türkçe',run:()=>click('#railLangBtn')},
      {label:L('Arayüz boyutunu değiştir','Change interface size'),hint:L('Görünüm','View'),keywords:'boyut size font yazı büyük compact',run:()=>click('#railFontSizeBtn')}, // i18n-ignore: arama anahtar kelimeleri görünmez
      {label:L('Menüyü daralt / genişlet','Collapse / expand menu'),hint:L('Görünüm','View'),keywords:'menu menü ray rail daralt collapse',run:()=>click('#railCollapse')},
      {label:L('Not defterini aç','Open notebook'),hint:L('Araç','Tool'),keywords:'not notebook todo',run:()=>click('#todoBtn')},
      {label:L('Bildirim geçmişi','Notification history'),hint:L('Araç','Tool'),keywords:'bildirim notification',run:()=>click('#notificationsBtn')}
    ].filter(item=>!item.when||item.when()).map(item=>({...item,group:L('Komutlar','Commands')}));
    const destinations=recent().map(tab=>modules.find(item=>item.tab===tab)).filter(Boolean).map(item=>({...item,group:L('Son açılanlar','Recent destinations')}));
    return (root.BLContextCommands?.commands?.()||[]).concat(destinations,modules,actions);
  }

  function score(item,q){
    if(!q)return 1;
    const label=fold(item.label),keys=fold(item.keywords||''),words=q.split(/\s+/).filter(Boolean);
    let s=0;
    for(const w of words){
      if(label.startsWith(w))s+=4;else if(label.includes(w))s+=2;else if(keys.includes(w))s+=1;else return 0;
    }
    return s;
  }

  function render(){
    const q=fold(input.value.trim());
    const all=commands();
    items=all.map(item=>({item,s:score(item,q)})).filter(x=>x.s>0).sort((a,b)=>b.s-a.s).map(x=>x.item);
    if(!q)items=all;
    active=Math.min(active,Math.max(0,items.length-1));
    list.textContent='';
    if(!items.length){
      const empty=doc.createElement('div');empty.className='blCmdEmpty';
      empty.textContent=L('Sonuç yok. Modül adı veya komut yazın.','No results. Type a module name or a command.');
      input.removeAttribute('aria-activedescendant');
      list.appendChild(empty);return;
    }
    let group='';
    items.forEach((item,index)=>{
      if(item.group!==group){group=item.group;const head=doc.createElement('div');head.className='blCmdGroup';head.textContent=group;head.setAttribute('role','presentation');list.appendChild(head);}
      const row=doc.createElement('div');
      row.className='blCmdItem'+(index===active?' isActive':'')+(item.disabled?' isDisabled':'');
      row.id='blCmdItem'+index;row.setAttribute('role','option');row.setAttribute('aria-selected',index===active?'true':'false');
      row.setAttribute('aria-disabled',item.disabled?'true':'false');row.dataset.commandId=item.id||'';row.title=item.reason||item.label;
      row.dataset.index=String(index);
      const label=doc.createElement('span');label.textContent=item.label;
      const hint=doc.createElement('small');hint.textContent=item.hint||'';
      row.append(label,hint);list.appendChild(row);
    });
    input.setAttribute('aria-activedescendant','blCmdItem'+active);
    list.querySelector('.isActive')?.scrollIntoView({block:'nearest'});
  }

  function build(){
    overlay=doc.createElement('div');overlay.className='blCmdOverlay';overlay.dataset.uiMigrated='remaining';overlay.hidden=true;
    overlay.innerHTML='<div class="blCmdCard" role="dialog" aria-modal="true"><div class="blCmdField"><svg class="ic" aria-hidden="true"><use href="#i-search"/></svg><input class="blCmdInput" type="text" autocomplete="off" spellcheck="false" role="combobox" aria-expanded="true" aria-controls="blCmdList"><kbd>Esc</kbd></div><div class="blCmdList" id="blCmdList" role="listbox"></div><div class="blCmdFoot"></div></div>';
    doc.body.appendChild(overlay);
    input=overlay.querySelector('.blCmdInput');list=overlay.querySelector('.blCmdList');
    input.addEventListener('input',()=>{active=0;render();});
    input.addEventListener('keydown',event=>{
      if(event.key==='ArrowDown'){event.preventDefault();active=Math.min(items.length-1,active+1);render();}
      else if(event.key==='ArrowUp'){event.preventDefault();active=Math.max(0,active-1);render();}
      else if(event.key==='Enter'){event.preventDefault();run(active);}
    });
    list.addEventListener('click',event=>{const row=event.target.closest('.blCmdItem');if(row)run(Number(row.dataset.index));});
    list.addEventListener('mousemove',event=>{const row=event.target.closest('.blCmdItem');if(row&&Number(row.dataset.index)!==active){active=Number(row.dataset.index);render();}});
    overlay.addEventListener('pointerdown',event=>{if(event.target===overlay)close();});
  }

  function localize(){
    overlay.querySelector('.blCmdCard').setAttribute('aria-label',L('Komut paleti','Command palette'));
    input.placeholder=L('Modül veya komut ara…','Search modules or commands…');
    input.setAttribute('aria-label',input.placeholder);
    overlay.querySelector('.blCmdFoot').textContent=L('↑↓ seç · Enter çalıştır · Esc kapat','↑↓ select · Enter run · Esc close');
  }

  function open(){
    if(!overlay)build();
    if(!overlay.hidden)return;
    lastTrigger=doc.activeElement;
    localize();input.value='';active=0;render();
    overlay.hidden=false;
    if(root.BLLayerSystem?.openDialog)root.BLLayerSystem.openDialog(overlay,{onClose:close,initialFocus:input});
    else input.focus();
  }
  function close(){
    if(!overlay||overlay.hidden)return;
    overlay.hidden=true;
    if(root.BLLayerSystem?.closeDialog)root.BLLayerSystem.closeDialog(overlay);
    else lastTrigger?.focus?.();
  }
  function run(index){
    const item=items[index];if(!item)return;
    if(item.disabled){root.BLUI?.notify?.(item.reason||item.hint,{kind:'info',language:isEn()?'en':'tr'});return;}
    close();
    root.setTimeout(async()=>{try{await item.run();}catch(error){console.error('[command-palette]',error);root.BLUI?.notify?.(String(error?.message||error),{kind:'error',language:isEn()?'en':'tr'});}},0);
  }

  // Ctrl+K mevcut "CP Tracker'da ara" kısayoludur ve korunur. Palet Ctrl+Shift+K ile
  // açılır; eski işleyici Shift'e bakmadığı için olay yakalama aşamasında durdurulur.
  root.addEventListener('keydown',event=>{
    if(!(event.ctrlKey||event.metaKey)||event.altKey||!event.shiftKey)return;
    if(String(event.key).toLowerCase()!=='k')return;
    event.preventDefault();event.stopImmediatePropagation();
    overlay&&!overlay.hidden?close():open();
  },true);

  root.BLCommandPalette={open,close,commands};
  root.addEventListener('bl:user-access-applied',()=>{if(overlay&&!overlay.hidden)render();});
})(typeof window!=='undefined'?window:globalThis);
