/* Buyer Log — PLM NUMUNE TALEPLERİ MOTORU (CoreNectum "Requests" sekmesi)
 *
 * KAYNAK: CoreNectum style-overview → Requests sekmesi, canlı trafikte ÖLÇÜLDÜ:
 *   POST .../api/Request/GetRequestList
 *   { pageNumber:1, pageSize:1000, searchCriteria:{columnNames:[],searchText:''},
 *     filterCriterias:[{ filterColumnName:'styleId', filterOperator:0, filterValue:'<styleId>' }] }
 *   → data.coreNectumResultData.requestListResult[]
 *
 * Bu motor HAM kaydı Buyer Log'un okuduğu küçük şekle çevirir ve CP kontrol
 * listesinin "PPS / S-Off / Kritik numune / Artwork onayı alındı mı?"
 * sorularına PLM KANITI üretir.
 *
 * DÜRÜSTLÜK KURALI (cp-checklist-engine ile aynı): PLM'de talep YOKSA bu
 * "onay yok" demek DEĞİLDİR. Kanıt yalnız gerçekten var olan talepten üretilir;
 * talep yoksa kanıt da yoktur ve soru eskisi gibi kullanıcıya sorulur.
 *
 * SAF: DOM yok, fetch yok, AI yok. Sunucu (normalize/saklama) ve istemci
 * (CP kontrol listesi, numune penceresi) AYNI sınıflandırmayı kullanır.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.BLPlmSampleRequestsEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const STATUS = Object.freeze({ APPROVED: 'approved', OPEN: 'open', REJECTED: 'rejected', CANCELLED: 'cancelled' });

  /* Canlı veride görülen durum kimlikleri. Bilinmeyen kimlik adından
     sınıflandırılır; ad da tanınmazsa "açık" sayılır (onaylı SAYILMAZ). */
  const STATUS_BY_ID = Object.freeze({ 14: STATUS.APPROVED, 9: STATUS.OPEN });

  /* Kilometre taşları CP kontrol listesi kimlikleriyle BİREBİR aynıdır
     (cp-checklist-engine ITEMS). Böylece eşleme tek yerde durur. */
  const MILESTONES = Object.freeze(['pps', 'soff', 'criticalSample', 'artwork']);

  /* Canlı veride görülen alt tip kimlikleri. Diğerleri addan eşlenir. */
  const MILESTONE_BY_SUBTYPE_ID = Object.freeze({ 146: 'artwork', 39: 'soff', 12: 'criticalSample' });

  function clean(value, max = 300) {
    return String(value == null ? '' : value).replace(/\u0000/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
  }

  function numericId(value) {
    let text = clean(value, 40);
    if (/^\d+\.0+$/.test(text)) text = text.slice(0, text.indexOf('.'));
    text = text.replace(/^0+(?=\d)/, '');
    return /^\d+$/.test(text) && Number(text) > 0 ? text : '';
  }

  function isoOrNull(value) {
    const text = clean(value, 40);
    if (!text) return null;
    const time = Date.parse(text);
    return Number.isFinite(time) ? new Date(time).toISOString() : null;
  }

  function classifyStatus(statusId, statusName) {
    const byId = STATUS_BY_ID[numericId(statusId)];
    if (byId) return byId;
    const name = clean(statusName, 120).toLowerCase();
    if (/cancel|iptal/.test(name)) return STATUS.CANCELLED;
    if (/reject|red edil|reddedil/.test(name)) return STATUS.REJECTED;
    if (/approv|complet|onay|tamamlan/.test(name)) return STATUS.APPROVED;
    return STATUS.OPEN;
  }

  /* Alt tip → kontrol listesi kalemi. Sıra önemli: "Perfect Sign Off
     Fitting" içinde "Fitting" de geçer, bu yüzden S/Off önce denenir. */
  function classifyMilestone(subTypeId, subTypeName) {
    const byId = MILESTONE_BY_SUBTYPE_ID[numericId(subTypeId)];
    if (byId) return byId;
    const name = clean(subTypeName, 160).toLowerCase();
    if (!name) return '';
    if (/sign\s*-?\s*off|\bs\s*\/\s*off\b/.test(name)) return 'soff';
    if (/\bpps\b|pre\s*-?\s*production/.test(name)) return 'pps';
    if (/fit\s*sample|size\s*set|\bseal/.test(name)) return 'criticalSample';
    if (/artwork/.test(name)) return 'artwork';
    return '';
  }

  function normalizeRequest(record) {
    if (!record || typeof record !== 'object') return null;
    const requestCode = numericId(record.requestCode);
    const requestId = numericId(record.requestId);
    if (!requestCode && !requestId) return null;
    const statusName = clean(record.requestStatusName, 120);
    const subTypeName = clean(record.requestSubTypeName, 160);
    return {
      requestId,
      requestCode: requestCode || requestId,
      styleId: numericId(record.styleId),
      plmId: numericId(record.itemCode),
      statusId: numericId(record.requestStatusId),
      statusName,
      status: classifyStatus(record.requestStatusId, statusName),
      typeId: numericId(record.requestTypeId),
      typeName: clean(record.requestTypeName, 160),
      subTypeId: numericId(record.requestSubTypeId),
      subTypeName,
      milestone: classifyMilestone(record.requestSubTypeId, subTypeName),
      iteration: Math.max(0, Math.trunc(Number(record.iteration)) || 0),
      supplierName: clean(record.supplierName, 200),
      responsibleUserName: clean(record.responsibleUserName, 200),
      approverUserName: clean(record.approverUserName, 200),
      sizeName: clean(record.sizeName, 60),
      createdDate: isoOrNull(record.createdDate),
      requestDate: isoOrNull(record.requestDate),
      approvedDate: isoOrNull(record.approvedDate),
      modifiedDate: isoOrNull(record.modifiedDate),
    };
  }

  /* Talebin "durum tarihi": onay tarihi çoğu kayıtta boş geliyor (canlı
     veri), bu yüzden son değişiklik ve oluşturma tarihine düşülür. */
  function statusDate(request) {
    return (request && (request.approvedDate || request.modifiedDate || request.createdDate)) || null;
  }

  function newerFirst(a, b) {
    return (b.iteration - a.iteration)
      || String(b.createdDate || '').localeCompare(String(a.createdDate || ''))
      || (Number(b.requestCode) || 0) - (Number(a.requestCode) || 0);
  }

  /* Bir modelin talepleri → kilometre taşı özeti.
     Her alt tip için YALNIZ en güncel talep (iterasyon/oluşturma) sayılır:
     reddedilip ikinci iterasyonda açılan Fit, "açık"tır. İptal edilen talep
     hiçbir şey kanıtlamaz ve yok sayılır.
       open      → alt tiplerden biri hâlâ açık
       rejected  → açık yok, en az biri reddedilmiş
       approved  → hepsi onaylı */
  function summarizeMilestones(requests) {
    const byMilestone = {};
    for (const request of Array.isArray(requests) ? requests : []) {
      if (!request || !request.milestone || request.status === STATUS.CANCELLED) continue;
      const subKey = request.subTypeId || request.subTypeName.toLowerCase();
      const bucket = byMilestone[request.milestone] || (byMilestone[request.milestone] = new Map());
      const current = bucket.get(subKey);
      if (!current || newerFirst(request, current) < 0) bucket.set(subKey, request);
    }
    const out = {};
    for (const milestone of MILESTONES) {
      const bucket = byMilestone[milestone];
      if (!bucket || !bucket.size) continue;
      const latest = [...bucket.values()].sort(newerFirst);
      const open = latest.filter(item => item.status === STATUS.OPEN);
      const rejected = latest.filter(item => item.status === STATUS.REJECTED);
      const state = open.length ? STATUS.OPEN : rejected.length ? STATUS.REJECTED : STATUS.APPROVED;
      const lead = (open[0] || rejected[0] || latest[0]);
      out[milestone] = {
        milestone,
        state,
        requestCode: lead.requestCode,
        statusName: lead.statusName,
        subTypeName: lead.subTypeName,
        date: statusDate(lead),
        requests: latest.map(item => ({ requestCode: item.requestCode, subTypeName: item.subTypeName, status: item.status, statusName: item.statusName })),
      };
    }
    return out;
  }

  /* CP kontrol listesi için kanıt. Yalnız PLM'de gerçekten talep varsa döner. */
  function evidenceFor(milestones, itemId) {
    if (!milestones || !MILESTONES.includes(itemId)) return null;
    return milestones[itemId] || null;
  }

  const STATUS_LABELS = Object.freeze({
    tr: { approved: 'Onaylandı', open: 'Devam ediyor', rejected: 'Reddedildi', cancelled: 'İptal' },
    en: { approved: 'Approved', open: 'In progress', rejected: 'Rejected', cancelled: 'Cancelled' },
  });

  return {
    STATUS, STATUS_BY_ID, MILESTONES, MILESTONE_BY_SUBTYPE_ID, STATUS_LABELS,
    numericId, classifyStatus, classifyMilestone, normalizeRequest, statusDate,
    summarizeMilestones, evidenceFor,
  };
});
