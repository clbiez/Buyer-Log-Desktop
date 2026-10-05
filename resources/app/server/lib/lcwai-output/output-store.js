'use strict';

/*
 * LCW AI çıktı dosyaları + metadata kaydı.
 *
 * Masaüstünde ana süreç BUYER_LOG_AI_OUTPUTS_ROOT ile kullanıcının gerçek
 * İndirilenler klasörünü verir. Tarayıcı/headless kipinde eski güvenli yerel
 * klasör (<LOCAL_DATA_ROOT>/ai-outputs) yedek davranış olarak korunur.
 * Ad anlamlı ve güvenlidir:
 * "<başlık> - <YYYY-MM-DD>.<uzantı>", çakışmada " (2)", " (3)"…
 *
 * Metadata (ai-outputs-index.json, klasörün yanında) yalnız dosya bilgisi
 * taşır: kimlik, sahip, ad, biçim, şablon, boyut, zaman, deneme sayısı.
 * Prompt, AI cevabı, token veya Authorization bilgisi ASLA yazılmaz.
 * Renderer dosyaya yalnız kimlik (id) ile ulaşır; yol kabul edilmez.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MAX_INDEX = 500;
const PENDING_TTL_MS = 15 * 60 * 1000;
const EXTENSIONS = Object.freeze({ pdf: 'pdf', xlsx: 'xlsx', pptx: 'pptx', html: 'html' });

function defaultRoot() {
  if (process.env.BUYER_LOG_AI_OUTPUTS_ROOT) return process.env.BUYER_LOG_AI_OUTPUTS_ROOT;
  // user-data yalnız gerektiğinde yüklenir (testler kökü enjekte eder).
  return path.join(require('../../user-data').LOCAL_DATA_ROOT, 'ai-outputs');
}

function defaultIndexFile(rootDir) {
  // Çıktının kendisi Downloads'a gidebilir; metadata kullanıcı profilinin
  // köküne saçılmaz. Eski ve yeni sürümler aynı yerel index'i kullanır.
  if (process.env.BUYER_LOG_AI_OUTPUTS_ROOT) {
    return path.join(require('../../user-data').LOCAL_DATA_ROOT, 'ai-outputs-index.json');
  }
  return path.join(path.dirname(rootDir), 'ai-outputs-index.json');
}

function legacyRoot() {
  try { return path.join(require('../../user-data').LOCAL_DATA_ROOT, 'ai-outputs'); }
  catch (_) { return ''; }
}

/* Windows/macOS/Linux için güvenli dosya adı tabanı (Türkçe harfler korunur). */
function safeFileBase(value, fallback = 'LCW AI') {
  // İzin listesi: harf, rakam, boşluk ve - _ . , ( ) +. Tırnaklar (tipografik
  // olanlar dâhil), ; $ ` [ ] & % gibi kabuk/joker anlamı taşıyan her şey düşer:
  // ad, LCW AI'ın yazdığı başlıktan gelir ve "Aç" işletim sistemi komutuna gider.
  let base = String(value == null ? '' : value).normalize('NFC')
    .replace(/['`\u2018-\u201F\u2032\u2035]/g, '')
    .replace(/[^\p{L}\p{M}\p{N} \-_.,()+]+/gu, ' ')
    .replace(/\s+/g, ' ').trim()
    .replace(/^[.\s-]+|[.\s]+$/g, '');
  if (/^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i.test(base)) base = `_${base}`;
  base = base.slice(0, 80).replace(/[.\s]+$/, '').trim();
  return base || fallback;
}

function fileNameFor(title, format, date = new Date()) {
  const day = (date instanceof Date ? date : new Date()).toISOString().slice(0, 10);
  return `${safeFileBase(title)} - ${day}.${EXTENSIONS[format] || 'bin'}`;
}

function createOutputStore(options = {}) {
  const now = typeof options.now === 'function' ? options.now : () => new Date();
  let rootPath = options.root || null;
  const root = () => (rootPath || (rootPath = defaultRoot()));
  const indexFile = () => options.indexFile || defaultIndexFile(root());
  const pending = new Map();

  function readIndex() {
    let raw;
    try { raw = fs.readFileSync(indexFile(), 'utf8'); } catch (_) { return []; }
    try { const list = JSON.parse(raw); if (Array.isArray(list)) return list; } catch (_) {}
    // Bozuk kayıt sessizce ezilmez: yanına yedeklenir, yeni kayıt boş başlar.
    try { fs.renameSync(indexFile(), `${indexFile()}.corrupt-${Date.now()}`); } catch (_) {}
    return [];
  }
  function writeIndex(list) {
    const file = indexFile();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temp = `${file}.${process.pid}.${crypto.randomBytes(3).toString('hex')}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(list.slice(-MAX_INDEX), null, 1), 'utf8');
    fs.renameSync(temp, file);
  }

  /* Çakışmasız yaz: 'wx' bayrağı aynı ada iki yazımı engeller. */
  function writeUnique(fileName, buffer) {
    const dir = root();
    fs.mkdirSync(dir, { recursive: true });
    const ext = path.extname(fileName);
    const stem = fileName.slice(0, fileName.length - ext.length);
    for (let n = 1; n < 1000; n++) {
      const name = n === 1 ? fileName : `${stem} (${n})${ext}`;
      const full = path.join(dir, name);
      try { fs.writeFileSync(full, buffer, { flag: 'wx' }); return { name, full }; }
      catch (error) { if (error && error.code === 'EEXIST') continue; throw error; }
    }
    throw new Error('ai-output-name-exhausted');
  }

  function publicRecord(record) {
    if (!record) return null;
    return {
      id: record.id, fileName: record.fileName, format: record.format, title: record.title,
      template: record.template, templateLabel: record.templateLabel, bytes: record.bytes,
      createdAt: record.createdAt, attempts: record.attempts, path: record.path, folder: path.dirname(record.path),
    };
  }

  function save(ownerId, { buffer, title, format, template = '', templateLabel = '', attempts = 1, requestId = '' } = {}) {
    if (!Buffer.isBuffer(buffer) || !buffer.length) throw new Error('ai-output-empty');
    const created = now();
    const written = writeUnique(fileNameFor(title, format, created), buffer);
    const record = {
      id: crypto.randomBytes(12).toString('hex'),
      owner: String(ownerId || 'default'),
      fileName: written.name,
      path: written.full,
      format,
      title: String(title || '').slice(0, 160),
      template, templateLabel,
      bytes: buffer.length,
      attempts,
      requestId: String(requestId || '').slice(0, 64),
      createdAt: created.toISOString(),
    };
    const list = readIndex();
    list.push(record);
    writeIndex(list);
    return publicRecord(record);
  }

  /* Sahibine ait kaydı döndürür. Yeni dosyalar Downloads'tadır; yükseltme
     öncesinde üretilmiş kayıtlar için eski LOCAL_DATA_ROOT/ai-outputs klasörü
     de yalnız-okuma uyumluluğu olarak kabul edilir. Her iki durumda da index
     elle değiştirilerek başka bir klasöre çıkılamaz. */
  function get(ownerId, id) {
    const record = readIndex().find(item => item.id === String(id || '') && item.owner === String(ownerId || 'default'));
    if (!record) return null;
    const full = path.resolve(record.path);
    const allowed = new Set([path.resolve(root())]);
    const legacy = legacyRoot();
    if (legacy) allowed.add(path.resolve(legacy));
    if (!allowed.has(path.dirname(full)) || !fs.existsSync(full)) return null;
    return { ...publicRecord(record), path: full };
  }

  function list(ownerId, limit = 20) {
    return readIndex().filter(item => item.owner === String(ownerId || 'default')).slice(-limit).reverse().map(publicRecord);
  }

  /* PDF bekleyenleri: HTML masaüstü kabuğunda basılana kadar bellekte durur. */
  function putPending(ownerId, data) {
    const at = Date.now();
    for (const [key, value] of pending) if (at - value.at > PENDING_TTL_MS) pending.delete(key);
    const id = crypto.randomBytes(12).toString('hex');
    pending.set(id, { ...data, owner: String(ownerId || 'default'), at });
    return id;
  }
  function takePending(ownerId, id, { keep = false } = {}) {
    const entry = pending.get(String(id || ''));
    if (!entry || entry.owner !== String(ownerId || 'default') || Date.now() - entry.at > PENDING_TTL_MS) return null;
    if (!keep) pending.delete(String(id));
    return entry;
  }

  return { save, get, list, putPending, takePending, root, indexFile };
}

module.exports = { createOutputStore, safeFileBase, fileNameFor, EXTENSIONS };
