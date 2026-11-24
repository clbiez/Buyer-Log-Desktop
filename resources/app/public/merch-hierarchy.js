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
  var data=null,version=null,loading=null,listeners=[];

  // Aktif dil render anında okunur (dil değişiminde bayat metin kalmaz).
  function lang(){var d=root.document&&root.document.documentElement;return String((d&&d.lang)||root.appLang||'tr').toLowerCase().indexOf('en')===0?'en':'tr';}
  function L(tr,en){return lang()==='en'?en:tr;}
  function code(value){return String(value==null?'':value).replace(/\s+/g,' ').trim().toUpperCase();}
  function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}
  function lower(s){try{return String(s||'').toLocaleLowerCase('tr-TR');}catch(_){return String(s||'').toLowerCase();}}

  function fieldOf(key){
    var k=String(key==null?'':key).trim();if(!k)return '';
    if(FIELDS.indexOf(k)>=0)return k;
    if(ROW_KEYS[k])return ROW_KEYS[k];
    var CF=root.BLCanonicalFields;
    if(CF&&typeof CF.canonicalId==='function'){
      var hit=CF.canonicalId('',k);
      if(!hit){var mods=['cp','orders','backlog','overview','lfl','logistics','antrepo','collection'];for(var i=0;i<mods.length&&!hit;i++)hit=CF.canonicalId(mods[i],k);}
      if(hit&&FIELDS.indexOf(hit)>=0)return hit;
    }
    return '';
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
    if(d.missing)return '<span class="blMerchCtx blMerchCtxMissing">'+esc(L('Eşleme yok','No mapping'))+'</span>';
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
    var value=input.value;if(!/[0-9A-Za-zÇĞİÖŞÜçğıöşü]/.test(String(value)))return; // boş / '—' yer tutucu
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

  return Object.freeze({fieldOf:fieldOf,noteVersion:noteVersion,ensure:ensure,onChange:onChange,setData:setData,describe:describe,optionText:optionText,searchText:searchText,ctxHtml:ctxHtml,decorate:decorate,decorateSelect:decorateSelect,FIELDS:FIELDS.slice()});
});
