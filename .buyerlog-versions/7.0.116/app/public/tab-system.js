(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root&&root.document){root.BLTabSystem=api;api.mount(root.document);}
})(typeof window!=='undefined'?window:null,function(){
  'use strict';

  function nextTabIndex(current,length,key,orientation='horizontal'){
    if(!Number.isInteger(current)||length<1)return null;
    if(key==='Home')return 0;
    if(key==='End')return length-1;
    const vertical=orientation==='vertical';
    if((vertical&&key==='ArrowDown')||(!vertical&&key==='ArrowRight'))return (current+1)%length;
    if((vertical&&key==='ArrowUp')||(!vertical&&key==='ArrowLeft'))return (current-1+length)%length;
    return null;
  }

  function directTabs(tablist){
    if(!tablist?.querySelectorAll)return [];
    return [...tablist.querySelectorAll('[role="tab"]')].filter(tab=>tab.closest('[role="tablist"]')===tablist);
  }

  function availableTabs(tablist){
    return directTabs(tablist).filter(tab=>!tab.disabled&&tab.getAttribute('aria-disabled')!=='true'&&!tab.hidden&&!tab.closest('[hidden]'));
  }

  function syncTablist(tablist){
    const tabs=availableTabs(tablist);
    if(!tabs.length)return;
    const active=tabs.find(tab=>tab.getAttribute('aria-selected')==='true')||tabs[0];
    tabs.forEach(tab=>{
      const selected=tab===active;
      tab.setAttribute('tabindex',selected?'0':'-1');
    });
  }

  function syncAll(scope){
    if(!scope?.querySelectorAll)return;
    scope.querySelectorAll('[role="tablist"]').forEach(syncTablist);
  }

  function handleKeydown(event){
    if(event.altKey||event.ctrlKey||event.metaKey)return;
    const tab=event.target?.closest?.('[role="tab"]');
    const tablist=tab?.closest?.('[role="tablist"]');
    if(!tab||!tablist||tab.closest('[role="tablist"]')!==tablist)return;
    const tabs=availableTabs(tablist),current=tabs.indexOf(tab);
    const index=nextTabIndex(current,tabs.length,event.key,tablist.getAttribute('aria-orientation')||'horizontal');
    if(index==null)return;
    event.preventDefault();
    const next=tabs[index];
    next.setAttribute('tabindex','-1');
    next.focus();
  }

  function mount(doc){
    if(!doc?.addEventListener)return;
    doc.addEventListener('keydown',handleKeydown);
    doc.addEventListener('click',event=>{
      const tablist=event.target?.closest?.('[role="tab"]')?.closest?.('[role="tablist"]');
      if(tablist)queueMicrotask(()=>syncTablist(tablist));
    });
    const ready=()=>syncAll(doc);
    if(doc.readyState==='loading')doc.addEventListener('DOMContentLoaded',ready,{once:true});else ready();
  }

  return {nextTabIndex,directTabs,availableTabs,syncTablist,syncAll,handleKeydown,mount};
});
