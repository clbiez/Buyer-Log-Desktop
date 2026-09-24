'use strict';

/*
 * Buyer Log — İLK AÇILIŞTA ESKİ KURULUMDAN VERİ TAŞIMA (masaüstü kipi)
 *
 * BuyerLog.exe, üzerinde ESKİ (CMD + tarayıcı) Buyer Log çalışmış bir
 * bilgisayarda ilk kez açıldığında kullanıcının verisini bulup portable veri
 * köküne getirir. Kullanıcının APPDATA klasörlerinde dosya araması gerekmez.
 *
 * BU MODÜL TAŞIMAYI KENDİ YAPMAZ. Taşımayı scripts/import-legacy-data.js
 * yapıyor ve yıllardır üretimde: kaynağı asla silmez, üstüne yazmaz, yedek ve
 * anlık görüntüleri elemiş, gerçek Windows AppData yollarını registry'den bile
 * bulabiliyor. İkinci bir taşıyıcı yazmak, iki farklı davranış demek olurdu.
 * Buradaki katman ona şunları ekler:
 *
 * 1) AŞAMALANDIRMA. Taşıma önce data\.staging altına yapılır. Yarım kalan bir
 *    taşıma ASLA etkin veri kökü hâline gelmez; backend onu görmez bile.
 *
 * 2) DOĞRULAMA. "Dosyalar kopyalandı" başarı değildir. Yerel veritabanı
 *    gerçekten açılıyor mu, kayıt deposu duruyor mu, ayar dosyaları
 *    ayrıştırılabiliyor mu — etkinleştirmeden ÖNCE ölçülür.
 *
 * 3) ETKİNLEŞTİRME ÜSTÜNE YAZMAZ. Portable'ın kendi verisi varsa o kazanır.
 *    Aşamalanan dosya atlanır; kullanıcının yeni işi eski kopyayla ezilmez.
 *
 * 4) FİKİRDEŞLİK (idempotence). Durum data\desktop-migration.json'a yazılır.
 *    BuyerLog.exe'yi yüz kez açmak taşımayı bir kez çalıştırır; ikinci kopya
 *    kullanıcı, ikinci cihaz kimliği veya sıfırlanmış sync durumu üretmez.
 *
 * 5) BAŞARISIZLIKTA SESSİZ TEMİZ PROFİL YOK. Taşıma başarısız olursa etkin
 *    veri kökü değiştirilmez, aşamalanan klasör SİLİNMEZ, eski kurulum
 *    ellenmez ve kullanıcıya okunabilir bir hata gösterilir. Boş bir profille
 *    açılıp "verin yok" demek, en tehlikeli başarısızlık türüdür.
 *
 * KAYNAK HİÇBİR KOŞULDA DEĞİŞTİRİLMEZ. Eski kurulum, masaüstü sürümü kabul
 * edilene kadar çalışır durumda kalır (geri dönüş yolu).
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const MIGRATION_SCHEMA_VERSION = 1;
const IMPORT_TIMEOUT_MS = 30 * 60 * 1000;

function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return fallback; }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = file + '.' + process.pid + '.tmp';
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', 'utf8');
  fs.renameSync(temporary, file);
}

function fileSize(file) {
  try { return fs.statSync(file).size; } catch (_) { return 0; }
}

function hashFile(file) {
  try {
    return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  } catch (_) { return ''; }
}

function inventory(root) {
  let files = 0, bytes = 0;
  const walk = directory => {
    let entries;
    try { entries = fs.readdirSync(directory, { withFileTypes: true }); } catch (_) { return; }
    for (const entry of entries) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) { files += 1; bytes += fileSize(full); }
    }
  };
  walk(root);
  return { files, bytes };
}

/* Portable zaten kullanılıyorsa "ilk açılış" değildir (§4). */
function portableAlreadyInUse(paths) {
  return fileSize(paths.localDbPath) > 0;
}

function readMigrationState(paths) {
  return readJson(paths.migrationStatePath, null);
}

/*
 * Yerel veritabanı GERÇEKTEN açılıyor mu (§2)?
 *
 * Buyer Log'un yerel-öncelikli deposu bir JSON delta store'dur: kök nesnede
 * `records` sözlüğü bulunur (bkz. scripts/create-portable-package.js →
 * deltaDocument). Ayrıştırılamayan bir dosya, kopyalanmış olsa bile
 * KULLANILAMAZ veridir; etkinleştirmek onu sessizce kaybetmek olurdu.
 */
function verifyLocalDatabase(dbPath) {
  if (!fs.existsSync(dbPath)) {
    return { present: false, ok: true, reason: 'Yerel veritabanı taşınmadı (eski kurulumda yoktu).' };
  }
  const bytes = fileSize(dbPath);
  if (!bytes) return { present: true, ok: false, reason: 'Yerel veritabanı boş kopyalandı.' };
  let parsed;
  try { parsed = JSON.parse(fs.readFileSync(dbPath, 'utf8')); } catch (error) {
    return { present: true, ok: false, bytes, reason: 'Yerel veritabanı ayrıştırılamadı: ' + error.message };
  }
  if (!parsed || typeof parsed !== 'object' || !parsed.records || typeof parsed.records !== 'object') {
    return { present: true, ok: false, bytes, reason: 'Yerel veritabanında kayıt deposu (records) bulunamadı.' };
  }
  const storeKeys = Object.keys(parsed.records);
  return {
    present: true,
    ok: true,
    bytes,
    sha256: hashFile(dbPath),
    storeCount: storeKeys.length,
    stores: storeKeys.filter(key => key.startsWith('store:')).slice(0, 40),
  };
}

/*
 * YABANCI KÖKE İŞARET EDEN KURTARMA NİYETİ VAR MI? (v10.14)
 *
 * Canlıda görülen kusur: taşıma 2098 dosyayı kopyaladı, yerel veritabanı
 * ayrıştırıldı ve "başarılı" sayıldı — ama program açıldığında CP ve
 * Siparişler BOŞTU. Veritabanı dosyası sağlamdı; açılmasını engelleyen şey
 * yanına kopyalanmış kurtarma niyet dosyalarıydı. İçlerindeki hedef kaynak
 * kurulumun MUTLAK yoluydu ve dayanıklı-yazma katmanı açılışta bunu haklı
 * olarak reddediyordu:
 *
 *   Recovery target is outside allowed data roots:
 *   C:\Users\<kullanıcı>\AppData\Local\BuyerLog\BuyerLogLocal.db
 *
 * Tek bir reddedilen niyet TÜM yerel veritabanı açılışını düşürüyor.
 *
 * Asıl çözüm bu dosyaları hiç taşımamaktır (scripts/import-legacy-data.js →
 * RUNTIME_ARTIFACT_DIRS). Buradaki kontrol ikinci settir: "dosyalar kopyalandı"
 * ile "veri gerçekten KULLANILABİLİR" arasındaki farkı ölçer. Bir gün başka
 * bir yol aynı zehri taşırsa, taşıma etkinleştirilmeden önce durur.
 */
function verifyRecoveryIntents(root) {
  const foreign = [];
  let checked = 0;
  const rootLower = path.resolve(root).toLowerCase();
  const walk = directory => {
    let entries;
    try { entries = fs.readdirSync(directory, { withFileTypes: true }); } catch (_) { return; }
    for (const entry of entries) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!entry.isFile() || !/\.intent\.json$/i.test(entry.name)) continue;
      checked += 1;
      const intent = readJson(full, null);
      const target = intent && typeof intent.target === 'string' ? intent.target : '';
      if (!target) continue;
      if (!path.resolve(target).toLowerCase().startsWith(rootLower)) {
        foreign.push({ file: path.relative(root, full), target });
      }
    }
  };
  walk(root);
  return { checked, foreign };
}

/* Ayar/kural dosyaları ayrıştırılabiliyor mu? Bozuk JSON, uygulamayı açılışta
   düşüren türden bir hatadır; etkinleştirmeden önce görülmeli. */
function verifyJsonTree(root, limit = 400) {
  const broken = [];
  let checked = 0;
  const walk = directory => {
    let entries;
    try { entries = fs.readdirSync(directory, { withFileTypes: true }); } catch (_) { return; }
    for (const entry of entries) {
      if (checked >= limit) return;
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        /* Edge/Chromium profili Buyer Log ayarı değildir. İçindeki component
           manifestleri, koruma listeleri ve workspace verileri tarayıcıya ait
           çalışma-zamanı dosyalarıdır; JSON doğrulamasına sokulmaz. */
        const relative = path.relative(root, full).replace(/\\/g, '/').toLowerCase();
        if (relative === 'local/browser-profiles' || relative.startsWith('local/browser-profiles/')) continue;
        walk(full);
        continue;
      }
      if (!entry.isFile() || !/\.json$/i.test(entry.name)) continue;
      checked += 1;
      if (fileSize(full) === 0) continue;
      try { JSON.parse(fs.readFileSync(full, 'utf8')); } catch (error) {
        broken.push({ file: path.relative(root, full), reason: error.message.slice(0, 120) });
      }
    }
  };
  walk(root);
  return { checked, broken };
}

/* browser-profiles iş verisi değildir ve önceki başarısız taşıma denemesinden
   .staging altında kalmış olabilir. Yeni sürüm onu artık kaynaktan kopyalamasa
   bile eski staging kalıntısını etkinleştirmeden önce temizlemek gerekir. */
function removeStagedBrowserProfiles(stagingRoot, log) {
  const browserProfiles = path.join(stagingRoot, 'local', 'browser-profiles');
  if (!fs.existsSync(browserProfiles)) return false;
  try {
    fs.rmSync(browserProfiles, { recursive: true, force: true });
    log('Taşıma: Edge browser-profiles çalışma verisi atlandı.');
    return true;
  } catch (error) {
    log('UYARI: staging browser-profiles temizlenemedi: ' + error.message);
    return false;
  }
}

/*
 * Etkinleştirme (§3). Aşamalanan ağaç etkin veri köküne TAŞINIR; hedefte aynı
 * dosya varsa portable'ın kendi kopyası korunur ve aşamalanan atlanır.
 * Aynı bölümde rename anlıktır; farklı bölüm/kilit durumunda kopyalamaya düşer.
 */
function activateTree(from, to, stats) {
  let entries;
  try { entries = fs.readdirSync(from, { withFileTypes: true }); } catch (_) { return; }
  fs.mkdirSync(to, { recursive: true });
  for (const entry of entries) {
    const source = path.join(from, entry.name);
    const target = path.join(to, entry.name);
    if (entry.isDirectory()) { activateTree(source, target, stats); continue; }
    if (!entry.isFile()) continue;
    if (fs.existsSync(target)) { stats.kept += 1; continue; }
    try {
      fs.renameSync(source, target);
      stats.activated += 1;
    } catch (_) {
      try {
        fs.copyFileSync(source, target);
        fs.rmSync(source, { force: true });
        stats.activated += 1;
      } catch (error) {
        stats.failed.push(path.relative(from, source) + ' (' + (error.code || error.message) + ')');
      }
    }
  }
}

function removeIfEmpty(root) {
  try {
    const entries = fs.readdirSync(root, { withFileTypes: true });
    for (const entry of entries) if (entry.isDirectory()) removeIfEmpty(path.join(root, entry.name));
    if (!fs.readdirSync(root).length) fs.rmdirSync(root);
  } catch (_) { /* boş değilse dursun; silmeye çalışmıyoruz */ }
}

function runImportScript(options) {
  const { execPath, appCoreRoot, stagingRoot, portableRoot, log } = options;
  const script = path.join(appCoreRoot, 'scripts', 'import-legacy-data.js');
  if (!fs.existsSync(script)) {
    return Promise.resolve({ ok: false, reason: 'Taşıma betiği bulunamadı: ' + script, output: '' });
  }
  /* Taşıyıcı GERÇEK Windows AppData yollarını görmeli. Electron ana süreci
     bu değişkenleri hiç yönlendirmediği için (bkz. portable-paths.js §2)
     process.env burada doğrudan doğru değerleri taşır. */
  const env = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1',
    BUYER_LOG_PORTABLE_ROOT: portableRoot,
    BUYER_LOG_PORTABLE_DATA_ROOT: stagingRoot,
    BL_HOST_APPDATA: process.env.BL_HOST_APPDATA || process.env.APPDATA || '',
    BL_HOST_LOCALAPPDATA: process.env.BL_HOST_LOCALAPPDATA || process.env.LOCALAPPDATA || '',
  };
  return new Promise(resolve => {
    let output = '';
    let finished = false;
    const child = spawn(execPath, [script], {
      cwd: appCoreRoot, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
    });
    const timer = setTimeout(() => {
      if (finished) return;
      finished = true;
      try { child.kill(); } catch (_) {}
      resolve({ ok: false, reason: 'Taşıma zaman aşımına uğradı (30 dk).', output });
    }, IMPORT_TIMEOUT_MS);
    /*
     * BORU HER KOSULDA BOSALTILIR.
     *
     * Loglama bir sekilde bloke olur ya da hata atarsa, cocugun stdout
     * borusu dolar ve cocuk kopyalamanin ortasinda kilitlenir. Bu yuzden
     * once veri tuketilir, loglama ayri ve korumali yapilir.
     */
    const collect = chunk => {
      const text = chunk.toString('utf8');
      output += text;
      try {
        for (const line of text.split(/\r?\n/)) if (line.trim()) log('  [taşıma] ' + line.trim());
      } catch (_) { /* gunluk yazilamasa bile boru akmali */ }
    };
    if (child.stdout) child.stdout.on('data', collect);
    if (child.stderr) child.stderr.on('data', collect);
    child.on('error', error => {
      if (finished) return;
      finished = true; clearTimeout(timer);
      resolve({ ok: false, reason: 'Taşıma başlatılamadı: ' + error.message, output });
    });
    child.on('exit', code => {
      if (finished) return;
      finished = true; clearTimeout(timer);
      if (code === 0) resolve({ ok: true, output });
      else resolve({ ok: false, reason: 'Taşıma betiği ' + code + ' koduyla çıktı.', output });
    });
  });
}

/*
 * Ana giriş. Dönüş: { state, performed, detail }
 *   'skipped'    → daha önce tamamlanmış (§4)
 *   'in-use'     → portable zaten kullanılıyor, taşıma gereksiz
 *   'not-needed' → bu bilgisayarda eski Buyer Log verisi yok
 *   'complete'   → taşındı ve doğrulandı
 *   'failed'     → doğrulanamadı; etkin veri kökü DEĞİŞTİRİLMEDİ (§5)
 */
async function runFirstRunMigration(options = {}) {
  const { paths, appCoreRoot } = options;
  const log = typeof options.log === 'function' ? options.log : () => {};
  const execPath = options.execPath || process.execPath;
  const stagingRoot = path.join(paths.dataRoot, '.staging');

  const existing = readMigrationState(paths);
  if (existing && existing.state === 'complete' && Number(existing.schemaVersion) === MIGRATION_SCHEMA_VERSION) {
    log('Veri taşıma daha önce tamamlanmış (' + existing.completedAt + '); atlanıyor.');
    return { state: 'skipped', performed: false, detail: existing };
  }

  if (portableAlreadyInUse(paths)) {
    const record = {
      schemaVersion: MIGRATION_SCHEMA_VERSION,
      state: 'complete',
      reason: 'portable-already-in-use',
      note: 'Yerel veritabanı zaten mevcuttu; eski kurulumdan taşıma yapılmadı.',
      completedAt: new Date().toISOString(),
      localDbBytes: fileSize(paths.localDbPath),
    };
    writeJson(paths.migrationStatePath, record);
    log('Portable veri kökü zaten kullanımda; taşıma gerekmiyor.');
    return { state: 'in-use', performed: false, detail: record };
  }

  log('İlk açılış: bu bilgisayarda eski Buyer Log verisi aranıyor…');
  const startedAt = new Date().toISOString();
  fs.mkdirSync(stagingRoot, { recursive: true });

  const imported = await runImportScript({ execPath, appCoreRoot, stagingRoot, portableRoot: paths.portableRoot, log });
  if (!imported.ok) {
    const record = {
      schemaVersion: MIGRATION_SCHEMA_VERSION, state: 'failed', startedAt,
      failedAt: new Date().toISOString(), stage: 'copy', reason: imported.reason,
      stagingRoot,
      note: 'Eski kurulum DEĞİŞTİRİLMEDİ. Aşamalanan klasör silinmedi; tekrar denenebilir.',
    };
    writeJson(paths.migrationStatePath, record);
    log('TAŞIMA BAŞARISIZ (kopyalama): ' + imported.reason);
    return { state: 'failed', performed: false, detail: record };
  }

  removeStagedBrowserProfiles(stagingRoot, log);
  const staged = inventory(stagingRoot);
  if (!staged.files) {
    removeIfEmpty(stagingRoot);
    const record = {
      schemaVersion: MIGRATION_SCHEMA_VERSION, state: 'complete', reason: 'no-legacy-data',
      note: 'Bu bilgisayarda taşınacak eski Buyer Log verisi bulunamadı; temiz kurulum olarak devam edildi.',
      startedAt, completedAt: new Date().toISOString(),
    };
    writeJson(paths.migrationStatePath, record);
    log('Eski Buyer Log verisi bulunamadı; temiz kurulum olarak devam ediliyor.');
    return { state: 'not-needed', performed: false, detail: record };
  }

  log('Taşınan: ' + staged.files + ' dosya · ' + Math.round(staged.bytes / 1048576) + ' MB. Doğrulanıyor…');
  const database = verifyLocalDatabase(path.join(stagingRoot, 'local', 'BuyerLogLocal.db'));
  const json = verifyJsonTree(stagingRoot);
  /* Aşamalanan ağaç, hedef kökün DIŞINI gösteren bir kurtarma niyeti taşıyorsa
     veritabanı hedefte AÇILAMAZ — dosya sağlam olsa bile. */
  const intents = verifyRecoveryIntents(stagingRoot);
  if (!database.ok || json.broken.length || intents.foreign.length) {
    const reason = !database.ok ? database.reason
      : (intents.foreign.length
        ? 'Taşınan kurtarma niyetleri bu bilgisayarın dışını gösteriyor ('
          + intents.foreign.map(item => item.file).slice(0, 3).join(', ')
          + '); bu hâliyle yerel veritabanı açılamaz.'
        : 'Taşınan ayar dosyaları ayrıştırılamadı: ' + json.broken.map(item => item.file).slice(0, 5).join(', '));
    const record = {
      schemaVersion: MIGRATION_SCHEMA_VERSION, state: 'failed', startedAt,
      failedAt: new Date().toISOString(), stage: 'verify',
      reason,
      staged, database, json, intents, stagingRoot,
      note: 'Doğrulama geçilemediği için veri ETKİNLEŞTİRİLMEDİ. Eski kurulum değiştirilmedi.',
    };
    writeJson(paths.migrationStatePath, record);
    log('TAŞIMA BAŞARISIZ (doğrulama): ' + record.reason);
    return { state: 'failed', performed: false, detail: record };
  }

  const stats = { activated: 0, kept: 0, failed: [] };
  for (const name of ['server', 'app', 'local', 'auth']) {
    const from = path.join(stagingRoot, name);
    if (fs.existsSync(from)) activateTree(from, path.join(paths.dataRoot, name), stats);
  }
  if (stats.failed.length) {
    const record = {
      schemaVersion: MIGRATION_SCHEMA_VERSION, state: 'failed', startedAt,
      failedAt: new Date().toISOString(), stage: 'activate',
      reason: 'Bazı dosyalar etkinleştirilemedi: ' + stats.failed.slice(0, 5).join(', '),
      staged, database, stats, stagingRoot,
      note: 'Aşamalanan klasör silinmedi; kalan dosyalar orada duruyor.',
    };
    writeJson(paths.migrationStatePath, record);
    log('TAŞIMA BAŞARISIZ (etkinleştirme): ' + record.reason);
    return { state: 'failed', performed: false, detail: record };
  }

  removeIfEmpty(stagingRoot);
  const rebasedSettings = rebasePortableSettings(paths, log);
  const activeDatabase = verifyLocalDatabase(paths.localDbPath);
  const record = {
    schemaVersion: MIGRATION_SCHEMA_VERSION,
    state: 'complete',
    reason: 'legacy-import',
    startedAt,
    completedAt: new Date().toISOString(),
    source: { appData: process.env.APPDATA || '', localAppData: process.env.LOCALAPPDATA || '' },
    staged,
    activated: stats.activated,
    keptExisting: stats.kept,
    database: activeDatabase,
    rebasedSettings,
    jsonChecked: json.checked,
    note: 'Kaynak dosyalar SİLİNMEDİ; eski kurulum geri dönüş yolu olarak çalışmaya devam edebilir.',
  };
  writeJson(paths.migrationStatePath, record);
  log('Veri taşıma tamamlandı: ' + stats.activated + ' dosya etkinleştirildi'
    + (activeDatabase.present ? ', yerel veritabanı ' + activeDatabase.storeCount + ' depo ile açıldı.' : '.'));
  return { state: 'complete', performed: true, detail: record };
}

/*
 * Taşınan ayarlardaki MUTLAK yolları portable köke çeker.
 *
 * Neden gerekli: sync-settings.json içindeki `localDbPath`, server.js:127'de
 * BUYER_LOG_LOCAL_DB ortam değişkenini EZİYOR. Eski kurulumdan gelen değer
 * %LOCALAPPDATA%\BuyerLog\BuyerLogLocal.db gibi bir yol taşır. Dokunmazsak:
 *
 *   - paket kendi kendine yetmez; klasörü başka bilgisayara kopyalayınca
 *     veritabanı GELMEZ,
 *   - o yol karşı bilgisayarda yoksa uygulama oraya BOŞ bir veritabanı açar
 *     ve `desktop-migration.json` "tamamlandı" dediği için o bilgisayardaki
 *     gerçek veri hiç taşınmaz — ekranda veri kaybı gibi görünür.
 *
 * Taşıma zaten veritabanını data/local altına KOPYALADI; ayarın da oraya
 * bakması gerekir. Kaynak dosyaya dokunulmaz (geri dönüş yolu korunur).
 *
 * sharedSyncRoot'a KASITLI olarak dokunulmaz: o bir ağ paylaşımıdır, portable
 * kökün içinde olması beklenmez ve hedef bilgisayarda kullanıcı ayarlar.
 */
function rebasePortableSettings(paths, log) {
  const file = path.join(paths.localDataRoot, 'sync-settings.json');
  const out = { file, changed: false };
  let raw = null;
  try { raw = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')); }
  catch (_) { return out; }
  if (!raw || typeof raw !== 'object') return out;

  const hedef = path.resolve(paths.localDbPath);
  const mevcut = String(raw.localDbPath || '').trim();
  out.previous = mevcut;
  if (!mevcut) return out;
  if (path.resolve(mevcut) === hedef) return out;

  raw.localDbPath = hedef;
  try {
    fs.writeFileSync(file, JSON.stringify(raw, null, 2), 'utf8');
    out.changed = true;
    out.current = hedef;
    log('Ayar portable köke çekildi: localDbPath ' + mevcut + ' -> ' + hedef);
  } catch (error) {
    out.error = error.message;
    log('UYARI: sync-settings.json güncellenemedi: ' + error.message);
  }
  return out;
}

/*
 * HER AÇILIŞTA çalışan emniyet ağı — klasör başka bilgisayara kopyalandığında.
 *
 * Taşıma yalnız BİR KEZ çalışır. Klasör `data/` ile birlikte kopyalanırsa
 * `desktop-migration.json` "tamamlandı" der, taşıma atlanır ve eski
 * bilgisayara ait mutlak `localDbPath` olduğu gibi kalır. O yol hedef
 * bilgisayarda yoksa uygulama oraya BOŞ bir veritabanı açar; kullanıcı bunu
 * veri kaybı olarak görür.
 *
 * Kural, veri kaybetmemek üzerine kuruludur:
 *
 *   dış yol VARSA   -> DOKUNMA. Orada gerçek veri olabilir; portable kopya
 *                      eski olabilir. Sessizce eskiye dönmektense uyar.
 *   dış yol YOKSA   -> portable köke çek. Kaybedilecek bir şey yok ve yabancı
 *                      bir konumda öksüz veritabanı yaratılması engellenir.
 */
function healPortableSettings(paths, log) {
  const file = path.join(paths.localDataRoot, 'sync-settings.json');
  const out = { file, changed: false, reason: null };
  let raw = null;
  try { raw = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')); }
  catch (_) { return out; }
  if (!raw || typeof raw !== 'object') return out;

  const mevcut = String(raw.localDbPath || '').trim();
  if (!mevcut) return out;

  const cozulmus = path.resolve(mevcut);
  const hedef = path.resolve(paths.localDbPath);
  if (cozulmus === hedef) return out;

  const kok = path.resolve(paths.dataRoot) + path.sep;
  if (cozulmus.toLowerCase().startsWith(kok.toLowerCase())) return out;

  if (fileSize(cozulmus) > 0) {
    out.reason = 'foreign-path-exists';
    out.previous = cozulmus;
    log('UYARI: yerel veritabanı paketin DIŞINDA: ' + cozulmus);
    log('       Klasörü başka bilgisayara kopyalarsanız veritabanı gelmez.');
    return out;
  }

  raw.localDbPath = hedef;
  try {
    fs.writeFileSync(file, JSON.stringify(raw, null, 2), 'utf8');
    out.changed = true;
    out.reason = 'foreign-path-missing';
    out.previous = cozulmus;
    out.current = hedef;
    log('Yerel veritabanı yolu bu bilgisayarda yok; portable köke çekildi.');
    log('  eski: ' + cozulmus);
    log('  yeni: ' + hedef);
  } catch (error) {
    out.error = error.message;
    log('UYARI: sync-settings.json onarılamadı: ' + error.message);
  }
  return out;
}

module.exports = {
  runFirstRunMigration,
  rebasePortableSettings,
  healPortableSettings,
  verifyLocalDatabase,
  verifyJsonTree,
  verifyRecoveryIntents,
  activateTree,
  inventory,
  portableAlreadyInUse,
  readMigrationState,
  MIGRATION_SCHEMA_VERSION,
};
