'use strict';
/* Test raporu dosya okuyucu: .msg (msgreader), .eml (yerleşik MIME okuyucu)
   ve .pdf (vendored pdf.js metin katmanı). Ayrıştırma kuralları
   public/test-report-engine.js içindedir; burada yalnız dosya → metin/öğe
   dönüşümü ve parçaların birleştirilmesi yapılır. */

const path = require('path');
const crypto = require('crypto');
const Engine = require('../../../public/test-report-engine.js');

const PUBLIC_VENDOR = path.join(__dirname, '..', '..', '..', 'public', 'vendor');
const MAX_PDF_PAGES = 60;

let pdfjs = null;
function pdfLib() {
  if (pdfjs) return pdfjs;
  // pdf.js Node'da canvas polyfill uyarısı basar; metin çıkarmak için gereksiz.
  const log = console.log, warn = console.warn;
  console.log = () => {}; console.warn = () => {};
  try { pdfjs = require(path.join(PUBLIC_VENDOR, 'pdf.min.js')); }
  finally { console.log = log; console.warn = warn; }
  pdfjs.GlobalWorkerOptions.workerSrc = path.join(PUBLIC_VENDOR, 'pdf.worker.min.js');
  return pdfjs;
}

function sha256(buffer) { return crypto.createHash('sha256').update(buffer).digest('hex'); }

function detectKind(buffer, name) {
  const head = buffer.subarray(0, 8);
  if (head.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf';
  if (head.equals(Buffer.from([0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]))) return 'msg';
  if (head.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4E, 0x47]))) return 'image';
  if (head[0] === 0xFF && head[1] === 0xD8 && head[2] === 0xFF) return 'image';
  if (head.subarray(0, 4).toString('latin1') === 'RIFF' && buffer.subarray(8, 12).toString('latin1') === 'WEBP') return 'image';
  const ext = path.extname(String(name || '')).toLowerCase();
  if (ext === '.eml' || /^(received|from|date|subject|mime-version|return-path|message-id|to|x-[a-z-]+):/im.test(buffer.subarray(0, 4096).toString('latin1'))) return 'eml';
  return '';
}

/* ---------------------------------------------------------------- PDF */
async function pdfItems(buffer) {
  const lib = pdfLib();
  // isEvalSupported:false — font yolu kod çalıştırmaz (CVE-2024-4367 sınıfı).
  const doc = await lib.getDocument({
    data: new Uint8Array(buffer), isEvalSupported: false, disableFontFace: true,
    useSystemFonts: false, verbosity: 0, stopAtErrors: false,
  }).promise;
  const items = [];
  items.pageCount = doc.numPages;
  items.readPages = [];
  try {
    const pages = Math.min(doc.numPages, MAX_PDF_PAGES);
    for (let p = 1; p <= pages; p += 1) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      items.readPages.push(p);
      for (const item of content.items) {
        if (!item || typeof item.str !== 'string' || !item.str.trim()) continue;
        items.push({ p, x: Math.round(item.transform[4]), y: Math.round(item.transform[5]), w: Math.round(item.width || 0), s: item.str });
      }
      page.cleanup();
    }
  } finally {
    await doc.destroy();
  }
  return items;
}

/* ---------------------------------------------------------------- MSG */
function readMsg(buffer) {
  const MsgReader = require('@kenjiuno/msgreader').default;
  const reader = new MsgReader(buffer);
  const data = reader.getFileData();
  if (!data || data.error) throw Object.assign(new Error('MSG file could not be read.'), { code: 'TEST_REPORT_MSG_INVALID' });
  const attachments = [];
  const unreadAttachments = [];
  for (const meta of data.attachments || []) {
    if (meta.innerMsgContent) { unreadAttachments.push(meta.fileName || 'embedded-message.msg'); continue; }
    try {
      const file = reader.getAttachment(meta);
      if (file && file.content) attachments.push({ name: file.fileName || meta.fileName || 'attachment', buffer: Buffer.from(file.content) });
    } catch (_) { unreadAttachments.push(meta.fileName || 'unread-attachment'); }
  }
  return {
    subject: data.subject || '',
    from: [data.senderSmtpAddress, data.senderEmail, data.senderName].filter(Boolean).join(' '),
    to: (data.recipients || []).filter(r => r.recipType !== 2).map(r => r.smtpAddress || r.email || r.name || '').join('; '),
    cc: (data.recipients || []).filter(r => r.recipType === 2).map(r => r.smtpAddress || r.email || r.name || '').join('; '),
    date: data.messageDeliveryTime || data.clientSubmitTime || '',
    body: data.body || '',
    attachments,
    unreadAttachments,
  };
}

/* ---------------------------------------------------------------- EML */
function decodeWords(value) {
  return String(value || '').replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (_, charset, enc, data) => {
    const bytes = /b/i.test(enc) ? Buffer.from(data, 'base64') : Buffer.from(data.replace(/_/g, ' ').replace(/=([0-9A-F]{2})/gi, (m, h) => String.fromCharCode(parseInt(h, 16))), 'latin1');
    return decodeCharset(bytes, charset);
  }).replace(/\?=\s+=\?/g, '');
}
function decodeCharset(bytes, charset) {
  const cs = String(charset || 'utf-8').toLowerCase();
  try { return new TextDecoder(cs === 'windows-1254' || cs === 'iso-8859-9' ? cs : (cs || 'utf-8')).decode(bytes); }
  catch (_) { return bytes.toString('utf8'); }
}
function splitHeaders(raw) {
  const index = raw.search(/\r?\n\r?\n/);
  const headText = index >= 0 ? raw.slice(0, index) : raw;
  const bodyStart = index >= 0 ? index + raw.slice(index).match(/^\r?\n\r?\n/)[0].length : raw.length;
  const headers = {};
  for (const line of headText.replace(/\r?\n[ \t]+/g, ' ').split(/\r?\n/)) {
    const m = line.match(/^([^:]+):\s*(.*)$/);
    if (m) headers[m[1].trim().toLowerCase()] = m[2];
  }
  return { headers, bodyStart };
}
function param(header, name) {
  const m = String(header || '').match(new RegExp(name + '\\*?=(?:"([^"]*)"|([^;\\s]+))', 'i'));
  return m ? (m[1] != null ? m[1] : m[2]) : '';
}
function decodeBody(buffer, encoding) {
  const enc = String(encoding || '').toLowerCase().trim();
  if (enc === 'base64') return Buffer.from(buffer.toString('latin1').replace(/\s+/g, ''), 'base64');
  if (enc === 'quoted-printable') {
    const textValue = buffer.toString('latin1').replace(/=\r?\n/g, '');
    return Buffer.from(textValue.replace(/=([0-9A-F]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16))), 'latin1');
  }
  return buffer;
}
function htmlToText(html) {
  return String(html)
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, '')
    .replace(/<\/(td|th)>/gi, '\t').replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}
function walkMime(buffer, out, depth) {
  if (depth > 8) { out.incomplete = true; return; }
  const raw = buffer.toString('latin1');
  const { headers, bodyStart } = splitHeaders(raw);
  const type = String(headers['content-type'] || 'text/plain').toLowerCase();
  const body = buffer.subarray(Buffer.byteLength(raw.slice(0, bodyStart), 'latin1'));
  if (type.startsWith('multipart/')) {
    const boundary = param(headers['content-type'], 'boundary');
    if (!boundary) { out.incomplete = true; return; }
    const parts = body.toString('latin1').split('--' + boundary);
    for (const part of parts.slice(1)) {
      if (part.startsWith('--')) break;
      walkMime(Buffer.from(part.replace(/^\r?\n/, ''), 'latin1'), out, depth + 1);
    }
    return;
  }
  const decoded = decodeBody(body, headers['content-transfer-encoding']);
  const disposition = headers['content-disposition'] || '';
  const filename = decodeWords(param(disposition, 'filename') || param(headers['content-type'], 'name'));
  if (filename || /attachment/i.test(disposition) || type === 'application/pdf') {
    out.attachments.push({ name: filename || 'attachment.pdf', buffer: decoded });
    return;
  }
  const charset = param(headers['content-type'], 'charset') || 'utf-8';
  if (type.startsWith('text/plain') && !out.plain) out.plain = decodeCharset(decoded, charset);
  else if (type.startsWith('text/html') && !out.html) out.html = htmlToText(decodeCharset(decoded, charset));
}
function readEml(buffer) {
  const raw = buffer.toString('latin1');
  const { headers } = splitHeaders(raw);
  const out = { plain: '', html: '', attachments: [] };
  walkMime(buffer, out, 0);
  return {
    subject: decodeWords(headers.subject || ''),
    from: decodeWords(headers.from || ''),
    to: decodeWords(headers.to || ''), cc: decodeWords(headers.cc || ''), messageId: headers['message-id'] || '',
    date: headers.date || '',
    // Tablolu mailler HTML gövdede sekmeli satır verir; düz metin yedektir.
    body: out.html && /\t/.test(out.html) ? out.html : (out.plain || out.html),
    attachments: out.attachments,
    alternativeBody: out.plain && out.html && out.plain !== out.html ? (out.html && /\t/.test(out.html) ? out.plain : out.html) : '',
    incomplete: out.incomplete === true,
  };
}

/* ------------------------------------------------------------ birleşik */
function fileEntry(name, buffer, kind, stage) {
  const hash = sha256(buffer);
  const entry = { ad: path.basename(String(name || 'file')), tur: kind, boyut: buffer.length, hash };
  if (typeof stage === 'function') entry.stagingId = stage({ name: entry.ad, buffer, hash, kind });
  return entry;
}
function tag(report, fileName) {
  if (report) report.kaynakDosya = fileName;
  return report;
}

async function parsePdfBuffer(buffer, name, meta) {
  let items;
  try { items = await pdfItems(buffer); }
  catch (error) { return { format: '', report: null, error: 'pdf-unreadable', pages: [], complete: false }; }
  const parsed = Engine.parsePdfItems(items, meta);
  if (parsed.report) tag(parsed.report, name);
  const pages = (items.readPages || []).map(page => ({ page, text: Engine.linesFromItems(items.filter(item => item.p === page)),
    positions: items.filter(item => item.p === page).map(item => ({ x: item.x, y: item.y, w: item.w, text: item.s })) }));
  return { ...parsed, pages, pageCount: items.pageCount, complete: items.pageCount === pages.length && pages.every(page => page.text.trim().length > 30) };
}

/* Bir bırakılan dosyayı okur. Dönüş: { name, kind, status, format, reports,
   warnings }. `stage` ekleri geçici depoya alır ve kimlik döndürür. */
async function processFile(file, options) {
  const opts = options || {};
  const name = path.basename(String(file && file.name || 'file'));
  const buffer = Buffer.isBuffer(file && file.buffer) ? file.buffer : Buffer.from(file && file.buffer || []);
  const kind = detectKind(buffer, name);
  const result = { name, kind, status: 'parsed', format: '', reports: [], warnings: [], sources: [] };
  function source(entry, details) {
    const id = crypto.createHash('sha256').update([entry.hash, entry.ad, details.parentId || ''].join('|')).digest('hex').slice(0, 24);
    const value = { id, name: entry.ad, kind: entry.tur, hash: entry.hash, fileId: entry.stagingId || '', ...details };
    result.sources.push(value); return value;
  }
  try {
    if (kind === 'pdf') {
      const parsed = await parsePdfBuffer(buffer, name);
      const evidence = fileEntry(name, buffer, 'pdf', opts.stage);
      source(evidence, { pages: parsed.pages, pageCount: parsed.pageCount || 0, complete: parsed.complete === true });
      if (parsed.report) {
        parsed.report.dosyalar = [evidence];
        result.format = parsed.format;
        result.reports.push(parsed.report);
      } else {
        result.warnings.push({ code: parsed.noText ? 'noTextLayer' : 'unrecognized' });
        const entry = evidence;
        aiCandidate(result, { upload: entry, evidence: entry });
      }
      return result;
    }
    if (kind === 'image') {
      // Fotoğraf/tarama rapor: deterministik okuma yok, LCW AI okur.
      result.warnings.push({ code: 'unrecognized' });
      const entry = fileEntry(name, buffer, 'image', opts.stage);
      source(entry, { pages: [{ page: 1, text: '' }], pageCount: 1, complete: false });
      aiCandidate(result, { upload: entry, evidence: entry });
      return result;
    }
    if (kind === 'msg' || kind === 'eml') {
      const mail = kind === 'msg' ? readMsg(buffer) : readEml(buffer);
      const mailEntry = fileEntry(name, buffer, kind, opts.stage);
      const mailSource = source(mailEntry, { pages: [{ page: 0, text: ['Subject: ' + mail.subject, 'From: ' + mail.from, 'To: ' + (mail.to || ''), 'Cc: ' + (mail.cc || ''), 'Date: ' + mail.date, 'Message-ID: ' + (mail.messageId || ''), '', mail.body, mail.alternativeBody ? '\n=== Alternative MIME body ===\n' + mail.alternativeBody : ''].join('\n') }], pageCount: 1, complete: Boolean(mail.body && mail.body.trim()) && !mail.incomplete,
        attachments: mail.attachments.map(attachment => ({ name: attachment.name, kind: detectKind(attachment.buffer, attachment.name), hash: sha256(attachment.buffer) })) });
      for (const missing of mail.unreadAttachments || []) {
        result.sources.push({ id: crypto.createHash('sha256').update(mailSource.id + missing).digest('hex').slice(0, 24), parentId: mailSource.id, name: missing, kind: 'unsupported', pages: [], pageCount: 0, complete: false });
      }
      const parsed = Engine.parseMail(mail);
      let report = parsed.report ? tag(parsed.report, name) : null;
      result.format = parsed.format;
      const pdfs = mail.attachments.filter(a => detectKind(a.buffer, a.name) === 'pdf');
      for (const attachment of pdfs) {
        const sub = await parsePdfBuffer(attachment.buffer, attachment.name, { date: mail.date });
        const entry = fileEntry(attachment.name, attachment.buffer, 'pdf', opts.stage);
        source(entry, { parentId: mailSource.id, pages: sub.pages, pageCount: sub.pageCount || 0, complete: sub.complete === true });
        if (sub.report && (!report || !sub.report.talepNo || !report.talepNo || sub.report.talepNo === report.talepNo)) {
          sub.report.dosyalar = [entry];
          report = report ? Engine.mergeReports(report, sub.report) : sub.report;
        } else if (sub.report) {
          // Ek başka bir talebe aitse ayrı rapor olarak sunulur.
          sub.report.dosyalar = [entry];
          result.reports.push(sub.report);
        } else if (report) {
          report.dosyalar.push(entry);
        }
      }
      if (report) {
        // Ekli PDF yoksa (karar maili) kanıt olarak mailin kendisi eklenir.
        if (!pdfs.length) report.dosyalar.push(fileEntry(name, buffer, kind, opts.stage));
        result.reports.unshift(report);
        if (!result.format) result.format = 'pdf-in-mail';
      } else {
        result.warnings.push({ code: 'unrecognized' });
        const evidence = fileEntry(name, buffer, kind, opts.stage);
        const firstPdf = pdfs[0] ? fileEntry(pdfs[0].name, pdfs[0].buffer, 'pdf', opts.stage) : null;
        const mailText = [mail.subject, mail.body].filter(Boolean).join('\n\n');
        aiCandidate(result, { upload: firstPdf, evidence, extra: firstPdf ? [firstPdf] : [], mailText, mailDate: mail.date });
      }
      for (const attachment of mail.attachments.filter(a => detectKind(a.buffer, a.name) !== 'pdf')) {
        const attachmentKind = detectKind(attachment.buffer, attachment.name);
        const entry = fileEntry(attachment.name, attachment.buffer, attachmentKind || 'unsupported', opts.stage);
        source(entry, { parentId: mailSource.id, pages: [{ page: 1, text: '' }], pageCount: 1, complete: false });
      }
      return result;
    }
    result.status = 'unsupported';
    result.warnings.push({ code: 'unsupported' });
    return result;
  } catch (error) {
    result.status = 'error';
    result.warnings.push({ code: 'readError', message: String(error && error.message || error).slice(0, 300) });
    if (!result.sources.length && kind) source(fileEntry(name, buffer, kind, opts.stage), { pages: [], pageCount: 0, complete: false });
    return result;
  }
}

/* Deterministik ayrıştırıcının okuyamadığı dosya LCW AI'a aday olur. AI
   çağrısı istemcideki ortak BuyerLogAI yolundan yapılır (oturum, hata metni,
   iptal orada); sunucu yalnız dosyayı geçici alanda tutar ve AI cevabını
   /ai-report ile doğrular. */
function aiCandidate(result, parts) {
  result.status = 'unrecognized';
  result.ai = {
    eligible: Boolean(parts.upload || parts.mailText),
    uploadId: parts.upload && parts.upload.stagingId || '',
    uploadName: parts.upload && parts.upload.ad || '',
    files: [parts.evidence].concat(parts.extra || []).filter(Boolean),
    mailText: parts.mailText || '',
    mailDate: parts.mailDate || '',
  };
}

async function processFiles(files, options) {
  const fileResults = [];
  for (const file of files || []) fileResults.push(await processFile(file, options));
  const reports = Engine.groupReports(fileResults.reduce((all, r) => all.concat(r.reports), []));
  return { files: fileResults, reports };
}

module.exports = { detectKind, pdfItems, readMsg, readEml, processFile, processFiles, sha256 };
