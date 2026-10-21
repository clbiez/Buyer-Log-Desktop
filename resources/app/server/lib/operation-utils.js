'use strict';
const crypto=require('node:crypto');
const hash=value=>crypto.createHash('sha256').update(String(value)).digest('hex');
function error(code,status=400){return Object.assign(new Error(code),{code,statusCode:status});}
module.exports={hash,error};
