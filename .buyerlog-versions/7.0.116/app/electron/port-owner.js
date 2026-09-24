'use strict';

/*
 * Buyer Log — PORTU TUTAN KOPYAYI BULMA VE KAPATMA
 *
 * Hata ekranındaki "Çalışan Kopyayı Kapat" düğmesi buraya bağlıdır.
 *
 * BU DOSYA BİR SÜREÇ SONLANDIRIYOR — en dikkatli davranılması gereken iş
 * sınıfı. Kullanıcının açık Excel'ini, Node ile yazdığı bir betiği ya da
 * tamamen ilgisiz bir sunucuyu kapatmak, "kolaylık" adına yapılabilecek en
 * kötü şeydir. Bu yüzden kurallar açıktır:
 *
 * 1) YALNIZ PORTU GERÇEKTEN TUTAN SÜREÇ. İsimden ya da tahminden gidilmez;
 *    dinleyen soketin sahibi olan PID bulunur (netstat -ano).
 *
 * 2) DOĞRULANMADAN DOKUNULMAZ. PID'in görüntü adı BuyerLog.exe ya da node.exe
 *    olmalı VE adres gerçekten Buyer Log gibi cevap vermeli. İkisinden biri
 *    tutmuyorsa süreç YABANCI sayılır ve kullanıcıya "bunu ben kapatamam"
 *    denir. Yanlış süreci kapatmaktansa kullanıcıyı elle uğraştırmak yeğdir.
 *
 * 3) ÖNCE NAZİKÇE. taskkill /F olmadan gönderilir: Electron kopyası bunu
 *    pencere kapatma isteği olarak alır, kendi kapanış akışını çalıştırır ve
 *    veritabanını düzgün bırakır. Zorlama yalnız son çare olarak, süre
 *    dolduktan sonra kullanılır.
 *
 * 4) KENDİMİZE DOKUNMAYIZ. Kendi PID'imiz ve alt süreçlerimiz hedef olamaz.
 *
 * 5) SONUÇ ÖLÇÜLÜR. "Kapatma komutu gönderildi" başarı değildir; port
 *    gerçekten serbest kalana kadar beklenir.
 */

const { execFile } = require('child_process');
const http = require('http');

const GRACEFUL_WAIT_MS = 8000;
const FORCE_WAIT_MS = 5000;
const POLL_MS = 300;

/* Kapatılmasına izin verilen görüntü adları. Buyer Log ya kendi EXE'si ile
   (masaüstü sürümü) ya da node.exe ile (eski sunucu) çalışır. */
const ALLOWED_IMAGES = new Set(['buyerlog.exe', 'node.exe']);

function runCommand(command, args, timeoutMs = 10000) {
  return new Promise(resolve => {
    execFile(command, args, { windowsHide: true, timeout: timeoutMs, encoding: 'utf8' },
      (error, stdout) => resolve(error && !stdout ? '' : String(stdout || '')));
  });
}

/*
 * Dinleyen soketin sahibi (§1). netstat çıktısı yerelleştirilmez; sütun
 * düzeni Windows sürümleri arasında sabittir: Proto / Local / Foreign /
 * State / PID.
 */
async function findPortOwner(port) {
  const output = await runCommand('netstat.exe', ['-ano', '-p', 'TCP']);
  const wanted = ':' + Number(port);
  for (const line of output.split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 5) continue;
    const [, local, , state, pid] = parts;
    if (!/^LISTENING$/i.test(state)) continue;
    if (!local.endsWith(wanted)) continue;
    const value = Number(pid);
    if (Number.isInteger(value) && value > 0) return value;
  }
  return 0;
}

async function imageNameOf(pid) {
  const output = await runCommand('tasklist.exe', ['/FI', 'PID eq ' + pid, '/NH', '/FO', 'CSV']);
  const match = /^"([^"]+)"/m.exec(output.trim());
  return match ? match[1].toLowerCase() : '';
}

/* Adres Buyer Log gibi mi cevap veriyor (§2)? Süreç adı tek başına yeterli
   değil: node.exe kullanıcının başka bir işi de olabilir. */
function looksLikeBuyerLog(origin) {
  return new Promise(resolve => {
    const request = http.get(origin + '/', { timeout: 2500 }, response => {
      const location = String(response.headers.location || '');
      const status = Number(response.statusCode) || 0;
      response.resume();
      // Buyer Log giriş yapılmamışken kullanıcı seçimine yönlendirir.
      resolve(/select-user|login/i.test(location) || status === 200 || status === 302);
    });
    request.on('timeout', () => { request.destroy(); resolve(false); });
    request.on('error', () => resolve(false));
  });
}

function portFree(origin) {
  return new Promise(resolve => {
    const request = http.get(origin + '/', { timeout: 1500 }, response => {
      response.resume();
      resolve(false);
    });
    request.on('timeout', () => { request.destroy(); resolve(true); });
    request.on('error', () => resolve(true));
  });
}

async function waitForFree(origin, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await portFree(origin)) return true;
    if (Date.now() >= deadline) return false;
    await new Promise(resolve => setTimeout(resolve, POLL_MS));
  }
}

/*
 * Portu tutan kopyayı inceler. Sonuç kullanıcıya olduğu gibi gösterilebilir:
 * ne bulunduğu ve kapatılıp kapatılamayacağı açıkça söylenir.
 */
async function inspectPortOwner(origin, port) {
  const pid = await findPortOwner(port);
  if (!pid) return { found: false, reason: 'Portu tutan süreç bulunamadı.' };
  if (pid === process.pid || pid === process.ppid) {
    return { found: true, pid, closable: false, reason: 'Portu bu uygulamanın kendisi tutuyor.' };
  }
  const image = await imageNameOf(pid);
  if (!image) return { found: true, pid, closable: false, reason: 'Süreç bilgisi okunamadı (PID ' + pid + ').' };
  if (!ALLOWED_IMAGES.has(image)) {
    return {
      found: true, pid, image, closable: false,
      reason: 'Portu Buyer Log değil, "' + image + '" tutuyor. Bu süreci Buyer Log kapatmaz.',
    };
  }
  if (!(await looksLikeBuyerLog(origin))) {
    return {
      found: true, pid, image, closable: false,
      reason: 'Adres Buyer Log gibi cevap vermiyor; güvenli olmadığı için kapatılmadı.',
    };
  }
  return { found: true, pid, image, closable: true };
}

/*
 * Doğrulanmış kopyayı kapatır: önce nazikçe, gerekirse zorla (§3, §5).
 */
async function closePortOwner(origin, port, log = () => {}) {
  const owner = await inspectPortOwner(origin, port);
  if (!owner.found) return { ok: false, message: owner.reason };
  if (!owner.closable) return { ok: false, message: owner.reason, pid: owner.pid };

  log('Portu tutan kopya kapatılıyor: PID ' + owner.pid + ' (' + owner.image + ')');
  await runCommand('taskkill.exe', ['/PID', String(owner.pid), '/T']);
  if (await waitForFree(origin, GRACEFUL_WAIT_MS)) {
    log('Çalışan kopya düzgün kapandı (PID ' + owner.pid + ').');
    return { ok: true, forced: false, pid: owner.pid, image: owner.image };
  }

  log('Kopya zamanında kapanmadı; süreç ağacı sonlandırılıyor (PID ' + owner.pid + ').');
  await runCommand('taskkill.exe', ['/PID', String(owner.pid), '/T', '/F']);
  if (await waitForFree(origin, FORCE_WAIT_MS)) {
    log('Çalışan kopya sonlandırıldı (PID ' + owner.pid + ').');
    return { ok: true, forced: true, pid: owner.pid, image: owner.image };
  }
  return {
    ok: false, pid: owner.pid,
    message: 'Süreç sonlandırıldı ama ' + port + ' portu hâlâ kullanımda. '
      + 'Başka bir kopya daha açık olabilir.',
  };
}

module.exports = { findPortOwner, inspectPortOwner, closePortOwner, ALLOWED_IMAGES };
