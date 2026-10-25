/* Native root snapshots keep table DOM, focus, selection and scroll intact. */
(function(root){
  'use strict';
  const doc=root.document;
  const motion=root.matchMedia?.('(prefers-reduced-motion: reduce)');
  let active=null;

  function frames(){
    return Array.from({length:19},(_,index)=>{
      const t=index/18,x=-34+170*t,amplitude=12*Math.sin(Math.PI*t);
      const edge=Array.from({length:41},(_,point)=>{
        const y=point*2.5;
        return `${x+Math.sin(y/100*Math.PI*2-.5)*amplitude}% ${y}%`;
      }).join(',');
      return {clipPath:`polygon(-45% -5%,${edge},-45% 105%)`};
    });
  }

  function cancel(){
    if(!active)return;
    const job=active;
    // A skipped native transition may still have an outstanding update callback.
    // Apply it now and make that later callback harmless before starting another.
    job.apply();
    job.transition?.skipTransition();
    job.animation?.cancel();
    job.finish();
  }

  function start(update){
    cancel();
    const html=doc.documentElement;
    if(html.dataset?.uiSystem==='manifest'||motion?.matches||doc.visibilityState==='hidden'||doc.readyState==='loading'
      ||typeof doc.startViewTransition!=='function'||typeof html.animate!=='function')return false;
    let applied=false;
    const job={
      transition:null,animation:null,
      apply(){if(!applied){applied=true;update();}},
      finish(){
        if(active!==job)return;
        html.classList.remove('blThemeWave');
        active=null;
      },
    };
    active=job;
    html.classList.add('blThemeWave');
    try{job.transition=doc.startViewTransition(job.apply);}
    catch(_){job.finish();return false;}
    // Capture rejection (e.g. a hidden window) must not prevent the palette update.
    job.transition.finished.catch(()=>{});
    job.transition.ready.then(async()=>{
      if(active!==job)return;
      if(motion?.matches){cancel();return;}
      const style=root.getComputedStyle(html);
      job.animation=html.animate(frames(),{
        duration:parseFloat(style.getPropertyValue('--bl-motion-theme'))||1150,
        easing:style.getPropertyValue('--bl-ease').trim()||'ease-in-out',
        fill:'both',pseudoElement:'::view-transition-new(root)',
      });
      await job.animation.finished;
      await job.transition.finished;
    }).catch(()=>{
      job.apply();
      job.transition.skipTransition();
    }).finally(()=>job.finish());
    return true;
  }

  motion?.addEventListener?.('change',event=>{if(event.matches)cancel();});
  doc.addEventListener('visibilitychange',()=>{if(doc.visibilityState==='hidden')cancel();});
  root.BLThemeTransition={start,cancel};
})(window);
