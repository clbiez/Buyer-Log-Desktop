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

  /* Talebin etkin durumu: talep durumu + "Sample Evaluation Status".
     Talep durumu açık kalmış ama numune değerlendirmesi onaylıysa talep
     onaylı sayılır (kullanıcı kararı). Değerlendirme reddi talebi
     reddetmez; talep durumu esas kalır. */
  function evaluationApproves(evaluationName) {
    const name = clean(evaluationName, 120).toLowerCase();
    return Boolean(name) && !/reject|red edil|reddedil|cancel|iptal/.test(name) && /approv|complet|onay|tamamlan/.test(name);
  }
  function requestStatus(statusId, statusName, evaluationName) {
    const base = classifyStatus(statusId, statusName);
    if (base !== STATUS.APPROVED && base !== STATUS.CANCELLED && evaluationApproves(evaluationName)) return STATUS.APPROVED;
    return base;
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
    const evaluationStatusName = clean(record.styleSampleEvaluationStatusName, 120);
    return {
      requestId,
      requestCode: requestCode || requestId,
      styleId: numericId(record.styleId),
      plmId: numericId(record.itemCode),
      statusId: numericId(record.requestStatusId),
      statusName,
      evaluationStatusName,
      status: requestStatus(record.requestStatusId, statusName, evaluationStatusName),
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

  /* NUMUNE AŞAMA SIRASI (kullanıcı tanımı):
       Fit (ölçü, kalıp, işçilik)  ─┐
       Artwork → S/Off (baskı/nakış) ┴→ PPS (hem Fit'i hem Artwork'ü içerir)
     Fit ve S/Off birbirinden bağımsız yürür. PPS son aşamadır: PPS onayı
     Fit, S/Off ve Artwork'ün de onaylandığını kanıtlar. S/Off, Artwork'ün
     baskı/nakış onayı olduğu için S/Off onayı Artwork'ü de onaylar. */
  const IMPLIES = Object.freeze({
    pps: Object.freeze(['criticalSample', 'soff', 'artwork']),
    soff: Object.freeze(['artwork']),
  });

  /* Üretimi bitmiş siparişin aşamaları. Onaysız yükleme yapılmadığı için bu
     aşamalardaki siparişin numuneleri PLM kaydına bakılmadan onaylı sayılır
     (kullanıcı kararı). UNKNOWN ve PRODUCTION bu kümede DEĞİLDİR. */
  const POST_PRODUCTION_STAGES = Object.freeze(['LOADING', 'SHORTAGE', 'IN_TRANSIT', 'CUSTOMS', 'IN_WAREHOUSE', 'AWAITING_RETAIL_TRANSFER']);
  function isPostProductionStage(stage) { return POST_PRODUCTION_STAGES.includes(String(stage || '').toUpperCase()); }

  function compactRequest(item) {
    return { requestCode: item.requestCode, subTypeName: item.subTypeName, status: item.status, statusName: item.statusName, iteration: item.iteration };
  }

  /* Bir modelin talepleri → kilometre taşı özeti.

     PLM'deki kullanıcı karışıklığına dayanıklı kural (canlı örnek: Artwork
     4609404 onaylı, sonra 4609804/4611322/4614717 "Evaluated" açılmış):
       1) Bir alt tipte (ör. Artwork, Perfect Pre Production Fitting) ONAYLI
          bir giriş varsa o alt tip onaylıdır; sonradan açılan onaysız
          girişler dikkate alınmaz.
       2) Onaylı giriş yoksa en güncel giriş (iterasyon/oluşturma) belirler:
          reddedilip yeni iterasyonda açılan talep "açık"tır.
       3) İptal edilen talep hiçbir şey kanıtlamaz.
       4) Kalem: tüm alt tipleri onaylıysa onaylı; değilse açık alt tip varsa
          açık, yoksa reddedildi.
       5) Üst aşama onayı alt aşamaları onaylar (IMPLIES); bu çıkarım
          `inferredFrom` ile işaretlenir. */
  function summarizeMilestones(requests) {
    const byMilestone = {};
    for (const request of Array.isArray(requests) ? requests : []) {
      if (!request || !request.milestone || request.status === STATUS.CANCELLED) continue;
      const subKey = request.subTypeId || String(request.subTypeName || '').toLowerCase();
      const buckets = byMilestone[request.milestone] || (byMilestone[request.milestone] = new Map());
      if (!buckets.has(subKey)) buckets.set(subKey, []);
      buckets.get(subKey).push(request);
    }
    const out = {};
    for (const milestone of MILESTONES) {
      const buckets = byMilestone[milestone];
      if (!buckets || !buckets.size) continue;
      const decided = [...buckets.values()].map(list => {
        const sorted = list.slice().sort(newerFirst);
        return sorted.find(item => item.status === STATUS.APPROVED) || sorted[0];
      }).sort(newerFirst);
      const open = decided.filter(item => item.status === STATUS.OPEN);
      const rejected = decided.filter(item => item.status === STATUS.REJECTED);
      const state = open.length ? STATUS.OPEN : rejected.length ? STATUS.REJECTED : STATUS.APPROVED;
      const lead = open[0] || rejected[0] || decided[0];
      const all = [].concat(...[...buckets.values()]).sort(newerFirst);
      out[milestone] = {
        milestone,
        state,
        requestCode: lead.requestCode,
        statusName: lead.statusName,
        subTypeName: lead.subTypeName,
        date: statusDate(lead),
        inferredFrom: '',
        requests: all.map(compactRequest),
      };
    }
    // Üst aşama onayı → alt aşamalar onaylı (PPS → Fit/S-Off/Artwork, S/Off → Artwork).
    for (const upper of ['pps', 'soff']) {
      const source = out[upper];
      if (!source || source.state !== STATUS.APPROVED) continue;
      for (const lower of IMPLIES[upper]) {
        const current = out[lower];
        if (current && current.state === STATUS.APPROVED) continue;
        out[lower] = {
          milestone: lower,
          state: STATUS.APPROVED,
          requestCode: source.requestCode,
          statusName: source.statusName,
          subTypeName: source.subTypeName,
          date: source.date,
          inferredFrom: source.inferredFrom || upper,
          requests: current ? current.requests : [],
        };
      }
    }
    return out;
  }

  /* Sipariş aşaması üretim sonrasıysa (yükleme, yol, gümrük, depo…) tüm
     numune kalemleri onaylı kabul edilir; PLM kaydı varsa korunur, yalnız
     durum ve çıkarım kaynağı değişir. */
  function applyOrderStage(milestones, stage) {
    if (!isPostProductionStage(stage)) return milestones || null;
    const out = {};
    for (const milestone of MILESTONES) {
      const current = milestones && milestones[milestone];
      out[milestone] = current && current.state === STATUS.APPROVED ? current : {
        milestone,
        state: STATUS.APPROVED,
        requestCode: current ? current.requestCode : '',
        statusName: current ? current.statusName : '',
        subTypeName: current ? current.subTypeName : '',
        date: current ? current.date : null,
        inferredFrom: 'stage',
        stage: String(stage).toUpperCase(),
        requests: current ? current.requests : [],
      };
    }
    return out;
  }

  /* CP kontrol listesi için kanıt. PLM talebi, aşama zinciri ya da üretim
     sonrası sipariş aşaması yoksa kanıt yoktur (soru sorulur). */
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
    IMPLIES, POST_PRODUCTION_STAGES,
    numericId, classifyStatus, requestStatus, evaluationApproves, classifyMilestone, normalizeRequest, statusDate,
    summarizeMilestones, applyOrderStage, isPostProductionStage, evidenceFor,
  };
});
