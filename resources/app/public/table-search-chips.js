/* Tablo araması kipleri: arama metnini terim terim gösterir.
 * "XXX, YYY" → [XXX] veya [YYY]; "A; B" → [A] ve [B]; "MB=M3-M5" → [MB · Mart–Mayıs];
 * "14!" → [Hariç: 14]; geçersiz kısayol ve filtrelenmiş sonuçlarda bulunmayan terim
 * ayrı işaretlenir. Her kip tek tek kaldırılabilir; arama metni anlamı korunarak
 * yeniden yazılır. Eşleşme motoruna dokunmaz; yalnız görünüm ve düzenleme katmanıdır.
 */
(function(root,factory){
  'use strict';
  const api=factory(root);
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.BLTableSearchChips=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(root){
  'use strict';

  const clean=value=>String(value==null?'':value).trim();
  const keyOf=value=>clean(value).toLocaleLowerCase('tr-TR');
  const T=(english,tr,en)=>english?en:tr;

  // Satır gruplarını kaçışlı ayraçları bölmeden ayırır: "(A; 1), (B; 2)".
  function splitRowGroups(source){
    const labels=[];let start=0,depth=0,escaped=false;
    for(let i=0;i<source.length;i++){
      const ch=source[i];
      if(escaped){escaped=false;continue;}
      if(ch==='\\'){escaped=true;continue;}
      if(ch==='(')depth++;
      else if(ch===')')depth--;
      else if(ch===','&&depth===0){labels.push(source.slice(start,i).trim());start=i+1;}
    }
    labels.push(source.slice(start).trim());
    return labels.filter(Boolean);
  }

  function periods(){return root&&root.BLTableSearchPeriods||null;}

  function describePart(raw){
    const marker=raw[0];
    const suffix=marker!=='!'&&marker!=='/'&&raw.length>1&&raw[raw.length-1]==='!';
    const exclude=marker==='!'||suffix;
    const text=clean(marker==='!'||marker==='/'?raw.slice(1):suffix?raw.slice(0,-1):raw);
    if(!text)return null;
    const parsed=periods()?periods().parse(text):null;
    return {raw,text,exclude,parsed:parsed&&!parsed.invalid?parsed:null,invalid:parsed&&parsed.invalid?parsed:null};
  }

  /* Arama metnini kip yapısına çevirir. groups: [[part]] (VE ile bağlı, grup içi VEYA). */
  function parse(query){
    const source=clean(query);
    if(!source)return {rowGroups:false,groups:[]};
    const rowGroupApi=root&&root.BLTableSearchRowGroups;
    if(source[0]==='('&&rowGroupApi&&rowGroupApi.parseRowGroups(source)){
      return {rowGroups:true,groups:[splitRowGroups(source).map(raw=>({raw,text:raw.replace(/^\(|\)$/g,'').split(/\s*;\s*/).join(' + '),exclude:false,parsed:null,invalid:null,rowGroup:true}))]};
    }
    const groups=source.split(/;\s+/).map(group=>group.split(/,\s+/)
      .flatMap(part=>String(part).split(/(?<=[^\s!]!)\s+/))
      .map(clean).filter(Boolean).map(describePart).filter(Boolean)).filter(group=>group.length);
    return {rowGroups:false,groups};
  }

  /* index: düz sırada (grup grup) kip numarası. Kalan terimlerle arama metnini yazar. */
  function remove(query,index){
    const model=parse(query);let i=0;
    if(model.rowGroups)return model.groups[0].filter(()=>i++!==index).map(part=>part.raw).join(', ');
    return model.groups.map(group=>group.filter(()=>i++!==index).map(part=>part.raw).join(', ')).filter(Boolean).join('; ');
  }

  function chipLabel(part,english){
    if(part.parsed)return periods().label(part.parsed,english);
    return part.text;
  }

  /* Görüntü sırası: pozitif gruplar (VE), grup içi VEYA; hariç tutmalar en sonda VE ile. */
  function chips(query,options){
    const opts=options||{},english=!!opts.english,missing=opts.missing instanceof Set?opts.missing:new Set();
    const model=parse(query);let index=0;
    const positive=[],excluded=[];
    model.groups.forEach(group=>{
      const list=[];
      group.forEach(part=>{
        const chip={
          index:index++,key:keyOf(part.raw),raw:part.raw,
          label:chipLabel(part,english),
          kind:part.invalid?'invalid':part.exclude?'exclude':part.rowGroup?'group':part.parsed?'field':'term',
          title:part.invalid?periods().invalidReason(part.invalid,english):part.parsed?part.raw:'',
          missing:!part.exclude&&!part.invalid&&missing.has(keyOf(part.raw)),
        };
        (part.exclude?excluded:list).push(chip);
      });
      if(list.length)positive.push(list);
    });
    return {rowGroups:model.rowGroups,groups:positive,excluded};
  }

  function esc(value){
    return String(value==null?'':value).replace(/[&<>'"]/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]));
  }

  function chipHtml(chip,english){
    const state=chip.kind==='invalid'?T(english,'Geçersiz kısayol','Invalid shortcut')
      :chip.missing?T(english,'Filtrelenmiş sonuçlarda yok','Not in filtered results'):'';
    const prefix=chip.kind==='exclude'?T(english,'Hariç: ','Not: '):'';
    const removeText=T(english,'Terimi kaldır','Remove term');
    const detail=[state,chip.title].filter(Boolean).join(' · ');
    const aria=`${removeText}: ${prefix}${chip.label}${detail?' ('+detail+')':''}`;
    return `<button type="button" class="activeFilterToken tableSearchChip tableSearchChip--${chip.kind}${chip.missing?' tableSearchChip--missing':''}" data-search-chip="${chip.index}" data-chip-key="${esc(chip.key)}" title="${esc(aria)}" aria-label="${esc(aria)}"><span>${esc(prefix+chip.label)}</span><svg class="ic" aria-hidden="true"><use href="#i-x"/></svg></button>`;
  }

  function html(query,options){
    const opts=options||{},english=!!opts.english,model=chips(query,opts);
    const join=text=>`<span class="tableSearchChipJoin" aria-hidden="true">${esc(text)}</span>`;
    const or=join(T(english,'veya','or')),and=join(T(english,'ve','and'));
    const parts=model.groups.map(group=>group.map(chip=>chipHtml(chip,english)).join(or));
    if(model.excluded.length)parts.push(model.excluded.map(chip=>chipHtml(chip,english)).join(and));
    const label=T(english,'Arama','Search');
    return `<span class="tableSearchChips" role="group" data-search-input="${esc(opts.inputId||'')}" aria-label="${esc(T(english,'Arama terimleri','Search terms'))}"><span class="tableSearchChipsLabel">${esc(label)}</span>${parts.join(and)}</span>`;
  }

  /* Eksik değer geri bildirimi tablo çiziminden sonra gelirse kipleri yerinde işaretler. */
  function markMissing(inputId,labels,english){
    const doc=root&&root.document;if(!doc)return;
    const missing=new Set((labels||[]).map(keyOf));
    doc.querySelectorAll(`.tableSearchChips[data-search-input="${inputId}"] [data-chip-key]`).forEach(button=>{
      const on=missing.has(button.dataset.chipKey)&&!/tableSearchChip--(exclude|invalid)/.test(button.className);
      button.classList.toggle('tableSearchChip--missing',on);
    });
  }

  /* Kip tıklaması: terimi kaldırır, arama girdisini normal input akışıyla günceller. */
  function bind(container,inputId){
    if(!container)return;
    container.querySelectorAll('[data-search-chip]').forEach(button=>button.addEventListener('click',event=>{
      event.preventDefault();
      const input=root.document.getElementById(inputId);if(!input)return;
      input.value=remove(input.value,Number(button.dataset.searchChip));
      const EventCtor=root.Event;
      input.dispatchEvent(new EventCtor('input',{bubbles:true}));
    }));
  }

  return {parse,remove,chips,html,markMissing,bind};
});
