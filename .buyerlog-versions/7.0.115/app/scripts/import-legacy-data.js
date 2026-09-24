'use strict';

/*
 * Buyer Log — ESKİ KURULUMDAN VERİ TAŞIMA
 *
 * Portable paketin açıldığı bilgisayarda eski bir Buyer Log kurulumu olabilir
 * ve kullanıcı verileri Windows'un AppData klasörlerinde kalmış olabilir.
 * Bu betik onları bulup paketin KENDİ içine taşır; portable tek başına
 * çalışan bir uygulama hâline gelir.
 *
 * ARANAN YERLER (scripts/migration-roots.js ile aynı tanımlar):
 *   %APPDATA%\Buyer Log          → uygulama verisi
 *   %LOCALAPPDATA%\BuyerLog      → yerel veritabanı, model dosyaları, görseller
 *   eski kurulum klasörü         → server\data (varsa)
 *
 * GÜVENLİK KARARLARI — bu betik veri taşır, en tehlikeli iş sınıfı:
 *
 * 1) KAYNAK ASLA SİLİNMEZ, ASLA DEĞİŞTİRİLMEZ. Yalnız kopyalanır. Eski kurulum
 *    çalışmaya devam edebilir; taşıma geri alınamaz bir işlem değildir.
 *
 * 2) ÜSTÜNE YAZILMAZ. Portable'ın kendi verisi zaten varsa o dosya atlanır.
 *    İkinci kez çalıştırmak, kullanıcının portable'da yaptığı işi silemez.
 *
 * 3) PAKET KULLANILMAYA BAŞLANDIYSA HİÇ ÇALIŞMAZ. Yerel veritabanı oluşmuşsa
 *    "ilk açılış" değildir; taşıma atlanır. --force ile bilerek zorlanabilir.
 *
 * 4) APPDATA YÖNLENDİRMESİ. Başlatıcı APPDATA/LOCALAPPDATA değişkenlerini
 *    paketin içine çeviriyor. Bu yüzden GERÇEK Windows yolları başlatıcının
 *    sakladığı BL_HOST_* değişkenlerinden okunur; yoksa kayıt defterinden.
 *    Bu olmadan betik kendi kendini kaynak sanardı.
 *
 * Kullanım: node scripts/import-legacy-data.js [--force] [--dry-run]
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const PACKAGE_ROOT = path.resolve(__dirname, '..');
const args = new Set(process.argv.slice(2));
const FORCE = args.has('--force');
const DRY_RUN = args.has('--dry-run');

/* Paketin kendi veri kökleri (START-BUYER-LOG.cmd ile aynı düzen).
 *
 * v10 — MASAÜSTÜ (Electron) KİPİ. Batch başlatıcıda betik paketin kökünde
 * durduğu için veri kökü __dirname'den türetilebiliyordu. Electron'da
 * uygulama çekirdeği resources\app altında, DEĞİŞEBİLİR veri ise
 * BuyerLog.exe'nin yanındaki data\ klasöründe. Yolu türetmeye devam etseydik
 * taşınan veri app çekirdeğinin içine yazılırdı ve ilk güncellemede silinirdi.
 * Bu yüzden kök AÇIKÇA verilebilir; verilmezse eski davranış aynen sürer.
 */
const PORTABLE_ROOT = path.resolve(process.env.BUYER_LOG_PORTABLE_ROOT || PACKAGE_ROOT);
const DATA_ROOT = path.resolve(process.env.BUYER_LOG_PORTABLE_DATA_ROOT || path.join(PACKAGE_ROOT, 'data'));
const TARGET = {
  server: path.join(DATA_ROOT, 'server'),
  app: path.join(DATA_ROOT, 'app'),
  local: path.join(DATA_ROOT, 'local'),
  auth: path.join(DATA_ROOT, 'auth'),
};

/* Kaynak, paketin KENDİ alanı mı? Öyleyse taşıma anlamsız ve tehlikelidir
   (kendi üstüne kopyalama). Hem uygulama çekirdeği hem portable kök hem de
   veri kökü kontrol edilir; masaüstü kipinde bunlar farklı klasörlerdir. */
function isInsidePackage(candidate) {
  const target = path.resolve(candidate).toLowerCase();
  return [PACKAGE_ROOT, PORTABLE_ROOT, DATA_ROOT]
    .some(root => target.startsWith(path.resolve(root).toLowerCase()));
}

const SKIP_CACHES = args.has('--skip-caches');

/* TANIMI GEREĞİ GEREKSİZ olanlar: yedekler ve arşivler. Bunlar canlı verinin
   kopyası; taşımak paketi gereksiz yere büyütür. Bu makinede 1,8 GB'ın
   ~740 MB'ı tam olarak bunlardı. */
const REDUNDANT_DIRS = new Set(['model-snapshots']);
const REDUNDANT_FILES = [/\.bak$/i, /\.tmp$/i, /\.old$/i, /^data\.zip$/i, /\.log$/i];

/* ÇALIŞMA ZAMANI ARTIKLARI — v10.14.
 *
 * Bunlar iş verisi DEĞİL, çalışan bir sürecin geçici izleridir ve içlerinde
 * KAYNAK MAKİNENİN MUTLAK YOLLARI ile PID'leri vardır. Taşınırlarsa hedefte
 * anlamsız değil, ZARARLI olurlar:
 *
 * · .buyerlog-db-recovery / write-recovery — yarım kalmış bir yazmayı
 *   tamamlamak için tutulan niyet dosyaları. Hedefleri kaynak kurulumun
 *   mutlak yoludur. Portable kökte açılınca dayanıklı-yazma katmanı bunları
 *   haklı olarak reddeder ve TÜM yerel veritabanı açılışı düşer:
 *
 *     LOCAL_DB_READY_FAILED
 *     BuyerLogLocal.db okunamadı … Recovery target is outside allowed
 *     data roots: C:\\Users\\<kullanıcı>\\AppData\\Local\\BuyerLog\\BuyerLogLocal.db
 *
 *   Sonuç canlıda görüldü: program açılıyor, arayüz çiziliyor, ama CP ve
 *   Siparişler BOŞ. Veritabanı dosyası sapasağlam kopyalanmıştı; açılmasını
 *   engelleyen şey yanındaki bu artıklardı.
 *
 * · *.write-lock — hangi sürecin veritabanına yazdığını tutan sahiplik
 *   kilidi. Kaynak makinenin PID'sini taşır; kopyalanması hedefte yabancı
 *   bir sahibe işaret eden bayat bir kilit bırakır.
 *
 * · runtime — gözetmen PID'leri (watchdog.json).
 *
 * Kaynak kurulum kendi artıklarını kendi kurtarır; bunları taşımamak veri
 * kaybı DEĞİLDİR. Veritabanının kalıcı hâli .db ve .wal dosyalarındadır ve
 * ikisi de taşınır.
 */
const RUNTIME_ARTIFACT_DIRS = new Set(['.buyerlog-db-recovery', 'write-recovery', 'runtime', 'browser-profiles']);
const RUNTIME_ARTIFACT_DIR_PATTERNS = [/\.write-lock$/i];

function isRuntimeArtifactDir(name) {
  return RUNTIME_ARTIFACT_DIRS.has(name) || RUNTIME_ARTIFACT_DIR_PATTERNS.some(p => p.test(name));
}

/* Yeniden üretilebilir görsel önbellekleri. Varsayılan olarak TAŞINIR (PLM'den
   yeniden çekmek pahalı), ama --skip-caches ile hafif kurulum yapılabilir. */
const CACHE_DIRS = new Set(['model-files', 'collection-images', 'model-snapshots', 'qtx-files']);

function isRedundant(name, isDirectory) {
  if (isDirectory) {
    return REDUNDANT_DIRS.has(name) || isRuntimeArtifactDir(name)
      || (SKIP_CACHES && CACHE_DIRS.has(name));
  }
  return REDUNDANT_FILES.some(pattern => pattern.test(name));
}

const report = { found: [], copied: 0, skipped: 0, redundant: 0, bytes: 0, notes: [] };

/* GERÇEK Windows AppData yolları (§4). Başlatıcı değişkenleri çevirdiği için
   process.env.APPDATA paketin içini gösteriyor olabilir. */
function hostFolder(kind) {
  const saved = kind === 'appdata' ? process.env.BL_HOST_APPDATA : process.env.BL_HOST_LOCALAPPDATA;
  if (saved && fs.existsSync(saved)) return saved;
  const live = kind === 'appdata' ? process.env.APPDATA : process.env.LOCALAPPDATA;
  // Paketin içini gösteriyorsa güvenilmez.
  if (live && !isInsidePackage(live) && fs.existsSync(live)) return live;
  try {
    const key = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Shell Folders';
    const name = kind === 'appdata' ? 'AppData' : 'Local AppData';
    const out = execFileSync('reg', ['query', key, '/v', name], { encoding: 'utf8', timeout: 15000, windowsHide: true });
    const match = new RegExp(name + '\\s+REG_[A-Z_]+\\s+(.+)').exec(out);
    const resolved = match ? match[1].trim() : '';
    return resolved && fs.existsSync(resolved) ? resolved : '';
  } catch (_) { return ''; }
}

function dirSize(dir) {
  let total = 0;
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) total += dirSize(full);
      else if (entry.isFile()) { try { total += fs.statSync(full).size; } catch (_) { /* atla */ } }
    }
  } catch (_) { /* okunamayan klasör */ }
  return total;
}

/* Üstüne YAZMAZ (§2): hedefte dosya varsa atlar. */
function copyTree(source, destination) {
  let entries;
  try { entries = fs.readdirSync(source, { withFileTypes: true }); } catch (_) { return; }
  for (const entry of entries) {
    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    if (isRedundant(entry.name, entry.isDirectory())) { report.redundant += 1; continue; }
    if (entry.isDirectory()) { copyTree(from, to); continue; }
    if (!entry.isFile()) continue;
    if (fs.existsSync(to)) { report.skipped += 1; continue; }
    if (DRY_RUN) { report.copied += 1; continue; }
    try {
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(from, to);
      report.copied += 1;
      try { report.bytes += fs.statSync(to).size; } catch (_) { /* atla */ }
      // Büyük taşımalarda ekran donmuş görünmesin: her 200 dosyada bir işaret.
      if (report.copied % 200 === 0) process.stdout.write('  ... ' + report.copied + ' dosya tasindi\r\n');
    } catch (error) {
      report.notes.push('Kopyalanamadi: ' + entry.name + ' (' + (error.code || error.message) + ')');
    }
  }
}

function importFrom(label, source, destination) {
  if (!source || !fs.existsSync(source)) return false;
  // Kaynak paketin kendi içiyse taşıma anlamsız ve tehlikeli.
  if (isInsidePackage(source)) return false;
  const size = dirSize(source);
  report.found.push({ label, source, bytes: size });
  copyTree(source, destination);
  return true;
}

/* Eski kurulum klasörünü bulmaya çalış: kullanıcının bilinen konumları.
   Tüm diski taramayız — yavaş ve gereksiz. */
function legacyInstallRoots() {
  /* Kullanıcı eski kurulumu bilinmeyen bir yere koymuş olabilir; noktalı
     virgülle ayrılmış yol listesiyle doğrudan gösterebilir. */
  /* TANIMLI olması yeterli: boş değer "hiçbir kurulum klasörü tarama" demektir.
     `|| ''` ile boşa düşmek, boş listeyi "ayar yok" sanıp tahmine dönerdi. */
  if (process.env.BL_LEGACY_INSTALL_ROOTS !== undefined) {
    const override = String(process.env.BL_LEGACY_INSTALL_ROOTS).trim();
    if (!override) return [];
    return override.split(';').map(item => item.trim()).filter(item => {
      try { return item && !isInsidePackage(item) && fs.existsSync(path.join(item, 'server', 'data')); } catch (_) { return false; }
    });
  }
  const home = os.homedir();
  const candidates = [
    path.join(home, 'Desktop', 'Buyer Log'),
    path.join(home, 'Desktop', 'lcw-order-control'),
    path.join(home, 'Documents', 'Buyer Log'),
    'C:\\BuyerLog',
    'C:\\Buyer Log',
  ];
  return candidates.filter(item => {
    try {
      return !isInsidePackage(item)
        && fs.existsSync(path.join(item, 'server', 'data'));
    } catch (_) { return false; }
  });
}

function alreadyInUse() {
  const db = path.join(TARGET.local, 'BuyerLogLocal.db');
  try { return fs.existsSync(db) && fs.statSync(db).size > 0; } catch (_) { return false; }
}

function main() {
  const lines = [];
  lines.push('');
  lines.push('  BUYER LOG - ESKI VERI TASIMA');
  lines.push('  ' + '-'.repeat(64));

  if (alreadyInUse() && !FORCE) {
    lines.push('  Portable zaten kullanilmaya baslanmis (yerel veritabani mevcut).');
    lines.push('  Mevcut verinin uzerine yazmamak icin tasima ATLANDI.');
    lines.push('  Yine de denemek isterseniz: --force');
    lines.push('');
    process.stdout.write(lines.join('\r\n') + '\r\n');
    return;
  }

  for (const key of Object.keys(TARGET)) {
    try { fs.mkdirSync(TARGET[key], { recursive: true }); } catch (_) { /* atla */ }
  }

  const appData = hostFolder('appdata');
  const localAppData = hostFolder('localappdata');

  if (appData) importFrom('Uygulama verisi (%APPDATA%)', path.join(appData, 'Buyer Log'), TARGET.app);
  if (localAppData) importFrom('Yerel veri (%LOCALAPPDATA%)', path.join(localAppData, 'BuyerLog'), TARGET.local);

  for (const root of legacyInstallRoots()) {
    importFrom('Eski kurulum: ' + root, path.join(root, 'server', 'data'), TARGET.server);
  }

  if (!report.found.length) {
    lines.push('  Bu bilgisayarda eski Buyer Log verisi bulunamadi.');
    lines.push('  Portable kendi verisiyle calisacak; yapilacak bir sey yok.');
  } else {
    for (const item of report.found) {
      lines.push('  Bulundu : ' + item.label);
      lines.push('            ' + item.source + '  (' + Math.round(item.bytes / 1048576) + ' MB)');
    }
    lines.push('  ' + '-'.repeat(64));
    lines.push('  Tasinan dosya : ' + report.copied + (DRY_RUN ? '  (deneme, hicbir sey yazilmadi)' : ''));
    lines.push('  Atlanan       : ' + report.skipped + '  (portable\'da zaten vardi)');
    lines.push('  Gereksiz      : ' + report.redundant + '  (yedek/arsiv/anlik goruntu)');
    if (!DRY_RUN) lines.push('  Boyut         : ' + Math.round(report.bytes / 1048576) + ' MB');
    lines.push('  Kaynak dosyalar SILINMEDI; eski kurulum calismaya devam edebilir.');
  }
  for (const note of report.notes.slice(0, 10)) lines.push('  ! ' + note);
  lines.push('');
  process.stdout.write(lines.join('\r\n') + '\r\n');
}

main();
