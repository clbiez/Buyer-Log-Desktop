'use strict';

(function attachPlmLicenceUtils(root, factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.BLPlmLicenceUtils=api;
})(typeof window!=='undefined'?window:globalThis,function createPlmLicenceUtils(){
  function isLicenceDesignSource(value){
    return String(value==null?'':value).replace(/\s+/g,' ').trim().toLocaleUpperCase('en-US')==='LICENCE';
  }
  return Object.freeze({isLicenceDesignSource});
});
