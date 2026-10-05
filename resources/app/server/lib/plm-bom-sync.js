'use strict';

/* PLM BOM senkronu.
 *
 * 1) CoreNectum GetStyleBomInformation her styleId için alınır.
 * 2) Açık/standart yerleşimler deterministik çözümlenir.
 * 3) Yalnız belirsiz Print satırları LCW AI'a danışılır.
 * 4) BOM fingerprint değişmediyse LCW AI tekrar çağrılmaz.
 * 5) BOM/AI hatası ana PLM Sync'i düşürmez; eski başarılı kayıt korunur.
 */
const bomApi = require('./corenectum-bom-api');
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
  const runners = Array.from({ length: Math.min(Math.max(1, limit), items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      await worker(items[index], index);
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
    out.push({ plmId, styleId, styleName: clean(record && record.styleName, 300) });
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

async function syncPlmBoms(records, options = {}) {
  const ownerId = clean(options.ownerId, 160) || 'default';
  const store = options.store || defaultStore;
  const postJson = options.postJson || ((url, body, requestOptions) => coreNectumApiClient.postJson(ownerId, url, body, requestOptions));
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : () => {};
  const targets = targetsFromRecords(records);
  const snapshot = store.load();
  const fetched = [];
  const failed = [];
  let done = 0;

  await mapLimit(targets, Number(options.fetchConcurrency) || BOM_FETCH_CONCURRENCY, async target => {
    try {
      const payload = await postJson(
        bomApi.GET_STYLE_BOM_INFORMATION_URL,
        bomApi.bomRequestBody(target.styleId),
        { timeoutMs: 60000, retries: 3, language: options.language }
      );
      const analysis = bomApi.analyzeBom(payload);
      if (analysis.styleId && analysis.styleId !== target.styleId) {
        throw Object.assign(new Error(`BOM styleId uyuşmuyor: beklenen ${target.styleId}, gelen ${analysis.styleId}.`), { code: 'PLM_BOM_STYLE_MISMATCH' });
      }
      fetched.push({ target, analysis: { ...analysis, styleId: target.styleId } });
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
  for (let index = 0; index < fetched.length; index += 1) {
    const { target } = fetched[index];
    let { analysis } = fetched[index];
    const old = snapshot.models && snapshot.models[target.plmId];
    if (old && old.styleId === target.styleId && old.fingerprint && old.fingerprint === analysis.fingerprint) {
      unchanged += 1;
      if (old.hasPrint) withPrint += 1;
      entries.set(target.plmId, old);
      continue;
    }

    let ai = { status: 'not-needed', model: '', consultedAt: null, confidence: '', notes: [], error: '' };
    if (analysis.needsAi) {
      if (aiConsulted >= (Number(options.maxAiPerSync) || MAX_AI_PER_SYNC)) {
        ai = { ...ai, status: 'deferred', error: 'AI consultation limit reached for this sync.' };
      } else {
        aiConsulted += 1;
        onProgress({ phase: options.language === 'en' ? 'Consulting LCW AI for BOM' : 'BOM için LCW AI ile istişare ediliyor', current: aiConsulted, total: fetched.filter(item => item.analysis.needsAi).length, model: target.plmId });
        try {
          const consulted = await consultAi(ownerId, analysis, options);
          analysis = bomApi.mergeAiAnalysis(analysis, consulted.parsed);
          const confidence = ['high', 'medium', 'low'].includes(clean(consulted.parsed.confidence, 20).toLowerCase())
            ? clean(consulted.parsed.confidence, 20).toLowerCase() : '';
          ai = {
            status: analysis.needsAi ? 'partial' : 'resolved',
            model: clean(consulted.result && consulted.result.model && consulted.result.model.key, 80),
            consultedAt: new Date().toISOString(),
            confidence,
            notes: (Array.isArray(consulted.parsed.notes) ? consulted.parsed.notes : []).slice(0, 10).map(item => clean(item, 500)).filter(Boolean),
            error: '',
          };
          if (!analysis.needsAi) aiResolved += 1;
        } catch (error) {
          ai = {
            ...ai,
            status: 'failed',
            consultedAt: new Date().toISOString(),
            error: clean(error && (error.code ? `${error.code}: ${error.message}` : error.message) || error, 500),
          };
        }
      }
    }

    if (analysis.hasPrint) withPrint += 1;
    const entry = {
      plmId: target.plmId,
      styleId: target.styleId,
      styleBomId: analysis.styleBomId,
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
      ai,
    };
    entries.set(target.plmId, entry);
    toSave.push(entry);
  }

  /* Fetch hatası eski başarılı kaydı SİLMEZ; UI son bilinen kanıtı göstermeye
     devam eder. */
  for (const item of failed) {
    const old = snapshot.models && snapshot.models[item.plmId];
    if (old) entries.set(item.plmId, old);
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
    revision: saved.revision,
    updatedAt: saved.updatedAt,
  };
}

module.exports = {
  BOM_FETCH_CONCURRENCY,
  MAX_AI_PER_SYNC,
  targetsFromRecords,
  aiTask,
  consultAi,
  syncPlmBoms,
  mapLimit,
};
