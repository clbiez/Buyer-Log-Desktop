'use strict';

/* v9.54 — PORTABLE: ESKİ KURULUMDAN VERİ TAŞIMA
 *
 * Kullanıcı isteği (birebir): "Bu Portable'ı açtığım bilgisayarda eski Buyer
 * Log sürümü de olabilir ve kullanıcı verileri appdatada kalmış olabilir.
 * Portable eski programın oluşturduğu kullanıcı verilerini bulup kendi
 * bünyesine taşısın."
 *
 * Bu betik VERİ TAŞIYOR — en tehlikeli iş sınıfı. Korunan asıl kusurlar:
 *
 * 1) KAYNAĞIN SİLİNMESİ/DEĞİŞTİRİLMESİ. Eski kurulum çalışmaya devam
 *    edebilmeli; taşıma geri alınamaz olmamalı.
 * 2) PORTABLE'DAKİ ÇALIŞMANIN ÜSTÜNE YAZILMASI. İkinci çalıştırma kullanıcının
 *    portable'da yaptığı işi yok edemez.
 * 3) APPDATA YÖNLENDİRME TUZAĞI. Başlatıcı APPDATA/LOCALAPPDATA değişkenlerini
 *    paketin içine çeviriyor; betik gerçek Windows yollarını okumazsa kendi
 *    kendini kaynak sanar ve hiçbir şey bulamaz.
 * 4) Yedek/arşiv dosyalarının da taşınması (canlı veride 1,8 GB'ın ~740 MB'ı).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'import-legacy-data.js');
const SOURCE = fs.readFileSync(SCRIPT, 'utf8');

/* Sahte bir "eski kurulum + portable paket" düzeni kurar ve betiği gerçekten
   çalıştırır. Kaynak-metin eşleştirmesi bu iş için yeterli değil: dosyaların
   gerçekten kopyalandığını ve kaynağın bozulmadığını ölçmek gerekiyor. */
function makeWorld() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'bl-portable-'));
  const pkg = path.join(base, 'package');
  const hostAppData = path.join(base, 'Roaming');
  const hostLocal = path.join(base, 'Local');

  fs.mkdirSync(path.join(pkg, 'scripts'), { recursive: true });
  fs.copyFileSync(SCRIPT, path.join(pkg, 'scripts', 'import-legacy-data.js'));
  for (const name of ['server', 'app', 'local', 'auth']) {
    fs.mkdirSync(path.join(pkg, 'data', name), { recursive: true });
  }

  const legacyApp = path.join(hostAppData, 'Buyer Log');
  const legacyLocal = path.join(hostLocal, 'BuyerLog');
  fs.mkdirSync(path.join(legacyApp, 'auth'), { recursive: true });
  fs.mkdirSync(path.join(legacyLocal, 'model-files'), { recursive: true });
  fs.mkdirSync(path.join(legacyLocal, 'model-snapshots'), { recursive: true });

  fs.writeFileSync(path.join(legacyApp, 'fx-rates.json'), '{"USD":1}');
  fs.writeFileSync(path.join(legacyApp, 'fx-rates.json.bak'), '{"USD":0}');
  fs.writeFileSync(path.join(legacyApp, 'auth', 'token.json'), 'gizli');
  fs.writeFileSync(path.join(legacyLocal, 'BuyerLogLocal.db'), 'VERITABANI');
  fs.writeFileSync(path.join(legacyLocal, 'BuyerLogLocal.db.bak'), 'YEDEK');
  fs.writeFileSync(path.join(legacyLocal, 'data.zip'), 'ARSIV');
  fs.writeFileSync(path.join(legacyLocal, 'model-files', 'a.png'), 'GORSEL');
  fs.writeFileSync(path.join(legacyLocal, 'model-snapshots', 'snap.json'), 'ANLIK');

  /* v10.14 — CALISMA ZAMANI ARTIKLARI. Kaynak makinenin MUTLAK YOLLARINI ve
     PID lerini tasirlar; hedefte zararlidirlar (bkz. asagidaki test). */
  fs.mkdirSync(path.join(legacyLocal, '.buyerlog-db-recovery'), { recursive: true });
  fs.writeFileSync(path.join(legacyLocal, '.buyerlog-db-recovery', 'abc.intent.json'),
    JSON.stringify({ target: path.join(legacyLocal, 'BuyerLogLocal.db'), mutationId: 'x' }));
  fs.writeFileSync(path.join(legacyLocal, '.buyerlog-db-recovery', 'abc.payload'), 'YARIM YAZMA');
  fs.mkdirSync(path.join(legacyLocal, 'write-recovery'), { recursive: true });
  fs.writeFileSync(path.join(legacyLocal, 'write-recovery', 'w.intent.json'), '{}');
  fs.mkdirSync(path.join(legacyLocal, 'BuyerLogLocal.db.write-lock'), { recursive: true });
  fs.writeFileSync(path.join(legacyLocal, 'BuyerLogLocal.db.write-lock', 'owner.json'),
    JSON.stringify({ pid: 4242, machine: 'ESKI-PC' }));
  fs.mkdirSync(path.join(legacyLocal, 'runtime'), { recursive: true });
  fs.writeFileSync(path.join(legacyLocal, 'runtime', 'watchdog.json'), JSON.stringify({ watchdogPid: 4242 }));

  return { base, pkg, hostAppData, hostLocal, legacyApp, legacyLocal };
}

function run(world, extraArgs) {
  return execFileSync(process.execPath,
    [path.join(world.pkg, 'scripts', 'import-legacy-data.js')].concat(extraArgs || []),
    {
      encoding: 'utf8', timeout: 60000,
      env: {
        ...process.env,
        BL_HOST_APPDATA: world.hostAppData,
        BL_HOST_LOCALAPPDATA: world.hostLocal,
        // Yönlendirme tuzağını taklit et: gerçek değişkenler paketin içini gösteriyor.
        APPDATA: path.join(world.pkg, 'data', 'portable-appdata'),
        LOCALAPPDATA: path.join(world.pkg, 'data', 'portable-localappdata'),
        // Testin gercek makinedeki eski kurulumlari bulmasini engelle: tarama
        // yolu acikca belirtiliyor (kullanicilar da bunu kullanabilir).
        BL_LEGACY_INSTALL_ROOTS: world.legacyInstall || '',
      },
    });
}

const read = file => { try { return fs.readFileSync(file, 'utf8'); } catch (_) { return null; } };

test('v9.54 eski AppData verisi bulunup paketin içine taşınıyor', () => {
  const world = makeWorld();
  const out = run(world);
  assert.match(out, /Uygulama verisi/);
  assert.match(out, /Yerel veri/);
  assert.equal(read(path.join(world.pkg, 'data', 'app', 'fx-rates.json')), '{"USD":1}');
  assert.equal(read(path.join(world.pkg, 'data', 'app', 'auth', 'token.json')), 'gizli');
  assert.equal(read(path.join(world.pkg, 'data', 'local', 'BuyerLogLocal.db')), 'VERITABANI');
  assert.equal(read(path.join(world.pkg, 'data', 'local', 'model-files', 'a.png')), 'GORSEL');
});

/* §3 — bu olmadan betik hiçbir şey bulamaz. */
test('v9.54 APPDATA yönlendirmesine rağmen GERÇEK Windows klasörleri okunuyor', () => {
  const world = makeWorld();
  run(world);
  // Yönlendirilmiş APPDATA paketin içiydi; oradan değil host klasöründen almalı.
  assert.equal(read(path.join(world.pkg, 'data', 'app', 'fx-rates.json')), '{"USD":1}');
  assert.match(SOURCE, /BL_HOST_APPDATA/);
  assert.match(SOURCE, /BL_HOST_LOCALAPPDATA/);
  /* Paketin kendi içi kaynak olarak kabul edilmemeli.
     v10.14 — koruma tek satırdan ortak bir kapıya (isInsidePackage) taşındı ve
     GENİŞLETİLDİ. Masaüstü (Electron) kipinde uygulama çekirdeği
     resources\app altında, değişebilir veri ise BuyerLog.exe'nin yanındaki
     data\ klasöründe: artık üç kök birden kontrol ediliyor. Kilitlenen kusur
     aynı — paket kendi kendini kaynak sanmamalı. */
  assert.match(SOURCE, /function isInsidePackage\(candidate\)/);
  assert.match(SOURCE, /\[PACKAGE_ROOT, PORTABLE_ROOT, DATA_ROOT\]/);
  for (const guard of ['isInsidePackage(source)', 'isInsidePackage(item)', 'isInsidePackage(live)']) {
    assert.ok(SOURCE.includes(guard), guard + ' koruması kayıp');
  }
});

/* §1 — en tehlikeli hata: kaynağın bozulması. */
test('v9.54 kaynak dosyalar SİLİNMEZ ve DEĞİŞTİRİLMEZ', () => {
  const world = makeWorld();
  run(world);
  assert.equal(read(path.join(world.legacyApp, 'fx-rates.json')), '{"USD":1}', 'kaynak yerinde kalmalı');
  assert.equal(read(path.join(world.legacyLocal, 'BuyerLogLocal.db')), 'VERITABANI');
  assert.equal(read(path.join(world.legacyLocal, 'model-files', 'a.png')), 'GORSEL');
  // Kodda silme çağrısı hiç olmamalı.
  assert.doesNotMatch(SOURCE, /rmSync|unlinkSync|rmdirSync|renameSync/, 'taşıma silme/taşıma yapmamalı');
});

/* §2 — ikinci çalıştırma kullanıcının işini yok edemez. */
test('v9.54 portable\'daki mevcut dosyanın ÜSTÜNE yazılmaz', () => {
  const world = makeWorld();
  const target = path.join(world.pkg, 'data', 'app', 'fx-rates.json');
  fs.writeFileSync(target, 'PORTABLE-DA-DEGISTIRILDI');
  const out = run(world, ['--force']);
  assert.equal(read(target), 'PORTABLE-DA-DEGISTIRILDI', 'portable\'daki değişiklik korunmalı');
  assert.match(out, /Atlanan\s*:\s*[1-9]/);
});

test('v9.54 paket kullanılmaya başlandıysa taşıma kendiliğinden ÇALIŞMAZ', () => {
  const world = makeWorld();
  fs.writeFileSync(path.join(world.pkg, 'data', 'local', 'BuyerLogLocal.db'), 'PORTABLE-VERISI');
  const out = run(world);
  assert.match(out, /ATLANDI/);
  assert.equal(read(path.join(world.pkg, 'data', 'local', 'BuyerLogLocal.db')), 'PORTABLE-VERISI');
  // --force ile bilerek zorlanabilmeli, ama yine üstüne yazmamalı.
  const forced = run(world, ['--force']);
  assert.doesNotMatch(forced, /ATLANDI/);
  assert.equal(read(path.join(world.pkg, 'data', 'local', 'BuyerLogLocal.db')), 'PORTABLE-VERISI');
});

/* §4 — yedek ve arşivler tanımı gereği gereksiz. */
test('v9.54 yedek, arşiv ve anlık görüntüler taşınmıyor', () => {
  const world = makeWorld();
  const out = run(world);
  assert.equal(read(path.join(world.pkg, 'data', 'app', 'fx-rates.json.bak')), null, '.bak taşınmamalı');
  assert.equal(read(path.join(world.pkg, 'data', 'local', 'BuyerLogLocal.db.bak')), null);
  assert.equal(read(path.join(world.pkg, 'data', 'local', 'data.zip')), null, 'arşiv taşınmamalı');
  assert.equal(read(path.join(world.pkg, 'data', 'local', 'model-snapshots', 'snap.json')), null);
  assert.match(out, /Gereksiz\s*:\s*[1-9]/);
});

test('v9.54 --skip-caches görsel önbelleklerini atlar, gerçek veriyi taşır', () => {
  const world = makeWorld();
  run(world, ['--skip-caches']);
  assert.equal(read(path.join(world.pkg, 'data', 'local', 'model-files', 'a.png')), null, 'önbellek atlanmalı');
  assert.equal(read(path.join(world.pkg, 'data', 'local', 'BuyerLogLocal.db')), 'VERITABANI', 'gerçek veri taşınmalı');
});

test('v9.54 --dry-run hiçbir şey yazmaz', () => {
  const world = makeWorld();
  const out = run(world, ['--dry-run']);
  assert.match(out, /deneme, hicbir sey yazilmadi/);
  assert.equal(read(path.join(world.pkg, 'data', 'local', 'BuyerLogLocal.db')), null);
});

test('v9.54 eski veri yoksa sessizce ve hatasız geçilir', () => {
  const world = makeWorld();
  fs.rmSync(world.legacyApp, { recursive: true, force: true });
  fs.rmSync(world.legacyLocal, { recursive: true, force: true });
  const out = run(world);
  assert.match(out, /bulunamadi/i);
});

/* v10.14 — CANLIDA GORULEN KUSUR.
 *
 * Masaustu paketi ilk acilista veriyi tasidi, 2098 dosya kopyalandi, yerel
 * veritabani dogrulandi ve program acildi. Ama CP ve Siparisler BOSTU.
 * Sebep, veritabani dosyasi degil YANINDAKI artiklardi: tasinan kurtarma
 * niyet dosyalari kaynak kurulumun MUTLAK yolunu gosteriyordu ve dayanikli
 * yazma katmani acilista bunu haklı olarak reddediyordu:
 *
 *   LOCAL_DB_READY_FAILED
 *   Recovery target is outside allowed data roots:
 *   C:\\Users\\<kullanici>\\AppData\\Local\\BuyerLog\\BuyerLogLocal.db
 *
 * Tek bir reddedilen niyet dosyasi TUM yerel veritabani acilisini dusuruyor.
 * Ayni sinifta: kaynak makinenin PID sini tasiyan yazma kilidi ve gozetmen
 * PID dosyasi. Bunlar is verisi degil, calisan bir surecin izleridir.
 */
test('v10.14 çalışma zamanı artıkları TAŞINMAZ — mutlak yol taşıyan kurtarma niyeti yerel veritabanı açılışını düşürüyordu', () => {
  const world = makeWorld();
  run(world);
  const local = path.join(world.pkg, 'data', 'local');

  // Kalıcı veri TAŞINIR.
  assert.equal(read(path.join(local, 'BuyerLogLocal.db')), 'VERITABANI');
  assert.equal(read(path.join(local, 'model-files', 'a.png')), 'GORSEL');

  // Çalışma zamanı artıkları TAŞINMAZ.
  for (const artifact of ['.buyerlog-db-recovery', 'write-recovery', 'BuyerLogLocal.db.write-lock', 'runtime']) {
    assert.equal(fs.existsSync(path.join(local, artifact)), false,
      artifact + ' taşınmış: hedefte yabancı mutlak yol/PID bırakır');
  }

  // KAYNAK bozulmadı: eski kurulum kendi artıklarıyla çalışmaya devam eder.
  assert.equal(fs.existsSync(path.join(world.legacyLocal, '.buyerlog-db-recovery', 'abc.intent.json')), true);
  assert.equal(fs.existsSync(path.join(world.legacyLocal, 'BuyerLogLocal.db.write-lock', 'owner.json')), true);
});

test('v10.14 artık elemesi dizin adına göre çalışır, .db ve .wal her zaman taşınır', () => {
  const world = makeWorld();
  fs.writeFileSync(path.join(world.legacyLocal, 'BuyerLogLocal.db.wal'), 'BEKLEYEN');
  run(world);
  const local = path.join(world.pkg, 'data', 'local');
  // Bekleyen/çevrimdışı günlük KALICI veridir; artık değildir.
  assert.equal(read(path.join(local, 'BuyerLogLocal.db.wal')), 'BEKLEYEN');
});
