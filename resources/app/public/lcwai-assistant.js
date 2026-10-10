/* ===================================================================
   LCW AI — Buyer Log'un ortak AI istemcisi (window.BuyerLogAI)

   Buyer Log'da AI desteği TEK yoldan geçer: bu dosya → /api/lcwai/* →
   server/lib/lcwai (LCWAIEngine) → LCW AI HTTP API. Modüller kendi AI
   entegrasyonunu yazmaz; yalnız bağlamlarını ve alan doğrulayıcılarını verir.

     BuyerLogAI.ask({ source, task, context, guide })      → öneri
     BuyerLogAI.askWithFiles({ …, files: [File] })          → dosyalı öneri
     BuyerLogAI.cancel(requestId?)                          → iptal
     BuyerLogAI.getStatus() / connect() / disconnect()      → oturum
     BuyerLogAI.mountAssistant(host, options)               → ortak panel
     BuyerLogAI.openPanel(options)                          → panelin modal hâli

   Güvenlik: tarayıcı tarafı token GÖRMEZ. Sunucu yalnız ilerleme, sonuç ve
   kodlu hata döndürür. Öneri hiçbir zaman otomatik kaydedilmez: panel
   öneriyi ve modülün kendi doğrulamasını gösterir, "Uygula" kullanıcının
   açık onayıdır ve yine modülün mevcut kaydet/önizleme akışına bırakılır.
   =================================================================== */
(function (root) {
  'use strict';
  if (!root || root.BuyerLogAI) return;

  const isEn = () => String(root.appLang || (root.document && root.document.documentElement.lang) || 'tr').toLowerCase().startsWith('en');
  const L = (trText, enText) => (isEn() ? enText : trText);
  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const textOf = value => (value && typeof value === 'object' ? L(value.tr || '', value.en || value.tr || '') : String(value == null ? '' : value));

  let modelLabel = 'GPT-6 Sol';
  let configPromise = null;
  let requestSeq = 0;
  const active = new Map();
  const statusListeners = new Set();
  let lastStatus = null;

  /* Sunucu hata kodu → kullanıcı metni. Teknik ayrıntı gösterilmez. */
  const ERROR_TEXT = {
    LCWAI_AUTH_REQUIRED: { tr: 'LCW AI oturumu açık değil. LCW AI girişini yapın.', en: 'You are not signed in to LCW AI. Sign in to LCW AI.' },
    LCWAI_SESSION_EXPIRED: { tr: 'LCW AI oturumunuz yenilenmeli.', en: 'Your LCW AI session needs to be renewed.' },
    LCWAI_BROWSER_UNAVAILABLE: { tr: 'LCW AI oturumuna ulaşılamadı. Tarayıcı bağlantısını kontrol edin.', en: 'The LCW AI session could not be reached. Check the browser connection.' },
    LCWAI_LOGIN_IN_PROGRESS: { tr: 'LCW AI girişi sürüyor. Açılan tarayıcı sekmesinde girişi tamamlayın.', en: 'LCW AI sign-in is in progress. Complete it in the opened browser tab.' },
    LCWAI_LOGIN_TIMEOUT: { tr: 'LCW AI girişi tamamlanmadı. Tarayıcıdaki girişi bitirip tekrar deneyin.', en: 'LCW AI sign-in was not completed. Finish signing in in the browser and try again.' },
    LCWAI_FORBIDDEN: { tr: 'LCW AI bu işlem için yetki vermedi. Hesabınızın LCW AI erişimini kontrol edin.', en: 'LCW AI did not authorise this request. Check your account’s LCW AI access.' },
    LCWAI_RATE_LIMITED: { tr: 'LCW AI şu an çok fazla istek alıyor. Biraz bekleyip tekrar deneyin.', en: 'LCW AI is receiving too many requests. Wait a moment and try again.' },
    LCWAI_TIMEOUT: { tr: 'LCW AI zamanında yanıt vermedi. Tekrar deneyin.', en: 'LCW AI did not respond in time. Try again.' },
    LCWAI_NETWORK: { tr: 'LCW AI’a ulaşılamıyor. Kurumsal ağ/VPN bağlantınızı kontrol edin.', en: 'LCW AI cannot be reached. Check your corporate network/VPN connection.' },
    LCWAI_UNAVAILABLE: { tr: 'LCW AI şu an hizmet veremiyor. Biraz sonra tekrar deneyin.', en: 'LCW AI is currently unavailable. Try again later.' },
    LCWAI_STREAM_INTERRUPTED: { tr: 'LCW AI yanıtı yarıda kesildi. Tekrar deneyin.', en: 'The LCW AI response was interrupted. Try again.' },
    LCWAI_UPLOAD_FAILED: { tr: 'Dosya LCW AI’a yüklenemedi.', en: 'The file could not be uploaded to LCW AI.' },
    LCWAI_FILE_TOO_LARGE: { tr: 'Dosya LCW AI için çok büyük.', en: 'The file is too large for LCW AI.' },
    LCWAI_FILE_TYPE_NOT_ALLOWED: { tr: 'Bu dosya türü LCW AI’a gönderilemez.', en: 'This file type cannot be sent to LCW AI.' },
    LCWAI_OUTPUT_INVALID: { tr: 'LCW AI istenen dosya için geçerli içerik üretmedi (düzeltme denemeleri de sonuç vermedi). İsteği sadeleştirip tekrar deneyin.', en: 'LCW AI did not produce valid content for the requested file (repair attempts failed too). Simplify the request and try again.' },
    LCWAI_OUTPUT_RENDER_FAILED: { tr: 'Dosya oluşturulamadı.', en: 'The file could not be created.' },
    LCWAI_OUTPUT_NOT_FOUND: { tr: 'Dosya bulunamadı; silinmiş ya da taşınmış olabilir.', en: 'The file was not found; it may have been deleted or moved.' },
    LCWAI_OUTPUT_EDIT_INVALID: { tr: 'Düzenlenen içerik dosyaya çevrilemedi. İşaretli sorunları düzeltip tekrar deneyin.', en: 'The edited content could not be turned into a file. Fix the listed issues and try again.' },
    LCWAI_OUTPUT_TEMPLATE_NOT_FOUND: { tr: 'Çıktı şablonu bulunamadı; silinmiş olabilir.', en: 'The output template was not found; it may have been deleted.' },
    LCWAI_OUTPUT_TEMPLATE_INVALID: { tr: 'Şablon adı ve dosya biçimi zorunludur.', en: 'A template name and file format are required.' },
    LCWAI_OUTPUT_TEMPLATE_FORBIDDEN: { tr: 'Bu ekip şablonunu yalnız sahibi ya da bir moderatör değiştirebilir.', en: 'Only the owner or a moderator can change this team template.' },
    LCWAI_QUOTA_EXCEEDED: { tr: 'LCW AI dosya kotanız doldu. Eski sohbet dosyalarını silip tekrar deneyin.', en: 'Your LCW AI file quota is full. Delete old chat files and try again.' },
    LCWAI_INVALID_RESPONSE: { tr: 'LCW AI’ın cevabı anlaşılamadı. Tekrar deneyin ya da isteği sadeleştirin.', en: 'The LCW AI answer could not be understood. Try again or simplify the request.' },
    LCWAI_SCHEMA_MISMATCH: { tr: 'LCW AI beklenen biçimde bir öneri üretmedi. Tekrar deneyin ya da isteği netleştirin.', en: 'LCW AI did not produce a suggestion in the expected format. Try again or clarify the request.' },
    LCWAI_CANCELLED: { tr: 'LCW AI isteği iptal edildi.', en: 'The LCW AI request was cancelled.' },
    LCWAI_BUSY: { tr: 'Aynı anda çok fazla LCW AI isteği var. Öncekinin bitmesini bekleyin.', en: 'Too many LCW AI requests at once. Wait for the previous one to finish.' },
    LCWAI_BAD_REQUEST: { tr: 'LCW AI isteği geçersiz.', en: 'The LCW AI request is invalid.' },
    LCWAI_INTERNAL: { tr: 'LCW AI isteği tamamlanamadı.', en: 'The LCW AI request could not be completed.' },
  };
  const LOGIN_CODES = new Set(['LCWAI_AUTH_REQUIRED', 'LCWAI_SESSION_EXPIRED', 'LCWAI_BROWSER_UNAVAILABLE', 'LCWAI_LOGIN_TIMEOUT']);

  function lcwError(payload) {
    const data = payload && typeof payload === 'object' ? payload : {};
    const code = /^LCWAI_[A-Z_]+$/.test(String(data.code || '')) ? data.code : 'LCWAI_INTERNAL';
    const error = new Error(errorText({ code }));
    error.code = code;
    error.action = data.action || (LOGIN_CODES.has(code) ? 'login' : '');
    error.retryable = Boolean(data.retryable);
    error.lcwai = true;
    if (code === 'LCWAI_QUOTA_EXCEEDED' && data.remoteMessage) error.remoteMessage = String(data.remoteMessage).slice(0, 200);
    if (code === 'LCWAI_OUTPUT_EDIT_INVALID' && Array.isArray(data.issues)) error.issues = data.issues.slice(0, 6).map(item => String(item).slice(0, 240));
    return error;
  }
  function errorText(error) {
    const code = String(error && error.code || '');
    if (ERROR_TEXT[code]) return textOf(ERROR_TEXT[code]);
    // Kodsuz/ağ hatası: ham mesaj gösterilmez.
    return textOf(ERROR_TEXT.LCWAI_INTERNAL);
  }
  function needsLogin(error) { return Boolean(error && (error.action === 'login' || LOGIN_CODES.has(String(error.code || '')))); }

  /* Mevcut Buyer Log bildirim sistemi (BLUI.notify). Oturum hatalarında
     "LCW AI Girişi Yap" aksiyonu sunulur. */
  function notifyError(error) {
    if (error && error.code === 'LCWAI_CANCELLED') return;
    const message = errorText(error);
    const notify = root.BLUI && root.BLUI.notify;
    if (typeof notify === 'function') {
      notify(message, {
        kind: needsLogin(error) ? 'warning' : 'error',
        language: isEn() ? 'en' : 'tr',
        actions: needsLogin(error) ? [{ id: 'lcwai-login', label: L('LCW AI Girişi Yap', 'Sign in to LCW AI'), primary: true }] : [],
        onAction: (id, { close }) => { if (id === 'lcwai-login') { close(); return connect(); } return null; },
      });
      return;
    }
    if (typeof root.showToast === 'function') root.showToast(message);
  }

  async function api(url, options = {}) {
    let response;
    try { response = await fetch(url, { credentials: 'same-origin', ...options }); }
    catch (error) { if (error && error.name === 'AbortError') throw lcwError({ code: 'LCWAI_CANCELLED' }); throw lcwError({ code: 'LCWAI_NETWORK' }); }
    let data = null;
    try { data = await response.json(); } catch (_) {}
    if (!response.ok || !data || data.ok === false) throw lcwError(data);
    return data;
  }

  function loadConfig() {
    if (!configPromise) {
      configPromise = api('/api/lcwai/config').then(data => {
        if (data && data.config && data.config.defaultModelLabel) modelLabel = String(data.config.defaultModelLabel);
        return data.config;
      }).catch(error => { configPromise = null; throw error; });
    }
    return configPromise;
  }

  function publishStatus(status) {
    lastStatus = status || null;
    if (status && status.modelLabel) modelLabel = String(status.modelLabel);
    for (const listener of statusListeners) { try { listener(lastStatus); } catch (_) {} }
    return lastStatus;
  }
  /* Masaüstü arka plan oturumu (PLM Sync deseni): Electron gizli, kalıcı
     bölümde LCW AI'ı açar; SSO çerezleriyle token kullanıcı tarayıcı
     görmeden alınır. Köprü yoksa (tarayıcı kipi/eski kabuk) Edge yolu. */
  const desktopAuth = () => (root.buyerLogDesktop && typeof root.buyerLogDesktop.ensureLcwAiAuth === 'function' ? root.buyerLogDesktop : null);
  let silentAuth = null;
  let silentAuthAt = 0;
  function silentDesktopAuth({ force = false } = {}) {
    const desktop = desktopAuth();
    if (!desktop) return Promise.resolve(false);
    if (silentAuth) return silentAuth;
    if (!force && Date.now() - silentAuthAt < 60000) return Promise.resolve(false);
    silentAuthAt = Date.now();
    silentAuth = Promise.resolve(desktop.ensureLcwAiAuth({ interactive: false }))
      .then(result => Boolean(result && result.ok), () => false)
      .finally(() => { silentAuth = null; });
    return silentAuth;
  }
  async function getStatus({ refresh = true } = {}) {
    const data = await api(`/api/lcwai/status${refresh ? '' : '?refresh=0'}`);
    const status = data.status;
    // Bağlı değilse önce sessiz arka plan girişi denenir (dakikada en fazla bir).
    if (refresh && status && !status.connected && !status.loginInProgress && await silentDesktopAuth()) {
      return publishStatus((await api('/api/lcwai/status')).status);
    }
    return publishStatus(status);
  }
  /* Oturum gerektiren hata → sessiz arka plan girişi → bir kez yeniden dene. */
  async function withDesktopAuth(run) {
    try { return await run(); }
    catch (error) {
      if (!needsLogin(error) || !(await silentDesktopAuth({ force: true }))) throw error;
      return run();
    }
  }
  function onStatus(listener) {
    if (typeof listener !== 'function') return () => {};
    statusListeners.add(listener);
    return () => statusListeners.delete(listener);
  }

  /* LCW AI girişi: sunucu mevcut kurumsal Edge profilinde LCW AI'ı açar;
     kullanıcı tarayıcıda NORMAL şekilde giriş yapar (Buyer Log parola
     istemez/görmez). Buradan durum izlenir. */
  let connectInFlight = null;
  function connect({ quiet = false } = {}) {
    if (connectInFlight) return connectInFlight;
    const promise = (async () => {
      const notify = root.BLUI && root.BLUI.notify;
      let closeInfo = null;
      if (!quiet && typeof notify === 'function') {
        closeInfo = notify(desktopAuth()
          ? L('LCW AI oturumu arka planda açılıyor. Giriş gerekirse küçük bir LCW AI penceresi görünür; Buyer Log parolanızı görmez.', 'Opening the LCW AI session in the background. If sign-in is needed a small LCW AI window appears; Buyer Log never sees your password.')
          : L('LCW AI açılıyor. Tarayıcıda kurumsal hesabınızla giriş yapın; Buyer Log parolanızı görmez.', 'Opening LCW AI. Sign in with your corporate account in the browser; Buyer Log never sees your password.'), { kind: 'loading', language: isEn() ? 'en' : 'tr' });
      }
      try {
        const desktop = desktopAuth();
        if (desktop) {
          // Masaüstü: önce sessiz; gerekirse giriş penceresi yalnız bir kez görünür.
          const result = (await silentDesktopAuth({ force: true })) ? { ok: true } : await desktop.ensureLcwAiAuth({ interactive: true });
          const status = publishStatus((await api('/api/lcwai/status')).status);
          if (result && result.ok && status && status.connected) {
            if (!quiet && typeof root.showToast === 'function') root.showToast(L('LCW AI bağlı (arka plan oturumu).', 'LCW AI is connected (background session).'), { kind: 'success' });
            return status;
          }
          throw lcwError({ code: result && result.code === 'LCWAI_AUTH_CANCELLED' ? 'LCWAI_CANCELLED' : 'LCWAI_LOGIN_TIMEOUT' });
        }
        let status = publishStatus((await api('/api/lcwai/connect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status);
        const deadline = Date.now() + 5 * 60 * 1000 + 5000;
        while (status && status.loginInProgress && Date.now() < deadline) {
          await new Promise(resolve => setTimeout(resolve, 1500));
          status = await getStatus({ refresh: false });
        }
        if (status && status.connected) {
          if (!quiet && typeof root.showToast === 'function') root.showToast(L('LCW AI bağlı.', 'LCW AI is connected.'), { kind: 'success' });
          return status;
        }
        throw lcwError(status && status.lastError ? status.lastError : { code: 'LCWAI_LOGIN_TIMEOUT' });
      } catch (error) {
        if (!quiet) notifyError(error);
        throw error;
      } finally { if (typeof closeInfo === 'function') closeInfo(); }
    })();
    connectInFlight = promise;
    promise.finally(() => { if (connectInFlight === promise) connectInFlight = null; }).catch(() => {});
    return promise;
  }
  async function disconnect() {
    // Masaüstü arka plan oturumu da kapatılır (çerezler silinir; sonraki
    // bağlantıda yeniden giriş istenir).
    const desktop = root.buyerLogDesktop;
    if (desktop && typeof desktop.clearLcwAiAuth === 'function') { try { await desktop.clearLcwAiAuth(); } catch (_) {} }
    silentAuthAt = Date.now();
    const data = await api('/api/lcwai/disconnect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    return publishStatus(data.status);
  }

  /* NDJSON akışı: {type:'progress'|'result'|'error'} satırları. */
  async function readEvents(response, onEvent) {
    const reader = response.body && response.body.getReader ? response.body.getReader() : null;
    if (!reader) { const text = await response.text(); text.split('\n').forEach(line => { if (line.trim()) onEvent(JSON.parse(line)); }); return; }
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let index;
      while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index).trim();
        buffer = buffer.slice(index + 1);
        if (line) onEvent(JSON.parse(line));
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) onEvent(JSON.parse(buffer.trim()));
  }

  /* Temel çağrı. Dönüş: { requestId, text, data, structured, model, … }.
     data, kaynağın sözleşmesine uyan yapılandırılmış öneridir (uymazsa null;
     modül ham metinden kendi yedek ayıklamasını yapabilir). */
  async function ask(options = {}) {
    const requestId = String(options.requestId || `bl${Date.now().toString(36)}${(++requestSeq).toString(36)}`);
    const controller = new AbortController();
    if (options.signal) { if (options.signal.aborted) controller.abort(); else options.signal.addEventListener('abort', () => controller.abort(), { once: true }); }
    active.set(requestId, controller);
    const onProgress = typeof options.onProgress === 'function' ? options.onProgress : () => {};
    try {
      let response;
      try {
        response = await fetch('/api/lcwai/ask', {
          method: 'POST', credentials: 'same-origin', signal: controller.signal,
          headers: { 'Content-Type': 'application/json', Accept: 'application/x-ndjson' },
          body: JSON.stringify({ requestId, source: options.source, task: options.task, context: options.context || {}, guide: options.guide || '', lang: options.lang || (isEn() ? 'en' : 'tr'), attachments: options.attachments || [] }),
        });
      } catch (error) { throw lcwError({ code: error && error.name === 'AbortError' ? 'LCWAI_CANCELLED' : 'LCWAI_NETWORK' }); }
      if (!response.ok) { let data = null; try { data = await response.json(); } catch (_) {} throw lcwError(data); }
      let result = null, failure = null;
      try {
        await readEvents(response, event => {
          if (event.type === 'progress') { try { onProgress(event); } catch (_) {} }
          else if (event.type === 'result') result = event.result;
          else if (event.type === 'error') failure = lcwError(event.error);
        });
      } catch (error) {
        if (controller.signal.aborted) throw lcwError({ code: 'LCWAI_CANCELLED' });
        throw lcwError({ code: 'LCWAI_STREAM_INTERRUPTED' });
      }
      if (failure) throw failure;
      if (!result) throw lcwError({ code: controller.signal.aborted ? 'LCWAI_CANCELLED' : 'LCWAI_STREAM_INTERRUPTED' });
      if (result.model && result.model.label) modelLabel = String(result.model.label);
      if (lastStatus && !lastStatus.connected) getStatus({ refresh: false }).catch(() => {});
      return result;
    } catch (error) {
      if (needsLogin(error)) getStatus({ refresh: false }).catch(() => {});
      throw error;
    } finally { active.delete(requestId); }
  }

  async function uploadFile(file, { signal } = {}) {
    if (!file || typeof file.arrayBuffer !== 'function') throw lcwError({ code: 'LCWAI_BAD_REQUEST' });
    const data = await api('/api/lcwai/files', {
      method: 'POST', signal,
      headers: { 'Content-Type': file.type || 'application/octet-stream', 'X-LCWAI-File-Name': encodeURIComponent(file.name || 'file') },
      body: file,
    });
    return data.attachment;
  }
  async function askWithFiles(options = {}) {
    const files = Array.from(options.files || []);
    const attachments = Array.isArray(options.attachments) ? options.attachments.slice() : [];
    const onProgress = typeof options.onProgress === 'function' ? options.onProgress : () => {};
    for (let index = 0; index < files.length; index++) {
      onProgress({ phase: 'uploading', index, total: files.length });
      attachments.push(await uploadFile(files[index], { signal: options.signal }));
    }
    return ask({ ...options, attachments });
  }

  function cancel(requestId) {
    const ids = requestId ? [String(requestId)] : [...active.keys()];
    for (const id of ids) {
      const controller = active.get(id);
      if (controller) controller.abort();
      fetch('/api/lcwai/cancel', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId: id }) }).catch(() => {});
    }
    return ids.length > 0;
  }

  /* ---------------- Bağlantı durumu (kullanıcı menüsü) ---------------- */
  function statusBadge(status) {
    if (!status) return { kind: 'unknown', text: L('Kontrol ediliyor…', 'Checking…') };
    if (status.loginInProgress) return { kind: 'busy', text: L('Giriş bekleniyor…', 'Waiting for sign-in…') };
    if (status.connected) return status.source === 'desktop-sso'
      ? { kind: 'ok', text: L('✓ Bağlı · arka plan', '✓ Connected · background') }
      : { kind: 'ok', text: L('✓ LCW AI Bağlı', '✓ LCW AI Connected') };
    if (status.state === 'expired') return { kind: 'warn', text: L('⚠ LCW AI Oturumu Yenilenmeli', '⚠ LCW AI Session Needs Renewal') };
    return { kind: 'off', text: L('LCW AI Girişi Yap', 'Sign in to LCW AI') };
  }

  function openConnectionDialog() {
    if (!root.document) return;
    root.document.getElementById('_lcwaiConnection')?.remove();
    const modal = root.document.createElement('div');
    modal.id = '_lcwaiConnection';
    modal.className = 'warnOverlay';
    modal.innerHTML = `<div class="modalCard verHistCard lcwaiConnCard" role="dialog" aria-modal="true" aria-labelledby="lcwaiConnTitle">
        <div class="verHistTop"><div><h2 id="lcwaiConnTitle">${esc(L('LCW AI Girişi', 'LCW AI Sign-In'))}</h2><p class="verHistSub">${esc(L('Kurumsal LCW AI oturumu · model', 'Corporate LCW AI session · model'))} ${esc(modelLabel)}</p></div><button type="button" class="verHistClose" data-lcwai-close aria-label="${esc(L('Kapat', 'Close'))}"><svg class="ic"><use href="#i-x"/></svg></button></div>
        <div class="lcwaiConnBody">
          <div class="lcwaiConnState" data-lcwai-state></div>
          <p class="muted">${esc(L('Giriş, mevcut kurumsal Edge/Chrome profilinizde LCW AI sitesinde yapılır. Buyer Log parola istemez; oturum bilgisi yalnız uygulama belleğinde tutulur, diske yazılmaz ve gösterilmez. AI istekleri doğrudan LCW AI servisine gider.', 'Sign-in happens on the LCW AI site in your existing corporate Edge/Chrome profile. Buyer Log never asks for a password; the session is kept only in app memory, never written to disk or shown. AI requests go directly to the LCW AI service.'))}</p>
          <p class="muted">${esc(L('LCW AI sekmesini açık bırakmanız önerilir: oturum kısa ömürlüdür ve Buyer Log yeni oturumu o sekmeden sessizce alır.', 'Keeping the LCW AI tab open is recommended: the session is short-lived and Buyer Log silently picks up the renewed session from that tab.'))}</p>
        </div>
        <div class="verHistFoot"><button type="button" class="tbtn" data-lcwai-disconnect>${esc(L('Bağlantıyı kes', 'Disconnect'))}</button><span style="flex:1"></span><button type="button" class="tbtn primary" data-lcwai-connect>${esc(L('LCW AI Girişi Yap', 'Sign in to LCW AI'))}</button><button type="button" class="tbtn" data-lcwai-close>${esc(L('Kapat', 'Close'))}</button></div>
      </div>`;
    root.document.body.appendChild(modal);
    const stateBox = modal.querySelector('[data-lcwai-state]');
    const connectBtn = modal.querySelector('[data-lcwai-connect]');
    const paint = status => {
      if (!modal.isConnected) return;
      const badge = statusBadge(status);
      stateBox.className = `lcwaiConnState is-${badge.kind}`;
      stateBox.textContent = badge.text;
      connectBtn.textContent = status && status.connected ? L('Oturumu yenile', 'Renew session') : L('LCW AI Girişi Yap', 'Sign in to LCW AI');
      connectBtn.disabled = Boolean(status && status.loginInProgress);
    };
    const unsubscribe = onStatus(paint);
    const close = () => { unsubscribe(); modal.remove(); };
    modal.querySelectorAll('[data-lcwai-close]').forEach(button => button.addEventListener('click', close));
    modal.addEventListener('click', event => { if (event.target === modal) close(); });
    connectBtn.addEventListener('click', () => { connect().catch(() => {}); });
    modal.querySelector('[data-lcwai-disconnect]').addEventListener('click', () => { disconnect().catch(notifyError); });
    paint(lastStatus);
    getStatus().catch(() => paint({ state: 'disconnected' }));
  }

  /* ---------------- Ortak asistan paneli ----------------
     options:
       source         sözleşme anahtarı ('calculated-column' | 'rules' | 'automations' | …)
       placeholder    {tr,en} | string
       initialRequest başlangıç metni
       onRequestChange(text)
       buildRequest(text)  → { task, context, guide } (async olabilir)
       interpret(result)   → { ok, value, html, issues:[string], explanation, warnings:[string] }
                              Modülün KENDİ doğrulayıcısıdır (formül motoru,
                              kural motoru, otomasyon denetimi).
       onApply(value, interpreted)  → modülün mevcut akışına uygular (kaydetmez)
       applyLabel     {tr,en} | string
  */
  function mountAssistant(host, options = {}) {
    if (!host) return null;
    const state = { request: String(options.initialRequest || ''), busy: false, requestId: '', interpreted: null, destroyed: false };
    const label = value => textOf(value);
    host.innerHTML = `<section class="lcwaiAssist" data-lcwai-assist data-lcwai-source="${esc(options.source || '')}">
        <header class="lcwaiHead"><span class="lcwaiMark" aria-hidden="true">✦</span><b>${esc(L('LCW AI’dan Destek Al', 'Get help from LCW AI'))}</b><small class="lcwaiModel" data-lcwai-model>${esc(modelLabel)}</small><span class="lcwaiConnPill" data-lcwai-conn hidden></span></header>
        <label class="lcwaiField"><span>${esc(L('İsteğiniz', 'Your request'))}</span>
          <textarea data-lcwai-request rows="3" maxlength="4000" placeholder="${esc(label(options.placeholder) || L('Ne istediğinizi kendi cümlenizle yazın.', 'Describe what you want in your own words.'))}">${esc(state.request)}</textarea></label>
        <div class="lcwaiRow">
          <button type="button" class="lcwaiBtn is-primary" data-lcwai-ask>✦ ${esc(L('LCW AI’dan Destek Al', 'Get help from LCW AI'))}</button>
          <button type="button" class="lcwaiBtn" data-lcwai-cancel hidden>${esc(L('İptal', 'Cancel'))}</button>
          <span class="lcwaiStatus" data-lcwai-status aria-live="polite"></span>
        </div>
        <details class="lcwaiLive" data-lcwai-live hidden><summary>${esc(L('Canlı yanıt', 'Live response'))}</summary><pre data-lcwai-live-text></pre></details>
        <div class="lcwaiSuggestion" data-lcwai-suggestion hidden>
          <div class="lcwaiSuggestionHead">${esc(L('LCW AI önerisi', 'LCW AI suggestion'))}</div>
          <div data-lcwai-result></div>
          <p class="lcwaiExplain" data-lcwai-explain hidden></p>
          <ul class="lcwaiWarnings" data-lcwai-warnings hidden></ul>
          <div class="lcwaiRow">
            <button type="button" class="lcwaiBtn is-primary" data-lcwai-apply>${esc(label(options.applyLabel) || L('Uygula', 'Apply'))}</button>
            <button type="button" class="lcwaiBtn" data-lcwai-retry>${esc(L('Tekrar Dene', 'Try Again'))}</button>
            <button type="button" class="lcwaiBtn" data-lcwai-dismiss>${esc(L('İptal', 'Cancel'))}</button>
          </div>
          <p class="lcwaiNote">${esc(L('Öneri siz uygulamadan hiçbir şeyi değiştirmez; uyguladıktan sonra da kaydetmeden önce kontrol edebilirsiniz.', 'The suggestion changes nothing until you apply it; after applying you can still review before saving.'))}</p>
        </div>
      </section>`;
    const $ = selector => host.querySelector(selector);
    const requestBox = $('[data-lcwai-request]');
    const statusBox = $('[data-lcwai-status]');
    const askBtn = $('[data-lcwai-ask]');
    const cancelBtn = $('[data-lcwai-cancel]');
    const live = $('[data-lcwai-live]');
    const liveText = $('[data-lcwai-live-text]');
    const suggestion = $('[data-lcwai-suggestion]');
    const resultBox = $('[data-lcwai-result]');
    const explainBox = $('[data-lcwai-explain]');
    const warningsBox = $('[data-lcwai-warnings]');
    const applyBtn = $('[data-lcwai-apply]');
    const connPill = $('[data-lcwai-conn]');

    const setStatus = (text, kind = '', loginAction = false) => {
      statusBox.className = `lcwaiStatus${kind ? ` is-${kind}` : ''}`;
      statusBox.innerHTML = `${esc(text)}${loginAction ? ` <button type="button" class="lcwaiBtn is-link" data-lcwai-login>${esc(L('LCW AI Girişi Yap', 'Sign in to LCW AI'))}</button>` : ''}`;
      statusBox.querySelector('[data-lcwai-login]')?.addEventListener('click', () => { connect().then(() => setStatus(L('LCW AI bağlı. Şimdi tekrar deneyebilirsiniz.', 'LCW AI is connected. You can try again now.'), 'ok')).catch(() => {}); });
    };
    const paintConn = status => {
      // Panel DOM'dan çıktıysa (mod değişti, pencere kapandı) dinleyici bırakılır.
      if (!state.destroyed && !host.isConnected) { state.destroyed = true; unsubscribe(); if (state.busy) cancel(state.requestId); }
      if (state.destroyed || !connPill) return;
      const modelEl = $('[data-lcwai-model]');
      if (modelEl) modelEl.textContent = modelLabel;
      if (!status || status.connected) { connPill.hidden = true; return; }
      const badge = statusBadge(status);
      connPill.hidden = false;
      connPill.className = `lcwaiConnPill is-${badge.kind}`;
      connPill.textContent = badge.text;
    };
    const unsubscribe = onStatus(paintConn);
    const setBusy = busy => {
      state.busy = busy;
      askBtn.disabled = busy;
      cancelBtn.hidden = !busy;
      requestBox.readOnly = busy;
    };
    const hideSuggestion = () => { suggestion.hidden = true; state.interpreted = null; };

    async function run() {
      if (state.busy) return;
      const text = String(requestBox.value || '').trim();
      if (!text) { setStatus(L('Önce ne istediğinizi yazın.', 'First describe what you want.'), 'warn'); requestBox.focus(); return; }
      hideSuggestion();
      setBusy(true);
      live.hidden = true; liveText.textContent = '';
      setStatus(L(`${modelLabel} düşünüyor…`, `${modelLabel} is thinking…`), 'busy');
      state.requestId = `bl${Date.now().toString(36)}${(++requestSeq).toString(36)}`;
      try {
        const request = await options.buildRequest(text);
        const result = await ask({
          ...request, source: options.source, requestId: state.requestId,
          onProgress: event => {
            if (state.destroyed) return;
            if (event.phase === 'uploading') setStatus(L('Dosya yükleniyor…', 'Uploading file…'), 'busy');
            if (event.phase === 'streaming') {
              live.hidden = false;
              if (event.delta) liveText.textContent += event.delta;
              setStatus(L(`LCW AI yazıyor… ${event.chars || 0} karakter`, `LCW AI is writing… ${event.chars || 0} characters`), 'busy');
            }
          },
        });
        if (state.destroyed) return;
        let interpreted;
        try { interpreted = await options.interpret(result); }
        catch (_) { interpreted = { ok: false, issues: [errorText({ code: 'LCWAI_INVALID_RESPONSE' })] }; }
        state.interpreted = interpreted || { ok: false };
        resultBox.innerHTML = state.interpreted.html || '';
        const issues = (state.interpreted.issues || []).filter(Boolean);
        if (issues.length) resultBox.insertAdjacentHTML('beforeend', `<ul class="lcwaiIssues">${issues.map(item => `<li>${esc(item)}</li>`).join('')}</ul>`);
        const partialData = result.structured && result.structured.partial;
        const explanation = String(state.interpreted.explanation || (result.data && result.data.explanation) || (partialData && partialData.explanation) || '').trim();
        explainBox.hidden = !explanation;
        explainBox.textContent = explanation;
        const warnings = (state.interpreted.warnings || (result.data && result.data.warnings) || (partialData && partialData.warnings) || []).filter(Boolean);
        warningsBox.hidden = !warnings.length;
        warningsBox.innerHTML = warnings.map(item => `<li>${esc(item)}</li>`).join('');
        applyBtn.disabled = !state.interpreted.ok;
        suggestion.hidden = false;
        setStatus(state.interpreted.ok
          ? L('Öneri hazır. İnceleyip “Uygula”ya basın.', 'The suggestion is ready. Review it and press “Apply”.')
          : L('Öneri doğrulamadan geçmedi; tekrar deneyin ya da isteği netleştirin.', 'The suggestion did not pass validation; try again or clarify the request.'), state.interpreted.ok ? 'ok' : 'warn');
      } catch (error) {
        if (state.destroyed) return;
        if (error && error.code === 'LCWAI_CANCELLED') setStatus(errorText(error));
        else {
          setStatus(errorText(error), 'error', needsLogin(error));
          if (error && error.code === 'LCWAI_SESSION_EXPIRED') notifyError(error);
        }
      } finally { if (!state.destroyed) setBusy(false); }
    }

    requestBox.addEventListener('input', () => { state.request = requestBox.value; if (typeof options.onRequestChange === 'function') options.onRequestChange(requestBox.value); });
    requestBox.addEventListener('keydown', event => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); run(); } });
    askBtn.addEventListener('click', run);
    $('[data-lcwai-retry]').addEventListener('click', run);
    cancelBtn.addEventListener('click', () => { cancel(state.requestId); });
    $('[data-lcwai-dismiss]').addEventListener('click', () => { hideSuggestion(); setStatus(''); });
    applyBtn.addEventListener('click', () => {
      if (!state.interpreted || !state.interpreted.ok) return;
      try {
        options.onApply(state.interpreted.value, state.interpreted);
        hideSuggestion();
        setStatus(L('Öneri uygulandı. Kaydetmeden önce kontrol edin.', 'The suggestion was applied. Review it before saving.'), 'ok');
      } catch (_) { setStatus(L('Öneri uygulanamadı; mevcut ayar değiştirilmedi.', 'The suggestion could not be applied; the current setting was not changed.'), 'error'); }
    });
    if (lastStatus) paintConn(lastStatus);
    else getStatus({ refresh: false }).catch(() => {});
    loadConfig().then(() => paintConn(lastStatus)).catch(() => {});
    return {
      element: host.firstElementChild,
      run,
      setRequest(text) { requestBox.value = String(text || ''); state.request = requestBox.value; },
      destroy() { state.destroyed = true; unsubscribe(); if (state.busy) cancel(state.requestId); },
    };
  }

  /* Modülün kendi alanı olmayan yerler için aynı panelin modal hâli. */
  function openPanel(options = {}) {
    if (!root.document) return null;
    root.document.getElementById('_lcwaiPanel')?.remove();
    const modal = root.document.createElement('div');
    modal.id = '_lcwaiPanel';
    modal.className = 'warnOverlay';
    modal.innerHTML = `<div class="modalCard verHistCard lcwaiPanelCard" role="dialog" aria-modal="true" aria-label="${esc(L('LCW AI’dan Destek Al', 'Get help from LCW AI'))}"><div class="verHistTop"><div><h2>${esc(textOf(options.title) || L('LCW AI’dan Destek Al', 'Get help from LCW AI'))}</h2></div><button type="button" class="verHistClose" data-lcwai-panel-close aria-label="${esc(L('Kapat', 'Close'))}"><svg class="ic"><use href="#i-x"/></svg></button></div><div class="lcwaiPanelBody" data-lcwai-panel-host></div></div>`;
    root.document.body.appendChild(modal);
    let mounted = null;
    const close = () => { if (mounted) mounted.destroy(); modal.remove(); };
    mounted = mountAssistant(modal.querySelector('[data-lcwai-panel-host]'), { ...options, onApply: (value, interpreted) => { options.onApply(value, interpreted); close(); } });
    modal.querySelector('[data-lcwai-panel-close]').addEventListener('click', close);
    modal.addEventListener('click', event => { if (event.target === modal) close(); });
    modal.querySelector('[data-lcwai-request]')?.focus();
    return { close, assistant: mounted };
  }

  /* Modüllerin ortak yardımcısı: cevaptaki yapılandırılmış alanı alır;
     sözleşme tutmadıysa modülün kendi ayıklayıcısıyla ham metne düşer. */
  function pickField(result, field, fallbackExtract) {
    const value = result && result.data && typeof result.data[field] === 'string' ? result.data[field].trim() : '';
    if (value) return { value, structured: true };
    const partialData = result && result.structured && result.structured.partial && typeof result.structured.partial === 'object' ? result.structured.partial : null;
    const partial = partialData && typeof partialData[field] === 'string' ? partialData[field].trim() : '';
    if (partial) return { value: partial, structured: false };
    /* Cevap geçerli bir JSON'du ama alan boş: LCW AI bilerek öneri vermedi
       (nedeni "explanation"da). Ham metin formül/kod sanılmaz — eskiden JSON
       metninin kendisi formül diye denetlenip "Desteklenmeyen karakter: {"
       hatası çıkıyordu. */
    if (partialData) return { value: '', structured: true, declined: true, explanation: String(partialData.explanation || '').trim() };
    const text = String(result && result.text || '');
    const extracted = typeof fallbackExtract === 'function' ? String(fallbackExtract(text) || '').trim() : '';
    return { value: extracted, structured: false };
  }

  /* ---------------- Genel sohbet (Global LCW AI) ----------------
     Aynı ask() yolunun sohbet uç noktası. chatId=null yeni sohbet açar;
     dönen chatId ile devam edilir (geçmişi LCW AI tutar). */
  async function chat(options = {}) {
    const requestId = String(options.requestId || `bl${Date.now().toString(36)}${(++requestSeq).toString(36)}`);
    const controller = new AbortController();
    if (options.signal) { if (options.signal.aborted) controller.abort(); else options.signal.addEventListener('abort', () => controller.abort(), { once: true }); }
    active.set(requestId, controller);
    const onProgress = typeof options.onProgress === 'function' ? options.onProgress : () => {};
    try {
      let response;
      try {
        response = await fetch('/api/lcwai/chat', {
          method: 'POST', credentials: 'same-origin', signal: controller.signal,
          headers: { 'Content-Type': 'application/json', Accept: 'application/x-ndjson' },
          body: JSON.stringify({ requestId, chatId: options.chatId || null, message: options.message || '', contexts: options.contexts || [], attachments: options.attachments || [], lang: options.lang || (isEn() ? 'en' : 'tr'), output: options.output && options.output.format ? options.output : undefined }),
        });
      } catch (error) { throw lcwError({ code: error && error.name === 'AbortError' ? 'LCWAI_CANCELLED' : 'LCWAI_NETWORK' }); }
      if (!response.ok) { let data = null; try { data = await response.json(); } catch (_) {} throw lcwError(data); }
      let result = null, failure = null;
      try {
        await readEvents(response, event => {
          if (event.type === 'progress') { try { onProgress(event); } catch (_) {} }
          else if (event.type === 'result') result = event.result;
          else if (event.type === 'error') failure = lcwError(event.error);
        });
      } catch (error) {
        if (controller.signal.aborted) throw lcwError({ code: 'LCWAI_CANCELLED' });
        throw lcwError({ code: 'LCWAI_STREAM_INTERRUPTED' });
      }
      if (failure) throw failure;
      if (!result) throw lcwError({ code: controller.signal.aborted ? 'LCWAI_CANCELLED' : 'LCWAI_STREAM_INTERRUPTED' });
      if (result.model && result.model.label) modelLabel = String(result.model.label);
      let finalResult = result;
      // Çıktı model görseli kullanıyorsa: görseller renderer'da (yerel depo)
      // çözülür, sunucu dosyayı görsellerle oluşturur.
      if (finalResult.output && finalResult.output.pending === 'images') {
        const pending = finalResult.output;
        let images = {};
        try { images = typeof options.resolveImages === 'function' ? (await options.resolveImages(pending.tokens || [])) || {} : {}; } catch (_) { images = {}; }
        const data = await api(`/api/lcwai/outputs/${encodeURIComponent(String(pending.pendingId || ''))}/images`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ images }) });
        finalResult = { ...finalResult, output: data.output };
      }
      return finalResult.output && finalResult.output.pending === 'pdf' ? await finalizePdf(finalResult, onProgress) : finalResult;
    } catch (error) {
      if (needsLogin(error)) getStatus({ refresh: false }).catch(() => {});
      throw error;
    } finally { active.delete(requestId); }
  }

  /* ---------------- AI Çıktı Oluşturma (Export Engine) ----------------
     PDF son adımı: sunucunun temizlediği rapor HTML'i masaüstü kabuğunda
     (Chromium printToPDF; JS kapalı, ağ engelli gizli pencere) basılır ve
     baytlar AI Outputs'a kaydedilir. HTML bu sayfanın DOM'una hiç girmez.
     Kabuk yoksa (tarayıcı kipi) ya da baskı başarısızsa rapor HTML olarak
     kaydedilir; kullanıcı onu açıp Yazdır → PDF yapabilir. */
  async function finalizePdf(result, onProgress) {
    const pending = result.output;
    const id = encodeURIComponent(String(pending.pendingId || ''));
    const desktop = root.buyerLogDesktop;
    let record = null;
    if (desktop && typeof desktop.renderPdf === 'function') {
      try { onProgress({ phase: 'output', step: 'pdf' }); } catch (_) {}
      try {
        const rendered = await desktop.renderPdf(pending.html, { landscape: pending.landscape });
        if (rendered && rendered.ok && rendered.data) {
          record = (await api(`/api/lcwai/outputs/${id}/pdf`, { method: 'POST', headers: { 'Content-Type': 'application/pdf' }, body: rendered.data })).output;
        }
      } catch (_) { record = null; }
    }
    if (!record) record = { ...(await api(`/api/lcwai/outputs/${id}/fallback`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).output, fallback: 'html' };
    return { ...result, output: record };
  }
  const outputAction = action => async (id, fileName = '') => {
    // Masaüstünde yeni LCW AI çıktıları doğrudan Downloads'a kaydedilir.
    // Aç/Göster işlemini Electron shell yapar; renderer yalnız dosya adını
    // verebilir. Dosya eski konumdaysa aşağıdaki sunucu yolu geriye uyumludur.
    const desktop = root.buyerLogDesktop;
    const nativeAction = action === 'open' ? desktop && desktop.openGeneratedDownload : desktop && desktop.revealGeneratedDownload;
    if (fileName && typeof nativeAction === 'function') {
      try {
        const result = await nativeAction(fileName);
        if (result && result.ok) return true;
      } catch (_) { /* legacy/server fallback below */ }
    }
    const data = await api(`/api/lcwai/outputs/${encodeURIComponent(String(id || ''))}/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    if (!data.ok) throw lcwError({ code: 'LCWAI_OUTPUT_NOT_FOUND' });
    return true;
  };
  /* ---------------- AI Çıktı Düzenleyici + çıktı şablonları ----------------
     Taslak, dosyanın doğrulanmış yapısıdır (JSON ya da temizlenmiş HTML).
     Yeniden oluşturma aynı doğrulayıcıdan geçer; PDF son adımı yine masaüstü
     kabuğunda basılır (finalizePdf). LCW AI'a istek gitmez. */
  const jsonPost = (url, body, method = 'POST') => api(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
  const getDraft = async id => (await api(`/api/lcwai/output-drafts/${encodeURIComponent(String(id || ''))}`)).draft;
  async function renderDraft(id, payload = {}, options = {}) {
    const onProgress = typeof options.onProgress === 'function' ? options.onProgress : () => {};
    const data = await jsonPost(`/api/lcwai/output-drafts/${encodeURIComponent(String(id || ''))}/render`, payload);
    const result = { output: data.output, warnings: data.warnings || [] };
    return result.output && result.output.pending === 'pdf' ? finalizePdf(result, onProgress) : result;
  }
  const draftSkeleton = async (id, data) => (await jsonPost(`/api/lcwai/output-drafts/${encodeURIComponent(String(id || ''))}/skeleton`, { data })).definition;
  const templatePath = (id, shared, suffix = '') => `/api/lcwai/output-templates/${encodeURIComponent(String(id || ''))}${suffix}${shared ? '?shared=1' : ''}`;
  const outputTemplates = {
    list: () => api('/api/lcwai/output-templates'),
    create: body => jsonPost('/api/lcwai/output-templates', body),
    update: (id, shared, body) => jsonPost(templatePath(id, shared), body, 'PUT'),
    remove: (id, shared) => api(templatePath(id, shared), { method: 'DELETE' }),
    share: id => jsonPost(templatePath(id, false, '/share'), {}),
    copy: id => jsonPost(templatePath(id, false, '/copy'), {}),
  };

  const openOutput = outputAction('open');
  const revealOutput = outputAction('reveal');
  const listOutputs = async () => (await api('/api/lcwai/outputs')).outputs || [];
  const createConversation = (options = {}) => withDesktopAuth(() => chat({ ...options, chatId: null }));
  const continueConversation = (chatId, options = {}) => withDesktopAuth(() => chat({ ...options, chatId }));

  /* ---------------- Bağlam sağlayıcıları (AIContextProvider) ----------------
     Genel LCW AI ekranlara bağımlı değildir. Her ekran (veya modül) bir
     sağlayıcı kaydeder:
       { id, screen, label:{tr,en}, getOptions() → [{ id, label, detail }],
         build(optionId) → { label, screen, summary, filters, columns, rows, totalRows, text } }
     Genel sohbet yalnız getAvailableContext() / buildContext() kullanır. */
  const contextProviders = new Map();
  function registerContextProvider(provider) {
    if (!provider || !provider.id || typeof provider.getOptions !== 'function' || typeof provider.build !== 'function') return false;
    contextProviders.set(String(provider.id), provider);
    return true;
  }
  function getAvailableContext({ preferScreen = '' } = {}) {
    const groups = [];
    for (const provider of contextProviders.values()) {
      let options = [];
      try { options = (provider.getOptions() || []).filter(item => item && item.id); } catch (_) { options = []; }
      if (!options.length) continue;
      groups.push({ providerId: provider.id, screen: provider.screen || provider.id, label: textOf(provider.label), options: options.map(item => ({ id: `${provider.id}:${item.id}`, label: textOf(item.label), detail: textOf(item.detail) })) });
    }
    return groups.sort((a, b) => (b.screen === preferScreen) - (a.screen === preferScreen));
  }
  async function buildContext(contextId) {
    const [providerId, ...rest] = String(contextId || '').split(':');
    const provider = contextProviders.get(providerId);
    if (!provider) throw lcwError({ code: 'LCWAI_BAD_REQUEST' });
    const built = await provider.build(rest.join(':'));
    if (!built) throw lcwError({ code: 'LCWAI_BAD_REQUEST' });
    return { id: String(contextId), screen: provider.screen || provider.id, ...built, label: textOf(built.label) };
  }

  /* Her yerden: "LCW AI ile Analiz Et" gibi girişler genel ekranı açar ve
     istenen bağlamları önceden ekler. */
  function openChat(options = {}) {
    const pending = { contexts: Array.isArray(options.contexts) ? options.contexts.slice() : [], prompt: String(options.prompt || '') };
    root.BL_LCWAI_PENDING_OPEN = pending;
    if (typeof root.switchTab === 'function') root.switchTab('lcwai');
    root.dispatchEvent?.(new root.CustomEvent('buyerlog:lcwai-open', { detail: pending }));
    return true;
  }

  const askAuthed = options => withDesktopAuth(() => ask(options));
  const chatAuthed = options => withDesktopAuth(() => chat(options));
  const uploadAuthed = (file, options) => withDesktopAuth(() => uploadFile(file, options));
  // Persistent agent jobs still use this common transport/auth/cancellation
  // client. The business route archives the exchange around the SAME engine.
  async function runAgentOffice(options = {}) {
    const path = options.archive ? '/api/agent-office/training/review' : '/api/agent-office/run';
    const controller = new AbortController();
    const abort = () => controller.abort();
    if(options.signal){if(options.signal.aborted)abort();else options.signal.addEventListener('abort',abort,{once:true});}
    try {
      const response=await fetch(path,{method:'POST',credentials:'same-origin',signal:controller.signal,headers:{'Content-Type':'application/json',Accept:'application/x-ndjson'},body:JSON.stringify(options.payload || {})});
      if(!response.ok){const data=await response.json().catch(()=>({}));throw Object.assign(new Error(data.code || 'OFFICE_AI_FAILED'),{code:data.code || 'OFFICE_AI_FAILED'});}
      let result=null,failure=null;
      await readEvents(response,event=>{if(event.type==='progress')options.onProgress?.(event);else if(event.type==='result')result=event.result;else if(event.type==='error')failure=event.error;});
      if(failure)throw Object.assign(new Error(failure.code || 'OFFICE_AI_FAILED'),failure);
      if(!result)throw Object.assign(new Error('LCWAI_STREAM_INTERRUPTED'),{code:'LCWAI_STREAM_INTERRUPTED'});
      return result;
    }catch(err){if(controller.signal.aborted)throw lcwError({code:'LCWAI_CANCELLED'});throw err;}
    finally{options.signal?.removeEventListener('abort',abort);}
  }
  root.BuyerLogAI = {
    ask: askAuthed, askWithFiles: options => withDesktopAuth(() => askWithFiles(options)), uploadFile: uploadAuthed, cancel, getStatus, onStatus, connect, disconnect,
    chat: chatAuthed, createConversation, continueConversation, openChat,
    runAgentOffice: options => withDesktopAuth(() => runAgentOffice(options)),
    openOutput, revealOutput, listOutputs, getDraft, renderDraft, draftSkeleton, outputTemplates,
    registerContextProvider, getAvailableContext, buildContext,
    mountAssistant, openPanel, openConnectionDialog, statusBadge, pickField,
    errorText, notifyError, needsLogin, loadConfig,
    get modelLabel() { return modelLabel; },
  };
  root.LCWAI = root.BuyerLogAI;
})(typeof window !== 'undefined' ? window : null);
