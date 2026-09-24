'use strict';

/* ===================================================================
   v6.55 — KALICI QTX DEPOSU (Colour Code bazlı)

   Kullanıcı isteği: Umbrella'dan indirilen QTX dosyası Buyer Log
   veritabanına KAYDEDİLSİN; Colour Code tüm modellerde ortak bir değer
   olduğu için bir kez kaydedilen QTX, aynı Colour Code'a sahip HER
   siparişte/modelde görünür ve yeniden indirilebilir olsun.

   TASARIM
   · Anahtar Colour Code'un KENDİSİ (normalize edilmiş) — sipariş, model,
     tablo bilgisi TAŞIMAZ. Bu bilinçli: kullanıcı "Colour Code aynı olduğu
     sürece diğer siparişlerde de görünsün" dedi; model/sipariş bazlı bir
     anahtar bu paylaşımı KIRARDI.
   · Dosyanın kendisi diske (QTX_FILES_ROOT altında, {hash}.qtx adıyla)
     yazılır; index (qtx-index.json) yalnız METADATA (gerçek dosya adı,
     kimin/ne zaman kaydettiği, diskteki dosya adı) tutar. Dosya adını
     Colour Code'dan DOĞRUDAN türetmek (path traversal / özel karakter
     riski) yerine kısa bir hash kullanılır — Colour Code serbest metin
     olduğu için (aksan, /, boşluk vb. içerebilir) dosya sistemi güvenliği
     için bu şart.
   =================================================================== */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { QTX_FILES_ROOT, SERVER_DATA_ROOT } = require('../user-data');

const INDEX_FILE = path.join(SERVER_DATA_ROOT, 'qtx-index.json');
const MAX_FILE_BYTES = 25 * 1024 * 1024; // QTX dosyaları küçüktür; 25MB cömert bir tavan.

function clean(value) {
  return String(value == null ? '' : value).trim();
}
// Umbrella eşleştirmesiyle AYNI normalleştirme (agent-browser-connector.js
// içindeki `normalize`/`canonical` ile tutarlı olmalı): boşluk sıkıştırma +
// Türkçe büyük harf. Anahtar tutarsızlığı, "aynı Colour Code farklı satırlarda
// görünmüyor" şeklinde sessiz bir hata üretirdi.
function colourKey(value) {
  return clean(value).replace(/\s+/g, ' ').toLocaleUpperCase('tr-TR');
}
function diskNameFor(key) {
  return crypto.createHash('sha1').update(key).digest('hex') + '.qtx';
}

function emptyIndex() {
  return { version: 1, entries: {} };
}

function loadIndex() {
  try {
    const raw = fs.readFileSync(INDEX_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return emptyIndex();
    parsed.entries = parsed.entries && typeof parsed.entries === 'object' ? parsed.entries : {};
    return parsed;
  } catch (_) {
    return emptyIndex();
  }
}

function saveIndex(index) {
  fs.mkdirSync(path.dirname(INDEX_FILE), { recursive: true });
  const tmp = `${INDEX_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(index, null, 2), 'utf8');
  fs.renameSync(tmp, INDEX_FILE);
}

// Kayıtlı TÜM Colour Code'ların listesi — istemci tarafı görsel işaretleme
// (kalın+mavi hücre) bu listeyle beslenir. Dosya içeriği taşınmaz, yalnız
// "hangi Colour Code'lar kayıtlı" bilgisi — bu liste her veri yüklemesinde
// istemciye gönderilecek kadar küçük kalmalı.
function listSavedColourCodes() {
  const index = loadIndex();
  return Object.keys(index.entries).filter(key => index.entries[key] && index.entries[key].diskName);
}

function entryFor(colourCode) {
  const key = colourKey(colourCode);
  if (!key) return null;
  const index = loadIndex();
  const entry = index.entries[key];
  return entry ? { ...entry, colourCode: key } : null;
}

// buffer: Buffer — indirilen QTX dosyasının ham baytları.
function saveQtxFile(colourCode, buffer, meta = {}) {
  const key = colourKey(colourCode);
  if (!key) throw Object.assign(new Error('Colour Code boş olamaz.'), { code: 'QTX_COLOUR_REQUIRED', statusCode: 400 });
  if (!Buffer.isBuffer(buffer) || !buffer.length) {
    throw Object.assign(new Error('QTX dosyası boş.'), { code: 'QTX_FILE_EMPTY', statusCode: 400 });
  }
  if (buffer.length > MAX_FILE_BYTES) {
    throw Object.assign(new Error(`QTX dosyası çok büyük (üst sınır ${Math.round(MAX_FILE_BYTES / 1024 / 1024)}MB).`), { code: 'QTX_FILE_TOO_LARGE', statusCode: 413 });
  }
  fs.mkdirSync(QTX_FILES_ROOT, { recursive: true });
  const diskName = diskNameFor(key);
  const fullPath = path.join(QTX_FILES_ROOT, diskName);
  fs.writeFileSync(fullPath, buffer);

  const index = loadIndex();
  index.entries[key] = {
    diskName,
    fileName: clean(meta.fileName) || `${key}.qtx`,
    size: buffer.length,
    savedAt: new Date().toISOString(),
    savedBy: clean(meta.savedBy),
  };
  saveIndex(index);
  return { ...index.entries[key], colourCode: key };
}

// Kayıtlı dosyanın diskteki tam yolunu döndürür; yoksa null. Sunucu ucu bunu
// stream ederken kullanır.
function filePathFor(colourCode) {
  const entry = entryFor(colourCode);
  if (!entry) return null;
  const fullPath = path.join(QTX_FILES_ROOT, entry.diskName);
  if (!fs.existsSync(fullPath)) return null;
  return { fullPath, fileName: entry.fileName };
}

module.exports = {
  colourKey,
  listSavedColourCodes,
  entryFor,
  saveQtxFile,
  filePathFor,
  INDEX_FILE,
};
