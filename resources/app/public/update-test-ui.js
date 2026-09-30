/* Buyer Log — App Update UI (moderator: TEST/STABLE, others: STABLE only) */
(() => {
  'use strict';

  const esc = value => typeof escapeHtml === 'function'
    ? escapeHtml(String(value == null ? '' : value))
    : String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[ch]);
  const tr = (a,b) => (typeof appLang !== 'undefined' && appLang === 'en') ? b : a;
  let overlay = null;
  let unsubscribe = null;
  let busy = false;

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
    ROLLBACK: tr('Geri alınıyor','Rolling back'),
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
      return String(status.pendingVersion) + ' ' + tr('indirildi ve doğrulandı. Yeniden başlatınca kurulacak.','was downloaded and verified. Restart to install it.');
    }
    if (status.state === 'CHECKING') return tr('Yeni sürüm kontrol ediliyor…','Checking for a new version…');
    if (status.state === 'DOWNLOADING') return tr('Güncelleme indiriliyor…','Downloading update…');
    if (status.state === 'VERIFYING') return tr('Paket doğrulanıyor…','Verifying package…');
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
    if (overlay) overlay.remove();
    overlay = null;
    busy = false;
  }

  function setValue(name,value) {
    if (!overlay) return;
    const el = overlay.querySelector('[data-update-value="' + name + '"]');
    if (el) el.textContent = value == null || value === '' ? '—' : String(value);
  }

  function render(status) {
    if (!overlay || !status) return;
    setValue('current',status.currentVersion);
    setValue('channel',isModerator() ? String(status.channel || status.configuredChannel || 'stable').toUpperCase() : 'STABLE');
    setValue('latest',status.latestVersion);
    setValue('pending',status.pendingVersion);
    setValue('state',stateLabel(status.state));
    const channel = overlay.querySelector('[data-update-channel]');
    if (channel && !busy) channel.value = String(status.configuredChannel || status.channel || 'stable').toLowerCase() === 'test' ? 'test' : 'stable';
    const message = overlay.querySelector('[data-update-message]');
    if (message) {
      message.textContent = messageFor(status);
      message.classList.toggle('isReady',Boolean(status.pendingReady));
      message.classList.toggle('isError',status.state === 'FAILED' || Boolean(status.lastError));
    }
    const restart = overlay.querySelector('[data-update-restart]');
    if (restart) restart.hidden = !status.pendingReady;
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
      '<h2 class="modalTitle" id="updateTestTitle">' + esc(moderator ? tr('Güncelleme Testi','Update Test') : tr('Uygulama Güncellemesi','App Update')) + '</h2>',
      '<p>' + esc(moderator
        ? tr('TEST sürümünü kontrol et, indir ve hazır olduğunda yeniden başlatıp kur.','Check and download the TEST build, then restart to install when ready.')
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
      '<div class="updateTestActions">',
      '<button type="button" class="navActionBtn primary" data-update-check>' + esc(tr('Güncellemeyi Kontrol Et','Check for Update')) + '</button>',
      '<button type="button" class="navActionBtn primary" data-update-restart hidden>' + esc(tr('Yeniden Başlat ve Kur','Restart and Install')) + '</button>',
      '</div></section>'
    ].join('');
    document.body.appendChild(overlay);

    const channel = overlay.querySelector('[data-update-channel]');
    const check = overlay.querySelector('[data-update-check]');
    const restart = overlay.querySelector('[data-update-restart]');
    overlay.querySelector('[data-update-close]').addEventListener('click',close);
    overlay.addEventListener('mousedown',event => { if (event.target === overlay) close(); });

    const refresh = async () => {
      const status = await api.status(userId());
      render(status);
      return status;
    };
    const setBusy = value => {
      busy = Boolean(value);
      if (check) check.disabled = busy;
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
  }

  window.openBuyerLogUpdateTest = open;
  window.closeBuyerLogUpdateTest = close;
  document.addEventListener('keydown',event => { if (event.key === 'Escape' && overlay) close(); });
})();
