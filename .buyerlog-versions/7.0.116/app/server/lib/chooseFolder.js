// Native klasör seçme penceresi açar. Windows: ChooseFolder.ps1 (PowerShell). macOS:
// osascript (choose folder). Linux masaüstü: zenity/kdialog. Headless/desteklenmeyen
// ortamda net bir hata döndürür (bu durumda kullanıcı config.sourceFolder ayarlar veya
// dosya yükleme akışını kullanır). Windows tarafında native dialog foreground owner ile açılır.

const { execFile } = require('child_process');
const path = require('path');
const platform = require('./platform');

const SCRIPT_PATH = path.join(__dirname, 'ChooseFolder.ps1');
const PROMPT = 'Kaynak klasörünü seçin';

function windowsFolderDialogArgs(options = {}) {
  const initialPath = String(options.initialPath || '').trim().slice(0, 4096);
  const args = ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT_PATH];
  if (options.mode === 'network') args.push('-NetworkMode');
  else if (options.mode === 'modern') args.push('-ModernMode');
  if (initialPath) args.push('-InitialPath', initialPath);
  return args;
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 120000, ...opts }, (err, stdout, stderr) => {
      resolve({ err, stdout: String(stdout || ''), stderr: String(stderr || '') });
    });
  });
}

async function chooseFolderDialog(options = {}) {
  const plan = platform.folderDialogPlan();

  if (plan.kind === 'windows') {
    const { err, stdout, stderr } = await run('powershell.exe',
      windowsFolderDialogArgs(options));
    if (err) throw new Error(stderr || err.message);
    return stdout.trim() || null; // null => kullanıcı iptal etti
  }

  if (plan.kind === 'mac') {
    // osascript: iptalde "User canceled." ile non-zero çıkar → iptal (null) sayılır.
    const { err, stdout, stderr } = await run('osascript',
      ['-e', `POSIX path of (choose folder with prompt "${PROMPT}")`]);
    if (err) {
      if (/User canceled|-128/.test(stderr)) return null;
      throw new Error(stderr.trim() || err.message);
    }
    return stdout.trim() || null;
  }

  if (plan.kind === 'linux') {
    if (plan.tool === 'zenity') {
      const { err, stdout, stderr } = await run('zenity', ['--file-selection', '--directory', `--title=${PROMPT}`]);
      if (err) { if (err.code === 1) return null; throw new Error(stderr.trim() || err.message); } // 1 => iptal
      return stdout.trim() || null;
    }
    // kdialog
    const { err, stdout, stderr } = await run('kdialog', ['--getexistingdirectory', '.']);
    if (err) { if (err.code === 1) return null; throw new Error(stderr.trim() || err.message); }
    return stdout.trim() || null;
  }

  const e = new Error(`Bu ortamda (${platform.platformLabel()}) native klasör seçme penceresi yok. `
    + `Kaynak klasörü ayarlardan (config.sourceFolder) tanımlayın ya da dosya yükleme akışını kullanın.`);
  e.code = 'FOLDER_DIALOG_UNSUPPORTED';
  throw e;
}

module.exports = { chooseFolderDialog, windowsFolderDialogArgs };
