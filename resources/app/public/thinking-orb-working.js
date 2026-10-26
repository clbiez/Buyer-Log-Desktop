/* Adapted from Jakub Antalik / thinking-orbs "working" state (MIT, 2026).
 * Dependency-free Canvas port for Buyer Log map loading.
 */
(function(root){
'use strict';if(!root||!root.document)return;
function attach(canvas){
  if(!canvas||typeof canvas.getContext!=='function')return {stop:function(){}};
  const ctx=canvas.getContext('2d'),trails=Array.from({length:3},()=>[]),tilts=[-.62,.08,.72],offsets=[0,Math.PI*2/3,Math.PI*4/3];
  let raf=0,running=true,last=0,phase=0,intersecting=true,io=null,motionObserver=null;
  const reduced=root.matchMedia?.('(prefers-reduced-motion: reduce)');
  const motionAllowed=()=>!reduced?.matches&&root.document.visibilityState!=='hidden'&&root.document.documentElement.dataset?.blMotion!=='off';
  function schedule(){if(running&&intersecting&&motionAllowed()&&!raf)raf=root.requestAnimationFrame(frame);}
  function onVisibility(){if(motionAllowed())schedule();else if(raf){root.cancelAnimationFrame(raf);raf=0;}}
  root.document.addEventListener('visibilitychange',onVisibility);
  function colour(){try{const style=getComputedStyle(document.documentElement);return style.getPropertyValue('--acc-ink').trim()||style.getPropertyValue('--acc').trim()||'#4f83ad';}catch(_){return '#4f83ad';}}
  // Boyut her karede değil, yalnız ilk karede ve pencere boyutu değişince
  // ölçülür; kare başına zorunlu yerleşim (layout) ölçümü yapılmaz.
  let measured=0;function onResize(){measured=0;}root.addEventListener('resize',onResize);
  function resize(){if(!measured)measured=measureSize();return measured;}
  function measureSize(){const rect=canvas.getBoundingClientRect(),size=Math.max(20,Math.round(Math.min(rect.width||64,rect.height||64))),dpr=Math.max(1,Math.min(2,root.devicePixelRatio||1));if(canvas.width!==Math.round(size*dpr)||canvas.height!==Math.round(size*dpr)){canvas.width=Math.round(size*dpr);canvas.height=Math.round(size*dpr);}ctx.setTransform(dpr,0,0,dpr,0,0);return size;}
  function point(angle,tilt,r){const x=Math.cos(angle)*r,y=Math.sin(angle)*r*.48,c=Math.cos(tilt),s=Math.sin(tilt);return {x:x*c-y*s,y:x*s+y*c};}
  let ink='';
  function frame(now){
    raf=0;
    if(!running)return;
    // Detached/offscreen/hidden canvases never keep a frame loop alive.
    if(!canvas.isConnected){stop();return;}
    if(!intersecting||root.document.visibilityState==='hidden')return;
    const dt=last?Math.min(40,now-last):16;last=now;phase+=dt*.0039;const size=resize(),cx=size/2,cy=size/2,r=size*.27,c=ink||(ink=colour());ctx.clearRect(0,0,size,size);
    for(let p=0;p<3;p++){const pos=point(phase+offsets[p],tilts[p],r);trails[p].push({x:pos.x,y:pos.y});if(trails[p].length>14)trails[p].shift();trails[p].forEach((ghost,index)=>{const alpha=(index+1)/trails[p].length*.38,radius=.65+(index/trails[p].length)*.95;ctx.globalAlpha=alpha;ctx.fillStyle=c;ctx.beginPath();ctx.arc(cx+ghost.x,cy+ghost.y,radius,0,Math.PI*2);ctx.fill();});ctx.globalAlpha=1;ctx.fillStyle=c;ctx.beginPath();ctx.arc(cx+pos.x,cy+pos.y,2.35,0,Math.PI*2);ctx.fill();}
    ctx.globalAlpha=1;schedule();
  }
  function stop(){if(!running)return;running=false;root.removeEventListener('resize',onResize);root.document.removeEventListener('visibilitychange',onVisibility);reduced?.removeEventListener?.('change',onVisibility);io?.disconnect();motionObserver?.disconnect();if(raf)root.cancelAnimationFrame(raf);raf=0;ctx.clearRect(0,0,canvas.width,canvas.height);}
  if(typeof root.IntersectionObserver==='function'){
    io=new root.IntersectionObserver(entries=>{intersecting=!!entries[0]?.isIntersecting;onVisibility();});io.observe(canvas);
  }
  reduced?.addEventListener?.('change',onVisibility);
  if(typeof root.MutationObserver==='function'){
    motionObserver=new root.MutationObserver(onVisibility);
    motionObserver.observe(root.document.documentElement,{attributes:true,attributeFilter:['data-bl-motion']});
  }
  // Reduced motion keeps one original still frame rather than a blank symbol.
  if(reduced?.matches)frame(16);else schedule();
  return {stop};
}
root.BLThinkingOrb={attach};
})(typeof window!=='undefined'?window:null);
