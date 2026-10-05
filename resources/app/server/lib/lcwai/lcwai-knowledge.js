'use strict';

/*
 * BuyerLogKnowledgeService — LCW AI'ın Buyer Log'u "bilmesi".
 *
 * Her AI isteği üç katmanla kurulur:
 *   1) GLOBAL   — Buyer Log nedir, modüller, veri kaynakları, iş kavramları,
 *                 AI'ın yapabileceği/yapamayacağı şeyler. Kısa; her istekte.
 *   2) MODULE   — yalnız istekle ilgili modülün teknik bilgisi. Formül,
 *                 kural ve otomasyon bilgisi GERÇEK motorlardan üretilir
 *                 (public/formula-engine.js, public/cp-rules-engine.js,
 *                 server/lib/ai-capability-registry.js); elle yazılmış bir
 *                 kopya yoktur, kod değişince bilgi de değişir.
 *   3) RUNTIME  — çağıran ekranın verisi (lcwai-prompt.js ekler).
 *
 * Bütün dokümantasyon hiçbir istekte gönderilmez: selectModules() isteğin
 * kaynağına, eklenen bağlamın ekranına ve metindeki anahtar kelimelere göre
 * en fazla birkaç modül seçer; her modül bir karakter bütçesiyle kesilir.
 */

const KNOWLEDGE_VERSION = '2026-10-05.1';
const MODULE_BUDGET_CHARS = 9000;
const MAX_MODULES = 2;

function clean(value) { return String(value == null ? '' : value).trim(); }
function pick(lang, value) { return value && typeof value === 'object' ? (lang === 'en' ? value.en : value.tr) : clean(value); }
function lower(value) { return clean(value).toLocaleLowerCase('tr-TR'); }

const GLOBAL_KNOWLEDGE = Object.freeze({
  tr: [
    'Buyer Log, LC Waikiki lisanslı triko siparişlerini tedarikçiden mağazaya kadar izleyen, yerel çalışan bir masaüstü uygulamasıdır (Node + Express sunucu, tarayıcı arayüzü).',
    'Modüller: Overview (günün öncelikleri, CP kuralları ve checklist), CP Tracker (üretim/yükleme takibi), Siparişler, Backlog (teslimat riski ve plan-gerçekleşen), Nakliye Kıyaslama, Koleksiyon (ürün geliştirme, görseller), Quotations ve Fiyat Geçmişi, Fiyat & Üretici Analizi, Üreticiler, LFL Analizi, Ön Maliyet, Otomasyonlar, Veri Yönetimi.',
    'Veri kaynakları: ASAS (sipariş/model), CoreNectum PLM (stil, görsel, numune talepleri), PASS/OAB (bütçe raporu), IAS/Antrepo, kullanıcı Excel dosyaları. Ortak alanlar kanonik alan kimlikleriyle okunur.',
    'Kavramlar: MB / Ex-Factory = tedarikçinin yükleme tarihi. Yol süresi kuralı = ülke + sevkiyat tipine göre yüklemeden depoya gün. Tahmini varış = yükleme + yol süresi. Hedef tarih = Retail Depo ya da In Store (mağaza giriş) tarihi. Öncelikler: CRITICAL (Kritik, kırmızı) > ACTION_TODAY > ACTION_THIS_WEEK > WATCH.',
    'Çalışma ilkeleri: AI yalnız öneri üretir; Buyer Log önerileri kendi deterministik motoruyla doğrular ve kullanıcı onaylamadan hiçbir şey kaydedilmez. AI veriyi değiştiremez, e-posta gönderemez, sisteme yazamaz.',
    'Buyer Log\'un bir davranışından emin değilsen uydurma; "emin değilim" de ve neyin doğrulanması gerektiğini söyle. Buyer Log formülleri, kuralları ve otomasyonları için yalnız MODÜL BİLGİSİ\'nde verilen sözdizimini kullan; genel Excel/JavaScript/SQL sözdizimi Buyer Log\'da çalışmaz.',
  ].join('\n'),
  en: [
    'Buyer Log is a locally running desktop app tracking LC Waikiki licensed knitwear orders from supplier to store (Node + Express server, browser UI).',
    'Modules: Overview (today\'s priorities, CP rules and checklist), CP Tracker (production/loading follow-up), Orders, Backlog (delivery risk and plan vs actual), Shipping Comparison, Collection (product development, images), Quotations and Pricing History, Price & Supplier Analysis, Manufacturers, LFL Analysis, Open Costing, Automations, Data Management.',
    'Data sources: ASAS (orders/models), CoreNectum PLM (styles, images, sample requests), PASS/OAB (budget report), IAS/bonded warehouse, user Excel files. Shared fields are read through canonical field ids.',
    'Concepts: MB / Ex-Factory = supplier loading date. Transit-time rule = days from loading to warehouse by country + shipment type. Estimated arrival = loading + transit time. Target date = Retail warehouse or In Store (store entry) date. Priorities: CRITICAL (red) > ACTION_TODAY > ACTION_THIS_WEEK > WATCH.',
    'Principles: AI only suggests; Buyer Log validates suggestions with its own deterministic engines and nothing is saved without the user\'s approval. AI cannot change data, send e-mail or write to the system.',
    'If unsure about a Buyer Log behaviour, do not invent it; say so and state what should be verified. For Buyer Log formulas, rules and automations use only the syntax given in MODULE KNOWLEDGE; generic Excel/JavaScript/SQL syntax does not work in Buyer Log.',
  ].join('\n'),
});

/* Modül bilgisi üreticileri. Motorlar tembel yüklenir ve sonuç dil başına
   önbelleğe alınır (motor dosyaları süreç ömründe değişmez). */
function formulaKnowledge(lang) {
  const engine = require('../../../public/formula-engine.js');
  const text = engine.buildAiPrompt({ lang, columns: [], request: '' });
  // Sütun listesi ve cevap biçimi çalışma zamanına aittir; yalnız dil kuralları.
  const marker = text.indexOf(lang === 'en' ? 'COLUMNS OF THE' : 'TABLOSUNUN SÜTUNLARI');
  const cut = marker > 0 ? text.lastIndexOf('\n', marker) : -1;
  return (cut > 0 ? text.slice(0, cut) : text).trim();
}
function rulesKnowledge(lang) {
  const Rules = require('../../../public/cp-rules-engine.js');
  const guide = Rules.buildAiGuide({ lang, kind: 'priority', fields: { derived: Rules.DERIVED_FIELDS || [], checklist: [], rules: [], columns: [] }, request: '' });
  const meanings = (Rules.DERIVED_FIELDS || []).filter(item => item.meaning).map(item => `- [${lang === 'en' ? item.en : item.tr}]: ${pick(lang, item.meaning)}`);
  return [guide.trim(), '', lang === 'en' ? 'FIELD MEANINGS' : 'ALAN ANLAMLARI', ...meanings].join('\n');
}
function automationKnowledge(lang) {
  const A = require('../../../public/automation-assistant.js');
  const registry = require('../ai-capability-registry');
  const model = registry.getCapabilityModel();
  const rules = (A.DSL_RULES || []).map((rule, index) => `${index + 1}. ${pick(lang, rule)}`);
  const dictionary = (A.DSL_DICTIONARY || []).map(section => [`## ${pick(lang, section)}`, ...section.items.map(item => `- ${A.dslSyntax ? A.dslSyntax(item, lang) : item.syntax} — ${pick(lang, item)}`)].join('\n'));
  const triggers = (model.triggers || []).map(item => `${item.id}${item.parameters && item.parameters.length ? `(${item.parameters.join(', ')})` : ''}`).join(', ');
  const actions = (model.actions || []).map(item => `- ${item.id}: ${item.description}`).join('\n');
  const datasets = (model.datasets || []).map(item => item.id).join(', ');
  return [
    `Automation Code ${model.automationLanguageVersion}`,
    lang === 'en' ? 'RULES' : 'KURALLAR', ...rules, '',
    ...dictionary, '',
    `${lang === 'en' ? 'Datasets' : 'Veri kaynakları'}: ${datasets}`,
    `${lang === 'en' ? 'Triggers' : 'Tetikleyiciler'}: ${triggers}`,
    lang === 'en' ? 'Actions:' : 'Eylemler:', actions,
    '', lang === 'en' ? 'Example' : 'Örnek', A.dslExample ? A.dslExample(lang) : A.DSL_EXAMPLE,
  ].join('\n');
}
function backlogKnowledge(lang) {
  const engine = require('../../../public/backlog-delivery-engine.js');
  const labels = engine.OUTCOME_LABELS || {};
  const outcomes = (engine.OUTCOMES || []).map(key => `- ${key}: ${(labels[lang] || labels.tr || {})[key] || key}`);
  return [
    lang === 'en'
      ? 'Backlog lists open orders not yet delivered. Each row gets a delivery assessment from loading date + transit-time rule against the target date (Retail or In Store).'
      : 'Backlog teslim edilmemiş açık siparişleri listeler. Her satır, yükleme tarihi + yol süresi kuralıyla hedef tarihe (Retail ya da In Store) göre teslimat değerlendirmesi alır.',
    lang === 'en' ? 'Delivery outcomes:' : 'Teslimat sonuçları:', ...outcomes,
  ].join('\n');
}

function testReportKnowledge(lang) {
  return require('../../../public/test-report-engine.js').aiKnowledge(lang);
}

const STATIC_MODULES = Object.freeze({
  orders: { tr: 'Siparişler: ASAS sipariş satırları (PO, model, renk, tedarikçi, adet, FOB, tarihler). CP Tracker aynı siparişlerin üretim/yükleme takibidir; kontrol listesi (PPS, S/Off, test, artwork onayları) CP satırlarına bağlıdır.', en: 'Orders: ASAS order lines (PO, model, colour, supplier, quantity, FOB, dates). CP Tracker follows the production/loading of the same orders; the checklist (PPS, S/Off, test, artwork approvals) is attached to CP rows.' },
  collection: { tr: 'Koleksiyon: sezon geliştirme çalışma alanı; ürün/model satırları, PLM bağlantıları, görseller, durum kataloğu ve fiyat teklifleri (Quotations).', en: 'Collection: season development workspace; product/model rows, PLM links, images, status catalogue and quotations.' },
});

const MODULES = Object.freeze({
  'calculated-column': { title: { tr: 'Hesaplanan Sütun formül dili', en: 'Calculated Column formula language' }, keywords: ['formül', 'formul', 'formula', 'hesaplanan sütun', 'calculated column', 'kolon', 'sütun', 'column'], build: formulaKnowledge },
  rules: { title: { tr: 'CP öncelik/checklist kural dili', en: 'CP priority/checklist rule language' }, keywords: ['kural', 'rule', 'öncelik', 'priority', 'kritik', 'critical', 'checklist', 'kontrol listesi'], build: rulesKnowledge },
  automations: { title: { tr: 'Automation Code', en: 'Automation Code' }, keywords: ['otomasyon', 'automation', 'tetik', 'trigger', 'e-posta', 'email', 'mail at', 'bildirim'], build: automationKnowledge },
  backlog: { title: { tr: 'Backlog ve teslimat riski', en: 'Backlog and delivery risk' }, keywords: ['backlog', 'gecikme', 'delay', 'teslimat', 'delivery', 'yetiş', 'in store', 'retail'], build: backlogKnowledge },
  orders: { title: { tr: 'Siparişler ve CP', en: 'Orders and CP' }, keywords: ['sipariş', 'siparis', 'order', 'po ', 'cp ', 'cp tracker', 'tedarikçi', 'supplier'], build: lang => pick(lang, STATIC_MODULES.orders) },
  'test-reports': { title: { tr: 'Test raporu aktarımı', en: 'Test report import' }, keywords: ['test raporu', 'test report', 'talep no', 'request no', 'labright', 'ticari onay', 'commercial approval', 'gold seal', 'tekrar test', 'retest'], build: testReportKnowledge },
  collection: { title: { tr: 'Koleksiyon', en: 'Collection' }, keywords: ['koleksiyon', 'collection', 'model geliştirme', 'quotation', 'teklif'], build: lang => pick(lang, STATIC_MODULES.collection) },
});

// Bağlam sağlayıcısının ekranı → ilgili modül bilgisi.
const SCREEN_MODULES = Object.freeze({ cp: 'orders', orders: 'orders', overview: 'rules', backlog: 'backlog', koleksiyon: 'collection', collection: 'collection', automations: 'automations' });

const cache = new Map();
function moduleKnowledge(key, lang) {
  const module = MODULES[key];
  if (!module) return '';
  const cacheKey = `${key}:${lang}`;
  if (!cache.has(cacheKey)) {
    let text = '';
    try { text = clean(module.build(lang)); } catch (_) { text = ''; }
    cache.set(cacheKey, text.length > MODULE_BUDGET_CHARS ? `${text.slice(0, MODULE_BUDGET_CHARS)}…` : text);
  }
  return cache.get(cacheKey);
}

/* İstekle ilgili modüller. Sözleşmeli (bağlama özel) kaynak kendi modülünü
   alır; genel sohbette eklenen bağlamın ekranı ve metindeki anahtar
   kelimeler belirler. `exclude` zaten gönderilmiş/rehberle gelen modüllerdir. */
function selectModules({ source = '', task = '', screens = [], exclude = [] } = {}) {
  const skip = new Set(exclude);
  const chosen = [];
  const add = key => { if (MODULES[key] && !skip.has(key) && !chosen.includes(key) && chosen.length < MAX_MODULES) chosen.push(key); };
  if (MODULES[source]) add(source);
  if (/^test-report-/.test(clean(source))) add('test-reports');
  for (const screen of screens) add(SCREEN_MODULES[clean(screen)] || '');
  const text = ` ${lower(task)} `;
  if (text.trim()) {
    const scored = Object.entries(MODULES)
      .map(([key, module]) => [key, module.keywords.filter(word => text.includes(word)).length])
      .filter(([, score]) => score > 0)
      .sort((a, b) => b[1] - a[1]);
    for (const [key] of scored) add(key);
  }
  return chosen;
}

function globalKnowledge(lang) { return lang === 'en' ? GLOBAL_KNOWLEDGE.en : GLOBAL_KNOWLEDGE.tr; }

module.exports = { KNOWLEDGE_VERSION, MODULES, GLOBAL_KNOWLEDGE, SCREEN_MODULES, MODULE_BUDGET_CHARS, MAX_MODULES, globalKnowledge, moduleKnowledge, selectModules };
