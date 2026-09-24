// Node.js tarafından RefreshExcel.ps1'i çalıştırıp gerçek Excel'i (görünmez şekilde)
// açtırarak pivot tabloları/veri bağlantılarını yeniletir. Windows + Microsoft Excel
// kurulu olması gerekir. Bu dosya test edilmemiştir (bkz. README) — gerçek makinede
// doğrulanmalı.

const { execFile } = require('child_process');
const path = require('path');
const platform = require('./platform');

const SCRIPT_PATH = path.join(__dirname, 'RefreshExcel.ps1');

// Bir Excel dosyasını gerçek Excel ile açıp yeniler. Pivot tablo boyutuna/veri
// kaynağının hızına göre uzun sürebilir (30sn - birkaç dakika); bu yüzden bol
// timeout tanımlıyoruz.
function refreshExcelFile(filePath, timeoutMs) {
  return new Promise((resolve, reject) => {
    // Excel COM yenilemesi yalnız Windows'ta mümkün. Diğer platformlarda PowerShell'i
    // hiç çağırmadan net bir kodla reddet; çağıran taraf mevcut dosyayı okumaya devam eder.
    if (!platform.canRefreshExcel()) {
      const failure = new Error('Excel iç yenilemesi bu platformda desteklenmiyor; kaynak dosya olduğu gibi okunacak.');
      failure.code = 'EXCEL_REFRESH_UNSUPPORTED';
      failure.statusCode = 501;
      return reject(failure);
    }
    execFile('powershell.exe', [
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT_PATH, filePath
    ], { timeout: timeoutMs || 600000, windowsHide: true, maxBuffer: 2 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        const timedOut = Boolean(err.killed || err.code === 'ETIMEDOUT' || err.signal === 'SIGTERM');
        const detail = String(stderr || err.message || '').replace(/\s+/g, ' ').trim();
        const failure = new Error(timedOut
          ? `Excel iç yenilemesi zaman aşımına uğradı (${path.basename(filePath)}).`
          : `Excel iç yenilemesi başarısız (${path.basename(filePath)}): ${detail || 'Bilinmeyen PowerShell/Excel otomasyon hatası.'}`);
        failure.code = timedOut ? 'EXCEL_REFRESH_TIMEOUT' : 'EXCEL_REFRESH_FAILED';
        failure.statusCode = timedOut ? 504 : 500;
        failure.cause = err;
        return reject(failure);
      }
      resolve(String(stdout || '').trim());
    });
  });
}

module.exports = { refreshExcelFile };
