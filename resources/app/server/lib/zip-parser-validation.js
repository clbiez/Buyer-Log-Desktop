'use strict';
const zlib=require('node:zlib'),Policy=require('../../public/file-parser-policy');
function verify(input,limits=Policy.LIMITS){
 const info=Policy.inspectBytes(input,limits),buffer=Buffer.from(input.buffer||input,input.byteOffset||0,input.byteLength);
 for(const member of info.members||[]){
  if(member.method!==8)continue;
  try{const output=zlib.inflateRawSync(buffer.subarray(member.dataStart,member.dataStart+member.compressed),{maxOutputLength:member.expanded+1});if(output.length!==member.expanded)throw Policy.fail('FILE_PARSE_ZIP');}
  catch(_){throw Policy.fail('FILE_PARSE_ZIP');}
 }
 return info;
}
module.exports={verify};
