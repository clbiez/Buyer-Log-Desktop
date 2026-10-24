'use strict';
const path=require('node:path');
const F=require('./files'),S=require('./signature');

// The integrity manifest itself is installed inside protected electron/ code.
// Every application byte is checked before main.js or the backend is required.
function verifyPackagedCore(core,version){
 const m=F.readJsonStrict(F.regularFile(core,'electron/app-integrity.json'));
 if(m?.schemaVersion!==1||m.version!==version||!m.files||typeof m.files!=='object'||Array.isArray(m.files)||m.fileCount!==Object.keys(m.files).length||m.fileCount<4)S.fail('UPDATE_CORE_INTEGRITY','Kurulum bütünlük kaydı geçersiz.','The installation integrity record is invalid.');
 const actual=F.inventory(core,{exclude:rel=>rel==='electron/app-integrity.json'||rel===F.RECEIPT});
 if(actual.length!==m.fileCount)S.fail('UPDATE_CORE_INTEGRITY','Kurulum dosya listesi değişmiş; imzalı tam paketi yeniden kurun.','Installation file inventory changed; reinstall the signed full package.');
 for(const file of actual)if(m.files[file.path]!==file.sha256)S.fail('UPDATE_CORE_INTEGRITY','Kurulum dosyaları değişmiş; imzalı tam paketi yeniden kurun.','Installation files changed; reinstall the signed full package.');
 return {verified:true,fileCount:actual.length,core:path.resolve(core)};
}
module.exports={verifyPackagedCore};
