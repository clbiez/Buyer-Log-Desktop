(function(root,factory){
  'use strict';
  const api=factory(root);
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.BLTableSearchFeedback=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(root){
  'use strict';

  function inspect(query,rows,haystackOf,search,options={}){
    const seen=new Set(),pending=[],invalid=[];
    for(const entry of search.entries(query)){
      const {label,terms}=entry;
      const key=JSON.stringify(terms);if(seen.has(key))continue;seen.add(key);
      if(entry.invalid){invalid.push(label);continue;}
      const criteria=terms[0]?.mode==='rowGroup'?terms[0].terms:terms;
      if(criteria.every(term=>term.mode==='notContains'))continue;
      pending.push({label,terms});
    }
    if(pending.length)for(const row of typeof rows==='function'?rows():rows){
      if(!pending.length)break;
      const haystack=haystackOf(row),matchOptions={...options,plainMode:'contains',periods:options.periodsOf?()=>options.periodsOf(row):options.periods};
      for(let i=pending.length-1;i>=0;i--){
        if(search.matches(haystack,pending[i].terms,matchOptions))pending.splice(i,1);
      }
    }
    return {missing:pending.map(item=>item.label),invalid};
  }
  function findMissing(query,rows,haystackOf,search,options){
    return inspect(query,rows,haystackOf,search,options).missing;
  }

  function render(inputId,rows,haystackOf,english,options){
    const input=root.document?.getElementById(inputId);
    if(!input)return;
    let panel=root.document.getElementById(inputId+'Feedback');
    if(!input.value.trim()){
      if(panel){panel.hidden=true;panel.replaceChildren();}
      return;
    }
    const {missing,invalid}=inspect(input.value,rows,haystackOf,root.BLTableSearch,options);
    if(!missing.length&&!invalid.length){if(panel){panel.hidden=true;panel.replaceChildren();}return;}
    if(!panel){
      panel=root.document.createElement('div');panel.id=inputId+'Feedback';
      panel.className='tableSearchFeedback';panel.setAttribute('role','status');
      panel.setAttribute('aria-live','polite');panel.setAttribute('aria-atomic','true');
      input.closest('.tableActionToolbar').insertAdjacentElement('afterend',panel);
      const describedBy=(input.getAttribute('aria-describedby')||'').split(/\s+/).filter(Boolean);
      input.setAttribute('aria-describedby',[...new Set([...describedBy,panel.id])].join(' '));
    }
    const label=(english?'Not found in filtered results':'Filtrelenmiş sonuçlarda bulunamayan')+' ('+missing.length+'):';
    const signature=JSON.stringify([label,missing,invalid]);
    if(!panel.hidden&&panel.dataset.signature===signature)return;
    panel.dataset.signature=signature;
    const heading=root.document.createElement('strong');heading.textContent=label;
    const chips=missing.map(value=>{
      const chip=root.document.createElement('span');chip.className='tableSearchMissingTerm';
      chip.textContent=value;return chip;
    });
    const children=missing.length?[heading,...chips]:[];
    if(invalid.length){
      const invalidHeading=root.document.createElement('strong');
      invalidHeading.textContent=(english?'Invalid filter':'Geçersiz süzgeç')+' ('+invalid.length+'):';
      children.push(invalidHeading,...invalid.map(value=>{
        const chip=root.document.createElement('span');chip.className='tableSearchMissingTerm tableSearchInvalidTerm';chip.textContent=value;return chip;
      }));
    }
    panel.replaceChildren(...children);panel.hidden=false;
    root.BLMotionPlus?.play('card',panel);
  }

  return {findMissing,inspect,render};
});
