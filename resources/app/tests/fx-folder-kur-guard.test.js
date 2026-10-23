'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'fx-folder-guard-'));
for(const [key,dir] of Object.entries({BUYER_LOG_DATA_ROOT:'app',BUYER_LOG_SERVER_DATA_ROOT:'server',BUYER_LOG_LOCAL_DATA_ROOT:'local',BUYER_LOG_TEMP_ROOT:'temp'}))process.env[key]=path.join(root,dir);
process.env.BUYER_LOG_CONFIG_PATH=path.join(root,'config.json');
const db=require('../server/db'),fx=require('../server/lib/fxWorkbook'),XLSX=require('xlsx');
test.after(()=>fs.rmSync(root,{recursive:true,force:true}));
const candidate={found:true,updated:true,fingerprint:'new',reportMonth:'2026-10',modifiedAt:'2026-10-01T00:00:00Z',data:{months:{'2026-10':{TRY:40,EUR:.9,GBP:.8}},currencies:['TRY','EUR','GBP']}};
test('folder decision covers parse failure, identity, older, current newer and apply',()=>{
 for(const [current,input,reason] of [
 [{},null,'parse-failed'],[{}, {...candidate,updated:false,reason:'parse-failed'},'parse-failed'],
 [{sourceFingerprint:'new'},candidate,'unchanged'],[{reportMonth:'2026-11'},candidate,'older-report'],
 [{reportMonth:'2026-10',sourceType:'UPLOAD',updatedAt:'2026-11-01'},candidate,'current-newer'],
 [{sourceType:'LCWAI',updatedAt:'2026-11-01'},candidate,'current-newer']])assert.deepEqual(fx.decideFolderKurApply(current,input),{apply:false,reason});
 assert.deepEqual(fx.decideFolderKurApply({},candidate),{apply:true});
 assert.deepEqual(fx.decideFolderKurApply({reportMonth:'2026-09',sourceType:'UPLOAD',updatedAt:'2026-12-01'},candidate),{apply:true});
});
function syncHarness(onRead){
 const source=fs.readFileSync(path.join(__dirname,'../server/server.js'),'utf8');
 const block=source.slice(source.indexOf('async function syncFxFromKurWorkbook('),source.indexOf('// Date nesneleri JSON.stringify',source.indexOf('async function syncFxFromKurWorkbook(')));
 const context={require:require('node:module').createRequire(path.join(__dirname,'../server/server.js')),__dirname:path.join(__dirname,'../server'),path,sourceUserId:()=> 'moderator',sourceFolderForUser:()=>root,loadFx:db.loadFx,saveFx:db.saveFx,
  runExcelTask:async()=>onRead?onRead():({ ...fx.readFxWorkbook(path.join(root,'KUR.xlsx')),found:true,updated:true,file:'KUR.xlsx',modifiedAt:new Date(fs.statSync(path.join(root,'KUR.xlsx')).mtimeMs).toISOString(),fingerprint:fx.readFxWorkbook(path.join(root,'KUR.xlsx')).data.sourceFingerprint,reportMonth:'2026-10'}),
  publishSharedMasterChange(){},logRuntimeFailure(){},console,folderFxSyncStatus:null};
 vm.createContext(context);vm.runInContext(block,context);return context;
}
test('startup and force preserve a newer uploaded report and expose older-report',async()=>{
 const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([[null,null,'2026-10'],[null,'TRY',40],[null,'EUR',.9],[null,'GBP',.8]]),'Demo');XLSX.writeFile(wb,path.join(root,'KUR.xlsx'));
 const saved=db.saveFx({reportMonth:'2026-11',sourceType:'UPLOAD',months:{'2026-11':{TRY:50}}},db.loadFx()._revision);
 const h=syncHarness();for(const force of [false,true]){const result=await h.syncFxFromKurWorkbook('moderator',force);assert.equal(result.reason,'older-report');assert.deepEqual(db.loadFx().months,saved.months);assert.equal(h.folderFxSyncStatus.reason,'older-report');}
});
test('folder merge keeps uncovered cells and saves report provenance',async()=>{
 db.saveFx({months:{'2026-09':{TRY:39},'2026-10':{CHF:.8}}},db.loadFx()._revision);
 const h=syncHarness(()=>candidate);const out=await h.syncFxFromKurWorkbook('moderator');assert.equal(out.updated,true);const stored=db.loadFx();assert.equal(stored.months['2026-09'].TRY,39);assert.equal(stored.months['2026-10'].CHF,.8);assert.equal(stored.months['2026-10'].TRY,40);assert.equal(stored.sourceFingerprint,'new');assert.equal(stored.reportMonth,'2026-10');
});
test('intervening upload is re-read after conflict and cannot be overwritten',async()=>{
 db.saveFx({reportMonth:'2026-09',months:{}},db.loadFx()._revision);
 const h=syncHarness(()=>{db.saveFx({reportMonth:'2026-11',sourceType:'UPLOAD',months:{'2026-11':{TRY:55}}},db.loadFx()._revision);return candidate;});
 const out=await h.syncFxFromKurWorkbook('moderator');assert.equal(out.reason,'older-report');assert.equal(db.loadFx().months['2026-11'].TRY,55);
});
test('explicit source endpoint enforces permission, fingerprint and revision',async()=>{
 const express=require('express'),app=express(),h=syncHarness();app.use(express.json());
 const allow=(_req,_res,next)=>next();
 require('../server/routes/costing-fx-shipping-routes')(app,{loadFx:db.loadFx,saveFx:db.saveFx,syncFxFromKurWorkbook:h.syncFxFromKurWorkbook,getFolderFxSyncStatus:()=>h.folderFxSyncStatus,
  userAccess:{requireArea:()=>allow,requireAnyArea:()=>allow,requirePermission:()=> (req,res,next)=>req.headers['x-demo-deny']?res.sendStatus(403):next(),appendAudit(){}},requestRevision:req=>req.body.expectedRevision,
  publishSharedMasterChange(){},apiError:(res,err)=>res.status(err.statusCode||409).json({code:err.code})});
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 try{
  const base=`http://127.0.0.1:${server.address().port}`,fingerprint=fx.readFxWorkbook(path.join(root,'KUR.xlsx')).data.sourceFingerprint;
  const post=(body,headers={})=>fetch(base+'/api/fx/apply-source-kur',{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
  const revision=db.loadFx()._revision;
  assert.equal((await post({fingerprint,expectedRevision:revision},{'x-demo-deny':'1'})).status,403);
  assert.equal((await post({fingerprint:'0'.repeat(64),expectedRevision:revision})).status,409);
  assert.equal((await post({fingerprint,expectedRevision:revision-1})).status,409);
  const response=await post({fingerprint,expectedRevision:revision});assert.equal(response.status,200);assert.equal((await response.json()).updated,true);
  assert.equal(db.loadFx().reportMonth,'2026-10');assert.equal(db.loadFx().months['2026-11'].TRY,55);
 }finally{await new Promise(r=>server.close(r));}
});
