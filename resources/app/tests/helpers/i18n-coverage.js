'use strict';
/* ===================================================================
   Buyer Log — TR/EN dil kapsamı tarayıcısı (testler + scripts/i18n-coverage.js)
   Kaynak dosyalardaki Türkçe karakter içeren string/template literal'larını
   çıkarır ve her birinin İngilizce karşılığı olup olmadığına bakar:
     1. Literal, TR/EN çift yardımcısının parçasıdır: L('tr','en'),
        isEn()?'en':'tr', {tr:'..',en:'..'} gibi bitişik literal çiftleri.
     2. i18n-dictionary.js sözlüğü (i18n-runtime.js çeviri motoru) metni
        İngilizceye çevirebiliyor.
     3. Satırda bilinçli muafiyet işareti var: `i18n-ignore` (veri anahtarı,
        Excel başlığı, regex kaynağı vb. — görünen UI metni değil).
   Karşılığı olmayan literal'lar "eksik" sayılır. Mevcut eksikler
   tests/fixtures/i18n-coverage-baseline.json içinde dondurulur; yeni eksik
   eklenemez (ratchet).
   =================================================================== */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const APP_ROOT = path.resolve(__dirname, '..', '..');
const PUBLIC = path.join(APP_ROOT, 'public');
const BASELINE_FILE = path.join(APP_ROOT, 'tests', 'fixtures', 'i18n-coverage-baseline.json');
const TR_CHAR = /[çğıİöşüÇĞŞÜÖ]/;
const IGNORE_MARK = 'i18n-ignore';

// Dil sözlüğü/veri dosyaları ve UI metni üretmeyen dosyalar taranmaz.
const SKIP_FILES = new Set([
  'public/i18n-dictionary.js',
  'public/i18n-runtime.js',
  'public/sw.js',
]);

function rel(file) {
  return path.relative(APP_ROOT, file).split(path.sep).join('/');
}

// Geliştirici önizleme sayfaları kullanıcıya gösterilmez.
const SKIP_HTML = new Set(['public/design-preview.html']);

function listScanFiles() {
  return fs.readdirSync(PUBLIC)
    .filter(name => name.endsWith('.js') || name.endsWith('.html'))
    .map(name => path.join(PUBLIC, name))
    .filter(file => !SKIP_FILES.has(rel(file)) && !SKIP_HTML.has(rel(file)))
    .sort((a, b) => a.localeCompare(b));
}

// ---- lexer ------------------------------------------------------------------
// Yorumları atlar, string ve template literal'larını (${...} → {n}) toplar.
// Regex literal'ları sezgisel olarak önceki anlamlı karaktere göre ayırt edilir.
const REGEX_PREFIX = new Set(['', '(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '<', '>', '~', '^']);
const REGEX_KEYWORDS = /(?:^|[^\w$])(return|typeof|case|do|else|in|of|new|delete|void|throw|yield|await)$/;

function extractLiterals(src) {
  const out = [];
  let i = 0;
  let line = 1;
  let lastSig = '';
  let sigTail = '';
  const n = src.length;

  function pushLiteral(value, startLine, startIdx, endIdx, quote) {
    out.push({ value, line: startLine, start: startIdx, end: endIdx, quote });
  }

  function readQuoted(q) {
    const startLine = line;
    const startIdx = i;
    i++;
    let value = '';
    while (i < n) {
      const c = src[i];
      if (c === '\\') {
        const next = src[i + 1];
        if (next === '\n') line++;
        if (next === 'n') value += '\n';
        else if (next === 't') value += '\t';
        else if (next === 'u' && src[i + 2] === '{') {
          const close = src.indexOf('}', i);
          value += String.fromCodePoint(parseInt(src.slice(i + 3, close), 16));
          i = close + 1;
          continue;
        } else if (next === 'u') {
          value += String.fromCharCode(parseInt(src.slice(i + 2, i + 6), 16));
          i += 6;
          continue;
        } else if (next === 'x') {
          value += String.fromCharCode(parseInt(src.slice(i + 2, i + 4), 16));
          i += 4;
          continue;
        } else value += next;
        i += 2;
        continue;
      }
      if (c === q) { i++; break; }
      if (c === '\n') { line++; if (q !== '`') break; }
      value += c;
      i++;
    }
    pushLiteral(value, startLine, startIdx, i, q);
  }

  // Template literal: ${...} ifadeleri {0},{1}… yer tutucusuna dönüşür;
  // ifadelerin içindeki literal'lar da ayrıca taranır.
  function readTemplate() {
    const startLine = line;
    const startIdx = i;
    i++;
    let value = '';
    let ph = 0;
    while (i < n) {
      const c = src[i];
      if (c === '\\') { value += src[i + 1] === 'n' ? '\n' : src[i + 1]; if (src[i + 1] === '\n') line++; i += 2; continue; }
      if (c === '`') { i++; break; }
      if (c === '$' && src[i + 1] === '{') {
        value += `{${ph++}}`;
        i += 2;
        scan(true);
        continue;
      }
      if (c === '\n') line++;
      value += c;
      i++;
    }
    pushLiteral(value, startLine, startIdx, i, '`');
  }

  function readRegex() {
    i++;
    let inClass = false;
    while (i < n) {
      const c = src[i];
      if (c === '\\') { i += 2; continue; }
      if (c === '\n') break;
      if (c === '[') inClass = true;
      else if (c === ']') inClass = false;
      else if (c === '/' && !inClass) { i++; break; }
      i++;
    }
    while (i < n && /[a-z]/i.test(src[i])) i++;
  }

  // untilBrace: template ifadesi içindeyken eşleşen } görülünce döner.
  function scan(untilBrace) {
    let depth = 0;
    while (i < n) {
      const c = src[i];
      if (c === '\n') { line++; i++; continue; }
      if (c === ' ' || c === '\t' || c === '\r') { i++; continue; }
      if (c === '/' && src[i + 1] === '/') {
        while (i < n && src[i] !== '\n') i++;
        continue;
      }
      if (c === '/' && src[i + 1] === '*') {
        const close = src.indexOf('*/', i + 2);
        const end = close < 0 ? n : close + 2;
        for (let k = i; k < end; k++) if (src[k] === '\n') line++;
        i = end;
        continue;
      }
      if (c === '\'' || c === '"') { readQuoted(c); lastSig = 'x'; sigTail = ''; continue; }
      if (c === '`') { readTemplate(); lastSig = 'x'; sigTail = ''; continue; }
      if (c === '/') {
        if (REGEX_PREFIX.has(lastSig) || REGEX_KEYWORDS.test(sigTail)) { readRegex(); lastSig = 'x'; sigTail = ''; continue; }
      }
      if (untilBrace) {
        if (c === '{') depth++;
        else if (c === '}') {
          if (depth === 0) { i++; lastSig = 'x'; return; }
          depth--;
        }
      }
      lastSig = /[\w$]/.test(c) ? 'x' : c;
      sigTail = (sigTail + c).slice(-12);
      if (c === ')' || c === ']') lastSig = 'x';
      i++;
    }
  }

  scan(false);
  return out.sort((a, b) => a.start - b.start);
}

// ---- kapsam kontrolü ---------------------------------------------------------
let runtimeCache = null;
function loadRuntime() {
  if (runtimeCache) return runtimeCache;
  const window = {};
  const context = vm.createContext({ window });
  vm.runInContext(fs.readFileSync(path.join(PUBLIC, 'i18n-dictionary.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(PUBLIC, 'i18n-runtime.js'), 'utf8'), context);
  runtimeCache = window.BLI18n;
  return runtimeCache;
}

const norm = value => String(value == null ? '' : value).replace(/\s+/g, ' ').trim();

// Aynı iç içelik düzeyindeki literal'lar yalnız çift ayraçlarıyla (',' ':'
// '?' '||' '??', isteğe bağlı "en:" / "tr": anahtarı ya da "+ ifade")
// ayrılmışsa bir "dizi" oluşturur: L('tr','en'), isEn()?'en':'tr',
// {tr:'..',en:'..'}, ['id',trBaşlık,trMetin,enBaşlık,enMetin] gibi.
// Template ${...} içindeki literal'lar dıştaki dizinin üyesi sayılmaz.
const PAIR_GAP = /^(?:\s*\+[^;'"`{}\n]{0,80}?)?\s*(?:,|:|\?|\|\||\?\?)\s*(?:["']?[A-Za-z_$][\w$]*["']?\s*:\s*)?$/;
// tr = '…'; en = '…'; (hintTr/hintEn gibi dil adlı değişkenlere art arda atama)
const ASSIGN_GAP = /^\s*[;,]\s*(?:(?:let|const|var)\s+)?[\w$]*(?:en|En|EN|tr|Tr|TR)[\w$]*\s*=\s*$/;

// İngilizce metin: harf içerir, cümle/etiket biçimindedir ve kelimelerinin
// çoğu Türkçe karakter içermez (ASAS "Üretici" gibi alan adları serbest).
function looksEnglish(value) {
  const text = norm(value);
  if (!text || !/[A-Za-z]/.test(text)) return false;
  if (!/\s|\{\d+\}/.test(text) && !/^[A-Z]/.test(text)) return false;
  // Tırnak içindeki kaynak alan adları ("Ürün Tanım") sayılmaz.
  const words = text.replace(/"[^"]*"|“[^”]*”|'[^']*'/g, ' ').split(/\s+/).filter(Boolean);
  if (!words.length) return false;
  const trWords = words.filter(word => TR_CHAR.test(word)).length;
  return trWords / words.length <= 0.3;
}

// Nesne anahtarı olan literal ("en": …) dizi üyesi değildir.
// {tr:[ '…', '…' ], en:[ … ]} biçimindeki dil dizileri: literal "tr"
// anahtarlı bir dizinin içindeyse karşılığı "en" dizisindedir.
function insideTrArray(src, lit) {
  let depth = 0;
  for (let k = lit.start - 1, stop = Math.max(0, lit.start - 8000); k >= stop; k--) {
    const c = src[k];
    if (c === ']') depth++;
    else if (c === '[') {
      if (depth === 0) return /["']?tr["']?\s*:\s*$/.test(src.slice(Math.max(0, k - 20), k));
      depth--;
    } else if (c === '{' || c === '}' || c === ';') {
      if (depth === 0) return false;
    }
  }
  return false;
}

function isObjectKey(src, lit) {
  let k = lit.end;
  while (k < src.length && /\s/.test(src[k])) k++;
  if (src[k] !== ':') return false;
  k = lit.start - 1;
  while (k >= 0 && /\s/.test(src[k])) k--;
  return src[k] === '{' || src[k] === ',';
}

function pairedLiterals(src, lits) {
  const parent = new Array(lits.length).fill(-1);
  const open = [];
  lits.forEach((lit, index) => {
    while (open.length && lits[open[open.length - 1]].end <= lit.start) open.pop();
    if (open.length) parent[index] = open[open.length - 1];
    open.push(index);
  });
  const siblings = new Map();
  lits.forEach((lit, index) => {
    if (isObjectKey(src, lit)) return;
    const key = parent[index];
    if (!siblings.has(key)) siblings.set(key, []);
    siblings.get(key).push(index);
  });
  const paired = new Array(lits.length).fill(false);
  const closeRun = run => {
    let tr = 0, en = 0;
    for (const index of run) {
      const value = lits[index].value;
      if (looksEnglish(value)) en++;
      else if (isCandidate(value)) tr++;
    }
    // Bilinçli olarak iki dilde aynı kalan çift ('Türkiye','Türkiye').
    const values = run.map(index => norm(lits[index].value));
    const dup = values.length - new Set(values).size;
    en += dup;
    tr -= dup;
    if (en && en >= tr) run.forEach(index => { paired[index] = true; });
  };
  for (const group of siblings.values()) {
    let run = [group[0]];
    for (let k = 1; k < group.length; k++) {
      const a = lits[group[k - 1]], b = lits[group[k]];
      const gap = src.slice(a.end, b.start);
      if (PAIR_GAP.test(gap) || ASSIGN_GAP.test(gap)) run.push(group[k]);
      else { closeRun(run); run = [group[k]]; }
    }
    closeRun(run);
  }
  // Çiftin içindeki ${...} literal'ları o çiftin dil tarafına aittir.
  return lits.map((_, index) => {
    for (let at = index; at >= 0; at = parent[at]) if (paired[at]) return true;
    return false;
  });
}

// console.* çağrılarının argümanları geliştirici günlüğüdür, UI metni değil.
function insideConsoleCall(src, idx) {
  const from = Math.max(0, idx - 400);
  const before = src.slice(from, idx);
  const at = before.lastIndexOf('console.');
  if (at < 0) return false;
  const call = /^console\.(?:log|warn|error|info|debug|trace|table|group|groupCollapsed)\s*\(/.exec(before.slice(at));
  if (!call) return false;
  let depth = 0;
  for (let k = at + call[0].length - 1; k < before.length; k++) {
    if (before[k] === '(') depth++;
    else if (before[k] === ')') depth--;
  }
  return depth > 0;
}

function lineAt(src, idx) {
  const s = src.lastIndexOf('\n', idx - 1) + 1;
  const e = src.indexOf('\n', idx);
  return src.slice(s, e < 0 ? src.length : e);
}

// Görünen metin olmayan literal'lar: yalnız boşluk/sembol, tek kelimelik
// anahtar benzeri değerler değil — Türkçe karakter zaten kriter.
function isCandidate(value) {
  const text = norm(value);
  if (!text || !TR_CHAR.test(text)) return false;
  // Yer tutucudan ibaret parçalar ya da HTML iskeleti (ör. "{0}ı") görünen metin değil.
  const letters = text.replace(/\{\d+\}/g, '').replace(/<[^>]*>/g, '');
  return /[A-Za-zçğıöşüÇĞİÖŞÜ]{2,}/.test(letters);
}

// HTML parçası içeren literal'lar görünür metin parçalarına ayrılır.
function visibleSegments(value) {
  if (!/<[a-z/!][^>]*>/i.test(value)) return [value];
  return value
    .replace(/<[^>]*>/g, '\u0000')
    .split('\u0000')
    .map(norm)
    .filter(isCandidate);
}

function translates(runtime, text) {
  const t = norm(text);
  const out = norm(runtime.translate(t, 'en'));
  // Kısmi çeviri ("Şablon aktarımı failed") karşılık sayılmaz.
  return out !== t && (!TR_CHAR.test(out) || looksEnglish(out));
}

function scanSource(src, file) {
  const runtime = loadRuntime();
  const lits = extractLiterals(src);
  const paired = pairedLiterals(src, lits);
  const missing = [];
  lits.forEach((lit, index) => {
    if (!isCandidate(lit.value)) return;
    if (paired[index]) return;
    if (looksEnglish(lit.value)) return;
    if (insideTrArray(src, lit)) return;
    if (lineAt(src, lit.start).includes(IGNORE_MARK)) return;
    if (insideConsoleCall(src, lit.start)) return;
    for (const seg of visibleSegments(lit.value)) {
      if (!isCandidate(seg)) continue;
      if (translates(runtime, seg)) continue;
      missing.push({ file, line: lit.line, text: norm(seg) });
    }
  });
  return missing;
}

// HTML: görünen metin düğümleri ve title/placeholder/aria-label/alt
// öznitelikleri. data-i18n-tr/en çifti taşıyan öğeler zaten iki dillidir;
// <script>/<style> içeriği ve data-no-i18n işaretli öğeler taranmaz.
function scanHtml(src, file) {
  const runtime = loadRuntime();
  const missing = [];
  const lineOf = idx => src.slice(0, idx).split('\n').length;
  const blank = m => m.replace(/[^\n]/g, ' ');
  const body = src.replace(/<!--[\s\S]*?-->/g, blank).replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, blank);
  const check = (text, idx) => {
    const value = norm(text.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"'));
    if (!isCandidate(value) || looksEnglish(value)) return;
    if (lineAt(src, idx).includes(IGNORE_MARK)) return;
    if (translates(runtime, value)) return;
    missing.push({ file, line: lineOf(idx), text: value });
  };
  // Öğe açılış etiketleri: i18n çifti ya da muafiyet varsa içerik de atlanır.
  const skipStack = [];
  const TAG = /<(\/?)([a-zA-Z][\w-]*)([^>]*)>|([^<]+)/g;
  const VOID = new Set(['br', 'hr', 'img', 'input', 'meta', 'link', 'source', 'col', 'wbr', 'area', 'base']);
  let m;
  while ((m = TAG.exec(body))) {
    if (m[4] != null) {
      if (!skipStack.some(Boolean)) check(m[4], m.index);
      continue;
    }
    const closing = m[1] === '/';
    const name = m[2].toLowerCase();
    const attrs = m[3] || '';
    if (closing) { if (!VOID.has(name)) skipStack.pop(); continue; }
    const bilingual = /data-i18n-tr=/.test(attrs) || /data-no-i18n/.test(attrs);
    if (!bilingual) {
      for (const a of attrs.matchAll(/\b(title|placeholder|aria-label|alt)="([^"]*)"/g)) check(a[2], m.index);
    }
    if (!VOID.has(name) && !attrs.trim().endsWith('/')) skipStack.push(bilingual);
  }
  return missing;
}

function scanFile(file) {
  const src = fs.readFileSync(file, 'utf8');
  return file.endsWith('.html') ? scanHtml(src, rel(file)) : scanSource(src, rel(file));
}

function scanAll() {
  const byFile = {};
  for (const file of listScanFiles()) {
    const missing = scanFile(file);
    byFile[rel(file)] = missing;
  }
  return byFile;
}

// Baseline: dosya → eksik metin listesi (benzersiz, sıralı). Satır numarası
// tutulmaz; ilgisiz düzenlemeler baseline'ı bozmasın.
function toBaseline(byFile) {
  const out = {};
  for (const [file, list] of Object.entries(byFile)) {
    const texts = [...new Set(list.map(item => item.text))].sort();
    if (texts.length) out[file] = texts;
  }
  return out;
}

function readBaseline() {
  if (!fs.existsSync(BASELINE_FILE)) return {};
  return JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8')).files || {};
}

module.exports = {
  APP_ROOT,
  BASELINE_FILE,
  IGNORE_MARK,
  extractLiterals,
  listScanFiles,
  readBaseline,
  rel,
  scanAll,
  scanFile,
  scanSource,
  toBaseline,
};
