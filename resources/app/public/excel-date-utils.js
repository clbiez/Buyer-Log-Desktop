/* Buyer Log v2.97 — shared date typing for every generated Excel workbook. */
(function attachBuyerLogExcelDates(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.BLExcelDates = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createBuyerLogExcelDates() {
  'use strict';

  const DATE_FORMAT = 'dd.mm.yy';
  const ASCII_MAP = Object.freeze({ 'İ':'I','Ş':'S','Ç':'C','Ö':'O','Ü':'U','Ğ':'G' });

  function normalizedHeader(value) {
    return String(value == null ? '' : value)
      .toUpperCase()
      .replace(/[İŞÇÖÜĞ]/g, ch => ASCII_MAP[ch])
      .replace(/[\r\n]+/g, ' ')
      .replace(/[^A-Z0-9]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function isPeriodOnlyHeader(header) {
    const key = normalizedHeader(header);
    if (!key) return false;
    if (/\b(HAFTA|HAFTASI|HAFTALARI|WEEK|WEEKS)\b/.test(key)) return true;
    if (/\b(MONTH|MONTHS|AY|AYI|AYLARI)\b/.test(key) && !/\b(GUN|DAY)\b/.test(key)) return true;
    if (/\bYIL AY\b/.test(key) && !/\bGUN\b/.test(key)) return true;
    return false;
  }

  function isDateHeader(header) {
    const key = normalizedHeader(header);
    if (!key || isPeriodOnlyHeader(key)) return false;
    if (/TARIH/.test(key) || /\b(DATE|DATETIME|TIMESTAMP)\b/.test(key)) return true;
    if (['OPD','RETAIL','YUKLEME ONAYI','BUYING APPROVAL','RETAIL TR WITH VESSEL'].includes(key)) return true;
    if (/\bANTREPO TESLIM\b/.test(key)) return true;
    if (/\bEX FACTORY\b/.test(key)) return true;
    if (/\bIN STORE\b/.test(key)) return true;
    if (/\bANT(?:REPO)? ARRIVAL\b/.test(key)) return true;
    if (/\bANTREPO GIRIS\b/.test(key)) return true;
    if (/\bHANDOVER\b/.test(key)) return true;
    if (/\bCREATED AT\b|\bUPDATED AT\b|\bLOADED AT\b|\bAPPROVED AT\b/.test(key)) return true;
    return false;
  }

  function validDateParts(year, month, day) {
    const date = new Date(year, month - 1, day);
    return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : null;
  }

  function parseDate(value) {
    if (value instanceof Date) return isNaN(value) ? null : new Date(value.getFullYear(), value.getMonth(), value.getDate());
    if (value == null || value === '') return null;
    if (typeof value === 'number' && Number.isFinite(value)) return null; // already an Excel serial or a numeric value
    const text = String(value).trim();
    if (!text) return null;
    let match = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T\s].*)?$/);
    if (match) return validDateParts(Number(match[1]), Number(match[2]), Number(match[3]));
    match = text.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})(?:[T\s].*)?$/);
    if (match) return validDateParts(Number(match[3]), Number(match[2]), Number(match[1]));
    match = text.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2})$/);
    if (match) {
      const yy = Number(match[3]);
      return validDateParts(yy >= 70 ? 1900 + yy : 2000 + yy, Number(match[2]), Number(match[1]));
    }
    const parsed = new Date(text);
    return isNaN(parsed) ? null : new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
  }

  /* -------------------------------------------------------------------
     TARİH KAYMASI (v5.81)

     Excel tarihleri 30.12.1899'dan itibaren GÜN SAYISI olarak saklar. Bu sayı
     takvim günüdür, bir zaman anı değildir. Uygulamadaki tarihler ise yerel
     gece yarısına ayarlı Date nesneleri; Türkiye UTC+3 olduğu için 2 Ocak
     yerel gece yarısı, UTC'de 1 Ocak 21:00'dir.

     ExcelJS bu dönüşümü tamamen UTC üzerinden yapıyordu:
         seri = 25569 + tarih.getTime() / 86400000
     Bu, 2 Ocak için 46023,875 verir — Excel tam sayı kısmına baktığı için
     hücrede 01.01.2026 görünür. Yani UTC+X saat diliminde YAZILAN HER TARİH
     bir gün geriye kayıyordu.

     SheetJS bir gün kaydırmıyor ama Istanbul'un 1899'daki yerel saat farkı
     (+01:56:56) yüzünden seriye 56 saniyelik bir artık bırakıyordu.

     Çözüm: hiçbir kütüphanenin saat dilimi matematiğine güvenmeyip tarihleri
     kendimiz TAM SAYI seri numarasına çeviriyor ve hücreye sayı + tarih biçimi
     olarak yazıyoruz. Böylece yazan taraf ile okuyan taraf aynı takvim gününde
     buluşur, saat dilimi ne olursa olsun.
     ------------------------------------------------------------------- */
  const EXCEL_EPOCH_OFFSET = 25569; // 1970-01-01'in Excel seri numarası
  const MS_PER_DAY = 86400000;

  // Bir Date'in hangi TAKVİM GÜNÜNÜ temsil ettiğini bulur. Uygulamadaki tarihler
  // yerel gece yarısıdır; ISO metinden gelenler (new Date('2026-01-02')) ise UTC
  // gece yarısıdır. İkisini de doğru okumak için sunucudaki dateOnlyISO ile aynı
  // ayrım kullanılır.
  function calendarParts(value) {
    const date = value instanceof Date ? value : parseDate(value);
    if (!(date instanceof Date) || isNaN(date)) return null;
    const localMidnight = date.getHours() === 0 && date.getMinutes() === 0 && date.getSeconds() === 0 && date.getMilliseconds() === 0;
    const utcMidnight = date.getUTCHours() === 0 && date.getUTCMinutes() === 0 && date.getUTCSeconds() === 0 && date.getUTCMilliseconds() === 0;
    const useUTC = utcMidnight && !localMidnight;
    return {
      year: useUTC ? date.getUTCFullYear() : date.getFullYear(),
      month: (useUTC ? date.getUTCMonth() : date.getMonth()) + 1,
      day: useUTC ? date.getUTCDate() : date.getDate(),
    };
  }

  // Takvim gününün Excel seri numarası. Sonuç her zaman TAM SAYIDIR.
  function excelSerial(value) {
    const parts = calendarParts(value);
    if (!parts) return null;
    const days = Math.round(Date.UTC(parts.year, parts.month - 1, parts.day) / MS_PER_DAY);
    const serial = days + EXCEL_EPOCH_OFFSET;
    // Excel'in var olmayan 29.02.1900 hatası: 1 Mart 1900 öncesi bir gün kayar.
    return serial < 60 ? serial - 1 : serial;
  }

  function dateStyle(cell) {
    if (!cell) return;
    cell.z = DATE_FORMAT;
    if (cell.s && typeof cell.s === 'object' && !Array.isArray(cell.s)) cell.s = { ...cell.s, numFmt: DATE_FORMAT };
  }

  // Hücre artık Date değil, TAM SAYI seri numarası + tarih biçimi olarak yazılır.
  // Böylece SheetJS'in de ExcelJS'in de saat dilimi dönüşümü devreye girmez.
  // Hücrede zaten bir tarih biçimi varsa (ör. 'dd.mm.yy') korunur; yalnız biçimsiz
  // hücrelere varsayılan tarih biçimi konur.
  function looksLikeDateFormat(value) {
    const text = String(value == null ? '' : value).trim();
    if (!text || text.toLowerCase() === 'general') return false;
    return /[dmy]/i.test(text) && !/[#0]/.test(text);
  }
  function writeSerialCell(cell, value) {
    const serial = excelSerial(value);
    if (serial == null) return false;
    cell.t = 'n'; cell.v = serial; delete cell.w;
    const keep = looksLikeDateFormat(cell.z) ? cell.z : (looksLikeDateFormat(cell.s && cell.s.numFmt) ? cell.s.numFmt : null);
    if (keep) {
      cell.z = keep;
      if (cell.s && typeof cell.s === 'object' && !Array.isArray(cell.s)) cell.s = { ...cell.s, numFmt: keep };
    } else dateStyle(cell);
    return true;
  }

  // Başlığı tarih gibi görünmese bile t:'d' olan her hücre tarihtir; hepsi aynı
  // güvenli yoldan geçsin diye ayrıca taranır.
  function normalizeSheetDateCells(ws, XLSX) {
    if (!ws || !XLSX || !XLSX.utils || !ws['!ref']) return 0;
    const range = XLSX.utils.decode_range(ws['!ref']);
    let changed = 0;
    for (let r = range.s.r; r <= range.e.r; r++) {
      for (let c = range.s.c; c <= range.e.c; c++) {
        const cell = ws[XLSX.utils.encode_cell({ r, c })];
        if (!cell || cell.t !== 'd' || !(cell.v instanceof Date) || isNaN(cell.v)) continue;
        if (writeSerialCell(cell, cell.v)) changed++;
      }
    }
    return changed;
  }

  function normalizeSheetDateColumns(ws, XLSX, options) {
    if (!ws || !XLSX || !XLSX.utils || !ws['!ref']) return 0;
    const range = XLSX.utils.decode_range(ws['!ref']);
    const scanRows = Math.max(1, Number(options && options.headerScanRows) || 12);
    const headerByColumn = new Map();
    for (let c = range.s.c; c <= range.e.c; c++) {
      for (let r = range.s.r; r <= Math.min(range.e.r, range.s.r + scanRows - 1); r++) {
        const cell = ws[XLSX.utils.encode_cell({ r, c })];
        if (!headerByColumn.has(c) && cell && isDateHeader(cell.v)) headerByColumn.set(c, r);
      }
    }
    let changed = 0;
    for (const [c, headerRow] of headerByColumn) {
      for (let r = headerRow + 1; r <= range.e.r; r++) {
        const ref = XLSX.utils.encode_cell({ r, c });
        const cell = ws[ref];
        if (!cell || cell.v == null || cell.v === '') continue;
        if (cell.f) { dateStyle(cell); changed++; continue; }
        if (cell.t === 'd' && cell.v instanceof Date && !isNaN(cell.v)) { writeSerialCell(cell, cell.v); changed++; continue; }
        if (cell.t === 'n' && Number.isFinite(Number(cell.v))) { dateStyle(cell); changed++; continue; }
        const parsed = parseDate(cell.v);
        if (!parsed) continue;
        writeSerialCell(cell, parsed); changed++;
      }
    }
    return changed;
  }

  function normalizeWorkbookDateColumns(wb, XLSX, options) {
    if (!wb || !wb.Sheets) return 0;
    let changed = 0;
    for (const name of Array.isArray(wb.SheetNames) ? wb.SheetNames : Object.keys(wb.Sheets)) {
      changed += normalizeSheetDateColumns(wb.Sheets[name], XLSX, options);
      changed += normalizeSheetDateCells(wb.Sheets[name], XLSX);
    }
    return changed;
  }

  function excelJsCellText(cell) {
    const value = cell && cell.value;
    if (value == null) return '';
    if (typeof value === 'object') {
      if (value.richText) return value.richText.map(item => item.text || '').join('');
      if (value.text != null) return String(value.text);
      if (value.result != null) return String(value.result);
      return '';
    }
    return String(value);
  }

  // ExcelJS bir Date'i 25569 + getTime()/86400000 ile seriye çeviriyor; bu tamamen
  // UTC üzerinden olduğu için UTC+X saat dilimlerinde tarih bir gün geriye kayıyor.
  // Date yerine hazır seri numarası verildiğinde o dönüşüm hiç çalışmaz.
  function writeExcelJsSerial(cell, value) {
    const serial = excelSerial(value);
    if (serial == null) return false;
    const keep = looksLikeDateFormat(cell.numFmt) ? cell.numFmt : null;
    cell.value = serial;
    cell.numFmt = keep || DATE_FORMAT;
    return true;
  }

  function normalizeExcelJsWorksheetDateCells(ws) {
    if (!ws || typeof ws.eachRow !== 'function') return 0;
    let changed = 0;
    ws.eachRow(row => {
      row.eachCell({ includeEmpty: false }, cell => {
        if (cell.value instanceof Date && !isNaN(cell.value) && writeExcelJsSerial(cell, cell.value)) changed++;
      });
    });
    return changed;
  }

  function normalizeExcelJsWorksheetDateColumns(ws, options) {
    if (!ws || typeof ws.getRow !== 'function') return 0;
    const scanRows = Math.max(1, Number(options && options.headerScanRows) || 12);
    const maxRows = Number(ws.rowCount) || 0;
    const maxCols = Number(ws.columnCount) || 0;
    const headerByColumn = new Map();
    for (let c = 1; c <= maxCols; c++) {
      for (let r = 1; r <= Math.min(maxRows, scanRows); r++) {
        const cell = ws.getRow(r).getCell(c);
        if (!headerByColumn.has(c) && isDateHeader(excelJsCellText(cell))) headerByColumn.set(c, r);
      }
    }
    let changed = 0;
    for (const [c, headerRow] of headerByColumn) {
      for (let r = headerRow + 1; r <= maxRows; r++) {
        const cell = ws.getRow(r).getCell(c);
        const value = cell.value;
        if (value == null || value === '') continue;
        if (value instanceof Date && !isNaN(value)) { writeExcelJsSerial(cell, value); changed++; continue; }
        if (typeof value === 'object' && value.formula) { cell.numFmt = DATE_FORMAT; changed++; continue; }
        const parsed = parseDate(value);
        if (!parsed) continue;
        writeExcelJsSerial(cell, parsed); changed++;
      }
    }
    return changed;
  }

  function normalizeExcelJsWorkbookDateColumns(wb, options) {
    if (!wb || !Array.isArray(wb.worksheets)) return 0;
    return wb.worksheets.reduce((sum, ws) => sum
      + normalizeExcelJsWorksheetDateColumns(ws, options)
      + normalizeExcelJsWorksheetDateCells(ws), 0);
  }

  /* -------------------------------------------------------------------
     OKUMA TARAFI (v5.81)

     Aynı saat dilimi sorununun aynası okumada da var. SheetJS'e cellDates:true
     verildiğinde seri numarasını Date'e çevirirken 1899 yılının yerel saat
     farkını kullanıyor; İstanbul'da o dönemin farkı +01:56:56 olduğu için
     46024 (2 Ocak 2026) hücresi "1 Ocak 2026 23:59:04" olarak geri geliyordu.
     getDate() ile gün okunduğunda sonuç bir gün geriydi.

     Artık okunan her Date, gece yarısına çok yakınsa (birkaç dakika) en yakın
     gün başına yuvarlanır. Pencere dar tutuldu: gerçek bir saat bilgisi taşıyan
     zaman damgaları (ör. 14:30) bu pencereye giremez, dokunulmadan kalır.
     ------------------------------------------------------------------- */
  const MIDNIGHT_SNAP_MS = 5 * 60 * 1000;

  function snapReadDate(value) {
    if (!(value instanceof Date) || isNaN(value)) return value;
    const dayStart = new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
    const sinceStart = value.getTime() - dayStart;
    if (sinceStart <= MIDNIGHT_SNAP_MS) return new Date(dayStart);
    if (MS_PER_DAY - sinceStart <= MIDNIGHT_SNAP_MS) return new Date(dayStart + MS_PER_DAY);
    return value;
  }

  function repairReadDateCells(wb, XLSX) {
    if (!wb || !wb.Sheets || !XLSX || !XLSX.utils) return 0;
    let changed = 0;
    for (const name of Array.isArray(wb.SheetNames) ? wb.SheetNames : Object.keys(wb.Sheets)) {
      const ws = wb.Sheets[name];
      if (!ws || !ws['!ref']) continue;
      const range = XLSX.utils.decode_range(ws['!ref']);
      for (let r = range.s.r; r <= range.e.r; r++) {
        for (let c = range.s.c; c <= range.e.c; c++) {
          const cell = ws[XLSX.utils.encode_cell({ r, c })];
          if (!cell || !(cell.v instanceof Date) || isNaN(cell.v)) continue;
          const snapped = snapReadDate(cell.v);
          if (snapped.getTime() !== cell.v.getTime()) { cell.v = snapped; delete cell.w; changed++; }
        }
      }
    }
    return changed;
  }

  function installSheetJsHooks(XLSX) {
    if (!XLSX || XLSX.__buyerLogDateHooks) return false;
    const originalWriteFile = typeof XLSX.writeFile === 'function' ? XLSX.writeFile.bind(XLSX) : null;
    const originalWrite = typeof XLSX.write === 'function' ? XLSX.write.bind(XLSX) : null;
    if (originalWriteFile) XLSX.writeFile = function buyerLogWriteFile(workbook) {
      normalizeWorkbookDateColumns(workbook, XLSX);
      return originalWriteFile.apply(null, arguments);
    };
    if (originalWrite) XLSX.write = function buyerLogWrite(workbook) {
      normalizeWorkbookDateColumns(workbook, XLSX);
      return originalWrite.apply(null, arguments);
    };
    const originalRead = typeof XLSX.read === 'function' ? XLSX.read.bind(XLSX) : null;
    const originalReadFile = typeof XLSX.readFile === 'function' ? XLSX.readFile.bind(XLSX) : null;
    if (originalRead) XLSX.read = function buyerLogRead() {
      const workbook = originalRead.apply(null, arguments);
      repairReadDateCells(workbook, XLSX);
      return workbook;
    };
    if (originalReadFile) XLSX.readFile = function buyerLogReadFile() {
      const workbook = originalReadFile.apply(null, arguments);
      repairReadDateCells(workbook, XLSX);
      return workbook;
    };
    Object.defineProperty(XLSX, '__buyerLogDateHooks', { value: true, configurable: false, enumerable: false });
    return true;
  }

  return Object.freeze({
    DATE_FORMAT,
    EXCEL_EPOCH_OFFSET,
    calendarParts,
    excelSerial,
    normalizedHeader,
    isPeriodOnlyHeader,
    isDateHeader,
    parseDate,
    MIDNIGHT_SNAP_MS,
    snapReadDate,
    repairReadDateCells,
    looksLikeDateFormat,
    writeSerialCell,
    writeExcelJsSerial,
    normalizeSheetDateColumns,
    normalizeSheetDateCells,
    normalizeWorkbookDateColumns,
    normalizeExcelJsWorksheetDateCells,
    normalizeExcelJsWorksheetDateColumns,
    normalizeExcelJsWorkbookDateColumns,
    installSheetJsHooks,
  });
});
