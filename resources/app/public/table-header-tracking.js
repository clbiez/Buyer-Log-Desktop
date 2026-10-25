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
    const viewport=wrap.getBoundingClientRect();
    const frozenEdge=thead.querySelector('tr.colRow th.frzLEdge');
    const freezeRight=frozenEdge?frozenEdge.getBoundingClientRect().right:viewport.left;
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
      const result=computeTrack(th.getBoundingClientRect(),viewport,freezeRight,th.classList.contains('frzL'));
      label.style.visibility=result.visible?'visible':'hidden';
      if(result.visible){
        label.style.maxWidth=result.maxWidth+'px';
        label.style.transform='translate3d('+result.dx+'px,0,0)';
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
