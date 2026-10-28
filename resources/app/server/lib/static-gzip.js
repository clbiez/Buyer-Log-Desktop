'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { promisify } = require('util');

const gzip = promisify(zlib.gzip);
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
};
const MIN_BYTES = 1024;
// Bir renderer açılışı ~155 sıkıştırılabilir dosya ister; 48 kayıtlık LRU sıralı
// taramada hiç isabet etmiyor ve her sekme/yenilemede hepsini yeniden sıkıştırıyordu.
const DEFAULT_MAX_ENTRIES = 256;
const DEFAULT_MAX_BYTES = 32 * 1024 * 1024;

function safeJoin(root, urlPath) {
  let decoded;
  try { decoded = decodeURIComponent(urlPath); } catch (_) { return null; }
  if (decoded.indexOf('\0') >= 0) return null;
  const rel = decoded.replace(/^\/+/, '');
  const full = path.resolve(root, rel);
  const rootResolved = path.resolve(root);
  if (full !== rootResolved && !full.startsWith(rootResolved + path.sep)) return null;
  return full;
}

function hasVersionToken(urlValue) {
  try {
    const parsed = new URL(String(urlValue || ''), 'http://buyerlog.local');
    return /^\d+\.\d+(?:\.\d+)?$/.test(parsed.searchParams.get('v') || '');
  } catch (_) { return false; }
}
function isContentHashed(filePath) {
  return /(?:^|[._-])[a-f0-9]{8,}(?:[._-]|$)/i.test(path.basename(filePath));
}
function cacheControlFor(filePath, requestUrl) {
  // The HTML shell creates/refreshes the local Buyer session on GET /. A cached
  // shell can otherwise be restored without that request reaching Express, while
  // /user-context.js is fetched without a session and receives a redirect.
  if (path.extname(filePath).toLowerCase() === '.html') return 'no-store';
  const vendor = /(?:^|[\\/])vendor(?:[\\/]|$)/.test(filePath);
  return vendor && (hasVersionToken(requestUrl) || isContentHashed(filePath))
    ? 'public, max-age=31536000, immutable'
    : 'no-cache';
}

function createStaticGzip(root, options) {
  const opts = options || {};
  const minBytes = Number(opts.minBytes) || MIN_BYTES;
  const maxEntries = Math.max(1, Number(opts.maxEntries) || DEFAULT_MAX_ENTRIES);
  const maxBytes = Math.max(minBytes, Number(opts.maxBytes) || DEFAULT_MAX_BYTES);
  const cache = new Map();
  const inflight = new Map();
  let cacheBytes = 0;

  function touch(filePath, entry) {
    cache.delete(filePath);
    cache.set(filePath, entry);
  }
  function evict() {
    while (cache.size > maxEntries || cacheBytes > maxBytes) {
      const oldest = cache.entries().next().value;
      if (!oldest) break;
      cache.delete(oldest[0]);
      cacheBytes -= oldest[1].body.length;
    }
  }
  async function buildEntry(filePath, stat, tag) {
    const existing = inflight.get(filePath);
    if (existing?.tag === tag) return existing.promise;
    const promise = (async () => {
      const raw = await fs.promises.readFile(filePath);
      const body = await gzip(raw, { level: zlib.constants.Z_DEFAULT_COMPRESSION });
      return { tag, body };
    })().finally(() => {
      const current = inflight.get(filePath);
      if (current?.promise === promise) inflight.delete(filePath);
    });
    inflight.set(filePath, { tag, promise });
    return promise;
  }

  return async function staticGzip(req, res, next) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    if (!/\bgzip\b/i.test(String(req.headers['accept-encoding'] || ''))) return next();

    const urlPath = String(req.url || '').split('?')[0];
    const target = urlPath === '/' ? '/index.html' : urlPath;
    const ext = path.extname(target).toLowerCase();
    if (!TYPES[ext]) return next();
    const filePath = safeJoin(root, target);
    if (!filePath) return next();

    let stat;
    try { stat = await fs.promises.stat(filePath); } catch (_) { return next(); }
    if (!stat.isFile() || stat.size < minBytes) return next();

    const tag = `${stat.size}-${Number(stat.mtimeMs).toString(36)}`;
    const etag = `W/"gz-${tag}"`;
    const sendHeaders = () => {
      res.setHeader('Content-Type', TYPES[ext]);
      res.setHeader('Content-Encoding', 'gzip');
      res.setHeader('Vary', 'Accept-Encoding');
      res.setHeader('ETag', etag);
      res.setHeader('Cache-Control', cacheControlFor(filePath, req.originalUrl || req.url));
    };
    // ETag dosya meta verisinden türetilir; 304 için gövde okunmaz/sıkıştırılmaz.
    if (String(req.headers['if-none-match'] || '') === etag) {
      sendHeaders();
      res.statusCode = 304;
      return res.end();
    }
    let entry = cache.get(filePath);
    try {
      if (!entry || entry.tag !== tag) {
        const previous = entry;
        entry = await buildEntry(filePath, stat, tag);
        if (previous) cacheBytes -= previous.body.length;
        cache.set(filePath, entry);
        cacheBytes += entry.body.length;
        evict();
      } else touch(filePath, entry);
    } catch (_) { return next(); }

    if (res.headersSent || res.writableEnded) return;
    sendHeaders();
    res.setHeader('Content-Length', String(entry.body.length));
    if (req.method === 'HEAD') return res.end();
    return res.end(entry.body);
  };
}

module.exports = {
  createStaticGzip, safeJoin, TYPES, MIN_BYTES,
  cacheControlFor, hasVersionToken, isContentHashed,
  DEFAULT_MAX_ENTRIES, DEFAULT_MAX_BYTES,
};
