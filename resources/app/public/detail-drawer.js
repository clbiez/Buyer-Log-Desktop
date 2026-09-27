/* Buyer Log — ortak sağ detay çekmecesi.
 * Detay tabloları tek davranışta toplar: görsel, sütun seçimi, PLM görsel senkronu
 * ve görünen sütunları Excel'e aktarma. İş kuralları bu katmanda tutulmaz.
 */
(function(root,factory){
  const api=factory(root);
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root&&root.document)root.BLDetailDrawer=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(root){
'use strict';

const PREF_PREFIX='buyerlog.detailDrawer.columns.';
const WIDTH_PREFIX='buyerlog.detailDrawer.width.';
const clean=value=>String(value==null?'':value).replace(/\s+/g,' ').trim();
const safeFilePart=value=>clean(value).replace(/[\\/:*?"<>|]+/g,' ').replace(/\s+/g,' ').trim().slice(0,90)||'BuyerLog_Detail';
const escapeHtml=value=>clean(value).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
function inferColumns(rows){
  const seen=new Set(),out=[];
  (rows||[]).slice(0,40).forEach(row=>Object.keys(row||{}).forEach(key=>{
    if(!key||key.startsWith('_')||seen.has(key))return;
    seen.add(key);out.push({key,label:key});
  }));
  return out;
}
function normalizeColumns(columns,rows){
  const source=Array.isArray(columns)&&columns.length?columns:inferColumns(rows);
  const seen=new Set();
  return source.map((col,index)=>{
    if(typeof col==='string')col={key:col,label:col};
    const key=clean(col&&col.key)||('column_'+index);
    if(seen.has(key))return null;seen.add(key);
    return {...col,key,label:clean(col&&col.label)||key};
  }).filter(Boolean);
}
if(!root||!root.document)return {inferColumns,normalizeColumns,safeFilePart};

const document=root.document;
const isEn=()=>String(document.documentElement.lang||'tr').toLowerCase().startsWith('en');
const L=(tr,en)=>isEn()?en:tr;
const store=()=>root.BLStorage||root.localStorage;
let active=null;

function storagePart(value){return clean(value||'generic').replace(/[^a-z0-9_.-]+/gi,'_');}
function pageScope(input){
  const explicit=clean(input&&input.pageScope);
  if(explicit)return explicit;
  return clean(document.body&&document.body.dataset&&document.body.dataset.activeTab)||'global';
}
function prefKey(scope,page){return PREF_PREFIX+storagePart(page)+'.'+storagePart(scope);}
function loadVisible(scope,page,columns){
  try{
    const raw=JSON.parse(store().getItem(prefKey(scope,page))||'null');
    const allowed=new Set(columns.map(c=>c.key));
    const selected=Array.isArray(raw)?raw.filter(key=>allowed.has(key)):[];
    if(selected.length)return selected;
  }catch(_){}
  return columns.map(c=>c.key);
}
function saveVisible(scope,page,keys){try{store().setItem(prefKey(scope,page),JSON.stringify(keys));}catch(_){}}
function widthKey(page){return WIDTH_PREFIX+storagePart(page);}
function loadWidth(page){
  try{
    const value=Number(store().getItem(widthKey(page)));
    return Number.isFinite(value)&&value>=420?value:null;
  }catch(_){return null;}
}
function saveWidth(page,width){try{store().setItem(widthKey(page),String(Math.round(width)));}catch(_){}}
function ensureHost(){
  let host=document.getElementById('blSharedDetailDrawer');
  if(host)return host;
  host=document.createElement('aside');
  host.id='blSharedDetailDrawer';
  host.className='blDetailDrawer';
  host.setAttribute('aria-hidden','true');
  document.body.appendChild(host);
  return host;
}
function hasValue(value){return value!==undefined&&value!==null&&!(typeof value==='string'&&clean(value)==='');}
function rowSources(row){
  const sources=[row,row&&row.row,row&&row.raw,row&&row.source,row&&row.data].filter(item=>item&&typeof item==='object');
  return [...new Set(sources)];
}
function fieldRefs(col){
  const refs=[col&&col.key,col&&col.label].filter(Boolean),extra=[];
  refs.forEach(ref=>{
    const text=String(ref);
    let match;
    const rx=/\(([^)]+)\)/g;
    while((match=rx.exec(text)))if(clean(match[1]))extra.push(clean(match[1]));
    const without=clean(text.replace(/\([^)]+\)/g,' '));
    if(without)extra.push(without);
  });
  return [...new Set(refs.concat(extra).map(clean).filter(Boolean))];
}
function detailModule(){
  const known=['overview','cp','orders','backlog','collection','lfl','logistics','antrepo','openCosting'];
  const aliases={koleksiyon:'collection',collection:'collection',priceanalysis:'',shipping:'logistics'};
  const candidates=[active&&active.moduleId,active&&active.pageScope,active&&active.scope,active&&active.source].map(clean).filter(Boolean);
  for(const raw of candidates){
    const lower=raw.toLowerCase();
    if(Object.prototype.hasOwnProperty.call(aliases,lower)&&aliases[lower])return aliases[lower];
    for(const id of known){
      const canonical=String(id).toLowerCase();
      if(lower===canonical||lower.startsWith(canonical+'.')||lower.includes('.'+canonical+'.'))return id;
    }
  }
  return '';
}
function lookupValue(col,row){
  const refs=fieldRefs(col),sources=rowSources(row);
  for(const source of sources){
    for(const ref of refs){
      if(Object.prototype.hasOwnProperty.call(source,ref)&&hasValue(source[ref]))return source[ref];
    }
  }
  const canonical=root.BLCanonicalFields,moduleId=detailModule();
  if(canonical&&moduleId){
    for(const ref of refs){
      const id=canonical.canonicalId?.(moduleId,ref);
      if(!id)continue;
      for(const source of sources){
        const value=canonical.canonicalValue?.(source,moduleId,id);
        if(hasValue(value))return value;
      }
    }
  }
  const token=canonical&&canonical.token?canonical.token:(value=>String(value==null?'':value).toUpperCase().replace(/[^A-Z0-9]+/g,' ').trim());
  const wanted=[...new Set(refs.map(token).filter(Boolean))];
  for(const source of sources){
    const keys=Object.keys(source);
    for(const key of keys){
      if(wanted.includes(token(key))&&hasValue(source[key]))return source[key];
    }
  }
  return undefined;
}
function valueOf(col,row){
  try{
    let value;
    if(typeof col.value==='function'){
      value=col.value(row);
      if(!hasValue(value))value=lookupValue(col,row);
    }else value=lookupValue(col,row);
    if(typeof col.format==='function')return col.format(value,row);
    if(!hasValue(value))return '';
    if(value instanceof Date&&!Number.isNaN(value.getTime()))return value.toISOString().slice(0,10);
    if(typeof value==='object')return JSON.stringify(value);
    return value;
  }catch(_){return '';}
}
function textValue(col,row){const value=valueOf(col,row);return value==null?'':String(value);}
function modelIdentity(row){
  const nested=row&&typeof row==='object'?(row.row||row.raw||null):null;
  const get=(...keys)=>{
    for(const source of [row,nested]){
      if(!source)continue;
      for(const key of keys){const v=source[key];if(v!=null&&clean(v))return clean(v);}
    }
    return '';
  };
  return {
    plmId:get('plmId','PLM ID','PLM Id','PLMID'),
    modelName:get('model','modelName','modelKod','Model Adı','Model Name','Style Name','Style'),
    colourCode:get('colourCode','colorCode','C.Code','Renk Kod','Renk Kodu','Colour Code','Color Code'),
    colour:get('colour','color','Colour','Color','Renk','Renk Tanım'),
    orderCode:get('orderCode','orderKey','Sipariş Kod','Sipariş Kodu','Order Code','Order No')
  };
}
function imageUrl(row,index){
  const helper=root.BLDetailImages,id=modelIdentity(row);
  if(!helper)return '';
  return helper.urlFrom?.(index,{plmId:id.plmId,colourCode:id.colourCode,colour:id.colour,modelName:id.modelName})||
    helper.sourceFor?.({plmId:id.plmId,colourCode:id.colourCode,colour:id.colour,modelName:id.modelName})||'';
}
function imageCell(row,index){
  const helper=root.BLDetailImages,id=modelIdentity(row);
  if(!helper||!helper.thumbHtml)return '<span class="blDetailNoImage">—</span>';
  const url=imageUrl(row,index);
  return helper.thumbHtml(url,{modelId:id.plmId||id.modelName,plmId:id.plmId,modelName:id.modelName,colourCode:id.colourCode,colour:id.colour},{
    title:L('Büyük önizleme için üzerine gelin','Hover for large preview'),allowEmpty:true
  });
}
function filteredRows(){
  if(!active)return[];
  const q=clean(active.search).toLocaleLowerCase(isEn()?'en-GB':'tr-TR');
  if(!q)return active.rows;
  return active.rows.filter(row=>active.columns.some(col=>textValue(col,row).toLocaleLowerCase(isEn()?'en-GB':'tr-TR').includes(q)));
}
function currentColumns(){if(!active)return[];const set=new Set(active.visible);return active.columns.filter(col=>set.has(col.key));}
function registerAssetScope(panel,rows){
  const helper=root.BLDetailImages;if(!helper?.registerScope)return;
  try{
    const index=helper.buildIndex?.();
    helper.registerScope(panel,{
      contextType:'shared-detail-drawer',label:active.title,
      identities:rows.map((row,i)=>{
        const id=modelIdentity(row);
        return {...id,rowId:String(i),hasImage:index?Boolean(imageUrl(row,index)):null};
      }),
      repaint:render
    });
  }catch(err){console.warn('Detay çekmecesi model varlık kapsamı kaydedilemedi:',err);}
}
function renderColumnsPanel(){
  const host=document.querySelector('#blSharedDetailDrawer [data-bl-detail-column-panel]');
  if(!host||!active)return;
  const selected=new Set(active.visible);
  host.innerHTML='<div class="blDetailColumnPanelHead"><b>'+escapeHtml(L('Görünen sütunlar','Visible columns'))+'</b><button type="button" data-bl-detail-column-all>'+escapeHtml(L('Tümü','All'))+'</button></div>'+
    '<div class="blDetailColumnList">'+active.columns.map(col=>'<label><input type="checkbox" value="'+escapeHtml(col.key)+'"'+(selected.has(col.key)?' checked':'')+'><span>'+escapeHtml(col.label)+'</span></label>').join('')+'</div>';
  host.querySelectorAll('input[type="checkbox"]').forEach(input=>input.addEventListener('change',()=>{
    const keys=[...host.querySelectorAll('input[type="checkbox"]:checked')].map(x=>x.value);
    if(!keys.length){input.checked=true;return;}
    active.visible=keys;saveVisible(active.scope,active.pageScope,keys);renderTable();
  }));
  host.querySelector('[data-bl-detail-column-all]')?.addEventListener('click',()=>{
    active.visible=active.columns.map(c=>c.key);saveVisible(active.scope,active.pageScope,active.visible);renderTable();renderColumnsPanel();
  });
}
function renderTable(){
  const host=document.getElementById('blSharedDetailDrawer');if(!host||!active)return;
  const table=host.querySelector('[data-bl-detail-table]'),summary=host.querySelector('[data-bl-detail-summary]');
  if(!table)return;
  const rows=filteredRows(),columns=currentColumns(),helper=root.BLDetailImages;
  const showImages=active.images&&Boolean(helper),imageIndex=showImages&&helper?.buildIndex?helper.buildIndex():null;
  table.querySelector('thead').innerHTML='<tr>'+(showImages?'<th class="blDetailImageHead">'+escapeHtml(L('Görsel','Image'))+'</th>':'')+columns.map(col=>'<th>'+escapeHtml(col.label)+'</th>').join('')+'</tr>';
  table.querySelector('tbody').innerHTML=rows.length?rows.map(row=>'<tr>'+(showImages?'<td class="blDetailImageCell">'+imageCell(row,imageIndex)+'</td>':'')+columns.map(col=>{
    if(typeof col.html==='function'){let html='';try{html=col.html(row)||'';}catch(_){}return '<td>'+html+'</td>';}
    const value=textValue(col,row);return '<td title="'+escapeHtml(value)+'">'+escapeHtml(value||'—')+'</td>';
  }).join('')+'</tr>').join(''):'<tr><td class="blDetailEmpty" colspan="'+Math.max(1,columns.length+(showImages?1:0))+'">'+escapeHtml(L('Gösterilecek satır yok.','No rows to display.'))+'</td></tr>';
  if(summary)summary.textContent=(active.subtitle?active.subtitle+' · ':'')+rows.length.toLocaleString(isEn()?'en-GB':'tr-TR')+' '+L('satır','rows');
  registerAssetScope(host.querySelector('.blDetailDrawerPanel'),rows);
}
function downloadBuffer(buffer,name,mime){
  const helper=root.BLDetailImages;
  if(helper?.downloadBuffer){helper.downloadBuffer(buffer,name,mime);return;}
  const blob=new Blob([buffer],{type:mime}),url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
}
async function exportExcelJsWithImages(columns,rows,fileName){
  const helper=root.BLDetailImages;
  if(!active.images||!helper?.prepareForExcel||!helper?.addToExcel)return false;
  if(root.BLPerf?.ensureLibrary)await root.BLPerf.ensureLibrary('exceljs');
  if(!root.ExcelJS)return false;
  const wb=new root.ExcelJS.Workbook(),ws=wb.addWorksheet(L('Detay','Detail')),imageIndex=helper.buildIndex?.();
  ws.columns=[{header:L('Görsel','Image'),key:'__image',width:12},...columns.map((col,index)=>({header:col.label,key:'c'+index,width:Math.max(11,Math.min(40,Number(col.exportWidth)||18))}))];
  const head=ws.getRow(1);head.height=22;head.font={bold:true};head.alignment={vertical:'middle',wrapText:true};
  rows.forEach(row=>{const excelRow=ws.addRow(['',...columns.map(col=>valueOf(col,row))]);excelRow.height=48;});
  for(let start=0;start<rows.length;start+=8){
    const slice=rows.slice(start,start+8);
    const prepared=await Promise.all(slice.map(async row=>{const url=imageUrl(row,imageIndex);if(!url)return null;try{return await helper.prepareForExcel(url);}catch(_){return null;}}));
    prepared.forEach((image,offset)=>{if(image)helper.addToExcel(ws,wb,image,start+offset+2,1,null,{moveAndSizeWithCells:true});});
  }
  ws.views=[{state:'frozen',ySplit:1}];
  if(rows.length)ws.autoFilter={from:{row:1,column:1},to:{row:rows.length+1,column:Math.max(1,columns.length+1)}};
  const buffer=await wb.xlsx.writeBuffer();
  downloadBuffer(buffer,fileName,'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  return true;
}
function applyPanelWidth(panel){
  if(!panel||!active||root.innerWidth<=760)return;
  const max=Math.max(420,root.innerWidth-24),width=Math.min(max,Math.max(420,Number(active.width)||panel.getBoundingClientRect().width||980));
  panel.style.width=Math.round(width)+'px';
}
function bindResize(panel){
  const handle=panel&&panel.querySelector('[data-bl-detail-resize]');
  if(!handle||root.innerWidth<=760)return;
  handle.addEventListener('pointerdown',event=>{
    event.preventDefault();
    const startX=event.clientX,startWidth=panel.getBoundingClientRect().width;
    const move=ev=>{
      const max=Math.max(420,root.innerWidth-24);
      const next=Math.min(max,Math.max(420,startWidth+(startX-ev.clientX)));
      active.width=next;panel.style.width=Math.round(next)+'px';
    };
    const end=()=>{
      root.removeEventListener('pointermove',move);root.removeEventListener('pointerup',end);
      if(active&&active.width)saveWidth(active.pageScope,active.width);
      document.body.classList.remove('blDetailResizing');
    };
    document.body.classList.add('blDetailResizing');
    root.addEventListener('pointermove',move);root.addEventListener('pointerup',end,{once:true});
  });
}
function toggleExportMenu(){
  const menu=document.querySelector('#blSharedDetailDrawer [data-bl-detail-export-menu]');
  if(menu)menu.hidden=!menu.hidden;
}
async function exportExcel(mode='visible'){
  if(!active)return;
  const button=document.querySelector('#blSharedDetailDrawer [data-bl-detail-excel]'),old=button&&button.textContent;
  if(button){button.disabled=true;button.textContent=L('Hazırlanıyor…','Preparing…');}
  try{
    const columns=mode==='all'?active.columns:currentColumns(),rows=filteredRows(),fileName=safeFilePart(active.fileName||active.title)+'.xlsx';
    if(typeof active.exporter==='function'){
      await active.exporter({rows,columns,includeImages:active.images,fileName,title:active.title,source:active.source,valueOf});
    }else if(!(await exportExcelJsWithImages(columns,rows,fileName))){
      if(!root.XLSX&&root.BLPerf?.ensureLibrary)await root.BLPerf.ensureLibrary('xlsx');
      if(!root.XLSX)throw new Error(L('Excel kütüphanesi yüklenemedi.','Excel library could not be loaded.'));
      const data=[columns.map(c=>c.label),...rows.map(row=>columns.map(col=>valueOf(col,row)))];
      const ws=root.XLSX.utils.aoa_to_sheet(data,{cellDates:true});
      if(data.length&&columns.length)ws['!autofilter']={ref:root.XLSX.utils.encode_range({r:0,c:0},{r:Math.max(0,data.length-1),c:columns.length-1})};
      ws['!cols']=columns.map(col=>({wch:Math.max(11,Math.min(40,Number(col.exportWidth)||18))}));
      const wb=root.XLSX.utils.book_new();root.XLSX.utils.book_append_sheet(wb,ws,L('Detay','Detail'));
      root.XLSX.writeFile(wb,fileName);
    }
    root.showToast?.(mode==='all'?L('Detay satırları tüm sütunlarla Excel’e aktarıldı.','Detail rows were exported to Excel with all columns.'):L('Görünen detay satırları ve seçili sütunlar Excel’e aktarıldı.','Visible detail rows and selected columns were exported to Excel.'));
  }catch(err){root.showToast?.(err&&err.message?err.message:String(err));}
  finally{if(button){button.disabled=false;button.textContent=old||'⇩ Excel';}}
}
function render(){
  const host=ensureHost();if(!active){host.classList.remove('is-open');host.setAttribute('aria-hidden','true');return;}
  host.innerHTML='<div class="blDetailDrawerBackdrop" data-bl-detail-close></div><section class="blDetailDrawerPanel" role="dialog" aria-modal="true" aria-labelledby="blDetailDrawerTitle">'+
    '<div class="blDetailResizeHandle" data-bl-detail-resize title="'+escapeHtml(L('Genişliği değiştirmek için sürükleyin','Drag to resize'))+'"></div>'+
    '<header class="blDetailDrawerHead"><div class="blDetailDrawerTitle"><b id="blDetailDrawerTitle">'+escapeHtml(active.title)+'</b><span data-bl-detail-summary></span></div>'+
    '<div class="blDetailDrawerActions"><button type="button" class="blDetailTool" data-bl-detail-images aria-pressed="'+(active.images?'true':'false')+'">▧ '+escapeHtml(L('Görseller','Images'))+'</button>'+
    '<span data-bl-detail-plm></span><button type="button" class="blDetailTool" data-bl-detail-columns>☷ '+escapeHtml(L('Sütunlar','Columns'))+'</button>'+
    '<button type="button" class="blDetailTool" data-bl-detail-excel>⇩ Excel</button>'+
    '<div class="blDetailExportMenu" data-bl-detail-export-menu hidden><button type="button" data-bl-export-mode="all">'+escapeHtml(L('Tüm Sütunlarla','All Columns'))+'</button><button type="button" data-bl-export-mode="visible">'+escapeHtml(L('Görünen Sütunlarla','Visible Columns'))+'</button></div>'+
    '<button type="button" class="blDetailClose" data-bl-detail-close aria-label="'+escapeHtml(L('Kapat','Close'))+'">×</button></div></header>'+
    '<div class="blDetailDrawerSubbar"><input type="search" data-bl-detail-search value="'+escapeHtml(active.search)+'" placeholder="'+escapeHtml(L('Detaylarda ara…','Search details…'))+'">'+
    '<div class="blDetailExtraActions" data-bl-detail-extra></div><div class="blDetailColumnPanel" data-bl-detail-column-panel hidden></div></div>'+
    (active.note?'<div class="blDetailDrawerNote">'+escapeHtml(active.note)+'</div>':'')+
    '<div class="blDetailTableWrap"><table class="blDetailTable" data-bl-detail-table><thead></thead><tbody></tbody></table></div></section>';
  host.classList.add('is-open');host.setAttribute('aria-hidden','false');
  const panel=host.querySelector('.blDetailDrawerPanel');applyPanelWidth(panel);bindResize(panel);
  host.querySelectorAll('[data-bl-detail-close]').forEach(el=>el.addEventListener('click',close));
  host.querySelector('[data-bl-detail-search]')?.addEventListener('input',event=>{active.search=event.target.value;renderTable();});
  host.querySelector('[data-bl-detail-images]')?.addEventListener('click',()=>{active.images=!active.images;render();});
  host.querySelector('[data-bl-detail-columns]')?.addEventListener('click',()=>{
    const panel=host.querySelector('[data-bl-detail-column-panel]');panel.hidden=!panel.hidden;if(!panel.hidden)renderColumnsPanel();
  });
  host.querySelector('[data-bl-detail-excel]')?.addEventListener('click',toggleExportMenu);
  host.querySelectorAll('[data-bl-export-mode]').forEach(button=>button.addEventListener('click',()=>{
    const menu=host.querySelector('[data-bl-detail-export-menu]');if(menu)menu.hidden=true;
    void exportExcel(button.dataset.blExportMode==='all'?'all':'visible');
  }));
  const extra=host.querySelector('[data-bl-detail-extra]');
  (active.actions||[]).forEach(action=>{
    const button=document.createElement('button');button.type='button';button.className='blDetailTool';button.textContent=action.label||L('Aç','Open');
    button.addEventListener('click',()=>{try{action.run?.(filteredRows(),active);}catch(err){console.warn(err);}});extra.appendChild(button);
  });
  const plm=host.querySelector('[data-bl-detail-plm]');
  if(root.BLDetailImages?.modelImagesButtonHtml&&root.BLDetailImages?.bindModelImagesButton){
    const id='blSharedDetailModelImages';plm.innerHTML=root.BLDetailImages.modelImagesButtonHtml(id);root.BLDetailImages.bindModelImagesButton(id);
  }else if(plm)plm.hidden=true;
  renderTable();
}
function open(options){
  const input=options&&typeof options==='object'?options:{};
  const rows=Array.isArray(input.rows)?input.rows.filter(Boolean):[];
  const columns=normalizeColumns(input.columns,rows);
  const scope=input.storageKey||input.scope||input.source||'generic',page=pageScope(input);
  active={
    scope,pageScope:page,moduleId:input.moduleId||page,source:input.source||'shared-detail-drawer',
    title:clean(input.title)||L('Sipariş Detayları','Order Details'),
    subtitle:clean(input.subtitle),note:clean(input.note),fileName:input.fileName||input.title,
    rows,columns,visible:loadVisible(scope,page,columns),width:loadWidth(page),
    images:input.images!==false,search:'',actions:Array.isArray(input.actions)?input.actions:[],
    exporter:typeof input.exporter==='function'?input.exporter:null
  };
  render();
  requestAnimationFrame(()=>ensureHost().querySelector('[data-bl-detail-search]')?.focus());
}
function close(){active=null;const host=document.getElementById('blSharedDetailDrawer');if(host){host.classList.remove('is-open');host.setAttribute('aria-hidden','true');}}
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&active)close();});
return {open,close,inferColumns,normalizeColumns,safeFilePart,isOpen:()=>Boolean(active)};
});