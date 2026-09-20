'use strict';

const { taskTemplate, architectureTemplate, validateWorkflow } = require('./agent-graph');
const aiSettings = require('./agent-ai-settings');
const gateway = require('./ai-provider-gateway');

function clean(value) { return String(value == null ? '' : value).trim(); }
function lower(value) { return clean(value).toLocaleLowerCase('tr-TR'); }
function clone(value) { return JSON.parse(JSON.stringify(value)); }

function providerStatus() { return aiSettings.publicSettings(); }

function inferSource(prompt) {
  const p = lower(prompt);
  if (/\blfl\b/.test(p)) return 'lfl';
  if (/backlog|bekleyen/.test(p)) return 'backlog';
  if (/koleksiyon|collection/.test(p)) return 'collection';
  if (/siparişler|orders/.test(p)) return 'orders';
  return 'cp';
}
function extractFilters(prompt) {
  const p = clean(prompt), filters = [];
  const status = /status\s*[:=]?\s*["“]?([^,"”\n]+)/i.exec(p); if (status) filters.push({ field: 'STATUS', operator: 'contains', value: status[1].trim() });
  const priority = /priority\s*[:=]?\s*["“]?([^,"”\n]+)/i.exec(p); if (priority) filters.push({ field: 'Priority', operator: 'contains', value: priority[1].trim() });
  /* Sabit bir tarih gömmek, planlı bir otomasyonu kurulduğu güne dondururdu:
     sonraki koşularda o günden sonra geciken siparişler hiç görünmezdi.
     @today çalışma anında çözülür (bkz. automationResolveFilterValue). */
  if (/teslim tarihi geçen|geciken|geçmiş teslim/i.test(p)) filters.push({ field: 'Retail Date', operator: 'lt', value: '@today' });
  if (/üretim bilgisi eksik|üretici eksik|manufacturer.*eksik/i.test(p)) filters.push({ field: 'Manufacturer', operator: 'empty', value: '' });
  return filters;
}
function fallbackPlan(prompt) {
  const p = lower(prompt), source = inferSource(prompt), filters = extractFilters(prompt);
  if (/yenile|refresh|güncel ver/i.test(p)) {
    const graph = taskTemplate({ source, filters, title: clean(prompt).slice(0, 100) || 'Veri yenileme' });
    const toolNode = graph.nodes.find(item => item.type === 'tool.call' && item.config.toolId === 'dataset.query');
    if (toolNode) { toolNode.label = 'Refresh Data'; toolNode.config = { toolId: 'app.refresh', args: { targets: source === 'collection' ? ['cp', 'orders', 'backlog', 'lfl'] : [source] } }; }
    return { summary: 'AI Planner bağlı olmadığı için başlangıç workflow’u güvenli yerel planlayıcıyla oluşturuldu.', assumptions: [], warnings: ['Yazma veya dış sistem işlemleri otomatik tahmin edilmez.'], workflow: graph, provider: 'fallback' };
  }
  const graph = taskTemplate({ source, filters, title: clean(prompt).slice(0, 100) || 'Yeni Agent görevi' });
  return { summary: 'AI Planner bağlı olmadığı için veri sorgusu ağırlıklı workflow güvenli yerel planlayıcıyla oluşturuldu.', assumptions: [], warnings: filters.length ? [] : ['Görevde açık filtre bulunmadı. AI Planner bağlanana kadar sorgu kriterlerini workflow üzerinde kontrol edin.'], workflow: graph, provider: 'fallback' };
}

function planSchema(toolCatalog) {
  const toolIds = (toolCatalog || []).map(item => item.id);
  return {
    type: 'object', additionalProperties: false,
    properties: {
      summary: { type: 'string' },
      assumptions: { type: 'array', items: { type: 'string' } },
      warnings: { type: 'array', items: { type: 'string' } },
      workflow: {
        type: 'object', additionalProperties: false,
        properties: {
          name: { type: 'string' }, description: { type: 'string' },
          nodes: { type: 'array', maxItems: 40, items: { type: 'object', additionalProperties: false, properties: {
            id: { type: 'string' }, type: { type: 'string', enum: ['trigger.manual','agent.intent','agent.planner','policy.guard','tool.registry','tool.call','control.if','approval.gate','verify.result','recovery.safe','audit.log','output.result'] },
            label: { type: 'string' }, x: { type: 'number' }, y: { type: 'number' }, config: { type: 'object', additionalProperties: true },
          }, required: ['id','type','label','x','y','config'] } },
          edges: { type: 'array', maxItems: 70, items: { type: 'object', additionalProperties: false, properties: {
            id: { type: 'string' }, from: { type: 'string' }, to: { type: 'string' }, channel: { type: 'string', enum: ['success','error','true','false'] },
          }, required: ['id','from','to','channel'] } },
        }, required: ['name','description','nodes','edges'],
      },
    }, required: ['summary','assumptions','warnings','workflow'],
    $defs: { allowedToolIds: { enum: toolIds.length ? toolIds : ['dataset.query'] } },
  };
}

async function openAiPlan(prompt, toolRegistry) {
  const creds = aiSettings.credentials();
  const tools = toolRegistry.catalog();
  const instructions = [
    'You are the planning layer for Buyer Log. Return a declarative workflow graph only; you never execute tools.',
    'Execution is controlled by deterministic policy. Never invent tool IDs. Never request shell, eval, arbitrary code, source-code modification, credential access or unrestricted URLs.',
    'Prefer existing Buyer Log tools as the single source of truth. Use a verifier after operational/write/external actions. Use approval.gate before risky actions when useful.',
    `Allowed tools: ${tools.map(t => `${t.id}: ${t.description}`).join(' | ')}`,
    'Every workflow must have exactly one trigger.manual node and should normally end with audit.log then output.result.',
    'For tool.call nodes put config.toolId and config.args. Use dataset.query for investigation before changing data when the request is ambiguous.',
    'Browser rule: connector.browser.run may only replay browser steps already recorded/taught by the user. Never invent selectors, clicks, form values, browser scripts or navigation steps. If no recorded steps exist, plan investigation/recording as a required user setup instead of fabricating automation.',
    'For batch browser replay, pass query rows through config.args.items using a typed template such as {{nodes.<queryNodeId>.output.rows}} (or {{input.rows}} when the query is the direct predecessor). Recorded step values may contain {{item.<Field Name>}} and {{index}} placeholders. Browser runs are external actions: preserve approval and add verification after them.',
  ].join('\n');
  const provider = gateway.createProvider(creds);
  const schema = planSchema(tools);
  const response = await provider.chat([
    { role: 'system', content: instructions },
    { role: 'user', content: clean(prompt).slice(0, 12000) },
  ], {
    format: creds.provider === 'ollama' ? schema : undefined,
    responseFormat: creds.provider === 'ollama' ? undefined : { type: 'json_object' },
    options: { temperature: 0.1, num_predict: 1800, max_tokens: 1800 },
  });
  const output = clean(response.content).replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  const parsed = JSON.parse(output);
  const valid = validateWorkflow(parsed.workflow, toolRegistry);
  if (!valid.valid) throw Object.assign(new Error(`AI planı güvenlik doğrulamasını geçmedi: ${valid.errors.join(' · ')}`), { code: 'AI_PLAN_INVALID', statusCode: 422 });
  parsed.provider = creds.provider; parsed.model = creds.model; parsed.validation = valid;
  return parsed;
}

async function planTask(prompt, toolRegistry) {
  const text = clean(prompt); if (!text) throw Object.assign(new Error('Doğal dil görevi zorunludur.'), { code: 'PROMPT_REQUIRED', statusCode: 400 });
  const status = providerStatus();
  if (!status.configured) return fallbackPlan(text);
  try { return await openAiPlan(text, toolRegistry); }
  catch (error) {
    const fallback = fallbackPlan(text);
    fallback.warnings.unshift(`AI planlayıcı kullanılamadı: ${error.message}. Güvenli yerel plan üretildi.`);
    fallback.providerError = { code: error.code || 'AI_PROVIDER_ERROR', message: error.message };
    return fallback;
  }
}

async function discoverModels(overrides = {}) {
  const creds = aiSettings.credentials(overrides);
  const models = await gateway.createProvider(creds).listModels();
  return { provider:creds.provider, model:creds.model, selected:models.some(item => item.name === creds.model || item.name.startsWith(`${creds.model}:`)), models, recommendedModels:gateway.recommendedModels() };
}

async function pullModel(model, overrides = {}, onProgress = null) {
  const creds = aiSettings.credentials({ ...overrides, model:model || overrides.model });
  return gateway.createProvider(creds).pullModel(model || creds.model, onProgress);
}

async function removeModel(model, overrides = {}) {
  const creds = aiSettings.credentials({ ...overrides, model:model || overrides.model });
  return gateway.createProvider(creds).removeModel(model || creds.model);
}

async function updateAll(overrides = {}, onProgress = null) {
  const discovered = await discoverModels(overrides);
  const results = [];
  for (const item of discovered.models) results.push(await pullModel(item.name, overrides, onProgress));
  return { provider:discovered.provider, results };
}

module.exports = {
  providerStatus, planTask, fallbackPlan, architectureTemplate, planSchema,
  saveSettings:aiSettings.saveSettings, testConnection:aiSettings.testConnection,
  discoverModels, pullModel, removeModel, updateAll,
};
