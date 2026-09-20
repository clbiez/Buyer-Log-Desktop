/* ===================================================================
   v7.28 — FORMÜL MOTORU (hesaplanan sütunlar)

   Kullanıcı talebi (birebir): "tablolara sütunları birleştiren, sütunlar arası
   hesaplama yapabilen bir yeni sütun ekle sistemi kurmak istiyorum. mesela X ve
   Y sütununu tarih içeriyor, Z sütununu oluşturup X ve Y arasında kaç gün fark
   var görmek istiyorum. veya A ve B sütunu rakam içeriyor, aralarındaki
   farkı/çarpımı/bölme sonucunu ... C sütununu oluşturup görebileyim."

   TASARIM KARARLARI

   1) eval YOK. Formüller kullanıcıdan gelir ve ileride kullanıcılar arasında
      paylaşılabilir. eval/new Function kullanmak, bir başkasının yazdığı
      metnin sizin tarayıcınızda kod olarak çalışması demekti. Bunun yerine
      kendi sözcük çözümleyici + ayrıştırıcı + değerlendiricimiz var: bir
      formül YALNIZ aşağıdaki işleçleri ve fonksiyonları çalıştırabilir.

   2) HATA SESSİZ DEĞİL. Yazım hatası, bilinmeyen fonksiyon, olmayan sütun ve
      sıfıra bölme ayrı ayrı raporlanır; hücrede "—" görünür ve sütun başlığı
      hatayı söyler. Yanlış bir sayıyı doğruymuş gibi göstermek en pahalı
      hatadır (§152).

   3) TARİH ARİTMETİĞİ AÇIK. ASAS tarihleri hem 'YYYY-MM-DD' hem 'YYYYMMDD'
      hem de Date olabiliyor. Tarih fonksiyonları üçünü de kabul eder;
      DAYS(a,b) iki tarih arasındaki GÜN farkını verir (b - a).

   4) TÜRKÇE SAYI GİRDİSİ. Hücre değerleri "1.234,56" biçiminde gelebilir;
      sayıya çevirme bunu doğru okur. Formülün KENDİSİNDE ondalık ayırıcı
      noktadır (virgül argüman ayırıcıdır) — yardım metni bunu söyler.
   =================================================================== */
(function (global) {
  'use strict';

  const MAX_DEPTH = 60;
  const MAX_LENGTH = 2000;

  class FormulaError extends Error {
    constructor(message, code = 'FORMULA_ERROR', position = null) {
      super(message);
      this.name = 'FormulaError';
      this.code = code;
      this.position = position;
    }
  }

  /* ---------------- değer yardımcıları ---------------- */

  function isBlank(value) {
    return value == null || value === '' || (typeof value === 'number' && !Number.isFinite(value));
  }

  // "1.234,56" → 1234.56, "1,234.56" → 1234.56, "%12" → 12
  function toNumber(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value === 'boolean') return value ? 1 : 0;
    if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : null;
    const text = String(value == null ? '' : value).trim().replace(/[%\s ]/g, '');
    if (!text) return null;
    let normalized = text;
    const hasComma = text.includes(','), hasDot = text.includes('.');
    if (hasComma && hasDot) {
      normalized = text.lastIndexOf(',') > text.lastIndexOf('.')
        ? text.replace(/\./g, '').replace(',', '.')   // 1.234,56
        : text.replace(/,/g, '');                     // 1,234.56
    } else if (hasComma) {
      // Tek virgül ondalık ayırıcıdır; birden çoksa binlik ayırıcıdır.
      normalized = (text.match(/,/g) || []).length === 1 ? text.replace(',', '.') : text.replace(/,/g, '');
    } else if ((text.match(/\./g) || []).length > 1) {
      /* "1.234.567" — birden çok nokta yalnız binlik ayırıcı olabilir; tek
         noktalı "1.234" ise BELİRSİZDİR ve programın geri kalanıyla (app-main
         `toNum` → ham Number) uyumlu kalmak için ondalık sayılır. */
      normalized = text.replace(/\./g, '');
    }
    const number = Number(normalized);
    return Number.isFinite(number) ? number : null;
  }

  const DAY_MS = 86400000;
  /* Bir değer TARİH GİBİ Mİ duruyor?

     Sebep: ASAS tarihleri 20260302 gibi 8 haneli SAYI olarak da gelir. Böyle
     iki hücreyi "-" ile çıkarınca kullanıcının kastettiği neredeyse her zaman
     GÜN FARKIDIR (14), sayı farkı (86) değil. Ama her 8 haneli sayıyı tarih
     saymak da yanlış olur; bu yüzden yalnız GERÇEK bir takvim tarihine
     karşılık gelen (yıl 2000-2099, ay 1-12, gün ayın uzunluğu içinde)
     değerler tarih sayılır. Şüphe varsa DAYS() her zaman açıktır. */
  function looksLikeDate(value) {
    if (value instanceof Date) return Number.isFinite(value.getTime());
    const text = String(value == null ? '' : value).trim();
    if (!text) return false;
    if (/^\d{4}-\d{2}-\d{2}/.test(text)) return true;
    if (/^\d{1,2}[./-]\d{1,2}[./-]\d{4}$/.test(text)) return true;
    const match = /^(\d{4})(\d{2})(\d{2})$/.exec(text);
    if (!match) return false;
    const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
    if (year < 2000 || year > 2099 || month < 1 || month > 12 || day < 1) return false;
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  }
  function toDate(value) {
    /* Motorun İÇİNDE her tarih UTC gece yarısıdır; gün farkı, YEAR/MONTH/DAY ve
       metne çevirme hep UTC okur. Ama uygulamanın satırlarındaki tarihler Excel
       çözümlemesinden YEREL gece yarısı olarak gelir. UTC+3'te yerel gece yarısı
       bir önceki günün 21:00 UTC'sidir; ham hâliyle kullanılsaydı 2 Mart tarihli
       her hücre "1 Mart" yazardı. Bu yüzden gelen Date'in YEREL takvim günü
       alınıp UTC gece yarısına taşınır. */
    if (value instanceof Date) {
      if (!Number.isFinite(value.getTime())) return null;
      return makeDate(value.getFullYear(), value.getMonth() + 1, value.getDate());
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      // 20260216 gibi sayısal ASAS tarihleri.
      const text = String(Math.trunc(value));
      if (/^\d{8}$/.test(text)) return toDate(text);
      return null;
    }
    const text = String(value == null ? '' : value).trim();
    if (!text) return null;
    let match = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
    if (!match) match = /^(\d{4})(\d{2})(\d{2})$/.exec(text);
    if (!match) {
      const dmy = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/.exec(text);
      if (dmy) return makeDate(Number(dmy[3]), Number(dmy[2]), Number(dmy[1]));
      return null;
    }
    return makeDate(Number(match[1]), Number(match[2]), Number(match[3]));
  }
  function makeDate(year, month, day) {
    if (!(month >= 1 && month <= 12) || !(day >= 1 && day <= 31)) return null;
    // UTC: saat dilimi kayması gün farkını 1 gün oynatmasın.
    const date = new Date(Date.UTC(year, month - 1, day));
    return Number.isFinite(date.getTime()) ? date : null;
  }
  function dateText(date) {
    return date instanceof Date && Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : '';
  }
  function toText(value) {
    if (value == null) return '';
    if (value instanceof Date) return dateText(value);
    if (typeof value === 'boolean') return value ? 'DOĞRU' : 'YANLIŞ';
    return String(value);
  }
  function toBool(value) {
    if (typeof value === 'boolean') return value;
    if (isBlank(value)) return false;
    const number = toNumber(value);
    if (number != null) return number !== 0;
    const text = String(value).trim().toLocaleLowerCase('tr-TR');
    return !['', 'hayır', 'hayir', 'no', 'false', 'yanlış', 'yanlis', '0'].includes(text);
  }

  /* ---------------- sözcük çözümleyici ---------------- */

  const PUNCT = ['<=', '>=', '<>', '!=', '==', '&&', '||', '+', '-', '*', '/', '%', '^', '(', ')', ',', ';', '<', '>', '=', '&'];

  function tokenize(input) {
    const text = String(input == null ? '' : input);
    if (text.length > MAX_LENGTH) throw new FormulaError(`Formül çok uzun (en fazla ${MAX_LENGTH} karakter).`, 'FORMULA_TOO_LONG');
    const tokens = [];
    let i = 0;
    while (i < text.length) {
      const ch = text[i];
      if (/\s/.test(ch)) { i += 1; continue; }
      if (ch === '[') {
        const end = text.indexOf(']', i + 1);
        if (end < 0) throw new FormulaError('Sütun adı kapatılmamış: "]" eksik.', 'UNCLOSED_COLUMN', i);
        tokens.push({ type: 'column', value: text.slice(i + 1, end).trim(), position: i });
        i = end + 1;
        continue;
      }
      if (ch === '"' || ch === "'") {
        /* TERS BÖLÜ KAÇIŞI destekleniyor: \" \' \\ ve satır sonu \n \t.
           Gerekçe: Birleştirme kipinde ayracı kullanıcı yazıyor. Ayraç bir
           tırnak içeriyorsa ("A "x" B" gibi) kaçışsız bir dizeleyici metni
           erken kapatır ve kullanıcının kurduğu sütun hiç derlenmez. */
        let value = '';
        let index = i + 1;
        let closed = false;
        while (index < text.length) {
          const current = text[index];
          if (current === '\\' && index + 1 < text.length) {
            const next = text[index + 1];
            value += next === 'n' ? '\n' : next === 't' ? '\t' : next;
            index += 2;
            continue;
          }
          if (current === ch) { closed = true; break; }
          value += current;
          index++;
        }
        if (!closed) throw new FormulaError('Metin tırnağı kapatılmamış.', 'UNCLOSED_STRING', i);
        tokens.push({ type: 'string', value, position: i });
        i = index + 1;
        continue;
      }
      if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(text[i + 1] || ''))) {
        const match = /^[0-9]*\.?[0-9]+/.exec(text.slice(i));
        tokens.push({ type: 'number', value: Number(match[0]), position: i });
        i += match[0].length;
        continue;
      }
      if (/[A-Za-zÇĞİÖŞÜçğıöşü_]/.test(ch)) {
        const match = /^[A-Za-zÇĞİÖŞÜçğıöşü_][A-Za-zÇĞİÖŞÜçğıöşü0-9_.]*/.exec(text.slice(i));
        tokens.push({ type: 'name', value: match[0], position: i });
        i += match[0].length;
        continue;
      }
      const punct = PUNCT.find(item => text.startsWith(item, i));
      if (punct) { tokens.push({ type: 'punct', value: punct, position: i }); i += punct.length; continue; }
      throw new FormulaError(`Anlaşılmayan karakter: "${ch}"`, 'BAD_CHARACTER', i);
    }
    tokens.push({ type: 'end', value: '', position: text.length });
    return tokens;
  }

  /* ---------------- ayrıştırıcı (öncelik tırmanması) ---------------- */

  const BINARY = {
    '||': 1, 'OR': 1,
    '&&': 2, 'AND': 2,
    '=': 3, '==': 3, '<>': 3, '!=': 3, '<': 3, '<=': 3, '>': 3, '>=': 3,
    '&': 4,
    '+': 5, '-': 5,
    '*': 6, '/': 6, '%': 6,
    '^': 7,
  };
  const RIGHT_ASSOC = new Set(['^']);

  function parse(input) {
    const tokens = tokenize(input);
    let index = 0;
    const peek = () => tokens[index];
    const next = () => tokens[index++];
    const expect = value => {
      const token = next();
      if (token.value !== value) throw new FormulaError(`"${value}" bekleniyordu.`, 'EXPECTED_TOKEN', token.position);
      return token;
    };

    function parsePrimary(depth) {
      if (depth > MAX_DEPTH) throw new FormulaError('Formül fazla iç içe geçmiş.', 'TOO_DEEP');
      const token = next();
      if (token.type === 'number') return { kind: 'number', value: token.value };
      if (token.type === 'string') return { kind: 'string', value: token.value };
      if (token.type === 'column') {
        if (!token.value) throw new FormulaError('Boş sütun adı: [] kullanılamaz.', 'EMPTY_COLUMN', token.position);
        return { kind: 'column', name: token.value };
      }
      if (token.type === 'punct' && token.value === '(') {
        const node = parseExpression(0, depth + 1);
        expect(')');
        return node;
      }
      if (token.type === 'punct' && (token.value === '-' || token.value === '+')) {
        const node = parsePrimary(depth + 1);
        return token.value === '-' ? { kind: 'unary', op: '-', argument: node } : node;
      }
      if (token.type === 'name') {
        const upper = token.value.toLocaleUpperCase('en');
        if (peek().type === 'punct' && peek().value === '(') {
          next();
          const args = [];
          if (!(peek().type === 'punct' && peek().value === ')')) {
            for (;;) {
              args.push(parseExpression(0, depth + 1));
              const separator = peek();
              if (separator.type === 'punct' && (separator.value === ',' || separator.value === ';')) { next(); continue; }
              break;
            }
          }
          expect(')');
          return { kind: 'call', name: upper, args, position: token.position };
        }
        if (upper === 'TRUE' || upper === 'DOGRU') return { kind: 'boolean', value: true };
        if (upper === 'FALSE' || upper === 'YANLIS') return { kind: 'boolean', value: false };
        if (upper === 'NOT') return { kind: 'call', name: 'NOT', args: [parsePrimary(depth + 1)], position: token.position };
        throw new FormulaError(`Bilinmeyen ad: "${token.value}". Sütun adları köşeli parantez içinde yazılır: [${token.value}]`, 'UNKNOWN_NAME', token.position);
      }
      throw new FormulaError('Formül eksik görünüyor.', 'UNEXPECTED_END', token.position);
    }

    function parseExpression(minPrecedence, depth = 0) {
      if (depth > MAX_DEPTH) throw new FormulaError('Formül fazla iç içe geçmiş.', 'TOO_DEEP');
      let left = parsePrimary(depth + 1);
      for (;;) {
        const token = peek();
        const op = token.type === 'name' ? token.value.toLocaleUpperCase('en') : token.value;
        if ((token.type !== 'punct' && token.type !== 'name') || !Object.prototype.hasOwnProperty.call(BINARY, op)) break;
        const precedence = BINARY[op];
        if (precedence < minPrecedence) break;
        next();
        const nextMin = RIGHT_ASSOC.has(op) ? precedence : precedence + 1;
        const right = parseExpression(nextMin, depth + 1);
        left = { kind: 'binary', op, left, right };
      }
      return left;
    }

    const node = parseExpression(0, 0);
    const rest = peek();
    if (rest.type !== 'end') throw new FormulaError(`Fazladan ifade: "${rest.value}"`, 'TRAILING_INPUT', rest.position);
    return node;
  }

  /* ---------------- fonksiyonlar ---------------- */

  function needDate(value, fnName) {
    const date = toDate(value);
    if (!date) throw new FormulaError(`${fnName} için geçerli bir tarih gerekiyor.`, 'BAD_DATE');
    return date;
  }
  function numberOrNull(value) { return toNumber(value); }
  function numbersOf(args) { return args.map(numberOrNull).filter(value => value != null); }

  const FUNCTIONS = {
    // --- tarih ---
    DAYS: { min: 2, max: 2, fn: args => Math.round((needDate(args[1], 'DAYS').getTime() - needDate(args[0], 'DAYS').getTime()) / DAY_MS) },
    DATEDIF: { min: 2, max: 2, fn: args => FUNCTIONS.DAYS.fn(args) },
    TODAY: { min: 0, max: 0, fn: () => { const now = new Date(); return makeDate(now.getFullYear(), now.getMonth() + 1, now.getDate()); } },
    DATE: { min: 3, max: 3, fn: args => makeDate(Number(toNumber(args[0])), Number(toNumber(args[1])), Number(toNumber(args[2]))) },
    ADDDAYS: { min: 2, max: 2, fn: args => new Date(needDate(args[0], 'ADDDAYS').getTime() + (toNumber(args[1]) || 0) * DAY_MS) },
    YEAR: { min: 1, max: 1, fn: args => needDate(args[0], 'YEAR').getUTCFullYear() },
    MONTH: { min: 1, max: 1, fn: args => needDate(args[0], 'MONTH').getUTCMonth() + 1 },
    DAY: { min: 1, max: 1, fn: args => needDate(args[0], 'DAY').getUTCDate() },
    WEEKNUM: {
      min: 1, max: 1,
      fn: args => {
        // ISO hafta numarası: yılın ilk perşembesini içeren hafta 1. hafta.
        const date = new Date(needDate(args[0], 'WEEKNUM').getTime());
        const day = (date.getUTCDay() + 6) % 7;
        date.setUTCDate(date.getUTCDate() - day + 3);
        const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
        const firstDay = (firstThursday.getUTCDay() + 6) % 7;
        firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDay + 3);
        return 1 + Math.round((date.getTime() - firstThursday.getTime()) / (7 * DAY_MS));
      },
    },
    // --- matematik ---
    ABS: { min: 1, max: 1, fn: args => { const n = numberOrNull(args[0]); return n == null ? null : Math.abs(n); } },
    ROUND: { min: 1, max: 2, fn: args => { const n = numberOrNull(args[0]); if (n == null) return null; const d = args.length > 1 ? Math.trunc(toNumber(args[1]) || 0) : 0; const f = Math.pow(10, d); return Math.round(n * f) / f; } },
    CEIL: { min: 1, max: 1, fn: args => { const n = numberOrNull(args[0]); return n == null ? null : Math.ceil(n); } },
    FLOOR: { min: 1, max: 1, fn: args => { const n = numberOrNull(args[0]); return n == null ? null : Math.floor(n); } },
    MIN: { min: 1, max: 50, fn: args => { const list = numbersOf(args); return list.length ? Math.min(...list) : null; } },
    MAX: { min: 1, max: 50, fn: args => { const list = numbersOf(args); return list.length ? Math.max(...list) : null; } },
    SUM: { min: 1, max: 50, fn: args => numbersOf(args).reduce((sum, value) => sum + value, 0) },
    AVG: { min: 1, max: 50, fn: args => { const list = numbersOf(args); return list.length ? list.reduce((sum, value) => sum + value, 0) / list.length : null; } },
    AVERAGE: { min: 1, max: 50, fn: args => FUNCTIONS.AVG.fn(args) },
    SQRT: { min: 1, max: 1, fn: args => { const n = numberOrNull(args[0]); if (n == null) return null; if (n < 0) throw new FormulaError('SQRT negatif sayı alamaz.', 'MATH_DOMAIN'); return Math.sqrt(n); } },
    POWER: { min: 2, max: 2, fn: args => { const a = numberOrNull(args[0]), b = numberOrNull(args[1]); return a == null || b == null ? null : Math.pow(a, b); } },
    MOD: { min: 2, max: 2, fn: args => { const a = numberOrNull(args[0]), b = numberOrNull(args[1]); if (a == null || b == null) return null; if (b === 0) throw new FormulaError('MOD sıfıra bölünemez.', 'DIVIDE_BY_ZERO'); return a % b; } },
    NUMBER: { min: 1, max: 1, fn: args => numberOrNull(args[0]) },
    // --- mantık ---
    IF: { min: 2, max: 3, lazy: true, fn: (args, evaluate) => (toBool(evaluate(args[0])) ? evaluate(args[1]) : (args.length > 2 ? evaluate(args[2]) : null)) },
    AND: { min: 1, max: 50, fn: args => args.every(toBool) },
    OR: { min: 1, max: 50, fn: args => args.some(toBool) },
    NOT: { min: 1, max: 1, fn: args => !toBool(args[0]) },
    ISBLANK: { min: 1, max: 1, fn: args => isBlank(args[0]) },
    COALESCE: { min: 1, max: 50, fn: args => { for (const value of args) if (!isBlank(value)) return value; return null; } },
    IFERROR: { min: 2, max: 2, lazy: true, fn: (args, evaluate) => { try { const value = evaluate(args[0]); return isBlank(value) ? evaluate(args[1]) : value; } catch (_) { return evaluate(args[1]); } } },
    // --- metin ---
    CONCAT: { min: 1, max: 50, fn: args => args.map(toText).join('') },
    /* TEXTJOIN(ayraç, boşlarıAtla, a, b, c…) — Excel'deki adıyla aynı.
       "A & B & C" ile birleştirmenin sorunu, aradaki hücre BOŞSA ayracın çift
       kalmasıdır ("ELBİSE //  MAVİ"). İkinci argüman true ise boş hücreler
       atlanır ve ayraç yalnız dolu değerlerin arasına girer. */
    TEXTJOIN: {
      min: 3, max: 50,
      fn: args => {
        const separator = toText(args[0]);
        const skipEmpty = toBool(args[1]);
        const parts = args.slice(2).map(toText).map(text => text.trim());
        const kept = skipEmpty ? parts.filter(text => text !== '') : parts;
        return kept.length ? kept.join(separator) : null;
      },
    },
    BIRLESTIR: { min: 3, max: 50, fn: args => FUNCTIONS.TEXTJOIN.fn(args) },
    TEXT: { min: 1, max: 1, fn: args => toText(args[0]) },
    UPPER: { min: 1, max: 1, fn: args => toText(args[0]).toLocaleUpperCase('tr-TR') },
    LOWER: { min: 1, max: 1, fn: args => toText(args[0]).toLocaleLowerCase('tr-TR') },
    TRIM: { min: 1, max: 1, fn: args => toText(args[0]).trim() },
    LEN: { min: 1, max: 1, fn: args => toText(args[0]).length },
    LEFT: { min: 2, max: 2, fn: args => toText(args[0]).slice(0, Math.max(0, Math.trunc(toNumber(args[1]) || 0))) },
    RIGHT: { min: 2, max: 2, fn: args => { const n = Math.max(0, Math.trunc(toNumber(args[1]) || 0)); return n ? toText(args[0]).slice(-n) : ''; } },
    MID: { min: 3, max: 3, fn: args => { const start = Math.max(1, Math.trunc(toNumber(args[1]) || 1)); const len = Math.max(0, Math.trunc(toNumber(args[2]) || 0)); return toText(args[0]).substr(start - 1, len); } },
    FIND: { min: 2, max: 2, fn: args => { const index = toText(args[1]).toLocaleLowerCase('tr-TR').indexOf(toText(args[0]).toLocaleLowerCase('tr-TR')); return index < 0 ? 0 : index + 1; } },
    CONTAINS: { min: 2, max: 2, fn: args => toText(args[0]).toLocaleLowerCase('tr-TR').includes(toText(args[1]).toLocaleLowerCase('tr-TR')) },
  };

  /* ---------------- değerlendirici ---------------- */

  function compare(op, left, right) {
    const leftDate = toDate(left), rightDate = toDate(right);
    let a, b;
    if (leftDate && rightDate) { a = leftDate.getTime(); b = rightDate.getTime(); }
    else {
      const leftNumber = toNumber(left), rightNumber = toNumber(right);
      if (leftNumber != null && rightNumber != null) { a = leftNumber; b = rightNumber; }
      else { a = toText(left).toLocaleLowerCase('tr-TR'); b = toText(right).toLocaleLowerCase('tr-TR'); }
    }
    switch (op) {
      case '=': case '==': return a === b;
      case '<>': case '!=': return a !== b;
      case '<': return a < b;
      case '<=': return a <= b;
      case '>': return a > b;
      case '>=': return a >= b;
      default: throw new FormulaError(`Bilinmeyen karşılaştırma: ${op}`, 'BAD_OPERATOR');
    }
  }

  function arithmetic(op, left, right) {
    // Tarih − tarih = gün farkı. Kullanıcının en sık istediği işlem bu;
    // DAYS() yazmayı unutana da doğru cevabı verir.
    if (op === '-' && looksLikeDate(left) && looksLikeDate(right)) {
      const leftDate = toDate(left), rightDate = toDate(right);
      if (leftDate && rightDate) return Math.round((leftDate.getTime() - rightDate.getTime()) / DAY_MS);
    }
    const a = toNumber(left), b = toNumber(right);
    if (a == null || b == null) return null;   // Boş hücre → boş sonuç, 0 değil.
    switch (op) {
      case '+': return a + b;
      case '-': return a - b;
      case '*': return a * b;
      case '/':
        if (b === 0) throw new FormulaError('Sıfıra bölme.', 'DIVIDE_BY_ZERO');
        return a / b;
      case '%':
        if (b === 0) throw new FormulaError('Sıfıra bölme.', 'DIVIDE_BY_ZERO');
        return a % b;
      case '^': return Math.pow(a, b);
      default: throw new FormulaError(`Bilinmeyen işleç: ${op}`, 'BAD_OPERATOR');
    }
  }

  function evaluateNode(node, context) {
    switch (node.kind) {
      case 'number': return node.value;
      case 'string': return node.value;
      case 'boolean': return node.value;
      case 'column': return context.lookup(node.name);
      case 'unary': {
        const value = toNumber(evaluateNode(node.argument, context));
        return value == null ? null : -value;
      }
      case 'binary': {
        const op = node.op;
        if (op === '&&' || op === 'AND') return toBool(evaluateNode(node.left, context)) && toBool(evaluateNode(node.right, context));
        if (op === '||' || op === 'OR') return toBool(evaluateNode(node.left, context)) || toBool(evaluateNode(node.right, context));
        const left = evaluateNode(node.left, context);
        const right = evaluateNode(node.right, context);
        if (op === '&') return toText(left) + toText(right);
        if (['=', '==', '<>', '!=', '<', '<=', '>', '>='].includes(op)) return compare(op, left, right);
        return arithmetic(op, left, right);
      }
      case 'call': {
        const definition = FUNCTIONS[node.name];
        if (!definition) throw new FormulaError(`Bilinmeyen fonksiyon: ${node.name}()`, 'UNKNOWN_FUNCTION', node.position);
        if (node.args.length < definition.min || node.args.length > definition.max) {
          throw new FormulaError(`${node.name}() için ${definition.min === definition.max ? definition.min : `${definition.min}-${definition.max}`} argüman gerekiyor.`, 'BAD_ARITY', node.position);
        }
        if (definition.lazy) return definition.fn(node.args, argument => evaluateNode(argument, context));
        return definition.fn(node.args.map(argument => evaluateNode(argument, context)));
      }
      default: throw new FormulaError('Formül çözümlenemedi.', 'BAD_NODE');
    }
  }

  function columnsOf(node, out = []) {
    if (!node || typeof node !== 'object') return out;
    if (node.kind === 'column') { if (!out.includes(node.name)) out.push(node.name); return out; }
    ['left', 'right', 'argument'].forEach(key => { if (node[key]) columnsOf(node[key], out); });
    (node.args || []).forEach(argument => columnsOf(argument, out));
    return out;
  }

  /* Formülü bir kez derler; satır başına yalnız değerlendirme kalır.
     Döner: { ok, error, columns, evaluate(row, options) } */
  function compile(source) {
    let ast = null, error = null;
    try { ast = parse(source); }
    catch (err) { error = err instanceof FormulaError ? err : new FormulaError(String(err && err.message || err)); }
    const columns = ast ? columnsOf(ast) : [];
    return {
      ok: Boolean(ast),
      error: error ? { message: error.message, code: error.code, position: error.position } : null,
      columns,
      ast,
      evaluate(row, options = {}) {
        if (!ast) return { ok: false, value: null, error: error ? error.message : 'Formül geçersiz.' };
        const resolve = typeof options.lookup === 'function'
          ? options.lookup
          : name => (row && Object.prototype.hasOwnProperty.call(row, name) ? row[name] : undefined);
        const missing = [];
        const context = {
          lookup(name) {
            const value = resolve(name, row);
            if (value === undefined) { if (!missing.includes(name)) missing.push(name); return null; }
            return value;
          },
        };
        try {
          const value = evaluateNode(ast, context);
          if (missing.length && options.strictColumns !== false) {
            return { ok: false, value: null, error: `Sütun bulunamadı: ${missing.join(', ')}`, missing };
          }
          return { ok: true, value, missing };
        } catch (err) {
          return { ok: false, value: null, error: String(err && err.message || err), code: err && err.code };
        }
      },
    };
  }

  const FUNCTION_HELP = [
    { name: 'DAYS(a, b)', tr: 'İki tarih arasındaki gün farkı (b − a)', en: 'Days between two dates (b − a)' },
    { name: 'TODAY()', tr: 'Bugünün tarihi', en: 'Today’s date' },
    { name: 'ADDDAYS(tarih, n)', tr: 'Tarihe gün ekler', en: 'Adds days to a date' },
    { name: 'YEAR / MONTH / DAY / WEEKNUM(tarih)', tr: 'Tarihin yılı / ayı / günü / hafta numarası', en: 'Year / month / day / ISO week' },
    { name: 'IF(koşul, a, b)', tr: 'Koşul doğruysa a, değilse b', en: 'a when the condition holds, otherwise b' },
    { name: 'ROUND(sayı, basamak)', tr: 'Yuvarlar', en: 'Rounds' },
    { name: 'MIN / MAX / SUM / AVG(...)', tr: 'En küçük / en büyük / toplam / ortalama', en: 'Min / max / sum / average' },
    { name: 'ABS / SQRT / POWER / MOD', tr: 'Mutlak değer, karekök, üs, kalan', en: 'Absolute, square root, power, remainder' },
    { name: 'COALESCE(...)', tr: 'İlk dolu değeri verir', en: 'First non-empty value' },
    { name: 'ISBLANK(x)', tr: 'Hücre boş mu', en: 'Is the cell empty' },
    { name: 'TEXTJOIN(ayraç; boşları atla; a; b; …)', tr: 'Sütunları ayraçla birleştirir; boş hücreleri atlayabilir', en: 'Joins columns with a separator, optionally skipping blanks' },
    { name: 'CONCAT(...) veya a & b', tr: 'Metinleri birleştirir', en: 'Joins text' },
    { name: 'UPPER / LOWER / TRIM / LEN / LEFT / RIGHT / MID', tr: 'Metin işlemleri', en: 'Text helpers' },
    { name: 'CONTAINS(metin, aranan)', tr: 'İçeriyor mu', en: 'Contains' },
  ];

  const api = {
    compile, parse, tokenize, FUNCTIONS, FUNCTION_HELP, FormulaError,
    toNumber, toDate, toText, toBool, isBlank, dateText, looksLikeDate, DAY_MS,
  };

  global.BLFormulaEngine = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
