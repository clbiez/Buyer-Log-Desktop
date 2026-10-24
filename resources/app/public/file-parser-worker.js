'use strict';
const revision=self.location.search;
importScripts('file-parser-policy.js'+revision,'vendor/xlsx-reader.min.js'+revision,'excel-date-utils.js'+revision);
BLExcelDates.installSheetJsHooks(XLSX);
self.onmessage=async event=>{try{
 const {buffer,options={}}=event.data,info=BLFileParserPolicy.inspectBytes(buffer),bytes=new Uint8Array(buffer);
 // Stream-count actual DEFLATE output before SheetJS can allocate from an
 // untrusted local header. Metadata equality alone does not bound expansion.
 for(const member of info.members||[]){if(member.method!==8)continue;const reader=new Blob([bytes.subarray(member.dataStart,member.dataStart+member.compressed)]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();let total=0;try{while(true){const {done,value}=await reader.read();if(done)break;total+=value.byteLength;if(total>member.expanded)throw BLFileParserPolicy.fail('FILE_PARSE_ZIP');}if(total!==member.expanded)throw BLFileParserPolicy.fail('FILE_PARSE_ZIP');}finally{await reader.cancel().catch(()=>{});}}
 const requested=Number(options.sheetRows),sheetRows=requested>0?Math.min(requested,BLFileParserPolicy.LIMITS.rows+1):BLFileParserPolicy.LIMITS.rows+1;
 const workbook=XLSX.read(buffer,{...options,type:'array',sheetRows,bookVBA:false,cellHTML:false});BLFileParserPolicy.inspectWorkbook(workbook);
 self.postMessage({ok:true,workbook});
}catch(error){self.postMessage({ok:false,error:{code:error.code,message:error.message}});}};
