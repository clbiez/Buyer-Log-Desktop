'use strict';

/* Paydaş belgelerini siparişlerle eşleme ve risk değerlendirmesi.

   Üretici/paydaştan gelen karışık Excel, e-posta, PDF veya ekran görüntüsü:
   1) Okuma: Excel/CSV yerelde tabloya, e-posta (EML/MSG) ve metinli PDF yerelde
      metne çevrilir; görseller ve metni olmayan PDF'ler şirket içi LCW AI'a
      dosya olarak gider. LCW AI ('document-order-extract') yalnız satırları
      çıkarır: sipariş kodu, PLM, model, renk, adet, belgedeki ve istenen
      ex-factory, not.
   2) Eşleme: Buyer Log yapar; sahibin görebildiği siparişlerde önce sipariş
      kodu, sonra PLM + renk, sonra model + renk. Birden çok aday varsa satır
      "belirsiz" kalır, uydurma eşleşme yapılmaz.
   3) Risk: CP motorunun kanonik "hedefi kaçırmadan en geç yükleme" tarihi
      (latestSafeLoadDate) ile istenen tarih karşılaştırılır. AI yorum yazar,
      rakamları değiştirmez. */
const { error } = require('./agent-office-store');
// Belge ve AI kaynaklı metin kesilir, asla reddedilmez: tek uzun alan tüm eki düşürmemeli.
const text = (value, max) => String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, max);

const TABLE_FILE = /\.(xlsx|csv)$/i, LEGACY_TABLE = /\.xls$/i, MAIL_FILE = /\.(eml|msg)$/i, PDF_FILE = /\.pdf$/i, IMAGE_FILE = /\.(png|jpe?g|webp)$/i;
const MAX_TABLE_ROWS = 300, MAX_TABLE_COLUMNS = 30, MAX_TEXT = 12000, MAX_AI_FILES = 5, MAX_ROWS = 300, MAX_GUIDE = 38000;
// Dosya başına sınırlar; xlsx açılmadan önce sıkıştırılmamış toplam boyutu denetlenir (zip bombası).
const FILE_LIMITS = { xlsx: 15 * 1048576, csv: 5 * 1048576, mail: 15 * 1048576, pdf: 20 * 1048576, image: 20 * 1048576 };
const MAX_XLSX_UNPACKED = 120 * 1048576, MAX_XLSX_ENTRIES = 4000;
const DAY = 86400000;

const isoOf = ordinal => Number.isFinite(ordinal) ? new Date(ordinal * DAY).toISOString().slice(0, 10) : '';
// Geçersiz gün/ay (ör. ABD biçimli 12/31/2026 veya 2026-02-31) tahmin edilmez: tarih yok sayılır.
function validOrdinal(year, month, day) {
  if (!(month >= 1 && month <= 12 && day >= 1 && day <= 31 && year >= 2000 && year <= 2100)) return null;
  const time = Date.UTC(year, month - 1, day), date = new Date(time);
  return date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? Math.floor(time / DAY) : null;
}
function ordinalOf(value) {
  const raw = String(value || '').trim();
  let match = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (match) return validOrdinal(+match[1], +match[2], +match[3]);
  match = raw.match(/^(\d{1,2})[./](\d{1,2})[./](\d{2,4})$/);
  if (match) return validOrdinal(match[3].length === 2 ? 2000 + Number(match[3]) : Number(match[3]), +match[2], +match[1]);
  return null;
}
function zipUnpackedSize(buffer) {
  for (let offset = buffer.length - 22; offset >= Math.max(0, buffer.length - 65557); offset -= 1) {
    if (buffer.readUInt32LE(offset) !== 0x06054b50) continue;
    const entries = buffer.readUInt16LE(offset + 10), start = buffer.readUInt32LE(offset + 16);
    let position = start, total = 0;
    for (let index = 0; index < entries; index += 1) {
      if (position + 46 > buffer.length || buffer.readUInt32LE(position) !== 0x02014b50) return { entries, total: Infinity };
      total += buffer.readUInt32LE(position + 24);
      position += 46 + buffer.readUInt16LE(position + 28) + buffer.readUInt16LE(position + 30) + buffer.readUInt16LE(position + 32);
    }
    return { entries, total };
  }
  return { entries: 0, total: Infinity };
}
function checkSize(name, buffer) {
  const kind = /\.xlsx$/i.test(name) ? 'xlsx' : /\.csv$/i.test(name) ? 'csv' : MAIL_FILE.test(name) ? 'mail' : PDF_FILE.test(name) ? 'pdf' : 'image';
  if (buffer.length > FILE_LIMITS[kind]) throw error('OFFICE_ATTACHMENT_LIMIT', 413);
  if (kind === 'xlsx') { const zip = zipUnpackedSize(buffer); if (!(zip.total <= MAX_XLSX_UNPACKED) || zip.entries > MAX_XLSX_ENTRIES) throw error('OFFICE_ATTACHMENT_LIMIT', 413); }
}
function pdfLines(items) {
  const lines = new Map();
  for (const item of items) { const key = item.p + ':' + Math.round(item.y / 2); lines.set(key, [...(lines.get(key) || []), item]); }
  return [...lines.entries()].sort((a, b) => { const [pa, ya] = a[0].split(':').map(Number), [pb, yb] = b[0].split(':').map(Number); return pa - pb || yb - ya; })
    .map(([, list]) => list.sort((a, b) => a.x - b.x).map(item => item.s.trim()).filter(Boolean).join(' | ')).filter(Boolean);
}
const digits = value => String(value || '').replace(/\D/g, '');
// Türkçe ve İngilizce yazımlar eşit sayılır (I/ı/İ/i, aksanlar): WHITE = white = whıte.
const norm = value => String(value || '').toLocaleLowerCase('tr-TR').replace(/ı/g, 'i').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

function cellText(value) {
  if (value == null) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') {
    if (value.richText) return value.richText.map(part => part.text).join('');
    if (value.result != null) return cellText(value.result);
    if (value.text != null) return String(value.text);
    return '';
  }
  return String(value);
}

async function readTable(file, buffer) {
  if (/\.csv$/i.test(file.name)) {
    const lines = buffer.toString('utf8').split(/\r?\n/).filter(line => line.trim()).slice(0, MAX_TABLE_ROWS);
    return [{ sheet: file.name, rows: lines.map(line => line.slice(0, 1800)) }];
  }
  const ExcelJS = require('../../public/vendor/exceljs.min.js');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheets = [];
  let budget = MAX_TABLE_ROWS;
  workbook.eachSheet(sheet => {
    if (budget <= 0 || sheet.state === 'hidden' || sheet.state === 'veryHidden') return;
    const rows = [];
    sheet.eachRow({ includeEmpty: false }, row => {
      if (rows.length >= budget) return;
      const cells = [];
      for (let column = 1; column <= Math.min(MAX_TABLE_COLUMNS, row.cellCount); column += 1) cells.push(cellText(row.getCell(column).value).replace(/\s+/g, ' ').trim());
      if (cells.some(Boolean)) rows.push(cells.join(' | ').slice(0, 1800));
    });
    budget -= rows.length;
    if (rows.length) sheets.push({ sheet: text(sheet.name, 80), rows });
  });
  return sheets;
}

/* Dosyaları LCW AI'a gidecek düz metne (tablo/e-posta/PDF) ve gerekiyorsa
   yüklenecek dosyalara (görsel, taranmış PDF) ayırır. Eski .xls okunamaz. */
async function readDocuments(files) {
  const Extract = require('./test-reports/extract');
  const documents = [], uploads = [], skipped = [];
  for (const file of files) {
    const buffer = Buffer.from(String(file.base64 || ''), 'base64');
    if (!buffer.length) throw error('OFFICE_TASK_INVALID', 422);
    const name = text(file.name, 160);
    if (LEGACY_TABLE.test(name)) { skipped.push({ name, reason: 'xls' }); continue; }
    if (!TABLE_FILE.test(name) && !MAIL_FILE.test(name) && !PDF_FILE.test(name) && !IMAGE_FILE.test(name)) throw error('OFFICE_ATTACHMENT_TYPE', 415);
    checkSize(name, buffer);
    if (TABLE_FILE.test(name)) {
      let sheets;
      try { sheets = await readTable(file, buffer); } catch (_) { skipped.push({ name, reason: 'unreadable' }); continue; }
      documents.push({ name, kind: 'table', lines: sheets.flatMap(sheet => [`[${sheet.sheet}]`, ...sheet.rows]) });
      continue;
    }
    if (MAIL_FILE.test(name)) {
      const mail = /\.msg$/i.test(name) ? Extract.readMsg(buffer) : Extract.readEml(buffer);
      // Sekmeler sütun ayırıcıdır; e-posta tabloları kolonlarını korur.
      const body = String(mail.body || mail.text || '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(tr|p|div)>/gi, '\n').replace(/<\/t[dh]>/gi, '\t').replace(/<[^>]+>/g, ' ')
        .replace(/\t/g, ' | ').replace(/[ ]{2,}/g, ' ');
      documents.push({ name, kind: 'mail', from: text(mail.from || mail.senderName || '', 200), subject: text(mail.subject || '', 300), date: text(mail.date || '', 80),
        lines: body.slice(0, MAX_TEXT).split(/\r?\n/).map(line => line.trim()).filter(Boolean),
        attachments: (mail.attachments || []).map(item => text(item.name || item.fileName || '', 160)).filter(Boolean) });
      continue;
    }
    if (PDF_FILE.test(name)) {
      let lines = [];
      try { lines = pdfLines(await Extract.pdfItems(buffer)); } catch (_) {}
      if (lines.join(' ').length > 40) { documents.push({ name, kind: 'pdf', lines }); continue; }
    }
    uploads.push({ buffer, fileName: name }); documents.push({ name, kind: 'attached-file', lines: [] });
  }
  if (uploads.length > MAX_AI_FILES) throw error('OFFICE_ATTACHMENT_LIMIT', 413);
  return { documents, uploads, skipped };
}

/* Belge içeriği LCW AI'a düz metin bölümü olarak gider (bağlam JSON'unun
   derinlik/satır sınırına takılmaz); toplam 38.000 karakteri aşan kısım kesilir
   ve bu açıkça işaretlenir. */
function documentText(documents) {
  let out = '', truncated = false;
  for (const doc of documents) {
    const head = `=== ${doc.name} (${doc.kind})${doc.subject ? ' · ' + doc.subject : ''}${doc.from ? ' · ' + doc.from : ''} ===`;
    for (const line of [head, ...(doc.lines || []), ...(doc.attachments?.length ? ['[attachments: ' + doc.attachments.join(', ') + ']'] : [])]) {
      if (out.length + line.length + 1 > MAX_GUIDE) { truncated = true; break; }
      out += line + '\n';
    }
    if (truncated) break;
  }
  return { text: out, truncated };
}

function parseRows(data) {
  let rows;
  try { rows = JSON.parse(String(data?.rowsJson || '[]')); } catch (_) { throw error('OFFICE_AI_CONTRACT_INVALID', 422); }
  if (!Array.isArray(rows)) throw error('OFFICE_AI_CONTRACT_INVALID', 422);
  return rows.slice(0, MAX_ROWS).filter(row => row && typeof row === 'object').map((row, index) => ({
    line: index + 1, orderCode: text(row.orderCode, 40), plmId: text(row.plmId, 40), model: text(row.model, 120), colourCode: text(row.colourCode, 40), colour: text(row.colour, 80),
    quantity: Number.isFinite(Number(row.quantity)) ? Number(row.quantity) : null, documentExFactory: text(row.currentExFactory, 20), requestedExFactory: text(row.requestedExFactory, 20), note: text(row.note, 300) }));
}

/* Deterministik eşleme: sipariş kodu > PLM + renk > model + renk. */
function matchRow(row, orders, index) {
  const code = digits(row.orderCode);
  if (code && index.byCode.has(code)) return { level: 'order-code', candidates: index.byCode.get(code) };
  const plm = digits(row.plmId), colour = norm(row.colourCode);
  if (plm) {
    const list = (index.byPlm.get(plm) || []).filter(order => !colour || norm(order.colourCode) === colour);
    if (list.length) return { level: 'plm-colour', candidates: list };
  }
  const model = norm(row.model), colourName = norm(row.colour) || colour;
  if (model) {
    const list = orders.filter(order => norm(order.modelName) === model && (!colourName || norm(order.colourCode) === colourName || norm(order.colour) === colourName));
    if (list.length) return { level: 'model-colour', candidates: list };
  }
  return { level: 'none', candidates: [] };
}

/* Kanonik CP tarihleriyle risk: istenen tarih en geç güvenli yüklemeyi aşıyor mu. */
function assess(row, order) {
  const current = order.plannedLoadDate, requested = ordinalOf(row.requestedExFactory), safe = order.latestSafeLoadDate;
  const shiftDays = requested != null && current != null ? requested - current : null;
  const slackDays = requested != null && safe != null ? safe - requested : null;
  const documentCurrent = ordinalOf(row.documentExFactory);
  // Dayanak açıkça taşınır: kanonik en geç güvenli yükleme yoksa (ör. yol süresi
  // kuralı tanımsız) risk yalnız kayma gününe göredir ve böyle gösterilir.
  let risk = 'unknown', basis = '';
  if (slackDays != null) { basis = 'safe-load'; risk = slackDays < 0 ? 'high' : slackDays < 7 ? 'medium' : 'low'; }
  else if (shiftDays != null) { basis = 'shift'; risk = shiftDays > 14 ? 'high' : shiftDays > 7 ? 'medium' : 'low'; }
  return { orderCode: order.orderCode, model: order.modelName, colour: order.colourCode, quantity: order.quantity,
    currentExFactory: isoOf(current), requestedExFactory: isoOf(requested) || row.requestedExFactory, latestSafeLoad: isoOf(safe),
    shiftDays, slackDays, risk, basis, target: order.targetType || '', targetDate: isoOf(order.targetDate),
    documentDiffers: documentCurrent != null && current != null && documentCurrent !== current };
}

function evaluate(rows, orders) {
  const index = { byCode: new Map(), byPlm: new Map() };
  for (const order of orders) {
    const code = digits(order.orderCode); if (code) index.byCode.set(code, [...(index.byCode.get(code) || []), order]);
    const plm = digits(order.plmId); if (plm) index.byPlm.set(plm, [...(index.byPlm.get(plm) || []), order]);
  }
  const results = rows.map(row => {
    const match = matchRow(row, orders, index);
    if (match.candidates.length === 1) return { line: row.line, match: match.level, note: row.note, ...assess(row, match.candidates[0]) };
    return { line: row.line, match: match.candidates.length > 1 ? 'ambiguous' : 'none', candidates: match.candidates.slice(0, 3).map(order => order.orderCode),
      orderCode: row.orderCode, model: row.model, colour: row.colourCode || row.colour, requestedExFactory: row.requestedExFactory, note: row.note, risk: 'unmatched' };
  });
  const count = key => results.filter(item => item.risk === key).length;
  return { rows: results, totals: { rows: results.length, matched: results.filter(item => !['none', 'ambiguous'].includes(item.match)).length,
    ambiguous: results.filter(item => item.match === 'ambiguous').length, unmatched: count('unmatched') - results.filter(item => item.match === 'ambiguous').length,
    high: count('high'), medium: count('medium'), low: count('low'), unknown: count('unknown') } };
}

/* Sohbet bağlamı için kısa, sınırlı metin: her satır tek satır. */
function compactSummary(result) {
  const lines = result.rows.slice(0, 40).map(item => [item.line, item.orderCode || '-', item.model || '-', item.colour || '-', `${item.currentExFactory || '?'}→${item.requestedExFactory || '?'}`,
    item.shiftDays == null ? '' : `${item.shiftDays > 0 ? '+' : ''}${item.shiftDays}d`, item.latestSafeLoad ? `safe ${item.latestSafeLoad}` : 'no-safe-load', item.risk, item.match, item.basis || ''].join('|'));
  // Sınırlı kanıt: 4 katılımcılı ekip sohbetinde de paylaşılan bağlama sığar.
  return lines.join('\n').slice(0, 3500);
}

async function analyzeDocuments(profile, files, { engine, orders, lang = 'tr', signal, request = '' } = {}) {
  if (!engine) throw error('OFFICE_AI_FAILED', 503);
  const { documents, uploads, skipped } = await readDocuments(files);
  const fileNames = files.map(file => text(file.name, 160));
  if (!documents.length) return { kind: 'document-orders', docKind: 'other', files: fileNames, skipped, totals: { rows: 0, matched: 0, ambiguous: 0, unmatched: 0, high: 0, medium: 0, low: 0, unknown: 0 }, rows: [], compact: '' };
  const content = documentText(documents);
  const task = (lang === 'en' ? 'Extract the order rows and what the sender asks for.' : 'Sipariş satırlarını ve gönderenin ne istediğini çıkar.') + (request ? (lang === 'en' ? ' Owner\'s note: ' : ' Sahibin notu: ') + text(request, 600) : '');
  const input = { requestId: require('crypto').randomUUID(), source: 'document-order-extract', lang: lang === 'en' ? 'en' : 'tr', signal, task, guide: content.text,
    context: { documents: documents.map(doc => ({ name: doc.name, kind: doc.kind })), truncated: content.truncated } };
  const response = uploads.length ? await engine.askWithFiles(profile.id, { ...input, files: uploads }) : await engine.ask(profile.id, input);
  if (!response?.structured?.ok || !response.data) throw error('OFFICE_AI_CONTRACT_INVALID', 422);
  const rows = parseRows(response.data), result = evaluate(rows, await orders(profile));
  return { kind: 'document-orders', docKind: text(response.data.kind, 40), sender: text(response.data.sender, 200), request: text(response.data.request, 600),
    summary: text(response.data.summary, 1500), files: fileNames, skipped, truncated: content.truncated, totals: result.totals, rows: result.rows.slice(0, 60), compact: compactSummary(result) };
}

module.exports = { analyzeDocuments, evaluate, parseRows, ordinalOf, isoOf, readDocuments, compactSummary, documentText, zipUnpackedSize };
