/* Buyer Log — Check for Updates UI (moderator: TEST/STABLE, others: STABLE only) */
(() => {
  'use strict';

  const esc = value => typeof escapeHtml === 'function'
    ? escapeHtml(String(value == null ? '' : value))
    : String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[ch]);
  const tr = (a,b) => (typeof appLang !== 'undefined' && appLang === 'en') ? b : a;
  let overlay = null;
  let unsubscribe = null;
  let busy = false;
  let statusPollTimer = null;
  let statusPollBusy = false;
  let patchFailure = '';

  const stateLabel = code => ({
    IDLE: tr('Hazır','Ready'),
    CHECKING: tr('Kontrol ediliyor','Checking'),
    UPDATE_AVAILABLE: tr('Yeni sürüm bulundu','Update available'),
    DOWNLOADING: tr('İndiriliyor','Downloading'),
    VERIFYING: tr('Doğrulanıyor','Verifying'),
    READY_TO_INSTALL: tr('Kuruluma hazır','Ready to install'),
    INSTALLING: tr('Kuruluyor','Installing'),
    SUCCESS: tr('Güncel','Up to date'),
    FAILED: tr('Hata','Failed'),
    ROLLBACK: tr('Önceki sürüme dönüldü','Previous version restored'),
  })[String(code || '').toUpperCase()] || String(code || '—');

  function profile() {
    try {
      if (typeof state !== 'undefined' && state.currentUser) return state.currentUser;
    } catch (_) {}
    return window.BL_USER_CONTEXT || null;
  }

  function userId() {
    const user = profile() || {};
    return String(user.id || user.userId || user.username || '');
  }

  function isModerator() {
    const user = profile() || {};
    return user.systemRole === 'moderator';
  }

  function updatesApi() {
    return window.buyerLogDesktop && window.buyerLogDesktop.updates || null;
  }

  function messageFor(status) {
    if (!status) return tr('Güncelleme durumu okunamadı.','Update status could not be read.');
    if (status.pendingReady && status.pendingVersion) {
      if(status.pendingManualPatchSequence)return tr('İmzalı yama ','Signed patch ')+status.pendingManualPatchSequence+tr(' doğrulandı. İşinizi kaydettikten sonra yeniden başlatın.',' verified. Restart after saving your work.');
      return String(status.pendingVersion) + ' ' + tr('indirildi ve doğrulandı. Yeniden başlatınca kurulacak.','was downloaded and verified. Restart to install it.');
    }
    const code = String(status.lastError && status.lastError.code || '');
    if(status.lastError?.manualPatch)return tr('İmzalı yamanın açılışı doğrulanamadı. Önceki uygulama ve veri geri yüklendi. Daha yeni onaylı bir yama veya imzalı tam kurulum seçin.','The signed patch could not start successfully. The previous application and data were restored. Select a newer approved patch or a signed full installation.');
    if (code === 'UPDATE_ADMIN_REQUIRED') return tr('Bu güncelleme işlemi için güncel moderatör yetkisi gerekiyor.','Current moderator authority is required for this update operation.');
    if (code === 'UPDATE_RETRY_TARGET_CHANGED') return tr('Yeniden denenecek sürüm veya kanal değişti. Güncellemeyi kontrol edip paketi yeniden seçin.','The version or channel to retry changed. Check for updates and select the package again.');
    if (code === 'UPDATE_FAILED_VERSION_BLOCKED' || code === 'UPDATE_HEALTH_FAILED') {
      const failure = status.failedVersions && status.failedVersions[status.latestVersion];
      const reason = ({
        'health-timeout': tr('Açılış doğrulaması zaman aşımına uğradı.','Startup verification timed out.'),
        'previous-launch-unconfirmed': tr('Önceki açılış doğrulanmadan kapandı.','The previous launch ended before verification.'),
        'main-load-failed': tr('Yeni uygulama çekirdeği yüklenemedi.','The new app core could not be loaded.'),
      })[failure && failure.reason] || '';
      return tr('Bu sürümün önceki açılışı doğrulanamadı. Moderatör “Tekrar Dene” ile paketi yeniden indirip doğrulayabilir; yine başarısız olursa önceki sürüme dönülür.','This version’s previous launch could not be verified. A moderator can use “Retry” to download and verify it again; another failed launch returns to the previous version.') + (reason ? ' ' + reason : '');
    }
    if (status.state === 'CHECKING') return tr('Yeni sürüm kontrol ediliyor…','Checking for a new version…');
    if (status.state === 'UPDATE_AVAILABLE') {
      return status.latestVersion
        ? tr('Yeni sürüm bulundu: ','Update found: ') + status.latestVersion + '. ' + tr('İndirme hazırlanıyor…','Preparing download…')
        : tr('Yeni sürüm bulundu. İndirme hazırlanıyor…','Update found. Preparing download…');
    }
    if (status.state === 'DOWNLOADING') {
      return status.latestVersion
        ? tr('Buyer Log ','Buyer Log ') + status.latestVersion + tr(' indiriliyor…',' is downloading…')
        : tr('Güncelleme indiriliyor…','Downloading update…');
    }
    if (status.state === 'VERIFYING') {
      return status.latestVersion
        ? tr('Buyer Log ','Buyer Log ') + status.latestVersion + tr(' indirildi. Paket doğrulanıyor…',' downloaded. Verifying package…')
        : tr('Paket doğrulanıyor…','Verifying package…');
    }
    if (status.state === 'FAILED') {
      const last = status.lastError || {};
      return String(last.message || last.code || tr('Güncelleme kontrolü başarısız oldu.','Update check failed.'));
    }
    if (status.latestVersion && status.currentVersion && status.latestVersion === status.currentVersion) {
      return tr('Bu kanalda daha yeni bir sürüm yok.','There is no newer version on this channel.');
    }
    if (status.latestVersion) return tr('Son bulunan sürüm: ','Latest discovered version: ') + status.latestVersion;
    return tr('Henüz güncelleme kontrolü yapılmadı.','No update check has run yet.');
  }

  function close() {
    if (unsubscribe) { try { unsubscribe(); } catch (_) {} }
    unsubscribe = null;
    if (statusPollTimer) clearInterval(statusPollTimer);
    statusPollTimer = null;
    statusPollBusy = false;
    if (overlay) overlay.remove();
    overlay = null;
    busy = false;
    patchFailure = '';
  }

  function setValue(name,value) {
    if (!overlay) return;
    const el = overlay.querySelector('[data-update-value="' + name + '"]');
    if (el) el.textContent = value == null || value === '' ? '—' : String(value);
  }

  function renderProgress(status) {
    if (!overlay) return;
    const progress = overlay.querySelector('[data-update-progress]');
    if (!progress) return;
    const code = String(status && status.state || '').toUpperCase();
    const phase = ({
      CHECKING: 'check',
      UPDATE_AVAILABLE: 'download',
      DOWNLOADING: 'download',
      VERIFYING: 'verify',
      READY_TO_INSTALL: 'ready',
    })[code] || '';
    progress.hidden = !phase;
    const order = ['check','download','verify','ready'];
    const activeIndex = order.indexOf(phase);
    progress.querySelectorAll('[data-update-step]').forEach(step => {
      const index = order.indexOf(String(step.dataset.updateStep || ''));
      step.classList.toggle('isDone', activeIndex > index);
      step.classList.toggle('isActive', activeIndex === index);
    });
  }

  function render(status) {
    if (!overlay || !status) return;
    setValue('current',status.currentVersion);
    setValue('channel',isModerator() ? String(status.channel || status.configuredChannel || 'stable').toUpperCase() : 'STABLE');
    setValue('latest',status.latestVersion);
    setValue('pending',status.pendingVersion);
    setValue('state',stateLabel(status.state));
    renderProgress(status);
    const channel = overlay.querySelector('[data-update-channel]');
    if (channel && !busy) channel.value = String(status.configuredChannel || status.channel || 'stable').toLowerCase() === 'test' ? 'test' : 'stable';
    const message = overlay.querySelector('[data-update-message]');
    if (message) {
      message.textContent = patchFailure || messageFor(status);
      message.classList.toggle('isReady',Boolean(status.pendingReady));
      message.classList.toggle('isError',Boolean(patchFailure) || status.state === 'FAILED' || Boolean(status.lastError));
    }
    const restart = overlay.querySelector('[data-update-restart]');
    if (restart) restart.hidden = !status.pendingReady;
    const signed = overlay.querySelector('[data-update-signed-patch]');
    if (signed) signed.hidden = !(status.moderator && status.manualPatchSupported);
    // Health check'te geri alınan sürüm aynı paketle tekrar indirilmez; yalnız
    // moderatör bu engeli kaldırıp sürümü yeniden deneyebilir.
    const retry = overlay.querySelector('[data-update-retry]');
    if (retry) { retry.hidden = !canRetry(status); retry.dataset.version = String(status.latestVersion || ''); retry.dataset.channel = String(status.channel || 'stable'); }
  }

  function canRetry(status) {
    if (!isModerator() || !status || status.pendingReady || !status.latestVersion || status.lastError?.manualPatch) return false;
    const code = String(status.lastError && status.lastError.code || '');
    return code === 'UPDATE_FAILED_VERSION_BLOCKED' || code === 'UPDATE_HEALTH_FAILED';
  }

  async function open() {
    close();
    const user = profile();
    if (!user) return;
    // Kanal seçimi yalnız moderatördedir; diğer kullanıcılar yalnız STABLE
    // indirir. Backend de moderatör olmayan için efektif kanalı stable'a sabitler.
    const moderator = isModerator();
    const api = updatesApi();
    if (!api || typeof api.status !== 'function') {
      const msg = tr('Uygulama güncellemesi yalnız masaüstü Buyer Log uygulamasında kullanılabilir.','App update is available only in the Buyer Log desktop app.');
      if (typeof showToast === 'function') showToast(msg); else alert(msg);
      return;
    }

    overlay = document.createElement('div');
    overlay.className = 'updateTestOverlay';
    overlay.innerHTML = [
      '<section class="modalCard updateTestCard" role="dialog" aria-modal="true" aria-labelledby="updateTestTitle">',
      '<div class="updateTestHead"><div>',
      '<h2 class="modalTitle" id="updateTestTitle">' + esc(tr('Güncellemeleri Kontrol Et','Check for Updates')) + '</h2>',
      '<p>' + esc(moderator
        ? tr('Kanalı seç (TEST/STABLE), sürümü kontrol et, indir ve hazır olduğunda yeniden başlatıp kur.','Pick the channel (TEST/STABLE), check and download the build, then restart to install when ready.')
        : tr('STABLE sürümü kontrol et, indir ve hazır olduğunda yeniden başlatıp kur.','Check and download the STABLE build, then restart to install when ready.')) + '</p>',
      '</div><button type="button" class="iconbtn updateTestClose" data-update-close aria-label="' + esc(tr('Kapat','Close')) + '">×</button></div>',
      '<div class="updateTestFacts">',
      '<div><span>' + esc(tr('Mevcut sürüm','Current version')) + '</span><b data-update-value="current">—</b></div>',
      '<div><span>' + esc(tr('Kanal','Channel')) + '</span><b data-update-value="channel">—</b></div>',
      '<div><span>' + esc(tr('Son bulunan','Latest found')) + '</span><b data-update-value="latest">—</b></div>',
      '<div><span>' + esc(tr('Hazırlanan','Pending')) + '</span><b data-update-value="pending">—</b></div>',
      '<div class="updateTestStateRow"><span>' + esc(tr('Durum','Status')) + '</span><b data-update-value="state">—</b></div>',
      '</div>',
      moderator ? '<div class="updateTestControls"><label><span>' + esc(tr('Güncelleme kanalı','Update channel')) + '</span>' : '',
      moderator ? '<select data-update-channel><option value="test">TEST</option><option value="stable">STABLE</option></select></label></div>' : '',
      '<div class="updateTestMessage" data-update-message role="status" aria-live="polite"></div>',
      '<div class="updateTestProgress" data-update-progress hidden aria-label="' + esc(tr('Güncelleme ilerlemesi','Update progress')) + '">',
      '<div class="updateTestProgressSteps">',
      '<span class="updateTestProgressStep" data-update-step="check">' + esc(tr('Kontrol','Check')) + '</span>',
      '<span class="updateTestProgressStep" data-update-step="download">' + esc(tr('İndiriliyor','Download')) + '</span>',
      '<span class="updateTestProgressStep" data-update-step="verify">' + esc(tr('Doğrulama','Verify')) + '</span>',
      '<span class="updateTestProgressStep" data-update-step="ready">' + esc(tr('Hazır','Ready')) + '</span>',
      '</div></div>',
      '<div class="updateTestActions">',
      '<button type="button" class="navActionBtn" data-update-signed-patch hidden>' + esc(tr('İmzalı Yama Yükle…','Install Signed Patch…')) + '</button>',
      '<button type="button" class="navActionBtn" data-update-retry hidden>' + esc(tr('Tekrar Dene','Retry')) + '</button>',
      '<button type="button" class="navActionBtn primary" data-update-check>' + esc(tr('Güncellemeyi Kontrol Et','Check for Update')) + '</button>',
      '<button type="button" class="navActionBtn primary" data-update-restart hidden>' + esc(tr('Yeniden Başlat ve Kur','Restart and Install')) + '</button>',
      '</div></section>'
    ].join('');
    document.body.appendChild(overlay);

    const channel = overlay.querySelector('[data-update-channel]');
    const check = overlay.querySelector('[data-update-check]');
    const restart = overlay.querySelector('[data-update-restart]');
    const retry = overlay.querySelector('[data-update-retry]');
    const signed = overlay.querySelector('[data-update-signed-patch]');
    overlay.querySelector('[data-update-close]').addEventListener('click',close);
    overlay.addEventListener('mousedown',event => { if (event.target === overlay) close(); });

    const refresh = async () => {
      if (statusPollBusy) return null;
      statusPollBusy = true;
      try {
        const status = await api.status(userId());
        render(status);
        return status;
      } finally {
        statusPollBusy = false;
      }
    };
    const setBusy = value => {
      busy = Boolean(value);
      if(busy)patchFailure='';
      if (check) check.disabled = busy;
      if (retry) retry.disabled = busy;
      if (signed) signed.disabled = busy;
      if (channel) channel.disabled = busy;
    };

    if (channel) channel.addEventListener('change',async() => {
      setBusy(true);
      try {
        const result = await api.configure({userId:userId(),enabled:true,channel:channel.value});
        if (!result || result.ok === false) throw new Error(result && result.error || tr('Kanal değiştirilemedi.','Channel could not be changed.'));
        render(result);
      } catch (error) {
        if (typeof showToast === 'function') showToast(error.message); else alert(error.message);
      } finally {
        setBusy(false);
        await refresh().catch(()=>{});
      }
    });

    check.addEventListener('click',async() => {
      setBusy(true);
      try {
        if (moderator && channel) {
          const configured = await api.configure({userId:userId(),enabled:true,channel:channel.value});
          if (!configured || configured.ok === false) throw new Error(configured && configured.error || tr('Güncelleme kanalı ayarlanamadı.','Update channel could not be configured.'));
          render(configured);
        }
        const result = await api.check({userId:userId()});
        render(result);
      } catch (error) {
        const message = overlay && overlay.querySelector('[data-update-message]');
        if (message) {
          message.textContent = error.message || tr('Güncelleme kontrolü başarısız oldu.','Update check failed.');
          message.classList.add('isError');
        }
      } finally {
        setBusy(false);
        await refresh().catch(()=>{});
      }
    });

    if (retry) retry.addEventListener('click',async() => {
      if (typeof api.retry !== 'function') return;
      setBusy(true);
      try {
        const version = retry.dataset.version, channel = retry.dataset.channel;
        const result = await api.retry({userId:userId(),version,channel});
        if (!result || result.ok === false) throw new Error(result && ['UPDATE_RETRY_TARGET_CHANGED','UPDATE_ADMIN_REQUIRED'].includes(result.code) ? messageFor({lastError:{code:result.code}}) : result && (result.error || result.code) || tr('Sürüm yeniden denenemedi.','The version could not be retried.'));
        render(result);
      } catch (error) {
        const message = overlay && overlay.querySelector('[data-update-message]');
        if (message) {
          message.textContent = error.message || tr('Sürüm yeniden denenemedi.','The version could not be retried.');
          message.classList.add('isError');
        }
      } finally {
        setBusy(false);
        await refresh().catch(()=>{});
      }
    });

    signed.addEventListener('click',async()=>{
      if(typeof api.prepareSignedPatch!=='function')return;
      setBusy(true);
      try{
        const result=await api.prepareSignedPatch({userId:userId(),language:tr('tr','en')});
        if(result?.cancelled)return;
        if(!result?.ok)throw Error(result?.error||tr('İmzalı yama hazırlanamadı.','The signed patch could not be prepared.'));
        render(result);restart.focus();
      }catch(error){
        patchFailure=error.message;
        const message=overlay?.querySelector('[data-update-message]');
        if(message){message.textContent=error.message;message.classList.add('isError');}
      }finally{setBusy(false);}
    });

    restart.addEventListener('click',async() => {
      restart.disabled = true;
      const result = await api.restart();
      if (!result || result.ok === false) {
        restart.disabled = false;
        const msg = result && (result.error || result.code) || tr('Yeniden başlatma başlatılamadı.','Restart could not be started.');
        if (typeof showToast === 'function') showToast(msg); else alert(msg);
      }
    });

    if (typeof api.onStatus === 'function') unsubscribe = api.onStatus(render);
    await refresh().catch(error => {
      const message = overlay && overlay.querySelector('[data-update-message]');
      if (message) {
        message.textContent = error.message || tr('Güncelleme durumu okunamadı.','Update status could not be read.');
        message.classList.add('isError');
      }
    });
    // checkAndStage tek IPC çağrısı boyunca indirme + doğrulamayı tamamlar.
    // Main process yalnız işlem bittiğinde event gönderdiği için durum dosyasını
    // kısa aralıklarla okuyarak CHECKING -> DOWNLOADING -> VERIFYING -> READY
    // geçişlerini modal açıkken canlı göster.
    statusPollTimer = setInterval(() => { void refresh().catch(()=>{}); }, 350);
  }

  window.openBuyerLogUpdateTest = open;
  window.closeBuyerLogUpdateTest = close;
  document.addEventListener('keydown',event => { if (event.key === 'Escape' && overlay) close(); });
})();
