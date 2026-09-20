'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const gateway = require('../server/lib/ai-provider-gateway');
const fs = require('node:fs');
const path = require('node:path');

function jsonResponse(value, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return value; },
  };
}

test('AI gateway exposes provider-independent starter profiles', () => {
  assert.deepEqual(gateway.providerIds(), ['ollama', 'lmstudio', 'openai-compatible', 'openrouter', 'nvidia']);
  assert.deepEqual(gateway.recommendedModels().map(item => [item.id, item.profile]), [
    ['qwen3:8b', 'fast'],
    ['gemma4:12b', 'balanced'],
    ['gemma4:26b', 'advanced'],
  ]);
  assert.equal(gateway.profileForModel('org/custom-model:latest'), 'custom');
  assert.equal(gateway.defaultModel(), 'gemma4:12b');
});

test('gateway keeps local providers loopback-only and custom endpoints explicit', () => {
  assert.throws(() => gateway.normalizeEndpoint('ollama', 'https://example.com/ollama'), /yalnızca bu bilgisayardaki/);
  assert.equal(gateway.normalizeEndpoint('ollama', 'http://[::1]:11434/'), 'http://[::1]:11434');
  assert.equal(gateway.normalizeEndpoint('openai-compatible', 'https://ai.example.com/v1/'), 'https://ai.example.com/v1');
});

test('Ollama adapter discovers models and normalizes chat responses', async () => {
  const calls = [];
  const provider = gateway.createProvider({ provider: 'ollama', model: 'gemma4:12b' }, {
    fetch: async (url, options = {}) => {
      calls.push({ url: String(url), options });
      if (String(url).endsWith('/api/tags')) {
        return jsonResponse({ models: [{ name: 'gemma4:12b', size: 1200, modified_at: '2026-09-03T08:00:00Z' }] });
      }
      return jsonResponse({ model: 'gemma4:12b', message: { role: 'assistant', content: 'Hazır.' }, done: true });
    },
  });

  assert.deepEqual(await provider.listModels(), [{
    name: 'gemma4:12b', size: 1200, modifiedAt: '2026-09-03T08:00:00Z',
    provider: 'ollama', capabilities: [], details: null,
  }]);
  assert.deepEqual(await provider.chat([{ role: 'user', content: 'Merhaba' }]), {
    content: 'Hazır.', toolCalls: [], model: 'gemma4:12b', usage: null,
  });
  assert.equal(calls[1].options.method, 'POST');
  assert.match(calls[1].url, /\/api\/chat$/);
});

test('LM Studio uses the OpenAI-compatible adapter without changing gateway callers', async () => {
  const calls = [];
  const provider = gateway.createProvider({ provider: 'lmstudio', model: 'local-model' }, {
    fetch: async (url, options = {}) => {
      calls.push({ url: String(url), options });
      if (String(url).endsWith('/models')) return jsonResponse({ data: [{ id: 'local-model' }] });
      return jsonResponse({ model: 'local-model', choices: [{ message: { content: 'Local cevap' } }] });
    },
  });

  assert.deepEqual(await provider.listModels(), [{
    name: 'local-model', size: null, modifiedAt: null,
    provider: 'lmstudio', capabilities: [], details: null,
  }]);
  assert.equal((await provider.chat([{ role: 'user', content: 'Selam' }])).content, 'Local cevap');
  assert.equal(calls[1].options.method, 'POST');
  assert.match(calls[1].url, /\/chat\/completions$/);
});

test('chat accepts a bounded inference timeout for slower local Gemma models', async () => {
  const provider = gateway.createProvider({ provider: 'ollama', model: 'gemma4:26b' }, {
    fetch: async (_url, options = {}) => new Promise((resolve, reject) => {
      const timer = setTimeout(() => resolve(jsonResponse({ model: 'gemma4:26b', message: { content: 'late' } })), 40);
      options.signal.addEventListener('abort', () => {
        clearTimeout(timer);
        const error = new Error('aborted'); error.name = 'AbortError'; reject(error);
      }, { once: true });
    }),
  });
  await assert.rejects(
    () => provider.chat([{ role: 'user', content: 'Merhaba' }], { timeoutMs: 5 }),
    error => error && error.code === 'AI_TIMEOUT',
  );
});

test('Ollama model pull reports streamed progress and does not expose secrets', async () => {
  const encoded = new TextEncoder();
  const chunks = [
    JSON.stringify({ status: 'pulling', completed: 25, total: 100 }) + '\n',
    JSON.stringify({ status: 'success', completed: 100, total: 100 }) + '\n',
  ].map(encoded.encode.bind(encoded));
  const provider = gateway.createProvider({ provider: 'ollama', model: 'new-model:latest', apiKey: 'secret' }, {
    fetch: async (_url, options = {}) => {
      assert.equal(options.headers.Authorization, undefined);
      return {
        ok: true, status: 200,
        body: { getReader() {
          return { async read() {
            if (!chunks.length) return { done: true, value: undefined };
            return { done: false, value: chunks.shift() };
          } };
        } },
      };
    },
  });
  const progress = [];
  const result = await provider.pullModel('new-model:latest', item => progress.push(item));
  assert.equal(result.status, 'success');
  assert.deepEqual(progress.map(item => item.percent), [25, 100]);
});

test('AI model lifecycle endpoints remain inside the existing agent authorization boundary', () => {
  const server = fs.readFileSync(path.join(__dirname, '..', 'server', 'server.js'), 'utf8');
  for (const endpoint of [
    '/api/agent-platform/ai/models',
    '/api/agent-platform/ai/models/pull',
    '/api/agent-platform/ai/models/remove',
    '/api/agent-platform/ai/models/update-all',
  ]) assert.match(server, new RegExp(endpoint.replaceAll('/', '\\/')));
  const routeStart = server.indexOf("app.post('/api/agent-platform/ai/models/pull'");
  assert.ok(routeStart >= 0);
  assert.match(server.slice(routeStart, routeStart + 260), /userAccess\.requireModerator/);
});

test('Copilot keeps deterministic rendering while sending the selected model only to the backend explanation call', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'copilot.js'), 'utf8');
  assert.match(source, /data-bcp-model/);
  assert.match(source, /model\s*:\s*aiState\.model/);
  assert.match(source, /recommendedModels/);
});

test('Model Manager is reachable from the Copilot model control and supports streamed pull progress', () => {
  const copilot = fs.readFileSync(path.join(__dirname, '..', 'public', 'copilot.js'), 'utf8');
  const server = fs.readFileSync(path.join(__dirname, '..', 'server', 'server.js'), 'utf8');
  assert.match(copilot, /data-bcp-manage/);
  assert.match(copilot, /ai\/models\/pull\?stream=1/);
  assert.match(copilot, /data-bcp-provider/);
  assert.match(copilot, /api\/agent-platform\/ai-settings/);
  assert.match(server, /application\/x-ndjson/);
  assert.match(server, /const streaming\s*=/);
});

test('Copilot rechecks the visible installed model instead of keeping a missing default model status', () => {
  const copilot = fs.readFileSync(path.join(__dirname, '..', 'public', 'copilot.js'), 'utf8');
  const server = fs.readFileSync(path.join(__dirname, '..', 'server', 'server.js'), 'utf8');
  assert.match(copilot, /installedIds\.has\(aiState\.model\)/);
  assert.match(copilot, /refreshStatus\(aiState\.model\)/);
  assert.match(copilot, /encodeURIComponent\(model\)/);
  assert.match(server, /req\.query\.model/);
  assert.match(server, /aiModel:\s*requestedModel/);
});
