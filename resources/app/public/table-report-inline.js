/* Buyer Log — tablo içi Rapor görünümü (CP / Siparişler / Koleksiyon).
 * Ana tablo kendi yerinde rapor düzenine döner: görünen alanlar BLDetailReportLayout
 * rol gruplarında iki satırlı hücrelere toplanır. Satırlar tablonun o anki filtre,
 * sıralama ve sayfa aralığından gelir (aynı sayfalama çubuğu çalışır). Salt okunurdur:
 * kayıtlar, seçim, düzenleme, dışa aktarma ve filtre durumu değişmez; tabloya dönünce
 * her şey olduğu gibidir. Görünmeyen sekmede çizim yapmaz; dönüşte yeniden çizer.
 */
(function(root){
'use strict';
const doc=root.document;if(!doc)return;
const STORE_PREFIX='buyerlog.tableReportMode.v1.';
const CHUNK=300;
const adapters=new Map(),dirty=new Set(),limits=new Map(),drafts=new Map(),contexts=new Map();
const pendingImageFits=new Set();
let drag=null;
let frame=0,sharedLayouts=readLayout(STORE_PREFIX+'shared.v1'),sharedRequest=null,sharedLoaded=false,sharedGeneration=0,sharedAgain=false;
function sharedSlot(key,adapter){return key+'.'+(adapter.view?.()||'custom');}
function sharedEntry(key,adapter){return sharedLayouts?.slots?.[sharedSlot(key,adapter)]||null;}
function refreshShared(force=false){
  if(sharedRequest){if(force)sharedAgain=true;return sharedRequest;}
  if(typeof root.fetch!=='function')return Promise.resolve();
  const generation=sharedGeneration;
  sharedRequest=root.fetch('/api/table-report-layouts',{cache:'no-store'}).then(async response=>{if(!response.ok)throw new Error('layout-read');return response.json();}).then(data=>{
    if(generation!==sharedGeneration)return;
    sharedLayouts=data;sharedLoaded=true;try{store().setItem(STORE_PREFIX+'shared.v1',JSON.stringify(data));}catch(_){}for(const key of adapters.keys())schedule(key);
  }).catch(()=>{}).finally(()=>{sharedRequest=null;if(sharedAgain){sharedAgain=false;return refreshShared();}});return sharedRequest;
}
const isEn=()=>{try{return typeof root.appLang!=='undefined'?root.appLang==='en':doc.documentElement.lang==='en';}catch(_){return false;}};
const L=(tr,en)=>isEn()?en:tr;
const clean=value=>String(value==null?'':value).replace(/\s+/g,' ').trim();
const esc=value=>clean(value).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
function store(){return root.BLStorage||root.localStorage;}
function saved(key){try{return store().getItem(STORE_PREFIX+key)==='1';}catch(_){return false;}}
function save(key,on){try{if(on)store().setItem(STORE_PREFIX+key,'1');else store().removeItem(STORE_PREFIX+key);}catch(_){}}
const modes=new Map();
function isActive(key){if(!modes.has(key))modes.set(key,saved(key));return modes.get(key)===true;}
function register(key,adapter){adapters.set(key,adapter);if(isActive(key)){schedule(key);if(!sharedLoaded)void refreshShared();}}
function tabVisible(adapter){return doc.body?.dataset?.activeTab===adapter.tab;}
function sourceWrap(adapter){return adapter.table()?.closest?.('.tablewrap')||null;}
function host(key,adapter,create){
  let el=sourceWrap(adapter)?.querySelector(':scope > [data-table-report-inline="'+key+'"]');
  if(el||!create)return el;
  const wrap=sourceWrap(adapter);if(!wrap)return null;
  el=doc.createElement('div');el.className='blTableReportInline';el.dataset.tableReportInline=key;
  el.innerHTML='<div class="blTableReportBar"><b data-tr-title></b><span data-tr-count></span><span data-tr-actions></span><button type="button" class="tbtn" data-table-report-exit></button></div>'+
    '<table class="blDetailTable blTableReportTable" id="blTableReport-'+key+'"><colgroup></colgroup><thead></thead><tbody></tbody></table>';
  wrap.appendChild(el);
  const table=el.querySelector('table');
  if(root.ResizeObserver)new root.ResizeObserver(()=>scheduleImageFit(key,table)).observe(table.tBodies[0]);
  el.addEventListener('load',event=>{
    if(event.target.matches?.('.blDetailImageCell img[data-src]'))scheduleImageFit(key,table);
  },true);
  bindLayoutEvents(el,key,adapter);
  el.addEventListener('click',event=>{
    if(event.target.closest('[data-table-report-exit]')){setMode(key,false);return;}
    if(event.target.closest('[data-tr-more]')){limits.set(key,(limits.get(key)||CHUNK)+CHUNK);render(key);return;}
    const imageSize=event.target.closest('[data-tr-image-size]');
    if(imageSize){event.preventDefault();adapter.resizeImages?.(imageSize);return;}
    const filter=event.target.closest('[data-tr-filter]');
    if(filter){
      event.preventDefault();event.stopPropagation();
      const menu=filter.closest('details');if(menu)menu.open=false;
      try{adapter.filter?.(filter.dataset.trFilter,filter);}catch(err){console.warn('[rapor görünümü] filtre açılamadı',err);}
    }
  });
  return el;
}
function assignHtml(node,html){if(node._blReportHtml===html)return false;node.innerHTML=html;node._blReportHtml=html;return true;}
function assignText(node,text){if(node.textContent!==text)node.textContent=text;}
function labels(){return {identity:L('Sipariş / Model','Order / Model'),buyer:L('Buyer / Grup','Buyer / Group'),supplier:L('Üretici / Sezon','Manufacturer / Season'),status:L('Durum / Portföy','Status / Portfolio'),context:L('Sevkiyat / Rota','Shipment / Route')};}
/* Sütun ana başlıkları (tablonun grup satırı) raporun sütunlarıdır: başlık satırındaki her ardışık
   grup tek rapor sütunu olur, alanları tablodaki sırayla alt alta durur (ilk alan birincil satır).
   Ana başlığı olmayan sütun tek başına kalır. Sayısal tek alanlı sütun sağa hizalanır. */
const NUMERIC_TYPES=new Set(['integer','quantity','decimal','currency','percentage','number']);
function groupProjection(columns){
  const out=[];
  for(const col of columns){
    const group=clean(col.group),last=out[out.length-1];
    if(group&&last&&last.group===group){last.fields.push(col);continue;}
    out.push({key:'__report_group_'+out.length+'_'+(group||col.key),layoutId:JSON.stringify([col.groupId||group||col.key,out.filter(item=>(item.groupId||item.group)===(col.groupId||group)).length]),groupId:col.groupId,label:group||col.label,group,fields:[col]});
  }
  return out.map(col=>{
    const numeric=col.fields.length===1&&NUMERIC_TYPES.has(String(col.fields[0].dataType||col.fields[0].type||''));
    return {...col,reportRole:numeric?'number':'field',widthPx:col.fields.length>1?Math.min(320,150+col.fields.length*14):(numeric?110:140)};
  });
}
function cellText(field,row){try{const text=clean(field.text(row));return text==='—'?'':text;}catch(_){return '';}}
function preferenceKey(key,adapter){return STORE_PREFIX+'layout.'+key+'.'+(adapter.view?.()||'custom');}
function readLayout(id){try{const value=JSON.parse(store().getItem(id)||'{}');return value&&typeof value==='object'&&!Array.isArray(value)?value:{};}catch(_){return {};}}
function effectiveLayout(personal,shared){
  const common=shared?.layout||{};
  if(personal.version!==2)return shared?common:personal;
  const own=personal.layout;
  return personal.sharedId===(shared?.id||'')&&own&&typeof own==='object'&&!Array.isArray(own)?own:common;
}
function orderedLines(col,prefs){
  const fields=new Map(col.fields.map(field=>[field.key,field])),seen=new Set();
  const saved=prefs[col.layoutId||col.key];
  if(!Array.isArray(saved))return [[col.fields[0]].filter(Boolean),col.fields.slice(1),[]];
  const lines=[0,1,2].map(i=>(Array.isArray(saved[i])?saved[i]:[]).flatMap(key=>{
    if(seen.has(key)||!fields.has(key))return [];seen.add(key);return [fields.get(key)];
  }));
  // Hidden or late-loaded fields keep saved positions; genuinely new fields append below.
  col.fields.forEach(field=>{if(!seen.has(field.key))lines[1].push(field);});
  return lines;
}
function layoutFor(key){const context=contexts.get(key);return drafts.get(key)?.value||context?.saved||{};}
function cellHtml(col,row,moduleId){
  const lines=col.lines||[[col.fields[0]],col.fields.slice(1),[]];
  const html=lines.map((fields,index)=>{
    const parts=fields.map(field=>({field,text:cellText(field,row)})).filter(part=>part.text);
    if(!parts.length)return '';
    return '<div class="'+(index===0?'blDetailReportPrimary':'blDetailReportSub')+'">'+parts.map(part=>'<span title="'+esc(part.field.label+': '+part.text)+'">'+esc(part.text)+'</span>').join(' · ')+'</div>';
  }).join('');
  return html||'—';
}
function editorHtml(col,index){
  return '<td><div class="blReportCellEditor" data-tr-group="'+index+'">'+col.lines.map((fields,line)=>
    '<div class="blReportDropLine" data-tr-line="'+line+'"><small>'+esc(line===0?L('Ana bilgi','Primary'):line===1?L('2. satır','Line 2'):L('3. satır','Line 3'))+'</small>'+fields.map(field=>
      '<button type="button" class="tbtn blReportField" draggable="true" data-tr-field="'+esc(field.key)+'" title="'+esc(L('Sürükleyin veya Alt + ok tuşlarıyla taşıyın','Drag or move with Alt + arrow keys'))+'">⠿ '+esc(field.label)+'</button>').join('')+'</div>').join('')+'</div></td>';
}
function moveField(key,group,field,line,before){
  const context=contexts.get(key),draft=drafts.get(key),col=context?.projected[group];
  if(!draft||draft.saving||!col||!col.fields.some(item=>item.key===field)||line<0||line>2)return;
  const lines=orderedLines(col,draft.value).map(items=>items.map(item=>item.key).filter(k=>k!==field));
  const index=before?lines[line].indexOf(before):-1;lines[line].splice(index<0?lines[line].length:index,0,field);
  const previous=draft.value[col.layoutId||col.key];
  if(Array.isArray(previous)){const visible=new Set(col.fields.map(item=>item.key));previous.slice(0,3).forEach((items,i)=>{if(Array.isArray(items))items.forEach((item,j)=>{if(!visible.has(item)&&typeof item==='string')lines[i].splice(Math.min(j,lines[i].length),0,item);});});}
  draft.error='';draft.value={...draft.value,[col.layoutId||col.key]:lines};render(key);
  const el=host(key,adapters.get(key),false);
  [...(el?.querySelectorAll('[data-tr-field]')||[])].find(button=>button.dataset.trField===field&&Number(button.closest('[data-tr-group]').dataset.trGroup)===group)?.focus({preventScroll:true});
}
function bindLayoutEvents(el,key,adapter){
  el.addEventListener('click',event=>{
    const action=event.target.closest('[data-tr-action]')?.dataset.trAction;if(!action)return;
    const context=contexts.get(key);if(!context)return;
    if(action==='edit')drafts.set(key,{id:context.id,baseId:context.sharedId,value:JSON.parse(JSON.stringify(context.saved))});
    if(action==='cancel')drafts.delete(key);
    if(action==='reset'&&drafts.has(key))drafts.get(key).value={};
    if(action==='save'||action==='save-all'){
      const draft=drafts.get(key);if(!draft)return;
      const latest=sharedEntry(key,adapter)?.id||'';
      if(draft.baseId!==latest){el.querySelector('[data-tr-hint]').textContent=L('Yeni bir ortak düzen yayımlandı. Vazgeç ile güncel düzeni açın.','A new shared layout was published. Cancel to open the current layout.');return;}
      if(action==='save-all'){
        if(!root.BLIsModerator?.()||draft.saving)return;
        draft.saving=true;const submitted=JSON.parse(JSON.stringify(draft.value));event.target.disabled=true;render(key);
        const view=adapter.view?.()||'custom';
        root.fetch('/api/table-report-layouts',{method:'PUT',headers:{'Content-Type':'application/json',...(root.BL_CLIENT_ID?{'X-Client-Id':root.BL_CLIENT_ID}:{})},body:JSON.stringify({table:key,view,layout:submitted,expectedId:draft.baseId})}).then(async response=>{
          const data=await response.json();if(!response.ok)throw new Error(data.code||'save');
          sharedGeneration++;sharedLayouts=data;sharedLoaded=true;try{store().setItem(STORE_PREFIX+'shared.v1',JSON.stringify(data));}catch(_){}
          try{store().setItem(draft.id,JSON.stringify({version:2,sharedId:sharedEntry(key,adapter)?.id||'',layout:submitted}));}catch(_){}
          if(drafts.get(key)===draft)drafts.delete(key);for(const table of adapters.keys())schedule(table);
          root.showToast?.(L('Rapor düzeni herkes için kaydedildi.','Report layout saved for everyone.'));
        }).catch(error=>{
          draft.saving=false;event.target.disabled=false;
          draft.error=error.message==='REPORT_LAYOUT_CONFLICT'?L('Ortak düzen değişti. Vazgeç ile güncel düzeni açın.','The shared layout changed. Cancel to open the current layout.'):L('Herkes için kaydedilemedi. Yeniden deneyin.','Could not save for everyone. Try again.');
          if(drafts.get(key)===draft&&isActive(key)&&tabVisible(adapter))render(key);void refreshShared();
        });return;
      }
      try{store().setItem(draft.id,JSON.stringify({version:2,sharedId:latest,layout:draft.value}));drafts.delete(key);}
      catch(_){el.querySelector('[data-tr-hint]').textContent=L('Düzen kaydedilemedi. Yeniden deneyin.','Layout could not be saved. Try again.');return;}
    }
    render(key);if(action==='edit')root.BLMotionPlus?.play('card',el.querySelector('.blReportLayoutRow'));
  });
  el.addEventListener('dragstart',event=>{
    const field=event.target.closest('[data-tr-field]');if(!field)return;
    drag={key,group:Number(field.closest('[data-tr-group]').dataset.trGroup),field:field.dataset.trField};
    event.dataTransfer?.setData('text/plain',drag.field);if(event.dataTransfer)event.dataTransfer.effectAllowed='move';
  });
  el.addEventListener('dragover',event=>{
    const zone=event.target.closest('[data-tr-line]');
    if(!zone||drag?.key!==key||Number(zone.closest('[data-tr-group]').dataset.trGroup)!==drag.group)return;
    event.preventDefault();el.querySelectorAll('.isDropTarget').forEach(node=>node.classList.remove('isDropTarget'));zone.classList.add('isDropTarget');
  });
  el.addEventListener('dragleave',event=>{const zone=event.target.closest('[data-tr-line]');if(zone&&!zone.contains(event.relatedTarget))zone.classList.remove('isDropTarget');});
  el.addEventListener('drop',event=>{
    const zone=event.target.closest('[data-tr-line]');
    if(!zone||drag?.key!==key||Number(zone.closest('[data-tr-group]').dataset.trGroup)!==drag.group)return;
    event.preventDefault();const target=event.target.closest('[data-tr-field]');
    let before=target?.dataset.trField;
    if(target&&event.clientY>target.getBoundingClientRect().top+target.offsetHeight/2)before=target.nextElementSibling?.dataset.trField;
    if(before!==drag.field)moveField(key,drag.group,drag.field,Number(zone.dataset.trLine),before);
    drag=null;
  });
  el.addEventListener('dragend',()=>{drag=null;el.querySelectorAll('.isDropTarget').forEach(node=>node.classList.remove('isDropTarget'));});
  el.addEventListener('keydown',event=>{
    const button=event.target.closest('[data-tr-field]');if(!button||!event.altKey||!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(event.key))return;
    event.preventDefault();event.stopPropagation();
    const group=Number(button.closest('[data-tr-group]').dataset.trGroup),line=Number(button.closest('[data-tr-line]').dataset.trLine);
    const col=contexts.get(key).projected[group],lines=orderedLines(col,layoutFor(key)),fields=lines[line],index=fields.findIndex(field=>field.key===button.dataset.trField);
    if(event.key==='ArrowLeft'||event.key==='ArrowRight')moveField(key,group,button.dataset.trField,Math.max(0,Math.min(2,line+(event.key==='ArrowLeft'?-1:1))));
    else if(event.key==='ArrowUp'&&index>0)moveField(key,group,button.dataset.trField,line,fields[index-1].key);
    else if(event.key==='ArrowDown'&&index<fields.length-1)moveField(key,group,button.dataset.trField,line,fields[index+2]?.key);
  });
  el.addEventListener('change',event=>{
    const checkbox=event.target.closest('[data-tr-check]');if(!checkbox)return;
    const context=contexts.get(key),table=checkbox.closest('table');
    if(!context||!adapter.selectRows)return;
    if(checkbox.dataset.trCheck==='all')adapter.selectRows(context.rows,checkbox.checked);
    else{
      const row=context.shown[Number(checkbox.dataset.trCheck)];if(!row)return;
      const range=root.BLGridRangeSelect?.takeReportRange(checkbox);
      adapter.selectRows(range?range.map(index=>context.shown[index]).filter(Boolean):[row],checkbox.checked);
    }
    syncRowSelection(table,contexts.get(key),adapter);
  });
  el.addEventListener('contextmenu',event=>{
    const target=event.target.closest('tbody tr[data-id]');
    const cell=event.target.closest('td[data-key]')||target?.querySelector('td[data-key]');if(!cell||drafts.has(key))return;
    event.preventDefault();if(!root.BLGridClipboard?.state('blTableReport-'+key))registerSelection(key,adapter);root.BLGridClipboard?.prepareContextMenu('blTableReport-'+key,cell);const row=contexts.get(key)?.shown[Number(cell.dataset.r)];
    if(row)adapter.contextMenu?.(event,row,cell);
  });
}
function copySelection(key,event,options={}){
  const adapter=adapters.get(key),state=root.BLGridClipboard?.state('blTableReport-'+key);
  if(!isActive(key)||drafts.has(key)||!adapter?.selectable?.()||!state?.selectionRange||adapter.checked?.())return false;
  void root.BLGridClipboard.copyActive(event,options);return true;
}
function registerSelection(key,adapter){
  const grid=root.BLGridClipboard;if(!grid)return;
  const id='blTableReport-'+key;
  grid.register(id,{
    priority:10,isActive:()=>isActive(key)&&tabVisible(adapter)&&!drafts.has(key)&&adapter.selectable?.()!==false,
    label:()=>L('Rapor görünümü','Report view'),rows:()=>contexts.get(key)?.rows||[],columns:()=>contexts.get(key)?.selectionColumns||[],
    rowId:row=>adapter.rowId?.(row),columnId:column=>column.key,header:column=>column.label,value:()=>'',exporter:root.BLTableExport,
    selectionChanged:adapter.selectionChanged,
    copy:(_matrix,range,_state,options)=>{
      const context=contexts.get(key);
      const fields=context.selectionColumns.slice(range.startColumn,range.endColumn+1).flatMap(col=>col.fields.map(field=>field.key));
      return adapter.copy?.(context.rows.slice(range.startRow,range.endRow+1),fields,options);
    }
  });
}
function imageCell(row,moduleId,index){
  const helper=root.BLDetailImages;
  const primary=helper.identityFromRow(row,moduleId),nested=row?.raw||row?.row;
  const identity=nested?helper.identityFromRow(nested,moduleId):{};
  for(const key of Object.keys(primary))if(primary[key])identity[key]=primary[key];
  const id=helper.resolve(index,identity);
  return helper.thumbHtml(id.source,{...id,modelId:id.plmId||id.modelName},
    {title:L('Büyük önizleme için üzerine gelin','Hover for large preview'),allowEmpty:true});
}
function sizeColumns(table,wrap,{projected,checkable,imageDims,imageFitWidth}){
  const imageWidth=imageDims?Math.max(imageDims.col,imageFitWidth):0;
  if(imageDims){
    for(const [name,value] of Object.entries({col:imageWidth,height:imageDims.h,row:imageDims.row})){
      const property='--bl-report-image-'+name,px=value+'px';
      if(table.style.getPropertyValue(property)!==px)table.style.setProperty(property,px);
    }
  }
  const leading=imageWidth+(checkable?8:0);
  let widths=projected.map(col=>Number(col.widthPx)||140);
  const totalWidth=widths.reduce((sum,width)=>sum+width,0),viewport=wrap?.clientWidth||0;
  const stretch=totalWidth>0&&viewport>totalWidth+leading;
  if(stretch)widths=widths.map(width=>width*(viewport-leading)/totalWidth);
  assignHtml(table.querySelector('colgroup'),(checkable?'<col data-row-selection style="width:8px">':'')+(imageDims?'<col style="width:'+imageWidth+'px">':'')+widths.map(w=>'<col style="width:'+w+'px">').join(''));
  // table-layout:fixed: genişlik sütunların toplamıdır; rol grupları sıkışmaz.
  const width=(stretch?viewport:totalWidth+leading)+'px';
  if(table.style.width!==width)table.style.width=width;
}
function scheduleImageFit(key,table){
  if(!contexts.get(key)?.imageDims||pendingImageFits.has(key))return;
  pendingImageFits.add(key);
  root.requestAnimationFrame(()=>{
    pendingImageFits.delete(key);
    const context=contexts.get(key),adapter=adapters.get(key),dims=context?.imageDims;
    if(!dims||!adapter||!isActive(key)||!tabVisible(adapter)||!table.isConnected)return;
    // Satır metinle uzadığında görselin en-boy oranını koruyacak genişliği ayır.
    let width=0;
    for(const img of table.tBodies[0].querySelectorAll('.blDetailImageCell img[data-src]:not(.isPlaceholder)')){
      const ratio=img.dataset.blImageLoaded==='1'&&img.naturalHeight?img.naturalWidth/img.naturalHeight:dims.w/dims.h;
      width=Math.max(width,Math.ceil(img.offsetHeight*ratio)+8);
    }
    if(width===context.imageFitWidth)return;
    context.imageFitWidth=width;
    sizeColumns(table,sourceWrap(adapter),context);
  });
}
function updateImageDimensions(key,dims){
  const context=contexts.get(key),adapter=adapters.get(key);
  if(!context?.imageDims||!adapter||!isActive(key)||!tabVisible(adapter))return;
  const table=doc.getElementById('blTableReport-'+key);
  if(table){
    context.imageDims=dims;
    sizeColumns(table,sourceWrap(adapter),context);
    scheduleImageFit(key,table);
  }
}
function syncRowSelection(table,{rows,shown,checkable},adapter){
  if(!checkable)return;
  let count=0;
  for(const input of table.tBodies[0].querySelectorAll('input[data-tr-check]')){
    const on=Boolean(adapter.selected?.(shown[Number(input.dataset.trCheck)]));
    if(on)count++;
    if(input.checked!==on)input.checked=on;
    const row=input.closest('tr');
    if(row.classList.contains('selected')!==on)row.classList.toggle('selected',on);
  }
  for(let i=shown.length;i<rows.length;i++)if(adapter.selected?.(rows[i]))count++;
  const all=table.tHead.querySelector('[data-tr-check="all"]');
  const checked=rows.length>0&&count===rows.length,mixed=count>0&&count<rows.length;
  if(all.checked!==checked)all.checked=checked;
  if(all.indeterminate!==mixed)all.indeterminate=mixed;
}
function render(key){
  const adapter=adapters.get(key);if(!adapter)return;
  const el=host(key,adapter,true);if(!el)return;
  const wrap=sourceWrap(adapter);
  if(wrap&&!wrap.classList.contains('blTableReportMode'))wrap.classList.add('blTableReportMode');
  if(el.hidden)el.hidden=false;
  const moduleId=adapter.moduleId||key;
  let columns=[],rows=[];
  try{columns=adapter.columns()||[];rows=adapter.rows()||[];}catch(err){console.warn('[rapor görünümü] veri alınamadı',err);}
  const layout=root.BLDetailReportLayout,canonical=root.BLCanonicalFields;
  const projected=columns.some(col=>clean(col.group))?groupProjection(columns):
    layout?layout.project(columns,moduleId,canonical,labels()):columns.map(col=>({...col,fields:[col],reportRole:'field'}));
  const limit=limits.get(key)||CHUNK,shown=rows.slice(0,limit),rest=rows.length-shown.length;
  const id=preferenceKey(key,adapter),personal=readLayout(id),shared=sharedEntry(key,adapter),sharedId=shared?.id||'';
  const saved=effectiveLayout(personal,shared);
  if(drafts.get(key)?.id!==id)drafts.delete(key);
  const prefs=drafts.get(key)?.value||saved;
  projected.forEach(col=>{col.lines=orderedLines(col,prefs);});
  const editing=drafts.has(key),checkable=typeof adapter.selectRows==='function';
  const controls=editing?[['save',L('Kaydet','Save')],['cancel',L('Vazgeç','Cancel')],['reset',L('Varsayılana dön','Reset layout')]]:[['edit',L('Düzeni özelleştir','Customize layout')]];
  if(editing&&root.BLIsModerator?.())controls.push(['save-all',L('Herkes için kaydet','Save for everyone')]);
  assignHtml(el.querySelector('[data-tr-actions]'),controls.map(([action,label])=>'<button type="button" class="tbtn" data-tr-action="'+action+'"'+(action==='save-all'?' title="'+esc(L('Bu tablonun tüm rapor görünümlerini herkes için günceller','Updates every report view of this table for everyone'))+'"':'')+(drafts.get(key)?.saving?' disabled':'')+'>'+esc(label)+'</button>').join(''));

  const images=Boolean(root.BLDetailImages?.resolve)&&adapter.images?.()!==false;
  const imageIndex=images?root.BLDetailImages.buildIndex():null;
  const selectionColumns=images?[{key:'__report_picture',label:L('Görsel','Image'),fields:[{key:adapter.pictureKey||'__picture'}]},...projected]:projected;
  const imageDims=images?(adapter.imageDimensions?.()||{col:74,w:66,h:40,row:46}):null;
  const imageFitWidth=imageDims?(contexts.get(key)?.imageFitWidth||0):0;
  const context={id,saved,sharedId,projected,rows,shown,checkable,selectionColumns,imageDims,imageFitWidth};
  contexts.set(key,context);
  const span=projected.length+(images?1:0)+(checkable?1:0)||1;
  const table=el.querySelector('table');
  sizeColumns(table,wrap,context);
  assignHtml(table.querySelector('thead'),'<tr class="blDetailColumnRow">'+(checkable?'<th><input type="checkbox" data-tr-check="all" aria-label="'+esc(L('Sayfadaki satırları seç','Select rows on this page'))+'"></th>':'')+(images?'<th class="blDetailImageHead"><button type="button" class="tbtn" data-tr-image-size aria-haspopup="dialog" title="'+esc(L('Görsel boyutunu değiştir','Change image size'))+'">'+esc(L('Görsel','Image'))+'</button></th>':'')+projected.map(col=>{
    const filterable=typeof adapter.filter==='function';
    return '<th data-key="'+esc(col.key)+'"'+(col.reportRole==='number'?' class="blDetailNumeric"':'')+'><div class="blDetailReportHeading"><span>'+esc(col.label)+'</span>'+
      (filterable?'<details class="blDetailReportFilter"><summary aria-label="'+esc(L('Alanları filtrele','Filter fields')+': '+col.label)+'">▾</summary><div>'+
        col.fields.map(field=>'<button type="button" data-tr-filter="'+esc(field.key)+'">'+esc(field.label)+'</button>').join('')+'</div></details>':'')+'</div></th>';
  }).join('')+'</tr>');
  const body=shown.map((row,r)=>'<tr data-id="'+esc(adapter.rowId?.(row)??r)+'"'+(row._partialViewIndex!=null?' data-selection-partial-index="'+esc(row._partialViewIndex)+'"':'')+(adapter.dirty?.(row)?' class="rowDirty"':'')+'>'+
    (checkable?'<td><input type="checkbox" data-tr-check="'+r+'" aria-label="'+esc(L('Satırı seç','Select row'))+'"></td>':'')+
    (images?'<td class="blDetailImageCell" data-key="__report_picture" data-r="'+r+'" data-c="0">'+imageCell(row,moduleId,imageIndex)+'</td>':'')+projected.map((col,c)=>'<td data-key="'+esc(col.key)+'" data-r="'+r+'" data-c="'+(c+(images?1:0))+'"'+(col.reportRole==='number'?' class="blDetailNumeric"':'')+'>'+cellHtml(col,row,moduleId)+'</td>').join('')+'</tr>').join('');
  const editor=editing?'<tr class="blReportLayoutRow">'+(checkable?'<td></td>':'')+(images?'<td></td>':'')+projected.map(editorHtml).join('')+'</tr>':'';
  const bodyChanged=assignHtml(table.querySelector('tbody'),editor+(shown.length?body+(rest>0?'<tr><td class="blDetailMore" colspan="'+span+'"><button type="button" class="tbtn" data-tr-more>'+esc(L('Daha fazla göster','Show more'))+' · '+rest.toLocaleString(isEn()?'en-GB':'tr-TR')+' '+esc(L('satır kaldı','rows left'))+'</button></td></tr>':''):
    '<tr><td class="blDetailEmpty" colspan="'+span+'">'+esc(L('Gösterilecek satır yok.','No rows to display.'))+'</td></tr>'));
  if(bodyChanged)scheduleImageFit(key,table);
  let hint=el.querySelector('[data-tr-hint]');
  if(!hint){hint=doc.createElement('div');hint.dataset.trHint='';hint.className='blReportLayoutHint';el.querySelector('.blTableReportBar').after(hint);}
  if(hint.hidden===editing)hint.hidden=!editing;
  assignText(hint,drafts.get(key)?.error||L('Alanları hücre içinde sürükleyin. İlk satır ana bilgidir; düzen tüm kayıtlara uygulanır. Klavye: Alt + yukarı/aşağı ile sırala, Alt + sol/sağ ile satır değiştir.','Drag fields inside each cell. The first line is primary; the layout applies to every record. Keyboard: Alt + up/down to reorder, Alt + left/right to change lines.'));
  syncRowSelection(table,context,adapter);
  if(bodyChanged&&root.BLGridClipboard?.state('blTableReport-'+key))root.BLGridClipboard.afterRender('blTableReport-'+key);
  assignText(el.querySelector('[data-tr-title]'),L('Rapor görünümü','Report view'));
  const locale=isEn()?'en-GB':'tr-TR';let total=rows.length;try{total=Number(adapter.total?.())||rows.length;}catch(_){}
  assignText(el.querySelector('[data-tr-count]'),rows.length.toLocaleString(locale)+' / '+total.toLocaleString(locale)+' '+L('satır · geçerli filtre, sıralama ve sayfa','rows · current filters, sorting and page'));
  const exit=el.querySelector('[data-table-report-exit]'),disabled=Boolean(drafts.get(key)?.saving);
  if(exit.disabled!==disabled)exit.disabled=disabled;
  assignText(exit,L('Tablo görünümüne dön','Back to table view'));
}
function flush(){
  frame=0;
  for(const key of Array.from(dirty)){
    const adapter=adapters.get(key);
    if(!adapter||!isActive(key)){dirty.delete(key);continue;}
    if(!tabVisible(adapter))continue; // Görünmeyen sekme: sekme açılınca tablo yeniden çizilir ve buraya döner.
    dirty.delete(key);render(key);
  }
}
function schedule(key){
  if(!isActive(key))return;
  dirty.add(key);
  if(!frame)frame=root.requestAnimationFrame?root.requestAnimationFrame(flush):root.setTimeout(flush,0);
}
function setMode(key,on){
  const adapter=adapters.get(key);if(!adapter)return false;
  on=Boolean(on);modes.set(key,on);save(key,on);limits.delete(key);
  if(on){dirty.add(key);render(key);dirty.delete(key);if(!sharedLoaded)void refreshShared();}
  else{
    drafts.delete(key);root.BLGridClipboard?.clear('blTableReport-'+key);
    const el=host(key,adapter,false);if(el)el.hidden=true;
    sourceWrap(adapter)?.classList.remove('blTableReportMode');
  }
  try{adapter.changed?.(on);}catch(_){}
  return true;
}
function toggle(key){return setMode(key,!isActive(key));}
doc.addEventListener('pointerdown',event=>{
  const table=event.target.closest?.('.blTableReportTable');if(!table)return;
  const key=table.closest('[data-table-report-inline]')?.dataset.tableReportInline,context=contexts.get(key);
  if(context&&!drafts.has(key)&&!root.BLGridClipboard?.state(table.id))registerSelection(key,adapters.get(key));
},true);
doc.addEventListener('copy',event=>{if(event.defaultPrevented||event.target.closest?.('input,textarea,select,[contenteditable="true"]'))return;copySelection(doc.body?.dataset.activeTab,event,{includeHeaders:false});},true);
root.BLTableReportInline=Object.freeze({register,schedule,setMode,toggle,isActive,copySelection,refreshShared,updateImageDimensions});
})(typeof window!=='undefined'?window:globalThis);
