'use strict';

/* v6.50 — LFL "Manufacturer Order Volumes" ve "Classification Comparison"
 * arasındaki sürüklenebilir ayırıcı GÖRÜNMÜYORDU (regresyon).
 *
 * Kullanıcı bu özelliği istedi; kod aslında v6.35'te ZATEN yazılmıştı
 * (initAnalysisSplitter, --lfl-split CSS değişkeni, .lflSplitHandle). Sorun
 * özelliğin eksikliği değil, AYNI DOSYADA .lflAnalysisGrid ve .lflSplitHandle
 * seçicilerinin İKİ AYRI YERDE (v3.27 ve v3.32) KOŞULSUZ olarak yeniden
 * tanımlanmış olmasıydı — hiçbir media query içinde değillerdi, bu yüzden
 * CSS kaskadında (aynı özgüllük, dosyada SONRAKİ kazanır) v6.35'in asıl
 * tanımını (satır ~133) SESSİZCE eziyorlardı. Sonuç: ayırıcı DOM'da vardı,
 * JS'i çalışıyordu, ama grid her zaman TEK SÜTUNA düşüyor ve tutamaç
 * display:none oluyordu.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const CSS = fs.readFileSync(path.join(ROOT, 'public', 'lfl.css'), 'utf8');
const INDEX = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const LFL_JS = fs.readFileSync(path.join(ROOT, 'public', 'lfl.js'), 'utf8');

function allDefinitions(css, selector) {
  const out = [];
  let idx = 0;
  const needle = `${selector}{`;
  while (true) {
    idx = css.indexOf(needle, idx);
    if (idx < 0) break;
    // Yalnız TAM (bare) seçiciyi say; "#view-lfl .lflAnalysisGrid{" gibi
    // bileşik seçiciler farklı özgüllükte, ayrı ve meşru kurallardır.
    const lineStart = css.lastIndexOf('\n', idx) + 1;
    const prefix = css.slice(lineStart, idx).replace(/^@media\([^)]*\)\{/, '').replace(/.*[,{]\s*/, '');
    const isBare = prefix === '' || /^\s*$/.test(prefix);
    const open = idx + needle.length - 1;
    const close = css.indexOf('}', open);
    if (isBare) out.push({ at: idx, body: css.slice(open + 1, close) });
    idx = close;
  }
  return out;
}

// Bir konumun herhangi bir @media bloğunun İÇİNDE olup olmadığını, en yakın
// önceki @media{ ve onu kapatan } sayarak kabaca belirler. Bu dosyada tüm
// media blokları tek satırlık olduğu için (aynı satırda açılıp kapanıyor)
// yeterince güvenilir.
function isInsideMediaBlock(css, at) {
  const lineStart = css.lastIndexOf('\n', at) + 1;
  const line = css.slice(lineStart, css.indexOf('\n', at) < 0 ? css.length : css.indexOf('\n', at));
  return line.trim().startsWith('@media');
}

/* ---------------------------------------------------------- 1) TEK KOŞULSUZ TANIM */

test('v6.50 .lflAnalysisGrid için media dışı yalnız TEK tanım var (v6.35 split düzeni)', () => {
  const defs = allDefinitions(CSS, '.lflAnalysisGrid');
  const unconditional = defs.filter(d => !isInsideMediaBlock(CSS, d.at));
  assert.equal(unconditional.length, 1, 'koşulsuz ikinci bir tanım kalmamalı — çakışırdı');
  assert.match(unconditional[0].body, /var\(--lfl-split,1\.3fr\)/, 'kazanan tanım split değişkenini kullanmalı');
  assert.match(unconditional[0].body, /align-items:start/);
});

test('v6.50 .lflSplitHandle için media dışı yalnız TEK tanım var (görünür tutamaç)', () => {
  const defs = allDefinitions(CSS, '.lflSplitHandle');
  const unconditional = defs.filter(d => !isInsideMediaBlock(CSS, d.at));
  assert.equal(unconditional.length, 1, 'koşulsuz ikinci bir tanım (display:none) kalmamalı');
  assert.doesNotMatch(unconditional[0].body, /display:none/);
  assert.match(unconditional[0].body, /cursor:col-resize/);
});

test('v6.50 eski çakışan kurallar (v3.27, v3.32) sessizce yeniden eklenmemiş', () => {
  assert.doesNotMatch(CSS, /\n\.lflAnalysisGrid\{grid-template-columns:minmax\(0,1fr\);\}\n\.lflSplitHandle\{display:none;\}/);
  assert.doesNotMatch(CSS, /\.lflAnalysisGrid\{grid-template-columns:minmax\(0,1fr\) minmax\(560px,\.9fr\);align-items:stretch;\}/);
});

/* -------------------------------------------------- 2) DAR EKRAN DAVRANIŞI KORUNUYOR */

test('v6.50 dar ekranlarda ayırıcı hâlâ gizleniyor (meşru media-query davranışı)', () => {
  // Bu düzeltme yalnız KOŞULSUZ çakışmaları kaldırdı; @media(max-width:980px)
  // içindeki meşru "dar ekranda tek sütun" davranışı KORUNMALI.
  assert.match(CSS, /@media\(max-width:980px\)\{\.lflTopGrid,\.lflAnalysisGrid\{grid-template-columns:1fr;\}\.lflSplitHandle\{display:none;\}/);
  assert.match(CSS, /@media\(max-width:1280px\)\{\.lflAnalysisGrid\{grid-template-columns:1fr;\}/);
});

/* --------------------------------------------------------------- 3) YAN ETKİ YOK */

test('v6.50 v3.32\'nin diğer alt seçicileri (min-width, margin, max-height) korunuyor', () => {
  // Yalnız düzeni ezen grid-template-columns/align-items satırı kaldırıldı;
  // aynı bloktaki DİĞER kurallar (farklı seçiciler) silinmemeli.
  assert.match(CSS, /\.lflAnalysisGrid>\.lflCard\{min-width:0;margin-bottom:0;\}/);
  assert.match(CSS, /\.lflAnalysisGrid \.lflManufacturerVolumeCard\{margin-bottom:0;\}/);
  assert.match(CSS, /\.lflAnalysisGrid \.lflTableWrap,\.lflAnalysisGrid \.lflManufacturerVolume\{max-height:470px;\}/);
});

test('v6.50 dosya sözdizimsel olarak dengeli (brace ve yorum sayımı)', () => {
  let depth = 0;
  for (const ch of CSS) { if (ch === '{') depth++; else if (ch === '}') depth--; }
  assert.equal(depth, 0, 'süslü parantez dengesi bozuk olmamalı');
  const opens = (CSS.match(/\/\*/g) || []).length;
  const closes = (CSS.match(/\*\//g) || []).length;
  assert.equal(opens, closes, 'yorum blokları kapatılmamış olabilir');
});

/* ------------------------------------------------------------------- 4) DOM ve JS */

test('v6.50 sürükleme tutamacı DOM\'da ve "kibar" görsel tasarımda', () => {
  assert.match(INDEX, /id="lflAnalysisSplit"[^>]*role="separator"/);
  const handleDef = allDefinitions(CSS, '.lflSplitHandle>span')[0];
  assert.ok(handleDef);
  assert.match(handleDef.body, /width:3px/, 'ince, göze batmayan çizgi');
  assert.match(handleDef.body, /border-radius:var\(--r-pill\)/, 'yumuşak köşeli');
});

test('v6.50 JS tarafı doğru elemanları hedefliyor ve bir kez bağlanıyor', () => {
  assert.match(LFL_JS, /const handle=document\.getElementById\('lflAnalysisSplit'\);/);
  assert.match(LFL_JS, /const grid=document\.querySelector\('\.lflAnalysisGrid'\);/);
  assert.match(LFL_JS, /handle\.dataset\.splitBound==='1'\)return;/);
});
