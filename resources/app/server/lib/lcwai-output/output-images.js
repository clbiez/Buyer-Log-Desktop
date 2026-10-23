'use strict';

/*
 * AI çıktılarında GERÇEK model görselleri.
 *
 * Bağlam CSV'sinde her kaydın kısa görsel anahtarı (ör. KOL-3, CP-12)
 * bulunur; sohbet görselleri bu anahtarlarla etiketli paftalar hâlinde LCW
 * AI'a da ekler (public/lcwai-chat.js). LCW AI çıktıda anahtarı yer tutucu olarak
 * kullanır (HTML: <img data-bl-image="KOL-3">, PPTX: slide.items[].image,
 * XLSX: "image" tipli sütun). Buyer Log yalnız kullanılan anahtarların
 * görsellerini kendi yerel deposundan alıp (renderer, kanonik çözümleyici)
 * küçültür ve dosyaya gömer. Görseller şirket dışına gitmez.
 */
const TOKEN_RE = /^[A-Z]{2,4}-\d{1,6}$/;
const LIMITS = Object.freeze({ count: 200, bytes: 1.5 * 1024 * 1024, total: 40 * 1024 * 1024 });
const DATA_URL_RE = /^data:image\/(png|jpeg|jpg|gif|webp);base64,([A-Za-z0-9+/=\s]+)$/i;

const isToken = value => TOKEN_RE.test(String(value || ''));

/* Biçime göre çıktıda kullanılan anahtarlar (tekrarsız, sınırlı). */
function collectTokens(format, data) {
  const tokens = new Set();
  const add = value => { const token = String(value || '').trim().toUpperCase(); if (isToken(token)) tokens.add(token); };
  if (format === 'html' || format === 'pdf') {
    const re = /data-bl-image="([^"]+)"/g;
    let match;
    while ((match = re.exec(String(data && data.body || '')))) add(match[1]);
  } else if (format === 'pptx') {
    for (const slide of (data && data.slides) || []) {
      add(slide.image);
      for (const item of slide.items || []) add(item.image);
    }
  } else if (format === 'xlsx') {
    for (const sheet of (data && data.sheets) || []) {
      sheet.columns.forEach((column, index) => { if (column.type === 'image') for (const row of sheet.rows) add(row[index]); });
    }
  }
  return [...tokens].slice(0, LIMITS.count);
}

/* Renderer'dan gelen { token: dataUrl } → { token: { buffer, mime, ext } }.
   Yalnız istenen anahtarlar, yalnız raster görsel, boyut sınırlarıyla. */
function normalizeImages(input, allowedTokens) {
  const allowed = new Set(allowedTokens || []);
  const out = {};
  let total = 0;
  for (const [key, value] of Object.entries(input && typeof input === 'object' ? input : {})) {
    const token = String(key).toUpperCase();
    if (!allowed.has(token) || Object.keys(out).length >= LIMITS.count) continue;
    const match = DATA_URL_RE.exec(String(value || ''));
    if (!match) continue;
    const buffer = Buffer.from(match[2].replace(/\s+/g, ''), 'base64');
    const type = match[1].toLowerCase() === 'jpg' ? 'jpeg' : match[1].toLowerCase();
    if (!buffer.length || buffer.length > LIMITS.bytes || total + buffer.length > LIMITS.total) continue;
    if (!signatureMatches(type, buffer)) continue;
    total += buffer.length;
    out[token] = { buffer, mime: `image/${type}`, ext: type === 'jpeg' ? 'jpg' : type, dataUrl: `data:image/${type};base64,${buffer.toString('base64')}`, ...imageSize(type, buffer) };
  }
  return out;
}

function signatureMatches(type, buffer) {
  if (type === 'png') return buffer.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]));
  if (type === 'jpeg') return buffer[0] === 0xFF && buffer[1] === 0xD8;
  if (type === 'gif') return buffer.slice(0, 3).toString('latin1') === 'GIF';
  if (type === 'webp') return buffer.slice(0, 4).toString('latin1') === 'RIFF' && buffer.slice(8, 12).toString('latin1') === 'WEBP';
  return false;
}

/* En-boy oranı için piksel boyutu (PNG/JPEG/GIF; bilinmezse kare). */
function imageSize(type, buffer) {
  try {
    if (type === 'png') return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
    if (type === 'gif') return { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) };
    if (type === 'jpeg') {
      let offset = 2;
      while (offset < buffer.length) {
        if (buffer[offset] !== 0xFF) break;
        const marker = buffer[offset + 1];
        const length = buffer.readUInt16BE(offset + 2);
        if (marker >= 0xC0 && marker <= 0xCF && ![0xC4, 0xC8, 0xCC].includes(marker)) return { width: buffer.readUInt16BE(offset + 7), height: buffer.readUInt16BE(offset + 5) };
        offset += 2 + length;
      }
    }
  } catch (_) {}
  return { width: 1, height: 1 };
}

/* Kart bilgisi için kaynak satırlar: renderer bağlam tablosundaki satırı
   görsel anahtarıyla verir ({ KOL-3: [[sütun, değer], …] }). Yalnız
   istenen anahtarlar, yalnız düz metin, sınırlı boyutta. Bu veri LCW AI'a
   gitmez; yalnız Buyer Log'un ürettiği dosyada kart bilgisi olarak yazılır. */
const RECORD_LIMITS = Object.freeze({ fields: 60, label: 60, value: 300 });
function normalizeRecords(input, allowedTokens) {
  const allowed = new Set(allowedTokens || []);
  const out = {};
  const text = (value, max) => String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, max);
  for (const [key, value] of Object.entries(input && typeof input === 'object' && !Array.isArray(input) ? input : {})) {
    const token = String(key).toUpperCase();
    if (!allowed.has(token) || !Array.isArray(value)) continue;
    const pairs = value.filter(Array.isArray).map(pair => [text(pair[0], RECORD_LIMITS.label), text(typeof pair[1] === 'object' ? '' : pair[1], RECORD_LIMITS.value)])
      .filter(([label, cell]) => label && cell && label !== 'BL Image').slice(0, RECORD_LIMITS.fields);
    if (pairs.length) out[token] = pairs;
  }
  return out;
}

/* HTML gövdesindeki yer tutucuları gerçek görselle (ya da "görsel yok"
   kutusuyla) değiştirir. Gövde temizleyiciden geçmiştir. */
function fillHtmlImages(body, images, lang) {
  const english = lang === 'en';
  return String(body || '').replace(/<img\b([^>]*?)\sdata-bl-image="([^"]+)"([^>]*)>/g, (all, before, token, after) => {
    const image = images[String(token).toUpperCase()];
    const attrs = `${before}${after}`.replace(/\ssrc="[^"]*"/g, '');
    if (image) return `<img${attrs} src="${image.dataUrl}" data-bl-image="${token}">`;
    const alt = /\salt="([^"]*)"/.exec(attrs);
    return `<span class="bl-noimg" data-bl-image="${token}">${english ? 'No image' : 'Görsel yok'}${alt && alt[1] ? `<small>${alt[1]}</small>` : ''}</span>`;
  });
}

module.exports = { TOKEN_RE, LIMITS, RECORD_LIMITS, isToken, collectTokens, normalizeImages, normalizeRecords, fillHtmlImages, imageSize, signatureMatches };
