(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.BLTableRange=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const SIZES=Object.freeze([50,100,200,'all']);
  const normalizeSize=value=>value==='all'?'all':([50,100,200].includes(Number(value))?Number(value):50);
  // One filtered array per live table. No copy of the source dataset or disk snapshot.
  function create(initialSize=50){
    let size=normalizeSize(initialSize),page=0,rows=[];
    function pages(){return size==='all'?1:Math.max(1,Math.ceil(rows.length/size));}
    return {
      update(next){
        const list=Array.isArray(next)?next:[];
        if(rows.length!==list.length||rows.some((row,index)=>row!==list[index]))page=0;
        rows=list;page=Math.min(page,pages()-1);return this.snapshot();
      },
      setSize(value){size=normalizeSize(value);page=0;return this.snapshot();},
      go(value){page=Math.max(0,Math.min(pages()-1,Math.floor(Number(value)||0)));return this.snapshot();},
      snapshot(){
        const start=size==='all'?0:page*size,end=size==='all'?rows.length:Math.min(rows.length,start+size);
        return {size,page,pages:pages(),total:rows.length,start,end,rows:size==='all'?rows:rows.slice(start,end)};
      },
    };
  }
  return {SIZES,normalizeSize,create};
});
