'use strict';

/* v7.81 — DATA MAINTENANCE TEMA UYUMU.
 *
 * KORUNAN KUSUR (kullanıcı bildirdi): panel tema renkleriyle uyumsuzdu ve
 * yazılar okunmuyordu. Sebep, gözle görülmeyen bir yazım hatasıydı:
 *
 *     background: var(--panel, #fff)
 *     border:     var(--border, #d9e0ea)
 *     background: var(--soft,  #f7f9fc)
 *
 * --panel, --border ve --soft bu tasarım sisteminde HİÇ TANIMLI DEĞİL. CSS
 * bunu hata saymaz; sessizce geri düşüş değerini kullanır. Sonuç: panel her
 * temada beyaz, yazı her temada koyu — uygulamanın geri kalanı koyuyken.
 *
 * Bu yüzden "token kullandım" demek yetmez; token'ın VAR OLDUĞU ölçülmeli.
 * Aşağıdaki testler bunu ve kontrastı sayıyla kilitler.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const CSS = require('./helpers/manifest-css').rules(/blDataMaint/);
const CODE = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
const PALETTE = read('public/ui-tokens.css');

test('v7.81 sabit renk yok — her renk token’dan gelir', () => {
  const hex = CODE.match(/#[0-9a-fA-F]{3,8}\b/g) || [];
  assert.deepEqual(hex, [], `kodda sabit renk kaldı: ${hex.join(', ')}`);
});

test('v7.81 kullanılan her token GERÇEKTEN tanımlı', () => {
  /* Asıl kusur buydu. Tanımsız bir token sessizce geri düşüşe kaçar. */
  const used = [...new Set((CODE.match(/var\((--[a-z0-9-]+)/g) || []).map(v => v.slice(4)))];
  assert.ok(used.length >= 10, 'token kullanımı beklenenden az — test kendini kandırmasın');
  const missing = used.filter(token => !PALETTE.includes(`${token}:`));
  assert.deepEqual(missing, [], `tanımsız token: ${missing.join(', ')}`);
});

test('v7.81 token’ı gizleyen geri düşüşlü yazım kalmadı', () => {
  /* var(--x, #hex) tanımsız bir token'ı görünmez kılar: hata vermez, yalnız
     tema değiştiğinde yanlış renk verir. */
  const fallbacks = CODE.match(/var\(--[a-z0-9-]+\s*,\s*#[0-9a-fA-F]+\)/g) || [];
  assert.deepEqual(fallbacks, [], `geri düşüşlü yazım: ${fallbacks.join(', ')}`);
  for (const ghost of ['--panel', '--border', '--soft']) {
    assert.ok(!CODE.includes(ghost), `${ghost} bu sistemde yok`);
  }
});

/* ------------------------------------------------------------------ */
/* KONTRAST: "okunmuyor" şikâyeti ölçülerek kilitlenir.                */

function tokensFor(themeSelector) {
  const out = {};
  for (const source of [PALETTE]) {
    let from = 0;
    for (;;) {
      const i = source.indexOf(themeSelector, from);
      if (i < 0) break;
      const open = source.indexOf('{', i);
      const close = source.indexOf('}', open);
      for (const m of source.slice(open + 1, close).matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+)/g)) {
        out[m[1]] = m[2].trim();
      }
      from = close;
    }
  }
  return out;
}
function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h.slice(0, 6);
  return [0, 2, 4].map(i => parseInt(full.slice(i, i + 2), 16));
}
function mixOver(fg, alpha, bg) { return fg.map((c, i) => Math.round(c * alpha + bg[i] * (1 - alpha))); }
function resolve(value, tokens, under, depth = 0) {
  if (depth > 8) return null;
  const text = String(value).trim();
  if (text.startsWith('#')) return hexToRgb(text);
  const rgba = text.match(/^rgba?\(([^)]+)\)$/);
  if (rgba) {
    const parts = rgba[1].split(',').map(s => parseFloat(s.trim()));
    const alpha = parts.length > 3 ? parts[3] : 1;
    return alpha >= 1 ? parts.slice(0, 3) : mixOver(parts.slice(0, 3), alpha, under || [255, 255, 255]);
  }
  const ref = text.match(/^var\((--[a-z0-9-]+)\)$/);
  if (ref) return tokens[ref[1]] ? resolve(tokens[ref[1]], tokens, under, depth + 1) : null;
  return null;
}
function luminance([r, g, b]) {
  const f = c => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function contrast(fg, bg) {
  const a = luminance(fg) + 0.05;
  const b = luminance(bg) + 0.05;
  return Math.max(a, b) / Math.min(a, b);
}

/* Panelin KENDİ yüzey ve yazı çiftleri. Durum renkleri (--red/--orange/--green
   üstüne kendi -bg'leri) BİLEREK dışarıda: onlar uygulamanın ortak rozet
   paleti ve aynı çift .warnChip dâhil başka yerlerde de kullanılıyor. Yalnız
   burada koyulaştırmak, Data Maintenance'ı diğer uyarı rozetlerinden farklı
   gösterirdi (§9 — mevcut görsel kimliği koru). */
const PAIRS = [
  ['gövde yazısı', '--ui-text', '--ui-surface', 4.5],
  ['başlık açıklaması', '--ui-text-secondary', '--ui-surface', 4.5],
  ['araç çubuğu', '--ui-text', '--ui-surface-soft', 4.5],
  ['ölçüm etiketi', '--ui-text-secondary', '--ui-surface-soft', 4.5],
  ['bölüm başlığı', '--ui-text', '--ui-surface-soft', 4.5],
  ['tablo hücresi', '--ui-text', '--ui-surface', 4.5],
  ['tablo başlığı', '--ui-text-secondary', '--ui-surface-soft', 4.5],
  ['yol sütunu', '--ui-text-secondary', '--ui-surface', 4.5],
  ['rozet (nötr)', '--ui-text-secondary', '--ui-surface-soft', 4.5],
  ['JSON dökümü', '--ui-text', '--ui-canvas', 4.5],
];

for (const [themeName, selector] of [
  ['Aydınlık', ':root{'], ['Karanlık', '[data-theme="dark"]{'],
]) {
  test(`v7.81 ${themeName} temada her yazı okunur (WCAG AA)`, () => {
    const tokens = selector === ':root{' ? tokensFor(':root{') : { ...tokensFor(':root{'), ...tokensFor(selector) };
    for (const [label, fg, bg, min] of PAIRS) {
      const back = resolve(`var(${bg})`, tokens, null);
      const front = resolve(`var(${fg})`, tokens, back);
      assert.ok(front && back, `${label}: renk çözülemedi (${fg} / ${bg})`);
      const ratio = contrast(front, back);
      assert.ok(ratio >= min,
        `${themeName} · ${label}: ${ratio.toFixed(2)}:1 — ${min} eşiğinin altında, yazı okunmuyor`);
    }
  });
}

test('v7.81 ölçülen çiftler CSS’te GERÇEKTEN var', () => {
  /* Liste eskirse test yeşil kalır ama hiçbir şey korumaz. */
  for (const token of ['--ui-text', '--ui-text-secondary', '--ui-surface', '--ui-surface-soft', '--ui-canvas']) {
    assert.ok(CODE.includes(`var(${token})`), `${token} artık kullanılmıyor — çift listesi eskimiş`);
  }
  assert.ok(PALETTE.includes('--ui-text-muted:'), 'muted text is a defined canonical color');
});
