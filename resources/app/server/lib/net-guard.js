'use strict';

/*
 * Ağ maruziyeti güvenlik kilidi (saf, test edilebilir).
 *
 * Dış erişim parolası etkin değilken yalnız localhost'a bağlı kullanım güvenlidir.
 * Loopback dışı bir adrese kimlik doğrulama olmadan bağlanmak tüm sipariş verisini ağa
 * açacağından, bu durumda başlatma reddedilir. (Barındırılan/telefon erişimi senaryosunun
 * ilk güvenlik primitifi.)
 */

function isLoopbackHost(host) {
  const h = String(host || '').trim().toLowerCase();
  return h === '' || h === '::1' || h === 'localhost' || h.startsWith('127.');
}

function assertSafeBind(host, hasAuth) {
  if (isLoopbackHost(host) || hasAuth) return;
  const err = new Error(
    `GÜVENLİK: Sunucu loopback dışı bir adrese (${host}) kimlik doğrulama olmadan bağlanamaz. `
    + `Telefon/ağ erişimi için önce bir erişim anahtarı yapılandırın (config.auth.passwordHash veya BL_AUTH_PASSWORD) `
    + `ve tercihen HTTPS kullanın. Yalnız yerel kullanım için host'u 127.0.0.1 bırakın.`);
  err.code = 'UNSAFE_NETWORK_BIND';
  throw err;
}

// Başlangıçta kullanılan güvenli çözümleyici: FIRLATMAZ (watchdog altında sonsuz yeniden
// başlatma olmasın diye). Güvensiz yapılandırmada loopback'e düşürür ve bunu bildirir;
// böylece uygulama her zaman ayakta kalır ama kimlik doğrulamasız ağ maruziyeti oluşmaz.
function resolveBindHost(host, hasAuth) {
  if (isLoopbackHost(host) || hasAuth) return { host, downgraded: false };
  return { host: '127.0.0.1', downgraded: true, requested: String(host) };
}

module.exports = { isLoopbackHost, assertSafeBind, resolveBindHost };
