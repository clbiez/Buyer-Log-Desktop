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
      // Geçersiz kısayol "bulunamadı" değil; findInvalid ayrıca nedeniyle gösterir.
      if(criteria.some(term=>term.invalid))continue;
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

  /* Tanınan alan adıyla yazılmış ama değeri geçersiz kısayollar (MB=M13). */
  function findInvalid(query){
    const periods=root.BLTableSearchPeriods;
    const source=String(query||'').trim();
    if(!periods||!source||source[0]==='(')return [];
    const seen=new Set(),out=[];
    source.split(/;\s+|,\s+/).forEach(part=>{
      const text=part.trim().replace(/^[!/]/,'').replace(/!$/,'').trim();
      const parsed=periods.parse(text);
      if(parsed&&parsed.invalid&&!seen.has(text)){seen.add(text);out.push({label:text,parsed});}
    });
    return out;
  }

  const lastMissingByInput=new Map();
  function lastMissing(inputId){return lastMissingByInput.get(inputId)||[];}

  function render(inputId,rows,haystackOf,english){
    const input=root.document?.getElementById(inputId);
    if(!input)return;
    let panel=root.document.getElementById(inputId+'Feedback');
    const hide=()=>{
      lastMissingByInput.set(inputId,[]);root.BLTableSearchChips?.markMissing(inputId,[]);
      if(panel){panel.hidden=true;panel.replaceChildren();}
    };
    if(!input.value.trim())return hide();
    const missing=findMissing(input.value,rows,haystackOf,root.BLTableSearch);
    const invalid=findInvalid(input.value);
    lastMissingByInput.set(inputId,missing);
    root.BLTableSearchChips?.markMissing(inputId,missing);
    if(!missing.length&&!invalid.length)return hide();
    if(!panel){
      panel=root.document.createElement('div');panel.id=inputId+'Feedback';
      panel.className='tableSearchFeedback';panel.setAttribute('role','status');
      panel.setAttribute('aria-live','polite');panel.setAttribute('aria-atomic','true');
      input.closest('.tableActionToolbar').insertAdjacentElement('afterend',panel);
      const describedBy=(input.getAttribute('aria-describedby')||'').split(/\s+/).filter(Boolean);
      input.setAttribute('aria-describedby',[...new Set([...describedBy,panel.id])].join(' '));
    }
    const label=(english?'Not found in filtered results':'Filtrelenmiş sonuçlarda bulunamayan')+' ('+missing.length+'):';
    const invalidLabel=(english?'Invalid shortcut':'Geçersiz kısayol')+' ('+invalid.length+'):';
    const reasons=invalid.map(item=>root.BLTableSearchPeriods.invalidReason(item.parsed,english));
    const signature=JSON.stringify([label,missing,invalidLabel,invalid.map(item=>item.label),reasons]);
    if(!panel.hidden&&panel.dataset.signature===signature)return;
    panel.dataset.signature=signature;
    const nodes=[];
    const section=(text,values,className,titles)=>{
      const heading=root.document.createElement('strong');heading.textContent=text;nodes.push(heading);
      values.forEach((value,index)=>{
        const chip=root.document.createElement('span');chip.className=className;
        chip.textContent=value;if(titles&&titles[index])chip.title=titles[index];nodes.push(chip);
      });
    };
    if(invalid.length){
      section(invalidLabel,invalid.map((item,index)=>item.label+' — '+reasons[index]),'tableSearchMissingTerm tableSearchInvalidTerm');
    }
    if(missing.length)section(label,missing,'tableSearchMissingTerm');
    panel.replaceChildren(...nodes);panel.hidden=false;
    root.BLMotionPlus?.play('card',panel);
  }

  return {findMissing,findInvalid,lastMissing,render};
});
