'use strict';

/*
 * Buyer Log — PORTABLE ORTAM KONTROLÜ
 *
 * Yeni bir bilgisayarda paketi açan kullanıcı, uygulamayı başlatmadan ÖNCE
 * neyin eksik olduğunu görmeli. Aksi hâlde arıza çalışma anında, anlaşılmaz
 * bir hata olarak çıkıyor ve kullanıcı IT'ye gitmek zorunda kalıyor.
 *
 * TASARIM KARARLARI:
 * 1) HİÇBİR KONTROL ÇÖKMEZ. Her kontrol kendi try/catch'i içinde; biri
 *    patlarsa "kontrol edilemedi" der ve diğerleri çalışmaya devam eder.
 *    Kontrol aracının kendisi arıza kaynağı olamaz.
 * 2) BİLİNMEYEN ≠ HATA. Bir şeyi ölçemediysek "yok" demiyoruz; ayrı bir
 *    durum olarak gösteriyoruz. Yanlış kırmızı, gerçek kırmızıyı gizler.
 * 3) HER KIRMIZI SATIR NE YAPILACAĞINI SÖYLER. Teşhis yetmez, çözüm de lazım.
 * 4) Bağımlılık yok: yalnız Node çekirdeği. Paketin içinden çalışır.
 *
 * Çıkış kodu: 0 = başlatılabilir, 1 = engelleyici eksik var.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const net = require('net');
const { execFileSync } = require('child_process');

const APP_ROOT = path.resolve(__dirname, '..');
const PORTABLE_ROOT = path.resolve(process.env.BUYER_LOG_PORTABLE_ROOT || path.join(APP_ROOT, '..', '..'));
const { desktopPaths } = require('../electron/portable-paths');
const PORTABLE_PATHS = desktopPaths(PORTABLE_ROOT);
const IS_WINDOWS = process.platform === 'win32';

const OK = 'OK';
const WARN = 'UYARI';
const FAIL = 'EKSIK';
const UNKNOWN = 'BILINMIYOR';

const results = [];

/* Her kontrol izole: biri patlarsa rapor yine tamamlanır (§1). */
function check(title, fn) {
  try {
    const outcome = fn();
    if (outcome) results.push({ status: outcome.status, title, detail: outcome.detail || '', fix: outcome.fix || '' });
  } catch (error) {
    results.push({
      status: UNKNOWN, title,
      detail: 'Kontrol edilemedi: ' + (error && error.message),
      fix: 'Bu kontrol sonuc vermedi; uygulamayi baslatip davranisi gozleyin.',
    });
  }
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return null; }
}

function regQuery(key) {
  try {
    return execFileSync('reg', ['query', key], { encoding: 'utf8', timeout: 15000, windowsHide: true });
  } catch (_) { return ''; }
}

/* ------------------------------------------------------------------ Node */
check('Node calisma zamani', () => {
  const major = Number(String(process.versions.node).split('.')[0]);
  const packagedExe = path.join(PORTABLE_ROOT, 'BuyerLog.exe');
  const usingPackagedRuntime = IS_WINDOWS && fs.existsSync(packagedExe) && path.resolve(process.execPath).toLowerCase() === path.resolve(packagedExe).toLowerCase();
  if (!Number.isFinite(major) || major < 18) {
    return {
      status: FAIL,
      detail: 'Node ' + process.version + ' cok eski.',
      fix: 'Guncel Buyer Log paketini BuyerLog.exe ile baslatin.',
    };
  }
  return {
    status: OK,
    detail: 'Node ' + process.version + ' - ' + (usingPackagedRuntime ? 'BuyerLog.exe runtime' : 'kontrolu calistiran Node') + ' - ' + process.arch,
  };
});

/* -------------------------------------------------------------- dosyalar */
check('Uygulama dosyalari', () => {
  const required = [
    'server/server.js', 'server/watchdog.js', 'public/index.html',
    'node_modules/express', 'node_modules/xlsx', 'config.json',
  ];
  const missing = required.filter(item => !fs.existsSync(item === 'config.json' ? PORTABLE_PATHS.configPath : path.join(APP_ROOT, item)));
  if (missing.length) {
    return {
      status: FAIL,
      detail: 'Eksik: ' + missing.join(', '),
      fix: 'Paket eksik veya yarim acilmis. Zip dosyasini yeniden, TAM olarak cikarin.',
    };
  }
  return { status: OK, detail: required.length + ' zorunlu bilesen yerinde' };
});

check('Kullanici ve ayar dosyalari', () => {
  const auth = path.join(PORTABLE_PATHS.authDataRoot, 'user-access.json');
  const syncSettings = path.join(PORTABLE_PATHS.localDataRoot, 'sync-settings.json');
  // Ilk acilista auth deposunun HENUZ olmamasi normaldir: yerel Moderator
  // (Gokberk) ilk sifresini Shared Hub olmadan olusturabilir. Bu nedenle
  // eksik auth dosyasi paket bozuklugu degil, gecerli first-run durumudur.
  if (!fs.existsSync(auth)) {
    return {
      status: fs.existsSync(syncSettings) ? OK : WARN,
      detail: 'Ilk acilis: yerel kullanici onbellegi henuz olusmamis' + (fs.existsSync(syncSettings) ? ' - senkron ayarlari mevcut' : ' - senkron ayarlari henuz tanimli degil'),
      fix: fs.existsSync(syncSettings) ? '' : 'Uygulama acilir; Gokberk/Moderator ilk sifresini olusturabilir. Shared Hub gerekiyorsa daha sonra Senkron Ayarlari ekranindan secin.',
    };
  }
  const store = readJson(auth) || {};
  const users = [store.moderator].concat(Array.isArray(store.users) ? store.users : []).filter(Boolean);
  return {
    status: OK,
    detail: users.length + ' yerel kullanici kaydi - ' + (fs.existsSync(syncSettings) ? 'senkron ayarlari mevcut' : 'Shared Hub zorunlu degil'),
  };
});

/* --------------------------------------------------- yazma izni (AppLocker
   ve salt-okunur konum sorunlarinin en sik gorulduğu yer). */
check('Klasore yazma izni', () => {
  fs.mkdirSync(PORTABLE_PATHS.dataRoot, { recursive: true });
  const probe = path.join(PORTABLE_PATHS.dataRoot, '.write-probe-' + process.pid);
  try {
    fs.writeFileSync(probe, 'x');
    fs.unlinkSync(probe);
  } catch (error) {
    return {
      status: FAIL,
      detail: 'Bu klasore yazilamiyor: ' + (error.code || error.message),
      fix: 'Paketi C:\\BuyerLog gibi yazilabilir bir klasore tasiyin. Program Files altina koymayin.',
    };
  }
  return { status: OK, detail: PORTABLE_PATHS.dataRoot };
});

/* ------------------------------------- Mark-of-the-Web: indirilen zip'ten
   cikan dosyalar "engellendi" isaretiyle gelir; .cmd ve .ps1 calismaz. */
check('Dosya engeli (Mark-of-the-Web)', () => {
  if (!IS_WINDOWS) return { status: OK, detail: 'Windows disi: gecerli degil' };
  const candidates = [
    path.join(PORTABLE_ROOT, 'BuyerLog.exe'),
    path.join(APP_ROOT, 'server', 'lib', 'RefreshExcel.ps1'),
    path.join(APP_ROOT, 'server', 'lib', 'OutlookLocal.ps1'),
  ].filter(file => fs.existsSync(file));
  const blocked = candidates.filter(file => {
    try { fs.readFileSync(file + ':Zone.Identifier'); return true; } catch (_) { return false; }
  });
  if (blocked.length) {
    return {
      status: FAIL,
      detail: blocked.length + ' dosya Windows tarafindan engellenmis.',
      fix: 'Paket klasorundeki UNBLOCK-AND-START.cmd dosyasini calistirin (engeli kaldirip baslatir).',
    };
  }
  return { status: OK, detail: candidates.length + ' kritik dosyada engel yok' };
});

/* ---------------------------------------------------------- PowerShell
   Outlook maili, klasor secici, Excel yenileme ve model sorgusu .ps1 ile
   calisiyor. Kurumsal ExecutionPolicy / Constrained Language Mode bunlari
   engelleyebilir. */
check('PowerShell', () => {
  if (!IS_WINDOWS) return { status: OK, detail: 'Windows disi: gecerli degil' };
  const out = execFileSync('powershell.exe',
    ['-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command',
      '$ExecutionContext.SessionState.LanguageMode.ToString()'],
    { encoding: 'utf8', timeout: 20000, windowsHide: true }).trim();
  if (out && out !== 'FullLanguage') {
    return {
      status: WARN,
      detail: 'PowerShell kisitli modda: ' + out,
      fix: 'Outlook maili, Excel yenileme ve klasor secici calismayabilir. Diger ozellikler etkilenmez.',
    };
  }
  return { status: OK, detail: 'Calisiyor - ' + (out || 'FullLanguage') };
});

/* ------------------------------------------------------------------ Excel
   ASAS/IAS yuklemesi Excel COM ile yapiliyor (server/lib/RefreshExcel.ps1).
   canRefreshExcel yalniz "Windows mu" diye bakiyor, Excel KURULU MU diye
   bakmiyor; kurulu degilse yenileme calisma aninda hata verir. */
check('Microsoft Excel', () => {
  if (!IS_WINDOWS) return { status: WARN, detail: 'Windows disi: Excel yenilemesi kullanilamaz' };
  const out = regQuery('HKEY_CLASSES_ROOT\\Excel.Application\\CurVer');
  const match = /Excel\.Application\.(\d+)/i.exec(out);
  if (!match) {
    return {
      status: WARN,
      detail: 'Excel kurulu gorunmuyor.',
      fix: 'ASAS/IAS Excel yenilemesi calismaz. Kaynak dosyalar elle guncellenirse Buyer Log yine acilir ve okur. '
        + 'Yenilemeyi kapatmak icin config.json icinde "refreshWithExcel": false yapin.',
    };
  }
  return { status: OK, detail: 'Excel COM surum ' + match[1] };
});

/* ------------------------------------------------------------------ port */
check('Ag portu', () => {
  const config = readJson(PORTABLE_PATHS.configPath) || {};
  const port = Number(config.port) || 6194;
  const host = String(config.host || '127.0.0.1');
  const probe = net.createServer();
  let busy = false;
  try {
    probe.listen({ port, host, exclusive: true });
  } catch (_) { busy = true; }
  try { probe.close(); } catch (_) { /* yoksay */ }
  if (busy) {
    return {
      status: WARN,
      detail: host + ':' + port + ' kullanimda.',
      fix: 'Buyer Log zaten acik olabilir. Degilse config.json icindeki "port" degerini degistirin.',
    };
  }
  return { status: OK, detail: host + ':' + port + ' - yalniz yerel (guvenlik duvari uyarisi cikmaz)' };
});

/* -------------------------------------------------------- kaynak dosyalar */
check('Kaynak veri durumu', () => {
  // Guncel desktop mimarisinde kaynaklar sabit bir source-data klasorune
  // gomulmez; kullanici/kaynak ayarlari runtime'da secilir ve portable data
  // kokunde saklanir. Bos first-run paketi bu nedenle hatali degildir.
  const roots = [
    path.join(PORTABLE_PATHS.serverDataRoot, 'user-source-data'),
    path.join(PORTABLE_PATHS.appDataRoot, 'user-source-data'),
  ];
  const existing = roots.filter(folder => fs.existsSync(folder));
  if (!existing.length) return {
    status: WARN,
    detail: 'Henuz yerel kaynak veri onbellegi yok (gecerli first-run durumu).',
    fix: 'ASAS/IAS/Antrepo kaynaklarini uygulamadaki Kaynak Ayarlari ekranindan tanimlayin.',
  };
  let files = 0;
  for (const root of existing) {
    const stack = [root];
    while (stack.length) {
      const dir = stack.pop();
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) stack.push(path.join(dir, entry.name));
        else if (entry.isFile() && /\.(xlsx|xls|csv)$/i.test(entry.name)) files++;
      }
    }
  }
  return { status: OK, detail: files + ' yerel kaynak veri dosyasi / ' + existing.length + ' kaynak kok' };
});

/* ------------------------------------------------------------------ SYNC
   Ortak agdan KUR / Endeksmatik / nakliye sureleri / e-posta gruplari
   buradan geliyor. Bossa paket dondurulmus kopyayla calisir. */
check('Ortak ag senkronu', () => {
  const settings = readJson(path.join(PORTABLE_PATHS.localDataRoot, 'sync-settings.json')) || {};
  const root = String(settings.sharedSyncRoot || '').trim();
  if (!root) {
    return {
      status: WARN, detail: 'Ortak klasor tanimli degil.',
      fix: 'KUR, Endeksmatik, nakliye sureleri ve e-posta gruplari paketteki kopyada kalir (guncellenmez). '
        + 'Canli tutmak icin uygulamada Senkron Ayarlari ekranindan ortak klasoru secin.',
    };
  }
  if (!fs.existsSync(root)) {
    return {
      status: FAIL, detail: 'Ortak klasore ulasilamiyor: ' + root,
      fix: 'Ag surucusu bagli mi ve bu kullanicinin erisimi var mi kontrol edin. VPN gerekiyor olabilir.',
    };
  }
  return { status: OK, detail: root };
});

/* ---------------------------------------------------------------- rapor */
const ICONS = {};
ICONS[OK] = '[ OK  ]';
ICONS[WARN] = '[UYARI]';
ICONS[FAIL] = '[EKSIK]';
ICONS[UNKNOWN] = '[  ?  ]';

const blocking = results.filter(item => item.status === FAIL);
const warnings = results.filter(item => item.status === WARN || item.status === UNKNOWN);

const lines = [];
lines.push('');
lines.push('  BUYER LOG - PORTABLE ORTAM KONTROLU');
lines.push('  ' + '-'.repeat(64));
lines.push('  Klasor : ' + PORTABLE_ROOT);
lines.push('  Makine : ' + os.hostname() + ' - ' + os.platform() + ' ' + os.release());
lines.push('  ' + '-'.repeat(64));
lines.push('');
for (const item of results) {
  lines.push('  ' + (ICONS[item.status] || '[  ?  ]') + '  ' + item.title);
  if (item.detail) lines.push('           ' + item.detail);
  if (item.fix && item.status !== OK) lines.push('           -> ' + item.fix);
}
lines.push('');
lines.push('  ' + '-'.repeat(64));
if (blocking.length) {
  lines.push('  SONUC: ' + blocking.length + ' engelleyici eksik var. Once bunlari giderin.');
} else if (warnings.length) {
  lines.push('  SONUC: Baslatilabilir. ' + warnings.length + ' uyari var, ilgili ozellikler sinirli calisabilir.');
} else {
  lines.push('  SONUC: Her sey hazir. BuyerLog.exe ile baslatabilirsiniz.');
}
lines.push('');
process.stdout.write(lines.join('\r\n') + '\r\n');
process.exitCode = blocking.length ? 1 : 0;
