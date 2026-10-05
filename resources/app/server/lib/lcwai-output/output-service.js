'use strict';

/*
 * AI Çıktı Oluşturma (Export Engine).
 *
 *   LCW AI → içerik/yapı (HTML ya da JSON)
 *   Buyer Log → doğrulama, onarım, tema, gerçek dosya (HTML/PDF/XLSX/PPTX)
 *
 * Akış: şablon seçimi → sözleşme talimatı → engine.chat (aynı sohbet) →
 * ayrıştır + doğrula → gerekirse aynı sohbette onarım (en fazla
 * MAX_REPAIRS) → Buyer Log temasıyla dosya → AI Outputs klasörü.
 * PDF son adımı masaüstü kabuğunda (Chromium printToPDF) yapılır: servis
 * temizlenmiş, CSP'li HTML'i "bekleyen" olarak döndürür; renderer basılmış
 * PDF baytlarını completePdf ile geri verir. Kabuk yoksa HTML'e düşülür.
 */
const { lcwAiError, isLcwAiError } = require('../lcwai/lcwai-errors');
const contracts = require('./output-contracts');
const { chooseTemplate, templateLabel } = require('./output-templates');
const { buildDocument } = require('./output-html');
const { renderWorkbook } = require('./output-xlsx');
const { renderPresentation } = require('./output-pptx');
const { createOutputStore } = require('./output-store');

const MAX_REPAIRS = 2;
const MAX_PDF_BYTES = 50 * 1024 * 1024;
const DETAILS = ['summary', 'standard', 'detailed'];

function normalizeRequest(output = {}) {
  const format = contracts.normalizeFormat(output && output.format);
  if (!format) throw lcwAiError('BAD_REQUEST', { detail: 'output-format' });
  return {
    format,
    orientation: output.orientation === 'landscape' ? 'landscape' : 'portrait',
    detail: DETAILS.includes(output.detail) ? output.detail : 'standard',
    template: String(output.template || '').slice(0, 30),
  };
}

function fallbackTitle(message, english) {
  const line = String(message || '').split('\n').map(item => item.trim()).find(Boolean) || '';
  return line.slice(0, 70) || (english ? 'LCW AI Output' : 'LCW AI Çıktısı');
}

function createOutputService(options = {}) {
  const engineOf = typeof options.engine === 'function' ? options.engine : () => options.engine;
  const store = options.store || createOutputStore(options.storeOptions || {});
  const now = typeof options.now === 'function' ? options.now : () => new Date();
  const emit = (onProgress, event) => { if (typeof onProgress === 'function') { try { onProgress(event); } catch (_) {} } };

  async function create(ownerId, input = {}) {
    const spec = normalizeRequest(input.output);
    const lang = input.lang === 'en' ? 'en' : 'tr';
    const english = lang === 'en';
    const date = now();
    const day = date.toISOString().slice(0, 10);
    const template = chooseTemplate(spec.format, input.message, spec.template);
    const instruction = contracts.buildInstruction({ format: spec.format, template, orientation: spec.orientation, detail: spec.detail, lang });
    const engine = engineOf();
    const progress = event => emit(input.onProgress, { ...event, output: true });
    emit(input.onProgress, { phase: 'output', step: 'generating', format: spec.format, template: template.key, templateLabel: templateLabel(template, lang) });

    let result = await engine.chat(ownerId, { ...input, outputInstruction: instruction, onProgress: progress });
    let chatId = result.chatId || input.chatId || null;
    let parsed = contracts.parseOutput(spec.format, result.text, { lang, date: day });
    let attempts = 1;
    while (!parsed.ok && attempts <= MAX_REPAIRS) {
      if (input.signal && input.signal.aborted) throw lcwAiError('CANCELLED');
      emit(input.onProgress, { phase: 'output', step: 'repairing', attempt: attempts, format: spec.format });
      const repair = contracts.repairMessage({ format: spec.format, errors: parsed.errors, lang });
      // Sohbet kimliği varsa düzeltme aynı sohbette istenir (LCW AI önceki
      // cevabı görür); yoksa istek talimat + düzeltme notuyla yeniden kurulur.
      result = chatId
        ? await engine.chat(ownerId, { requestId: input.requestId, chatId, message: repair, lang, signal: input.signal, onProgress: progress })
        : await engine.chat(ownerId, { ...input, outputInstruction: `${instruction}\n\n${repair}`, onProgress: progress });
      chatId = result.chatId || chatId;
      parsed = contracts.parseOutput(spec.format, result.text, { lang, date: day });
      attempts++;
    }
    if (!parsed.ok) throw lcwAiError('OUTPUT_INVALID', { detail: parsed.errors.join(' | ').slice(0, 300) });

    emit(input.onProgress, { phase: 'output', step: 'rendering', format: spec.format });
    const title = (parsed.data && parsed.data.title) || fallbackTitle(input.message, english);
    const label = templateLabel(template, lang);
    const base = { requestId: result.requestId, chatId, text: parsed.explanation || '', model: result.model, finishReason: result.finishReason, modules: result.modules, truncated: result.truncated, warnings: parsed.warnings || [] };
    try {
      if (spec.format === 'pdf') {
        const html = buildDocument({ body: parsed.data.body, styles: parsed.data.styles, title, lang, orientation: spec.orientation, print: true, meta: { date: day, template: label } });
        const pendingId = store.putPending(ownerId, { html, title, template: template.key, templateLabel: label, attempts, lang, orientation: spec.orientation, requestId: result.requestId });
        return { ...base, output: { pending: 'pdf', pendingId, html, title, landscape: spec.orientation === 'landscape', format: 'pdf', templateLabel: label, attempts } };
      }
      let buffer;
      if (spec.format === 'html') buffer = Buffer.from(buildDocument({ body: parsed.data.body, styles: parsed.data.styles, title, lang, orientation: spec.orientation, meta: { date: day, template: label } }), 'utf8');
      else if (spec.format === 'xlsx') buffer = renderWorkbook(parsed.data, { lang, date });
      else buffer = renderPresentation(parsed.data, { lang, date });
      const record = store.save(ownerId, { buffer, title, format: spec.format, template: template.key, templateLabel: label, attempts, requestId: result.requestId });
      return { ...base, output: record };
    } catch (error) {
      if (isLcwAiError(error)) throw error;
      throw lcwAiError('OUTPUT_RENDER_FAILED', { detail: String(error && error.code || 'render').slice(0, 60) });
    }
  }

  /* Masaüstü kabuğunun bastığı PDF baytları → AI Outputs. */
  function completePdf(ownerId, pendingId, buffer) {
    const entry = store.takePending(ownerId, pendingId, { keep: true });
    if (!entry) throw lcwAiError('OUTPUT_NOT_FOUND');
    if (!Buffer.isBuffer(buffer) || buffer.length < 64 || buffer.length > MAX_PDF_BYTES || buffer.slice(0, 5).toString('latin1') !== '%PDF-') throw lcwAiError('OUTPUT_RENDER_FAILED', { detail: 'pdf-bytes' });
    store.takePending(ownerId, pendingId);
    return store.save(ownerId, { buffer, title: entry.title, format: 'pdf', template: entry.template, templateLabel: entry.templateLabel, attempts: entry.attempts, requestId: entry.requestId });
  }

  /* Kabuk yoksa (tarayıcı kipi) ya da baskı başarısızsa: aynı belge HTML
     olarak kaydedilir; kullanıcı tarayıcıda Yazdır → PDF yapabilir. */
  function fallbackHtml(ownerId, pendingId) {
    const entry = store.takePending(ownerId, pendingId);
    if (!entry) throw lcwAiError('OUTPUT_NOT_FOUND');
    return store.save(ownerId, { buffer: Buffer.from(entry.html, 'utf8'), title: entry.title, format: 'html', template: entry.template, templateLabel: entry.templateLabel, attempts: entry.attempts, requestId: entry.requestId });
  }

  return {
    create, completePdf, fallbackHtml,
    get: (ownerId, id) => store.get(ownerId, id),
    list: (ownerId, limit) => store.list(ownerId, limit),
    store,
  };
}

module.exports = { createOutputService, normalizeRequest, MAX_REPAIRS };
