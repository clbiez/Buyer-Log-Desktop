'use strict';

/* Ortak klasör (Shared Hub) dizin girdisi sınıflandırması.

   OneDrive/SharePoint "Files On-Demand" klasör ve dosyaları Windows'ta bulut
   reparse point'i taşır. Node/libuv `readdir({ withFileTypes: true })` bu
   girdileri yalnız öznitelikten okuyup Dirent'te isDirectory()=false,
   isFile()=false, isSymbolicLink()=true bildirebilir (saha: central-iam.js).
   Yalnız isDirectory()/isFile() ile süzen bir tarayıcı bu durumda eş cihaz
   klasörlerini ve rapor dosyalarını hata vermeden atlar.

   Kural: Dirent doğrudan klasör/dosya diyorsa ona güvenilir; bağlantı olarak
   bildirilen girdi `stat` ile (hedefi izleyerek) doğrulanır. Erişilemeyen veya
   kırık bağlantı hiçbir türe sayılmaz; çağıran onu eskisi gibi atlar. */

const fsp = require('fs/promises');
const path = require('path');

async function hubEntryKind(dir, entry, { stat = fsp.stat } = {}) {
  if (!entry) return 'other';
  if (entry.isDirectory()) return 'directory';
  if (entry.isFile()) return 'file';
  if (!entry.isSymbolicLink()) return 'other';
  try {
    const info = await stat(path.join(dir, entry.name));
    return info.isDirectory() ? 'directory' : info.isFile() ? 'file' : 'other';
  } catch (_) { return 'other'; }
}

async function filterHubEntries(dir, entries, kind, options) {
  const out = [];
  for (const entry of Array.isArray(entries) ? entries : []) {
    if ((await hubEntryKind(dir, entry, options)) === kind) out.push(entry);
  }
  return out;
}

const hubDirectories = (dir, entries, options) => filterHubEntries(dir, entries, 'directory', options);
const hubFiles = (dir, entries, options) => filterHubEntries(dir, entries, 'file', options);

module.exports = { hubEntryKind, hubDirectories, hubFiles };
