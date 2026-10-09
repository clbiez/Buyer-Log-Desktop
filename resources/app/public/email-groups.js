/* ===================================================================
   v7.32 — ÜRETİCİ E-POSTA GRUPLARI EKRANI

   Kullanıcı talebi (birebir):
     "Prepaire e-mail alanındaki üretici e-posta verilerini ayrı bir ekranda
      takip etmek istiyorum. source Data ekranına e-mail groups adı altında bir
      buton ekle ... Gruplamayı ülke olarak ve Dokuma / Örme / Triko / Denim
      gibi gruplarla yöneteceğim ... Bu alan kullanıcılar arasında görünür
      olsun."
     "birisi bir e posta kaydını düzenliyorken, diğer kullanıcılar için edit
      özelliğini o e posta kaydında kapat. o an kimin editledigi de diger
      kisiler tarafından görülsün. son güncelleme tarihi kayıt bazlı görünür
      olsun. e posta kayıtlarında kart dizaynı kullan."

   TASARIM KARARLARI

   1) KİLİT SUNUCUNUN İŞİ. Buradaki kilit rozeti ve kapalı Düzenle düğmesi
      yalnız GÖSTERİMDİR; gerçek engelleme sunucudadır (§32). Arayüz yanılsa
      bile yazma isteği reddedilir.

   2) LİSTE KENDİ KENDİNE TAZELENİR. "Kimin düzenlediği diğerleri tarafından
      görülsün" ancak liste tazelenirse doğru olur; ekran açıkken düzenli
      aralıkla yeniden okunur. Düzenleme formu AÇIKKEN yeniden çizilmez —
      kullanıcının yazdığı metin silinirdi.

   3) KİLİT KALP ATIŞIYLA TUTULUR. Form açık kaldıkça kilit tazelenir; pencere
      kapanınca bırakılır, tarayıcı çökerse sunucudaki süre sonunda düşer.

   4) SON GÜNCELLEME KAYIT BAZINDA. Her kartın altında ne zaman ve KİM
      tarafından güncellendiği yazar.
   =================================================================== */
(() => {
  'use strict';

  const REFRESH_MS = 10000;   // liste tazeleme
  const HEARTBEAT_MS = 20000; // kilit tazeleme (sunucudaki ömrün altında)

  const en = () => typeof appLang !== 'undefined' && appLang === 'en';
  const T = (tr, enText) => (en() ? enText : tr);
  const esc = value => (typeof escapeHtml === 'function' ? escapeHtml(String(value == null ? '' : value))
    : String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch])));
  const clean = value => String(value == null ? '' : value).trim();
  const toast = message => { try { if (typeof showToast === 'function') showToast(message); else alert(message); } catch (_) { alert(message); } };

  const S = {
    open: false, modal: null,
    data: { countries: [], types: [], records: [], revision: 0, lockTtlMs: 120000 },
    currentUserId: '',
    groupBy: 'country',
    search: '', filterCountry: '', filterType: '',
    editingId: '', selectedId: '', draft: null,
    headingEditor: null,
    refreshTimer: null, heartbeatTimer: null,
  };
  let snapshotSignature='',refreshPending=null,classificationSignature='';

  async function api(url, options = {}) {
    const response = await fetch(url, {
      cache: 'no-store', ...options,
      headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(window.BL_CLIENT_ID ? { 'X-Client-Id':window.BL_CLIENT_ID } : {}), ...(options.headers || {}) },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) { const error = new Error(data.error || response.statusText); error.code = data.code; error.lock = data.lock; throw error; }
    return data;
  }
  function absorb(data) {
    if (!data) return;
    if (Array.isArray(data.countries)) S.data.countries = data.countries;
    if (Array.isArray(data.types)) S.data.types = data.types;
    if (Array.isArray(data.records)) S.data.records = data.records;
    if (data.revision != null) S.data.revision = data.revision;
    if (data.lockTtlMs) S.data.lockTtlMs = data.lockTtlMs;
    if (data.currentUserId) S.currentUserId = data.currentUserId;
    const signature=JSON.stringify({data:S.data,currentUserId:S.currentUserId});
    if(signature===snapshotSignature){directoryLoadedAt=Date.now();return false;}
    snapshotSignature=signature;
    rebuildDirectory();
    const classification=JSON.stringify(S.data.records.filter(record=>record.dtrStatus==='NON-DTR').map(record=>[record.manufacturer,...(record.aliases||[])]).sort());
    if(classificationSignature && classificationSignature!==classification)window.dispatchEvent(new CustomEvent('bl:manufacturer-classification-changed'));
    classificationSignature=classification;
    /* v7.0.229 — Üreticiler sayfası kartları bu rehberden eşler; rehber her
       değiştiğinde (kayıt, alternatif ad, kilit) sayfa yeniden eşleme yapar. */
    try { window.dispatchEvent(new CustomEvent('bl:manufacturer-directory-changed', { detail: { ...S.data } })); } catch (_) { /* eski tarayıcı */ }
    return true;
  }

  /* ---------------- ORTAK ADRES REHBERİ (v7.35) ----------------

     Kullanıcı "kayıtları buraya taşı" dedikten sonra adresin TEK YERDEN
     yönetilmesi gerekir; iki liste kaldığı sürece kaçınılmaz olarak
     ayrışırlar. Prepare E-Mail bir üreticinin adresini artık buradan okur.

     Rehber, ekran hiç açılmadan da çalışır: ilk sorulduğunda ortak alan bir
     kez okunur ve önbelleğe alınır. Ağ hatasında rehber BOŞ döner, yanlış
     değil — Prepare E-Mail kendi listesine düşer ve e-posta hazırlama akışı
     durmaz. */
  const directory = new Map();
  let directoryLoadedAt = 0, directoryInFlight = null;
  const DIRECTORY_TTL_MS = 120000;
  const dirKey = value => String(value == null ? '' : value).trim().toLocaleLowerCase('tr-TR');

  function parseRecipients(value) {
    const raw = String(value == null ? '' : value).replace(/\r/g, '\n');
    const parts = raw.split(/[;\n]+/).map(v => v.trim()).filter(Boolean);
    const out = [], seen = new Set();
    for (const part of parts) {
      const angle = part.match(/^\s*([^<>]*)<\s*([^<>\s]+@[^<>\s]+)\s*>\s*$/);
      const email = clean(angle ? angle[2] : part).toLowerCase();
      const name = clean(angle ? angle[1] : '');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { out.push({ name, email: clean(angle ? angle[2] : part), invalid: true }); continue; }
      if (seen.has(email)) continue;
      seen.add(email);
      out.push({ name, email, invalid: false });
    }
    return out;
  }
  function formatRecipients(list) {
    return (Array.isArray(list) ? list : []).filter(r => r && !r.invalid && r.email)
      .map(r => r.name ? `${r.name} <${r.email}>` : r.email).join('; ');
  }
  function recipientChipsHtml(value, editable = false) {
    const rows = parseRecipients(value);
    if (!rows.length) return `<div class="egRecipientEmpty">${esc(T('Henüz e-posta adresi yok.', 'No e-mail addresses yet.'))}</div>`;
    return rows.map((r, i) => `<span class="egRecipientChip${r.invalid ? ' isInvalid' : ''}" title="${esc(r.invalid ? T('Geçersiz e-posta adresi', 'Invalid e-mail address') : r.email)}">
      <span>${esc(r.name || r.email)}</span>${r.name ? `<small>${esc(r.email)}</small>` : ''}${editable ? `<button type="button" data-eg-recipient-remove="${i}" aria-label="${esc(T('E-posta adresini kaldır', 'Remove e-mail address'))}">×</button>` : ''}
    </span>`).join('');
  }
  function rebuildDirectory() {
    directory.clear();
    for (const record of S.data.records) {
      const entry = { ...record, recipients: parseRecipients(record && record.email) };
      // Alternatif adlar (eski yazımlar) da aynı karta çözülür.
      for (const name of [record && record.manufacturer].concat(Array.isArray(record && record.aliases) ? record.aliases : [])) {
        const key = dirKey(name);
        if (key && !directory.has(key)) directory.set(key, entry);
      }
    }
    directoryLoadedAt = Date.now();
  }
  function ensureDirectory(force = false) {
    if (!force && Date.now() - directoryLoadedAt < DIRECTORY_TTL_MS) return Promise.resolve();
    if (directoryInFlight) return directoryInFlight;
    directoryInFlight = api('/api/email-groups')
      .then(data => { absorb(data); })
      .catch(() => { /* ortak alan okunamadı: rehber boş kalır, akış durmaz */ })
      .finally(() => { directoryInFlight = null; });
    return directoryInFlight;
  }
  // Eşzamanlı okuma: önbellekte varsa adres, yoksa boş metin.
  function recordFor(name) { return directory.get(dirKey(name)) || null; }
  function recipientsFor(name) { return (recordFor(name)?.recipients || []).filter(r => !r.invalid); }
  function emailFor(name) { return formatRecipients(recipientsFor(name)); }

  /* ---------------- yardımcılar ---------------- */

  function headingName(list, id) {
    const found = (list || []).find(item => item.id === id);
    return found ? found.name : '';
  }
  function stampText(value) {
    const date = new Date(value || '');
    if (!value || Number.isNaN(date.getTime())) return '—';
    const pad = number => String(number).padStart(2, '0');
    return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }
  // Başkası düzenliyor mu? (kendi kilidimiz engel değildir)
  function lockedByOther(record) {
    const lock = record && record.lock;
    return lock && lock.userId && lock.userId !== S.currentUserId ? lock : null;
  }
  function matchesFilters(record) {
    if (S.filterCountry && record.countryId !== S.filterCountry) return false;
    if (S.filterType && record.typeId !== S.filterType) return false;
    const query = S.search.toLocaleLowerCase('tr-TR');
    if (!query) return true;
    return [record.manufacturer, record.email, record.contact, record.phone, record.note, ...(record.aliases || [])]
      .some(value => String(value || '').toLocaleLowerCase('tr-TR').includes(query));
  }

  /* Kartları seçilen boyuta göre bölümlere ayırır. Başlığı olmayan kayıtlar
     "Atanmamış" bölümünde toplanır — hiçbir kayıt görünmez olmaz. */
  function sections() {
    const visible = S.data.records.filter(matchesFilters);
    if (S.groupBy === 'none') return [{ id: '', name: T('Tüm kayıtlar', 'All records'), records: visible }];
    const isCountry = S.groupBy === 'country';
    const headings = isCountry ? S.data.countries : S.data.types;
    const field = isCountry ? 'countryId' : 'typeId';
    const out = headings.map(heading => ({ id: heading.id, name: heading.name, records: visible.filter(record => record[field] === heading.id) }));
    const orphans = visible.filter(record => !record[field] || !headings.some(heading => heading.id === record[field]));
    if (orphans.length) out.push({ id: '', name: T('Atanmamış', 'Unassigned'), records: orphans });
    return out.filter(section => section.records.length);
  }

  /* ---------------- çizim ---------------- */

  function optionsHtml(list, selected) {
    return list.map(item => `<option value="${esc(item.id)}"${item.id === selected ? ' selected' : ''}>${esc(item.name)}</option>`).join('');
  }

  function cardHtml(record) {
    const other = lockedByOther(record);
    const country = headingName(S.data.countries, record.countryId);
    const type = headingName(S.data.types, record.typeId);
    if (S.editingId === record.id) return editCardHtml(record);
    return `<article class="egCard${other ? ' isLocked' : ''}" data-eg-card="${esc(record.id)}">
      <div class="egCardTop">
        <div class="egCardTitle">
          <strong>${esc(record.manufacturer || T('(adsız üretici)', '(unnamed manufacturer)'))}</strong>
          ${record.email ? `<a class="egMail" href="mailto:${esc(record.email)}">${esc(record.email)}</a>` : `<span class="egMuted">${esc(T('e-posta yok', 'no email'))}</span>`}
        </div>
        ${other
          ? `<span class="egLockBadge" title="${esc(T('Bu kayıt düzenleniyor', 'This record is being edited'))}"><svg class="ic"><use href="#i-user"/></svg>${esc(other.userName || other.userId)} ${esc(T('düzenliyor', 'is editing'))}</span>`
          : `<button type="button" class="egBtn egEdit" data-eg-edit="${esc(record.id)}"><svg class="ic"><use href="#i-pencil"/></svg>${esc(T('Düzenle', 'Edit'))}</button>`}
      </div>
      ${(record.contact || record.phone) ? `<div class="egCardLine">${esc([record.contact, record.phone].filter(Boolean).join(' · '))}</div>` : ''}
      ${record.note ? `<p class="egCardNote">${esc(record.note)}</p>` : ''}
      <div class="egChips">
        ${country ? `<span class="egChip">${esc(country)}</span>` : ''}
        ${type ? `<span class="egChip egChipType">${esc(type)}</span>` : ''}
      </div>
      <footer class="egCardFoot">${esc(T('Son güncelleme', 'Last updated'))}: ${esc(stampText(record.updatedAt))}${record.updatedByName ? ` · ${esc(record.updatedByName)}` : ''}</footer>
    </article>`;
  }

  function editCardHtml(record) {
    const draft = S.draft || record;
    return `<article class="egCard isEditing" data-eg-card="${esc(record.id)}">
      <div class="egCardTop"><div class="egCardTitle"><strong>${esc(T('Kaydı düzenle', 'Edit record'))}</strong>
        <span class="egMuted">${esc(T('Siz düzenlerken bu kayıt diğer kullanıcılara kapalıdır.', 'While you edit, this record is closed to other users.'))}</span></div></div>
      <div class="egForm">
        <label class="egField egFieldWide">${esc(T('Üretici (ASAS’taki tam ad)', 'Manufacturer (exact ASAS name)'))}<input type="text" data-eg-input="manufacturer" value="${esc(draft.manufacturer)}" maxlength="240" list="egAsasNames" autocomplete="off"><datalist id="egAsasNames">${asasNames().map(name => `<option value="${esc(name)}"></option>`).join('')}</datalist><small class="egAsasHint" data-eg-asas-hint>${asasHintText(draft.manufacturer)}</small></label>
        <label class="egField egFieldWide">${esc(T('Alternatif adlar', 'Alternative names'))}<textarea data-eg-input="aliases" rows="2" maxlength="4000" placeholder="${esc(T('Eski veya farklı yazımlar; ; ya da yeni satırla ayırın. Bu adlarla gelen siparişler de bu karta bağlanır.', 'Old or different spellings; separate with ; or a new line. Orders using these names are tied to this card too.'))}">${esc(Array.isArray(draft.aliases) ? draft.aliases.join('; ') : (draft.aliases || ''))}</textarea></label>
        <label class="egField egFieldWide egRecipientsField">${esc(T('E-posta alıcıları', 'E-mail recipients'))}<div class="egRecipientEditor"><div class="egRecipientChips" data-eg-recipient-chips>${recipientChipsHtml(draft.email, true)}</div><textarea data-eg-input="email" data-eg-recipient-input rows="3" maxlength="2000" placeholder="${esc(T('Birden fazla adresi ; veya yeni satır ile ayırabilirsiniz. e-posta istemcisinden liste yapıştırabilirsiniz.', 'Separate multiple addresses with ; or a new line. You can paste a list from your e-mail client.'))}">${esc(draft.email)}</textarea><div class="egRecipientHint">${esc(T('Örnek: Zeynep <zeynep@firma.com>; merch@firma.com', 'Example: Zeynep <zeynep@company.com>; merch@company.com'))}</div></div></label>
        <label class="egField">${esc(T('İlgili kişi', 'Contact'))}<input type="text" data-eg-input="contact" value="${esc(draft.contact)}" maxlength="240"></label>
        <label class="egField">${esc(T('Telefon', 'Phone'))}<input type="text" data-eg-input="phone" value="${esc(draft.phone)}" maxlength="80"></label>
        <label class="egField">${esc(T('Ülke', 'Country'))}<select data-eg-input="countryId"><option value="">${esc(T('— seçilmedi —', '— none —'))}</option>${optionsHtml(S.data.countries, draft.countryId)}</select></label>
        <label class="egField">${esc(T('Üretim alanı', 'Production area'))}<select data-eg-input="typeId"><option value="">${esc(T('— seçilmedi —', '— none —'))}</option>${optionsHtml(S.data.types, draft.typeId)}</select></label>
        <label class="egField">${esc(T('DTR / Non-DTR', 'DTR / Non-DTR'))}<select data-eg-input="dtrStatus"><option value="DTR"${draft.dtrStatus !== 'NON-DTR' ? ' selected' : ''}>DTR</option><option value="NON-DTR"${draft.dtrStatus === 'NON-DTR' ? ' selected' : ''}>Non-DTR</option></select><small>${esc(T('Varsayılan DTR. Bu ayar LFL sınıflandırmasını belirler; CP ve Orders lisansör alanlarını değiştirmez.', 'DTR by default. This setting determines LFL classification; it does not change CP or Orders licensor fields.'))}</small></label>
        <label class="egField egFieldWide">${esc(T('Not', 'Note'))}<textarea data-eg-input="note" rows="2" maxlength="2000">${esc(draft.note)}</textarea></label>
      </div>
      <footer class="egCardFoot egEditFoot">
        <button type="button" class="egBtn egDanger" data-eg-delete="${esc(record.id)}"><svg class="ic"><use href="#i-trash"/></svg>${esc(T('Sil', 'Delete'))}</button>
        <span style="flex:1"></span>
        <button type="button" class="egBtn" data-eg-cancel>${esc(T('Vazgeç', 'Cancel'))}</button>
        <button type="button" class="egBtn egPrimary" data-eg-save="${esc(record.id)}"><svg class="ic"><use href="#i-device-floppy"/></svg>${esc(T('Kaydet', 'Save'))}</button>
      </footer>
    </article>`;
  }

  /* v7.0.229 — ASAS önceliği: ad alanı Üreticiler sayfasının yüklediği ASAS
     üretici adlarını önerir ve ad ASAS'ta birebir yoksa uyarır. Liste yoksa
     (sayfa hiç açılmadıysa) uyarı gösterilmez — yanlış alarm verilmez. */
  function asasNames() { return Array.isArray(window.BLManufacturerAsasNames) ? window.BLManufacturerAsasNames : []; }
  function asasHintText(name) {
    const names = asasNames(), E = window.BLManufacturerCards;
    if (!names.length || !E || !clean(name)) return '';
    const key = E.nameKey(name);
    if (names.some(item => E.nameKey(item) === key)) return esc(T('✓ ASAS’taki üretici adıyla birebir eşleşiyor.', '✓ Exactly matches the ASAS manufacturer name.'));
    const near = E.suggestMatches(name, names, 2);
    return esc(T('ASAS’ta bu adla üretici yok; kurallar ve otomasyonlar bu karta sipariş bağlayamaz.', 'No ASAS manufacturer has this name; rules and automations cannot tie orders to this card.'))
      + (near.length ? ` ${esc(T('Benzer:', 'Similar:'))} ${near.map(item => esc(item.name)).join(', ')}` : '');
  }

  function directoryRowHtml(record) {
    const other = lockedByOther(record);
    const country = headingName(S.data.countries, record.countryId);
    const type = headingName(S.data.types, record.typeId);
    const recipients = parseRecipients(record.email).filter(r => !r.invalid);
    return `<button type="button" class="egDirectoryRow${S.selectedId===record.id?' isSelected':''}${other?' isLocked':''}" data-eg-select="${esc(record.id)}">
      <span class="egDirectoryMain"><strong>${esc(record.manufacturer || T('(adsız üretici)','(unnamed manufacturer)'))}</strong>
        <small>${esc([country,type].filter(Boolean).join(' · ') || T('Sınıflandırılmadı','Unclassified'))}</small></span>
      <span class="egDirectoryMeta">${recipients.length ? esc(T(`${recipients.length} alıcı`,`${recipients.length} recipients`)) : `<em>${esc(T('E-posta yok','No e-mail'))}</em>`}</span>
      ${other?`<span class="egDirectoryLock">${esc(other.userName||other.userId)}</span>`:''}
    </button>`;
  }

  function detailPaneHtml(record) {
    if (!record) return `<div class="egDetailEmpty"><strong>${esc(T('Bir üretici seçin','Select a manufacturer'))}</strong><p>${esc(T('İletişim bilgilerini görüntülemek veya düzenlemek için soldaki listeden kayıt seçin.','Select a record from the directory to view or edit contact information.'))}</p></div>`;
    if (S.editingId === record.id) return editCardHtml(record).replace('egCard isEditing','egDetailCard isEditing');
    const other=lockedByOther(record), country=headingName(S.data.countries,record.countryId), type=headingName(S.data.types,record.typeId);
    return `<section class="egDetailCard">
      <header class="egDetailHead"><div><span>${esc(T('Üretici kaydı','Manufacturer record'))}</span><h3>${esc(record.manufacturer||T('(adsız üretici)','(unnamed manufacturer)'))}</h3></div>
        ${other?`<span class="egLockBadge"><svg class="ic"><use href="#i-user"/></svg>${esc(other.userName||other.userId)} ${esc(T('düzenliyor','is editing'))}</span>`:`<button type="button" class="egBtn egPrimary" data-eg-edit="${esc(record.id)}"><svg class="ic"><use href="#i-pencil"/></svg>${esc(T('Düzenle','Edit'))}</button>`}
      </header>
      <div class="egDetailGrid"><div><label>DTR / Non-DTR</label><strong>${esc(record.dtrStatus || 'DTR')}</strong></div><div><label>${esc(T('Ülke','Country'))}</label><strong>${esc(country||'—')}</strong></div><div><label>${esc(T('Üretim alanı','Production area'))}</label><strong>${esc(type||'—')}</strong></div><div><label>${esc(T('İlgili kişi','Contact'))}</label><strong>${esc(record.contact||'—')}</strong></div><div><label>${esc(T('Telefon','Phone'))}</label><strong>${esc(record.phone||'—')}</strong></div></div>
      <section class="egRecipientsPanel"><div class="egPanelTitle"><div><strong>${esc(T('E-posta alıcıları','E-mail recipients'))}</strong><span>${parseRecipients(record.email).filter(r=>!r.invalid).length}</span></div><p>${esc(T('Prepare E-Mail ve Send to Pricing bu alıcı listesini doğrudan kullanır.','Prepare E-Mail and Send to Pricing use this recipient list directly.'))}</p></div><div class="egRecipientChips isReadOnly">${recipientChipsHtml(record.email,false)}</div></section>
      ${(record.aliases||[]).length?`<section class="egNotePanel"><label>${esc(T('Alternatif adlar','Alternative names'))}</label><p>${esc(record.aliases.join(' · '))}</p></section>`:''}
      <section class="egNotePanel"><label>${esc(T('Not','Note'))}</label><p>${esc(record.note||'—')}</p></section>
      <footer class="egDetailFoot">${esc(T('Son güncelleme','Last updated'))}: ${esc(stampText(record.updatedAt))}${record.updatedByName?` · ${esc(record.updatedByName)}`:''}</footer>
    </section>`;
  }

  /* Rehber herkese görünür; değiştirme Moderatörün verdiği ortak ayar
     yetkisiyle yapılır (sunucu da aynı izni ister). Yetkisiz kullanıcıya
     çalışmayacak düzenleme düğmeleri gösterilmez. */
  function canManage() {
    return typeof window.BLHasPermission !== 'function' || window.BLHasPermission('manageBusinessRules');
  }
  function applyReadOnly() {
    if (!S.modal || canManage()) return;
    S.modal.classList.add('egReadOnly');
    S.modal.querySelectorAll('[data-eg-add],[data-eg-headings],[data-eg-edit],[data-eg-delete]').forEach(el => el.remove());
  }

  function render() {
    if (!S.modal) return;
    const body = S.modal.querySelector('[data-eg-body]');
    const list = sections();
    const flat=list.flatMap(section=>section.records);
    const total=S.data.records.length, shown=flat.length;
    if (!S.selectedId || !S.data.records.some(r=>r.id===S.selectedId)) S.selectedId=flat[0]?.id||S.data.records[0]?.id||'';
    S.modal.querySelector('[data-eg-count]').textContent = shown===total ? T(`${total} kayıt`,`${total} records`) : T(`${shown} / ${total} kayıt`,`${shown} / ${total} records`);
    const directoryMarkup=list.length?list.map(section=>`<section class="egDirectorySection"><h4>${esc(section.name)}<span>${section.records.length}</span></h4>${section.records.map(directoryRowHtml).join('')}</section>`).join(''):`<div class="egEmpty">${esc(total?T('Filtreye uyan kayıt yok.','No record matches the filter.'):T('Henüz kayıt yok. “Kayıt Ekle” ile başlayın.','No records yet. Start with “Add record”.'))}</div>`;
    const selected=S.data.records.find(r=>r.id===S.selectedId)||null;
    body.innerHTML=`<aside class="egDirectory"><div class="egDirectoryScroll">${directoryMarkup}</div></aside><main class="egDetailPane">${detailPaneHtml(selected)}</main>`;

    const filters=S.modal.querySelector('[data-eg-filter-country]');
    if(filters)filters.innerHTML=`<option value="">${esc(T('Tüm ülkeler','All countries'))}</option>${optionsHtml(S.data.countries,S.filterCountry)}`;
    const typeFilter=S.modal.querySelector('[data-eg-filter-type]');
    if(typeFilter)typeFilter.innerHTML=`<option value="">${esc(T('Tüm üretim alanları','All production areas'))}</option>${optionsHtml(S.data.types,S.filterType)}`;
    if(S.editingId)setTimeout(()=>S.modal?.querySelector('[data-eg-input="manufacturer"]')?.focus(),0);
    applyReadOnly();
  }

  /* ---------------- veri ---------------- */

  function refresh({ force = false } = {}) {
    // Düzenleme formu açıkken yeniden çizmeyiz: yazılan metin silinirdi.
    if (S.editingId && !force) return;
    if(refreshPending)return refreshPending;
    refreshPending=(async()=>{
      try {
        const changed=absorb(await api('/api/email-groups'));
        // An editor may have opened while the read was in flight. Server-side
        // locks remain authoritative; never redraw an active draft after a poll.
        if((changed||force)&&(!S.editingId||force))render();
      } catch (_) { /* geçici ağ hatası: sonraki tazelemede düzelir */ }
    })().finally(()=>{refreshPending=null;});
    return refreshPending;
  }

  async function startEdit(id) {
    if (!canManage()) return;
    try {
      const data = await api(`/api/email-groups/records/${encodeURIComponent(id)}/lock`, { method: 'POST' });
      absorb(data);
      const record = S.data.records.find(item => item.id === id);
      S.editingId = id; S.selectedId = id;
      S.draft = { ...record };
      render();
      startHeartbeat();
    } catch (error) {
      toast(error.message || String(error));
      await refresh({ force: true }); // kilidi kimin tuttuğu ekranda görünsün
    }
  }
  function collectDraft() {
    const out = { ...S.draft };
    S.modal.querySelectorAll('[data-eg-input]').forEach(field => { out[field.dataset.egInput] = field.value; });
    return out;
  }
  async function stopEdit({ release = true } = {}) {
    const id = S.editingId;
    S.editingId = ''; S.draft = null;
    stopHeartbeat();
    if (id && release) { try { await api(`/api/email-groups/records/${encodeURIComponent(id)}/lock`, { method: 'DELETE' }); } catch (_) {} }
    await refresh({ force: true });
  }
  async function saveEdit(id) {
    const record = collectDraft();
    const parsed = parseRecipients(record.email);
    const invalid = parsed.filter(r => r.invalid);
    if (invalid.length) { toast(T(`Geçersiz e-posta: ${invalid[0].email}`, `Invalid e-mail: ${invalid[0].email}`)); S.modal?.querySelector('[data-eg-recipient-input]')?.focus(); return; }
    record.email = formatRecipients(parsed);
    try {
      absorb(await api(`/api/email-groups/records/${encodeURIComponent(id)}`, {
        method: 'PUT', body: JSON.stringify({ record, expectedRevision: S.data.revision }),
      }));
      S.editingId = ''; S.draft = null; stopHeartbeat();
      render();
      toast(T('Kayıt güncellendi.', 'Record updated.'));
    } catch (error) { toast(error.message || String(error)); await refresh({ force: true }); }
  }
  async function addRecord() {
    if (!canManage()) return;
    try {
      const data = await api('/api/email-groups/records', {
        method: 'POST',
        body: JSON.stringify({ record: { manufacturer: T('Yeni üretici', 'New manufacturer'), email: '' }, expectedRevision: S.data.revision }),
      });
      absorb(data);
      render();
      if (data.record) await startEdit(data.record.id);
    } catch (error) { toast(error.message || String(error)); await refresh({ force: true }); }
  }
  async function removeRecord(id) {
    if (!confirm(T('Bu e-posta kaydı silinsin mi?', 'Delete this email record?'))) return;
    try {
      absorb(await api(`/api/email-groups/records/${encodeURIComponent(id)}`, {
        method: 'DELETE', body: JSON.stringify({ expectedRevision: S.data.revision }),
      }));
      S.editingId = ''; S.draft = null; stopHeartbeat();
      render();
      toast(T('Kayıt silindi.', 'Record deleted.'));
    } catch (error) { toast(error.message || String(error)); await refresh({ force: true }); }
  }

  /* Kilit kalp atışı: form açık kaldıkça kilit tazelenir. */
  function startHeartbeat() {
    stopHeartbeat();
    S.heartbeatTimer = setInterval(() => {
      if (!S.editingId) return stopHeartbeat();
      api(`/api/email-groups/records/${encodeURIComponent(S.editingId)}/lock`, { method: 'POST' }).catch(() => {});
    }, HEARTBEAT_MS);
  }
  function stopHeartbeat() { if (S.heartbeatTimer) { clearInterval(S.heartbeatTimer); S.heartbeatTimer = null; } }

  /* ---------------- başlık yönetimi ---------------- */

  function headingKey(value) { return clean(value).toLocaleLowerCase('tr-TR'); }

  function renderHeadingEditor() {
    const editor = S.modal?.querySelector('[data-eg-heading-editor]');
    const state = S.headingEditor;
    if (!editor || !state) return;
    const list = editor.querySelector('[data-eg-heading-list]');
    list.innerHTML = state.items.length
      ? state.items.map((item, index) => `<li class="egHeadingRow">
          <span>${esc(item.name)}</span>
          <button type="button" class="egHeadingRemove" data-eg-heading-remove="${index}" title="${esc(T('Kaldır', 'Remove'))}">×</button>
        </li>`).join('')
      : `<li class="egHeadingEmpty">${esc(T('Henüz başlık eklenmedi.', 'No headings added yet.'))}</li>`;
  }

  function closeHeadingEditor() {
    S.modal?.querySelector('[data-eg-heading-editor]')?.remove();
    S.headingEditor = null;
  }

  function addHeading() {
    const editor = S.modal?.querySelector('[data-eg-heading-editor]');
    const input = editor?.querySelector('[data-eg-heading-input]');
    const name = clean(input?.value);
    if (!name) { input?.focus(); return; }
    const state = S.headingEditor;
    if (!state || state.items.some(item => headingKey(item.name) === headingKey(name))) {
      toast(T('Bu başlık zaten mevcut.', 'This heading already exists.'));
      input?.focus();
      return;
    }
    state.items.push({ id: '', name, order: state.items.length });
    input.value = '';
    renderHeadingEditor();
    input.focus();
  }

  function headingAppenditionsOnly(state) {
    const base = Array.isArray(state && state.baseItems) ? state.baseItems : [];
    const draft = Array.isArray(state && state.items) ? state.items : [];
    if (draft.length < base.length) return null;
    for (const original of base) {
      const same = draft.find(item => item.id && item.id === original.id);
      if (!same || headingKey(same.name) !== headingKey(original.name)) return null;
    }
    return draft.filter(item => !item.id && clean(item.name)).map(item => clean(item.name));
  }

  async function retryAddOnlyHeadingsAfterConflict(state) {
    const additions = headingAppenditionsOnly(state);
    if (!additions || !additions.length) return false;
    const latest = await api('/api/email-groups');
    absorb(latest);
    const current = state.kind === 'country' ? S.data.countries : S.data.types;
    const merged = current.map((item, order) => ({ id:item.id, name:item.name, order }));
    const seen = new Set(merged.map(item => headingKey(item.name)));
    for (const name of additions) {
      const key = headingKey(name);
      if (!key || seen.has(key)) continue;
      merged.push({ id:'', name, order:merged.length });
      seen.add(key);
    }
    absorb(await api(`/api/email-groups/headings/${state.kind}`, {
      method:'PUT',
      body:JSON.stringify({ items:merged, expectedRevision:S.data.revision }),
    }));
    return true;
  }

  async function saveHeadings() {
    const state = S.headingEditor;
    if (!state) return;
    try {
      absorb(await api(`/api/email-groups/headings/${state.kind}`, {
        method: 'PUT', body: JSON.stringify({ items: state.items, expectedRevision: S.data.revision }),
      }));
      closeHeadingEditor();
      render();
      toast(T('Başlıklar kaydedildi.', 'Headings saved.'));
    } catch (error) {
      if (error && error.code === 'REVISION_CONFLICT') {
        try {
          if (await retryAddOnlyHeadingsAfterConflict(state)) {
            closeHeadingEditor();
            render();
            toast(T('Başlıklar güncel listeyle birleştirilerek kaydedildi.', 'Headings were merged with the latest list and saved.'));
            return;
          }
        } catch (retryError) { error = retryError; }
      }
      toast(error.message || String(error));
      await refresh({ force: true });
      closeHeadingEditor();
    }
  }

  async function openHeadings(kind) {
    const isCountry = kind === 'country';
    const list = isCountry ? S.data.countries : S.data.types;
    const title = isCountry ? T('Ülkeler', 'Countries') : T('Üretim alanları', 'Production areas');
    closeHeadingEditor();
    const items = list.map((item, order) => ({ id: item.id, name: item.name, order }));
    S.headingEditor = { kind, baseItems: items.map(item => ({ ...item })), items };
    const editor = document.createElement('div');
    editor.className = 'egHeadingOverlay';
    editor.dataset.egHeadingEditor = '';
    editor.innerHTML = `<section class="egHeadingCard" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <header class="egHeadingHead"><div><strong>${esc(T(`${title} ekle / yönet`, `Add / manage ${title.toLowerCase()}`))}</strong>
        <p>${esc(T('Manuel başlık ekleyin. İçinde kayıt olan başlık kaldırılamaz.', 'Add headings manually. Headings with records cannot be removed.'))}</p></div>
        <button type="button" class="egBtn egHeadingClose" data-eg-heading-close aria-label="${esc(T('Kapat', 'Close'))}">×</button>
      </header>
      <div class="egHeadingAdd"><input type="text" data-eg-heading-input maxlength="120" placeholder="${esc(isCountry ? T('Yeni ülke', 'New country') : T('Yeni üretim alanı (ör. Örme)', 'New production area (e.g. Knit)'))}">
        <button type="button" class="egBtn egPrimary" data-eg-heading-add>＋ ${esc(T('Ekle', 'Add'))}</button></div>
      <ul class="egHeadingList" data-eg-heading-list></ul>
      <footer class="egHeadingFoot"><button type="button" class="egBtn" data-eg-heading-close>${esc(T('Vazgeç', 'Cancel'))}</button>
        <button type="button" class="egBtn egPrimary" data-eg-heading-apply>${esc(T('Kaydet', 'Save'))}</button></footer>
    </section>`;
    S.modal.appendChild(editor);
    renderHeadingEditor();
    editor.querySelector('[data-eg-heading-input]')?.focus();
  }

  /* ---------------- pencere ---------------- */

  function onKey(event) {
    if (event.key !== 'Escape' || !S.open) return;
    event.preventDefault(); event.stopImmediatePropagation();
    close();
  }

  /* ---------------- Prepare E-Mail kayıtlarının taşınması (v7.35) ----------

     Kullanıcı talebi (birebir): "Manufacturer Email Groups alanına, Prepare
     E-Mail alanındaki kayıtları taşı."

     Aday listesi İKİ yerden toplanır. Yalnız görünen listeyi göndermek,
     yıllar önce kaydedilmiş eski eşlemeleri geride bırakırdı:
       · kolManufacturers — Prepare E-Mail penceresindeki üretici/e-posta listesi,
       · lcw.prodstatus.mails.v1 — eski "üretici → e-posta" eşlemesi.
     Adresi olmayan üretici de taşınır: ortak ekranda eksik adres görünür ve
     oradan tamamlanır; atlanırsa o üretici hiç görünmezdi.

     Birleştirme kararını SUNUCU verir (§32) ve tek yazma işleminde uygular.
     Sonuç sayılarla bildirilir — "taşındı" demek, neyin taşınmadığını
     gizlemek olurdu. */
  function prepareEmailCandidates() {
    const out = [];
    const seen = new Set();
    const key = value => String(value == null ? '' : value).trim().toLocaleLowerCase('tr-TR');
    const push = (manufacturer, email) => {
      const name = clean(manufacturer);
      const mail = clean(email);
      if (!name && !mail) return;
      const k = key(name) || key(mail);
      if (seen.has(k)) {
        // Aynı üretici iki kaynakta da varsa adresi OLAN kazanır.
        if (mail) { const hit = out.find(item => (key(item.manufacturer) || key(item.email)) === k); if (hit && !hit.email) hit.email = mail; }
        return;
      }
      seen.add(k);
      out.push({ manufacturer: name, email: mail });
    };
    try {
      /* Liste app-main.js'te bir üst düzey `let`tir; window üzerinde GÖRÜNMEZ.
         Bu yüzden erişimci işlev üzerinden okunur — doğrudan
         window.kolManufacturers okumak sessizce BOŞ liste verirdi ve taşıma
         yalnız eski eşlemeyi getirirdi. */
      const list = typeof window.BLPrepareEmailManufacturers === 'function'
        ? window.BLPrepareEmailManufacturers()
        : (Array.isArray(window.kolManufacturers) ? window.kolManufacturers : []);
      (Array.isArray(list) ? list : []).forEach(item => push(item && item.name, item && item.email));
    } catch (_) { /* liste yoksa eski eşleme yine denenir */ }
    try {
      const raw = window.BLStorage ? BLStorage.getItem('lcw.prodstatus.mails.v1') : localStorage.getItem('lcw.prodstatus.mails.v1');
      const map = JSON.parse(raw || '{}');
      Object.entries(map && typeof map === 'object' ? map : {}).forEach(([name, mail]) => push(name, mail));
    } catch (_) { /* bozuk/eksik eşleme taşımayı durdurmaz */ }
    return out;
  }

  function importSummaryText(summary) {
    const s = summary || {};
    const parts = [];
    if (s.added?.length) parts.push(T(`${s.added.length} kayıt taşındı`, `${s.added.length} record(s) moved`));
    if (s.filled?.length) parts.push(T(`${s.filled.length} boş adres dolduruldu`, `${s.filled.length} empty address(es) filled`));
    if (s.unchanged?.length) parts.push(T(`${s.unchanged.length} kayıt zaten aynıydı`, `${s.unchanged.length} record(s) already matched`));
    if (s.conflicts?.length) parts.push(T(`${s.conflicts.length} kayıtta adres FARKLI — üzerine yazılmadı: ${s.conflicts.slice(0, 3).map(item => item.manufacturer).join(', ')}`,
      `${s.conflicts.length} record(s) have a DIFFERENT address — not overwritten: ${s.conflicts.slice(0, 3).map(item => item.manufacturer).join(', ')}`));
    if (s.locked?.length) parts.push(T(`${s.locked.length} kayıt düzenlemede olduğu için atlandı`, `${s.locked.length} record(s) skipped: being edited`));
    return parts.length ? parts.join(' · ') : T('Taşınacak yeni kayıt bulunamadı.', 'No new record to move.');
  }

  async function importFromPrepareEmail() {
    if (!canManage()) { toast(T('E-posta rehberini güncellemek için ortak ayar yetkisi gerekir.', 'Updating the email directory requires shared-settings permission.')); return; }
    const candidates = prepareEmailCandidates();
    if (!candidates.length) {
      toast(T('Prepare E-Mail listenizde taşınacak üretici yok.', 'Your Prepare E-Mail list has no manufacturer to move.'));
      return;
    }
    try {
      const data = await api('/api/email-groups/import', {
        method: 'POST',
        body: JSON.stringify({ records: candidates, expectedRevision: S.data.revision }),
      });
      absorb(data);
      render();
      S.lastImport = data.summary || null;
      toast(importSummaryText(data.summary));
    } catch (error) { toast(error.message || String(error)); }
  }

  async function reconcileLegacyDirectoryIfSparse() {
    /* Eski tek-seferlik migration işareti artık bir KAPI değildir. Merkezi
       rehber sonradan seyrekleşirse (ör. sync/recovery arızası), işaret '1'
       kalsa bile kullanıcı profilindeki eski üretici→e-posta eşlemesi güvenli
       bir onarım kaynağı olabilir. Onarım yalnız güçlü seyrekleşme imzasında
       ve yalnız GERÇEK e-posta taşıyan adaylarla çalışır; normal bir silme
       işleminden sonra eski üreticileri sürekli geri getirmez. */
    if (!canManage()) return false;
    const candidates = prepareEmailCandidates().filter(item => clean(item && item.email));
    if (candidates.length < 3) return false;
    await ensureDirectory(true);
    const currentRecipients = S.data.records.filter(record => clean(record && record.email)).length;
    const sparse = S.data.records.length <= 1
      || currentRecipients === 0
      || currentRecipients * 3 < candidates.length;
    if (!sparse) return false;

    const repair = candidates.filter(candidate => {
      const existing = recordFor(candidate.manufacturer);
      if (!existing) return true;
      return !clean(existing.email) && clean(candidate.email);
    });
    if (!repair.length) return false;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const data = await api('/api/email-groups/import', {
          method:'POST',
          body:JSON.stringify({ records:repair, expectedRevision:S.data.revision }),
        });
        absorb(data);
        try { (window.BLStorage || localStorage).setItem('lcw.emailGroups.centralMigration.v2.repaired','1'); } catch (_) {}
        return true;
      } catch (error) {
        if (!error || error.code !== 'REVISION_CONFLICT' || attempt > 0) return false;
        await ensureDirectory(true);
      }
    }
    return false;
  }

  /* Eski dış çağrılar/testler için ad korunur; artık "once" işaretiyle
     engellenmez, yukarıdaki seyrekleşme korumasını kullanır. */
  async function migrateLegacyDirectoryOnce() {
    return reconcileLegacyDirectoryIfSparse();
  }

  async function open() {
    if (S.open) return;
    close();
    S.open = true;
    S.modal = document.createElement('div');
    S.modal.id = '_emailGroups';
    S.modal.className = 'warnOverlay egOverlay';
    S.modal.innerHTML = `<div class="modalCard egCardShell" role="dialog" aria-modal="true">
      <div class="egHead">
        <div>
          <div class="modalTitle">${esc(T('Üreticiler — İletişim Rehberi', 'Manufacturers — Contact Directory'))}</div>
          <p class="egSub">${esc(T('Üretici kartlarının merkezi e-posta rehberi. Prepare E-Mail, Send to Pricing, kurallar ve otomasyonlar bu kayıtları kullanır; üretici adı ASAS’taki tam ad olmalıdır.', 'The central e-mail directory of the manufacturer cards. Prepare E-Mail, Send to Pricing, rules and automations use these records; the manufacturer name must be the exact ASAS name.'))}</p>
        </div>
        <button type="button" class="pricingRuleIconBtn" data-eg-close aria-label="${esc(T('Kapat', 'Close'))}">✕</button>
      </div>
      <div class="egTools">
        <input type="search" class="egSearch" data-eg-search placeholder="${esc(T('Üretici, e-posta, kişi ara…', 'Search manufacturer, email, contact…'))}" autocomplete="off">
        <select data-eg-filter-country></select>
        <select data-eg-filter-type></select>
        <label class="egGroupBy">${esc(T('Grupla', 'Group by'))}
          <select data-eg-groupby>
            <option value="country">${esc(T('Ülke', 'Country'))}</option>
            <option value="type">${esc(T('Üretim alanı', 'Production area'))}</option>
            <option value="none">${esc(T('Gruplama yok', 'No grouping'))}</option>
          </select>
        </label>
        <span class="egCount" data-eg-count></span>
        <span style="flex:1"></span>
        <button type="button" class="egBtn" data-eg-headings="country"><svg class="ic"><use href="#i-map-pin"/></svg>＋ ${esc(T('Ülke ekle', 'Add country'))}</button>
        <button type="button" class="egBtn" data-eg-headings="type"><svg class="ic"><use href="#i-tag"/></svg>＋ ${esc(T('Üretim alanı ekle', 'Add production area'))}</button>
        <button type="button" class="egBtn egPrimary" data-eg-add><svg class="ic"><use href="#i-copy-plus"/></svg>${esc(T('Kayıt Ekle', 'Add record'))}</button>
      </div>
      <div class="egBody" data-eg-body></div>
    </div>`;
    document.body.appendChild(S.modal);

    S.modal.addEventListener('click', async event => {
      if (event.target === S.modal || event.target.closest('[data-eg-close]')) { close(); return; }
      const headingEditor = event.target.closest('[data-eg-heading-editor]');
      if (headingEditor && event.target === headingEditor) { closeHeadingEditor(); return; }
      if (event.target.closest('[data-eg-heading-close]')) { closeHeadingEditor(); return; }
      if (event.target.closest('[data-eg-heading-add]')) { addHeading(); return; }
      const removeHeading = event.target.closest('[data-eg-heading-remove]');
      if (removeHeading) {
        const index = Number(removeHeading.dataset.egHeadingRemove);
        if (S.headingEditor?.items[index]) { S.headingEditor.items.splice(index, 1); renderHeadingEditor(); }
        return;
      }
      if (event.target.closest('[data-eg-heading-apply]')) { await saveHeadings(); return; }
      const select = event.target.closest('[data-eg-select]');
      if (select && !event.target.closest('a,input,select,textarea')) { S.selectedId = select.dataset.egSelect; render(); return; }
      const edit = event.target.closest('[data-eg-edit]');
      if (edit) { await startEdit(edit.dataset.egEdit); return; }
      const recipientRemove = event.target.closest('[data-eg-recipient-remove]');
      if (recipientRemove && S.editingId) { const current = parseRecipients(collectDraft().email).filter((_,i)=>i!==Number(recipientRemove.dataset.egRecipientRemove)); S.draft = { ...collectDraft(), email: formatRecipients(current) }; render(); return; }
      if (event.target.closest('[data-eg-cancel]')) { await stopEdit(); return; }
      const save = event.target.closest('[data-eg-save]');
      if (save) { await saveEdit(save.dataset.egSave); return; }
      const drop = event.target.closest('[data-eg-delete]');
      if (drop) { await removeRecord(drop.dataset.egDelete); return; }
      if (event.target.closest('[data-eg-add]')) { await addRecord(); return; }
      const headings = event.target.closest('[data-eg-headings]');
      if (headings) { await openHeadings(headings.dataset.egHeadings); }
    });
    S.modal.addEventListener('input', event => {
      if (event.target.matches('[data-eg-search]')) { S.search = event.target.value; render(); return; }
      if (event.target.matches('[data-eg-input="manufacturer"]')) { const hint = S.modal?.querySelector('[data-eg-asas-hint]'); if (hint) hint.innerHTML = asasHintText(event.target.value); }
      if (event.target.matches('[data-eg-input]')) { S.draft = collectDraft(); if(event.target.matches('[data-eg-recipient-input]')){ const chips=S.modal?.querySelector('[data-eg-recipient-chips]'); if(chips) chips.innerHTML=recipientChipsHtml(event.target.value,true); } }
    });
    S.modal.addEventListener('keydown', event => {
      if (event.key === 'Enter' && event.target.matches('[data-eg-heading-input]')) { event.preventDefault(); addHeading(); }
    });
    S.modal.addEventListener('change', event => {
      if (event.target.matches('[data-eg-filter-country]')) { S.filterCountry = event.target.value; render(); }
      else if (event.target.matches('[data-eg-filter-type]')) { S.filterType = event.target.value; render(); }
      else if (event.target.matches('[data-eg-groupby]')) { S.groupBy = event.target.value; render(); }
    });
    document.addEventListener('keydown', onKey, true);

    render(); // Reuse the existing directory snapshot while revalidating locks.
    await refresh({ force: true });
    if (await reconcileLegacyDirectoryIfSparse()) { render(); }
    S.refreshTimer = setInterval(() => refresh(), REFRESH_MS);
  }

  /* Üreticiler sayfasındaki "Kartı düzenle": rehberi açar, kaydı seçer ve
     kilitli düzenlemeyi başlatır (kilit ve yetki yine sunucuda). */
  async function openRecord(id, { edit = false } = {}) {
    await open();
    if (!S.modal || !id) return;
    S.selectedId = id;
    render();
    if (edit) await startEdit(id);
  }

  function close() {
    if (S.editingId) { const id = S.editingId; S.editingId = ''; S.draft = null;
      api(`/api/email-groups/records/${encodeURIComponent(id)}/lock`, { method: 'DELETE' }).catch(() => {}); }
    stopHeartbeat();
    if (S.refreshTimer) { clearInterval(S.refreshTimer); S.refreshTimer = null; }
    document.removeEventListener('keydown', onKey, true);
    S.modal?.remove();
    S.modal = null; S.headingEditor = null; S.open = false;
  }

  document.getElementById('emailGroupsBtn')?.addEventListener('click', () => void open());
  // Tarayıcı kapanırken kilidi bırakmaya ÇALIŞ; ulaşmazsa sunucudaki süre düşürür.
  window.addEventListener('beforeunload', () => { if (S.editingId) { try { navigator.sendBeacon?.(`/api/email-groups/records/${encodeURIComponent(S.editingId)}/lock-release`); } catch (_) {} } });

  window.BLEmailGroups = { open, openRecord, close, refresh, sections, lockedByOther, stampText, state: S,
    prepareEmailCandidates, importFromPrepareEmail, importSummaryText, reconcileLegacyDirectoryIfSparse };
  /* Prepare E-Mail bu rehberden okur. Ayrı bir nesne olmasının sebebi, adres
     sorgulamak için e-posta grupları EKRANINA hiç ihtiyaç duyulmamasıdır. */
  window.BLEmailDirectory = { emailFor, recordFor, recipientsFor, ensureDirectory, parseRecipients, formatRecipients, records:()=>S.data.records.slice(), size: () => directory.size };
  // Açılışta bir kez okunur; ilk e-posta hazırlamada rehber hazır olsun.
  setTimeout(() => { void ensureDirectory().then(() => reconcileLegacyDirectoryIfSparse()); }, 2500);
})();
