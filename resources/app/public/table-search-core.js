/* Shared table-search grammar. No dates or display tokens are embedded in text. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.BLTableSearchCore=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  function fold(value){
    const text=String(value??'').trim();
    // ASCII has no marks; this is equivalent to the full Turkish fold below.
    if(/^[\x00-\x7f]*$/.test(text))return text.toLowerCase();
    return text.toLocaleUpperCase('tr-TR').replace(/[İŞÇÖÜĞ]/g,ch=>({İ:'I',Ş:'S',Ç:'C',Ö:'O',Ü:'U',Ğ:'G'})[ch])
      .toLowerCase().normalize('NFKD').replace(/\p{M}/gu,'');
  }
  function labeled(item,label){
    if(item)Object.defineProperty(item,'label',{value:label.trim(),enumerable:false});
    return item;
  }
  function criterion(part){
    const raw=String(part??'').trim();if(!raw)return null;
    // Period-like assignments are validated, never silently treated as text.
    if(/^[!/]?[a-z]+\s*=/i.test(raw)){
      const m=/^(EX|RE|MB)=([WM])(\d{1,2})(?:-\2(\d{1,2}))?$/i.exec(raw);
      if(m){
        const from=Number(m[3]),to=Number(m[4]??m[3]),max=m[2].toUpperCase()==='W'?53:12;
        if(from>=1&&from<=max&&to>=1&&to<=max)return labeled({mode:'period',field:m[1].toLowerCase(),unit:m[2].toUpperCase(),from,to},raw);
      }
      return labeled({mode:'invalid',value:fold(raw)},raw);
    }
    const marker=raw[0],suffix=marker!=='!'&&marker!=='/'&&raw.length>1&&raw.endsWith('!');
    const mode=marker==='!'||suffix?'notContains':marker==='/'?'contains':'exact';
    const text=marker==='!'||marker==='/'?raw.slice(1).trim():suffix?raw.slice(0,-1).trim():raw;
    return text?labeled({mode,value:fold(text)},raw):null;
  }
  function split(source,separators){
    const out=[];let current='';
    for(let i=0;i<source.length;i++){
      const ch=source[i];
      // Preserve escapes until the leaf is decoded (a second split follows).
      if(ch==='\\'&&i+1<source.length){current+=ch+source[++i];continue;}
      if(separators.includes(ch)&&(i+1===source.length||/\s/.test(source[i+1]))){out.push(current);current='';}
      else current+=ch;
    }
    out.push(current);return out;
  }
  const decode=text=>text.replace(/\\([\\;(),])/g,'$1');
  function plain(source){
    const groups=[];
    for(const group of split(source,';')){
      const terms=split(group,',').flatMap(part=>part.split(/(?<=[^\s!]!)\s+/)).map(part=>criterion(decode(part))).filter(Boolean);
      const positive=terms.filter(term=>term.mode!=='notContains');
      if(positive.length)groups.push(positive);
      terms.filter(term=>term.mode==='notContains').forEach(term=>groups.push([term]));
    }
    return groups.length===1?groups[0]:groups;
  }
  function parseRowGroups(value){
    const source=String(value??'').trim();if(!source.startsWith('('))return null;
    let index=0;const groups=[];
    while(index<source.length){
      while(/\s/.test(source[index]||'')&&index<source.length)index++;
      if(source[index]!=='(')return null;
      const labelStart=index++,start=index;let end=-1,literalDepth=0;
      for(;index<source.length;index++){
        const ch=source[index];
        if(ch==='\\'){index++;continue;}
        if(ch==='('&&index>start&&!/[\s;,(]/.test(source[index-1])){literalDepth++;continue;}
        if(ch===')'&&literalDepth){literalDepth--;continue;}
        // Parentheses inside a word stay literal. Only a closing token boundary
        // can terminate a row group (BUDDY(YD) remains part of its cell).
        if(ch===')'&&(index+1===source.length||/\s/.test(source[index+1])||source[index+1]===','&&/\s/.test(source[index+2]||''))){end=index;break;}
      }
      if(end<0)return null;
      const parsed=plain(source.slice(start,end));
      const terms=Array.isArray(parsed[0])?parsed:[parsed];
      if(!parsed.length)return null;
      groups.push(labeled({mode:'rowGroup',value:'',terms:terms.flat(),groups:terms},source.slice(labelStart,end+1)));
      index=end+1;
      while(index<source.length&&/\s/.test(source[index]))index++;
      if(index===source.length)break;
      if(source[index]!==','||!(/\s/.test(source[index+1]||'')))return null;
      index++;
    }
    return groups.length?groups:null;
  }
  function parseTerms(value){
    const source=String(value??'');return parseRowGroups(source)||plain(source);
  }
  function entries(query){
    const parsed=parseTerms(query),terms=Array.isArray(parsed[0])?parsed.flat():parsed;
    return terms.map(term=>({label:term.label,terms:[term],invalid:term.mode==='invalid'||term.terms?.some(t=>t.mode==='invalid')}));
  }
  function hasPeriods(terms){
    return terms.some(t=>Array.isArray(t)?hasPeriods(t):t.mode==='period'||t.mode==='rowGroup'&&hasPeriods(t.terms));
  }
  function matches(haystack,terms,options={}){
    const parsed=Array.isArray(terms)?terms:parseTerms(terms);if(!parsed.length)return true;
    const data=haystack&&typeof haystack==='object'?haystack:null;
    const text=options.folded?(data?data.text:haystack):fold(data?data.text:haystack);
    let periods;
    const match=item=>{
      if(typeof item!=='object')item={mode:'exact',value:fold(item)};
      if(item.mode==='invalid')return false;
      if(item.mode==='rowGroup')return (item.groups||item.terms.map(t=>[t])).every(group=>group.some(match));
      if(item.mode==='period'){
        if(periods===undefined){const get=data?.periods??options.periods;periods=(typeof get==='function'?get():get)||{};}
        const value=periods[item.field]?.[item.unit.toLowerCase()];
        return Number.isFinite(value)&&(item.from<=item.to?value>=item.from&&value<=item.to:value>=item.from||value<=item.to);
      }
      const needle=fold(item.value);if(!needle)return false;
      if(item.mode==='notContains')return !text.includes(needle);
      if(item.mode==='contains'||options.plainMode==='contains')return text.includes(needle);
      let offset=text.indexOf(needle);
      while(offset!==-1){
        if(!/[a-z0-9]/.test(text[offset-1]||'')&&!/[a-z0-9]/.test(text[offset+needle.length]||''))return true;
        offset=text.indexOf(needle,offset+1);
      }
      return false;
    };
    if(parsed[0]?.mode==='rowGroup')return parsed.some(match);
    return (Array.isArray(parsed[0])?parsed:[parsed]).every(group=>group.some(match));
  }
  return {fold,criterion,parseTerms,parseRowGroups,entries,hasPeriods,matches};
});
