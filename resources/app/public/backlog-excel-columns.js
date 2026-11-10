/* Backlog export identity, dependency and formula adapter. No source data is renamed. */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory();
  else root.BLBacklogColumns=factory();
})(typeof window!=='undefined'?window:globalThis,function(){
  'use strict';
  const display=(item,settings)=>String(settings[item.id]?.label||item.display||item.header||item.id);
  function dependencies(selected,columns,settings,E){
    const catalog=new Map(columns.map(c=>[c.id,c])),out=[],done=new Set(),active=new Set();
    function visit(id){
      if(active.has(id))throw new Error('Formula dependency cycle: '+id);
      if(done.has(id))return;
      if(!catalog.has(id))throw new Error('Missing formula source: '+id);
      active.add(id);done.add(id);out.push(id);
      const config=settings[id],formula=config?.formula;
      if(config?.excelFormula)for(const match of config.excelFormula.matchAll(/\{col:([^}]+)\}/g)){if(!match[1].startsWith('helper:'))visit(match[1]);}
      if(formula){const p=E.compile(formula);if(!p.ok)throw new Error(p.error.message);p.columns.forEach(visit);}
      active.delete(id);
    }
    selected.forEach(visit);
    return out;
  }
  // Compile the shared, deterministic CP language into live Excel expressions.
  // DAYS in Buyer Log takes start/end (the reverse of Excel DAYS).
  function excelFormula(formula,E,reference){
    const program=E.compile(formula);if(!program.ok)throw new Error(program.error.message);
    const str=v=>'"'+String(v).replace(/"/g,'""')+'"';
    function emit(n){
      if(n.kind==='column'){const ref=reference(n.name);if(!ref)throw new Error('Missing formula source: '+n.name);return ref;}
      if(n.kind==='number')return String(n.value);
      if(n.kind==='string')return str(n.value);
      if(n.kind==='boolean')return n.value?'TRUE':'FALSE';
      if(n.kind==='unary'){const a=emit(n.argument);return 'IF('+a+'="","",(-'+a+'))';}
      if(n.kind==='binary'){
        const a=emit(n.left),b=emit(n.right),op=n.op;
        if(['&&','AND','||','OR'].includes(op))return (op==='&&'||op==='AND'?'AND':'OR')+'('+a+','+b+')';
        if(['+','-','*','/','%','^'].includes(op)){const expr=op==='%'?'('+a+'-TRUNC('+a+'/'+b+')*'+b+')':'('+a+op+b+')';return 'IF(OR('+a+'="",'+b+'=""),"",'+expr+')';}
        return '('+a+({'==':'=','!=':'<>'}[op]||op)+b+')';
      }
      const a=n.args.map(emit),fn=n.name,call=(name,args=a)=>name+'('+args.join(',')+')';
      if(fn==='DAYS'||fn==='DATEDIF'&&a.length===2)return 'IF(OR('+a[0]+'="",'+a[1]+'=""),"",('+a[1]+'-'+a[0]+'))';
      if(fn==='ADDDAYS')return 'IF('+a[0]+'="","",('+a[0]+'+'+a[1]+'))';
      if(fn==='WEEKNUM')return call('WEEKNUM',[a[0],'21']);
      if(fn==='CEIL')return '(-INT(-'+a[0]+'))';
      if(fn==='FLOOR')return call('INT');
      if(fn==='ROUND'){const f='10^'+(a[1]||'0');return '(INT('+a[0]+'*'+f+'+0.5)/'+f+')';}
      if(fn==='MOD')return '('+a[0]+'-TRUNC('+a[0]+'/'+a[1]+')*'+a[1]+')';
      if(fn==='DATEDIF'){const start='MIN('+a[0]+','+a[1]+')',end='MAX('+a[0]+','+a[1]+')',unit=a[2]||'"d"';return 'IF('+unit+'="d",('+a[1]+'-'+a[0]+'),SIGN('+a[1]+'-'+a[0]+')*DATEDIF('+start+','+end+','+unit+'))';}
      if(fn==='AVG')return call('AVERAGE');
      if(fn==='NUMBER')return 'IFERROR(VALUE('+a[0]+'),"")';
      if(fn==='TEXT')return '('+a[0]+'&"")';
      if(fn==='FIND')return 'IFERROR(SEARCH('+a.join(',')+'),0)';
      if(fn==='CONTAINS')return 'ISNUMBER(SEARCH('+a[1]+','+a[0]+'))';
      if(fn==='CONCAT')return '('+a.join('&')+')';
      if(fn==='COALESCE')return a.reduceRight((rest,v)=>'IF('+v+'="",'+rest+','+v+')','""');
      if(fn==='ISBLANK')return '('+a[0]+'="")';
      if(fn==='IFERROR')return 'IFERROR(IF('+a[0]+'="",'+a[1]+','+a[0]+'),'+a[1]+')';
      if(fn==='IFS')return a.reduceRight((rest,v,i)=>i%2?rest:'IF('+v+','+a[i+1]+','+rest+')','""');
      if(fn==='BIRLESTIR')return call('TEXTJOIN');
      if(['ROUND','ROUNDUP','ROUNDDOWN'].includes(fn)&&a.length===1)return call(fn,[a[0],'0']);
      if(fn==='IF'&&a.length===2)return call(fn,[...a,'""']);
      return call(fn);
    }
    return emit(program.ast);
  }
  // Preserve column identity in native Excel formulas as well. String literals and
  // references to the settings sheet must not be rewritten as BACKLOG columns.
  function nativeParts(text,transform){return String(text).split(/("(?:[^"]|"")*")/g).map((part,i)=>i%2?part:transform(part)).join('');}
  function validateNative(text,E){
    const raw=String(text).trim();
    if(!raw||/[\[\]\r\n]/.test(raw))return false;
    const syntax=nativeParts(raw,part=>part.replace(/(?:'Ayarlar'|Ayarlar)!\$?[A-Z]{1,3}\$?\d+/g,'1').replace(/\$?[A-Z]{1,3}\$?(?:\{row\}|\d+)/g,'1'));
    return E.compile(syntax).ok;
  }
  function nativeRowTemplate(text){return nativeParts(text,part=>part.replace(/(?<![\w!$])(\$?[A-Z]{1,3})2(?!\d)/g,'$1{row}'));}
  function nativeStore(text,ids){
    return nativeParts(text,part=>part.replace(/(?<![\w!$])\$?([A-Z]{1,3})(\$?)(\{row\}|\d+)(?!\w)/g,(whole,letters,absolute,row)=>{
      let index=0;for(const c of letters)index=index*26+c.charCodeAt(0)-64;
      const id=ids[index-1];if(!id)throw new Error('Missing formula source: '+letters);
      return '{col:'+id+'}'+absolute+(row==='2'&&!absolute?'{row}':row);
    }));
  }
  function nativeExcel(text,reference,row){
    return nativeParts(text,part=>part.replace(/\{col:([^}]+)\}/g,(_,id)=>{
      const ref=reference(id);if(!ref)throw new Error('Missing formula source: '+id);return ref;
    }).replace(/\{row\}/g,String(row)));
  }
  function editorIndex(columns){
    const index={byKey:new Map(),base:new Map(),calculated:new Map(),model:new Map(),checklist:new Map()};
    const key=s=>String(s).trim().toLocaleLowerCase('tr-TR');
    columns.forEach(c=>{index.byKey.set(c.ref,{key:c.ref,name:c.label,kind:'base'});index.base.set(key(c.label),c.ref);index.base.set(key(c.ref),c.ref);});
    return index;
  }
  return {display,dependencies,excelFormula,nativeStore,nativeExcel,nativeRowTemplate,validateNative,editorIndex};
});
