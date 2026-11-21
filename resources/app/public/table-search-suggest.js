/* Tablo araması için kısayol önerileri. İmlecin bulunduğu terim bir alan adına
 * benziyorsa ("MB", "SEZ") alanları, "MB=" / "SEZON=" yazıldıysa tablodaki
 * değerleri satır sayısıyla önerir. Liste kendiliğinden hiçbir şeyi değiştirmez:
 * Enter/Tab yalnız ok tuşuyla bir öneri seçiliyken uygular; tıklama da uygular.
 * Veri kaynağı: BLTableSearch.fieldTokenTexts(inputId) → satır başına jeton metni.
 */
(function(root,factory){
  'use strict';
  const api=factory(root);
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.BLTableSearchSuggest=api;
  if(root&&root.document)api.attachAll(root.document);
})(typeof globalThis!=='undefined'?globalThis:this,function(root){
  'use strict';

  const TARGET_IDS=['cpSearch','ordersSearch','kolSearch'];
  const LIST_ID='tableSearchSuggestList';
  const MAX_ITEMS=14;
  const FIELDS=[
    {insert:'MB=',match:['mb'],tr:'Model Budget hafta (W) / ay (M)',en:'Model Budget week (W) / month (M)'},
    {insert:'EXF=',match:['exf','ex','exfactory'],tr:'Ex-Factory hafta / ay',en:'Ex-Factory week / month'},
    {insert:'RT=',match:['rt','retail'],tr:'Retail hafta / ay',en:'Retail week / month'},
    {insert:'SEZON=',insertEn:'SEASON=',match:['sezon','season'],tr:'Sezon, örn. S7',en:'Season, e.g. S7'},
  ];

  const isEnglish=()=>{try{return root.appLang==='en'||(typeof appLang!=='undefined'&&appLang==='en');}catch(_){return false;}};
  const periods=()=>root.BLTableSearchPeriods||null;

  /* İmleçteki terim: son ", " / "; " / "(" ayracından imlece kadar; ! ve / öneki korunur. */
  function currentSegment(value,caret){
    const text=String(value==null?'':value),end=caret==null?text.length:caret;
    const before=text.slice(0,end);
    // Ayraç yoksa (aramanın ilk terimi) başlangıç 0'dır; -1+2 ilk harfi kesmesin.
    const after=(token,width)=>{const at=before.lastIndexOf(token);return at<0?0:at+width;};
    const start=Math.max(after(', ',2),after('; ',2),after('(',1));
    const raw=before.slice(start);
    const marker=/^[!/]/.test(raw)?raw[0]:'';
    return {start:start+marker.length,end,text:raw.slice(marker.length)};
  }

  /* Saf öneri üretimi. texts: satır jeton metinleri (yalnız değer önerisi için okunur). */
  function suggestions(segmentText,textsProvider,english){
    const seg=String(segmentText||'');
    const low=seg.toLowerCase();
    const eq=low.indexOf('=');
    if(eq<0){
      if(low.length<2||!/^[a-z-]+$/.test(low))return [];
      return FIELDS.filter(field=>field.match.some(alias=>alias.startsWith(low.replace(/-/g,''))))
        .map(field=>({insert:english&&field.insertEn?field.insertEn:field.insert,label:english&&field.insertEn?field.insertEn:field.insert,detail:english?field.en:field.tr,keepOpen:true}));
    }
    const P=periods();if(!P)return [];
    const fieldKey=P.FIELD_ALIASES[low.slice(0,eq).trim().replace(/-/g,'')];
    if(!fieldKey)return [];
    const prefix=seg.slice(0,eq+1),partial=low.slice(eq+1).trim();
    if(partial.indexOf('-')>=0||/^\d{4}/.test(partial))return [];
    const texts=typeof textsProvider==='function'?textsProvider():textsProvider;
    const rows=n=>english?`${n} row${n===1?'':'s'}`:`${n} satır`;
    if(fieldKey==='sz'){
      const counts=P.countTokens(texts,'sz');
      return [...counts.entries()].sort((a,b)=>a[0].localeCompare(b[0],'tr',{numeric:true}))
        .filter(([key])=>!partial||key.startsWith(partial.replace(/[^a-z0-9]/g,'')))
        .map(([key,count])=>({insert:prefix+key.toUpperCase(),label:prefix+key.toUpperCase(),detail:rows(count)}));
    }
    const unit=/^[wh]/.test(partial)?'w':'m';
    const counts=P.countTokens(texts,fieldKey,unit);
    const max=unit==='m'?12:53;
    const numbers=counts.size?[...counts.keys()].map(Number).sort((a,b)=>a-b):Array.from({length:unit==='m'?12:0},(_,i)=>i+1);
    const letter=unit==='m'?'M':'W';
    const typed=partial.replace(/^[a-z]/,'');
    return numbers.filter(n=>n>=1&&n<=max&&(!typed||String(n).startsWith(typed)))
      .map(n=>{
        const count=counts.get(String(n).padStart(2,'0'));
        const name=unit==='m'?P.monthName(n,english):(english?`Week ${n}`:`${n}. hafta`);
        return {insert:prefix+letter+n,label:prefix+letter+n,detail:count?`${name} · ${rows(count)}`:name};
      });
  }

  let list=null,activeInput=null,items=[],activeIndex=-1,segment=null,textsCache={inputId:'',at:0,texts:null};

  function texts(inputId){
    const now=Date.now();
    if(textsCache.inputId===inputId&&now-textsCache.at<3000)return textsCache.texts;
    let value=[];
    try{value=root.BLTableSearch?.fieldTokenTexts?.(inputId)||[];}catch(_){value=[];}
    textsCache={inputId,at:now,texts:value};
    return value;
  }

  function esc(value){
    return String(value==null?'':value).replace(/[&<>'"]/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]));
  }

  function close(){
    if(list)list.remove();
    list=null;items=[];activeIndex=-1;segment=null;
    if(activeInput){
      activeInput.setAttribute('aria-expanded','false');
      activeInput.removeAttribute('aria-activedescendant');
    }
  }

  function position(){
    if(!list||!activeInput)return;
    const rect=activeInput.getBoundingClientRect();
    const width=Math.max(rect.width,260);
    list.style.left=Math.round(Math.max(8,Math.min(rect.left,root.innerWidth-width-8)))+'px';
    list.style.top=Math.round(rect.bottom+4)+'px';
    list.style.minWidth=Math.round(width)+'px';
  }

  function setActive(index){
    activeIndex=index;
    if(!list)return;
    list.querySelectorAll('[role="option"]').forEach((option,i)=>{
      const on=i===index;option.setAttribute('aria-selected',on?'true':'false');
      if(on)option.scrollIntoView?.({block:'nearest'});
    });
    if(index>=0)activeInput.setAttribute('aria-activedescendant',LIST_ID+'-'+index);
    else activeInput.removeAttribute('aria-activedescendant');
  }

  function open(input){
    const english=isEnglish();
    segment=currentSegment(input.value,input.selectionStart);
    items=suggestions(segment.text,()=>texts(input.id),english).slice(0,MAX_ITEMS);
    if(!items.length){close();return;}
    activeInput=input;
    if(!list){
      list=root.document.createElement('div');
      list.id=LIST_ID;list.className='tableSearchSuggest';list.setAttribute('role','listbox');
      root.document.body.appendChild(list);
      list.addEventListener('mousedown',event=>event.preventDefault());
      list.addEventListener('click',event=>{
        const option=event.target.closest('[data-suggest-index]');
        if(option)apply(Number(option.dataset.suggestIndex));
      });
    }
    list.setAttribute('aria-label',english?'Search shortcut suggestions':'Arama kısayolu önerileri');
    list.innerHTML=items.map((item,i)=>`<div role="option" id="${LIST_ID}-${i}" class="tableSearchSuggestItem" data-suggest-index="${i}" aria-selected="false"><code>${esc(item.label)}</code><span>${esc(item.detail)}</span></div>`).join('');
    input.setAttribute('aria-expanded','true');
    input.setAttribute('aria-controls',LIST_ID);
    activeIndex=-1;input.removeAttribute('aria-activedescendant');
    position();
  }

  function apply(index){
    const item=items[index],input=activeInput;
    if(!item||!input||!segment)return;
    const value=input.value;
    input.value=value.slice(0,segment.start)+item.insert+value.slice(segment.end);
    const caret=segment.start+item.insert.length;
    try{input.setSelectionRange(caret,caret);}catch(_){}
    input.dispatchEvent(new root.Event('input',{bubbles:true}));
    input.focus({preventScroll:true});
    if(item.keepOpen)open(input);else close();
  }

  function onKeydown(event){
    if(!list||activeInput!==event.target)return;
    if(event.key==='ArrowDown'||event.key==='ArrowUp'){
      event.preventDefault();
      const step=event.key==='ArrowDown'?1:-1;
      // -1 = öneri seçili değil (Enter normal davranır); uçlardan sarar.
      let next=activeIndex+step;
      if(next>=items.length)next=-1;else if(next<-1)next=items.length-1;
      setActive(next);
    }else if((event.key==='Enter'||event.key==='Tab')&&activeIndex>=0){
      event.preventDefault();event.stopPropagation();apply(activeIndex);
    }else if(event.key==='Escape'){
      event.preventDefault();event.stopPropagation();close();
    }
  }

  function attach(input){
    if(!input||input.dataset.searchSuggestBound==='1')return;
    input.dataset.searchSuggestBound='1';
    input.setAttribute('aria-autocomplete','list');
    input.setAttribute('aria-expanded','false');
    // Yalnız kullanıcı yazarken açılır; kip kaldırma gibi programatik güncellemeler açmaz.
    input.addEventListener('input',event=>{if(event.isTrusted)open(input);});
    input.addEventListener('keydown',onKeydown,true);
    input.addEventListener('blur',()=>{if(activeInput===input)close();});
  }

  function attachAll(doc){
    const run=()=>TARGET_IDS.forEach(id=>attach(doc.getElementById(id)));
    if(doc.readyState==='loading')doc.addEventListener('DOMContentLoaded',run,{once:true});else run();
    if(root.addEventListener){
      root.addEventListener('resize',position);
      root.addEventListener('scroll',position,true);
    }
  }

  return {currentSegment,suggestions,attachAll,close};
});
