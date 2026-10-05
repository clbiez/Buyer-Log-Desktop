'use strict';

const styleApi = require('./corenectum-style-api');

const SET_STYLE_CHILD_ASSOCIATION_URL = 'https://mym-api.lcwaikiki.com/lcw/live/corenectum/service/api/StyleMainInformation/SetStyleChildStyleColorAssociation';

function clean(value, max = 1000) {
  return String(value == null ? '' : value).replace(/\u0000/g, '').trim().slice(0, max);
}

function isSetStyle(value) {
  const source = value && typeof value === 'object'
    ? (value.productType ?? value.productTypeName)
    : value;
  return clean(source, 120).toLocaleLowerCase('tr-TR').replace(/[\s_-]+/g, '') === 'setstyle';
}

function associationQuery(styleId) {
  const id = styleApi.coreId(styleId);
  if (!id) throw Object.assign(new Error('Geçerli bir Set Style ID gerekli.'), { code: 'CORENECTUM_STYLE_ID_REQUIRED' });
  const numeric = Number(id);
  return { styleId: Number.isSafeInteger(numeric) ? numeric : id };
}

function componentLabel(styleName, index) {
  const tokens = clean(styleName, 300).toUpperCase().split(/[-_\s]+/).filter(Boolean);
  const explicit = [...tokens].reverse().find(token => /^[A-Z]$/.test(token));
  if (explicit) return explicit;
  const n = Math.max(0, Number(index) || 0);
  return n < 26 ? String.fromCharCode(65 + n) : String(n + 1);
}

function childStyleAssociations(payload) {
  const root = payload && payload.data && payload.data.coreNectumResultData;
  const groups = root && Array.isArray(root.setStyleChildStyleColorAssociations)
    ? root.setStyleChildStyleColorAssociations : [];
  const out = [];
  const seen = new Set();
  for (const group of groups) {
    for (const raw of Array.isArray(group && group.relatedStyleOptions) ? group.relatedStyleOptions : []) {
      const childStyleId = styleApi.coreId(raw && raw.childStyleId);
      const childPlmId = styleApi.coreId(raw && raw.childStylePlmCode);
      if (!childStyleId || !childPlmId) continue;
      const key = childStyleId || childPlmId;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        label: componentLabel(raw && raw.childStyleName, out.length),
        setStyleId: styleApi.coreId(raw && raw.setStyleId),
        childStyleId,
        childPlmId,
        childStyleName: clean(raw && raw.childStyleName, 300),
        childStyleOptionId: styleApi.coreId(raw && raw.childStyleOptionId),
        childStyleColorCode: clean(raw && raw.childStyleColorCode, 80),
        setStyleOptionId: styleApi.coreId(raw && raw.setStyleOptionId),
        setStyleColorCode: clean(raw && raw.setStyleColorCode, 80),
        perAssemblyCount: Number.isFinite(Number(raw && raw.perAssemblyCount)) ? Number(raw.perAssemblyCount) : null,
        specialCode: '',
        fabric: '',
        productMainDefinition: '',
      });
    }
  }
  return out;
}

function childStyleDetails(payload) {
  return styleApi.styleListRecords(payload).map(raw => ({
    plmId: styleApi.coreId(raw && raw.plmCode),
    styleId: styleApi.coreId(raw && raw.styleId),
    styleName: clean(raw && raw.styleName, 300),
    specialCode: clean(raw && raw.specialCode, 160),
    fabric: clean(raw && raw.mainFabricInfo, 1500),
    productMainDefinition: clean(raw && raw.productMainDefinitionName, 300),
  })).filter(item => item.plmId || item.styleId);
}

function enrichChildStyles(children, styleListPayload) {
  const details = childStyleDetails(styleListPayload);
  const byPlm = new Map(details.filter(item => item.plmId).map(item => [item.plmId, item]));
  const byStyle = new Map(details.filter(item => item.styleId).map(item => [item.styleId, item]));
  return (Array.isArray(children) ? children : []).map((child, index) => {
    const detail = byPlm.get(child.childPlmId) || byStyle.get(child.childStyleId) || {};
    return {
      ...child,
      label: child.label || componentLabel(detail.styleName || child.childStyleName, index),
      childStyleName: detail.styleName || child.childStyleName || '',
      specialCode: detail.specialCode || child.specialCode || '',
      fabric: detail.fabric || child.fabric || '',
      productMainDefinition: detail.productMainDefinition || child.productMainDefinition || '',
    };
  });
}

function componentLines(children, field, emptyText = '') {
  return (Array.isArray(children) ? children : [])
    .map((child, index) => {
      const label = clean(child && child.label, 20) || componentLabel(child && child.childStyleName, index);
      const value = clean(child && child[field], 2000) || clean(emptyText, 200);
      return value ? `${label} - ${value}` : '';
    })
    .filter(Boolean)
    .join('\n');
}

module.exports = {
  SET_STYLE_CHILD_ASSOCIATION_URL,
  clean,
  isSetStyle,
  associationQuery,
  componentLabel,
  childStyleAssociations,
  childStyleDetails,
  enrichChildStyles,
  componentLines,
};
