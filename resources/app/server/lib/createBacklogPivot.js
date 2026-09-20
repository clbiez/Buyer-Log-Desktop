const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

const SCRIPT_PATH = path.join(__dirname, 'CreateBacklogPivot.ps1');

function uniqueExisting(items) {
  const seen = new Set();
  return items.filter((item) => {
    if (!item) return false;
    const key = String(item).toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return item === 'powershell.exe' || fs.existsSync(item);
  });
}

function getPowerShellCandidates() {
  const root = process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows';
  // Excel COM kaydı Office'in bitliğine göre yalnızca 32-bit veya 64-bit kayıt görünümünde
  // bulunabilir. Bu yüzden iki Windows PowerShell mimarisini de deneriz.
  return uniqueExisting([
    path.join(root, 'Sysnative', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    path.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    path.join(root, 'SysWOW64', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    'powershell.exe',
  ]);
}

function runPowerShell(executable, filePath, configPath, timeoutMs) {
  return new Promise((resolve, reject) => {
    execFile(executable, [
      '-NoLogo', '-NoProfile', '-Sta', '-ExecutionPolicy', 'Bypass',
      '-File', SCRIPT_PATH, filePath, configPath,
    ], {
      timeout: timeoutMs,
      windowsHide: true,
      maxBuffer: 1024 * 1024 * 8,
      encoding: 'utf8',
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    }, (err, stdout, stderr) => {
      const detail = String(stderr || stdout || (err && err.message) || '').trim();
      if (err) return reject(Object.assign(new Error(detail || err.message), { detail, executable }));
      resolve({ executable, output: String(stdout || '').trim() });
    });
  });
}

function isArchitectureOrComRegistrationError(text) {
  return /80040154|REGDB_E_CLASSNOTREG|class not registered|s[ıi]n[ıi]f kaydedilmemi[şs]|CLSID|Excel\.Application.*(?:bulunamad|kay[ıi]tl[ıi] de[ğg]il)/i.test(String(text || ''));
}

async function createBacklogPivot(filePath, configPath, timeoutMs) {
  const candidates = getPowerShellCandidates();
  if (!candidates.length) throw new Error('Windows PowerShell bulunamadı.');

  const totalTimeout = Number(timeoutMs) || 240000;
  const attemptTimeout = Math.max(60000, Math.floor(totalTimeout / candidates.length));
  const failures = [];

  for (let i = 0; i < candidates.length; i += 1) {
    const executable = candidates[i];
    try {
      return await runPowerShell(executable, filePath, configPath, attemptTimeout);
    } catch (err) {
      const detail = String(err.detail || err.message || '').trim();
      failures.push(`${path.basename(path.dirname(path.dirname(executable))) || executable}: ${detail}`);
      // 32/64-bit COM kayıt görünümü sorunuysa diğer PowerShell mimarisini dene.
      // Başka bir Excel/Pivot hatasında aynı dosyayı tekrar işleyip riske atmamak için dur.
      if (!isArchitectureOrComRegistrationError(detail) && !/ENOENT|not found/i.test(detail)) break;
    }
  }

  throw new Error(
    'Excel PivotTable oluşturulamadı. Program hem 64-bit hem 32-bit Windows PowerShell ile Excel COM otomasyonunu denedi. ' +
    failures.join(' | ')
  );
}

module.exports = { createBacklogPivot, getPowerShellCandidates };
