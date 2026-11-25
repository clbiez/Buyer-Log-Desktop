'use strict';
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const root=require('node:child_process').execFileSync('git',['rev-parse','--show-toplevel'],{cwd:__dirname,encoding:'utf8'}).trim();
const results=[];
for(const [label,{sqlite}] of [['R2',require('./r2-loader.cjs')],['R3',require(path.join(root,'scripts/prototypes/sqlite-decision-20261109/sqlite-compat.cjs'))]])for(const size of [20,2000]){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'incr-dml-')),s=sqlite(path.join(dir,'test.sqlite'));s.initialize();s.queuePatches(Array.from({length:size},(_,i)=>({id:`r:${i}`,eventId:`e:${i}`,patch:{value:i}})));
 s.db.exec('CREATE TEMP TABLE audit(tab TEXT,op TEXT,id TEXT)');for(const [tab,key] of [['records','id'],['events','event_id'],['meta','key']])for(const op of ['INSERT','DELETE','UPDATE'])s.db.exec(`CREATE TEMP TRIGGER audit_${tab}_${op} AFTER ${op} ON ${tab} BEGIN INSERT INTO audit VALUES('${tab}','${op}',${op==='DELETE'?'old':'new'}.${key}); END`);
 s.queuePatch({id:'r:0',eventId:'patch',patch:{value:999}});const rows=s.db.prepare('SELECT tab,op,count(*) n FROM audit GROUP BY tab,op').all();results.push({label,size,rows,total:rows.reduce((n,r)=>n+r.n,0),unrelated:s.db.prepare("SELECT count(*) n FROM audit WHERE (tab='records' AND id!='r:0') OR (tab='events' AND id!='patch')").get().n,pragma:Object.fromEntries(['journal_mode','synchronous','busy_timeout','cache_size','wal_autocheckpoint'].map(k=>[k,Object.values(s.db.prepare(`PRAGMA ${k}`).get())[0]]))});s.close();fs.rmSync(dir,{recursive:true});
}
console.log(JSON.stringify(results,null,2));
