'use strict';
/*
 * Demo veri seti için temsili ürün görselleri (bağımlılıksız PNG).
 *
 * Görseller tamamen soyuttur: düz arka plan üzerinde basit bir giysi silüeti,
 * model rengi ve tohumdan türeyen bir desen (çizgi/puan/blok). Yazı, logo,
 * marka ya da lisanslı karakter içermez. Aynı girdi her zaman aynı baytları üretir.
 */
const zlib = require('node:zlib');

const COLOURS = {
  SIYAH: [38, 38, 42], LACIVERT: [32, 48, 92], KIRMIZI: [190, 40, 45], 'GRI MELANJ': [150, 152, 158],
  EKRU: [232, 224, 204], HAKI: [112, 116, 72], PEMBE: [236, 150, 178], MAVI: [64, 128, 200], BORDO: [118, 30, 48],
};
const SHAPES = {
  // Normalize (0–1) çokgenler: kazak/sweatshirt, tişört, hırka, pijama üstü.
  top: [[0.30, 0.12], [0.42, 0.10], [0.50, 0.16], [0.58, 0.10], [0.70, 0.12], [0.92, 0.30], [0.84, 0.42], [0.74, 0.36],
    [0.74, 0.90], [0.26, 0.90], [0.26, 0.36], [0.16, 0.42], [0.08, 0.30]],
  tee: [[0.32, 0.14], [0.43, 0.12], [0.50, 0.18], [0.57, 0.12], [0.68, 0.14], [0.86, 0.26], [0.78, 0.36], [0.70, 0.32],
    [0.70, 0.88], [0.30, 0.88], [0.30, 0.32], [0.22, 0.36], [0.14, 0.26]],
};

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function hashSeed(text) { let h = 2166136261; for (const ch of String(text)) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }

const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(buf) { let c = 0xFFFFFFFF; for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function encodePng(width, height, rgb) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) { raw[y * (width * 3 + 1)] = 0; rgb.copy(raw, y * (width * 3 + 1) + 1, y * width * 3, (y + 1) * width * 3); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
function inside(poly, x, y) {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}
const mix = (a, b, t) => a.map((v, i) => Math.round(v * (1 - t) + b[i] * t));

/* key: model/renk kimliği (deterministik tohum), colour: CATALOG renk adı, category: ürün klasmanı. */
function productImage({ key, colour, category, width = 240, height = 300 }) {
  const rand = mulberry32(hashSeed(key));
  const base = COLOURS[String(colour || '').toUpperCase()] || [120, 120, 130];
  const light = base[0] + base[1] + base[2] > 520;
  const accent = light ? mix(base, [40, 40, 50], 0.45) : mix(base, [255, 255, 255], 0.55);
  const bg = mix([244, 242, 238], base, 0.08);
  const shape = /T-SHIRT|PIJAMA/.test(String(category || '').toUpperCase()) ? SHAPES.tee : SHAPES.top;
  const pattern = Math.floor(rand() * 4); // 0 düz, 1 çizgi, 2 puan, 3 göğüs bloğu
  const period = 10 + Math.floor(rand() * 14), offset = Math.floor(rand() * period);
  const block = [0.36 + rand() * 0.06, 0.40 + rand() * 0.08, 0.20 + rand() * 0.06, 0.16 + rand() * 0.06];
  const rgb = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const nx = x / width, ny = y / height;
      let px = bg;
      if (inside(shape, nx, ny)) {
        px = base;
        if (pattern === 1 && ((y + offset) % period) < period / 3) px = accent;
        else if (pattern === 2 && ((x + offset) % period) < 4 && ((y + offset) % period) < 4) px = accent;
        else if (pattern === 3 && nx > block[0] && nx < block[0] + block[2] && ny > block[1] && ny < block[1] + block[3]) px = accent;
        // Hafif gölge: kenarlara doğru koyulaşma, düz renk yerine kumaş hissi.
        const shade = 1 - Math.abs(nx - 0.5) * 0.18;
        px = px.map(v => Math.max(0, Math.min(255, Math.round(v * shade))));
      }
      const o = (y * width + x) * 3; rgb[o] = px[0]; rgb[o + 1] = px[1]; rgb[o + 2] = px[2];
    }
  }
  return encodePng(width, height, rgb);
}

module.exports = { productImage, encodePng, COLOURS };
