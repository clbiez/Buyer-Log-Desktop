/* Buyer Log — CP / Orders Fabric cards and card-field facets.
 * Presentation-only layer: PLM row values remain untouched. Uses the existing
 * fabric-cards-engine; no new API, storage, or update pipeline.
 */
(function(global){
  'use strict';
  if(global.BLCPOrdersFabricCards)return;
  const engine=global.BLFabricCards;
  if(!engine||typeof engine.ruleCard!=='function')return;
  const labels=[
    ['category','Kumaş grubu','Fabric group'],
    ['type','Kumaş tipi','Fabric type'],
    ['yarn','İplik','Yarn'],
    ['weight','Gramaj','Weight'],
    ['composition','Karışım','Composition'],
    ['finish','Apre / işlem','Finish'],
    ['sustainability','Sürdürülebilirlik','Sustainability']
  ];
  const esc=value=>String(value==null?'':value).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const isEn=()=>String(document.documentElement.lang||'tr').toLowerCase().startsWith('en');
  const text=(tr,en)=>isEn()?en:tr;
  const active=new Map();
  const tableState=new WeakMap();
  const style=document.createElement('style');
  style.textContent=
    '.blCpFabricCard{display:flex;align-items:flex-start;gap:6px;min-width:0;line-height:1.35;white-space:normal}'+
    '.blCpFabricCode{flex:0 0 auto;padding:2px 5px;background:var(--card2,#edf2f7);color:var(--acc,#326b94);font-weight:700;font-size:10px;white-space:nowrap}'+
    '.blCpFabricSummary{min-width:0;color:var(--ink,inherit);font-size:11px}'+
    '.blCpFabricFacetBtn{margin-inline-start:5px;padding:2px 5px;border:1px solid var(--line,#d4dbe3);background:var(--card,#fff);color:var(--ink,inherit);font:inherit;font-size:10px;cursor:pointer}'+
    '.blCpFabricFacet{position:fixed;z-index:10080;width:min(340px,calc(100vw - 24px));max-height:min(72vh,520px);overflow:auto;padding:10px;background:var(--card,#fff);color:var(--ink,#1f2937);border:1px solid var(--line,#d4dbe3);box-shadow:0 8px 28px #0002}'+
    '.blCpFabricFacet label{display:grid;gap:3px;margin:7px 0;font-size:11px}'+
    '.blCpFabricFacet input{box-sizing:border-box;width:100%;min-height:28px;padding:4px 6px;border:1px solid var(--line,#d4dbe3);background:var(--paper,#fff);color:inherit;font:inherit}'+
    '.blCpFabricFacet footer{display:flex;justify-content:flex-end;gap:6px;position:sticky;bottom:-10px;padding:8px 0 0;background:var(--card,#fff)}'+
    '.blCpFabricFacet button{padding:5px 9px;border:1px solid var(--line,#d4dbe3);background:var(--card2,#f3f5f7);color:inherit;cursor:pointer}'+
    '.blCpFabricFacet button.primary{background:var(--acc,#326b94);color:white}';
  (document.head||document.documentElement).appendChild(style);
  function findFabricHeader(table){
    const headers=Array.from(table.querySelectorAll('thead tr:last-child th'));
    const index=headers.findIndex(th=>/fabric\s*\(plm\)|fabric\s*\/\s*plm|kumaş\s*\(plm\)/i.test(th.innerText||th.textContent||''));
    return index<0?null:{header:headers[index],index};
  }
  function parse(raw){
    const value=String(raw||'').trim();
    if(!value)return null;
    const card=engine.ruleCard(value);
    const code=card.code||'';
    const details=card.details||{};
    const lang=isEn()?'en':'tr';
    const summary=lang==='en'?(card.summaryEn||card.summary):(card.summary||card.summaryEn);
    return {raw:value,code,summary:summary||value,details};
  }
  function valuesFor(table,index){
    return Array.from(table.querySelectorAll('tbody tr')).map(row=>{
      const cells=Array.from(row.children);
      const cell=cells[index];
      if(!cell||row.hidden||row.dataset.blFabricFacetHidden==='1')return null;
      const raw=cell.dataset.blFabricRaw||cell.innerText||cell.textContent||'';
      const card=parse(raw);
      return card?{row,cell,card}:null;
    }).filter(Boolean);
  }
  function renderCard(cell,card){
    if(!card)return;
    if(!cell.dataset.blFabricRaw)cell.dataset.blFabricRaw=card.raw;
    if(cell.dataset.blFabricCard===card.raw)return;
    cell.dataset.blFabricCard=card.raw;
    cell.innerHTML='<div class="blCpFabricCard">'+(card.code?'<span class="blCpFabricCode">'+esc(card.code)+'</span>':'')+'<span class="blCpFabricSummary">'+esc(card.summary)+'</span></div>';
    cell.title=labels.map(([key,tr,en])=>card.details[key]?text(tr,en)+': '+card.details[key]:'').filter(Boolean).join('\n');
  }
  function closeFacet(){document.querySelectorAll('.blCpFabricFacet').forEach(node=>node.remove());}
  function apply(table,index){
    const filters=active.get(table)||{};
    Array.from(table.querySelectorAll('tbody tr')).forEach(row=>{
      const cell=Array.from(row.children)[index];
      if(!cell){return;}
      const raw=cell.dataset.blFabricRaw||cell.innerText||cell.textContent||'';
      const card=parse(raw);
      const pass=!!card&&Object.entries(filters).every(([key,value])=>!value||String(card.details[key]||'').toLocaleLowerCase().includes(value.toLocaleLowerCase()));
      row.dataset.blFabricFacetHidden=pass?'0':'1';
      row.style.display=pass?'':'none';
    });
  }
  function openFacet(table,index,button){
    closeFacet();
    const current=active.get(table)||{};
    const panel=document.createElement('div');panel.className='blCpFabricFacet';
    panel.innerHTML='<strong>'+esc(text('Kumaş kartı filtreleri','Fabric card filters'))+'</strong>'+
      labels.map(([key,tr,en])=>'<label>'+esc(text(tr,en))+'<input data-fabric-filter="'+key+'" value="'+esc(current[key]||'')+'" placeholder="'+esc(text('Değer ara…','Search value…'))+'"></label>').join('')+
      '<footer><button type="button" data-fabric-clear>'+esc(text('Temizle','Clear'))+'</button><button type="button" class="primary" data-fabric-apply>'+esc(text('Uygula','Apply'))+'</button></footer>';
    document.body.appendChild(panel);
    const rect=button.getBoundingClientRect();
    panel.style.top=Math.max(8,Math.min(rect.bottom+4,innerHeight-panel.offsetHeight-8))+'px';
    panel.style.left=Math.max(8,Math.min(rect.left,innerWidth-panel.offsetWidth-8))+'px';
    panel.querySelector('[data-fabric-clear]').addEventListener('click',()=>{
      active.delete(table);apply(table,index);closeFacet();
    });
    panel.querySelector('[data-fabric-apply]').addEventListener('click',()=>{
      const next={};
      panel.querySelectorAll('[data-fabric-filter]').forEach(input=>{if(input.value.trim())next[input.dataset.fabricFilter]=input.value.trim();});
      if(Object.keys(next).length)active.set(table,next);else active.delete(table);
      apply(table,index);closeFacet();
    });
  }
  function enhance(table){
    const found=findFabricHeader(table);if(!found)return;
    const {header,index}=found;
    if(!tableState.has(table)){
      const button=document.createElement('button');
      button.type='button';button.className='blCpFabricFacetBtn';button.textContent='▽';
      button.title=text('Kumaş kartı alanlarına göre filtrele','Filter by fabric-card fields');
      button.setAttribute('aria-label',button.title);
      button.addEventListener('click',event=>{event.stopPropagation();openFacet(table,index,button);});
      header.appendChild(button);
      tableState.set(table,{index,button});
    }
    const current=tableState.get(table);
    Array.from(table.querySelectorAll('tbody tr')).forEach(row=>{
      const cell=Array.from(row.children)[index];
      if(!cell)return;
      const raw=cell.dataset.blFabricRaw||cell.innerText||cell.textContent||'';
      const card=parse(raw);
      if(card)renderCard(cell,card);
    });
    if(active.has(table))apply(table,index);
    if(current.index!==index)current.index=index;
  }
  function scan(){
    document.querySelectorAll('table').forEach(table=>{
      if(findFabricHeader(table))enhance(table);
    });
  }
  let scheduled=false;
  const observer=new MutationObserver(()=>{
    if(scheduled)return;scheduled=true;
    queueMicrotask(()=>{scheduled=false;scan();});
  });
  function start(){scan();observer.observe(document.body,{subtree:true,childList:true});}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
  global.BLCPOrdersFabricCards={scan,parse,apply};
})(window);
