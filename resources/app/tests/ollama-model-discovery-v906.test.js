'use strict';

/*
 * OLLAMA MODEL DISCOVERY — ŞİRKET BİLGİSAYARINDA ÇALIŞMIYORDU
 *
 * Bildirilen belirti: `Invoke-RestMethod http://127.0.0.1:11434/api/tags`
 * PowerShell'den anında ve doğru cevap veriyor (gemma4:12b dahil), ama
 * Buyer Log'un AI Modelleri paneli hiçbir model göstermiyor / "AI kapalı"
 * diyor.
 *
 * KÖK NEDEN: server/lib/copilot-llm.js'teki status(), Ollama'nın model
 * listesini `Promise.race([provider.listModels(), timeout(1500)])` ile
 * yokluyordu. Kurumsal bir makinede AV/EDR'ın her soket bağlantısına eklediği
 * gecikme (Defender ATP, CrowdStrike vb. — loopback dahil) ya da Ollama'nın
 * kendi model listesini disktan okuma süresi kolayca 1.5 saniyeyi aşabiliyor.
 * Bu durumda dış yarış (withTimeout) gerçek hatayı YOK SAYIP kendi jenerik
 * 'AI_TIMEOUT'unu üretiyor, status() da bunu düz "AI kapalı"ya çeviriyordu —
 * kullanıcı Ollama'nın gerçekte SAĞLIKLI olduğunu ancak PowerShell ile ayrıca
 * doğrulayarak öğrenebiliyordu (bildirilen davranışın ta kendisi).
 *
 * İKİNCİ KUSUR: ai-provider-gateway.js'in jsonRequest()'i bir 200 yanıtın
 * gövdesi bozuk JSON olduğunda bunu sessizce {}'e düşürüyordu — "0 model"
 * ile "yanıt okunamadı" ayırt edilemez hâldeydi.
 *
 * Bu testler üç şeyi kilitler:
 *   1) Gerçek Ollama yanıt biçimi (colon/tag içeren model adları dahil)
 *      doğru ayrıştırılır, hiçbir isim filtrelenmez/bozulmaz.
 *   2) Bağlantı seviyesi hata (OFFLINE) ile bağlantı KURULDU ama yanıt
 *      okunamadı hatası (DISCOVERY_ERROR) AYRI durumlardır.
 *   3) Yoklama süresi artık kurumsal gecikmeye pay bırakır ve gerçek hata
 *      kodu ASLA sessizce yutulmaz.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const gateway = require('../server/lib/ai-provider-gateway');
const copilotLlm = require('../server/lib/copilot-llm');

const AGENT_AI_SETTINGS_FILE = path.join(__dirname, '..', 'server', 'data', 'agent-ai-settings.json');

function jsonResponse(value, status = 200) {
  return { ok: status >= 200 && status < 300, status, async json() { return value; } };
}

/* Şirket bilgisayarında PowerShell'in gördüğü GERÇEK /api/tags gövdesinin
   yapısı: {"models":[{name, model, size, modified_at, digest, details}, ...]}. */
function realOllamaTagsResponse() {
  return {
    models: [
      {
        name: 'gemma4:12b', model: 'gemma4:12b', size: 8134280192,
        modified_at: '2026-08-20T09:12:03.4419Z',
        digest: 'a1b2c3d4e5f6', details: { family: 'gemma', parameter_size: '12B', quantization_level: 'Q4_K_M' },
      },
      {
        name: 'qwen3:8b', model: 'qwen3:8b', size: 5000000000,
        modified_at: '2026-08-19T10:00:00Z', digest: 'ffeeddcc',
        details: { family: 'qwen3', parameter_size: '8B', quantization_level: 'Q4_0' },
      },
      {
        name: 'gemma4:26b', model: 'gemma4:26b', size: 16000000000,
        modified_at: '2026-08-18T08:00:00Z', digest: '11223344',
        details: { family: 'gemma', parameter_size: '26B', quantization_level: 'Q4_K_M' },
      },
    ],
  };
}

/* ------------------------------------------------------- PARSER TESTİ (§8) */

test('gerçek Ollama /api/tags yanıtı doğru ayrıştırılır: colon/tag içeren adlar bozulmaz', async () => {
  const provider = gateway.createProvider({ provider: 'ollama', model: 'gemma4:12b' }, {
    fetch: async () => jsonResponse(realOllamaTagsResponse()),
  });
  const models = await provider.listModels();
  assert.deepEqual(models.map(item => item.name).sort(), ['gemma4:12b', 'gemma4:26b', 'qwen3:8b']);
  // size / modified_at / details güvenli biçimde taşınır.
  const gemma12 = models.find(item => item.name === 'gemma4:12b');
  assert.equal(gemma12.size, 8134280192);
  assert.equal(gemma12.modifiedAt, '2026-08-20T09:12:03.4419Z');
  assert.deepEqual(gemma12.details, { family: 'gemma', parameter_size: '12B', quantization_level: 'Q4_K_M' });
});

test('response.models (dizinin KENDİSİ) kaynaktır; response üst düzey dizi değildir', async () => {
  let receivedShapeIsArray = null;
  const provider = gateway.createProvider({ provider: 'ollama', model: 'gemma4:12b' }, {
    fetch: async () => {
      const body = realOllamaTagsResponse();
      receivedShapeIsArray = Array.isArray(body);
      return jsonResponse(body);
    },
  });
  await provider.listModels();
  assert.equal(receivedShapeIsArray, false, 'Ollama yanıtı {"models":[...]} biçimindedir, düz dizi değildir');
});

test('kurulu olmayan/önceden bilinmeyen model adları FİLTRELENMEZ (hardcoded whitelist yok)', async () => {
  const provider = gateway.createProvider({ provider: 'ollama', model: 'gemma4:12b' }, {
    fetch: async () => jsonResponse({
      models: [
        { name: 'gemma4:12b' }, // MODEL_PROFILES içinde var
        { name: 'my-custom-fork:v2' }, // önceden BİLİNMEYEN bir model
        { name: 'deepseek-r1:14b' }, // önceden BİLİNMEYEN bir model
      ],
    }),
  });
  const names = (await provider.listModels()).map(item => item.name).sort();
  assert.deepEqual(names, ['deepseek-r1:14b', 'gemma4:12b', 'my-custom-fork:v2'],
    'yalnız MODEL_PROFILES içinde olanlar gösterilmemeli — tüm keşfedilen modeller gösterilmeli');
});

/* -------------------------------------------------- 127.0.0.1 VARSAYILANI (§1) */

test('Ollama sağlayıcısının varsayılan adresi 127.0.0.1:11434 — localhost DEĞİL', () => {
  assert.equal(gateway.PROVIDERS.ollama.endpoint, 'http://127.0.0.1:11434');
  assert.equal(gateway.normalizeEndpoint('ollama', ''), 'http://127.0.0.1:11434');
  assert.equal(gateway.normalizeEndpoint('ollama', undefined), 'http://127.0.0.1:11434');
});

test('copilot-llm.js legacyEndpoint de 127.0.0.1 varsayılanını kullanır', () => {
  assert.equal(copilotLlm.DEFAULT_HOST, '127.0.0.1');
  assert.equal(copilotLlm.DEFAULT_PORT, 11434);
});

/* -------------------------------------- BOZUK/BEKLENMEYEN YANIT (§3, §6) */

test('200 OK ama BOZUK JSON gövdesi sessizce "0 model"e düşmez — AI_RESPONSE_UNREADABLE fırlatır', async () => {
  const provider = gateway.createProvider({ provider: 'ollama', model: 'gemma4:12b' }, {
    fetch: async () => ({ ok: true, status: 200, async json() { throw new SyntaxError('Unexpected token'); } }),
  });
  await assert.rejects(provider.listModels(), error => error && error.code === 'AI_RESPONSE_UNREADABLE');
});

test('200 OK ama beklenmeyen gövde biçimi (models dizisi yok) AI_RESPONSE_UNREADABLE fırlatır', async () => {
  const provider = gateway.createProvider({ provider: 'ollama', model: 'gemma4:12b' }, {
    fetch: async () => jsonResponse({ unexpected: 'shape' }),
  });
  await assert.rejects(provider.listModels(), error => error && error.code === 'AI_RESPONSE_UNREADABLE');
});

test('GERÇEKTEN boş bir model listesi ({"models":[]}) hata SAYILMAZ', async () => {
  const provider = gateway.createProvider({ provider: 'ollama', model: 'gemma4:12b' }, {
    fetch: async () => jsonResponse({ models: [] }),
  });
  assert.deepEqual(await provider.listModels(), []);
});

test('listModels artık isteğe bağlı bir timeoutMs kabul eder (probe ile refresh farklı toleranslar isteyebilir)', async () => {
  const provider = gateway.createProvider({ provider: 'ollama', model: 'gemma4:12b' }, {
    fetch: async (_url, options = {}) => new Promise((resolve, reject) => {
      const timer = setTimeout(() => resolve(jsonResponse(realOllamaTagsResponse())), 40);
      options.signal?.addEventListener('abort', () => { clearTimeout(timer); const e = new Error('aborted'); e.name = 'AbortError'; reject(e); }, { once: true });
    }),
  });
  await assert.rejects(provider.listModels({ timeoutMs: 5 }), error => error && error.code === 'AI_TIMEOUT');
  const models = await provider.listModels({ timeoutMs: 500 });
  assert.equal(models.length, 3);
});

/* --------------------------------------- status() ÜÇ AYRI DURUM (§7) */

test('status(): bağlantı seviyesi zaman aşımı OFFLINE döner, connected:false, hata YUTULMAZ', async () => {
  const originalCreate = gateway.createProvider;
  gateway.createProvider = () => ({
    listModels: async () => { throw Object.assign(new Error('AI sağlayıcı zaman aşımına uğradı.'), { code: 'AI_TIMEOUT' }); },
  });
  try {
    const result = await copilotLlm.status({ aiEnabled: true, aiModel: 'gemma4:12b' });
    assert.equal(result.status, copilotLlm.STATUS.OFFLINE);
    assert.equal(result.ok, false);
    assert.equal(result.connected, false);
    assert.equal(result.errorCode, 'AI_TIMEOUT');
    assert.ok(result.reason, 'gerçek hata mesajı SESSİZCE YUTULMAMALI');
  } finally { gateway.createProvider = originalCreate; }
});

test('status(): bağlantı KURULDU ama model listesi okunamadı → DISCOVERY_ERROR, connected:true', async () => {
  const originalCreate = gateway.createProvider;
  gateway.createProvider = () => ({
    listModels: async () => { throw Object.assign(new Error('AI sağlayıcı model listesi beklenmeyen bir biçimde döndü.'), { code: 'AI_RESPONSE_UNREADABLE' }); },
  });
  try {
    const result = await copilotLlm.status({ aiEnabled: true, aiModel: 'gemma4:12b' });
    assert.equal(result.status, copilotLlm.STATUS.DISCOVERY_ERROR);
    assert.equal(result.ok, false);
    assert.equal(result.connected, true, 'Ollama connection = OK, Model discovery = FAILED durumu ayırt edilmeli');
    assert.equal(result.errorCode, 'AI_RESPONSE_UNREADABLE');
  } finally { gateway.createProvider = originalCreate; }
});

test('status(): bağlantı KURULDU, model listesi boş → MODEL_MISSING ama connected:true ve models:[]', async () => {
  const originalCreate = gateway.createProvider;
  gateway.createProvider = () => ({ listModels: async () => [] });
  try {
    const result = await copilotLlm.status({ aiEnabled: true, aiModel: 'gemma4:12b' });
    assert.equal(result.status, copilotLlm.STATUS.MODEL_MISSING);
    assert.equal(result.connected, true);
    assert.deepEqual(result.models, []);
  } finally { gateway.createProvider = originalCreate; }
});

test('status(): bağlantı KURULDU, modeller var ama seçili model yok → MODEL_MISSING, modeller GÖRÜNÜR', async () => {
  const originalCreate = gateway.createProvider;
  gateway.createProvider = () => ({
    listModels: async () => [{ name: 'qwen3:8b' }, { name: 'gemma4:26b' }],
  });
  try {
    const result = await copilotLlm.status({ aiEnabled: true, aiModel: 'gemma4:12b' });
    assert.equal(result.status, copilotLlm.STATUS.MODEL_MISSING);
    assert.equal(result.connected, true);
    assert.deepEqual(result.models.sort(), ['gemma4:26b', 'qwen3:8b'],
      'seçili model kurulu değilse bile kurulu OLAN modeller kullanıcıya gösterilmeli');
  } finally { gateway.createProvider = originalCreate; }
});

test('status(): tam sağlıklı durumda READY, connected:true, models dolu', async () => {
  const originalCreate = gateway.createProvider;
  gateway.createProvider = () => ({
    listModels: async () => [{ name: 'gemma4:12b' }, { name: 'qwen3:8b' }],
  });
  try {
    const result = await copilotLlm.status({ aiEnabled: true, aiModel: 'gemma4:12b' });
    assert.equal(result.status, copilotLlm.STATUS.READY);
    assert.equal(result.ok, true);
    assert.equal(result.connected, true);
    assert.deepEqual(result.models.sort(), ['gemma4:12b', 'qwen3:8b']);
  } finally { gateway.createProvider = originalCreate; }
});

test('status() her koşulda endpoint bilgisini taşır (UI "Server: 127.0.0.1:11434" gösterebilsin)', async () => {
  const result = await copilotLlm.status({ aiEnabled: true, aiModel: 'gemma4:12b' });
  assert.match(result.endpoint || '', /127\.0\.0\.1:11434/);
});

/* -------------------------------------------------- ZAMAN AŞIMI SÜRESİ (kök neden) */

test('PROBE_TIMEOUT_MS artık 1500ms değil — kurumsal AV/EDR gecikmesine pay bırakır', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'server', 'lib', 'copilot-llm.js'), 'utf8');
  const match = /PROBE_TIMEOUT_MS\s*=\s*(\d+)/.exec(source);
  assert.ok(match, 'PROBE_TIMEOUT_MS tanımı bulunamadı');
  const value = Number(match[1]);
  assert.ok(value >= 5000, `1.5 saniyelik eski değer kurumsal makinede sağlıklı bir Ollama'yı bile "kapalı" gösteriyordu; görülen: ${value}ms`);
});

test('status() artık kendi Promise.race zaman aşımını YENİDEN İCAT ETMİYOR — tek zaman aşımı katmanı gateway’de', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'server', 'lib', 'copilot-llm.js'), 'utf8');
  assert.doesNotMatch(source, /withTimeout/, 'iç içe iki zaman aşımı katmanı gerçek hatayı örtüyordu');
  assert.match(source, /listModels\(\s*\{\s*timeoutMs:\s*PROBE_TIMEOUT_MS\s*\}\s*\)/);
});

/* -------------------------------------- BACKEND ÜZERİNDEN GEÇİŞ (§2) */

test('frontend Ollama’a DOĞRUDAN gitmiyor; her fetch() Buyer Log backend uç noktasına gider', () => {
  // "11434" bir placeholder/varsayılan-değer İPUCU olarak metinde geçebilir
  // (kullanıcıya ne yazması gerektiğini göstermek için); asıl kural şu:
  // hiçbir fetch() ÇAĞRISI 127.0.0.1/localhost'a DOĞRUDAN gitmemeli, hepsi
  // Buyer Log'un kendi /api/... uç noktalarını hedeflemeli.
  const copilot = fs.readFileSync(path.join(__dirname, '..', 'public', 'copilot.js'), 'utf8');
  const fetchCalls = copilot.match(/fetch\(\s*[`'"][^`'"]*[`'"]/g) || [];
  assert.ok(fetchCalls.length > 0, 'karşılaştırılacak fetch() çağrısı bulunamadı');
  for (const call of fetchCalls) {
    assert.match(call, /['"`]\/api\//, `fetch çağrısı Buyer Log backend'ine gitmeli: ${call}`);
    assert.doesNotMatch(call, /127\.0\.0\.1|localhost|11434/i, `fetch çağrısı Ollama'ya DOĞRUDAN gitmemeli: ${call}`);
  }
});

test('/api/copilot/status backend üzerinden Ollama’ya gider (gateway → provider.listModels)', () => {
  const server = fs.readFileSync(path.join(__dirname, '..', 'server', 'server.js'), 'utf8');
  assert.match(server, /app\.get\('\/api\/copilot\/status'/);
  assert.match(server, /copilotLlm\.status\(/);
});

/* --------------------------------- YENİDEN BAŞLATMA GEREKTİRMEZ (§5) */

test('Refresh Models yalnız yeniden sorgular, restart gerektiren bir eylem yoktur', () => {
  const copilot = fs.readFileSync(path.join(__dirname, '..', 'public', 'copilot.js'), 'utf8');
  assert.match(copilot, /data-bcp-refresh-models/, 'Refresh Models kontrolü modal içinde bulunmalı');
  assert.match(copilot, /data-bcp-test-connection/, 'Test Connection kontrolü Refresh Models’den AYRI olmalı');
  const start = copilot.indexOf('data-bcp-refresh-models]')
  const block = copilot.slice(Math.max(0, start - 400), start + 400);
  assert.match(block, /refreshStatus\(\)/);
});

test('Connection Test ve Model Discovery FARKLI uç noktaları çağırır (§7)', () => {
  const copilot = fs.readFileSync(path.join(__dirname, '..', 'public', 'copilot.js'), 'utf8');
  assert.match(copilot, /\/api\/agent-platform\/ai-settings\/test/, 'Test Connection kendi uç noktasını kullanmalı');
  assert.match(copilot, /\/api\/copilot\/status/, 'Refresh Models / durum yoklaması kendi uç noktasını kullanmalı');
});

/* ------------------------------------------------ OLLAMA KAPALIYKEN ÇÖKMEZ (§9) */

test('Ollama tamamen erişilemezken status() fırlatmaz, yapılandırılmış bir hata döner', async () => {
  const originalCreate = gateway.createProvider;
  gateway.createProvider = () => ({
    listModels: async () => { throw Object.assign(new Error('AI sağlayıcıya bağlanılamadı.'), { code: 'AI_PROVIDER_OFFLINE' }); },
  });
  try {
    const result = await copilotLlm.status({ aiEnabled: true, aiModel: 'gemma4:12b' });
    assert.equal(result.status, copilotLlm.STATUS.OFFLINE);
    assert.equal(result.connected, false);
  } finally { gateway.createProvider = originalCreate; }
});

test('AI devre dışıyken (aiEnabled:false) status() sorgu bile denemez', async () => {
  const result = await copilotLlm.status({ aiEnabled: false, aiModel: 'gemma4:12b' });
  assert.equal(result.status, copilotLlm.STATUS.DISABLED);
  assert.equal(result.ok, false);
});
