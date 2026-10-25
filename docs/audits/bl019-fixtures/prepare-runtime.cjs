'use strict';
// Copies runtime files only. The original application/resources/data are never started or changed.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const executable=process.argv[2];if(!executable)throw Error('Pass the existing installed Electron executable path.');
const source=path.resolve(executable),directory=path.dirname(source),target=fs.mkdtempSync(path.join(os.tmpdir(),'buyerlog-isolated-runtime-'));
for(const entry of fs.readdirSync(directory,{withFileTypes:true})){
 if(entry.isFile()&&(entry.name===path.basename(source)||/\.(dll|pak|bin|dat)$/.test(entry.name)||['version','LICENSE','LICENSES.chromium.html','vk_swiftshader_icd.json'].includes(entry.name)))fs.copyFileSync(path.join(directory,entry.name),path.join(target,entry.name));
 if(entry.isDirectory()&&entry.name==='locales')fs.cpSync(path.join(directory,entry.name),path.join(target,entry.name),{recursive:true});
}
const app=path.join(target,'resources/app');fs.mkdirSync(app,{recursive:true});fs.writeFileSync(path.join(app,'package.json'),JSON.stringify({name:'buyerlog-isolated-acceptance',version:'1.0.0',main:'index.js'}));fs.writeFileSync(path.join(app,'index.js'),"'use strict';require(process.env.BUYER_LOG_BENCH_MAIN);\n");
const copied=path.join(target,path.basename(source)),digest=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');if(digest(source)!==digest(copied))throw Error('Runtime copy mismatch');
console.log(JSON.stringify({executable:copied,sha256:digest(copied)},null,2));
