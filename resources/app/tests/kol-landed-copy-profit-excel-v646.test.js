'use strict';

/* v6.46 — Overseas Landed kopyalamada kâr yüzdesi Excel'e (HTML clipboard)
 * ULAŞMIYORDU.
 *
 * Kullanıcı gözlemi: "koleksiyon ekranında kopyalama yapınca Overseas landed
 * fiyatının % fiyat farkı dışarıya aktarılmıyor, sadece Overseas Landed
 * fiyatı aktarılıyor."
 *
 * Kök neden: v6.42'de kâr yüzdesi data-copy-text'e eklenmişti ("$4,31
 * (-3,4%)") ama data-copy-num ve data-copy-numfmt HER ZAMAN da ekleniyordu.
 * _copyCellFromTd bir hücrede data-copy-num sayısal bulunca hücreyi SAYISAL
 * modda işliyor ve panonun ZENGİN/HTML tarafına (tarayıcıdan Excel'e
 * yapıştırırken KULLANILAN taraf) yalnız SAF SAYIYI (num.toFixed(2), kâr YOK)
 * yazıyordu. Kâr yüzdesi yalnız düz metin/TSV satırına (plainText) gidiyordu
 * — kullanıcı Ctrl+V ile Excel'e yapıştırdığında bu asla görünmüyordu.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');

function bodyOf(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} bulunmalı`);
  let paren = 0, i = source.indexOf('(', start);
  for (; i < source.length; i++) {
    if (source[i] === '(') paren++;
    else if (source[i] === ')' && --paren === 0) break;
  }
  const open = source.indexOf('{', i);
  let depth = 0;
  for (let j = open; j < source.length; j++) {
    if (source[j] === '{') depth++;
    else if (source[j] === '}' && --depth === 0) return source.slice(open + 1, j);
  }
  throw new Error(`${name} ayrıştırılamadı`);
}

const escapeHtml = v => String(v);
const kolMoney2 = n => Number(n).toFixed(2).replace('.', ',');
const kolLandedCopyAttrs = new Function('escapeHtml', 'kolMoney2',
  `function kolLandedCopyAttrs(value,profitPct){${bodyOf(APP, 'kolLandedCopyAttrs')}} return kolLandedCopyAttrs;`
)(escapeHtml, kolMoney2);

async function copyCellFromTd(td) {
  const _COPY_BORDER = '1px solid #000';
  const _COPY_NUMFMT = { money2: '"$"#,##0.00' };
  const copyPlainCell = t => t;
  const _copyVisualStyle = () => ({});
  const fn = new Function('escapeHtml', '_COPY_BORDER', '_COPY_NUMFMT', 'copyPlainCell', '_copyVisualStyle',
    `return (async function _copyCellFromTd(td,styleCache,imageCache){${bodyOf(APP, '_copyCellFromTd')}});`
  )(escapeHtml, _COPY_BORDER, _COPY_NUMFMT, copyPlainCell, _copyVisualStyle);
  return fn(td, new Map(), new Map());
}

function fakeTd(dataset) {
  return { querySelector: () => null, dataset, classList: { contains: () => false }, textContent: '' };
}

/* --------------------------------------------------- 1) ATTRIBUTE ÜRETİMİ */

test('v6.46 kâr varken sayısal kopyalama attribute\'ları hiç üretilmiyor', () => {
  const attrs = kolLandedCopyAttrs(4.3123, -3.4);
  assert.match(attrs, /data-copy-text="\$4,31 \(-3,4%\)"/);
  assert.doesNotMatch(attrs, /data-copy-num=/);
  assert.doesNotMatch(attrs, /data-copy-numfmt=/);
});

test('v6.46 kâr yokken (TR Landed) davranış değişmiyor', () => {
  const attrs = kolLandedCopyAttrs(4.3123, null);
  assert.match(attrs, /data-copy-text="\$4,31"/);
  assert.match(attrs, /data-copy-num="4\.31"/);
  assert.match(attrs, /data-copy-numfmt="money2"/);
});

/* -------------------------------------------- 2) UÇTAN UCA: HTML/EXCEL YOLU */

test('v6.46 kârlı hücrenin HTML (Excel yapıştırma) çıktısında kâr görünüyor', async () => {
  // Bu, kullanıcının şikayet ettiği asıl yol: tarayıcıdan Excel'e Ctrl+V
  // yapıştırıldığında KULLANILAN taraf .html, .text değil.
  const td = fakeTd({ copyText: '$4,31 (-3,4%)' });
  const result = await copyCellFromTd(td);
  const excelSees = result.html || escapeHtml(result.text);
  assert.match(excelSees, /\(-3,4%\)/, 'Excel yapıştırmasında kâr yüzdesi görünmeli');
});

test('v6.46 kârsız hücre (TR Landed) hâlâ saf sayı olarak kopyalanıyor', async () => {
  // Formülde kullanılabilirlik yalnız kâr OLMAYAN hücrelerde korunuyor.
  const td = fakeTd({ copyText: '$4,31', copyNum: '4.31', copyNumfmt: 'money2' });
  const result = await copyCellFromTd(td);
  assert.match(result.style, /mso-number-format/, 'sayısal biçim korunmalı');
  assert.equal(result.text, '4.31');
});

test('v6.46 plainText (TSV) tarafında da kâr görünmeye devam ediyor', async () => {
  // Not defterine veya düz metin editörüne yapıştırma yolu bozulmamalı.
  const td = fakeTd({ copyText: '$4,31 (-3,4%)' });
  const result = await copyCellFromTd(td);
  assert.match(result.plainText, /\(-3,4%\)/);
});

test('v6.46 boş landed değeri hâlâ boş kopyalanıyor', () => {
  assert.equal(kolLandedCopyAttrs(null, -3.4), ' data-copy-text=""');
  assert.equal(kolLandedCopyAttrs('abc', -3.4), ' data-copy-text=""');
});
