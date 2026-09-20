'use strict';

// Buyer Log v7.57 — versioned, streamed user/full backup UI.
function buyerLogBackupTr(tr, en) { return typeof appLang !== 'undefined' && appLang === 'en' ? en : tr; }
function buyerLogRestoreBytes(value) {
  const bytes = Math.max(0, Number(value) || 0), units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let amount = bytes, unit = 0; while (amount >= 1024 && unit < units.length - 1) { amount /= 1024; unit += 1; }
  return `${amount >= 100 || unit === 0 ? Math.round(amount) : amount.toFixed(1)} ${units[unit]}`;
}
function buyerLogBrowserStorageSnapshot() {
  const out = {}, profile = window.BL_USER_CONTEXT || {}, uid = String(profile.id || 'anonymous').replace(/[^A-Za-z0-9_-]/g, '_');
  const prefix = `bl.user.${uid}.`, storage = window.BLStorage && window.BLStorage.native || window.localStorage;
  for (let index = 0; storage && index < storage.length; index++) {
    const key = storage.key(index); if (key && key.startsWith(prefix)) out[key] = storage.getItem(key);
  }
  return out;
}
function buyerLogBackupModal() {
  document.getElementById('_buyerLogBackupModal')?.remove();
  const moderator = Boolean(window.BLIsModerator && window.BLIsModerator());
  const stages = ['Hazırlanıyor', 'Veriler', 'Ayarlar', 'Doğrulanıyor', 'Tamamlandı'];
  const labels = typeof appLang !== 'undefined' && appLang === 'en' ? ['Preparing', 'Data', 'Settings', 'Validating', 'Completed'] : stages;
  const modal = document.createElement('div'); modal.id = '_buyerLogBackupModal'; modal.className = 'warnOverlay';
  modal.innerHTML = `<div class="modalCard backupCard" role="dialog" aria-modal="true" aria-labelledby="_backupTitle">
    <div class="backupHead"><div><div class="modalTitle" id="_backupTitle">Backup</div><div class="backupIntro">${buyerLogBackupTr('Kişisel verilerinizi ve ayarlarınızı güvenli, sürümlü tek bir ZIP dosyasında indirin.','Download your personal data and settings as one secure, versioned ZIP file.')}</div></div><button class="pricingRuleIconBtn _backupClose" aria-label="${buyerLogBackupTr('Kapat','Close')}"><svg class="ic"><use href="#i-x"/></svg></button></div>
    <div class="backupBody"><div class="backupActions"><button class="navActionBtn" data-backup-mode="user"><svg class="ic"><use href="#i-download"/></svg><span>${buyerLogBackupTr('Verilerimi Yedekle','Back Up My Data')}</span></button>${moderator ? `<button class="tbtn" data-backup-mode="full"><svg class="ic"><use href="#i-database-import"/></svg><span>${buyerLogBackupTr('Tam Sistem Yedeği','Full System Backup')}</span></button><button class="tbtn" data-backup-restore><svg class="ic"><use href="#i-upload"/></svg><span>${buyerLogBackupTr('Full System Restore','Full System Restore')}</span></button>` : ''}</div>
    ${moderator ? `<div class="backupRestorePanel" data-restore-panel hidden><label class="backupFilePicker">${buyerLogBackupTr('Full System Backup ZIP seçin','Choose a Full System Backup ZIP')}<input type="file" data-restore-file accept=".zip,application/zip"/></label><div class="backupRestoreActions"><button class="tbtn" data-restore-inspect>${buyerLogBackupTr('Ön kontrol yap','Run preflight')}</button><label><input type="checkbox" data-restore-safety-backup checked/> createSafetyBackup</label><button class="tbtn" data-restore-confirm disabled>${buyerLogBackupTr('Restore’u uygula','Apply restore')}</button><button class="tbtn" data-restore-cancel hidden>${buyerLogBackupTr('İptal','Cancel')}</button></div><div class="backupRestoreStatus" data-restore-status aria-live="polite">${buyerLogBackupTr('Bir backup seçin.','Choose a backup.')}</div></div>` : ''}
    <div class="backupStages">${labels.map((label, index) => `<div class="backupStage" data-stage="${stages[index]}"><span>${index + 1}</span><b>${label}</b></div>`).join('')}</div>
    <div class="backupProgress" id="_backupStatus" aria-live="polite">${buyerLogBackupTr('Yedekleme başlatılmadı.','Backup has not started.')}</div></div></div>`;
  document.body.appendChild(modal);
  const status = modal.querySelector('#_backupStatus'), buttons = [...modal.querySelectorAll('[data-backup-mode]')];
  const restorePanel = modal.querySelector('[data-restore-panel]'), restoreFile = modal.querySelector('[data-restore-file]');
  const close = () => modal.remove();
  modal.querySelector('._backupClose').addEventListener('click', close); modal.addEventListener('click', event => { if (event.target === modal) close(); });
  function render(job) {
    const activeIndex = Math.max(0, stages.indexOf(job.phase));
    modal.querySelectorAll('.backupStage').forEach((node, index) => { node.classList.toggle('done', index < activeIndex || job.ready); node.classList.toggle('active', index === activeIndex && !job.error); node.classList.toggle('error', Boolean(job.error) && index === activeIndex); });
    if (job.error) status.textContent = `${buyerLogBackupTr('Hata','Error')}: ${job.error}`;
    else status.textContent = `${labels[activeIndex] || job.phase} • ${Number(job.current || 0).toLocaleString()}/${Number(job.total || 0).toLocaleString()}${job.item ? ` • ${job.item}` : ''}`;
  }
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  async function run(mode) {
    buttons.forEach(button => { button.disabled = true; }); render({ phase: 'Hazırlanıyor', current: 0, total: 0 });
    try {
      const response = await fetch('/api/backups', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode, browserStorage: mode === 'user' ? buyerLogBrowserStorageSnapshot() : {} }) });
      const initial = await response.json().catch(() => ({})); if (!response.ok) throw new Error(initial.error || response.statusText);
      let job = initial;
      while (!job.ready && !job.error) { await wait(300); const poll = await fetch(`/api/backups/${encodeURIComponent(job.id)}/status`, { cache: 'no-store' }); job = await poll.json().catch(() => ({})); if (!poll.ok) throw new Error(job.error || poll.statusText); render(job); }
      render(job); if (job.error) throw new Error(job.error);
      const link = document.createElement('a'); link.href = `/api/backups/${encodeURIComponent(job.id)}/download`; link.download = job.filename || 'BuyerLog_Backup.zip'; document.body.appendChild(link); link.click(); link.remove();
    } catch (error) { render({ phase: 'Hazırlanıyor', current: 0, total: 0, error: error.message }); }
    finally { buttons.forEach(button => { button.disabled = false; }); }
  }
  buttons.forEach(button => button.addEventListener('click', () => run(button.dataset.backupMode)));
  if (restorePanel) {
    let uploadId = '', restoreJobId = '', commitStarted = false;
    const restoreStatus = restorePanel.querySelector('[data-restore-status]'), inspectButton = restorePanel.querySelector('[data-restore-inspect]'), confirmButton = restorePanel.querySelector('[data-restore-confirm]'), cancelButton = restorePanel.querySelector('[data-restore-cancel]'), safetyCheckbox = restorePanel.querySelector('[data-restore-safety-backup]');
    const setRestoreStatus = message => { restoreStatus.textContent = message; };
    modal.querySelector('[data-backup-restore]').addEventListener('click', () => { restorePanel.hidden = !restorePanel.hidden; });
    inspectButton.addEventListener('click', async () => {
      const file = restoreFile.files && restoreFile.files[0]; if (!file) return setRestoreStatus(buyerLogBackupTr('Önce bir ZIP seçin.','Choose a ZIP first.'));
      inspectButton.disabled = true; confirmButton.disabled = true; uploadId = '';
      try {
        const response = await fetch(`/api/backups/restore/inspect?createSafetyBackup=${safetyCheckbox.checked ? '1' : '0'}`, { method: 'POST', headers: { 'Content-Type': 'application/zip' }, body: file });
        const data = await response.json().catch(() => ({})); if (!response.ok) throw new Error(data.error || response.statusText);
        uploadId = data.uploadId; const plan = data.preflight || {};
        const inventory = plan.inventory || {}, connections = inventory.connections || {};
        setRestoreStatus(`${buyerLogBackupTr('Ön kontrol tamamlandı','Preflight complete')}: ${Number(plan.fileCount || 0).toLocaleString()} ${buyerLogBackupTr('dosya','files')} • ${buyerLogRestoreBytes(plan.totalBytes)} • Users: ${Number(inventory.users || 0).toLocaleString()} • Roles: ${Number(inventory.roles || 0).toLocaleString()} • Local DB: ${inventory.localDb ? 'Found' : 'Missing'} • ASAS: ${connections.asas ? 'Found' : 'Missing'} • IAS: ${connections.ias ? 'Found' : 'Missing'} • INTAKE: ${connections.intake ? 'Found' : 'Missing'}${(plan.warnings || []).length ? ` • ${plan.warnings.join(' ')}` : ''}`);
        confirmButton.disabled = false;
      } catch (error) { setRestoreStatus(`${buyerLogBackupTr('Hata','Error')}: ${error.message}`); }
      finally { inspectButton.disabled = false; }
    });
    confirmButton.addEventListener('click', async () => {
      if (!uploadId) return;
      confirmButton.disabled = true; cancelButton.hidden = false; commitStarted = false;
      try {
        const response = await fetch('/api/backups/restore/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ uploadId, createSafetyBackup: safetyCheckbox.checked }) });
        let job = await response.json().catch(() => ({})); if (!response.ok) throw new Error(job.error || response.statusText);
        restoreJobId = job.id;
        while (!job.done && !job.error) {
          await wait(400); const poll = await fetch(`/api/backups/restore/${encodeURIComponent(restoreJobId)}/status`, { cache: 'no-store' }); job = await poll.json().catch(() => ({})); if (!poll.ok) throw new Error(job.error || poll.statusText);
          commitStarted = Boolean(job.commitStarted); cancelButton.hidden = commitStarted; setRestoreStatus(`${job.phase || ''} • ${Number(job.current || 0).toLocaleString()}/${Number(job.total || 0).toLocaleString()}${job.bytesTotal ? ` • ${buyerLogRestoreBytes(job.bytesDone)}/${buyerLogRestoreBytes(job.bytesTotal)}` : ''}${job.item ? ` • ${job.item}` : ''}`);
        }
        if (job.error) throw new Error(job.error);
        setRestoreStatus(buyerLogBackupTr('Restore tamamlandı. Sunucuyu yeniden başlatın.','Restore completed. Restart the server.'));
      } catch (error) { setRestoreStatus(`${buyerLogBackupTr('Hata','Error')}: ${error.message}`); }
      finally { cancelButton.hidden = true; confirmButton.disabled = false; }
    });
    cancelButton.addEventListener('click', async () => {
      if (!restoreJobId || commitStarted) return;
      await fetch(`/api/backups/restore/${encodeURIComponent(restoreJobId)}/cancel`, { method: 'POST' }).catch(() => {});
      setRestoreStatus(buyerLogBackupTr('İptal istendi.','Cancellation requested.'));
    });
  }
}
window.buyerLogBackupModal = buyerLogBackupModal;
document.getElementById('backupRestoreBtn')?.addEventListener('click', buyerLogBackupModal);
document.getElementById('backupSettingsBtn')?.addEventListener('click', buyerLogBackupModal);
