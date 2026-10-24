'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bl-owned-temp-tests-'));
const userDataPath = path.join(__dirname, '../server/user-data.js');
test.after(() => fs.rmSync(root, { recursive: true, force: true }));
function run(name, body, { explicitTemp = false, localOverride = true, beforeLoad = '' } = {}) {
  const fixture = path.join(root, name), systemTemp = path.join(fixture, 'system-temp');
  fs.mkdirSync(systemTemp, { recursive: true });
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith('BUYER_LOG_')) delete env[key];
  Object.assign(env, { TMPDIR: systemTemp, TMP: systemTemp, TEMP: systemTemp,
    BUYER_LOG_SERVER_DATA_ROOT: path.join(systemTemp, 'fixture-server'),
    BUYER_LOG_DATA_ROOT: path.join(fixture, 'app'), BUYER_LOG_CONFIG_PATH: path.join(fixture, 'config.json'),
    APPDATA: path.join(fixture, 'profile'), LOCALAPPDATA: path.join(fixture, 'profile'),
  });
  if (localOverride) env.BUYER_LOG_LOCAL_DATA_ROOT = path.join(fixture, 'local');
  if (explicitTemp) { env.BUYER_LOG_TEMP_ROOT = path.join(fixture, 'portable-temp'); fs.mkdirSync(env.BUYER_LOG_TEMP_ROOT, { recursive: true }); }
  const prelude = `const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
    const systemTemp=os.tmpdir();
    ${beforeLoad}
    const data=require(${JSON.stringify(userDataPath)});
    fs.mkdirSync(data.SERVER_DATA_ROOT,{recursive:true});fs.mkdirSync(data.APP_DATA_ROOT,{recursive:true});
    fs.writeFileSync(path.join(data.SERVER_DATA_ROOT,'synthetic-orders.json'),JSON.stringify({fixture:'owned'}));
    fs.writeFileSync(data.CONFIG_PATH,JSON.stringify({host:'127.0.0.1',port:6297}));`;
  const result = spawnSync(process.execPath, ['-e', prelude + '\n(async()=>{' + body + '})().catch(e=>{console.error(e);process.exitCode=1;});'], { env, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

test('default inventory and both backup formats do not traverse foreign system temp; cleanup stays owned', () => {
  run('foreign', `
    assert.notEqual(data.TEMP_ROOT,systemTemp);
    assert.equal(path.dirname(data.TEMP_ROOT),systemTemp);
    const foreign=path.join(systemTemp,'unrelated-private');fs.mkdirSync(foreign);fs.writeFileSync(path.join(foreign,'sentinel'),'keep');
    let foreignReads=0;const original=fs.readdirSync;
    fs.readdirSync=function(dir,...args){if(path.resolve(dir)===foreign){foreignReads++;throw Object.assign(new Error('unrelated denied'),{code:'EACCES'});}return original.call(this,dir,...args);};
    const inventory=data.getUserDataInventory();assert.equal(foreignReads,0);
    assert.equal(inventory.roots.find(r=>r.id==='temp').root,data.TEMP_ROOT);
    const legacy=data.parseBackup(data.exportBackup());assert.ok(legacy.files.some(f=>f.path==='synthetic-orders.json'));
    const streamed=await data.exportBackupToFile();assert.ok(streamed.path.startsWith(data.TEMP_ROOT+path.sep));
    const temporaryFolder=path.dirname(streamed.path);assert.ok(fs.existsSync(streamed.path));streamed.cleanup();
    assert.equal(fs.existsSync(temporaryFolder),false);assert.equal(fs.readFileSync(path.join(foreign,'sentinel'),'utf8'),'keep');
    assert.equal(foreignReads,0);
  `);
});
test('unavailable excluded diagnostics return explicit warnings without breaking real backup members', () => {
  run('diagnostic', `
    for(const dir of [data.LOGS_ROOT,data.TEMP_ROOT,data.EMAIL_DRAFT_ROOT])fs.mkdirSync(dir,{recursive:true});
    const denied=new Set([data.LOGS_ROOT,data.TEMP_ROOT,data.EMAIL_DRAFT_ROOT].map(x=>path.resolve(x))),original=fs.readdirSync;
    fs.readdirSync=function(dir,...args){if(denied.has(path.resolve(dir)))throw Object.assign(new Error('diagnostic denied'),{code:'EACCES'});return original.call(this,dir,...args);};
    const inventory=data.getUserDataInventory();assert.equal(inventory.warnings.length,3);
    for(const id of ['logs','temp','emailDraftTemp']){const entry=inventory.roots.find(r=>r.id===id);assert.equal(entry.available,false);assert.equal(entry.fileCount,null);assert.equal(entry.bytes,null);assert.equal(entry.backupIncluded,false);}
    assert.ok(inventory.warnings.every(w=>w.code==='DIAGNOSTIC_INVENTORY_UNAVAILABLE'&&w.errorCode==='EACCES'&&w.message.tr&&w.message.en));
    const legacy=data.parseBackup(data.exportBackup());assert.ok(legacy.files.some(f=>f.path==='synthetic-orders.json'));assert.equal(legacy.inventory.warnings.length,3);
    const streamed=await data.exportBackupToFile();assert.ok(fs.existsSync(streamed.path));streamed.cleanup();
  `);
});
test('owned diagnostic file-disappearance races are tolerated without inventing warnings or totals', () => {
  run('disappeared', `
    fs.mkdirSync(data.TEMP_ROOT,{recursive:true});const missing=path.join(data.TEMP_ROOT,'disappearing.json');fs.writeFileSync(missing,'{}');
    const original=fs.statSync;fs.statSync=function(file,...args){if(path.resolve(file)===missing)throw Object.assign(new Error('gone'),{code:'ENOENT'});return original.call(this,file,...args);};
    const inventory=data.getUserDataInventory(),entry=inventory.roots.find(r=>r.id==='temp');
    assert.equal(entry.available,true);assert.equal(entry.fileCount,0);assert.equal(inventory.warnings.length,0);
  `);
});
test('authoritative scope read failures remain strict for inventory and both backup formats', () => {
  run('authority', `
    const original=fs.readdirSync;fs.readdirSync=function(dir,...args){if(path.resolve(dir)===path.resolve(data.SERVER_DATA_ROOT))throw Object.assign(new Error('authority denied'),{code:'EACCES'});return original.call(this,dir,...args);};
    assert.throws(()=>data.getUserDataInventory(),{code:'EACCES'});assert.throws(()=>data.exportBackup(),{code:'EACCES'});await assert.rejects(data.exportBackupToFile(),{code:'EACCES'});
  `);
});
test('unreadable authoritative config is not silently replaced by an empty object in backups', () => {
  run('config', `
    const original=fs.readFileSync;fs.readFileSync=function(file,...args){if(path.resolve(file)===path.resolve(data.CONFIG_PATH))throw Object.assign(new Error('config denied'),{code:'EACCES'});return original.call(this,file,...args);};
    assert.throws(()=>data.exportBackup(),{code:'EACCES'});await assert.rejects(data.exportBackupToFile(),{code:'EACCES'});
  `);
});
test('explicit portable temp root and existing draft location stay compatible', () => {
  run('portable', `
    assert.equal(data.TEMP_ROOT,process.env.BUYER_LOG_TEMP_ROOT);assert.equal(data.EMAIL_DRAFT_ROOT,path.join(process.env.BUYER_LOG_TEMP_ROOT,'BuyerLog-email-drafts'));
    const streamed=await data.exportBackupToFile();assert.ok(streamed.path.startsWith(data.TEMP_ROOT+path.sep));streamed.cleanup();
  `, { explicitTemp: true });
});
test('temporary server recovery and existing temporary atomic-write allowance remain isolated', () => {
  run('recovery', `
    data.atomicWriteJson(path.join(data.SERVER_DATA_ROOT,'probe.json'),{ok:true});
    assert.ok(fs.existsSync(path.join(data.SERVER_DATA_ROOT,'.buyerlog-write-recovery')));
    assert.equal(fs.existsSync(path.join(process.env.LOCALAPPDATA,'BuyerLog','write-recovery')),false);
    const toolTarget=path.join(systemTemp,'synthetic-tool','probe.json');data.atomicWriteJson(toolTarget,{ok:true});assert.equal(JSON.parse(fs.readFileSync(toolTarget,'utf8')).ok,true);
  `, { localOverride: false });
});

test('a default root link cannot redirect startup inventory or backup output into foreign files', () => {
  const modulePath = JSON.stringify(userDataPath);
  run('root-link-before', `assert.equal(fs.readFileSync(path.join(systemTemp,'foreign','sentinel'),'utf8'),'keep');`, {
    beforeLoad: `const foreign=path.join(systemTemp,'foreign');fs.mkdirSync(foreign);fs.writeFileSync(path.join(foreign,'sentinel'),'keep');
      const linked=path.join(systemTemp,'BuyerLog'+(typeof process.getuid==='function'?'-'+process.getuid():''));
      fs.symlinkSync(foreign,linked,'junction');
      assert.throws(()=>require(${modulePath}),{code:'UNSAFE_TEMP_ROOT'});
      assert.deepEqual(fs.readdirSync(foreign),['sentinel']);fs.unlinkSync(linked);`,
  });
  run('root-link-after', `
    const foreign=path.join(systemTemp,'foreign');fs.mkdirSync(foreign);fs.writeFileSync(path.join(foreign,'sentinel'),'keep');
    fs.rmdirSync(data.TEMP_ROOT);fs.symlinkSync(foreign,data.TEMP_ROOT,'junction');
    const inventory=data.getUserDataInventory();assert.equal(inventory.roots.find(r=>r.id==='temp').available,false);
    assert.ok(inventory.warnings.some(w=>w.errorCode==='UNSAFE_TEMP_ROOT'));
    await assert.rejects(data.exportBackupToFile(),{code:'UNSAFE_TEMP_ROOT'});
    assert.deepEqual(fs.readdirSync(foreign),['sentinel']);assert.equal(fs.readFileSync(path.join(foreign,'sentinel'),'utf8'),'keep');
  `);
});
test('corrupt authoritative config fails both backup formats without altering business data', () => {
  run('corrupt-config', `
    fs.writeFileSync(data.CONFIG_PATH,'{broken');
    assert.throws(()=>data.exportBackup(),SyntaxError);await assert.rejects(data.exportBackupToFile(),SyntaxError);
    assert.equal(JSON.parse(fs.readFileSync(path.join(data.SERVER_DATA_ROOT,'synthetic-orders.json'),'utf8')).fixture,'owned');
  `);
});
test('an intentional portable root link keeps configured semantics and cleans only its generated folder', () => {
  run('portable-link', `
    assert.equal(data.TEMP_ROOT,process.env.BUYER_LOG_TEMP_ROOT);
    const streamed=await data.exportBackupToFile();const temporaryFolder=path.dirname(streamed.path);streamed.cleanup();
    assert.equal(fs.existsSync(temporaryFolder),false);assert.equal(fs.readFileSync(path.join(systemTemp,'configured-target','sentinel'),'utf8'),'keep');
  `, { explicitTemp: true, beforeLoad: `
    const configured=path.join(systemTemp,'configured-target');fs.mkdirSync(configured);fs.writeFileSync(path.join(configured,'sentinel'),'keep');
    fs.rmdirSync(process.env.BUYER_LOG_TEMP_ROOT);fs.symlinkSync(configured,process.env.BUYER_LOG_TEMP_ROOT,'junction');
  ` });
});
test('current ZIP full backup preserves missing-config fallback but rejects unreadable or corrupt config', () => {
  run('zip-config', `
    const fsp=require('node:fs/promises'),{createBackupService}=require(${JSON.stringify(path.join(__dirname, '../server/lib/backup-service'))});
    const service=createBackupService({appVersion:'test',userAccess:{backupSnapshot:()=>({users:[],roles:[]})},syncSettings:{read:async()=>({})}});
    const input={mode:'full',user:{id:'synthetic',systemRole:'moderator'}};
    const original=fsp.readFile;
    fsp.readFile=async function(file,...args){if(path.resolve(file)===path.resolve(data.CONFIG_PATH))throw Object.assign(new Error('config denied'),{code:'EACCES'});return original.call(this,file,...args);};
    await assert.rejects(service.create(input),{code:'EACCES'});fsp.readFile=original;
    fs.writeFileSync(data.CONFIG_PATH,'{broken');await assert.rejects(service.create(input),SyntaxError);
    fs.unlinkSync(data.CONFIG_PATH);const absent=await service.create(input);assert.ok(absent.size>0);await absent.cleanup();
  `);
});
