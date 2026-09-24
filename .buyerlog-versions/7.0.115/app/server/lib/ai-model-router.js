'use strict';

/*
 * Buyer Log AI Model Router
 *
 * Görev → kapasite → model eşlemesi burada yaşar. Agent (copilot-agent.js)
 * hiçbir model/sağlayıcı adı bilmez; yalnız bu router'dan sıralı bir aday
 * listesi ister ve sırayla dener. Yeni bir NVIDIA modeli eklendiğinde ya da
 * bir modelin sağlığı değiştiğinde burası hiç değişmez — kaynak veri
 * ai-model-registry.js (statik kapasite) ve agent-ai-settings.js (kullanıcı
 * ayarı + canlı sağlık durumu) üzerinden akar.
 */

const registry = require('./ai-model-registry');

function clean(value) { return String(value == null ? '' : value).trim(); }

/* Bir NVIDIA modelinin şu an Auto Router tarafından DENENEBİLİR olup
   olmadığı: deprecated, devre dışı bırakılmış ya da kimlik/oran-sınırı
   hatası almış modeller asla otomatik seçilmez (bkz. kullanıcı talebi §12).
   "unavailable" (geçici — timeout/offline) hâlâ denenebilir; sağlayıcı
   sorunları geçici olabilir ve bir sonraki istek düzelmiş olabilir. */
function isSelectable(modelEntry, healthEntry, overrides) {
  if (!modelEntry || modelEntry.deprecated) return false;
  if (overrides && overrides[modelEntry.modelId] === false) return false;
  const status = healthEntry && healthEntry.status;
  if (status === 'auth-error' || status === 'deprecated') return false;
  return true;
}

/* task.requireVision / task.requireTools / task.minContext görev
   sinyalleridir; Agent bunları soru/ekli görsel/geçmiş uzunluğuna bakarak
   üretir. Router burada YALNIZ eşleştirme yapar, sinyal üretmez. */
function scoreModel(modelEntry, task) {
  if (task.requireVision && !modelEntry.vision) return -1;
  if (task.requireTools && !modelEntry.toolCalling) return -1;
  if (task.requireStructuredOutput && !modelEntry.structuredOutput) return -1;
  if (task.minContext && modelEntry.contextLength < task.minContext) return -1;
  let score = 0;
  const uses = Array.isArray(modelEntry.recommendedUse) ? modelEntry.recommendedUse : [];
  const taskTags = Array.isArray(task.tags) ? task.tags : [];
  taskTags.forEach(tag => { if (uses.includes(tag)) score += 10; });
  if (task.requireVision && modelEntry.vision) score += 5;
  if (task.requireTools && modelEntry.toolCalling) score += 2;
  // Daha uzun bağlam desteği eşit puanlı adaylar arasında hafif tercih
  // sebebidir — ama tek başına sıralamayı belirlemez.
  score += Math.min(3, Math.floor((modelEntry.contextLength || 0) / 400000));
  return score;
}

/* Sıralı NVIDIA aday listesi üretir. `excludeModelIds` aynı istekte daha
   önce denenip başarısız olmuş modelleri dışlar — aynı modeli tekrar
   denemek anlamsız bir döngü üretirdi (bkz. kullanıcı talebi §9). */
function rankNvidiaCandidates({ task = {}, health = {}, overrides = {}, excludeModelIds = [] } = {}) {
  const excluded = new Set((Array.isArray(excludeModelIds) ? excludeModelIds : []).map(clean));
  const models = registry.listNvidiaModels({ includeDeprecated: false })
    .filter(model => !excluded.has(model.modelId))
    .filter(model => isSelectable(model, health[model.modelId], overrides));
  return models
    .map(model => ({ model, score: scoreModel(model, task) }))
    .filter(item => item.score >= 0)
    .sort((a, b) => b.score - a.score)
    .map(item => item.model);
}

/* Görev sinyallerini soru metni + bağlamdan üretir. Agent bu fonksiyonu
   çağırıp router'ın geri kalanına ham sinyal yerine normalize edilmiş bir
   `task` nesnesi verir. */
function inferTask({ question, hasImageAttachment, historyChars, requireTools } = {}) {
  const text = clean(question).toLocaleLowerCase('tr-TR');
  const tags = [];
  if (hasImageAttachment) tags.push('multimodal', 'image-understanding', 'document-understanding');
  if (/kod|coding|fonksiyon|hata ayıkla|debug|script/.test(text)) tags.push('coding');
  if (/analiz|karşılaştır|neden|risk|trend|değerlendir/.test(text)) tags.push('reasoning', 'agentic-analysis');
  if (!tags.length) tags.push('general', 'agent');
  return {
    tags,
    requireVision: Boolean(hasImageAttachment),
    requireTools: requireTools !== false,
    requireStructuredOutput: true,
    minContext: Number(historyChars) > 24000 ? 200000 : undefined,
  };
}

module.exports = { rankNvidiaCandidates, inferTask, scoreModel, isSelectable };
