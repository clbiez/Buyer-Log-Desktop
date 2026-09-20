'use strict';

/* ===================================================================
   v6.41 — YERLEŞİK WEB BETİKLERİNİN DÜZENLENEBİLİR HÂLE GETİRİLMESİ

   Buyer Log'un dış sitelerle konuşan akışları (CoreNectum PLM görsel indirme,
   görsel küçültme, Umbrella QTX indirme) bugüne kadar agent-browser-connector
   içine GÖMÜLÜ olarak duruyordu. Dış sitelerin yapısı değiştiğinde bunları
   düzeltmek yeni sürüm gerektiriyordu.

   Kullanıcı kararı (v6.41): bu betikler Automations Terminal'den düzenlenebilsin.

   TASARIM
   · Fabrika kodu koddaki yerinde KALIR ve asla değiştirilmez. Kullanıcının
     yazdığı sürüm yalnız bir ÜST KATMANDIR (override). Bu yüzden bozuk bir
     düzenleme kalıcı hasar veremez: "Varsayılana dön" her zaman çalışır.
   · Kaydetmeden önce kod sözdizimi doğrulanır. Sözdizimi hatalı bir betik
     kaydedilirse hata ancak PLM'e gidildiğinde ortaya çıkar ve akış sessizce
     bozulur — bu zincirdeki en pahalı hata türü.
   · Her betik ortak bir sözleşmeye uyar: gövde `params` nesnesini alır ve bir
     sonuç nesnesi döndürür. Böylece parametreler metin araya sıkıştırma
     (string interpolation) ile değil, veri olarak taşınır; kullanıcının yazdığı
     kod tırnak kaçışlarıyla uğraşmak zorunda kalmaz.
   =================================================================== */

const fs = require('fs');
const path = require('path');
const { atomicWriteJson } = require('../user-data');

const SERVER_DATA_ROOT = process.env.BL_DATA_DIR || path.join(__dirname, '..', 'data');
const STORE_FILE = path.join(SERVER_DATA_ROOT, 'web-scripts.json');
const MAX_CODE_BYTES = 200000;
const MAX_HISTORY = 10;

function clean(value) {
  return String(value == null ? '' : value).trim();
}
function iso() {
  return new Date().toISOString();
}

function emptyStore() {
  return { version: 1, scripts: {}, updatedAt: iso() };
}

function loadStore() {
  try {
    const raw = fs.readFileSync(STORE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return emptyStore();
    parsed.scripts = parsed.scripts && typeof parsed.scripts === 'object' ? parsed.scripts : {};
    return parsed;
  } catch (_) {
    return emptyStore();
  }
}

function saveStore(store) {
  const next = { ...store, updatedAt: iso() };
  atomicWriteJson(STORE_FILE, next);
  return next;
}

/* -------------------------------------------------------------- DOĞRULAMA */

/* Kaydetmeden önce kodu ayrıştırır. Kod TARAYICIDA çalışacağı için burada
   çalıştırılmaz — yalnız ayrıştırılır. new Function ayrıştırma yapar ama gövdeyi
   ÇALIŞTIRMAZ, bu yüzden sunucu tarafında yan etkisi yoktur. */
function validateCode(code) {
  const text = String(code == null ? '' : code);
  if (!text.trim()) return { ok: false, error: 'Betik boş olamaz.', code: 'WEB_SCRIPT_EMPTY' };
  if (Buffer.byteLength(text, 'utf8') > MAX_CODE_BYTES) {
    return { ok: false, error: `Betik en fazla ${MAX_CODE_BYTES} bayt olabilir.`, code: 'WEB_SCRIPT_TOO_LARGE' };
  }
  try {
    // Gövde async bir fonksiyonun içinde çalışacak; doğrulama da öyle olmalı,
    // yoksa await kullanan geçerli bir betik "hatalı" sayılırdı.
    // eslint-disable-next-line no-new-func
    new Function('params', `return (async function(params){\n${text}\n});`);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: `Sözdizimi hatası: ${clean(error && error.message)}`, code: 'WEB_SCRIPT_SYNTAX_ERROR' };
  }
}

/* ------------------------------------------------------------- OKUMA/YAZMA */

function overrideFor(id) {
  const key = clean(id);
  if (!key) return null;
  const entry = loadStore().scripts[key];
  if (!entry || typeof entry !== 'object') return null;
  const code = String(entry.code == null ? '' : entry.code);
  if (!code.trim()) return null;
  return { id: key, code, updatedAt: clean(entry.updatedAt), updatedBy: clean(entry.updatedBy), revision: Number(entry.revision) || 1 };
}

// Çalışma zamanının tek giriş noktası: override varsa o, yoksa fabrika kodu.
// Bozuk override sessizce kullanılmaz — doğrulamadan geçmeyen kayıt yok sayılır
// ve fabrika koduna dönülür ki dış akış tamamen durmasın.
function resolveCode(id, factoryCode) {
  const override = overrideFor(id);
  if (!override) return { code: String(factoryCode == null ? '' : factoryCode), source: 'factory' };
  const check = validateCode(override.code);
  if (!check.ok) return { code: String(factoryCode == null ? '' : factoryCode), source: 'factory_fallback', error: check.error };
  return { code: override.code, source: 'override', updatedAt: override.updatedAt, updatedBy: override.updatedBy };
}

function saveOverride(id, code, user) {
  const key = clean(id);
  if (!key) throw Object.assign(new Error('Betik kimliği zorunlu.'), { code: 'WEB_SCRIPT_ID_REQUIRED', statusCode: 400 });
  const check = validateCode(code);
  if (!check.ok) throw Object.assign(new Error(check.error), { code: check.code, statusCode: 400 });
  const store = loadStore();
  const previous = store.scripts[key];
  // Geçmiş tutulur: kullanıcı kendi önceki sürümüne de dönebilmeli, yalnız
  // fabrika ayarına değil.
  const history = Array.isArray(previous && previous.history) ? previous.history.slice(0, MAX_HISTORY - 1) : [];
  if (previous && String(previous.code || '').trim()) {
    history.unshift({ code: previous.code, updatedAt: clean(previous.updatedAt), updatedBy: clean(previous.updatedBy) });
  }
  store.scripts[key] = {
    code: String(code),
    updatedAt: iso(),
    updatedBy: clean(user && (user.name || user.id)),
    revision: (Number(previous && previous.revision) || 0) + 1,
    history: history.slice(0, MAX_HISTORY),
  };
  saveStore(store);
  return overrideFor(key);
}

// Fabrika koduna dönüş: override kaydı tamamen silinir.
function clearOverride(id) {
  const key = clean(id);
  const store = loadStore();
  if (!store.scripts[key]) return false;
  delete store.scripts[key];
  saveStore(store);
  return true;
}

function historyFor(id) {
  const entry = loadStore().scripts[clean(id)];
  return Array.isArray(entry && entry.history) ? entry.history : [];
}

module.exports = {
  STORE_FILE,
  MAX_CODE_BYTES,
  validateCode,
  overrideFor,
  resolveCode,
  saveOverride,
  clearOverride,
  historyFor,
  loadStore,
};
