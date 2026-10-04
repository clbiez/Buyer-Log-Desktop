'use strict';

/* v7.175 — AI İLE OTOMASYON YAZ

   Kullanıcı talebi: "Otomasyon alanı da buna benzer kolaylıkta olsun, acemiler
   bile kolaylıkla kullanabilsin." Hesaplanan sütundaki "AI ile yaz" akışının
   otomasyon karşılığı:

     1) Kullanıcı ne istediğini kendi cümlesiyle yazar ve veriyi seçer.
     2) "AI yönergesini kopyala": kurallar + sözlük + seçilen kaynağın alan
        ADLARI + istek tek metinde (public/automation-assistant.js). Satır
        değeri, e-posta adresi ya da grup adı EKLENMEZ.
     3) AI'ın cevabı olduğu gibi yapıştırılır: kod bloğu ayıklanır, anlamı
        değiştirmeyen düzeltmeler (kıvrık tırnak, sürüm satırı) uygulanır ve
        sunucu denetler. Hatalar düz dille ve öneriyle ("Bunu mu demek
        istediniz: [Üretici]?") gösterilir.

   Güvence değişmedi: denetim ve önizleme hiçbir eylem çalıştırmaz, içe aktarma
   KAPALI bir taslak oluşturur; yetkili doğrulama sunucudadır
   (server/lib/automation-language.js). */
(() => {
  const tr = (trText, enText) => (window.appLang || document.documentElement.lang || 'tr').toLowerCase().startsWith('en') ? enText : trText;
  const lang = () => tr('tr', 'en');
  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
  const assistant = () => window.BLAutomationAssistant || null;
  const api = async (url, options = {}) => {
    const response = await fetch(url, { credentials: 'same-origin', ...options });
    let data = null;
    try { data = await response.json(); } catch (_) {}
    if (!response.ok) {
      const error = new Error(data && data.error || `${tr('İstek başarısız', 'Request failed')} (${response.status})`);
      error.details = data && data.details;
      error.code = data && data.code;
      throw error;
    }
    return data;
  };
  const toast = message => typeof window.showToast === 'function' ? window.showToast(message) : null;

  let capabilityModel = null;
  async function loadModel() {
    if (capabilityModel) return capabilityModel;
    const data = await api('/api/automations/ai/capabilities');
    capabilityModel = data && data.model || null;
    return capabilityModel;
  }

  function setStatus(modal, message, kind = '') {
    const target = modal.querySelector('[data-ai-status]');
    if (!target) return;
    target.className = `aiAutomationStatus ${kind}`;
    target.textContent = message || '';
  }

  function setDetails(modal, value) {
    const target = modal.querySelector('[data-ai-details]');
    if (!target) return;
    target.textContent = typeof value === 'string' ? value : JSON.stringify(value || {}, null, 2);
    const wrap = target.closest('details');
    if (wrap) wrap.hidden = !target.textContent.trim();
  }

  function populateGroups(modal, groups) {
    const select = modal.querySelector('[data-ai-email-group]');
    if (!select) return;
    select.textContent = '';
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = tr('E-posta grubu seçin', 'Choose an email group');
    select.appendChild(placeholder);
    (Array.isArray(groups) ? groups : []).forEach(group => {
      const option = document.createElement('option');
      option.value = String(group.id || '');
      option.textContent = `${group.name || group.id || ''}${group.to && group.to.length ? ` · ${group.to.join('; ')}` : ''}`;
      select.appendChild(option);
    });
  }

  async function loadGroups(modal) {
    try {
      const state = await api('/api/automations');
      populateGroups(modal, state.emailGroups || []);
    } catch (error) {
      setStatus(modal, error.message, 'error');
    }
  }

  /* Yapıştırılan cevaptan denetlenecek kod: ayıklanmış + düzeltilmiş. */
  function preparedCode(modal) {
    const raw = modal.querySelector('[data-ai-code]').value;
    const A = assistant();
    if (!A) return { code: raw, fixes: [], extracted: raw };
    const extracted = A.extractAutomationCode(raw);
    const fixed = A.autoFixCode(extracted, { version: capabilityModel && capabilityModel.automationLanguageVersion });
    return { code: fixed.code, fixes: fixed.fixes, extracted };
  }
  const sourceOf = code => { const match = /^\s*SOURCE\s+"?([A-Za-z_]+)"?/im.exec(code || ''); return match ? match[1].toLowerCase() : ''; };

  function renderIssues(modal, messages, code) {
    const host = modal.querySelector('[data-ai-issues]');
    if (!host) return;
    const A = assistant();
    const source = sourceOf(code) || modal.querySelector('[data-ai-source]')?.value || '';
    const list = (messages || []).filter(Boolean).map(message => (A ? A.explainDslError(message, { model: capabilityModel, source }) : { tr: message, en: message }));
    host.innerHTML = list.length ? `<ul class="fcIssues aiIssues">${list.map(item => `<li class="fcIssue is-error"><span class="fcIssueIcon" aria-hidden="true">✕</span><span><b>${esc(tr(item.tr, item.en))}</b>${tr(item.hintTr, item.hintEn) ? `<br>${esc(tr(item.hintTr, item.hintEn))}` : ''}${item.field && item.suggestion ? ` <button type="button" class="autoMiniBtn" data-ai-fix-field="${esc(item.field)}" data-ai-fix-to="${esc(item.suggestion)}">${esc(tr(`[${item.suggestion}] yap`, `Use [${item.suggestion}]`))}</button>` : ''}</span></li>`).join('')}</ul><p class="aiNote">${esc(tr('İsterseniz hatayı AI’a da söyleyin: yukarıdaki mesajı kopyalayıp “bunu düzelt” deyin ve yeni cevabı buraya yapıştırın.', 'You can also tell the AI: copy the message above, say “fix this” and paste the new answer here.'))}</p>` : '';
    host.querySelectorAll('[data-ai-fix-field]').forEach(button => {
      button.onclick = () => {
        const field = modal.querySelector('[data-ai-code]');
        const from = button.dataset.aiFixField, to = button.dataset.aiFixTo;
        const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        field.value = preparedCode(modal).code.replace(new RegExp(`\\[\\s*${escaped}\\s*\\]`, 'gi'), `[${to}]`);
        analyze(modal);
      };
    });
  }

  function renderFound(modal, prepared) {
    const host = modal.querySelector('[data-ai-found]');
    if (!host) return;
    const raw = modal.querySelector('[data-ai-code]').value.trim();
    const changed = prepared.code && prepared.code !== raw;
    host.innerHTML = changed || prepared.fixes.length
      ? `<div class="aiFound">${prepared.extracted !== raw ? `<span>${esc(tr('Cevabın içinden kod ayıklandı; açıklama metni yok sayıldı.', 'The code was extracted from the answer; the explanation text was ignored.'))}</span>` : ''}${prepared.fixes.map(item => `<span>✓ ${esc(tr(item.tr, item.en))}</span>`).join('')}</div>`
      : '';
  }

  async function analyze(modal) {
    const prepared = preparedCode(modal);
    renderFound(modal, prepared);
    if (!prepared.code.trim()) {
      setStatus(modal, tr('Önce AI’ın cevabını 3. adıma yapıştırın.', 'First paste the AI’s answer into step 3.'), 'error');
      renderIssues(modal, [], '');
      return null;
    }
    setStatus(modal, tr('Kod denetleniyor…', 'Checking the code…'));
    setDetails(modal, '');
    try {
      await loadModel().catch(() => null);
      const data = await api('/api/automations/ai/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: prepared.code }) });
      const parsed = data.parsed || {};
      const validation = data.validation || {};
      const required = validation.requiredInputs || [];
      const actions = (parsed.actions || []).map(action => action.type).join(', ') || tr('eylem yok', 'no actions');
      setStatus(modal, `✓ ${tr('Kod geçerli', 'The code is valid')} · ${parsed.name || ''} · ${tr('Veri', 'Data')}: ${parsed.source || ''} · ${(parsed.conditions || []).length} ${tr('koşul', 'condition(s)')} · ${actions}${required.includes('EMAIL_GROUP') ? ` · ${tr('Aşağıdan e-posta grubunu seçin', 'Choose the email group below')}` : ''}`, 'success');
      renderIssues(modal, [], prepared.code);
      setDetails(modal, { name: parsed.name, trigger: parsed.trigger, source: parsed.source, fields: validation.resolvedFields, requiredInputs: validation.requiredInputs, capabilityHash: validation.capabilityHash });
      modal.dataset.aiAnalyzed = '1';
      modal.dataset.aiCode = prepared.code;
      modal.querySelector('[data-ai-preview]').disabled = false;
      modal.querySelector('[data-ai-import]').disabled = false;
      modal.querySelector('[data-ai-group-wrap]').hidden = !required.includes('EMAIL_GROUP');
      return data;
    } catch (error) {
      modal.dataset.aiAnalyzed = '0';
      modal.querySelector('[data-ai-preview]').disabled = true;
      modal.querySelector('[data-ai-import]').disabled = true;
      const errors = error.details && error.details.validation && Array.isArray(error.details.validation.errors) ? error.details.validation.errors : [error.message];
      setStatus(modal, tr(`Kodda ${errors.length} sorun var:`, `The code has ${errors.length} problem(s):`), 'error');
      renderIssues(modal, errors, prepared.code);
      setDetails(modal, error.details || '');
      return null;
    }
  }

  function previewTableHtml(preview) {
    const sample = Array.isArray(preview && preview.sample) ? preview.sample : [];
    if (!sample.length) return '';
    const columns = [...new Set(sample.flatMap(row => Object.keys(row || {})))].filter(key => key && !key.startsWith('_')).slice(0, 7);
    return `<div class="autoPreviewTableWrap"><table class="autoPreviewTable"><thead><tr>${columns.map(key => `<th>${esc(key)}</th>`).join('')}</tr></thead><tbody>${sample.slice(0, 8).map(row => `<tr>${columns.map(key => `<td>${esc(row && row[key] == null ? '' : row[key])}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  }

  async function preview(modal) {
    if (modal.dataset.aiAnalyzed !== '1') return analyze(modal);
    setStatus(modal, tr('Gerçek veride deneniyor (hiçbir şey gönderilmez)…', 'Trying on real data (nothing is sent)…'));
    try {
      const data = await api('/api/automations/ai/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: modal.dataset.aiCode || preparedCode(modal).code }) });
      const result = data.preview || {};
      setStatus(modal, `${tr('Ön izleme hazır', 'Preview ready')} · ${result.matched || 0} / ${result.total || 0} ${tr('satır eşleşti', 'rows matched')}${result.matched ? '' : ` — ${tr('hiç kayıt eşleşmedi; koşul değerlerini kontrol edin.', 'no record matched; check the condition values.')}`}`, result.matched ? 'success' : 'error');
      const host = modal.querySelector('[data-ai-preview-table]');
      if (host) host.innerHTML = previewTableHtml(result);
      setDetails(modal, result);
    } catch (error) {
      setStatus(modal, error.message, 'error');
      setDetails(modal, error.details || '');
    }
  }

  async function importDraft(modal) {
    if (modal.dataset.aiAnalyzed !== '1') return analyze(modal);
    const code = modal.dataset.aiCode || preparedCode(modal).code;
    const emailGroupId = modal.querySelector('[data-ai-email-group]').value;
    setStatus(modal, tr('Güvenli taslak oluşturuluyor…', 'Creating a safe draft…'));
    try {
      const data = await api('/api/automations/ai/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, resolutions: { emailGroupId } }) });
      modal.remove();
      toast(tr('AI otomasyon taslağı oluşturuldu. Otomasyonlar ekranında inceleyip etkinleştirin.', 'AI automation draft created. Review and enable it in Automations.'));
      window.dispatchEvent(new CustomEvent('buyerlog:automation-ai-imported', { detail: data.recipe || null }));
    } catch (error) {
      setStatus(modal, error.message, 'error');
      setDetails(modal, error.details || '');
    }
  }

  async function downloadGuide(modal) {
    try {
      const response = await fetch('/api/automations/ai/guide', { credentials: 'same-origin' });
      if (!response.ok) throw new Error(tr('AI Guide indirilemedi.', 'AI Guide could not be downloaded.'));
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'Buyer-Log-AI-Guide.md';
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setStatus(modal, tr('Güncel AI Guide indirildi.', 'Current AI Guide downloaded.'), 'success');
    } catch (error) { setStatus(modal, error.message, 'error'); }
  }

  function promptText(modal) {
    const A = assistant();
    if (!A) return '';
    return A.buildAutomationPrompt({
      lang: lang(),
      model: capabilityModel || {},
      source: modal.querySelector('[data-ai-source]').value,
      request: modal.querySelector('[data-ai-request]').value,
    });
  }
  function renderPrompt(modal) {
    const box = modal.querySelector('[data-ai-prompt]');
    if (box) box.textContent = promptText(modal);
  }
  async function copyPrompt(modal) {
    const text = promptText(modal);
    let ok = false;
    try { await navigator.clipboard.writeText(text); ok = true; } catch (_) {
      const area = document.createElement('textarea');
      area.value = text; area.style.position = 'fixed'; area.style.opacity = '0';
      document.body.appendChild(area); area.select();
      try { ok = document.execCommand('copy'); } catch (__) { ok = false; }
      area.remove();
    }
    toast(ok
      ? tr('AI yönergesi kopyalandı. AI aracınıza yapıştırın, cevabı 3. adıma geri getirin.', 'AI instructions copied. Paste them into your AI tool and bring the answer back to step 3.')
      : tr('Kopyalanamadı; “Yönergeyi göster”den seçip kopyalayın.', 'Could not copy; select it under “Show instructions” and copy.'));
  }

  /* ---- Automation Code sözlüğü ---- */
  function dictionaryHtml(modal) {
    const A = assistant();
    if (!A) return '';
    const source = modal ? modal.querySelector('[data-ai-source]')?.value : '';
    const fields = A.fieldsForSource(capabilityModel || {}, source || 'cp');
    const item = (syntax, text) => `<div class="fcDictItem" data-ai-dict-item="${esc(`${syntax} ${text}`.toLocaleLowerCase('tr-TR'))}"><div class="fcDictTop"><code>${esc(syntax)}</code></div><div class="fcDictText">${esc(text)}</div></div>`;
    return `<input type="search" class="fcDictSearch" data-ai-dict-search placeholder="${esc(tr('Ara: tarih, e-posta, içerir, haftalık…', 'Search: date, email, contains, weekly…'))}" autocomplete="off">
      <div class="fcDictGroup"><div class="fcDictHead">${esc(tr('Nasıl çalışır?', 'How does it work?'))}</div><ol class="fcRules">${A.DSL_RULES.map(rule => `<li>${esc(tr(rule.tr, rule.en))}</li>`).join('')}</ol></div>
      <div class="fcDictGroup"><div class="fcDictHead">${esc(tr('Tam örnek', 'Complete example'))}</div><pre class="aiDictExample">${esc(A.dslExample ? A.dslExample(lang()) : A.DSL_EXAMPLE)}</pre></div>
      ${A.DSL_DICTIONARY.map(section => `<div class="fcDictGroup"><div class="fcDictHead">${esc(tr(section.tr, section.en))}</div>${section.items.map(entry => item(A.dslSyntax ? A.dslSyntax(entry, lang()) : entry.syntax, tr(entry.tr, entry.en))).join('')}</div>`).join('')}
      <div class="fcDictGroup"><div class="fcDictHead">${esc(tr(`Alanlar — ${source || 'cp'}`, `Fields — ${source || 'cp'}`))}</div>${fields.length ? fields.map(field => item(`[${(field.label && (lang() === 'en' ? field.label.en : field.label.tr)) || field.id}]`, `${field.type || ''} · id: ${field.id}`)).join('') : `<p class="aiNote">${esc(tr('Alan listesi yüklenemedi.', 'The field list could not be loaded.'))}</p>`}</div>`;
  }
  function renderDictionary(modal) {
    const host = modal.querySelector('[data-ai-dict]');
    if (host) host.innerHTML = dictionaryHtml(modal);
  }

  function openModal() {
    document.getElementById('_aiAutomationImport')?.remove();
    const modal = document.createElement('div');
    modal.id = '_aiAutomationImport';
    modal.className = 'autoModalOverlay aiAutomationModal';
    const datasets = [['cp', 'CP Tracker'], ['orders', tr('Siparişler', 'Orders')], ['backlog', 'Backlog'], ['lfl', 'LFL'], ['collection', tr('Koleksiyon', 'Collection')], ['asas', 'ASAS'], ['ias', 'IAS / Antrepo'], ['intake', 'INTAKE']];
    modal.innerHTML = `<div class="autoModal aiAutomationDialog"><header><div><span class="autoEyebrow">BUYER LOG · LCW AI</span><h3>${esc(tr('LCW AI’dan Destek Al · Otomasyon', 'Get help from LCW AI · Automation'))}</h3><p>${esc(tr('Otomasyonu kendi cümlenizle anlatın; LCW AI yazsın, Buyer Log denetlesin. Denetim ve ön izleme hiçbir eylem çalıştırmaz; içe aktarma KAPALI bir taslak oluşturur.', 'Describe the automation in your own words; LCW AI writes it and Buyer Log checks it. Checking and preview run no actions; import creates a DISABLED draft.'))}</p></div><button type="button" data-ai-close>×</button></header>
      <div class="autoModalBody aiAutomationBody">
        <ol class="aiSteps">
          <li><b>${esc(tr('Hangi veri üzerinde?', 'On which data?'))}</b>
            <label class="autoField"><select data-ai-source aria-label="${esc(tr('Hangi veri üzerinde?', 'On which data?'))}">${datasets.map(([id, label]) => `<option value="${id}">${esc(label)}</option>`).join('')}</select></label>
          </li>
          <li><div data-ai-lcwai-host></div></li>
          <li><b>${esc(tr('Otomasyon kodu (LCW AI’dan uygulanan ya da yapıştırılan)', 'Automation code (applied from LCW AI or pasted)'))}</b>
            <textarea data-ai-code rows="10" spellcheck="false" placeholder="${esc(tr('LCW AI önerisini uygulayın ya da başka bir AI aracının cevabını buraya yapıştırın; kod kendiliğinden bulunur ve denetlenir.', 'Apply the LCW AI suggestion or paste another AI tool’s answer here; the code is found and checked automatically.'))}"></textarea>
            <div data-ai-found></div>
            <div data-ai-status class="aiAutomationStatus" aria-live="polite"></div>
            <div data-ai-issues></div>
            <div data-ai-group-wrap hidden><label class="autoField"><span>${esc(tr('Eksik seçim: E-posta grubu', 'Required choice: Email group'))}</span><select data-ai-email-group></select></label></div>
            <div data-ai-preview-table></div>
            <details class="aiTech" hidden><summary>${esc(tr('Teknik ayrıntı', 'Technical details'))}</summary><pre data-ai-details class="aiAutomationDetails"></pre></details>
          </li>
        </ol>
        <details class="lcwaiManual"><summary>${esc(tr('Manuel yol: yönergeyi başka bir AI aracına verin', 'Manual route: give the instructions to another AI tool'))}</summary>
          <ol class="aiSteps">
            <li><b>${esc(tr('Ne istediğinizi yazın', 'Describe what you want'))}</b>
              <textarea data-ai-request rows="3" placeholder="${esc(tr('Örn. Her pazartesi 09:00’da Ex-factory’sine 7 günden az kalan ve durumu “Yüklendi” olmayan siparişleri e-postayla gönder.', 'e.g. Every Monday at 09:00 email the orders whose ex-factory is within 7 days and whose status is not “Loaded”.'))}"></textarea>
            </li>
            <li><b>${esc(tr('Yönergeyi kopyalayıp kullandığınız AI aracına yapıştırın; cevabı yukarıdaki kod kutusuna getirin', 'Copy the instructions into your AI tool and bring the answer back to the code box above'))}</b>
              <div class="aiAutomationActions"><button class="tbtn" type="button" data-ai-copy>${esc(tr('AI yönergesini kopyala', 'Copy AI instructions'))}</button><button class="tbtn" type="button" data-ai-guide>${esc(tr('Güncel AI Guide indir', 'Download current AI Guide'))}</button></div>
              <details class="aiPromptWrap"><summary>${esc(tr('Yönergeyi göster', 'Show instructions'))}</summary><pre class="aiPrompt" data-ai-prompt></pre></details>
              <p class="aiNote">${esc(tr('Yönerge dilin kurallarını, sözlüğü ve seçtiğiniz verinin yalnız alan ADLARINI içerir; hiçbir sipariş, fiyat, tedarikçi ya da e-posta adresi eklenmez. Şirketinizin izin verdiği bir AI aracını kullanın.', 'The instructions contain the language rules, the dictionary and only the field NAMES of the chosen data; no order, price, supplier or email address is included. Use an AI tool your company allows.'))}</p>
            </li>
          </ol>
        </details>
        <details class="fcDict aiDict"><summary>${esc(tr('📖 Automation Code sözlüğü — kurallar, örnekler, alan listesi', '📖 Automation Code dictionary — rules, examples, field list'))}</summary><div data-ai-dict></div></details>
      </div>
      <footer><button class="tbtn" type="button" data-ai-close>${esc(tr('Kapat', 'Close'))}</button><span style="flex:1"></span><button class="tbtn" type="button" data-ai-analyze>${esc(tr('Denetle', 'Check'))}</button><button class="tbtn" type="button" data-ai-preview disabled>${esc(tr('Veride dene', 'Try on data'))}</button><button class="tbtn primary" type="button" data-ai-import disabled>${esc(tr('Kapalı taslak oluştur', 'Create disabled draft'))}</button></footer></div>`;
    document.body.appendChild(modal);
    modal.querySelectorAll('[data-ai-close]').forEach(button => { button.onclick = () => modal.remove(); });
    modal.onclick = event => { if (event.target === modal) modal.remove(); };
    modal.querySelector('[data-ai-guide]').onclick = () => downloadGuide(modal);
    modal.querySelector('[data-ai-copy]').onclick = () => copyPrompt(modal);
    modal.querySelector('[data-ai-analyze]').onclick = () => analyze(modal);
    modal.querySelector('[data-ai-preview]').onclick = () => preview(modal);
    modal.querySelector('[data-ai-import]').onclick = () => importDraft(modal);
    modal.querySelector('[data-ai-request]').addEventListener('input', () => renderPrompt(modal));
    modal.querySelector('[data-ai-source]').addEventListener('change', () => { renderPrompt(modal); renderDictionary(modal); });
    let timer = null;
    modal.querySelector('[data-ai-code]').addEventListener('input', () => {
      modal.dataset.aiAnalyzed = '0';
      modal.querySelector('[data-ai-preview]').disabled = true;
      modal.querySelector('[data-ai-import]').disabled = true;
      const table = modal.querySelector('[data-ai-preview-table]');
      if (table) table.innerHTML = '';
      setStatus(modal, '');
      setDetails(modal, '');
      clearTimeout(timer);
      // Yapıştırınca kendiliğinden denetlenir; her tuşta sunucuya gidilmez.
      timer = setTimeout(() => { if (modal.isConnected && modal.querySelector('[data-ai-code]').value.trim()) analyze(modal); }, 700);
    });
    modal.addEventListener('input', event => {
      if (!event.target.matches('[data-ai-dict-search]')) return;
      const query = event.target.value.trim().toLocaleLowerCase('tr-TR');
      modal.querySelectorAll('[data-ai-dict-item]').forEach(item => { item.hidden = Boolean(query) && !item.dataset.aiDictItem.includes(query); });
    });
    loadGroups(modal);
    loadModel().then(() => { renderPrompt(modal); renderDictionary(modal); }).catch(error => { setStatus(modal, error.message, 'error'); renderPrompt(modal); renderDictionary(modal); });
    renderPrompt(modal);
    renderDictionary(modal);
    mountLcwAi(modal);
  }

  /* LCW AI ortak paneli (public/lcwai-assistant.js). Bağlam: seçilen veri,
     o verinin alanları, izinli tetikleyiciler ve eylemler; rehber, manuel
     yolun kullandığı aynı Automation Code yönergesidir. "Uygula" kodu
     yukarıdaki kutuya koyar ve sunucudaki mevcut denetimi başlatır; taslak
     yine "Kapalı taslak oluştur" ile, kullanıcı onayıyla oluşur. */
  function mountLcwAi(modal) {
    const host = modal.querySelector('[data-ai-lcwai-host]');
    const mount = AI => {
      if (!AI || !host || !host.isConnected) { modal.querySelector('[data-ai-request]')?.focus(); return; }
      const manual = modal.querySelector('[data-ai-request]');
      AI.mountAssistant(host, {
        source: 'automations',
        placeholder: { tr: 'Örn. MB’ye 10 gün kala bana bildirim oluştur.', en: 'e.g. Notify me 10 days before MB.' },
        onRequestChange: text => { if (manual) { manual.value = text; renderPrompt(modal); } },
        buildRequest: async text => {
          await loadModel().catch(() => null);
          const source = modal.querySelector('[data-ai-source]').value;
          const A = assistant();
          const model = capabilityModel || {};
          return {
            task: text,
            guide: A ? A.buildAutomationPrompt({ lang: lang(), model, source, request: text }) : '',
            context: {
              dataset: source,
              availableFields: (A ? A.fieldsForSource(model, source) : []).slice(0, 300).map(field => ({ name: (field.label && (lang() === 'en' ? field.label.en : field.label.tr)) || field.id, id: field.id, type: field.type || '' })),
              availableTriggers: (model.triggers || []).map(item => ({ id: item.id, parameters: item.parameters || [] })),
              availableActions: (model.actions || []).map(item => ({ id: item.id, parameters: item.parameters || [] })),
              automationLanguageVersion: model.automationLanguageVersion || '',
            },
          };
        },
        interpret: async result => {
          const A = assistant();
          const picked = AI.pickField(result, 'code', text => (A ? A.extractAutomationCode(text) : text));
          if (!picked.value) return { ok: false, issues: [tr('LCW AI bir otomasyon kodu önermedi. İsteği netleştirip tekrar deneyin.', 'LCW AI did not suggest automation code. Clarify the request and try again.')] };
          const code = A ? A.autoFixCode(A.extractAutomationCode(picked.value), { version: capabilityModel && capabilityModel.automationLanguageVersion }).code : picked.value;
          try {
            const data = await api('/api/automations/ai/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) });
            const parsed = data.parsed || {};
            const actions = (parsed.actions || []).map(action => action.type).join(', ') || tr('eylem yok', 'no actions');
            return { ok: true, value: code, html: `<pre>${esc(code)}</pre><div class="lcwaiResultLine is-ok"><span>${esc(tr('Denetim', 'Check'))}</span>✓ ${esc(`${tr('Kod geçerli', 'The code is valid')} · ${parsed.name || ''} · ${tr('Veri', 'Data')}: ${parsed.source || ''} · ${(parsed.conditions || []).length} ${tr('koşul', 'condition(s)')} · ${actions}`)}</div>` };
          } catch (error) {
            const errors = error.details && error.details.validation && Array.isArray(error.details.validation.errors) ? error.details.validation.errors : [error.message];
            const explained = errors.filter(Boolean).slice(0, 6).map(message => { const item = A ? A.explainDslError(message, { model: capabilityModel, source: sourceOf(code) }) : { tr: message, en: message }; return tr(item.tr, item.en); });
            return { ok: false, value: code, html: `<pre>${esc(code)}</pre>`, issues: explained };
          }
        },
        applyLabel: { tr: 'Uygula ve denetle', en: 'Apply and check' },
        onApply: code => {
          const field = modal.querySelector('[data-ai-code]');
          field.value = code;
          analyze(modal);
        },
      });
      host.querySelector('[data-lcwai-request]')?.focus();
    };
    if (window.BuyerLogAI) mount(window.BuyerLogAI);
    else Promise.resolve(window.BLPerf?._loadScript?.('lcwai-assistant.js?rev=1')).catch(() => null).then(() => mount(window.BuyerLogAI || null));
  }

  function install() {
    const host = document.getElementById('automationStudio');
    const actions = host && host.querySelector('.autoHeaderActions');
    if (!actions || actions.querySelector('[data-ai-automation-import]')) return Boolean(actions);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'tbtn';
    button.dataset.aiAutomationImport = '1';
    button.textContent = tr('✦ LCW AI’dan Destek Al', '✦ Get help from LCW AI');
    button.title = tr('Ne istediğinizi yazın, LCW AI (GPT-6 Sol) yazsın, Buyer Log denetleyip kapalı bir taslak oluştursun', 'Describe it, let LCW AI (GPT-6 Sol) write it, Buyer Log checks it and creates a disabled draft');
    button.onclick = openModal;
    actions.insertBefore(button, actions.firstChild);
    return true;
  }

  function init() {
    if (install()) return;
    let settled = false;
    const settle = () => {
      if (settled) return true;
      settled = install();
      if (settled) {
        observer?.disconnect();
        clearInterval(timer);
      }
      return settled;
    };
    const observer = typeof MutationObserver === 'function'
      ? new MutationObserver(settle)
      : null;
    observer?.observe(document.body, { childList: true, subtree: true });
    let attempts = 0;
    const timer = setInterval(() => {
      attempts += 1;
      if (settle() || attempts > 600) {
        clearInterval(timer);
        observer?.disconnect();
      }
    }, 50);
  }

  window.initAiAutomationImport = init;
  window.BLAiAutomationImport = { open: openModal };
})();
