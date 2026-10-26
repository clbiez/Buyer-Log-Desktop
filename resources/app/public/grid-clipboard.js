(function(root,factory){
  const api=factory(root);
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.BLGridClipboard=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(root){
  'use strict';

  const tables=new Map();
  let dragging=null;
  let bound=false;

  function selectionSize(range){
    const rows=range?Math.max(0,range.endRow-range.startRow+1):0;
    const columns=range?Math.max(0,range.endColumn-range.startColumn+1):0;
    return {rows,columns,cells:rows*columns,label:`${rows}×${columns}`};
  }
  function serialize(matrix,exporter,options={}){
    const includeHeaders=options.includeHeaders!==false;
    return {plain:exporter.toTSV(matrix,{includeHeaders}),html:exporter.toSafeHTML(matrix,{includeHeaders}),includeHeaders};
  }
  function createDiagnostics(limit=50){
    const entries=[];const max=Math.max(1,Math.min(200,Number(limit)||50));
    const shape=value=>value&&typeof value==='object'?{rows:Math.max(0,Number(value.rows)||0),columns:Math.max(0,Number(value.columns)||0)}:undefined;
    return {
      record(raw={}){const error=raw.error;const entry={at:new Date().toISOString(),module:identity(raw.module),operation:['copy','paste'].includes(raw.operation)?raw.operation:'copy',selection:shape(raw.selection),clipboard:shape(raw.clipboard),includeHeaders:raw.includeHeaders!==false,transport:identity(raw.transport),ok:raw.ok===true,error:error?identity(error.name||error.code||'ClipboardError'):(raw.ok===false?'ClipboardWriteFailed':'')};entries.push(entry);while(entries.length>max)entries.shift();return entry;},
      list(){return entries.map(entry=>({...entry,selection:entry.selection&&{...entry.selection},clipboard:entry.clipboard&&{...entry.clipboard}}));},
      clear(){entries.length=0;},
    };
  }
  const diagnostics=createDiagnostics(50);

  function identity(value){return value==null?'':String(value);}
  function domToken(value){return encodeURIComponent(identity(value)).replace(/%/g,'_');}
  function cellDomId(tableId,rowId,columnId){return `bl-grid-${domToken(tableId)}-${domToken(rowId)}-${domToken(columnId)}`;}
  function resolveRange(anchor,focus,options){
    if(!anchor||!focus)return null;
    const rows=Array.isArray(options?.rows)?options.rows:[];
    const columns=Array.isArray(options?.columns)?options.columns:[];
    const rowId=typeof options?.rowId==='function'?options.rowId:row=>row?._id;
    const columnId=typeof options?.columnId==='function'?options.columnId:column=>column?.k;
    const ar=rows.findIndex(row=>identity(rowId(row))===identity(anchor.rowId));
    const fr=rows.findIndex(row=>identity(rowId(row))===identity(focus.rowId));
    const ac=columns.findIndex(column=>identity(columnId(column))===identity(anchor.columnId));
    const fc=columns.findIndex(column=>identity(columnId(column))===identity(focus.columnId));
    if(ar<0||fr<0||ac<0||fc<0)return null;
    return {startRow:Math.min(ar,fr),endRow:Math.max(ar,fr),startColumn:Math.min(ac,fc),endColumn:Math.max(ac,fc)};
  }

  function buildMatrix(options){
    const rows=Array.isArray(options?.rows)?options.rows:[];
    const columns=Array.isArray(options?.columns)?options.columns:[];
    const range=options?.range;
    const exporter=options?.exporter;
    if(!range||!exporter?.buildMatrix)return null;
    const records=rows.slice(range.startRow,range.endRow+1);
    const selectedColumns=columns.slice(range.startColumn,range.endColumn+1);
    return exporter.buildMatrix({
      records,
      columns:selectedColumns,
      columnLabel:typeof options.header==='function'?options.header:column=>column?.label||column?.k||'',
      cellText:typeof options.value==='function'?(column,row,rowIndex)=>options.value(row,column,rowIndex):undefined,
    });
  }

  function nativeEditingTarget(target){
    return Boolean(target?.closest?.('input,textarea,select,[contenteditable="true"],[role="textbox"]'));
  }

  function cellIdentity(td){
    const tr=td?.closest?.('tbody tr[data-id]');
    const columnId=td?.dataset?.key;
    if(!tr||columnId==null)return null;
    return {rowId:identity(tr.dataset.id),columnId:identity(columnId)};
  }

  function tableEntryFromCell(td){
    const table=td?.closest?.('table');
    return table?tables.get(table.id)||null:null;
  }

  function currentData(entry){
    const table=root.document?.getElementById?.(entry.tableId);
    const rows=entry.config.rows?.(table)||table?._blRenderedRows||[];
    const columns=entry.config.columns?.(table)||table?._blRenderedColumns||[];
    return {table,rows:Array.isArray(rows)?rows:[],columns:Array.isArray(columns)?columns:[]};
  }

  function currentRange(entry){
    const data=currentData(entry);
    return {
      ...data,
      range:resolveRange(entry.state.selectionAnchor,entry.state.selectionFocus,{
        rows:data.rows,columns:data.columns,
        rowId:entry.config.rowId,columnId:entry.config.columnId,
      }),
    };
  }

  function clearPaint(table){
    table?.querySelectorAll?.('.blGridActiveCell,.blGridRangeCell,.blGridRangeEdge').forEach(cell=>{
      cell.classList.remove('blGridActiveCell','blGridRangeCell','blGridRangeEdge');
      cell.setAttribute('aria-selected','false');
    });
  }

  function paint(entry){
    const {table,range}=currentRange(entry);
    if(!table)return;
    entry.state.selectionRange=range;
    clearPaint(table);
    entry.config.selectionChanged?.(range?selectionSize(range):null,entry.state);
    if(!range){table.removeAttribute('aria-activedescendant');return;}
    let activeDomId='';
    table.querySelectorAll('tbody td[data-key]').forEach(td=>{
      const row=Number(td.dataset.r),column=Number(td.dataset.c);
      if(row<range.startRow||row>range.endRow||column<range.startColumn||column>range.endColumn)return;
      td.classList.add('blGridRangeCell');
      td.setAttribute('aria-selected','true');
      if(row===range.startRow||row===range.endRow||column===range.startColumn||column===range.endColumn)td.classList.add('blGridRangeEdge');
      const id=cellIdentity(td);
      if(id&&identity(id.rowId)===identity(entry.state.activeCell?.rowId)&&identity(id.columnId)===identity(entry.state.activeCell?.columnId)){
        td.classList.add('blGridActiveCell');
        activeDomId=td.id||cellDomId(entry.tableId,id.rowId,id.columnId);td.id=activeDomId;
      }
    });
    if(activeDomId)table.setAttribute('aria-activedescendant',activeDomId);else table.removeAttribute('aria-activedescendant');
  }

  function setFocus(entry,cell,{extend=false,focus=true}={}){
    if(!cell)return false;
    if(!extend||!entry.state.selectionAnchor)entry.state.selectionAnchor=cell;
    entry.state.activeCell=cell;
    entry.state.selectionFocus=cell;
    paint(entry);
    if(focus)root.document?.getElementById?.(entry.tableId)?.focus?.({preventScroll:true});
    return true;
  }

  function entryIsActive(entry){
    return typeof entry.config.isActive==='function'?Boolean(entry.config.isActive()):true;
  }

  // Üstte açılan katman (ör. alt detay raporu çekmecesi) arkadaki CP/Orders
  // seçiminden önce gelir: priority yüksek olan etkin tablo kazanır.
  function activeEntry(){
    let best=null;
    for(const entry of tables.values()){
      if(!entryIsActive(entry)||!entry.state.activeCell)continue;
      if(!best||(Number(entry.config.priority)||0)>(Number(best.config.priority)||0))best=entry;
    }
    return best;
  }

  // Sağ tık yeni bir seçim başlangıcı değildir. Yalnızca tıklanan hücre
  // mevcut dikdörtgenin dışındaysa aktif hücreye taşınır.
  function prepareContextMenu(tableId,cell){
    const entry=tables.get(tableId);if(!entry||!entryIsActive(entry))return false;
    const clicked=cellIdentity(cell);if(!clicked)return false;
    const data=currentRange(entry);
    const rowIndex=data.rows.findIndex(row=>identity(entry.config.rowId(row))===clicked.rowId);
    const columnIndex=data.columns.findIndex(column=>identity(entry.config.columnId(column))===clicked.columnId);
    const cellInRange=Boolean(data.range&&rowIndex>=data.range.startRow&&rowIndex<=data.range.endRow&&columnIndex>=data.range.startColumn&&columnIndex<=data.range.endColumn);
    if(!cellInRange)setFocus(entry,clicked,{focus:false});
    return true;
  }

  async function copyEntry(entry,event,options={}){
    const data=currentRange(entry);
    if(!data.range)return false;
    const matrix=buildMatrix({
      rows:data.rows,columns:data.columns,range:data.range,
      rowId:entry.config.rowId,columnId:entry.config.columnId,
      header:entry.config.header,value:entry.config.value,exporter:entry.config.exporter,
    });
    if(!matrix)return false;
    event?.preventDefault?.();
    event?.stopImmediatePropagation?.();
    const result=await entry.config.copy?.(matrix,data.range,entry.state,options);
    return result!==false;
  }

  function parseClipboardText(text){
    const lines=identity(text).replace(/\r\n?/g,'\n').split('\n');
    if(lines.length>1&&lines[lines.length-1]==='')lines.pop();
    return lines.map(line=>line.split('\t'));
  }
  function isMultiCellText(text){
    const matrix=parseClipboardText(text);
    return matrix.length>1||(matrix[0]||[]).length>1;
  }

  // Kopyalanan matrisi seçili aralığa yerleştirir (Excel): tek değer seçimin
  // tamamını doldurur, seçim kopyanın tam katıysa desen tekrarlanır; aksi
  // hâlde sol üst hücreden kopya boyutunca yapıştırılır. Düzenlenemeyen veya
  // değeri geçersiz hücre atlanır, tablo dışına taşan kısım sayılır.
  function planPaste(options){
    const rows=Array.isArray(options?.rows)?options.rows:[];
    const columns=Array.isArray(options?.columns)?options.columns:[];
    const range=options?.range;
    const matrix=parseClipboardText(options?.text);
    const height=matrix.length,width=matrix.reduce((max,line)=>Math.max(max,line.length),0);
    const plan={ops:[],readonly:0,invalid:0,skipped:0,mode:'',source:{rows:height,columns:width},target:null};
    if(!range||!height||!width)return plan;
    const selectionRows=range.endRow-range.startRow+1,selectionColumns=range.endColumn-range.startColumn+1;
    let outRows=height,outColumns=width,mode='anchor';
    if(selectionRows*selectionColumns>1){
      if(height===1&&width===1){outRows=selectionRows;outColumns=selectionColumns;mode='fill';}
      else if(selectionRows%height===0&&selectionColumns%width===0){outRows=selectionRows;outColumns=selectionColumns;mode=selectionRows===height&&selectionColumns===width?'exact':'tile';}
    }
    plan.mode=mode;
    for(let r=0;r<outRows;r++){
      for(let c=0;c<outColumns;c++){
        const rowIndex=range.startRow+r,columnIndex=range.startColumn+c;
        const row=rows[rowIndex],column=columns[columnIndex];
        if(!row||!column){plan.skipped++;continue;}
        const target=typeof options.target==='function'?options.target(row,column):null;
        if(!target){plan.readonly++;continue;}
        const raw=matrix[r%height][c%width]??'';
        const parsed=typeof options.parse==='function'?options.parse(raw,target,row,column):{ok:true,value:raw};
        if(!parsed||parsed.ok===false){plan.invalid++;continue;}
        plan.ops.push({row,column,rowIndex,columnIndex,target,value:parsed.value});
      }
    }
    plan.target={
      startRow:range.startRow,endRow:Math.min(rows.length-1,range.startRow+outRows-1),
      startColumn:range.startColumn,endColumn:Math.min(columns.length-1,range.startColumn+outColumns-1),
    };
    return plan;
  }

  async function pasteEntry(entry,event,text){
    if(typeof entry.config.applyPaste!=='function')return false;
    const data=currentRange(entry);
    if(!data.range)return false;
    const plan=planPaste({
      text,rows:data.rows,columns:data.columns,range:data.range,
      target:entry.config.pasteTarget,parse:entry.config.pasteValue,
    });
    // Düzenlenecek hücre yoksa panodaki görsel, görsel hücresine yapıştırma
    // akışına (ör. CP görsel sütunu) bırakılır.
    if(!plan.ops.length&&clipboardHasImage(event))return false;
    event?.preventDefault?.();
    event?.stopImmediatePropagation?.();
    const result=await entry.config.applyPaste(plan,data.range,entry.state);
    // 7.0.300 toplu işlem önizlemesi asenkrondur. İptal/ret sonrasında
    // seçimi ve düzenleyici odağını değiştirmek bir sonraki Ctrl+C/V'yi bozar.
    if(result===false||result?.ok===false)return false;
    // Excel gibi: başarıyla yapıştırılan alan seçili kalır.
    const target=plan.target;
    const first=target&&cellAt(entry,target.startRow,target.startColumn);
    const last=target&&cellAt(entry,target.endRow,target.endColumn);
    if(first&&last){entry.state.selectionAnchor=entry.state.activeCell=first;entry.state.selectionFocus=last;}
    afterRender(entry.tableId);
    const table=root.document?.getElementById?.(entry.tableId);
    const focused=root.document?.activeElement;
    // Onay makbuzu hâlâ açıkken veya kullanıcı başka alana geçmişken,
    // tabloya focus vermek modal/yerel metin kopyalama davranışını bozmasın.
    const bulkDialogOpen=Boolean(root.document?.querySelector?.('.blBulkOverlay,.kolSpreadsheetPasteOverlay'));
    if(!bulkDialogOpen&&entryIsActive(entry)&&(!focused||focused===root.document?.body||focused===table||table?.contains?.(focused))){
      table?.focus?.({preventScroll:true});
    }
    return true;
  }

  function clipboardText(event){
    try{return identity(event?.clipboardData?.getData?.('text/plain'));}catch{return '';}
  }
  function clipboardHasImage(event){
    try{return Array.from(event?.clipboardData?.items||[]).some(item=>String(item?.type||'').startsWith('image/'));}catch{return false;}
  }

  function cellAt(entry,rowIndex,columnIndex){
    const {table,rows,columns}=currentData(entry);
    if(!table||!rows[rowIndex]||!columns[columnIndex])return null;
    const rowId=entry.config.rowId(rows[rowIndex]);
    const columnId=entry.config.columnId(columns[columnIndex]);
    return {rowId:identity(rowId),columnId:identity(columnId)};
  }

  function move(entry,dr,dc,extend){
    const data=currentRange(entry),range=data.range;
    if(!range||!entry.state.activeCell)return false;
    const activeRange=resolveRange(entry.state.activeCell,entry.state.activeCell,{
      rows:data.rows,columns:data.columns,rowId:entry.config.rowId,columnId:entry.config.columnId,
    });
    if(!activeRange)return false;
    let row=Math.max(0,Math.min(data.rows.length-1,activeRange.startRow+dr));
    let column=activeRange.startColumn+dc;
    if(column>=data.columns.length){row=Math.min(data.rows.length-1,row+1);column=0;}
    if(column<0){row=Math.max(0,row-1);column=Math.max(0,data.columns.length-1);}
    return setFocus(entry,cellAt(entry,row,column),{extend});
  }

  // Tablonun görünen tüm hücreleri (Ctrl+A).
  function selectAll(tableId){
    const entry=tables.get(tableId);if(!entry||!entryIsActive(entry))return false;
    const {rows,columns}=currentData(entry);if(!rows.length||!columns.length)return false;
    const first=cellAt(entry,0,0),last=cellAt(entry,rows.length-1,columns.length-1);if(!first||!last)return false;
    entry.state.selectionAnchor=first;entry.state.activeCell=first;entry.state.selectionFocus=last;
    paint(entry);return true;
  }

  function bind(){
    if(bound||!root.document?.addEventListener)return;bound=true;
    root.document.addEventListener('pointerdown',event=>{
      if(event.button!==0||nativeEditingTarget(event.target))return;
      const td=event.target?.closest?.('tbody td[data-key]'),entry=tableEntryFromCell(td);
      if(!entry||!entryIsActive(entry))return;
      const cell=cellIdentity(td);if(!cell)return;
      // Bağlantı/düğme/görsel taşıyan hücre de seçilebilir olmalı: eskiden bu
      // hedefler hiç seçilmiyordu ve model adı, sipariş kodu, görsel gibi
      // hücreler Ctrl+C ile kopyalanamıyordu. İç öğenin kendi tıklaması
      // korunur (preventDefault yok); sürükleyerek aralık seçimi başlatılmaz.
      if(event.target?.closest?.('button,a,img,label')){
        setFocus(entry,cell,{extend:event.shiftKey,focus:false});
        return;
      }
      event.preventDefault();
      root.getSelection?.()?.removeAllRanges?.();
      setFocus(entry,cell,{extend:event.shiftKey});
      dragging={entry};
    },true);
    root.document.addEventListener('pointermove',event=>{
      if(!dragging)return;
      const td=event.target?.closest?.(`#${dragging.entry.tableId} tbody td[data-key]`);
      if(td)setFocus(dragging.entry,cellIdentity(td),{extend:true,focus:false});
    },true);
    root.document.addEventListener('pointerup',()=>{dragging=null;},true);
    // Ctrl+V: yalnız applyPaste tanımlayan tablolar (ör. CP) yapıştırma alır.
    root.document.addEventListener('paste',event=>{
      if(event.defaultPrevented)return;
      const text=clipboardText(event);if(!text)return;
      const target=event.target;
      if(nativeEditingTarget(target)){
        // Serbest metin/not textarea'sındaki satır sonu ve TAB karakterleri
        // hücre sınırı değildir; tarayıcının yerel yapıştırmasını koru.
        if(String(target?.tagName||'').toUpperCase()==='TEXTAREA')return;
        // Hücre düzenleyicisinde tek değer yerel olarak yapıştırılır; sekme veya
        // satır sonu içeren (Excel'den çoklu hücre) metin bu hücreden başlayarak dağıtılır.
        if(!isMultiCellText(text))return;
        const td=target.closest?.('tbody td[data-key]'),entry=tableEntryFromCell(td);
        if(!entry||!entryIsActive(entry)||typeof entry.config.applyPaste!=='function')return;
        const cell=cellIdentity(td);if(!cell)return;
        setFocus(entry,cell,{focus:false});
        void pasteEntry(entry,event,text);return;
      }
      // Birden çok tabloda aralık tutulabilir: olayın geldiği tablo,
      // arkada kalmış en son aktif aralıktan önce gelir.
      const direct=tableEntryFromCell(target?.closest?.('tbody td[data-key]'));
      const entry=direct&&entryIsActive(direct)&&direct.state.activeCell?direct:activeEntry();
      if(!entry||typeof entry.config.applyPaste!=='function')return;
      const table=root.document.getElementById(entry.tableId);
      if(target!==table&&!table?.contains?.(target)&&target!==root.document.body)return;
      void pasteEntry(entry,event,text);
    },true);
    root.document.addEventListener('keydown',event=>{
      if(nativeEditingTarget(event.target))return;
      const nativeSelection=root.getSelection?.();
      if(nativeSelection&&nativeSelection.rangeCount&&!nativeSelection.isCollapsed)return;
      const entry=activeEntry();if(!entry)return;
      const key=String(event.key||'').toLowerCase();
      // Ctrl+C varsayılanı başlıksız "Kopyala"dır (Excel davranışı). Başlıklı
      // kopya sağ tık › "Başlıklarla kopyala" ile bilerek seçilir.
      if((event.ctrlKey||event.metaKey)&&!event.altKey&&!event.shiftKey&&key==='c'){
        void copyEntry(entry,event,{includeHeaders:false});return;
      }
      const table=root.document.getElementById(entry.tableId);
      if(event.target!==table&&!table?.contains?.(event.target))return;
      if((event.ctrlKey||event.metaKey)&&!event.altKey&&!event.shiftKey&&key==='a'){
        if(selectAll(entry.tableId))event.preventDefault();return;
      }
      if(event.key==='Escape'){event.preventDefault();clear(entry.tableId);return;}
      const arrows={ArrowDown:[1,0],ArrowUp:[-1,0],ArrowRight:[0,1],ArrowLeft:[0,-1]};
      if(arrows[event.key]){event.preventDefault();move(entry,...arrows[event.key],event.shiftKey);return;}
      if(event.key==='Tab'){event.preventDefault();move(entry,0,event.shiftKey?-1:1,false);return;}
      if(event.key==='Enter'){event.preventDefault();move(entry,event.shiftKey?-1:1,0,false);}
    },true);
  }

  function register(tableId,config){
    const existing=tables.get(tableId);
    const entry=existing||{tableId,state:{activeCell:null,selectionAnchor:null,selectionFocus:null,selectionRange:null,editingCell:null},config:{}};
    entry.config={...entry.config,...config};tables.set(tableId,entry);bind();afterRender(tableId);return entry.state;
  }

  function afterRender(tableId){
    const entry=tables.get(tableId),table=root.document?.getElementById?.(tableId);if(!entry||!table)return;
    const data=currentRange(entry);
    const label=typeof entry.config.label==='function'?entry.config.label():entry.config.label;
    table.setAttribute('role','grid');table.setAttribute('tabindex','0');table.setAttribute('aria-multiselectable','true');
    table.setAttribute('aria-rowcount',String(data.rows.length+1));table.setAttribute('aria-colcount',String(data.columns.length));
    if(label)table.setAttribute('aria-label',identity(label));
    table.querySelectorAll('thead th[data-k]').forEach((th,index)=>{th.setAttribute('role','columnheader');th.setAttribute('aria-colindex',String(index+1));});
    table.querySelectorAll('tbody tr[data-id]').forEach((tr,rowIndex)=>{
      tr.setAttribute('role','row');tr.setAttribute('aria-rowindex',String(rowIndex+2));
      tr.querySelectorAll('td[data-key]').forEach((td,columnIndex)=>{
        const id=cellIdentity(td);td.id=id?cellDomId(tableId,id.rowId,id.columnId):'';
        td.setAttribute('role','gridcell');td.setAttribute('aria-rowindex',String(rowIndex+2));td.setAttribute('aria-colindex',String(columnIndex+1));td.setAttribute('aria-selected','false');
      });
    });
    entry.state.selectionRange=data.range;
    if(entry.state.activeCell&&!resolveRange(entry.state.activeCell,entry.state.activeCell,{rows:data.rows,columns:data.columns,rowId:entry.config.rowId,columnId:entry.config.columnId})){
      entry.state.activeCell=entry.state.selectionAnchor=entry.state.selectionFocus=entry.state.selectionRange=null;
    }
    paint(entry);
  }

  function clear(tableId){
    const entry=tables.get(tableId);if(!entry)return;
    entry.state.activeCell=entry.state.selectionAnchor=entry.state.selectionFocus=entry.state.selectionRange=entry.state.editingCell=null;
    const table=root.document?.getElementById?.(tableId);clearPaint(table);table?.removeAttribute?.('aria-activedescendant');
  }

  function copyActive(event,options){const entry=activeEntry();return entry?copyEntry(entry,event,options):false;}
  function state(tableId){return tables.get(tableId)?.state||null;}
  function restoreActive(tableId,cell){
    const entry=tables.get(tableId);if(!entry||!cell)return false;
    const data=currentRange(entry);
    if(!resolveRange(cell,cell,{rows:data.rows,columns:data.columns,rowId:entry.config.rowId,columnId:entry.config.columnId}))return false;
    return setFocus(entry,cell,{focus:false});
  }

  return {resolveRange,buildMatrix,selectionSize,serialize,createDiagnostics,diagnostics,nativeEditingTarget,parseClipboardText,isMultiCellText,planPaste,register,afterRender,clear,copyActive,selectAll,state,restoreActive,prepareContextMenu};
});
