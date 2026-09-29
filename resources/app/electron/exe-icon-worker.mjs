/*
 * BuyerLog.exe SİMGE YAMASI — ayrı süreç (ELECTRON_RUN_AS_NODE).
 * exe ~240 MB olduğu için okuma/yeniden üretme ana süreci ve arayüzü
 * kilitlemesin diye burada yapılır. Sıra:
 *   1. exe'nin simge kaynakları buyerlog.ico ile değiştirilmiş kopyası üretilir,
 *   2. kopya yeniden ayrıştırılıp doğrulanır ve Node modunda çalıştırılarak
 *      gerçekten açıldığı sınanır,
 *   3. çalışan exe yeniden adlandırılır (Windows çalışan exe'nin silinmesine değil
 *      yeniden adlandırılmasına izin verir), yeni kopya asıl adı alır.
 * Herhangi bir adım başarısız olursa asıl exe'ye dokunulmaz / geri alınır.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SMOKE_TOKEN = 'buyerlog-exe-icon-ok';

function iconGroups(ResEdit, exe) {
  const res = ResEdit.NtExecutableResource.from(exe);
  const groups = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries);
  return { res, groups };
}

function defaultSmokeTest(file) {
  const result = spawnSync(file, ['-e', `process.stdout.write(${JSON.stringify(SMOKE_TOKEN)})`], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    encoding: 'utf8',
    timeout: 60000,
    windowsHide: true,
  });
  return result.status === 0 && String(result.stdout || '').includes(SMOKE_TOKEN);
}

export async function patchExeIcon({ exePath, iconPath, smokeTest = defaultSmokeTest, now = Date.now() }) {
  const ResEdit = await import('resedit');
  const original = fs.readFileSync(exePath);
  const exe = ResEdit.NtExecutable.from(original, { ignoreCert: true });
  const { res, groups } = iconGroups(ResEdit, exe);
  const iconFile = ResEdit.Data.IconFile.from(fs.readFileSync(iconPath));
  if (!iconFile.icons.length) throw new Error('buyerlog.ico içinde simge yok');
  // Uygulama simgesi exe'nin ilk (en küçük kimlikli) simge grubudur.
  const main = groups.slice().sort((a, b) => String(a.id).localeCompare(String(b.id), 'en', { numeric: true }))[0];
  const groupId = main ? main.id : 1;
  const lang = main ? main.lang : 1033;
  ResEdit.Resource.IconGroupEntry.replaceIconsForResource(res.entries, groupId, lang, iconFile.icons.map(item => item.data));
  res.outputResource(exe);
  const patched = Buffer.from(exe.generate());

  // Doğrulama: PE imzası ve yeni simge grubu okunabiliyor olmalı.
  if (patched.subarray(0, 2).toString('latin1') !== 'MZ') throw new Error('yamalı exe PE başlığı geçersiz');
  const check = iconGroups(ResEdit, ResEdit.NtExecutable.from(patched, { ignoreCert: true })).groups
    .find(group => String(group.id) === String(groupId) && String(group.lang) === String(lang));
  if (!check || check.icons.length !== iconFile.icons.length) throw new Error('yamalı exe simge grubu doğrulanamadı');

  const staged = exePath + '.icon-new';
  fs.writeFileSync(staged, patched);
  try {
    if (smokeTest && !smokeTest(staged)) throw new Error('yamalı exe deneme çalıştırmasında açılmadı');
  } catch (error) {
    fs.rmSync(staged, { force: true });
    throw error;
  }

  const retired = exePath + '.old-' + now;
  fs.renameSync(exePath, retired);
  try {
    fs.renameSync(staged, exePath);
  } catch (error) {
    fs.renameSync(retired, exePath);
    fs.rmSync(staged, { force: true });
    throw error;
  }
  const stat = fs.statSync(exePath);
  return { swapped: true, retired, groupId: String(groupId), icons: iconFile.icons.length, exeSize: stat.size, exeMtimeMs: stat.mtimeMs };
}

// Komut satırı: node exe-icon-worker.mjs <exePath> <iconPath> → stdout'a tek satır JSON.
const samePath = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
if (process.argv[1] && samePath(process.argv[1], fileURLToPath(import.meta.url))) {
  const [exePath, iconPath] = process.argv.slice(2);
  patchExeIcon({ exePath, iconPath })
    .then(result => { process.stdout.write(JSON.stringify({ ok: true, ...result }) + '\n'); })
    .catch(error => { process.stdout.write(JSON.stringify({ ok: false, error: String(error && error.message || error) }) + '\n'); process.exitCode = 1; });
}
