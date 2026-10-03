/* Buyer Log v9.48 — CP KONTROL LİSTESİ MOTORU
 *
 * Buyer Log'da numune, test, kumaş hazırlığı, aksesuar ve üretici teyidi için
 * SÜTUN YOK ve açılmayacak. Bu bilgiler yine de takip edilmeli — çözüm:
 * bunları veri değil SORU olarak sormak.
 *
 *   "Yüklemeye 6 hafta kaldı. PPS onayı alındı mı?"
 *        → kullanıcı [Tamamlandı] işaretler
 *        → aynı soru bir daha sorulmaz
 *
 * TASARIM KARARLARI:
 *
 * 1) CEVAP VERİ DEĞİLDİR. Kullanıcının "tamamlandı" işareti bir iş verisi
 *    alanı değil, o kullanıcının kendi takip notudur. Bu yüzden sipariş
 *    satırına YAZILMAZ, kullanıcıya ait ayrı bir kayıtta durur ve hiçbir
 *    hesaplamayı (risk, ETA, öncelik) DEĞİŞTİRMEZ. Yalnız soruyu susturur.
 *
 * 2) HER BUYER HER DETAYI TAKİP ETMEK ZORUNDA DEĞİL. Her kontrol tek tek
 *    açılıp kapatılabilir; kapalı kontrol hiç sorulmaz, cevaplanmamış sayılmaz
 *    ve hiçbir sayıma girmez.
 *
 * 3) CEVAPSIZ ≠ EKSİK. Sorulmuş ama cevaplanmamış bir kontrol "PPS yok"
 *    demek DEĞİLDİR; "bu soru henüz yanıtlanmadı" demektir. Etiketler ve
 *    sayımlar bunu ayırır — olmayan veriden kesin uyarı üretmiyoruz.
 *
 * 4) TARİH KAYARSA SORU GERİ GELİR. Yükleme tarihi cevaptan sonra ileri/geri
 *    alınırsa cevap "eskimiş" sayılır ve kontrol yeniden sorulur; aksi hâlde
 *    Ocak'ta "evet" denen bir kontrol, Nisan'a ertelenmiş sipariş için sonsuza
 *    kadar onaylı görünürdü.
 *
 * 5) PLM KANITI SORUYU KENDİSİ CEVAPLAR. CoreNectum Requests sekmesinden
 *    gelen numune talebi (plm-sample-requests-engine) onaylıysa soru
 *    sorulmaz; açık/reddedilmiş talep varsa soru açık kalır ama PLM durumu
 *    yanında gösterilir. PLM'de talep YOKSA kanıt da yoktur — soru eskisi
 *    gibi kullanıcıya sorulur (cevapsız ≠ eksik kuralı korunur). Kullanıcının
 *    kendi cevabı her zaman önceliklidir.
 *
 * SAF: DOM yok, fetch yok, AI yok.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.BLCpChecklistEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /* Kontroller. `maxDaysToLoad`: yüklemeye bu kadar veya daha az gün kalınca
     sorulur. `minOrderAgeDays`: sipariş bu kadar yaşlanınca sorulur. İkisi de
     tanımlıysa HERHANGİ biri yeterlidir (kumaş sorusu hem yaşa hem yüklemeye
     bağlıdır). `stages`: yalnız bu aşamalardaki siparişlere sorulur —
     depodaki siparişe "kumaş hazır mı" sormak anlamsızdır. */
  const PRE_LOAD = Object.freeze(['PRODUCTION', 'LOADING', 'SHORTAGE']);

  const ITEMS = Object.freeze([
    Object.freeze({ id: 'pps', group: 'approval', defaultEnabled: true, maxDaysToLoad: 42, stages: PRE_LOAD,
      tr: 'PPS onayı', en: 'PPS approval',
      questionTr: 'PPS onayı alındı mı?', questionEn: 'Has PPS been approved?' }),
    Object.freeze({ id: 'soff', group: 'approval', defaultEnabled: true, maxDaysToLoad: 42, stages: PRE_LOAD,
      tr: 'S/Off onayı', en: 'S/Off approval',
      questionTr: 'S/Off onayı alındı mı?', questionEn: 'Has S/Off been approved?' }),
    Object.freeze({ id: 'criticalSample', group: 'sample', defaultEnabled: false, maxDaysToLoad: 56, stages: PRE_LOAD,
      tr: 'Kritik numune onayları', en: 'Critical sample approvals',
      questionTr: 'Kritik numune onayları (Fit, Size Set, Seal) tamam mı?', questionEn: 'Are the critical sample approvals (Fit, Size Set, Seal) complete?' }),
    Object.freeze({ id: 'artwork', group: 'approval', defaultEnabled: true, maxDaysToLoad: 56, stages: PRE_LOAD,
      tr: 'Artwork onayı', en: 'Artwork approval',
      questionTr: 'Artwork onayı alındı mı?', questionEn: 'Has the artwork been approved?' }),
    Object.freeze({ id: 'tests', group: 'test', defaultEnabled: true, maxDaysToLoad: 28, stages: PRE_LOAD,
      tr: 'Testler', en: 'Tests',
      questionTr: 'Gerekli testler tamamlandı mı?', questionEn: 'Are the required tests complete?' }),
    Object.freeze({ id: 'fabric', group: 'material', defaultEnabled: true, maxDaysToLoad: 28, minOrderAgeDays: 30, stages: PRE_LOAD,
      tr: 'Kumaş hazırlığı', en: 'Fabric readiness',
      questionTr: 'Kumaş hazır mı?', questionEn: 'Is the fabric ready?' }),
    Object.freeze({ id: 'accessories', group: 'material', defaultEnabled: true, maxDaysToLoad: 28, stages: PRE_LOAD,
      tr: 'Aksesuar hazırlığı', en: 'Accessory readiness',
      questionTr: 'Aksesuarlar hazır mı?', questionEn: 'Are the accessories ready?' }),
    Object.freeze({ id: 'productionStart', group: 'production', defaultEnabled: false, maxDaysToLoad: 28, stages: PRE_LOAD,
      tr: 'Üretim başlangıcı', en: 'Production start',
      questionTr: 'Üretim başladı mı?', questionEn: 'Has production started?' }),
    Object.freeze({ id: 'supplierConfirmation', group: 'confirmation', defaultEnabled: true, maxDaysToLoad: 14, stages: PRE_LOAD,
      tr: 'Üretici yükleme teyidi', en: 'Supplier loading confirmation',
      questionTr: 'Üretici yükleme teyidi verdi mi?', questionEn: 'Has the supplier confirmed the loading?' }),
    Object.freeze({ id: 'packing', group: 'production', defaultEnabled: false, maxDaysToLoad: 14, stages: PRE_LOAD,
      tr: 'Paketleme hazırlığı', en: 'Packing readiness',
      questionTr: 'Paketleme ve yükleme hazırlığı tamam mı?', questionEn: 'Is packing and loading preparation complete?' }),
  ]);

  const ITEM_BY_ID = Object.freeze(ITEMS.reduce((map, item) => { map[item.id] = item; return map; }, {}));
  const GROUP_LABELS = Object.freeze({
    tr: { approval: 'Onaylar', sample: 'Numune', test: 'Test', material: 'Malzeme', production: 'Üretim', confirmation: 'Teyit' },
    en: { approval: 'Approvals', sample: 'Samples', test: 'Tests', material: 'Materials', production: 'Production', confirmation: 'Confirmation' },
  });

  /* Cevap durumları (v7.221). Kullanıcı dört durumdan birini seçer:
       Pending (open)   → cevap YOK; soru açıktır. Saklanmaz, kayıt silinir.
       Approved         → soruyu susturur.
       Not Required     → soruyu susturur; "yapıldı"dan ayrı bilgi.
       Rejected         → soru AÇIK kalır ama "reddedildi" diye işaretlenir:
                          reddedilen test/onay hâlâ aksiyon ister.
     Eski kayıtlardaki 'done' (Tamamlandı) değeri 'approved' olarak okunur. */
  const STATUS_IDS = Object.freeze(['open', 'approved', 'rejected', 'notRequired']);
  const ANSWER_STATES = Object.freeze(['approved', 'rejected', 'notRequired']);
  const RESOLVED_STATES = Object.freeze(['approved', 'notRequired']);
  const STATUS_LABELS = Object.freeze({
    tr: { open: 'Bekliyor', approved: 'Onaylandı', rejected: 'Reddedildi', notRequired: 'Gerekmiyor' },
    en: { open: 'Pending', approved: 'Approved', rejected: 'Rejected', notRequired: 'Not Required' },
  });
  // Geriye uyumluluk: eski çağıranlar ANSWER_LABELS[lang].done okuyabilir.
  const ANSWER_LABELS = Object.freeze({
    tr: Object.freeze({ ...STATUS_LABELS.tr, done: STATUS_LABELS.tr.approved }),
    en: Object.freeze({ ...STATUS_LABELS.en, done: STATUS_LABELS.en.approved }),
  });

  /* Serbest metni (Excel, eski kayıt, sunucu) kanonik duruma çevirir.
     Tanınmayan değer '' döner; çağıran onu GEÇERSİZ sayar, tahmin yürütülmez. */
  function normalizeStatus(value) {
    const raw = String(value == null ? '' : value).trim().toLocaleLowerCase('tr-TR').replace(/[._-]+/g, ' ').replace(/\s+/g, ' ');
    if (!raw) return '';
    if (['approved', 'approve', 'onaylandı', 'onaylandi', 'onaylı', 'onayli', 'done', 'completed', 'complete', 'tamam', 'tamamlandı', 'tamamlandi', 'yes', 'evet'].includes(raw)) return 'approved'; // i18n-ignore — içe aktarma eş anlamlıları, UI metni değil
    if (['rejected', 'reject', 'reddedildi', 'red', 'ret', 'failed', 'fail', 'no', 'hayır', 'hayir'].includes(raw)) return 'rejected'; // i18n-ignore — içe aktarma eş anlamlıları, UI metni değil
    if (['notrequired', 'not required', 'n a', 'na', 'gerekmiyor', 'gerek yok', 'uygulanmaz'].includes(raw)) return 'notRequired'; // i18n-ignore — içe aktarma eş anlamlıları, UI metni değil
    if (['open', 'pending', 'açık', 'acik', 'bekliyor', 'beklemede', 'yeniden aç', 'yeniden ac'].includes(raw)) return 'open'; // i18n-ignore — içe aktarma eş anlamlıları, UI metni değil
    return '';
  }
  function statusLabel(status, lang) {
    const labels = STATUS_LABELS[lang === 'en' ? 'en' : 'tr'];
    return labels[normalizeStatus(status) || 'open'];
  }

/* GECİKMİŞ SİPARİŞ PENCERESİ.
   Kontrol listesi ileriye dönük bir geri sayımdır: "yüklemeye 6 hafta kaldı,
   PPS alındı mı?". Yalnız üst eşiğe bakılırsa 3 ay önce yüklenmesi gereken bir
   sipariş de `daysToLoad <= 42` koşulunu sağlar ve her kontrol için soru
   üretir — canlı veride 1.209 siparişin HEPSİ her kontrolde listelendi, liste
   kullanılamaz hâle geldi. Çok gecikmiş siparişler zaten öncelik tarafında
   CRITICAL olarak görünür; onları ayrıca "PPS alındı mı?" diye sormak bilgi
   katmaz. Bu yüzden geriye dönük bir tolerans penceresi var. */
  const DEFAULT_OVERDUE_GRACE_DAYS = 30;

/* Number(null) === 0 TUZAĞI.
   Bu depoda daha önce de ısırdı: kaydedilmiş bir tercih `minOrderAgeDays: null`
   değerini geri okuduğunda Number(null) sonlu bir 0 üretiyor, "yaş eşiği yok"
   demek olan null sessizce "yaşı 0'dan büyük her sipariş" hâline geliyordu.
   Sonuç canlıda görüldü: yaş koşulu her siparişte doğru olduğu için yükleme
   eşikleri hiç devreye girmedi ve dokuz kontrolün hepsi AYNI 741 siparişi
   listeledi. Bu yüzden null/'' /undefined, Number()'a girmeden ayıklanır. */
  function finiteOrNull(value) {
    if (value == null || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function normalizeSettings(raw) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const graceRaw = finiteOrNull(source.overdueGraceDays);
    const overdueGraceDays = graceRaw == null ? DEFAULT_OVERDUE_GRACE_DAYS : Math.max(0, Math.min(365, Math.round(graceRaw)));
    const items = {};
    for (const item of ITEMS) {
      const override = source.items && typeof source.items === 'object' ? source.items[item.id] : null;
      const config = override && typeof override === 'object' ? override : {};
      const maxDays = finiteOrNull(config.maxDaysToLoad);
      const minAge = finiteOrNull(config.minOrderAgeDays);
      items[item.id] = {
        enabled: typeof config.enabled === 'boolean' ? config.enabled : item.defaultEnabled,
        // Eşikler kullanıcıya açık ama sınırsız değil: 1 yıldan uzak bir
        // "yaklaşıyor" eşiği soruyu her siparişte sorar, listeyi çöpe çevirir.
        maxDaysToLoad: maxDays == null ? item.maxDaysToLoad : Math.max(0, Math.min(365, Math.round(maxDays))),
        // null = "yaş eşiği YOK". 0 ile karıştırılamaz: 0 her siparişi kapsar.
        minOrderAgeDays: minAge == null ? (item.minOrderAgeDays == null ? null : item.minOrderAgeDays) : Math.max(1, Math.min(365, Math.round(minAge))),
      };
    }
    return { enabled: source.enabled !== false, overdueGraceDays, items };
  }

  function answerKey(orderKey, itemId) { return `${orderKey}::${itemId}`; }

  function managedItemIdsOf(context) {
    const raw = context && context.managedItemIds;
    if (raw instanceof Set) return raw;
    return new Set(Array.isArray(raw) ? raw.map(String) : []);
  }

  /* PLM kanıtı: ctx.plmEvidence(analysis, itemId) → { state:'approved'|'open'|
     'rejected', requestCode, statusName, subTypeName, date } ya da null.
     Yalnız 'approved' soruyu susturur. */
  function plmEvidenceOf(context, analysis, itemId) {
    if (!context || typeof context.plmEvidence !== 'function') return null;
    try {
      const evidence = context.plmEvidence(analysis, itemId);
      return evidence && typeof evidence === 'object' && evidence.state ? evidence : null;
    } catch (_) { return null; }
  }
  function plmApproved(evidence) { return Boolean(evidence && evidence.state === 'approved'); }

  /* Cevap, verildiği andaki yükleme tarihine bağlanır. Tarih sonradan
     kayarsa cevap eskir ve soru yeniden sorulur (§4). */
  function makeAnswer(state, analysis, meta) {
    return {
      state: ANSWER_STATES.includes(normalizeStatus(state)) ? normalizeStatus(state) : 'approved',
      at: (meta && meta.at) || new Date().toISOString(),
      by: (meta && meta.by) || '',
      loadDate: analysis ? analysis.plannedLoadDate : null,
    };
  }

  function answerIsStale(answer, analysis) {
    if (!answer) return false;
    if (answer.loadDate == null || !analysis || analysis.plannedLoadDate == null) return false;
    return answer.loadDate !== analysis.plannedLoadDate;
  }

  /* Bir sorunun sipariş için geçerli durumu ('open' | 'approved' | 'rejected'
     | 'notRequired'). Kullanıcı cevabı her zaman önceliklidir; eskimiş cevap
     soruyu yeniden açar; cevap yoksa PLM onayı soruyu kapatır. */
  function statusOf(analysis, itemId, ctx) {
    const context = ctx || {};
    const answers = context.answers || {};
    const answer = answers[answerKey(analysis.orderKey, itemId)];
    const stale = answerIsStale(answer, analysis);
    const answerState = answer && !stale ? normalizeStatus(answer.state) : '';
    if (answerState && answerState !== 'open') return answerState;
    if (plmApproved(plmEvidenceOf(context, analysis, itemId))) return 'approved';
    return 'open';
  }
  function isResolved(status) { return RESOLVED_STATES.includes(status); }

  function itemApplies(item, config, analysis, settings) {
    if (!config.enabled) return false;
    if (item.stages && !item.stages.includes(analysis.stage)) return false;
    const grace = settings && Number.isFinite(Number(settings.overdueGraceDays))
      ? Number(settings.overdueGraceDays) : DEFAULT_OVERDUE_GRACE_DAYS;
    // Çok gecikmiş sipariş bu listenin konusu değil (yukarıdaki nota bak).
    if (analysis.daysToLoad != null && analysis.daysToLoad < -grace) return false;
    const byLoad = analysis.daysToLoad != null && analysis.daysToLoad <= config.maxDaysToLoad;
    const byAge = config.minOrderAgeDays != null && analysis.orderAgeDays != null && analysis.orderAgeDays >= config.minOrderAgeDays;
    return Boolean(byLoad || byAge);
  }

  /* Bir sipariş için açık kontroller. Onaylanmış / gerekmiyor denmiş (ve
     cevabı eskimemiş) kontroller listede YER ALMAZ — sorunun bir daha
     sorulmaması bu demek. Reddedilen kontrol açık kalır, `rejected` taşır. */
  function openEntry(item, analysis, context, extra) {
    const answers = context.answers || {};
    const answer = answers[answerKey(analysis.orderKey, item.id)];
    const stale = answerIsStale(answer, analysis);
    const status = statusOf(analysis, item.id, context);
    if (isResolved(status)) return null;
    return {
      id: item.id, group: item.group || 'custom', ...(extra || {}),
      tr: item.tr, en: item.en, questionTr: item.questionTr, questionEn: item.questionEn,
      daysToLoad: analysis.daysToLoad, orderAgeDays: analysis.orderAgeDays,
      status,
      rejected: status === 'rejected',
      // Cevabı eskiyen kontrol, hiç sorulmamış olandan ayrı gösterilir.
      reopened: Boolean(stale),
      previousAnswer: stale ? answer : null,
      plm: plmEvidenceOf(context, analysis, item.id),
    };
  }

  function openItems(analysis, ctx) {
    const context = ctx || {};
    const settings = context.settings && context.settings.items ? context.settings : normalizeSettings(context.settings);
    if (!settings.enabled) return [];
    const open = [];
    /* Kullanıcının kendi tanımladığı kontroller (ör. "Hologram siparişi verildi
       mi?", yalnız belirli lisanslar için). Kapsam koşulu kural motorunda
       değerlendirilir; buraya YALNIZ kapsama giren kontroller gelir. */
    const managedItemIds = managedItemIdsOf(context);
    for (const item of (Array.isArray(context.customItems) ? context.customItems : [])) {
      const entry = openEntry(item, analysis, context, { custom: true });
      if (entry) open.push(entry);
    }
    for (const item of ITEMS) {
      if (managedItemIds.has(item.id)) continue;
      const config = settings.items[item.id];
      if (!itemApplies(item, config, analysis, settings)) continue;
      const entry = openEntry(item, analysis, context);
      if (entry) open.push(entry);
    }
    return open;
  }

/* Bir siparişin kontrol durumu, öncelik kurallarının okuyabileceği biçimde.
   'open'          → soru geçerli ve cevap bekliyor (Pending)
   'approved'      → onaylandı (kullanıcı ya da PLM)
   'rejected'      → reddedildi; soru açık kalır
   'notRequired'   → bu siparişte gerekmiyor
   'notApplicable' → kontrol kapalı ya da bu sipariş kapsam dışında
   Ayrım önemli: kapalı bir kontrol "eksik" değildir, o yüzden kural yazarken
   'open' ile 'notApplicable' karışmamalı. */
  function stateFor(analysis, ctx) {
    const context = ctx || {};
    const settings = context.settings && context.settings.items ? context.settings : normalizeSettings(context.settings);
    const state = {};
    const mark = (id, applicable) => {
      state[id] = applicable ? statusOf(analysis, id, context) : 'notApplicable';
    };
    const managedItemIds = managedItemIdsOf(context);
    for (const item of ITEMS) {
      if (managedItemIds.has(item.id)) state[item.id] = 'notApplicable';
      else mark(item.id, settings.enabled && itemApplies(item, settings.items[item.id], analysis, settings));
    }
    for (const item of (Array.isArray(context.customItems) ? context.customItems : [])) mark(item.id, settings.enabled);
    return state;
  }

  /* Ekran özeti: hangi kontrol kaç siparişte açık. `limit` YALNIZ listeyi
     kısaltır; sayımlar tam kümeden gelir. */
  function summarize(analyses, ctx) {
    const context = ctx || {};
    const settings = context.settings && context.settings.items ? context.settings : normalizeSettings(context.settings);
    const limit = Math.max(1, Number(context.limit) || 200);
    const list = Array.isArray(analyses) ? analyses : [];
    const buckets = new Map();
    let openTotal = 0;
    let rejectedTotal = 0;
    let answeredTotal = 0;
    let plmAnsweredTotal = 0;
    const answers = context.answers || {};
    const managedItemIds = managedItemIdsOf(context);

    // Özel kontroller sipariş bazında değişir (kapsam koşulu): çağıran her
    // sipariş için hangilerinin geçerli olduğunu verir.
    const customFor = typeof context.customItemsFor === 'function' ? context.customItemsFor : () => [];
    for (const analysis of list) {
      const customItems = customFor(analysis);
      const itemContext = { settings, answers, customItems, plmEvidence: context.plmEvidence, managedItemIds: context.managedItemIds };
      const open = openItems(analysis, itemContext);
      for (const entry of open) {
        if (!buckets.has(entry.id)) buckets.set(entry.id, { id: entry.id, group: entry.group, tr: entry.tr, en: entry.en, questionTr: entry.questionTr, questionEn: entry.questionEn, rows: 0, qty: 0, rejected: 0, reopened: 0, plmOpen: 0, plmRejected: 0, orders: [] });
        const bucket = buckets.get(entry.id);
        bucket.rows += 1;
        bucket.qty += Number(analysis.qty) || 0;
        if (entry.rejected) { bucket.rejected += 1; rejectedTotal += 1; }
        if (entry.reopened) bucket.reopened += 1;
        if (entry.plm && entry.plm.state === 'open') bucket.plmOpen += 1;
        if (entry.plm && entry.plm.state === 'rejected') bucket.plmRejected += 1;
        bucket.orders.push(analysis);
        openTotal += 1;
      }
      if (!settings.enabled) continue;
      // Cevaplanmış ve hâlâ geçerli olan kontroller: "bu kadarını hallettin".
      const countResolved = itemId => {
        const status = statusOf(analysis, itemId, itemContext);
        if (!isResolved(status)) return;
        answeredTotal += 1;
        const answer = answers[answerKey(analysis.orderKey, itemId)];
        if (!(answer && !answerIsStale(answer, analysis) && normalizeStatus(answer.state))) plmAnsweredTotal += 1;
      };
      for (const item of customItems) countResolved(item.id);
      for (const item of ITEMS) {
        if (managedItemIds.has(item.id)) continue;
        if (!itemApplies(item, settings.items[item.id], analysis, settings)) continue;
        countResolved(item.id);
      }
    }

    const items = [...buckets.values()].sort((a, b) => b.rows - a.rows || a.id.localeCompare(b.id));
    for (const bucket of items) {
      const all = bucket.orders;
      Object.defineProperty(bucket, 'allOrders', { value: all, enumerable: false });
      bucket.orders = all.slice(0, limit);
    }
    return {
      items,
      openTotal,
      rejectedTotal,
      answeredTotal,
      // answeredTotal içinde, kullanıcı değil PLM onayıyla kapananlar.
      plmAnsweredTotal,
      // Kapalı kontroller: kullanıcı bunları takip etmemeyi SEÇTİ. Eksik değil.
      disabled: ITEMS.filter(item => !managedItemIds.has(item.id) && !settings.items[item.id].enabled).map(item => ({ id: item.id, tr: item.tr, en: item.en })),
    };
  }

  return {
    ITEMS, ITEM_BY_ID, GROUP_LABELS, ANSWER_STATES, ANSWER_LABELS, STATUS_IDS, STATUS_LABELS, RESOLVED_STATES,
    normalizeStatus, statusLabel, statusOf, isResolved,
    normalizeSettings, answerKey, makeAnswer, answerIsStale, stateFor,
    itemApplies, openItems, summarize,
  };
});
