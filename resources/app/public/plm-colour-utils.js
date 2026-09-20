'use strict';

(function attachPlmColourUtils(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.BLPlmColourUtils=api;
})(typeof window!=='undefined'?window:globalThis,function createPlmColourUtils(){
  function colourFromCell(cell){
    const style=cell&&cell.s||{};
    const fill=style.fgColor||style.fill?.fgColor||{};
    let raw=String(fill.rgb||fill.argb||'').replace(/^#/,'').toUpperCase();
    if(raw.length===8)raw=raw.slice(2);
    if(!/^[0-9A-F]{6}$/.test(raw)||raw==='FFFFFF')return '';
    return '#'+raw;
  }

  function extractColourVariants({cells=[],colourCode='',colour=''}={}){
    const swatches=[];
    (Array.isArray(cells)?cells:[]).forEach(cell=>{
      const hex=colourFromCell(cell);
      if(hex&&!swatches.includes(hex))swatches.push(hex);
    });
    if(swatches.length)return swatches.map(hex=>({colourCode:String(colourCode||hex),colour:String(colour||hex)}));
    return [{colourCode:String(colourCode||''),colour:String(colour||'')}];
  }

  function directColourValue(value){
    if(!value||typeof value!=='object')return null;
    const colourCode=String(value.colourCode??value.colorCode??value.code??value.colour_code??'').trim();
    const colour=String(value.colour??value.color??value.name??value.colorName??value.colourName??'').trim();
    const hex=String(value.hexCode??value.hex??value.rgb??'').trim();
    if(!colourCode&&!colour&&!hex)return null;
    return {colourCode,colour,...(hex?{hex}:{}),...(value.id!=null?{id:value.id}:{}),...(value.pantone!=null?{pantone:value.pantone}:{})};
  }

  function expandDirectRecords(records){
    const output=[];
    (Array.isArray(records)?records:[]).forEach(record=>{
      const source=record&&typeof record==='object'?record:{};
      const rawColours=Array.isArray(source.colors)?source.colors:Array.isArray(source.colours)?source.colours:[];
      const colours=rawColours.map(directColourValue).filter(Boolean);
      if(!colours.length){output.push(source);return;}
      colours.forEach(item=>output.push({...source,colourCode:item.colourCode,colour:item.colour}));
    });
    return output;
  }

  return Object.freeze({colourFromCell,extractColourVariants,expandDirectRecords});
});
