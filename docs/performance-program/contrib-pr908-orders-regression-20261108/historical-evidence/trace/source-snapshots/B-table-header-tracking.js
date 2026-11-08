/* Buyer Log — shared CP / Orders / Collection grouped heading tracking. */
(function(){
  'use strict';
  const ids=['cpTable','ordersTable','kolTable'], wraps=new Set(), pending=new Set();
  function computeTrack(group,viewport,freezeEdge,isFrozen){
    if(!group||group.right<=group.left)return {visible:false,dx:0,maxWidth:0};
    const minX=isFrozen?viewport.left:Math.max(viewport.left,freezeEdge||viewport.left);
    const left=Math.max(group.left,minX),right=Math.min(group.right,viewport.right);
    if(right-left<8)return {visible:false,dx:0,maxWidth:0};
    return {visible:true,dx:Math.round((left+right-group.left-group.right)/2),maxWidth:Math.max(0,Math.floor(right-left-12))};
  }
  window.BLTableGroupTracking=Object.freeze({computeTrack});
  function update(wrap){
    const table=wrap.querySelector('table'),thead=table&&table.tHead;
    if(!thead||!wrap.clientWidth)return;
    // Prepare new captions before measuring; header renderers replace rows.
    const labels=[];
    thead.querySelectorAll('tr.groupRow th[data-grp]').forEach(th=>{
      let label=th.querySelector(':scope > .blGroupFollowLabel');
      if(!label){
        const nodes=[...th.childNodes].filter(node=>node.nodeType===3&&node.textContent.trim());
        if(!nodes.length)return;
        label=document.createElement('span');
        label.className='blGroupFollowLabel';
        th.insertBefore(label,nodes[0]);
        nodes.forEach(node=>label.appendChild(node));
      }
      labels.push({th,label});
    });
    const viewport=wrap.getBoundingClientRect();
    const frozenEdge=thead.querySelector('tr.colRow th.frzLEdge');
    // İki bölmeli dondurmada donmuş bölme kendi içinde kayar; sınırı bölme genişliğidir.
    const pane=Number(table.getAttribute('data-bl-freeze-pane'))||0;
    const paneRight=pane?viewport.left+wrap.clientLeft+pane:Infinity;
    const freezeRight=frozenEdge?Math.min(frozenEdge.getBoundingClientRect().right,paneRight):viewport.left;
    const frozenView={left:viewport.left,right:Math.min(viewport.right,paneRight)};
    const groupHeight=thead.querySelector('tr.groupRow')?.offsetHeight||0;
    const columns=groupHeight?[...thead.querySelectorAll('tr.colRow th')]:[];
    const measured=labels.map(({th,label})=>{
      const frozen=th.classList.contains('frzL');
      const result=computeTrack(th.getBoundingClientRect(),frozen?frozenView:viewport,freezeRight,frozen);
      return {label,result};
    });
    // Wrapping captions can change the band height after the renderer's rAF.
    const top=groupHeight+'px';
    columns.forEach(th=>{if(th.style.top!==top)th.style.top=top;});
    measured.forEach(({label,result})=>{
      const visibility=result.visible?'visible':'hidden';
      if(label.style.visibility!==visibility)label.style.visibility=visibility;
      if(result.visible){
        const maxWidth=result.maxWidth+'px',transform='translate3d('+result.dx+'px, 0px, 0px)';
        if(label.style.maxWidth!==maxWidth)label.style.maxWidth=maxWidth;
        if(label.style.transform!==transform)label.style.transform=transform;
      }
    });
  }
  function schedule(wrap){
    if(pending.has(wrap))return;
    pending.add(wrap);
    requestAnimationFrame(()=>{
      pending.delete(wrap);
      if(wrap.isConnected)update(wrap);
    });
  }
  function install(){
    ids.forEach(id=>{
      const table=document.getElementById(id),wrap=table&&table.closest('.tablewrap'),thead=table&&table.tHead;
      if(!wrap||!thead||wraps.has(wrap))return;
      wraps.add(wrap);
      wrap.addEventListener('scroll',()=>schedule(wrap),{passive:true});
      wrap.addEventListener('blfreezepanescroll',()=>schedule(wrap));
      // Both header renderers replace rows; observe just those children.
      new MutationObserver(()=>schedule(wrap)).observe(thead,{childList:true});
      if(typeof ResizeObserver==='function'){
        const observer=new ResizeObserver(()=>schedule(wrap));
        observer.observe(wrap);
        observer.observe(table);
      }
      schedule(wrap);
    });
    window.addEventListener('resize',()=>wraps.forEach(schedule),{passive:true});
    document.addEventListener('pointerup',()=>wraps.forEach(schedule),true);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});
  else install();
})();
