/* ===================================================================
   v7.175 — OTOMASYON ASİSTANI (saf yardımcılar)

   Kullanıcı talebi (birebir): "Şimdi aynı mantıkla bir de otomasyonları uçtan
   uca ele al ve revize et. Otomasyon alanı da buna benzer kolaylıkta olsun,
   acemiler bile kolaylıkla kullanabilsin."

   Hesaplanan sütunda kurulan mantığın otomasyondaki karşılığı:
     · "NE YAPMAK İSTİYORSUNUZ?" — hazır senaryo şablonları. Acemi boş bir
       formla değil, kendi işine benzeyen dolu bir örnekle başlar.
     · DÜZ DİLLE ÖZET — otomasyonun ne yapacağı her an tek paragrafta okunur.
     · "HAZIR MI?" — eksik ya da yanlış olanı, düzeltme önerisiyle listeler
       (olmayan alan için en yakın alan, boş değer, grup seçilmemiş…).
     · AI ASİSTANI — kuralları + sözlüğü + seçilen kaynağın alan ADLARINI içeren
       yönerge; yapıştırılan AI cevabından kodun ayıklanması, otomatik
       düzeltme ve hataların düz dille açıklanması.
     · SÖZLÜK — Automation Code dilinin her parçası örnekle.

   Bu dosya DOM'a dokunmaz: hem tarayıcıda (window.BLAutomationAssistant) hem
   düğüm testlerinde (module.exports) aynı kod çalışır. Sunucudaki gerçek
   doğrulama (server/lib/automation-language.js) tek yetkili olarak kalır;
   buradaki kontroller yalnız kullanıcıya erken ve anlaşılır geri bildirimdir.
   =================================================================== */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.BLAutomationAssistant = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : null), function () {
  'use strict';

  const clean = value => String(value == null ? '' : value).trim();
  const lowerTr = value => clean(value).toLocaleLowerCase('tr-TR');
  const pick = (lang, trText, enText) => (lang === 'en' ? enText : trText);

  function distance(a, b) {
    const s = String(a), t = String(b);
    if (s === t) return 0;
    const row = Array.from({ length: t.length + 1 }, (_, index) => index);
    for (let i = 1; i <= s.length; i++) {
      let previous = row[0];
      row[0] = i;
      for (let j = 1; j <= t.length; j++) {
        const current = row[j];
        row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (s[i - 1] === t[j - 1] ? 0 : 1));
        previous = current;
      }
    }
    return row[t.length];
  }
  // En yakın ad; yakın bir aday yoksa '' (yanlış öneri, öneri vermemekten kötüdür).
  function closest(name, candidates) {
    const target = lowerTr(name);
    if (!target) return '';
    let best = '', bestScore = Infinity;
    for (const candidate of candidates || []) {
      const value = lowerTr(candidate);
      if (!value) continue;
      let score = distance(target, value);
      if (value.includes(target) || target.includes(value)) score = Math.min(score, Math.abs(value.length - target.length) * 0.5 + 0.5);
      if (score < bestScore) { bestScore = score; best = candidate; }
    }
    return best && bestScore <= Math.max(2, Math.floor(target.length / 3)) ? best : '';
  }

  /* ---------------- HAZIR SENARYOLAR ----------------

     Alan adları UYDURULMAZ: backlog/CP şablonları sunucunun zenginleştirdiği
     sabit alanları (server/lib/backlog-automation.js, cp-automation.js) ve
     dilden bağımsız KOD alanlarını kullanır ("Teslimat Sonucu Kodu" = AT_RISK),
     çünkü görünen etiket iletişim diline göre TR ya da EN gelebilir.
     Alan seçimi kullanıcıya bırakılan şablonlarda alan BOŞ gelir ve "Hazır mı?"
     listesi onu ilk eksik olarak gösterir. Hiçbir şablon gerçek gönderim
     kurmaz: teslim şekli her zaman TASLAK'tır. */
  const TEMPLATES = [
    {
      id: 'late_suppliers', icon: '⏰', purpose: 'email',
      tr: 'Gecikme riski olan siparişleri üreticilere bildir',
      en: 'Tell suppliers about orders at risk of delay',
      descTr: 'Backlog teslimat analizine göre riskli / gecikecek / gecikmiş siparişler, her üreticiye kendi listesiyle ayrı e-posta taslağı olarak hazırlanır.',
      descEn: 'Orders at risk, expected late or already late (Backlog delivery analysis) are prepared as one email draft per supplier with their own list.',
      patch: {
        source: 'backlog',
        filters: [{ field: 'Teslimat Sonucu Kodu', operator: 'in', value: 'AT_RISK, EXPECTED_LATE, ALREADY_LATE' }],
        email: { recipientMode: 'field', recipientField: 'Üretici', languageMode: 'auto', subject: 'Teslimat riski olan siparişleriniz', subjectEn: 'Your orders at delivery risk', body: 'Merhaba,\n\nAşağıdaki siparişlerde teslimat riski görünüyor. Güncel yükleme tarihlerini paylaşabilir misiniz?\n\nTeşekkürler', bodyEn: 'Hello,\n\nThe orders below show a delivery risk. Could you share the current loading dates?\n\nThank you', reportFields: ['Sipariş Kod', 'Model Adı', 'Teslimat Sonucu', 'Risk Sebebi', 'Hedef Tarih', 'Tahmini Antrepo (ETA)'] },
      },
    },
    {
      id: 'daily_actions', icon: '🔥', purpose: 'email',
      tr: 'Bugün aksiyon gereken siparişleri her sabah bana gönder',
      en: 'Send me the orders needing action every morning',
      descTr: 'CP analizinde “Kritik” ya da “Bugün Aksiyon” olan siparişler her iş günü 09:00’da seçtiğiniz gruba rapor olarak gelir.',
      descEn: 'Orders marked “Critical” or “Action Today” in the CP analysis arrive as a report for your group every weekday at 09:00.',
      patch: {
        source: 'cp',
        filters: [{ field: 'Aksiyon Önceliği Kodu', operator: 'in', value: 'CRITICAL, ACTION_TODAY' }],
        email: { recipientMode: 'group', subject: 'Bugün aksiyon gereken siparişler', subjectEn: 'Orders needing action today', reportFields: ['Order Code', 'Aksiyon Önceliği', 'Teslimat Sonucu', 'Risk Sebepleri', 'Yüklemeye Kalan Gün'] },
        schedule: { enabled: true, mode: 'weekly', time: '09:00', weekdays: [1, 2, 3, 4, 5] },
      },
    },
    {
      id: 'weekly_report', icon: '🗓', purpose: 'email',
      tr: 'Her hafta düzenli rapor gönder',
      en: 'Send a regular weekly report',
      descTr: 'Seçtiğiniz veriden (isterseniz koşullu) bir rapor her Pazartesi 09:00’da e-posta grubuna taslak olarak hazırlanır.',
      descEn: 'A report from the data you choose (optionally filtered) is prepared for an email group every Monday at 09:00.',
      patch: {
        source: 'cp',
        email: { recipientMode: 'group', subject: 'Haftalık sipariş raporu', subjectEn: 'Weekly order report' },
        schedule: { enabled: true, mode: 'weekly', time: '09:00', weekdays: [1] },
      },
    },
    {
      id: 'field_changed', icon: '🔔', purpose: 'email',
      tr: 'Bir bilgi değişince haber ver',
      en: 'Notify me when a value changes',
      descTr: 'Seçtiğiniz alan (ör. yükleme tarihi, durum) önceki çalışmaya göre değişen siparişler her gün kontrol edilir ve size bildirilir.',
      descEn: 'Orders whose chosen field (e.g. loading date, status) changed since the previous run are checked daily and reported to you.',
      patch: {
        source: 'cp',
        filters: [{ field: '', operator: 'changed', value: '' }],
        email: { recipientMode: 'group', subject: 'Değişen siparişler', subjectEn: 'Changed orders' },
        schedule: { enabled: true, mode: 'daily', time: '09:00', weekdays: [1] },
      },
    },
    {
      id: 'due_soon', icon: '📅', purpose: 'email',
      tr: 'Tarihi yaklaşan siparişleri listele',
      en: 'List orders with an upcoming date',
      descTr: 'Seçtiğiniz tarih alanı önümüzdeki 7 gün içinde olan siparişler. “Bugün” her çalışmada o günün tarihi olarak hesaplanır.',
      descEn: 'Orders whose chosen date falls within the next 7 days. “Today” is recalculated on every run.',
      patch: {
        source: 'cp',
        filters: [{ field: '', operator: 'gte', value: '@today' }, { field: '', operator: 'lte', value: '@today+7d' }],
        email: { recipientMode: 'group', subject: 'Önümüzdeki 7 günün siparişleri', subjectEn: 'Orders for the next 7 days' },
      },
    },
    {
      id: 'missing_info', icon: '🧩', purpose: 'analysis',
      tr: 'Eksik bilgisi olan kayıtları bul',
      en: 'Find records with missing information',
      descTr: 'Seçtiğiniz alan BOŞ olan kayıtlar bulunur ve üreticiye göre sayılır. Önce “Dene” ile listeyi görürsünüz; hiçbir şey gönderilmez.',
      descEn: 'Records where the chosen field is EMPTY are found and counted per supplier. “Try” shows the list first; nothing is sent.',
      patch: {
        source: 'cp',
        filters: [{ field: '', operator: 'empty', value: '' }],
        analysis: { groupBy: 'Manufacturer', valueField: '', operation: 'count', topN: 20 },
      },
    },
    {
      id: 'summary', icon: '📊', purpose: 'analysis',
      tr: 'Veriyi özetle (grupla ve say / topla)',
      en: 'Summarize data (group and count / sum)',
      descTr: 'Ör. üreticiye göre sipariş adedi ya da toplam miktar. Excel pivotu kurmadan tek tuşla.',
      descEn: 'E.g. order count or total quantity per supplier. Like a pivot, in one click.',
      patch: { source: 'cp', analysis: { groupBy: 'Manufacturer', valueField: '', operation: 'count', topN: 15 } },
    },
    {
      id: 'web_task', icon: '🌐', purpose: 'browser',
      tr: 'Bir web sitesinde tekrar eden işi otomatikleştir',
      en: 'Automate a repeated task on a website',
      descTr: 'İşlemi bir kez kendiniz yapın, Buyer Log kaydetsin; sonra her sipariş için aynı adımları tekrarlasın.',
      descEn: 'Do the task once while Buyer Log records it; then it repeats the steps for every order.',
      patch: { source: 'manual' },
    },
  ];

  /* ---------------- düz dille anlatım ---------------- */

  const OPERATOR_WORDS = {
    eq: ['eşittir', 'equals'], neq: ['eşit değil', 'is not'], contains: ['içerir', 'contains'],
    starts_with: ['ile başlar', 'starts with'], in: ['şunlardan biri', 'is one of'], not_in: ['şunlardan biri değil', 'is none of'],
    empty: ['boş', 'is empty'], not_empty: ['dolu', 'is not empty'], changed: ['değişti', 'changed'],
    gt: ['büyük / sonra', 'greater / after'], gte: ['en az / o gün ya da sonra', 'at least / on or after'],
    lt: ['küçük / önce', 'less / before'], lte: ['en fazla / o gün ya da önce', 'at most / on or before'],
  };
  const NO_VALUE_OPERATORS = new Set(['empty', 'not_empty', 'changed']);
  const DATE_TOKEN = /^@today(?:\s*([+-])\s*(\d{1,4})d)?$/i;

  // "@today+7d" → "bugünden 7 gün sonra". Çalışma anında çözülen belirteçtir.
  function valueLabel(value, lang) {
    const match = DATE_TOKEN.exec(clean(value));
    if (!match) return clean(value);
    const days = Number(match[2] || 0);
    if (!days) return pick(lang, 'bugün', 'today');
    return match[1] === '-'
      ? pick(lang, `bugünden ${days} gün önce`, `${days} days before today`)
      : pick(lang, `bugünden ${days} gün sonra`, `${days} days after today`);
  }
  function describeFilter(filter, lang) {
    const rule = filter || {};
    const field = clean(rule.field) || pick(lang, '(alan seçilmedi)', '(no field chosen)');
    const words = OPERATOR_WORDS[rule.operator] || OPERATOR_WORDS.eq;
    if (rule.operator === 'changed') return pick(lang, `“${field}” önceki çalışmaya göre değişti`, `“${field}” changed since the previous run`);
    if (NO_VALUE_OPERATORS.has(rule.operator)) return `“${field}” ${pick(lang, words[0], words[1])}`;
    return `“${field}” ${pick(lang, words[0], words[1])} “${valueLabel(rule.value, lang) || '…'}”`;
  }

  const WEEKDAYS = { tr: ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'], en: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] };
  function describeSchedule(schedule, lang) {
    const s = schedule || {};
    if (!s.enabled || s.mode === 'manual') return pick(lang, 'Siz “Çalıştır”a bastığınızda', 'When you press “Run”');
    if (s.mode === 'daily') return pick(lang, `Her gün ${s.time || '09:00'}’da`, `Every day at ${s.time || '09:00'}`);
    if (s.mode === 'interval') return pick(lang, `Her ${Number(s.intervalHours) || 24} saatte bir`, `Every ${Number(s.intervalHours) || 24} hours`);
    const days = (s.weekdays || []).slice().sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map(day => WEEKDAYS[lang === 'en' ? 'en' : 'tr'][day]).filter(Boolean);
    if (days.length === 5 && !(s.weekdays || []).some(day => day === 0 || day === 6)) return pick(lang, `Her iş günü ${s.time || '09:00'}’da`, `Every weekday at ${s.time || '09:00'}`);
    return pick(lang, `Her ${days.join(', ') || '(gün seçilmedi)'} ${s.time || '09:00'}’da`, `Every ${days.join(', ') || '(no day chosen)'} at ${s.time || '09:00'}`);
  }

  /* Otomasyonun ne yapacağını DÜZ CÜMLELERLE anlatır. ctx: { lang, sourceLabel,
     groupName(id) } — etiketler çağıran ekrandan gelir (tek kaynak). */
  function summarize(recipe, ctx = {}) {
    const lang = ctx.lang === 'en' ? 'en' : 'tr';
    const r = recipe || {};
    const lines = [];
    const sourceName = typeof ctx.sourceLabel === 'function' ? ctx.sourceLabel(r.source) : clean(r.source).toUpperCase();
    lines.push({ kind: 'when', text: describeSchedule(r.purpose === 'email' ? r.schedule : { enabled: false }, lang) });
    if (r.source && r.source !== 'manual') {
      const filters = (r.filters || []).filter(item => item && (clean(item.field) || item.operator));
      lines.push({ kind: 'data', text: filters.length
        ? pick(lang, `${sourceName} verisinde şu koşulların HEPSİNE uyan kayıtlar alınır: ${filters.map(item => describeFilter(item, lang)).join(' VE ')}.`, `records in ${sourceName} matching ALL of: ${filters.map(item => describeFilter(item, lang)).join(' AND ')}.`)
        : pick(lang, `${sourceName} verisindeki TÜM kayıtlar alınır (en fazla ${Number(r.limit) || 50}).`, `ALL records in ${sourceName} are taken (at most ${Number(r.limit) || 50}).`) });
      if (r.join && r.join.source) {
        const joinName = typeof ctx.sourceLabel === 'function' ? ctx.sourceLabel(r.join.source) : r.join.source;
        lines.push({ kind: 'data', text: pick(lang, `Kayıtlar sipariş kodundan ${joinName} verisiyle eşleştirilir.`, `Records are matched with ${joinName} by order code.`) });
      }
    }
    if (['analysis', 'email', 'app', 'mixed'].includes(r.purpose) && r.analysis && r.analysis.groupBy) {
      const op = { count: ['sayılır', 'counted'], sum: ['toplanır', 'summed'], avg: ['ortalaması alınır', 'averaged'], min: ['en küçüğü bulunur', 'minimum found'], max: ['en büyüğü bulunur', 'maximum found'] }[r.analysis.operation] || ['sayılır', 'counted'];
      lines.push({ kind: 'do', text: r.analysis.operation && r.analysis.operation !== 'count' && r.analysis.valueField
        ? pick(lang, `“${r.analysis.groupBy}” bazında “${r.analysis.valueField}” ${op[0]}.`, `“${r.analysis.valueField}” is ${op[1]} per “${r.analysis.groupBy}”.`)
        : pick(lang, `“${r.analysis.groupBy}” bazında kayıtlar ${op[0]}.`, `Records are ${op[1]} per “${r.analysis.groupBy}”.`) });
    }
    if (['email', 'mixed'].includes(r.purpose)) {
      const email = r.email || {};
      const group = typeof ctx.groupName === 'function' ? ctx.groupName(email.groupId) : '';
      const target = email.recipientMode === 'field'
        ? pick(lang, `“${email.recipientField || '…'}” alanındaki her değere (ör. her üreticiye) KENDİ listesiyle ayrı e-posta`, `a separate email to every value of “${email.recipientField || '…'}” (e.g. each supplier) with its own list`)
        : pick(lang, `${group ? `“${group}”` : '(grup seçilmedi)'} grubuna tek e-posta`, `one email to ${group ? `“${group}”` : '(no group chosen)'}`);
      lines.push({ kind: 'do', text: pick(lang, `${target} TASLAK olarak hazırlanır; siz kontrol edip gönderirsiniz.`, `${target} is prepared as a DRAFT; you check and send it.`) });
    }
    if (['browser', 'mixed'].includes(r.purpose)) {
      const steps = (r.steps || []).length;
      lines.push({ kind: 'do', text: pick(lang, `Web sitesinde kaydedilen ${steps} adım her kayıt için tekrarlanır.`, `The ${steps} recorded web step(s) are repeated for every record.`) });
    }
    if (['app', 'mixed'].includes(r.purpose) && (r.appActions || []).length) {
      lines.push({ kind: 'do', text: pick(lang, `Buyer Log içinde ${(r.appActions || []).length} adım uygulanır.`, `${(r.appActions || []).length} Buyer Log step(s) run.`) });
    }
    if (r.purpose === 'analysis' && !(r.analysis && r.analysis.groupBy)) {
      lines.push({ kind: 'do', text: pick(lang, 'Eşleşen kayıtlar listelenir; hiçbir şey gönderilmez.', 'Matching records are listed; nothing is sent.') });
    }
    return lines;
  }

  /* ---------------- "HAZIR MI?" ----------------

     ctx: { lang, fields: [...], fieldsLoaded, groups: [{id,name}] }
     Döner: [{ level: 'error'|'warn'|'info', tr, en, target, suggestion?, index? }]
     "error" kaydı engellemez (yarım bir taslak kaydedilebilir) ama Çalıştır'dan
     önce gösterilir; sunucu kendi doğrulamasını yine yapar. */
  function readiness(recipe, ctx = {}) {
    const r = recipe || {};
    const out = [];
    const add = (level, tr, en, extra) => out.push({ level, tr, en, ...(extra || {}) });
    const fields = Array.isArray(ctx.fields) ? ctx.fields : [];
    const knowsFields = Boolean(ctx.fieldsLoaded) && fields.length > 0;
    const hasField = name => fields.some(item => lowerTr(item) === lowerTr(name));
    /* Alıcı alanı kanonik eşdeğeriyle de kabul edilir: AI ile yazılan
       RECIPIENT_FIELD [Üretici], Orders verisinde "Manufacturer" başlığıdır;
       sunucu da aynı kanonik eşlemeyle çözer (automation-field-check). */
    const canonical = typeof globalThis !== 'undefined' ? globalThis.BLCanonicalFields : null;
    const sameCanonical = (a, b) => {
      try {
        if (!canonical || typeof canonical.canonicalId !== 'function') return false;
        const source = clean(r.source).toLowerCase(), left = canonical.canonicalId(source, a);
        return Boolean(left) && left === canonical.canonicalId(source, b);
      } catch (_) { return false; }
    };
    const hasRecipientField = name => hasField(name) || fields.some(item => sameCanonical(item, name));
    if (!clean(r.name)) add('error', 'Otomasyona bir ad verin.', 'Give the automation a name.', { target: 'name' });
    if (r.source && r.source !== 'manual') {
      (r.filters || []).forEach((rule, index) => {
        const item = rule || {};
        if (!clean(item.field)) { add('error', `${index + 1}. koşulda alan seçilmedi.`, `Condition ${index + 1} has no field.`, { target: 'filter', index }); return; }
        if (knowsFields && !hasField(item.field)) {
          const suggestion = closest(item.field, fields);
          add('error', `${index + 1}. koşuldaki “${item.field}” alanı bu veride yok.`, `Field “${item.field}” in condition ${index + 1} is not in this data.`, { target: 'filter', index, field: item.field, suggestion });
        }
        if (!NO_VALUE_OPERATORS.has(item.operator) && clean(item.value) === '') add('error', `${index + 1}. koşulda değer boş.`, `Condition ${index + 1} has no value.`, { target: 'filter', index });
        if (item.operator === 'changed') add('info', 'İlk gerçek çalıştırma yalnız mevcut değerleri “başlangıç” olarak kaydeder; bildirim sonraki değişiklikte gelir.', 'The first real run only stores the current values as a baseline; you are notified on the next change.', { target: 'filter', index });
      });
      if (!(r.filters || []).length && r.purpose !== 'analysis') add('info', `Koşul yok: kaynaktaki tüm kayıtlar işlenir (en fazla ${Number(r.limit) || 50}).`, `No condition: all records are processed (at most ${Number(r.limit) || 50}).`, { target: 'filter' });
    }
    if (['email', 'mixed'].includes(r.purpose)) {
      const email = r.email || {};
      if (email.recipientMode === 'field') {
        if (!clean(email.recipientField)) add('error', 'Alıcıyı belirleyecek alanı seçin (ör. Üretici).', 'Choose the field that decides the recipient (e.g. Supplier).', { target: 'email' });
        else if (knowsFields && !hasRecipientField(email.recipientField)) add('error', `Alıcı alanı “${email.recipientField}” bu veride yok.`, `Recipient field “${email.recipientField}” is not in this data.`, { target: 'email', suggestion: closest(email.recipientField, fields) });
      } else if (!clean(email.groupId)) add('error', 'E-postanın gideceği grubu seçin.', 'Choose the email group.', { target: 'email' });
      else if (Array.isArray(ctx.groups) && ctx.groups.length && !ctx.groups.some(group => group.id === email.groupId)) add('error', 'Seçili e-posta grubu artık yok; yeniden seçin.', 'The chosen email group no longer exists; choose again.', { target: 'email' });
      if (!clean(email.subject)) add('warn', 'E-posta konusu boş.', 'The email subject is empty.', { target: 'email' });
    }
    const schedule = r.schedule || {};
    if (schedule.enabled) {
      if (r.purpose !== 'email') add('error', 'Planlı çalışma yalnız E-posta otomasyonlarında kullanılabilir.', 'Scheduling is available only for Email automations.', { target: 'schedule' });
      if (schedule.mode === 'weekly' && !(schedule.weekdays || []).length) add('error', 'Haftalık çalışma için en az bir gün seçin.', 'Choose at least one day for the weekly run.', { target: 'schedule' });
      if (r.enabled === false) add('warn', 'Otomasyon kapalı; planlı saatte çalışmaz. Üstteki “Aktif”i açın.', 'The automation is off; it will not run on schedule. Turn on “Enabled” above.', { target: 'enabled' });
    }
    if (['browser', 'mixed'].includes(r.purpose)) {
      if (!clean(r.url)) add('error', 'Web sitesinin adresini (https://…) girin.', 'Enter the website address (https://…).', { target: 'browser' });
      if (!(r.steps || []).length && !clean(r.terminalCode)) add('error', 'Henüz web adımı yok: “Yaptıklarımı Kaydet” ile işlemi bir kez gösterin.', 'No web steps yet: show the task once with “Record My Actions”.', { target: 'browser' });
    }
    const analysis = r.analysis || {};
    if (analysis.groupBy && ['sum', 'avg', 'min', 'max'].includes(analysis.operation) && !clean(analysis.valueField)) add('error', 'Toplam / ortalama için sayısal alanı seçin.', 'Choose the numeric field for sum / average.', { target: 'analysis' });
    if (knowsFields && analysis.groupBy && !hasField(analysis.groupBy)) add('warn', `Gruplama alanı “${analysis.groupBy}” bu veride yok.`, `Group-by field “${analysis.groupBy}” is not in this data.`, { target: 'analysis', suggestion: closest(analysis.groupBy, fields) });
    return out;
  }

  /* ---------------- AUTOMATION CODE: sözlük ---------------- */

  const DSL_RULES = [
    { tr: 'İlk satır her zaman BUYERLOG_AUTOMATION 1.0 olur.', en: 'The first line is always BUYERLOG_AUTOMATION 1.0.' },
    { tr: 'Sıra sabittir: NAME → TRIGGER…END → SOURCE → WHEN…END → ACTIONS…END.', en: 'The order is fixed: NAME → TRIGGER…END → SOURCE → WHEN…END → ACTIONS…END.' },
    { tr: 'Alan adı köşeli parantez içinde yazılır: [Üretici]. Metin çift tırnak içinde: "Riskli".', en: 'Field names go in square brackets: [Supplier]. Text goes in double quotes: "At risk".' },
    { tr: 'WHEN içinde her satır bir koşuldur; kayıt ancak HEPSİNE uyarsa işlenir.', en: 'Each line inside WHEN is one condition; a record is processed only if it matches ALL of them.' },
    { tr: 'Her eylem kendi END satırıyla kapanır; ACTIONS bölümü de END ile biter.', en: 'Every action closes with its own END; the ACTIONS section ends with END too.' },
    { tr: 'E-posta alıcısı iki yoldan belirlenir: tek bir sabit grup için RECIPIENT_GROUP ASK_USER (grup Buyer Log’da seçilir); her üreticiye KENDİ siparişleriyle ayrı e-posta için RECIPIENT_FIELD [Üretici].', en: 'The email recipient is set in one of two ways: RECIPIENT_GROUP ASK_USER for one fixed group (chosen in Buyer Log); RECIPIENT_FIELD [Manufacturer] for a separate email to each manufacturer with ITS OWN orders.' },
    { tr: 'RECIPIENT_FIELD [Üretici] sipariş bazında Buyer Log Üretici kartlarıyla eşlenir: adresler karttan gelir, lisanslı Non-DTR siparişlerde Alt Üretici (Sub-Manufacturer) sorumludur. E-posta adresi kodda YAZILMAZ.', en: 'RECIPIENT_FIELD [Manufacturer] is matched per order to the Buyer Log manufacturer cards: addresses come from the card, and on licensed non-DTR orders the Sub-Manufacturer is responsible. Never write e-mail addresses in the code.' },
    { tr: 'Kod, komut, betik (JavaScript, PowerShell, SQL…) YAZILMAZ; reddedilir.', en: 'No code, commands or scripts (JavaScript, PowerShell, SQL…); they are rejected.' },
    { tr: 'İçe aktarılan otomasyon KAPALI bir taslak olarak gelir; siz inceleyip açarsınız.', en: 'An imported automation arrives as a DISABLED draft; you review and enable it.' },
  ];
  const DSL_DICTIONARY = [
    { cat: 'structure', tr: 'İskelet', en: 'Skeleton', items: [
      { syntax: 'BUYERLOG_AUTOMATION 1.0', tr: 'Dil sürümü — ilk satır.', en: 'Language version — first line.' },
      { syntax: 'NAME "Geciken siparişler"', syntaxEn: 'NAME "Late orders"', tr: 'Otomasyonun adı.', en: 'Automation name.' },
      { syntax: 'SOURCE "backlog"', tr: 'Hangi veri: cp, orders, backlog, lfl, collection, asas, ias, intake.', en: 'Which data: cp, orders, backlog, lfl, collection, asas, ias, intake.' },
    ] },
    { cat: 'trigger', tr: 'Ne zaman? (TRIGGER … END)', en: 'When? (TRIGGER … END)', items: [
      { syntax: 'MANUAL', tr: 'Yalnız siz çalıştırınca.', en: 'Only when you run it.' },
      { syntax: 'DAILY AT 09:00', tr: 'Her gün aynı saatte.', en: 'Every day at the same time.' },
      { syntax: 'WEEKLY ON MONDAY AT 09:00', tr: 'Her hafta seçilen günde (MONDAY … SUNDAY ya da PAZARTESI …).', en: 'Every week on the chosen day (MONDAY … SUNDAY).' },
      { syntax: 'INTERVAL 4 HOURS', tr: 'Her N saatte bir.', en: 'Every N hours.' },
    ] },
    { cat: 'condition', tr: 'Hangi kayıtlar? (WHEN … END)', en: 'Which records? (WHEN … END)', items: [
      { syntax: '[Üretici] = "ABC Tekstil"', syntaxEn: '[Manufacturer] = "ABC Textile"', tr: 'Eşittir (= ya da !=, eşit değil).', en: 'Equals (= or != for not equal).' },
      { syntax: '[Sipariş Adedi] >= 1000', syntaxEn: '[Order Quantity] >= 1000', tr: 'Sayı karşılaştırma: > >= < <=.', en: 'Number comparison: > >= < <=.' },
      { syntax: '[Model Adı] CONTAINS "ELBİSE"', syntaxEn: '[Model Name] CONTAINS "DRESS"', tr: 'İçerir (NOT_CONTAINS: içermez). Büyük/küçük harf fark etmez.', en: 'Contains (NOT_CONTAINS: does not). Case-insensitive.' },
      { syntax: '[Sezon] IN ("SS26", "AW26")', syntaxEn: '[Season] IN ("SS26", "AW26")', tr: 'Listedekilerden biri.', en: 'One of the list.' },
      { syntax: '[Sipariş Adedi] BETWEEN 100 AND 500', syntaxEn: '[Order Quantity] BETWEEN 100 AND 500', tr: 'İki sayı arasında (sınırlar dâhil).', en: 'Between two numbers (inclusive).' },
      { syntax: 'IS_BLANK([Retail Tarihi])', syntaxEn: 'IS_BLANK([Retail Date])', tr: 'Boş (IS_NOT_BLANK: dolu).', en: 'Empty (IS_NOT_BLANK: not empty).' },
      { syntax: 'DAYS_UNTIL([Ex-Factory]) BETWEEN 0 AND 7', tr: 'Tarihe bugünden kaç gün kaldı; her çalışmada yeniden hesaplanır.', en: 'Days from today until the date; recalculated on every run.' },
    ] },
    { cat: 'action', tr: 'Ne yapılsın? (ACTIONS … END)', en: 'What to do? (ACTIONS … END)', items: [
      { syntax: 'SEND_EMAIL\n  RECIPIENT_GROUP ASK_USER\n  SUBJECT "Riskli siparişler"\n  INCLUDE_MATCHING_ROWS TRUE\nEND', syntaxEn: 'SEND_EMAIL\n  RECIPIENT_GROUP ASK_USER\n  SUBJECT "Orders at risk"\n  INCLUDE_MATCHING_ROWS TRUE\nEND', tr: 'E-posta (taslak). Alıcı grubu Buyer Log’da seçilir.', en: 'Email (draft). The recipient group is chosen in Buyer Log.' },
      { syntax: 'SEND_EMAIL\n  RECIPIENT_FIELD [Üretici]\n  SUBJECT "Bu haftanın yüklemeleri"\n  INCLUDE_MATCHING_ROWS TRUE\nEND', syntaxEn: 'SEND_EMAIL\n  RECIPIENT_FIELD [Manufacturer]\n  SUBJECT "This week\'s shipments"\n  INCLUDE_MATCHING_ROWS TRUE\nEND', tr: 'Her üreticiye kendi siparişleriyle ayrı e-posta taslağı. Adresler Üreticiler sayfasındaki kartlardan gelir.', en: 'A separate draft to each manufacturer with its own orders. Addresses come from the cards on the Manufacturers page.' },
      { syntax: 'SHOW_REPORT\n  TITLE "Özet"\nEND', syntaxEn: 'SHOW_REPORT\n  TITLE "Summary"\nEND', tr: 'Sonucu Buyer Log içinde rapor olarak göster.', en: 'Show the result as a report inside Buyer Log.' },
      { syntax: 'OPEN_PAGE\n  MODULE cp\nEND', tr: 'Bir Buyer Log sayfasını aç.', en: 'Open a Buyer Log page.' },
      { syntax: 'REFRESH_SOURCE\n  SOURCE cp\nEND', tr: 'Veriyi yenile (cp, orders, backlog, lfl).', en: 'Refresh data (cp, orders, backlog, lfl).' },
    ] },
  ];
  const DSL_EXAMPLE = [
    'BUYERLOG_AUTOMATION 1.0',
    'NAME "Ex-factory’si yaklaşanlar"',
    'TRIGGER',
    '  WEEKLY ON MONDAY AT 09:00',
    'END',
    'SOURCE "cp"',
    'WHEN',
    '  DAYS_UNTIL([Ex-Factory]) BETWEEN 0 AND 7',
    '  [Durum] != "Yüklendi"',
    'END',
    'ACTIONS',
    '  SEND_EMAIL',
    '    RECIPIENT_GROUP ASK_USER',
    '    SUBJECT "Önümüzdeki 7 gün yüklenecekler"',
    '    INCLUDE_MATCHING_ROWS TRUE',
    '  END',
    'END',
  ].join('\n');
  // EN kipinde yönerge ve sözlük aynı örneği İngilizce alan adlarıyla gösterir
  // (alanların EN etiketleri de sunucu doğrulamasından geçer).
  const DSL_EXAMPLE_EN = DSL_EXAMPLE
    .replace('NAME "Ex-factory’si yaklaşanlar"', 'NAME "Ex-factory coming up"')
    .replace('[Durum] != "Yüklendi"', '[Status] != "Shipped"')
    .replace('SUBJECT "Önümüzdeki 7 gün yüklenecekler"', 'SUBJECT "Shipping in the next 7 days"');
  const dslSyntax = (item, lang) => (lang === 'en' && item.syntaxEn) || item.syntax;
  const dslExample = lang => (lang === 'en' ? DSL_EXAMPLE_EN : DSL_EXAMPLE);

  /* ---------------- AI cevabını okuma ---------------- */

  /* AI cevabından Automation Code'u ayıklar. Cevap çoğu zaman açıklama + kod
     bloğudur; kullanıcıdan "yalnız kodu seç" beklemek kopyalamayı zorlaştırır.
     Sıra: BUYERLOG_AUTOMATION içeren ``` bloğu → metindeki BUYERLOG_AUTOMATION
     satırından SON END satırına kadar → metnin tamamı. */
  function extractAutomationCode(input) {
    const raw = String(input == null ? '' : input).replace(/\r\n?/g, '\n');
    if (!raw.trim()) return '';
    const fences = [...raw.matchAll(/```[^\n]*\n([\s\S]*?)```/g)].map(match => match[1]);
    const fenced = fences.find(block => /BUYERLOG_AUTOMATION/i.test(block));
    const text = fenced != null ? fenced : raw;
    const lines = text.split('\n');
    const start = lines.findIndex(line => /^\s*BUYERLOG_AUTOMATION\b/i.test(line));
    if (start < 0) return text.trim();
    let end = -1;
    for (let index = lines.length - 1; index > start; index--) {
      if (/^\s*END\s*$/i.test(lines[index])) { end = index; break; }
    }
    return lines.slice(start, end < 0 ? lines.length : end + 1).join('\n').trim();
  }
  /* Anlamı değiştirmeyen düzeltmeler; ne yapıldığı listelenir. */
  function autoFixCode(input, options = {}) {
    const fixes = [];
    const note = (tr, en) => { if (!fixes.some(item => item.tr === tr)) fixes.push({ tr, en }); };
    let code = String(input == null ? '' : input);
    const straight = code.replace(/[“”„‟″]/g, '"').replace(/[‘’‚‛′]/g, "'");
    if (straight !== code) { code = straight; note('Kıvrık tırnaklar düz tırnağa çevrildi.', 'Curly quotes were turned into straight quotes.'); }
    const noTabs = code.replace(/\t/g, '  ');
    if (noTabs !== code) code = noTabs;
    const version = clean(options.version) || '1.0';
    const header = /^(\s*)BUYERLOG_AUTOMATION(?:[ \t]+([^\n]*))?$/im.exec(code);
    if (header && clean(header[2]) !== version) {
      code = code.replace(header[0], `${header[1]}BUYERLOG_AUTOMATION ${version}`);
      note(`Dil sürümü ${version} olarak düzeltildi.`, `Language version set to ${version}.`);
    }
    const bullets = code.replace(/^(\s*)[-*•]\s+(?=\S)/gm, '$1');
    if (bullets !== code) { code = bullets; note('Satır başındaki madde işaretleri kaldırıldı.', 'Bullet marks at line starts were removed.'); }
    return { code: code.trim(), fixes };
  }

  /* Sunucunun doğrulama cümlesini düz dile ve bir öneriye çevirir.
     ctx: { model, source } — model /api/automations/ai/capabilities'ten gelir. */
  function explainDslError(message, ctx = {}) {
    const text = clean(message);
    const model = ctx.model || {};
    const datasets = (model.datasets || []).map(item => item.id);
    const actions = (model.actions || []).map(item => item.id);
    const fieldNames = fieldsForSource(model, ctx.source).flatMap(field => [field.label && field.label.tr, field.label && field.label.en, field.id]).filter(Boolean);
    let match;
    const out = (tr, en, hintTr, hintEn, extra) => ({ tr, en, hintTr: hintTr || '', hintEn: hintEn || '', raw: text, ...(extra || {}) });
    if (/Language sürümü|BUYERLOG_AUTOMATION/i.test(text)) return out('İlk satır BUYERLOG_AUTOMATION 1.0 olmalı.', 'The first line must be BUYERLOG_AUTOMATION 1.0.', 'AI’ın yazdığı açıklamayı değil yalnız kodu yapıştırın ya da ilk satırı düzeltin.', 'Paste only the code, not the AI’s explanation, or fix the first line.');
    if (/NAME satırı/i.test(text)) return out('İkinci satır NAME "…" olmalı.', 'The second line must be NAME "…".');
    if ((match = /Geçersiz TRIGGER:\s*(.*)$/i.exec(text))) return out(`Zaman satırı anlaşılmadı: ${match[1]}`, `The schedule line was not understood: ${match[1]}`, 'Geçerli biçimler: MANUAL · DAILY AT 09:00 · WEEKLY ON MONDAY AT 09:00 · INTERVAL 4 HOURS', 'Valid forms: MANUAL · DAILY AT 09:00 · WEEKLY ON MONDAY AT 09:00 · INTERVAL 4 HOURS');
    if (/TRIGGER bölümü|TRIGGER değeri/i.test(text)) return out('TRIGGER bölümü eksik.', 'The TRIGGER section is missing.', 'NAME satırından sonra: TRIGGER / DAILY AT 09:00 / END', 'After NAME: TRIGGER / DAILY AT 09:00 / END');
    if ((match = /^(.*?)\s*END eksik/i.exec(text))) return out(`${match[1] || 'Bir bölüm'} kapatılmamış: END satırı eksik.`, `${match[1] || 'A section'} is not closed: an END line is missing.`, 'TRIGGER, WHEN, ACTIONS ve her eylem ayrı bir END satırıyla biter.', 'TRIGGER, WHEN, ACTIONS and every action each end with their own END line.');
    if (/SOURCE satırı/i.test(text)) return out('SOURCE satırı eksik.', 'The SOURCE line is missing.', `TRIGGER…END’den sonra: SOURCE "cp". Seçenekler: ${datasets.join(', ')}`, `After TRIGGER…END: SOURCE "cp". Options: ${datasets.join(', ')}`);
    if ((match = /Bilinmeyen dataset:\s*(.*)$/i.exec(text))) {
      const suggestion = closest(match[1], datasets);
      return out(`“${match[1]}” diye bir veri kaynağı yok.`, `There is no data source “${match[1]}”.`, suggestion ? `Bunu mu demek istediniz: "${suggestion}"?` : `Seçenekler: ${datasets.join(', ')}`, suggestion ? `Did you mean "${suggestion}"?` : `Options: ${datasets.join(', ')}`, { suggestion });
    }
    if (/WHEN bölümü/i.test(text)) return out('WHEN bölümü eksik.', 'The WHEN section is missing.', 'Koşul yoksa da boş bir WHEN / END yazılır.', 'Even with no condition write an empty WHEN / END.');
    if (/ACTIONS bölümü/i.test(text)) return out('ACTIONS bölümü eksik.', 'The ACTIONS section is missing.');
    if ((match = /Geçersiz koşul:\s*(.*)$/i.exec(text))) return out(`Koşul anlaşılmadı: ${match[1]}`, `The condition was not understood: ${match[1]}`, 'Biçim: [Alan] = "değer" · [Alan] >= 10 · [Alan] CONTAINS "x" · IS_BLANK([Alan])', 'Form: [Field] = "value" · [Field] >= 10 · [Field] CONTAINS "x" · IS_BLANK([Field])');
    if ((match = /Bilinmeyen alan:\s*(.*)$/i.exec(text))) {
      const suggestion = closest(match[1], fieldNames);
      return out(`[${match[1]}] bu veri kaynağında yok.`, `[${match[1]}] does not exist in this data source.`, suggestion ? `Bunu mu demek istediniz: [${suggestion}]?` : 'Alan adlarını sözlükteki alan listesinden seçin.', suggestion ? `Did you mean [${suggestion}]?` : 'Pick field names from the field list in the dictionary.', { field: match[1], suggestion });
    }
    if ((match = /Desteklenmeyen action parametresi:\s*(\w+)\.(\w+)/i.exec(text))) {
      const action = (model.actions || []).find(item => item.id === match[1].toUpperCase());
      return out(`${match[1]} eyleminde ${match[2]} kullanılamaz.`, `${match[2]} cannot be used in ${match[1]}.`, action ? `Kullanılabilir: ${action.parameters.join(', ')}` : '', action ? `Allowed: ${action.parameters.join(', ')}` : '');
    }
    if ((match = /Desteklenmeyen action:\s*(.*)$/i.exec(text))) {
      const suggestion = closest(match[1], actions);
      return out(`“${match[1]}” diye bir eylem yok.`, `There is no action “${match[1]}”.`, `${suggestion ? `Bunu mu demek istediniz: ${suggestion}? ` : ''}Eylemler: ${actions.join(', ')}`, `${suggestion ? `Did you mean ${suggestion}? ` : ''}Actions: ${actions.join(', ')}`, { suggestion });
    }
    if (/RECIPIENT_GROUP veya RECIPIENT_FIELD gerekli|RECIPIENT_GROUP gerekli/i.test(text)) return out('E-posta eyleminde alıcı satırı yok.', 'The email action has no recipient line.', 'SEND_EMAIL altına RECIPIENT_GROUP ASK_USER (sabit grup) ya da RECIPIENT_FIELD [Üretici] (her üreticiye ayrı) ekleyin.', 'Add RECIPIENT_GROUP ASK_USER (fixed group) or RECIPIENT_FIELD [Manufacturer] (one per manufacturer) under SEND_EMAIL.');
    if (/birlikte kullanılamaz/i.test(text)) return out('RECIPIENT_GROUP ve RECIPIENT_FIELD aynı e-postada birlikte olamaz.', 'RECIPIENT_GROUP and RECIPIENT_FIELD cannot be used in the same email.', 'Birini silin: sabit grup için RECIPIENT_GROUP, üreticiye göre bölmek için RECIPIENT_FIELD.', 'Delete one: RECIPIENT_GROUP for a fixed group, RECIPIENT_FIELD to split by manufacturer.');
    if (/DAYS_UNTIL tarih alanı/i.test(text)) return out('DAYS_UNTIL yalnız TARİH alanıyla çalışır.', 'DAYS_UNTIL only works with a DATE field.');
    if (/BETWEEN aralığı/i.test(text)) return out('BETWEEN iki sayı ister: BETWEEN 0 AND 7.', 'BETWEEN needs two numbers: BETWEEN 0 AND 7.');
    if (/Forbidden|çalıştırılabilir kod/i.test(text)) return out('Kodda komut ya da betik var; yalnız Buyer Log otomasyon dili kabul edilir.', 'The code contains commands or scripts; only the Buyer Log automation language is accepted.', 'AI’a “yalnız Buyer Log Automation Code yaz, betik yazma” deyin.', 'Tell the AI: “write only Buyer Log Automation Code, no scripts”.');
    if (/sonunda tanınmayan içerik/i.test(text)) return out('Son END satırından sonra fazladan metin var.', 'There is extra text after the final END.', 'AI’ın açıklamasını silin; kod END ile bitmeli.', 'Delete the AI’s explanation; the code must end with END.');
    if (/boş olamaz/i.test(text)) return out('Yapıştırılan metinde kod yok.', 'The pasted text has no code.');
    return out(text, text);
  }

  /* ---------------- AI YÖNERGESİ ---------------- */

  function fieldsForSource(model, source) {
    const wanted = clean(source).toLowerCase();
    const dataset = (model && model.datasets || []).find(item => item.id === wanted);
    const ids = new Set(dataset ? dataset.fields : []);
    return (model && model.fields || []).filter(field => (wanted ? ids.has(field.id) || (field.sources || []).includes(wanted) : true));
  }
  /* Yönerge kuralları, dilin iskeletini, sözlüğü, seçilen kaynağın alan
     ADLARINI ve kullanıcının isteğini içerir. Satır DEĞERİ, e-posta adresi ya
     da grup adı eklenmez: kullanıcının seçtiği dış bir araca şirket verisi
     gitmez (CLAUDE.md §4); alıcı her zaman ASK_USER ile Buyer Log'da seçilir. */
  function buildAutomationPrompt(options = {}) {
    const lang = options.lang === 'en' ? 'en' : 'tr';
    const model = options.model || {};
    const source = clean(options.source).toLowerCase();
    const request = clean(options.request);
    const lines = [];
    lines.push(pick(lang,
      'Buyer Log uygulaması için bir otomasyon yazmama yardım et. Cevabı YALNIZ “Buyer Log Automation Code” dilinde ver; bu dil aşağıda tam olarak tanımlı. Başka dil, betik ya da komut yazma.',
      'Help me write an automation for the Buyer Log app. Answer ONLY in “Buyer Log Automation Code”, fully defined below. Do not write any other language, script or command.'));
    lines.push('', pick(lang, 'KURALLAR', 'RULES'));
    DSL_RULES.forEach((rule, index) => lines.push(`${index + 1}. ${pick(lang, rule.tr, rule.en)}`));
    lines.push('', pick(lang, 'SÖZLÜK', 'DICTIONARY'));
    DSL_DICTIONARY.forEach(section => {
      lines.push(`# ${pick(lang, section.tr, section.en)}`);
      section.items.forEach(item => lines.push(`- ${dslSyntax(item, lang).replace(/\n\s*/g, ' / ')} — ${pick(lang, item.tr, item.en)}`));
    });
    if ((model.actions || []).length) lines.push(`- ${pick(lang, 'Geçerli eylemler', 'Valid actions')}: ${(model.actions || []).map(item => `${item.id} (${(item.parameters || []).join(', ')})`).join('; ')}`);
    lines.push('', pick(lang, 'ÖRNEK', 'EXAMPLE'), '```', dslExample(lang), '```');
    const fields = fieldsForSource(model, source);
    if (source) {
      lines.push('', pick(lang, `KULLANILACAK VERİ: SOURCE "${source}" — ALANLAR (köşeli parantezle, aynen böyle yaz)`, `DATA TO USE: SOURCE "${source}" — FIELDS (write exactly like this, in brackets)`));
    } else {
      lines.push('', pick(lang, 'ALANLAR (kaynak — alan)', 'FIELDS (source — field)'));
    }
    fields.slice(0, 250).forEach(field => {
      const label = (field.label && (lang === 'en' ? field.label.en : field.label.tr)) || field.id;
      lines.push(`- [${label}]${field.type ? ` — ${field.type}` : ''}${source ? '' : ` — ${(field.sources || []).join(', ')}`}`);
    });
    lines.push('', pick(lang, 'İSTEDİĞİM', 'WHAT I WANT'));
    lines.push(request || pick(lang, '(ne istediğinizi buraya yazın)', '(describe what you want here)'));
    lines.push('', pick(lang, 'CEVAP BİÇİMİ', 'ANSWER FORMAT'));
    lines.push(pick(lang, '- Kodu TEK bir kod bloğu (```) içinde ver; ilk satırı BUYERLOG_AUTOMATION 1.0 olsun.', '- Put the code in ONE code block (```); its first line is BUYERLOG_AUTOMATION 1.0.'));
    lines.push(pick(lang, '- Listede olmayan alan, eylem ya da fonksiyon UYDURMA. İstediğim şey bu dille yapılamıyorsa açıkça söyle.', '- Do NOT invent fields, actions or functions. If what I want cannot be done with this language, say so plainly.'));
    lines.push(pick(lang, '- E-posta tek bir sabit gruba gidecekse RECIPIENT_GROUP ASK_USER yaz. Kayıtların üreticisine göre her üreticiye ayrı gidecekse RECIPIENT_FIELD [Üretici] yaz; Buyer Log her siparişi Üretici kartına eşler (lisanslı Non-DTR siparişte Alt Üretici). E-posta adresi yazma.', '- If the email goes to one fixed group write RECIPIENT_GROUP ASK_USER. If each manufacturer should get its own records write RECIPIENT_FIELD [Manufacturer]; Buyer Log matches every order to its manufacturer card (Sub-Manufacturer on licensed non-DTR orders). Do not write e-mail addresses.'));
    return lines.join('\n');
  }

  return {
    TEMPLATES, OPERATOR_WORDS, NO_VALUE_OPERATORS, DSL_RULES, DSL_DICTIONARY, DSL_EXAMPLE, DSL_EXAMPLE_EN, dslSyntax, dslExample,
    closest, valueLabel, describeFilter, describeSchedule, summarize, readiness,
    extractAutomationCode, autoFixCode, explainDslError, fieldsForSource, buildAutomationPrompt,
  };
});
