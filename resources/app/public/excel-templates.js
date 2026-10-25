(function(root){
  'use strict';
  const KEY='bl.excelTemplates.',MIME='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const T=(tr,en)=>typeof appLang!=='undefined'&&appLang==='en'?en:tr;
  const esc=s=>root.BLExcelTemplateEngine.escapeXml(s);
  const error=code=>new Error(code==='INVALID_ORDER_QUANTITY'
    ?T('Sipariş adedi pozitif bir tam sayı olmalıdır.','Order quantity must be a positive integer.')
    :code==='INVALID_HOLOGRAM_RULE'
    ?T('Hologram çarpanı 0–100 arasında (0 hariç), yuvarlama adımı 1–1.000.000 arasında tam sayı olmalıdır.','The hologram multiplier must be above 0 and at most 100; rounding must be an integer from 1 to 1,000,000.')
    :T('Excel şablonu işlenemedi. Dosyayı, sayfayı ve alan eşleştirmelerini kontrol edin.','The Excel template could not be processed. Check the file, sheet and field mappings.'));
  const failureMessage=err=>/^[A-Z_]+$/.test(String(err&&err.message||''))?error(err.message).message:(err&&err.message||error().message);
  const key=type=>KEY+type+'.v1';
  async function json(url,options){const response=await fetch(url,options);if(!response.ok)throw new Error(T('Excel ayarlarına erişilemedi.','Excel settings could not be accessed.'));return response.json();}
  async function saved(type){const data=await json('/api/user-preferences',{cache:'no-store'});const value=data.entries&&data.entries[key(type)];return value?JSON.parse(value.value):null;}
  async function libraries(){await Promise.all([root.BLPerf.ensureLibrary('exceljs'),root.BLPerf.ensureLibrary('jszip')]);}
  function decode(base64){return Uint8Array.from(atob(base64),c=>c.charCodeAt(0));}
  function encode(bytes){let out='';for(let i=0;i<bytes.length;i+=16384)out+=String.fromCharCode(...bytes.subarray(i,i+16384));return btoa(out);}
  async function defaultBytes(type){
    if(type==='hologram'){
      const response=await fetch('excel-templates/hologram-request.xlsx');if(!response.ok)throw error();return new Uint8Array(await response.arrayBuffer());
    }
    const sample=Object.fromEntries(root.BLCapacityRequest.ORDER.map(id=>[id,root.BLCapacityRequest.DATE_KEYS.includes(id)?new Date():root.BLCapacityRequest.NUMBER_KEYS.includes(id)?0:'']));
    const wb=type==='capacity'?root.BLCapacityRequest.buildWorkbook({rows:[sample]},root.ExcelJS):root.BLFixedExcelDefaults.mb();
    wb.worksheets[0].getRow(2).eachCell({includeEmpty:true},cell=>{cell.value=null;});
    return new Uint8Array(await wb.xlsx.writeBuffer());
  }
  async function configuration(type){const item=await saved(type);if(item)return {config:item.config,bytes:decode(item.bytes),name:item.name};
    return {bytes:await defaultBytes(type),config:type==='hologram'?root.BLHologramRequest.template():null,name:type+'.xlsx'};
  }
  function catalog(type){
    const fields=root.BLCanonicalFields,ids=new Map();
    ['cp','collection'].forEach(module=>fields.moduleFields(module).forEach(id=>ids.set(id,{id,label:fields.label(id,typeof appLang!=='undefined'?appLang:'tr')})));
    ids.set('today',{id:'today',label:T('Oluşturma tarihi','Creation date')});
    if(type==='hologram')ids.set('hologramQuantity',{id:'hologramQuantity',label:T('Hologram adedi (çarpan + yukarı yuvarlama)','Hologram quantity (multiplier + round up)')});
    if(type==='capacity')root.BLCapacityRequest.ORDER.forEach((id,i)=>ids.set('capacity:'+id,{id:'capacity:'+id,label:root.BLCapacityRequest.HEADERS[i]}));
    if(type==='mb')root.BLFixedExcelDefaults.mbHeaders.forEach((label,i)=>ids.set('mb:'+i,{id:'mb:'+i,label}));
    return [...ids.values()];
  }
  function records(rows,module,extras){return rows.map((row,index)=>{
    const out={today:root.BLCapacityRequest.startOfDay()};
    root.BLCanonicalFields.moduleFields(module).forEach(id=>{
      const value=root.BLCanonicalFields.value(row,module,id),definition=root.BLCanonicalFields.field(id);
      out[id]=definition.type==='date'?root.BLCapacityRequest.toDate(value)||'':definition.type==='number'?root.BLCapacityRequest.toNumber(value):value;
    });return Object.assign(out,extras&&extras[index]);
  });}
  // Saved Capacity templates may rearrange columns. Resolve all formula
  // references from their actual mapped positions, not the default A:T layout.
  function capacityFormulaRecords(data,config){
    const mapped=new Map(config.columns.filter(c=>c.field).map(c=>[c.field,c.column]));
    const column=(field,rowNo)=>mapped.has('capacity:'+field)?root.BLExcelTemplateEngine.columnName(mapped.get('capacity:'+field))+rowNo:null;
    const raw=(record,field)=>record['capacity:'+field]!==undefined?record['capacity:'+field]:record[field];
    return data.map((record,i)=>{
      const rowNo=config.dataRow+i,copy={...record};
      const units=column('units',rowNo),po=column('poIssuingDate',rowNo),ex=column('exFactoryDate',rowNo),retail=column('retailStockDate',rowNo);
      const add=(field,formula)=>{if(mapped.has('capacity:'+field)&&formula)copy['capacity:'+field]={__blFormula:formula,result:raw(record,field)};};
      const quantity=Number(raw(record,'units')),garments=Number(raw(record,'garmentQty'));
      const multiplier=Number(record.garmentMultiplier||record['capacity:garmentMultiplier'])||
        (Number.isFinite(quantity)&&quantity!==0&&Number.isFinite(garments)?garments/quantity:1);
      if(units&&[1,2].includes(multiplier))add('garmentQty','IF('+units+'="","",'+units+'*'+multiplier+')');
      if(po&&ex)add('poIssueToExFactory','IF(OR('+po+'="",'+ex+'=""),"",'+ex+'-'+po+')');
      if(ex&&retail)add('exFactoryToRetail','IF(OR('+ex+'="",'+retail+'=""),"",'+retail+'-'+ex+')');
      return copy;
    });
  }
  async function build(type,data,fallback){
    const item=await saved(type);
    if(!item&&type!=='hologram')return fallback;
    await libraries();const config=item?item.config:root.BLHologramRequest.template(),bytes=item?decode(item.bytes):await defaultBytes(type);
    // Recalculate using the saved per-template rule; do not reuse the default
    // quantity produced before the user's template preferences were loaded.
    const recordsForExport=type==='hologram'?data.map(record=>({...record,hologramQuantity:root.BLHologramRequest.quantity(record.orderQuantity,config.quantityRule)}))
      :type==='capacity'?capacityFormulaRecords(data,config):data;
    try{return await root.BLExcelTemplateEngine.fill(bytes,config,recordsForExport,root.JSZip,root.BLExcelDates);}catch(_){throw error();}
  }
  async function open(){
    await libraries();document.getElementById('excelTemplateManager')?.blClose?.();
    const modal=document.createElement('div');modal.id='excelTemplateManager';modal.className='warnOverlay';
    modal.innerHTML=`<div class="modalCard excelTemplateCard" role="dialog" aria-modal="true" aria-labelledby="excelTemplateTitle"><div class="modalTitle"><span id="excelTemplateTitle">${T('Excel Şablonlarını Yönet','Manage Excel Templates')}</span><button type="button" data-close aria-label="${T('Kapat','Close')}">×</button></div>
    <p>${T('Bu ayarlar hesabınıza kaydedilir. Yeni formatı indirin veya yükleyin; başlıkları otomatik eşleştirin, yeni sütunların alanını seçip kaydedin. Sonraki çıktılar yeni formatı kullanır.','These settings are saved to your account. Download or upload a format, match headers automatically, choose fields for new columns and save. Future exports use the new format.')}</p>
    <p>${T('Şablon: başlıklar + ilk veri satırında örnek biçim. İlk veri satırından sonraki tüm örnek veriler temizlenir; bu alana dipnot koymayın. Diğer sayfalar korunur.','Template: headers + sample formatting in the first data row. All sample data from the first data row onward is cleared; keep footnotes outside this area. Other sheets are preserved.')}</p>
    <div class="excelTemplateControls"><label>${T('Format','Format')}<select data-type><option value="hologram">Hologram Request Excel</option><option value="capacity">Capacity Request Excel</option><option value="mb">MB List Excel</option></select></label>
    <button class="tbtn" data-download>${T('Mevcut şablonu indir','Download current template')}</button><label class="tbtn">${T('Yeni Excel yükle','Upload new Excel')}<input data-upload type="file" accept=".xlsx" hidden></label></div>
    <div class="excelTemplateControls"><label>${T('Sayfa','Sheet')}<select data-sheet></select></label><label>${T('Başlık satırı','Header row')}<input data-header type="number" min="1" max="9999"></label><label>${T('İlk veri satırı','First data row')}<input data-start type="number" min="2" max="10000"></label><button class="tbtn" data-match>${T('Alanları eşleştir','Match fields')}</button></div>
    <div class="excelTemplateQuantity" data-hologram-rule hidden><strong>${T('Hologram adet hesabı','Hologram quantity calculation')}</strong>
    <div class="excelTemplateControls"><label>${T('Sipariş adedi çarpanı','Order quantity multiplier')}<input data-multiplier type="number" min="0.000001" max="100" step="0.01" value="1.03"></label>
    <label>${T('Yukarı yuvarlama katı (adet)','Round up to a multiple of')}<input data-round-to type="number" min="1" max="1000000" step="1" value="50"></label></div>
    <p data-quantity-preview></p></div>
    <p data-file></p><div class="excelTemplateMapping" data-mapping></div><p role="status" data-status></p><div class="modalFoot"><button class="tbtn" data-reset>${T('Varsayılana dön','Restore default')}</button><button class="tbtn primary" data-save>${T('Formatı kaydet','Save format')}</button><button class="tbtn" data-close>${T('Kapat','Close')}</button></div></div>`;
    document.body.appendChild(modal);const $=s=>modal.querySelector(s),type=()=> $('[data-type]').value;
    let bytes,wb,previous,columns=[],loading=false;
    const reader=new AbortController();
    const close=()=>{reader.abort();modal.remove();};modal.blClose=close;
    const status=message=>{$('[data-status]').textContent=message;};
    const busy=on=>{loading=on;['[data-save]','[data-reset]','[data-type]','[data-download]','[data-match]','[data-multiplier]','[data-round-to]'].forEach(s=>$(s).disabled=on);};
    const quantityRule=()=>root.BLHologramRequest.normalizeQuantityRule({
      multiplier:$('[data-multiplier]').value,roundTo:$('[data-round-to]').value
    });
    function previewQuantityRule(){
      try{
        const rule=quantityRule(),example=root.BLHologramRequest.quantity(1000,rule);
        $('[data-quantity-preview]').textContent=T(
          'Örnek: 1.000 × '+String(rule.multiplier).replace('.',',')+' → '+example+' adet ('+rule.roundTo+' katına yukarı yuvarlandı).',
          'Example: 1,000 × '+rule.multiplier+' → '+example+' units (rounded up to a multiple of '+rule.roundTo+').'
        );
      }catch(_){$('[data-quantity-preview]').textContent=error('INVALID_HOLOGRAM_RULE').message;}
    }
    ['[data-multiplier]','[data-round-to]'].forEach(s=>$(s).addEventListener('input',previewQuantityRule));
    const token=s=>root.BLCanonicalFields.token(s);
    function match(){
      const sheet=wb.getWorksheet($('[data-sheet]').value),header=Number($('[data-header]').value),start=Number($('[data-start]').value),available=catalog(type());
      if(!sheet||!Number.isInteger(header)||header<1||!Number.isInteger(start)||start<=header)throw error();
      const defaults=type()==='hologram'?root.BLHologramRequest.HEADERS:type()==='capacity'?root.BLCapacityRequest.HEADERS:root.BLFixedExcelDefaults.mbHeaders;
      const ids=type()==='hologram'?root.BLHologramRequest.ORDER:type()==='capacity'?root.BLCapacityRequest.ORDER.map(id=>'capacity:'+id):defaults.map((_,i)=>'mb:'+i);
      columns=[];sheet.getRow(header).eachCell((cell,column)=>{
        const title=cell.text;if(!title.trim())return;const old=previous&&previous.columns.find(c=>token(c.header)===token(title));
        const index=defaults.findIndex(h=>token(h)===token(title));
        const canonical=available.find(item=>token(item.label)===token(title)||token(item.id)===token(title));
        columns.push({column,header:title,field:old?old.field:index>=0?ids[index]:canonical?canonical.id:''});
      });
      if(!columns.length||columns.length>200)throw error();
      $('[data-mapping]').innerHTML='<table><thead><tr><th>'+T('Excel sütunu','Excel column')+'</th><th>'+T('Buyer Log alanı','Buyer Log field')+'</th></tr></thead><tbody>'+columns.map((c,i)=>'<tr><td>'+esc(root.BLExcelTemplateEngine.columnName(c.column)+' · '+c.header)+'</td><td><select data-field="'+i+'"><option value="">'+T('Boş bırak','Leave blank')+'</option>'+available.map(f=>'<option value="'+esc(f.id)+'"'+(f.id===c.field?' selected':'')+'>'+esc(f.label)+'</option>').join('')+'</select></td></tr>').join('')+'</tbody></table>';
      $('[data-mapping]').querySelectorAll('[data-field]').forEach(el=>el.onchange=()=>{columns[Number(el.dataset.field)].field=el.value;});
      status(T('Eşleşmeleri kontrol edip formatı kaydedin.','Review the mappings and save the format.'));
    }
    async function inspect(item){
      const model=await root.BLFileParser.readExcelJsModel(item.bytes,{signal:reader.signal});
      if(reader.signal.aborted||!modal.isConnected)return;
      bytes=item.bytes;previous=item.config;wb=new root.ExcelJS.Workbook();wb.model=model;
      const hologram=type()==='hologram';$('[data-hologram-rule]').hidden=!hologram;
      if(hologram){
        const rule=root.BLHologramRequest.normalizeQuantityRule(previous?.quantityRule);
        $('[data-multiplier]').value=rule.multiplier;$('[data-round-to]').value=rule.roundTo;previewQuantityRule();
      }
      $('[data-sheet]').innerHTML=wb.worksheets.map(s=>'<option>'+esc(s.name)+'</option>').join('');
      $('[data-sheet]').value=wb.getWorksheet(previous?.sheetName||'')?.name||wb.worksheets[0].name;
      $('[data-header]').value=previous?.headerRow||1;$('[data-start]').value=previous?.dataRow||2;
      $('[data-file]').textContent=item.name;match();
    }
    async function load(){busy(true);try{await inspect(await configuration(type()));}catch(e){status(failureMessage(e));}finally{busy(false);}}
    $('[data-type]').onchange=load;
    $('[data-upload]').onchange=async e=>{const file=e.target.files[0];if(!file||loading)return;
      if(!/\.xlsx$/i.test(file.name)||file.size>500*1024){status(T('En fazla 500 KB boyutunda .xlsx yükleyin.','Upload an .xlsx file no larger than 500 KB.'));return;}
      busy(true);try{const current={sheetName:$('[data-sheet]').value,headerRow:Number($('[data-header]').value),dataRow:Number($('[data-start]').value),columns,...(type()==='hologram'?{quantityRule:quantityRule()}:{})};await inspect({bytes:new Uint8Array(await file.arrayBuffer()),config:current,name:file.name});}catch(_){status(error().message);}finally{busy(false);}};
    $('[data-match]').onclick=()=>{try{match();}catch(_){status(error().message);}};
    $('[data-download]').onclick=()=>root.BLFixedExcelDefaults.download(bytes,type()+'-template.xlsx',MIME);
    $('[data-reset]').onclick=async()=>{busy(true);try{await json('/api/user-preferences/delete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({keys:[key(type())]})});await load();}catch(e){status(failureMessage(e));}finally{busy(false);}};
    $('[data-save]').onclick=async()=>{busy(true);try{
      const config={sheetName:$('[data-sheet]').value,headerRow:Number($('[data-header]').value),dataRow:Number($('[data-start]').value),columns,...(type()==='hologram'?{quantityRule:quantityRule()}:{})};root.BLExcelTemplateEngine.validate(config);
      const actual=wb.getWorksheet(config.sheetName);if(!actual||columns.some(c=>actual.getRow(config.headerRow).getCell(c.column).text!==c.header))throw error();
      await root.BLExcelTemplateEngine.fill(bytes,config,[{}],root.JSZip,root.BLExcelDates);
      const value=JSON.stringify({version:1,name:$('[data-file]').textContent,config,bytes:encode(bytes)}),entryKey=key(type()),data=await json('/api/user-preferences',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({entries:{[entryKey]:{value,updatedAt:new Date().toISOString()}}})});
      if(data.rejected?.length||data.entries?.[entryKey]?.value!==value)throw error();
      status(T('Format kaydedildi. Sonraki çıktılar bu şablonu kullanacak.','Format saved. Future exports will use this template.'));
    }catch(e){status(failureMessage(e));}finally{busy(false);}};
    modal.querySelectorAll('[data-close]').forEach(b=>b.onclick=close);
    modal.addEventListener('keydown',e=>{if(e.key==='Escape')close();});await load();if(modal.isConnected)$('[data-type]').focus();
  }
  root.BLExcelTemplates={open,build,records,error,catalog};
})(window);
