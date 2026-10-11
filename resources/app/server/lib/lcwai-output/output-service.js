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
 *
 * AI Çıktı Düzenleyici: doğrulanmış yapı taslak olarak saklanır
 * (output-drafts). Kullanıcı taslağı düzenleyip renderDraft ile yeniden
 * oluşturur; düzenleme AYNI doğrulayıcıdan geçer, LCW AI'a gidilmez.
 * Kullanıcı şablonu (output-user-templates) sözleşmenin sonuna eklenir.
 */
const { lcwAiError, isLcwAiError } = require('../lcwai/lcwai-errors');
const contracts = require('./output-contracts');
const { chooseTemplate, templateLabel } = require('./output-templates');
const { buildDocument } = require('./output-html');
const { reportCss } = require('./output-theme');
const { renderWorkbook } = require('./output-xlsx');
const { renderPresentation } = require('./output-pptx');
const { createOutputStore } = require('./output-store');
const { collectTokens, normalizeImages, fillHtmlImages } = require('./output-images');
const { createDraftStore } = require('./output-drafts');
const userTemplates = require('./output-user-templates');
const BLOutputLayout = require('../../../public/lcwai-output-layout');

const MAX_REPAIRS = 2;
const MAX_PDF_BYTES = 50 * 1024 * 1024;
const DETAILS = ['summary', 'standard', 'detailed'];

function normalizeRequest(output = {}) {
  const format = contracts.normalizeFormat(output && output.format);
  if (!format) throw lcwAiError('BAD_REQUEST', { detail: 'output-format' });
  // Kullanıcı şablonu route'ta depodan çözülür; istemcinin gönderdiği
  // ham tanım güvenilmez sayılır ve burada yeniden normalize edilir.
  const user = output.userTemplate && typeof output.userTemplate === 'object' ? output.userTemplate : null;
  const definition = user ? userTemplates.normalizeDefinition({ ...user.definition, format }) : null;
  return {
    format,
    orientation: output.orientation === 'landscape' ? 'landscape' : 'portrait',
    detail: DETAILS.includes(output.detail) ? output.detail : 'standard',
    template: String(output.template || (definition && definition.base) || '').slice(0, 30),
    userTemplate: definition ? { name: String(user.name || '').slice(0, 80), definition } : null,
  };
}

function fallbackTitle(message, english) {
  const line = String(message || '').split('\n').map(item => item.trim()).find(Boolean) || '';
  return line.slice(0, 70) || (english ? 'LCW AI Output' : 'LCW AI Çıktısı');
}

function createOutputService(options = {}) {
  const engineOf = typeof options.engine === 'function' ? options.engine : () => options.engine;
  const store = options.store || createOutputStore(options.storeOptions || {});
  const drafts = options.drafts || createDraftStore(options.draftOptions || (options.storeOptions && options.storeOptions.root ? { root: `${options.storeOptions.root}-drafts` } : {}));
  const now = typeof options.now === 'function' ? options.now : () => new Date();
  const emit = (onProgress, event) => { if (typeof onProgress === 'function') { try { onProgress(event); } catch (_) {} } };

  async function create(ownerId, input = {}) {
    const spec = normalizeRequest(input.output);
    const lang = input.lang === 'en' ? 'en' : 'tr';
    const english = lang === 'en';
    const date = now();
    const day = date.toISOString().slice(0, 10);
    const template = chooseTemplate(spec.format, input.message, spec.template);
    const custom = spec.userTemplate ? userTemplates.templateInstruction(spec.userTemplate.definition, { name: spec.userTemplate.name, lang }) : '';
    const instruction = [contracts.buildInstruction({ format: spec.format, template, orientation: spec.orientation, detail: spec.detail, lang }), custom].filter(Boolean).join('\n');
    const label = spec.userTemplate ? spec.userTemplate.name || templateLabel(template, lang) : templateLabel(template, lang);
    const engine = engineOf();
    const progress = event => emit(input.onProgress, { ...event, output: true });
    emit(input.onProgress, { phase: 'output', step: 'generating', format: spec.format, template: template.key, templateLabel: label });

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
    // Yerleşim LCW AI'dan değil kullanıcıdan gelir: şablonun yerleşimi ya da varsayılan.
    parsed.data.layout = spec.userTemplate && spec.userTemplate.definition.layout ? spec.userTemplate.definition.layout : null;

    const title = (parsed.data && parsed.data.title) || fallbackTitle(input.message, english);
    const job = {
      format: spec.format, data: parsed.data, title, template: template.key, templateLabel: label,
      attempts, lang, orientation: spec.orientation, day, date: date.toISOString(), requestId: result.requestId,
    };
    // Taslak yazılamazsa dosya yine oluşur; yalnız "Düzenle" sunulmaz.
    try {
      job.draftId = drafts.create(ownerId, { format: job.format, data: job.data, title, template: job.template, templateLabel: job.templateLabel, lang, orientation: job.orientation, detail: spec.detail, day, images: {} });
    } catch (_) { job.draftId = null; }
    const base = { requestId: result.requestId, chatId, text: parsed.explanation || '', model: result.model, finishReason: result.finishReason, modules: result.modules, truncated: result.truncated, warnings: parsed.warnings || [] };
    // Çıktı model görseli anahtarı kullanıyorsa görseller renderer'dan istenir
    // (yerel depo, kanonik çözümleyici); dosya görsellerle birlikte oluşur.
    const tokens = input.output && input.output.images === false ? [] : collectTokens(spec.format, parsed.data);
    if (tokens.length) {
      const pendingId = store.putPending(ownerId, { stage: 'images', job, tokens });
      return { ...base, output: { pending: 'images', pendingId, tokens, format: spec.format, title, templateLabel: job.templateLabel, attempts, draftId: job.draftId } };
    }
    emit(input.onProgress, { phase: 'output', step: 'rendering', format: spec.format });
    return { ...base, output: render(ownerId, job, {}) };
  }

  /* İş + (varsa) görseller → dosya. PDF son adımı masaüstü kabuğunda. */
  function render(ownerId, job, images) {
    const { format, data, title, lang, orientation, day } = job;
    const date = new Date(job.date);
    const saveMeta = { title, format, template: job.template, templateLabel: job.templateLabel, attempts: job.attempts, requestId: job.requestId, draftId: job.draftId, edited: Boolean(job.edited) };
    try {
      if (format === 'pdf' || format === 'html') {
        // Yerleşim varsa model galerisi PDF'te sütun × satır sayfalarına bölünür.
        const filled = fillHtmlImages(data.body, images, lang);
        const body = data.layout ? BLOutputLayout.paginateGallery(filled, data.layout, { pages: format === 'pdf' }) : filled;
        if (format === 'pdf') {
          const html = buildDocument({ body, styles: data.styles, title, lang, orientation, print: true, meta: { date: day, template: job.templateLabel }, layout: data.layout });
          const pendingId = store.putPending(ownerId, { stage: 'pdf', html, ...saveMeta, lang, orientation, officeCapability:job.durablePending===true }, {durable:job.durablePending===true});
          return { pending: 'pdf', pendingId, html, title, landscape: orientation === 'landscape', format: 'pdf', templateLabel: job.templateLabel, attempts: job.attempts, draftId: job.draftId };
        }
        const buffer = Buffer.from(buildDocument({ body, styles: data.styles, title, lang, orientation, meta: { date: day, template: job.templateLabel }, layout: data.layout }), 'utf8');
        return store.save(ownerId, { buffer, ...saveMeta });
      }
      const buffer = format === 'xlsx' ? renderWorkbook(data, { lang, date, images }) : renderPresentation(data, { lang, date, images });
      return store.save(ownerId, { buffer, ...saveMeta });
    } catch (error) {
      if (isLcwAiError(error)) throw error;
      throw lcwAiError('OUTPUT_RENDER_FAILED', { detail: String(error && error.code || 'render').slice(0, 60) });
    }
  }

  /* Renderer'ın çözdüğü görseller ({ anahtar: dataURL }) → dosya. Eksik
     görsel dosyayı durdurmaz; yerine "görsel yok" kutusu konur. */
  function completeImages(ownerId, pendingId, rawImages) {
    const entry = store.takePending(ownerId, pendingId);
    if (!entry || entry.stage !== 'images') throw lcwAiError('OUTPUT_NOT_FOUND');
    const images = normalizeImages(rawImages, entry.tokens);
    // Yeniden oluşturmada görseller tekrar istenmesin: taslağın yanında kalır.
    if (entry.job.draftId) {
      try { drafts.update(ownerId, entry.job.draftId, { images: Object.fromEntries(Object.entries(images).map(([token, image]) => [token, image.dataUrl])) }); } catch (_) {}
    }
    const output = render(ownerId, entry.job, images);
    return { ...output, imagesUsed: Object.keys(images).length, imagesRequested: entry.tokens.length };
  }

  /* Masaüstü kabuğunun bastığı PDF baytları → AI Outputs. */
  function completePdf(ownerId, pendingId, buffer, {officeAuthorized=false}={}) {
    return store.withPending ? store.withPending(pendingId,()=>perform()) : perform();
    function perform(){
    const entry = store.takePending(ownerId, pendingId, { keep: true });
    if (!entry || entry.stage !== 'pdf') throw lcwAiError('OUTPUT_NOT_FOUND');
    if(entry.officeCapability&&!officeAuthorized)throw lcwAiError('OUTPUT_NOT_FOUND');
    if (!Buffer.isBuffer(buffer) || buffer.length < 64 || buffer.length > MAX_PDF_BYTES || buffer.slice(0, 5).toString('latin1') !== '%PDF-') throw lcwAiError('OUTPUT_RENDER_FAILED', { detail: 'pdf-bytes' });
    const saved=(entry.officeCapability&&store.byRequest(ownerId,entry.requestId))||store.save(ownerId, { buffer, title: entry.title, format: 'pdf', template: entry.template, templateLabel: entry.templateLabel, attempts: entry.attempts, requestId: entry.requestId, draftId: entry.draftId, edited: entry.edited });
    store.takePending(ownerId, pendingId);return saved;
    }
  }

  /* Kabuk yoksa (tarayıcı kipi) ya da baskı başarısızsa: aynı belge HTML
     olarak kaydedilir; kullanıcı tarayıcıda Yazdır → PDF yapabilir. */
  function fallbackHtml(ownerId, pendingId, {officeAuthorized=false}={}) {
    return store.withPending ? store.withPending(pendingId,()=>perform()) : perform();
    function perform(){
    const entry = store.takePending(ownerId, pendingId,{keep:true});
    if (!entry || entry.stage !== 'pdf') throw lcwAiError('OUTPUT_NOT_FOUND');
    if(entry.officeCapability&&!officeAuthorized)throw lcwAiError('OUTPUT_NOT_FOUND');
    const saved=(entry.officeCapability&&store.byRequest(ownerId,entry.requestId))||store.save(ownerId, { buffer: Buffer.from(entry.html, 'utf8'), title: entry.title, format: 'html', template: entry.template, templateLabel: entry.templateLabel, attempts: entry.attempts, requestId: entry.requestId, draftId: entry.draftId, edited: entry.edited });
    store.takePending(ownerId,pendingId);return saved;
    }
  }

  /* ---------------- AI Çıktı Düzenleyici ---------------- */
  function draftOf(ownerId, draftId) {
    const draft = drafts.get(ownerId, draftId);
    if (!draft) throw lcwAiError('OUTPUT_NOT_FOUND');
    return draft;
  }

  /* Düzenleyiciye giden taslak. Rapor (HTML/PDF) önizlemesi için tema CSS'i
     de verilir; önizleme betiksiz, CSP'li ayrı bir belgede çizilir. */
  function getDraft(ownerId, draftId) {
    const draft = draftOf(ownerId, draftId);
    const out = {
      id: draft.id, format: draft.format, title: draft.title, lang: draft.lang, orientation: draft.orientation, detail: draft.detail,
      template: draft.template, templateLabel: draft.templateLabel, revision: draft.revision, updatedAt: draft.updatedAt,
      // Görseller önizlemede (rapor, Yerleşim aracındaki model kartları) kullanılır.
      data: draft.data, imageKeys: Object.keys(draft.images || {}), images: draft.images || {},
    };
    if (draft.format === 'pdf' || draft.format === 'html') out.previewCss = reportCss({ orientation: draft.orientation, print: false });
    return out;
  }

  /* Düzenlenen yapı → doğrulama → taslak güncellenir → yeni dosya. Eski
     dosya korunur (her oluşturma yeni bir dosyadır). */
  function renderDraft(ownerId, draftId, input = {}) {
    const draft = draftOf(ownerId, draftId);
    const lang = draft.lang === 'en' ? 'en' : 'tr';
    const options = { lang, date: draft.day };
    const raw = input.data && typeof input.data === 'object' ? input.data : null;
    if (!raw) throw lcwAiError('OUTPUT_EDIT_INVALID', { issues: [lang === 'en' ? 'Content is missing.' : 'İçerik eksik.'] });
    const parsed = draft.format === 'xlsx' ? contracts.normalizeWorkbook(raw, options)
      : draft.format === 'pptx' ? contracts.normalizePresentation(raw, options)
        : contracts.normalizeHtmlDraft(raw, options);
    if (!parsed.ok) throw lcwAiError('OUTPUT_EDIT_INVALID', { issues: parsed.errors });
    const title = String(input.title == null ? '' : input.title).replace(/\s+/g, ' ').trim().slice(0, contracts.LIMITS.titleChars) || (parsed.data && parsed.data.title) || draft.title;
    if (draft.format !== 'pdf' && draft.format !== 'html') parsed.data.title = title;
    const orientation = input.orientation === 'landscape' || input.orientation === 'portrait' ? input.orientation : draft.orientation;
    const updated = drafts.update(ownerId, draft.id, { data: parsed.data, title, orientation });
    const date = now();
    const job = {
      format: draft.format, data: parsed.data, title, template: draft.template, templateLabel: draft.templateLabel,
      attempts: 1, lang, orientation, day: draft.day, date: date.toISOString(), requestId: '', draftId: draft.id, edited: true,
    };
    const images = normalizeImages(draft.images || {}, collectTokens(draft.format, parsed.data));
    const output = render(ownerId, job, images);
    return { output, warnings: parsed.warnings || [], revision: updated ? updated.revision : draft.revision };
  }

  /* Şablon olarak kaydetme: taslaktaki (ya da düzenleyicideki) yapının
     veri taşımayan iskeleti. */
  function skeleton(ownerId, draftId, data) {
    const draft = draftOf(ownerId, draftId);
    const source = data && typeof data === 'object' ? data : draft.data;
    return { format: draft.format, orientation: draft.orientation, detail: draft.detail || 'standard', base: draft.template || '', structure: userTemplates.skeletonFromData(draft.format, source), layout: source.layout ? BLOutputLayout.normalizeLayout(draft.format, source.layout) : null };
  }

  return {
    create, completeImages, completePdf, fallbackHtml, getDraft, renderDraft, skeleton,
    renderStructured(ownerId,input){
      const format=contracts.normalizeFormat(input.format),lang=input.lang==='en'?'en':'tr',date=now();
      if(!['html','xlsx','pdf'].includes(format))throw lcwAiError('BAD_REQUEST');
      const parsed=format==='xlsx'?contracts.normalizeWorkbook(input.data,{lang}):contracts.normalizeHtmlDraft(input.data,{lang});
      if(!parsed.ok||parsed.warnings?.length)throw lcwAiError('OUTPUT_INVALID',{detail:'structured-report'});
      return render(ownerId,{format,data:parsed.data,title:String(input.title||'Report').slice(0,140),lang,orientation:'landscape',day:date.toISOString().slice(0,10),date:date.toISOString(),requestId:input.requestId,attempts:0,template:'deterministic-report',templateLabel:lang==='en'?'Buyer Log report':'Buyer Log raporu',durablePending:true},{});
    },
    get: (ownerId, id) => store.get(ownerId, id),
    list: (ownerId, limit) => store.list(ownerId, limit),
    store,
  };
}

module.exports = { createOutputService, normalizeRequest, MAX_REPAIRS };
