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
        tokens.push({ type: 'column', value: text.slice(i + 1, end).trim(), position: i, end: end + 1 });
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
        tokens.push({ type: 'string', value, position: i, end: index + 1 });
        i = index + 1;
        continue;
      }
      if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(text[i + 1] || ''))) {
        const match = /^[0-9]*\.?[0-9]+/.exec(text.slice(i));
        tokens.push({ type: 'number', value: Number(match[0]), position: i, end: i + match[0].length });
        i += match[0].length;
        continue;
      }
      if (/[A-Za-zÇĞİÖŞÜçğıöşü_]/.test(ch)) {
        const match = /^[A-Za-zÇĞİÖŞÜçğıöşü_][A-Za-zÇĞİÖŞÜçğıöşü0-9_.]*/.exec(text.slice(i));
        tokens.push({ type: 'name', value: match[0], position: i, end: i + match[0].length });
        i += match[0].length;
        continue;
      }
      const punct = PUNCT.find(item => text.startsWith(item, i));
      if (punct) { tokens.push({ type: 'punct', value: punct, position: i, end: i + punct.length }); i += punct.length; continue; }
      throw new FormulaError(`Anlaşılmayan karakter: "${ch}"`, 'BAD_CHARACTER', i);
    }
    tokens.push({ type: 'end', value: '', position: text.length, end: text.length });
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
    /* DATEDIF(a, b, "d" | "m" | "y") — Excel'deki adıyla. Üçüncü argüman
       verilmezse gün farkıdır (eski davranış). "m" / "y" TAMAMLANMIŞ ay / yıl
       sayısını verir; AI araçları bu biçimi sık üretir. */
    DATEDIF: {
      min: 2, max: 3,
      fn: args => {
        const unit = args.length > 2 ? toText(args[2]).trim().toLocaleLowerCase('en') : 'd';
        if (unit === 'd' || unit === '') return FUNCTIONS.DAYS.fn(args);
        const a = needDate(args[0], 'DATEDIF'), b = needDate(args[1], 'DATEDIF');
        const sign = b.getTime() >= a.getTime() ? 1 : -1;
        const [from, to] = sign > 0 ? [a, b] : [b, a];
        let months = (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + (to.getUTCMonth() - from.getUTCMonth());
        if (to.getUTCDate() < from.getUTCDate()) months -= 1;
        if (unit === 'm') return sign * months;
        if (unit === 'y') return sign * Math.floor(months / 12);
        throw new FormulaError('DATEDIF birimi "d", "m" ya da "y" olmalı.', 'BAD_ARGUMENT');
      },
    },
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
    // Excel'deki gibi: ROUNDUP sıfırdan UZAĞA, ROUNDDOWN sıfıra DOĞRU yuvarlar.
    ROUNDUP: { min: 1, max: 2, fn: args => { const n = numberOrNull(args[0]); if (n == null) return null; const d = args.length > 1 ? Math.trunc(toNumber(args[1]) || 0) : 0; const f = Math.pow(10, d); return Math.sign(n) * Math.ceil(Math.abs(n) * f - 1e-9) / f; } },
    ROUNDDOWN: { min: 1, max: 2, fn: args => { const n = numberOrNull(args[0]); if (n == null) return null; const d = args.length > 1 ? Math.trunc(toNumber(args[1]) || 0) : 0; const f = Math.pow(10, d); return Math.sign(n) * Math.floor(Math.abs(n) * f + 1e-9) / f; } },
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
    /* IFS(koşul1, değer1, koşul2, değer2, …) — ilk doğru koşulun değeri.
       Hiçbiri tutmazsa BOŞ döner (Excel #N/A verir; boş, "bilinmiyor"u
       yanlış bir değer göstermeden anlatır). Son koşul olarak TRUE yazmak
       "değilse" dalıdır. */
    IFS: {
      min: 2, max: 50, lazy: true,
      fn: (args, evaluate) => {
        if (args.length % 2) throw new FormulaError('IFS() koşul/değer çiftleri ister (çift sayıda argüman).', 'BAD_ARITY');
        for (let index = 0; index < args.length; index += 2) {
          if (toBool(evaluate(args[index]))) return evaluate(args[index + 1]);
        }
        return null;
      },
    },
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

  /* ---------------- SÖZLÜK ----------------

     Kullanıcı talebi (birebir): "İsteyen advanced modda formül de yazsın,
     formül yazmak için bir sözlük de sun, nasıl çalışır / hangi işlem için
     hangi formül v.s."

     Sözlük MOTORUN YANINDA durur: pencere, AI yönergesi ve analiz aynı listeyi
     okur. Ayrı bir yardım metni yazılsaydı, motora eklenen bir fonksiyon
     sözlükte eksik kalır ya da AI'a olmayan bir fonksiyon öğretilirdi. Test,
     FUNCTIONS içindeki her ana fonksiyonun burada anlatıldığını denetler. */
  const CATEGORIES = [
    { id: 'date', tr: 'Tarih', en: 'Dates' },
    { id: 'math', tr: 'Sayı ve hesap', en: 'Numbers & maths' },
    { id: 'logic', tr: 'Koşul ve kontrol', en: 'Conditions & checks' },
    { id: 'text', tr: 'Metin', en: 'Text' },
  ];
  const FUNCTION_DOCS = [
    { name: 'DAYS', cat: 'date', syntax: 'DAYS([başlangıç], [bitiş])', syntaxEn: 'DAYS([start], [end])', tr: 'İki tarih arasındaki gün sayısı (bitiş − başlangıç). Bitiş önceyse sonuç eksi çıkar.', en: 'Days between two dates (end − start). Negative when the end is earlier.', example: 'DAYS([Ex-factory], [Retail Date])', resultTr: '14 gün', resultEn: '14 days' },
    { name: 'DATEDIF', cat: 'date', syntax: 'DATEDIF([başlangıç], [bitiş], "m")', syntaxEn: 'DATEDIF([start], [end], "m")', tr: 'Tarih farkını "d" gün, "m" tam ay, "y" tam yıl olarak verir.', en: 'Date difference in "d" days, "m" whole months or "y" whole years.', example: 'DATEDIF([Order Date], [Ex-factory], "m")', resultTr: '3 ay', resultEn: '3 months' },
    { name: 'ADDDAYS', cat: 'date', syntax: 'ADDDAYS([tarih], gün)', syntaxEn: 'ADDDAYS([date], days)', tr: 'Tarihe gün ekler; eksi sayı gün çıkarır.', en: 'Adds days to a date; a negative number subtracts.', example: 'ADDDAYS([Ex-factory], 30)', resultTr: '30 gün sonrası', resultEn: '30 days later' },
    { name: 'TODAY', cat: 'date', syntax: 'TODAY()', syntaxEn: 'TODAY()', tr: 'Bugünün tarihi. Her gün kendiliğinden değişir.', en: 'Today’s date. Changes every day by itself.', example: 'DAYS(TODAY(), [Ex-factory])', resultTr: 'ex-factory’ye kalan gün', resultEn: 'days left to ex-factory' },
    { name: 'DATE', cat: 'date', syntax: 'DATE(yıl, ay, gün)', syntaxEn: 'DATE(year, month, day)', tr: 'Sabit bir tarih üretir.', en: 'Builds a fixed date.', example: 'DAYS(DATE(2026, 1, 1), [Ex-factory])', resultTr: 'yılbaşından bu yana gün', resultEn: 'days since new year' },
    { name: 'YEAR', cat: 'date', syntax: 'YEAR([tarih]) · MONTH · DAY · WEEKNUM', syntaxEn: 'YEAR([date]) · MONTH · DAY · WEEKNUM', tr: 'Tarihin yılı, ayı, günü ya da ISO hafta numarası.', en: 'Year, month, day or ISO week number of a date.', example: 'WEEKNUM([Ex-factory])', resultTr: '12. hafta', resultEn: 'week 12', also: ['MONTH', 'DAY', 'WEEKNUM'] },
    { name: 'ROUND', cat: 'math', syntax: 'ROUND(sayı, basamak)', syntaxEn: 'ROUND(number, digits)', tr: 'Yuvarlar. ROUNDUP her zaman yukarı, ROUNDDOWN her zaman aşağı yuvarlar.', en: 'Rounds. ROUNDUP always rounds up, ROUNDDOWN always down.', example: 'ROUND([Price] * 1.2, 2)', resultTr: '12,35', resultEn: '12.35', also: ['ROUNDUP', 'ROUNDDOWN', 'CEIL', 'FLOOR'] },
    { name: 'SUM', cat: 'math', syntax: 'SUM(a, b, …) · AVG · MIN · MAX', syntaxEn: 'SUM(a, b, …) · AVG · MIN · MAX', tr: 'Toplam, ortalama, en küçük, en büyük. Boş hücreleri atlar.', en: 'Sum, average, smallest, largest. Skips blank cells.', example: 'MAX([Qty 1], [Qty 2], [Qty 3])', resultTr: 'en büyük adet', resultEn: 'largest quantity', also: ['AVG', 'AVERAGE', 'MIN', 'MAX'] },
    { name: 'ABS', cat: 'math', syntax: 'ABS(sayı)', syntaxEn: 'ABS(number)', tr: 'Mutlak değer: eksi işaretini kaldırır.', en: 'Absolute value: drops the minus sign.', example: 'ABS([Retail Date] - [Ex-factory])', resultTr: 'yönsüz gün farkı', resultEn: 'day gap without direction' },
    { name: 'POWER', cat: 'math', syntax: 'POWER(a, b) · SQRT(a) · MOD(a, b)', syntaxEn: 'POWER(a, b) · SQRT(a) · MOD(a, b)', tr: 'Üs, karekök ve bölümden kalan.', en: 'Power, square root and remainder.', example: 'MOD([Qty], 12)', resultTr: 'düzineden artan', resultEn: 'left over after dozens', also: ['SQRT', 'MOD'] },
    { name: 'NUMBER', cat: 'math', syntax: 'NUMBER([metin])', syntaxEn: 'NUMBER([text])', tr: 'Metni sayıya çevirir ("1.234,56" dâhil).', en: 'Turns text into a number ("1.234,56" included).', example: 'NUMBER([Size]) * 2', resultTr: 'sayı', resultEn: 'number' },
    { name: 'IF', cat: 'logic', syntax: 'IF(koşul, doğruysa, değilse)', syntaxEn: 'IF(condition, if true, otherwise)', tr: 'Koşul doğruysa ikinci, değilse üçüncü değeri yazar.', en: 'Writes the second value when the condition holds, otherwise the third.', example: 'IF([Ex-factory] > [Retail Date], "Gecikmeli", "Zamanında")', resultTr: 'Gecikmeli / Zamanında', resultEn: 'Late / On time' },
    { name: 'IFS', cat: 'logic', syntax: 'IFS(koşul1, değer1, koşul2, değer2, TRUE, diğer)', syntaxEn: 'IFS(cond1, value1, cond2, value2, TRUE, other)', tr: 'Birden çok koşul: ilk doğru koşulun değerini yazar. Son koşul TRUE ise "değilse" dalıdır.', en: 'Several conditions: writes the value of the first one that holds. A final TRUE is the “otherwise” branch.', example: 'IFS([Margin] < 20, "Düşük", [Margin] < 40, "Orta", TRUE, "Yüksek")', resultTr: 'Düşük / Orta / Yüksek', resultEn: 'Low / Mid / High' },
    { name: 'AND', cat: 'logic', syntax: 'AND(a, b) · OR(a, b) · NOT(a)', syntaxEn: 'AND(a, b) · OR(a, b) · NOT(a)', tr: 'Koşulları birleştirir: hepsi / en az biri / tersi.', en: 'Combines conditions: all / at least one / the opposite.', example: 'IF(AND([Qty] > 0, [Price] > 0), "Tamam", "Eksik")', resultTr: 'Tamam / Eksik', resultEn: 'OK / Missing', also: ['OR', 'NOT'] },
    { name: 'IFERROR', cat: 'logic', syntax: 'IFERROR(hesap, yedek)', syntaxEn: 'IFERROR(calculation, fallback)', tr: 'Hesap hata verirse (ör. sıfıra bölme) ya da boş kalırsa yedek değeri yazar.', en: 'Writes the fallback when the calculation fails (e.g. divide by zero) or is blank.', example: 'IFERROR([Cost] / [Qty], 0)', resultTr: 'birim maliyet ya da 0', resultEn: 'unit cost or 0' },
    { name: 'ISBLANK', cat: 'logic', syntax: 'ISBLANK([sütun])', syntaxEn: 'ISBLANK([column])', tr: 'Hücre boş mu? Doğru / yanlış verir.', en: 'Is the cell empty? Returns true / false.', example: 'IF(ISBLANK([Retail Date]), "Tarih yok", "Var")', resultTr: 'Tarih yok / Var', resultEn: 'No date / Present' },
    { name: 'COALESCE', cat: 'logic', syntax: 'COALESCE(a, b, …)', syntaxEn: 'COALESCE(a, b, …)', tr: 'İlk DOLU değeri verir.', en: 'Returns the first non-empty value.', example: 'COALESCE([Revised Date], [Ex-factory])', resultTr: 'revize varsa o, yoksa ex-factory', resultEn: 'revised date if any, else ex-factory' },
    { name: 'CONTAINS', cat: 'logic', syntax: 'CONTAINS([metin], "aranan")', syntaxEn: 'CONTAINS([text], "search")', tr: 'Metin, aranan parçayı içeriyor mu (büyük/küçük harf fark etmez)?', en: 'Does the text contain the search part (case-insensitive)?', example: 'IF(CONTAINS([Model], "ELBİSE"), "Elbise", "Diğer")', resultTr: 'Elbise / Diğer', resultEn: 'Dress / Other' },
    { name: 'TEXTJOIN', cat: 'text', syntax: 'TEXTJOIN("ayraç", TRUE, [a], [b], …)', syntaxEn: 'TEXTJOIN("separator", TRUE, [a], [b], …)', tr: 'Sütunları ayraçla birleştirir; TRUE boş hücreleri atlar.', en: 'Joins columns with a separator; TRUE skips blank cells.', example: 'TEXTJOIN(" - ", TRUE, [Model], [Color])', resultTr: 'ELBİSE - MAVİ', resultEn: 'DRESS - BLUE' },
    { name: 'CONCAT', cat: 'text', syntax: 'CONCAT(a, b, …) veya a & b', syntaxEn: 'CONCAT(a, b, …) or a & b', tr: 'Metinleri aralarına bir şey koymadan birleştirir.', en: 'Joins text with nothing in between.', example: '[Season] & "-" & [Order Code]', resultTr: 'SS26-12345', resultEn: 'SS26-12345' },
    { name: 'UPPER', cat: 'text', syntax: 'UPPER · LOWER · TRIM([metin])', syntaxEn: 'UPPER · LOWER · TRIM([text])', tr: 'Büyük harf, küçük harf, baştaki/sondaki boşlukları silme.', en: 'Upper case, lower case, trim spaces.', example: 'UPPER([Color])', resultTr: 'MAVİ', resultEn: 'BLUE', also: ['LOWER', 'TRIM'] },
    { name: 'LEFT', cat: 'text', syntax: 'LEFT([metin], n) · RIGHT · MID([metin], başla, n)', syntaxEn: 'LEFT([text], n) · RIGHT · MID([text], start, n)', tr: 'Metnin soldan / sağdan / ortasından parça alır.', en: 'Takes a part from the left / right / middle of the text.', example: 'LEFT([Order Code], 4)', resultTr: 'ilk 4 karakter', resultEn: 'first 4 characters', also: ['RIGHT', 'MID'] },
    { name: 'LEN', cat: 'text', syntax: 'LEN([metin]) · FIND("aranan", [metin])', syntaxEn: 'LEN([text]) · FIND("search", [text])', tr: 'Karakter sayısı; aranan parçanın kaçıncı karakterde başladığı (yoksa 0).', en: 'Character count; where the search part starts (0 if missing).', example: 'LEN([Model])', resultTr: '12', resultEn: '12', also: ['FIND'] },
    { name: 'TEXT', cat: 'text', syntax: 'TEXT(değer)', syntaxEn: 'TEXT(value)', tr: 'Değeri metne çevirir. Görünüm (ondalık, yüzde, tarih) için pencerenin Biçim ayarını kullanın.', en: 'Turns a value into text. Use the window’s Format setting for decimals, percent or dates.', example: 'TEXT([Qty]) & " adet"', resultTr: '120 adet', resultEn: '120 pcs' },
  ];
  // İşlemler — sözlüğün ilk bölümü; "hangi işlem için hangi işaret".
  const OPERATOR_DOCS = [
    { sign: '+  −  *  /', tr: 'Topla, çıkar, çarp, böl', en: 'Add, subtract, multiply, divide', example: '([Price] - [Cost]) / [Price] * 100' },
    { sign: '^', tr: 'Üs alma', en: 'Power', example: '[A] ^ 2' },
    { sign: '&', tr: 'Metin birleştirme', en: 'Join text', example: '[Model] & " / " & [Color]' },
    { sign: '=  <>  >  <  >=  <=', tr: 'Karşılaştırma: eşit, eşit değil, büyük, küçük…', en: 'Compare: equal, not equal, greater, less…', example: '[Qty] >= 1000' },
    { sign: '( )', tr: 'Önce yapılacak işlemi gruplar', en: 'Groups what is calculated first', example: '([A] + [B]) * 2' },
  ];
  // "Hangi iş için hangi formül" — düz Türkçe ihtiyaçtan formüle.
  const RECIPE_DOCS = [
    { tr: 'İki tarih arasında kaç gün var?', en: 'How many days between two dates?', formula: 'DAYS([Ex-factory], [Retail Date])' },
    { tr: 'Bugüne göre kaç gün kaldı / geçti?', en: 'Days left / passed until today?', formula: 'DAYS(TODAY(), [Ex-factory])' },
    { tr: 'Tarihe 30 gün ekle', en: 'Add 30 days to a date', formula: 'ADDDAYS([Ex-factory], 30)' },
    { tr: 'A, B’nin yüzde kaçı?', en: 'A is what percent of B?', formula: 'ROUND([A] / [B] * 100, 1)' },
    { tr: 'Yüzde değişim (eski → yeni)', en: 'Percent change (old → new)', formula: 'ROUND(([New] - [Old]) / [Old] * 100, 1)' },
    { tr: 'Kâr marjı %', en: 'Profit margin %', formula: 'ROUND(([Price] - [Cost]) / [Price] * 100, 1)' },
    { tr: 'Sıfıra bölünce hata değil 0 yaz', en: 'Write 0 instead of a divide-by-zero error', formula: 'IFERROR([Cost] / [Qty], 0)' },
    { tr: 'Gecikmeli mi? (koşula göre yazı)', en: 'Late or not? (text by condition)', formula: 'IF([Ex-factory] > [Retail Date], "Gecikmeli", "Zamanında")' },
    { tr: 'Aralığa göre sınıf (düşük/orta/yüksek)', en: 'Band by range (low/mid/high)', formula: 'IFS([Margin] < 20, "Düşük", [Margin] < 40, "Orta", TRUE, "Yüksek")' },
    { tr: 'Boşsa başka sütunu kullan', en: 'Use another column when blank', formula: 'COALESCE([Revised Date], [Ex-factory])' },
    { tr: 'Sütunları ayraçla birleştir', en: 'Join columns with a separator', formula: 'TEXTJOIN(" - ", TRUE, [Model], [Color])' },
  ];
  // Formül yazmanın kuralları — pencerede "Nasıl çalışır" ve AI yönergesi AYNI listeyi kullanır.
  const RULES = [
    { tr: 'Sütun adı köşeli parantez içinde, tablodaki başlığıyla yazılır: [Ex-factory]. Büyük/küçük harf fark etmez.', en: 'Write a column by its table heading in square brackets: [Ex-factory]. Case does not matter.' },
    { tr: 'Metin çift tırnak içinde yazılır: "Gecikmeli".', en: 'Text goes in double quotes: "Late".' },
    { tr: 'Ondalık ayırıcı NOKTADIR (1.5). Argümanlar virgül ya da noktalı virgülle ayrılır.', en: 'The decimal separator is a DOT (1.5). Arguments are separated by a comma or semicolon.' },
    { tr: 'Başa "=" koymak gerekmez.', en: 'No leading "=" is needed.' },
    { tr: 'İki tarih sütununu birbirinden çıkarmak GÜN farkını verir.', en: 'Subtracting one date column from another gives the DAY difference.' },
    { tr: 'Boş hücreyle yapılan hesap BOŞ kalır, 0 sayılmaz. Boşları yönetmek için ISBLANK / COALESCE kullanın.', en: 'A calculation with a blank cell stays BLANK, it is not treated as 0. Use ISBLANK / COALESCE for blanks.' },
    { tr: 'Sıfıra bölme hata verir; IFERROR(hesap, 0) ile yakalanır.', en: 'Dividing by zero is an error; catch it with IFERROR(calculation, 0).' },
    { tr: 'Her formül YALNIZ aynı satırın değerleriyle çalışır: hücre adresi (A1), aralık (A1:A10), başka satır ya da sayfa (VLOOKUP, SUMIF…) yoktur.', en: 'Each formula works ONLY with the values of the same row: no cell addresses (A1), ranges (A1:A10), other rows or sheets (VLOOKUP, SUMIF…).' },
    { tr: 'Yalnız sözlükteki fonksiyonlar kullanılabilir; adları İngilizcedir (IF, ROUND…). Türkçe Excel adları (EĞER, YUVARLA…) otomatik düzeltilir.', en: 'Only the functions in the dictionary exist; names are English (IF, ROUND…). Turkish Excel names (EĞER, YUVARLA…) are fixed automatically.' },
  ];
  // Geriye dönük uyumluluk: eski kısa liste sözlükten türetilir (tek kaynak).
  const FUNCTION_HELP = FUNCTION_DOCS.map(item => ({ name: item.syntax, tr: item.tr, en: item.en }));

  /* ---------------- belirteç düzeyinde yeniden yazma ----------------

     Formül metnindeki [sütun] başvurularını ve fonksiyon adlarını, metnin geri
     kalanına (boşluk, tırnak içindeki yazı, parantez düzeni) DOKUNMADAN
     değiştirir. Düzenli ifade ile "[" aramak, "…[x]…" gibi tırnak içindeki
     bir yazıyı da sütun sanardı; motorun kendi sözcük çözümleyicisi bu ayrımı
     zaten yapıyor. Metin çözümlenemiyorsa olduğu gibi döner. */
  function rewriteTokens(source, replace) {
    const text = String(source == null ? '' : source);
    let tokens;
    try { tokens = tokenize(text); } catch (_) { return text; }
    let out = '';
    let last = 0;
    tokens.forEach((token, index) => {
      if (token.type === 'end') return;
      const next = replace(token, tokens[index + 1] || null);
      if (next == null) return;
      out += text.slice(last, token.position) + next;
      last = token.end;
    });
    return out + text.slice(last);
  }
  // Her [ad] için map(ad) çağrılır; farklı bir ad dönerse yerine yazılır.
  function rewriteColumns(source, map) {
    return rewriteTokens(source, token => {
      if (token.type !== 'column') return null;
      const next = map(token.value);
      if (next == null || next === token.value) return null;
      const name = String(next);
      return /[\[\]]/.test(name) ? null : `[${name}]`;
    });
  }

  /* ---------------- AI çıktısını okuma ve otomatik düzeltme ---------------- */

  const fold = value => String(value == null ? '' : value)
    .replace(/[İIı]/g, 'I').replace(/i/g, 'I')
    .toLocaleUpperCase('en')
    .replace(/Ş/g, 'S').replace(/Ğ/g, 'G').replace(/Ü/g, 'U').replace(/Ö/g, 'O').replace(/Ç/g, 'C');
  /* Türkçe Excel ve sık görülen başka adlar → motorun adı. AI araçları ve
     Excel alışkanlığı en çok bunları üretir; kullanıcıya "bilinmeyen
     fonksiyon" demek yerine düzeltilir ve NE düzeltildiği söylenir. */
  const FUNCTION_ALIASES = {
    EGER: 'IF', VE: 'AND', YADA: 'OR', DEGIL: 'NOT', COKEGER: 'IFS', EGERHATA: 'IFERROR', EBOSSA: 'ISBLANK',
    TOPLA: 'SUM', ORTALAMA: 'AVERAGE', MAK: 'MAX', YUVARLA: 'ROUND', YUKARIYUVARLA: 'ROUNDUP', ASAGIYUVARLA: 'ROUNDDOWN',
    MUTLAK: 'ABS', KAREKOK: 'SQRT', KUVVET: 'POWER', TAMSAYI: 'FLOOR', INT: 'FLOOR', CEILING: 'CEIL', TAVANAYUVARLA: 'CEIL', TABANAYUVARLA: 'FLOOR',
    BUGUN: 'TODAY', NOW: 'TODAY', SIMDI: 'TODAY', TARIH: 'DATE', YIL: 'YEAR', AY: 'MONTH', GUN: 'DAY', HAFTASAY: 'WEEKNUM', ISOWEEKNUM: 'WEEKNUM', ISOHAFTASAY: 'WEEKNUM',
    GUNSAY: 'DAYS', ETARIHLI: 'DATEDIF',
    BIRLESTIR: 'CONCAT', CONCATENATE: 'CONCAT', METINBIRLESTIR: 'TEXTJOIN', BUYUKHARF: 'UPPER', KUCUKHARF: 'LOWER', KIRP: 'TRIM',
    UZUNLUK: 'LEN', SOLDAN: 'LEFT', SAGDAN: 'RIGHT', PARCAAL: 'MID', BUL: 'FIND', MBUL: 'FIND', SEARCH: 'FIND',
    SAYIYACEVIR: 'NUMBER', VALUE: 'NUMBER', METNECEVIR: 'TEXT',
  };
  function canonicalFunctionName(name) {
    const upper = String(name || '').toLocaleUpperCase('en');
    if (Object.prototype.hasOwnProperty.call(FUNCTIONS, upper)) return upper;
    const folded = fold(name);
    if (Object.prototype.hasOwnProperty.call(FUNCTIONS, folded)) return folded;
    return FUNCTION_ALIASES[folded] || null;
  }

  /* AI cevabından formülü çıkarır. Cevap çoğu zaman açıklama + kod bloğu
     olarak gelir; kullanıcıdan "yalnız formülü seç" beklemek, kopyalamayı
     zorlaştırmak demekti. Sıra: ``` kod bloğu → `satır içi kod` → metnin
     tamamı → çözümlenebilen ilk satır. */
  function extractFormula(input) {
    const raw = String(input == null ? '' : input).replace(/\r\n?/g, '\n').trim();
    if (!raw) return '';
    const strip = text => String(text || '').trim()
      .replace(/^(?:formül|formula|formul)\s*[:：]\s*/i, '')
      .replace(/^=\s*/, '')
      .replace(/[;\s]+$/, '')
      .trim();
    const fence = /```[a-zA-Z]*\n?([\s\S]*?)```/.exec(raw);
    if (fence && strip(fence[1])) return strip(fence[1]);
    const inline = [...raw.matchAll(/`([^`\n]+)`/g)].map(match => strip(match[1])).find(text => /[\[(]/.test(text));
    if (inline) return inline;
    const whole = strip(raw);
    if (compile(autoFix(whole).formula).ok) return whole;
    const lines = raw.split('\n').map(strip).filter(Boolean);
    const parsed = lines.find(line => /[\[(]/.test(line) && compile(autoFix(line).formula).ok);
    if (parsed) return parsed;
    return lines.find(line => /[\[(]/.test(line)) || whole;
  }

  /* Metni motorun anlayacağı biçime getirir ve NE değiştiğini listeler.
     Anlamı değiştirebilecek hiçbir şeye (ondalık virgül, hücre adresi)
     dokunulmaz — onlar analizde HATA olarak bildirilir. */
  function autoFix(input) {
    const fixes = [];
    const note = (tr, en) => { if (!fixes.some(item => item.tr === tr)) fixes.push({ tr, en }); };
    let text = String(input == null ? '' : input).trim();
    if (/^=/.test(text)) { text = text.replace(/^=\s*/, ''); note('Baştaki "=" kaldırıldı.', 'Removed the leading "=".'); }
    const quoted = text.replace(/[“”„‟″]/g, '"').replace(/[‘’‚‛′]/g, "'");
    if (quoted !== text) { text = quoted; note('Kıvrık tırnaklar düz tırnağa çevrildi.', 'Curly quotes were turned into straight quotes.'); }
    // İşaretler yalnız tırnak DIŞINDA değişir; ayraç olarak yazılan "–" korunur.
    const SIGNS = { '×': '*', '÷': '/', '−': '-', '–': '-', '—': '-', '≠': '<>', '≤': '<=', '≥': '>=' };
    let out = '', quote = null, changedSign = false;
    for (let index = 0; index < text.length; index++) {
      const ch = text[index];
      if (quote) {
        out += ch;
        if (ch === '\\' && index + 1 < text.length) { out += text[++index]; continue; }
        if (ch === quote) quote = null;
        continue;
      }
      if (ch === '"' || ch === "'") { quote = ch; out += ch; continue; }
      if (SIGNS[ch]) { out += SIGNS[ch]; changedSign = true; continue; }
      out += ch;
    }
    if (changedSign) note('× ÷ − ≠ ≤ ≥ işaretleri formül işaretlerine (* / - <> <= >=) çevrildi.', 'The × ÷ − ≠ ≤ ≥ signs were turned into formula signs (* / - <> <= >=).');
    text = out;
    const renamed = [];
    text = rewriteTokens(text, (token, next) => {
      if (token.type !== 'name') return null;
      const isCall = next && next.type === 'punct' && next.value === '(';
      if (!isCall) {
        const folded = fold(token.value);
        if ((folded === 'DOGRU' || folded === 'YANLIS') && token.value !== folded) return folded === 'DOGRU' ? 'TRUE' : 'FALSE';
        return null;
      }
      const canonical = canonicalFunctionName(token.value);
      if (!canonical || canonical === token.value) return null;
      if (canonical !== token.value.toLocaleUpperCase('en')) renamed.push(`${token.value} → ${canonical}`);
      return canonical;
    });
    if (renamed.length) note(`Fonksiyon adları düzeltildi: ${[...new Set(renamed)].join(', ')}.`, `Function names fixed: ${[...new Set(renamed)].join(', ')}.`);
    return { formula: text, fixes };
  }

  /* ---------------- ANALİZ ----------------

     Kullanıcı talebi: "... çıktıyı buyer loga kopyalasınlar, buyer log da
     analiz edip varsa hata söylesin."

     Motorun derleme hatası tek satırlık teknik bir cümledir ("")" bekleniyordu").
     Analiz aynı hatayı DÜZ DİLLE ve NEREDE olduğunu göstererek söyler, üstüne
     derlemenin göremediklerini de denetler: tabloda olmayan sütun (en yakın
     adı önererek), yanlış argüman sayısı (doğru yazımı göstererek), sütun
     adının tırnakla yazılması. Sonuç { ok, formula, fixes, issues } olur;
     ok yalnız HATA düzeyinde sorun yoksa doğrudur. */
  function distance(a, b) {
    const s = String(a), t = String(b);
    if (s === t) return 0;
    const row = Array.from({ length: t.length + 1 }, (_, index) => index);
    for (let i = 1; i <= s.length; i++) {
      let previous = row[0];
      row[0] = i;
      for (let j = 1; j <= t.length; j++) {
        const current = row[j];
        row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (s[i - 1] === t[j - 1] ? 0 : 1));
        previous = current;
      }
    }
    return row[t.length];
  }
  const lowerTr = value => String(value == null ? '' : value).trim().toLocaleLowerCase('tr-TR');
  function closest(name, candidates) {
    const target = lowerTr(name);
    if (!target) return null;
    let best = null, bestScore = Infinity;
    for (const candidate of candidates) {
      const value = lowerTr(candidate);
      if (!value) continue;
      let score = distance(target, value);
      if (value.includes(target) || target.includes(value)) score = Math.min(score, Math.abs(value.length - target.length) * 0.5 + 0.5);
      if (score < bestScore) { bestScore = score; best = candidate; }
    }
    return best != null && bestScore <= Math.max(2, Math.floor(target.length / 3)) ? best : null;
  }
  function docFor(name) {
    return FUNCTION_DOCS.find(item => item.name === name || (item.also || []).includes(name)) || null;
  }
  function issue(level, code, tr, en, extra) { return { level, code, tr, en, ...(extra || {}) }; }

  function analyze(source, options = {}) {
    const input = String(source == null ? '' : source);
    const fixed = options.autoFix === false ? { formula: input.trim(), fixes: [] } : autoFix(input);
    const formula = fixed.formula;
    const issues = [];
    const columnNames = (options.columns || []).map(item => (typeof item === 'string' ? item : item && item.name)).filter(Boolean);
    const resolve = typeof options.resolve === 'function'
      ? options.resolve
      : name => columnNames.some(item => lowerTr(item) === lowerTr(name));
    if (!formula.trim()) {
      issues.push(issue('error', 'EMPTY', 'Formül boş.', 'The formula is empty.'));
      return { ok: false, formula, fixes: fixed.fixes, issues, columns: [] };
    }
    const program = compile(formula);
    if (!program.ok) {
      const error = program.error || {};
      const position = Number.isFinite(error.position) ? error.position : null;
      const at = position != null ? formula[position] || '' : '';
      let tr = error.message || 'Formül çözümlenemedi.', en = 'The formula could not be read.';
      let hintTr = '', hintEn = '';
      if (error.code === 'UNCLOSED_COLUMN') { tr = 'Bir sütun adının kapanış köşeli parantezi "]" eksik.'; en = 'A column name is missing its closing "]".'; }
      else if (error.code === 'UNCLOSED_STRING') { tr = 'Bir metnin kapanış tırnağı eksik.'; en = 'A piece of text is missing its closing quote.'; }
      else if (error.code === 'EXPECTED_TOKEN') { tr = 'Parantezler dengeli değil ya da iki değer arasında virgül eksik.'; en = 'The brackets are unbalanced, or a comma is missing between two values.'; }
      else if (error.code === 'UNEXPECTED_END') { tr = 'Formül yarım kalmış: bir işaretten ya da virgülden sonra değer eksik.'; en = 'The formula is unfinished: a value is missing after a sign or comma.'; }
      else if (error.code === 'TRAILING_INPUT') { tr = `Fazladan bir parça var ("${at}"). Arada bir işlem işareti (+ − * /) eksik ya da fazladan parantez olabilir.`; en = `There is an extra piece ("${at}"). A sign (+ − * /) may be missing, or there is an extra bracket.`; }
      else if (error.code === 'BAD_CHARACTER') {
        tr = `Formülde kullanılamayan bir işaret var: "${at}".`; en = `The formula has a sign that cannot be used: "${at}".`;
        if (at === ':') { hintTr = 'Aralık (A1:A10) yoktur; formül tek satırın değerleriyle çalışır.'; hintEn = 'Ranges (A1:A10) do not exist; a formula works on one row’s values.'; }
        if (at === '{' || at === '}') { hintTr = 'Sütun adları süslü değil KÖŞELİ parantezle yazılır: [Sütun].'; hintEn = 'Column names use SQUARE brackets, not braces: [Column].'; }
      } else if (error.code === 'UNKNOWN_NAME') {
        const bare = /"([^"]+)"/.exec(error.message || '');
        const name = bare ? bare[1] : '';
        tr = `"${name}" tanınmadı.`; en = `"${name}" is not recognised.`;
        if (/^[A-Za-z]{1,3}\d+$/.test(name)) { hintTr = 'Hücre adresi (A1, B2) yoktur; sütunu adıyla köşeli parantez içinde yazın: [Sütun Adı].'; hintEn = 'There are no cell addresses (A1, B2); write the column by name in square brackets: [Column Name].'; }
        else {
          const match = columnNames.find(item => lowerTr(item) === lowerTr(name)) || closest(name, columnNames);
          hintTr = match ? `Sütunsa köşeli parantezle yazın: [${match}]. Metinse tırnağa alın: "${name}".` : `Sütunsa köşeli parantezle ([${name}]), metinse tırnakla ("${name}") yazın.`;
          hintEn = match ? `If it is a column, use square brackets: [${match}]. If it is text, quote it: "${name}".` : `Use square brackets for a column ([${name}]) or quotes for text ("${name}").`;
        }
      }
      issues.push(issue('error', error.code || 'PARSE', tr, en, { position, hintTr, hintEn }));
      return { ok: false, formula, fixes: fixed.fixes, issues, columns: [] };
    }
    const seenColumns = new Set();
    const visit = node => {
      if (!node || typeof node !== 'object') return;
      if (node.kind === 'column' && !seenColumns.has(lowerTr(node.name))) {
        seenColumns.add(lowerTr(node.name));
        if (!resolve(node.name)) {
          const suggestion = closest(node.name, columnNames);
          issues.push(issue('error', 'UNKNOWN_COLUMN',
            `Bu tabloda [${node.name}] adlı bir sütun yok.`, `This table has no column named [${node.name}].`,
            { column: node.name, suggestion, hintTr: suggestion ? `Bunu mu demek istediniz: [${suggestion}]?` : 'Sütun adını “Sütun ekle” listesinden seçerek yazın.', hintEn: suggestion ? `Did you mean [${suggestion}]?` : 'Pick the name from the “Insert column” list.' }));
        }
      }
      if (node.kind === 'string' && columnNames.some(item => lowerTr(item) === lowerTr(node.value))) {
        issues.push(issue('warn', 'QUOTED_COLUMN',
          `"${node.value}" tırnak içinde: bu bir METİN olarak okunur, sütunun değeri değil.`, `"${node.value}" is in quotes: it is read as TEXT, not the column value.`,
          { hintTr: `Sütunun değerini kullanmak için [${node.value}] yazın.`, hintEn: `Write [${node.value}] to use the column value.` }));
      }
      if (node.kind === 'call') {
        const definition = FUNCTIONS[node.name];
        if (!definition) {
          const suggestion = FUNCTION_ALIASES[fold(node.name)] || closest(node.name, Object.keys(FUNCTIONS));
          issues.push(issue('error', 'UNKNOWN_FUNCTION', `${node.name}() diye bir fonksiyon yok.`, `There is no ${node.name}() function.`,
            { position: node.position, hintTr: suggestion ? `Bunu mu demek istediniz: ${suggestion}()? Tam liste sözlükte.` : 'Kullanılabilir fonksiyonlar sözlükte listelenir.', hintEn: suggestion ? `Did you mean ${suggestion}()? The full list is in the dictionary.` : 'The available functions are listed in the dictionary.' }));
        } else if (node.args.length < definition.min || node.args.length > definition.max) {
          const doc = docFor(node.name);
          const expected = definition.min === definition.max ? String(definition.min) : definition.max >= 50 ? `${definition.min}+` : `${definition.min}-${definition.max}`;
          issues.push(issue('error', 'BAD_ARITY', `${node.name}() ${expected} değer ister, formülde ${node.args.length} tane var.`, `${node.name}() takes ${expected} value(s); the formula gives ${node.args.length}.`,
            { position: node.position, hintTr: doc ? `Doğru yazım: ${doc.syntax}` : '', hintEn: doc ? `Correct form: ${doc.syntaxEn}` : '' }));
        } else if (node.name === 'IFS' && node.args.length % 2) {
          issues.push(issue('error', 'BAD_ARITY', 'IFS() koşul/değer ÇİFTLERİ ister; bir değer eksik.', 'IFS() takes condition/value PAIRS; a value is missing.', { position: node.position }));
        }
        if (node.name === 'TODAY') {
          issues.push(issue('info', 'VOLATILE', 'TODAY() her gün değişir; sütunun değeri de her gün kendiliğinden güncellenir.', 'TODAY() changes every day, so the column updates by itself each day.'));
        }
      }
      ['left', 'right', 'argument'].forEach(key => visit(node[key]));
      (node.args || []).forEach(visit);
    };
    visit(program.ast);
    // Aynı bilgi notu birden çok kez yazılmasın.
    const unique = issues.filter((item, index) => issues.findIndex(other => other.code === item.code && other.tr === item.tr) === index);
    return { ok: !unique.some(item => item.level === 'error'), formula, fixes: fixed.fixes, issues: unique, columns: program.columns };
  }

  /* ---------------- AI YÖNERGESİ ----------------

     Kullanıcı talebi: "oluşturmak istenilen formül karmaşıksa AI'a formül
     yazma kurallarını anlatıp istediklerini söylesinler ve çıktıyı buyer
     loga kopyalasınlar."

     Yönerge kuralları, fonksiyon listesini, tablonun sütun ADLARINI (ve tahmini
     türlerini) ve kullanıcının isteğini tek metinde toplar. Hiçbir satır
     DEĞERİ eklenmez: sipariş, fiyat ya da tedarikçi verisi kullanıcının
     seçtiği dış bir araca gitmez (CLAUDE.md §4). */
  function buildAiPrompt(options = {}) {
    const english = options.lang === 'en';
    const pick = item => (english ? item.en : item.tr);
    const typeName = type => ({
      date: english ? 'date' : 'tarih', number: english ? 'number' : 'sayı', text: english ? 'text' : 'metin',
    }[type] || (english ? 'unknown' : 'bilinmiyor'));
    const columns = (options.columns || []).map(item => (typeof item === 'string' ? { name: item } : item)).filter(item => item && item.name);
    const request = String(options.request || '').trim();
    const lines = [];
    if (english) {
      lines.push('You are helping me write ONE formula for a calculated column in the Buyer Log app. It is NOT Excel: follow these rules exactly.');
    } else {
      lines.push('Buyer Log uygulamasında hesaplanan bir sütun için TEK bir formül yazmama yardım et. Bu Excel DEĞİL: aşağıdaki kurallara birebir uy.');
    }
    lines.push('', english ? 'RULES' : 'KURALLAR');
    RULES.forEach((rule, index) => lines.push(`${index + 1}. ${pick(rule)}`));
    lines.push('', english ? 'OPERATORS' : 'İŞLEMLER');
    OPERATOR_DOCS.forEach(item => lines.push(`- ${item.sign.replace(/\s+/g, ' ')} : ${pick(item)}`));
    lines.push('', english ? 'FUNCTIONS (only these exist)' : 'FONKSİYONLAR (yalnız bunlar var)');
    FUNCTION_DOCS.forEach(item => lines.push(`- ${english ? item.syntaxEn : item.syntax} — ${pick(item)}`));
    lines.push('', english ? `COLUMNS OF THE ${String(options.tableName || '').toUpperCase()} TABLE (name — type)` : `${String(options.tableName || '').toLocaleUpperCase('tr-TR')} TABLOSUNUN SÜTUNLARI (ad — tür)`);
    columns.forEach(item => lines.push(`- [${item.name}]${item.type ? ` — ${typeName(item.type)}` : ''}`));
    lines.push('', english ? 'WHAT I WANT' : 'İSTEDİĞİM');
    lines.push(request || (english ? '(describe what the column should show here)' : '(sütunun ne göstermesini istediğinizi buraya yazın)'));
    lines.push('', english ? 'ANSWER FORMAT' : 'CEVAP BİÇİMİ');
    if (english) {
      lines.push('- Put the formula inside ONE code block (```), on a single line, with no leading "=".');
      lines.push('- Under it, explain in one or two sentences what it does.');
      lines.push('- If what I want cannot be done with these rules (e.g. it needs other rows), say so plainly instead of inventing a function.');
    } else {
      lines.push('- Formülü TEK bir kod bloğu (```) içinde, tek satır ve başında "=" olmadan ver.');
      lines.push('- Altına ne yaptığını bir iki cümleyle açıkla.');
      lines.push('- İstediğim şey bu kurallarla yapılamıyorsa (ör. başka satırlara bakmak gerekiyorsa) fonksiyon uydurmak yerine bunu açıkça söyle.');
    }
    return lines.join('\n');
  }

  const api = {
    compile, parse, tokenize, FUNCTIONS, FUNCTION_HELP, FormulaError,
    toNumber, toDate, toText, toBool, isBlank, dateText, looksLikeDate, DAY_MS,
    // Sözlük, analiz ve AI yardımcıları (v7.175).
    CATEGORIES, FUNCTION_DOCS, OPERATOR_DOCS, RECIPE_DOCS, RULES, FUNCTION_ALIASES,
    rewriteTokens, rewriteColumns, extractFormula, autoFix, analyze, buildAiPrompt, canonicalFunctionName,
  };

  global.BLFormulaEngine = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
