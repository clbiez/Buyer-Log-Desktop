'use strict';

const crypto = require('crypto');
function clean(value) { return String(value == null ? '' : value).trim(); }
function id(prefix) { return `${prefix}_${crypto.randomBytes(4).toString('hex')}`; }
function clone(value) { return JSON.parse(JSON.stringify(value)); }

const NODE_DEFS = Object.freeze({
  'trigger.manual': { label: 'Start', category: 'core', icon: '▶', description: 'Kullanıcı tarafından başlatılan workflow girişi.' },
  'agent.intent': { label: 'Understand Intent', category: 'core', icon: '◎', description: 'Görevin amacını ve beklenen sonucu kayda geçirir.' },
  'agent.planner': { label: 'Planner', category: 'core', icon: '◇', description: 'Plan metadata’sını yürütme context’ine ekler; execution yetkisi vermez.' },
  'policy.guard': { label: 'Policy Gate', category: 'core', icon: '⛨', description: 'Tool yetkisi, kullanıcı alanı ve onay gereksinimlerini deterministik olarak uygular.' },
  'tool.registry': { label: 'Tool Registry', category: 'core', icon: '▦', description: 'Workflow’u yalnız sunucuda kayıtlı ve tiplenmiş araçlara yönlendiren execution sınırını gösterir.' },
  'tool.call': { label: 'Tool', category: 'app', icon: '▣', description: 'Tool Registry içindeki izinli bir aracı çalıştırır.' },
  'control.if': { label: 'If / Else', category: 'control', icon: '⑂', description: 'Basit doğrulanabilir koşula göre true/false dalı seçer.' },
  'approval.gate': { label: 'Manual Approval', category: 'control', icon: '✓', description: 'Kullanıcı onayı gelene kadar yürütmeyi durdurur.' },
  'verify.result': { label: 'Verifier', category: 'core', icon: '✓', description: 'Beklenen sonuç ile gerçek sonucu karşılaştırır.' },
  'recovery.safe': { label: 'Recovery / Rollback', category: 'core', icon: '↶', description: 'Başarısızlıkta desteklenen rollback adımlarını güvenli biçimde geri alır.' },
  'audit.log': { label: 'Audit Log', category: 'core', icon: '≡', description: 'Çalışma context’ini ve sonucu audit event olarak kayda geçirir.' },
  'output.result': { label: 'Result', category: 'core', icon: '●', description: 'Workflow sonucunu kullanıcıya döndürür.' },
});

const TOOL_NODE_PRESETS = Object.freeze([
  { id: 'dataset.describe', label: 'Describe Dataset', category: 'query', icon: '◫' },
  { id: 'dataset.query', label: 'Dataset Query', category: 'query', icon: '⌕' },
  { id: 'dataset.aggregate', label: 'Dataset Aggregate', category: 'query', icon: 'Σ' },
  { id: 'app.refresh', label: 'Refresh Data', category: 'app', icon: '↻' },
  { id: 'app.order.update', label: 'Update Order', category: 'app', icon: '✎' },
  { id: 'report.summary', label: 'Result Summary', category: 'app', icon: '▤' },
  { id: 'connector.http', label: 'HTTP Connector', category: 'connector', icon: '◎' },
  { id: 'connector.browser.run', label: 'Browser Automation', category: 'connector', icon: '◉' },
]);

function node(type, label, x, y, config = {}) { return { id: id('node'), type, label, x, y, config: clone(config) }; }
function edge(from, to, channel = 'success') { return { id: id('edge'), from: from.id, to: to.id, channel }; }

function architectureTemplate() {
  const start = node('trigger.manual', 'User / UI', 60, 250);
  const intent = node('agent.intent', 'Agent Core · Intent', 300, 250);
  const planner = node('agent.planner', 'Planner', 540, 250);
  const policy = node('policy.guard', 'Rule / Permission / Policy', 780, 250);
  const registry = node('tool.registry', 'Tool Registry', 1020, 250);
  const query = node('tool.call', 'Query Tools', 1260, 120, { toolId: 'dataset.query', args: { source: 'cp', filters: [], fields: [], limit: 200 } });
  const app = node('tool.call', 'App Tools', 1260, 250, { disabled: true, toolId: 'report.summary', args: { title: 'Buyer Log Agent sonucu' } });
  const connector = node('tool.call', 'Connectors', 1260, 380, { disabled: true, toolId: 'connector.http', args: { url: '', method: 'GET' } });
  const verify = node('verify.result', 'Verifier', 1500, 250, { mode: 'not_empty' });
  const recovery = node('recovery.safe', 'Error / Recovery / Rollback', 1740, 390, { rollback: true });
  const audit = node('audit.log', 'Audit Log', 1740, 200);
  const output = node('output.result', 'Result', 1980, 200);
  return {
    name: 'Think → Plan → Act · Buyer Log',
    description: 'Doğal dil isteğini kontrollü tool yürütmesine, doğrulamaya, güvenli recovery’ye ve audit kaydına bağlayan başlangıç mimarisi.',
    nodes: [start, intent, planner, policy, registry, query, app, connector, verify, recovery, audit, output],
    edges: [
      edge(start, intent), edge(intent, planner), edge(planner, policy), edge(policy, registry),
      edge(registry, query), edge(registry, app), edge(registry, connector),
      edge(query, verify), edge(app, verify), edge(connector, verify),
      edge(verify, audit, 'success'), edge(verify, recovery, 'error'), edge(recovery, audit), edge(audit, output),
    ],
  };
}

function taskTemplate({ source = 'cp', filters = [], fields = [], title = 'Agent sonucu', aggregate = null } = {}) {
  const start = node('trigger.manual', 'Start', 70, 220);
  const intent = node('agent.intent', 'Understand Intent', 300, 220);
  const planner = node('agent.planner', 'Planner', 530, 220);
  const policy = node('policy.guard', 'Policy Gate', 760, 220);
  const query = node('tool.call', aggregate ? 'Aggregate Dataset' : 'Query Dataset', 1000, 220, {
    toolId: aggregate ? 'dataset.aggregate' : 'dataset.query',
    args: aggregate || { source, filters, fields, limit: 250 },
  });
  const verify = node('verify.result', 'Verifier', 1240, 220, { mode: 'not_empty' });
  const summary = node('tool.call', 'Build Summary', 1480, 220, { toolId: 'report.summary', args: { title } });
  const audit = node('audit.log', 'Audit Log', 1720, 220);
  const out = node('output.result', 'Result', 1960, 220);
  const recovery = node('recovery.safe', 'Recovery', 1480, 390, { rollback: true });
  return { name: title, description: '', nodes: [start, intent, planner, policy, query, verify, summary, recovery, audit, out], edges: [edge(start, intent), edge(intent, planner), edge(planner, policy), edge(policy, query), edge(query, verify), edge(verify, summary, 'success'), edge(verify, recovery, 'error'), edge(recovery, audit), edge(summary, audit), edge(audit, out)] };
}

function topologicalOrder(workflow) {
  const nodes = Array.isArray(workflow && workflow.nodes) ? workflow.nodes : [];
  const edges = Array.isArray(workflow && workflow.edges) ? workflow.edges : [];
  const ids = new Set(nodes.map(item => item.id));
  const incoming = new Map(nodes.map(item => [item.id, 0]));
  const outgoing = new Map(nodes.map(item => [item.id, []]));
  edges.forEach(item => { if (ids.has(item.from) && ids.has(item.to)) { incoming.set(item.to, (incoming.get(item.to) || 0) + 1); outgoing.get(item.from).push(item.to); } });
  const queue = [...incoming.entries()].filter(([, count]) => count === 0).map(([key]) => key);
  const order = [];
  while (queue.length) {
    const current = queue.shift(); order.push(current);
    for (const next of outgoing.get(current) || []) { incoming.set(next, incoming.get(next) - 1); if (incoming.get(next) === 0) queue.push(next); }
  }
  if (order.length !== nodes.length) throw Object.assign(new Error('Workflow döngü içeriyor. Döngüler bu sürümde kontrollü loop node olmadan kullanılamaz.'), { code: 'WORKFLOW_CYCLE' });
  return order;
}

function validateWorkflow(workflow, toolRegistry) {
  const errors = [], warnings = [];
  const nodes = Array.isArray(workflow && workflow.nodes) ? workflow.nodes : [];
  const edges = Array.isArray(workflow && workflow.edges) ? workflow.edges : [];
  if (!nodes.length) errors.push('Workflow en az bir node içermelidir.');
  if (nodes.length > 100) errors.push('Workflow 100 node sınırını aşıyor.');
  const ids = new Set();
  nodes.forEach(item => {
    if (!item.id || ids.has(item.id)) errors.push('Node ID değerleri benzersiz olmalıdır.');
    ids.add(item.id);
    if (!NODE_DEFS[item.type]) errors.push(`Desteklenmeyen node tipi: ${item.type || '(boş)'}`);
    if (item.type === 'tool.call') {
      const toolId = clean(item.config && item.config.toolId);
      if (!toolId || !toolRegistry || !toolRegistry.get(toolId)) errors.push(`Kayıtlı olmayan tool: ${toolId || '(boş)'}`);
    }
  });
  edges.forEach(item => {
    if (!ids.has(item.from) || !ids.has(item.to)) errors.push('Edge var olmayan bir node’a bağlı.');
    if (!['success', 'error', 'true', 'false'].includes(item.channel || 'success')) errors.push('Edge channel geçersiz.');
  });
  const startNodes = nodes.filter(item => item.type === 'trigger.manual');
  if (startNodes.length !== 1) errors.push('Workflow tam olarak bir Start node içermelidir.');
  try { topologicalOrder(workflow); } catch (err) { errors.push(err.message); }
  if (!nodes.some(item => item.type === 'verify.result')) warnings.push('Verifier node yok; sonuç doğrulaması sınırlı olacaktır.');
  if (!nodes.some(item => item.type === 'audit.log')) warnings.push('Audit Log node yok; runtime yine teknik event kaydı tutar ancak iş akışı audit noktası eksiktir.');
  return { valid: errors.length === 0, errors, warnings };
}

function nodeCatalog(toolCatalog = []) {
  const core = Object.entries(NODE_DEFS).map(([type, meta]) => ({ type, ...meta }));
  const tools = (toolCatalog || []).map(tool => ({ type: 'tool.call', toolId: tool.id, label: tool.label, category: tool.category || tool.kind || 'app', icon: TOOL_NODE_PRESETS.find(x => x.id === tool.id)?.icon || '▣', description: tool.description, risk: tool.risk, approval: Boolean(tool.approval), rollbackable: Boolean(tool.rollbackable) }));
  return { core, tools };
}

module.exports = { NODE_DEFS, architectureTemplate, taskTemplate, topologicalOrder, validateWorkflow, nodeCatalog };
