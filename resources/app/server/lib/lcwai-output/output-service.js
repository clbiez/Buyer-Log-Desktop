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
const { collectTokens, normalizeImages, normalizeRecords, fillHtmlImages } = require('./output-images');
const { createDraftStore } = require('./output-drafts');
const userTemplates = require('./output-user-templates');
const studioSource = require('../../../public/lcwai-output-source');
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
    const records = job.records || {};
    const date = new Date(job.date);
    const saveMeta = { title, format, template: job.template, templateLabel: job.templateLabel, attempts: job.attempts, requestId: job.requestId, draftId: job.draftId, edited: Boolean(job.edited) };
    try {
      if (format === 'pdf' || format === 'html') {
        // Model kartı/galeri varsa: kart bilgileri (kaynak satırdan), gruplar
        // yan yana, PDF'te sütun × satır sayfaları. Yerleşim yoksa varsayılan.
        const filled = fillHtmlImages(data.body, images, lang);
        const layout = data.layout || (/\bbl-(gallery|groups|specs)\b/.test(filled) ? BLOutputLayout.defaults('pdf') : null);
        const body = layout ? BLOutputLayout.prepareReport(filled, layout, { pages: format === 'pdf', records, english: lang === 'en' }) : filled;
        if (format === 'pdf') {
          const html = buildDocument({ body, styles: data.styles, title, lang, orientation, print: true, meta: { date: day, template: job.templateLabel }, layout });
          const pendingId = store.putPending(ownerId, { stage: 'pdf', html, ...saveMeta, lang, orientation, officeCapability:job.durablePending===true }, {durable:job.durablePending===true});
          return { pending: 'pdf', pendingId, html, title, landscape: orientation === 'landscape', format: 'pdf', templateLabel: job.templateLabel, attempts: job.attempts, draftId: job.draftId };
        }
        const buffer = Buffer.from(buildDocument({ body, styles: data.styles, title, lang, orientation, meta: { date: day, template: job.templateLabel }, layout }), 'utf8');
        return store.save(ownerId, { buffer, ...saveMeta });
      }
      const buffer = format === 'xlsx' ? renderWorkbook(data, { lang, date, images }) : renderPresentation(data, { lang, date, images, records });
      return store.save(ownerId, { buffer, ...saveMeta });
    } catch (error) {
      if (isLcwAiError(error)) throw error;
      throw lcwAiError('OUTPUT_RENDER_FAILED', { detail: String(error && error.code || 'render').slice(0, 60) });
    }
  }

  /* Renderer'ın çözdüğü görseller ({ anahtar: dataURL }) → dosya. Eksik
     görsel dosyayı durdurmaz; yerine "görsel yok" kutusu konur. */
  function completeImages(ownerId, pendingId, rawImages, rawRecords) {
    const entry = store.takePending(ownerId, pendingId);
    if (!entry || entry.stage !== 'images') throw lcwAiError('OUTPUT_NOT_FOUND');
    const images = normalizeImages(rawImages, entry.tokens);
    // Kart bilgisi kaynak satırları (yalnız istenen anahtarlar).
    const records = normalizeRecords(rawRecords, entry.tokens);
    // Yeniden oluşturmada görseller/satırlar tekrar istenmesin: taslağın yanında kalır.
    if (entry.job.draftId) {
      try { drafts.update(ownerId, entry.job.draftId, { images: Object.fromEntries(Object.entries(images).map(([token, image]) => [token, image.dataUrl])), records }); } catch (_) {}
    }
    const output = render(ownerId, { ...entry.job, records }, images);
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
      // Kart bilgisi seçicisi kaynak satırlardaki sütunları da sunar.
      records: draft.records || {}, source: draft.source || null,
    };
    if (draft.format === 'pdf' || draft.format === 'html') out.previewCss = reportCss({ orientation: draft.orientation, print: false });
    return out;
  }

  /* Düzenlenen yapı → doğrulama → taslak güncellenir → yeni dosya. Eski
     dosya korunur (her oluşturma yeni bir dosyadır). */
  function renderDraft(ownerId, draftId, input = {}) {
    const draft = draftOf(ownerId, draftId);
    const lang = input.lang === 'en' || (input.lang !== 'tr' && draft.lang === 'en') ? 'en' : 'tr';
    const options = { lang, date: draft.day };
    const raw = input.data && typeof input.data === 'object' ? input.data : null;
    if (!raw) throw lcwAiError('OUTPUT_EDIT_INVALID', { issues: [lang === 'en' ? 'Content is missing.' : 'İçerik eksik.'] });
    if (input.format && !['pptx', 'pdf', 'html', 'xlsx'].includes(input.format)) throw lcwAiError('BAD_REQUEST');
    if (raw.layout && raw.layout.studio && (Array.isArray(raw.slides) ? raw.slides : []).reduce((n, slide) => n + (slide && Array.isArray(slide.items) ? slide.items.length : 0), 0) > studioSource.MAX_ROWS) throw lcwAiError('OUTPUT_EDIT_INVALID', { issues: [lang === 'en' ? 'Use up to 30,000 records per presentation.' : 'Sunum başına en fazla 30.000 kayıt kullanın.'] });
    const parsed = draft.format === 'xlsx' ? contracts.normalizeWorkbook(raw, options)
      : draft.format === 'pptx' ? contracts.normalizePresentation(raw, options)
        : contracts.normalizeHtmlDraft(raw, options);
    if (!parsed.ok) throw lcwAiError('OUTPUT_EDIT_INVALID', { issues: parsed.errors });
    if (draft.source && parsed.warnings.length) throw lcwAiError('OUTPUT_EDIT_INVALID', { issues: parsed.warnings });
    const title = String(input.title == null ? '' : input.title).replace(/\s+/g, ' ').trim().slice(0, contracts.LIMITS.titleChars) || (parsed.data && parsed.data.title) || draft.title;
    if (draft.format !== 'pdf' && draft.format !== 'html') parsed.data.title = title;
    const orientation = input.orientation === 'landscape' || input.orientation === 'portrait' ? input.orientation : draft.orientation;
    const updated = drafts.update(ownerId, draft.id, { data: parsed.data, title, orientation });
    const date = now();
    const job = {
      format: draft.format, data: parsed.data, title, template: draft.template, templateLabel: draft.templateLabel,
      attempts: 1, lang, orientation, day: draft.day, date: date.toISOString(), requestId: '', draftId: draft.id, edited: true,
      records: draft.source ? studioSource.normalizeRecords(draft.records, Object.keys(draft.records), lang) : raw.layout && raw.layout.studio ? studioSource.bindLegacyRecords(draft.records, lang) : draft.records || {},
    };
    const imageTokens = parsed.data.layout && parsed.data.layout.studio && draft.format === 'pptx'
      ? parsed.data.slides.flatMap(slide => [slide.image, ...(slide.items || []).map(item => item.image)]).filter(Boolean)
      : collectTokens(draft.format, parsed.data);
    const images = normalizeImages(draft.images || {}, imageTokens);
    let output;
    if (parsed.data.layout && parsed.data.layout.studio && draft.format === 'pptx') {
      const target = input.format || 'pptx';
      if (!['pptx', 'pdf', 'html', 'xlsx'].includes(target)) throw lcwAiError('BAD_REQUEST');
      output = renderStudio(ownerId, job, images, target);
    } else output = render(ownerId, job, images);
    return { output, warnings: parsed.warnings || [], revision: updated ? updated.revision : draft.revision };
  }

  function createStudio(ownerId, input = {}) {
    const lang = input.lang === 'en' ? 'en' : 'tr';
    if (!input.data || !input.data.layout || !input.data.layout.studio) throw lcwAiError('BAD_REQUEST');
    const originalCount = (Array.isArray(input.data.slides) ? input.data.slides : []).reduce((n, slide) => n + (slide && Array.isArray(slide.items) ? slide.items.length : 0), 0);
    if (originalCount > studioSource.MAX_ROWS) throw lcwAiError('BAD_REQUEST');
    const parsed = contracts.normalizePresentation(input.data, { lang });
    const items = parsed.data && parsed.data.slides.flatMap(s => s.layout === 'gallery' ? s.items : []);
    if (!parsed.ok || parsed.warnings.length || !items.length || items.length > studioSource.MAX_ROWS) throw lcwAiError('OUTPUT_EDIT_INVALID', { issues: parsed.errors });
    const tokens = items.map(item => item.image);
    if (new Set(tokens).size !== tokens.length) throw lcwAiError('BAD_REQUEST');
    const records = studioSource.normalizeRecords(input.records, tokens, lang);
    if (tokens.some(token => !records[token])) throw lcwAiError('BAD_REQUEST');
    const images = normalizeImages(input.images || {}, tokens);
    const source = { module: records[tokens[0]].module, scope: input.source && input.source.scope === 'filtered' ? 'filtered' : 'selected',
      count: items.length, grain: records[tokens[0]].module === 'collection' ? 'model-colour' : 'order-row', capturedAt: now().toISOString() };
    const id = drafts.create(ownerId, { format: 'pptx', data: parsed.data, records, source, title: parsed.data.title, lang,
      orientation: 'landscape', detail: 'standard', day: now().toISOString().slice(0, 10), template: 'catalog', templateLabel: 'Smart Layout Studio',
      images: Object.fromEntries(Object.entries(images).map(([token, image]) => [token, image.dataUrl])) });
    return getDraft(ownerId, id);
  }

  function renderStudio(ownerId, job, images, target) {
    if (target === 'pptx') return render(ownerId, job, images);
    if (target === 'xlsx') {
      const items = job.data.slides.flatMap(s => s.layout === 'gallery' ? s.items : []);
      const fields = job.data.layout.cardFields || [];
      // Excel retains typed bound values and every record; long lists are split into sheets.
      const sheets = [];
      for (let start = 0; start < items.length; start += 5000) {
        sheets.push({ name: `${job.lang === 'en' ? 'Models' : 'Modeller'} ${sheets.length + 1}`, columns: [{ header: 'Model', type: 'text' }, ...fields.map(id => {
          const record = job.records[items[0].image];
          return { header: record && record.labels && record.labels[id] || id, type: studioSource.columnType(id) };
        })], rows: items.slice(start, start + 5000).map(item => [item.title, ...fields.map(id => {
          const record = job.records[item.image];
          return record && !Array.isArray(record) && record.values ? record.values[id] ?? null : BLOutputLayout.fieldValue(item, id, job.records);
        })]) });
      }
      const parsed = contracts.normalizeWorkbook({ title: job.title, sheets }, { lang: job.lang });
      if (!parsed.ok || parsed.warnings.length) throw lcwAiError('OUTPUT_EDIT_INVALID', { issues: [...parsed.errors, ...parsed.warnings] });
      return render(ownerId, { ...job, format: target, data: parsed.data }, {});
    }
    const report = BLOutputLayout.presentationReport(job.data, job.records, job.lang === 'en');
    const c = require('./output-theme').theme().colors;
    const css = `@page{size:${report.width}pt ${report.height}pt;margin:0}html,body,.bl-page,.bl-report{margin:0!important;padding:0!important;max-width:none!important;width:auto!important}.bl-header,.bl-footer{display:none!important}.bl-studio-page{background:${c.paper};margin:0!important;overflow:hidden}.bl-studio-page:last-child{break-after:auto}.bl-studio-title{color:${c.ink}}.bl-studio-title small{display:block;font-size:12pt}.bl-studio-card{background:${c.paper};border:0.5pt solid ${c.line}}.bl-studio-card img{max-width:none!important;margin:0!important}.bl-studio-content table{width:100%}`;
    return render(ownerId, { ...job, format: target, orientation: job.data.layout.studio.orientation, data: { body: report.body, styles: [css], title: job.title, layout: null } }, images);
  }

  /* Şablon olarak kaydetme: taslaktaki (ya da düzenleyicideki) yapının
     veri taşımayan iskeleti. */
  function skeleton(ownerId, draftId, data) {
    const draft = draftOf(ownerId, draftId);
    const source = data && typeof data === 'object' ? data : draft.data;
    return { format: draft.format, orientation: draft.orientation, detail: draft.detail || 'standard', base: draft.template || '', structure: userTemplates.skeletonFromData(draft.format, source), layout: source.layout ? BLOutputLayout.normalizeLayout(draft.format, source.layout) : null };
  }

  return {
    create, createStudio, completeImages, completePdf, fallbackHtml, getDraft, renderDraft, skeleton,
    saveStudioImages(ownerId, id, input) {
      const draft = draftOf(ownerId, id);
      if (!draft.source) throw lcwAiError('BAD_REQUEST');
      const images = normalizeImages(input, collectTokens('pptx', draft.data));
      const safe = Object.fromEntries(Object.entries(images).map(([token, image]) => [token, image.dataUrl]));
      drafts.update(ownerId, id, { images: safe });
      return safe;
    },
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
