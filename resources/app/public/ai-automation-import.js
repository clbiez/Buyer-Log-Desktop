'use strict';

(() => {
  const tr = (trText, enText) => (window.appLang || document.documentElement.lang || 'tr').toLowerCase().startsWith('en') ? enText : trText;
  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
  const api = async (url, options = {}) => {
    const response = await fetch(url, { credentials: 'same-origin', ...options });
    let data = null;
    try { data = await response.json(); } catch (_) {}
    if (!response.ok) {
      const error = new Error(data && data.error || `${tr('İstek başarısız', 'Request failed')} (${response.status})`);
      error.details = data && data.details;
      throw error;
    }
    return data;
  };
  const toast = message => typeof window.showToast === 'function' ? window.showToast(message) : null;

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

  async function analyze(modal) {
    const code = modal.querySelector('[data-ai-code]').value;
    setStatus(modal, tr('Kod analiz ediliyor…', 'Analyzing code…'));
    setDetails(modal, '');
    try {
      const data = await api('/api/automations/ai/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) });
      const parsed = data.parsed || {};
      const validation = data.validation || {};
      const required = (validation.requiredInputs || []).join(', ');
      setStatus(modal, `${tr('Geçerli DSL', 'Valid DSL')} · ${parsed.source || ''} · ${(parsed.actions || []).map(action => action.type).join(', ') || tr('action yok', 'no actions')}${required ? ` · ${tr('Eksik seçim', 'Input needed')}: ${required}` : ''}`, 'success');
      setDetails(modal, { name: parsed.name, trigger: parsed.trigger, source: parsed.source, fields: validation.resolvedFields, requiredInputs: validation.requiredInputs, capabilityHash: validation.capabilityHash });
      modal.dataset.aiAnalyzed = '1';
      modal.querySelector('[data-ai-preview]').disabled = false;
      modal.querySelector('[data-ai-import]').disabled = false;
      modal.querySelector('[data-ai-group-wrap]').hidden = !(validation.requiredInputs || []).includes('EMAIL_GROUP');
      return data;
    } catch (error) {
      modal.dataset.aiAnalyzed = '0';
      modal.querySelector('[data-ai-preview]').disabled = true;
      modal.querySelector('[data-ai-import]').disabled = true;
      setStatus(modal, error.message, 'error');
      setDetails(modal, error.details || '');
      return null;
    }
  }

  async function preview(modal) {
    if (modal.dataset.aiAnalyzed !== '1') return analyze(modal);
    const code = modal.querySelector('[data-ai-code]').value;
    setStatus(modal, tr('Kaynak veride ön izleme çalışıyor…', 'Running a source preview…'));
    try {
      const data = await api('/api/automations/ai/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) });
      setStatus(modal, `${tr('Ön izleme hazır', 'Preview ready')} · ${data.preview && data.preview.matched || 0} / ${data.preview && data.preview.total || 0} ${tr('satır eşleşti', 'rows matched')}`, 'success');
      setDetails(modal, data.preview || {});
    } catch (error) {
      setStatus(modal, error.message, 'error');
      setDetails(modal, error.details || '');
    }
  }

  async function importDraft(modal) {
    if (modal.dataset.aiAnalyzed !== '1') return analyze(modal);
    const code = modal.querySelector('[data-ai-code]').value;
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

  function openModal() {
    document.getElementById('_aiAutomationImport')?.remove();
    const modal = document.createElement('div');
    modal.id = '_aiAutomationImport';
    modal.className = 'autoModalOverlay aiAutomationModal';
    modal.innerHTML = `<div class="autoModal aiAutomationDialog"><header><div><span class="autoEyebrow">BUYER LOG · AI AUTOMATION</span><h3>${esc(tr('AI ile otomasyon taslağı oluştur', 'Create an automation draft with AI'))}</h3><p>${esc(tr('Yalnızca Buyer Log Automation Code kabul edilir. Analiz ve ön izleme hiçbir action çalıştırmaz; içe aktarma kapalı bir taslak oluşturur.', 'Only Buyer Log Automation Code is accepted. Analyze and preview execute no actions; import creates a disabled draft.'))}</p></div><button type="button" data-ai-close>×</button></header><div class="autoModalBody aiAutomationBody"><label class="autoField"><span>${esc(tr('Buyer Log Automation Code', 'Buyer Log Automation Code'))}</span><textarea data-ai-code rows="18" spellcheck="false" placeholder="BUYERLOG_AUTOMATION 1.0\nNAME &quot;Production Risk&quot;\n…"></textarea></label><div class="aiAutomationActions"><button class="tbtn" type="button" data-ai-guide>${esc(tr('Güncel AI Guide indir', 'Download current AI Guide'))}</button><button class="tbtn" type="button" data-ai-analyze>${esc(tr('Analiz et', 'Analyze'))}</button><button class="tbtn" type="button" data-ai-preview disabled>${esc(tr('Ön izleme', 'Preview'))}</button><button class="tbtn primary" type="button" data-ai-import disabled>${esc(tr('Kapalı taslak oluştur', 'Create disabled draft'))}</button></div><div data-ai-group-wrap hidden><label class="autoField"><span>${esc(tr('Eksik seçim: E-posta grubu', 'Required choice: Email group'))}</span><select data-ai-email-group></select></label></div><div data-ai-status class="aiAutomationStatus"></div><pre data-ai-details class="aiAutomationDetails"></pre></div><footer><button class="tbtn" type="button" data-ai-close>${esc(tr('Kapat', 'Close'))}</button></footer></div>`;
    document.body.appendChild(modal);
    modal.querySelectorAll('[data-ai-close]').forEach(button => { button.onclick = () => modal.remove(); });
    modal.onclick = event => { if (event.target === modal) modal.remove(); };
    modal.querySelector('[data-ai-guide]').onclick = () => downloadGuide(modal);
    modal.querySelector('[data-ai-analyze]').onclick = () => analyze(modal);
    modal.querySelector('[data-ai-preview]').onclick = () => preview(modal);
    modal.querySelector('[data-ai-import]').onclick = () => importDraft(modal);
    modal.querySelector('[data-ai-code]').addEventListener('input', () => {
      modal.dataset.aiAnalyzed = '0';
      modal.querySelector('[data-ai-preview]').disabled = true;
      modal.querySelector('[data-ai-import]').disabled = true;
      setStatus(modal, '');
      setDetails(modal, '');
    });
    loadGroups(modal);
    modal.querySelector('[data-ai-code]').focus();
  }

  function install() {
    const host = document.getElementById('automationStudio');
    const actions = host && host.querySelector('.autoHeaderActions');
    if (!actions || actions.querySelector('[data-ai-automation-import]')) return Boolean(actions);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'tbtn';
    button.dataset.aiAutomationImport = '1';
    button.textContent = tr('✦ AI ile oluştur', '✦ Create with AI');
    button.title = tr('Buyer Log Automation Code analiz et ve güvenli taslak oluştur', 'Analyze Buyer Log Automation Code and create a safe draft');
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
})();
