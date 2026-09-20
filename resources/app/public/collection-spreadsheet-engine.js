(function(global){
  'use strict';
  function columnLetter(index){
    let n=Number(index)+1;if(!Number.isFinite(n)||n<1)return '';
    let out='';while(n>0){n--;out=String.fromCharCode(65+(n%26))+out;n=Math.floor(n/26);}return out;
  }
  function parseClipboardMatrix(text){
    const normalized=String(text==null?'':text).replace(/\r\n?/g,'\n');
    const rows=normalized.split('\n');if(rows.length>1&&rows[rows.length-1]==='')rows.pop();
    return rows.map(row=>row.split('\t'));
  }
  function normalizeSingleCellPasteText(text){
    const value=String(text==null?'':text);
    if(!/\r|\n/.test(value))return value;
    return value.replace(/\r\n|\r|\n/g,' ').replace(/ {2,}/g,' ').trim();
  }
  function rangeBounds(a,b){
    if(!a||!b)return null;
    return {r1:Math.min(a.r,b.r),r2:Math.max(a.r,b.r),c1:Math.min(a.c,b.c),c2:Math.max(a.c,b.c)};
  }
  function cellsInRange(bounds){
    const out=[];if(!bounds)return out;
    for(let r=bounds.r1;r<=bounds.r2;r++)for(let c=bounds.c1;c<=bounds.c2;c++)out.push({r,c});
    return out;
  }
  function expandPasteMatrix(matrix,bounds){
    const source=Array.isArray(matrix)?matrix:[];
    if(!source.length||!bounds)return source;
    const height=Math.max(0,Number(bounds.r2)-Number(bounds.r1)+1),width=Math.max(0,Number(bounds.c2)-Number(bounds.c1)+1);
    const sourceHeight=source.length,sourceWidth=source.reduce((max,row)=>Math.max(max,Array.isArray(row)?row.length:0),0);
    if(height<1||width<1||sourceHeight<1||sourceWidth<1)return source;
    // A single value fills the complete selection. For a copied Excel range,
    // repeat the TSV pattern over the selected rectangle so a 1xN row applies
    // to every selected row and an MxN block behaves like Excel fill-paste.
    if(height===1&&width===1)return source;
    if(sourceHeight>height||sourceWidth>width)return source;
    return Array.from({length:height},(_,r)=>Array.from({length:width},(_,c)=>{
      const row=source[r%sourceHeight];
      return Array.isArray(row)?(row[c%sourceWidth]??''):'';
    }));
  }
  function planPasteGeometry(matrix,bounds){
    const source=Array.isArray(matrix)?matrix:[];
    const sourceRows=source.length,sourceColumns=source.reduce((max,row)=>Math.max(max,Array.isArray(row)?row.length:0),0);
    const selectionRows=bounds?Math.max(0,Number(bounds.r2)-Number(bounds.r1)+1):0;
    const selectionColumns=bounds?Math.max(0,Number(bounds.c2)-Number(bounds.c1)+1):0;
    const clipboard={rows:sourceRows,columns:sourceColumns},selection={rows:selectionRows,columns:selectionColumns};
    if(!sourceRows||!sourceColumns||!selectionRows||!selectionColumns)return {ok:false,mode:'empty',clipboard,selection,matrix:[]};
    if(selectionRows===1&&selectionColumns===1)return {ok:true,mode:'anchor',clipboard,selection,matrix:source};
    if(sourceRows===1&&sourceColumns===1)return {ok:true,mode:'fill',clipboard,selection,matrix:expandPasteMatrix(source,bounds)};
    if(sourceRows===selectionRows&&sourceColumns===selectionColumns)return {ok:true,mode:'exact',clipboard,selection,matrix:source};
    if(selectionRows%sourceRows===0&&selectionColumns%sourceColumns===0)return {ok:true,mode:'tile',clipboard,selection,matrix:expandPasteMatrix(source,bounds)};
    return {ok:false,mode:'mismatch',clipboard,selection,matrix:[]};
  }
  function tsv(matrix){return (matrix||[]).map(row=>(row||[]).map(v=>String(v==null?'':v).replace(/\t/g,' ').replace(/\r?\n/g,' ')).join('\t')).join('\n');}
  function selectionStats(values,parseNumber){
    const flat=(values||[]).flat().filter(v=>v!=null&&String(v)!=='');
    const nums=flat.map(v=>parseNumber?parseNumber(v):Number(v)).filter(Number.isFinite);
    const sum=nums.reduce((a,b)=>a+b,0);
    return {count:flat.length,numericCount:nums.length,sum,average:nums.length?sum/nums.length:null};
  }
  function pasteSummary(plan){const geometry=plan&&plan.geometry||{};return {kind:'paste',mode:geometry.mode||'',changed:Array.isArray(plan&&plan.ops)?plan.ops.length:0,readonly:Number(plan&&plan.readonly)||0,invalid:Number(plan&&plan.invalid)||0,skipped:Number(plan&&plan.skipped)||0,source:{...(geometry.clipboard||{rows:0,columns:0})},target:{...(geometry.selection||{rows:0,columns:0})}};}
  global.BLCollectionSpreadsheetEngine={columnLetter,parseClipboardMatrix,normalizeSingleCellPasteText,rangeBounds,cellsInRange,expandPasteMatrix,planPasteGeometry,pasteSummary,tsv,selectionStats};
  if(typeof module!=='undefined'&&module.exports)module.exports={columnLetter,parseClipboardMatrix,normalizeSingleCellPasteText,rangeBounds,cellsInRange,expandPasteMatrix,planPasteGeometry,pasteSummary,tsv,selectionStats};
})(typeof window!=='undefined'?window:globalThis);
