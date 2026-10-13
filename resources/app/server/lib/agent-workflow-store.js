'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { SERVER_DATA_ROOT, atomicWriteJson } = require('../user-data');

const STORE_FILE = path.join(SERVER_DATA_ROOT, 'agent-platform.json');
const SCHEMA_VERSION = 1;
const MAX_WORKFLOWS = 120;
const MAX_RUNS = 400;
const MAX_EVENTS_PER_RUN = 300;
const LEGACY_AGENT_ARTIFACTS = [
  path.join(SERVER_DATA_ROOT, 'agents.json'),
  path.join(SERVER_DATA_ROOT, 'agents.json.bak'),
  path.join(SERVER_DATA_ROOT, 'web-agent-profiles'),
];

function purgeLegacyAgentArtifacts() {
  for (const target of LEGACY_AGENT_ARTIFACTS) {
    try { fs.rmSync(target, { recursive: true, force: true }); } catch (_) {}
  }
}
purgeLegacyAgentArtifacts();

function clean(value) { return String(value == null ? '' : value).trim(); }
function iso(value = Date.now()) { return new Date(value).toISOString(); }
function makeId(prefix) { return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(5).toString('hex')}`; }
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function number(value, fallback = 0) { const n = Number(value); return Number.isFinite(n) ? n : fallback; }

function defaultStore() {
  return { schemaVersion: SCHEMA_VERSION, workflows: [], runs: [], revision: 0, updatedAt: null };
}

function normalizeNode(raw, index = 0) {
  const item = raw && typeof raw === 'object' ? raw : {};
  return {
    id: clean(item.id) || makeId(`node${index + 1}`),
    type: clean(item.type).slice(0, 80),
    label: clean(item.label).slice(0, 160),
    x: Math.max(-5000, Math.min(5000, number(item.x, 100 + index * 220))),
    y: Math.max(-5000, Math.min(5000, number(item.y, 120))),
    config: item.config && typeof item.config === 'object' && !Array.isArray(item.config) ? clone(item.config) : {},
  };
}

function normalizeEdge(raw, index = 0) {
  const item = raw && typeof raw === 'object' ? raw : {};
  const channel = ['success', 'error', 'true', 'false'].includes(clean(item.channel)) ? clean(item.channel) : 'success';
  return {
    id: clean(item.id) || makeId(`edge${index + 1}`),
    from: clean(item.from).slice(0, 120),
    to: clean(item.to).slice(0, 120),
    channel,
  };
}

function normalizeWorkflow(raw, ownerId = '') {
  const item = raw && typeof raw === 'object' ? raw : {};
  const now = iso();
  const nodes = (Array.isArray(item.nodes) ? item.nodes : []).slice(0, 100).map(normalizeNode);
  const nodeIds = new Set(nodes.map(node => node.id));
  const edges = (Array.isArray(item.edges) ? item.edges : []).slice(0, 160).map(normalizeEdge)
    .filter(edge => edge.from && edge.to && edge.from !== edge.to && nodeIds.has(edge.from) && nodeIds.has(edge.to));
  return {
    id: clean(item.id) || makeId('wf'),
    ownerId: clean(ownerId || item.ownerId),
    name: (clean(item.name) || 'Yeni workflow').slice(0, 160),
    description: clean(item.description).slice(0, 4000),
    enabled: item.enabled !== false,
    nodes,
    edges,
    createdAt: clean(item.createdAt) || now,
    updatedAt: clean(item.updatedAt) || now,
    revision: Math.max(0, Math.floor(number(item.revision, 0))),
  };
}

function normalizeRun(raw) {
  const item = raw && typeof raw === 'object' ? raw : {};
  return {
    id: clean(item.id) || makeId('run'),
    workflowId: clean(item.workflowId),
    ownerId: clean(item.ownerId),
    workflowName: clean(item.workflowName).slice(0, 160),
    status: ['queued', 'running', 'waiting_approval', 'completed', 'failed', 'cancelled', 'dry_run'].includes(clean(item.status)) ? clean(item.status) : 'queued',
    dryRun: item.dryRun === true,
    input: item.input && typeof item.input === 'object' ? clone(item.input) : {},
    output: item.output == null ? null : clone(item.output),
    currentNodeId: clean(item.currentNodeId),
    pendingApproval: item.pendingApproval && typeof item.pendingApproval === 'object' ? clone(item.pendingApproval) : null,
    executionState: item.executionState && typeof item.executionState === 'object' ? clone(item.executionState) : {},
    rollbackStack: Array.isArray(item.rollbackStack) ? clone(item.rollbackStack).slice(-100) : [],
    events: Array.isArray(item.events) ? clone(item.events).slice(-MAX_EVENTS_PER_RUN) : [],
    cancelReason: clean(item.cancelReason).slice(0, 80),
    message: clean(item.message).slice(0, 2000),
    createdAt: clean(item.createdAt) || iso(),
    updatedAt: clean(item.updatedAt) || clean(item.createdAt) || iso(),
    finishedAt: clean(item.finishedAt),
  };
}

function loadStore() {
  fs.mkdirSync(SERVER_DATA_ROOT, { recursive: true });
  if (!fs.existsSync(STORE_FILE)) return defaultStore();
  try {
    const raw = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
    const store = defaultStore();
    store.revision = Math.max(0, Math.floor(number(raw && raw.revision, 0)));
    store.updatedAt = clean(raw && raw.updatedAt) || null;
    store.workflows = (Array.isArray(raw && raw.workflows) ? raw.workflows : []).slice(0, MAX_WORKFLOWS).map(item => normalizeWorkflow(item));
    store.runs = (Array.isArray(raw && raw.runs) ? raw.runs : []).slice(0, MAX_RUNS).map(normalizeRun);
    return store;
  } catch (_) { return defaultStore(); }
}

function saveStore(store) {
  const next = {
    schemaVersion: SCHEMA_VERSION,
    workflows: (store.workflows || []).slice(0, MAX_WORKFLOWS),
    runs: (store.runs || []).slice(0, MAX_RUNS),
    revision: Math.max(0, number(store.revision, 0)) + 1,
    updatedAt: iso(),
  };
  atomicWriteJson(STORE_FILE, next);
  return next;
}

function mutate(mutator) {
  return require('./shared-file-transaction').withFileLeaseSync(STORE_FILE, () => {
    const store = loadStore();
    const result = mutator(store);
    const saved = saveStore(store);
    return { result: clone(result), revision: saved.revision };
  });
}

function stateForOwner(ownerId) {
  const key = clean(ownerId), store = loadStore();
  return {
    workflows: store.workflows.filter(item => item.ownerId === key).map(clone),
    runs: store.runs.filter(item => item.ownerId === key).slice(0, 100).map(clone),
    revision: store.revision,
    updatedAt: store.updatedAt,
  };
}

function createWorkflow(ownerId, value) {
  return mutate(store => {
    const now = iso();
    const workflow = normalizeWorkflow({ ...(value || {}), id: makeId('wf'), ownerId, createdAt: now, updatedAt: now, revision: 1 }, ownerId);
    store.workflows.unshift(workflow);
    if (store.workflows.length > MAX_WORKFLOWS) store.workflows.length = MAX_WORKFLOWS;
    return workflow;
  });
}

function updateWorkflow(ownerId, workflowId, value) {
  return mutate(store => {
    const index = store.workflows.findIndex(item => item.id === clean(workflowId) && item.ownerId === clean(ownerId));
    if (index < 0) throw Object.assign(new Error('Workflow bulunamadı.'), { statusCode: 404, code: 'WORKFLOW_NOT_FOUND' });
    const previous = store.workflows[index];
    const workflow = normalizeWorkflow({
      ...previous, ...(value || {}), id: previous.id, ownerId: previous.ownerId, createdAt: previous.createdAt,
      updatedAt: iso(), revision: previous.revision + 1,
    }, previous.ownerId);
    store.workflows[index] = workflow;
    return workflow;
  });
}

function deleteWorkflow(ownerId, workflowId) {
  return mutate(store => {
    const index = store.workflows.findIndex(item => item.id === clean(workflowId) && item.ownerId === clean(ownerId));
    if (index < 0) throw Object.assign(new Error('Workflow bulunamadı.'), { statusCode: 404, code: 'WORKFLOW_NOT_FOUND' });
    return store.workflows.splice(index, 1)[0];
  });
}

function workflowForOwner(ownerId, workflowId) {
  return stateForOwner(ownerId).workflows.find(item => item.id === clean(workflowId)) || null;
}

function createRun(ownerId, workflow, { input = {}, dryRun = false } = {}) {
  return mutate(store => {
    const run = normalizeRun({
      id: makeId('run'), workflowId: workflow.id, workflowName: workflow.name, ownerId,
      status: dryRun ? 'dry_run' : 'queued', dryRun, input, createdAt: iso(), updatedAt: iso(), events: [], executionState: {}, rollbackStack: [],
    });
    store.runs.unshift(run);
    if (store.runs.length > MAX_RUNS) store.runs.length = MAX_RUNS;
    return run;
  });
}

function updateRun(ownerId, runId, patch, expected = null) {
  return mutate(store => {
    const index = store.runs.findIndex(item => item.id === clean(runId) && item.ownerId === clean(ownerId));
    if (index < 0) throw Object.assign(new Error('Agent çalışması bulunamadı.'), { statusCode: 404, code: 'RUN_NOT_FOUND' });
    const previous = store.runs[index];
    if(expected&&(previous.status!==expected.status||previous.pendingApproval?.nodeId!==expected.nodeId))throw Object.assign(new Error('Run approval was already reserved.'),{code:'RUN_NOT_WAITING_APPROVAL',statusCode:409});
    const next = normalizeRun({ ...previous, ...(patch || {}), id: previous.id, ownerId: previous.ownerId, workflowId: previous.workflowId, workflowName: previous.workflowName, createdAt: previous.createdAt, updatedAt: iso() });
    store.runs[index] = next;
    return next;
  });
}

function appendEvent(ownerId, runId, event) {
  return mutate(store => {
    const run = store.runs.find(item => item.id === clean(runId) && item.ownerId === clean(ownerId));
    if (!run) throw Object.assign(new Error('Agent çalışması bulunamadı.'), { statusCode: 404, code: 'RUN_NOT_FOUND' });
    run.events = Array.isArray(run.events) ? run.events : [];
    run.events.push({ at: iso(), ...(event || {}) });
    if (run.events.length > MAX_EVENTS_PER_RUN) run.events = run.events.slice(-MAX_EVENTS_PER_RUN);
    run.updatedAt = iso();
    return run;
  });
}

function runForOwner(ownerId, runId) {
  return stateForOwner(ownerId).runs.find(item => item.id === clean(runId)) || null;
}

module.exports = {
  STORE_FILE, SCHEMA_VERSION, LEGACY_AGENT_ARTIFACTS, purgeLegacyAgentArtifacts, normalizeWorkflow, stateForOwner, workflowForOwner,
  createWorkflow, updateWorkflow, deleteWorkflow, createRun, updateRun, appendEvent, runForOwner,
};
