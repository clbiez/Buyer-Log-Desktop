/* Buyer Log — Yol Süreleri › İthalat Yol Süresi Analizi paneli.
 *
 * Yol Süreleri penceresi açıldığında lazy yüklenir (perf-runtime: transitAnalysis).
 * Süreler doğrudan IAS (Antrepo) parsiyellerinden hesaplanır (/api/transit-analysis/live).
 * Aşama süre modeli sunucuda aynı parsiyellerden kurulup tek merkezde saklanır
 * (/api/transit-analysis/stage-model); Backlog Teslimat Riski ETA'yı bununla hesaplar.
 * Panel kuralları KENDİSİ KAYDETMEZ: seçili öneriler pencerenin çalışma listesine
 * aktarılır, kullanıcı mevcut "Kuralları Kaydet" akışıyla onaylar. */
(function attachTransitAnalysisUI(global) {
  'use strict';

  // Arayüz dili her çizimde aktif appLang'dan okunur (app-main).
  const isEn = () => typeof appLang !== 'undefined' && appLang === 'en';
  const L = (tr, en) => (isEn() ? en : tr);
  const loc = () => (isEn() ? 'en-GB' : 'tr-TR');
  const lang = () => (isEn() ? 'en' : 'tr');
  const VIEW_KEY = 'lcw.transitAnalysis.view.v1';
  // Kayıtlı aşama süre modeli (risk hesabının okuduğu).
  const store = { loaded: false, model: null, revision: 0, pending: null };
  // Excel'siz varsayılan kaynak: Buyer Log'un ASAS + IAS verisinden canlı hesap.
  const live = { loaded: false, analysis: null, message: '', meta: null, warnings: [], params: '', pending: null };

  /* params: { scope: 'filtered'|'company', window: 'w4'|'m3'|'y1'|'all'… }.
     Kapsam/pencere değişince sunucudan yeniden hesaplanır; hata (ör. şirket
     geneli yetkisi yok) panelde mesaj olarak gösterilir, kontroller kalır. */
  const liveSnapshots=new Map(),summarySnapshots=new WeakMap();
  const LIVE_TTL_MS=5*60*1000,MAX_LIVE_RECORDS=40000;
  let liveGeneration=0,liveRequestSeq=0;
  const localDay=()=>{const d=new Date();return `${d.getFullYear()}-${d.getMonth()+1}-${d.getDate()}`;};
  const liveKey=params=>[params.scope==='filtered'?'filtered':'company',params.window||'y1',params.weight==='qty'?'qty':'shipment',localDay()].join('|');
  function rememberLive(key,result){
    liveSnapshots.delete(key);liveSnapshots.set(key,result);
    const count=()=>[...liveSnapshots.values()].reduce((n,item)=>n+(item.analysis?.records?.length||0),0);
    while(liveSnapshots.size>4||count()>MAX_LIVE_RECORDS)liveSnapshots.delete(liveSnapshots.keys().next().value);
  }
  function summarized(analysis,params){
    let cache=summarySnapshots.get(analysis);if(!cache){cache=new Map();summarySnapshots.set(analysis,cache);}
    const key=JSON.stringify(params);
    if(cache.has(key))return cache.get(key);
    const result=TA().summarize(analysis,params);cache.set(key,result);
    if(cache.size>6)cache.delete(cache.keys().next().value);
    return result;
  }
  async function loadLive(force = false, params = {}) {
    const scope=params.scope==='filtered'?'filtered':'company',win=params.window||'y1',weight=params.weight==='qty'?'qty':'shipment',key=liveKey(params);
    if(live.pending&&live.pendingKey===key&&(!force||live.pendingForce))return live.pending;
    if(!force){
      const cached=liveSnapshots.get(key);
      if(cached&&Date.now()-cached.at<LIVE_TTL_MS){
        ++liveRequestSeq;live.pending=null;live.pendingKey='';liveSnapshots.delete(key);liveSnapshots.set(key,cached);Object.assign(live,cached,{message:L(cached.messageTr||cached.message,cached.messageEn||cached.message)});return live;
      }
    }else{liveSnapshots.clear();++liveGeneration;live.loaded=false;}
    const generation=liveGeneration,sequence=++liveRequestSeq;
    const pending=(async()=>{
      const result={loaded:true,params:key,analysis:null,message:'',warnings:[],diag:null,meta:null,at:Date.now()};
      if(!global.SERVER_BACKED)result.message=L('Buyer Log verisinden hesap sunucu modunda çalışır.', 'Calculating from Buyer Log data requires server mode.');
      else{
        const qs=new URLSearchParams({scope,window:win,weight,...(force?{refresh:'1'}:{})});
        const res=await fetch('/api/transit-analysis/live?'+qs.toString(),{headers:{Accept:'application/json'}});
        const data=await res.json().catch(()=>({}));
        if(!res.ok)result.message=L(data.error||res.statusText,data.errorEn||data.error||res.statusText);
        else{
          result.analysis=data.analysis||null;result.stageModel=SM()?SM().normalizeModel(data.stageModel):null;result.messageTr=data.message||'';result.messageEn=data.messageEn||data.message||'';result.message=L(result.messageTr,result.messageEn);
          result.warnings=Array.isArray(data.warnings)?data.warnings:[];result.diag=data.diag||null;
          result.meta={antrepoSourceMode:data.antrepoSourceMode||'',orderCount:Number(data.orderCount)||0};
          if(generation===liveGeneration)rememberLive(key,result);
        }
      }
      // A late result from a prior scope, force refresh or invalidated model
      // may not replace the current snapshot.
      if(sequence===liveRequestSeq&&generation===liveGeneration)Object.assign(live,result);
      return result;
    })().finally(()=>{if(live.pending===pending){live.pending=null;live.pendingKey='';live.pendingForce=false;}});
    live.pending=pending;live.pendingKey=key;live.pendingForce=force;
    return pending;
  }

  function TA() { return global.BLTransitAnalysis; }
  function SM() { return global.BLTransitStageModel; }
  function esc(value) {
    return String(value == null ? '' : value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function fmt(value, digits = 1) {
    if (value == null || !Number.isFinite(Number(value))) return '—';
    return Number(value).toLocaleString(loc(), { minimumFractionDigits: 0, maximumFractionDigits: digits });
  }
  function fmtQty(value) {
    const n = Number(value) || 0;
    if (n >= 1e6) return (n / 1e6).toLocaleString(loc(), { maximumFractionDigits: 1 }) + ' M';
    if (n >= 1e3) return (n / 1e3).toLocaleString(loc(), { maximumFractionDigits: 0 }) + L(' B', ' K');
    return n.toLocaleString(loc());
  }
  function fmtPeriod(period, granularity) {
    const p = String(period || '');
    return granularity === 'week' ? p.slice(0, 4) + L('-H', '-W') + p.slice(4) : p.slice(0, 4) + '/' + p.slice(4);
  }
  // IAS'taki taşıt adları İngilizce görünümde parça parça çevrilir; tanınmayan
  // bir parça varsa database değeri olduğu gibi gösterilir.
  const VEHICLE_WORDS = { GEMI: 'Sea', UCAK: 'Air', TIR: 'Truck', KARA: 'Road', KARAYOLU: 'Road', DEMIRYOLU: 'Rail', TREN: 'Rail', KURYE: 'Courier', DENIZ: 'Sea', DENIZYOLU: 'Sea', HAVAYOLU: 'Air' };
  function vehicleLabel(vehicle, analysis) {
    if (!vehicle) return analysis && analysis.source === 'database' ? L('Taşıt belirtilmemiş', 'Vehicle not specified') : L('Karma (Tümü)', 'Mixed (All)');
    if (TA().ruleVehicle(vehicle)) return typeof global.transitDelTypeDisplay === 'function' ? global.transitDelTypeDisplay(vehicle) : vehicle;
    if (lang() !== 'en') return vehicle;
    const parts = String(vehicle).split(/(\s*[+/,-]\s*|\s+)/);
    const out = parts.map(part => {
      if (!part.trim() || /^\s*[+/,-]\s*$/.test(part)) return part;
      const k = part.toLocaleUpperCase('tr-TR').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      return VEHICLE_WORDS[k] || null;
    });
    return out.some(x => x == null) ? vehicle : out.join('');
  }
  function toast(message) { if (typeof global.showToast === 'function') global.showToast(message); }
  function readView() {
    try { return JSON.parse((global.BLStorage || global.localStorage).getItem(VIEW_KEY) || '{}') || {}; } catch (_) { return {}; }
  }
  function writeView(view) {
    try { (global.BLStorage || global.localStorage).setItem(VIEW_KEY, JSON.stringify(view)); } catch (_) {}
  }

  async function load(force = false) {
    if (store.loaded && !force) return store;
    if (store.pending) return store.pending;
    store.pending = (async () => {
      if (global.SERVER_BACKED) {
        const res = await fetch('/api/transit-analysis', { headers: { Accept: 'application/json' } });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(L(data.error || res.statusText, data.errorEn || data.error || res.statusText));
        store.model = SM() ? SM().normalizeModel(data.analysis) : null;
        store.revision = Number(data.revision) || 0;
      } else store.model = null;
      store.loaded = true;
      return store;
    })().finally(() => { store.pending = null; });
    return store.pending;
  }

  /* Model istemciden yazılmaz: sunucu aynı kapsam + pencereden kendisi kurar. */
  async function saveModel(params) {
    const res = await fetch('/api/transit-analysis/stage-model', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'If-Match': String(store.revision || 0), ...(global.BL_CLIENT_ID ? { 'X-Client-Id': global.BL_CLIENT_ID } : {}) },
      body: JSON.stringify({ scope: 'company', window: params.window || 'y1' }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(L(data.error || res.statusText, data.errorEn || data.error || res.statusText));
    store.model = SM() ? SM().normalizeModel(data.analysis) : null;
    store.revision = Number(data.revision) || store.revision;
    store.loaded = true;
    return store.model;
  }
  async function removeModel() {
    const res = await fetch('/api/transit-analysis', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'If-Match': String(store.revision || 0), ...(global.BL_CLIENT_ID ? { 'X-Client-Id': global.BL_CLIENT_ID } : {}) },
      body: JSON.stringify({ analysis: null }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(L(data.error || res.statusText, data.errorEn || data.error || res.statusText));
    store.model = null;
    store.revision = Number(data.revision) || store.revision;
    store.loaded = true;
    return null;
  }

  function stackedBar(row, scale) {
    const parts = [['loading', 'var(--ui-accent)'], ['transit', 'var(--ui-chart-3)'], ['customs', 'var(--ui-warning)']]
      .map(([m, color]) => ({ m, color, v: Math.max(0, Number(row[m]) || 0) }));
    if (!scale || !parts.some(p => p.v)) return '';
    return `<div style="display:flex;height:6px;width:100%;max-width:140px;border-radius:var(--ui-radius);overflow:hidden;background:var(--ui-surface-soft);margin-top:4px;" aria-hidden="true">${parts.map(p => `<span title="${esc(TA().labels(lang()).metric[p.m])}: ${fmt(p.v)} ${L('gün', 'days')}" style="width:${(p.v / scale * 100).toFixed(1)}%;background:${p.color};"></span>`).join('')}</div>`;
  }

  function trendCell(row) {
    if (row.trend == null || row.periods < 2) return '<span style="color:var(--ui-text-muted);">—</span>';
    const t = Number(row.trend);
    const color = Math.abs(t) < 2 ? 'var(--ui-text-muted)' : t > 0 ? 'var(--ui-danger)' : 'var(--ui-success)';
    const arrow = Math.abs(t) < 2 ? '→' : t > 0 ? '↑' : '↓';
    return `<span style="color:${color};font-weight:600;" title="${L('Son 3 dönem ortalaması', 'Average of the last 3 periods:')} ${fmt(row.lastMean)} ${L('gün', 'days')}">${arrow} ${t > 0 ? '+' : ''}${fmt(t)}</span>`;
  }

  function detailHtml(row, analysis) {
    const max = Math.max(1, ...row.series.map(s => Math.max(0, Number(s.endToEnd) || 0)));
    const series = row.series.map(s => `<div style="display:grid;grid-template-columns:72px 1fr 52px 64px;gap:8px;align-items:center;font-size:var(--ui-font-xs);">
        <span style="color:var(--ui-text-muted);">${esc(fmtPeriod(s.period, row.granularity))}</span>
        <span style="height:6px;border-radius:var(--ui-radius);background:var(--ui-surface-soft);overflow:hidden;"><span style="display:block;height:100%;width:${(Math.max(0, Number(s.endToEnd) || 0) / max * 100).toFixed(1)}%;background:var(--ui-accent);"></span></span>
        <span class="num" style="text-align:right;">${fmt(s.endToEnd)}</span>
        <span class="num" style="text-align:right;color:var(--ui-text-muted);">${fmtQty(s.qty)}</span></div>`).join('');
    const groups = { loading: L('Yükleme', 'Loading'), transit: L('Yol', 'Transit'), customs: L('Gümrük', 'Customs') };
    const steps = row.steps.length ? row.steps.map(s => `<tr><td style="color:var(--ui-text-muted);">${esc(groups[s.group] || '')}</td><td>${esc(s.code)}. ${esc(TA().stepLabel(s, analysis, lang()))}${s.informational ? ` <span style="color:var(--ui-text-muted);">${L('(bilgi — üst adımın içinde)', '(info — included in the parent step)')}</span>` : ''}</td><td class="num" style="text-align:right;${s.days < 0 ? 'color:var(--ui-danger);' : ''}">${fmt(s.days)}</td></tr>`).join('')
      : `<tr><td colspan="3" style="color:var(--ui-text-muted);">${L('Bu ülke/taşıt için alt süreç kırılımı raporda yok.', 'The report has no sub-process breakdown for this country/vehicle.')}</td></tr>`;
    return `<div style="display:grid;grid-template-columns:minmax(260px,1fr) minmax(320px,1.2fr);gap:18px;padding:10px 6px;">
      <div><div style="font-weight:600;font-size:var(--ui-font-xs);margin-bottom:6px;">${L('Dönem bazında uçtan uca (gün · adet)', 'End-to-end by period (days · qty)')}</div><div style="display:flex;flex-direction:column;gap:3px;max-height:220px;overflow:auto;">${series}</div></div>
      <div><div style="font-weight:600;font-size:var(--ui-font-xs);margin-bottom:6px;">${L('Alt süreç ortalamaları (gün)', 'Sub-process averages (days)')}</div><table class="trxTable trxMini"><tbody>${steps}</tbody></table></div>
    </div>`;
  }

  /* ctx: { getRules():Rule[], applyRules(rules), setVehicleTypes?(types) }
     Kart iskeleti (başlık + kaynak + araç çubuğu) her durumda çizilir; yükleme,
     boş sonuç ve hata yalnız gövdeyi değiştirir. Böylece kapsam/tarih/Yenile
     kontrolleri hiçbir durumda kaybolmaz. */
  const VIEW_VERSION = 3;
  function mount(container, ctx) {
    if (!container || !TA()) return null;
    const saved = readView();
    const view = { scope: 'company', window: 'y1', basis: '', year: '', vehicle: '*', metric: 'handoverToWarehouse', stat: 'mean', collapsed: false, bufferDays: 0, bufferPct: 0,
      ...saved, source: 'database', v: VIEW_VERSION };
    // v2: varsayılan kapsam modülün kendi IAS database ufkudur.
    // v3: Excel kaynağı kaldırıldı; kurala esas varsayılanı Handover → Antrepo
    //     (Backlog ETA'sı Handover/Ex-Factory'ye eklenir, Yükleme Talep'e değil).
    if (saved.v !== VIEW_VERSION) { view.scope = 'company'; view.metric = 'handoverToWarehouse'; }
    if (!['filtered', 'company'].includes(view.scope)) view.scope = 'company';
    if (!TA().WINDOW_KEYS.includes(view.window)) view.window = 'y1';
    if (!['shipment', 'qty'].includes(view.weight)) view.weight = 'shipment';
    { const b = TA().normalizeBuffer(view); view.bufferDays = b.days; view.bufferPct = b.pct; }
    const liveParams = () => ({ scope: view.scope, window: view.window, weight: view.weight });
    const selected = new Map();
    const expanded = new Set();
    let busy = false;
    let busyLive = false;
    let errorText = '';
    let summary = null;

    function rowId(row) { return row.vehicle + '|' + row.countryKey; }
    const opt = (value, label, current) => `<option value="${esc(value)}" ${String(value) === String(current) ? 'selected' : ''}>${esc(label)}</option>`;

    function statsLine(analysis) {
      const st = analysis && analysis.stats;
      if (!st) return '';
      const n = value => Number(value || 0).toLocaleString(loc());
      const parts = [L(`${n(st.used)} / ${n(st.total)} IAS parsiyeli hesaba girdi`, `${n(st.used)} of ${n(st.total)} IAS partials used`)];
      if (st.notArrived) parts.push(L(`${n(st.notArrived)} gerçekleşen antrepo girişi yok`, `${n(st.notArrived)} without a realized warehouse entry`));
      if (st.outOfWindow) parts.push(L(`${n(st.outOfWindow)} tarih aralığı dışında`, `${n(st.outOfWindow)} outside the date range`));
      if (st.missingDates) parts.push(L(`${n(st.missingDates)} tarihi eksik`, `${n(st.missingDates)} missing dates`));
      if (st.outOfRange) parts.push(L(`${n(st.outOfRange)} tutarsız tarih`, `${n(st.outOfRange)} inconsistent dates`));
      if (st.missingCountry) parts.push(L(`${n(st.missingCountry)} ülkesi yok`, `${n(st.missingCountry)} without a country`));
      if (st.otherDestination) parts.push(L(`${n(st.otherDestination)} rapor filtresiyle hariç rota`, `${n(st.otherDestination)} route excluded by the report filter`));
      return parts.join(' · ');
    }
    function columnNotes(analysis) {
      const c = analysis && analysis.columns;
      // Hiç parsiyel yoksa sütun teşhisi yanıltıcıdır (her sütun "yok" görünür).
      if (!c || !(analysis.stats && analysis.stats.total)) return '';
      const notes = [];
      if (!c.loadingRequest) notes.push(L('"Yükleme Talep Tarih" sütunu yok — uçtan uca süre hesaplanamaz', 'No "Yükleme Talep Tarih" column — end-to-end time cannot be calculated'));
      if (!c.eta) notes.push(L('"ETA Tarih" sütunu yok — yol/gümrük ayrılamaz', 'No "ETA Tarih" column — transit and customs cannot be separated'));
      if (!c.actualEntry) notes.push(L('Gerçekleşen Antrepo/Tema Depo giriş tarihi bulunamadı — yalnız gerçekleşen veriyle hesaplandığı için tahmini giriş kullanılmaz. IAS Database kapsamını seçin veya IAS alan eşlemesine "Antrepo Giriş Tarihi" ekleyin.', 'No actual Antrepo/Tema warehouse entry date was found — only realized data is used, so the estimated entry is not used. Choose the IAS Database scope or add "Antrepo Giriş Tarihi" to the IAS field mapping.'));
      if (!c.actualLoading) notes.push(L('Fiili Yükleme tarihi yok; yükleme/yol ayrımı Handover\'a göre', 'No actual loading date; loading/transit split by Handover'));
      if (!c.summaryDeclaration) notes.push(L('Özet Beyan / Ambar / Transit Beyanname tarihleri yok; gümrük alt adımları (5–8) hesaplanamaz', 'No summary declaration / warehouse approval / transit declaration dates; customs sub-steps (5–8) cannot be calculated'));
      if (!c.finalDestination) notes.push(L('Final Destination yok; rota hedefi bilgisi gösterilemez', 'No Final Destination; route destination information cannot be shown'));
      return notes.length ? `<div class="trxNote">${notes.map(esc).join(' · ')}</div>` : '';
    }

    function dbToolbar() {
      const seg = (id, label, title) => `<button type="button" data-ta-scope="${id}" aria-pressed="${view.scope === id}" title="${esc(title)}">${label}</button>`;
      const group = (label, keys) => `<optgroup label="${esc(label)}">${keys.map(k => `<option value="${k}" ${view.window === k ? 'selected' : ''}>${esc(TA().windowLabel(k, lang()))}</option>`).join('')}</optgroup>`;
      const keys = TA().WINDOW_KEYS;
      const win = live.analysis && live.analysis.window;
      const d = live.diag;
      const when = d && d.queriedAt ? new Date(d.queriedAt).toLocaleTimeString(loc(), { hour: '2-digit', minute: '2-digit' }) : '';
      const diagText = d ? [
        when ? L(`Son sorgu ${when}`, `Last query ${when}`) : '',
        d.rowsFetched != null ? L(`${Number(d.rowsFetched).toLocaleString(loc())} IAS satırı`, `${Number(d.rowsFetched).toLocaleString(loc())} IAS rows`) : '',
        d.cacheHit ? L('önbellek', 'cached') : '',
      ].filter(Boolean).join(' · ') : '';
      return `<div class="trxToolbar">
        <div class="trxSeg" role="group" aria-label="${esc(L('Veri kapsamı', 'Data scope'))}">${seg('company', L('IAS Database', 'IAS Database'), L('Modülün kendi ufku: IAS verisi kullanıcı/Backlog filtresi olmadan, yalnız seçilen tarih aralığıyla sorgulanır. Tüm ülke ve taşıtlar gelir.', 'The module\'s own horizon: IAS data is queried without user/Backlog filters, limited only by the selected date range. All countries and vehicles are included.'))}${seg('filtered', L('Backlog filtrem', 'My Backlog filter'), L('Backlog\'daki kaynak ufkun ve yetki kapsamın', 'Your Backlog source horizon and access scope'))}</div>
        <label class="trxInline" title="${esc(L('Bu tarih penceresi yalnız Yol Süreleri analizine aittir; Backlog/kullanıcı ufkunu değiştirmez.', 'This date window belongs only to Transit Times analysis; it does not change the Backlog/user horizon.'))}"><span>${L('Modül ufku', 'Module horizon')}</span><select class="trxSelect" data-ta-window ${busyLive ? 'disabled' : ''}>${group(L('Hafta', 'Weeks'), keys.filter(k => k[0] === 'w'))}${group(L('Ay', 'Months'), keys.filter(k => k[0] === 'm'))}${group(L('Yıl', 'Years'), keys.filter(k => k[0] === 'y'))}<option value="all" ${view.window === 'all' ? 'selected' : ''}>${esc(TA().windowLabel('all', lang()))}</option></select></label>
        <label class="trxInline" title="${esc(L('Sevkiyat: her IAS parsiyeli eşit sayılır (Global Lojistik raporu gibi). Adet: yüklenen adetle ağırlıklı.', 'Shipment: every IAS partial counts equally (like the Global Logistics report). Quantity: weighted by loaded quantity.'))}"><span>${L('Ortalama', 'Average')}</span><select class="trxSelect" data-ta-weight ${busyLive ? 'disabled' : ''}><option value="shipment" ${view.weight !== 'qty' ? 'selected' : ''}>${esc(L('Sevkiyat (rapor gibi)', 'Shipment (like the report)'))}</option><option value="qty" ${view.weight === 'qty' ? 'selected' : ''}>${esc(L('Adet ağırlıklı', 'Quantity-weighted'))}</option></select></label>
        ${win && win.from ? `<span class="trxMeta">${esc(win.from)} → ${esc(win.to)} · ${win.granularity === 'week' ? L('haftalık', 'weekly') : L('aylık', 'monthly')}</span>` : ''}
        <span class="trxGrow"></span>
        ${diagText && !busyLive ? `<span class="trxMeta">${esc(diagText)}</span>` : ''}
        <button type="button" class="trxBtn" data-ta-refresh ${busyLive ? 'disabled' : ''} title="${esc(L('IAS verisini yeniden sorgula (önbelleği atlar)', 'Re-query IAS data (bypasses the cache)'))}"><svg class="ic${busyLive ? ' trxSpin' : ''}"><use href="#i-refresh"/></svg><span>${busyLive ? L('Sorgulanıyor…', 'Querying…') : L('Yenile', 'Refresh')}</span></button>
      </div>`;
    }

    /* Risk hesabının aşama modeli: önizleme bu ekrandaki IAS parsiyellerinden
       (aynı kapsam + ufuk), kaydedilen model tek merkezdedir. Kritik yol
       aşamaları sıralıdır; evrak süreci paralel olduğu için toplam süreye
       eklenmez, yalnız ETA'dan sonra teslim edildiyse gümrüğü bekletir. */
    let modelBusy = false;
    function stageModelHtml() {
      if (!SM()) return '';
      const preview = live.stageModel;
      const saved = store.model;
      const canWrite = !!global.SERVER_BACKED;
      const stat = view.stat === 'p80' ? 'p80' : 'mean';
      const codes = SM().STAGES.map(st => st.code);
      const groups = (preview ? preview.groups : []).filter(g => g.scope === 'country'
        && (view.vehicle === '*' || TA().ruleVehicle(g.vehicle) === TA().ruleVehicle(view.vehicle)))
        .sort((a, b) => b.n - a.n).slice(0, 40);
      const cell = d => (d ? `<span title="${esc(L(`Ortalama ${fmt(d.mean)} · P80 ${fmt(d.p80)} · ${d.n} parsiyel`, `Average ${fmt(d.mean)} · P80 ${fmt(d.p80)} · ${d.n} partials`))}">${fmt(d[stat])}</span>` : '—');
      const body = groups.map(g => `<tr>
          <td><span class="trxBadge">${esc(vehicleLabel(g.vehicle, live.analysis))}</span></td>
          <td><strong>${esc(TA().countryRuleName(g.country))}</strong></td>
          <td class="num">${g.n.toLocaleString(loc())}</td>
          ${codes.map(code => `<td class="num">${cell(g.stages[code])}</td>`).join('')}
          <td class="num"><strong>${cell(g.remaining.handover)}</strong></td>
          <td class="num">${g.docsLateShare == null ? '—' : esc((g.docsLateShare * 100).toLocaleString(loc(), { maximumFractionDigits: 0 })) + '%'}</td>
        </tr>`).join('');
      const savedText = saved
        ? L(`Risk hesabında kullanılan model: ${new Date(saved.generatedAt).toLocaleString(loc())}${saved.generatedBy ? ' · ' + saved.generatedBy : ''} · ${TA().windowLabel(saved.window, lang())} · ${saved.stats.used.toLocaleString(loc())} parsiyel`,
          `Model used by the risk calculation: ${new Date(saved.generatedAt).toLocaleString(loc())}${saved.generatedBy ? ' · ' + saved.generatedBy : ''} · ${TA().windowLabel(saved.window, 'en')} · ${saved.stats.used.toLocaleString(loc())} partials`)
        : L('Kayıtlı aşama modeli yok: Backlog Teslimat Riski tek kural gününe göre hesaplanıyor.', 'No saved stage model: Backlog Delivery Risk is calculated with the single rule duration.');
      const head = codes.map(code => `<th class="num" title="${esc(SM().stageLabel(code, lang()))}">${esc(code)}</th>`).join('');
      return `<div class="trxStageModel">
        <div class="trxToolbar">
          <div><div class="trxH">${L('Aşama süre modeli (risk hesabı)', 'Stage duration model (risk calculation)')}</div>
            <div class="trxSub">${L('Kritik yol aşamaları birbirini bekler; Backlog ETA\'sı son gerçekleşen kilometre taşından kalan sürenin dağılımıyla hesaplanır. Gösterilen istatistik:', 'Critical-path stages wait for each other; the Backlog ETA is calculated from the last realized milestone with the remaining-time distribution. Statistic shown:')} ${esc(TA().labels(lang()).ruleStat[stat])}</div></div>
          <span class="trxGrow"></span>
          ${canWrite ? `<button type="button" class="trxBtn trxBtnPrimary" data-ta-model-save ${modelBusy || !preview || view.scope !== 'company' ? 'disabled' : ''} title="${esc(view.scope !== 'company' ? L('Paylaşılan model yalnız IAS Database kapsamından kaydedilir; kapsamı IAS Database yapın.', 'The shared model is saved only from the IAS Database scope; switch the scope to IAS Database.') : L('Modeli şirket geneli IAS verisi ve modül ufkuyla sunucuda yeniden kurar ve risk hesabına uygular (iş kuralı yetkisi gerekir).', 'Rebuilds the model on the server from company-wide IAS data and the module horizon and applies it to the risk calculation (business rules permission required).'))}"><svg class="ic"><use href="#i-check"/></svg><span>${modelBusy ? L('Kaydediliyor…', 'Saving…') : L('Risk hesabına uygula', 'Apply to risk calculation')}</span></button>` : ''}
          ${canWrite && saved ? `<button type="button" class="trxBtn" data-ta-model-remove ${modelBusy ? 'disabled' : ''} title="${esc(L('Modeli kaldır: risk hesabı tek kural gününe döner', 'Remove the model: the risk calculation returns to the single rule duration'))}"><svg class="ic"><use href="#i-trash"/></svg></button>` : ''}
        </div>
        <div class="trxNote">${esc(savedText)}</div>
        ${groups.length ? `<div class="trxTableWrap"><table class="trxTable trxMini"><thead><tr><th>${L('Taşıt', 'Vehicle')}</th><th>${L('Ülke', 'Country')}</th><th class="num">${L('Parsiyel', 'Partials')}</th>${head}<th class="num" title="${esc(L('Handover\'dan antrepo girişine kalan süre (parsiyel bazında doğrudan ölçülür)', 'Remaining time from Handover to antrepo entry (measured directly per partial)'))}">${L('Handover → Antrepo', 'Handover → Antrepo')}</th><th class="num" title="${esc(L('Evrakı ETA\'dan sonra teslim edilen parsiyel oranı (paralel süreç gümrüğü bekletir)', 'Share of partials whose documents arrived after the ETA (the parallel process delays customs)'))}">${L('Evrak geç', 'Docs late')}</th></tr></thead><tbody>${body}</tbody></table></div>
        <div class="trxNote" data-no-i18n>${esc(SM().STAGES.map(st => `${st.code}: ${SM().stageLabel(st.code, lang())}`).join(' · '))}</div>` : `<div class="trxNote">${esc(L('Bu kapsamda aşama tarihleri olan ve antrepoya girmiş parsiyel yok.', 'No partials with stage dates and a warehouse entry in this scope.'))}</div>`}
      </div>`;
    }

    function bodyHtml(analysis) {
      const isDb = true;
      if (isDb && busyLive && !analysis) return `<div class="trxEmpty">${view.scope === 'company' ? L('IAS database sorgulanıyor…', 'Querying the IAS database…') : L('Hesaplanıyor…', 'Calculating…')}</div>`;
      if (isDb && errorText) return `<div class="trxEmpty trxError">${esc(errorText)}</div>`;
      if (isDb && !(analysis && analysis.records && analysis.records.length)) {
        const msg = live.message || (live.loaded
          ? L('Bu kapsam ve tarih aralığında antrepoya girmiş sevkiyat yok. Tarih aralığını genişletin.', 'No shipments entered the warehouse in this scope and date range. Widen the date range.')
          : L('IAS verisi okunuyor…', 'Reading IAS data…'));
        return `<div class="trxEmpty">${esc(msg)}${statsLine(analysis) ? `<div class="trxNote">${esc(statsLine(analysis))}</div>` : ''}${columnNotes(analysis)}</div>`;
      }
      return tableHtml(analysis) + stageModelHtml();
    }

    function tableHtml(analysis) {
      const isDb = analysis.source === 'database';
      const yearFilter = isDb ? '*' : view.year;
      summary = summarized(analysis, { basis: view.basis, year: yearFilter, vehicle: view.vehicle });
      view.basis = summary.basis; if (!isDb) view.year = summary.year;
      if (view.vehicle !== '*' && !summary.options.vehicles.includes(view.vehicle)) { view.vehicle = '*'; summary = summarized(analysis, { basis: view.basis, year: yearFilter, vehicle: '*' }); }
      writeView(view);
      const rules = ctx.getRules();
      if (typeof ctx.setVehicleTypes === 'function') ctx.setVehicleTypes(summary.options.vehicles.filter(Boolean));
      const suggestions = new Map(TA().suggestRules(summary, view).map(s => [s.vehicle + '|' + s.countryKey, s]));
      summary.rows.forEach(row => {
        const id = rowId(row);
        if (!selected.has(id)) selected.set(id, !!row.ruleType && !row.lowSample && !row.anomaly && suggestions.has(id));
      });
      const hasBuffer = view.bufferDays > 0 || view.bufferPct > 0;
      const bufferText = [view.bufferPct > 0 ? `+%${fmt(view.bufferPct)}` : '', view.bufferDays > 0 ? `+${view.bufferDays} ${L('gün', 'days')}` : ''].filter(Boolean).join(' ');
      const scale = Math.max(1, ...summary.rows.map(r => ['loading', 'transit', 'customs'].reduce((s, m) => s + Math.max(0, Number(r[m]) || 0), 0)));
      const labels = TA().metricLabels(analysis, lang());
      const text = TA().labels(lang());
      const tiles = summary.vehicleTotals.map(t => `<div class="trxTile">
          <div class="trxTileHead">${esc(vehicleLabel(t.vehicle, analysis))} · ${t.countries} ${L('ülke', 'countries')} · ${fmtQty(t.qty)}</div>
          <div class="trxTileValue">${fmt(t.endToEnd)}<small>${L('gün', 'days')}</small></div>
          <div class="trxTileFoot">${L('Yük.', 'Load')} ${fmt(t.loading)} · ${L('Yol', 'Transit')} ${fmt(t.transit)} · ${L('Gümr.', 'Cust.')} ${fmt(t.customs)}</div></div>`).join('');
      const body = summary.rows.map(row => {
        const id = rowId(row);
        const s = suggestions.get(id);
        const current = TA().currentRuleDays(rules, row.ruleType, row.ruleCountry);
        const diff = s && current ? s.days - current.days : null;
        const flags = [row.lowSample ? `<span class="trxFlag" title="${row.shipments != null ? L(`${TA().LOW_SAMPLE_SHIPMENTS} sevkiyattan az`, `Fewer than ${TA().LOW_SAMPLE_SHIPMENTS} shipments`) : L(`Toplam adet < ${fmtQty(TA().LOW_SAMPLE_QTY)} veya < ${TA().LOW_SAMPLE_PERIODS} dönem`, `Total qty < ${fmtQty(TA().LOW_SAMPLE_QTY)} or < ${TA().LOW_SAMPLE_PERIODS} periods`)}">${L('düşük örneklem', 'low sample')}</span>` : '',
          row.anomaly ? `<span class="trxFlag trxFlagBad" title="${esc(L('Negatif ana süre var (tarih tutarsızlığı)', 'Negative main duration (date inconsistency)'))}">${L('veri tutarsız', 'inconsistent')}</span>` : ''].join('');
        const canSelect = !!row.ruleType && !!s;
        const noRuleTip = L('Taşıt tipi belirtilmemiş; kurala aktarılamaz', 'Vehicle type not specified; cannot be transferred');
        return `<tr data-ta-row="${esc(id)}" class="${expanded.has(id) ? 'is-open' : ''}">
          <td><input type="checkbox" class="trxCheck" data-ta-pick="${esc(id)}" ${selected.get(id) && canSelect ? 'checked' : ''} ${canSelect ? '' : 'disabled'} title="${canSelect ? esc(L('Öneriyi kurallara aktar', 'Transfer the suggestion to the rules')) : esc(noRuleTip)}"></td>
          <td><span class="trxBadge" data-v="${esc(row.vehicle)}" title="${esc(row.vehicle || '')}">${esc(vehicleLabel(row.vehicle, analysis))}</span></td>
          <td><strong>${esc(row.ruleCountry)}</strong>${flags}</td>
          <td class="num">${fmtQty(row.qty)}<div class="trxSubNum">${row.shipments != null ? row.shipments.toLocaleString(loc()) + L(' sevk.', ' shp.') : row.periods + (row.granularity === 'week' ? L(' hf', ' wk') : L(' ay', ' mo'))}</div></td>
          <td class="num">${fmt(row.loading)}</td><td class="num">${fmt(row.transit)}</td><td class="num">${fmt(row.customs)}</td>
          <td class="num"><strong>${fmt(row.endToEnd)}</strong>${stackedBar(row, scale)}</td>
          <td class="num">${fmt(row.p80)}</td>
          <td class="num trxMuted">${fmt(row.min)}–${fmt(row.max)}</td>
          <td class="num">${trendCell(row)}</td>
          <td class="num">${current ? `${fmt(current.days, 0)}<div class="trxSubNum">${current.source === 'rule' ? L('kural', 'rule') : L('varsayılan', 'default')}</div>` : '—'}</td>
          <td class="num"${s && hasBuffer ? ` title="${esc(L(`Hesaplanan ${s.baseDays} gün, ${bufferText} buffer ile ${s.days} gün`, `Calculated ${s.baseDays} days, ${bufferText} buffer = ${s.days} days`))}"` : ''}>${s ? `<strong>${fmt(s.days, 0)}</strong>${diff ? `<div class="trxSubNum" style="color:${diff > 0 ? 'var(--ui-danger)' : 'var(--ui-success)'};">${diff > 0 ? '+' : ''}${diff}</div>` : ''}` : (row.vehicle && !row.ruleType ? `<span class="trxMuted" title="${esc(noRuleTip)}">${L('kural yok', 'no rule')}</span>` : '—')}</td>
          <td><button type="button" class="trxIconBtn" data-ta-expand="${esc(id)}" title="${esc(L('Dönem ve alt süreç detayı', 'Period and sub-process detail'))}" aria-expanded="${expanded.has(id)}">${expanded.has(id) ? '▴' : '▾'}</button></td>
        </tr>${expanded.has(id) ? `<tr class="trxDetailRow"><td colspan="14">${detailHtml(row, analysis)}</td></tr>` : ''}`;
      }).join('');
      const picked = summary.rows.filter(r => selected.get(rowId(r)) && suggestions.has(rowId(r))).length;
      const allPickable = summary.rows.filter(r => r.ruleType && suggestions.has(rowId(r))).length;
      return `<div class="trxFilters">
          <label class="trxInline"><span>${L('Baz', 'Basis')}</span><select class="trxSelect" data-ta-view="basis">${summary.options.bases.map(b => opt(b, text.basis[b], view.basis)).join('')}</select></label>
          <label class="trxInline"><span>${L('Taşıt', 'Vehicle')}</span><select class="trxSelect" data-ta-view="vehicle">${opt('*', L('Tümü', 'All'), view.vehicle)}${summary.options.vehicles.map(v => opt(v, vehicleLabel(v, analysis), view.vehicle)).join('')}</select></label>
          <label class="trxInline"><span>${L('Kurala esas', 'Rule basis')}</span><select class="trxSelect" data-ta-view="metric">${Object.entries(labels.rule).map(([k, l]) => opt(k, l, view.metric)).join('')}</select></label>
          <label class="trxInline"><span>${L('İstatistik', 'Statistic')}</span><select class="trxSelect" data-ta-view="stat">${Object.entries(text.ruleStat).map(([k, l]) => opt(k, l, view.stat)).join('')}</select></label>
          <span class="trxInline trxBuffer${hasBuffer ? ' is-on' : ''}" title="${esc(L('Hesaplanan güne otomatik eklenir: önce yüzde, sonra gün. Öneri sütunu ve kurallara aktarılan gün buffer\'lı değerdir.', 'Added automatically to the calculated days: first the percentage, then the days. The Suggested column and the days transferred to the rules include the buffer.'))}"><span>Buffer</span>
            <input type="number" class="trxInput trxBufferInput" data-ta-buffer="bufferDays" min="0" max="${TA().MAX_BUFFER_DAYS}" step="1" value="${view.bufferDays}" aria-label="${esc(L('Buffer gün', 'Buffer days'))}"><span>${L('gün', 'days')}</span>
            <input type="number" class="trxInput trxBufferInput" data-ta-buffer="bufferPct" min="0" max="${TA().MAX_BUFFER_PCT}" step="1" value="${view.bufferPct}" aria-label="${esc(L('Buffer yüzde', 'Buffer percent'))}"><span>%</span></span>
        </div>
        ${tiles ? `<div class="trxTiles">${tiles}</div>` : ''}
        ${isDb ? `<div class="trxNote">${esc(statsLine(analysis))}</div>${columnNotes(analysis)}` : ''}
        <div class="trxTableWrap"><table class="trxTable"><thead><tr>
          <th><input type="checkbox" class="trxCheck" data-ta-all title="${esc(L('Tümünü seç', 'Select all'))}" ${picked && picked === allPickable ? 'checked' : ''}></th><th>${L('Taşıt', 'Vehicle')}</th><th>${L('Ülke', 'Country')}</th><th class="num">${L('Adet', 'Qty')}</th><th class="num" title="${esc(labels.loading)}">${L('Yükleme', 'Loading')}</th><th class="num" title="${esc(labels.transit)}">${L('Yol', 'Transit')}</th><th class="num" title="${esc(labels.customs)}">${L('Gümrük', 'Customs')}</th><th class="num" title="${esc(labels.endToEnd)}">${L('Uçtan Uca', 'End-to-End')}</th><th class="num">P80</th><th class="num">${L('Min–Maks', 'Min–Max')}</th><th class="num">Trend</th><th class="num">${L('Mevcut', 'Current')}</th><th class="num">${L('Öneri', 'Suggested')}</th><th></th>
        </tr></thead><tbody>${body || `<tr><td colspan="14" class="trxEmpty">${L('Bu seçim için veri yok.', 'No data for this selection.')}</td></tr>`}</tbody></table></div>
        <div class="trxFoot"><span class="trxMeta">${L(`${picked} öneri seçili`, `${picked} suggestion(s) selected`)} · ${esc(labels.rule[view.metric] || text.ruleMetric[view.metric])}, ${esc(text.ruleStat[view.stat])}${hasBuffer ? ` · Buffer ${esc(bufferText)}` : ''} · ${(analysis.weighting === 'shipment' ? L('süreler gün, sevkiyat ortalaması', 'days, shipment average') : L('süreler gün, adet ağırlıklı', 'days, quantity-weighted'))}</span><span class="trxGrow"></span>
          <button type="button" class="trxBtn trxBtnPrimary" data-ta-apply ${picked ? '' : 'disabled'}><svg class="ic"><use href="#i-copy-plus"/></svg><span>${L('Seçilenleri kurallara aktar', 'Transfer selected to rules')}</span></button></div>`;
    }

    function render() {
      const analysis = live.analysis;
      const title = L('İthalat Yol Süresi Analizi', 'Import Lead Time Analysis');
      const sub = L('Ülke × taşıt ve aşama süreleri IAS parsiyellerinin gerçekleşen tarihlerinden hesaplanır; seçilen öneriler aşağıdaki kurallara aktarılır, aşama modeli risk hesabına uygulanır.', 'Country × vehicle and stage durations are calculated from the realized dates of IAS partials; selected suggestions are transferred to the rules below and the stage model is applied to the risk calculation.');
      container.innerHTML = `<section class="trxCard${view.collapsed ? ' is-collapsed' : ''}">
        <div class="trxCardHead">
          <button type="button" class="trxCollapse" data-ta-collapse aria-expanded="${!view.collapsed}" title="${esc(view.collapsed ? L('Aç', 'Expand') : L('Daralt', 'Collapse'))}">${view.collapsed ? '▸' : '▾'}</button>
          <div class="trxCardTitle"><div class="trxH">${title}</div><div class="trxSub">${sub}</div></div>
        </div>
        ${view.collapsed ? '' : `<div class="trxDisclosureBody">${dbToolbar()}
        ${live.warnings && live.warnings.length ? `<div class="trxWarn">${live.warnings.map(w => esc(w && typeof w === 'object' ? L(w.tr, w.en || w.tr) : String(w))).join(' · ')}</div>` : ''}
        <div class="trxCardBody">${bodyHtml(analysis)}</div></div>`}
      </section>`;
      bindAll();
    }

    function reloadLive(force) {
      writeView(view); selected.clear(); expanded.clear();
      busyLive = force || !live.loaded || live.params!==liveKey(liveParams()); errorText = ''; render();
      loadLive(force, liveParams())
        .then(() => { busyLive = false; render(); })
        .catch(err => { busyLive = false; errorText = err.message; render(); });
    }

    function bindAll() {
      const q = sel => container.querySelector(sel);
      const qa = sel => container.querySelectorAll(sel);
      q('[data-ta-collapse]')?.addEventListener('click', event => {
        view.collapsed = !view.collapsed; writeView(view);
        if (!view.collapsed) render();
        const button = q('[data-ta-collapse]') || event.currentTarget, body = q('.trxDisclosureBody');
        button.setAttribute('aria-expanded', String(!view.collapsed));
        button.textContent = view.collapsed ? '▸' : '▾';
        button.title = view.collapsed ? L('Aç', 'Expand') : L('Daralt', 'Collapse');
        q('.trxCard')?.classList.toggle('is-collapsed', view.collapsed);
        if (global.BLMotionPlus?.disclosure) global.BLMotionPlus.disclosure(body, !view.collapsed, { trigger: button, ...(!view.collapsed ? { fromHeight: 0 } : {}) });
        else if (body) body.hidden = view.collapsed;
      });
      q('[data-ta-refresh]')?.addEventListener('click', () => reloadLive(true));
      qa('[data-ta-scope]').forEach(el => el.addEventListener('click', () => {
        if (view.scope === el.dataset.taScope || busyLive) return;
        view.scope = el.dataset.taScope; reloadLive(false);
      }));
      q('[data-ta-window]')?.addEventListener('change', e => { view.window = e.target.value; reloadLive(false); });
      q('[data-ta-weight]')?.addEventListener('change', e => { view.weight = e.target.value; reloadLive(false); });
      qa('[data-ta-view]').forEach(el => el.addEventListener('change', () => {
        view[el.dataset.taView] = el.value;
        if (el.dataset.taView === 'basis') view.year = '';
        selected.clear();
        render();
      }));
      // Değişiklik odak kaybında gelir; aynı olay içinde yeniden çizmek odaktaki
      // alanı silerken tarayıcı hatası verir, bu yüzden çizim ertelenir.
      qa('[data-ta-buffer]').forEach(el => el.addEventListener('change', () => {
        const b = TA().normalizeBuffer({ ...view, [el.dataset.taBuffer]: el.value });
        if (b.days === view.bufferDays && b.pct === view.bufferPct) { el.value = view[el.dataset.taBuffer]; return; }
        view.bufferDays = b.days; view.bufferPct = b.pct;
        writeView(view); setTimeout(render, 0);
      }));
      qa('[data-ta-pick]').forEach(el => el.addEventListener('change', () => { selected.set(el.dataset.taPick, el.checked); render(); }));
      q('[data-ta-all]')?.addEventListener('change', e => {
        (summary ? summary.rows : []).forEach(r => { if (r.ruleType) selected.set(rowId(r), e.target.checked); });
        render();
      });
      qa('[data-ta-expand]').forEach(el => el.addEventListener('click', () => {
        const id = el.dataset.taExpand;
        if (expanded.has(id)) expanded.delete(id); else expanded.add(id);
        render();
      }));
      q('[data-ta-apply]')?.addEventListener('click', () => {
        const suggestions = new Map(TA().suggestRules(summary, view).map(s => [s.vehicle + '|' + s.countryKey, s]));
        const chosen = summary.rows.filter(r => selected.get(rowId(r))).map(r => suggestions.get(rowId(r))).filter(Boolean);
        const result = TA().applySuggestions(ctx.getRules(), chosen, view.metric);
        ctx.applyRules(result.rules);
        toast(L(`${result.added} kural eklendi, ${result.updated} güncellendi${result.unchanged ? `, ${result.unchanged} aynı` : ''}. Kalıcı olması için "Kuralları Kaydet".`,
          `${result.added} rule(s) added, ${result.updated} updated${result.unchanged ? `, ${result.unchanged} unchanged` : ''}. Use "Save Rules" to keep them.`));
        render();
      });
      q('[data-ta-model-save]')?.addEventListener('click', async () => {
        if (modelBusy) return;
        modelBusy = true; render();
        try {
          const model = await saveModel(liveParams());
          toast(L(`Aşama modeli kaydedildi (${model ? model.stats.used.toLocaleString(loc()) : 0} parsiyel). Backlog Teslimat Riski yeniden hesaplanacak.`,
            `Stage model saved (${model ? model.stats.used.toLocaleString(loc()) : 0} partials). Backlog Delivery Risk will be recalculated.`));
          if (typeof global.loadFromServer === 'function') void global.loadFromServer(false);
        } catch (err) { toast(L('Aşama modeli kaydedilemedi: ', 'Could not save the stage model: ') + err.message); }
        finally { modelBusy = false; render(); }
      });
      q('[data-ta-model-remove]')?.addEventListener('click', async () => {
        if (modelBusy) return;
        if (!global.confirm(L('Aşama modeli kaldırılsın mı? Backlog Teslimat Riski tek kural gününe göre hesaplanır.', 'Remove the stage model? Backlog Delivery Risk will be calculated with the single rule duration.'))) return;
        modelBusy = true; render();
        try {
          await removeModel();
          toast(L('Aşama modeli kaldırıldı.', 'Stage model removed.'));
          if (typeof global.loadFromServer === 'function') void global.loadFromServer(false);
        } catch (err) { toast(L('Aşama modeli kaldırılamadı: ', 'Could not remove the stage model: ') + err.message); }
        finally { modelBusy = false; render(); }
      });
    }

    // Pencere her açıldığında yeniden hesaplanır (IAS sorgusu sunucuda 15 dk
    // önbellekli; "Yenile" önbelleği atlar).
    live.loaded = false;
    reloadLive(false);
    load().then(render).catch(err => { toast(err.message); render(); });
    return { refresh: () => { reloadLive(true); load(true).then(render).catch(() => {}); }, render };
  }

  function invalidate({liveOnly=false}={}) { if(!liveOnly)store.loaded=false;live.loaded=false;live.pending=null;live.pendingKey='';liveSnapshots.clear();++liveGeneration;++liveRequestSeq; }
  // Kural düzenleyicisi IAS analizindeki ülke ve taşıt sözlüğünü de sunar.
  function knownCountries() {
    const names = new Set();
    (live.analysis && Array.isArray(live.analysis.records) ? live.analysis.records : [])
      .forEach(r => { const name = TA() && TA().countryRuleName(r.country); if (name) names.add(name); });
    return [...names];
  }
  function knownVehicles() {
    const names = new Set();
    (live.analysis && Array.isArray(live.analysis.records) ? live.analysis.records : [])
      .forEach(r => { const name = TA() && TA().ruleVehicle(r.vehicle); if (name) names.add(name); });
    return [...names].sort((a, b) => a.localeCompare(b, 'tr'));
  }

  global.BLTransitAnalysisUI = { mount, load, loadLive, saveModel, removeModel, invalidate, knownCountries, knownVehicles };
})(typeof window !== 'undefined' ? window : globalThis);
