'use strict';

/* v9.56 — PORTABLE'DA EDGE OTURUMU BULUNAMIYORDU
 *
 * Kullanıcı bildirimi (birebir):
 *   "Seçili PLM modelleri aktarılamadı: Buyer Log mevcut Edge oturumuna henüz
 *    bağlanamadı. — dış bağlantıya gitmesi gerektiği zaman edge'yi bulamıyor"
 *
 * KÖK SEBEP: portable başlatıcı, uygulama klasörünün dışına yazılmasın diye
 * LOCALAPPDATA'yı paketin içine çeviriyor. Bağlayıcı ise Edge'in profilini ve
 * DevToolsActivePort dosyasını process.env.LOCALAPPDATA üzerinden arıyordu.
 * Edge açık ve remote debugging etkin olduğu hâlde, bağlayıcı paketin
 * içindeki BOŞ klasöre bakıp "bağlanamadı" diyordu.
 *
 * Aynı ailenin ikinci hatası v9.55'te düzeltildi: Edge, yönlendirilmiş
 * LOCALAPPDATA yüzünden paketin içinde AYRI PROFİL açıyordu.
 *
 * Korunan asıl kusur: portable'ın kendi kendini yalıtması, kullanıcının GERÇEK
 * Edge oturumunu görmesini engellememeli — PLM aktarımı, CoreNectum görselleri
 * ve Troy entegrasyonu bu oturuma bağlı.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const CONNECTOR = path.join(ROOT, 'server', 'lib', 'agent-browser-connector.js');
const SOURCE = fs.readFileSync(CONNECTOR, 'utf8');

/* Bağlayıcıyı ayrı bir süreçte, istenen ortam değişkenleriyle yükleyip
   aday listesini alır. Modül yüklenirken ortamı okuduğu için aynı süreçte
   env değiştirip yeniden require etmek güvenilir değil. */
function candidatesWith(env) {
  const code = 'const c=require(' + JSON.stringify(CONNECTOR) + ');'
    + 'process.stdout.write(JSON.stringify(c.edgeUserDataDirCandidates()));';
  const out = execFileSync(process.execPath, ['-e', code], {
    encoding: 'utf8', timeout: 30000,
    env: { ...process.env, ...env },
  });
  return JSON.parse(out);
}

/* Sahte LOCALAPPDATA GERÇEKTEN VAR OLMALI: bağlayıcı yüklenirken user-data.js
   bu kökün altında klasör açmaya çalışıyor. Var olmayan bir yol verirsek modül
   hiç yüklenmez ve test, ölçmek istediği şeyi değil kurulum hatasını görür. */
function tempRoot(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bl-edge-' + name + '-'));
  return dir;
}

test('v9.56 portable yönlendirmesine rağmen GERÇEK Edge profili aranıyor', () => {
  const realLocal = 'C:\\Users\\test\\AppData\\Local';
  const redirected = 'C:\\paket\\data\\portable-localappdata';
  const list = candidatesWith({
    BL_HOST_LOCALAPPDATA: realLocal,
    LOCALAPPDATA: redirected,
    BL_EDGE_USER_DATA_DIR: '',
  });
  const realProfile = path.join(realLocal, 'Microsoft', 'Edge', 'User Data');
  assert.ok(list.includes(realProfile), 'gerçek profil aday listesinde olmalı: ' + JSON.stringify(list));
  // Ve ÖNCE denenmeli: yönlendirilmiş klasör boş olduğu için sonra gelmeli.
  const redirectedProfile = path.join(redirected, 'Microsoft', 'Edge', 'User Data');
  if (list.includes(redirectedProfile)) {
    assert.ok(list.indexOf(realProfile) < list.indexOf(redirectedProfile),
      'gerçek profil yönlendirilmiş olandan ÖNCE denenmeli');
  }
});

test('v9.56 normal kurulumda davranış değişmiyor', () => {
  // BL_HOST_LOCALAPPDATA yalnız portable başlatıcı tarafından set ediliyor.
  const local = tempRoot('normal');
  const list = candidatesWith({ LOCALAPPDATA: local, BL_HOST_LOCALAPPDATA: '', BL_EDGE_USER_DATA_DIR: '' });
  assert.ok(list.includes(path.join(local, 'Microsoft', 'Edge', 'User Data')));
  // Kanal varyantları korunmalı (v5.88 dersi: tek klasöre bakmak yetmiyor).
  for (const channel of ['Edge Beta', 'Edge Dev', 'Edge SxS']) {
    assert.ok(list.includes(path.join(local, 'Microsoft', channel, 'User Data')), channel + ' adayı kaybolmamalı');
  }
});

test('v9.56 açık ayar (BL_EDGE_USER_DATA_DIR) her şeyin önünde kalır', () => {
  const explicit = 'D:\\ozel\\EdgeProfil';
  const list = candidatesWith({
    BL_EDGE_USER_DATA_DIR: explicit,
    BL_HOST_LOCALAPPDATA: 'C:\\Users\\test\\AppData\\Local',
    LOCALAPPDATA: 'C:\\paket\\data\\portable-localappdata',
  });
  assert.equal(list[0], explicit, 'kullanıcının açık ayarı ilk sırada olmalı');
});

test('v9.56 aday listesi tekrarsız', () => {
  const same = tempRoot('dedupe');
  const list = candidatesWith({ BL_HOST_LOCALAPPDATA: same, LOCALAPPDATA: same, BL_EDGE_USER_DATA_DIR: '' });
  assert.equal(new Set(list.map(item => item.toLowerCase())).size, list.length,
    'aynı klasör iki kez denenmemeli');
});

/* GERÇEK MAKİNE ÖLÇÜMÜ: bu bilgisayarda Edge remote debugging ile açıksa,
   portable ortamını taklit ettiğimizde de oturum BULUNMALI. Hatanın canlı
   kanıtı buydu; düzeltmenin canlı kanıtı da bu. */
test('v9.56 gerçek Edge oturumu portable ortamında da bulunuyor', { skip: process.platform !== 'win32' }, () => {
  const realLocal = process.env.LOCALAPPDATA;
  const active = realLocal
    && fs.existsSync(path.join(realLocal, 'Microsoft', 'Edge', 'User Data', 'DevToolsActivePort'));
  if (!active) return; // Edge remote debugging açık değil; ölçecek bir şey yok.

  const fakePackage = path.join(os.tmpdir(), 'bl-portable-probe', 'data', 'portable-localappdata');
  const list = candidatesWith({
    BL_HOST_LOCALAPPDATA: realLocal,
    LOCALAPPDATA: fakePackage,
    BL_EDGE_USER_DATA_DIR: '',
  });
  const found = list.find(dir => fs.existsSync(path.join(dir, 'DevToolsActivePort')));
  assert.ok(found, 'portable ortamında da canlı Edge oturumu bulunmalı; bulunamazsa PLM aktarımı çalışmaz');
});

test('v9.56 kaynak: gerçek klasör tek bir yardımcıdan okunuyor', () => {
  assert.match(SOURCE, /function hostLocalAppData\(\)/);
  assert.match(SOURCE, /BL_HOST_LOCALAPPDATA/);
  // Edge çalıştırılabilir dosyası da gerçek klasörden aranmalı.
  assert.match(SOURCE, /process\.env\.BL_HOST_LOCALAPPDATA && path\.join\(process\.env\.BL_HOST_LOCALAPPDATA, 'Microsoft', 'Edge', 'Application', 'msedge\.exe'\)/);
});
