'use strict';

/* v9.40 — TROY SİPARİŞ KAPATMA SERVİSİ (§ Siparişi Kapat)
 *
 * Sıra spesifikte verildiği gibi: IsRevisedLimited → ColorInfromationsByOrderCode
 * → (OptionRef listesi boş DEĞİLSE) CloseOrCancel. Kimlik doğrulama
 * troySessionService.getFreshAuthorization ile TAZE alınır (cache yok, bkz.
 * troy-session-service.js); herhangi bir adımda 401 gelirse TAM OLARAK BİR
 * kez sessiz yeniden yakalama denenir, ikinci 401 kullanıcıya yansır.
 *
 * Job state global DEĞİL: `${ownerId}::close::${orderCode}` anahtarlı bir
 * Set ile yalnız AYNI siparişin eşzamanlı ikinci çağrısı engellenir; başka
 * bir sipariş ya da başka bir operasyon (download PO) hiç etkilenmez.
 */

const troySession = require('./troy-session-service');
const { connectorError, safeOwner, ensureContext, pageForCurrentBuyerLogProfile, troyPageLooksLikeLogin } = troySession;

const TROY_API_ROOT = 'https://purchaseorder.prod.lcwaikiki.com/purchaseorder/bf/service/api/Order';
const CLOSE_TIMEOUT_MS = 30000;

/* v9.45 — "Revize Et" (§ Order Code sağ tık → Revize Et)
 *
 * Bu, Kapat/PO'dan TAMAMEN FARKLI bir mekanizma: burada bir REST API'ye JWT
 * ile istek atmıyoruz — kullanıcının zaten oturum açmış GERÇEK Troy sekmesinde
 * gerçek bir kullanıcı gibi tıklıyoruz (satırı bul → işlem menüsünü aç →
 * "Revize Et" ikonlu butona bas), TA Kİ Troy'un kendi Angular stepper'ı
 * (Revize ekranı) açılana kadar. O an otomasyon KESİN olarak durur — form
 * alanına DOKUNULMAZ, "Sonraki Adım"a ya da Save/Submit'e ASLA basılmaz.
 * Kullanıcı devamını Troy'da kendisi tamamlar.
 *
 * Doğrulanmış gerçek URL: https://troy.lcwaikiki.com/order-management/orders
 * (Kapat/PO özelliğinin JWT-yakalama sekmesiyle — ordermanagement.lcwaikiki.com
 * — KARIŞTIRILMAZ; ikisi ayrı sekme/host, aynı Edge context'i paylaşır.) */
const TROY_ORDERS_HOST = 'troy.lcwaikiki.com';
const TROY_ORDERS_URL = 'https://troy.lcwaikiki.com/order-management/orders';
const REVISE_TIMEOUT_MS = 45000;

function clean(value) { return String(value == null ? '' : value).trim(); }

const inProgress = new Set();
function lockKey(ownerId, orderCode) { return `${safeOwner(ownerId)}::close::${clean(orderCode)}`; }

/* Cevap şekli Troy tarafında belgelenmemiş; nesne/array içinde ne kadar iç
   içe olursa olsun UrunOptionRef/ProductOptionRef adlı (büyük-küçük harf
   duyarsız) her alanı toplar. Böylece gerçek yanıtın tam şeklini bilmeden de
   doğru çalışır. */
function collectOptionRefs(value, out = new Set(), depth = 0) {
  if (value == null || depth > 8) return out;
  if (Array.isArray(value)) { for (const item of value) collectOptionRefs(item, out, depth + 1); return out; }
  if (typeof value === 'object') {
    for (const [key, val] of Object.entries(value)) {
      if (/^(urun|product)optionref$/i.test(key)) {
        const ref = clean(val);
        if (ref) out.add(ref);
      } else {
        collectOptionRefs(val, out, depth + 1);
      }
    }
  }
  return out;
}

async function callStep(ownerId, headers, url, method, body, options) {
  return troySession.troyRequest(ownerId, headers, url, method, body, options);
}

/* Tek bir deneme: taze Authorization alır, üç adımı sırayla çalıştırır.
   401 alırsa TROY_UNAUTHORIZED fırlatır (troyRequest zaten bu şekilde
   fırlatıyor) — çağıran (closeOrder) bunu yakalayıp tam olarak bir kez
   yeniden dener. */
async function attemptClose(ownerId, orderCode) {
  const auth = await troySession.getFreshAuthorization(ownerId);
  if (!auth.ok) throw connectorError('Troy oturumu bulunamadı; giriş gerekiyor.', auth.code || 'TROY_LOGIN_REQUIRED', 401, { opened: auth.opened });
  const headers = auth.headers;

  const revised = await callStep(ownerId, headers, `${TROY_API_ROOT}/IsRevisedLimited`, 'POST', { OrderCode: orderCode });
  if (!revised.ok) {
    throw connectorError(`Troy IsRevisedLimited hatası: HTTP ${revised.status} ${revised.statusText}`.trim(), 'TROY_HTTP_ERROR', 502, { step: 'IsRevisedLimited', status: revised.status });
  }

  const colorInfo = await callStep(ownerId, headers, `${TROY_API_ROOT}/ColorInfromationsByOrderCode`, 'POST', String(orderCode));
  if (!colorInfo.ok) {
    throw connectorError(`Troy ColorInfromationsByOrderCode hatası: HTTP ${colorInfo.status} ${colorInfo.statusText}`.trim(), 'TROY_HTTP_ERROR', 502, { step: 'ColorInfromationsByOrderCode', status: colorInfo.status });
  }
  const refs = [...collectOptionRefs(colorInfo.json)];
  if (!refs.length) {
    return { ok: false, code: 'TROY_NO_OPTION_REFS', message: 'Bu sipariş için ürün seçenek referansı bulunamadı; sipariş kapatılmadı.' };
  }

  const closed = await callStep(ownerId, headers, `${TROY_API_ROOT}/CloseOrCancel`, 'POST', { ProductOptionRefList: refs, OrderCode: orderCode, SellingRegion: 2 });
  if (!closed.ok) {
    throw connectorError(`Troy CloseOrCancel hatası: HTTP ${closed.status} ${closed.statusText}`.trim(), 'TROY_HTTP_ERROR', 502, { step: 'CloseOrCancel', status: closed.status });
  }
  return { ok: true, optionRefCount: refs.length };
}

async function closeOrder(ownerId, orderCode) {
  const code = clean(orderCode);
  if (!code) throw connectorError('Sipariş kodu eksik.', 'TROY_INVALID_ORDER_CODE', 400);
  const key = lockKey(ownerId, code);
  if (inProgress.has(key)) throw connectorError('Bu sipariş için bir kapatma işlemi zaten sürüyor.', 'TROY_OPERATION_IN_PROGRESS', 409);
  inProgress.add(key);

  let timer;
  try {
    const withTimeout = promise => new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(connectorError('Sipariş kapatma isteği zaman aşımına uğradı.', 'TROY_TIMEOUT', 408)), CLOSE_TIMEOUT_MS);
      promise.then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); });
    });

    try {
      return await withTimeout(attemptClose(ownerId, code));
    } catch (error) {
      // Tam olarak BİR sessiz yeniden deneme: yalnız 401/oturum hatasında.
      if (!error || error.code !== 'TROY_UNAUTHORIZED') throw error;
      try {
        return await withTimeout(attemptClose(ownerId, code));
      } catch (retryError) {
        if (retryError && retryError.code === 'TROY_UNAUTHORIZED') {
          throw connectorError('Troy oturumu sona ermiş. Lütfen Troy\'da oturum açıp tekrar deneyin.', 'TROY_LOGIN_REQUIRED', 401);
        }
        throw retryError;
      }
    }
  } finally {
    clearTimeout(timer);
    inProgress.delete(key);
  }
}

/* Doğrulanmış (kullanıcı tarafından canlı DOM'dan çıkarılmış) selector'lar
   ve akış BİREBİR korunur — yeniden keşfedilmez. Tarayıcı İÇİNDE (CDP
   Runtime.evaluate) çalışır ki DOM etkileşimi gerçek bir kullanıcının
   tıklamasıyla aynı yoldan (gerçek Angular event handler'ları tetikleyerek)
   gitsin. Üstteki async IIFE hiçbir koşulda dışarı fırlatmaz — hep bir
   {ok, ...} nesnesi döner (login sayfasına düşülmüşse code:'TROY_LOGIN_
   REQUIRED', başka bir adım bulunamazsa code:'TROY_REVISION_AUTOMATION_
   FAILED') ki CDP evaluate sonucu her zaman düz bir değer olsun. */
function troyRevisionAutomationExpression(orderCode) {
  const code = JSON.stringify(String(orderCode));
  return `(async()=>{
    function waitFor(fn,timeout,interval){
      return new Promise((resolve,reject)=>{
        const started=Date.now();
        const tick=()=>{
          let result=null;
          try{result=fn();}catch(_){result=null;}
          if(result)return resolve(result);
          if(Date.now()-started>=timeout)return reject(new Error('TIMEOUT'));
          setTimeout(tick,interval);
        };
        tick();
      });
    }
    function exactRowMatch(text,orderCode){
      const escaped=String(orderCode).replace(/[.*+?^\${}()|[\\]\\\\]/g,'\\\\$&');
      return new RegExp('(^|[^0-9])'+escaped+'($|[^0-9])').test(String(text||''));
    }
    function looksLikeLogin(){
      return Boolean(document.querySelector('input[type="password"], input[name*="password" i], input[id*="password" i]'));
    }
    const orderCode=${code};
    try{
      // 1) Order Code filtre input'u (varsa) doldurulur, Filter Results'a basılır.
      const input=await waitFor(()=>document.querySelector('input[formcontrolname="orderCode"], input[placeholder="Order Code"]'),15000,200).catch(()=>null);
      if(input){
        const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')?.set;
        setter.call(input,orderCode);
        input.dispatchEvent(new Event('input',{bubbles:true}));
        input.dispatchEvent(new Event('change',{bubbles:true}));
        const filterBtn=[...document.querySelectorAll('button,.mat-raised-button,.mat-button-wrapper')].find(el=>/filter\\s*results/i.test((el.innerText||el.textContent||'').trim()));
        if(filterBtn)filterBtn.click();
      }
      // 2) Doğru sipariş satırı — Order Code'un rakam sınırlarıyla EXACT eşleşmesi.
      const row=await waitFor(()=>{
        const rows=[...document.querySelectorAll('tr, mat-row, .mat-row, [role="row"]')];
        return rows.find(r=>exactRowMatch(r.innerText||r.textContent||'',orderCode));
      },15000,250);
      // 3) Satırın işlem menüsünü aç.
      const toggle=row.querySelector('button.toggle')||row.querySelector('i.icon.toggle')?.closest('button');
      if(!toggle)throw new Error('TOGGLE_NOT_FOUND');
      if(!row.querySelector('.lcw-action-menu-w.opened')){
        toggle.click();
        await waitFor(()=>row.querySelector('.lcw-action-menu-w.opened'),8000,150);
      }
      // 4) GERÇEK "Revize Et" butonu — metinle değil, ikonla doğrulanır.
      const reviseButton=await waitFor(()=>[...row.querySelectorAll('.lcw-action-menu-w.opened .buttons-w button')].find(btn=>btn.querySelector('i.fas.fa-clipboard-list')),8000,150);
      reviseButton.scrollIntoView({block:'center',inline:'center'});
      reviseButton.click();
      // 5) Revize ekranı (Angular Material horizontal stepper) açıldığını
      //    doğrula. Bu satırdan SONRA hiçbir click/input YOK — otomasyon DURUR.
      await waitFor(()=>{
        const type=document.querySelector('mat-select[aria-label="Revize Tipi"]');
        const reason=document.querySelector('mat-select[aria-label="Revize Nedeni"]');
        const description=document.querySelector('textarea[formcontrolname="Description"]');
        const next=document.querySelector('button.next-step');
        return (type&&reason&&description&&next)?true:null;
      },20000,250);
      return {ok:true,state:'REVISION_SCREEN_OPEN'};
    }catch(error){
      return {ok:false,code:looksLikeLogin()?'TROY_LOGIN_REQUIRED':'TROY_REVISION_AUTOMATION_FAILED',message:String(error&&error.message||error)};
    }
  })()`;
}

function isTroyOrdersPage(candidate) {
  try { const url = new URL(candidate.url()); return !candidate.isClosed() && url.hostname.toLowerCase() === TROY_ORDERS_HOST; }
  catch (_) { return false; }
}
/* Mevcut Edge context'inde (yeni profil YOK, bkz. ensureContext) bir Troy
   Orders sekmesi bulur/açar — bu sekme kullanıcının SONRADAN etkileşeceği
   (Revize formunu dolduracağı) sekme olduğu için, Kapat/PO'nun arka plan
   JWT-yakalama sekmesinin aksine, burada BİLEREK odak/gizlilik zorlanmaz;
   Edge'in kendi varsayılan davranışına bırakılır. */
async function ensureTroyOrdersPage(ownerId) {
  const { context } = await ensureContext(ownerId);
  await context.syncPages().catch(() => {});
  let page = context.pages().find(isTroyOrdersPage);
  let opened = false;
  if (!page) { page = await pageForCurrentBuyerLogProfile(context, TROY_ORDERS_URL); opened = true; }
  if (page.url() !== TROY_ORDERS_URL && (opened || !isTroyOrdersPage(page))) {
    await page.goto(TROY_ORDERS_URL, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
  }
  return { page, opened };
}

const reviseInProgress = new Set();
function reviseLockKey(ownerId, orderCode) { return `${safeOwner(ownerId)}::revise::${clean(orderCode)}`; }

/* Kullanıcının "Troy'da Oturum Aç" butonu: mevcut Edge'de (yeni profil YOK)
   Troy Orders sayfasını GÖRÜNÜR biçimde açar/kullanır — form doldurmaz,
   yalnız kullanıcının manuel login yapabileceği sekmeyi hazırlar. */
async function openTroyLogin(ownerId) {
  await ensureTroyOrdersPage(ownerId);
  return { ok: true };
}

/* "Revize Et": Orders → Filter → satır → işlem menüsü → Revize Et adımlarını
   otomatik tamamlar, Troy'un GERÇEK revize stepper'ı açılınca DURUR. Aynı
   sipariş için eşzamanlı ikinci çağrı reddedilir (kapatmadaki ile aynı desen,
   ayrı bir kilit kümesinde — Kapat/PO'nun kilitlerini hiç etkilemez). */
async function openRevision(ownerId, orderCode) {
  const code = clean(orderCode);
  if (!code) throw connectorError('Sipariş kodu eksik.', 'TROY_INVALID_ORDER_CODE', 400);
  const key = reviseLockKey(ownerId, code);
  if (reviseInProgress.has(key)) throw connectorError('Bu sipariş için bir revize işlemi zaten sürüyor.', 'TROY_OPERATION_IN_PROGRESS', 409);
  reviseInProgress.add(key);

  let timer;
  try {
    return await new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(connectorError('Revize akışı zaman aşımına uğradı.', 'TROY_TIMEOUT', 408)), REVISE_TIMEOUT_MS);
      (async () => {
        // Sekme her çağrıda TAZE çözülür: eskisi kapanmış/başka sayfaya
        // gitmiş (stale DOM) olabilir, bu yüzden asla önbelleklenmez.
        const { page } = await ensureTroyOrdersPage(ownerId);
        if (await troyPageLooksLikeLogin(page)) {
          throw connectorError('Revize işlemi için Troy\'da oturum açmanız gerekiyor.', 'TROY_LOGIN_REQUIRED', 401, { opened: true });
        }
        let result;
        try { result = await page._evaluateValue(troyRevisionAutomationExpression(code)); }
        catch (error) { throw connectorError(`Troy revize otomasyonu çalıştırılamadı: ${clean(error && error.message || error)}`, 'TROY_CDP_FAILED', 502); }
        if (!result || !result.ok) {
          const failCode = (result && result.code) || 'TROY_REVISION_AUTOMATION_FAILED';
          const message = failCode === 'TROY_LOGIN_REQUIRED'
            ? 'Revize işlemi için Troy\'da oturum açmanız gerekiyor.'
            : `Troy revize ekranı açılamadı: ${clean(result && result.message)}`;
          throw connectorError(message, failCode, failCode === 'TROY_LOGIN_REQUIRED' ? 401 : 502, { opened: true });
        }
        return result;
      })().then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); });
    });
  } finally {
    clearTimeout(timer);
    reviseInProgress.delete(key);
  }
}

module.exports = {
  closeOrder, collectOptionRefs, TROY_API_ROOT,
  openRevision, openTroyLogin, TROY_ORDERS_URL,
};
