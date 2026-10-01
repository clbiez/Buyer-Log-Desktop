'use strict';

/* CoreNectum Request API — numune talepleri (style-overview → Requests sekmesi).
 *
 * CANLI DOĞRULAMA (kullanıcının kendi CoreNectum oturumunda yakalandı):
 *   POST .../api/Request/GetRequestList
 *   gövde: styleId alanında filterOperator 0 ("eşittir"), pageSize 1000
 *   yanıt: data.coreNectumResultData.requestListResult[] + totalCount
 *
 * Bu modül BİLEREK saftır (ağ yok): gövde ve yanıt ayrıştırma belirlenimci
 * sınanır. Ağ çağrısı corenectum-api-client'tan (izinli uç nokta listesi) geçer.
 * Yalnız ölçülmüş biçim kullanılır; "virgüllü liste" operatörü (10) bu uçta
 * ölçülmediği için model başına tek istek atılır. */

const engine = require('../../public/plm-sample-requests-engine');

const GET_REQUEST_LIST_URL = 'https://mym-api.lcwaikiki.com/lcw/live/corenectum/service/api/Request/GetRequestList';
const STYLE_ID_FILTER_OPERATOR = 0;
const REQUEST_LIST_PAGE_SIZE = 1000;
const REQUEST_LIST_CONCURRENCY = 5;

function requestListBody(styleId) {
  const id = engine.numericId(styleId);
  if (!id) throw Object.assign(new Error('Geçerli bir Style ID gerekli.'), { code: 'CORENECTUM_STYLE_ID_REQUIRED' });
  return {
    pageNumber: 1,
    pageSize: REQUEST_LIST_PAGE_SIZE,
    searchCriteria: { columnNames: [], searchText: '' },
    filterCriterias: [{ filterColumnName: 'styleId', filterOperator: STYLE_ID_FILTER_OPERATOR, filterValue: id }],
  };
}

/* Yanıt sarmalayıcısı sürümler arasında değişebilir (GetStyleList'te
   yaşandı); beklenen yol boşsa requestCode+styleId taşıyan dizi aranır. */
function requestListRecords(payload) {
  const core = payload && payload.data && payload.data.coreNectumResultData;
  const preferred = core && core.requestListResult;
  if (Array.isArray(preferred)) return preferred;
  let found = null;
  const visit = (value, depth = 0) => {
    if (found || depth > 8 || value == null) return;
    if (Array.isArray(value)) {
      if (value.some(item => item && typeof item === 'object' && ('requestCode' in item) && ('styleId' in item))) { found = value; return; }
      value.forEach(item => visit(item, depth + 1));
      return;
    }
    if (typeof value === 'object') Object.values(value).forEach(item => visit(item, depth + 1));
  };
  visit(payload);
  return Array.isArray(found) ? found : [];
}

/* Yalnız istenen styleId'ye ait kayıtlar kabul edilir: filtre bir sebeple
   yok sayılırsa başka modelin talebi bu modele yazılmamalı. */
function parseRequestList(payload, styleId) {
  const wanted = engine.numericId(styleId);
  const out = [];
  const seen = new Set();
  for (const record of requestListRecords(payload)) {
    const request = engine.normalizeRequest(record);
    if (!request) continue;
    if (wanted && request.styleId && request.styleId !== wanted) continue;
    if (seen.has(request.requestCode)) continue;
    seen.add(request.requestCode);
    out.push(request);
  }
  return out;
}

module.exports = {
  GET_REQUEST_LIST_URL,
  STYLE_ID_FILTER_OPERATOR,
  REQUEST_LIST_PAGE_SIZE,
  REQUEST_LIST_CONCURRENCY,
  requestListBody,
  requestListRecords,
  parseRequestList,
};
