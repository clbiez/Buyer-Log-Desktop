'use strict';
const crypto=require('node:crypto');
const pin='1d659d8750a465c42c27c0062c7930082283ef4bdebc1249a36d49a348dae2bb';
function patch(source){
 if(crypto.createHash('sha256').update(source).digest('hex')!==pin)throw Error('SCHEMA_SOURCE_PAGE_SETUP: frozen source drift');
 const old='    const input=captureOrdersReadyInputs(),s={...input.settings};';
 const next=old+'\n    if(s.lifecycle){s.lifecycle={...s.lifecycle};delete s.lifecycle.page;}';
 if(source.split(old).length!==2)throw Error('SCHEMA_SOURCE_PAGE_SETUP: nonunique published-source anchor');
 const result=source.replace(old,next);if(result.replace(next,old)!==source)throw Error('SCHEMA_SOURCE_PAGE_SETUP: exact reversal');
 return result;
}
module.exports={pin,patch};
