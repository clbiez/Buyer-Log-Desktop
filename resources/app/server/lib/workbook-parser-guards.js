'use strict';
const Policy=require('../../public/file-parser-policy');
function install(XLSX,{limits=Policy.LIMITS}={}){
 if(XLSX.__buyerLogParserGuards)return XLSX;
 const read=XLSX.read.bind(XLSX);
 XLSX.read=(input,options={})=>{
  const bytes=typeof input==='string'?Buffer.from(input,options.type==='base64'?'base64':'binary'):input;require('./zip-parser-validation').verify(bytes,limits);
  const sheetRows=options.sheetRows>0?Math.min(options.sheetRows,limits.rows+1):limits.rows+1;
  return Policy.inspectWorkbook(read(input,{...options,sheetRows,bookVBA:false,cellHTML:false}),limits);
 };
 XLSX.readFile=(file,options={})=>{const fs=require('node:fs'),stat=fs.statSync(file);if(stat.size>limits.bytes)throw Policy.fail();return XLSX.read(fs.readFileSync(file),{...options,type:'buffer'});};
 Object.defineProperty(XLSX,'__buyerLogParserGuards',{value:true});return XLSX;
}
module.exports={install};
