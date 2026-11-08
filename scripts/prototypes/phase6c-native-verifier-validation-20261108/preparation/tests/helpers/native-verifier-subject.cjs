'use strict';
// ROOT-only test loader; never imported/executed during preparation.
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
function locate(){
 if(process.env.BL_NATIVE_VERIFIER_APP_ROOT)return path.resolve(process.env.BL_NATIVE_VERIFIER_APP_ROOT);
 for(const start of [__dirname,process.cwd()]){let dir=start;for(;;){for(const root of [dir,path.join(dir,'resources/app')])if(fs.existsSync(path.join(root,'server/lib/local-db.js')))return root;const parent=path.dirname(dir);if(parent===dir)break;dir=parent;}}
 throw Object.assign(Error('Set BL_NATIVE_VERIFIER_APP_ROOT or run from the repository'),{code:'NATIVE_VERIFIER_TEST_SETUP'});
}
const appRoot=locate(),nativeFile=path.join(appRoot,'server/lib/local-db.js');
let subject;
if(process.env.BL_NATIVE_VERIFIER_SOURCE){
 const loaded=new Module(nativeFile,module);loaded.filename=nativeFile;loaded.paths=Module._nodeModulePaths(path.dirname(nativeFile));
 loaded._compile(fs.readFileSync(process.env.BL_NATIVE_VERIFIER_SOURCE,'utf8'),nativeFile);subject=loaded.exports;
}else subject=require(nativeFile);
module.exports={...subject,appRoot};
