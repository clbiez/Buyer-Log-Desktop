/* Buyer Log — Backlog radar + pivot workspace layout.
 * Görsel katmandır; Backlog pivot ve teslimat analizi hesaplarını değiştirmez.
 */
(function attachBacklogRadarLayout(root){
  'use strict';
  if(!root||!root.document)return;

  const STORAGE_KEY='lcw.backlog.radar.layout.v1';
  const DEFAULTS={
    pivotShare:.5,
    radarFirst:false,
    pivotCollapsed:false,
    pivotRadarCollapsed:false,
    riskCollapsed:false,
    riskPosition:'after-kpi',
  };
  let state={...DEFAULTS},pivotWorkspace=null,pivotPanel=null,pivotRadarCard=null,splitter=null;
  let riskScheduled=false,pivotScheduled=false;

  const lang=()=>root.document.documentElement.lang==='en'?'en':'tr';
  const L=(tr,en)=>lang()==='en'?en:tr;
  const esc=value=>String(value==null?'':value).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const store=()=>{try{return root.BLStorage||root.localStorage||null;}catch(_){return null;}};
  function load(){
    try{
      const raw=store()?.getItem(STORAGE_KEY),saved=raw?JSON.parse(raw):{};
      state={...DEFAULTS,...saved};
      state.pivotShare=Math.max(.28,Math.min(.72,Number(state.pivotShare)||.5));
      if(!['before-kpi','after-kpi','after-attention'].includes(state.riskPosition))state.riskPosition='after-kpi';
    }catch(_){state={...DEFAULTS};}
  }
  function save(){try{store()?.setItem(STORAGE_KEY,JSON.stringify(state));}catch(_){}}

  function parseNumber(value){
    let text=String(value==null?'':value).trim().replace(/\s/g,'');
    if(!text)return 0;
    const comma=text.lastIndexOf(','),dot=text.lastIndexOf('.');
    if(comma>=0&&dot>=0){
      if(comma>dot)text=text.replace(/\./g,'').replace(',','.');
      else text=text.replace(/,/g,'');
    }else if(comma>=0)text=text.replace(/\./g,'').replace(',','.');
    else if(dot>=0&&/^[-+]?\d{1,3}(?:\.\d{3})+$/.test(text))text=text.replace(/\./g,'');
    const n=Number(text.replace(/[^0-9+.-]/g,''));
    return Number.isFinite(n)?n:0;
  }
  function fmt(value){return Math.round(Number(value)||0).toLocaleString(lang()==='en'?'en-GB':'tr-TR');}

  function radarSvg(items,label){
    const list=(items||[]).filter(item=>item&&String(item.label||'').trim()).slice(0,10);
    if(list.length<3)return '<div class="blRadarEmpty">'+esc(L('Radar için en az 3 başlık gerekiyor.','At least 3 categories are required for the radar.'))+'</div>';
    const size=360,cx=180,cy=178,radius=116,rings=4,max=Math.max(1,...list.map(item=>Number(item.value)||0));
    const point=(index,ratio=1)=>{
      const angle=-Math.PI/2+Math.PI*2*index/list.length;
      return [cx+Math.cos(angle)*radius*ratio,cy+Math.sin(angle)*radius*ratio,angle];
    };
    let svg='<svg class="blRadarSvg" viewBox="0 0 '+size+' '+size+'" role="img" aria-label="'+esc(label)+'">';
    for(let ring=1;ring<=rings;ring++){
      const pts=list.map((_,i)=>{const p=point(i,ring/rings);return p[0].toFixed(1)+','+p[1].toFixed(1);}).join(' ');
      svg+='<polygon class="blRadarGrid" points="'+pts+'"/>';
    }
    list.forEach((_,i)=>{const p=point(i);svg+='<line class="blRadarAxis" x1="'+cx+'" y1="'+cy+'" x2="'+p[0].toFixed(1)+'" y2="'+p[1].toFixed(1)+'"/>';});
    const dataPts=list.map((item,i)=>{const p=point(i,Math.max(.035,(Number(item.value)||0)/max));return p[0].toFixed(1)+','+p[1].toFixed(1);}).join(' ');
    svg+='<polygon class="blRadarArea" points="'+dataPts+'"/>';
    list.forEach((item,i)=>{
      const p=point(i,Math.max(.035,(Number(item.value)||0)/max));
      svg+='<circle class="blRadarPoint" cx="'+p[0].toFixed(1)+'" cy="'+p[1].toFixed(1)+'" r="3.2"/>';
      const lp=point(i,1.22),anchor=Math.cos(lp[2])>.25?'start':Math.cos(lp[2])<-.25?'end':'middle';
      const labelText=String(item.label||'').length>22?String(item.label).slice(0,21)+'…':String(item.label||'');
      svg+='<text class="blRadarLabel" x="'+lp[0].toFixed(1)+'" y="'+lp[1].toFixed(1)+'" text-anchor="'+anchor+'"><tspan x="'+lp[0].toFixed(1)+'">'+esc(labelText)+'</tspan><tspan class="blRadarValue" x="'+lp[0].toFixed(1)+'" dy="12">'+esc(fmt(item.value))+'</tspan></text>';
    });
    svg+='</svg>';
    return svg;
  }

  function pivotItems(){
    const table=root.document.getElementById('backlogTreeTable'),body=root.document.getElementById('backlogTreeBody');
    if(!table||!body)return [];
    const qtyHead=root.document.getElementById('backlogThQty'),qtyIndex=qtyHead?qtyHead.cellIndex:-1;
    if(qtyIndex<0)return [];
    return [...body.querySelectorAll('tr[data-depth="0"]')].map(row=>({
      label:row.querySelector('.backlogTreeLabel')?.textContent?.trim()||'—',
      value:parseNumber(row.cells[qtyIndex]?.textContent),
    })).filter(item=>item.label&&item.value>=0);
  }
  function updatePivotRadar(){
    if(!pivotRadarCard)return;
    const body=pivotRadarCard.querySelector('[data-pivot-radar-body]'),items=pivotItems();
    if(!body)return;
    const signature=JSON.stringify(items);
    if(body.dataset.signature===signature)return;
    body.dataset.signature=signature;
    body.innerHTML=radarSvg(items,L('Backlog durum radarı','Backlog status radar'));
  }
  function schedulePivotRadar(){
    if(pivotScheduled)return;pivotScheduled=true;
    root.requestAnimationFrame(()=>{pivotScheduled=false;updatePivotRadar();});
  }

  function iconButton(action,label,glyph){
    return '<button type="button" class="blWorkspaceIconBtn" data-bl-layout="'+action+'" title="'+esc(label)+'" aria-label="'+esc(label)+'">'+glyph+'</button>';
  }
  function applyPivotLayout(){
    if(!pivotWorkspace||!pivotPanel||!pivotRadarCard)return;
    pivotPanel.classList.toggle('is-collapsed',!!state.pivotCollapsed);
    pivotRadarCard.classList.toggle('is-collapsed',!!state.pivotRadarCollapsed);
    pivotPanel.style.order=state.radarFirst?'3':'1';
    pivotRadarCard.style.order=state.radarFirst?'1':'3';
    if(splitter)splitter.style.order='2';

    const both=!state.pivotCollapsed&&!state.pivotRadarCollapsed;
    if(splitter)splitter.hidden=!both;
    if(both){
      const pivotPct=Math.round(state.pivotShare*1000)/10,radarPct=Math.round((1-state.pivotShare)*1000)/10;
      pivotWorkspace.style.gridTemplateColumns=state.radarFirst
        ? 'minmax(0,'+radarPct+'fr) 7px minmax(0,'+pivotPct+'fr)'
        : 'minmax(0,'+pivotPct+'fr) 7px minmax(0,'+radarPct+'fr)';
    }else{
      pivotWorkspace.style.gridTemplateColumns='minmax(150px,190px) minmax(0,1fr)';
      if(state.radarFirst&&state.pivotRadarCollapsed){
        pivotRadarCard.style.order='1';pivotPanel.style.order='2';
      }else if(!state.radarFirst&&state.pivotCollapsed){
        pivotPanel.style.order='1';pivotRadarCard.style.order='2';
      }
    }
    pivotPanel.querySelector('[data-bl-layout="pivot-collapse"]')?.setAttribute('aria-expanded',String(!state.pivotCollapsed));
    pivotRadarCard.querySelector('[data-bl-layout="radar-collapse"]')?.setAttribute('aria-expanded',String(!state.pivotRadarCollapsed));
  }
  function swapPivot(){state.radarFirst=!state.radarFirst;save();applyPivotLayout();}
  function bindPivotControls(){
    pivotWorkspace?.addEventListener('click',event=>{
      const button=event.target.closest('[data-bl-layout]');if(!button)return;
      const action=button.dataset.blLayout;
      if(action==='pivot-collapse'){state.pivotCollapsed=!state.pivotCollapsed;save();applyPivotLayout();}
      else if(action==='radar-collapse'){state.pivotRadarCollapsed=!state.pivotRadarCollapsed;save();applyPivotLayout();}
      else if(action==='swap'){swapPivot();}
    });
    splitter?.addEventListener('pointerdown',event=>{
      if(event.button!==0)return;
      event.preventDefault();splitter.setPointerCapture?.(event.pointerId);
      const onMove=move=>{
        const rect=pivotWorkspace.getBoundingClientRect();if(!rect.width)return;
        const ratio=(move.clientX-rect.left)/rect.width;
        state.pivotShare=Math.max(.28,Math.min(.72,state.radarFirst?1-ratio:ratio));
        applyPivotLayout();
      };
      const onUp=up=>{
        splitter.releasePointerCapture?.(up.pointerId);
        splitter.removeEventListener('pointermove',onMove);splitter.removeEventListener('pointerup',onUp);splitter.removeEventListener('pointercancel',onUp);
        save();
      };
      splitter.addEventListener('pointermove',onMove);splitter.addEventListener('pointerup',onUp);splitter.addEventListener('pointercancel',onUp);
    });
  }
  function ensurePivotWorkspace(){
    const table=root.document.getElementById('backlogTreeTable');if(!table)return;
    const panel=table.closest('.panel');if(!panel)return;
    if(panel.dataset.backlogWorkspaceReady==='1'){pivotPanel=panel;pivotWorkspace=panel.closest('.backlogPivotRadarWorkspace');pivotRadarCard=pivotWorkspace?.querySelector('[data-pivot-radar-card]');splitter=pivotWorkspace?.querySelector('.backlogWorkspaceSplitter');schedulePivotRadar();return;}
    pivotPanel=panel;panel.dataset.backlogWorkspaceReady='1';panel.classList.add('backlogPivotWorkspacePanel');

    pivotWorkspace=root.document.createElement('div');pivotWorkspace.className='backlogPivotRadarWorkspace';
    panel.parentNode.insertBefore(pivotWorkspace,panel);pivotWorkspace.appendChild(panel);

    const pivotHead=root.document.createElement('div');pivotHead.className='backlogWorkspaceCardHead';
    pivotHead.innerHTML='<div><strong>'+esc(L('Backlog Pivot','Backlog Pivot'))+'</strong><span>'+esc(L('Güncel durum kırılımı','Current status breakdown'))+'</span></div><div class="backlogWorkspaceCardActions">'
      +iconButton('swap',L('Radar ile yer değiştir','Swap with radar'),'⇄')
      +iconButton('pivot-collapse',L('Pivotu aç / kapat','Expand / collapse pivot'),'▾')+'</div>';
    panel.insertBefore(pivotHead,panel.firstChild);

    pivotRadarCard=root.document.createElement('div');pivotRadarCard.className='panel backlogRadarCard';pivotRadarCard.dataset.pivotRadarCard='1';
    pivotRadarCard.innerHTML='<div class="backlogWorkspaceCardHead"><div><strong>'+esc(L('Durum Radarı','Status Radar'))+'</strong><span>'+esc(L('Yalnız ana başlıklar','Top-level groups only'))+'</span></div><div class="backlogWorkspaceCardActions">'
      +iconButton('swap',L('Pivot ile yer değiştir','Swap with pivot'),'⇄')
      +iconButton('radar-collapse',L('Radarı aç / kapat','Expand / collapse radar'),'▾')+'</div></div><div class="backlogRadarBody" data-pivot-radar-body></div>';
    pivotWorkspace.appendChild(pivotRadarCard);

    splitter=root.document.createElement('div');splitter.className='backlogWorkspaceSplitter';splitter.setAttribute('role','separator');splitter.setAttribute('aria-orientation','vertical');splitter.title=L('Sürükleyerek genişliği ayarla','Drag to resize');
    pivotWorkspace.appendChild(splitter);

    bindPivotControls();applyPivotLayout();schedulePivotRadar();
    const tbody=root.document.getElementById('backlogTreeBody');
    if(tbody)new MutationObserver(schedulePivotRadar).observe(tbody,{childList:true,subtree:true,characterData:true});
    root.addEventListener('resize',schedulePivotRadar);
  }

  function riskItems(host){
    return [...host.querySelectorAll('.bdaKpiRow .bdaKpi:not(.is-total)')].map(card=>({
      label:card.querySelector('.bdaKpiLabel')?.textContent?.trim()||'—',
      value:parseNumber(card.querySelector('.bdaKpiValue')?.textContent),
    })).filter(item=>item.label);
  }
  function riskPositionCard(host,card){
    const kpi=host.querySelector('.bdaKpiRow');if(!kpi)return;
    if(state.riskPosition==='before-kpi'){
      if(card.nextElementSibling!==kpi)kpi.before(card);
    }else if(state.riskPosition==='after-attention'){
      const target=host.querySelector('[data-fold="attention"]')||kpi;
      if(target.nextElementSibling!==card)target.after(card);
    }else if(kpi.nextElementSibling!==card)kpi.after(card);
  }
  function renderRiskRadar(){
    const host=root.document.getElementById('backlogAnalysis');if(!host)return;
    const kpi=host.querySelector('.bdaKpiRow');if(!kpi)return;
    let card=host.querySelector('[data-risk-radar-card]');
    if(!card){
      card=root.document.createElement('div');card.className='bdaRadarCard';card.dataset.riskRadarCard='1';
      card.innerHTML='<div class="backlogWorkspaceCardHead"><div><strong>'+esc(L('Teslimat Risk Radarı','Delivery Risk Radar'))+'</strong><span>'+esc(L('Ekrandaki risk etiketleri','Current risk labels'))+'</span></div><div class="backlogWorkspaceCardActions">'
        +iconButton('risk-up',L('Yukarı taşı','Move up'),'↑')
        +iconButton('risk-down',L('Aşağı taşı','Move down'),'↓')
        +iconButton('risk-collapse',L('Radarı aç / kapat','Expand / collapse radar'),'▾')+'</div></div><div class="backlogRadarBody" data-risk-radar-body></div>';
      card.addEventListener('click',event=>{
        const button=event.target.closest('[data-bl-layout]');if(!button)return;
        const positions=['before-kpi','after-kpi','after-attention'],current=Math.max(0,positions.indexOf(state.riskPosition));
        if(button.dataset.blLayout==='risk-collapse')state.riskCollapsed=!state.riskCollapsed;
        else if(button.dataset.blLayout==='risk-up')state.riskPosition=positions[Math.max(0,current-1)];
        else if(button.dataset.blLayout==='risk-down')state.riskPosition=positions[Math.min(positions.length-1,current+1)];
        save();renderRiskRadar();
      });
    }
    riskPositionCard(host,card);
    card.classList.toggle('is-collapsed',!!state.riskCollapsed);
    card.querySelector('[data-bl-layout="risk-collapse"]')?.setAttribute('aria-expanded',String(!state.riskCollapsed));
    const body=card.querySelector('[data-risk-radar-body]'),items=riskItems(host),signature=JSON.stringify(items);
    if(body&&body.dataset.signature!==signature){body.dataset.signature=signature;body.innerHTML=radarSvg(items,L('Teslimat risk radarı','Delivery risk radar'));}
  }
  function scheduleRiskRadar(){
    if(riskScheduled)return;riskScheduled=true;
    root.requestAnimationFrame(()=>{riskScheduled=false;renderRiskRadar();});
  }

  function init(){
    load();ensurePivotWorkspace();
    const analysis=root.document.getElementById('backlogAnalysis');
    if(analysis)new MutationObserver(scheduleRiskRadar).observe(analysis,{childList:true,subtree:true});
    scheduleRiskRadar();
  }
  if(root.document.readyState==='loading')root.document.addEventListener('DOMContentLoaded',init,{once:true});else init();
  root.BLBacklogRadarLayout={refreshPivot:schedulePivotRadar,refreshRisk:scheduleRiskRadar,_state:state};
})(window);
