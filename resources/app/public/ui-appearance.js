(function(){
 'use strict';
 const root=document.documentElement;
 try{
  const saved=JSON.parse(localStorage.getItem('buyerlog.ui.appearance')||'{}');
  const theme=saved.theme==='grey'?'light':['light','dark'].includes(saved.theme)?saved.theme:(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');
  root.dataset.theme=theme;
  const step=Number.isInteger(saved.step)&&saved.step>=0&&saved.step<=3?saved.step:0;
  root.dataset.fontStep=String(step);root.dataset.uiScale=['standard','large','xl','compact'][step];
 }catch(_){}
 window.BLUIAppearance={remember:function(){try{localStorage.setItem('buyerlog.ui.appearance',JSON.stringify({theme:root.dataset.theme,step:Number(root.dataset.fontStep)||0}));}catch(_){}}};
})();
