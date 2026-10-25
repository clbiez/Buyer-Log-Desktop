/* KPI sayaç hareketi (DESIGN_SYSTEM.md §8).
   Bir modül açıldığında görünür KPI değerleri sıfırdan özgün değerlerine sayar.
   Güvenlik: metin yalnız animasyon karesinde değişir, sonunda birebir özgün
   metne döner; modül bu sırada yeniden çizerse animasyon kendini bırakır.
   prefers-reduced-motion açıkken hiç çalışmaz. Görünmeyen modüle dokunmaz. */
(function(root){
  'use strict';
  const doc=root.document;
  if(!doc)return;
  const SELECTOR='.bpaTileValue,.bdaKpiValue,.psaKpi strong,.cpaChip .n,.pricingMetric b,.blvTile .bpaTileValue';
  const DURATION=650;
  const seen=new WeakMap();
  const reduced=()=>root.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  // "726.300", "%21,8", "$8,66", "515.200 adet" → sayı + biçim parçaları
  function parse(text){
    const m=String(text).match(/^(\D*?)(\d{1,3}(?:\.\d{3})+|\d+)(,\d+)?(\D*)$/);
    if(!m)return null;
    const intPart=Number(m[2].replace(/\./g,'')),dec=m[3]?m[3].slice(1):'';
    const value=intPart+(dec?Number('0.'+dec):0);
    if(!Number.isFinite(value)||value===0)return null;
    return {prefix:m[1],suffix:m[4],value,decimals:dec.length,grouped:m[2].includes('.')||intPart>=1000};
  }
  function format(p,v){
    const fixed=v.toFixed(p.decimals);
    let [i,d]=fixed.split('.');
    if(p.grouped)i=i.replace(/\B(?=(\d{3})+(?!\d))/g,'.');
    return p.prefix+i+(d?','+d:'')+p.suffix;
  }
  function animate(el){
    const original=el.textContent;
    if(seen.get(el)===original)return;
    seen.set(el,original);
    const p=parse(original.trim());if(!p)return;
    const start=performance.now();let last=null;
    const frame=now=>{
      if(last!==null&&el.textContent!==last)return; // modül yeniden çizdi: bırak
      const t=Math.min(1,(now-start)/DURATION),e=1-Math.pow(1-t,3);
      if(t>=1){el.textContent=original;return;}
      last=format(p,p.value*e);el.textContent=last;
      root.requestAnimationFrame(frame);
    };
    root.requestAnimationFrame(frame);
  }
  function run(){
    // The Manifest pilots show the actual number immediately; no decorative count-up.
    if(doc.documentElement.dataset.uiSystem==='manifest'&&['overview','cp'].includes(doc.body.dataset.activeTab))return;
    if(reduced())return;
    const view=doc.querySelector('main section.active')||doc;
    view.querySelectorAll(SELECTOR).forEach(el=>{const r=el.getBoundingClientRect();if(r.width&&r.bottom>0&&r.top<root.innerHeight)animate(el);});
  }
  // Modül değişiminden sonra içerik çizilince bir kez çalış.
  doc.addEventListener('click',event=>{
    if(!event.target.closest?.('nav.tabs button[data-tab]'))return;
    root.setTimeout(run,260);root.setTimeout(run,1200);
  },true);
  root.BLKpiMotion={run};
})(typeof window!=='undefined'?window:globalThis);
