/* Template bytes stay intact except for the selected sheet's data cells,
   dimension/filter ranges, and date styles. No workbook reconstruction. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.BLExcelTemplateEngine=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const escapeXml=v=>String(v==null?'':v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
  const attr=(xml,key)=>{const m=new RegExp('(?:^|\\s)'+key+'=["\']([^"\']*)["\']').exec(xml);return m?m[1]:'';};
  function columnName(n){let s='';while(n){n--;s=String.fromCharCode(65+n%26)+s;n=Math.floor(n/26);}return s;}
  function columnNumber(name){return [...name].reduce((n,c)=>n*26+c.charCodeAt(0)-64,0);}
  function validate(config){
    if(!config||!config.sheetName||!Number.isInteger(config.headerRow)||!Number.isInteger(config.dataRow)||config.headerRow<1||config.dataRow<=config.headerRow||config.dataRow>10000||!Array.isArray(config.columns)||!config.columns.length||config.columns.length>200)throw new Error('INVALID_TEMPLATE');
    const seen=new Set();config.columns.forEach(c=>{if(!Number.isInteger(c.column)||c.column<1||c.column>200||seen.has(c.column)||typeof c.field!=='string')throw new Error('INVALID_TEMPLATE');seen.add(c.column);});
    if(!config.columns.some(c=>c.field))throw new Error('EMPTY_MAPPING');
    return config;
  }
  async function fill(bytes,config,records,JSZip,dates){
    validate(config);if(!records.length)throw new Error('EMPTY_EXPORT');
    const zip=await JSZip.loadAsync(bytes),read=async name=>{const file=zip.file(name);if(!file)throw new Error('INVALID_XLSX');return file.async('string');};
    const workbook=await read('xl/workbook.xml'),rels=await read('xl/_rels/workbook.xml.rels');
    const date1904=/\bdate1904=["'](?:1|true)["']/.test(workbook);
    const sheet=(workbook.match(/<sheet\b[^>]*\/?\s*>/g)||[]).find(s=>attr(s,'name')===escapeXml(config.sheetName));
    if(!sheet)throw new Error('SHEET_NOT_FOUND');
    const rel=(rels.match(/<Relationship\b[^>]*\/?\s*>/g)||[]).find(s=>attr(s,'Id')===attr(sheet,'r:id'));
    const target=rel&&attr(rel,'Target');if(!target||target.includes('..'))throw new Error('INVALID_XLSX');
    const sheetPath=target.startsWith('/')?target.slice(1):'xl/'+target.replace(/^\.\//,'');
    let xml=await read(sheetPath),styles=await read('xl/styles.xml');
    const sheetData=/<sheetData\b[^>]*>([\s\S]*?)<\/sheetData>/,part=sheetData.exec(xml);if(!part)throw new Error('INVALID_XLSX');
    const rows=part[1].match(/<row\b[^>]*?(?:\/>|>[\s\S]*?<\/row>)/g)||[];
    // Templates contain a title/header followed by a data area through the end
    // of the sheet. All example data is cleared, including unmapped columns.
    const sample=rows.find(r=>Number(attr(r,'r'))===config.dataRow)||'<row r="'+config.dataRow+'"></row>';
    const sampleCells=sample.match(/<c\b[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g)||[],cellStyles=new Map();
    sampleCells.forEach(c=>{const ref=attr(c,'r').match(/^([A-Z]+)/);if(ref)cellStyles.set(columnNumber(ref[1]),attr(c,'s')||'0');});
    const dateStyles=new Map();
    function dateStyle(id){
      if(dateStyles.has(id))return dateStyles.get(id);
      const block=/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(styles);if(!block)throw new Error('INVALID_XLSX');
      const xfs=block[1].match(/<xf\b[^>]*?(?:\/>|>[\s\S]*?<\/xf>)/g)||[];
      let xf=xfs[Number(id)]||xfs[0];
      const formatId=Number(attr(xf,'numFmtId'));
      const custom=(styles.match(/<numFmt\b[^>]*\/>/g)||[]).find(f=>Number(attr(f,'numFmtId'))===formatId);
      if(formatId>=14&&formatId<=22||custom&&/[dmy]/i.test(attr(custom,'formatCode').replace(/&quot;[^]*?&quot;/g,''))){dateStyles.set(id,id);return id;}
      xf=xf.replace(/\snumFmtId="[^"]*"/,'').replace(/\sapplyNumberFormat="[^"]*"/,'').replace('<xf','<xf numFmtId="14" applyNumberFormat="1"');
      const next=String(xfs.length);styles=styles.replace(block[0],'<cellXfs count="'+(xfs.length+1)+'">'+block[1]+xf+'</cellXfs>');dateStyles.set(id,next);return next;
    }
    const keep=rows.filter(r=>Number(attr(r,'r'))<config.dataRow);
    const maxOriginal=Math.max(config.dataRow,...rows.map(r=>Number(attr(r,'r'))));
    const end=Math.max(maxOriginal,config.dataRow+records.length-1),maxCol=Math.max(...config.columns.map(c=>c.column),...cellStyles.keys());
    for(let rowNo=config.dataRow;rowNo<=end;rowNo++){
      const record=records[rowNo-config.dataRow],cells=[];
      for(let col=1;col<=maxCol;col++){
        const mapping=config.columns.find(c=>c.column===col),value=record&&mapping&&mapping.field?record[mapping.field]:null;
        let style=cellStyles.get(col)||'0',type='',body='';
        if(value instanceof Date&&!isNaN(value)){
          style=dateStyle(style);body='<v>'+(dates.excelSerial(value)-(date1904?1462:0))+'</v>';
        }else if(typeof value==='number'&&Number.isFinite(value))body='<v>'+value+'</v>';
        else if(value!=null&&value!==''){type=' t="inlineStr"';body='<is><t xml:space="preserve">'+escapeXml(value)+'</t></is>';}
        cells.push('<c r="'+columnName(col)+rowNo+'" s="'+style+'"'+type+'>'+body+'</c>');
      }
      let opening=(sample.match(/^<row\b[^>]*>/)||['<row>'])[0].replace(/\s(?:r|spans)="[^"]*"/g,'').replace(/\/>$/, '>');
      opening=opening.replace('<row','<row r="'+rowNo+'"');keep.push(opening+cells.join('')+'</row>');
    }
    xml=xml.replace(sheetData,'<sheetData>'+keep.join('')+'</sheetData>');
    xml=xml.replace(/<dimension\b[^>]*\/>/,'<dimension ref="A1:'+columnName(maxCol)+end+'"/>');
    xml=xml.replace(/<autoFilter\b([^>]*)ref="[^"]*"/,'<autoFilter$1ref="A'+config.headerRow+':'+columnName(maxCol)+(config.dataRow+records.length-1)+'"');
    zip.file(sheetPath,xml);zip.file('xl/styles.xml',styles);
    return zip.generateAsync({type:'uint8array',compression:'DEFLATE'});
  }
  return {escapeXml,columnName,columnNumber,validate,fill};
});
