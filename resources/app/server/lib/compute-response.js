'use strict';
const {Readable}=require('node:stream'),zlib=require('node:zlib'),accepts=require('accepts');
function sendComputedResponse(req,res,lease,{contentType='application/json; charset=utf-8',filename,gzip=true,headers={}}={}){
  let released=false;
  const release=()=>{if(released)return;released=true;lease.release();};
  try{
    lease.assertResponse?.();
    const buffer=Buffer.isBuffer(lease.value.buffer)?lease.value.buffer:Buffer.from(lease.value.buffer);
    res.statusCode=200;res.setHeader('Content-Type',contentType);
    if(filename)res.setHeader('Content-Disposition',`attachment; filename="${filename}"`);
    for(const [key,value] of Object.entries(headers))res.setHeader(key,String(value));
    res.once('finish',release);res.once('close',release);
    if(!gzip){res.setHeader('Content-Length',String(buffer.length));return res.end(buffer);}
    res.setHeader('Vary','Accept-Encoding');
    if(accepts(req).encodings(['gzip','identity'])==='gzip'){
      res.setHeader('Content-Encoding','gzip');res.setHeader('Content-Length',String(buffer.length));return res.end(buffer);
    }
    // Identity istemcilerde 70 MB JSON'u ana thread'de açıp ayrıştırma.
    // Native gunzip akışı, HTTP backpressure ile sınırlı parçalar üretir.
    if(Number.isSafeInteger(lease.value.uncompressedBytes))res.setHeader('Content-Length',String(lease.value.uncompressedBytes));
    const input=Readable.from([buffer]),inflate=zlib.createGunzip();
    const stop=()=>{input.destroy();inflate.destroy();release();};res.once('close',stop);
    input.once('error',error=>res.destroy(error));inflate.once('error',error=>res.destroy(error));
    return input.pipe(inflate).pipe(res);
  }catch(error){release();throw error;}
}
module.exports={sendComputedResponse};
