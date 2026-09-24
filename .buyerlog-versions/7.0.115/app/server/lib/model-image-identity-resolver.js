'use strict';

const parse = require('./parse');

function clean(value) { return String(value == null ? '' : value).trim(); }
function textKey(value) {
  let text = clean(value).toUpperCase();
  [['İ', 'I'], ['I', 'I'], ['Ş', 'S'], ['Ç', 'C'], ['Ö', 'O'], ['Ü', 'U'], ['Ğ', 'G']]
    .forEach(([a, b]) => { text = text.split(a).join(b); });
  return text.replace(/\s+/g, ' ').trim();
}
function orderCodeKey(value) {
  let text = clean(value);
  if (/^\d+(?:\.0+)?$/.test(text)) text = text.replace(/\.0+$/, '').replace(/^0+(?=\d)/, '');
  return textKey(text);
}
function colourCodeKey(value) { return parse.normalizeCpImageColourCode(value); }
function styleNameOf(value) { return clean(value && (value.styleName ?? value.modelName ?? value.model)); }
function orderCodeOf(value) { return clean(value && (value.orderCode ?? value.ocode ?? value['Order Code'] ?? value['Sipariş Kod'] ?? value['Sipariş Kodu'])); }
function colourCodeOf(value) { return clean(value && (value.colourCode ?? value.colorCode ?? value.ccode ?? value['Renk Kodu'] ?? value['Renk Kod'])); }
function plmIdOf(value) { return parse.normalizePlmImageId(value && (value.plmId ?? value.plm ?? value['PLM ID'] ?? value['Plm Kod'] ?? value['PLM Kod'])); }

function addCandidate(map, key, plmId) {
  const id = parse.normalizePlmImageId(plmId);
  if (!key || !id) return;
  const current = map.get(key);
  if (!current) { map.set(key, { plmId: id, conflict: false }); return; }
  if (current.plmId !== id) current.conflict = true;
}
function candidate(map, key) {
  const hit = key ? map.get(key) : null;
  return hit && !hit.conflict ? hit.plmId : '';
}

function buildIdentityIndex({ orders = [], styleLinks = {} } = {}) {
  const byOrderModelColour = new Map();
  const byModelColour = new Map();
  const byModel = new Map();

  for (const order of Array.isArray(orders) ? orders : []) {
    const model = textKey(styleNameOf(order));
    const colour = colourCodeKey(colourCodeOf(order));
    const orderCode = orderCodeKey(orderCodeOf(order));
    const plmId = plmIdOf(order);
    if (!model || !plmId) continue;
    addCandidate(byModel, model, plmId);
    if (colour) addCandidate(byModelColour, `${model}\u0000${colour}`, plmId);
    if (orderCode && colour) addCandidate(byOrderModelColour, `${orderCode}\u0000${model}\u0000${colour}`, plmId);
  }

  for (const link of Object.values(styleLinks || {})) {
    const model = textKey(link && (link.styleName ?? link.modelName ?? link.model));
    const plmId = plmIdOf(link);
    if (model && plmId) addCandidate(byModel, model, plmId);
  }
  return { byOrderModelColour, byModelColour, byModel };
}

function resolveItems(rawItems, { orders = [], styleLinks = {} } = {}) {
  const list = Array.isArray(rawItems) ? rawItems : [];
  const needsLookup = list.some(item => !plmIdOf(item));
  const index = needsLookup ? buildIdentityIndex({ orders, styleLinks }) : null;
  const resolved = [], unresolved = [];

  for (const raw of list) {
    const item = raw && typeof raw === 'object' ? { ...raw } : {};
    const styleName = styleNameOf(item);
    const model = textKey(styleName);
    const colourCode = colourCodeOf(item);
    const colour = colourCodeKey(colourCode);
    const orderCode = orderCodeOf(item);
    const order = orderCodeKey(orderCode);
    let plmId = plmIdOf(item);

    if (!plmId && index) {
      plmId = candidate(index.byOrderModelColour, order && model && colour ? `${order}\u0000${model}\u0000${colour}` : '');
      if (!plmId) plmId = candidate(index.byModelColour, model && colour ? `${model}\u0000${colour}` : '');
      if (!plmId) plmId = candidate(index.byModel, model);
    }

    if (plmId) {
      item.plmId = plmId;
      if (!item.styleName && styleName) item.styleName = styleName;
      if (!item.colourCode && colourCode) item.colourCode = colourCode;
      if (!item.orderCode && orderCode) item.orderCode = orderCode;
      resolved.push(item);
      continue;
    }

    unresolved.push({
      plmId: '',
      styleName,
      colourCode,
      orderCode,
      code: 'MODEL_PLM_ID_UNRESOLVED',
      error: styleName ? `"${styleName}" için PLM ID çözülemedi.` : 'Model kimliği (PLM ID) eksik.',
    });
  }
  return { resolved, unresolved };
}

function ordersFromRuntime(runtime) {
  const source = runtime && typeof runtime === 'object' ? runtime : {};
  const rows = [];
  if (Array.isArray(source.asasOrders)) rows.push(...source.asasOrders);
  if (source.asasOrdersByTarget && typeof source.asasOrdersByTarget === 'object') {
    Object.values(source.asasOrdersByTarget).forEach(list => { if (Array.isArray(list)) rows.push(...list); });
  }
  const seen = new Set(), out = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const key = [
      orderCodeKey(orderCodeOf(row)),
      textKey(styleNameOf(row)),
      colourCodeKey(colourCodeOf(row)),
      plmIdOf(row),
    ].join('\u0000');
    if (seen.has(key)) continue;
    seen.add(key); out.push(row);
  }
  return out;
}

module.exports = {
  textKey, orderCodeKey, buildIdentityIndex, resolveItems, ordersFromRuntime,
};
