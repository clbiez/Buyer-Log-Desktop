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
async function warmFile(file) {
  try {
    const stat = await fs.promises.stat(file);
    if (!stat.isFile()) return false;
    const tag = `${stat.size}:${stat.mtimeMs}`, hit = hashes.get(file);
    if (hit && hit.tag === tag) return false;
    const hash = crypto.createHash('sha256').update(await fs.promises.readFile(file)).digest('hex').slice(0, HASH_LENGTH);
    if (hashes.size >= MAX_ENTRIES) hashes.clear();
    hashes.set(file, { tag, hash });
    return true;
  } catch (_) { return false; /* ilk istekte senkron yola düşer */ }
}
// Açılışta arka planda: ilk GET / özetleri senkron hesaplamak zorunda kalmaz
// (yavaş disk/antivirüste ~165 dosyanın okunması). Eksik kalan dosya ilk istekte hesaplanır.
async function warmAssetHashes(html, root, versionToken) {
  const token = String(versionToken).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`(?:src|href)="([^"?#:]+)\\?v=${token}(?=[&"])`, 'g');
  let warmed = 0;
  for (const match of String(html).matchAll(pattern)) {
    const file = safeFile(root, match[1]);
    if (file && await warmFile(file)) warmed += 1;
  }
  return warmed;
}

/* Tembel yüklenen betikler (7.0.323). perf-runtime.js'in yüklediği ~90 betik
   index.html'de yer almadığı için içerik özeti alamıyor ve her açılışta
   "no-cache" ile yeniden doğrulanıyordu. Liste perf-runtime.js kaynağından
   okunur (ikinci bir elle tutulan liste yok); özetler arka planda ısıtılır ve
   sunulan sayfaya yalnız GÜNCEL içerikle eşleşen özetler yazılır. */
const LAZY_SCRIPT_PATTERN = /'([A-Za-z0-9_][A-Za-z0-9_\-\/.]*\.js)(?:\?[^']*)?'/g;
function lazyScriptFiles(perfRuntimeSource) {
  const out = new Set();
  for (const match of String(perfRuntimeSource || '').matchAll(LAZY_SCRIPT_PATTERN)) {
    if (!match[1].includes('..')) out.add(match[1]);
  }
  return [...out];
}
async function warmFileHashes(root, relatives) {
  let warmed = 0;
  for (const relative of relatives || []) {
    const file = safeFile(root, relative);
    if (file && await warmFile(file)) warmed += 1;
  }
  return warmed;
}
// Yalnız önbellekte olan ve boyut/zaman damgası hâlâ tutan özetler: dosya
// değiştiyse eski özet yayımlanmaz (adres değişmeden bayat kod kalıcılaşmaz).
function cachedHashMap(root, relatives) {
  const map = {};
  for (const relative of relatives || []) {
    const file = safeFile(root, relative);
    const hit = file && hashes.get(file);
    if (!hit) continue;
    let info;
    try { info = fs.statSync(file); } catch (_) { continue; }
    if (`${info.size}:${info.mtimeMs}` === hit.tag) map[relative] = hit.hash;
  }
  return map;
}
// Satır içi <script type="application/json"> içine güvenle gömülebilir JSON.
function hashMapJson(map) {
  return JSON.stringify(map || {}).replace(/</g, '\\u003c');
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

module.exports = { contentHash, stampAssetHashes, warmAssetHashes, immutableForRequest, HASH_LENGTH, lazyScriptFiles, warmFileHashes, cachedHashMap, hashMapJson };
