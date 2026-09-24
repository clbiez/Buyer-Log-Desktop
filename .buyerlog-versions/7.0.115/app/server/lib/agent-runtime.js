'use strict';

const { topologicalOrder, validateWorkflow } = require('./agent-graph');
const { compare, getField } = require('./agent-tool-registry');

function clean(value) { return String(value == null ? '' : value).trim(); }
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function isEmpty(value) {
  if (value == null || value === '') return true;
  if (Array.isArray(value)) return value.length === 0;
  if (value && typeof value === 'object') {
    if (Object.prototype.hasOwnProperty.call(value, 'matched')) return Number(value.matched) <= 0;
    if (Object.prototype.hasOwnProperty.call(value, 'rows') && Array.isArray(value.rows)) return value.rows.length === 0;
    return Object.keys(value).length === 0;
  }
  return false;
}
function valueAt(source, pathText) {
  const path = clean(pathText); if (!path) return source;
  return path.split('.').reduce((current, key) => current == null ? undefined : current[key], source);
}
function activeChannel(state) {
  if (!state) return null;
  if (state.status === 'error') return 'error';
  if (state.status === 'success' || state.status === 'skipped') {
    if (state.branch === true) return 'true';
    if (state.branch === false) return 'false';
    return 'success';
  }
  return null;
}
function edgeMatches(edge, state) {
  const channel = activeChannel(state); if (!channel) return false;
  if (edge.channel === 'true' || edge.channel === 'false') return edge.channel === channel;
  if (channel === 'true' || channel === 'false') return edge.channel === 'success';
  return (edge.channel || 'success') === channel;
}
function mergedInput(nodeId, workflow, state, runInput) {
  const incoming = (workflow.edges || []).filter(edge => edge.to === nodeId);
  if (!incoming.length) return runInput;
  const active = incoming.filter(edge => edgeMatches(edge, state[edge.from])).map(edge => state[edge.from] && state[edge.from].output);
  if (!active.length) return undefined;
  return active.length === 1 ? active[0] : { branches: active };
}
function predecessorsSettled(nodeId, workflow, state) {
  const incoming = (workflow.edges || []).filter(edge => edge.to === nodeId);
  if (!incoming.length) return true;
  return incoming.every(edge => state[edge.from] && ['success','error','skipped'].includes(state[edge.from].status));
}
function compact(value, depth = 0) {
  if (depth > 5) return '[depth-limit]';
  if (typeof value === 'string') return value.length > 5000 ? `${value.slice(0, 5000)}…` : value;
  if (Array.isArray(value)) return value.slice(0, 80).map(item => compact(item, depth + 1));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).slice(0, 80).map(([key, item]) => [key, compact(item, depth + 1)]));
  return value;
}

function classifyFailure(value) {
  const source = value && typeof value === 'object' ? value : { error: String(value || '') };
  const code = clean(source.code || source.errorContext && source.errorContext.code).toUpperCase();
  const message = clean(source.error || source.message || source.errorContext && source.errorContext.error).toLocaleLowerCase('tr-TR');
  const combined = `${code} ${message}`;
  if (/AUTH|401|UNAUTHORIZED|login|oturum|kimlik/.test(combined)) return { category:'authentication', rootCause:'Kimlik doğrulama veya oturum erişimi başarısız görünüyor.', safeAction:'Kimlik bilgisini Agent’a vermeden bağlantı/oturum yapılandırmasını kullanıcı veya yönetici kontrol etmeli.' };
  if (/FORBIDDEN|PERMISSION|AREA_FORBIDDEN|403|yetki|izin/.test(combined)) return { category:'permission', rootCause:'İşlem mevcut kullanıcı yetkisi veya policy sınırına takıldı.', safeAction:'Yetki yükseltme otomatik yapılmaz; doğru kullanıcı/alan izni doğrulanmalı.' };
  if (/TIMEOUT|ABORT|ETIMEDOUT|timeout|zaman aş/.test(combined)) return { category:'timeout', rootCause:'Kaynak veya connector zaman aşımına uğradı.', safeAction:'Read-only işlemse yeniden deneme değerlendirilebilir; write/external işlem kullanıcı onayı olmadan tekrarlanmaz.' };
  if (/MAPPING|FIELD|COLUMN|schema|alan|kolon|eşle/.test(combined)) return { category:'mapping', rootCause:'Beklenen alan veya veri şeması ile güncel kaynak arasında uyumsuzluk olabilir.', safeAction:'Canlı dataset şemasını Describe Dataset ile yeniden inceleyip sorgu parametrelerini güncelle.' };
  if (/VALIDATION|WORKFLOW_INVALID|DATASET_INVALID|ORDER_CODE_REQUIRED|geçersiz|zorunlu/.test(combined)) return { category:'validation', rootCause:'Workflow veya tool parametreleri doğrulama kurallarını karşılamadı.', safeAction:'Parametreleri değiştirmeden önce ilgili node ve input verisini kontrol et.' };
  if (/CONNECTOR|ENOTFOUND|ECONN|network|bağlant/.test(combined)) return { category:'connection', rootCause:'Harici bağlantı veya endpoint erişimi başarısız oldu.', safeAction:'Allowlist, HTTPS endpoint ve servis erişilebilirliğini kontrol et; credential verisini workflow içine yazma.' };
  if (/VERIFICATION_FAILED|verify|doğrula/.test(combined)) return { category:'verification', rootCause:'İşlem sonucu beklenen doğrulama koşulunu karşılamadı.', safeAction:'Başarılı kabul etme; eksik/farklı sonucu araştır ve gerekiyorsa desteklenen değişiklikleri rollback et.' };
  return { category:'unknown', rootCause:'Hata mevcut sinyallerle güvenli biçimde sınıflandırılamadı.', safeAction:'Yeni bir write/external işlem yapmadan önce node input/output ve audit izini incele.' };
}

function expressionValue(expression, context) {
  const path = clean(expression).replace(/^\$+/, '');
  if (!path) return undefined;
  const root = path.split('.')[0];
  const source = root === 'input' ? context.input : root === 'run' ? context.run : root === 'nodes' ? context.nodes : root === 'variables' ? (context.run && context.run.variables) : undefined;
  if (typeof source === 'undefined') return undefined;
  const parts = path.split('.').slice(1);
  return parts.reduce((current, key) => current == null ? undefined : current[key], source);
}
function resolveTemplates(value, context, depth = 0) {
  if (depth > 8) throw Object.assign(new Error('Agent expression nesting limit aşıldı.'), { code: 'EXPRESSION_DEPTH_LIMIT' });
  if (Array.isArray(value)) return value.map(item => resolveTemplates(item, context, depth + 1));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key,item]) => [key, resolveTemplates(item, context, depth + 1)]));
  if (typeof value !== 'string') return value;
  const exact = /^\s*\{\{\s*([^{}]+?)\s*\}\}\s*$/.exec(value);
  if (exact) {
    const resolved = expressionValue(exact[1], context);
    return typeof resolved === 'undefined' ? value : clone(resolved);
  }
  return value.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (all, expression) => {
    const resolved = expressionValue(expression, context);
    if (typeof resolved === 'undefined') return all;
    return resolved && typeof resolved === 'object' ? JSON.stringify(resolved) : String(resolved == null ? '' : resolved);
  });
}

function createAgentRuntime({ store, toolRegistry, policyEngine, auditFn } = {}) {
  if (!store || !toolRegistry || !policyEngine) throw new Error('Agent runtime dependencies missing.');
  const approvalResumes = new Map();

  async function runNode(node, input, ctx) {
    if (node.config && node.config.disabled === true) return { status: 'skipped', output: input };
    switch (node.type) {
      case 'trigger.manual': return { status: 'success', output: input };
      case 'agent.intent': return { status: 'success', output: { task: clean(ctx.run.input && ctx.run.input.task), input } };
      case 'agent.planner': return { status: 'success', output: input };
      case 'policy.guard': return { status: 'success', output: input };
      case 'tool.registry': return { status: 'success', output: input };
      case 'control.if': {
        const source = valueAt(input, node.config && node.config.path);
        const fieldValue = node.config && node.config.field ? getField(source && typeof source === 'object' ? source : input, node.config.field) : source;
        const branch = compare(fieldValue, clean(node.config && node.config.operator) || 'eq', node.config && node.config.value);
        return { status: 'success', output: input, branch };
      }
      case 'approval.gate': {
        if (!ctx.approvals[node.id] && !ctx.dryRun) return { status: 'waiting_approval', approval: { nodeId: node.id, label: node.label || 'Manual Approval', message: clean(node.config && node.config.message) || 'Workflow bu adımdan devam etmek için kullanıcı onayı bekliyor.', preview: compact(input) } };
        return { status: 'success', output: input };
      }
      case 'tool.call': {
        const toolId = clean(node.config && node.config.toolId), tool = toolRegistry.get(toolId);
        const rawArgs = node.config && node.config.args && typeof node.config.args === 'object' ? clone(node.config.args) : {};
        const args = resolveTemplates(rawArgs, { input, run: ctx.run.input || {}, nodes: Object.fromEntries(Object.entries(ctx.state || {}).map(([id,item]) => [id, { status:item.status, output:item.output }])) });
        const approvalGranted = Boolean(ctx.approvals[node.id]);
        const policy = policyEngine.evaluate(ctx.profile, tool, args, { dryRun: ctx.dryRun, approvalGranted });
        if (!policy.allowed && policy.approvalRequired) return { status: 'waiting_approval', approval: { nodeId: node.id, label: node.label || tool && tool.label || toolId, message: policy.reason, tool: tool ? { id: tool.id, label: tool.label, risk: tool.risk } : null, args: compact(args), preview: compact(input) } };
        if (!policy.allowed) throw Object.assign(new Error(policy.reason || 'Tool policy tarafından engellendi.'), { code: policy.code || 'POLICY_BLOCKED', statusCode: 403 });
        const result = await toolRegistry.execute(toolId, args, { ownerId: ctx.ownerId, profile: ctx.profile, dryRun: ctx.dryRun, input, runId: ctx.run.id, nodeId: node.id });
        if (!ctx.dryRun && tool && tool.rollbackable && result && result.rollbackToken) ctx.rollbackStack.push({ toolId, token: result.rollbackToken, nodeId: node.id });
        return { status: 'success', output: result };
      }
      case 'verify.result': {
        const mode = clean(node.config && node.config.mode) || 'not_empty';
        const actual = valueAt(input, node.config && node.config.path);
        let ok = true;
        if (mode === 'not_empty') ok = !isEmpty(actual);
        else if (mode === 'empty') ok = isEmpty(actual);
        else if (mode === 'min_count') {
          const count = Array.isArray(actual) ? actual.length : Number(actual && (actual.matched ?? actual.count ?? actual.updated ?? actual.length));
          ok = Number.isFinite(count) && count >= Number(node.config && node.config.value || 1);
        } else if (mode === 'equals') ok = compare(actual, 'eq', node.config && node.config.value);
        if (!ok) throw Object.assign(new Error(clean(node.config && node.config.message) || `Verifier başarısız: ${mode}`), { code: 'VERIFICATION_FAILED' });
        return { status: 'success', output: { verified: true, mode, value: input } };
      }
      case 'recovery.safe': {
        const attempts = [];
        if (!ctx.dryRun && (!node.config || node.config.rollback !== false)) {
          while (ctx.rollbackStack.length) {
            const item = ctx.rollbackStack.pop();
            try { attempts.push({ toolId: item.toolId, nodeId: item.nodeId, ok: true, result: await toolRegistry.rollback(item.toolId, item.token, { ownerId: ctx.ownerId, profile: ctx.profile, runId: ctx.run.id }) }); }
            catch (error) { attempts.push({ toolId: item.toolId, nodeId: item.nodeId, ok: false, error: error.message }); }
          }
        }
        const diagnosis = classifyFailure(input);
        return { status: 'success', output: { recovered: attempts.length > 0 && attempts.every(item => item.ok), rollbackAttempts: attempts, diagnosis, errorContext: input } };
      }
      case 'audit.log': {
        if (typeof auditFn === 'function') auditFn(ctx.profile, 'AGENT_WORKFLOW_AUDIT', ctx.run.workflowId, { runId: ctx.run.id, nodeId: node.id, dryRun: ctx.dryRun, summary: compact(input) });
        return { status: 'success', output: input };
      }
      case 'output.result': return { status: 'success', output: input };
      default: throw Object.assign(new Error(`Desteklenmeyen node tipi: ${node.type}`), { code: 'NODE_UNSUPPORTED' });
    }
  }

  async function execute({ ownerId, profile, workflow, input = {}, dryRun = false, runId = '', approvalNodeId = '' }) {
    const validation = validateWorkflow(workflow, toolRegistry);
    if (!validation.valid) throw Object.assign(new Error(`Workflow geçersiz: ${validation.errors.join(' · ')}`), { code: 'WORKFLOW_INVALID', statusCode: 400, details: validation });
    let run = runId ? store.runForOwner(ownerId, runId) : null;
    if (!run) run = store.createRun(ownerId, workflow, { input: { ...(input || {}) }, dryRun }).result;
    const execution = run.executionState && typeof run.executionState === 'object' ? clone(run.executionState) : {};
    const state = execution.nodes && typeof execution.nodes === 'object' ? execution.nodes : {};
    const approvals = execution.approvals && typeof execution.approvals === 'object' ? execution.approvals : {};
    const rollbackStack = Array.isArray(run.rollbackStack) ? clone(run.rollbackStack) : [];
    if (approvalNodeId) approvals[approvalNodeId] = true;
    execution.workflowSnapshot = execution.workflowSnapshot || clone(workflow);
    execution.nodes = state; execution.approvals = approvals;
    run = store.updateRun(ownerId, run.id, { status: dryRun ? 'dry_run' : 'running', pendingApproval: null, executionState: execution, rollbackStack, currentNodeId: '', message: dryRun ? 'Dry run çalışıyor.' : 'Workflow çalışıyor.' }).result;
    const order = topologicalOrder(workflow), byId = new Map(workflow.nodes.map(node => [node.id, node]));
    let finalOutput = null;

    for (const nodeId of order) {
      if (state[nodeId] && ['success','error','skipped'].includes(state[nodeId].status)) { if (byId.get(nodeId)?.type === 'output.result' && state[nodeId].status === 'success') finalOutput = state[nodeId].output; continue; }
      if (!predecessorsSettled(nodeId, workflow, state)) continue;
      const nodeInput = mergedInput(nodeId, workflow, state, run.input);
      const incoming = (workflow.edges || []).filter(edge => edge.to === nodeId);
      if (incoming.length && typeof nodeInput === 'undefined') { state[nodeId] = { status: 'skipped', output: null, at: new Date().toISOString(), reason: 'inactive-branch' }; continue; }
      const node = byId.get(nodeId);
      store.appendEvent(ownerId, run.id, { type: 'node_start', nodeId, nodeType: node.type, label: node.label });
      try {
        const result = await runNode(node, nodeInput, { ownerId, profile, dryRun, approvals, rollbackStack, run, state });
        if (result.status === 'waiting_approval') {
          state[nodeId] = { status: 'waiting_approval', output: nodeInput, at: new Date().toISOString() };
          execution.nodes = state; execution.approvals = approvals;
          run = store.updateRun(ownerId, run.id, { status: 'waiting_approval', currentNodeId: nodeId, pendingApproval: result.approval, executionState: execution, rollbackStack, message: result.approval.message }).result;
          store.appendEvent(ownerId, run.id, { type: 'approval_required', nodeId, detail: result.approval });
          return { run: store.runForOwner(ownerId, run.id), validation };
        }
        state[nodeId] = { status: result.status || 'success', output: result.output, branch: result.branch, at: new Date().toISOString() };
        if (node.type === 'output.result') finalOutput = result.output;
        execution.nodes = state; execution.approvals = approvals;
        run = store.updateRun(ownerId, run.id, { currentNodeId: nodeId, executionState: execution, rollbackStack, message: `${node.label || node.type} tamamlandı.` }).result;
        store.appendEvent(ownerId, run.id, { type: result.status === 'skipped' ? 'node_skipped' : 'node_success', nodeId, nodeType: node.type, label: node.label, output: compact(result.output) });
      } catch (error) {
        state[nodeId] = { status: 'error', output: { error: error.message, code: error.code || 'NODE_FAILED', input: compact(nodeInput) }, at: new Date().toISOString() };
        execution.nodes = state; execution.approvals = approvals;
        store.appendEvent(ownerId, run.id, { type: 'node_error', nodeId, nodeType: node.type, label: node.label, error: error.message, code: error.code || 'NODE_FAILED' });
        const hasErrorPath = (workflow.edges || []).some(edge => edge.from === nodeId && edge.channel === 'error');
        if (!hasErrorPath) {
          const rollbackResults = [];
          if (!dryRun) {
            while (rollbackStack.length) {
              const item = rollbackStack.pop();
              try { rollbackResults.push({ toolId: item.toolId, ok: true, result: await toolRegistry.rollback(item.toolId, item.token, { ownerId, profile, runId: run.id }) }); }
              catch (rollbackError) { rollbackResults.push({ toolId: item.toolId, ok: false, error: rollbackError.message }); }
            }
          }
          const failed = store.updateRun(ownerId, run.id, { status: 'failed', currentNodeId: nodeId, executionState: execution, rollbackStack, output: { error: error.message, code: error.code || 'NODE_FAILED', rollback: rollbackResults }, message: error.message, finishedAt: new Date().toISOString() }).result;
          if (typeof auditFn === 'function') auditFn(profile, 'AGENT_WORKFLOW_FAILED', workflow.id, { runId: failed.id, nodeId, error: error.message, rollback: rollbackResults });
          return { run: failed, validation };
        }
      }
    }

    const terminal = finalOutput != null ? finalOutput : (() => {
      const completed = order.map(id => state[id]).filter(item => item && item.status === 'success');
      return completed.length ? completed[completed.length - 1].output : null;
    })();
    // Completed runs keep a compact execution trace; large row payloads do not accumulate forever.
    const compactState = { ...execution, nodes: Object.fromEntries(Object.entries(state).map(([id, item]) => [id, { ...item, output: compact(item.output) }])) };
    const finished = store.updateRun(ownerId, run.id, { status: dryRun ? 'dry_run' : 'completed', currentNodeId: '', pendingApproval: null, executionState: compactState, rollbackStack: [], output: compact(terminal), message: dryRun ? 'Dry run tamamlandı; kalıcı değişiklik uygulanmadı.' : 'Workflow başarıyla tamamlandı.', finishedAt: new Date().toISOString() }).result;
    store.appendEvent(ownerId, run.id, { type: 'run_complete', status: finished.status, output: compact(terminal) });
    if (typeof auditFn === 'function') auditFn(profile, dryRun ? 'AGENT_WORKFLOW_DRY_RUN' : 'AGENT_WORKFLOW_COMPLETE', workflow.id, { runId: finished.id, workflow: workflow.name });
    return { run: store.runForOwner(ownerId, run.id), validation };
  }

  async function resumeApprovalOnce({ ownerId, profile, runId, approved }) {
    const run = store.runForOwner(ownerId, runId);
    if (!run) throw Object.assign(new Error('Agent çalışması bulunamadı.'), { code: 'RUN_NOT_FOUND', statusCode: 404 });
    if (run.status !== 'waiting_approval' || !run.pendingApproval || !run.pendingApproval.nodeId) throw Object.assign(new Error('Bu çalışma onay beklemiyor.'), { code: 'RUN_NOT_WAITING_APPROVAL', statusCode: 409 });
    if (!approved) {
      const cancelled = store.updateRun(ownerId, run.id, { status: 'cancelled', pendingApproval: null, currentNodeId: '', cancelReason:'user_cancelled', message: 'Kullanıcı onayı reddetti.', finishedAt: new Date().toISOString() }).result;
      store.appendEvent(ownerId, run.id, { type: 'approval_rejected', code:'USER_CANCELLED', reason:'user_cancelled', nodeId: run.pendingApproval.nodeId });
      if (typeof auditFn === 'function') auditFn(profile, 'AGENT_WORKFLOW_APPROVAL_REJECTED', run.workflowId, { runId: run.id, nodeId: run.pendingApproval.nodeId });
      return { run: store.runForOwner(ownerId, cancelled.id) };
    }
    const snapshot = run.executionState && run.executionState.workflowSnapshot;
    if (!snapshot) throw Object.assign(new Error('Workflow snapshot bulunamadı; çalışma güvenli biçimde devam ettirilemiyor.'), { code: 'WORKFLOW_SNAPSHOT_MISSING', statusCode: 409 });
    const state = clone(run.executionState || {}); state.nodes = state.nodes || {};
    delete state.nodes[run.pendingApproval.nodeId];
    store.updateRun(ownerId, run.id, { status: 'running', pendingApproval: null, executionState: state, message: 'Kullanıcı onayladı; workflow devam ediyor.' });
    store.appendEvent(ownerId, run.id, { type: 'approval_granted', nodeId: run.pendingApproval.nodeId });
    return execute({ ownerId, profile, workflow: snapshot, input: run.input, dryRun: run.dryRun, runId: run.id, approvalNodeId: run.pendingApproval.nodeId });
  }

  async function resumeApproval(args = {}) {
    const key = `${clean(args.ownerId)}:${clean(args.runId)}`;
    const inFlight = approvalResumes.get(key);
    if (inFlight) return inFlight;
    const task = resumeApprovalOnce(args).finally(() => {
      if (approvalResumes.get(key) === task) approvalResumes.delete(key);
    });
    approvalResumes.set(key, task);
    return task;
  }

  return { execute, resumeApproval };
}

module.exports = { createAgentRuntime, valueAt, activeChannel, edgeMatches, compact, resolveTemplates, expressionValue, classifyFailure };
