/* Adapted from Jakub Antalik / thinking-orbs "breathing" state — the orb the
 * library labels "Thinking…" (MIT, 2026). Dependency-free Canvas port of the
 * ring mode at the 64px preset; geometry matches the upstream golden vectors.
 * Used by the boot guard in index.html, so it must load before first paint.
 */
(function(root){
'use strict';
const SIZE=64,SPEED=3.24,CAM_TILT=.3;
// resolvePreset('breathing',64): ring profile × count .25 × size .956 + extra
const OPTS={lanes:3,segs:44,rBase:1.0516,rDepth:1.6252,rsPow:.6,rMin:.3,bandMul:3.627,wobMul:.368};
function frame(size,t,o){
  const cx=size/2,cy=size/2,R=(size/2)*.78,rs=Math.pow(size/300,o.rsPow);
  // spin 0 + face-on: yaw frozen at 0, band tilt cancels the camera tilt
  const ta=-CAM_TILT,st=Math.sin(CAM_TILT),ct=Math.cos(CAM_TILT);
  const ux=1,uz=0,vx=-uz*Math.sin(ta),vy=Math.cos(ta),vz=ux*Math.sin(ta);
  const nx=-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy;
  const wobAmp=.23*o.wobMul,baseR=R/(1+.85*wobAmp);
  const lanes=Math.max(1,Math.round(o.lanes*o.bandMul)),segs=o.segs,dots=[];
  for(let w=0;w<lanes;w++){
    const laneOff=(w-(lanes-1)/2)*.075,edge=Math.abs(w-(lanes-1)/2)/Math.max(1,(lanes-1)/2);
    for(let k=0;k<segs;k++){
      const a=(k/segs)*2*Math.PI;
      const wob=(.16*Math.sin(a*3-t*1.7+w*.22)+.07*Math.sin(a*5+t*1.1))*o.wobMul;
      const x=ux*Math.cos(a)+vx*Math.sin(a)+nx*laneOff,y=vy*Math.sin(a)+ny*laneOff,z=uz*Math.cos(a)+vz*Math.sin(a)+nz*laneOff;
      const l=Math.sqrt(x*x+y*y+z*z),rr=baseR*(1+wob),px=(x/l)*rr,py=(y/l)*rr,pz=(z/l)*rr;
      const y1=py*ct-pz*st,zr=py*st+pz*ct,depth=(zr/R+1)/2;
      const a2=.4+.6*depth;
      if(a2<.02)continue;
      dots.push({x:cx+px,y:cy-y1,z:zr,r:Math.max(o.rMin,(o.rBase+o.rDepth*depth)*(1-.25*edge)*rs),white:.52-.44*depth+.18*edge,a:a2});
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
function isDark(){try{return root.document.documentElement.getAttribute('data-theme')==='dark';}catch(_){return false;}}
function attach(canvas){
  if(!canvas||typeof canvas.getContext!=='function')return {stop:function(){}};
  const ctx=canvas.getContext('2d');if(!ctx)return {stop:function(){}};
  const dpr=Math.max(1,Math.min(2,root.devicePixelRatio||1));
  canvas.width=Math.round(SIZE*dpr);canvas.height=Math.round(SIZE*dpr);
  let raf=0,running=true;
  function draw(){
    if(!running)return;
    if(!canvas.isConnected){running=false;return;}
    const now=(root.performance&&root.performance.now)?root.performance.now():Date.now();
    ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,SIZE,SIZE);
    paint(ctx,frame(SIZE,(now/1000)*SPEED,OPTS),isDark());
    raf=root.requestAnimationFrame(draw);
  }
  draw();
  return {stop:function(){running=false;if(raf)root.cancelAnimationFrame(raf);}};
}
const api={attach:attach,frame:frame,OPTS:OPTS,SIZE:SIZE,SPEED:SPEED};
if(root&&root.document)root.BLThinkingOrbBreathing=api;
if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:null);
