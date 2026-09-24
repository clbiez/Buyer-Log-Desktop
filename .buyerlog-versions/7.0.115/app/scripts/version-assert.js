'use strict';
const fs=require('fs');
const path=require('path');
const { APP_ROOT,readPackage,readJson,parseSemver }=require('./release-common');
const { APP_VERSION,DISPLAY_VERSION }=require('../server/lib/app-version');
function main(){const pkg=readPackage(),index=fs.readFileSync(path.join(APP_ROOT,'public','index.html'),'utf8');if(APP_VERSION!==pkg.version)throw new Error(`server APP_VERSION ${APP_VERSION} != package ${pkg.version}`);if(!parseSemver(pkg.version))throw new Error('Canonical version SemVer değil.');if(!index.includes('__BL_CANONICAL_VERSION__')||!index.includes('__BL_DISPLAY_VERSION__'))throw new Error('UI runtime version placeholders eksik.');console.log(JSON.stringify({canonical:pkg.version,display:DISPLAY_VERSION,ui:'runtime-derived'},null,2));}
if(require.main===module){try{main();}catch(e){console.error(e.message);process.exitCode=1;}}
module.exports={main};
