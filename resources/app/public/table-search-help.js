(function(global){
  'use strict';

  const TARGET_IDS=['cpSearch','ordersSearch','kolSearch'];
  const POPOVER_ID='tableSearchHelpPopover';
  let activeButton=null;
  let popover=null;
  let ensureQueued=false;
  let measureContext=null;

  function isEnglish(){
    try{return typeof appLang!=='undefined'&&appLang==='en';}catch(_){return false;}
  }

  function copy(){
    if(isEnglish()){
      return {
        button:'Search help',
        title:'How search works',
        intro:'You can search one or many values in the same box.',
        rows:[
          ['ABC123','Finds rows containing this value.'],
          ['ABC123, ABC456','Comma + space = OR. Either value may match.'],
          ['Disney; Bangladesh','Semicolon + space = AND. Both conditions must match the same row.'],
          ['Disney; !Bangladesh','! = must not contain the value.'],
        ],
        excelTitle:'Paste from Excel',
        excel:'Copy one or more Excel cells and paste them directly into the search box. Rows and columns are flattened, empty cells are ignored, duplicates are removed, and the values are searched as OR automatically.',
        note:'Tip: separators intentionally include a following space. This keeps decimal values such as 13,50 as one search value.'
      };
    }
    return {
      button:'Arama kullanımı',
      title:'Arama nasıl çalışır?',
      intro:'Aynı kutuda tek veya birden fazla değeri arayabilirsiniz.',
      rows:[
        ['ABC123','Bu değeri içeren kayıtları bulur.'],
        ['ABC123, ABC456','Virgül + boşluk = VEYA. Değerlerden birinin eşleşmesi yeterlidir.'],
        ['Disney; Bangladesh','Noktalı virgül + boşluk = VE. Aynı kayıtta iki koşul da bulunmalıdır.'],
        ['Disney; !Bangladesh','! = bu değeri içermesin.'],
      ],
      excelTitle:'Excel’den yapıştırma',
      excel:'Excel’de bir veya birden fazla hücreyi kopyalayıp doğrudan arama kutusuna yapıştırın. Satır ve sütunlar tek listeye çevrilir; boş hücreler atılır, tekrar edenler tekilleştirilir ve değerler otomatik olarak VEYA şeklinde aranır.',
      note:'İpucu: Ayraçlardan sonra boşluk kullanılır. Böylece 13,50 gibi ondalık değerler tek arama değeri olarak kalır.'
    };
  }

  function esc(value){
    return String(value==null?'':value).replace(/[&<>'"]/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]));
  }

  function inputContentWidth(input){
    const value=String(input&&input.value||'');
    if(!value)return 0;
    const style=getComputedStyle(input);
    let width=0;
    try{
      if(!measureContext){
        const canvas=document.createElement('canvas');
        measureContext=canvas.getContext('2d');
      }
      if(measureContext){
        measureContext.font=style.font||[style.fontWeight,style.fontSize,style.fontFamily].filter(Boolean).join(' ');
        width=measureContext.measureText(value).width;
        const spacing=parseFloat(style.letterSpacing||'0');
        if(Number.isFinite(spacing))width+=Math.max(0,value.length-1)*spacing;
      }
    }catch(_){}
    if(!(width>0))width=value.length*Math.max(7,(parseFloat(style.fontSize)||12)*0.58);
    const chrome=(parseFloat(style.paddingLeft)||0)+(parseFloat(style.paddingRight)||0)+
      (parseFloat(style.borderLeftWidth)||0)+(parseFloat(style.borderRightWidth)||0)+34;
    return Math.ceil(width+chrome);
  }

  function expandedInputMetrics(input){
    const rect=input.getBoundingClientRect();
    const base=input.classList.contains('tableSearchInputExpanded')
      ?(Number(input.dataset.searchBaseWidth)||rect.width)
      :rect.width;
    const desired=inputContentWidth(input);
    const toolbar=input.closest('.tableActionToolbar');
    const edge=toolbar?toolbar.getBoundingClientRect().right:window.innerWidth;
    const max=Math.max(base,Math.floor(Math.min(window.innerWidth-10,edge)-rect.left-8));
    return {base,desired,max,width:Math.max(base,Math.min(desired,max)),overflow:desired>base+4};
  }

  function setInputExpanded(input,expanded){
    if(!input)return;
    if(expanded&&!input.classList.contains('tableSearchInputExpanded')){
      input.dataset.searchBaseWidth=String(Math.ceil(input.getBoundingClientRect().width));
    }
    const metrics=expandedInputMetrics(input);
    input.classList.toggle('tableSearchInputOverflowing',metrics.overflow);
    if(expanded&&metrics.overflow){
      input.style.setProperty('--table-search-hover-width',Math.ceil(metrics.width)+'px');
      input.classList.add('tableSearchInputExpanded');
      return;
    }
    input.classList.remove('tableSearchInputExpanded');
    input.style.removeProperty('--table-search-hover-width');
    delete input.dataset.searchBaseWidth;
  }

  function bindExpandableInput(input){
    if(!input||input.dataset.searchHoverExpandBound==='1')return;
    input.dataset.searchHoverExpandBound='1';
    input.classList.add('tableSearchInputExpandable');
    input.addEventListener('pointerenter',()=>setInputExpanded(input,true));
    input.addEventListener('pointerleave',()=>{if(document.activeElement!==input)setInputExpanded(input,false);});
    input.addEventListener('focus',()=>setInputExpanded(input,true));
    input.addEventListener('blur',()=>{if(!input.matches(':hover'))setInputExpanded(input,false);});
    input.addEventListener('input',()=>{
      const active=document.activeElement===input||input.matches(':hover');
      setInputExpanded(input,active);
    });
  }

  function closePopover(refocus){
    const button=activeButton;
    if(popover)popover.remove();
    popover=null;
    activeButton=null;
    if(button){
      button.setAttribute('aria-expanded','false');
      if(refocus&&button.isConnected)button.focus({preventScroll:true});
    }
  }

  function positionPopover(){
    if(!popover||!activeButton||!activeButton.isConnected)return;
    const rect=activeButton.getBoundingClientRect();
    const margin=8,gap=6;
    const width=popover.offsetWidth||340;
    const height=popover.offsetHeight||260;
    let left=rect.right-width;
    left=Math.max(margin,Math.min(left,window.innerWidth-width-margin));
    let top=rect.bottom+gap;
    if(top+height>window.innerHeight-margin&&rect.top-height-gap>=margin)top=rect.top-height-gap;
    top=Math.max(margin,Math.min(top,window.innerHeight-height-margin));
    popover.style.left=Math.round(left)+'px';
    popover.style.top=Math.round(top)+'px';
  }

  function openPopover(button){
    if(activeButton===button&&popover){closePopover(true);return;}
    closePopover(false);
    const text=copy();
    popover=document.createElement('div');
    popover.id=POPOVER_ID;
    popover.className='tableSearchHelpPopover';
    popover.setAttribute('role','dialog');
    popover.setAttribute('aria-label',text.title);
    popover.innerHTML=
      '<div class="tableSearchHelpHead"><strong>'+esc(text.title)+'</strong><button type="button" class="tableSearchHelpClose" aria-label="'+esc(isEnglish()?'Close':'Kapat')+'">×</button></div>'+
      '<p class="tableSearchHelpIntro">'+esc(text.intro)+'</p>'+
      '<div class="tableSearchHelpExamples">'+text.rows.map(row=>
        '<div class="tableSearchHelpExample"><code>'+esc(row[0])+'</code><span>'+esc(row[1])+'</span></div>'
      ).join('')+'</div>'+
      '<div class="tableSearchHelpExcel"><strong>'+esc(text.excelTitle)+'</strong><span>'+esc(text.excel)+'</span></div>'+
      '<div class="tableSearchHelpNote">'+esc(text.note)+'</div>';
    document.body.appendChild(popover);
    activeButton=button;
    button.setAttribute('aria-expanded','true');
    button.setAttribute('aria-controls',POPOVER_ID);
    popover.querySelector('.tableSearchHelpClose')?.addEventListener('click',()=>closePopover(true));
    requestAnimationFrame(positionPopover);
  }

  function createButton(input){
    if(!input||!input.parentElement)return false;
    bindExpandableInput(input);
    const selector='.tableSearchHelpButton[data-search-help-for="'+input.id+'"]';
    const found=Array.from(document.querySelectorAll(selector));
    let button=found.find(item=>item.previousElementSibling===input)||found[0]||null;
    let changed=false;
    for(const extra of found){
      if(extra===button)continue;
      if(extra===activeButton)closePopover(false);
      extra.remove();
      changed=true;
    }
    if(!button){
      const text=copy();
      button=document.createElement('button');
      button.type='button';
      button.className='tableSearchHelpButton';
      button.dataset.searchHelpFor=input.id;
      button.textContent='i';
      button.title=text.button;
      button.setAttribute('aria-label',text.button);
      button.setAttribute('aria-expanded','false');
      button.setAttribute('data-i18n-title-tr','Arama kullanımı');
      button.setAttribute('data-i18n-title-en','Search help');
      button.setAttribute('data-i18n-aria-label-tr','Arama kullanımı');
      button.setAttribute('data-i18n-aria-label-en','Search help');
      changed=true;
    }
    button.dataset.tbPriority='pinned';
    button.dataset.tbOverflow='never';
    if(button.dataset.searchHelpBound!=='1'){
      button.dataset.searchHelpBound='1';
      button.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();openPopover(button);});
    }
    if(input.nextElementSibling!==button){
      input.insertAdjacentElement('afterend',button);
      changed=true;
    }
    return changed;
  }

  function ensureButtons(){
    ensureQueued=false;
    const touched=new Set();
    TARGET_IDS.forEach(id=>{
      const input=document.getElementById(id);
      if(createButton(input)){
        const toolbar=input?.closest?.('[data-responsive-toolbar]');
        if(toolbar)touched.add(toolbar);
      }
    });
    touched.forEach(toolbar=>global.BLToolbarResponsive?.refresh?.(toolbar,{remeasure:true}));
  }

  function scheduleEnsure(){
    if(ensureQueued)return;
    ensureQueued=true;
    requestAnimationFrame(ensureButtons);
  }

  document.addEventListener('mousedown',event=>{
    if(!popover)return;
    if(popover.contains(event.target)||activeButton?.contains(event.target))return;
    closePopover(false);
  },true);
  document.addEventListener('keydown',event=>{
    if(event.key==='Escape'&&popover){event.preventDefault();closePopover(true);}
  });
  window.addEventListener('resize',()=>{
    positionPopover();
    TARGET_IDS.forEach(id=>{
      const input=document.getElementById(id);
      if(input&&!input.classList.contains('tableSearchInputExpanded'))setInputExpanded(input,false);
    });
  });
  window.addEventListener('scroll',positionPopover,true);

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',ensureButtons,{once:true});
  else ensureButtons();

  const observer=new MutationObserver(scheduleEnsure);
  observer.observe(document.documentElement,{childList:true,subtree:true});

  global.BLTableSearchHelp={ensure:ensureButtons,close:closePopover};
})(globalThis);
