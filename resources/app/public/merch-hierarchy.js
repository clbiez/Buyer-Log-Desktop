(function(root,factory){
  'use strict';
  var api=factory(root);
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.BLMerchHierarchy=api;
})(typeof window!=='undefined'?window:globalThis,function(root){
  'use strict';

  /*
   * Merch hiyerarşisi bağlamı (Marka Müdürlüğü › MMYG › MAG).
   * -------------------------------------------------------
   * Filtre listeleri ham kodu (CU4E) filtreler; bu modül yalnız GÖRÜNÜMÜ ve aramayı
   * zenginleştirir: kodun altına bağlı olduğu MMYG adı ve Marka Müdürlüğü yazılır.
   * Seçilen/kaydedilen değer değişmez; kayıtlı görünümler, formüller ve Excel
   * çıktıları etkilenmez.
   *
   * Veri sunucudaki kullanıcı ASAS yenilemesinden gelir (/api/merch-hierarchy);
   * elle bakım yoktur. Modül açılışta hiçbir şey indirmez: ilk merch filtresi
   * açıldığında bir kez ister, veri sürümü değişince (yeni yenileme) yeniden ister.
   *
   * Kullanım (her filtre yüzeyi aynı API'yi kullanır):
   *   BLMerchHierarchy.fieldOf(columnKey)            → 'mag' | 'mmyg' | 'brandDirectorate' | ''
   *   BLMerchHierarchy.decorate(container, field)    → .cfpItem checklist satırlarını iki satırlı yapar
   *   BLMerchHierarchy.decorateSelect(select, field) → <option> metnine tek satır bağlam ekler
   *   BLMerchHierarchy.optionText(field, value)      → "CU4E — ERKEK ÇOCUK · … Md." (tek satır)
   *   BLMerchHierarchy.searchText(field, value)      → arama için kod + ad + müdürlük
   */

  var FIELDS=['mag','mmyg','brandDirectorate'];
  // Kanonik kayıt defterinde bulunmayan modül-içi satır anahtarları.
  var ROW_KEYS={merch:'mag',mags:'mag',magRaw:'mag',ageGroup:'mmyg',mmygs:'mmyg',mmygRaw:'mmyg',brandDirectorate:'brandDirectorate',directorate:'brandDirectorate'};
  var data=null,version=null,loading=null,listeners=[],masterRetry=0;

  // Aktif dil render anında okunur (dil değişiminde bayat metin kalmaz).
  function lang(){var d=root.document&&root.document.documentElement;return String((d&&d.lang)||root.appLang||'tr').toLowerCase().indexOf('en')===0?'en':'tr';}
  function L(tr,en){return lang()==='en'?en:tr;}
  function code(value){return String(value==null?'':value).replace(/\s+/g,' ').trim().toUpperCase();}
  function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}
  function lower(s){try{return String(s||'').toLocaleLowerCase('tr-TR');}catch(_){return String(s||'').toLowerCase();}}

  /* Model/İngilizce sütun adları (Ufuk, Veri Yönetimi ve widget'lar modeldeki adı
     gösterir: "Merch Sub-Group Code"). Kanonik kayıt defterine eklenmez; yalnız görüntü
     bağlamı için tanınır. Anahtarlar token biçimindedir (büyük harf, Türkçe karaktersiz). */
  var MODEL_NAMES={
    // Yalnız KOD sütunları: Kod'suz "Merch Brand Age Group" gibi adlar ad tutabilir (TR'de
    // "Merch Marka Yaş Grup" addır); "Merch Sub-Group" kayıt defterindeki "Merch Alt Grup" ile eşdeğerdir.
    'MERCH SUB GROUP CODE':'mag','MERCH SUBGROUP CODE':'mag','MERCH SUB GROUP':'mag','MERCHANDISE SUB GROUP CODE':'mag','MERCH ALT GRUP KODU':'mag','MAG KODU':'mag','MAG CODE':'mag', // i18n-ignore
    'MERCH BRAND AGE GROUP CODE':'mmyg','BRAND AGE GROUP CODE':'mmyg','MERCH MARKA YAS GRUP KODU':'mmyg','MMYG KODU':'mmyg','MMYG CODE':'mmyg', // i18n-ignore
    'MARKA MUDURLUGU':'brandDirectorate','BRAND DIRECTORATE':'brandDirectorate','BRAND DIRECTORATES':'brandDirectorate','MARKA DIREKTORLUGU':'brandDirectorate','MARKA DIREKTORLUKLERI':'brandDirectorate' // i18n-ignore
  };
  var TR_FOLD={'ı':'I','İ':'I','ş':'S','Ş':'S','ğ':'G','Ğ':'G','ü':'U','Ü':'U','ö':'O','Ö':'O','ç':'C','Ç':'C'};
  function tokenOf(v){return String(v==null?'':v).replace(/[ıİşŞğĞüÜöÖçÇ]/g,function(ch){return TR_FOLD[ch];}).toUpperCase().replace(/[^A-Z0-9]+/g,' ').trim();}
  var fieldCache=new Map();
  function fieldOfOne(k){
    if(FIELDS.indexOf(k)>=0)return k;
    if(ROW_KEYS[k])return ROW_KEYS[k];
    var CF=root.BLCanonicalFields;
    if(CF&&typeof CF.canonicalId==='function'){
      var hit=CF.canonicalId('',k);
      if(!hit){var mods=['cp','orders','backlog','overview','lfl','logistics','antrepo','collection'];for(var i=0;i<mods.length&&!hit;i++)hit=CF.canonicalId(mods[i],k);}
      if(hit&&FIELDS.indexOf(hit)>=0)return hit;
    }
    return MODEL_NAMES[tokenOf(k)]||'';
  }
  function fieldOf(key){
    var k=String(key==null?'':key).trim();if(!k)return '';
    if(fieldCache.has(k))return fieldCache.get(k);
    // "Tablo · Sütun", "Tablo::Sütun", "'Tablo'[Sütun]" → önce tamamı, sonra yalnız sütun kısmı.
    var bracket=k.match(/\[([^\]]+)\]\s*$/);
    var parts=[k,bracket&&bracket[1],k.split('::').pop(),k.split('·').pop()].map(function(p){return String(p||'').trim();}).filter(Boolean);
    var out='';for(var i=0;i<parts.length&&!out;i++)out=fieldOfOne(parts[i]);
    if(fieldCache.size>2000)fieldCache.clear();
    fieldCache.set(k,out);
    return out;
  }

  function noteVersion(next){
    var v=next==null?null:String(next);
    if(v===version)return;
    version=v;
    // Veri değişti: bir sonraki ihtiyaçta yeniden istenir; mevcut kopya o zamana dek kullanılır.
    if(data)data._stale=true;
  }

  function ensure(){
    if(data&&!data._stale)return Promise.resolve(data);
    if(loading)return loading;
    if(typeof root.fetch!=='function')return Promise.resolve(data);
    loading=root.fetch('/api/merch-hierarchy',{credentials:'same-origin',cache:'no-store'})
      .then(function(r){return r.ok?r.json():null;})
      .then(function(json){
        if(json&&json.mag&&json.mmyg){data=json;listeners.slice().forEach(function(fn){try{fn(data);}catch(_){}});}
        // Model geneli eşleme sunucuda arka planda hazırlanıyorsa bir kez, kısa süre sonra yeniden istenir.
        if(json&&json.master&&json.master.pending&&!masterRetry){masterRetry=setTimeout(function(){if(data)data._stale=true;ensure();},20000);}
        return data;
      })
      .catch(function(){return data;})
      .then(function(result){loading=null;return result;});
    return loading;
  }
  function onChange(fn){if(typeof fn==='function')listeners.push(fn);return function(){listeners=listeners.filter(function(x){return x!==fn;});};}
  /** Testler ve sunucu tarafı ön-doldurma için. */
  function setData(json){data=json&&json.mag&&json.mmyg?json:null;}

  function directorateShort(text){return String(text||'').replace(/\s+MARKA\s+D[İI]REKT[ÖO]RL[ÜU][ĞG][ÜU]$/i,' Md.').replace(/\s+KATEGOR[İI]\s+D[İI]REKT[ÖO]RL[ÜU][ĞG][ÜU]$/i,' Kat. Md.');} // i18n-ignore — veri kısaltması

  /** Bir değer için bağlam: { line1, line2, title, search } — bulunamazsa null. */
  function describe(field,value){
    if(!data)return null;
    var c=code(value);if(!c)return null;
    if(field==='mag'){
      var m=data.mag[c];if(!m)return {missing:true};
      var p=data.mmyg[m.mmyg]||{};var dir=m.directorate||p.directorate||'';
      var l1=[m.mmyg,p.name].filter(Boolean).join(' · ');
      return {line1:l1,line2:dir,title:[c,l1,dir].filter(Boolean).join(' › '),search:[c,m.mmyg,p.name,dir].join(' '),stale:Boolean(m.stale)};
    }
    if(field==='mmyg'){
      var g=data.mmyg[c];if(!g)return {missing:true};
      var count=0;for(var k in data.mag)if(data.mag[k].mmyg===c)count++;
      var l1b=g.name||'';var l2b=[g.directorate||'',count?(count+' MAG'):''].filter(Boolean).join(' · ');
      return {line1:l1b,line2:l2b,title:[c,g.name,g.directorate].filter(Boolean).join(' › '),search:[c,g.name,g.directorate].join(' '),stale:Boolean(g.stale)};
    }
    if(field==='brandDirectorate'){
      var name=String(value==null?'':value).trim();if(!name)return null;var want=lower(name);var codes=[];
      for(var mm in data.mmyg)if(lower(data.mmyg[mm].directorate)===want)codes.push(mm);
      if(!codes.length)return {missing:true};
      codes.sort();
      var shown=codes.slice(0,6).join(', ')+(codes.length>6?' +'+(codes.length-6):'');
      return {line1:'MMYG: '+shown,line2:'',title:name+' › '+codes.join(', '),search:name+' '+codes.join(' ')+' '+codes.map(function(x){return data.mmyg[x].name||'';}).join(' ')};
    }
    return null;
  }

  function optionText(field,value){
    var raw=String(value==null?'':value);var d=describe(field,value);
    if(!d||d.missing||!(d.line1||d.line2))return raw;
    if(field==='brandDirectorate')return raw;
    return raw+' — '+[d.line1,directorateShort(d.line2)].filter(Boolean).join(' · ');
  }
  function searchText(field,value){var d=describe(field,value);return lower(String(value==null?'':value)+' '+(d&&d.search||''));}

  function ctxHtml(field,value){
    var d=describe(field,value);
    if(!d)return '';
    if(d.missing){
      var why=data&&data.master&&data.master.builtAt
        ?L('Bu kod ASAS modelindeki MAG/MMYG listesinde yok (eski, geçersiz ya da başka kaynaktan gelen kod).','This code is not in the ASAS model MAG/MMYG list (old, invalid or from another source).')
        :L('Model geneli eşleme henüz okunmadı; ASAS model bağlantısıyla bir yenileme sonrası tamamlanır.','The model-wide mapping has not been read yet; it completes after a refresh with the ASAS model connection.');
      return '<span class="blMerchCtx blMerchCtxMissing" title="'+esc(why)+'">'+esc(L('Eşleme yok','No mapping'))+'</span>';
    }
    var parts=[];
    if(d.line1)parts.push('<span class="blMerchCtxLine">'+esc(d.line1)+'</span>');
    if(d.line2)parts.push('<span class="blMerchCtxLine blMerchCtxSub">'+esc(field==='mmyg'?d.line2:directorateShort(d.line2))+'</span>');
    return parts.length?'<span class="blMerchCtx'+(d.stale?' blMerchCtxStale':'')+'" title="'+esc(d.title+(d.stale?' · '+L('son yenilemede görülmedi','not seen in the latest refresh'):''))+'">'+parts.join('')+'</span>':'';
  }

  /* Checklist satırı: <label class="cfpItem" data-txt="..."><input value="CU4E"> CU4E</label>
     Kod metni ve bağlam tek bir sütunda toplanır; arama metni (data-txt) genişletilir.
     Farklı işaretleme kullanan listeler (ör. LFL .lflDimOption) seçicilerini verir:
       { item: '.lflDimOption', text: 'span', searchAttr: 'search' } */
  var DEFAULT_SHAPE={item:'.cfpItem',text:'',searchAttr:'txt'};
  function decorateItem(item,field,shape){
    var input=item.querySelector('input');if(!input)return;
    // Değer: value niteliği; yoksa (data-* ile kodlanmış listeler) satır metni. İlk geçişte saklanır.
    if(item.dataset.merchValue==null){var raw=input.getAttribute('value'),host0=shape.text?item.querySelector(shape.text):null;item.dataset.merchValue=raw!=null?raw:String((host0||item).textContent||'').replace(/\s+/g,' ').trim();}
    var value=item.dataset.merchValue;if(!/[0-9A-Za-zÇĞİÖŞÜçğıöşü]/.test(String(value)))return; // boş / '—' yer tutucu
    var old=item.querySelector('.blMerchCtx');if(old)old.remove();
    var html=ctxHtml(field,value);if(!html)return;
    var wrap=item.querySelector('.blMerchOpt');
    if(!wrap){
      var host=shape.text?item.querySelector(shape.text):null;
      wrap=document.createElement('span');wrap.className='blMerchOpt';
      var codeEl=document.createElement('span');codeEl.className='blMerchCode';
      var nodes=host?[].slice.call(host.childNodes):[].slice.call(item.childNodes).filter(function(n){return n!==input&&!(n.nodeType===1&&n.tagName==='EM');});
      nodes.forEach(function(n){codeEl.appendChild(n);});
      if(!codeEl.textContent.trim())codeEl.textContent=value;
      wrap.appendChild(codeEl);
      if(host)host.appendChild(wrap);else item.insertBefore(wrap,input.nextSibling);
    }
    wrap.insertAdjacentHTML('beforeend',html);
    item.classList.add('blMerchItem');
    var attr=shape.searchAttr||'txt',baseKey='blMerchBase'+attr.charAt(0).toUpperCase()+attr.slice(1);
    if(!item.dataset[baseKey])item.dataset[baseKey]=item.dataset[attr]||lower(value);
    item.dataset[attr]=item.dataset[baseKey]+' '+searchText(field,value);
  }
  function apply(container,field,shape){
    if(!container||!field)return;
    var items=container.querySelectorAll(shape.item);
    for(var i=0;i<items.length;i++)decorateItem(items[i],field,shape);
    if(container.matches&&container.matches(shape.item))decorateItem(container,field,shape);
  }
  function decorate(container,field,shapeOpt){
    field=FIELDS.indexOf(field)>=0?field:fieldOf(field);
    if(!container||!field)return false;
    var shape={item:(shapeOpt&&shapeOpt.item)||DEFAULT_SHAPE.item,text:(shapeOpt&&shapeOpt.text)||'',searchAttr:(shapeOpt&&shapeOpt.searchAttr)||DEFAULT_SHAPE.searchAttr};
    if(data&&!data._stale){apply(container,field,shape);return true;}
    if(data)apply(container,field,shape);
    ensure().then(function(){if(container.isConnected!==false)apply(container,field,shape);});
    return true;
  }
  function decorateSelect(select,field){
    field=FIELDS.indexOf(field)>=0?field:fieldOf(field);
    if(!select||!field||field==='brandDirectorate')return false;
    var run=function(){
      [].slice.call(select.options||[]).forEach(function(opt){
        if(!String(opt.value).trim())return;
        if(!opt.dataset.blMerchBase)opt.dataset.blMerchBase=opt.textContent;
        var t=optionText(field,opt.value);
        opt.textContent=t===String(opt.value)?opt.dataset.blMerchBase:t;
      });
    };
    if(data)run();
    if(!data||data._stale)ensure().then(function(){if(select.isConnected!==false)run();});
    return true;
  }

  /* Bildirimsel bağlantı: liste kapsayıcısı data-merch-field="MAG" (ve gerekirse
     data-merch-item / data-merch-text) taşır; çizimden sonra decorateAll(root) yeter. */
  function decorateAll(root){
    if(!root||!root.querySelectorAll)return 0;
    var hosts=[].slice.call(root.querySelectorAll('[data-merch-field]:not([data-merch-value])'));
    if(root.matches&&root.matches('[data-merch-field]:not([data-merch-value])'))hosts.push(root);
    hosts.forEach(function(host){
      if(host.tagName==='SELECT')decorateSelect(host,host.dataset.merchField);
      else decorate(host,host.dataset.merchField,{item:host.dataset.merchItem||DEFAULT_SHAPE.item,text:host.dataset.merchText||'',searchAttr:'blMerchSearch'});
    });
    return hosts.length;
  }

  /* ---------------------------------------------------------------------------
     Hover ipucu: tablolarda (CP, Siparişler, Backlog, widget ve rapor tabloları) ve
     data-merch-field + data-merch-value taşıyan her öğede imleç bir MAG / MMYG /
     Marka Müdürlüğü değerine gelince tam zincir gösterilir.
     Maliyet: tablo çizimine HİÇBİR şey eklenmez. Belge düzeyinde tek pointerover
     dinleyicisi vardır; sütun alanı hücrenin data-key'inden ya da tablo başlık
     satırından (tablo başına önbellekli) çözülür, değer O(1) haritadan okunur.
     Veri yalnız ilk merch hücresine gelindiğinde istenir. */
  var TIP_DELAY=320,tipEl=null,tipTarget=null,tipTimer=0,pendingEl=null,headerCache=typeof WeakMap==='function'?new WeakMap():null;
  function headerLabel(th){
    if(!th)return '';
    var ds=th.dataset||{};
    if(ds.merchField)return ds.merchField;
    var key=ds.key||ds.fk||ds.kcol||ds.col||'';
    if(key&&fieldOf(key))return key;
    var label=th.querySelector&&th.querySelector('.thLabel');
    return String((label||th).textContent||'').replace(/[▾▴▲▼↑↓⇅]/g,'').replace(/\s+/g,' ').trim(); // i18n-ignore — sıralama okları
  }
  function columnFields(table){
    var head=table.tHead;if(!head||!head.rows.length)return null;
    var row=head.rows[head.rows.length-1],cached=headerCache&&headerCache.get(table);
    if(cached&&cached.row===row&&cached.count===row.cells.length)return cached.fields;
    var fields=[],idx=0;
    for(var i=0;i<row.cells.length;i++){var cell=row.cells[i],span=cell.colSpan||1,f=fieldOf(headerLabel(cell));for(var s=0;s<span;s++)fields[idx+s]=f;idx+=span;}
    if(headerCache)headerCache.set(table,{row:row,count:row.cells.length,fields:fields});
    return fields;
  }
  function cellColumnIndex(td){var idx=0,cells=td.parentElement?td.parentElement.cells:[];for(var i=0;i<cells.length&&cells[i]!==td;i++)idx+=cells[i].colSpan||1;return idx;}
  function hoverTarget(el){
    if(!el||!el.closest)return null;
    var tagged=el.closest('[data-merch-field][data-merch-value]');
    if(tagged)return {el:tagged,field:fieldOf(tagged.dataset.merchField),value:tagged.dataset.merchValue};
    var td=el.closest('td');if(!td||td.closest('.colFilterPanel'))return null;
    var field='';
    if(td.dataset.merchField)field=fieldOf(td.dataset.merchField);
    else if(td.dataset.key)field=fieldOf(td.dataset.key);
    if(!field){var table=td.closest('table'),fields=table&&columnFields(table);field=fields?fields[cellColumnIndex(td)]||'':'';}
    if(!field)return null;
    // Değer adayları: gruplu widget hücreleri aç/kapa oku, <strong> etiket ve "3 model" sayısı
    // taşır (tam metin "▾CU4E3 model" olur). Ham değer title / <strong> içindedir; eşlemede
    // bulunan ilk aday kullanılır (showTip).
    var clean=function(v){return String(v==null?'':v).replace(/\s+/g,' ').trim();};
    var strong=td.querySelector&&td.querySelector('strong');
    var candidates=[td.dataset.merchValue,td.getAttribute('title'),td.dataset.blMerchTitle,strong&&strong.textContent,td.textContent].map(clean).filter(function(v,i,a){return v&&a.indexOf(v)===i;});
    return candidates.length?{el:td,field:field,value:candidates[0],candidates:candidates}:null;
  }
  function tipLines(field,value){
    if(!data)return null;
    var c=code(value);
    if(field==='mag'){
      var m=data.mag[c];if(!m)return null;var p=data.mmyg[m.mmyg]||{};
      return {head:c+' · MAG',lines:[L('MMYG: ','MMYG: ')+[m.mmyg,p.name].filter(Boolean).join(' · '),L('Marka Müdürlüğü: ','Brand Directorate: ')+(m.directorate||p.directorate||'—')],stale:m.stale};
    }
    if(field==='mmyg'){
      var g=data.mmyg[c];if(!g)return null;var mags=[];for(var k in data.mag)if(data.mag[k].mmyg===c)mags.push(k);mags.sort();
      return {head:c+(g.name?' · '+g.name:''),lines:[L('Marka Müdürlüğü: ','Brand Directorate: ')+(g.directorate||'—'),'MAG: '+(mags.slice(0,10).join(', ')+(mags.length>10?' +'+(mags.length-10):'')||'—')],stale:g.stale};
    }
    if(field==='brandDirectorate'){
      var want=lower(String(value).trim()),groups=[];
      for(var mm in data.mmyg)if(lower(data.mmyg[mm].directorate)===want)groups.push(mm+(data.mmyg[mm].name?' · '+data.mmyg[mm].name:''));
      if(!groups.length)return null;groups.sort();
      return {head:String(value).trim(),lines:groups.slice(0,8).concat(groups.length>8?['+'+(groups.length-8)+' MMYG']:[])};
    }
    return null;
  }
  function hideTip(){
    clearTimeout(tipTimer);tipTimer=0;pendingEl=null;
    if(tipTarget&&tipTarget.dataset&&tipTarget.dataset.blMerchTitle!=null){if(!tipTarget.hasAttribute('title'))tipTarget.setAttribute('title',tipTarget.dataset.blMerchTitle);delete tipTarget.dataset.blMerchTitle;}
    tipTarget=null;
    if(tipEl){tipEl.classList.remove('isVisible');tipEl.hidden=true;}
  }
  function showTip(target){
    var t=null,list=target.candidates||[target.value];
    for(var i=0;i<list.length&&!t;i++)t=tipLines(target.field,list[i]);
    if(!t)return;
    var doc=root.document;
    if(!tipEl){tipEl=doc.createElement('div');tipEl.className='blTip blMerchTip';tipEl.setAttribute('role','tooltip');tipEl.hidden=true;doc.body.appendChild(tipEl);}
    var el=target.el;
    // Yerel title ikinci (gecikmeli) ipucu açmasın: ayrılınca geri yazılır.
    if(el.hasAttribute('title')){el.dataset.blMerchTitle=el.getAttribute('title');el.removeAttribute('title');}
    tipEl.innerHTML='<b>'+esc(t.head)+'</b>'+t.lines.map(function(line){return '<span>'+esc(line)+'</span>';}).join('')+(t.stale?'<span class="blMerchCtxStale">'+esc(L('Son yenilemede görülmedi','Not seen in the latest refresh'))+'</span>':'');
    tipEl.hidden=false;
    var r=el.getBoundingClientRect(),w=tipEl.offsetWidth,h=tipEl.offsetHeight,vw=root.innerWidth,vh=root.innerHeight;
    var left=Math.max(8,Math.min(Math.round(r.left),vw-w-8)),top=Math.round(r.bottom+6);
    if(top+h>vh-8)top=Math.round(r.top-h-6);
    tipEl.style.left=left+'px';tipEl.style.top=top+'px';
    tipEl.classList.add('isVisible');
    tipTarget=el;
  }
  function onOver(event){
    var target=hoverTarget(event.target);
    if(!target){if(tipTarget&&!tipTarget.contains(event.target))hideTip();return;}
    if(target.el===tipTarget||target.el===pendingEl)return;
    hideTip();
    pendingEl=target.el;
    tipTimer=setTimeout(function(){
      tipTimer=0;pendingEl=null;
      if(!target.el.isConnected)return;
      if(data&&!data._stale){showTip(target);return;}
      ensure().then(function(){if(target.el.isConnected&&target.el.matches(':hover'))showTip(target);});
    },TIP_DELAY);
  }
  function installHoverTips(){
    var doc=root.document;if(!doc||!doc.addEventListener||root.__blMerchTipsInstalled)return false;
    root.__blMerchTipsInstalled=true;
    doc.addEventListener('pointerover',onOver,{passive:true});
    doc.addEventListener('pointerout',function(event){var owner=tipTarget||pendingEl;if(owner&&!owner.contains(event.relatedTarget))hideTip();},{passive:true});
    doc.addEventListener('pointerdown',hideTip,true);
    doc.addEventListener('keydown',function(event){if(event.key==='Escape')hideTip();});
    root.addEventListener('scroll',hideTip,true);
    root.addEventListener('blur',hideTip);
    return true;
  }
  if(root&&root.document&&typeof module==='undefined')installHoverTips();

  return Object.freeze({fieldOf:fieldOf,noteVersion:noteVersion,ensure:ensure,onChange:onChange,setData:setData,describe:describe,optionText:optionText,searchText:searchText,ctxHtml:ctxHtml,decorate:decorate,decorateSelect:decorateSelect,decorateAll:decorateAll,tipLines:tipLines,hoverTarget:hoverTarget,installHoverTips:installHoverTips,FIELDS:FIELDS.slice()});
});
