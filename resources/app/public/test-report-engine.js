/* Buyer Log — TEST RAPORU MOTORU (saf)
 *
 * Test sonuç maillerini (.msg/.eml) ve rapor PDF'lerini deterministik olarak
 * ayrıştırır, aynı talebe ait parçaları birleştirir, checklist adımının
 * durumunu satırın BÜTÜN ilgili raporlarından türetir ve raporu CP satırıyla
 * eşler. Dosya okuma (msgreader / pdf.js) sunucudadır; bu modül yalnız metin
 * ve konumlu PDF öğeleri (p, x, y, s) ile çalışır.
 *
 * KURALLAR (brief'teki tuzaklar testlerle çivili):
 *  - Talep no METİNDİR. BD 6, TR 7 hane; sayıya çevrilmez.
 *  - Sonuç sözlüğü ikili değildir. Ham değer saklanır, gösterim TR/EN
 *    sözlüğüyle yapılır (statusDisplay deseni).
 *  - Renk kodu yoktur, renk TANIMI vardır. Bileşen rengi (R9J EKRU) varyant
 *    rengi değildir; eşleşme sipariş + model + renk tanımı ile yapılır.
 *  - Mail ile PDF çelişirse sessizce biri seçilmez; uyarı üretilir.
 *  - Tekrar test (retestOf) eski raporun yerine geçer.
 *  - Eşleştirmeyi AI değil bu motor yapar.
 *
 * SAF: DOM yok, fetch yok, AI yok.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.BLTestReports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /* ------------------------------------------------------------ metin */
  function text(value) { return String(value == null ? '' : value).replace(/\s+/g, ' ').trim(); }
  /* Türkçe büyük harf + aksan temizliği: ŞRT → SRT, İ/ı → I. Karşılaştırma
     anahtarıdır, gösterilmez. */
  function fold(value) {
    return text(value).toLocaleUpperCase('tr-TR').normalize('NFD').replace(/[̀-ͯ]/g, '');
  }
  // İki dilli değerlerde ("Kalır / Fail") ilk parça.
  function firstPart(value) { return text(String(value == null ? '' : value).split(' / ')[0]); }

  /* ------------------------------------------------------- sonuç sözlüğü */
  const RESULT_CODES = Object.freeze(['pass', 'fail', 'lackOfSample', 'commercialApproval', 'retest', 'awaitingBuying']);
  const RESULT_LABELS = Object.freeze({
    pass: Object.freeze({ tr: 'Geçer', en: 'Pass' }),
    fail: Object.freeze({ tr: 'Kalır', en: 'Fail' }),
    lackOfSample: Object.freeze({ tr: 'Numune yetersiz', en: 'Lack of sample' }),
    commercialApproval: Object.freeze({ tr: 'Ticari onay', en: 'Commercial approval' }),
    retest: Object.freeze({ tr: 'Tekrar test', en: 'Retest' }),
    awaitingBuying: Object.freeze({ tr: 'Buying dönüşü bekleniyor', en: 'Awaiting buying feedback' }),
  });
  function normalizeResult(value) {
    const parts = String(value == null ? '' : value).split('/').map(fold).filter(Boolean);
    const whole = fold(value);
    const candidates = [whole].concat(parts);
    for (const raw of candidates) {
      if (/BUYING/.test(raw) && /(DONUS|BEKLEN|AWAIT|WAIT|FEEDBACK)/.test(raw)) return 'awaitingBuying';
      if (/^(TICARI ONAY|COMMERCIAL APPROVAL|COMMERCIAL ACCEPT(ANCE)?)$/.test(raw)) return 'commercialApproval';
      if (/^(TEKRAR TEST|RETEST|RE-TEST|RE TEST)$/.test(raw)) return 'retest';
      if (/^(LACK OF SAMPLE|NUMUNE YETERSIZ|EKSIK NUMUNE|YETERSIZ NUMUNE)$/.test(raw)) return 'lackOfSample';
      if (/^(GECER|PASS|PASSED)$/.test(raw)) return 'pass';
      if (/^(KALIR|FAIL|FAILED)$/.test(raw)) return 'fail';
    }
    return '';
  }
  function resultLabel(value, lang) {
    const code = RESULT_LABELS[value] ? value : normalizeResult(value);
    if (!code) return text(value);
    return RESULT_LABELS[code][lang === 'en' ? 'en' : 'tr'];
  }

  /* --------------------------------------------------- kimlik alanları */
  // Talep no metindir: baştaki sıfır korunur, Number() kullanılmaz.
  function normalizeTalepNo(value) {
    const raw = text(value).replace(/\.0+$/, '');
    return /^\d{5,8}$/.test(raw) ? raw : '';
  }
  function normalizeOrderCode(value) {
    const raw = text(value).replace(/\.0+$/, '').replace(/\s+/g, '');
    return /^\d+$/.test(raw) ? raw.replace(/^0+(?=\d)/, '') : fold(raw);
  }
  /* MODEL ADI: "ŞRT,PLAYS10-YD" = "ŞRT,PLAYS-10-YD"; "KK.TSH,YUKI 2447911"
     sonundaki ek numara atılır; ayraçlar yok sayılır. */
  function modelKey(value) {
    return fold(value).replace(/\s+\d{6,}$/, '').replace(/[^A-Z0-9]+/g, '');
  }
  /* 'exact' | 'partial' | ''. Kısmi: biri diğerinin önekidir
     ("KK.BDY,SPACEJAM" ↔ "KK.BDY,SPACEJAM-1-YD"). Kısa önekler (< 6) kabul
     edilmez; "KK" her modelin öneki olurdu. */
  function modelMatch(a, b) {
    const x = modelKey(a), y = modelKey(b);
    if (!x || !y) return '';
    if (x === y) return 'exact';
    const shorter = x.length < y.length ? x : y;
    const longer = x.length < y.length ? y : x;
    return shorter.length >= 6 && longer.startsWith(shorter) ? 'partial' : '';
  }
  // Model kodu: "S7IQ90" ↔ "S7IQ90Z4".
  function modelCodeMatch(a, b) {
    const x = fold(a).replace(/[^A-Z0-9]+/g, ''), y = fold(b).replace(/[^A-Z0-9]+/g, '');
    if (!x || !y) return false;
    return x === y || (Math.min(x.length, y.length) >= 5 && (x.startsWith(y) || y.startsWith(x)));
  }
  /* RENK TANIMI. "HC3 CHINESE RED" gibi kod önekli değerde kod ayrı tutulur.
     Kod önekini yalnız rakam içeren 2-4 karakterlik ilk parça sayarız; "MID
     GREEN" gibi tanımlar bozulmaz. */
  function colourParts(value) {
    const folded = fold(value);
    const match = folded.match(/^([A-Z0-9]{2,4})\s+(.+)$/);
    if (match && /\d/.test(match[1])) return { code: match[1], key: text(match[2]) };
    return { code: '', key: folded };
  }
  function colourKey(value) { return colourParts(value).key; }
  /* 'exact' (tanım eşit) | 'code' (rapor kodu satırın renk koduna eşit) | '' */
  function colourMatch(reportColour, rowColour, rowColourCode) {
    const report = colourParts(reportColour);
    if (!report.key) return '';
    const row = colourParts(rowColour);
    if (row.key && row.key === report.key) return 'exact';
    if (report.code && fold(rowColourCode) === report.code) return 'code';
    return '';
  }
  function talepTipiKey(value) { return fold(firstPart(value)); }

  /* ------------------------------------------------------------ tarih */
  const MONTHS = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12 };
  function pad(n) { return String(n).padStart(2, '0'); }
  function offsetText(minutes) {
    const sign = minutes < 0 ? '-' : '+';
    const abs = Math.abs(minutes);
    return sign + pad(Math.floor(abs / 60)) + ':' + pad(abs % 60);
  }
  /* "03.10.2026", "05/10/2026", "5.10.2026 19:37:44", "Oct 5 2026 9:20AM",
     "2026-10-05T13:38:52Z". TR ve BD gün-ay-yıl yazar. Saat dilimi biliniyorsa
     (dakika) ISO değerine eklenir; bilinmiyorsa yerel saat olarak kalır. */
  function parseDate(value, options) {
    const raw = text(value);
    const out = { raw, date: '', time: '', iso: '' };
    if (!raw) return out;
    let y, mo, d, h = null, mi = 0, s = 0;
    let m = raw.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
    if (m) { d = +m[1]; mo = +m[2]; y = +m[3]; if (m[4] != null) { h = +m[4]; mi = +m[5]; s = +(m[6] || 0); } }
    if (!m) {
      m = raw.match(/^([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?)?$/);
      if (m && MONTHS[m[1].toUpperCase()]) {
        mo = MONTHS[m[1].toUpperCase()]; d = +m[2]; y = +m[3];
        if (m[4] != null) {
          h = +m[4]; mi = +m[5]; s = +(m[6] || 0);
          const ap = (m[7] || '').toUpperCase();
          if (ap === 'PM' && h < 12) h += 12;
          if (ap === 'AM' && h === 12) h = 0;
        }
      } else m = null;
    }
    if (!m) {
      const t = Date.parse(raw);
      if (/^\d{4}-\d{2}-\d{2}/.test(raw) && Number.isFinite(t)) {
        const iso = new Date(t).toISOString();
        return { raw, date: raw.slice(0, 10), time: raw.length > 10 ? iso.slice(11, 16) : '', iso: raw.length > 10 ? iso : raw.slice(0, 10) };
      }
      return out;
    }
    if (!(mo >= 1 && mo <= 12 && d >= 1 && d <= 31)) return out;
    out.date = y + '-' + pad(mo) + '-' + pad(d);
    if (h == null) { out.iso = out.date; return out; }
    out.time = pad(h) + ':' + pad(mi);
    const local = out.date + 'T' + out.time + ':' + pad(s);
    const offset = options && Number.isFinite(options.offsetMinutes) ? options.offsetMinutes : null;
    out.iso = offset == null ? local : local + offsetText(offset);
    return out;
  }
  /* Karar maili TR (+03) ya da BD (+06) saatiyle gelir. Kararın UTC anı mail
     gönderiminden sonra olamaz; en yakın aday seçilir. */
  const KNOWN_OFFSETS = Object.freeze([180, 360]);
  function inferOffsetMinutes(localValue, mailDate) {
    const parsed = parseDate(localValue);
    const mailAt = Date.parse(mailDate || '');
    if (!parsed.time || !Number.isFinite(mailAt)) return null;
    const naive = Date.parse(parsed.date + 'T' + parsed.time + ':00Z');
    let best = null;
    for (const offset of KNOWN_OFFSETS) {
      const utc = naive - offset * 60000;
      const lag = mailAt - utc;
      if (lag < -5 * 60000 || lag > 48 * 3600000) continue;
      if (!best || lag < best.lag) best = { offset, lag };
    }
    return best ? best.offset : null;
  }
  function regionOffset(lab) {
    const key = fold(lab);
    if (/BANGLADESH|\bBD\b/.test(key)) return 360;
    if (/TURK|ISTANBUL|LABORATUVARI|\bTR\b/.test(key)) return 180;
    return null;
  }

  /* ------------------------------------------------------ alan sözlüğü */
  const FIELD_LABELS = Object.freeze({
    'TEST TALEP NO': 'talepNo', 'TALEP NO': 'talepNo', 'REQUEST NO': 'talepNo',
    'SIPARIS KODU': 'siparisKodu', 'SIPARIS NO': 'siparisKodu', 'ORDER NO': 'siparisKodu', 'ORDER NUMBER': 'siparisKodu',
    'TALEP TIPI': 'talepTipi', 'REQUEST TYPE': 'talepTipi',
    'RAPOR TARIHI': 'raporTarihi', 'REPORT DATE': 'raporTarihi',
    'GENEL DEGERLENDIRME': 'genelSonuc', 'GENERAL EVALUATION': 'genelSonuc', 'TEST REQUEST RESULT': 'genelSonuc',
    'MODEL': 'modelAdi', 'MODEL ADI': 'modelAdi', 'STYLE NAME': 'modelAdi',
    'MODEL KODU': 'modelKodu', 'STYLE CODE': 'modelKodu',
    'RENK': 'renk', 'COLOR': 'renk', 'COLOUR': 'renk', 'VARYANT RENGI': 'renk', 'SAMPLE COLOR': 'renk',
    'URUN KLASMAN': 'urunKlasman', 'PRODUCT CLASSIFICATION': 'urunKlasman',
    'TEDARIKCI': 'tedarikci', 'SUPPLIER': 'tedarikci', 'URETICI': 'uretici', 'MANUFACTURER': 'uretici',
    'RETEST REQUEST NO': 'retestOf', 'TEKRAR TEST TALEP NO': 'retestOf', 'RETEST TALEP NO': 'retestOf', 'TEKRAR TALEP NO': 'retestOf',
  });
  function fieldForLabel(label) {
    const key = fold(firstPart(String(label || '').replace(/[:\s]+$/, ''))).replace(/\s*\?$/, '');
    return FIELD_LABELS[key] || '';
  }

  function emptyReport() {
    return {
      talepNo: '', talepTipi: '', lab: '', retestOf: '', siparisKodu: '', modelAdi: '', modelKodu: '', renk: '',
      genelSonuc: '', raporTarihi: '', raporTarihiIso: '',
      bilesenler: [], testler: [], kararlar: [], dosyalar: [],
      kaynak: '', kaynaklar: [], uyarilar: [],
    };
  }
  function assignField(report, field, value) {
    const v = text(value);
    if (!field || !v) return;
    if (field === 'talepNo' || field === 'retestOf') { const t = normalizeTalepNo(v); if (t) report[field] = t; return; }
    if (field === 'urunKlasman' || field === 'tedarikci' || field === 'uretici') { report.ekBilgi = report.ekBilgi || {}; report.ekBilgi[field] = v; return; }
    if (!report[field]) report[field] = v;
  }

  /* ---------------------------------------------------- mail ayrıştırma */
  function bodyLines(body) { return String(body == null ? '' : body).replace(/\r/g, '').split('\n'); }

  /* B — Labright sonuç maili: sekmeyle ayrılmış alan/değer çiftleri. */
  function parseTabPairs(body, report) {
    for (const line of bodyLines(body)) {
      if (line.indexOf('\t') < 0) continue;
      const cells = line.split('\t').map(text).filter(cell => cell && cell !== ':');
      for (let i = 0; i + 1 < cells.length; i += 2) assignField(report, fieldForLabel(cells[i]), cells[i + 1]);
    }
  }
  /* A — tedarikçi lab maili: "Etiket / Label : değer" satırları. */
  function parseColonPairs(body, report) {
    for (const rawLine of bodyLines(body)) {
      // Gerçek örnek: "Sipariş Kodu / Order No\t :\t 1374861\t" — sekmeler boşluk sayılır.
      const line = rawLine.replace(/\t/g, ' ');
      const m = line.match(/^\s*([^:]{2,80}?)\s*:\s*(.+?)\s*$/);
      if (m) assignField(report, fieldForLabel(m[1]), m[2]);
    }
  }

  function classifyMail(mail) {
    const subject = fold(mail && mail.subject);
    const from = fold(mail && mail.from);
    const body = fold(mail && mail.body);
    if (/TICARI KARARLAR/.test(subject) || (/TEST TALEP NO/.test(body) && /KARAR TARIHI/.test(body))) return 'C';
    // A ve B gövdesi aynı "Test Talep Bilgileri" başlığını taşır; konu/gönderen önce gelir.
    if (/NUMARALI TALEP SONUC RAPORU/.test(subject) || /SUPPLIERLABUSER/.test(from)) return 'A';
    if (/\[(RESULT REPORT|SONUC RAPORU)\]/.test(subject) || /LABRIGHT/.test(from)) return 'B';
    if (/TEST TALEP BILGILERI/.test(body)) return /\t\s*:\s*\t|^[^\t\n]+:\s*\S/m.test(String(mail && mail.body || '')) ? 'A' : 'B';
    return '';
  }

  function parseSupplierLabMail(mail) {
    const report = emptyReport();
    const subject = text(mail.subject);
    const fs = fold(subject);
    const t = fs.match(/(\d{5,8})\s+NUMARALI TALEP SONUC RAPORU/);
    parseColonPairs(mail.body, report);
    if (!report.talepNo && t) report.talepNo = t[1];
    const g = fs.match(/GENEL DEGERLENDIRME\s*:\s*([^;]+)/);
    if (!report.genelSonuc && g) report.genelSonuc = text(subject.substr(fs.indexOf(g[1]), g[1].length)) || g[1];
    const md = fs.match(/MODEL ADI\s*:\s*([^;]+)/);
    if (!report.modelAdi && md) report.modelAdi = text(subject.substr(fs.indexOf(md[1]), md[1].length)) || md[1];
    report.lab = report.ekBilgi && report.ekBilgi.tedarikci ? report.ekBilgi.tedarikci : 'supplier-lab';
    report.kaynak = 'parser:A';
    report.raporTarihiIso = parseDate(report.raporTarihi, { offsetMinutes: inferOffsetMinutes(report.raporTarihi, mail.date) }).iso;
    return report;
  }

  function parseLabrightResultMail(mail) {
    const report = emptyReport();
    const fs = fold(mail.subject);
    parseTabPairs(mail.body, report);
    if (!report.talepNo) { const t = fs.match(/TALEP NO(?:\s*\/\s*REQUEST NO)?\s*:\s*(\d{5,8})/); if (t) report.talepNo = t[1]; }
    if (!report.siparisKodu) { const o = fs.match(/SIPARIS NO\s*:\s*(\d{5,9})/); if (o) report.siparisKodu = o[1]; }
    const region = fs.match(/\[(TR|BD)\]/);
    report.lab = region ? 'Labright ' + region[1] : 'Labright';
    report.kaynak = 'parser:B';
    report.raporTarihiIso = parseDate(report.raporTarihi, { offsetMinutes: inferOffsetMinutes(report.raporTarihi, mail.date) }).iso;
    return report;
  }

  const DECISION_COLUMNS = Object.freeze({
    'TALEP TIPI': 'talepTipi', 'SIPARIS NO': 'siparisKodu', 'MODEL ADI': 'modelAdi', 'RENK': 'renk',
    'TEST TALEP NO': 'talepNo', 'TEST ADI': 'test', 'KARAR VEREN': 'kararVeren', 'ISLEM YAPAN': 'islemYapan',
    'KARAR TARIHI': 'tarih', 'KARAR': 'karar', 'ACIKLAMA': 'aciklama',
  });
  /* C — ticari karar maili: sekmeli tablo, her test ayrı satır. */
  function parseDecisionMail(mail) {
    const report = emptyReport();
    const lines = bodyLines(mail.body);
    let header = null;
    const rows = [];
    for (const line of lines) {
      if (line.indexOf('\t') < 0) continue;
      const cells = line.split('\t').map(text);
      if (!header) {
        const mapped = cells.map(cell => DECISION_COLUMNS[fold(cell)] || '');
        if (mapped.includes('talepNo') && mapped.includes('karar')) header = mapped;
        continue;
      }
      const row = {};
      header.forEach((field, index) => { if (field) row[field] = cells[index] || ''; });
      if (normalizeTalepNo(row.talepNo)) rows.push(row);
    }
    const fs = fold(mail.subject);
    const sm = fs.match(/^(.*?)\s+TEDARIKCISI TARAFINDAN URETILEN\s+(\d+)\s+SIPARIS NUMARALI\s+(.+?)\s+MODELINDEKI\s+(\d{5,8})\s+NUMARALI TEST TALEBINE/);
    for (const row of rows) {
      for (const field of ['talepNo', 'talepTipi', 'siparisKodu', 'modelAdi', 'renk']) assignField(report, field, row[field]);
      const offset = inferOffsetMinutes(row.tarih, mail.date);
      const date = parseDate(row.tarih, { offsetMinutes: offset });
      report.kararlar.push({
        talepNo: normalizeTalepNo(row.talepNo),
        test: text(row.test), karar: text(row.karar), aciklama: text(row.aciklama),
        kararVeren: text(row.kararVeren), islemYapan: text(row.islemYapan),
        tarih: text(row.tarih), tarihIso: date.iso,
        saatDilimi: offset == null ? '' : offsetText(offset),
      });
    }
    if (sm) {
      if (!report.siparisKodu) report.siparisKodu = sm[2];
      if (!report.modelAdi) report.modelAdi = sm[3];
      if (!report.talepNo) report.talepNo = sm[4];
      report.ekBilgi = report.ekBilgi || {};
      if (sm[1]) report.ekBilgi.tedarikci = text(mail.subject).slice(0, sm[1].length).trim();
    }
    report.lab = 'Labright';
    report.kaynak = 'parser:C';
    if (!report.kararlar.length) report.uyarilar.push({ code: 'decisionTableEmpty' });
    return report;
  }

  function parseMail(mail) {
    const format = classifyMail(mail);
    let report = null;
    if (format === 'A') report = parseSupplierLabMail(mail);
    else if (format === 'B') report = parseLabrightResultMail(mail);
    else if (format === 'C') report = parseDecisionMail(mail);
    if (!report) return { format: '', report: null };
    finalizeReport(report);
    return { format, report };
  }

  /* ----------------------------------------------------- PDF ayrıştırma */
  /* Öğeler: [{ p: sayfa, x, y, s: metin }]. y PDF koordinatıdır (yukarı artar). */
  function cleanItems(items) {
    return (Array.isArray(items) ? items : [])
      .map(item => ({ p: Number(item.p) || 1, x: Number(item.x) || 0, y: Number(item.y) || 0, w: Number(item.w) || 0, s: text(item.s) }))
      .filter(item => item.s);
  }
  function readingOrder(a, b) { return a.p - b.p || b.y - a.y || a.x - b.x; }
  function isLabelItem(item) { return Boolean(fieldForLabel(item.s)) || /^(Belirsizlik|Uygulama Yeri|Sonu. A..klamas.)/i.test(item.s); }
  // Etiketin sağındaki ilk değer (aynı satır). Değer başka bir etiketse boştur.
  function valueRightOf(items, label) {
    let best = null;
    for (const item of items) {
      if (item === label || item.p !== label.p || Math.abs(item.y - label.y) > 3 || item.x <= label.x) continue;
      if (!best || item.x < best.x) best = item;
    }
    if (!best || isLabelItem(best)) return '';
    return best.s;
  }
  function headerFields(items, report) {
    const sorted = items.slice().sort(readingOrder);
    for (const item of sorted) {
      const field = fieldForLabel(item.s);
      if (!field || (field === 'uretici' || field === 'tedarikci')) continue;
      const fieldKey = field === 'urunKlasman' ? '' : field;
      if (!fieldKey) continue;
      // Sadece ilk görülen değer: sonraki sayfa başlıkları tekrarlanır.
      if (report[fieldKey]) continue;
      assignField(report, fieldKey, valueRightOf(items, item));
    }
  }
  function findItem(items, pattern, from) {
    const sorted = items.slice().sort(readingOrder);
    const start = from ? sorted.indexOf(from) + 1 : 0;
    for (let i = Math.max(0, start); i < sorted.length; i += 1) if (pattern.test(fold(sorted[i].s))) return sorted[i];
    return null;
  }
  function after(item, ref) { return item.p > ref.p || (item.p === ref.p && item.y < ref.y); }
  function before(item, ref) { return item.p < ref.p || (item.p === ref.p && item.y > ref.y); }

  function classifyPdf(items) {
    const all = fold(items.map(item => item.s).join(' '));
    if (/EVALUATION SUMMARY|DEGERLENDIRME OZETI/.test(all)) return 'labright';
    if (/TEST SONUC RAPORU|TEST RESULT REPORT/.test(all) && /TALEP NO|REQUEST NO/.test(all) && /UYGULAMA YERI|APPLIED PLACE/.test(all)) return 'A';
    if (/TEST TALEP BILGILERI|TICARI KARARLAR|NUMARALI TALEP SONUC RAPORU|TEST REQUEST INFORMATIONS/.test(all)) return 'mail';
    return '';
  }

  /* Labright formu (B eki ve D): DEĞERLENDİRME ÖZETİ tablosu. Test adı sol
     sütunda çok satırlı, test sonucu orta sütunda; her ad parçası aynı
     sayfadaki en yakın sonuca bağlanır. */
  function labrightTests(items) {
    const start = findItem(items, /^(EVALUATION SUMMARY|DEGERLENDIRME OZETI)$/);
    if (!start) return [];
    const end = findItem(items, /^(COMPONENT LIST|BILESEN LISTESI|TEST RESULTS|TEST SONUCLARI)$/, start);
    const pageTop = {};
    for (const item of items) {
      if (/^(REQUEST TYPE|TALEP TIPI)$/.test(fold(item.s))) pageTop[item.p] = Math.min(pageTop[item.p] == null ? Infinity : pageTop[item.p], item.y);
    }
    const inRegion = item => after(item, start) && (!end || before(item, end))
      && item.y > 90 && !(pageTop[item.p] != null && item.y >= pageTop[item.p] - 12)
      && !(item.p === start.p && item.y >= start.y - 22);
    const region = items.filter(inRegion);
    const results = region.filter(item => item.x >= 250 && item.x <= 330 && normalizeResult(item.s));
    const tests = new Map();
    const order = [];
    const nearest = item => {
      let best = null;
      for (const r of results) {
        if (r.p !== item.p) continue;
        const d = Math.abs(r.y - item.y);
        if (!best || d < best.d) best = { r, d };
      }
      return best;
    };
    const parts = new Map(results.map(r => [r, { names: [], components: [] }]));
    for (const item of region) {
      if (item.x < 140) {
        const hit = nearest(item);
        if (hit && hit.d <= 30) parts.get(hit.r).names.push(item);
      } else if (item.x >= 330 && item.x < 375 && /^C\d+/i.test(item.s)) {
        const hit = nearest(item);
        if (hit) parts.get(hit.r).components.push(item.s.match(/^C\d+/i)[0].toUpperCase());
      }
    }
    for (const r of results.slice().sort(readingOrder)) {
      const part = parts.get(r);
      const name = part.names.sort((a, b) => b.y - a.y || a.x - b.x).map(item => item.s).join(' ').replace(/\s+/g, ' ').trim();
      if (!name) continue;
      const key = fold(name);
      if (!tests.has(key)) { tests.set(key, { ad: name, bilesen: '', sonuc: r.s }); order.push(key); }
      const test = tests.get(key);
      const comps = new Set(test.bilesen ? test.bilesen.split(', ') : []);
      part.components.forEach(c => comps.add(c));
      test.bilesen = [...comps].join(', ');
      // Aynı test sayfa sonunda bölünmüşse kötü sonuç korunur.
      if (normalizeResult(r.s) === 'fail') test.sonuc = r.s;
    }
    return order.map(key => tests.get(key));
  }

  /* A formatı: her test "Uygulama Yeri:" satırıyla başlar; sonuç bir alt
     satırda sağ uçtadır. */
  function supplierLabTests(items) {
    const tests = [];
    const anchors = items.filter(item => /^UYGULAMA YERI\s*:|^APPLIED PLACE\s*:/.test(fold(item.s))).sort(readingOrder);
    for (const anchor of anchors) {
      const name = items.filter(item => item.p === anchor.p && Math.abs(item.y - anchor.y) <= 3 && item.x < anchor.x)
        .sort((a, b) => a.x - b.x).map(item => item.s).join(' ');
      if (!name) continue;
      let result = null;
      for (const item of items) {
        if (item.p !== anchor.p || item.x < 500 || item.y >= anchor.y || item.y < anchor.y - 70 || !normalizeResult(item.s)) continue;
        if (!result || item.y > result.y) result = item;
      }
      let comp = null;
      for (const item of items) {
        if (item.p !== anchor.p || item.x > 120 || item.y >= anchor.y || item.y < anchor.y - 90 || !/^C\d+$/i.test(item.s)) continue;
        if (!comp || item.y > comp.y) comp = item;
      }
      tests.push({ ad: name, bilesen: comp ? comp.s.toUpperCase() : '', sonuc: result ? result.s : '' });
    }
    return tests;
  }

  const COMPONENT_HEADERS = Object.freeze({
    'BILESEN NO': 'no', 'GRUBU': 'grup', 'GROUP': 'grup', 'KODU': 'kod', 'CODE': 'kod',
    'ADI (RENGI)': 'ad', 'NAME (COLOR)': 'ad', 'BILESEN RENK': 'renk', 'COMPONENT COLOR': 'renk',
  });
  /* BİLEŞEN LİSTESİ: sütunlar başlık x konumuna göre atanır. Bileşen rengi
     (R9J EKRU) burada kalır; varyant rengi değildir. */
  function components(items) {
    const start = findItem(items, /^(BILESEN LISTESI|COMPONENT LIST)$/);
    if (!start) return [];
    const headers = items.filter(item => item.p === start.p && item.y < start.y && item.y >= start.y - 20 && COMPONENT_HEADERS[fold(item.s)]);
    const rows = items.filter(item => item.p === start.p && item.y < start.y - 8 && item.x < 60 && /^C\d+$/i.test(item.s));
    const out = new Map();
    for (const row of rows.sort(readingOrder)) {
      const no = row.s.toUpperCase();
      if (out.has(no)) continue;
      const record = { no, grup: '', kod: '', ad: '', renk: '' };
      const cells = items.filter(item => item !== row && item.p === row.p && Math.abs(item.y - row.y) <= 9 && item.x > row.x + 10).sort((a, b) => b.y - a.y || a.x - b.x);
      for (const cell of cells) {
        // Hücre ve başlık ORTA noktaları karşılaştırılır: çok satırlı adlar ortalanır.
        const center = cell.x + (cell.w || 0) / 2;
        let column = null;
        for (const header of headers) {
          const d = Math.abs(header.x + (header.w || 0) / 2 - center);
          if (!column || d < column.d) column = { header, d };
        }
        column = column ? column.header : null;
        const field = column ? COMPONENT_HEADERS[fold(column.s)] : '';
        if (!field || field === 'no') continue;
        record[field] = text((record[field] ? record[field] + ' ' : '') + cell.s);
      }
      out.set(no, record);
    }
    return [...out.values()];
  }
  function labName(items) {
    const top = items.filter(item => item.p === 1).sort((a, b) => b.y - a.y)[0];
    return top ? top.s : '';
  }
  /* Mailin PDF çıktısı: satırlar sekmeyle birleştirilip mail ayrıştırıcısına
     verilir. */
  function linesFromItems(items) {
    const rows = [];
    for (const item of items.slice().sort(readingOrder)) {
      const row = rows.length ? rows[rows.length - 1] : null;
      if (row && row.p === item.p && Math.abs(row.y - item.y) <= 2) row.items.push(item);
      else rows.push({ p: item.p, y: item.y, items: [item] });
    }
    return rows.map(row => row.items.sort((a, b) => a.x - b.x).map(item => item.s).join('\t')).join('\n');
  }

  function parsePdfItems(rawItems, meta) {
    const items = cleanItems(rawItems);
    if (!items.length) return { format: '', report: null, noText: true };
    const format = classifyPdf(items);
    if (format === 'mail') {
      const body = linesFromItems(items);
      const parsed = parseMail({ subject: body, body, from: '', date: meta && meta.date });
      if (parsed.report) parsed.report.uyarilar.push({ code: 'mailPdf' });
      return { format: parsed.format ? 'mail:' + parsed.format : '', report: parsed.report };
    }
    if (!format) return { format: '', report: null };
    const report = emptyReport();
    headerFields(items, report);
    report.lab = labName(items);
    report.testler = format === 'labright' ? labrightTests(items) : supplierLabTests(items);
    report.bilesenler = components(items);
    report.kaynak = format === 'labright' ? 'parser:D' : 'parser:A';
    const offset = format === 'labright' ? regionOffset(report.lab) : null;
    finalizeReport(report, offset);
    return { format, report };
  }

  function finalizeReport(report, offsetMinutes) {
    report.talepNo = normalizeTalepNo(report.talepNo);
    if (report.raporTarihi && !report.raporTarihiIso) {
      const offset = offsetMinutes != null ? offsetMinutes : regionOffset(report.lab);
      report.raporTarihiIso = parseDate(report.raporTarihi, { offsetMinutes: offset }).iso;
    }
    if (!report.talepNo) report.uyarilar.push({ code: 'missingTalepNo' });
    if (report.kaynak && !report.kaynaklar.includes(report.kaynak)) report.kaynaklar.push(report.kaynak);
    return report;
  }

  /* -------------------------------------------------------- birleştirme */
  const CONFLICT_FIELDS = Object.freeze(['siparisKodu', 'modelAdi', 'modelKodu', 'renk', 'genelSonuc', 'talepTipi']);
  function sameValue(field, a, b) {
    if (field === 'siparisKodu') return normalizeOrderCode(a) === normalizeOrderCode(b);
    // Mail konusundaki kısaltılmış ya da ekli yazım çelişki değildir.
    if (field === 'modelAdi') return Boolean(modelMatch(a, b));
    if (field === 'modelKodu') return modelCodeMatch(a, b);
    if (field === 'renk') return colourKey(a) === colourKey(b);
    if (field === 'genelSonuc') return normalizeResult(a) === normalizeResult(b);
    if (field === 'talepTipi') return true; // TR ve EN adlar farklı yazılır; çelişki sayılmaz.
    return fold(a) === fold(b);
  }
  function decisionKey(decision, talepNo) {
    return [normalizeTalepNo(decision.talepNo) || talepNo, fold(decision.test), normalizeResult(decision.karar) || fold(decision.karar), decision.tarihIso || fold(decision.tarih)].join('|');
  }
  function fileKey(file) { return file.hash ? 'h:' + file.hash : 'n:' + fold(file.ad) + ':' + (Number(file.boyut) || 0); }

  /* Aynı talep no'lu parçaları birleştirir. İlk dolu değer kalır; farklı
     değer gelirse sessizce seçilmez, `conflict` uyarısı iki değeri de taşır. */
  function mergeReports(base, incoming) {
    if (!base) return clone(incoming);
    if (!incoming) return clone(base);
    const out = clone(base);
    const add = clone(incoming);
    out.alanKaynak = out.alanKaynak || {};
    for (const field of ['talepTipi', 'lab', 'retestOf', 'siparisKodu', 'modelAdi', 'modelKodu', 'renk', 'genelSonuc', 'raporTarihi', 'raporTarihiIso']) {
      const a = out[field], b = add[field];
      if (!b) continue;
      if (!a) { out[field] = b; continue; }
      // Mailin genel "Labright" etiketi yerine PDF başlığındaki laboratuvar adı.
      if (field === 'lab' && /^(LABRIGHT( TR| BD)?|SUPPLIER-LAB)$/.test(fold(a)) && fold(b) !== fold(a)) { out.lab = b; continue; }
      if (CONFLICT_FIELDS.includes(field) && !sameValue(field, a, b)) {
        const known = out.uyarilar.some(w => w.code === 'conflict' && w.field === field && w.values.some(v => fold(v.value) === fold(b)));
        if (!known) {
          const existing = out.uyarilar.find(w => w.code === 'conflict' && w.field === field);
          const entry = { value: b, source: add.kaynak + (add.kaynakDosya ? ' · ' + add.kaynakDosya : '') };
          if (existing) existing.values.push(entry);
          else out.uyarilar.push({ code: 'conflict', field, values: [{ value: a, source: out.kaynak + (out.kaynakDosya ? ' · ' + out.kaynakDosya : '') }, entry] });
        }
      }
      // Mail konusundaki kısaltılmış model adı yerine daha uzun yazım tercih edilir.
      if (field === 'modelAdi' && modelMatch(a, b) === 'partial' && modelKey(b).length > modelKey(a).length) out[field] = b;
    }
    if (!out.testler.length && add.testler.length) out.testler = add.testler;
    if (!out.bilesenler.length && add.bilesenler.length) out.bilesenler = add.bilesenler;
    const decisions = new Map(out.kararlar.map(d => [decisionKey(d, out.talepNo), d]));
    for (const d of add.kararlar) { const key = decisionKey(d, out.talepNo); if (!decisions.has(key)) decisions.set(key, d); }
    out.kararlar = [...decisions.values()];
    const files = new Map(out.dosyalar.map(f => [fileKey(f), f]));
    for (const f of add.dosyalar) if (!files.has(fileKey(f))) files.set(fileKey(f), f);
    out.dosyalar = [...files.values()];
    for (const source of add.kaynaklar || []) if (!out.kaynaklar.includes(source)) out.kaynaklar.push(source);
    const warningKeys = new Set(out.uyarilar.map(w => JSON.stringify(w)));
    for (const w of add.uyarilar) if (w.code !== 'conflict' && !warningKeys.has(JSON.stringify(w))) out.uyarilar.push(w);
    if (out.talepNo) out.uyarilar = out.uyarilar.filter(w => w.code !== 'missingTalepNo');
    return out;
  }
  function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
  /* Bir bırakma işlemindeki bütün parçaları talep no ile tekilleştirir. */
  function groupReports(reports) {
    const map = new Map();
    const loose = [];
    for (const report of reports || []) {
      if (!report) continue;
      if (!report.talepNo) { loose.push(report); continue; }
      map.set(report.talepNo, mergeReports(map.get(report.talepNo), report));
    }
    return [...map.values()].concat(loose);
  }

  /* --------------------------------------------------- durum türetme */
  /* Karar ↔ test eşleşmesi: tam ad ya da parantez içindeki standart kodu
     ("ISO 105 C06"). Dil farkında ad tutmazsa eşleşmemiş kararlar, kalan
     başarısız testleri toplu kapsar. */
  function standardKey(name) {
    const m = fold(name).match(/\b(ISO|EN|AATCC|ASTM|DIN|BS EN|GB\/T|CPSC)[\s-]*([0-9][0-9A-Z .:/-]*)/);
    return m ? (m[1] + m[2]).replace(/[^A-Z0-9]+/g, '').replace(/(\d{4})$/, '') : '';
  }
  function testsMatch(a, b) {
    if (fold(a) === fold(b)) return true;
    const x = standardKey(a), y = standardKey(b);
    return Boolean(x && y && (x.startsWith(y) || y.startsWith(x)));
  }
  function latestDecisions(report) {
    const byTest = new Map();
    for (const d of report.kararlar || []) {
      const key = fold(d.test) || '*';
      const prev = byTest.get(key);
      if (!prev || String(d.tarihIso || '') >= String(prev.tarihIso || '')) byTest.set(key, d);
    }
    return [...byTest.values()];
  }
  /* Raporun etkin sonucu: 'pass' | 'fail' | 'pending'.
     Ticari onay geçer sayılır (kullanıcı kararı). Tekrar test, Buying dönüşü
     ve numune yetersizliği bekleyen sayılır. */
  function reportOutcome(report) {
    const base = normalizeResult(report.genelSonuc);
    const tests = Array.isArray(report.testler) ? report.testler : [];
    const decisions = latestDecisions(report);
    const tasks = [];
    let pending = base === 'lackOfSample' || base === 'retest' || base === 'awaitingBuying';
    let commercial = false;
    if (tests.some(t => normalizeResult(t.sonuc) === 'lackOfSample')) pending = true;
    let failing = tests.filter(t => normalizeResult(t.sonuc) === 'fail').map(t => t.ad);
    if (!tests.length && (base === 'fail' || !base)) failing = decisions.map(d => d.test);
    const unmatched = decisions.slice();
    const covering = [];
    const uncovered = [];
    for (const name of failing) {
      const index = unmatched.findIndex(d => testsMatch(d.test, name));
      if (index >= 0) covering.push(unmatched.splice(index, 1)[0]);
      else uncovered.push(name);
    }
    // Dil farkı: kalan kararlar kalan başarısız testleri toplu kapsar.
    if (uncovered.length && unmatched.length >= uncovered.length) { covering.push(...unmatched.splice(0, uncovered.length)); uncovered.length = 0; }
    for (const d of covering) {
      const code = normalizeResult(d.karar);
      if (code === 'commercialApproval') commercial = true;
      else if (code === 'retest') pending = true;
      else if (code === 'awaitingBuying') { pending = true; tasks.push({ talepNo: report.talepNo, test: d.test, aciklama: d.aciklama, tarih: d.tarih, tarihIso: d.tarihIso }); }
      else if (code === 'pass') commercial = commercial || false;
      else uncovered.push(d.test);
    }
    // Başarısız test listesi dışında kalan Buying kararları yine görev üretir.
    for (const d of unmatched) if (normalizeResult(d.karar) === 'awaitingBuying') { pending = true; tasks.push({ talepNo: report.talepNo, test: d.test, aciklama: d.aciklama, tarih: d.tarih, tarihIso: d.tarihIso }); }
    let code;
    if (uncovered.length) code = 'fail';
    else if (pending) code = 'pending';
    else if (base === 'pass' || commercial || (base === 'fail' && failing.length && !uncovered.length)) code = 'pass';
    else if (!base && tests.length && tests.every(t => normalizeResult(t.sonuc) === 'pass')) code = 'pass';
    else code = 'pending';
    return { talepNo: report.talepNo, code, commercial, failing: uncovered, tasks };
  }
  function supersededSet(reports) {
    const out = new Set();
    for (const r of reports || []) if (r && r.retestOf && r.retestOf !== r.talepNo) out.add(r.retestOf);
    return out;
  }
  /* Adım durumu bütün ilgili raporlardan: hepsi geçer/ticari onay →
     approved; biri kalır → rejected; aksi hâlde open. Rapor yoksa ''. */
  function deriveStepStatus(reports) {
    const list = (reports || []).filter(Boolean);
    const superseded = supersededSet(list);
    const active = list.filter(r => !superseded.has(r.talepNo));
    const outcomes = active.map(reportOutcome);
    const tasks = outcomes.reduce((all, o) => all.concat(o.tasks), []);
    let state = '';
    if (outcomes.length) {
      if (outcomes.some(o => o.code === 'fail')) state = 'rejected';
      else if (outcomes.some(o => o.code === 'pending')) state = 'open';
      else state = 'approved';
    }
    return { state, outcomes, tasks, superseded: [...superseded] };
  }

  /* ------------------------------------------------------- eşleştirme */
  const DEFAULT_FIELDS = Object.freeze({ orderCode: 'Order Code', model: 'Model Name', colourCode: 'C.Code', colour: 'Colour' });
  function defaultKey(row, fields) {
    return [normalizeOrderCode(row[fields.orderCode]), fold(row[fields.model]), fold(row[fields.colourCode])].join('|');
  }
  function reportColours(report) {
    const out = [report.renk];
    for (const w of report.uyarilar || []) if (w.code === 'conflict' && w.field === 'renk') w.values.forEach(v => out.push(v.value));
    return [...new Set(out.filter(Boolean))];
  }
  /* Eşleşme düzeyi:
       exact     — sipariş + model (tam) + renk tanımı, tek satır
       partial   — tek satır ama model kısmi ya da renk kodla eşleşti
       ambiguous — birden çok satır; kullanıcı seçer
       none      — eşleşme yok (reason: order | model | colour) */
  function matchReport(report, rows, options) {
    const opts = options || {};
    const fields = { ...DEFAULT_FIELDS, ...(opts.fields || {}) };
    const keyOf = typeof opts.keyOf === 'function' ? opts.keyOf : row => defaultKey(row, fields);
    const order = normalizeOrderCode(report.siparisKodu);
    if (!order) return { level: 'none', reason: 'order', candidates: [] };
    const byOrder = (rows || []).filter(row => row && normalizeOrderCode(row[fields.orderCode]) === order);
    if (!byOrder.length) return { level: 'none', reason: 'order', candidates: [] };
    const colours = reportColours(report);
    const scored = byOrder.map(row => {
      const model = modelMatch(report.modelAdi, row[fields.model]);
      let colour = '';
      for (const c of colours) {
        const level = colourMatch(c, row[fields.colour], row[fields.colourCode]);
        if (level === 'exact') { colour = 'exact'; break; }
        if (level) colour = level;
      }
      return { row, key: keyOf(row), model, colour };
    });
    const unique = list => { const seen = new Map(); for (const c of list) if (!seen.has(c.key)) seen.set(c.key, c); return [...seen.values()]; };
    const byModel = unique(scored.filter(c => c.model));
    if (!byModel.length) return { level: 'none', reason: 'model', candidates: unique(scored) };
    const byColour = byModel.filter(c => c.colour);
    if (!byColour.length) return { level: byModel.length === 1 ? 'partial' : 'ambiguous', reason: 'colour', candidates: byModel };
    if (byColour.length > 1) {
      const exact = byColour.filter(c => c.model === 'exact' && c.colour === 'exact');
      if (exact.length === 1) return { level: 'exact', reason: '', candidates: exact };
      return { level: 'ambiguous', reason: 'multiple', candidates: byColour };
    }
    const only = byColour[0];
    const level = only.model === 'exact' && only.colour === 'exact' ? 'exact' : 'partial';
    return { level, reason: level === 'exact' ? '' : (only.model !== 'exact' ? 'modelPartial' : 'colourCode'), candidates: byColour };
  }

  /* ----------------------------------------------------- uyarı metni */
  const FIELD_NAMES = Object.freeze({
    siparisKodu: { tr: 'Sipariş kodu', en: 'Order code' }, modelAdi: { tr: 'Model adı', en: 'Model name' },
    modelKodu: { tr: 'Model kodu', en: 'Model code' }, renk: { tr: 'Renk', en: 'Colour' },
    genelSonuc: { tr: 'Genel değerlendirme', en: 'General evaluation' }, talepTipi: { tr: 'Talep tipi', en: 'Request type' },
  });
  function warningText(warning, lang) {
    const en = lang === 'en';
    const w = warning || {};
    if (w.code === 'conflict') {
      const field = FIELD_NAMES[w.field] ? FIELD_NAMES[w.field][en ? 'en' : 'tr'] : w.field;
      const values = (w.values || []).map(v => '"' + v.value + '" (' + v.source + ')').join(en ? ' vs ' : ' / ');
      return (en ? field + ' differs between sources: ' : field + ' kaynaklar arasında farklı: ') + values;
    }
    if (w.code === 'mailPdf') return en ? 'Read from a PDF printout of the e-mail.' : 'Mailin PDF çıktısından okundu.';
    if (w.code === 'missingTalepNo') return en ? 'No request number found.' : 'Talep no bulunamadı.';
    if (w.code === 'decisionTableEmpty') return en ? 'The decision table could not be read.' : 'Karar tablosu okunamadı.';
    if (w.code === 'noTextLayer') return en ? 'The PDF has no text layer (scanned). LCW AI fallback is not connected yet.' : 'PDF metin katmanı yok (taranmış). LCW AI yedeği henüz bağlı değil.';
    if (w.code === 'unrecognized') return en ? 'Unrecognised format. LCW AI fallback is not connected yet.' : 'Tanınmayan format. LCW AI yedeği henüz bağlı değil.';
    if (w.code === 'decisionAlreadyApplied') return en ? 'This decision was already imported; it will not be applied twice.' : 'Bu karar daha önce aktarıldı; iki kez işlenmez.';
    return text(w.message || w.code);
  }

  return {
    RESULT_CODES, RESULT_LABELS, FIELD_LABELS,
    fold, normalizeResult, resultLabel, normalizeTalepNo, normalizeOrderCode,
    modelKey, modelMatch, modelCodeMatch, colourParts, colourKey, colourMatch, talepTipiKey,
    parseDate, inferOffsetMinutes, regionOffset,
    classifyMail, parseMail, parsePdfItems, linesFromItems,
    emptyReport, mergeReports, groupReports, decisionKey, fileKey,
    reportOutcome, supersededSet, deriveStepStatus, testsMatch,
    matchReport, warningText,
  };
});
