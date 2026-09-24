/* ===================================================================
   KAYNAK EKLEME SİHİRBAZI (v7.81, §8)

   Hedef: "Yeni bir database'i Buyer Log'a bağlamak birkaç dakika sürmeli."

   AKIŞ — dört adım, hepsi tek panelde:

     1 Tür + ad        profil kaydından gelir, sabit liste yok
     2 Bağlantı        sunucu + model, ardından SINA
     3 Modüller        yalnız o profilin besleyebildikleri
     4 Otomatik eşleme sonucu özetlenir, sorunlular sayılır

   MOCK-UP'TAN AYRILDIĞIM YERLER ve nedenleri:

   · Manuel yol mevcut SSAS/Tabular kaynak sihirbazını aynen korur.
   · Excel discovery yolu worksheet/pivot verisi okumaz; yalnız Workbook
     Connections metadata’sını canonical database source tanımına dönüştürür.
   · Secret değerler Excel’den çıkarılmaz; gerektiğinde kullanıcı ayrıca girer.
   · PROFİL ADIMI manuel akışta korunur. Mock-up'ta yoktu ama zorunlu: otomatik eşlemenin
     neye karşı eşleştireceğini ve kaynağın hangi modülleri besleyebileceğini
     bu seçim belirler.
   =================================================================== */
(() => {
  'use strict';

  const en = () => typeof appLang !== 'undefined' && appLang === 'en';
  const T = (tr, enText) => (en() ? enText : tr);
  const esc = value => (typeof escapeHtml === 'function'
    ? escapeHtml(String(value == null ? '' : value))
    : String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch])));

  let host = null;
  let profiles = [];
  let moduleLabels = {};
  let onDone = null;

  let draft = null;              // {name, profileId, server, catalog, moduleIds}
  let step = 1;
  let busy = false;
  /* Mesajlar BİRİKİR, birbirini ezmez. Canlı ölçümde görüldü: "kaynak kapalı
     eklendi çünkü bu türde zaten aktif biri var" uyarısı, hemen ardından gelen
     eşleme hatası tarafından siliniyordu — kullanıcı en önemli bilgiyi
     kaybediyordu. */
  let messages = [];
  let messageTone = 'info';
  const TONE_RANK = { info: 0, warn: 1, bad: 2 };
  function say(text, tone = 'info') {
    const value = String(text || '').trim();
    if (!value) return;
    if (!messages.includes(value)) messages.push(value);
    if (TONE_RANK[tone] > TONE_RANK[messageTone]) messageTone = tone;
  }
  function clearMessages() { messages = []; messageTone = 'info'; }
  let probe = null;              // {tableCount, provider, method}
  let mapResult = null;          // {mapped, unmatched, missingRequired}
  let creationMode = '';         // '' | 'manual' | 'excel'
  let excelDiscovery = null;     // sanitized discovery response
  let excelCandidateId = '';
  let excelProbe = null;
  let excelName = '';
  let excelUsername = '';
  let excelPassword = '';

  const profileOf = id => profiles.find(entry => entry.id === id) || null;

  /* ---------------------------------------------------------------- */

  function stepHeader() {
    const steps = [
      T('Tür', 'Type'), T('Bağlantı', 'Connection'),
      T('Modüller', 'Modules'), T('Eşleme', 'Mapping'),
    ];
    return `<ol class="dmsSteps">${steps.map((label, index) => {
      const number = index + 1;
      const state = number < step ? ' isDone' : (number === step ? ' isActive' : '');
      return `<li class="dmsStep${state}"><span class="dmsStepNo">${number}</span>${esc(label)}</li>`;
    }).join('')}</ol>`;
  }

  function body() {
    if (step === 1) {
      return `<div class="dmsPane">
        <label class="dmsField">
          <span class="dmLabel">${esc(T('Kaynak adı', 'Source name'))}</span>
          <input type="text" id="_dmsName" value="${esc(draft.name)}" maxlength="80"
            placeholder="${esc(T('Örn. ASAS', 'e.g. ASAS'))}" autocomplete="off">
        </label>
        <span class="dmLabel">${esc(T('Kaynak türü', 'Source type'))}</span>
        <div class="dmsProfiles">
          ${profiles.map(profile => `<button type="button" class="dmsProfile${draft.profileId === profile.id ? ' isActive' : ''}"
            data-profile="${esc(profile.id)}">
            <span class="dmsProfileName">${esc(en() ? profile.label.en : profile.label.tr)}</span>
            <span class="dmsProfileSummary">${esc(en() ? profile.summary.en : profile.summary.tr)}</span>
            <span class="dmsProfileFeeds">${esc(T('Besleyebilir', 'Can feed'))}: ${profile.feedableModules.map(id => esc(moduleLabels[id] || id)).join(' · ')}</span>
          </button>`).join('')}
        </div>
      </div>`;
    }

    if (step === 2) {
      const profile = profileOf(draft.profileId);
      return `<div class="dmsPane">
        <p class="dmsNote">${esc(T(
          'Bu kaynak Analysis Services / Power BI modeline DAX ile bağlanır. Kimlik bilgisi istenmez: Windows oturumunuz kullanılır.',
          'This source connects to an Analysis Services / Power BI model with DAX. No credentials are asked: your Windows session is used.'))}</p>
        <div class="dmsGrid">
          <label class="dmsField">
            <span class="dmLabel">${esc(T('Sunucu', 'Server'))}</span>
            <input type="text" id="_dmsServer" value="${esc(draft.server)}" placeholder="lcwtabular_s30" autocomplete="off">
          </label>
          <label class="dmsField">
            <span class="dmLabel">${esc(T('Model (katalog)', 'Model (catalog)'))}</span>
            <input type="text" id="_dmsCatalog" value="${esc(draft.catalog)}" placeholder="ASAS_30" autocomplete="off">
          </label>
        </div>
        <div class="dmsRow">
          <button type="button" class="tbtn" data-test ${busy ? 'disabled' : ''}>${esc(T('Bağlantıyı sına', 'Test connection'))}</button>
          ${probe ? `<span class="dmsProbe">✓ ${probe.tableCount} ${esc(T('tablo bulundu', 'tables found'))}${probe.provider ? ` · ${esc(probe.provider)}` : ''}</span>` : ''}
        </div>
        <p class="dmsHint">${esc(T(
          `Alan eşlemesi "${profile ? (en() ? profile.label.en : profile.label.tr) : ''}" kataloğuna göre yapılacak.`,
          `Field mapping will use the "${profile ? (en() ? profile.label.en : profile.label.tr) : ''}" catalogue.`))}</p>
      </div>`;
    }

    if (step === 3) {
      const profile = profileOf(draft.profileId);
      const feedable = profile ? profile.feedableModules : [];
      return `<div class="dmsPane">
        <span class="dmLabel">${esc(T('Bu kaynak hangi modülleri beslesin?', 'Which modules should this source feed?'))}</span>
        <div class="dmsModules">
          ${feedable.map(id => `<label class="dmCheck">
            <input type="checkbox" data-module="${esc(id)}" ${draft.moduleIds.includes(id) ? 'checked' : ''}>
            <span>${esc(moduleLabels[id] || id)}</span>
          </label>`).join('')}
        </div>
        <p class="dmsHint">${esc(T(
          'Seçtiğin modüller filtresiz başlar. Filtre tanımlanmadan yenileme çalışmaz — ekran bunu hatırlatacak.',
          'The modules you pick start without a filter. Refresh will not run until a filter is defined — the screen will remind you.'))}</p>
      </div>`;
    }

    return `<div class="dmsPane">
      ${mapResult ? `
        <div class="dmsMapSummary">
          <span class="isOk">✓ ${mapResult.mapped} ${esc(T('alan otomatik eşlendi', 'fields auto-mapped'))}</span>
          ${mapResult.unmatched ? `<span class="isWarn">— ${mapResult.unmatched} ${esc(T('eşlenmedi', 'unmapped'))}</span>` : ''}
          ${mapResult.missingRequired.length ? `<span class="isBad">⛔ ${mapResult.missingRequired.length} ${esc(T('zorunlu alan eksik', 'required missing'))}</span>` : ''}
        </div>
        ${mapResult.missingRequired.length ? `<p class="dmsHint">${esc(T(
          `Eksik zorunlu alanlar: ${mapResult.missingRequired.join(', ')}. Kaynak eklenecek ama bunlar eşlenmeden yenilenemez.`,
          `Missing required fields: ${mapResult.missingRequired.join(', ')}. The source will be added but cannot refresh until these are mapped.`))}</p>` : ''}
      ` : `<p class="dmsHint">${esc(T('Otomatik eşleme çalıştırılıyor…', 'Running auto-mapping…'))}</p>`}
    </div>`;
  }

  function canAdvance() {
    if (step === 1) return Boolean(draft.name.trim() && draft.profileId);
    if (step === 2) return Boolean(draft.server.trim() && draft.catalog.trim());
    return true;
  }

  function kindLabel(kind, family) {
    if (kind === 'analysis-services') return 'Analysis Services / MSOLAP';
    if (kind === 'sqlserver') return 'SQL Server';
    if (kind === 'odbc') return family === 'oracle' ? 'Oracle / ODBC' : 'ODBC';
    if (kind === 'oledb') return family === 'oracle' ? 'Oracle / OLE DB' : 'OLE DB';
    return T('Desteklenmeyen kaynak', 'Unsupported source');
  }
  function authLabel(auth) {
    if (!auth) return '—';
    if (auth.type === 'windows') return T('Windows / Integrated', 'Windows / Integrated');
    if (auth.type === 'username-password') return T('Kullanıcı adı + parola', 'Username + password');
    if (auth.type === 'office-managed') return T('Excel/Office tarafından yönetiliyor', 'Managed by Excel/Office');
    return T('Belirlenemedi', 'Unknown');
  }
  function currentExcelCandidate() {
    return excelDiscovery && (excelDiscovery.connections || []).find(item => item.id === excelCandidateId) || null;
  }
  function renderMethodChoice() {
    host.innerHTML = `<div class="dmSourceWizard" role="region" aria-label="${esc(T('Yeni Database Bağlantısı', 'New Database Connection'))}">
      <div class="dmsHead"><span class="dmsTitle">${esc(T('Yeni Database Bağlantısı', 'New Database Connection'))}</span></div>
      <div class="dmsPane">
        <p class="dmsNote">${esc(T('Bağlantıyı elle tanımlayın veya çalışan bir Excel dosyasındaki bağlantı metadata’sını keşfedin. Excel yalnız keşif için kullanılır; veri kaynağı olmaz.', 'Define the connection manually or discover connection metadata from a working Excel workbook. Excel is used only for discovery; it does not become the data source.'))}</p>
        <div class="dmsProfiles dmsMethodChoices">
          <button type="button" class="dmsProfile" data-creation-mode="manual"><span class="dmsProfileName">${esc(T('Manuel Tanımla', 'Define Manually'))}</span><span class="dmsProfileSummary">${esc(T('Mevcut Buyer Log database/model bağlantı sihirbazını kullan.', 'Use the existing Buyer Log database/model connection wizard.'))}</span></button>
          <button type="button" class="dmsProfile" data-creation-mode="excel"><span class="dmsProfileName">${esc(T("Excel'den Bağlantı Bilgilerini Al", 'Get Connection Info from Excel'))}</span><span class="dmsProfileSummary">${esc(T('Workbook Connections içindeki database metadata’sını keşfet; worksheet/pivot verisi okunmaz.', 'Discover database metadata from Workbook Connections; worksheet/pivot data is not read.'))}</span></button>
        </div>
      </div>
      <div class="dmsFoot"><span class="dmfSpacer"></span><button type="button" class="tbtn" data-cancel>${esc(T('İptal', 'Cancel'))}</button></div>
    </div>`;
  }
  function renderExcel() {
    const candidate = currentExcelCandidate();
    if (!excelDiscovery) {
      host.innerHTML = `<div class="dmSourceWizard" role="region"><div class="dmsHead"><span class="dmsTitle">${esc(T("Excel'den Bağlantı Bilgilerini Al", 'Get Connection Info from Excel'))}</span></div><div class="dmsPane"><p class="dmsHint">${esc(busy ? T('Excel bağlantı metadata’sı okunuyor…', 'Reading Excel connection metadata…') : T('Bir .xlsx veya .xlsm çalışma kitabı seçin.', 'Choose an .xlsx or .xlsm workbook.'))}</p>${messages.length ? `<p class="dmfMessage is-${esc(messageTone)}">${messages.map(esc).join(' ')}</p>` : ''}</div><div class="dmsFoot"><button type="button" class="tbtn" data-mode-back ${busy ? 'disabled' : ''}>${esc(T('Geri', 'Back'))}</button><span class="dmfSpacer"></span><button type="button" class="tbtn" data-cancel>${esc(T('İptal', 'Cancel'))}</button><button type="button" class="navActionBtn" data-pick-workbook ${busy ? 'disabled' : ''}>${esc(T('Excel Dosyası Seç', 'Choose Excel File'))}</button></div></div>`;
      return;
    }
    if (!candidate) {
      const rows = (excelDiscovery.connections || []).map(item => `<div class="dmsExcelConnection${item.supported ? '' : ' isUnsupported'}">
        <div class="dmsExcelConnectionMain"><strong>${esc(item.name)}</strong><span>${esc(kindLabel(item.kind, item.family))}</span><small>${esc(item.server || item.dsn || item.provider || '—')}${item.database ? ` / ${esc(item.database)}` : ''}</small><small>${esc(T('Kimlik doğrulama', 'Authentication'))}: ${esc(authLabel(item.authentication))} · ${esc(item.query && item.query.found ? T('Query: mevcut', 'Query: found') : T('Query: yok', 'Query: none'))}</small>${!item.supported ? `<small class="isBad">${esc(T('Desteklenmeyen kaynak türü', 'Unsupported source type'))}</small>` : ''}</div>
        <button type="button" class="tbtn" data-excel-select="${esc(item.id)}" ${item.supported ? '' : 'disabled'}>${esc(T('Seç', 'Select'))}</button>
      </div>`).join('');
      host.innerHTML = `<div class="dmSourceWizard" role="region"><div class="dmsHead"><span class="dmsTitle">${esc(excelDiscovery.workbookName || '')}</span><span class="dmsHint">${esc(T(`${excelDiscovery.count || 0} bağlantı bulundu`, `${excelDiscovery.count || 0} connections found`))}</span></div><div class="dmsPane"><div class="dmsExcelConnections">${rows || `<p class="dmsHint">${esc(T('Workbook Connections metadata bulunamadı.', 'No Workbook Connections metadata found.'))}</p>`}</div>${(excelDiscovery.warnings || []).map(w => `<p class="dmfMessage is-warn">${esc(w)}</p>`).join('')}</div><div class="dmsFoot"><button type="button" class="tbtn" data-mode-back>${esc(T('Geri', 'Back'))}</button><span class="dmfSpacer"></span><button type="button" class="tbtn" data-cancel>${esc(T('İptal', 'Cancel'))}</button><button type="button" class="tbtn" data-pick-workbook>${esc(T('Başka Excel Seç', 'Choose Another Excel'))}</button></div></div>`;
      return;
    }
    const auth = candidate.authentication || {};
    const needsCredential = auth.passwordRequired || auth.officeManaged || auth.type === 'username-password' || auth.type === 'office-managed' || auth.type === 'unknown';
    host.innerHTML = `<div class="dmSourceWizard" role="region"><div class="dmsHead"><span class="dmsTitle">${esc(T('Database Bağlantısı', 'Database Connection'))}</span></div><div class="dmsPane">
      <label class="dmsField"><span class="dmLabel">${esc(T('Kaynak adı', 'Source name'))}</span><input id="_dmsExcelName" value="${esc(excelName || candidate.name)}" maxlength="80" autocomplete="off"></label>
      <div class="dmConnectionPreview">
        <div><span class="dmLabel">${esc(T('Kaynak', 'Source'))}</span><span class="dmValue">${esc(T("Excel'den algılandı", 'Detected from Excel'))}</span></div>
        <div><span class="dmLabel">${esc(T('Tür', 'Type'))}</span><span class="dmValue">${esc(kindLabel(candidate.kind, candidate.family))}</span></div>
        <div><span class="dmLabel">${esc(T('Sunucu / DSN', 'Server / DSN'))}</span><span class="dmValue">${esc(candidate.server || candidate.dsn || '—')}</span></div>
        <div><span class="dmLabel">${esc(T('Database / Service', 'Database / Service'))}</span><span class="dmValue">${esc(candidate.database || candidate.serviceName || candidate.sid || '—')}</span></div>
        <div><span class="dmLabel">${esc(T('Authentication', 'Authentication'))}</span><span class="dmValue">${esc(authLabel(auth))}</span></div>
        <div><span class="dmLabel">${esc(T('Driver / Provider', 'Driver / Provider'))}</span><span class="dmValue">${esc(candidate.driver || candidate.provider || '—')}</span></div>
        <div><span class="dmLabel">${esc(T('Query', 'Query'))}</span><span class="dmValue">${esc(candidate.query && candidate.query.safe ? T('Bulundu', 'Found') : candidate.query && candidate.query.found ? T('Bulundu fakat otomatik çalıştırılmayacak', 'Found but will not be auto-executed') : T('Yok', 'None'))}</span></div>
      </div>
      ${candidate.hasEmbeddedSecret || auth.officeManaged ? `<p class="dmfMessage is-warn">${esc(T('Bu bağlantının kimlik bilgileri Excel/Office tarafından yönetiliyor olabilir. Buyer Log secret çıkarmaya çalışmaz; gerekirse aşağıda ayrıca kimlik doğrulayın.', 'This connection may have credentials managed by Excel/Office. Buyer Log does not extract secrets; authenticate separately below if needed.'))}</p>` : ''}
      ${needsCredential ? `<div class="dmsGrid"><label class="dmsField"><span class="dmLabel">${esc(T('Kullanıcı adı', 'Username'))}</span><input id="_dmsExcelUser" value="${esc(excelUsername || auth.username || '')}" autocomplete="username"></label><label class="dmsField"><span class="dmLabel">${esc(T('Parola', 'Password'))}</span><input id="_dmsExcelPassword" type="password" value="${esc(excelPassword)}" autocomplete="new-password"></label></div><p class="dmsHint">${esc(T('Parola Excel’den okunmaz. Database olarak eklenirse yalnız bu bilgisayarda şifreli credential store’da saklanır.', 'The password is not read from Excel. If added as a database source, it is stored only on this PC in the encrypted credential store.'))}</p>` : ''}
      ${excelProbe ? `<p class="dmfMessage is-info">✓ ${esc(T('Database bağlantısı başarılı', 'Database connection successful'))}${excelProbe.provider ? ` · ${esc(excelProbe.provider)}` : ''}</p>` : ''}
      ${messages.length ? `<p class="dmfMessage is-${esc(messageTone)}">${messages.map(esc).join(' ')}</p>` : ''}
    </div><div class="dmsFoot"><button type="button" class="tbtn" data-excel-list-back ${busy ? 'disabled' : ''}>${esc(T('Geri', 'Back'))}</button><span class="dmfSpacer"></span><button type="button" class="tbtn" data-cancel ${busy ? 'disabled' : ''}>${esc(T('Vazgeç', 'Cancel'))}</button><button type="button" class="tbtn" data-excel-test ${busy ? 'disabled' : ''}>${esc(busy ? T('Sınanıyor…', 'Testing…') : T('Bağlantıyı Test Et', 'Test Connection'))}</button><button type="button" class="navActionBtn" data-excel-add ${busy || !excelProbe ? 'disabled' : ''}>${esc(T('Database Olarak Ekle', 'Add as Database'))}</button></div></div>`;
  }

  function render() {
    if (!host) return;
    if (!creationMode) { renderMethodChoice(); return; }
    if (creationMode === 'excel') { renderExcel(); return; }
    host.innerHTML = `<div class="dmSourceWizard" role="region" aria-label="${esc(T('Kaynak ekle', 'Add source'))}">
      <div class="dmsHead">
        <span class="dmsTitle">${esc(T('Kaynak ekle', 'Add source'))}</span>
        ${stepHeader()}
      </div>
      ${body()}
      <div class="dmsFoot">
        ${messages.length ? `<span class="dmfMessage is-${esc(messageTone)}">${messages.map(esc).join(' ')}</span>` : ''}
        <span class="dmfSpacer"></span>
        <button type="button" class="tbtn" data-cancel ${busy ? 'disabled' : ''}>${esc(T('İptal', 'Cancel'))}</button>
        ${step > 1 ? `<button type="button" class="tbtn" data-back ${busy ? 'disabled' : ''}>${esc(T('Geri', 'Back'))}</button>` : ''}
        ${step < 3 ? `<button type="button" class="navActionBtn" data-next ${busy || !canAdvance() ? 'disabled' : ''}>${esc(T('İleri', 'Next'))}</button>` : ''}
        ${step === 3 ? `<button type="button" class="navActionBtn" data-create ${busy ? 'disabled' : ''}>${esc(T('Kaynağı ekle', 'Add source'))}</button>` : ''}
        ${step === 4 ? `<button type="button" class="navActionBtn" data-finish ${busy ? 'disabled' : ''}>${esc(T('Bitir', 'Finish'))}</button>` : ''}
      </div>
    </div>`;
  }

  /* ---------------------------------------------------------------- */

  function readInputs() {
    const name = host.querySelector('#_dmsName');
    if (name) draft.name = name.value;
    const server = host.querySelector('#_dmsServer');
    if (server) draft.server = server.value;
    const catalog = host.querySelector('#_dmsCatalog');
    if (catalog) draft.catalog = catalog.value;
  }

  async function testConnection() {
    busy = true; clearMessages(); probe = null; render();
    try {
      const response = await fetch('/api/model-connections/inspect', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ server: draft.server, catalog: draft.catalog }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(payload.error || T('Bağlantı kurulamadı.', 'Could not connect.'));
      probe = { tableCount: payload.tableCount, provider: payload.provider || '', method: payload.method || '' };
    } catch (error) {
      say(String(error && error.message || error), 'bad');
    } finally { busy = false; render(); }
  }

  async function createSource() {
    busy = true; clearMessages(); render();
    try {
      const response = await fetch('/api/data-management/source', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: draft.name, profileId: draft.profileId,
          server: draft.server, catalog: draft.catalog, moduleIds: draft.moduleIds,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(payload.error || T('Kaynak eklenemedi.', 'Could not add the source.'));
      draft.sourceId = payload.sourceId;
      // Bu uyarilar (ornegin "kapali eklendi") sonraki adimda SILINMEZ.
      for (const warning of payload.warnings || []) say(warning, 'warn');
      step = 4;
      render();
      await runAutoMap();
    } catch (error) {
      say(String(error && error.message || error), 'bad');
      busy = false;
      render();
    }
  }

  async function runAutoMap() {
    busy = true; render();
    try {
      const profile = profileOf(draft.profileId);
      const response = await fetch('/api/model-connections/automap', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        /* role: eski sözleşme. Profil ile rol arasındaki eşleme sunucuda
           yaşıyor; burada profilin legacy karşılığı gönderilir. */
        body: JSON.stringify({ server: draft.server, catalog: draft.catalog, role: profile ? profile.legacyRole : 'asas' }),
      });
      const payload = await response.json().catch(() => ({}));
      // Yedek metin, aşağıdaki ön ekle çakışmayacak şekilde yazılır; ikisi
      // birleşince "Otomatik eşleme çalışmadı: Otomatik eşleme çalışmadı."
      // gibi bir cümle çıkmamalı.
      if (!response.ok || !payload.ok) throw new Error(payload.error || T('sunucu yanıt vermedi', 'the server did not respond'));

      const write = await fetch(`/api/data-management/source/${encodeURIComponent(draft.sourceId)}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mapping: payload.mapping || {} }),
      });
      const written = await write.json().catch(() => ({}));
      if (!write.ok || !written.ok) throw new Error(written.error || T('Eşleme kaydedilemedi.', 'Could not save the mapping.'));

      mapResult = {
        mapped: Object.keys(payload.mapping || {}).length,
        unmatched: (payload.unmatched || []).length,
        missingRequired: payload.missingRequired || [],
      };
    } catch (error) {
      /* Kaynak ZATEN EKLENDİ; eşleme ayrı bir adım. Hata burada akışı geri
         almaz — kullanıcı eşlemeyi kaynak ayrıntısından sonra düzeltebilir. */
      mapResult = { mapped: 0, unmatched: 0, missingRequired: [] };
      say(`${T('Otomatik eşleme çalışmadı:', 'Auto-mapping failed:')} ${String(error && error.message || error)} `
        + T('Kaynak eklendi; eşlemeyi kaynak ayrıntısından düzeltebilirsiniz.', 'The source was added; you can fix the mapping from the source details.'), 'warn');
    } finally { busy = false; render(); }
  }

  function readExcelInputs() {
    const name = host && host.querySelector('#_dmsExcelName'); if (name) excelName = name.value;
    const user = host && host.querySelector('#_dmsExcelUser'); if (user) excelUsername = user.value;
    const password = host && host.querySelector('#_dmsExcelPassword'); if (password) excelPassword = password.value;
  }
  async function chooseWorkbook() {
    clearMessages(); excelProbe = null;
    if (!window.buyerLogDesktop || typeof window.buyerLogDesktop.chooseDatabaseWorkbook !== 'function') {
      say(T('Excel bağlantı keşfi Buyer Log Desktop içinde kullanılabilir.', 'Excel connection discovery is available in Buyer Log Desktop.'), 'bad'); render(); return;
    }
    busy = true; render();
    try {
      const selected = await window.buyerLogDesktop.chooseDatabaseWorkbook();
      if (!selected || selected.cancelled) return;
      if (!selected.ok) throw new Error(T('Excel dosyası seçilemedi.', 'The Excel file could not be selected.'));
      const response = await fetch('/api/data-management/database-discovery/excel', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ path:selected.path, proof:selected.proof }) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(payload.error || T('Excel bağlantıları okunamadı.', 'Excel connections could not be read.'));
      excelDiscovery = payload; excelCandidateId = ''; excelName = ''; excelUsername = ''; excelPassword = ''; excelProbe = null;
      if (!payload.count) say(T('Workbook Connections metadata bulunamadı.', 'No Workbook Connections metadata found.'), 'warn');
    } catch (error) { say(String(error && error.message || error), 'bad'); }
    finally { busy = false; render(); }
  }
  async function testExcelCandidate() {
    readExcelInputs(); const candidate = currentExcelCandidate(); if (!candidate) return;
    busy = true; clearMessages(); excelProbe = null; render();
    try {
      const response = await fetch(`/api/data-management/database-discovery/${encodeURIComponent(excelDiscovery.discoveryId)}/test`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ candidateId:candidate.id, username:excelUsername, password:excelPassword }) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(payload.error || T('Database bağlantısı başarısız.', 'Database connection failed.'));
      excelProbe = payload.probe || {};
    } catch (error) { say(String(error && error.message || error), 'bad'); }
    finally { busy = false; render(); }
  }
  async function addExcelCandidate() {
    readExcelInputs(); const candidate = currentExcelCandidate(); if (!candidate || !excelProbe) return;
    if (!(excelName || candidate.name || '').trim()) { say(T('Kaynağa bir ad verin.', 'Give the source a name.'), 'warn'); render(); return; }
    busy = true; clearMessages(); render();
    try {
      const response = await fetch(`/api/data-management/database-discovery/${encodeURIComponent(excelDiscovery.discoveryId)}/add`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ candidateId:candidate.id, name:(excelName || candidate.name).trim(), username:excelUsername, password:excelPassword }) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(payload.error || T('Database kaynağı eklenemedi.', 'Database source could not be added.'));
      const done = onDone; const warnings = payload.warnings || [];
      close(); if (typeof done === 'function') done(warnings); return;
    } catch (error) { say(String(error && error.message || error), 'bad'); }
    finally { if (host) { busy = false; render(); } }
  }

  function onClick(event) {
    const modeChoice = event.target.closest('[data-creation-mode]');
    if (modeChoice) { creationMode = modeChoice.dataset.creationMode === 'excel' ? 'excel' : 'manual'; clearMessages(); render(); if (creationMode === 'excel') void chooseWorkbook(); return; }
    if (event.target.closest('[data-mode-back]')) { creationMode = ''; excelDiscovery = null; excelCandidateId = ''; clearMessages(); render(); return; }
    if (event.target.closest('[data-pick-workbook]')) { void chooseWorkbook(); return; }
    const excelSelect = event.target.closest('[data-excel-select]');
    if (excelSelect) { excelCandidateId = excelSelect.dataset.excelSelect; const candidate = currentExcelCandidate(); excelName = candidate ? candidate.name : ''; excelUsername = candidate && candidate.authentication ? candidate.authentication.username || '' : ''; excelPassword = ''; excelProbe = null; clearMessages(); render(); return; }
    if (event.target.closest('[data-excel-list-back]')) { readExcelInputs(); excelCandidateId = ''; excelProbe = null; clearMessages(); render(); return; }
    if (event.target.closest('[data-excel-test]')) { void testExcelCandidate(); return; }
    if (event.target.closest('[data-excel-add]')) { void addExcelCandidate(); return; }
    const cancel = event.target.closest('[data-cancel]');
    if (cancel) { close(); return; }

    const profile = event.target.closest('[data-profile]');
    if (profile) {
      readInputs();
      draft.profileId = profile.dataset.profile;
      // Tür değişince önceki modül seçimi geçersiz olabilir.
      const allowed = profileOf(draft.profileId);
      draft.moduleIds = draft.moduleIds.filter(id => allowed && allowed.feedableModules.includes(id));
      render();
      return;
    }

    const back = event.target.closest('[data-back]');
    if (back) { readInputs(); step -= 1; render(); return; }

    const next = event.target.closest('[data-next]');
    if (next) {
      readInputs();
      if (!canAdvance()) return;
      step += 1;
      render();
      return;
    }

    const test = event.target.closest('[data-test]');
    if (test) { readInputs(); void testConnection(); return; }

    const create = event.target.closest('[data-create]');
    if (create) { readInputs(); void createSource(); return; }

    const finish = event.target.closest('[data-finish]');
    if (finish) {
      const done = onDone;
      const warnings = messageTone !== 'info' ? messages.slice() : [];
      close();
      if (typeof done === 'function') done(warnings);
    }
  }

  function onChange(event) {
    const box = event.target.closest('[data-module]');
    if (!box) return;
    const id = box.dataset.module;
    draft.moduleIds = box.checked
      ? [...new Set([...draft.moduleIds, id])]
      : draft.moduleIds.filter(entry => entry !== id);
  }

  function onInput(event) {
    const target = event.target;
    if (!target || !target.id) return;
    if (target.id === '_dmsExcelName') { excelName = target.value; return; }
    if (target.id === '_dmsExcelUser') { excelUsername = target.value; excelProbe = null; return; }
    if (target.id === '_dmsExcelPassword') { excelPassword = target.value; excelProbe = null; return; }
    if (target.id === '_dmsName') { draft.name = target.value; syncNext(); }
    if (target.id === '_dmsServer') { draft.server = target.value; probe = null; syncNext(); }
    if (target.id === '_dmsCatalog') { draft.catalog = target.value; probe = null; syncNext(); }
  }

  /* Yazarken tüm paneli yeniden çizmek imleci kaybettirirdi; yalnız İleri
     düğmesinin durumu güncellenir. */
  function syncNext() {
    const next = host && host.querySelector('[data-next]');
    if (next) next.disabled = busy || !canAdvance();
  }

  /* ---------------------------------------------------------------- */

  function close() {
    if (!host) return;
    host.innerHTML = '';
    host.classList.remove('isOpen');
    host.removeEventListener('click', onClick);
    host.removeEventListener('change', onChange);
    host.removeEventListener('input', onInput);
    host = null;
    draft = null;
    creationMode = ''; excelDiscovery = null; excelCandidateId = ''; excelProbe = null; excelPassword = '';
    busy = false;
  }

  async function open(container, options = {}) {
    close();
    host = container;
    moduleLabels = options.moduleLabels || {};
    onDone = options.onDone || null;
    draft = { name: '', profileId: '', server: '', catalog: '', moduleIds: [], sourceId: '' };
    step = 1; busy = false; clearMessages(); probe = null; mapResult = null;
    creationMode = ''; excelDiscovery = null; excelCandidateId = ''; excelProbe = null; excelName = ''; excelUsername = ''; excelPassword = '';

    host.classList.add('isOpen');
    host.addEventListener('click', onClick);
    host.addEventListener('change', onChange);
    host.addEventListener('input', onInput);
    host.innerHTML = `<p class="dmsHint">${esc(T('Kaynak türleri yükleniyor…', 'Loading source types…'))}</p>`;

    try {
      const response = await fetch('/api/data-management/source-options', { cache: 'no-store' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(payload.error || T('Kaynak türleri okunamadı.', 'Could not read source types.'));
      profiles = (payload.profiles || []).filter(profile => !Array.isArray(profile.creationMethods) || profile.creationMethods.includes('manual'));
    } catch (error) {
      host.innerHTML = `<p class="dmfMessage is-bad">${esc(String(error && error.message || error))}</p>`;
      return;
    }
    render();
  }

  window.BLDataSourceWizard = { open, close };
})();
