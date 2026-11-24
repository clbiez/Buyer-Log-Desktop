'use strict';

/* v8.0.15 — PLM görsel alımında indeks görsel başına değil, parti başına yazılır.
 *
 * Saha profili (8.0.14): her görsel için index.json tam parse + pretty-print
 * yazma + fsync + iki rename + tam geri okuma/SHA-256, hepsi ana iş
 * parçacığında. 4.708 indirme 2.000 sn, 3 indirmelik sessiz parti 11,7 sn
 * olay döngüsünü kilitledi.
 *
 * Sözleşme:
 *  - N görsellik toplu commit indeksi sınırlı sayıda (burada 1) yazar.
 *  - İndeks içeriği eski (görsel başına senkron) yolla aynıdır.
 *  - Eşzamanlı okuyucu dosyası diskte olmayan bir kayıt görmez.
 *  - Çökmede indeks bozulmaz; flush'tan önce yazılmış dosyalar yetim kalır,
 *    bağlantı almaz ve sonraki süreçte güvenle temizlenir.
 *  - İndeks kalıcılaşamazsa bu turda oluşturulan dosyalar geri alınır. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const APP = path.join(__dirname, '..');
const USER_DATA = path.join(APP, 'server', 'user-data.js');
const INGEST = path.join(APP, 'server', 'lib', 'plm-image-ingest.js');
const OWNERSHIP = path.join(APP, 'server', 'lib', 'plm-image-ownership.js');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bl-img-index-batch-'));
test.after(() => fs.rmSync(root, { recursive: true, force: true }));

function run(name, body) {
  const fixture = path.join(root, name);
  fs.mkdirSync(fixture, { recursive: true });
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith('BUYER_LOG_')) delete env[key];
  Object.assign(env, {
    BUYER_LOG_LOCAL_DATA_ROOT: path.join(fixture, 'local'),
    BUYER_LOG_DATA_ROOT: path.join(fixture, 'app'),
    BUYER_LOG_SERVER_DATA_ROOT: path.join(fixture, 'server'),
    BUYER_LOG_CONFIG_PATH: path.join(fixture, 'config.json'),
    BUYER_LOG_TEMP_ROOT: path.join(fixture, 'tmp'),
  });
  const prelude = `const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
    const data=require(${JSON.stringify(USER_DATA)});
    const INDEX=path.join(data.COLLECTION_IMAGES_ROOT,'index.json');
    const png=n=>{const b=Buffer.alloc(96,n%251);Buffer.from('89504e470d0a1a0a','hex').copy(b);return b;};
    const indexRenames={n:0};
    const origRename=fs.renameSync,origAsyncRename=fs.promises.rename;
    fs.renameSync=function(a,b){if(path.resolve(String(b))===path.resolve(INDEX))indexRenames.n++;return origRename.apply(this,arguments);};
    fs.promises.rename=async function(a,b){if(path.resolve(String(b))===path.resolve(INDEX))indexRenames.n++;return origAsyncRename.apply(this,arguments);};
    const normalized=items=>items.map(({id,storedName,createdAt,updatedAt,...rest})=>rest).sort((a,b)=>a.rowId.localeCompare(b.rowId));
    const out=v=>process.stdout.write('@@'+JSON.stringify(v)+'\\n');`;
  const result = spawnSync(process.execPath, ['-e', `${prelude}\n(async()=>{${body}})().catch(e=>{console.error(e);process.exitCode=1;});`], { env, encoding: 'utf8', timeout: 60000 });
  const outputs = String(result.stdout || '').split('\n').filter(line => line.startsWith('@@')).map(line => JSON.parse(line.slice(2)));
  return { result, outputs, fixture };
}

test('N görsellik toplu yazma indeksi bir kez yazar ve içerik eski senkron yolla aynıdır', () => {
  const N = 40;
  const legacy = run('legacy', `
    for(let i=0;i<${N};i++) data.saveCollectionImage({rowId:'plm:k'+i,filename:'f'+i+'.png',mimeType:'image/png',base64:png(i).toString('base64')});
    out({renames:indexRenames.n,items:normalized(JSON.parse(fs.readFileSync(INDEX,'utf8')))});`);
  assert.equal(legacy.result.status, 0, legacy.result.stderr);
  const batched = run('batched', `
    const before=data.collectionImageIndexStats.diskLoads;
    const saved=[];
    for(let i=0;i<${N};i++) saved.push(await data.saveCollectionImageDeferred({rowId:'plm:k'+i,filename:'f'+i+'.png',mimeType:'image/png',buffer:png(i)}));
    assert.equal(indexRenames.n,0,'flush öncesi indeks yazılmaz');
    for(const item of saved) assert.ok(data.getCollectionImage(item.id),'kayıt flush öncesi bellekte okunur');
    await data.flushCollectionImageIndex();
    const onDisk=JSON.parse(fs.readFileSync(INDEX,'utf8'));
    for(const item of onDisk) assert.ok(fs.existsSync(path.join(data.COLLECTION_IMAGES_ROOT,item.storedName)));
    // Kendi yazmamızdan sonra indeks yeniden parse edilmez.
    for(const item of saved) assert.ok(data.getCollectionImage(item.id));
    out({renames:indexRenames.n,items:normalized(onDisk),loads:data.collectionImageIndexStats.diskLoads-before,asyncWrites:data.collectionImageIndexStats.asyncWrites,syncWrites:data.collectionImageIndexStats.syncWrites});`);
  assert.equal(batched.result.status, 0, batched.result.stderr);
  const [old] = legacy.outputs, [next] = batched.outputs;
  assert.equal(old.renames, N, 'eski yol görsel başına bir indeks yazması yapar (RED kanıtı)');
  assert.equal(next.renames, 1, 'toplu yol indeksi tek kez yazar');
  assert.equal(next.asyncWrites, 1);
  assert.equal(next.syncWrites, 0);
  assert.ok(next.loads <= 1, 'indeks en fazla bir kez diskten okunur: ' + next.loads);
  assert.deepEqual(next.items, old.items, 'indeks içeriği eski yolla aynı');
});

test('eşzamanlı okuyucu dosyası olmayan kayıt görmez; uçuştaki yazmayla çakışan elle kayıt da kalıcılaşır', () => {
  const { result, outputs } = run('concurrent', `
    let stop=false,checks=0,violations=0;
    const reader=(async()=>{while(!stop){for(const item of data.readCollectionImageIndex()){checks++;if(!fs.existsSync(path.join(data.COLLECTION_IMAGES_ROOT,item.storedName)))violations++;}await new Promise(r=>setImmediate(r));}})();
    const ids=[];let manual;
    try {
    for(let i=0;i<30;i++) ids.push((await data.saveCollectionImageDeferred({rowId:'plm:c'+i,filename:'c.png',mimeType:'image/png',buffer:png(i)})).id);
    const flushing=data.flushCollectionImageIndex();
    // Uçuştaki asenkron yazma sırasında senkron (elle) kayıt ikinci yazıcı açmaz.
    manual=data.saveCollectionImage({rowId:'manual:1',filename:'m.png',mimeType:'image/png',base64:png(99).toString('base64')});
    assert.ok(data.getCollectionImage(manual.id),'elle kayıt hemen okunur');
    await flushing; await data.flushCollectionImageIndex();
    } finally { stop=true; await reader; }
    const disk=JSON.parse(fs.readFileSync(INDEX,'utf8')).map(item=>item.id);
    out({checks,violations,manualOnDisk:disk.includes(manual.id),allOnDisk:ids.every(id=>disk.includes(id)),count:disk.length});`);
  assert.equal(result.status, 0, result.stderr);
  const [value] = outputs;
  assert.ok(value.checks > 0);
  assert.equal(value.violations, 0);
  assert.equal(value.manualOnDisk, true);
  assert.equal(value.allOnDisk, true);
  assert.equal(value.count, 31);
});

test('flush öncesi çökme: indeks bozulmaz, yetim dosyalar sonraki süreçte güvenle temizlenir', () => {
  const first = run('crash', `
    for(let i=0;i<3;i++) await data.saveCollectionImageDeferred({rowId:'plm:keep'+i,filename:'k.png',mimeType:'image/png',buffer:png(i)});
    await data.flushCollectionImageIndex();
    const lost=[];
    for(let i=0;i<4;i++) lost.push((await data.saveCollectionImageDeferred({rowId:'plm:lost'+i,filename:'l.png',mimeType:'image/png',buffer:png(10+i)})).id);
    out({lost});
    // Güç kesintisi: exit kancaları çalışmaz.
    process.kill(process.pid,'SIGKILL');`);
  // Ani sonlanma (çıkış kancaları çalışmaz). POSIX'te sinyal SIGKILL olarak görünür; Windows'ta
  // process.kill(pid,'SIGKILL') TerminateProcess ile sonlandırır: signal null, status 0 dışı (normal çıkış değil).
  if (process.platform === 'win32') { assert.equal(first.result.signal, null); assert.notEqual(first.result.status, 0); }
  else assert.equal(first.result.signal, 'SIGKILL');
  const [{ lost }] = first.outputs;
  const restarted = run('crash', `
    const items=data.readCollectionImageIndex();
    const files=data.listStoredCollectionImageFiles();
    // Bu süreç başlamadan önceki dosyalar aday: yeni yazılan dosyalar korunur.
    const fresh=await data.saveCollectionImageDeferred({rowId:'plm:fresh',filename:'f.png',mimeType:'image/png',buffer:png(50)});
    await data.flushCollectionImageIndex();
    const sweep=await data.reconcileCollectionImageOrphans({startedBeforeMs:Date.now()-1});
    const quarantineRoot=path.join(data.COLLECTION_IMAGES_ROOT,'.orphans');
    const quarantined=fs.readdirSync(quarantineRoot).flatMap(day=>fs.readdirSync(path.join(quarantineRoot,day)));
    out({indexed:items.map(i=>i.rowId).sort(),filesBefore:files.length,sweep,filesAfter:data.listStoredCollectionImageFiles().length,fresh:Boolean(data.getCollectionImage(fresh.id)),quarantined,days:fs.readdirSync(quarantineRoot)});`);
  assert.equal(restarted.result.status, 0, restarted.result.stderr);
  const [value] = restarted.outputs;
  assert.deepEqual(value.indexed, ['plm:keep0', 'plm:keep1', 'plm:keep2'], 'indeks son kalıcı sürümde, bozulmamış');
  assert.equal(value.filesBefore, 3 + lost.length, 'kalıcılaşmamış görseller yetim dosya olarak kalır');
  // fresh, startedBeforeMs'ten SONRA yazıldığı için aday değildir.
  assert.equal(value.sweep.quarantined, lost.length);
  assert.equal(value.filesAfter, 4);
  assert.equal(value.fresh, true);
  // Yetimler SİLİNMEZ: aynı adla gün klasörü altındaki karantinaya taşınır.
  assert.equal(value.days.length, 1);
  assert.match(value.days[0], /^\d{8}$/);
  assert.deepEqual(value.quarantined.sort(), lost.map(id => id + '.png').sort());
});

test('yetim taraması indeks .bak kaynaklıysa ya da bekleyen yazma varken hiçbir şey silmez', () => {
  const { result, outputs } = run('sweep-guard', `
    data.saveCollectionImage({rowId:'a',filename:'a.png',mimeType:'image/png',base64:png(1).toString('base64')});
    data.saveCollectionImage({rowId:'b',filename:'b.png',mimeType:'image/png',base64:png(2).toString('base64')});
    const orphan=path.join(data.COLLECTION_IMAGES_ROOT,'ci_1_aaaaaaaaaaaa.png');fs.writeFileSync(orphan,png(3));
    await data.saveCollectionImageDeferred({rowId:'c',filename:'c.png',mimeType:'image/png',buffer:png(4)});
    const pending=await data.reconcileCollectionImageOrphans({startedBeforeMs:Date.now()+60000});
    await data.flushCollectionImageIndex();
    fs.writeFileSync(INDEX,'{bozuk');
    const fromBak=await data.reconcileCollectionImageOrphans({startedBeforeMs:Date.now()+60000});
    out({pending,fromBak,orphanKept:fs.existsSync(orphan)});`);
  assert.equal(result.status, 0, result.stderr);
  const [value] = outputs;
  assert.equal(value.pending.skipped, 'pending');
  assert.equal(value.fromBak.skipped, 'index-not-primary');
  assert.equal(value.orphanKept, true);
});

test('kanonik alım: indeks kalıcılaşamazsa bağlantı yazılmaz ve yeni dosyalar geri alınır', async () => {
  const ingestLib = require(INGEST);
  const ownership = require(OWNERSHIP);
  const files = new Map();
  let seq = 0, patched = 0, flushes = 0;
  const ingest = ingestLib.createPlmImageIngest({
    ownership: { ...ownership, saveOwnership: () => {} },
    getImage: ref => (files.has(ref) ? { item: files.get(ref), full: ref } : null),
    saveImage: async ({ buffer, mimeType }) => { const id = 'ci_' + (++seq); files.set(id, { id, mimeType, size: buffer.length }); return { id, url: '/x/' + id, mimeType, size: buffer.length }; },
    deleteImage: async ref => files.delete(ref),
    flushImages: async () => { flushes += 1; throw Object.assign(new Error('disk full'), { code: 'ENOSPC' }); },
    patchLinks: () => { patched += 1; return { overrides: { imagemap: {} }, updated: 1 }; },
  });
  const png = n => { const b = Buffer.alloc(64, n); Buffer.from('89504e470d0a1a0a', 'hex').copy(b); return b; };
  const entries = [1, 2, 3].map(n => ({ plmId: String(1000 + n), colourCode: 'C' + n, colour: 'X', sourceType: 'OPTION', sourceIdentity: 'o:' + n, buffer: png(n), mimeType: 'image/png' }));
  await assert.rejects(ingest.commit(entries, { store: ownership.emptyStore(), imagemap: {} }), /disk full/);
  assert.equal(flushes, 1, 'tek flush bariyeri');
  assert.equal(patched, 0, 'kalıcı indeks olmadan bağlantı yazılmaz');
  assert.equal(files.size, 0, 'bu turda oluşturulan dosyalar geri alınır');
});

test('kanonik alım: N görsel commit başına tek flush, olay döngüsüne düzenli döner', async () => {
  const ingestLib = require(INGEST);
  const ownership = require(OWNERSHIP);
  const files = new Map();
  let seq = 0, flushes = 0, ticks = 0;
  const ingest = ingestLib.createPlmImageIngest({
    ownership: { ...ownership, saveOwnership: () => {} },
    getImage: ref => (files.has(ref) ? { item: files.get(ref), full: ref } : null),
    saveImage: async ({ buffer, mimeType }) => { await new Promise(resolve => setImmediate(resolve)); const id = 'ci_' + (++seq); files.set(id, { id }); return { id, url: '/x/' + id, mimeType, size: buffer.length }; },
    deleteImage: async ref => files.delete(ref),
    flushImages: async () => { flushes += 1; },
    patchLinks: links => ({ overrides: { imagemap: Object.fromEntries(links.map(link => [ingestLib.canonicalKeyFor(link), link.imageRef])) }, updated: links.length }),
  });
  const png = n => { const b = Buffer.alloc(64, n % 251); Buffer.from('89504e470d0a1a0a', 'hex').copy(b); b.writeUInt32BE(n, 60); return b; };
  const entries = Array.from({ length: 120 }, (_, n) => ({ plmId: String(5000 + n), colourCode: 'C', colour: 'X', sourceType: 'OPTION', sourceIdentity: 'o:' + n, buffer: png(n), mimeType: 'image/png' }));
  const ticker = setInterval(() => { ticks += 1; }, 0);
  let result;
  try { result = await ingest.commit(entries, { store: ownership.emptyStore(), imagemap: {} }); }
  finally { clearInterval(ticker); }
  assert.equal(result.counts.written, 120);
  assert.equal(flushes, 1);
  assert.ok(ticks > 0, 'commit olay döngüsünü kilitlemez');
});

test('yetim sayısı şüpheli eşiği aşarsa hiçbir dosya taşınmaz; karantina 30 günden eskiyse temizlenir', () => {
  const { result, outputs } = run('sweep-bound', `
    data.saveCollectionImage({rowId:'a',filename:'a.png',mimeType:'image/png',base64:png(1).toString('base64')});
    // Küçük indekste eşik 50: 51 yetim şüphelidir.
    const names=Array.from({length:51},(_,i)=>'ci_1_'+i.toString(16).padStart(12,'0')+'.png');
    for(const name of names) fs.writeFileSync(path.join(data.COLLECTION_IMAGES_ROOT,name),png(7));
    const errors=[];const origError=console.error;console.error=(...args)=>errors.push(args.join(' '));
    const over=await data.reconcileCollectionImageOrphans({startedBeforeMs:Date.now()+60000});
    console.error=origError;
    const stillThere=names.filter(name=>fs.existsSync(path.join(data.COLLECTION_IMAGES_ROOT,name))).length;
    const quarantineRoot=path.join(data.COLLECTION_IMAGES_ROOT,'.orphans');
    // Eşik altına inince taşınır; eski gün klasörü 30 gün sonra temizlenir, yenisi kalır.
    for(const name of names.slice(1)) fs.unlinkSync(path.join(data.COLLECTION_IMAGES_ROOT,name));
    const oldDay=path.join(quarantineRoot,'20000101');fs.mkdirSync(oldDay,{recursive:true});fs.writeFileSync(path.join(oldDay,'ci_1_ffffffffffff.png'),png(8));
    const recentDay=path.join(quarantineRoot,'29991231');fs.mkdirSync(recentDay,{recursive:true});
    const moved=await data.reconcileCollectionImageOrphans({startedBeforeMs:Date.now()+60000});
    out({over,stillThere,logged:errors.some(line=>line.includes('[DATA_INTEGRITY]')&&line.includes('51')),quarantineExists:fs.existsSync(quarantineRoot)&&fs.readdirSync(quarantineRoot).some(d=>d!=='20000101'&&d!=='29991231'),moved,oldPurged:!fs.existsSync(oldDay),recentKept:fs.existsSync(recentDay)});`);
  assert.equal(result.status, 0, result.stderr);
  const [value] = outputs;
  assert.equal(value.over.skipped, 'suspicious-orphan-count');
  assert.equal(value.over.limit, 50);
  assert.equal(value.stillThere, 51, 'eşik aşılınca hiçbir dosya taşınmaz');
  assert.equal(value.logged, true);
  assert.equal(value.moved.quarantined, 1);
  assert.equal(value.quarantineExists, true);
  assert.equal(value.oldPurged, true);
  assert.equal(value.recentKept, true);
});
