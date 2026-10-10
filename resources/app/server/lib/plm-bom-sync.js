'use strict';

/* PLM BOM senkronu.
 *
 * Single Style:
 *   Style List styleId -> GetStyleBomInformation.
 *
 * Set Style:
 *   parent styleId -> SetStyleChildStyleColorAssociation -> child styleId'ler
 *   -> her child için BOM + child PLM metadata. Buyer Log'da yeni satır
 *   yaratılmaz; sonuç parent PLM kaydında A/B/C parçaları olarak tutulur.
 *
 * Yalnız belirsiz Print satırları LCW AI'a danışılır. BOM/AI/Set ilişkisi
 * hatası ana PLM alan senkronunu geri almaz; son başarılı BOM kaydı korunur.
 */
const crypto = require('crypto');
const bomApi = require('./corenectum-bom-api');
const styleApi = require('./corenectum-style-api');
const setStyleApi = require('./corenectum-set-style-api');
const defaultStore = require('./plm-bom-store');
const coreNectumApiClient = require('./corenectum-api-client');
const { getDefaultEngine } = require('./lcwai');
const { extractJsonObject } = require('./lcwai/lcwai-prompt');

const BOM_FETCH_CONCURRENCY = 5;
const MAX_AI_PER_SYNC = 50;

function clean(value, max = 500) {
  return String(value == null ? '' : value).replace(/[\u0000\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}
async function mapLimit(items, limit, worker) {
  let cursor = 0;
  const list = Array.isArray(items) ? items : [];
  const runners = Array.from({ length: Math.min(Math.max(1, limit), list.length) }, async () => {
    while (cursor < list.length) {
      const index = cursor++;
      await worker(list[index], index);
    }
  });
  await Promise.all(runners);
}

function targetsFromRecords(records) {
  const out = [], seen = new Set();
  for (const record of Array.isArray(records) ? records : []) {
    const plmId = bomApi.coreId(record && (record.plmId ?? record.plmCode));
    const styleId = bomApi.coreId(record && record.styleId);
    if (!plmId || !styleId || seen.has(plmId)) continue;
    seen.add(plmId);
    out.push({
      plmId,
      styleId,
      styleName: clean(record && record.styleName, 300),
      productType: clean(record && (record.productType ?? record.productTypeName), 120),
      fabric: clean(record && record.fabric, 1500),
    });
  }
  return out;
}

function aiTask(analysis) {
  const allowed = Object.keys(bomApi.PLACEMENTS).filter(key => key !== 'other').join(', ');
  return [
    'CoreNectum PLM BOM içindeki yalnız belirsiz PRINT yerleşimlerini sınıflandır.',
    'Deterministik olarak çözülmüş satırları değiştirme. Label/Sticker/License Label gibi Print olmayan bileşenleri asla baskı sayma.',
    `Yalnız şu placement anahtarlarından birini kullan: ${allowed}.`,
    'Her belirsiz component için componentCode değerini aynen geri ver.',
    'Yalnız TEK JSON nesnesi döndür; açıklama veya kod bloğu ekleme.',
    '{"placements":[{"componentCode":"B123","placement":"front_body","confidence":"high","reason":"kısa gerekçe"}],"confidence":"high","notes":[]}',
  ].join('\n');
}

async function consultAi(ownerId, analysis, options) {
  const engine = options.aiEngine || getDefaultEngine();
  const ambiguous = analysis.placements.filter(item => item.placement === 'other').map(item => ({
    componentCode: item.componentCode,
    styleBomComponentId: item.styleBomComponentId,
    description: item.description,
    categoryName: item.categoryName,
    printType: item.printType,
  }));
  const known = analysis.placements.filter(item => item.placement !== 'other').map(item => ({
    componentCode: item.componentCode,
    description: item.description,
    placement: item.placement,
    printType: item.printType,
  }));
  const result = await engine.ask(ownerId, {
    source: 'plm-bom',
    task: aiTask(analysis),
    context: {
      deterministicSummary: analysis.summary,
      knownPlacements: known,
      ambiguousPrintComponents: ambiguous,
    },
    lang: options.language === 'en' ? 'en' : 'tr',
    reasoningLevel: 'Medium',
  });
  const parsed = extractJsonObject(result && result.text);
  if (!parsed) throw Object.assign(new Error('LCW AI BOM analizi geçerli JSON döndürmedi.'), { code: 'PLM_BOM_AI_INVALID_JSON' });
  return { parsed, result };
}

function aggregateSetFingerprint(children) {
  const canonical = (Array.isArray(children) ? children : []).map(item => ({
    label: clean(item && item.label, 20),
    childStyleId: bomApi.coreId(item && item.childStyleId),
    childPlmId: bomApi.coreId(item && item.childPlmId),
    childStyleName: clean(item && item.childStyleName, 300),
    specialCode: clean(item && item.specialCode, 160),
    fabric: clean(item && item.fabric, 1500),
    productMainDefinition: clean(item && item.productMainDefinition, 300),
    perAssemblyCount: Number.isFinite(Number(item && item.perAssemblyCount)) ? Number(item.perAssemblyCount) : null,
    bomFingerprint: clean(item && item.analysis && item.analysis.fingerprint, 128),
  }));
  return crypto.createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

function topAi(setComponents) {
  const items = (Array.isArray(setComponents) ? setComponents : []).map(item => item && item.ai || {});
  const statuses = items.map(item => item.status || 'not-needed');
  let status = 'not-needed';
  if (statuses.includes('failed')) status = 'failed';
  else if (statuses.includes('partial')) status = 'partial';
  else if (statuses.includes('deferred')) status = 'deferred';
  else if (statuses.includes('resolved')) status = 'resolved';
  const models = [...new Set(items.map(item => clean(item.model, 80)).filter(Boolean))];
  const confidences = items.map(item => clean(item.confidence, 20)).filter(Boolean);
  const rank = { low: 1, medium: 2, high: 3 };
  const confidence = confidences.length ? confidences.sort((a, b) => (rank[a] || 0) - (rank[b] || 0))[0] : '';
  return {
    status,
    model: models.join(' + ').slice(0, 80),
    consultedAt: items.map(item => item.consultedAt).filter(Boolean).sort().pop() || null,
    confidence,
    notes: items.flatMap(item => Array.isArray(item.notes) ? item.notes : []).slice(0, 10),
    error: items.map(item => clean(item.error, 500)).filter(Boolean).join(' | ').slice(0, 500),
  };
}

async function syncPlmBoms(records, options = {}) {
  const ownerId = clean(options.ownerId, 160) || 'default';
  const store = options.store || defaultStore;
  const postJson = options.postJson || ((url, body, requestOptions) => coreNectumApiClient.postJson(ownerId, url, body, requestOptions));
  const getJson = options.getJson || ((url, query, requestOptions) => coreNectumApiClient.getJson(ownerId, url, query, requestOptions));
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : () => {};
  const targets = targetsFromRecords(records);
  const snapshot = store.load();
  const fetched = [];
  const failed = [];
  const recordOverrides = new Map();
  let done = 0;

  await mapLimit(targets, Number(options.fetchConcurrency) || BOM_FETCH_CONCURRENCY, async target => {
    try {
      if (setStyleApi.isSetStyle(target.productType)) {
        const associationPayload = await getJson(
          setStyleApi.SET_STYLE_CHILD_ASSOCIATION_URL,
          setStyleApi.associationQuery(target.styleId),
          { timeoutMs: 60000, retries: 3, language: options.language }
        );
        let children = setStyleApi.childStyleAssociations(associationPayload);
        if (!children.length) {
          throw Object.assign(new Error('Set Style için takım parçası bulunamadı.'), { code: 'PLM_SET_COMPONENTS_NOT_FOUND' });
        }

        /* İlişki API'si childStyleId/PLM/name verir. Kumaş ve Special Code,
           doğrulanmış GetStyleList alanlarından tek toplu istekle zenginleşir. */
        const childPlmIds = children.map(item => item.childPlmId).filter(Boolean);
        if (childPlmIds.length) {
          const metadataPayload = await postJson(
            styleApi.GET_STYLE_LIST_URL,
            styleApi.styleListBatchBody(childPlmIds),
            { timeoutMs: 60000, retries: 3, language: options.language }
          );
          children = setStyleApi.enrichChildStyles(children, metadataPayload);
        }

        const childAnalyses = new Array(children.length);
        await mapLimit(children, Number(options.fetchConcurrency) || BOM_FETCH_CONCURRENCY, async (child, childIndex) => {
          const payload = await postJson(
            bomApi.GET_STYLE_BOM_INFORMATION_URL,
            bomApi.bomRequestBody(child.childStyleId),
            { timeoutMs: 60000, retries: 3, language: options.language }
          );
          const analysis = bomApi.analyzeBom(payload);
          if (analysis.styleId && analysis.styleId !== child.childStyleId) {
            throw Object.assign(new Error(`BOM styleId uyuşmuyor: beklenen ${child.childStyleId}, gelen ${analysis.styleId}.`), { code: 'PLM_BOM_STYLE_MISMATCH' });
          }
          childAnalyses[childIndex] = { ...child, analysis: { ...analysis, styleId: child.childStyleId } };
        });

        const withAnalysis = childAnalyses.filter(Boolean);
        if (withAnalysis.length !== children.length) {
          throw Object.assign(new Error('Set Style takım parçalarının BOM bilgisi eksik döndü.'), { code: 'PLM_SET_COMPONENT_BOM_INCOMPLETE' });
        }
        fetched.push({
          target,
          kind: 'set',
          children: withAnalysis,
          fingerprint: aggregateSetFingerprint(withAnalysis),
        });
      } else {
        const payload = await postJson(
          bomApi.GET_STYLE_BOM_INFORMATION_URL,
          bomApi.bomRequestBody(target.styleId),
          { timeoutMs: 60000, retries: 3, language: options.language }
        );
        const analysis = bomApi.analyzeBom(payload);
        if (analysis.styleId && analysis.styleId !== target.styleId) {
          throw Object.assign(new Error(`BOM styleId uyuşmuyor: beklenen ${target.styleId}, gelen ${analysis.styleId}.`), { code: 'PLM_BOM_STYLE_MISMATCH' });
        }
        fetched.push({ target, kind: 'single', analysis: { ...analysis, styleId: target.styleId }, fingerprint: analysis.fingerprint });
      }
    } catch (error) {
      failed.push({
        plmId: target.plmId,
        styleId: target.styleId,
        code: clean(error && error.code, 80) || 'PLM_BOM_FETCH_FAILED',
        error: clean(error && error.message || error, 500) || 'BOM alınamadı.',
      });
    } finally {
      done += 1;
      onProgress({ phase: options.language === 'en' ? 'Reading PLM BOM' : 'PLM BOM okunuyor', current: done, total: targets.length, model: target.plmId });
    }
  });

  const entries = new Map();
  const toSave = [];
  let unchanged = 0, aiConsulted = 0, aiResolved = 0, withPrint = 0;
  const maxAiPerSync = Number(options.maxAiPerSync) || MAX_AI_PER_SYNC;
  const pendingAiTotal = fetched.reduce((sum, item) => sum + (
    item.kind === 'set'
      ? item.children.filter(child => child.analysis.needsAi).length
      : (item.analysis.needsAi ? 1 : 0)
  ), 0);

  async function resolveAi(analysis, modelLabel) {
    let next = analysis;
    let ai = { status: 'not-needed', model: '', consultedAt: null, confidence: '', notes: [], error: '' };
    if (!next.needsAi) return { analysis: next, ai };
    if (aiConsulted >= maxAiPerSync) {
      return { analysis: next, ai: { ...ai, status: 'deferred', error: 'AI consultation limit reached for this sync.' } };
    }
    aiConsulted += 1;
    onProgress({
      phase: options.language === 'en' ? 'Consulting LCW AI for BOM' : 'BOM için LCW AI ile istişare ediliyor',
      current: aiConsulted,
      total: pendingAiTotal,
      model: modelLabel,
    });
    try {
      const consulted = await consultAi(ownerId, next, options);
      next = bomApi.mergeAiAnalysis(next, consulted.parsed);
      const confidence = ['high', 'medium', 'low'].includes(clean(consulted.parsed.confidence, 20).toLowerCase())
        ? clean(consulted.parsed.confidence, 20).toLowerCase() : '';
      ai = {
        status: next.needsAi ? 'partial' : 'resolved',
        model: clean(consulted.result && consulted.result.model && consulted.result.model.key, 80),
        consultedAt: new Date().toISOString(),
        confidence,
        notes: (Array.isArray(consulted.parsed.notes) ? consulted.parsed.notes : []).slice(0, 10).map(item => clean(item, 500)).filter(Boolean),
        error: '',
      };
      if (!next.needsAi) aiResolved += 1;
    } catch (error) {
      ai = {
        ...ai,
        status: 'failed',
        consultedAt: new Date().toISOString(),
        error: clean(error && (error.code ? `${error.code}: ${error.message}` : error.message) || error, 500),
      };
    }
    return { analysis: next, ai };
  }

  for (const item of fetched) {
    const { target } = item;
    const old = snapshot.models && snapshot.models[target.plmId];

    /* LCW AI'ın ertelendiği/ulaşılamadığı kayıt fingerprint aynı olsa da
       yeniden çözümlenir; aksi hâlde "Kontrol gerekli" özet kalıcı olur. */
    const fullComponents=item.kind==='set'?item.children.flatMap(child=>(child.analysis.fullComponents||[]).map(component=>({...component,setPart:child.label,childPlmId:child.childPlmId,childStyleId:child.childStyleId}))):(item.analysis.fullComponents||[]);
    const fullFingerprint=require('crypto').createHash('sha256').update(JSON.stringify(fullComponents)).digest('hex');
    const fullEvidence={fullComponents,fullFingerprint,fullComponentCount:fullComponents.length,fullCoverage:'all-normalized'};
    const aiPending = Boolean(old && old.ai && ['failed', 'deferred'].includes(old.ai.status));
    if (old && !aiPending && old.styleId === target.styleId && old.fingerprint && old.fingerprint === item.fingerprint) {
      unchanged += 1;
      if (old.hasPrint) withPrint += 1;
      const upgraded=old.fullFingerprint===fullFingerprint?old:{...old,...fullEvidence,fetchedAt:new Date().toISOString()};
      if(upgraded!==old)toSave.push(upgraded);
      entries.set(target.plmId, upgraded);
      if (item.kind === 'set') {
        const fabrics = item.children.map(child => child.fabric).filter(Boolean);
        const fabricSummary = fabrics.length ? setStyleApi.componentLines(item.children, 'fabric', 'Kumaş bilgisi yok') : clean(old.fabricSummary, 5000);
        recordOverrides.set(target.plmId, {
          ...(fabricSummary ? { fabric: fabricSummary } : {}),
          artworkSummary: old.artworkSummary || old.summary || '',
          setStyleComponents: item.children.map(child => ({
            label: child.label, plmId: child.childPlmId, styleId: child.childStyleId,
            styleName: child.childStyleName, specialCode: child.specialCode, fabric: child.fabric,
          })),
        });
      }
      continue;
    }

    let entry;
    if (item.kind === 'set') {
      const setComponents = [];
      const placements = [];
      const components = [];
      for (const child of item.children) {
        const resolved = await resolveAi(child.analysis, `${target.plmId}/${child.label}`);
        const analysis = resolved.analysis;
        const childPlacements = analysis.placements.map(placement => ({
          ...placement,
          setPart: child.label,
          childStyleId: child.childStyleId,
          childPlmId: child.childPlmId,
          childStyleName: child.childStyleName,
        }));
        const childComponents = analysis.components.map(component => ({
          ...component,
          setPart: child.label,
          childStyleId: child.childStyleId,
          childPlmId: child.childPlmId,
          childStyleName: child.childStyleName,
        }));
        placements.push(...childPlacements);
        components.push(...childComponents);
        setComponents.push({
          label: child.label,
          childStyleId: child.childStyleId,
          childPlmId: child.childPlmId,
          childStyleName: child.childStyleName,
          specialCode: child.specialCode,
          fabric: child.fabric,
          productMainDefinition: child.productMainDefinition,
          perAssemblyCount: child.perAssemblyCount,
          styleBomId: analysis.styleBomId,
          hasPrint: analysis.hasPrint,
          totalPrintCount: analysis.totalPrintCount,
          bomSummary: analysis.summary,
          needsAi: analysis.needsAi,
          components: childComponents,
          placements: childPlacements,
          ai: resolved.ai,
        });
      }
      const totals = bomApi.summaryForPlacements(placements);
      const fabricValues = setComponents.map(child => child.fabric).filter(Boolean);
      const fabricSummary = fabricValues.length ? setStyleApi.componentLines(setComponents, 'fabric', 'Kumaş bilgisi yok') : '';
      const artworkSummary = setStyleApi.componentLines(setComponents, 'bomSummary', 'Baskı yok');
      entry = {
        plmId: target.plmId,
        styleId: target.styleId,
        styleBomId: '',
        isSetStyle: true,
        fetchedAt: new Date().toISOString(),
        sourceCreatedDate: null,
        sourceModifiedDate: null,
        fingerprint: item.fingerprint,
        fabricSummary,
        artworkSummary,
        setComponents,
        components,
        placements,
        hasPrint: totals.totalPrintCount > 0,
        totalPrintCount: totals.totalPrintCount,
        placementSummary: totals.placementSummary,
        techniqueSummary: totals.techniqueSummary,
        summary: artworkSummary || totals.summary,
        needsAi: setComponents.some(child => child.needsAi),
        ambiguousComponentCodes: placements.filter(placement => placement.placement === 'other')
          .map(placement => `${placement.setPart || '?'}:${placement.componentCode || placement.styleBomComponentId}`).filter(Boolean),
        ai: topAi(setComponents),
      };
      recordOverrides.set(target.plmId, {
        ...(fabricSummary ? { fabric: fabricSummary } : {}),
        artworkSummary,
        setStyleComponents: setComponents.map(child => ({
          label: child.label, plmId: child.childPlmId, styleId: child.childStyleId,
          styleName: child.childStyleName, specialCode: child.specialCode, fabric: child.fabric,
        })),
      });
    } else {
      const resolved = await resolveAi(item.analysis, target.plmId);
      const analysis = resolved.analysis;
      entry = {
        plmId: target.plmId,
        styleId: target.styleId,
        styleBomId: analysis.styleBomId,
        isSetStyle: false,
        fetchedAt: new Date().toISOString(),
        sourceCreatedDate: analysis.sourceCreatedDate,
        sourceModifiedDate: analysis.sourceModifiedDate,
        fingerprint: analysis.fingerprint,
        components: analysis.components,
        placements: analysis.placements,
        hasPrint: analysis.hasPrint,
        totalPrintCount: analysis.totalPrintCount,
        placementSummary: analysis.placementSummary,
        techniqueSummary: analysis.techniqueSummary,
        summary: analysis.summary,
        needsAi: analysis.needsAi,
        ambiguousComponentCodes: analysis.ambiguousComponentCodes,
        ai: resolved.ai,
      };
    }

    Object.assign(entry,fullEvidence);
    if (entry.hasPrint) withPrint += 1;
    entries.set(target.plmId, entry);
    toSave.push(entry);
  }

  /* Fetch hatası eski başarılı kaydı SİLMEZ; UI son bilinen kanıtı göstermeye
     devam eder. */
  for (const item of failed) {
    const old = snapshot.models && snapshot.models[item.plmId];
    if (old) {
      entries.set(item.plmId, old);
      if (old.isSetStyle && old.fabricSummary) {
        recordOverrides.set(item.plmId, { fabric: old.fabricSummary, artworkSummary: old.artworkSummary || old.summary || '' });
      }
    }
  }

  const saved = toSave.length ? store.saveResults(toSave) : { written: 0, revision: snapshot._revision || 0, updatedAt: snapshot._updatedAt || null };
  return {
    requested: targets.length,
    fetched: fetched.length,
    changed: toSave.length,
    unchanged,
    withPrint,
    aiConsulted,
    aiResolved,
    failed,
    entries,
    recordOverrides,
    revision: saved.revision,
    updatedAt: saved.updatedAt,
  };
}

module.exports = {
  BOM_FETCH_CONCURRENCY,
  MAX_AI_PER_SYNC,
  targetsFromRecords,
  aggregateSetFingerprint,
  aiTask,
  consultAi,
  syncPlmBoms,
  mapLimit,
};
