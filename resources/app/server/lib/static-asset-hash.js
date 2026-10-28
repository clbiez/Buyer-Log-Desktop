'use strict';

/* İçerik özetli statik dosya adresleri.
   index.html her açılışta ~190 betik/stil dosyasını "no-cache" ile yeniden
   doğrulatıyordu (tekrar açılışta 0,6–0,8 sn yalnız 304 turu). Sunulan HTML'deki
   yerel adreslere dosyanın içerik özeti (h) eklenir; istek bu özeti taşıyor ve
   dosyanın GÜNCEL içeriğiyle eşleşiyorsa yanıt kalıcı önbelleğe alınabilir.
   Dosya değişince özet ve adres değişir: aynı sürüm numarasıyla gelen el yaması
   veya geliştirme düzenlemesi bayat dosya bırakmaz. Eşleşmeyen/eksik özet eski
   "no-cache" davranışında kalır. */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const HASH_LENGTH = 16;
const MAX_ENTRIES = 2048;
const hashes = new Map();

function safeFile(root, relative) {
  const base = path.resolve(root);
  const full = path.resolve(base, String(relative || '').replace(/^\/+/, ''));
  return full.startsWith(base + path.sep) ? full : null;
}
// Özet dosya boyutu + değişiklik zamanı aynı kaldıkça yeniden hesaplanmaz.
function contentHash(file, stat = null) {
  let info = stat;
  try { if (!info) info = fs.statSync(file); } catch (_) { return ''; }
  if (!info.isFile()) return '';
  const tag = `${info.size}:${info.mtimeMs}`, hit = hashes.get(file);
  if (hit && hit.tag === tag) return hit.hash;
  let hash = '';
  try { hash = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').slice(0, HASH_LENGTH); } catch (_) { return ''; }
  if (hashes.size >= MAX_ENTRIES) hashes.clear();
  hashes.set(file, { tag, hash });
  return hash;
}
// src/href="yerel/dosya?v=TOKEN..." → "yerel/dosya?v=TOKEN&h=ÖZET..."
function stampAssetHashes(html, root, versionToken) {
  const token = String(versionToken).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`((?:src|href)=")([^"?#:]+)(\\?v=${token})(?=[&"])`, 'g');
  return String(html).replace(pattern, (match, attr, relative, version) => {
    const file = safeFile(root, relative);
    const hash = file ? contentHash(file) : '';
    return hash ? `${attr}${relative}${version}&h=${hash}` : match;
  });
}
function requestHash(requestUrl) {
  try { return new URL(String(requestUrl || ''), 'http://buyerlog.local').searchParams.get('h') || ''; }
  catch (_) { return ''; }
}
// İstek özeti dosyanın güncel içeriğiyle birebir eşleşiyorsa kalıcı önbellek uygundur.
function immutableForRequest(file, requestUrl, stat = null) {
  const wanted = requestHash(requestUrl);
  return Boolean(wanted && wanted.length === HASH_LENGTH && wanted === contentHash(file, stat));
}

module.exports = { contentHash, stampAssetHashes, immutableForRequest, HASH_LENGTH };
