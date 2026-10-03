'use strict';

/*
 * Ağ maruziyeti güvenlik kilidi (saf, test edilebilir).
 *
 * Buyer Log yerel-öncelikli bir masaüstü uygulamasıdır; sunucu düz HTTP konuşur.
 * Loopback DIŞI bir adrese HTTP ile bağlanmak oturum çerezini, giriş parolasını ve
 * tüm sipariş/tedarikçi verisini ağda açık metin olarak taşır. Parola tek başına bunu
 * güvenli yapmaz (parola ve oturum çerezi dinlenebilir). Bu yüzden loopback dışı
 * bağlanma yalnız TLS ile mümkündür; sunucu TLS sonlandırmadığı sürece istek
 * fail-closed biçimde 127.0.0.1'e düşürülür.
 */

const IPV4_LOOPBACK = /^127(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;

function normalizeHost(host) {
  let h = String(host == null ? '' : host).trim().toLowerCase();
  if (h.startsWith('[') && h.endsWith(']')) h = h.slice(1, -1);
  return h;
}

// Boş host Node'da "tüm arayüzler" anlamına gelir; loopback SAYILMAZ.
// "127.example.com" gibi ad çözümlemesine bağlı adlar da loopback sayılmaz.
function isLoopbackHost(host) {
  const h = normalizeHost(host);
  if (!h) return false;
  if (h === 'localhost' || h === '::1' || h === '0:0:0:0:0:0:0:1') return true;
  if (h.startsWith('::ffff:')) return IPV4_LOOPBACK.test(h.slice(7));
  return IPV4_LOOPBACK.test(h);
}

function normalizeOptions(options) {
  // Geriye uyumluluk: eski imza resolveBindHost(host, hasAuth) idi. Kimlik doğrulama
  // artık loopback dışı bağlanma için YETERLİ değildir; yalnız TLS kapıyı açar.
  if (options && typeof options === 'object') return { hasAuth: options.hasAuth === true, tls: options.tls === true };
  return { hasAuth: options === true, tls: false };
}

function bindRefusal(host, opts) {
  if (isLoopbackHost(host)) return null;
  if (!opts.tls) return 'TLS_REQUIRED';
  if (!opts.hasAuth) return 'AUTH_REQUIRED';
  return null;
}

function assertSafeBind(host, options) {
  const opts = normalizeOptions(options);
  const reason = bindRefusal(host, opts);
  if (!reason) return;
  const err = new Error(
    `GÜVENLİK: Sunucu loopback dışı bir adrese (${host}) ${reason === 'TLS_REQUIRED' ? 'TLS olmadan' : 'kimlik doğrulama olmadan'} bağlanamaz. `
    + `Yalnız yerel kullanım için host'u 127.0.0.1 bırakın. / SECURITY: The server cannot bind to a non-loopback address (${host}) `
    + `${reason === 'TLS_REQUIRED' ? 'without TLS' : 'without authentication'}. Keep host at 127.0.0.1 for local use.`);
  err.code = 'UNSAFE_NETWORK_BIND';
  err.reason = reason;
  throw err;
}

// Başlangıçta kullanılan güvenli çözümleyici: FIRLATMAZ (watchdog altında sonsuz yeniden
// başlatma olmasın diye). Güvensiz yapılandırmada loopback'e düşürür ve bunu bildirir;
// böylece uygulama her zaman ayakta kalır ama açık metin ağ maruziyeti oluşmaz.
function resolveBindHost(host, options) {
  const opts = normalizeOptions(options);
  const reason = bindRefusal(host, opts);
  if (!reason) return { host: normalizeHost(host) === '' ? '127.0.0.1' : host, downgraded: false };
  return { host: '127.0.0.1', downgraded: true, requested: String(host), reason };
}

module.exports = { isLoopbackHost, assertSafeBind, resolveBindHost };
