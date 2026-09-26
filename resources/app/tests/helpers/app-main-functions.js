'use strict';

/* app-main.js'teki üst düzey fonksiyonları DAVRANIŞ testi için yükler.
 *
 * app-main.js DOM'a sıkı bağlı dev bir klasik script; bütünüyle Node'da
 * çalıştırılamaz. Saf hesap fonksiyonları (sayı ayrıştırma, ağırlıklı
 * ortalama, lisans/landed fiyat, yuvarlama…) ise tek başına çalışır. Bu
 * yardımcı istenen fonksiyonların KAYNAĞINI olduğu gibi çıkarır ve ayrı bir
 * vm bağlamında çalıştırır: stub yok, üretimdeki kodun kendisi test edilir.
 *
 * Çıkarma, dize/şablon/yorum/regex farkında basit bir parantez eşleştiricidir.
 * Bir fonksiyon bulunamazsa ya da eksik bağımlılık varsa test sessizce
 * geçmez: SyntaxError / ReferenceError ile düşer.
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const APP_MAIN = path.join(__dirname, '..', '..', 'public', 'app-main.js');
let cachedSource = null;

const REGEX_PREV = /[(,=:[!&|?{};+\-*%<>~^]$|(?:^|[^\w$])(?:return|typeof|case|in|of|delete|void|throw|new|else|do)$/;

function skipString(src, i, quote) {
  for (i++; i < src.length; i++) {
    if (src[i] === '\\') { i++; continue; }
    if (src[i] === quote) return i + 1;
  }
  throw new Error('kapanmayan dize');
}

function skipRegex(src, i) {
  let inClass = false;
  for (i++; i < src.length; i++) {
    const ch = src[i];
    if (ch === '\\') { i++; continue; }
    if (ch === '[') inClass = true;
    else if (ch === ']') inClass = false;
    else if (ch === '/' && !inClass) { i++; while (/[a-z]/i.test(src[i])) i++; return i; }
    else if (ch === '\n') throw new Error('kapanmayan regex');
  }
  throw new Error('kapanmayan regex');
}

/* src[i] '{' iken eşleşen '}' sonrasını döndürür. Şablon içindeki ${ } de
   aynı fonksiyonla özyinelemeli taranır. */
function skipBlock(src, i) {
  let depth = 0;
  for (; i < src.length; i++) {
    const ch = src[i], next = src[i + 1];
    if (ch === '/' && next === '/') { i = src.indexOf('\n', i); if (i < 0) break; continue; }
    if (ch === '/' && next === '*') { i = src.indexOf('*/', i + 2) + 1; continue; }
    if (ch === '"' || ch === "'") { i = skipString(src, i, ch) - 1; continue; }
    if (ch === '`') { i = skipTemplate(src, i) - 1; continue; }
    if (ch === '/') {
      const before = src.slice(Math.max(0, i - 12), i).replace(/\s+$/, '');
      if (REGEX_PREV.test(before)) { i = skipRegex(src, i) - 1; continue; }
    }
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return i + 1; }
  }
  throw new Error('kapanmayan blok');
}

function skipTemplate(src, i) {
  for (i++; i < src.length; i++) {
    if (src[i] === '\\') { i++; continue; }
    if (src[i] === '`') return i + 1;
    if (src[i] === '$' && src[i + 1] === '{') i = skipBlock(src, i + 1) - 1;
  }
  throw new Error('kapanmayan şablon');
}

function extractFunction(source, name) {
  const match = new RegExp(`(^|\\n)((?:async )?function\\*? ${name}\\s*\\()`).exec(source);
  if (!match) throw new Error(`app-main.js içinde "function ${name}(" bulunamadı`);
  const start = match.index + match[1].length;
  // Parametre listesi varsayılan değerlerde { } içerebilir: parantezleri say.
  let i = start + match[2].length, depth = 1;
  for (; depth > 0 && i < source.length; i++) {
    if (source[i] === '(') depth++;
    else if (source[i] === ')') depth--;
    else if (source[i] === '{') i = skipBlock(source, i) - 1;
    else if (source[i] === '"' || source[i] === "'") i = skipString(source, i, source[i]) - 1;
  }
  const bodyStart = source.indexOf('{', i);
  return source.slice(start, skipBlock(source, bodyStart));
}

function loadAppMainFunctions(names, globals = {}) {
  if (cachedSource == null) cachedSource = fs.readFileSync(APP_MAIN, 'utf8');
  const code = names.map(name => extractFunction(cachedSource, name)).join('\n');
  const context = vm.createContext({ ...globals });
  vm.runInContext(`${code}\n;globalThis.__blExports={${names.join(',')}};`, context, { filename: 'app-main.js (seçili fonksiyonlar)' });
  return context.__blExports;
}

module.exports = { loadAppMainFunctions, extractFunction };
