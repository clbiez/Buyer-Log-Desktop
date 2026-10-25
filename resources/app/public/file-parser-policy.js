(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.BLFileParserPolicy=api;})(typeof self!=='undefined'?self:globalThis,function(){
  'use strict';
  const LIMITS=Object.freeze({bytes:40*1024*1024,expandedBytes:200*1024*1024,entries:10000,sheets:64,rows:200000,columns:512,cells:10000000,timeoutMs:60000});
  // Existing inspected Endeksmatik books are up to 49 MB / 462 MB expanded.
  // This profile is used only by its serialized server-side import process.
  const ENDEKSMATIK_LIMITS=Object.freeze({...LIMITS,bytes:64*1024*1024,expandedBytes:512*1024*1024,cells:20000000});
  const T=(tr,en)=>tr+' / '+en;
  function fail(code='FILE_PARSE_LIMIT'){
    const message=code==='FILE_PARSE_TIMEOUT'?T('Dosya okuma zaman aşımına uğradı; hiçbir değişiklik uygulanmadı.','File reading timed out; no changes were applied.')
      :code==='FILE_PARSE_CANCELLED'?T('Dosya okuma iptal edildi.','File reading was cancelled.')
      :code==='FILE_PARSE_BUSY'?T('Dosya okuma kuyruğu dolu; diğer işlemler bitince yeniden deneyin.','The file reading queue is full; retry after other jobs finish.')
      :['FILE_PARSE_FAILED','FILE_PARSE_EXIT','FILE_PARSE_RESULT'].includes(code)?T('Dosya okuyucu tamamlanamadı; hiçbir değişiklik uygulanmadı.','The file reader did not complete; no changes were applied.')
      :T('Dosya güvenli okuma sınırını aşıyor veya bozuk.','The file exceeds safe parsing limits or is malformed.');
    return Object.assign(new Error(message),{code,statusCode:code==='FILE_PARSE_TIMEOUT'?504:code==='FILE_PARSE_CANCELLED'?409:code==='FILE_PARSE_BUSY'?429:413});
  }
  function bytesOf(input){if(input instanceof ArrayBuffer)return new Uint8Array(input);if(ArrayBuffer.isView(input))return new Uint8Array(input.buffer,input.byteOffset,input.byteLength);throw fail('FILE_PARSE_INPUT');}
  function inspectBytes(input,limits=LIMITS){
    const bytes=bytesOf(input);if(!bytes.length||bytes.length>limits.bytes)throw fail();
    if(bytes.length<4||bytes[0]!==0x50||bytes[1]!==0x4b)return {bytes:bytes.length,zip:false};
    const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let end=-1;
    for(let at=bytes.length-22;at>=Math.max(0,bytes.length-65557);at--)if(view.getUint32(at,true)===0x06054b50&&at+22+view.getUint16(at+20,true)===bytes.length){end=at;break;}
    if(end<0||view.getUint16(end+4,true)||view.getUint16(end+6,true))throw fail('FILE_PARSE_ZIP');
    const count=view.getUint16(end+10,true),size=view.getUint32(end+12,true),offset=view.getUint32(end+16,true);
    if(count>limits.entries||count===65535||offset+size>end||view.getUint16(end+8,true)!==count)throw fail();
    const members=[];let at=offset,total=0;
    function extraFields(start,length){const end=start+length;if(end>bytes.length)throw fail('FILE_PARSE_ZIP');while(start<end){if(start+4>end)throw fail('FILE_PARSE_ZIP');const id=view.getUint16(start,true),size=view.getUint16(start+2,true);if(id===1||start+4+size>end)throw fail('FILE_PARSE_ZIP');start+=4+size;}}
    for(let i=0;i<count;i++){
      if(at+46>offset+size||view.getUint32(at,true)!==0x02014b50)throw fail('FILE_PARSE_ZIP');
      const expanded=view.getUint32(at+24,true),compressed=view.getUint32(at+20,true),flags=view.getUint16(at+8,true),method=view.getUint16(at+10,true),crc=view.getUint32(at+16,true),nameLength=view.getUint16(at+28,true),extraLength=view.getUint16(at+30,true),local=view.getUint32(at+42,true);total+=expanded;
      if(expanded===0xffffffff||total>limits.expandedBytes)throw fail();
      if(flags&0x2041||![0,8].includes(method)||view.getUint16(at+34,true)||at+46+nameLength+extraLength>offset+size||local+30>offset||view.getUint32(local,true)!==0x04034b50)throw fail('FILE_PARSE_ZIP');
      extraFields(at+46+nameLength,extraLength);
      const localFlags=view.getUint16(local+6,true),localMethod=view.getUint16(local+8,true),localCrc=view.getUint32(local+14,true),localCompressed=view.getUint32(local+18,true),localExpanded=view.getUint32(local+22,true),localName=view.getUint16(local+26,true),localExtra=view.getUint16(local+28,true),dataStart=local+30+localName+localExtra;
      if(localFlags!==flags||localMethod!==method||localName!==nameLength||dataStart+compressed>offset)throw fail('FILE_PARSE_ZIP');
      for(let n=0;n<nameLength;n++)if(bytes[local+30+n]!==bytes[at+46+n])throw fail('FILE_PARSE_ZIP');
      extraFields(local+30+localName,localExtra);
      const descriptor=Boolean(flags&8);if(descriptor?(localCompressed!==0&&localCompressed!==compressed||localExpanded!==0&&localExpanded!==expanded||localCrc!==0&&localCrc!==crc):(localCompressed!==compressed||localExpanded!==expanded||localCrc!==crc))throw fail('FILE_PARSE_ZIP');
      let recordEnd=dataStart+compressed;
      if(descriptor){if(recordEnd+12>offset)throw fail('FILE_PARSE_ZIP');if(view.getUint32(recordEnd,true)===0x08074b50)recordEnd+=4;if(recordEnd+12>offset||view.getUint32(recordEnd,true)!==crc||view.getUint32(recordEnd+4,true)!==compressed||view.getUint32(recordEnd+8,true)!==expanded)throw fail('FILE_PARSE_ZIP');recordEnd+=12;}
      if(method===0&&compressed!==expanded)throw fail('FILE_PARSE_ZIP');
      members.push({local,end:recordEnd,dataStart,compressed,expanded,method});
      at+=46+view.getUint16(at+28,true)+view.getUint16(at+30,true)+view.getUint16(at+32,true);
      if(at>offset+size)throw fail('FILE_PARSE_ZIP');
    }
    members.sort((a,b)=>a.local-b.local);for(let i=1;i<members.length;i++)if(members[i].local<members[i-1].end)throw fail('FILE_PARSE_ZIP');
    if(at!==offset+size)throw fail('FILE_PARSE_ZIP');return {bytes:bytes.length,zip:true,entries:count,expandedBytes:total,members};
  }
  function inspectWorkbook(workbook,limits=LIMITS){
    const names=workbook?.SheetNames||[];if(names.length>limits.sheets)throw fail();let cells=0;
    for(const name of names){
      const sheet=workbook.Sheets?.[name],ref=sheet?.['!fullref']||sheet?.['!ref'];let row=0,col=0;
      const add=(r1,c1,r2,c2)=>{if(![r1,c1,r2,c2].every(Number.isSafeInteger)||r1<1||c1<1||r2<r1||c2<c1)throw fail('FILE_PARSE_RANGE');if(r2>limits.rows||c2>limits.columns)throw fail();row=Math.max(row,r2);col=Math.max(col,c2);};
      const range=value=>{
        const match=String(value).replace(/\$/g,'').match(/^(?:([A-Z]+)([1-9]\d*):)?([A-Z]+)([1-9]\d*)$/i);if(!match)throw fail('FILE_PARSE_RANGE');
        const column=text=>String(text).toUpperCase().split('').reduce((n,c)=>n*26+c.charCodeAt(0)-64,0);
        add(Number(match[2]||match[4]),column(match[1]||match[3]),Number(match[4]),column(match[3]));
      };
      if(ref)range(ref);
      const merges=sheet?.['!merges']||[];if(!Array.isArray(merges))throw fail('FILE_PARSE_RANGE');
      for(const merge of merges){if(typeof merge==='string')range(merge);else add(merge?.s?.r+1,merge?.s?.c+1,merge?.e?.r+1,merge?.e?.c+1);}
      cells+=row*col;if(cells>limits.cells)throw fail();
    }return workbook;
  }
  function inspectExcelJsModel(model,limits=LIMITS){
    if(!model||!Array.isArray(model.worksheets)||model.worksheets.length>limits.sheets)throw fail();
    let cells=0,mediaBytes=0;
    for(const sheet of model.worksheets){
      if(!Array.isArray(sheet.rows))throw fail();
      for(const row of sheet.rows){
        if(!Number.isSafeInteger(row.number)||row.number<1||row.number>limits.rows||!Array.isArray(row.cells)||row.cells.length>limits.columns)throw fail();
        for(const cell of row.cells){if(++cells>limits.cells)throw fail();if(!/^[A-Z]+[1-9]\d*$/i.test(cell?.address||''))throw fail('FILE_PARSE_RANGE');inspectWorkbook({SheetNames:['cell'],Sheets:{cell:{'!ref':cell.address}}},limits);}
      }
      for(const range of sheet.merges||[])inspectWorkbook({SheetNames:['merge'],Sheets:{merge:{'!ref':range}}},limits);
    }
    for(const media of model.media||[]){mediaBytes+=Number(media.buffer?.byteLength)||Math.ceil(String(media.base64||'').length*3/4);if(mediaBytes>limits.expandedBytes)throw fail();}
    return model;
  }
  return Object.freeze({LIMITS,ENDEKSMATIK_LIMITS,fail,inspectBytes,inspectWorkbook,inspectExcelJsModel});
});
