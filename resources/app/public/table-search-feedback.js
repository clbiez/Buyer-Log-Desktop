(function(root,factory){
  'use strict';
  const api=factory(root);
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.BLTableSearchFeedback=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(root){
  'use strict';

  // Satır gruplarını özgün yazımlarıyla koru; kaçışlı parantez/ayraçları bölme.
  function rowGroupLabels(source){
    const labels=[];let start=0,depth=0,escaped=false;
    for(let i=0;i<source.length;i++){
      const ch=source[i];
      if(escaped){escaped=false;continue;}
      if(ch==='\\'){escaped=true;continue;}
      if(ch==='(')depth++;
      else if(ch===')')depth--;
      else if(ch===','&&depth===0){labels.push(source.slice(start,i).trim());start=i+1;}
    }
    labels.push(source.slice(start).trim());return labels;
  }

  function findMissing(query,rows,haystackOf,search){
    const source=String(query||'').trim();
    if(!source)return [];
    const parsed=search.parseTerms(source);
    const grouped=parsed[0]?.mode==='rowGroup';
    const labels=grouped?rowGroupLabels(source):source.split(/;\s+|,\s+/).map(s=>s.trim());
    const seen=new Set(),pending=[];
    for(const label of labels){
      const terms=search.parseTerms(label);
      if(!terms.length)continue;
      // Olumsuz koşullar model/değer listesi değildir; eksik olarak işaretlenmez.
      const criteria=grouped?terms[0].terms:terms;
      if(criteria.every(term=>term.mode==='notContains'))continue;
      const key=JSON.stringify(terms);
      if(seen.has(key))continue;
      seen.add(key);pending.push({label,terms});
    }
    for(const row of rows){
      if(!pending.length)break;
      const haystack=haystackOf(row);
      for(let i=pending.length-1;i>=0;i--){
        if(search.matches(haystack,pending[i].terms,{plainMode:'contains'}))pending.splice(i,1);
      }
    }
    return pending.map(item=>item.label);
  }

  function render(inputId,rows,haystackOf,english){
    const input=root.document?.getElementById(inputId);
    if(!input)return;
    let panel=root.document.getElementById(inputId+'Feedback');
    if(!input.value.trim()){
      if(panel){panel.hidden=true;panel.replaceChildren();}
      return;
    }
    const missing=findMissing(input.value,rows,haystackOf,root.BLTableSearch);
    if(!missing.length){if(panel){panel.hidden=true;panel.replaceChildren();}return;}
    if(!panel){
      panel=root.document.createElement('div');panel.id=inputId+'Feedback';
      panel.className='tableSearchFeedback';panel.setAttribute('role','status');
      panel.setAttribute('aria-live','polite');panel.setAttribute('aria-atomic','true');
      input.closest('.tableActionToolbar').insertAdjacentElement('afterend',panel);
      const describedBy=(input.getAttribute('aria-describedby')||'').split(/\s+/).filter(Boolean);
      input.setAttribute('aria-describedby',[...new Set([...describedBy,panel.id])].join(' '));
    }
    const label=(english?'Not found in filtered results':'Filtrelenmiş sonuçlarda bulunamayan')+' ('+missing.length+'):';
    const signature=JSON.stringify([label,missing]);
    if(!panel.hidden&&panel.dataset.signature===signature)return;
    panel.dataset.signature=signature;
    const heading=root.document.createElement('strong');heading.textContent=label;
    const chips=missing.map(value=>{
      const chip=root.document.createElement('span');chip.className='tableSearchMissingTerm';
      chip.textContent=value;return chip;
    });
    panel.replaceChildren(heading,...chips);panel.hidden=false;
    root.BLMotionPlus?.play('card',panel);
  }

  return {findMissing,render};
});
