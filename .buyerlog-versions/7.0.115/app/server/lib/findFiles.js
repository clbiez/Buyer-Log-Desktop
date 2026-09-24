// Orijinal HTML'deki "Klasörden Otomatik Bul" mantığının (folderBtn click handler)
// Node.js dosya sistemi üzerinden çalışan karşılığı. Aynı adlandırma kurallarını kullanır:
//   - antrepo*.xlsx  -> Antrepo dosyası
//   - asas*.xlsx     -> ASAS dosyası
//   - *update*.xlsx (claude-lcw-cp* hariç) -> Sub-Mfr/CPUpdate dosyası
// Aynı isim kalıbına uyan birden fazla dosya varsa, değiştirilme tarihi en yeni olan seçilir.

const fs = require('fs');
const path = require('path');

function findLatestSourceFiles(folderPath) {
  let entries;
  try {
    entries = fs.readdirSync(folderPath, { withFileTypes: true });
  } catch (err) {
    throw new Error(`Klasör okunamadı: ${folderPath} — ${err.message}`);
  }
  const candidates = { asas: [], antrepo: [], cpupdate: [], lfl: [] };
  for (const ent of entries) {
    if (!ent.isFile() || !/\.xlsx$/i.test(ent.name)) continue;
    const full = path.join(folderPath, ent.name);
    const stat = fs.statSync(full);
    const item = { name: ent.name, full, mtime: stat.mtimeMs };
    if (/^antrepo/i.test(ent.name)) candidates.antrepo.push(item);
    // Eski ASAS - Fabric dosyası artık kaynak değildir. Yine de ana /^asas/
    // eşleşmesine düşüp sipariş dosyası sanılmaması için açıkça atlanır.
    else if (/^asas\s*[-_ ]\s*fabric(?:\s|[-_]|\.|$)/i.test(ent.name)) continue;
    else if (/^asas/i.test(ent.name)) candidates.asas.push(item);
    else if (/^lfl/i.test(ent.name) || /(?:^|[^a-z0-9])lfl(?:[^a-z0-9]|$)/i.test(ent.name)) candidates.lfl.push(item);
    else if (/update/i.test(ent.name) && !/^claude-lcw-cp/i.test(ent.name)) candidates.cpupdate.push(item);
  }
  const pickLatest = list => list.sort((a, b) => b.mtime - a.mtime)[0] || null;
  return {
    asas: pickLatest(candidates.asas),
    antrepo: pickLatest(candidates.antrepo),
    cpupdate: pickLatest(candidates.cpupdate),
    lfl: pickLatest(candidates.lfl),
  };
}

module.exports = { findLatestSourceFiles };
