/* Mevcut PLM Görsel Paketini İçe Aktar (BUYERLOG_IMPORT).

   NEDEN AYRI DOSYA: app-main.js zaten 29.000 satırın üzerinde. plm-operations.js
   ile aynı desen: kendi kendine yeten bir birim, app-main'in global
   yardımcılarını (escapeHtml, appLang, showToast, plmJsonRequest) KULLANIR
   ama ona hiçbir şey eklemez — yalnız window.BLPlmImagePackage üzerinden
   dışa açılır.

   TASARIM: yeni bir bileşen dili uydurulmadı. Buyer Log'un mevcut kabukları
   kullanıldı: .warnOverlay / .modalCard, .kolPlanStat istatistik kutucukları,
   .plmImportTable tablo, .tbtn düğmeler, :root tema değişkenleri. Uygulama
   köşe yuvarlaması kullanmadığı için burada da kullanılmaz.

   AKIŞ SÖZLEŞMESİ: ÖNCE ÖNİZLEME, SONRA ONAY. Önizleme sunucuda hiçbir şey
   yazmaz; yazma yalnız kullanıcı sayıları gördükten ve açıkça onayladıktan
   sonra yapılır. Kullanıcının elle koyduğu görseller varsayılan olarak
   KORUNUR; üzerine yazmak ayrı ve açık bir seçimdir. */
(function () {
  'use strict';

  const en = () => (typeof appLang !== 'undefined' && appLang === 'en');
  const t = (tr, enText) => (en() ? enText : tr);
  const esc = value => (typeof escapeHtml === 'function' ? escapeHtml(value) : String(value == null ? '' : value));
  const toast = message => { if (typeof showToast === 'function') showToast(message); };

  const state = { folder: '', preview: null, busy: false, overwriteManual: false };

  async function api(path, body) {
    const options = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) };
    if (typeof plmJsonRequest === 'function') return plmJsonRequest(path, options);
    const response = await fetch(path, { credentials: 'same-origin', ...options });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(payload.error || `HTTP ${response.status}`), { code: payload.code });
    return payload;
  }

  function humanBytes(value) {
    const bytes = Number(value) || 0;
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function metric(caption, value, tone = '') {
    return `<div class="kolPlanStat${tone ? ` ${tone}` : ''}"><span>${esc(caption)}</span><strong>${esc(value)}</strong></div>`;
  }

  /* Sayılar UYDURULMAZ: her biri manifestten ve gerçek dosya denetiminden
     gelen sayımdır. Kullanıcı neyin yazılacağını, neyin korunacağını ve
     neyin reddedildiğini YAZMADAN ÖNCE görür. */
  function previewBody(preview) {
    const counts = preview.counts || {};
    const bySource = Object.entries(counts.bySource || {})
      .map(([key, value]) => metric(key === 'OPTION' ? t('Renk görseli', 'Option image') : key === 'STYLE_DEFAULT' ? t('Varsayılan model görseli', 'Default style image') : key, value))
      .join('');
    return `
      <div class="plmImportIntro">
        <div><strong>${esc(preview.packageType || '')}</strong> · v${esc(preview.formatVersion)} · ${esc(preview.generatedAt || '')}</div>
        <div class="muted">${esc(preview.root || '')}</div>
      </div>
      <div class="kolPlanStats">
        ${metric(t('Paketteki girdi', 'Package entries'), counts.total || 0)}
        ${metric(t('Aktarılacak', 'Will import'), counts.ready || 0)}
        ${metric(t('Pakette görsel yok', 'Missing in package'), counts.missing || 0)}
        ${metric(t('Geçersiz / reddedildi', 'Invalid / rejected'), counts.invalid || 0)}
        ${metric(t('Zaten kayıtlı', 'Already stored'), counts.cached || 0)}
        ${metric(t('Toplam boyut', 'Total size'), humanBytes(preview.totalReadyBytes))}
      </div>
      <h4 class="plmImportSubhead">${esc(t('Ne değişecek?', 'What will change?'))}</h4>
      <div class="kolPlanStats">
        ${metric(t('Yeni görsel', 'New images'), counts.newImages || 0)}
        ${metric(t('Otomatik görselin üzerine yazılacak', 'Overwrites automatic image'), counts.overwritesAutomatic || 0)}
        ${metric(t('Elle konmuş görsel (korunur)', 'Manual images (preserved)'), counts.manualPreserved || 0)}
        ${bySource}
      </div>
      ${counts.manualConflicts ? `<label class="plmImportCheck"><input type="checkbox" data-package-overwrite${state.overwriteManual ? ' checked' : ''}>
        <span>${esc(t(`Elle konmuş ${counts.manualConflicts} görselin de üzerine yaz`, `Also overwrite ${counts.manualConflicts} manually chosen image(s)`))}</span></label>` : ''}
      ${sampleTable(t('Reddedilenler', 'Rejected'), preview.samples && preview.samples.invalid)}
      ${sampleTable(t('Pakette görseli olmayanlar', 'Missing in package'), preview.samples && preview.samples.missing)}`;
  }

  function sampleTable(title, rows) {
    const list = Array.isArray(rows) ? rows : [];
    if (!list.length) return '';
    const body = list.map(row => `<tr>
      <td>${esc(row.plmId || '')}</td><td>${esc(row.colourCode || '')}</td>
      <td>${esc(row.code || '')}</td><td>${esc(row.reason || '')}</td></tr>`).join('');
    return `<h4 class="plmImportSubhead">${esc(title)}</h4>
      <div class="plmImportTableWrap"><table class="plmImportTable">
        <thead><tr><th>PLM ID</th><th>${esc(t('Renk', 'Colour'))}</th><th>${esc(t('Kod', 'Code'))}</th><th>${esc(t('Sebep', 'Reason'))}</th></tr></thead>
        <tbody>${body}</tbody></table></div>`;
  }

  function render() {
    const modal = document.getElementById('plmImagePackageModal');
    if (!modal) return;
    const body = modal.querySelector('[data-package-body]');
    const confirm = modal.querySelector('[data-package-confirm]');
    if (!body) return;
    if (state.busy) {
      body.innerHTML = `<div class="plmOpsEmpty">${esc(t('Paket okunuyor… (binlerce görselde bu bir süre alabilir)', 'Reading package… (this can take a while for thousands of images)'))}</div>`;
    } else if (!state.preview) {
      body.innerHTML = `<div class="plmImportIntro">
        <p>${esc(t('Dış PLM görsel testinin ürettiği BUYERLOG_IMPORT klasörünün tam yolunu girin. Klasörde manifest.json, import_report.csv ve selected/ bulunmalıdır.', 'Enter the full path of the BUYERLOG_IMPORT folder produced by the external PLM image test. It must contain manifest.json, import_report.csv and selected/.'))}</p>
        <p class="muted">${esc(t('Görseller Buyer Log deposuna KOPYALANIR; paket klasörü sonradan silinebilir.', 'Images are COPIED into Buyer Log storage; the package folder can be deleted afterwards.'))}</p>
      </div>`;
    } else {
      body.innerHTML = previewBody(state.preview);
    }
    if (confirm) {
      const ready = Number(state.preview && state.preview.counts && state.preview.counts.ready) || 0;
      confirm.disabled = state.busy || !ready;
      confirm.textContent = ready
        ? t(`${ready} görseli içe aktar`, `Import ${ready} image(s)`)
        : t('İçe aktar', 'Import');
    }
    const input = modal.querySelector('[data-package-folder]');
    if (input) input.disabled = state.busy;
  }

  async function preview(folder) {
    state.folder = String(folder || '').trim();
    if (!state.folder) { toast(t('Önce paket klasörünü girin.', 'Enter the package folder first.')); return; }
    state.busy = true; state.preview = null; render();
    try {
      state.preview = await api('/api/model-images/package/preview', { folder: state.folder, overwriteManual: state.overwriteManual });
    } catch (error) {
      state.preview = null;
      toast((en() ? 'Package could not be read: ' : 'Paket okunamadı: ') + (error && error.message ? error.message : ''));
    } finally { state.busy = false; render(); }
  }

  async function commit() {
    if (!state.preview || !state.folder) return;
    state.busy = true; render();
    try {
      const data = await api('/api/model-images/package/import', { folder: state.folder, overwriteManual: state.overwriteManual, confirm: true });
      // Görseller KANONİK kayıttan çözülür; istemci önbelleği ayrı bir
      // doğruluk kaynağı değildir. Mevcut uygulayıcı yeniden kullanılır.
      if (typeof applySyncedPlmImages === 'function') applySyncedPlmImages({ ...data, mode: 'all' });
      if (typeof plmSyncRepaintAll === 'function') plmSyncRepaintAll();
      const counts = data.counts || {};
      const message = en()
        ? `Package imported: ${counts.downloadsCompleted || 0} image(s), ${counts.manualPreserved || 0} manual preserved, ${counts.failed || 0} failed.`
        : `Paket aktarıldı: ${counts.downloadsCompleted || 0} görsel, ${counts.manualPreserved || 0} elle konmuş korundu, ${counts.failed || 0} başarısız.`;
      if (typeof showToast === 'function') showToast(message, { icon: false, duration: 12000 });
      else toast(message);
      close();
    } catch (error) {
      toast((en() ? 'Package could not be imported: ' : 'Paket içe aktarılamadı: ') + (error && error.message ? error.message : ''));
    } finally { state.busy = false; render(); }
  }

  let openTrigger = null;
  function close() {
    const modal=document.getElementById('plmImagePackageModal');
    if(!modal)return;
    window.BLLayerSystem?.closeDialog?.(modal,{trigger:openTrigger});
    modal.remove();
    openTrigger=null;
  }

  function open(trigger=null) {
    close();
    openTrigger=trigger;
    const modal = document.createElement('div');
    modal.id = 'plmImagePackageModal';
    modal.className = 'warnOverlay';
    modal.innerHTML = `<div class="modalCard verHistCard plmImportCard" role="dialog" aria-modal="true" aria-label="${esc(t('Mevcut PLM Görsel Paketini İçe Aktar', 'Import Existing PLM Image Package'))}">
      <div class="verHistHead"><div>
        <strong>${esc(t('Mevcut PLM Görsel Paketini İçe Aktar', 'Import Existing PLM Image Package'))}</strong>
        <div class="muted">${esc(t('Hazır BUYERLOG_IMPORT paketindeki görseller CoreNectum’a tekrar gidilmeden Buyer Log deposuna alınır.', 'Images from a ready BUYERLOG_IMPORT package are stored in Buyer Log without downloading from CoreNectum again.'))}</div>
      </div></div>
      <div class="plmImportRow">
        <input type="text" data-package-folder placeholder="${esc(t('…\\output_…\\BUYERLOG_IMPORT', '…\\output_…\\BUYERLOG_IMPORT'))}" value="${esc(state.folder)}" spellcheck="false">
        <button type="button" class="tbtn" data-package-preview>${esc(t('Önizle', 'Preview'))}</button>
      </div>
      <div class="plmImportBody" data-package-body></div>
      <div class="verHistFoot">
        <button type="button" class="tbtn" data-package-close>${esc(t('Vazgeç', 'Cancel'))}</button>
        <span style="flex:1"></span>
        <button type="button" class="tbtn primary" data-package-confirm disabled>${esc(t('İçe aktar', 'Import'))}</button>
      </div></div>`;
    document.body.appendChild(modal);
    render();
    window.BLLayerSystem?.openDialog?.(modal,{trigger:openTrigger,onClose:close,initialFocus:'[data-package-folder]'});
    modal.querySelector('[data-package-folder]')?.focus();
  }

  document.addEventListener('click', event => {
    if (event.target.closest('[data-plm-image-package-open]')) { event.preventDefault(); open(event.target.closest('[data-plm-image-package-open]')); return; }
    const modal = document.getElementById('plmImagePackageModal');
    if (!modal) return;
    if (event.target === modal || event.target.closest('[data-package-close]')) { close(); return; }
    if (event.target.closest('[data-package-preview]')) {
      void preview(modal.querySelector('[data-package-folder]')?.value);
      return;
    }
    if (event.target.closest('[data-package-confirm]')) { void commit(); return; }
    const overwrite = event.target.closest('[data-package-overwrite]');
    if (overwrite) {
      state.overwriteManual = Boolean(overwrite.checked);
      // Seçim önizlemeyi DEĞİŞTİRİR (kaç görselin üzerine yazılacağı başka
      // olur), bu yüzden sayılar yeniden hesaplanır.
      void preview(state.folder);
    }
  });

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && document.getElementById('plmImagePackageModal')) close();
  });

  window.BLPlmImagePackage = { open, close, preview, commit, state: () => ({ ...state }) };
})();
