'use strict';
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib'),crypto=require('node:crypto');
const root=process.argv[2],m=JSON.parse(fs.readFileSync(path.join(root,'local/page-cache/moderator/manifest.json'),'utf8')),out={generation:m.activeGeneration,sourceRevision:m.sourceRevisionKey,modules:{}};
for(const name of ['cp','orders','overview']){
 const value=JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(root,'local/page-cache/moderator',m.activeGeneration,name+'.json.gz'))));
 out.modules[name]={rows:value.rows.length,orderedRowsSha256:crypto.createHash('sha256').update(JSON.stringify(value.rows)).digest('hex')};
}
console.log(JSON.stringify(out));
