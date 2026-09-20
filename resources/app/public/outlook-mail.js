/* Buyer Log v7.11 — Clean mail previews + repaired Outlook result actions. */
(() => {
  'use strict';

  const T = (tr, en) => (typeof appLang !== 'undefined' && appLang === 'en') ? en : tr;
  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[char]);
  const clean = value => String(value == null ? '' : value).trim();
  const current = () => window.BL_USER_CONTEXT || {};
  const hasCapability = code => Array.isArray(current().capabilities) && current().capabilities.includes(code);
  const canUse = () => hasCapability('OUTLOOK.SEARCH');
  const CONTEXT_FIELD_GROUPS = [
    { key:'orderNo', label:()=>T('Sipariş','Order'), members:['orderNo','poNo'] },
    { key:'plmCode', label:()=> 'PLM', members:['plmCode','styleId'] },
    { key:'modelName', label:()=>T('Model','Model'), members:['modelName','modelCode'] },
    { key:'colourCode', label:()=>T('Renk','Colour'), members:['colourCode'] },
    { key:'manufacturer', label:()=>T('Üretici','Manufacturer'), members:['manufacturer','supplier'] },
  ];
  const state = { drawer: null, context: null, module: '', status: null, features: {}, mailboxes:{personal:[],shared:[],managed:[]}, page: 0, items: new Map(), linked:new Map(), controller: null, requestId: 0, loading: false, authPopup: null, authTimer: null, contextFields:new Set() };

  function pick(row, keys) {
    for (const key of keys) { const value = row && row[key]; if (value != null && clean(value)) return clean(value); }
    return '';
  }
  function buildContext(row) {
    const source = row && typeof row === 'object' ? row : {};
    return Object.fromEntries(Object.entries({
      orderNo: pick(source, ['orderNo','Order Code','Order No','Order Number','Sipariş Kod','Sipariş Kodu','Sipariş No','PO No','PO']),
      poNo: pick(source, ['poNo','PO No','PO','Purchase Order','PurchaseOrder']),
      plmCode: pick(source, ['plmCode','PLM ID','PLM Code','PLM','plmId']),
      styleId: pick(source, ['styleId','Style ID','StyleId','Model ID']),
      modelCode: pick(source, ['modelCode','Model Code','Model Kodu']),
      modelName: pick(source, ['modelName','Model Name','Model Adı','Ürün Adı','modelKod']),
      colourCode: pick(source, ['colourCode','C.Code','Colour Code','Color Code','Renk Kod','Renk Kodu']),
      manufacturer: pick(source, ['manufacturer','Manufacturer','Üretici','buyingSampleManufacturer','confirmedManufacturer']),
      supplier: pick(source, ['supplier','Supplier','Tedarikçi','Sub-Manufacturer','Kumaşçı']),
      option: pick(source, ['option','Option','Opsiyon']), article: pick(source, ['article','Article','Artikel']),
      department: pick(source, ['department','Department','Departman']), className: pick(source, ['className','Class','Klasman','Category','Ürün Tanım']),
      orderDate: pick(source, ['orderDate','Order Date','Sipariş Tarihi','Sipariş Yerleştirme MerchTarih']),
      deliveryDate: pick(source, ['deliveryDate','Delivery Date','Retail Date','Retail Depo Tarih','retail']),
      price: pick(source, ['price','Price','FOB','Supp. FOB','Supplier FOB']), quantity: pick(source,['quantity','Quantity','Order Quantity','Adet']),
      _entityId: pick(source, ['_entityId','orderNo','Order Code','Order No','Order Number','Sipariş Kod','Sipariş Kodu','Sipariş No','PO No','PO','id']),
      _entityType: pick(source, ['_entityType']) || 'ORDER',
    }).filter(([, value]) => value));
  }

  function buttonHtml(module, id) {
    if (!canUse()) return '';
    return `<button type="button" class="outlookRowBtn" data-outlook-module="${esc(module || '')}" data-outlook-id="${esc(id)}" title="${esc(T('Bu siparişle ilgili Outlook maillerini ara','Search Outlook emails related to this order'))}" aria-label="${esc(T('Outlook maillerini ara','Search Outlook emails'))}"><span aria-hidden="true"></span></button>`;
  }
  function moduleFromButton(button) {
    if (button.dataset.outlookModule) return button.dataset.outlookModule;
    if (button.closest('#cpTable')) return 'cp';
    if (button.closest('#ordersTable')) return 'orders';
    if (button.closest('#kolTable')) return 'collection';
    if (button.closest('#backlogDetailTableWrap')) return 'backlog';
    return '';
  }
  function rowFromButton(button) {
    const module = moduleFromButton(button), id = button.dataset.outlookId;
    return typeof window.BLGetOutlookRow === 'function' ? window.BLGetOutlookRow(module, id) : null;
  }
  async function api(url, options = {}) {
    const response = await fetch(url, { cache: 'no-store', ...options, headers: { ...(options.body ? { 'Content-Type':'application/json' } : {}), ...(options.headers || {}) } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) { const error = new Error(data.error || response.statusText); error.code = data.code; error.retryAfter = data.retryAfter; throw error; }
    return data;
  }

  function ensureDrawer() {
    if (state.drawer && state.drawer.isConnected) return state.drawer;
    const root = document.createElement('div'); root.className = 'outlookDrawerRoot'; root.hidden = true;
    root.innerHTML = `<div class="outlookBackdrop" data-outlook-close></div><aside class="outlookDrawer" role="dialog" aria-modal="true" aria-labelledby="outlookDrawerTitle"><header><div><small>MICROSOFT 365</small><h2 id="outlookDrawerTitle">${esc(T('OUTLOOK · SİPARİŞ MAİLLERİ','OUTLOOK · ORDER EMAILS'))}</h2></div><button type="button" class="outlookClose" data-outlook-close aria-label="${esc(T('Kapat','Close'))}">×</button></header><div class="outlookDrawerBody" data-outlook-body></div></aside>`;
    document.body.appendChild(root); state.drawer = root;
    root.addEventListener('click', event => { if (event.target.closest('[data-outlook-close]')) close(); });
    return root;
  }
  function close() {
    if (state.controller) state.controller.abort();
    if (state.drawer) state.drawer.hidden = true;
    document.body.classList.remove('outlookDrawerOpen');
  }
  function openShell() {
    const root = ensureDrawer(); root.hidden = false; document.body.classList.add('outlookDrawerOpen');
    const body = root.querySelector('[data-outlook-body]');
    if (body) body.scrollTop = 0;
    return body;
  }

  function statusCard(status) {
    const connected = status && status.connected, engine=clean(status&&status.activeEngine||''), local=engine==='CLASSIC_OUTLOOK_LOCAL', graph=engine==='MICROSOFT_GRAPH', bridge=!connected&&status&&status.bridgeAvailable;
    const reauth = status && status.graph && status.graph.state === 'REAUTH_REQUIRED';
    const label = local ? T('Classic Outlook Hazır','Classic Outlook Ready') : graph ? T('Microsoft Graph Bağlı','Microsoft Graph Connected') : bridge ? T('Outlook Bridge Kullanılabilir','Outlook Bridge Available') : reauth ? T('Microsoft Graph yeniden doğrulama gerekli','Microsoft Graph reauthentication required') : T('Outlook kullanılamıyor','Outlook unavailable');
    const detail=local?T('IT izni gerekmeden bu bilgisayardaki Classic Outlook profili kullanılıyor.','The Classic Outlook profile on this computer is being used without an IT setup.'):graph?T('Microsoft 365 Graph bağlantısı kullanılıyor.','Microsoft 365 Graph connection is active.'):bridge?T('Yerel mail sonuçları okunamıyor; aramayı Classic Outlook ekranında açabilirsiniz.','Local email results cannot be read; the search can be opened in Classic Outlook.'):status&&status.message||'';
    const identity=local?(status.local&& (status.local.profileName||status.local.storeName)||status.accountName||'Classic Outlook'):(status.email||status.accountName||'');
    const actions=[];
    if(graph){actions.push(`<button type="button" data-outlook-refresh>${esc(T('Graph Bağlantısını Yenile','Reconnect Graph'))}</button><button type="button" data-outlook-disconnect>${esc(T('Graph Bağlantısını Kes','Disconnect Graph'))}</button>`);}
    else if(status&&status.graph&&status.graph.configured){actions.push(`<button type="button" data-outlook-connect>${esc(T("Microsoft Graph'a Bağlan",'Connect Microsoft Graph'))}</button>`);}
    if(status&&status.bridgeAvailable)actions.push(`<button type="button" data-outlook-bridge>${esc(T("Outlook'ta Ara",'Search in Outlook'))}</button>`);
    return `<section class="outlookConnection ${connected?'isConnected':''}"><div class="outlookStatusDot"></div><div><b>${esc(label)}</b>${identity?`<span>${esc(identity)}</span>`:''}<small>${esc(detail)}</small></div><div class="outlookConnectionActions">${actions.join('')}</div></section>`;
  }
  function formatDate(value) {
    const time = Date.parse(value || ''); if (!Number.isFinite(time)) return '—';
    return new Intl.DateTimeFormat((typeof appLang !== 'undefined' && appLang === 'en')?'en-GB':'tr-TR',{dateStyle:'medium',timeStyle:'short'}).format(new Date(time));
  }
  async function loadStatus() { state.status = await api('/api/outlook/status'); return state.status; }
  async function loadV2Meta() {
    const [featureResult,mailboxes]=await Promise.all([api('/api/outlook/v2/features').catch(()=>({features:{}})),api('/api/outlook/v2/mailboxes').catch(()=>({personal:[],shared:[],managed:[]}))]);
    state.features=featureResult.features||{};state.mailboxes={personal:mailboxes.personal||[],shared:mailboxes.shared||[],managed:mailboxes.managed||[]};return state.mailboxes;
  }
  function bindConnectionActions(body, afterConnect) {
    body.querySelector('[data-outlook-connect]')?.addEventListener('click', () => connect(afterConnect));
    body.querySelector('[data-outlook-refresh]')?.addEventListener('click', () => connect(afterConnect));
    body.querySelectorAll('[data-outlook-bridge]').forEach(button=>button.addEventListener('click',()=>openBridge(button)));
    body.querySelector('[data-outlook-disconnect]')?.addEventListener('click', async event => {
      if (!confirm(T('Outlook bağlantınız kesilsin mi?','Disconnect your Outlook account?'))) return;
      event.currentTarget.disabled = true;
      try { await api('/api/outlook/disconnect',{method:'POST',body:'{}'}); await openSettings(); }
      catch (error) { toast(error.message); event.currentTarget.disabled = false; }
    });
  }
  async function connect(afterConnect) {
    try {
      const result = await api('/api/outlook/connect',{method:'POST',body:'{}'});
      if (result.mock) { state.status = await loadStatus(); if (afterConnect) afterConnect(); else openSettings(); return; }
      const popup = window.open(result.authorizeUrl,'buyerlog-microsoft365','popup=yes,width=620,height=760,resizable=yes,scrollbars=yes');
      if (!popup) throw new Error(T('Tarayıcı Microsoft giriş penceresini engelledi. Açılır pencereye izin verin.','The browser blocked the Microsoft sign-in window. Allow pop-ups.'));
      state.authPopup=popup;clearInterval(state.authTimer);state.authTimer=setInterval(()=>{if(!state.authPopup||state.authPopup.closed){clearInterval(state.authTimer);state.authTimer=null;state.authPopup=null;loadStatus().then(status=>{if(status.connected){if(afterConnect)afterConnect();else openSettings();}else toast(T('Microsoft giriş penceresi bağlantı tamamlanmadan kapatıldı.','The Microsoft sign-in window was closed before connection completed.'));}).catch(()=>{});}},700);
    } catch (error) { toast(error.message); }
  }
  async function openSettings() {
    const body = openShell();
    const returnContext = state.context && Object.keys(state.context).length ? { ...state.context } : null;
    const returnModule = state.module || '';
    body.innerHTML = `<section class="outlookSettings"><div class="outlookSettingsHead"><div><h3>${esc(T('Outlook Ayarları','Outlook Settings'))}</h3><small>${esc(T('Classic Outlook Local şimdi kullanılabilir; Microsoft Graph daha sonra IT desteğiyle etkinleştirilebilir.','Classic Outlook Local can be used now; Microsoft Graph can be enabled later with IT support.'))}</small></div>${returnContext?`<button type="button" data-outlook-back-search>← ${esc(T('Aramaya Dön','Back to Search'))}</button>`:''}</div><div class="outlookLoading"><span></span>${esc(T('Outlook bağlantısı kontrol ediliyor…','Checking Outlook connection…'))}</div></section>`;
    body.querySelector('[data-outlook-back-search]')?.addEventListener('click',()=>openForContext(returnContext,returnModule,{preserveManual:true}));
    try {
      // Settings sayfası yalnız connection status ister. V2 mailbox discovery burada
      // gerekli değildir ve Classic Outlook-only kurulumlarda ekranı gereksiz yere bekletebilir.
      const status = await loadStatus();
      const local=status.local||{},graph=status.graph||{};
      body.innerHTML = `<section class="outlookSettings"><div class="outlookSettingsHead"><div><h3>${esc(T('Outlook Ayarları','Outlook Settings'))}</h3><small>${esc(T('Classic Outlook Local şimdi kullanılabilir; Microsoft Graph daha sonra IT desteğiyle etkinleştirilebilir.','Classic Outlook Local can be used now; Microsoft Graph can be enabled later with IT support.'))}</small></div>${returnContext?`<button type="button" data-outlook-back-search>← ${esc(T('Aramaya Dön','Back to Search'))}</button>`:''}</div>${statusCard(status)}<div class="outlookEngineGrid"><article class="${local.connected?'active':''}"><span>1</span><div><b>Classic Outlook Local</b><small>${esc(local.connected?T('Şimdi aktif · IT kurulumu gerekmez','Active now · No IT setup required'):T('Bu bilgisayarda erişilemedi','Unavailable on this computer'))}</small></div></article><article class="${graph.connected?'active':''}"><span>2</span><div><b>Microsoft Graph</b><small>${esc(graph.connected?T('Bağlı · kurumsal motor','Connected · enterprise engine'):graph.configured?T('Kuruldu, kullanıcı bağlantısı bekliyor','Configured, waiting for user connection'):T('İleride IT desteğiyle etkinleştirilebilir','Can be enabled later with IT support'))}</small></div></article><article><span>3</span><div><b>Outlook Bridge</b><small>${esc(T('Yerel okuma engellenirse aramayı Classic Outlook ekranında açar','Opens the search in Classic Outlook if local reading is blocked'))}</small></div></article></div><div class="outlookInfo"><b>${esc(T('Geçiş mimarisi','Migration architecture'))}</b><p>${esc(T('AUTO modunda Microsoft Graph bağlıysa Graph, değilse Classic Outlook Local kullanılır. İkisi de kullanılamazsa Outlook Bridge devreye girer. Arayüz ve sipariş arama mantığı değişmez.','In AUTO mode, Microsoft Graph is used when connected; otherwise Classic Outlook Local is used. If neither can be used, Outlook Bridge remains available. The UI and order-search logic stay unchanged.'))}</p></div><div class="outlookInfo"><b>${esc(T('Gizlilik','Privacy'))}</b><p>${esc(T('Classic Outlook modu yalnız bu Windows oturumunda Outlook profilinizin zaten erişebildiği mailleri okur; mail göndermez, silmez, taşımaz veya okundu durumunu değiştirmez.','Classic Outlook mode only reads emails already accessible to your Outlook profile in this Windows session; it does not send, delete, move, or mark mail as read.'))}</p></div>${hasCapability('OUTLOOK_INTELLIGENCE.VIEW')?`<button type="button" class="outlookAdminOpen" data-outlook-dashboard>${esc(T('Mail Intelligence Paneli','Mail Intelligence Dashboard'))}</button>`:''}${hasCapability('OUTLOOK_INTELLIGENCE.ADMIN')?`<button type="button" class="outlookAdminOpen" data-outlook-health>${esc(T('Outlook Intelligence Sağlığı','Outlook Intelligence Health'))}</button><button type="button" class="outlookAdminOpen primary" data-outlook-setup>${esc(T('Microsoft Graph · İleri Kurulum','Microsoft Graph · Advanced Setup'))}</button>`:''}</section>`;
      body.scrollTop=0;
      bindConnectionActions(body, openSettings);
      body.querySelector('[data-outlook-back-search]')?.addEventListener('click',()=>openForContext(returnContext,returnModule,{preserveManual:true}));
      body.querySelector('[data-outlook-dashboard]')?.addEventListener('click',openDashboard);
      body.querySelector('[data-outlook-health]')?.addEventListener('click',openHealth);
      body.querySelector('[data-outlook-setup]')?.addEventListener('click',openSetupWizard);
    } catch (error) {
      body.innerHTML = `<section class="outlookSettings"><div class="outlookSettingsHead"><div><h3>${esc(T('Outlook Ayarları','Outlook Settings'))}</h3><small>${esc(T('Ayar ekranı yüklenemedi. Arama ekranı çalışmaya devam edebilir.','Settings could not be loaded. The search screen can continue to work.'))}</small></div>${returnContext?`<button type="button" data-outlook-back-search>← ${esc(T('Aramaya Dön','Back to Search'))}</button>`:''}</div>${errorState(error)}<button type="button" class="outlookAdminOpen" data-outlook-settings-retry>${esc(T('Ayarları Tekrar Yükle','Reload Settings'))}</button></section>`;
      body.scrollTop=0;
      body.querySelector('[data-outlook-back-search]')?.addEventListener('click',()=>openForContext(returnContext,returnModule,{preserveManual:true}));
      body.querySelector('[data-outlook-settings-retry]')?.addEventListener('click',openSettings);
    }
  }

  function setupFlag(data,field,label){return `<label class="outlookSetupCheck"><input type="checkbox" name="${esc(field)}" ${data.features&&data.features[field]?'checked':''}> <span>${esc(label)}</span></label>`;}
  function setupStatus(ok,label,detail){return `<div class="outlookSetupStatus ${ok?'ok':'warn'}"><span>${ok?'✓':'!'}</span><div><b>${esc(label)}</b><small>${esc(detail||'')}</small></div></div>`;}
  function renderSetupChecks(root,checks){const target=root.querySelector('[data-setup-results]');if(!target)return;target.innerHTML=(checks||[]).map(item=>setupStatus(Boolean(item.ok),item.id,item.message||item.code)).join('');}
  async function openSetupWizard(options={}){
    const body=openShell();state.context=null;body.innerHTML=skeleton();
    try{
      const data=await api('/api/outlook/v2/admin/setup'),graph=data.graph||{},application=data.application||{},webhook=data.webhook||{},readiness=data.readiness||{},running=data.running||{},local=data.local||{};
      body.innerHTML=`<section class="outlookSetup"><div class="outlookContext"><div><h3>${esc(T('Microsoft 365 Kurulum Sihirbazı','Microsoft 365 Setup Wizard'))}</h3><small>${esc(T('Buyer Log içinde yönetilebilen ayarları tek ekrandan yapılandırın.','Configure settings managed by Buyer Log from one screen.'))}</small></div><button data-outlook-settings>⚙</button></div>
        ${options.restartRequired?`<div class="outlookSetupRestart"><b>${esc(T('Ayarlar kaydedildi.','Settings saved.'))}</b><span>${esc(T('Yeni Graph ve webhook ayarlarının devreye girmesi için Buyer Log yeniden başlatılmalıdır.','Restart Buyer Log to activate the new Graph and webhook settings.'))}</span>${data.canRestart?`<button type="button" class="primary" data-setup-restart>${esc(T('Şimdi Yeniden Başlat','Restart Now'))}</button>`:''}</div>`:''}
        <div class="outlookInfo"><b>${esc(T('Şu an önerilen motor','Recommended engine now'))}</b><p>${esc(local.connected?T('Classic Outlook Local hazır. Microsoft Graph alanlarını boş bırakabilirsiniz; IT desteği geldiğinde bu ekrandan Graph kurulabilir.','Classic Outlook Local is ready. You can leave Microsoft Graph fields empty and configure Graph here later when IT support becomes available.'):T('Classic Outlook Local kullanılamıyor. Graph kurulana kadar Outlook Bridge fallback kullanılabilir.','Classic Outlook Local is unavailable. Outlook Bridge can be used until Graph is configured.'))}</p></div><div class="outlookSetupStatuses">${setupStatus(Boolean(local.connected),T('Classic Outlook Local','Classic Outlook Local'),local.connected?T('IT kurulumu olmadan hazır','Ready without IT setup'):T('Bu bilgisayarda algılanamadı','Not detected on this computer'))}${setupStatus(Boolean(readiness.delegatedConfigured),T('Microsoft Graph','Microsoft Graph'),readiness.delegatedConfigured?T('Uygulama ayarları hazır','Application configuration ready'):T('İleri kullanım için IT kurulumu bekleniyor','Waiting for IT setup for future use'))}${setupStatus(Boolean(readiness.applicationCredentialsConfigured),T('Arka Plan Intelligence','Background Intelligence'),readiness.applicationCredentialsConfigured?T('Application credentials hazır','Application credentials ready'):T('Opsiyonel application credentials eksik','Optional application credentials missing'))}${setupStatus(Boolean(readiness.webhookConfigured),T('Webhook','Webhook'),readiness.webhookConfigured?T('HTTPS adresleri hazır','HTTPS endpoints ready'):T('Public HTTPS adresleri eksik','Public HTTPS endpoints missing'))}${setupStatus(Boolean(running.graphReady),T('Çalışan Yapılandırma','Running Configuration'),running.graphReady?T('Aktif','Active'):T('Kurulum veya yeniden başlatma gerekli','Setup or restart required'))}</div>
        <form data-outlook-setup-form>
          <fieldset><legend>1 · ${esc(T('Kişisel Outlook Bağlantısı','Personal Outlook Connection'))}</legend><label class="outlookSetupCheck"><input type="checkbox" name="graphEnabled" ${graph.enabled?'checked':''}> <span>${esc(T('Microsoft Graph bağlantısını etkinleştir','Enable Microsoft Graph connection'))}</span></label><div class="outlookSetupGrid"><label><span>Client ID</span><input name="clientId" value="${esc(graph.clientId||'')}" autocomplete="off" placeholder="00000000-0000-0000-0000-000000000000"></label><label><span>Tenant ID</span><input name="tenantId" value="${esc(graph.tenantId||'organizations')}" autocomplete="off"></label><label class="wide"><span>Redirect URI</span><input name="redirectUri" value="${esc(graph.redirectUri||`${location.origin}/api/outlook/callback`)}" autocomplete="off"></label><label class="wide"><span>Client Secret</span><input type="password" name="delegatedClientSecret" value="" autocomplete="new-password" placeholder="${esc(graph.maskedClientSecret||T('Entra uygulamasındaki Secret VALUE değerini girin','Enter the Secret VALUE from the Entra app'))}"></label><label class="outlookSetupCheck wide"><input type="checkbox" name="clearDelegatedSecret"> <span>${esc(T('Kayıtlı kişisel Outlook client secret değerini temizle','Clear saved personal Outlook client secret'))}</span></label></div><small>${esc(T('Delegated izinler: Mail.Read + isteğe bağlı Mail.Read.Shared. Client Secret yalnız sunucuda şifreli saklanır; Mail.Send istenmez.','Delegated permissions: Mail.Read + optional Mail.Read.Shared. Client Secret is stored encrypted on the server only; Mail.Send is not requested.'))}</small></fieldset>
          <fieldset><legend>2 · ${esc(T('Shared Mailbox ve Özellikler','Shared Mailboxes and Features'))}</legend><label><span>${esc(T('Shared mailbox adayları — her satıra bir adres','Shared mailbox candidates — one address per line'))}</span><textarea name="sharedMailboxes" rows="4" placeholder="buying@company.com">${esc((graph.sharedMailboxCandidates||[]).join('\n'))}</textarea></label><div class="outlookSetupFlags">${setupFlag(data,'sharedMailboxEnabled',T('Shared mailbox arama','Shared mailbox search'))}${setupFlag(data,'manualLinkEnabled',T('Manuel mail–sipariş bağlantısı','Manual mail–order linking'))}${setupFlag(data,'timelineEnabled','Timeline')}${setupFlag(data,'attachmentPreviewEnabled',T('Güvenli attachment önizleme','Safe attachment preview'))}${setupFlag(data,'aiSummaryEnabled',T('AI özeti','AI summary'))}${setupFlag(data,'intelligenceEnabled','Mail Intelligence')}</div></fieldset>
          <fieldset><legend>3 · ${esc(T('Arka Plan Application Erişimi','Background Application Access'))}</legend><div class="outlookSetupGrid"><label><span>Application Client ID</span><input name="applicationClientId" value="${esc(application.clientId||'')}" autocomplete="off"></label><label><span>Application Tenant ID</span><input name="applicationTenantId" value="${esc(application.tenantId||'')}" autocomplete="off"></label><label class="wide"><span>Application Client Secret</span><input type="password" name="applicationClientSecret" value="" autocomplete="new-password" placeholder="${esc(application.maskedClientSecret||T('Değiştirmiyorsanız boş bırakın','Leave blank to keep current secret'))}"></label><label class="outlookSetupCheck wide"><input type="checkbox" name="clearApplicationSecret"> <span>${esc(T('Kayıtlı application secret değerini temizle','Clear saved application secret'))}</span></label></div><small>${esc(T('Secret şifreli saklanır ve ekrana geri gönderilmez. Production için sertifika tabanlı kimlik doğrulama tercih edilmelidir.','The secret is stored encrypted and is never returned to the browser. Certificate authentication is preferred for production.'))}</small></fieldset>
          <fieldset><legend>4 · Webhook / Delta</legend><div class="outlookSetupGrid"><label class="wide"><span>Notification URL</span><input name="notificationUrl" value="${esc(webhook.notificationUrl||`${location.origin}/api/outlook/webhook`)}" autocomplete="off"></label><label class="wide"><span>Lifecycle URL</span><input name="lifecycleUrl" value="${esc(webhook.lifecycleUrl||`${location.origin}/api/outlook/lifecycle`)}" autocomplete="off"></label><label><span>${esc(T('Subscription süresi (saat)','Subscription duration (hours)'))}</span><input type="number" min="1" max="168" name="subscriptionHours" value="${Number(webhook.subscriptionHours)||120}"></label><label><span>Delta folders</span><input name="deltaFolders" value="${esc((webhook.deltaFolders||['inbox']).join(';'))}"></label></div><label class="outlookSetupCheck"><input type="checkbox" name="changeNotificationsEnabled" ${data.features&&data.features.changeNotificationsEnabled?'checked':''}> <span>${esc(T('Graph change notifications özelliğini etkinleştir','Enable Graph change notifications'))}</span></label><small>${esc(T('Public HTTPS ve Exchange RBAC doğrulanmadan bu seçeneği açmayın. clientState otomatik ve şifreli üretilir.','Do not enable this until public HTTPS and Exchange RBAC are verified. clientState is generated automatically and stored encrypted.'))}</small></fieldset>
          <fieldset><legend>5 · ${esc(T('Microsoft 365 Yöneticisinin Tamamlayacağı Adımlar','Steps Required from the Microsoft 365 Administrator'))}</legend><div class="outlookExternalSteps">${(data.externalSteps||[]).map(item=>`<a href="${esc(item.url)}" target="_blank" rel="noopener noreferrer"><span>↗</span><div><b>${esc(item.label)}</b><small>${esc(T('Bu işlem Buyer Log tarafından otomatik verilemez.','Buyer Log cannot grant this externally controlled permission.'))}</small></div></a>`).join('')}</div></fieldset>
          <div class="outlookSetupTest"><label><span>${esc(T('Erişimi test edilecek mailbox','Mailbox to test'))}</span><input type="email" name="testMailbox" placeholder="buying@company.com"></label><label class="outlookSetupCheck"><input type="checkbox" name="testApplication" checked> <span>${esc(T('Application token ve Exchange RBAC testi','Application token and Exchange RBAC test'))}</span></label><label class="outlookSetupCheck"><input type="checkbox" name="testDelegatedMailbox"> <span>${esc(T('Oturum açmış kullanıcıyla shared mailbox testi','Shared mailbox test with signed-in user'))}</span></label><button type="button" data-setup-test>${esc(T('Bağlantıları Test Et','Test Connections'))}</button></div><div data-setup-results class="outlookSetupResults"></div>
          ${data.security&&data.security.environmentOverrides&&data.security.environmentOverrides.length?`<div class="outlookInfo"><b>${esc(T('IT tarafından kilitlenen ayarlar','Settings controlled by IT'))}</b><p>${esc(data.security.environmentOverrides.join(', '))}</p></div>`:''}
          <footer><button type="button" data-outlook-settings>${esc(T('Geri','Back'))}</button><button type="submit" class="primary">${esc(T('Ayarları Kaydet','Save Settings'))}</button></footer>
        </form></section>`;
      body.querySelectorAll('[data-outlook-settings]').forEach(button=>button.addEventListener('click',openSettings));
      body.querySelector('[data-outlook-setup-form]')?.addEventListener('submit',saveOutlookSetup);
      body.querySelector('[data-setup-test]')?.addEventListener('click',testOutlookSetup);
      body.querySelector('[data-setup-restart]')?.addEventListener('click',restartForOutlookSetup);
    }catch(error){body.innerHTML=errorState(error);}
  }
  function setupFormPayload(form){
    const checked=name=>Boolean(form.elements[name]&&form.elements[name].checked),value=name=>clean(form.elements[name]&&form.elements[name].value);
    return {graph:{enabled:checked('graphEnabled'),clientId:value('clientId'),tenantId:value('tenantId'),redirectUri:value('redirectUri'),clientSecret:value('delegatedClientSecret'),clearClientSecret:checked('clearDelegatedSecret'),sharedMailboxCandidates:value('sharedMailboxes').split(/\n|,|;/).map(item=>item.trim()).filter(Boolean)},application:{clientId:value('applicationClientId'),tenantId:value('applicationTenantId'),clientSecret:value('applicationClientSecret'),clearClientSecret:checked('clearApplicationSecret')},webhook:{notificationUrl:value('notificationUrl'),lifecycleUrl:value('lifecycleUrl'),subscriptionHours:Number(value('subscriptionHours'))||120,deltaFolders:value('deltaFolders')},features:{sharedMailboxEnabled:checked('sharedMailboxEnabled'),manualLinkEnabled:checked('manualLinkEnabled'),timelineEnabled:checked('timelineEnabled'),attachmentPreviewEnabled:checked('attachmentPreviewEnabled'),aiSummaryEnabled:checked('aiSummaryEnabled'),intelligenceEnabled:checked('intelligenceEnabled'),changeNotificationsEnabled:checked('changeNotificationsEnabled')}};
  }
  async function saveOutlookSetup(event){event.preventDefault();const form=event.currentTarget,button=form.querySelector('button[type="submit"]');button.disabled=true;try{await api('/api/outlook/v2/admin/setup',{method:'POST',body:JSON.stringify(setupFormPayload(form))});toast(T('Outlook ayarları şifreli olarak kaydedildi.','Outlook settings were saved encrypted.'));await openSetupWizard({restartRequired:true});}catch(error){toast(error.message);button.disabled=false;}}
  async function testOutlookSetup(event){const button=event.currentTarget,form=button.closest('form'),mailbox=clean(form.elements.testMailbox.value);button.disabled=true;try{const result=await api('/api/outlook/v2/admin/setup/test',{method:'POST',body:JSON.stringify({mailbox,testApplication:form.elements.testApplication.checked,testDelegatedMailbox:form.elements.testDelegatedMailbox.checked})});renderSetupChecks(form,result.checks);toast(T('Kurulum testi tamamlandı.','Setup test completed.'));}catch(error){toast(error.message);}finally{button.disabled=false;}}
  async function restartForOutlookSetup(event){if(!confirm(T('Buyer Log şimdi yeniden başlatılsın mı? Açık işlemlerinizi kaydettiğinizden emin olun.','Restart Buyer Log now? Make sure your open work is saved.')))return;event.currentTarget.disabled=true;try{await api('/api/outlook/v2/admin/setup/restart',{method:'POST',body:'{}'});toast(T('Buyer Log yeniden başlatılıyor…','Buyer Log is restarting…'));setTimeout(()=>location.reload(),5000);}catch(error){toast(error.message);event.currentTarget.disabled=false;}}

  function contextGroupValue(context, group) {
    for (const member of group.members) if (context && context[member]) return clean(context[member]);
    return '';
  }
  function availableContextGroups(context=state.context) {
    return CONTEXT_FIELD_GROUPS.filter(group => contextGroupValue(context, group));
  }
  function resetContextFields(context=state.context) {
    state.contextFields = new Set(availableContextGroups(context).map(group => group.key));
  }
  function expandedContextFields() {
    const fields = [];
    for (const group of CONTEXT_FIELD_GROUPS) {
      if (!state.contextFields.has(group.key)) continue;
      for (const member of group.members) if (!fields.includes(member)) fields.push(member);
    }
    return fields;
  }
  function contextChips(context) {
    const groups = availableContextGroups(context);
    const active = groups.filter(group => state.contextFields.has(group.key)).map(group => {
      const label=group.label(), value=contextGroupValue(context,group);
      return `<span class="outlookContextChip" data-outlook-context-chip="${esc(group.key)}"><b>${esc(label)}</b><span>${esc(value)}</span><button type="button" data-outlook-context-remove="${esc(group.key)}" title="${esc(T(`${label} kriterini aramadan çıkar`,`Remove ${label} from search`))}" aria-label="${esc(T(`${label} kriterini aramadan çıkar`,`Remove ${label} from search`))}">×</button></span>`;
    }).join('');
    const hasRemoved = groups.some(group => !state.contextFields.has(group.key));
    const removed = groups.map(group => `<button type="button" class="outlookContextRestore" data-outlook-context-add="${esc(group.key)}" ${state.contextFields.has(group.key)?'hidden':''}>+ ${esc(group.label())}</button>`).join('');
    return `<div class="outlookContextCriteria"><div class="outlookContextActive" data-outlook-context-active>${active || `<small data-outlook-context-empty>${esc(T('Otomatik kriter yok','No automatic criteria'))}</small>`}</div><div class="outlookContextRemoved" data-outlook-context-removed ${hasRemoved?'':'hidden'}><small>${esc(T('Kaldırılan kriterler','Removed criteria'))}</small>${removed}</div></div>`;
  }
  function searchLayout(preserveManual='') {
    const context = state.context;
    const engine=clean(state.status&&state.status.activeEngine||'AUTO');
    const manualValue=clean(preserveManual||'');
    const quickTerms=['approval','RFID','strike off','termin','price','shipment'];
    return `<section class="outlookContext"><div>${contextChips(context)}</div><button type="button" data-outlook-settings title="${esc(T('Outlook ayarları','Outlook settings'))}" aria-label="${esc(T('Outlook ayarları','Outlook settings'))}">⚙</button></section><div class="outlookEngineBanner"><b>${esc(T('Aktif motor','Active engine'))}: ${esc(engine==='CLASSIC_OUTLOOK_LOCAL'?'Classic Outlook Local':engine==='MICROSOFT_GRAPH'?'Microsoft Graph':'AUTO')}</b><button type="button" data-outlook-bridge>${esc(T("Classic Outlook'ta Ara",'Search in Classic Outlook'))}</button></div>
      <section class="outlookQuickSearch" aria-label="${esc(T('Manuel mail arama','Manual email search'))}">
        <div class="outlookQuickSearchHead"><div><b>${esc(T('Manuel kelime ekle','Add manual keywords'))}</b><small>${esc(T('Sipariş/PLM/Model kriterlerine ek olarak mail içinde aranır. Birden fazla ifade için virgül kullanabilirsin.','These are searched in addition to Order/PLM/Model criteria. Use commas for multiple phrases.'))}</small></div></div>
        <div class="outlookQuickSearchRow"><input type="search" data-outlook-manual value="${esc(manualValue)}" placeholder="${esc(T('Örn: RFID, approval, strike off…','e.g. RFID, approval, strike off…'))}" autocomplete="off"><button type="button" class="primary" data-outlook-manual-search>${esc(T('Ara','Search'))}</button><button type="button" data-outlook-manual-clear>${esc(T('Temizle','Clear'))}</button></div>
        <div class="outlookQuickTerms">${quickTerms.map(term=>`<button type="button" data-outlook-quick-term="${esc(term)}">+ ${esc(term)}</button>`).join('')}</div>
      </section>
      <details class="outlookAdvancedFilters">
        <summary>${esc(T('Gelişmiş arama seçenekleri','Advanced search options'))}</summary>
        <section class="outlookFilters">
          ${hasCapability('OUTLOOK_SHARED_MAIL.SEARCH')&&state.mailboxes.shared.length?`<div class="outlookMailboxSelector"><b>${esc(T('Arama Kaynağı','Search Source'))}</b><label><input type="radio" name="outlookMailboxSource" value="PERSONAL" checked> ${esc(T('Benim Outlook’um','My Outlook'))}</label><label><input type="radio" name="outlookMailboxSource" value="SHARED_DELEGATED"> ${esc(T('Erişebildiğim Ortak Mailbox’lar','Shared Mailboxes I Can Access'))}</label><label><input type="radio" name="outlookMailboxSource" value="ALL"> ${esc(T('Tümü','All'))}</label><div data-outlook-shared-list hidden>${state.mailboxes.shared.map(item=>`<label><input type="checkbox" data-outlook-mailbox value="${esc(item.email)}" checked> ${esc(item.displayName||item.email)} <small>${esc(item.email)}</small></label>`).join('')}</div></div>`:''}
          <div class="outlookFilterGrid">
            <label>${esc(T('Tarih','Date'))}<select data-outlook-date><option value="30">${esc(T('Son 30 Gün','Last 30 Days'))}</option><option value="90" selected>${esc(T('Son 3 Ay','Last 3 Months'))}</option><option value="180">${esc(T('Son 6 Ay','Last 6 Months'))}</option><option value="365">${esc(T('Son 1 Yıl','Last Year'))}</option><option value="all">${esc(T('Tümü','All'))}</option><option value="custom">${esc(T('Özel Tarih','Custom Date'))}</option></select></label>
            <label>${esc(T('Mail','Email'))}<select data-outlook-mail><option value="all">${esc(T('Tümü','All'))}</option><option value="unread">${esc(T('Okunmamış','Unread'))}</option><option value="with">${esc(T('Ekli','With attachments'))}</option><option value="without">${esc(T('Ek yok','No attachments'))}</option></select></label>
            <label>${esc(T('Sıralama','Sort'))}<select data-outlook-sort><option value="relevance">${esc(T('En İlgili','Most Relevant'))}</option><option value="newest">${esc(T('En Yeni','Newest'))}</option><option value="oldest">${esc(T('En Eski','Oldest'))}</option></select></label>
          </div><div class="outlookCustomDates" data-outlook-custom-dates hidden><label>${esc(T('Başlangıç','From'))}<input type="date" data-outlook-date-from></label><label>${esc(T('Bitiş','To'))}<input type="date" data-outlook-date-to></label></div>
          <details class="outlookCriteria"><summary>${esc(T('Arama alanları','Search fields'))}</summary><div>${availableContextGroups(context).map(group=>`<label><input type="checkbox" data-outlook-field-group="${esc(group.key)}" value="${esc(group.key)}" ${state.contextFields.has(group.key)?'checked':''}>${esc(group.label())}</label>`).join('')}</div></details>
          <div class="outlookFilterActions"><button type="button" class="primary" data-outlook-search>${esc(T('İlgili Mailleri Tara','Search Related Emails'))}</button>${hasCapability('OUTLOOK_MAIL.TIMELINE_VIEW')?`<button type="button" data-outlook-timeline>${esc(T('İletişim Timeline','Communication Timeline'))}</button>`:''}${hasCapability('OUTLOOK_INTELLIGENCE.VIEW')?`<button type="button" data-outlook-watch>${esc(T('Siparişi Takip Et','Watch Order'))}</button>`:''}<label><input type="checkbox" data-outlook-group checked> ${esc(T('Konuşmaları grupla','Group conversations'))}</label></div>
        </section>
      </details><div data-outlook-results></div>`;
  }
  function bindSearch(body) {
    body.querySelector('[data-outlook-settings]')?.addEventListener('click', openSettings);
    body.querySelector('[data-outlook-search]')?.addEventListener('click', () => search({ reset:true }));
    body.querySelector('[data-outlook-manual-search]')?.addEventListener('click', () => search({ reset:true }));
    body.querySelectorAll('[data-outlook-bridge]').forEach(button=>button.addEventListener('click',()=>openBridge(button)));
    body.querySelector('[data-outlook-group]')?.addEventListener('change', renderResults);
    body.querySelector('[data-outlook-date]')?.addEventListener('change',event=>{const box=body.querySelector('[data-outlook-custom-dates]');if(box)box.hidden=event.target.value!=='custom';});
    body.querySelectorAll('input[name="outlookMailboxSource"]').forEach(input=>input.addEventListener('change',()=>{const list=body.querySelector('[data-outlook-shared-list]');if(list)list.hidden=input.value==='PERSONAL';}));
    body.querySelector('[data-outlook-timeline]')?.addEventListener('click',renderTimeline);
    body.querySelector('[data-outlook-watch]')?.addEventListener('click',watchOrder);
    const updateContextControls=(key,enabled,{rerun=true}={})=>{
      if(enabled)state.contextFields.add(key);else state.contextFields.delete(key);
      const chip=body.querySelector(`[data-outlook-context-chip="${CSS.escape(key)}"]`);
      if(chip)chip.hidden=!enabled;
      const restore=body.querySelector(`[data-outlook-context-add="${CSS.escape(key)}"]`);
      if(restore)restore.hidden=enabled;
      const field=body.querySelector(`[data-outlook-field-group="${CSS.escape(key)}"]`);
      if(field)field.checked=enabled;
      const removedBox=body.querySelector('[data-outlook-context-removed]');
      if(removedBox)removedBox.hidden=![...removedBox.querySelectorAll('[data-outlook-context-add]')].some(button=>!button.hidden);
      const activeBox=body.querySelector('[data-outlook-context-active]');
      if(activeBox){
        let empty=activeBox.querySelector('[data-outlook-context-empty]');
        const any=[...activeBox.querySelectorAll('[data-outlook-context-chip]')].some(node=>!node.hidden);
        if(!empty&&!any){empty=document.createElement('small');empty.dataset.outlookContextEmpty='';empty.textContent=T('Otomatik kriter yok','No automatic criteria');activeBox.appendChild(empty);}
        if(empty)empty.hidden=any;
      }
      if(rerun)search({reset:true});
    };
    body.querySelectorAll('[data-outlook-context-remove]').forEach(button=>button.addEventListener('click',()=>updateContextControls(button.dataset.outlookContextRemove,false)));
    body.querySelectorAll('[data-outlook-context-add]').forEach(button=>button.addEventListener('click',()=>updateContextControls(button.dataset.outlookContextAdd,true)));
    body.querySelectorAll('[data-outlook-field-group]').forEach(input=>input.addEventListener('change',()=>updateContextControls(input.value,input.checked)));
    const manual=body.querySelector('[data-outlook-manual]');
    let timer=null;
    manual?.addEventListener('input',()=>{clearTimeout(timer);timer=setTimeout(() => search({ reset:true }), 500);});
    manual?.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();clearTimeout(timer);search({reset:true});}});
    body.querySelector('[data-outlook-manual-clear]')?.addEventListener('click',()=>{if(manual)manual.value='';search({reset:true});});
    body.querySelectorAll('[data-outlook-quick-term]').forEach(button=>button.addEventListener('click',()=>{
      if(!manual)return;const term=clean(button.dataset.outlookQuickTerm),parts=manual.value.split(/[,;\n]+/).map(clean).filter(Boolean);if(!parts.some(item=>item.toLocaleLowerCase('tr-TR')===term.toLocaleLowerCase('tr-TR')))parts.push(term);manual.value=parts.join(', ');manual.focus();
    }));
  }

  function searchOptions() {
    const body = state.drawer.querySelector('[data-outlook-body]'), date = body.querySelector('[data-outlook-date]')?.value || '90';
    const until = new Date(), from = ['all','custom'].includes(date) ? null : new Date(Date.now() - Number(date) * 86400000), mail = body.querySelector('[data-outlook-mail]')?.value || 'all';
    return {
      manual: clean(body.querySelector('[data-outlook-manual]')?.value), fields: expandedContextFields(),
      dateFrom: date==='custom'?clean(body.querySelector('[data-outlook-date-from]')?.value):(from ? from.toISOString().slice(0,10) : ''), dateTo: date==='custom'?clean(body.querySelector('[data-outlook-date-to]')?.value):until.toISOString().slice(0,10),
      unreadOnly: mail === 'unread', attachment: ['with','without'].includes(mail) ? mail : 'all',
      sort: body.querySelector('[data-outlook-sort]')?.value || 'relevance', page: state.page, pageSize: 25,
      mailboxSource: body.querySelector('input[name="outlookMailboxSource"]:checked')?.value||'PERSONAL', mailboxes:[...body.querySelectorAll('[data-outlook-mailbox]:checked')].map(input=>input.value), includePersonal:true, enginePreference:'AUTO',
    };
  }
  async function search({ reset = false, broad = false } = {}) {
    const results = state.drawer?.querySelector('[data-outlook-results]'); if (!results) return;
    if (reset) { state.page = 0; state.items.clear(); }
    if (state.controller) state.controller.abort(); state.controller = new AbortController();
    const requestId = ++state.requestId; state.loading = true;
    results.innerHTML = skeleton();
    try {
      const options = { ...searchOptions(), broad }; if(broad&&!options.dateFrom)options.dateFrom=new Date(Date.now()-365*86400000).toISOString().slice(0,10);
      if (!options.fields.length && !options.manual) {
        results.innerHTML = `<div class="outlookEmpty"><b>${esc(T('Arama kriteri kalmadı.','No search criteria remain.'))}</b><p>${esc(T('Üstten en az bir otomatik kriteri yeniden ekleyin veya manuel kelime yazın.','Re-add at least one automatic criterion above or enter a manual keyword.'))}</p></div>`;
        return;
      }
      const data = await api('/api/outlook/v2/search',{method:'POST',signal:state.controller.signal,body:JSON.stringify({context:state.context,options})});
      if (requestId !== state.requestId) return;
      (data.items || []).forEach(item => state.items.set(item.internetMessageId || item.messageId, item));
      state.hasMore = Boolean(data.hasMore); renderResults();
    } catch (error) {
      if (error.name !== 'AbortError') { results.innerHTML = errorState(error, true); bindResultActions(results); }
    } finally { if (requestId === state.requestId) state.loading = false; }
  }
  function skeleton() { return `<div class="outlookSearching"><b>${esc(T("Outlook'ta aranıyor…",'Searching Outlook…'))}</b><div class="outlookSkeleton"></div><div class="outlookSkeleton"></div><div class="outlookSkeleton"></div></div>`; }
  function errorState(error, searchError = false) {
    const code = error && error.code;
    const message = code === 'OUTLOOK_NOT_CONNECTED' ? T('Outlook hesabınız henüz bağlı değil.','Your Outlook account is not connected.') : code === 'REAUTH_REQUIRED' ? T('Outlook bağlantınızın yeniden doğrulanması gerekiyor.','Your Outlook connection must be reauthenticated.') : /consent|approval|authorization_request_denied/i.test(code||'') ? T('Microsoft 365 erişimi için kurum yöneticinizin onayı gerekiyor.','Your organization administrator must approve Microsoft 365 access.') : code === 'GRAPH_THROTTLED' ? T('Microsoft 365 geçici olarak yoğun. Arama kısa süre sonra yeniden denenebilir.','Microsoft 365 is temporarily busy. Try the search again shortly.') : error && error.message || T('Microsoft 365 bağlantı hatası.','Microsoft 365 connection error.');
    const bridge=['OUTLOOK_BRIDGE_REQUIRED','CLASSIC_OUTLOOK_UNAVAILABLE','CLASSIC_OUTLOOK_WINDOWS_REQUIRED','CLASSIC_OUTLOOK_LOCAL_FAILED','CLASSIC_OUTLOOK_POWERSHELL_FAILED'].includes(code)||Boolean(state.status&&state.status.bridgeAvailable);
    return `<div class="outlookEmpty isError"><b>${esc(message)}</b>${searchError?`<button type="button" data-outlook-retry>${esc(T('Tekrar Dene','Try Again'))}</button>`:''}${bridge?`<button type="button" class="primary" data-outlook-bridge>${esc(T("Classic Outlook'ta Ara",'Search in Classic Outlook'))}</button>`:''}${code==='OUTLOOK_NOT_CONNECTED'||code==='REAUTH_REQUIRED'?`<button type="button" data-outlook-connect-inline>${esc(T('Microsoft Graph’a Bağlan','Connect Microsoft Graph'))}</button>`:''}</div>`;
  }
  function senderText(sender) { return clean(sender && sender.name) || (sender&&sender.address?T('Gönderen','Sender'):'—'); }
  function displayPreview(value) {
    let text=String(value==null?'':value).replace(/\r/g,'').replace(/<mailto:[^>]+>/gi,' ').replace(/mailto:[^\s>]+/gi,' ').replace(/<?[A-Z0-9._%+\-']+@[A-Z0-9.\-]+\.[A-Z]{2,}>?/gi,' ');
    const lineCuts=[/(?:^|\n)\s*-{2,}\s*(?:original message|forwarded message|ilet(?:ilen|ilmiş) ileti)\s*-{2,}/i,/(?:^|\n)\s*(?:from|kimden|gönderen|sent|gönderildi|to|kime|cc|subject|konu)\s*:/i,/(?:^|\n)\s*(?:kind regards|best regards|warm regards|regards|thanks\s*(?:&|and)\s*regards|saygılarımla|saygılar|iyi çalışmalar|best wishes)\b/i,/(?:^|\n)\s*(?:please consider the environment before printing|save paper!?|this e-?mail and any attachments|bu e-?posta ve ekleri)\b/i];
    for(const pattern of lineCuts){const match=pattern.exec(text);if(match&&match.index>=0)text=text.slice(0,match.index);}
    if(!text.includes('\n')){const inlineCuts=[/\s+-{2,}\s*(?:original message|forwarded message)\s*-{2,}/i,/\s+(?:from|kimden|gönderen|sent|gönderildi|to|kime|cc|subject|konu)\s*:\s+/i,/\s+(?:kind regards|best regards|warm regards|regards|thanks\s*(?:&|and)\s*regards|saygılarımla|saygılar|iyi çalışmalar|best wishes)\b/i];for(const pattern of inlineCuts){const match=pattern.exec(text);if(match&&match.index>24)text=text.slice(0,match.index);}}
    text=text.split('\n').map(line=>line.replace(/[\t ]+/g,' ').trimEnd()).join('\n').replace(/\n{3,}/g,'\n\n').trim();
    if(text.length>900){const head=text.slice(0,901);let cut=Math.max(head.lastIndexOf('\n\n'),head.lastIndexOf('. '),head.lastIndexOf('! '),head.lastIndexOf('? '));if(cut<540)cut=900;text=text.slice(0,cut).replace(/#(?:Tablo|Görsel)\d*$/i,'').trimEnd()+'…';}
    return text;
  }
  function previewHtml(value) {
    const safe=esc(displayPreview(value));
    return safe.replace(/#Tablo(\d+)/gi,(_m,n)=>`<span class="outlookContentRef table">▦ ${esc(T('Tablo','Table'))}${Number(n)}</span>`).replace(/#Görsel(\d+)/gi,(_m,n)=>`<span class="outlookContentRef image">▧ ${esc(T('Görsel','Image'))}${Number(n)}</span>`).replace(/\n/g,'<br>');
  }
  function resultContentMeta(item){
    const parts=[];const tables=Number(item.tableCount)||0,images=Number(item.imageCount)||0,attachments=Number(item.attachmentCount)||0;
    if(tables)parts.push(`${tables} ${T('tablo','table')}`);if(images)parts.push(`${images} ${T('görsel','image')}`);if(item.hasAttachments)parts.push(attachments?`${attachments} ${T('ek','attachment')}`:T('Ek var','Has attachment'));
    return parts.length?`<span class="outlookContentMeta">${esc(parts.join(' · '))}</span>`:'<span></span>';
  }
  function resultCard(item) {
    const matches = (item.matchedFields || []).map(match => `<span>✓ ${esc(match.label)}</span>`).join('');
    const link=state.linked.get(`${item.mailboxAddress||''}|${item.messageId}`);
    return `<article class="outlookResult" data-message-id="${esc(item.messageId)}" data-mailbox-type="${esc(item.mailboxType||'PERSONAL')}" data-mailbox-address="${esc(item.mailboxAddress||'')}"><div class="outlookScore">${Number(item.score)||0}% <small>${esc(T('EŞLEŞME','MATCH'))}</small></div><div class="outlookResultHead"><div><b>${esc(item.subject || T('(Konu yok)','(No subject)'))}</b><span>${esc(senderText(item.sender))} · ${esc(formatDate(item.receivedAt))}</span></div>${item.isRead?'':'<i></i>'}</div><div class="outlookPreview">${previewHtml(item.preview || '')}</div><div class="outlookMatches">${matches}</div><footer>${resultContentMeta(item)}<div>${hasCapability('OUTLOOK_MAIL.LINK')?`<button type="button" data-outlook-link${link?' disabled':''}>${esc(link?T('Bağlandı','Linked'):T('Siparişe Bağla','Link to Order'))}</button>`:''}${link&&hasCapability('OUTLOOK_MAIL.PIN')?`<button type="button" data-outlook-pin data-link-id="${esc(link.id)}">${esc(link.isPinned?T('İşareti Kaldır','Unpin'):T('Önemli İşaretle','Pin Important'))}</button>`:''}${hasCapability('OUTLOOK_INTELLIGENCE.VIEW')?`<button type="button" data-outlook-analyze>${esc(T('Gelişmeyi İncele','Review Development'))}</button>`:''}<button type="button" data-outlook-detail>${esc(T('Detay','Detail'))}</button>${item.mailboxType==='CLASSIC_OUTLOOK_LOCAL'?`<button type="button" class="primary" data-outlook-open-local>${esc(T("Outlook'ta Aç",'Open in Outlook'))}</button>`:item.webLink?`<button type="button" class="primary" data-outlook-open data-link="${esc(item.webLink)}">${esc(T("Outlook'ta Aç",'Open in Outlook'))}</button>`:''}</div></footer><div class="outlookMessageDetail" hidden></div></article>`;
  }
  function conversationCards(items) {
    const map = new Map(); items.forEach(item => { const key=item.conversationId||item.messageId; if(!map.has(key))map.set(key,[]); map.get(key).push(item); });
    return [...map.values()].sort((a,b)=>Math.max(...b.map(x=>x.score))-Math.max(...a.map(x=>x.score))).map(messages => messages.length === 1 ? resultCard(messages[0]) : `<details class="outlookThread" data-conversation-id="${esc(messages[0].conversationId||'')}"><summary><div><b>${esc(messages[0].subject || T('(Konu yok)','(No subject)'))}</b><span>${messages.length} ${esc(T('mesaj','messages'))} · ${esc(formatDate(messages.map(x=>x.receivedAt).sort().at(-1)))}</span></div><strong>${Math.max(...messages.map(x=>x.score))}%</strong>${hasCapability('OUTLOOK_MAIL.AI_SUMMARY')?`<button type="button" data-outlook-summary>${esc(T('AI ile Özetle','Summarize with AI'))}</button>`:''}</summary><div data-outlook-summary-result></div>${messages.sort((a,b)=>Date.parse(b.receivedAt)-Date.parse(a.receivedAt)).map(resultCard).join('')}</details>`).join('');
  }
  function renderResults() {
    const results = state.drawer?.querySelector('[data-outlook-results]'); if (!results) return;
    const items = [...state.items.values()];
    if (!items.length) {
      results.innerHTML = `<div class="outlookEmpty"><b>${esc(T('Bu siparişle eşleşen mail bulunamadı.','No emails matched this order.'))}</b><p>${esc(T('Daha geniş arama yapabilir veya arama kriterlerini değiştirebilirsiniz.','Broaden the search or change the search criteria.'))}</p><button type="button" data-outlook-broad>${esc(T('Daha Geniş Ara','Broaden Search'))}</button></div>`;
    } else {
      const grouped = state.drawer.querySelector('[data-outlook-group]')?.checked;
      const manual=clean(state.drawer.querySelector('[data-outlook-manual]')?.value);const manualMeta=manual?` · ${esc(T('Manuel','Manual'))}: <b>${esc(manual)}</b>`:'';
      results.innerHTML = `<div class="outlookResultMeta">${items.length} ${esc(T('mail bulundu','emails found'))}${manualMeta}</div>${grouped?conversationCards(items):items.map(resultCard).join('')}${state.hasMore?`<button type="button" class="outlookMore" data-outlook-more>${esc(T('Daha Fazla Göster','Show More'))}</button>`:''}`;
    }
    bindResultActions(results);
  }
  function bindResultActions(root) {
    root.querySelector('[data-outlook-broad]')?.addEventListener('click',()=>search({reset:true,broad:true}));
    root.querySelector('[data-outlook-retry]')?.addEventListener('click',()=>search({reset:true}));
    root.querySelector('[data-outlook-connect-inline]')?.addEventListener('click',()=>connect(()=>openForContext(state.context,state.module)));
    root.querySelectorAll('[data-outlook-bridge]').forEach(button=>button.addEventListener('click',()=>openBridge(button)));
    root.querySelector('[data-outlook-more]')?.addEventListener('click',()=>{state.page++;search();});
    root.querySelectorAll('[data-outlook-open]').forEach(button=>button.addEventListener('click',()=>{
      const card=button.closest('[data-message-id]'),link=button.dataset.link,opened=link&&window.open(link,'_blank','noopener,noreferrer');
      if(link&&!opened)toast(T('Outlook bağlantısı tarayıcı tarafından engellendi. Açılır pencere iznini kontrol edin.','The Outlook link was blocked by the browser. Check pop-up permissions.'));
      void api('/api/outlook/message-opened',{method:'POST',body:JSON.stringify({messageId:card&&card.dataset.messageId})}).catch(()=>{});
    }));
    root.querySelectorAll('[data-outlook-open-local]').forEach(button=>button.addEventListener('click',async()=>{
      const card=button.closest('[data-message-id]'),item=card&&itemForCard(card);if(!card)return;const old=button.textContent;button.disabled=true;button.textContent=T('Outlook açılıyor…','Opening Outlook…');try{await api('/api/outlook/local/open',{method:'POST',body:JSON.stringify({messageId:card.dataset.messageId,internetMessageId:item&&item.internetMessageId||''})});}catch(error){toast(error.message);}finally{button.disabled=false;button.textContent=old;}
    }));
    root.querySelectorAll('[data-outlook-detail]').forEach(button=>button.addEventListener('click',()=>loadDetail(button)));
    root.querySelectorAll('[data-outlook-link]').forEach(button=>button.addEventListener('click',()=>linkMessage(button)));
    root.querySelectorAll('[data-outlook-analyze]').forEach(button=>button.addEventListener('click',()=>analyzeMessage(button)));
    root.querySelectorAll('[data-outlook-pin]').forEach(button=>button.addEventListener('click',()=>pinMessage(button)));
    root.querySelectorAll('[data-outlook-summary]').forEach(button=>button.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();summarizeConversation(button);}));
  }
  function detailTableHtml(table){
    const rows=Array.isArray(table&&table.rows)?table.rows:[];
    return `<section class="outlookRichItem" id="outlook-${esc(table&&table.id||'table')}"><h5>▦ ${esc(T('Tablo','Table'))}${Number(table&&table.index)||''}</h5><div class="outlookTableScroll"><table>${rows.map(row=>`<tr>${(row||[]).map(cell=>cell&&cell.header?`<th>${esc(cell.text||'')}</th>`:`<td>${esc(cell&&cell.text||'')}</td>`).join('')}</tr>`).join('')}</table></div></section>`;
  }
  function detailImageHtml(image){
    const label=`${T('Görsel','Image')}${Number(image&&image.index)||''}`,canLoad=Boolean(image&&image.attachmentId&&hasCapability('OUTLOOK_MAIL.ATTACHMENT_VIEW'));
    return `<section class="outlookRichItem outlookInlineImage" id="outlook-${esc(image&&image.id||'image')}"><h5>▧ ${esc(label)}</h5>${image&&image.alt?`<small>${esc(image.alt)}</small>`:''}<div data-inline-image-host>${canLoad?`<button type="button" data-outlook-inline-image="${esc(image.attachmentId)}">${esc(T('Görseli Göster','Show Image'))}</button>`:`<span>${esc(image&&image.src&&/^https?:/i.test(image.src)?T('Uzak görsel gizlilik nedeniyle otomatik yüklenmedi.','Remote image was not loaded automatically for privacy.'):T('Görsel önizlemesi kullanılamıyor.','Image preview is unavailable.'))}</span>`}</div></section>`;
  }
  function detailMessageHtml(content){
    const blocks=Array.isArray(content&&content.blocks)?content.blocks:[];
    if(!blocks.length)return `<div class="outlookBodyContent outlookEmptyBody">${esc(T('Gösterilecek içerik bulunamadı.','No displayable content found.'))}</div>`;
    return `<div class="outlookBodyContent">${blocks.map(block=>block.type==='paragraph'?`<div class="outlookMailParagraph">${esc(block.text||'').replace(/\n/g,'<br>')}</div>`:block.type==='tableRef'?`<div class="outlookContentRefLine"><span class="outlookContentRef table">▦ ${esc(T('Tablo','Table'))}${Number(block.index)||''}</span></div>`:block.type==='imageRef'?`<div class="outlookContentRefLine"><span class="outlookContentRef image">▧ ${esc(T('Görsel','Image'))}${Number(block.index)||''}</span></div>`:'').join('')}</div>`;
  }
  function detailRichContentHtml(content){
    const tables=Array.isArray(content&&content.tables)?content.tables:[],images=Array.isArray(content&&content.images)?content.images:[];
    if(!tables.length&&!images.length)return '';
    return `<section class="outlookRichContent"><h4>${esc(T('İçerikler','Contents'))}</h4>${tables.map(detailTableHtml).join('')}${images.map(detailImageHtml).join('')}</section>`;
  }
  async function loadDetail(button) {
    const card=button.closest('[data-message-id]'),box=card&&card.querySelector('.outlookMessageDetail');if(!card||!box)return;
    if(!box.hidden){box.hidden=true;return;} box.hidden=false;box.innerHTML=skeleton();button.disabled=true;
    try{
      const target=entityTarget(),data=await api('/api/outlook/v2/message-detail',{method:'POST',body:JSON.stringify({...target,messageId:card.dataset.messageId,mailboxType:card.dataset.mailboxType,mailboxAddress:card.dataset.mailboxAddress})}),content=data.content||{};
      const attachmentRows=(data.attachments||[]).filter(item=>!item.isInline||!content.images?.some(image=>image.attachmentId===item.id));
      box.innerHTML=`<section class="outlookDetailSection"><h4>${esc(T('Mesaj','Message'))}</h4>${detailMessageHtml(content)}</section>${detailRichContentHtml(content)}${attachmentRows.length?`<section class="outlookDetailSection"><h4>${esc(T('Ekler','Attachments'))}</h4><ul class="outlookAttachments">${attachmentRows.map(item=>`<li>📎 <span>${esc(item.name)} <small>${Math.ceil((item.size||0)/1024)} KB · ${esc(item.attachmentType||'file')}</small></span>${hasCapability('OUTLOOK_MAIL.ATTACHMENT_VIEW')?`<button type="button" data-outlook-attachment="${esc(item.id)}">${esc(T('Güvenli Önizle','Safe Preview'))}</button>`:''}</li>`).join('')}</ul></section>`:''}`;
      const item=itemForCard(card);if(item&&content){item.tableCount=Number(content.tableCount)||0;item.imageCount=Number(content.imageCount)||0;}
      box.querySelectorAll('[data-outlook-attachment]').forEach(item=>item.addEventListener('click',()=>openAttachment(card,item)));
      box.querySelectorAll('[data-outlook-inline-image]').forEach(item=>item.addEventListener('click',()=>loadInlineImage(card,item)));
    }catch(error){box.innerHTML=errorState(error);}finally{button.disabled=false;}
  }
  function entityTarget(){return{entityType:state.context&&state.context._entityType||'ORDER',entityId:state.context&&state.context._entityId||state.context&&state.context.orderNo||''};}
  function itemForCard(card){return[...state.items.values()].find(item=>item.messageId===card.dataset.messageId&&(item.mailboxAddress||'')===(card.dataset.mailboxAddress||''));}
  async function linkMessage(button){const card=button.closest('[data-message-id]'),item=card&&itemForCard(card),target=entityTarget();if(!item||!target.entityId)return toast(T('İlişkilendirme hedefi bulunamadı.','Link target was not found.'));button.disabled=true;try{const data=await api('/api/outlook/v2/links',{method:'POST',body:JSON.stringify({...target,mailboxType:item.mailboxType||'PERSONAL',mailboxAddress:item.mailboxAddress||'',graphMessageId:item.messageId,internetMessageId:item.internetMessageId,conversationId:item.conversationId,subject:item.subject,sender:senderText(item.sender),receivedDateTime:item.receivedAt,confidence:item.score,source:'MANUAL'})}),link=data.results&&data.results[0]&&data.results[0].item;if(link){state.linked.set(`${item.mailboxAddress||''}|${item.messageId}`,link);button.textContent=T('Bağlandı','Linked');button.disabled=true;toast(T('Mail sipariş timeline’ına bağlandı.','Email linked to the order timeline.'));}}catch(error){toast(error.message);button.disabled=false;}}
  async function pinMessage(button){const linkId=button.dataset.linkId,link=[...state.linked.values()].find(item=>item.id===linkId);if(!link)return;const pin=!link.isPinned,tag=pin?prompt(T('Etiket (Termin, Fiyat, Onay, Revizyon, İptal, Numune, Sevkiyat, Kalite, Üretim, Ödeme, Diğer)','Tag (Termin, Price, Approval, Revision, Cancellation, Sample, Shipment, Quality, Production, Payment, Other)'),'Termin'):'';if(pin&&tag===null)return;button.disabled=true;try{const data=await api(`/api/outlook/v2/links/${encodeURIComponent(linkId)}`,{method:'PATCH',body:JSON.stringify({isPinned:pin,pinReason:pin?tag:'',tags:pin?[tag]:[]})});Object.assign(link,data.item);button.textContent=pin?T('İşareti Kaldır','Unpin'):T('Önemli İşaretle','Pin Important');}catch(error){toast(error.message);}finally{button.disabled=false;}}
  async function summarizeConversation(button){const thread=button.closest('[data-conversation-id]'),box=thread&&thread.querySelector('[data-outlook-summary-result]'),target=entityTarget(),conversationId=thread&&thread.dataset.conversationId;if(!box)return;button.disabled=true;box.innerHTML=skeleton();try{const messages=[...state.items.values()].filter(item=>(item.conversationId||'')===conversationId).sort((a,b)=>Date.parse(a.receivedAt)-Date.parse(b.receivedAt)).map(item=>({messageId:item.messageId,receivedAt:item.receivedAt,sender:item.sender,subject:item.subject,preview:item.preview})),result=await api('/api/outlook/v2/summary',{method:'POST',body:JSON.stringify({...target,conversationId,messages,language:typeof appLang!=='undefined'?appLang:'tr'})});box.innerHTML=`<section class="outlookSummary"><h4>${esc(T('Özet','Summary'))}</h4><p>${esc(result.summary)}</p>${(result.keyDecisions||[]).length?`<b>${esc(T('Kararlar','Decisions'))}</b><ul>${result.keyDecisions.map(item=>`<li>${esc(item.text)}${item.sourceMessage?` <small>${esc(T('Kaynak Mail','Source Mail'))} ${item.sourceMessage}</small>`:''}</li>`).join('')}</ul>`:''}${(result.actions||[]).length?`<b>${esc(T('Aksiyon','Actions'))}</b><ul>${result.actions.map(item=>`<li>${esc(item)}</li>`).join('')}</ul>`:''}${(result.risks||[]).length?`<b>${esc(T('Riskler','Risks'))}</b><ul>${result.risks.map(item=>`<li>${esc(item.detail||item.type)}</li>`).join('')}</ul>`:''}<small>${esc(confidenceLabel(result.confidence))}${result.aiUnavailable?` · ${esc(T('AI kullanılamadı; güvenli kural özeti gösterildi.','AI unavailable; safe rule summary shown.'))}`:''}</small></section>`;}catch(error){box.innerHTML=errorState(error);}finally{button.disabled=false;}}
  async function analyzeMessage(button){const card=button.closest('[data-message-id]'),item=card&&itemForCard(card),target=entityTarget();if(!item||!target.entityId)return;button.disabled=true;try{const result=await api('/api/outlook/v2/analyze',{method:'POST',body:JSON.stringify({...target,context:state.context,message:{...item,bodyText:item.preview}})}),box=card.querySelector('.outlookMessageDetail');box.hidden=false;box.innerHTML=`<div class="outlookDetection"><b>${esc(T('Neden tespit edildi?','Why was it detected?'))}</b>${(result.classifications||[]).slice(0,4).map(row=>`<span>${esc(row.type)} · ${esc(confidenceLabel(row.confidence))}</span>`).join('')}${(result.candidates||[]).map(candidate=>`<article><strong>${esc(candidate.type)}</strong><span>${esc(candidate.oldValue||'—')} → ${esc(candidate.newValue||'—')}</span><small>${esc(confidenceLabel(candidate.confidence))}</small>${candidate.sourceExcerpt?`<p>${esc(candidate.sourceExcerpt)}</p>`:''}<div><button data-candidate-decision="REJECTED" data-id="${esc(candidate.id)}">${esc(T('Reddet','Reject'))}</button>${!candidate.ambiguous?`<button class="primary" data-candidate-decision="ACCEPTED" data-id="${esc(candidate.id)}">${esc(T('Değişikliği Uygula','Apply Change'))}</button>`:''}</div></article>`).join('')}</div>`;box.querySelectorAll('[data-candidate-decision]').forEach(action=>action.addEventListener('click',()=>decideCandidate(action)));}catch(error){toast(error.message);}finally{button.disabled=false;}}
  function confidenceLabel(value){const n=Number(value)||0;return n>=85?T('Yüksek Güven','High Confidence'):n>=60?T('Orta Güven','Medium Confidence'):T('Düşük Güven','Low Confidence');}
  async function decideCandidate(button){if(button.dataset.candidateDecision==='ACCEPTED'&&!confirm(T('Değişiklik mevcut Buyer Log güncelleme akışıyla uygulansın mı?','Apply this through the existing Buyer Log update flow?')))return;button.disabled=true;try{await api(`/api/outlook/v2/candidates/${encodeURIComponent(button.dataset.id)}/decision`,{method:'POST',body:JSON.stringify({decision:button.dataset.candidateDecision})});toast(button.dataset.candidateDecision==='ACCEPTED'?T('Değişiklik uygulandı.','Change applied.'):T('Aday reddedildi.','Candidate rejected.'));button.closest('article')?.remove();}catch(error){toast(error.message);button.disabled=false;}}
  async function attachmentBlob(card,attachmentId){
    const target=entityTarget(),response=await fetch('/api/outlook/v2/attachment',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...target,messageId:card.dataset.messageId,attachmentId,mailboxType:card.dataset.mailboxType,mailboxAddress:card.dataset.mailboxAddress})});
    if(!response.ok){const data=await response.json().catch(()=>({}));throw new Error(data.error||response.statusText);}return response.blob();
  }
  async function openAttachment(card,button){button.disabled=true;try{const blob=await attachmentBlob(card,button.dataset.outlookAttachment),url=URL.createObjectURL(blob);window.open(url,'_blank','noopener,noreferrer');setTimeout(()=>URL.revokeObjectURL(url),60000);}catch(error){toast(error.message);}finally{button.disabled=false;}}
  async function loadInlineImage(card,button){button.disabled=true;const host=button.closest('[data-inline-image-host]');try{const blob=await attachmentBlob(card,button.dataset.outlookInlineImage);if(!/^image\//i.test(blob.type))throw new Error(T('Bu içerik güvenli bir görsel olarak doğrulanamadı.','This content could not be verified as a safe image.'));const url=URL.createObjectURL(blob),img=document.createElement('img');img.alt=T('Mail içi görsel','Inline email image');img.onload=()=>URL.revokeObjectURL(url);img.onerror=()=>URL.revokeObjectURL(url);img.src=url;if(host){host.innerHTML='';host.appendChild(img);}}catch(error){toast(error.message);button.disabled=false;}}
  async function renderTimeline(){const results=state.drawer?.querySelector('[data-outlook-results]'),target=entityTarget();if(!results||!target.entityId)return;results.innerHTML=skeleton();try{const data=await api(`/api/outlook/v2/timeline/${encodeURIComponent(target.entityType)}/${encodeURIComponent(target.entityId)}`);results.innerHTML=`<div class="outlookTimeline"><h3>${esc(T('İletişim Timeline','Communication Timeline'))}</h3>${(data.events||[]).length?(data.events||[]).map(event=>`<article><time>${esc(formatDate(event.occurredAt))}</time><div><b>${esc(event.subtype||event.eventType)}</b><span>${esc(event.mail&&event.mail.subjectSnapshot||event.metadata&&event.metadata.subject||'')}</span>${event.mail&&event.mail.senderSnapshot?`<small>${esc(event.mail.senderSnapshot)}</small>`:''}</div></article>`).join(''):`<p>${esc(T('Henüz ilişkilendirilmiş mail bulunmuyor.','No linked emails yet.'))}</p>`}</div>`;}catch(error){results.innerHTML=errorState(error);}}
  async function watchOrder(event){const target=entityTarget();if(!target.entityId)return;event.currentTarget.disabled=true;try{await api(`/api/outlook/v2/watch/${encodeURIComponent(target.entityId)}`,{method:'POST',body:JSON.stringify({entityType:target.entityType,enabled:true,eventTypes:['DELIVERY_DATE_CHANGE','CANCELLATION','PRICE_CHANGE','APPROVAL']})});event.currentTarget.textContent=T('Takip Ediliyor','Watching');toast(T('Termin, iptal, fiyat ve onay gelişmeleri için takip açıldı.','Watching delivery, cancellation, price and approval developments.'));}catch(error){toast(error.message);event.currentTarget.disabled=false;}}
  async function openDashboard(){const body=openShell();state.context=null;body.innerHTML=skeleton();try{const data=await api('/api/outlook/v2/dashboard');body.innerHTML=`<section class="outlookIntelDashboard"><div class="outlookContext"><div><h3>${esc(T('Mail Intelligence','Mail Intelligence'))}</h3><small>${esc(T('Bu ekran mailbox inbox değil, sipariş iletişim zekâsıdır.','This is business communication intelligence, not a mailbox inbox.'))}</small></div><button data-outlook-settings>⚙</button></div><div class="outlookIntelStats"><div><span>${esc(T('İlgili Mail','Linked Emails'))}</span><b>${Number(data.summary&&data.summary.linkedMails)||0}</b></div><div><span>${esc(T('Conversation','Conversations'))}</span><b>${Number(data.summary&&data.summary.conversations)||0}</b></div><div><span>${esc(T('Bekleyen Değişiklik','Pending Changes'))}</span><b>${Number(data.summary&&data.summary.pendingChanges)||0}</b></div><div><span>${esc(T('Önemli','Pinned'))}</span><b>${Number(data.summary&&data.summary.pinned)||0}</b></div></div><h4>${esc(T('Kritik','Critical'))}</h4>${(data.critical||[]).length?(data.critical||[]).map(item=>`<article class="outlookIntelItem critical"><b>${esc(item.type)}</b><span>${esc(item.entityType)} ${esc(item.entityId)}</span><small>${esc(confidenceLabel(item.confidence))}</small></article>`).join(''):`<p>${esc(T('Kritik açık sinyal yok.','No open critical signals.'))}</p>`}<h4>${esc(T('Aksiyon Bekleyen','Action Required'))}</h4>${(data.actionRequired||[]).slice(0,50).map(item=>`<article class="outlookIntelItem"><b>${esc(item.type)}</b><span>${esc(item.entityType)} ${esc(item.entityId)} · ${esc(item.newValue||'')}</span></article>`).join('')||`<p>${esc(T('Açık değişiklik adayı yok.','No pending change candidates.'))}</p>`}<h4>${esc(T('Eşleşmemiş Mailler','Unmatched Emails'))}</h4>${(data.unmatched||[]).slice(0,50).map(item=>`<article class="outlookIntelItem"><b>${esc(item.metadata&&item.metadata.subject||T('(Konu yok)','(No subject)'))}</b><span>${esc(formatDate(item.occurredAt))}</span></article>`).join('')||`<p>${esc(T('Eşleşmemiş önemli mail yok.','No unmatched important emails.'))}</p>`}</section>`;body.querySelector('[data-outlook-settings]')?.addEventListener('click',openSettings);}catch(error){body.innerHTML=errorState(error);}}
  async function openHealth(){const body=openShell();state.context=null;body.innerHTML=skeleton();try{const [health,mailboxes]=await Promise.all([api('/api/outlook/v2/admin/health'),api('/api/outlook/v2/admin/managed-mailboxes')]);body.innerHTML=`<section class="outlookHealth"><div class="outlookContext"><div><h3>${esc(T('Outlook Intelligence Sağlığı','Outlook Intelligence Health'))}</h3><small>${esc(T('Background erişim iki kapsam kontrolüyle fail-closed çalışır.','Background access is fail-closed behind two scope checks.'))}</small></div><button data-outlook-settings>⚙</button></div><div class="outlookHealthGrid"><div><span>Graph</span><b>${health.graph&&health.graph.configured?'Healthy':'Setup Required'}</b></div><div><span>${esc(T('Yönetilen Mailbox','Managed Mailboxes'))}</span><b>${Number(health.managedMailboxes)||0}</b></div><div><span>${esc(T('Aktif Subscription','Active Subscriptions'))}</span><b>${Number(health.subscriptions)||0}</b></div><div><span>${esc(T('Süresi Yaklaşan','Expiring Soon'))}</span><b>${Number(health.expiringSoon)||0}</b></div><div><span>${esc(T('Kuyruk','Queue'))}</span><b>${Number(health.queue&&health.queue.pending)||0}</b></div><div><span>${esc(T('Başarısız','Failed'))}</span><b>${Number(health.queue&&health.queue.failed)||0}</b></div></div><form data-mailbox-form class="outlookMailboxForm"><h4>${esc(T('Microsoft Mailbox Ekle / Güncelle','Add / Update Microsoft Mailbox'))}</h4><input type="email" name="email" required placeholder="buying@company.com"><input name="displayName" placeholder="Buying Shared"><label><input type="checkbox" name="isEnabled" checked> ${esc(T('Aktif','Enabled'))}</label><label><input type="checkbox" name="intelligenceEnabled"> Intelligence</label><label><input type="checkbox" name="watchInbox" checked> Inbox</label><label><input type="checkbox" name="watchSentItems"> Sent Items</label><button class="primary" type="submit">${esc(T('Kaydet','Save'))}</button></form><div data-mailbox-list>${(mailboxes.items||[]).map(item=>`<article class="outlookMailboxRow"><div><b>${esc(item.displayName||item.email)}</b><span>${esc(item.email)}</span></div><small>${item.isEnabled?'Enabled':'Disabled'} · Intelligence ${item.intelligenceEnabled?'On':'Off'}</small><button data-mailbox-delete="${esc(item.id)}">${esc(T('Kaldır','Remove'))}</button></article>`).join('')}</div><button type="button" data-subscription-ensure>${esc(T('Subscription’ları Kontrol Et','Ensure Subscriptions'))}</button><button type="button" data-queue-process>${esc(T('Kuyruğu Şimdi İşle','Process Queue Now'))}</button></section>`;body.querySelector('[data-outlook-settings]')?.addEventListener('click',openSettings);body.querySelector('[data-mailbox-form]')?.addEventListener('submit',saveMailbox);body.querySelectorAll('[data-mailbox-delete]').forEach(button=>button.addEventListener('click',()=>deleteMailbox(button)));body.querySelector('[data-subscription-ensure]')?.addEventListener('click',async event=>{event.currentTarget.disabled=true;try{const result=await api('/api/outlook/v2/admin/subscriptions/ensure',{method:'POST',body:'{}'});toast(`${result.created||0} created · ${result.renewed||0} renewed · ${result.failed||0} failed`);await openHealth();}catch(error){toast(error.message);event.currentTarget.disabled=false;}});body.querySelector('[data-queue-process]')?.addEventListener('click',async event=>{event.currentTarget.disabled=true;try{const result=await api('/api/outlook/v2/admin/queue/process',{method:'POST',body:JSON.stringify({limit:20})});toast(`${(result.results||[]).length} job`);await openHealth();}catch(error){toast(error.message);event.currentTarget.disabled=false;}});}catch(error){body.innerHTML=errorState(error);}}
  async function saveMailbox(event){event.preventDefault();const form=event.currentTarget,data=Object.fromEntries(new FormData(form));data.isEnabled=form.elements.isEnabled.checked;data.intelligenceEnabled=form.elements.intelligenceEnabled.checked;data.watchInbox=form.elements.watchInbox.checked;data.watchSentItems=form.elements.watchSentItems.checked;const button=form.querySelector('button[type="submit"]');button.disabled=true;try{await api('/api/outlook/v2/admin/managed-mailboxes',{method:'POST',body:JSON.stringify(data)});await openHealth();}catch(error){toast(error.message);button.disabled=false;}}
  async function deleteMailbox(button){if(!confirm(T('Managed mailbox kaydı kaldırılsın mı?','Remove managed mailbox registry entry?')))return;button.disabled=true;try{await api(`/api/outlook/v2/admin/managed-mailboxes/${encodeURIComponent(button.dataset.mailboxDelete)}`,{method:'DELETE'});await openHealth();}catch(error){toast(error.message);button.disabled=false;}}
  async function openBridge(button){
    if(!state.context)return toast(T('Outlook araması için önce bir sipariş seçin.','Select an order before opening Outlook search.'));
    if(button)button.disabled=true;
    try{
      let options={};
      if(state.drawer&&state.drawer.querySelector('[data-outlook-results]')){try{options=searchOptions();}catch(_){} }
      const result=await api('/api/outlook/bridge',{method:'POST',body:JSON.stringify({context:state.context,options})});
      toast(result.mode==='INSTANT_SEARCH'?T('Arama Classic Outlook içinde açıldı.','Search opened in Classic Outlook.'):T('Arama metni panoya kopyalandı ve Outlook açıldı. Ctrl+V → Enter kullanın.','Search text was copied and Outlook opened. Use Ctrl+V → Enter.'));
    }catch(error){toast(error.message);}finally{if(button)button.disabled=false;}
  }
  async function openForContext(context, module, options={}) {
    if (!canUse()) { toast(T('Bu özellik için Outlook Sipariş Maillerini Ara yetkiniz bulunmuyor.','You do not have permission to search Outlook order emails.')); return; }
    const previousManual=options.preserveManual&&state.drawer?clean(state.drawer.querySelector('[data-outlook-manual]')?.value):'';
    state.context = buildContext(context); state.module = module || ''; state.page=0;state.items.clear();
    if(!options.preserveManual && !options.preserveCriteria) resetContextFields(state.context);
    const body=openShell();body.innerHTML=skeleton();
    try{
      const status=await loadStatus();await loadV2Meta();
      if(!status.connected){body.innerHTML=`${statusCard(status)}<div class="outlookInfo"><p>${esc(status.bridgeAvailable?T('Classic Outlook yerel okuması kullanılamıyor. Sipariş aramasını doğrudan Outlook ekranında açabilirsiniz.','Classic Outlook local reading is unavailable. You can open the order search directly in Outlook.'):T('Microsoft Graph veya Classic Outlook Local kullanılabilir olduğunda arama başlayacaktır.','Search will start when Microsoft Graph or Classic Outlook Local becomes available.'))}</p></div>${status.bridgeAvailable?`<button type="button" class="outlookAdminOpen primary" data-outlook-bridge>${esc(T("Classic Outlook'ta Ara",'Search in Classic Outlook'))}</button>`:''}`;bindConnectionActions(body,()=>openForContext(state.context,state.module));return;}
      body.innerHTML=searchLayout(previousManual);bindSearch(body);await search({reset:true});
    }catch(error){body.innerHTML=errorState(error);bindResultActions(body);}
  }
  function openRow(row,module){const context=buildContext(row);context._entityType=module==='collection'?'COLLECTION':'ORDER';if(module==='collection')context._entityId=pick(row,['id','plmId','PLM ID','PLM Code'])||context._entityId||context.plmCode||context.modelName;else context._entityId=context.orderNo||context.poNo||pick(row,['Order Code','Order No','Order Number','Sipariş Kod','Sipariş Kodu','Sipariş No','PO No','PO'])||context._entityId;if(!context.orderNo&&!context.poNo&&!context.modelName&&!context.plmCode){toast(T('Bu satırda Outlook araması için sipariş veya model bilgisi bulunamadı.','This row has no order or model information for Outlook search.'));return;}return openForContext(context,module);}
  function toast(message){try{if(typeof showToast==='function')showToast(message);else alert(message);}catch(_){alert(message);}}

  document.addEventListener('click',event=>{const button=event.target.closest('.outlookRowBtn');if(!button)return;event.preventDefault();event.stopPropagation();const row=rowFromButton(button);if(row)openRow(row,moduleFromButton(button));});
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&state.drawer&&!state.drawer.hidden)close();});
  window.addEventListener('message',event=>{if(event.origin!==location.origin||!event.data||event.data.type!=='BUYER_LOG_OUTLOOK_AUTH')return;clearInterval(state.authTimer);state.authTimer=null;state.authPopup=null;if(event.data.ok){loadStatus().then(()=>state.context?openForContext(state.context,state.module):openSettings());}else toast(event.data.message||T('Microsoft bağlantısı tamamlanamadı.','Microsoft connection could not be completed.'));});

  let notificationPollBusy=false;
  async function pollIntelligenceNotifications(){if(notificationPollBusy||!hasCapability('OUTLOOK_INTELLIGENCE.VIEW')||document.hidden)return;notificationPollBusy=true;try{const data=await api('/api/outlook/v2/notifications'),key='buyerlog.outlook.notifications.seen.v1';let seen=[];try{seen=JSON.parse((window.BLStorage||localStorage).getItem(key)||'[]');}catch(_){}const known=new Set(Array.isArray(seen)?seen:[]),fresh=(data.items||[]).filter(item=>!known.has(item.id));fresh.slice(0,5).reverse().forEach(item=>toast(`${item.severity==='CRITICAL'?'⚠ ':''}${item.title}: ${item.message}`));const next=[...(data.items||[]).map(item=>item.id),...known].slice(0,500);try{(window.BLStorage||localStorage).setItem(key,JSON.stringify(next));}catch(_){}}catch(_){}finally{notificationPollBusy=false;}}
  setTimeout(pollIntelligenceNotifications,4000);setInterval(pollIntelligenceNotifications,60000);

  window.BLOutlook = { canUse, buttonHtml, buildContext, openRow, openForContext, openSettings, openDashboard, openHealth, close };
})();
