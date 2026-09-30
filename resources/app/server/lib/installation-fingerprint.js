'use strict';

/* KURULUM PARMAK İZİ (7.0.178).
 *
 * Bir Buyer Log kurulumunu çalıştığı bilgisayar + Windows kullanıcısı ile
 * tanımlar. Veri klasörü başka bir bilgisayara/kullanıcıya kopyalandığında
 * deviceId aynı kalır ama bu değer değişir; kopya kurulum böyle anlaşılır
 * (bkz. local-db ensureDeviceBinding, sync-settings cihaz klasörü sahipliği).
 *
 * Yalnız geri döndürülemez kısa bir özet saklanır; bilgisayar veya kullanıcı
 * adı Shared Hub'a açık metin olarak yazılmaz. Klasör yolu bilerek dahil
 * değildir: kullanıcının kendi klasörünü taşıması kimlik değiştirmez.
 * Değerler bulunamazsa boş döner ve koruma devre dışı kalır (eski davranış).
 */

const os = require('os');
const crypto = require('crypto');

function clean(value) { return String(value == null ? '' : value).trim().toLowerCase(); }

function installationFingerprint(env = process.env) {
  const source = env && typeof env === 'object' ? env : {};
  let host = clean(source.COMPUTERNAME);
  let user = clean(source.USERNAME);
  if (!host) { try { host = clean(os.hostname()); } catch (_) { host = ''; } }
  if (!user) { try { user = clean(os.userInfo().username); } catch (_) { user = clean(source.USER); } }
  if (!host || !user) return '';
  return crypto.createHash('sha256').update(['buyerlog-installation-v1', host, user].join('\u0000')).digest('hex').slice(0, 32);
}

module.exports = { installationFingerprint };
