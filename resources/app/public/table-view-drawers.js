/* Buyer Log — CP / Orders / Collection view pickers.
   Existing preset, price and Fields buttons remain the source of truth.
   This module owns only the compact popover and its accessible trigger. */
(function(){
  'use strict';
  const pickers=[];
  const isEnglish=()=>document.querySelector('[data-table-view-preset="focus"] span')?.textContent.trim()==='Focus'
    ||document.documentElement.lang==='en';
  const buttonLabel=button=>button?.querySelector('span')?.textContent.trim()||button?.textContent.trim()||'';

  function close(picker,restoreFocus){
    if(picker.menu.hidden)return;
    picker.menu.hidden=true;
    picker.trigger.setAttribute('aria-expanded','false');
    picker.root.classList.remove('isOpen');
    if(restoreFocus)picker.trigger.focus({preventScroll:true});
  }
  function closeOthers(except){
    pickers.forEach(picker=>{if(picker!==except)close(picker,false);});
  }
  function reposition(picker){
    if(picker.menu.hidden)return;
    const rect=picker.trigger.getBoundingClientRect();
    const width=picker.menu.offsetWidth,height=picker.menu.offsetHeight;
    const left=Math.max(8,Math.min(rect.left,window.innerWidth-width-8));
    const bottom=window.innerHeight-rect.bottom;
    const top=bottom>=height+8||bottom>=rect.top
      ?rect.bottom+5:Math.max(8,rect.top-height-5);
    picker.menu.style.left=left+'px';
    picker.menu.style.top=top+'px';
  }
  function open(picker,focusOption){
    closeOthers(picker);
    picker.menu.hidden=false;
    picker.root.classList.add('isOpen');
    picker.trigger.setAttribute('aria-expanded','true');
    reposition(picker);
    if(focusOption){
      const selected=picker.menu.querySelector('[aria-pressed="true"]');
      (selected||picker.menu.querySelector('button'))?.focus({preventScroll:true});
    }
  }
  function sync(picker){
    const chosen=picker.menu.querySelector('[aria-pressed="true"]');
    const en=isEnglish();
    const label=chosen?buttonLabel(chosen):(en?'Custom':'Özel');
    const current=picker.trigger.querySelector('[data-bl-view-current]');
    if(current&&current.textContent!==label)current.textContent=label;
    const prefix=picker.price?(en?'Price view':'Fiyat görünümü'):(en?'Table view':'Tablo görünümü');
    const accessible=prefix+': '+label;
    if(picker.trigger.getAttribute('aria-label')!==accessible)picker.trigger.setAttribute('aria-label',accessible);
  }
  function mount(root){
    const trigger=root.querySelector('[data-bl-view-trigger]');
    const menu=root.querySelector('.blViewPickerMenu');
    if(!trigger||!menu)return;
    const picker={root,trigger,menu,price:root.hasAttribute('data-bl-price-picker')};
    pickers.push(picker);
    sync(picker);
    // app-main updates aria-pressed after every render, including language changes.
    const observer=new MutationObserver(()=>sync(picker));
    observer.observe(menu,{subtree:true,attributes:true,attributeFilter:['aria-pressed'],childList:true,characterData:true});
    trigger.addEventListener('click',()=>{
      if(menu.hidden)open(picker,false);else close(picker,false);
    });
    trigger.addEventListener('keydown',event=>{
      if(event.key==='ArrowDown'||event.key==='ArrowUp'){
        event.preventDefault();open(picker,true);
      }
    });
    menu.addEventListener('click',event=>{
      if(event.target.closest('button'))close(picker,false);
    });
    menu.addEventListener('keydown',event=>{
      if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close(picker,true);return;}
      if(event.key==='Tab'){close(picker,false);return;}
      if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key))return;
      const buttons=[...menu.querySelectorAll('button:not(:disabled)')];
      if(!buttons.length)return;
      const current=buttons.indexOf(document.activeElement);
      const next=event.key==='Home'?0:event.key==='End'?buttons.length-1:
        (current+(event.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length;
      event.preventDefault();
      buttons[next].focus({preventScroll:true});
    });
  }
  function mountVariants(){
    const button=document.getElementById('kolAllVariantsToggle');
    const label=button?.querySelector('[data-bl-variant-label]');
    if(!button||!label)return;
    const sync=()=>{
      const en=isEnglish(),expanded=button.getAttribute('aria-pressed')!=='false';
      const text=button.disabled
        ?(en?'No options to expand':'Genişletilecek opsiyon yok')
        :(expanded?(en?'Collapse options':'Opsiyonları daralt'):(en?'Expand options':'Opsiyonları genişlet'));
      if(label.textContent!==text)label.textContent=text;
      if(button.getAttribute('aria-label')!==text)button.setAttribute('aria-label',text);
      if(button.title!==text)button.title=text;
    };
    new MutationObserver(sync).observe(button,{attributes:true,attributeFilter:['aria-pressed','disabled','title']});
    // Locale changes update the data-i18n element; reflect its final state in the label.
    new MutationObserver(sync).observe(label,{childList:true,characterData:true,subtree:true});
    sync();
  }
  document.querySelectorAll('.blViewPicker').forEach(mount);
  mountVariants();
  document.addEventListener('pointerdown',event=>{
    pickers.forEach(picker=>{
      if(!picker.menu.hidden&&!picker.root.contains(event.target))close(picker,false);
    });
  },true);
  document.addEventListener('keydown',event=>{
    if(event.key!=='Escape')return;
    const opened=pickers.find(picker=>!picker.menu.hidden);
    if(opened){event.preventDefault();close(opened,true);}
  });
  window.addEventListener('resize',()=>pickers.forEach(reposition));
  window.addEventListener('scroll',()=>pickers.forEach(reposition),true);
})();
