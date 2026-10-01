'use strict';

/* PLM ANA RENK ÇÖZÜMLEYİCİSİ

   NEDEN VAR: CoreNectum'da ön+arka model görseli (Model Images,
   isDefault === true) renk kodu TAŞIMAZ; GetStyleList.imageUrl de aynı
   görseldir. Options görselleri ise renk kodludur ama yalnız ön görünüştür.
   Canlı ANDY-YI (2129219) verisi: colors = J0G, Q6K, RQL; ana renk Q6K ikinci
   sırada. PLM ana rengi hiçbir alanla bildirmez, sıra da güvenilir değildir.

   Kural (kullanıcı kararı: "grup başı + elle düzeltme"):
     1. Elle seçilen ana renk her şeyi ezer.
     2. PLM'de TEK renk varsa o renk ana renktir (lisans tişörtlerinin çoğu).
     3. Koleksiyon grup başı (parent) ana renktir; variant alt renktir.
        Grupsuz (single) satır yalnız PLM renkleri bilinmiyorsa veya tek
        renkliyse ana renk sayılır; çok renkli modelde tek başına duran bir
        siyah satıra beyaz ana görsel yazılmaz.
     4. CP / Siparişler / Backlog aynı PLM için Koleksiyon grup başını kullanır.
     5. Hiçbiri yoksa eski davranış (auto: Option önce).

   Bu modül iş gerçeğini yalnız PLM verisinden ve kullanıcının açık
   seçiminden alır; görüntü içeriğine bakarak renk tahmini YAPMAZ. */

const fs = require('fs');
const path = require('path');
const { SERVER_DATA_ROOT, atomicWriteJson } = require('../user-data');
const { normalizeCpImageColourCode } = require('./parse');

const FILE = path.join(SERVER_DATA_ROOT, 'plm-main-colours.json');
const MAX_MODELS = 100000;
const ROLE_MAIN = 'main';
const ROLE_OPTION = 'option';
const ROLE_AUTO = 'auto';
const GROUP_ROLES = new Set(['parent', 'single', 'variant']);

function clean(value, max = 500) {
  return String(value == null ? '' : value).replace(/\u0000/g, '').trim().slice(0, max);
}

function plmKey(value) {
  let text = clean(value, 80).replace(/^_+/, '');
  if (/^\d+\.0+$/.test(text)) text = text.slice(0, text.indexOf('.'));
  text = text.replace(/^0+(?=\d)/, '');
  return /^\d+$/.test(text) && Number(text) > 0 ? text : '';
}

function colourKey(value) {
  return normalizeCpImageColourCode(value);
}

function emptyStore() {
  return { schemaVersion: 1, models: {} };
}

function normalizeEntry(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const colourCodes = Array.isArray(raw.colourCodes)
    ? [...new Set(raw.colourCodes.map(code => clean(code, 40)).filter(Boolean))].slice(0, 200)
    : null;
  const entry = {};
  if (colourCodes) { entry.colourCodes = colourCodes; entry.coloursAt = clean(raw.coloursAt, 40) || null; }
  const main = clean(raw.mainColourCode, 40);
  if (main) {
    entry.mainColourCode = main;
    entry.mainColourAt = clean(raw.mainColourAt, 40) || null;
    entry.mainColourBy = clean(raw.mainColourBy, 160);
  }
  return Object.keys(entry).length ? entry : null;
}

function normalizeStore(raw) {
  const out = emptyStore();
  const models = raw && typeof raw === 'object' && raw.models && typeof raw.models === 'object' ? raw.models : {};
  for (const [plmId, value] of Object.entries(models).slice(0, MAX_MODELS)) {
    const key = plmKey(plmId);
    const entry = normalizeEntry(value);
    if (key && entry) out.models[key] = entry;
  }
  return out;
}

function loadStore(file = FILE) {
  try { return normalizeStore(JSON.parse(fs.readFileSync(file, 'utf8'))); }
  catch (_) { return emptyStore(); }
}

function saveStore(store, file = FILE) {
  atomicWriteJson(file, normalizeStore(store));
}

function entryFor(store, plmId) {
  const key = plmKey(plmId);
  return (key && store && store.models && store.models[key]) || {};
}

/* GetStyleList satırlarının renk kodlarını kaydeder. rows: Map(plmId → row)
   veya dizi; row.colors = [{ colourCode }]. Değişiklik varsa true döner. */
function rememberStyleColours(store, rows, now = new Date().toISOString()) {
  let changed = false;
  const list = rows instanceof Map ? [...rows.values()] : (Array.isArray(rows) ? rows : []);
  for (const row of list) {
    const key = plmKey(row && row.plmId);
    if (!key || !Array.isArray(row.colors)) continue;
    const codes = [...new Set(row.colors.map(item => clean(item && (item.colourCode ?? item.colorCode), 40)).filter(Boolean))];
    if (!codes.length) continue;
    const current = store.models[key] || {};
    if (Array.isArray(current.colourCodes) && current.colourCodes.join('\u0000') === codes.join('\u0000')) continue;
    store.models[key] = { ...current, colourCodes: codes, coloursAt: now };
    changed = true;
  }
  return changed;
}

/* Elle ana renk. colourCode boşsa elle seçim kaldırılır. */
function setManualMainColour(store, plmId, colourCode, actor, now = new Date().toISOString()) {
  const key = plmKey(plmId);
  if (!key) throw Object.assign(new Error('Geçerli bir PLM ID gerekli.'), { code: 'PLM_ID_REQUIRED', status: 400 });
  const code = clean(colourCode, 40);
  const current = { ...(store.models[key] || {}) };
  if (code) {
    current.mainColourCode = code;
    current.mainColourAt = now;
    current.mainColourBy = clean(actor, 160);
  } else {
    delete current.mainColourCode;
    delete current.mainColourAt;
    delete current.mainColourBy;
  }
  if (Object.keys(current).length) store.models[key] = current;
  else delete store.models[key];
  return { plmId: key, mainColourCode: code };
}

/* Koleksiyon satırlarından PLM → grup başı renk kodu. Aynı PLM için farklı
   renkte iki grup başı varsa PLM belirsiz sayılır ve haritaya girmez. */
function collectionMainColours(rows) {
  const out = new Map();
  const ambiguous = new Set();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || row.modelGroupRole !== 'parent') continue;
    const key = plmKey(row.plmId);
    const code = clean(row.colourCode, 40);
    if (!key || !code) continue;
    const previous = out.get(key);
    if (previous && colourKey(previous) !== colourKey(code)) ambiguous.add(key);
    else out.set(key, code);
  }
  for (const key of ambiguous) out.delete(key);
  return out;
}

/* Tek bir görsel isteğinin rolünü çözer.
   Dönen alanlar:
     imageRole  'main' | 'option' | 'auto'
     roleProbe  PLM renkleri bilinmiyor ve rol kesinleşmedi: bir kez
                GetStyleList ile doğrulanmalı (eski Option görseli tek renkli
                modelde ana görsele dönebilir).
     roleDemote rol KESİN olarak ana renk değil: geçmişte ana görselle
                (ön+arka) yazılmış kayıt alt renk görseline dönmeli. */
function resolveImageRole(request, { entry = {}, collectionMainColour = '' } = {}) {
  const wanted = colourKey(request && (request.colourCode ?? request.colorCode));
  const requested = clean(request && request.imageRole, 20).toLowerCase();
  const groupRole = clean(request && request.groupRole, 20).toLowerCase();
  const codes = Array.isArray(entry.colourCodes) ? entry.colourCodes : null;
  const manual = colourKey(entry.mainColourCode);
  const result = (imageRole, extra = {}) => ({ imageRole, roleProbe: false, roleDemote: false, ...extra });

  if (manual && wanted) {
    return wanted === manual ? result(ROLE_MAIN, { reason: 'manual' }) : result(ROLE_OPTION, { roleDemote: true, reason: 'manual' });
  }
  if (codes && codes.length === 1 && (!wanted || colourKey(codes[0]) === wanted)) {
    return result(ROLE_MAIN, { reason: 'single-colour' });
  }
  const multiColour = Boolean(codes && codes.length > 1);
  if (groupRole === 'parent') return result(ROLE_MAIN, { reason: 'collection-parent' });
  if (groupRole === 'variant') return result(ROLE_OPTION, { reason: 'collection-variant' });
  if (groupRole === 'single') {
    if (multiColour) return result(ROLE_AUTO, { roleDemote: true, reason: 'collection-single-multicolour' });
    return result(ROLE_MAIN, { roleProbe: !codes, reason: 'collection-single' });
  }
  if (!GROUP_ROLES.has(groupRole) && (requested === ROLE_MAIN || requested === ROLE_OPTION)) {
    return result(requested, { reason: 'request' });
  }
  const parent = colourKey(collectionMainColour);
  if (parent && wanted) {
    return wanted === parent ? result(ROLE_MAIN, { reason: 'collection-parent' }) : result(ROLE_OPTION, { reason: 'collection-parent' });
  }
  return result(ROLE_AUTO, { roleProbe: !codes, reason: 'unknown' });
}

module.exports = {
  FILE,
  emptyStore,
  normalizeStore,
  loadStore,
  saveStore,
  entryFor,
  rememberStyleColours,
  setManualMainColour,
  collectionMainColours,
  resolveImageRole,
  plmKey,
};
