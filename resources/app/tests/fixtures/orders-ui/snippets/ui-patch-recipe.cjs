'use strict';
// UNRUN recipe. Exact baseline reads + in-memory transforms; root applies only
// after native tests/review. No full app snapshot or changed protected body.
const assert=require('node:assert/strict');
function once(source,old,next,label){assert.equal(source.split(old).length,2,label);return source.replace(old,next);}
function app(source,extractFunction,seam){
  let out=source;
  const prepend=(name,code)=>{
    const old=extractFunction(out,name),at=old.indexOf('){');assert.ok(at>=0,name+' body');
    out=once(out,old,old.slice(0,at+2)+'\n'+code+old.slice(at+2),name);
  };
  const rerun=(name,args,condition="tableKey==='orders'",inspect='ordersUiControlsIntent',lane="'orders-command'")=>{
    prepend(name,`  if(${condition}&&ordersProjectionIsThin())return ordersUiChange('orders','${name}',${lane},${inspect},()=>${name}(${args}));`);
  };
  // Sinks guard programmatic/re-entrant callers too. Ordinary full bodies stay
  // byte-exact below the added branch; asynchronous UI initiators are below.
  rerun('removeActiveFilterToken','tableKey,kind,key');
  rerun('clearTableFilters','tableKey,{announce}');
  rerun('clearColumnFilters','tableKey,keys');
  rerun('toggleMirroredQuickFilter','tableKey,key,controlId,candidate,rerender');
  rerun('toggleOrdersQuickExFactory','candidate,rerender','true');
  rerun('toggleOrdersActiveQuick','value','true');
  rerun('setPartialView','tableKey,enabled');
  rerun('cycleCheckFilter','tableKey,rerenderOuter');
  rerun('managedSelectionChange','tableKey,change',"tableKey==='orders'",'()=>()=>true',"'orders-selection'");
  prepend('managedSelectionSnapshot',"  if(tableKey==='orders'&&ordersProjectionIsThin())throw Object.assign(ordersFullActionError('ORDERS_FULL_STALE'),{code:'ORDERS_FULL_REQUIRED'});");
  rerun('openHeaderFilter','tableKey,key,anchorEl,rerenderOuter',"tableKey==='orders'",
    "()=>ordersUiIntent([anchorEl],()=>[key],()=>anchorEl.isConnected!==false)", 'anchorEl');
  rerun('openCheckFilter','tableKey,anchorEl,rerenderOuter',"tableKey==='orders'",
    "()=>ordersUiIntent([anchorEl],()=>[],()=>anchorEl.isConnected!==false)", 'anchorEl');
  const oldListeners=`['ordersSearch','ordersFCountry','ordersFLicense','ordersFDelType','ordersFStatus','ordersFSeason'].forEach(id=>{
  const el=document.getElementById(id);if(!el)return;
  if(el.tagName==='INPUT')el.addEventListener('input',renderOrdersDebounced);
  el.addEventListener('change',renderOrders);
});`;
  const listeners=`['ordersSearch','ordersFCountry','ordersFLicense','ordersFDelType','ordersFStatus','ordersFSeason'].forEach(id=>{
  const el=document.getElementById(id);if(!el)return;
  const run=(render,event)=>ordersUiChange('orders','orders.filter.control',el,
    ()=>ordersUiIntent([el],()=>[el.value],()=>document.getElementById(id)===el),()=>render.call(el,event));
  if(el.tagName==='INPUT')el.addEventListener('input',event=>run(renderOrdersDebounced,event));
  el.addEventListener('change',event=>run(renderOrders,event));
});`;
  out=once(out,oldListeners,listeners,'actual six Orders control listeners');
  // Preserve legacy full paste byte-for-byte; thin special paste invokes the
  // semantic command directly after full, never redispatches a native event.
  const pasteOld="    e.preventDefault();\n    const values=parseTableSearchClipboardMatrix(text);";
  const pasteNext=`    if(el.id==='ordersSearch'&&ordersProjectionIsThin()){
      e.preventDefault();const values=parseTableSearchClipboardMatrix(text),value=el.value;
      return ordersUiChange('orders','orders.filter.paste',el,
        ()=>ordersUiIntent([el],()=>[el.value],()=>document.getElementById(el.id)===el&&el.value===value),
        ()=>{el.value=values.join(', ');renderOrdersDebounced();});
    }
    e.preventDefault();
    const values=parseTableSearchClipboardMatrix(text);`;
  const paste=extractFunction(out,'bindTableSearchClipboardPaste');out=once(out,paste,once(paste,pasteOld,pasteNext,'main search paste'),'paste function');
  // Dimension domain changes occur after full. Each checkbox has its own lane:
  // independent choices are not accidentally collapsed to the last checkbox.
  const dims=extractFunction(out,'renderOrdersDimPanel');let nd=dims;
  nd=once(nd,"  panel.querySelector('.ordersDimAll')?.addEventListener('change',e=>{",`  panel.querySelector('.ordersDimAll')?.addEventListener('change',e=>ordersUiChange('orders','orders.dim.all',e.target,
    ()=>ordersUiIntent([panel,e.target],()=>[e.target.checked],()=>document.getElementById('ordersDimPanel_'+dim)===panel&&panel.contains(e.target)),()=>{`,'dim all start');
  nd=once(nd,"    }else e.target.checked=true;\n  });","    }else e.target.checked=true;\n  }));",'dim all end');
  nd=once(nd,"  panel.querySelectorAll('.ordersDimChk').forEach(chk=>chk.addEventListener('change',()=>{",`  panel.querySelectorAll('.ordersDimChk').forEach(chk=>chk.addEventListener('change',()=>ordersUiChange('orders','orders.dim.value',chk,
    ()=>ordersUiIntent([panel,chk],()=>[chk.value,chk.checked],()=>document.getElementById('ordersDimPanel_'+dim)===panel&&panel.contains(chk)),()=>{`,'dim value start');
  nd=once(nd,'    updateOrdersDimBtnLabels();saveOrdersDimFilters();renderOrders();\n  }));','    updateOrdersDimBtnLabels();saveOrdersDimFilters();renderOrders();\n  })));','dim value end');
  out=once(out,dims,nd,'dimension actual function');
  // A header's opening is gated above: rowsForFilterUniverse temporarily
  // deletes/restores a domain filter while constructing its option universe.
  const header=extractFunction(out,'openHeaderFilter');let nh=header;
  nh=once(nh,"  _openFilterPanel = panel;",`  _openFilterPanel = panel;
  const changeHeader=(reason,change,node)=>ordersUiChange(tableKey,reason,panel,
    ()=>ordersUiPanelIntent(panel,node?[node]:[]),change);`,'header helper');
  nh=once(nh,"  function applyFromBody(bodyEl, gran, addToCurrent=false){",`  function applyFromBody(bodyEl, gran, addToCurrent=false){
    if(tableKey==='orders'&&ordersProjectionIsThin())return changeHeader('orders.header.apply',()=>applyFromBody(bodyEl,gran,addToCurrent));`,'header apply');
  for(const [start,end,nextStart,nextEnd,label] of [
    ["    bodyEl.querySelector('.cfpRemoveSelection')?.addEventListener('click',()=>{","      updateDrawerSummaries();\n      closeHeaderFilter();\n    });",
      "    bodyEl.querySelector('.cfpRemoveSelection')?.addEventListener('click',()=>changeHeader('orders.header.remove',()=>{","      updateDrawerSummaries();\n      closeHeaderFilter();\n    }));",'header remove'],
    ["    panel.querySelectorAll('.cfpSortBtn').forEach(b=>b.addEventListener('click', ()=>{","      closeHeaderFilter();\n    }));",
      "    panel.querySelectorAll('.cfpSortBtn').forEach(b=>b.addEventListener('click', ()=>changeHeader('orders.header.sort',()=>{","      closeHeaderFilter();\n    },b)));",'header sort'],
    ["    if(clr) clr.addEventListener('click', ()=>{","      closeHeaderFilter();\n    });",
      "    if(clr) clr.addEventListener('click', ()=>changeHeader('orders.header.clear',()=>{","      closeHeaderFilter();\n    },clr));",'header clear'],
    ["    panel.querySelector('.cfpRangeApply')?.addEventListener('click',()=>{","      closeHeaderFilter();\n    });",
      "    panel.querySelector('.cfpRangeApply')?.addEventListener('click',()=>changeHeader('orders.header.range',()=>{","      closeHeaderFilter();\n    }));",'range apply'],
    ["    panel.querySelector('.cfpRangeClear')?.addEventListener('click',()=>{","      closeHeaderFilter();\n    });",
      "    panel.querySelector('.cfpRangeClear')?.addEventListener('click',()=>changeHeader('orders.header.range-clear',()=>{","      closeHeaderFilter();\n    }));",'range clear'],
    ["    panel.querySelectorAll('input[name=\"cfpRev\"]').forEach(radio=>radio.addEventListener('change',()=>{","      closeHeaderFilter();\n    }));",
      "    panel.querySelectorAll('input[name=\"cfpRev\"]').forEach(radio=>radio.addEventListener('change',()=>changeHeader('orders.header.revision',()=>{","      closeHeaderFilter();\n    },radio)));",'revision']
  ]){
    const at=nh.indexOf(start);assert.ok(at>=0,label);const stop=nh.indexOf(end,at);assert.ok(stop>at,label+' end');
    nh=nh.slice(0,at)+nextStart+nh.slice(at+start.length,stop)+nextEnd+nh.slice(stop+end.length);
  }
  out=once(out,header,nh,'actual header function');
  // Check-filter radio is domain state too, independent of checkbox selection.
  const checkPanel=extractFunction(out,'openCheckFilter');
  out=once(out,checkPanel,once(once(checkPanel,"  panel.querySelectorAll('input[name=chkf]').forEach(r=> r.addEventListener('change', ()=>{",
    "  panel.querySelectorAll('input[name=chkf]').forEach(r=> r.addEventListener('change', ()=>ordersUiChange(tableKey,'orders.check-filter',r,()=>ordersUiPanelIntent(panel,[r]),()=>{",'check radio start'),
    '    closeHeaderFilter();\n  }));','    closeHeaderFilter();\n  })));','check radio end'),'check filter');
  // Main KPI handlers retain actual semantic bodies; only their async entry is
  // wrapped. Header sort records the actual th label target in renderFullTable.
  const renderer=extractFunction(out,'renderOrdersNow');let nr=renderer;
  const qp="el.addEventListener('click',()=>";
  for(const [old,next] of [
    ["toggleOrdersActiveQuick(el.dataset.orderActive)","ordersUiChange('orders','orders.quick.active',el,()=>ordersUiIntent([el],()=>[el.dataset.orderActive]),()=>toggleOrdersActiveQuick(el.dataset.orderActive))"],
    ["toggleMirroredQuickFilter('orders','STATUS','ordersFStatus',el.dataset.status,renderOrders)","ordersUiChange('orders','orders.quick.status',el,()=>ordersUiIntent([el],()=>[el.dataset.status]),()=>toggleMirroredQuickFilter('orders','STATUS','ordersFStatus',el.dataset.status,renderOrders))"],
    ["toggleMirroredQuickFilter('orders','Del. Type','ordersFDelType',el.dataset.deltype,renderOrders)","ordersUiChange('orders','orders.quick.del',el,()=>ordersUiIntent([el],()=>[el.dataset.deltype]),()=>toggleMirroredQuickFilter('orders','Del. Type','ordersFDelType',el.dataset.deltype,renderOrders))"],
    ["toggleMirroredQuickFilter('orders','Season','ordersFSeason',el.dataset.season,renderOrders)","ordersUiChange('orders','orders.quick.season',el,()=>ordersUiIntent([el],()=>[el.dataset.season]),()=>toggleMirroredQuickFilter('orders','Season','ordersFSeason',el.dataset.season,renderOrders))"],
    ["toggleOrdersQuickExFactory(el.dataset.exf,renderOrders)","ordersUiChange('orders','orders.quick.exf',el,()=>ordersUiIntent([el],()=>[el.dataset.exf]),()=>toggleOrdersQuickExFactory(el.dataset.exf,renderOrders))"]
  ])nr=once(nr,qp+old+');',qp+next+');','actual quick listener '+old);
  const clear="if(el.dataset.act==='clearAll')el.addEventListener('click',()=>{";
  const clearEnd="state.ordersQuickActive.clear();clearColumnFilters('orders',mirrored);renderOrders();});";
  nr=once(nr,clear,"if(el.dataset.act==='clearAll')el.addEventListener('click',()=>ordersUiChange('orders','orders.quick.clear',el,()=>ordersUiIntent([el],()=>[el.dataset.act]),()=>{",'KPI clear start');
  nr=once(nr,clearEnd,"state.ordersQuickActive.clear();clearColumnFilters('orders',mirrored);renderOrders();}));",'KPI clear end');
  out=once(out,renderer,nr,'Orders actual renderer');
  // Shared table label click: callback sorting must not capture the old table
  // after its source is replaced while awaiting full.
  const table=extractFunction(out,'renderFullTable');let nt=table;
  nt=once(nt,'  const notifySelectionChange = ()=>{','  const notifySelectionChange = (selected=selSet,records=fullRows)=>{','selection notification parameters');
  nt=once(nt,"    if(typeof opts.onSelectionChange==='function') opts.onSelectionChange(selSet,fullRows);",
    "    if(typeof opts.onSelectionChange==='function') opts.onSelectionChange(selected,records);",'selection notification references');
  nt=once(nt,"    else label.addEventListener('click', e=>{ e.stopPropagation(); onSort(key); });",
    "    else label.addEventListener('click', e=>{ e.stopPropagation();return ordersUiChange(tableKey,'orders.sort.header',label,()=>ordersUiIntent([table,label],()=>[key],()=>document.getElementById(tableId)===table&&table.contains(label)),()=>onSort(key)); });",'header sort click');
  // Selection patches below deliberately remap actual row references through
  // the existing full receipt. A business ID is never a source/ordinal proof.
  const allStart="    selAll.addEventListener('change', ()=>{";
  const allEnd="      notifySelectionChange();\n    });";
  const at=nt.indexOf(allStart),stop=nt.indexOf(allEnd,at);assert.ok(at>=0&&stop>at,'select all');
  const allBody=nt.slice(at+allStart.length,stop);
  nt=nt.slice(0,at)+`    selAll.addEventListener('change', ()=>ordersUiChange(tableKey,'orders.selection.all',selAll,
      ()=>ordersUiIntent([table,selAll],()=>[selAll.checked],()=>document.getElementById(tableId)===table&&table.contains(selAll)),full=>{
      if(full){
        const liveRows=full.remapRows(fullRows),liveSet=state.ordersSelected;
        liveRows.forEach(row=>selectionSetId(liveSet,row._id,selAll.checked));
        if(liveSet.size>0)window.BLGridClipboard?.clear?.(tableId);
        renderOrders();
        if(typeof opts.onSelectionChange==='function')opts.onSelectionChange(liveSet,liveRows);else updateShippingBtnVisibility();
        return;
      }`+allBody+`      notifySelectionChange();
    }));`+nt.slice(stop+allEnd.length);
  const rowStart="      tbody.addEventListener('change', e=>{";
  const rowPrefix="        const meta = tbody._chkMeta; if(!meta) return;";
  nt=once(nt,rowPrefix,rowPrefix+`
        if(meta.tableKey==='orders'&&ordersProjectionIsThin())return ordersUiChange('orders','orders.selection.row',chk,
          ()=>ordersUiIntent([tbody,chk],()=>[chk.dataset.id,chk.checked],()=>tbody._chkMeta===meta&&tbody.contains(chk)&&document.getElementById(meta.tableId)===meta.table),full=>{
          const liveRows=full.remapRows(meta.rows),liveSet=state.ordersSelected,id=selectionActualId(liveRows,meta.getId,chk.dataset.id);
          selectionSetId(liveSet,id,chk.checked);
          if(liveSet.size>0)window.BLGridClipboard?.clear?.(meta.tableId);
          renderOrders();
          if(typeof meta.onSelectionChange==='function')meta.onSelectionChange(liveSet,liveRows);else updateShippingBtnVisibility();
        });`,'row checkbox');
  out=once(out,table,nt,'actual shared table selection');
  const partial="  setPartialView(tableKey,!partialViewEnabled(tableKey));";
  out=once(out,partial,"  return ordersUiChange(tableKey,'orders.partial',button,()=>ordersUiIntent([button],()=>[button.dataset.partialViewToggle]),()=>setPartialView(tableKey,!partialViewEnabled(tableKey)));",'partial actual listener');
  // Actual active-filter token buttons supply a DOM target; public direct
  // clear/remove sinks above remain guarded for callers without a UI node.
  out=once(out,"wrap.querySelectorAll('[data-filter-remove]').forEach(button=>button.addEventListener('click',()=>removeActiveFilterToken(tableKey,button.dataset.filterKind,button.dataset.filterKey)));",
    "wrap.querySelectorAll('[data-filter-remove]').forEach(button=>button.addEventListener('click',()=>ordersUiChange(tableKey,'orders.filter.remove',button,()=>ordersUiIntent([button],()=>[button.dataset.filterKind,button.dataset.filterKey]),()=>removeActiveFilterToken(tableKey,button.dataset.filterKind,button.dataset.filterKey))));",'active remove');
  out=once(out,"document.querySelectorAll('[data-active-filter-clear]').forEach(button=>button.addEventListener('click',()=>clearTableFilters(button.dataset.activeFilterClear)));",
    "document.querySelectorAll('[data-active-filter-clear]').forEach(button=>button.addEventListener('click',()=>ordersUiChange(button.dataset.activeFilterClear,'orders.filter.clear',button,()=>ordersUiIntent([button],()=>[button.dataset.activeFilterClear]),()=>clearTableFilters(button.dataset.activeFilterClear))));",'active clear');
  out=once(out,"  const info=activeTableInfo();if(info)clearTableFilters(info.tableKey);",
    "  const info=activeTableInfo();if(info)return ordersUiChange(info.tableKey,'orders.filter.nav-clear','orders-nav-clear',ordersUiControlsIntent,()=>clearTableFilters(info.tableKey));",'nav clear');
  // A selection undo captured against another full module cannot be applied
  // to a replacement thin module using IDs. Await full, then reject visibly.
  const managed=extractFunction(out,'managedSelectionChange');
  out=once(out,managed,once(managed,"    if(id!=='undo')return;",`    if(id!=='undo')return;
    if(tableKey==='orders'&&ordersProjectionIsThin())return ordersUiChange('orders','orders.selection.undo','orders-selection',()=>()=>true,()=>{throw ordersFullActionError('ORDERS_FULL_STALE');});`,'selection undo'),'managed undo');
  // Insert new declarations after all state/controller declarations, before
  // these UI callbacks can be invoked. Lazy module loading remains root-owned.
  out=once(out,"function renderActiveFilterContext(tableKey){",seam+'\nfunction renderActiveFilterContext(tableKey){','new private seam');
  return out;
}
function quick(source){
  const old=`      el.addEventListener('click', () => {
        const module = MODULES[moduleKey];`;
  const next=`      el.addEventListener('click', () => {
        const change=()=>{
        const module = MODULES[moduleKey];`;
  let out=once(source,old,next,'actual dynamic quick chip');
  const tail="        if (typeof rerender === 'function') rerender();\n      });";
  out=once(out,tail,`        if (typeof rerender === 'function') rerender();
        };
        if(moduleKey==='orders'&&typeof window.BLOrdersUiChange==='function')return window.BLOrdersUiChange('orders','orders.quick.extra',el,
          ()=>window.BLOrdersUiCommand.intent([el],()=>[el.dataset.qfgCol,el.dataset.qfgValue]),change);
        return change();
      });`,'dynamic chip completion');
  return out;
}
function selectionBar(source){
  // Gate the WHOLE Orders handler so drawPanel/snapshot and scheduling don't
  // run before managed clear/remove's asynchronous promotion has completed.
  let out=source;
  const panelStart="    panel.addEventListener('click',event=>{\n      event.stopPropagation();const button=event.target.closest('button');if(!button)return;";
  const panelNext=panelStart+"\n      const change=()=>{";
  out=once(out,panelStart,panelNext,'selection panel start');
  const panelEnd="      if(button.dataset.selectionClose!==undefined)closePanel(true);\n    });";
  const panelNextEnd=`      if(button.dataset.selectionClose!==undefined)closePanel(true);
      };
      if(lastKey==='orders'&&button.dataset.selectionRemove!==undefined&&typeof root.BLOrdersUiChange==='function')return root.BLOrdersUiChange('orders','orders.selection.popover',button,
        ()=>root.BLOrdersUiCommand.intent([button],()=>[button.dataset.selectionRemove,button.dataset.selectionClose]),change);
      return change();
    });`;
  out=once(out,panelEnd,panelNextEnd,'selection panel end');
  const barStart="      // Menü tetikleyicileri belge tıklamasıyla kapanmasın diye olay burada durur.\n      event.stopPropagation();";
  out=once(out,barStart,barStart+'\n      const change=()=>{','selection bar start');
  const barEnd="      schedule();\n    });\n  }\n  function closePanel";
  const barNextEnd=`      schedule();
      };
      const needsFull=button.dataset.selectionDismiss!==undefined||(button.dataset.selectionDetails!==undefined&&panel.hidden);
      if(lastKey==='orders'&&needsFull&&typeof root.BLOrdersUiChange==='function')return root.BLOrdersUiChange('orders','orders.selection.bar',button,
        ()=>root.BLOrdersUiCommand.intent([button],()=>[button.dataset.selectionDetails,button.dataset.selectionDismiss,button.dataset.selectionTarget]),change);
      return change();
    });
  }
  function closePanel`;
  out=once(out,barEnd,barNextEnd,'selection bar end');return out;
}
module.exports={app,quick,selectionBar};
