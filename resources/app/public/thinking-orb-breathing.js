/* Adapted from Jakub Antalik / thinking-orbs "breathing" state — the orb the
 * library labels "Thinking…" (MIT, 2026). Dependency-free Canvas port of the
 * upstream ring mode. The 20px and 64px presets keep the original tuned
 * geometry; Buyer Log's existing .blOrb[data-state="thinking"] placeholders
 * are upgraded automatically so waiting/status UI no longer uses the blue
 * gradient fallback.
 */
(function(root){
'use strict';

const PRESETS={
  20:{
    size:20,speed:3.78,
    // resolvePreset('breathing',20): ring × count .028 × size 1.622 + extra
    opts:{lanes:2,segs:15,rBase:1.7842,rDepth:2.7574,rsPow:.6,rMin:.3,bandMul:3.968,wobMul:.565}
  },
  64:{
    size:64,speed:3.24,
    // resolvePreset('breathing',64): ring × count .25 × size .956 + extra
    opts:{lanes:3,segs:44,rBase:1.0516,rDepth:1.6252,rsPow:.6,rMin:.3,bandMul:3.627,wobMul:.368}
  }
};
const SIZE=64,SPEED=PRESETS[64].speed,OPTS=PRESETS[64].opts,CAM_TILT=.3;
const mounted=typeof WeakMap!=='undefined'?new WeakMap():null;

function presetFor(size){return Number(size)===20?PRESETS[20]:PRESETS[64];}

function frame(size,t,o){
  const cx=size/2,cy=size/2,R=(size/2)*.78,rs=Math.pow(size/300,o.rsPow);
  // spin 0 + face-on: yaw frozen at 0, band tilt cancels the camera tilt.
  const ta=-CAM_TILT,st=Math.sin(CAM_TILT),ct=Math.cos(CAM_TILT);
  const ux=1,uz=0,vx=-uz*Math.sin(ta),vy=Math.cos(ta),vz=ux*Math.sin(ta);
  const nx=-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy;
  const wobAmp=.23*o.wobMul,baseR=R/(1+.85*wobAmp);
  const lanes=Math.max(1,Math.round(o.lanes*o.bandMul)),segs=o.segs,dots=[];
  for(let w=0;w<lanes;w++){
    const laneOff=(w-(lanes-1)/2)*.075;
    const edge=Math.abs(w-(lanes-1)/2)/Math.max(1,(lanes-1)/2);
    for(let k=0;k<segs;k++){
      const a=(k/segs)*2*Math.PI;
      const wob=(.16*Math.sin(a*3-t*1.7+w*.22)+.07*Math.sin(a*5+t*1.1))*o.wobMul;
      const x=ux*Math.cos(a)+vx*Math.sin(a)+nx*laneOff;
      const y=vy*Math.sin(a)+ny*laneOff;
      const z=uz*Math.cos(a)+vz*Math.sin(a)+nz*laneOff;
      const l=Math.sqrt(x*x+y*y+z*z),rr=baseR*(1+wob);
      const px=(x/l)*rr,py=(y/l)*rr,pz=(z/l)*rr;
      const y1=py*ct-pz*st,zr=py*st+pz*ct,depth=(zr/R+1)/2;
      const alpha=.4+.6*depth;
      if(alpha<.02)continue;
      dots.push({
        x:cx+px,y:cy-y1,z:zr,
        r:Math.max(o.rMin,(o.rBase+o.rDepth*depth)*(1-.25*edge)*rs),
        white:.52-.44*depth+.18*edge,a:alpha
      });
    }
  }
  dots.sort((p,q)=>p.z-q.z);
  return dots;
}

function paint(ctx,dots,dark){
  for(const d of dots){
    const w=Math.min(1,Math.max(0,d.white)),g=Math.round((dark?1-w:w)*255);
    ctx.fillStyle='rgba('+g+','+g+','+g+','+d.a+')';
    ctx.beginPath();ctx.arc(d.x,d.y,d.r,0,Math.PI*2);ctx.fill();
  }
}

function isDark(){
  try{return root.document.documentElement.getAttribute('data-theme')==='dark';}
  catch(_){return false;}
}

function nowMs(){
  return root&&root.performance&&typeof root.performance.now==='function'?root.performance.now():Date.now();
}

function attach(canvas,options){
  if(!root||!canvas||typeof canvas.getContext!=='function')return {stop:function(){}};
  const preset=presetFor(options&&options.size),size=preset.size,speed=preset.speed,opts=preset.opts;
  const ctx=canvas.getContext('2d');if(!ctx)return {stop:function(){}};
  const dpr=Math.max(1,Math.min(2,root.devicePixelRatio||1));
  canvas.width=Math.round(size*dpr);canvas.height=Math.round(size*dpr);

  let raf=0,running=false,stopped=false,visible=true,io=null,themeObserver=null;
  const reducedQuery=typeof root.matchMedia==='function'?root.matchMedia('(prefers-reduced-motion: reduce)'):null;
  const reduced=!!(reducedQuery&&reducedQuery.matches);

  function drawAt(tSec){
    ctx.setTransform(dpr,0,0,dpr,0,0);
    ctx.clearRect(0,0,size,size);
    paint(ctx,frame(size,tSec,opts),isDark());
  }
  function loop(){
    if(!running||stopped)return;
    if(!canvas.isConnected){stop();return;}
    drawAt((nowMs()/1000)*speed);
    raf=root.requestAnimationFrame(loop);
  }
  function start(){
    if(stopped||running||reduced||root.document.documentElement.dataset?.blMotion==='off')return;
    running=true;raf=root.requestAnimationFrame(loop);
  }
  function stopLoop(){
    running=false;
    if(raf){root.cancelAnimationFrame(raf);raf=0;}
  }
  function onVisibility(){
    if(root.document.visibilityState==='hidden')stopLoop();
    else if(visible)start();
  }
  function stop(){
    if(stopped)return;
    stopped=true;stopLoop();
    if(io)io.disconnect();
    if(themeObserver)themeObserver.disconnect();
    root.document.removeEventListener('visibilitychange',onVisibility);
  }

  if(reduced){
    drawAt(.6);
    if(typeof root.MutationObserver==='function'){
      themeObserver=new root.MutationObserver(function(){drawAt(.6);});
      themeObserver.observe(root.document.documentElement,{attributes:true,attributeFilter:['data-theme','class','data-bl-motion']});
    }
  }else{
    // Paint immediately, then follow the same shared performance clock as upstream.
    drawAt((nowMs()/1000)*speed);
    if(typeof root.IntersectionObserver==='function'){
      io=new root.IntersectionObserver(function(entries){
        const entry=entries&&entries[0];visible=!entry||entry.isIntersecting;
        if(visible&&root.document.visibilityState!=='hidden')start();else stopLoop();
      });
      io.observe(canvas);
    }else start();
    if(typeof root.MutationObserver==='function'){
      themeObserver=new root.MutationObserver(function(){
        if(root.document.documentElement.dataset?.blMotion==='off')stopLoop();
        else if(visible&&root.document.visibilityState!=='hidden')start();
      });
      themeObserver.observe(root.document.documentElement,{attributes:true,attributeFilter:['data-bl-motion']});
    }
    root.document.addEventListener('visibilitychange',onVisibility);
  }
  return {stop:stop,size:size};
}

function unmount(host){
  if(!mounted||!host)return;
  const hit=mounted.get(host);if(!hit)return;
  try{hit.controller&&hit.controller.stop&&hit.controller.stop();}catch(_){}
  try{hit.canvas&&hit.canvas.remove();}catch(_){}
  host.classList.remove('blOrb--thinkingCanvas');
  host.removeAttribute('data-thinking-orb-mounted');
  mounted.delete(host);
}

function mount(host){
  if(!mounted||!host||!host.matches||!host.matches('.blOrb[data-state="thinking"]'))return null;
  const hit=mounted.get(host);if(hit)return hit.controller;
  const canvas=root.document.createElement('canvas');
  canvas.className='blOrbCanvas';
  canvas.setAttribute('aria-hidden','true');
  const size=host.classList.contains('blOrb--lg')?64:20;
  host.classList.add('blOrb--thinkingCanvas');
  host.setAttribute('data-thinking-orb-mounted','1');
  host.appendChild(canvas);
  const controller=attach(canvas,{size:size});
  mounted.set(host,{canvas:canvas,controller:controller});
  return controller;
}

function reconcile(host){
  if(!host||!host.matches)return;
  if(host.matches('.blOrb[data-state="thinking"]'))mount(host);
  else if(mounted&&mounted.has(host))unmount(host);
}

function scan(node){
  if(!node||node.nodeType!==1)return;
  reconcile(node);
  if(node.querySelectorAll)node.querySelectorAll('.blOrb[data-state="thinking"]').forEach(mount);
}

function installAutoMount(){
  if(!root||!root.document||!root.document.documentElement)return null;
  scan(root.document.documentElement);
  if(typeof root.MutationObserver!=='function')return null;
  const observer=new root.MutationObserver(function(records){
    for(const record of records){
      if(record.type==='attributes'){reconcile(record.target);continue;}
      if(record.addedNodes)record.addedNodes.forEach(scan);
    }
  });
  observer.observe(root.document.documentElement,{
    subtree:true,childList:true,attributes:true,attributeFilter:['class','data-state']
  });
  return observer;
}

const api={attach:attach,mount:mount,unmount:unmount,frame:frame,PRESETS:PRESETS,OPTS:OPTS,SIZE:SIZE,SPEED:SPEED};
if(root&&root.document){
  root.BLThinkingOrbBreathing=api;
  installAutoMount();
}
if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:null);
