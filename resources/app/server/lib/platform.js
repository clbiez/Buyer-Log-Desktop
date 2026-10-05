'use strict';

/*
 * Merkezî platform yetenek katmanı.
 *
 * Amaç: Windows'a özgü entegrasyonları (Excel COM yenileme, native klasör seçici,
 * dosya/e-posta açma, artık süreç temizliği) tek yerde platform-farkında hâle getirmek.
 * Böylece uygulama macOS'ta ve headless bir Linux sunucusunda (barındırılan senaryo)
 * ÇALIŞIR kalır; Windows davranışı değişmez.
 *
 * Bu modül saf/yan-etkisizdir: yalnız yetenek tespiti ve komut SEÇİMİ yapar. Gerçek
 * spawn işlemleri ayrı, açıkça isimlendirilmiş fonksiyonlardadır ki komut seçimi
 * gerçek süreç başlatmadan test edilebilsin.
 */

const { spawnSync, spawn } = require('child_process');
const path = require('path');

const IS_WINDOWS = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';
const IS_LINUX = process.platform === 'linux';

function platformLabel() {
  if (IS_WINDOWS) return 'Windows';
  if (IS_MAC) return 'macOS';
  if (IS_LINUX) return 'Linux';
  return process.platform;
}

// Bir komutun PATH'te olup olmadığını kontrol eder (POSIX: `which`, Windows: `where`).
const _cmdCache = new Map();
function hasCommand(name) {
  if (_cmdCache.has(name)) return _cmdCache.get(name);
  let ok = false;
  try {
    const probe = IS_WINDOWS ? spawnSync('where', [name], { windowsHide: true, timeout: 4000 })
                             : spawnSync('which', [name], { timeout: 4000 });
    ok = !probe.error && probe.status === 0;
  } catch (_) { ok = false; }
  _cmdCache.set(name, ok);
  return ok;
}

// Excel COM otomasyonu (kaynak dosyaların pivot/veri bağlantılarını yenileme) yalnız
// Windows + kurulu Excel ile mümkündür. Diğer platformlarda uygulama dosyaları olduğu
// gibi okur; yenileme adımı atlanır.
function canRefreshExcel() { return IS_WINDOWS; }

// Native klasör seçme diyaloğu hangi araçla açılabilir?
//  windows  -> PowerShell (ChooseFolder.ps1)
//  mac      -> osascript (choose folder)
//  linux    -> zenity veya kdialog varsa; yoksa desteklenmez (headless sunucu → yükleme kullanılır)
function folderDialogPlan() {
  if (IS_WINDOWS) return { kind: 'windows' };
  if (IS_MAC) return { kind: 'mac' };
  if (IS_LINUX) {
    if (hasCommand('zenity')) return { kind: 'linux', tool: 'zenity' };
    if (hasCommand('kdialog')) return { kind: 'linux', tool: 'kdialog' };
    return { kind: 'unsupported' };
  }
  return { kind: 'unsupported' };
}
function canOpenNativeFolderDialog() { return folderDialogPlan().kind !== 'unsupported'; }

// Bir dosyayı/eki işletim sisteminin varsayılan uygulamasında açma komutunu SEÇER
// (spawn etmez). E-posta taslağı (.eml) açmak için kullanılır.
function externalOpenPlan(fullPath) {
  const p = String(fullPath || '');
  if (IS_WINDOWS) {
    // PowerShell U+2018–U+201B'yi de tek tırnak sayar; hepsi ikilenerek
    // kaçışlanır (aksi hâlde "’" içeren bir ad dizeyi kapatıp komut çalıştırabilir).
    const escaped = p.replace(/['\u2018-\u201B]/g, quote => quote + quote);
    return { cmd: 'powershell.exe', args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', `Start-Process -FilePath '${escaped}'`] };
  }
  if (IS_MAC) return { cmd: 'open', args: [p] };
  return { cmd: 'xdg-open', args: [p] }; // linux masaüstü; headless'ta komut yoksa açılış zarifçe başarısız olur
}

// Planlanan komutu gerçekten çalıştırır. Dosya açılamazsa (ör. headless ortam) false döner.
function openPathExternally(fullPath) {
  try {
    const { cmd, args } = externalOpenPlan(fullPath);
    const result = spawnSync(cmd, args, { windowsHide: true, timeout: 12000, encoding: 'utf8' });
    return !result.error && (result.status === 0 || result.status == null);
  } catch (_) { return false; }
}

// Taslak e-postası gibi kullanıcıya yalnızca dosya açılması gereken akışlarda
// sunucu yanıtını işletim sistemi uygulamasının açılışını bekleterek bloklamayız.
// Çocuk süreç bağımsız başlar; oluşturulan dosya zaten diske atomik olmayan ama
// tamamlanmış biçimde yazıldığı için dış uygulama güvenle okuyabilir.
function openPathExternallyAsync(fullPath) {
  try {
    const { cmd, args } = externalOpenPlan(fullPath);
    const child = spawn(cmd, args, { windowsHide: true, detached: true, stdio: 'ignore' });
    child.on('error', () => {});
    child.unref();
    return true;
  } catch (_) { return false; }
}

// Bir klasörü dosya gezgininde açma komutunu SEÇER (spawn etmez). "Open PO
// Folder" gibi akışlarda, tek bir dosyayı değil onu içeren klasörü açmak
// için kullanılır — externalOpenPlan'ın klasör kardeşidir.
function revealFolderPlan(folderPath) {
  const p = String(folderPath || '');
  if (IS_WINDOWS) return { cmd: 'explorer.exe', args: [p] };
  if (IS_MAC) return { cmd: 'open', args: [p] };
  return { cmd: 'xdg-open', args: [p] };
}

// Planlanan komutu gerçekten çalıştırır. Sunucu yanıtını klasörün açılışını
// bekleterek bloklamayız (openPathExternallyAsync ile aynı gerekçe).
function openFolderExternally(folderPath) {
  try {
    const { cmd, args } = revealFolderPlan(folderPath);
    const child = spawn(cmd, args, { windowsHide: true, detached: true, stdio: 'ignore' });
    child.on('error', () => {});
    child.unref();
    return true;
  } catch (_) { return false; }
}

// Bir dosyayı, onu içeren klasörde SEÇİLİ olarak açma komutunu SEÇER (spawn
// etmez). "Klasörde Göster" akışları için revealFolderPlan'ın dosya kardeşi:
// yalnız klasörü değil, klasördeki dosyayı da işaretler.
//  windows -> explorer.exe /select,<path>
//  mac     -> open -R <path> (Finder'da seçili gösterir)
//  linux   -> masaüstü dosya yöneticileri için evrensel bir "seç" bayrağı yok;
//             zarifçe klasörü açmaya düşer (revealFolderPlan ile aynı davranış).
function revealFileInFolderPlan(fullPath) {
  const p = String(fullPath || '');
  if (IS_WINDOWS) return { cmd: 'explorer.exe', args: [`/select,${p}`] };
  if (IS_MAC) return { cmd: 'open', args: ['-R', p] };
  return revealFolderPlan(path.dirname(p));
}

// Planlanan komutu gerçekten çalıştırır. Diğer "aç/göster" fonksiyonlarıyla
// aynı gerekçeyle sunucu yanıtını bekletmez.
function revealFileExternally(fullPath) {
  try {
    const { cmd, args } = revealFileInFolderPlan(fullPath);
    const child = spawn(cmd, args, { windowsHide: true, detached: true, stdio: 'ignore' });
    child.on('error', () => {});
    child.unref();
    return true;
  } catch (_) { return false; }
}

module.exports = {
  IS_WINDOWS, IS_MAC, IS_LINUX, platformLabel, hasCommand,
  canRefreshExcel, folderDialogPlan, canOpenNativeFolderDialog,
  externalOpenPlan, openPathExternally, openPathExternallyAsync,
  revealFolderPlan, openFolderExternally,
  revealFileInFolderPlan, revealFileExternally,
};
