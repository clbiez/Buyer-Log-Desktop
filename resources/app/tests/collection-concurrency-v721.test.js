'use strict';

/*
 * v7.21 — KOLEKSİYON: ÇOK KULLANICILI YAZMA
 *
 * Saha bulgusu (kullanıcı): "Çok kullanıcılı senaryoda anlık olarak
 * kullanıcılar tarafından belki yüzlerce veri girişi olacak. Her giriş için
 * tüm kullanıcıları uyarmak soruna yol açar. … diğer kullanıcıların X
 * buyer'ının kendi modellerinde yaptığı değişiklikle ilgili bildirim alması,
 * ekran beklemesi, veri kaybı yaşaması istemediğim bir durum. Aynı anda 100
 * kişi programda düzenlemeler yaptığı senaryoda eğer darboğaz olacak ve
 * zincirleme şekilde kullanıcılar birbirinin güncellemelerini bekleyecekse
 * bu çalışılmaz bir sistem olur."
 *
 * ÖLÇÜLEN KÖK NEDEN: kaydetme eşzamanlıydı ve Node'un olay döngüsünü bloke
 * ediyordu — 50.000 satırlık bir sayfada 307 ms. O süre boyunca sunucu HİÇBİR
 * isteğe yanıt vermiyordu; yani bir kullanıcının kaydı bütün ekibi
 * durduruyordu. Kaydetme artık ayrı bir iş parçacığında yürüyor; aynı ölçümde
 * ana iş parçacığı bloğu 43 ms'ye indi.
 *
 * Bu testler dört şeyi çivilerler:
 *   1) Kaydetme ana iş parçacığını bloke etmiyor.
 *   2) Farklı sayfalara yazan kullanıcılar birbirini beklemiyor.
 *   3) Değişiklik satır yaması olarak taşınıyor; kilit ve bildirim yok.
 *   4) Yama ile ifade edilemeyen değişiklikte sessizce yeniden yükleniyor.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-kol-v721-'));
const env = {
  BUYER_LOG_SERVER_DATA_ROOT: path.join(root, 'data'),
  BUYER_LOG_DATA_ROOT: path.join(root, 'app'),
  BUYER_LOG_LOCAL_DATA_ROOT: path.join(root, 'local'),
  BUYER_LOG_CONFIG_PATH: path.join(root, 'config.json'),
};
Object.assign(process.env, env);

const store = require('../server/lib/collection-workspaces');
const saveWorker = require('../server/lib/collection-save-worker-client');
const liveEvents = require('../server/lib/live-events');

const ROOT = path.join(__dirname, '..');
const SERVER = fs.readFileSync(path.join(ROOT, 'server', 'server.js'), 'utf8');
const APP = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');

test.after(async () => { await saveWorker.shutdown(); fs.rmSync(root, { recursive: true, force: true }); });

function makeRows(count) {
  const rows = [];
  for (let index = 1; index <= count; index += 1) {
    rows.push({ id: index, plmId: `PLM${index}`, model: `MODEL ${index}`, colour: 'SIYAH', note: 'gerçekçi uzunlukta bir not metni', qty: 1000 + index, price: 12.3 });
  }
  return rows;
}
function bodyOf(payload) { return Buffer.from(JSON.stringify(payload), 'utf8'); }
function save(ownerId, payload) {
  return saveWorker.runCollectionSave({ ownerId, body: bodyOf(payload), expectedRevision: null, env });
}
// Olay döngüsünün ne kadar bloke kaldığını ölçer.
async function measureBlocking(run) {
  let maxLag = 0, last = Date.now();
  const timer = setInterval(() => { const now = Date.now(); maxLag = Math.max(maxLag, now - last - 4); last = now; }, 4);
  await new Promise(resolve => setTimeout(resolve, 80));
  maxLag = 0; last = Date.now();
  const value = await run();
  // Gecikmeyi kaydedecek tik, run() bittiği anda henüz çalışmamış olabilir.
  // Zamanlayıcıyı hemen durdurmak ölçümü 0 ms gösterirdi.
  await new Promise(resolve => setTimeout(resolve, 60));
  clearInterval(timer);
  return { value, maxLag };
}

/* ---------------- 1 · Darboğaz ---------------- */

test('v7.21 kaydetme ana iş parçacığını bloke etmiyor', async () => {
  /* 50.000 satır — kullanıcının ölçtüğü en büyük sayfa boyutuna yakın. Bu
     boyutta eşzamanlı yol olay döngüsünü ~307 ms durduruyordu; worker yolu
     aynı ölçümde 43 ms'ye indi.

     ÖLÇÜM GÜRÜLTÜSÜ: test paketi dosyaları ayrı süreçlerde PARALEL koşuyor,
     dolayısıyla tek bir örnek komşu testlerin CPU rekabetinden etkilenir.
     Bu yüzden her iki yol için de birkaç tur alınıp EN TEMİZ (en düşük)
     örnek karşılaştırılıyor: yük altında her iki tarafı da aynı biçimde
     cezalandıran gürültü böylece elenir. */
  const rows = makeRows(50000);
  const payload = { rows, manufacturers: [], customColumns: [], nextId: rows.length + 1 };
  await save('blok', payload); // ısınma: iş parçacığı bir kez açılsın
  // Eşzamanlı hedef de ISITILMALI: dosya henüz yokken kaydetme, MEVCUT
  // dosyayı okuyup ayrıştırma adımını hiç yapmaz ve gerçekte olduğundan çok
  // daha ucuz ölçülür. (İlk yazımda en düşük örnek tam da bu boş ilk çağrıydı.)
  store.saveWorkspace('blok-sync', payload, null);

  const bestOf = async (attempts, run) => {
    const samples = [];
    for (let attempt = 0; attempt < attempts; attempt += 1) samples.push((await measureBlocking(run)).maxLag);
    return Math.min(...samples);
  };
  const syncLag = await bestOf(3, async () => store.saveWorkspace('blok-sync', payload, null));
  const workerLag = await bestOf(3, async () => {
    rows[0].note = `değişti ${Date.now()}`;
    return save('blok', { ...payload, rows });
  });

  /* SONUÇ NEDEN KOŞULLU ÇİVİLENİYOR:

     Bu ölçüm yalnız makine BAŞKA İŞ YAPMIYORKEN anlamlıdır. Test paketi
     dosyaları paralel koştuğunda her iki yol da CPU rekabetiyle aynı tabana
     oturuyor ve gerçek fark eziliyor — ölçülen: yalıtılmış koşuda 307 ms'ye
     karşı 43 ms (7 kat), tam paket altında 89 ms'ye karşı 52 ms (1,7 kat).

     Eşiği "her koşulda geçen" bir değere çekmek, testi ölçmediği bir şeyi
     ölçüyormuş gibi göstermek olurdu. Bunun yerine: sonucu her zaman yazdır,
     oranı yalnız ölçümün geçerli olduğu yalıtılmış koşuda çivile.

     Yalıtılmış koşu:  BL_PERF_TESTS=1 node --test tests/collection-concurrency-v721.test.js

     Yapısal garanti (gövde ana iş parçacığında ayrıştırılmıyor, kaydetme
     worker'a gidiyor) HER koşuda ayrı bir testte çivileniyor. */
  const isolated = String(process.env.BL_PERF_TESTS || '') === '1';
  console.log(`      [ölçüm] eşzamanlı ${syncLag} ms · worker ${workerLag} ms · ana iş parçacığı bloğu${isolated ? '' : ' (paralel paket altında — oran ezilir)'}`);
  assert.ok(Number.isFinite(workerLag), 'worker yolu ölçülebilmeli');
  if (!isolated) return;
  assert.ok(syncLag > 60,
    `eşzamanlı yol yalnız ${syncLag} ms bloke etti; bu boyutta beklenen çok daha fazla (ölçüm ortamı şüpheli)`);
  assert.ok(workerLag < syncLag / 2,
    `worker yolu ${workerLag} ms bloke etti, eşzamanlı yol ${syncLag} ms — beklenen en az iki kat düşüş`);
});

test('v7.21 farklı Koleksiyon sayfalarına yazanlar birbirini beklemiyor', async () => {
  // Kullanıcının asıl korkusu buydu: "zincirleme şekilde kullanıcılar
  // birbirinin güncellemelerini bekleyecekse bu çalışılmaz bir sistem olur."
  const payload = { rows: makeRows(3000), manufacturers: [], customColumns: [], nextId: 3001 };
  await save('isinma', payload);

  const started = Date.now();
  const results = await Promise.all(['buyer-a', 'buyer-b', 'buyer-c', 'buyer-d'].map(owner => save(owner, payload)));
  const parallelMs = Date.now() - started;

  results.forEach(result => assert.equal(result.ok, true));
  // Dördü de kaydedilmiş olmalı — hiçbiri kilit yüzünden düşmemeli.
  ['buyer-a', 'buyer-b', 'buyer-c', 'buyer-d'].forEach(owner => {
    assert.equal(store.loadWorkspace(owner).rows.length, 3000, `${owner} kaydedilmedi`);
  });
  assert.ok(parallelMs < 60000, `dört sayfa ${parallelMs} ms sürdü`);
});

test('v7.21 aynı sayfaya art arda yazmalar sıraya girer, kilit yüzünden düşmez', async () => {
  // Aynı dosyaya eşzamanlı iki yazma, dosya kirasında yarışır ve ikincisi
  // SHARED_WRITE_BUSY ile düşebilirdi. Sayfa bazında kuyruklama bunu önler.
  const payload = { rows: makeRows(500), manufacturers: [], customColumns: [], nextId: 501 };
  const results = await Promise.all([1, 2, 3, 4, 5].map(index => {
    const rows = makeRows(500);
    rows[0].note = `tur ${index}`;
    return save('sirali', { ...payload, rows });
  }));
  results.forEach((result, index) => assert.equal(result.ok, true, `${index + 1}. yazma düştü`));
  // Revizyonlar ardışık olmalı: hiçbir yazma kaybolmamış.
  const revisions = results.map(result => result.revision).sort((a, b) => a - b);
  assert.deepEqual(revisions, [1, 2, 3, 4, 5]);
});

/* ---------------- 2 · Satır farkı ---------------- */

test('v7.21 kaydetme değişen satırları döndürür', async () => {
  const rows = makeRows(50);
  await save('fark', { rows, manufacturers: [], customColumns: [], nextId: 51 });
  const next = makeRows(50);
  next[7].note = 'ekip arkadaşının notu';
  const result = await save('fark', { rows: next, manufacturers: [], customColumns: [], nextId: 51 });
  assert.equal(result.ok, true);
  assert.equal(result.rowPatches.length, 1, 'yalnız değişen satır taşınmalı');
  assert.equal(result.rowPatches[0].kind, 'changed');
  assert.equal(result.rowPatches[0].row.note, 'ekip arkadaşının notu');
});

test('v7.21 silme satır yamasında taşınır — eksik satır "silinmiş" sanılmaz', async () => {
  const rows = makeRows(10);
  await save('silme', { rows, manufacturers: [], customColumns: [], nextId: 11 });
  const next = makeRows(10).filter(row => row.id !== 4);
  const result = await save('silme', { rows: next, manufacturers: [], customColumns: [], nextId: 11 });
  const removed = result.rowPatches.filter(item => item.kind === 'removed');
  assert.equal(removed.length, 1);
  assert.equal(removed[0].key, 'id:4');
  assert.equal(removed[0].row, null, 'silme kaydı satır içeriği taşımamalı');
});

test('v7.21 satır sırası veya sütun değişince yama YERİNE yeniden yükleme istenir', async () => {
  // Yarım yama uygulamak, karşı ekranda sessiz veri sapması demektir.
  const rows = makeRows(10);
  await save('yapisal', { rows, manufacturers: [], customColumns: [], nextId: 11 });
  const reordered = [...makeRows(10)].reverse();
  const reorder = await save('yapisal', { rows: reordered, manufacturers: [], customColumns: [], nextId: 11 });
  assert.equal(reorder.rowPatches, null, 'sıralama değişikliği yama ile ifade edilemez');

  const columns = await save('yapisal', { rows: reordered, manufacturers: [], customColumns: [{ k: 'c1', label: 'Yeni' }], nextId: 11 });
  assert.equal(columns.rowPatches, null, 'sütun değişikliği yama ile ifade edilemez');
});

test('v7.21 çok büyük fark yama olarak taşınmaz', async () => {
  const rows = makeRows(1200);
  await save('buyukfark', { rows, manufacturers: [], customColumns: [], nextId: 1201 });
  const next = makeRows(1200).map(row => ({ ...row, note: 'hepsi değişti' }));
  const result = await save('buyukfark', { rows: next, manufacturers: [], customColumns: [], nextId: 1201 });
  assert.equal(result.rowPatches, null, `${store.MAX_PATCH_ROWS} satırı aşan fark yeniden yüklemeye düşmeli`);
});

test('v7.21 satır karşılaştırması JSON.stringify kullanmıyor', () => {
  // İlk yazımda satır başına iki JSON.stringify vardı; 50.000 satırda bu tek
  // başına 273 ms sürüyordu — düzeltmeye çalıştığım maliyetin tamamına yakın.
  const source = fs.readFileSync(path.join(ROOT, 'server', 'lib', 'collection-workspaces.js'), 'utf8');
  const diff = source.slice(source.indexOf('function diffWorkspaceRows'), source.indexOf('async function saveWorkspaceAsync'));
  assert.doesNotMatch(diff, /JSON\.stringify\(previous\)/);
  assert.match(diff, /shallowRowEqual\(previous, row\)/);
});

/* ---------------- 3 · Yetki ---------------- */

test('v7.21 Koleksiyon satırları yalnız o sayfaya erişimi olana gider', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const written = [];
  const izinli = { write: chunk => written.push(['izinli', chunk]) };
  const yasakli = { write: chunk => written.push(['yasakli', chunk]) };
  const a = liveEvents.addClient(izinli, 'c-izinli', { req: {} });
  const b = liveEvents.addClient(yasakli, 'c-yasakli', { req: {} });
  liveEvents.setPatchAuthorizer((entry, patches, event) => {
    assert.equal(event.area, 'collection');
    assert.equal(event.ownerId, 'buyer-x');
    return entry.id === 'c-izinli' ? patches : [];
  });
  liveEvents.notifyChange('collection', 'yazan', { ownerId: 'buyer-x', rowPatches: [{ key: 'id:1', kind: 'changed', row: { id: 1, note: 'gizli fiyat notu' } }] });
  t.mock.timers.tick(3000);

  const forIzinli = written.filter(([who]) => who === 'izinli');
  const forYasakli = written.filter(([who]) => who === 'yasakli');
  assert.equal(forIzinli.length, 1);
  assert.equal(forYasakli.length, 0, 'erişimi olmayan aboneye satır gitmemeli');
  assert.ok(!JSON.stringify(forIzinli).includes('c-yasakli'));
  assert.ok(JSON.stringify(forIzinli).includes('gizli fiyat notu'));

  liveEvents.removeClient(a); liveEvents.removeClient(b);
  liveEvents.setPatchAuthorizer(null);
});

test('v7.21 Koleksiyon yetkisi SAYFA bazındadır, kısmi süzme yoktur', () => {
  const block = SERVER.slice(SERVER.indexOf('liveEvents.setPatchAuthorizer'), SERVER.indexOf('const ROW_PATCH_IDENTITY_KEYS'));
  assert.match(block, /event\.area === 'collection'/);
  assert.match(block, /userAccess\.collectionAccessLevel\(profile, ownerId\) \? rowPatches : \[\]/);
  assert.match(block, /if \(!ownerId\) return \[\];/);
});

test('v7.21 aynı satırın art arda yamaları birleşir, silme kaybolmaz', () => {
  const merged = liveEvents.mergeCollectionPatches(
    [{ key: 'id:1', kind: 'changed', row: { id: 1, note: 'ilk' } }, { key: 'id:2', kind: 'removed', row: null }],
    [{ key: 'id:1', kind: 'changed', row: { id: 1, note: 'son' } }],
  );
  assert.equal(merged.length, 2);
  const first = merged.find(item => item.key === 'id:1');
  assert.equal(first.row.note, 'son', 'satırın son hâli geçerli olmalı');
  assert.ok(merged.some(item => item.key === 'id:2' && item.kind === 'removed'), 'silme kaydı korunmalı');
});

/* ---------------- 4 · Sunucu ve istemci sözleşmesi ---------------- */

test('v7.21 kaydetme gövdesi ana iş parçacığında ayrıştırılmıyor', () => {
  const block = SERVER.slice(SERVER.indexOf("app.put('/api/collection-workspaces/:ownerId'"), SERVER.indexOf('// ---- Shared PLM'));
  assert.match(block, /express\.raw\(/, 'gövde ham alınmalı');
  assert.doesNotMatch(block, /express\.json\(/, 'ana iş parçacığında JSON ayrıştırma kalmamalı');
  assert.match(block, /collectionSaveWorker\.runCollectionSave/);
  // Yanıt küçük olmalı: 18 MB'ı geri serileştirmek kazancı geri verirdi.
  assert.match(block, /workspace: \{ _revision: result\.revision/);
  assert.doesNotMatch(block, /workspace: saved \}/);
});

test('v7.21 gövde worker\'a kopyalanmadan taşınır', () => {
  // structuredClone 8 MB'lık bir gövdede 102 ms ölçüldü; bu, kaçmaya
  // çalıştığımız ana-iş-parçacığı bloğunu geri getirirdi.
  const client = fs.readFileSync(path.join(ROOT, 'server', 'lib', 'collection-save-worker-client.js'), 'utf8');
  assert.match(client, /postMessage\(\{ \.\.\.task, body: slice, id \}, \[slice\]\)/);
});

test('v7.21 worker hatası HTTP anlamını koruyor', () => {
  // Revizyon çakışması 409 olmalı; worker sınırında 500'e dönüşürse istemci
  // "güncel sürümü yükle" yolunu çalıştıramaz.
  const client = fs.readFileSync(path.join(ROOT, 'server', 'lib', 'collection-save-worker-client.js'), 'utf8');
  assert.match(client, /error\.statusCode = Number\(message\.statusCode\) \|\| 500;/);
  assert.match(client, /if \(message\.currentRevision != null\) error\.currentRevision = message\.currentRevision;/);
});

test('v7.21 istemci uzak yamayı yerinde uygular, çalışma durumunu silmez', () => {
  const apply = APP.slice(APP.indexOf('function kolApplyRemotePatches'), APP.indexOf('function kolHighlightRemoteRows'));
  assert.match(apply, /kolRows\.splice\(index, ?1\)/, 'silinen satır listeden çıkarılmalı');
  assert.match(apply, /kolRows\[index\]=migrateKolRow/, 'değişen satır yerinde güncellenmeli');
  // Kullanıcının kendi durumu bu yolda sıfırlanmamalı.
  ['kolUndoStack=[]', 'kolRedoStack=[]', 'kolSelected.clear()'].forEach(name => {
    assert.ok(!apply.includes(name), `${name} uzak yama yolunda sıfırlanmamalı`);
  });
  assert.ok(!apply.includes('setReadOnlyMode'), 'uzak yama ekranı kilitlememeli');
});

test('v7.21 yeniden yükleme yolu kaydırma ve seçimi koruyor', () => {
  const start = APP.indexOf('async function kolHandleRemoteChange');
  assert.ok(start > 0, 'kolHandleRemoteChange bulunmalı');
  // Fonksiyonun sonu: hemen ardından gelen açıklama bloğunun başlangıcı.
  // (Bir sonraki `function` bildirimine kadar almak, aradaki v7.19 açıklama
  // metnini de kapsıyor ve o metinde setReadOnlyMode SÖZCÜĞÜ geçiyor.)
  const body = APP.slice(start, APP.indexOf('/* ==', start));
  assert.ok(body.length > 200 && body.length < 3000, `beklenen fonksiyon gövdesi alınamadı: ${body.length}`);
  assert.match(body, /restored\.scrollTop=top/, 'kaydırma konumu geri yüklenmeli');
  assert.match(body, /selected\.forEach/, 'seçim korunmalı');
  assert.doesNotMatch(body, /setReadOnlyMode/);
  assert.match(body, /kolHasDirtyWorkspace\(\)/, 'kirli yerel durum tam yeniden yüklemeden önce korunmalı');
  assert.match(body, /kolPersistPendingWorkspace\('remote-change'\)/, 'bekleyen yerel giriş cihazda kurtarılabilir kalmalı');
  assert.match(body, /showToast/, 'ertelenen uzak değişiklik kullanıcıdan gizlenmemeli');
});
