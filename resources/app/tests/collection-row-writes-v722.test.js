'use strict';

/*
 * v7.22 — SATIR BAZLI YAZMA VE SATIR BAZLI REVİZYON
 *
 * v7.20 incelemesinde ölçülen veri kaybı: revizyon kontrolü BÜTÜN SAYFA
 * bazındaydı. A 1. satırı, B 900. satırı düzenlediğinde — aralarında hiçbir
 * çakışma olmamasına rağmen — B'nin yazması REVISION_CONFLICT ile
 * reddediliyor, istemci güncel sürümü yükleyip B'nin girişini atıyordu.
 * Birebir çalıştırılmıştı: B'nin notu diskte yoktu.
 *
 * Bu testler beş şeyi çivilerler:
 *   1) Farklı satırlara yazan iki kullanıcının ikisi de kaydeder.
 *   2) AYNI satıra yazan ikinci kullanıcı sessizce ezilmez ve sessizce
 *      atılmaz — gerçek çakışma güncel değerle bildirilir.
 *   3) Silme, satırın yokluğundan çıkarılmaz; açık bir kayıt olarak gelir.
 *   4) Yapısal değişiklik (sütun/üretici/sıra) hâlâ sayfa revizyonuyla
 *      kilitlenir — satıra ait olmayan şey satır bazlı çözülemez.
 *   5) v7.21 ve öncesinden kalma dosyalar (_rev taşımayan) veri kaybı
 *      olmadan yükseltilir ve eski tam sayfa yolu çalışmaya devam eder.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-kol-v722-'));
Object.assign(process.env, {
  BUYER_LOG_SERVER_DATA_ROOT: path.join(root, 'data'),
  BUYER_LOG_DATA_ROOT: path.join(root, 'app'),
  BUYER_LOG_LOCAL_DATA_ROOT: path.join(root, 'local'),
  BUYER_LOG_CONFIG_PATH: path.join(root, 'config.json'),
});

const store = require('../server/lib/collection-workspaces');
const ROOT = path.join(__dirname, '..');
const SERVER = require('./helpers/server-source')();
const APP = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');
const WORKER = fs.readFileSync(path.join(ROOT, 'server', 'collection-save-worker.js'), 'utf8');

test.after(() => fs.rmSync(root, { recursive: true, force: true }));

function rowsOf(count) {
  const rows = [];
  for (let index = 1; index <= count; index += 1) rows.push({ id: index, model: `M${index}`, note: '' });
  return rows;
}
async function seed(ownerId, count) {
  await store.saveWorkspaceAsync(ownerId, { rows: rowsOf(count), manufacturers: [], customColumns: [], nextId: count + 1 }, null);
  return store.loadWorkspace(ownerId);
}

/* ---------------- 1 · v7.20 veri kaybı kapandı ---------------- */

test('v7.22 farklı satırları düzenleyen iki kullanıcının İKİSİ de kaydeder', async () => {
  // v7.20'de bu senaryoda B'nin girişi kayboluyordu.
  await seed('ortak', 1000);
  const a = store.loadWorkspace('ortak');
  const b = store.loadWorkspace('ortak');
  assert.equal(a._revision, b._revision, 'iki kullanıcı aynı sayfayı aynı revizyonda açtı');

  const first = await store.applyRowChangesAsync('ortak', { upserts: [{ ...a.rows[0], note: 'A kullanıcısının notu' }] });
  const second = await store.applyRowChangesAsync('ortak', { upserts: [{ ...b.rows[899], note: 'B kullanıcısının notu' }] });

  assert.equal(first.conflicts.length, 0);
  assert.equal(second.conflicts.length, 0, 'farklı satır çakışma sayılmamalı');
  const final = store.loadWorkspace('ortak');
  assert.equal(final.rows[0].note, 'A kullanıcısının notu');
  assert.equal(final.rows[899].note, 'B kullanıcısının notu', 'B kullanıcısının girişi korunmalı');
  assert.equal(final.rows.length, 1000, 'satır sayısı değişmemeli');
});

test('v7.22 aynı satıra ikinci yazma ezmiyor, sessizce de atılmıyor', async () => {
  await seed('cakisma', 20);
  const first = store.loadWorkspace('cakisma');
  const second = store.loadWorkspace('cakisma');

  await store.applyRowChangesAsync('cakisma', { upserts: [{ ...first.rows[5], note: 'ÖNCE' }] });
  const result = await store.applyRowChangesAsync('cakisma', { upserts: [{ ...second.rows[5], note: 'SONRA' }] });

  assert.equal(result.applied.length, 0);
  assert.equal(result.conflicts.length, 1, 'gerçek çakışma bildirilmeli');
  const conflict = result.conflicts[0];
  assert.equal(conflict.reason, 'row-revision');
  // Kullanıcıya "kaydedilemedi" demek yetmez; sunucudaki GÜNCEL değer de
  // dönmeli ki ekranda doğru veri gösterilebilsin.
  assert.equal(conflict.current.note, 'ÖNCE');
  assert.equal(store.loadWorkspace('cakisma').rows[5].note, 'ÖNCE', 'disk ezilmemeli');
});

test('v7.22 çakışan satır varken çakışmayanlar yine uygulanır', async () => {
  await seed('kismi', 20);
  const first = store.loadWorkspace('kismi');
  const second = store.loadWorkspace('kismi');
  await store.applyRowChangesAsync('kismi', { upserts: [{ ...first.rows[2], note: 'başkası' }] });

  const result = await store.applyRowChangesAsync('kismi', {
    upserts: [
      { ...second.rows[2], note: 'çakışacak' },
      { ...second.rows[9], note: 'geçecek' },
    ],
  });
  assert.equal(result.applied.length, 1, 'çakışmayan satır uygulanmalı');
  assert.equal(result.conflicts.length, 1);
  const final = store.loadWorkspace('kismi');
  assert.equal(final.rows[2].note, 'başkası', 'çakışan satır korunmalı');
  assert.equal(final.rows[9].note, 'geçecek', 'çakışmayan satır yazılmalı');
});

test('v7.22 hiçbir satır uygulanmadıysa dosyaya dokunulmuyor', async () => {
  await seed('bosyazma', 10);
  const before = store.loadWorkspace('bosyazma');
  const stale = store.loadWorkspace('bosyazma');
  await store.applyRowChangesAsync('bosyazma', { upserts: [{ ...before.rows[0], note: 'ilk' }] });
  const revisionAfterFirst = store.loadWorkspace('bosyazma')._revision;

  const result = await store.applyRowChangesAsync('bosyazma', { upserts: [{ ...stale.rows[0], note: 'çakışan' }] });
  assert.equal(result.changed, false);
  assert.equal(store.loadWorkspace('bosyazma')._revision, revisionAfterFirst,
    'tamamen çakışan bir yazma revizyonu ilerletmemeli ve gereksiz canlı olay üretmemeli');
});

/* ---------------- 2 · Silme ---------------- */

test('v7.22 silme açık kayıt olarak taşınır', async () => {
  const seeded = await seed('silme', 10);
  const result = await store.applyRowChangesAsync('silme', { deletes: [{ id: 4, _rev: store.rowRev(seeded.rows[3]) }] });
  assert.equal(result.applied.length, 1);
  assert.equal(result.applied[0].kind, 'removed');
  const final = store.loadWorkspace('silme');
  assert.equal(final.rows.length, 9);
  assert.ok(!final.rows.some(row => row.id === 4));
});

test('v7.22 başkası düzenlemişse silme sessizce uygulanmaz', async () => {
  const seeded = await seed('silme2', 10);
  const stale = store.loadWorkspace('silme2');
  await store.applyRowChangesAsync('silme2', { upserts: [{ ...seeded.rows[3], note: 'başkası yazdı' }] });

  const result = await store.applyRowChangesAsync('silme2', { deletes: [{ id: 4, _rev: store.rowRev(stale.rows[3]) }] });
  assert.equal(result.conflicts.length, 1);
  assert.equal(result.conflicts[0].reason, 'row-revision-delete');
  assert.equal(store.loadWorkspace('silme2').rows.length, 10, 'satır silinmemeli');
});

test('v7.22 zaten silinmiş satırın silinmesi hata değildir', async () => {
  await seed('silme3', 5);
  const result = await store.applyRowChangesAsync('silme3', { deletes: [{ id: 999 }] });
  assert.equal(result.conflicts.length, 0, 'istenen sonuç zaten sağlanmış');
  assert.equal(result.applied[0].kind, 'removed');
});

/* ---------------- 3 · Yapısal değişiklik ---------------- */

test('v7.22 sütun/üretici değişikliği sayfa revizyonuyla kilitlenir', async () => {
  const seeded = await seed('yapisal', 10);
  await assert.rejects(
    () => store.applyRowChangesAsync('yapisal', {
      baseRevision: seeded._revision - 1, // bayat
      structure: { customColumns: [{ k: 'c1', label: 'Yeni' }] },
    }),
    error => error.code === 'STRUCTURE_REVISION_CONFLICT' && error.statusCode === 409,
  );
  const fresh = store.loadWorkspace('yapisal');
  const ok = await store.applyRowChangesAsync('yapisal', {
    baseRevision: fresh._revision,
    structure: { customColumns: [{ k: 'c1', label: 'Yeni' }] },
  });
  assert.equal(ok.changed, true);
  assert.equal(store.loadWorkspace('yapisal').customColumns.length, 1);
});

test('v7.22 yapısal değişiklikte yama değil yeniden yükleme istenir', async () => {
  const seeded = await seed('yapisal2', 5);
  const result = await store.applyRowChangesAsync('yapisal2', {
    baseRevision: seeded._revision,
    structure: { customColumns: [{ k: 'c9', label: 'X' }] },
  });
  assert.equal(result.rowPatches, null, 'karşı ekranın sütunları ayrışmamalı');
});

test('v7.22 sıralamada listelenmeyen satır DÜŞÜRÜLMEZ', async () => {
  // §142: performans ya da kolaylık için satır düşürmek yok.
  const seeded = await seed('sira', 5);
  const result = await store.applyRowChangesAsync('sira', {
    baseRevision: seeded._revision,
    structure: { order: ['3', '1'] }, // yalnız iki satır listelendi
  });
  const final = store.loadWorkspace('sira');
  assert.equal(final.rows.length, 5, 'listelenmeyen satırlar korunmalı');
  assert.deepEqual(final.rows.slice(0, 2).map(row => row.id), [3, 1], 'verilen sıra uygulanmalı');
  assert.ok(result.changed);
});

/* ---------------- 4 · Göç ve geriye dönük uyum ---------------- */

test('v7.22 _rev taşımayan eski dosyalar veri kaybı olmadan yükseltilir', async () => {
  const dir = path.join(root, 'data', 'collection-workspaces');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'eski.json'), JSON.stringify({
    schemaVersion: 1, ownerId: 'eski', initialized: true,
    rows: [{ id: 1, model: 'M1', note: 'eski not' }, { id: 2, model: 'M2', note: '' }],
    manufacturers: [{ name: 'U1' }], customColumns: [{ k: 'c1', label: 'Ek' }],
    nextId: 3, _revision: 7, _updatedAt: '2026-01-01T00:00:00.000Z',
  }, null, 2));

  const loaded = store.loadWorkspace('eski');
  assert.ok(!loaded.rows.some(row => row._rev != null), 'eski dosyada _rev bulunmaz');

  const result = await store.applyRowChangesAsync('eski', { upserts: [{ ...loaded.rows[1], note: 'yeni not' }] });
  assert.equal(result.conflicts.length, 0, '_rev yokluğu çakışma sayılmamalı');
  const after = store.loadWorkspace('eski');
  assert.equal(after.rows[0].note, 'eski not', 'dokunulmayan satır korunmalı');
  assert.equal(after.rows[1].note, 'yeni not');
  assert.equal(after.customColumns.length, 1, 'sütunlar korunmalı');
  assert.equal(after.manufacturers.length, 1, 'üreticiler korunmalı');
  assert.equal(after._revision, 8, 'sayfa revizyonu ilerlemeli');
});

test('v7.22 eski tam sayfa yolu çalışmaya devam ediyor', async () => {
  // Excel/PLM içe aktarma gibi sayfanın tamamını değiştiren akışlar bu yolu
  // kullanıyor; satır bazlı yazma onu kaldırmadı.
  const seeded = await seed('tamsayfa', 10);
  const saved = await store.saveWorkspaceAsync('tamsayfa', {
    rows: seeded.rows.map(row => ({ ...row, note: 'toplu' })),
    manufacturers: [], customColumns: [], nextId: 11,
  }, seeded._revision);
  assert.equal(saved.saved._revision, seeded._revision + 1);
  assert.ok(store.loadWorkspace('tamsayfa').rows.every(row => row.note === 'toplu'));
  assert.match(WORKER, /task\.mode === 'rows'/, 'worker iki yazma biçimini de tanımalı');
});

/* ---------------- 5 · Sunucu ve istemci sözleşmesi ---------------- */

test('v7.22 PATCH ucu var, kısmi başarı 200 döner', () => {
  const block = SERVER.slice(SERVER.indexOf("app.patch('/api/collection-workspaces/:ownerId'"), SERVER.indexOf('// Son başarılı OAB snapshot'));
  assert.match(block, /express\.raw\(/, 'gövde ana iş parçacığında ayrıştırılmamalı');
  assert.match(block, /mode: 'rows'/);
  assert.match(block, /conflicts: result\.conflicts/, 'çakışan satırlar istemciye dönmeli');
  // Bazı satırlar uygulanmışken bütün isteği hata saymak, uygulananları
  // görünmez kılardı.
  assert.match(block, /res\.json\(\{\s*ok: true/);
  // Hiçbir şey değişmediyse canlı olay ve denetim kaydı üretilmemeli.
  assert.match(block, /if \(result\.changed\) \{/);
});

test('v7.22 istemci yalnız değişen satırları gönderiyor', () => {
  const collect = APP.slice(APP.indexOf('function kolCollectChanges'), APP.indexOf('function kolReportConflicts'));
  assert.match(collect, /upserts\.push/);
  assert.match(collect, /deletes\.push/);
  assert.match(collect, /change\.structure=/, 'yapısal değişiklik ayrı taşınmalı');
  assert.match(collect, /change\.baseRevision=kolBaseline\.structureBaseRevision\?\?kolWorkspaceRevision/);
  const save = APP.slice(APP.indexOf('async function kolSaveWorkspaceNow'), APP.indexOf('function kolQueueWorkspaceSave'));
  assert.match(save, /method:rowMode\?'PATCH':'PUT'/);
});

test('v7.22 değişen satır kümesi mutasyon noktalarından değil TEMELDEN çıkarılıyor', () => {
  /* "değişen satırı burada işaretle" yaklaşımı, Koleksiyon'daki onlarca
     düzenleme yolundan birini atlamak ve o yolu sessizce hiç kaydetmemek
     demekti — düzeltmeye çalıştığımız hatanın daha sinsi biçimi. */
  assert.match(APP, /function kolCaptureBaseline\(\)/);
  const apply = APP.slice(APP.indexOf('function kolApplyWorkspace'), APP.indexOf('async function kolSaveWorkspaceNow'));
  assert.match(apply, /kolCaptureBaseline\(\)/, 'temel yükleme sonrası kurulmalı');
  const collect = APP.slice(APP.indexOf('function kolCollectChanges'), APP.indexOf('function kolReportConflicts'));
  assert.match(collect, /kolBaseline\.rows\.get\(key\)/);
  assert.match(collect, /if\(!kolBaseline\|\|kolBaseline\.ownerId!==kolWorkspaceOwnerId\)return null/,
    'temel yoksa tam sayfa gönderilmeli — sessizce eksik gönderilmemeli');
});

test('v7.22 istemci kendi yazdığı satırın yeni revizyonunu saklıyor', () => {
  // Saklamazsa bir sonraki kayıt kendi yazdığı satırı çakışmış sanardı.
  const save = APP.slice(APP.indexOf('async function kolSaveWorkspaceNow'), APP.indexOf('function kolQueueWorkspaceSave'));
  assert.match(save, /kolRows\[index\]\._rev=Number\(item\.rev\)/);
  assert.match(save, /kolCaptureBaseline\(\)/);
  assert.match(WORKER, /rev: item\.row \? item\.row\._rev : undefined/);
});

test('v7.22 uzaktan gelen satır temele de işleniyor', () => {
  // İşlenmezse bir sonraki kayıt o satırı "ben değiştirdim" sanıp eski _rev
  // ile geri gönderir ve boş yere çakışma alırdı.
  const apply = APP.slice(APP.indexOf('function kolApplyRemotePatches'), APP.indexOf('function kolHighlightRemoteRows'));
  assert.match(apply, /kolBaseline\.rows\.delete\(id\)/);
  assert.match(apply, /kolBaseline\.rows\.set\(id,\{\.\.\.incoming\}\)/);
});

test('v7.22 çakışan satırlar kullanıcıya bildirilir ve yerel giriş korunur', () => {
  const report = APP.slice(APP.indexOf('function kolReportConflicts'), APP.indexOf('function kolWorkspaceSetReadonly'));
  assert.doesNotMatch(report, /kolRows\[index\]=migrateKolRow\(\{\.\.\.item\.current\}\)/, 'sunucu değeri yerel girişi ezmemeli');
  assert.match(report, /kolBaseline\.rows\.set/, 'sunucu değeri yalnız karşılaştırma temeline alınmalı');
  assert.match(report, /kolPersistPendingWorkspace\(rebased\?'rebased':'conflict'\)/, 'yerel giriş hem otomatik rebase hem gerçek conflict durumunda cihazda kurtarılabilir kalmalı');
  assert.match(report, /showToast/);
  assert.match(report, /kaydedilemedi/, 'hangi satırların kaydedilemediği söylenmeli');
});


/* ---------------- 6 · Kendi Koleksiyonunda kilitsiz / kayıpsız rebase ---------------- */

test('v7.0.111 kendi satırındaki eşzamanlı değişiklik üç yönlü birleştirilir', () => {
  const start = APP.indexOf('function kolValueEqual');
  const end = APP.indexOf('function kolCollectChanges', start);
  assert.ok(start > 0 && end > start, 'Collection merge yardımcıları bulunmalı');
  const source = APP.slice(start, end);
  const scene = new Function('migrateKolRow', `
    ${source}
    return { kolMergeLocalRowDelta, kolRowChangedFromBase };
  `)(row => ({ ...row }));

  const base = { id: 1, _rev: 4, not: 'eski', targetPrice: '10', pricing: { confirmed: false } };
  const local = { ...base, not: 'benim girişim', pricing: { confirmed: true } };
  const remote = { ...base, _rev: 5, not: 'öteki pencere', targetPrice: '11', colour: 'KIRMIZI' };
  const merged = scene.kolMergeLocalRowDelta(base, local, remote);

  assert.equal(merged.not, 'benim girişim', 'aynı alanda kullanıcının aktif yerel girişi korunmalı');
  assert.deepEqual(merged.pricing, { confirmed: true }, 'yerel nesne alanı da korunmalı');
  assert.equal(merged.targetPrice, '11', 'yerelde dokunulmayan uzak alan ezilmemeli');
  assert.equal(merged.colour, 'KIRMIZI', 'uzakta eklenen alan korunmalı');
  assert.equal(merged._rev, 5, 'tekrar kayıt güncel satır revizyonuna dayanmalı');
  assert.equal(scene.kolRowChangedFromBase(base, local), true);
});

test('v7.0.111 kendi Koleksiyonunda revizyon çakışması kullanıcıyı durdurmadan otomatik yeniden tabanlanır', () => {
  const report = APP.slice(APP.indexOf('function kolReportConflicts'), APP.indexOf('function kolWorkspaceSetReadonly'));
  assert.match(report, /kolIsOwnWorkspace\(\)/);
  assert.match(report, /kolMergeLocalRowDelta\(base,local,remote\)/);
  assert.match(report, /return rebased/);

  const rebase = APP.slice(APP.indexOf('async function kolRebaseOwnWorkspace'), APP.indexOf('async function kolSaveWorkspaceNow'));
  assert.match(rebase, /kolPersistPendingWorkspace\('rebasing'\)/, 'rebase öncesi yerel çalışma cihazda güvenceye alınmalı');
  assert.match(rebase, /remoteBaselineRows/, 'güncel sunucu satırları yeni baseline olmalı');
  assert.match(rebase, /kolMergeLocalRowDelta/, 'yerel alan farkları güncel satırın üstüne taşınmalı');
  assert.match(rebase, /localOrderChanged/, 'yerel sıra değişikliği kaybolmamalı');

  const save = APP.slice(APP.indexOf('async function kolSaveWorkspaceNow'), APP.indexOf('function kolQueueWorkspaceSave'));
  assert.match(save, /retryOwnConflict/);
  assert.match(save, /kolRebaseOwnWorkspace\(ownerId\)/);
  assert.match(save, /_conflictRetry:conflictRetry\+1/);
  assert.doesNotMatch(save, /This Collection page changed elsewhere\. Your local edit is preserved; review and retry\./);
});

test('v7.0.111 düzenlenen Koleksiyon satırını bekleyen uzak yama ezemez', () => {
  const apply = APP.slice(APP.indexOf('function kolDirtyRowIds'), APP.indexOf('function kolHighlightRemoteRows'));
  assert.match(apply, /const dirty=kolDirtyRowIds\(\)/);
  assert.match(apply, /dirty\.has\(id\)/, 'kaydedilmemiş satır yaması ertelenmeli');
  assert.match(apply, /appliedItems/, 'baseline yalnız uygulanmış yamalardan ilerlemeli');
  assert.doesNotMatch(apply, /kolBaseline\.structure=kolStructureSignature\(\)/,
    'satır yaması yerel yapısal değişikliği kaydedilmiş saymamalı');

  const deferredStart = APP.indexOf("document.addEventListener('focusout',()=>{", APP.indexOf('let kolDeferredPatches=[]'));
  const deferredEnd = APP.indexOf('/* Kirli-workspace', deferredStart);
  const deferred = APP.slice(deferredStart, deferredEnd);
  assert.match(deferred, /await kolSettlePendingSave\(\)/, 'focusout önce yerel kaydı tamamlamalı');
  assert.ok(
    deferred.indexOf('await kolSettlePendingSave()') < deferred.indexOf('kolApplyRemotePatches(pending)'),
    'uzak yama yerel kayıt tamamlanmadan uygulanmamalı',
  );
});

test('a shared-row rejection keeps its original CAS token, so background pricing cannot silently retry stale fields', () => {
  const report=APP.slice(APP.indexOf('function kolReportConflicts'),APP.indexOf('function kolWorkspaceSetReadonly'));
  const original={id:1,_rev:3,modelKod:'old',fob:'4'};
  const ctx={kolIsOwnWorkspace:()=>false,migrateKolRow:r=>r,kolBaseline:{rows:new Map([['1',original]])},kolRows:[{...original,modelKod:'rejected-draft'}],kolRowIndexById:()=>0,kolPersistPendingWorkspace:()=>{},showToast:()=>{},appLang:'en'};
  require('node:vm').createContext(ctx);require('node:vm').runInContext(report,ctx);
  assert.equal(ctx.kolReportConflicts([{id:1,current:{...original,_rev:4,modelKod:'accepted-peer'}}]),false);
  assert.equal(ctx.kolBaseline.rows.get('1')._rev,3,'rejected local data must not acquire the remote acceptance token');
  assert.equal(ctx.kolRows[0].modelKod,'rejected-draft','draft remains available for an explicit user decision');
});
