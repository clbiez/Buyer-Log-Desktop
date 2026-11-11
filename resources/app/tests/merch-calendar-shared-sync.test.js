'use strict';
/* Merch Calendar ekip çapında tek iş takvimidir: Moderatörün yüklediği takvim
   Master checkpoint ile diğer Buyer Log kullanıcılarına ulaşmalıdır.
   Regresyon: takvim yalnız yerel dosyada duruyor, hiçbir senkron kanalına
   girmiyordu; Moderatörde görünen takvim ekipte hiç görünmüyordu. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bl-merch-shared-'));
test.after(() => fs.rmSync(tmp, { recursive:true, force:true }));

function envFor(name) {
  const base = path.join(tmp, name);
  return {
    ...process.env,
    BUYER_LOG_SERVER_DATA_ROOT: path.join(base, 'server-data'),
    BUYER_LOG_DATA_ROOT: path.join(base, 'app-data'),
    BUYER_LOG_LOCAL_DATA_ROOT: path.join(base, 'local-data'),
    BUYER_LOG_CONFIG_PATH: path.join(base, 'config.json'),
  };
}
/* Her cihaz ayrı süreçte koşar: store dosya yolu modül yüklenirken sabitlenir. */
function runDevice(name, script, input = null) {
  const out = execFileSync(process.execPath, ['-e', `
    const ROOT=${JSON.stringify(ROOT)};
    const path=require('path');
    const store=require(path.join(ROOT,'server/lib/merch-calendar-store'));
    const policy=require(path.join(ROOT,'server/lib/shared-sync-policy'));
    const {createDeltaStore}=require(path.join(ROOT,'server/lib/delta-store'));
    const {createLocalDb}=require(path.join(ROOT,'server/lib/local-db'));
    const fixture=require(path.join(ROOT,'tests/helpers/merch-calendar-fixture'));
    const input=JSON.parse(process.argv[1]||'null');
    (async()=>{
      const localDb=createLocalDb(path.join(process.env.BUYER_LOG_LOCAL_DATA_ROOT,'Local.db'));
      const delta=createDeltaStore({localDb,mode:'delta'});
      await delta.hydrate();
      store.attachDeltaStore(delta);
      const result=await (async()=>{${script}})();
      process.stdout.write(JSON.stringify(result));
    })().catch(error=>{console.error(error);process.exit(1);});
  `, JSON.stringify(input)], { env:envFor(name), encoding:'utf8' });
  return JSON.parse(out);
}

test('Merch Calendar kaydı Moderatör Master checkpoint kapsamındadır', () => {
  const policy = require('../server/lib/shared-sync-policy');
  assert.equal(policy.classifyRecordId('merch-calendar:current'), 'GLOBAL_MASTER');
  // Eşler arası kanal kural/master verisini taşımaz; yalnız Moderatör yayımlar.
  assert.equal(policy.peerChannelAllows('merch-calendar:current'), false);
});

test('Moderatörün yüklediği takvim yayımlanır, diğer kullanıcıda dosyaya uygulanır ve silme de ulaşır', () => {
  // 1) Moderatör cihazı: takvim kaydedilir → ortak kayda aynalanır → Master kayıtlarına girer.
  const published = runDevice('moderator', `
    const value={...fixture.build(),schemaVersion:1,uploadedAt:'2026-11-01T00:00:00.000Z',meta:{weekCount:104}};
    const receipt=store.restoreSnapshotWithReceipt(value,{});
    const mirrored=await receipt.shared;
    await delta.flush();
    const state=await localDb.read();
    return {mirrored:mirrored.ok,records:policy.masterRecordsFromState(state)};
  `);
  assert.equal(published.mirrored, true);
  const record = published.records['merch-calendar:current'];
  assert.ok(record, 'Master checkpoint kaydı Merch Calendar içermeli');
  assert.equal(record.calendar.weeks.length, 104);
  assert.equal(record.calendar._revision, undefined, 'yerel revizyon sayacı taşınmaz');

  // 2) Takvimi olmayan ekip üyesi: checkpoint kaydı yerel kayda gelir → dosyaya uygulanır.
  const received = runDevice('teammate', `
    const before=store.publicProjection().configured;
    await localDb.queuePatches([{id:'merch-calendar:current',entityType:'merch-calendar',patch:input}]);
    await delta.hydrate();
    const applied=store.syncFromShared();
    const again=store.syncFromShared();
    const after=store.publicProjection();
    return {before,applied,again,configured:after.configured,weeks:after.calendar&&after.calendar.weeks.length,sourceName:after.summary&&after.summary.sourceName};
  `, record);
  assert.equal(received.before, false);
  assert.equal(received.applied.applied, true);
  assert.equal(received.again.applied, false, 'aynı içerik yeniden yazılmaz');
  assert.equal(received.configured, true);
  assert.equal(received.weeks, 104);
  assert.equal(received.sourceName, 'test-fixture.xlsx');

  // 3) Moderatör takvimi kaldırırsa kaldırma da taşınır.
  const removed = runDevice('moderator', `
    const receipt=store.removeWithReceipt({});
    await receipt.shared; await delta.flush();
    return policy.masterRecordsFromState(await localDb.read())['merch-calendar:current'];
  `);
  assert.equal(removed.calendar, null);
  const cleared = runDevice('teammate', `
    await localDb.queuePatches([{id:'merch-calendar:current',entityType:'merch-calendar',patch:input}]);
    await delta.hydrate();
    const applied=store.syncFromShared();
    return {applied,configured:store.publicProjection().configured};
  `, removed);
  assert.equal(cleared.applied.removed, true);
  assert.equal(cleared.configured, false);
});

test('Geçersiz ortak kayıt yerel takvimi bozmaz; ortak kopyadan uygulama geri aynalanmaz', () => {
  const result = runDevice('guarded', `
    store.restoreSnapshotWithReceipt({...fixture.build(),schemaVersion:1},{});
    await delta.flush();
    await localDb.queuePatches([{id:'merch-calendar:current',entityType:'merch-calendar',patch:{calendar:{schemaVersion:1,weeks:[{year:2026,week:99}]}}}]);
    await delta.hydrate();
    const applied=store.syncFromShared();
    const fromShared=store.restoreSnapshotWithReceipt({...fixture.build(),schemaVersion:1,sourceName:'x.xlsx'},{fromShared:true});
    return {applied,configured:store.publicProjection().configured,skipped:(await fromShared.shared).skipped};
  `);
  assert.equal(result.applied.applied, false);
  assert.equal(result.applied.reason, 'invalid');
  assert.equal(result.configured, true);
  assert.equal(result.skipped, true);
});

test('Eski yüklenmiş takvim yeniden yükleme gerekmeden ortak kayda tohumlanır', () => {
  const result = runDevice('legacy', `
    store.attachDeltaStore(null);
    store.restoreSnapshotWithReceipt({...fixture.build(),schemaVersion:1},{});
    store.attachDeltaStore(delta);
    const first=await store.seedMissing(delta);
    const second=await store.seedMissing(delta);
    return {first:first.seeded,second:second.seeded,record:Boolean(policy.masterRecordsFromState(await localDb.read())['merch-calendar:current'])};
  `);
  assert.equal(result.first, 1);
  assert.equal(result.second, 0);
  assert.equal(result.record, true);
});

test('Sunucu ve istemci Moderatör takvim yayımını bağlar', () => {
  const SERVER = require('./helpers/server-source')();
  const APP = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');
  assert.match(SERVER, /publishSharedMasterChange\('merchCalendar', req\)/);
  assert.match(SERVER, /id === 'merch-calendar:current'\) changed\.add\('merchCalendar'\)/);
  assert.match(SERVER, /merchCalendarStore\.attachDeltaStore\(deltaStore\)/);
  assert.match(SERVER, /merchCalendar\.seedMissing\(deltaStore\)/);
  assert.match(APP, /area==='merchCalendar'[\s\S]{0,300}BLMerchCalendarRuntime\?\.reload/);
});
