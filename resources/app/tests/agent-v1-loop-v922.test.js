'use strict';

/* v9.22 — AGENT V1: chatbot'tan ajana.
 *
 * Denetim şunu gösterdi: mimari zaten ajan mimarisiydi (8 turluk döngü, tool
 * registry, policy engine, canonical field katmanı) ama PENÇELERİ SÖKÜLMÜŞTÜ.
 * copilot-agent yalnız /^(dataset|system)\./ ile eşleşen salt-okunur araçları
 * LLM'e veriyordu; yeni bir araç ailesi eklemek regex güncellemesi gerektiriyordu.
 *
 * Bu turda dört gerçek engel kaldırıldı. Hepsi CANLI koşuda (Ollama + qwen3:8b,
 * 240 satırlık sentetik CP verisi) ortaya çıktı, tahminle değil:
 *
 *   1) Yapılandırılan model kurulu değildi (gemma4:12b yok, gemma4:26b var)
 *      → ajan hiç çalışmıyordu. Artık kurulu listeye göre çözülüyor.
 *   2) Araç katalogu regex'le süzülüyordu → module.* araçları görünmüyordu.
 *   3) Tek bir araç hatası BÜTÜN turu düşürüyordu → ajan ilk yanlış alan
 *      adında pes ediyordu. Artık hata modele gözlem olarak dönüyor.
 *   4) Grounding doğrulayıcısı liste numaralarını, başlıkları, para birimlerini
 *      ve terim açılımlarını uydurma sanıyordu → doğru cevaplar reddediliyordu.
 *
 * Canlı sonuç: ajan "en pahalı üreticiyi ürün karmasıyla bul" sorusunda
 * module.catalog → dataset.aggregate (hatalı alan) → dataset.describe →
 * dataset.aggregate (düzeltilmiş) zincirini kendi kurdu ve veriye kasten
 * gömülen sinyali (Star Apparel 17,33 / diğerleri 15,93) buldu.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const copilot = require('../server/lib/copilot-agent');
const gateway = require('../server/lib/ai-provider-gateway');
const { createToolRegistry } = require('../server/lib/agent-tool-registry');
const { createPolicyEngine } = require('../server/lib/agent-policy-engine');
const grounding = require('../public/copilot-grounding.js');

const profile = { id: 'u1', areas: ['cp', 'orders', 'koleksiyon', 'overview', 'priceanalysis', 'lfl', 'backlog', 'shipping', 'opencosting', 'automations', 'source', 'agents'] };
const userAccess = { hasArea: (p, area) => (p && p.areas || []).includes(area), appendAudit() {} };
function registry(data = {}) {
  return createToolRegistry({
    userAccess,
    listDatasets: async () => Object.keys(data).map(id => ({ id, allowed: true })),
    getDataset: async (_o, _p, source) => data[source] || [],
    getDataContext: async (_o, _p, source) => ({ source, rowCount: (data[source] || []).length }),
  });
}
/* Sıralı sahte sağlayıcı: modelin ne döndüreceğini biz belirleriz, böylece
   döngünün davranışı model kalitesinden bağımsız sınanır. Eski JSON zarfı
   ({type:'tool_calls',calls}/{type:'answer',answer}) yerine native
   {content,toolCalls} şekli üretilir (bkz. copilot-agent.js toolIdFor —
   dot içeren araç kimliği '__' ile fonksiyon adına çevrilir). */
function toNativeName(id) { return String(id).replace(/\./g, '__'); }
function sequenced(turns) {
  let index = 0;
  return {
    config: { provider: 'ollama', model: 'test' },
    async chat() {
      const turn = turns[Math.min(index, turns.length - 1)];
      index += 1;
      if (turn.type === 'tool_calls') {
        return {
          content: '',
          toolCalls: turn.calls.map((call, i) => ({ id: `call_${index}_${i}`, name: toNativeName(call.id), args: call.args })),
          model: 'test',
        };
      }
      return { content: turn.answer, toolCalls: [], model: 'test' };
    },
  };
}

/* ------------------------------------------- 1) MODEL ÇÖZÜMLEMESİ */

test('v9.22 kurulu olmayan model aynı aileden kurulu olana düşüyor', () => {
  const installed = [
    { name: 'gemma4:26b', capabilities: ['completion', 'tools', 'thinking'] },
    { name: 'qwen3:8b', capabilities: ['completion', 'tools'] },
  ];
  const chosen = gateway.chooseInstalledModel('gemma4:12b', installed);
  assert.equal(chosen.model.name, 'gemma4:26b', 'aynı aile tercih edilmeli');
  assert.equal(chosen.reason, 'same-family');
  // Tam eşleşme her zaman önce gelir: kullanıcının seçimi ezilmemeli.
  assert.equal(gateway.chooseInstalledModel('qwen3:8b', installed).reason, 'exact');
});

test('v9.22 ajan döngüsü için araç yeteneği olan model tercih ediliyor', () => {
  const installed = [
    { name: 'embed-only:1b', capabilities: ['embedding'] },
    { name: 'llama9:7b', capabilities: ['completion', 'tools'] },
  ];
  // Araç yeteneği şart koşulduğunda araçsız model seçilmemeli.
  assert.equal(gateway.chooseInstalledModel('yok:1b', installed, { requireTools: true }).model.name, 'llama9:7b');
  // Şart koşulmadığında da hiç değilse bir şey çalışsın.
  assert.ok(gateway.chooseInstalledModel('yok:1b', installed).model.name);
  // Hiç model yoksa çağıran net bir hata üretebilsin diye null döner.
  assert.equal(gateway.chooseInstalledModel('a:1b', []), null);
});

/* --------------------------------------------- 2) ARAÇ KATALOĞU */

test('v9.22 katalog regex yerine RİSK seviyesine göre süzülüyor', () => {
  /* Eski süzgeç /^(dataset|system)\./ idi; yeni bir araç ailesi eklemek
     copilot-agent'ı düzenlemeyi gerektiriyordu. §38'in ajan tarafı budur. */
  const ids = copilot.toolCatalog(registry({ cp: [] })).map(tool => tool.id);
  assert.ok(ids.includes('module.catalog'), 'modül keşif aracı görünmeli');
  assert.ok(ids.includes('module.describe'));
  assert.ok(ids.includes('report.summary'), 'dataset/system dışı salt-okunur araç da görünmeli');
  assert.ok(ids.includes('dataset.aggregate'));
  // Yazma ve dış servis araçları V1'de sunulmaz: her turda reddedilmeleri
  // modeli boşuna döngüye sokardı.
  assert.ok(!ids.includes('app.order.update'));
  assert.ok(!ids.includes('connector.http'));
  // v9.23: 'ui' katmanı eklendi — veriye dokunmaz, yalnız kullanıcının
  // gördüğünü değiştirir, dolayısıyla onaysız çalışır.
  /* v9.24: 'propose' eklendi — oneri uretmek HICBIR SEY YAZMAZ, dolayisiyla
     okuma sinifindadir. Onay kapisi arac seviyesinde degil, kullanicinin
     onizlemeyi gorup Onayla'ya basmasindadir. */
  assert.deepEqual([...copilot.AUTO_RISK], ['read', 'ui', 'propose']);
  assert.ok(ids.includes('action.catalog') && ids.includes('action.propose'));
  assert.ok(ids.includes('ui.navigate') && ids.includes('ui.filter'));
});

test('v9.22 ajan Buyer Log modüllerini VERİDEN keşfediyor', async () => {
  const reg = registry({ cp: [] });
  const all = await reg.execute('module.catalog', {}, { profile, language: 'tr' });
  assert.ok(all.modules.length >= 10, 'modüller listelenmeli');
  assert.ok(all.modules.every(m => m.datasets && m.capabilities), 'her modül veri ve yetenek bildirmeli');
  // Yetkisi olmayan modül HİÇ görünmemeli: ajan "yapabilirim" deyip 403 almasın.
  const limited = await reg.execute('module.catalog', {}, { profile: { areas: ['cp'] }, language: 'tr' });
  assert.deepEqual(limited.modules.map(m => m.id), ['cp']);
  await assert.rejects(() => reg.execute('module.describe', { module: 'koleksiyon' }, { profile: { areas: ['cp'] } }),
    error => error && error.code === 'AREA_FORBIDDEN');
});

/* --------------------------------------- 3) KENDİ KENDİNİ DÜZELTME */

test('v9.22 araç hatası turu düşürmüyor, modele gözlem olarak dönüyor', async () => {
  /* Canlı koşuda model olmayan bir alan adı uydurdu (producer_id) ve tek bir
     hata bütün isteği öldürdü. Gerçek ajan hatayı okur ve düzeltir. */
  const assistant = copilot.createCopilotAssistant({
    providerFactory: () => sequenced([
      { type: 'tool_calls', calls: [{ id: 'dataset.aggregate', args: { source: 'cp', groupBy: 'producer_id', metric: 'avg', valueField: 'fob' } }] },
      { type: 'tool_calls', calls: [{ id: 'dataset.aggregate', args: { source: 'cp', groupBy: 'Manufacturer', metric: 'avg', valueField: 'FOB' } }] },
      { type: 'answer', mode: 'business', answer: 'ABC ortalama 10 FOB.' },
    ]),
  });
  const result = await assistant.respond({
    question: 'Ortalama fiyat nedir?', ownerId: 'u1', profile,
    toolRegistry: registry({ cp: [{ Manufacturer: 'ABC', FOB: 10 }] }), policyEngine: createPolicyEngine({ userAccess }),
  });
  assert.equal(result.ok, true, 'ilk hatada pes etmemeli');
  assert.equal(result.toolFailures, 1, 'hata sayılmalı ama turu düşürmemeli');
  const failed = result.toolCalls.find(call => call.error);
  assert.equal(failed.error.code, 'DATASET_FIELD_NOT_FOUND');
  // Hata mesajı modele NE YAPACAĞINI söylemeli, yoksa aynı hatayı tekrarlar.
  /* v9.24: ipucu daha da güçlendi — gerçek alan adları artık HATA MESAJININ
     kendisinde. Model ayrıca dataset.describe çağırıp bir tur harcamak
     zorunda değil; canlı koşuda tur bütçesi tam olarak orada tükeniyordu. */
  assert.match(failed.error.hint, /GERÇEK alan adlarını listeliyor/);
  assert.match(failed.error.hint, /UYDURMA/);
  assert.match(failed.error.message, /gerçek alanlar: .*Manufacturer/);
  // Başarısız çağrı kanıt sayılmamalı.
  assert.ok(result.evidence.every(item => item), 'kanıt listesi hatalı çağrı taşımamalı');
});

test('v9.22 yetki sınırı geri beslenmez, turu durdurur', async () => {
  /* Araç hatası ile YETKİ REDDİ aynı şey değil. "Siparişi değiştir" diyen
     kullanıcı, değiştirilmediğini duymalı; ajanın sessizce başka bir şey
     denemesi yanıltıcı olur. */
  const assistant = copilot.createCopilotAssistant({
    providerFactory: () => sequenced([
      { type: 'tool_calls', calls: [{ id: 'app.order.update', args: { orderCode: 1 } }] },
    ]),
  });
  await assert.rejects(() => assistant.respond({
    question: 'Siparişi değiştir', ownerId: 'u1', profile,
    toolRegistry: registry({ cp: [] }), policyEngine: createPolicyEngine({ userAccess }),
  }), error => error && error.code === 'COPILOT_TOOL_BLOCKED');
});

test('v9.22 sonsuz hata döngüsü korumalı', async () => {
  const assistant = copilot.createCopilotAssistant({
    providerFactory: () => sequenced([
      { type: 'tool_calls', calls: [{ id: 'dataset.aggregate', args: { source: 'cp', groupBy: 'yok', metric: 'avg', valueField: 'yok' } }] },
    ]),
  });
  await assert.rejects(() => assistant.respond({
    question: 'Ortalama?', ownerId: 'u1', profile,
    toolRegistry: registry({ cp: [{ Manufacturer: 'ABC', FOB: 10 }] }), policyEngine: createPolicyEngine({ userAccess }),
  }), error => error && error.code === 'COPILOT_TOOL_FAILED');
});

test('v9.22 dataset hatası modül/dataset karışıklığını açıklıyor', async () => {
  /* Canlı koşuda ajan modül kimliğini (koleksiyon, priceanalysis) dataset
     sanıp sekiz tur boşa harcadı. Hata mesajı geçerli listeyi taşımalı. */
  await assert.rejects(() => registry({ cp: [] }).execute('dataset.describe', { source: 'koleksiyon' }, { profile }),
    error => error && error.code === 'DATASET_INVALID' && /Geçerli datasetler/.test(error.message) && /collection/.test(error.message));
});

/* ------------------------------------- 4) DOĞRULAYICI YANLIŞ POZİTİFLERİ */

test('v9.22 liste numaraları uydurma sayı sayılmıyor', () => {
  const result = { answerable: true, toolResults: [{ rows: [{ manufacturer: 'Star Apparel', avg: 14.2 }] }] };
  const numbers = text => grounding.validate(text, result).problems.filter(p => p.includes('sayı'));
  assert.deepEqual(numbers('Bulgular\n1. Star Apparel\n2. Diğerleri'), [], 'satır başı sıralama');
  assert.deepEqual(numbers('Sorunlar: 1) ilki, 2) ikincisi.'), [], 'satır içi sıralama');
  // Ama GERÇEK bir sayı hâlâ araç sonucuyla eşleşmek zorunda.
  assert.equal(numbers('Toplam 12 model riskli.').length, 1, 'uydurma sayı yakalanmalı');
  assert.equal(numbers('Ortalama 14,2.').length, 0, 'doğru sayı geçmeli');
});

test('v9.22 başlıklar, para birimleri ve terim açılımları ad sayılmıyor', () => {
  const result = { answerable: true, toolResults: [{ rows: [{ manufacturer: 'Star Apparel', avg: 14.2 }] }] };
  const names = text => grounding.validate(text, result).problems.filter(p => p.includes('ad'));
  assert.deepEqual(names('## Önerilen Aksiyon\nStar Apparel pahalı.'), [], 'başlık yapısal etikettir');
  assert.deepEqual(names('Star Apparel ortalama 14,2 USD.'), [], 'para birimi ad değildir');
  assert.deepEqual(names('Star Apparel; Free On Board bazında 14,2.'), [], 'terim açılımı sözlüktür');
  // Uydurulmuş bir tedarikçi hâlâ yakalanmalı — denetim zayıflatılmadı.
  assert.equal(names('Star Apparel ve Gizli Tedarikci pahalı.').length, 1);
});

test('v9.22 yer tutucu cevap reddediliyor', () => {
  /* Canlı koşuda model aracı düzeltmek yerine şablon üretti:
     "1. [Üretici A] - Ortalama FOB: $X". Sayı ve ad denetimleri bunu KAÇIRDI
     çünkü ortada doğrulanacak değer yoktu — tam da bu yüzden geçiyordu. */
  const result = { answerable: true, toolResults: [{ rows: [{ manufacturer: 'Star Apparel', avg: 14.2 }] }] };
  for (const draft of ['1. [Üretici A] - FOB: 14,2', 'Ortalama <supplier> için 14,2', 'Sonuç {{value}} olarak 14,2']) {
    const problems = grounding.validate(draft, result).problems;
    assert.ok(problems.some(p => p.includes('yer tutucu')), `yer tutucu yakalanmalı: ${draft}`);
  }
  assert.ok(!grounding.validate('Star Apparel 14,2.', result).problems.some(p => p.includes('yer tutucu')));
});

/* --------------------------------------------------- 5) SÖZLEŞME */

test('v9.22 sistem promptu ajan davranışı tarif ediyor, modül listesi gömmüyor', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const source = fs.readFileSync(path.join(__dirname, '..', 'server', 'lib', 'copilot-agent.js'), 'utf8');
  const start = source.indexOf('function systemPrompt(');
  const block = source.slice(start, source.indexOf('function likelyBusinessFact', start));
  // Keşif → planla → hesapla → yorumla
  assert.match(block, /discover what exists \(module\.catalog, dataset\.describe\)/);
  assert.match(block, /as many tool rounds as the question deserves/);
  assert.match(block, /never in your head/, 'matematik araca yaptırılmalı');
  assert.match(block, /finding, then likely reason, then recommended action/);
  // Süreç anlatımı yasak (§32).
  assert.match(block, /Never narrate your own process/);
  assert.match(block, /Never answer with placeholders/);
  // Modül adları PROMPTA GÖMÜLMEMELİ: gömülürse yeni modül eklendiğinde bayatlar.
  assert.ok(!/koleksiyon.*priceanalysis.*opencosting/s.test(block), 'modül listesi prompta gömülmemeli');
});
