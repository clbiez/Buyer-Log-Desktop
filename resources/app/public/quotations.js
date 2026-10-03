/* Buyer Log v4.07 — shared quotations, status lifecycle and record-level editing permissions */
(() => {
  'use strict';

  const STORAGE_KEY = 'lcw.quotations.v1';
  const MIGRATION_KEY = 'lcw.quotations.serverMigrated.v4.07';
  const COLUMN_WIDTHS_KEY = 'lcw.quotations.columnWidths.v1';
  const LEGACY_DROP_DETACH_KEY = 'lcw.quotations.dropDetached.v2.82';
  const NOTEBOOK_DETACH_KEY = 'lcw.quotations.notebookDetached.v4.76';
  const qColumnDefaults = Object.freeze({model:260,category:140,manufacturer:180,target:125,best:190,price:170,approved:90,dropped:105});
  const qColumnMinimums = Object.freeze({model:110,category:80,manufacturer:100,target:90,best:130,price:125,approved:64,dropped:76});
  let qColumnWidths = null;
  let qState = null;
  let qProfiles = [];
  let qHydrated = false;
  let qReady = null;
  let qSaveQueue = Promise.resolve();
  let qStatusFilter = 'active';
  let qActiveSource = 'collection';
  let qActiveId = null;
  let qDragId = null;
  let qDragMoved = false;
  let qWorkspaceMounted = false;
  let qWorkspaceMode = '';
  let qWorkspaceSelectedLineId = '';
  let qPricingHistoryRows = null;
  let qPricingHistorySelected = null;
  const qTableStates = new Map();
  let qTableFilterPanel = null;
  let qTableFilterDocHandler = null;

  const qNow = () => new Date().toISOString();
  const qId = prefix => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
  const qLang = (tr,en) => (typeof appLang !== 'undefined' && appLang === 'en') ? en : tr;
  const qNorm = value => String(value == null ? '' : value).trim();
  const parseTableSearchTerms=globalThis.BLTableSearch.parseTerms;
  const tableSearchMatches=globalThis.BLTableSearch.matches;
  const qEsc = value => typeof escapeHtml === 'function' ? escapeHtml(String(value == null ? '' : value)) : String(value == null ? '' : value)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  const qCurrentUser = () => (typeof state!=='undefined'&&state.currentUser)||window.BL_USER_CONTEXT||{};
  const qCurrentUserId = () => qNorm(qCurrentUser()?.id);
  const qIsModerator = () => qCurrentUser()?.role==='moderator';

  function qNormalizeRequest(req){
    const current=qCurrentUser();
    const created=req?.createdAt||qNow();
    const ownerId=qNorm(req?.ownerId)||qNorm(current?.id);
    return {
      id:qNorm(req?.id)||qId('quotation'),
      source:req?.source==='cp'?'cp':'collection',
      origin:req?.origin==='manual-collection'?'manual-collection':'',
      createdAt:created,updatedAt:req?.updatedAt||created,
      status:req?.status==='closed'?'closed':'active',closedAt:req?.status==='closed'?qNorm(req?.closedAt||req?.updatedAt||created):'',
      ownerId,ownerName:qNorm(req?.ownerName)||qNorm(current?.displayName||current?.username||ownerId),
      editorIds:[...new Set((Array.isArray(req?.editorIds)?req.editorIds:[]).map(qNorm).filter(id=>id&&id!==ownerId))],
      note:qNorm(req?.note).slice(0,10000),
      capacityConfirmed:!!req?.capacityConfirmed,
      manufacturers:Array.isArray(req?.manufacturers)?req.manufacturers.map(m=>({name:qNorm(m?.name),email:qNorm(m?.email)})).filter(m=>m.name):[],
      items:Array.isArray(req?.items)?req.items.filter(Boolean).map(item=>({
        id:qNorm(item.id)||qId('quote-line'),modelKey:qNorm(item.modelKey),rowId:(item.rowId!==null&&item.rowId!==''&&Number.isFinite(Number(item.rowId)))?Number(item.rowId):null,
        orderCode:qNorm(item.orderCode),plmId:qNorm(item.plmId),modelCode:qNorm(item.modelCode),license:qNorm(item.license),
        category:qNorm(item.category),colour:qNorm(item.colour),fabric:qNorm(item.fabric),season:qNorm(item.season),
        picture:qNorm(item.picture),inStoreMonth:qNorm(item.inStoreMonth),quantity:qNumOrNull(item.quantity),targetPrice:qNorm(item.targetPrice),
        manufacturer:qNorm(item.manufacturer),manufacturerEmail:qNorm(item.manufacturerEmail),price:qNorm(item.price),approved:!!item.approved,dropped:!!item.dropped,
      })).filter(item=>item.modelKey&&item.manufacturer):[],
      sortOrder:Number.isFinite(Number(req?.sortOrder))?Number(req.sortOrder):0,
    };
  }

  function qLoad(){
    if(qState) return qState;
    let parsed=null;
    try{parsed=JSON.parse(BLStorage.getItem(STORAGE_KEY)||'null');}catch(e){}
    if(!parsed||!Array.isArray(parsed.requests))parsed={version:2,requests:[]};
    qState={version:2,requests:parsed.requests.filter(Boolean).map(qNormalizeRequest)};
    return qState;
  }
  function qPersistLocal(){
    try{BLStorage.setItem(STORAGE_KEY,JSON.stringify(qLoad()));return true;}
    catch(e){if(typeof showToast==='function')showToast(qLang('Fiyat çalışmaları yerel önbelleğe kaydedilemedi.','Quotations could not be cached locally.'));return false;}
  }
  async function qApi(path,options={}){
    const response=await fetch(path,{credentials:'same-origin',cache:'no-store',...options,headers:{...(options.body?{'Content-Type':'application/json'}:{}),...(options.headers||{})}});
    const data=await response.json().catch(()=>({}));
    if(!response.ok){const error=new Error(data.error||response.statusText||qLang('Quotation işlemi başarısız.','Quotation operation failed.'));error.code=data.code;error.status=response.status;throw error;}
    return data;
  }
  /*
   * Sunucudan dönen kaydı yerel depoya yazar.
   *
   * NESNE KİMLİĞİ KORUNUR. Eskiden st.requests[index] yeni bir nesneyle
   * DEĞİŞTİRİLİYORDU; oysa ekrandaki bütün olay dinleyicileri (Drop, Onayla,
   * fiyat girişi, sil) render sırasındaki `req` nesnesini kapatıyor ve
   * getLine=id=>req.items.find(...) satırı o nesne üzerinden arıyor.
   *
   * Sonuç şu hataydı: ilk Drop çalışıyor, arka planda PUT tamamlanınca depodaki
   * nesne yenisiyle değişiyor, ekrandaki dinleyiciler ARTIK DEPODA OLMAYAN eski
   * nesneyi güncelliyordu. qRenderDetail ise qActiveRequest() ile depodaki YENİ
   * nesneyi çiziyordu — yani tıklama hiçbir şey yapmamış gibi görünüyor, ikinci
   * tıklama gerekiyordu.
   *
   * Alanları yerinde birleştirmek bu sınıfın tamamını kapatır: dinleyiciler aynı
   * nesneyi tutmaya devam eder, içeriği sunucudan gelen hâle güncellenir.
   */
  function qReplaceRequest(request){
    const normalized=qNormalizeRequest(request),st=qLoad(),index=st.requests.findIndex(item=>item.id===normalized.id);
    if(index<0){st.requests.unshift(normalized);qPersistLocal();return normalized;}
    const existing=st.requests[index];
    if(existing===normalized){qPersistLocal();return existing;}
    // Sunucuda artık bulunmayan alanlar temizlenir, kalanlar üzerine yazılır.
    Object.keys(existing).forEach(key=>{ if(!Object.prototype.hasOwnProperty.call(normalized,key)) delete existing[key]; });
    Object.assign(existing,normalized);
    qPersistLocal();return existing;
  }
  async function qHydrateShared(force=false){
    if(qHydrated&&!force)return qLoad();
    const legacy=qLoad().requests.slice();
    try{
      let data=await qApi('/api/quotations');
      qProfiles=Array.isArray(data.profiles)?data.profiles:[];
      const migrated=BLStorage.getItem(MIGRATION_KEY)==='1';
      if(!migrated&&legacy.length){
        try{
          const imported=await qApi('/api/quotations/import',{method:'POST',body:JSON.stringify({requests:legacy})});
          if(Array.isArray(imported.requests))data={...data,requests:imported.requests};
        }catch(importErr){
          // Ortak depoda zaten kayıt varsa sıradan kullanıcıların eski tarayıcı
          // önbelleğini yeniden içe aktarmasına izin verilmez. Bu durumda sunucu
          // verisini göstermeye devam et; bütün yüklemeyi yerel kopyaya düşürme.
          if(importErr?.status!==403)throw importErr;
        }
        BLStorage.setItem(MIGRATION_KEY,'1');
      }
      qState={version:2,requests:(Array.isArray(data.requests)?data.requests:[]).map(qNormalizeRequest)};
      qHydrated=true;qPersistLocal();
    }catch(err){
      qHydrated=true;
      if(typeof showToast==='function')showToast(qLang('Ortak quotation kayıtları yüklenemedi; yerel önbellek gösteriliyor. ','Shared quotations could not be loaded; showing the local cache. ')+(err?.message||''));
    }
    return qLoad();
  }
  function qQueue(task){
    qSaveQueue=qSaveQueue.then(task,task);
    return qSaveQueue;
  }
  function qSave(requests=null){
    qPersistLocal();
    const list=(Array.isArray(requests)?requests:[requests]).filter(Boolean);
    if(!list.length)return true;
    qQueue(async()=>{
      for(const req of list){
        try{const data=await qApi(`/api/quotations/${encodeURIComponent(req.id)}`,{method:'PUT',body:JSON.stringify(req)});if(data.request)qReplaceRequest(data.request);}
        catch(err){if(typeof showToast==='function')showToast((err?.message||qLang('Quotation kaydedilemedi.','Quotation could not be saved.')));if(err?.status===403)await qHydrateShared(true);}
      }
    });
    return true;
  }

  // Quotation içeriği ile durum değişikliği iki farklı API çağrısıdır. Kullanıcı
  // fiyat hücresinden doğrudan "Kapandı" seçimine geçtiğinde durum PATCH'i, fiyat
  // PUT'undan önce sunucuya ulaşırsa kapalı kayıt eski içerikle dönebilir ve sıradaki
  // PUT kapalı kayıt korumasına takılır. Durum değiştirmeden önce bütün bekleyen
  // içerik kayıtlarının tamamlanmasını beklemek bu yarışı ortadan kaldırır.
  async function qFlushSaves(){
    try{await qSaveQueue;}catch(_){}
    return true;
  }

  qReady=qHydrateShared().then(result=>{qDetachLegacyNotebookPages();return result;});

  function qSourceLabel(source){ return source==='cp' ? 'CP' : qLang('Koleksiyon','Collection'); }
  function qStatusLabel(status){return status==='closed'?qLang('Kapandı','Closed'):qLang('Devam ediyor','In progress');}
  function qProfileName(userId){const profile=qProfiles.find(item=>item.id===userId);return qNorm(profile?.displayName||profile?.username||userId)||'—';}
  function qOwnerLabel(req){const profile=qProfiles.find(item=>item.id===req?.ownerId);return qNorm(profile?.displayName||profile?.username||req?.ownerName||req?.ownerId)||'—';}
  function qEditorNames(req){return (Array.isArray(req?.editorIds)?req.editorIds:[]).map(qProfileName).filter(Boolean);}
  function qDate(value,withTime=true){
    const d=new Date(value); if(Number.isNaN(d.getTime())) return '';
    return d.toLocaleString((typeof appLang!=='undefined'&&appLang==='en')?'en-GB':'tr-TR',withTime?{dateStyle:'short',timeStyle:'short'}:{dateStyle:'short'});
  }
  function qMoneyNumber(value){
    if(typeof kolParseMoneyNum==='function') return kolParseMoneyNum(value);
    const text=qNorm(value).replace(/[$£€\s]/g,'').replace(/\.(?=\d{3}(?:\D|$))/g,'').replace(',','.');
    const n=Number(text); return Number.isFinite(n)?n:NaN;
  }
  function qMoneyDisplay(value){
    const n=qMoneyNumber(value); if(!Number.isFinite(n)) return qNorm(value);
    if(typeof kolFormatMoneyDisplay==='function') return kolFormatMoneyDisplay(String(n));
    return n.toFixed(2);
  }
  function qValidPrice(value){ const n=qMoneyNumber(value); return Number.isFinite(n)&&n>0; }

  function qRequestTitle(req){
    if(req?.origin==='manual-collection')return qLang('Koleksiyon · Elle Girilen Fiyatlar','Collection · Manual Prices');
    const names=[...new Set(req.manufacturers.map(m=>m.name).filter(Boolean))];
    const first=names.slice(0,2).join(', '), more=names.length>2?` +${names.length-2}`:'';
    return `${qSourceLabel(req.source)} · ${first||qLang('Üretici yok','No manufacturer')}${more}`;
  }
  function qModelCount(req){ return new Set(req.items.map(x=>x.modelKey)).size; }
  function qWorkspaceRequestTitle(req){
    if(req?.origin==='manual-collection')return qLang('Elle Girilen Fiyatlar','Manual Prices');
    const models=[...new Set((req?.items||[]).map(item=>qNorm(item.modelCode||item.plmId||item.orderCode)).filter(Boolean))];
    if(models.length===1)return models[0];
    if(models.length>1)return `${models[0]} +${models.length-1}`;
    return qRequestTitle(req);
  }

  // Quotation kayıtları Notebook'tan tamamen bağımsızdır. v4.76 geçişi,
  // eski sürümlerin otomatik oluşturduğu quotation not sayfalarını bir kez temizler;
  // kullanıcının normal not sayfalarına dokunmaz.
  function qDetachLegacyNotebookPages(){
    if(typeof BLStorage==='undefined')return;
    try{
      if(BLStorage.getItem(NOTEBOOK_DETACH_KEY)==='1')return;
      if(typeof todoLoad==='function'&&typeof todoSave==='function'){
        const st=todoLoad();
        const before=Array.isArray(st.pages)?st.pages.length:0;
        st.pages=(Array.isArray(st.pages)?st.pages:[]).filter(page=>page?.type!=='quotation'&&!qNorm(page?.quotationId));
        if(!st.pages.some(page=>page.id===st.activeId))st.activeId=st.pages[0]?.id||null;
        if(!st.pages.length){
          const title=typeof todoText==='function'?todoText().untitled:qLang('İsimsiz not','Untitled note');
          const page={id:qId('todo'),title,text:'',updatedAt:qNow()};
          st.pages.push(page);st.activeId=page.id;
        }
        if(st.pages.length!==before)todoSave(null);
      }
      BLStorage.setItem(NOTEBOOK_DETACH_KEY,'1');
    }catch(e){}
  }

  function qFindCollectionRow(line){
    if(typeof kolRows==='undefined' || !Array.isArray(kolRows)) return null;
    if(Number.isFinite(Number(line.rowId))){
      const byId=kolRows.find(r=>Number(r.id)===Number(line.rowId)); if(byId) return byId;
    }
    if(line.orderCode){
      const byCode=kolRows.find(r=>qNorm(r._sourceOrderCode).toLocaleLowerCase('tr-TR')===line.orderCode.toLocaleLowerCase('tr-TR'));
      if(byCode) return byCode;
    }
    return null;
  }

  function qCollectionEffectiveValue(row,key){
    try{
      const api=window.BLCollectionModelGroups;
      if(api?.effectiveValue&&typeof kolRows!=='undefined'&&Array.isArray(kolRows))return api.effectiveValue(row,key,kolRows);
    }catch(_){ }
    return row?.[key];
  }

  function qCollectionImageSrc(row,item=null){
    const plmId=qNorm(row?.plmId||row?.['PLM ID']||item?.plmId),colourCode=qNorm(row?.colourCode||row?.['C.Code']||row?.['Colour Code']||item?.colourCode);
    // Kanonik kayıt renk ADI taşıyan anahtar da tutar (plm:X|colour:Y|name:Z).
    // Ana Koleksiyon görünümü (canonicalModelImageSource) rengi zaten
    // veriyordu; Pricing History vermediği için adlı kayıtlar ıskalanıp legacy
    // picture/img değerine düşülüyordu.
    const colourName=qNorm(row?.colour||row?.['Colour']||row?.['Renk']||item?.colour);
    const canonicalKnown=window.BLModelImageCache?.hasRegistryKey?.(plmId,colourCode,colourName)||false;
    const canonical=window.BLModelImageCache?.resolveRegistrySource?.(plmId,colourCode,'/api/collection-images',colourName)||'';
    if(canonicalKnown)return canonical;
    if(row){
      const direct=qNorm(row.img||row.Picture||row.picture);
      if(direct)return direct;
      const ref=qNorm(row.imgRef);
      if(ref)return `/api/collection-images/${encodeURIComponent(ref)}`;
    }
    return qNorm(item?.picture);
  }
  function qCachedModelThumb(source,{modelId='',plmId='',modelName='',colourCode='',colour='',classes='quotationModelThumb'}={}){
    const src=qNorm(source)||window.BLDetailImages?.sourceFor?.({plmId:plmId||modelId,modelName,colourCode,colour})||'';
    if(window.BLDetailImages?.thumbHtml)return window.BLDetailImages.thumbHtml(src,{modelId:modelId||plmId||modelName,plmId:plmId||modelId,modelName,colourCode,colour},{classes,allowEmpty:true,title:qLang('Büyük önizleme için üzerine gelin','Hover for large preview')});
    if(!src)return '';
    if(classes==='qhModelImage')return `<img class="qhModelImage" src="${qEsc(src)}" alt="" loading="lazy" decoding="async" fetchpriority="low">`;
    return `<img class="${qEsc(classes)}" src="${qEsc(src)}" alt="" loading="lazy" decoding="async" fetchpriority="low">`;
  }

  function qFindCpRow(line){
    const rows=(typeof state!=='undefined'&&state.cp&&Array.isArray(state.cp.rows))?state.cp.rows:[];
    if(!rows.length) return null;
    const order=qNorm(line.orderCode).toLocaleLowerCase('tr-TR');
    if(order){
      const byOrder=rows.find(r=>qNorm(r._sourceOrderCode||r['Order Code']).toLocaleLowerCase('tr-TR')===order);
      if(byOrder) return byOrder;
    }
    const plm=qNorm(line.plmId).toLocaleLowerCase('tr-TR');
    if(plm){
      const byPlm=rows.find(r=>qNorm(r.plmId||r['PLM ID']).toLocaleLowerCase('tr-TR')===plm);
      if(byPlm) return byPlm;
    }
    const model=qNorm(line.modelCode).toLocaleLowerCase('tr-TR');
    if(model){
      const byModel=rows.find(r=>qNorm(r.modelKod||r['Model Name']).toLocaleLowerCase('tr-TR')===model);
      if(byModel) return byModel;
    }
    return null;
  }

  function qCanEditRequest(req){
    if(!req)return false;
    const userId=qCurrentUserId();
    return qIsModerator()||req.ownerId===userId||(Array.isArray(req.editorIds)&&req.editorIds.includes(userId));
  }
  function qCanManageAccess(req){return Boolean(req&&(qIsModerator()||req.ownerId===qCurrentUserId()));}
  // v6.51 — Kapalı kayıtlarda içerik düzenleme yasağı kaldırıldı; yalnız
  // sahiplik/erişim kontrolü (qCanEditRequest) kaldı.
  function qCanEditLine(req,_item){return Boolean(req&&qCanEditRequest(req));}
  function qCanDeleteRequest(req){return qCanManageAccess(req);}
  function qViewOnlyNotice(req){
    if(typeof showToast!=='function')return;
    showToast(req?.status==='closed'
      ?qLang('Bu quotation kapalıdır. Düzenlemek için önce Devam ediyor durumuna alın.','This quotation is closed. Reopen it before editing.')
      :qLang('Bu quotation için yalnız görüntüleme yetkiniz var. Kayıt sahibinin düzenleme yetkisi vermesi gerekir.','You have view-only access to this quotation. The owner must grant editing permission.'));
  }

  function qFabricValue(row){
    if(!row) return '';
    const direct=qNorm(qCollectionEffectiveValue(row,'fabric')); if(direct) return direct;
    const parts=[qCollectionEffectiveValue(row,'Kumaş Tipi'),qCollectionEffectiveValue(row,'kumasTipi'),qCollectionEffectiveValue(row,'Karışım'),qCollectionEffectiveValue(row,'karisim'),qCollectionEffectiveValue(row,'Gramaj'),qCollectionEffectiveValue(row,'fabricWeight')]
      .map(qNorm).filter((value,index,all)=>value&&all.indexOf(value)===index);
    return parts.join(' · ');
  }

  function qItemFabric(req,item){
    return qNorm(item.fabric) || qFabricValue(req.source==='collection'?qFindCollectionRow(item):qFindCpRow(item));
  }

  function qItemCategory(req,item){
    if(qNorm(item?.category)) return qNorm(item.category);
    const row=req?.source==='collection'?qFindCollectionRow(item):qFindCpRow(item);
    return qNorm(qCollectionEffectiveValue(row,'urunTipi') || row?.['Category'] || row?.category);
  }

  function qItemTargetPrice(req,item){
    if(req?.ownerId&&req.ownerId!==qCurrentUserId())return qNorm(item?.targetPrice);
    const row=req?.source==='collection'?qFindCollectionRow(item):qFindCpRow(item);
    if(row){
      if(req?.source==='collection' && Object.prototype.hasOwnProperty.call(row,'targetPrice')) return qNorm(qCollectionEffectiveValue(row,'targetPrice'));
      if(req?.source==='cp'){
        if(Object.prototype.hasOwnProperty.call(row,'targetPrice')) return qNorm(row.targetPrice);
        if(Object.prototype.hasOwnProperty.call(row,'Supp. FOB')) return qNorm(row['Supp. FOB']);
      }
    }
    return qNorm(item?.targetPrice);
  }

  function qTargetDelta(targetValue,priceValue){
    const target=qMoneyNumber(targetValue),price=qMoneyNumber(priceValue);
    if(!Number.isFinite(target)||target<=0||!Number.isFinite(price)||price<=0) return null;
    const percent=((price-target)/target)*100;
    const rounded=Math.abs(percent)<0.05?0:Math.round(percent*10)/10;
    const locale=(typeof appLang!=='undefined'&&appLang==='en')?'en-GB':'tr-TR';
    const amount=Math.abs(rounded).toLocaleString(locale,{minimumFractionDigits:Number.isInteger(rounded)?0:1,maximumFractionDigits:1});
    return {target,price,percent:rounded,meetsTarget:price<=target,text:rounded===0?'0%':`${rounded<0?'−':'+'}${amount}%`};
  }

  // `kol:<rowId>` yalnız TEK kullanıcının Koleksiyon çalışma alanında anlamlıdır:
  // rowId'ler kullanıcı başına 1'den başlar ve veri taşıma / yeniden import /
  // reset sonrası yeniden dağıtılır. Bu yüzden aynı modelKey tek başına "aynı
  // model" demek değildir. Eşleşme için (1) Koleksiyon kayıtlarında aynı
  // quotation sahibi ve (2) kayıt anındaki PLM ID / Model adı anlık
  // görüntülerinden en az birinin uyuşması gerekir. Tek alanın (ör. yalnız
  // model adı) revize edilmesi eşleşmeyi bozmaz; ikisi de farklıysa bu artık
  // başka bir modeldir ve eski fiyat ona taşınmaz.
  function qIdentityCompatible(a,b){
    const pairs=[[a?.plmId,b?.plmId],[a?.modelCode,b?.modelCode]]
      .map(([x,y])=>[qNorm(x).toLocaleLowerCase('tr-TR'),qNorm(y).toLocaleLowerCase('tr-TR')])
      .filter(([x,y])=>x&&y);
    return !pairs.length||pairs.some(([x,y])=>x===y);
  }
  function qSameCollectionOwner(reqA,reqB){
    return qNorm(reqA?.ownerId)===qNorm(reqB?.ownerId);
  }
  function qBestForModel(req,item){
    let best=null;
    const source=req?.source==='cp'?'cp':'collection';
    const modelKey=qNorm(item?.modelKey);
    if(!modelKey)return null;
    // Best Price is shared across every quotation for the same source/model.
    // The price remains owned by its original quotation line; only the derived
    // Best Price / Mfr view is global.
    qLoad().requests.forEach(otherReq=>{
      if(otherReq.source!==source)return;
      if(source==='collection'&&!qSameCollectionOwner(req,otherReq))return;
      (otherReq.items||[]).forEach(line=>{
        if(qNorm(line.modelKey)!==modelKey||!qValidPrice(line.price))return;
        if(!qIdentityCompatible(item,line))return;
        const price=qMoneyNumber(line.price);
        if(!best||price<best.price){
          best={price,manufacturer:qNorm(line.manufacturer),lineId:line.id};
        }
      });
    });
    return best;
  }


  function qItemDropped(_req,item){
    return !!item?.dropped;
  }

  function qDetachLegacyCollectionDrops(){
    try{if(BLStorage.getItem(LEGACY_DROP_DETACH_KEY)==='1')return 0;}catch(e){}
    if(typeof kolRows==='undefined'||!Array.isArray(kolRows)||!kolRows.length)return 0;
    const affectedRows=new Set();
    qLoad().requests.forEach(req=>{
      if(req.source!=='collection'||req.ownerId!==qCurrentUserId())return;
      req.items.forEach(item=>{if(item.dropped&&Number.isFinite(Number(item.rowId)))affectedRows.add(Number(item.rowId));});
    });
    let changed=0;
    kolRows.forEach(row=>{
      if(affectedRows.has(Number(row.id))&&row.dropped){row.dropped=false;changed++;}
    });
    if(changed&&typeof saveKolRows==='function')saveKolRows();
    try{BLStorage.setItem(LEGACY_DROP_DETACH_KEY,'1');}catch(e){}
    if(changed&&typeof renderKol==='function'&&document.body?.dataset?.activeTab==='koleksiyon')renderKol();
    return changed;
  }

  function qBuildExportRows(req){
    const groups=new Map();
    (req?.items||[]).forEach((item,index)=>{
      let row=groups.get(item.modelKey);
      if(!row){
        const current=req.ownerId===qCurrentUserId()?(req.source==='collection'?qFindCollectionRow(item):qFindCpRow(item)):null;
        row=current?{...current}:{};
        row.id=row.id??item.rowId??index+1;
        row.plmId=qNorm(row.plmId||row['PLM ID']||item.plmId);
        row.modelKod=qNorm(qCollectionEffectiveValue(row,'modelKod')||row['Model Name']||item.modelCode);
        row.lisans=qNorm(qCollectionEffectiveValue(row,'lisans')||row['License']||item.license);
        row.urunTipi=qNorm(qCollectionEffectiveValue(row,'urunTipi')||row['Category']||item.category);
        row.colour=qNorm(row.colour||row['Colour']||item.colour);
        row.fabric=qFabricValue(row)||qNorm(item.fabric);
        row.season=qNorm(qCollectionEffectiveValue(row,'season')||row['Season']||item.season);
        row.targetPrice=qItemTargetPrice(req,item);
        row.img=qCollectionImageSrc(row,item);
        row._quotationPrices={};
        row._quotationApprovals={};
        groups.set(item.modelKey,row);
      }
      row._quotationPrices[item.manufacturer]=qNorm(item.price);
      row._quotationApprovals[item.manufacturer]=!!item.approved;
    });
    return [...groups.values()];
  }

  async function qExportRequest(req,button){
    const bridge=window.BL_KOL_PRICING_EXCEL;
    if(!bridge?.build||!bridge?.download){
      if(typeof showToast==='function')showToast(qLang('Excel oluşturma modülü hazır değil.','Excel export module is not ready.'));
      return false;
    }
    const rows=qBuildExportRows(req);
    if(!rows.length){if(typeof showToast==='function')showToast(qLang('Aktarılacak model yok.','There are no models to export.'));return false;}
    const names=[...new Set([...(req.manufacturers||[]).map(m=>qNorm(m.name)),...(req.items||[]).map(item=>qNorm(item.manufacturer))].filter(Boolean))];
    const extraColumns=names.map(name=>({
      label:`[${name}] Quotation Price`,width:24,money:true,
      value:row=>row._quotationPrices?.[name]||'',
      approved:row=>!!row._quotationApprovals?.[name],
    }));
    const old=button?.innerHTML;
    if(button){button.disabled=true;button.textContent=qLang('Hazırlanıyor…','Preparing…');}
    try{
      const date=new Date(req.createdAt||Date.now()),pad=value=>String(value).padStart(2,'0');
      const safeTitle=(typeof kolSafePricingFileName==='function'?kolSafePricingFileName(qRequestTitle(req)):qRequestTitle(req).replace(/[^A-Za-z0-9._-]+/g,'_'))||'Quotation_History';
      const fileName=`Quotation_History_${safeTitle}_${date.getFullYear()}${pad(date.getMonth()+1)}${pad(date.getDate())}.xlsx`;
      const workbook=await bridge.build(rows,safeTitle,{extraColumns,fileName,sheetName:'Quotation History'});
      bridge.download(workbook);
      if(typeof showToast==='function')showToast(qLang(`Quotation Excel oluşturuldu (${rows.length} model).`,`Quotation Excel created (${rows.length} models).`));
      return true;
    }catch(err){
      if(typeof showToast==='function')showToast(qLang('Quotation Excel oluşturulamadı: ','Quotation Excel could not be created: ')+(err?.message||String(err)));
      return false;
    }finally{if(button){button.disabled=false;button.innerHTML=old;}}
  }

  /* Koleksiyon satırındaki fiyat haritası quotation kaleminden yazılır.
     v5.99: DÜŞÜLEN (dropped) kalem artık haritadan SİLİNİR. Önceden yalnız
     yazma vardı; düşülen bir üreticinin fiyatı Koleksiyon'da kalmaya devam
     ediyor ve Best Price hesabına giriyordu. Aynı sebeple onaylı üretici de
     düşülünce temizlenir — silinmiş bir teklifin üreticisi "nihai üretici"
     olarak kalmamalı. */
  function qWritePriceToCollection(req,line){
    if(!req||req.ownerId!==qCurrentUserId())return false;
    const row=qFindCollectionRow(line); if(!row) return false;
    if(!row.pricing) row.pricing={};
    if(line.dropped){
      delete row.pricing[line.manufacturer];
      if(qNorm(row.confirmedManufacturer)===line.manufacturer) row.confirmedManufacturer='';
    }else{
      row.pricing[line.manufacturer]=qValidPrice(line.price)?qMoneyDisplay(line.price):qNorm(line.price);
      if(line.approved && qValidPrice(line.price)) row.confirmedManufacturer=line.manufacturer;
      else if(qNorm(row.confirmedManufacturer)===line.manufacturer && !line.approved) row.confirmedManufacturer='';
    }
    if(typeof kolApplyRulePricing==='function') kolApplyRulePricing(row);
    if(typeof saveKolRows==='function') saveKolRows();
    return true;
  }

  function qRefreshCollection(){
    if(typeof document!=='undefined' && document.body?.dataset?.activeTab==='koleksiyon' && typeof renderKol==='function') renderKol();
  }

  async function recordRequest(source,rows,manufacturers){
    await qReady;
    const src=source==='cp'?'cp':'collection';
    const safeRows=Array.isArray(rows)?rows.filter(Boolean):[];
    const safeMfrs=(Array.isArray(manufacturers)?manufacturers:[]).map(m=>({name:qNorm(m?.name),email:qNorm(m?.email)})).filter(m=>m.name);
    if(!safeRows.length||!safeMfrs.length)return null;
    if(src==='cp'&&safeRows.some(row=>row._canEdit===false)){qViewOnlyNotice();return null;}
    const created=qNow(),user=qCurrentUser();
    const req={id:qId('quotation'),source:src,createdAt:created,updatedAt:created,status:'active',closedAt:'',ownerId:qCurrentUserId(),ownerName:qNorm(user?.displayName||user?.username),editorIds:[],note:'',capacityConfirmed:false,manufacturers:safeMfrs,items:[],sortOrder:Date.now()};
    safeRows.forEach((row,ri)=>{
      const modelSeed=src==='collection'?`kol:${row.id}`:`cp:${qNorm(row._sourceOrderCode)||qNorm(row.plmId)||qNorm(row.modelKod)||ri}`;
      safeMfrs.forEach((m,mi)=>{
        const oldPrice=row.pricing&&row.pricing[m.name];
        req.items.push({
          id:qId(`quote-${ri}-${mi}`),modelKey:modelSeed,rowId:src==='collection'?Number(row.id):null,
          orderCode:qNorm(row._sourceOrderCode||row['Order Code']),plmId:qNorm(row.plmId||row['PLM ID']),modelCode:qNorm(row.modelKod||row['Model Name']),license:qNorm(row.lisans||row['License']),
          category:qNorm(row.urunTipi||row['Category']),colour:qNorm(row.colour||row['Colour']),colourCode:qNorm(row.colourCode||row['C.Code']||row['Colour Code']),fabric:qFabricValue(row),season:qNorm(row.season||row['Season']),
          picture:qCollectionImageSrc(row),inStoreMonth:qNorm(row.inStoreMonth||row['In Store Month']||row['In-Store (Model Budget)']||row.inStore),quantity:Number.isFinite(qMoneyNumber(row.quantity!=null?row.quantity:row['Order Quantity']))?qMoneyNumber(row.quantity!=null?row.quantity:row['Order Quantity']):null,targetPrice:qNorm(row.targetPrice||row['Supp. FOB']),
          manufacturer:m.name,manufacturerEmail:m.email,price:qValidPrice(oldPrice)?qMoneyDisplay(oldPrice):'',approved:src==='collection'&&qNorm(row.confirmedManufacturer)===m.name&&qValidPrice(oldPrice),dropped:false,
        });
      });
    });
    try{
      const data=await qApi('/api/quotations',{method:'POST',body:JSON.stringify(req)});
      const saved=qReplaceRequest(data.request||req);qActiveSource=src;qActiveId=saved.id;return saved;
    }catch(err){
      if(typeof showToast==='function')showToast(qLang('Quotation kaydı oluşturulamadı: ','Quotation could not be created: ')+(err?.message||String(err)));
      return null;
    }
  }


  /* Koleksiyon'da elle girilen fiyatlar ayrı ayrı quotation oluşturmaz.
     Kullanıcının tek "manual-collection" quotation'ı altında toplanır.
     Mevcut gerçek quotation satırı varsa v6.34 davranışı korunur ve o satır
     yerinde güncellenir; yalnız hiçbir mevcut satır yoksa manuel kovaya eklenir. */
  async function recordManualCollectionPrice(row,manufacturer,{price,approved=false,_retried=false}={}){
    await qReady;
    if(!row)return null;
    const raw=manufacturer&&typeof manufacturer==='object'?manufacturer:{name:manufacturer};
    const m={name:qNorm(raw?.name),email:qNorm(raw?.email)};
    if(!m.name)return null;
    const rowId=Number(row.id);
    if(!Number.isFinite(rowId))return null;
    const displayPrice=qValidPrice(price)?qMoneyDisplay(price):(qValidPrice(row.pricing?.[m.name])?qMoneyDisplay(row.pricing[m.name]):'');
    if(!displayPrice)return null;

    // Başka bir quotation içinde bu model + üretici zaten varsa yeni manuel
    // satır açma; kullanıcının düzenlediği gerçek kaydı yerinde güncelle.
    const existing=findCollectionLine(rowId,m.name);
    if(existing){
      const updated=updateCollectionLine(rowId,m.name,{price:displayPrice,approved:Boolean(approved)});
      if(updated){
        await qFlushSaves();
        const req=qLoad().requests.find(r=>r.id===existing.requestId)||null;
        return {request:req,created:false,added:false,updatedExisting:true};
      }
    }

    // Çoklu pencere / cihazda mümkün olduğunca güncel ortak durumu gör.
    await qHydrateShared(true);
    let bucket=qLoad().requests.find(req=>req?.source==='collection'
      &&req?.origin==='manual-collection'
      &&req?.ownerId===qCurrentUserId()
      &&qCanEditRequest(req));

    const buildItem=()=>({
      id:qId('manual-price'),modelKey:`kol:${rowId}`,rowId,
      orderCode:qNorm(row._sourceOrderCode||row['Order Code']),plmId:qNorm(row.plmId||row['PLM ID']),modelCode:qNorm(row.modelKod||row['Model Name']),license:qNorm(row.lisans||row['License']),
      category:qNorm(row.urunTipi||row['Category']),colour:qNorm(row.colour||row['Colour']),colourCode:qNorm(row.colourCode||row['C.Code']||row['Colour Code']),fabric:qFabricValue(row),season:qNorm(row.season||row['Season']),
      picture:qCollectionImageSrc(row),inStoreMonth:qNorm(row.inStoreMonth||row['In Store Month']||row['In-Store (Model Budget)']||row.inStore),quantity:Number.isFinite(qMoneyNumber(row.quantity!=null?row.quantity:row['Order Quantity']))?qMoneyNumber(row.quantity!=null?row.quantity:row['Order Quantity']):null,targetPrice:qNorm(row.targetPrice||row['Supp. FOB']),
      manufacturer:m.name,manufacturerEmail:m.email,price:displayPrice,approved:Boolean(approved),dropped:false,
    });

    if(!bucket){
      const created=qNow(),user=qCurrentUser();
      const req={
        id:qId('quotation-manual'),source:'collection',origin:'manual-collection',
        createdAt:created,updatedAt:created,status:'active',closedAt:'',
        ownerId:qCurrentUserId(),ownerName:qNorm(user?.displayName||user?.username),
        editorIds:[],note:'',capacityConfirmed:false,manufacturers:[m],
        items:[buildItem()],sortOrder:Date.now()
      };
      try{
        const data=await qQueue(()=>qApi('/api/quotations',{method:'POST',body:JSON.stringify(req)}));
        const saved=qReplaceRequest(data.request||req);qActiveSource='collection';qActiveId=saved.id;
        return {request:saved,created:true,added:true,updatedExisting:false};
      }catch(err){
        if(err?.status===409&&!_retried){
          await qHydrateShared(true);
          return recordManualCollectionPrice(row,m,{price:displayPrice,approved,_retried:true});
        }
        if(typeof showToast==='function')showToast(qLang('Manuel quotation kaydı oluşturulamadı: ','Manual quotation could not be created: ')+(err?.message||String(err)));
        return null;
      }
    }

    const sameName=(a,b)=>qNorm(a).toLocaleLowerCase('tr-TR')===qNorm(b).toLocaleLowerCase('tr-TR');
    const mfr=bucket.manufacturers.find(item=>sameName(item?.name,m.name));
    if(!mfr)bucket.manufacturers.push(m);
    else if(!qNorm(mfr.email)&&m.email)mfr.email=m.email;

    let line=(bucket.items||[]).find(item=>Number(item?.rowId)===rowId&&sameName(item?.manufacturer,m.name));
    if(line){
      const fresh=buildItem(),keepId=line.id;
      Object.assign(line,fresh,{id:keepId,dropped:false});
    }else{
      line=buildItem();bucket.items.push(line);
    }
    bucket.updatedAt=qNow();
    try{
      const data=await qQueue(()=>qApi(`/api/quotations/${encodeURIComponent(bucket.id)}`,{method:'PUT',body:JSON.stringify(bucket)}));
      const saved=qReplaceRequest(data.request||bucket);qActiveSource='collection';qActiveId=saved.id;
      return {request:saved,created:false,added:true,updatedExisting:false};
    }catch(err){
      if(err?.status===409&&!_retried){
        await qHydrateShared(true);
        return recordManualCollectionPrice(row,m,{price:displayPrice,approved,_retried:true});
      }
      if(typeof showToast==='function')showToast(qLang('Manuel quotation kaydı güncellenemedi: ','Manual quotation could not be updated: ')+(err?.message||String(err)));
      return null;
    }
  }

  async function renameManufacturer(oldName,newName){
    await qReady;
    const old=qNorm(oldName),next=qNorm(newName);if(!old||!next||old===next)return;
    const affected=[];
    qLoad().requests.forEach(req=>{
      // v6.52 — "eski kayıtlara da yansıt": kapalı kayıtları atlayan şart
      // kaldırıldı (v6.51'de içerik düzenleme kilidi zaten kalkmıştı, bu
      // fonksiyon o karardan bağımsız kendi eski kısıtlamasını taşıyordu).
      // Sahiplik kontrolü (yalnız kendi kayıtların) BİLEREK korunuyor.
      if(req.ownerId!==qCurrentUserId())return;
      let changed=false;
      req.manufacturers.forEach(m=>{if(m.name===old){m.name=next;changed=true;}});
      req.items.forEach(item=>{if(item.manufacturer===old){item.manufacturer=next;changed=true;}});
      if(changed){req.updatedAt=qNow();affected.push(req);}
    });
    if(affected.length)qSave(affected);
  }

  /* v6.52 — Koleksiyon'da bir modelin PLM ID / Model Name / Category / Colour /
     Season / License alanı değiştiğinde, o modele ait quotation satırları da
     senkronlanır. Eşleşme item.rowId (Koleksiyon satırının KALICI kimliği)
     üzerinden yapılır — model adı DEĞİŞSE BİLE rowId sabit kaldığı için doğru
     satır bulunur. recordRequest ile AYNI alan haritasını kullanır, aksi halde
     iki yol zamanla ayrışıp bir kısmı güncel bir kısmı bayat kalırdı.
     Yalnız GERÇEKTEN DEĞİŞEN alanlar `updates` içinde gelir; boş obje veya
     eşleşme yoksa hiçbir şey yapılmaz. Kapalı kayıtlar da (v6.51'den beri
     düzenlenebilir oldukları için) senkronlanır; sahiplik kontrolü
     renameManufacturer ile tutarlı şekilde uygulanır. */
  const KOL_MODEL_FIELD_MAP=Object.freeze({modelKod:'modelCode',plmId:'plmId',urunTipi:'category',colour:'colour',season:'season',lisans:'license'});
  // kolFieldKey Koleksiyon'daki hücre anahtarıdır (ör. 'modelKod'); çağıran
  // taraf (app-main.js) quotation item şemasını (modelCode vb.) bilmek zorunda
  // kalmasın diye eşleme burada, tek yerde çözülür.
  function syncModelFields(rowId,kolFieldKey,value){
    const id=Number(rowId),itemField=KOL_MODEL_FIELD_MAP[kolFieldKey];
    if(!Number.isFinite(id)||!itemField)return;
    const next=qNorm(value);
    const affected=[];
    qLoad().requests.forEach(req=>{
      if(req.ownerId!==qCurrentUserId())return;
      let changed=false;
      req.items.forEach(item=>{
        if(item.rowId!==id)return;
        if(item[itemField]!==next){item[itemField]=next;changed=true;}
      });
      if(changed){req.updatedAt=qNow();affected.push(req);}
    });
    if(affected.length)qSave(affected);
  }

  function qMoveRequest(dragId,targetId,placeAfter=false){
    const st=qLoad(),drag=st.requests.find(r=>r.id===dragId),target=st.requests.find(r=>r.id===targetId);
    if(!drag||!target||drag.id===target.id||drag.source!==target.source)return false;
    if(!qCanEditRequest(drag)||!qCanEditRequest(target)){qViewOnlyNotice(drag);return false;}
    const source=drag.source,ordered=st.requests.filter(r=>r.source===source).sort((a,b)=>(Number(b.sortOrder)||0)-(Number(a.sortOrder)||0));
    const from=ordered.findIndex(r=>r.id===dragId);if(from<0)return false;
    ordered.splice(from,1);
    let to=ordered.findIndex(r=>r.id===targetId);if(to<0)return false;
    if(placeAfter)to+=1;
    const before=ordered[to-1],after=ordered[to];
    if(before&&after)drag.sortOrder=((Number(before.sortOrder)||0)+(Number(after.sortOrder)||0))/2;
    else if(before)drag.sortOrder=(Number(before.sortOrder)||0)-1;
    else if(after)drag.sortOrder=(Number(after.sortOrder)||0)+1;
    else drag.sortOrder=Date.now();
    drag.updatedAt=qNow();qSave(drag);return true;
  }

  async function qMergeRequest(dragId,targetId){
    const st=qLoad(),source=st.requests.find(r=>r.id===dragId),target=st.requests.find(r=>r.id===targetId);
    if(!source||!target||source.id===target.id||source.source!==target.source)return false;
    if(!qCanDeleteRequest(source)||!qCanDeleteRequest(target)){qViewOnlyNotice(source);return false;}
    // v6.51 — v6.47'de sunucu ve sürükleme (draggable) tarafı kapalı kayıtlara
    // açılmıştı ama BU istemci ön-kontrolü (drop sonrası, sunucuya istek
    // gitmeden önce) gözden kaçmıştı; kapalı kayıt sürüklenebiliyordu ama
    // bırakıldığında burada sessizce reddediliyordu. Artık kaldırıldı.
    const message=qLang(
      `“${qRequestTitle(source)}” kaydı “${qRequestTitle(target)}” kaydının içine birleştirilsin mi? Hedef kayıt korunacak, kaynak kayıt kaldırılacaktır.`,
      `Merge “${qRequestTitle(source)}” into “${qRequestTitle(target)}”? The target record will be kept and the source record removed.`
    );
    if(!confirm(message))return false;
    try{
      await qFlushSaves();
      const data=await qApi('/api/quotations/merge',{method:'POST',body:JSON.stringify({sourceId:source.id,targetId:target.id})});
      if(!data.request)throw new Error(qLang('Birleştirilmiş kayıt alınamadı.','The merged record was not returned.'));
      st.requests=st.requests.filter(item=>item.id!==data.removedId&&item.id!==data.request.id);
      st.requests.push(qNormalizeRequest(data.request));qTableStates.delete(data.removedId);qPersistLocal();
      qActiveId=data.request.id;
      if(typeof showToast==='function')showToast(qLang('Quotation kayıtları birleştirildi.','Quotation records were merged.'));
      return true;
    }catch(err){if(typeof showToast==='function')showToast(err?.message||qLang('Quotation kayıtları birleştirilemedi.','Quotation records could not be merged.'));return false;}
  }

  function qClearDragMarks(host){
    if(!host) return;
    host.querySelectorAll('.isDragging,.dropBefore,.dropAfter,.dropMerge').forEach(el=>{el.classList.remove('isDragging','dropBefore','dropAfter','dropMerge');el.setAttribute('aria-grabbed','false');});
  }

  async function qDeleteRequest(req){
    if(!req)return false;
    if(!qCanDeleteRequest(req)){qViewOnlyNotice(req);return false;}
    const msg=qLang('Bu fiyat çalışması yalnızca sizin görünümünüzden kaldırılacaktır. Diğer kullanıcıların kayıtları etkilenmez. Devam edilsin mi?','This quotation request will only be hidden from your view. Other users are not affected. Continue?');
    if(!confirm(msg))return false;
    try{await qApi(`/api/quotations/${encodeURIComponent(req.id)}`,{method:'DELETE'});}
    catch(err){if(typeof showToast==='function')showToast(err?.message||qLang('Quotation görünümden kaldırılamadı.','Quotation could not be hidden from your view.'));return false;}
    const st=qLoad();st.requests=st.requests.filter(item=>item.id!==req.id);qTableStates.delete(req.id);qPersistLocal();
    const search=document.getElementById('quotationSearch');
    qActiveId=qVisibleRequests(qActiveSource,search?.value||'')[0]?.id||qVisibleRequests(qActiveSource,'')[0]?.id||null;
    if(qWorkspaceMounted)qRenderWorkspaceAll(search?.value||'');else{qRenderNav(search?.value||'');qRenderDetail();}
    if(typeof showToast==='function')showToast(qLang('Fiyat çalışması görünümünüzden kaldırıldı.','Quotation request hidden from your view.'));
    return true;
  }

  function qPricingEngine(){ return window.BLPricingWorkspaceEngine||null; }
  function qRequestMatchesStatus(req,key=qStatusFilter){
    const engine=qPricingEngine();
    if(engine?.requestMatchesFilter)return engine.requestMatchesFilter(req,key);
    if(key==='all')return true;
    if(key==='active'||key==='in_progress')return req.status!=='closed';
    if(key==='closed')return req.status==='closed';
    return req.status!=='closed';
  }

  function qVisibleRequests(source,query=''){
    const terms=parseTableSearchTerms(query);
    return qLoad().requests.filter(req=>req.source===source).filter(req=>qRequestMatchesStatus(req)).filter(req=>{
      if(!terms.length)return true;
      const hay=[qRequestTitle(req),qDate(req.createdAt),qOwnerLabel(req),qStatusLabel(req.status),...req.items.flatMap(i=>[i.modelCode,i.plmId,i.orderCode,i.manufacturer,i.license,qItemCategory(req,i)])].join(' ').toLocaleLowerCase('tr-TR');
      return tableSearchMatches(hay,terms,{plainMode:'contains'});
    }).sort((a,b)=>(Number(b.sortOrder)||0)-(Number(a.sortOrder)||0)||String(b.createdAt).localeCompare(String(a.createdAt)));
  }

  function qActiveRequest(){
    const list=qVisibleRequests(qActiveSource,'');
    let req=list.find(r=>r.id===qActiveId);
    if(!req){req=list[0]||null;qActiveId=req?.id||null;}
    return req;
  }

  function qRenderStatusTabs(){
    const host=document.getElementById('quotationStatusTabs');if(!host)return;
    const sourceRows=qLoad().requests.filter(req=>req.source===qActiveSource);
    const keys=[...host.querySelectorAll('[data-quotation-status-filter]')].map(button=>button.dataset.quotationStatusFilter);
    const counts=Object.fromEntries(keys.map(key=>[key,sourceRows.filter(req=>qRequestMatchesStatus(req,key)).length]));
    host.querySelectorAll('[data-quotation-status-filter]').forEach(button=>{
      const key=button.dataset.quotationStatusFilter;
      button.classList.toggle('isActive',key===qStatusFilter);
      button.setAttribute('aria-pressed',key===qStatusFilter?'true':'false');
      const count=button.querySelector('[data-status-count]');if(count)count.textContent=String(counts[key]||0);
    });
  }

  function qRenderNav(query=''){
    const host=document.getElementById('quotationNav');if(!host)return;
    const list=qVisibleRequests(qActiveSource,query);
    const count=document.getElementById('quotationCount');if(count)count.textContent=qLang(`${list.length} kayıt`,`${list.length} records`);
    qRenderStatusTabs();
    if(!list.length){
      const empty=qStatusFilter==='closed'?qLang('Kapanmış quotation kaydı bulunmuyor.','No closed quotations.'):(qStatusFilter==='active'?qLang('Devam eden quotation kaydı bulunmuyor.','No quotations in progress.'):qLang('Henüz quotation kaydı yok.','No quotation records yet.'));
      host.innerHTML=`<div class="verHistEmpty">${qEsc(empty)}</div>`;return;
    }
    host.innerHTML=list.map(req=>{
      const active=req.id===qActiveId,canEdit=qCanEditRequest(req),contentCanEdit=canEdit;
      /* v6.47 — Sürükleyip BİRLEŞTİRME artık kapalı kayıtlarda da mümkün
         (kullanıcı kararı: "kapalı kayıt hem kaynak hem hedef olabilsin, tam
         serbest"). Bu, kapalı kaydın KENDİ İÇERİĞİNİ düzenleme iznini
         (contentCanEdit — fiyat girişi, onay kutusu) DEĞİŞTİRMEZ; yalnız
         sürükleme/birleştirme yetkisi ayrı tutulur ve sunucudaki
         canManageAccess ile aynı kurala (qCanManageAccess) bağlanır — statü
         kontrolü yoktur, çünkü merge artık statüden bağımsız. */
      const canDrag=qCanManageAccess(req);
      const mfr=req.manufacturers.map(m=>m.name).join(', '),owner=qOwnerLabel(req);
      return `<button type="button" draggable="${canDrag?'true':'false'}" aria-grabbed="false" class="verHistNavItem quotationNavItem${canDrag?' navSortableItem':''}${active?' isActive':''}${canEdit?'':' quotationViewOnly'}${req.status==='closed'?' isClosed':''}" data-quotation-id="${qEsc(req.id)}">
        <span class="verHistNavTop"><span class="quotationSourceBadge">${qEsc(qSourceLabel(req.source))}</span><span class="quotationStatusBadge ${req.status==='closed'?'isClosed':'isActive'}">${qEsc(qStatusLabel(req.status))}</span><span class="verHistNavDate">${qEsc(qDate(req.createdAt))}</span>${canDrag?'<span class="navDragGrip" aria-hidden="true">⋮⋮</span>':''}</span>
        <span class="quotationNavTitle">${qEsc(qWorkspaceMounted?qWorkspaceRequestTitle(req):(mfr||qLang('Üretici belirtilmedi','No manufacturer')))}</span>
        <span class="quotationNavMeta">${qEsc(qLang(`${qModelCount(req)} model · ${req.manufacturers.length} üretici · Sahibi: ${owner}`,`${qModelCount(req)} models · ${req.manufacturers.length} manufacturers · Owner: ${owner}`))}${canEdit?'':` · 🔒 ${qEsc(qLang('Yalnız görüntüleme','View only'))}`}</span>
      </button>`;
    }).join('');
  }

  function qTableState(req){
    let tableState=qTableStates.get(req.id);
    if(!tableState){
      tableState={sort:{key:'',dir:1},filters:{},view:{scrollTop:0,scrollLeft:0}};
      qTableStates.set(req.id,tableState);
    }
    return tableState;
  }

  function qLoadColumnWidths(){
    if(qColumnWidths) return qColumnWidths;
    let saved={};
    try{saved=JSON.parse(BLStorage.getItem(COLUMN_WIDTHS_KEY)||'{}')||{};}catch(e){}
    qColumnWidths={};
    Object.keys(qColumnDefaults).forEach(key=>{
      const value=Number(saved[key]);
      qColumnWidths[key]=Number.isFinite(value)
        ?Math.max(qColumnMinimums[key],Math.min(640,Math.round(value)))
        :qColumnDefaults[key];
    });
    return qColumnWidths;
  }
  function qSaveColumnWidths(){
    try{BLStorage.setItem(COLUMN_WIDTHS_KEY,JSON.stringify(qLoadColumnWidths()));return true;}catch(e){return false;}
  }
  function qColumnWidth(key){return qLoadColumnWidths()[key]||qColumnDefaults[key]||100;}
  function qColumnTotalWidth(){return qTableCols.reduce((sum,col)=>sum+qColumnWidth(col.key),0);}
  function qSetColumnWidth(key,value,save=false){
    if(!Object.prototype.hasOwnProperty.call(qColumnDefaults,key)) return qColumnWidth(key);
    const numeric=Number(value);
    const width=Math.max(qColumnMinimums[key],Math.min(640,Math.round(Number.isFinite(numeric)?numeric:qColumnDefaults[key])));
    qLoadColumnWidths()[key]=width;
    if(save)qSaveColumnWidths();
    return width;
  }

  const qTableCols=[
    {key:'model',tr:'Model',en:'Model',value:(_req,item)=>qNorm(item.modelCode||item.plmId||item.orderCode),sort:'text'},
    {key:'category',tr:'Kategori',en:'Category',value:(req,item)=>qItemCategory(req,item),sort:'text'},
    {key:'manufacturer',tr:'Üretici',en:'Manufacturer',value:(_req,item)=>qNorm(item.manufacturer),sort:'text'},
    {key:'target',tr:'Hedef Fiyat',en:'Target Price',value:(req,item)=>qValidPrice(qItemTargetPrice(req,item))?`$${qMoneyDisplay(qItemTargetPrice(req,item))}`:'',number:(item,req)=>qMoneyNumber(qItemTargetPrice(req,item)),sort:'number',align:'right'},
    {key:'best',tr:'En İyi Fiyat / Üretici',en:'Best Price / Mfr',value:(req,item)=>{const best=qBestForModel(req,item);return best?`$${qMoneyDisplay(best.price)} · ${best.manufacturer}`:'';},number:(item,req)=>qBestForModel(req,item)?.price,sort:'number',align:'right'},
    {key:'price',tr:'Teklif Fiyatı',en:'Quotation Price',value:(req,item)=>{const price=qValidPrice(item.price)?`$${qMoneyDisplay(item.price)}`:qNorm(item.price),delta=qTargetDelta(qItemTargetPrice(req,item),item.price);return delta?`${delta.text} ${price}`:price;},number:item=>qMoneyNumber(item.price),sort:'number',align:'right'},
    {key:'approved',tr:'Onay',en:'Approval',value:(_req,item)=>item.approved?qLang('Onaylı','Approved'):qLang('Onaysız','Not approved'),number:item=>item.approved?1:0,sort:'number',align:'center'},
    {key:'dropped',tr:'Drop',en:'Drop',value:(req,item)=>req.source==='collection'?(qItemDropped(req,item)?qLang('Drop','Dropped'):qLang('Aktif','Active')):'—',number:(item,req)=>qItemDropped(req,item)?1:0,sort:'number',align:'center'},
  ];
  function qTableCol(key){ return qTableCols.find(col=>col.key===key); }
  function qFilterValue(req,item,key){ const col=qTableCol(key); return col?qNorm(col.value(req,item)):''; }
  function qRowsPassingFilters(req,excludeKey=''){
    const tableState=qTableState(req);
    return req.items.filter(item=>Object.entries(tableState.filters).every(([key,values])=>key===excludeKey||!values||values.has(qFilterValue(req,item,key))));
  }
  function qVisibleTableItems(req){
    const tableState=qTableState(req);
    const rows=qRowsPassingFilters(req).map((item,index)=>({item,index}));
    const col=qTableCol(tableState.sort.key);
    if(col){
      rows.sort((a,b)=>{
        let comparison=0;
        if(col.sort==='number'){
          const av=col.number(a.item,req),bv=col.number(b.item,req),aValid=Number.isFinite(av),bValid=Number.isFinite(bv);
          if(aValid&&bValid) comparison=av-bv;
          else if(aValid) comparison=-1;
          else if(bValid) comparison=1;
        }else{
          comparison=qFilterValue(req,a.item,col.key).localeCompare(qFilterValue(req,b.item,col.key),'tr',{numeric:true,sensitivity:'base'});
        }
        return comparison?comparison*tableState.sort.dir:a.index-b.index;
      });
    }
    return rows.map(row=>row.item);
  }
  function qCloseTableFilter(){
    if(qTableFilterPanel){qTableFilterPanel.remove();qTableFilterPanel=null;}
    if(qTableFilterDocHandler){document.removeEventListener('mousedown',qTableFilterDocHandler,true);qTableFilterDocHandler=null;}
  }
  function qSortTable(req,key,dir){
    const tableState=qTableState(req);
    tableState.sort=dir?{key,dir}:tableState.sort.key===key?{key,dir:tableState.sort.dir*-1}:{key,dir:1};
    qCloseTableFilter(); qRenderDetail();
  }
  function qOpenTableFilter(req,key,anchor){
    qCloseTableFilter();
    if(typeof closeHeaderFilter==='function') closeHeaderFilter();
    const col=qTableCol(key); if(!col) return;
    const tableState=qTableState(req), universe=qRowsPassingFilters(req,key);
    const values=[...new Set(universe.map(item=>qFilterValue(req,item,key)))].sort((a,b)=>a.localeCompare(b,'tr',{numeric:true,sensitivity:'base'}));
    const current=tableState.filters[key];
    const panel=document.createElement('div'); panel.className='colFilterPanel quotationColFilterPanel';
    const rect=anchor.getBoundingClientRect();
    panel.style.left=Math.max(6,Math.min(window.innerWidth-306,rect.right-286))+'px';
    panel.style.top=Math.max(6,Math.min(window.innerHeight-370,rect.bottom+4))+'px';
    panel.innerHTML=`<div class="cfpSortBar"><button type="button" class="cfpSortBtn" data-qdir="1">${qEsc(qLang('A→Z Sırala','Sort A→Z'))}</button><button type="button" class="cfpSortBtn" data-qdir="-1">${qEsc(qLang('Z→A Sırala','Sort Z→A'))}</button></div>
      <input type="text" class="cfpSearch" placeholder="${qEsc(qLang('Ara…','Search…'))}">
      <div class="cfpHeader"><button type="button" class="cfpAll" data-v="all">${qEsc(qLang('Tümü','All'))}</button><button type="button" class="cfpAll" data-v="none">${qEsc(qLang('Temizle','Clear'))}</button></div>
      <div class="cfpList">${values.map(value=>{const checked=!current||current.has(value),display=value||qLang('(boş)','(blank)');return `<label class="cfpItem" data-txt="${qEsc(display.toLocaleLowerCase('tr-TR'))}"><input type="checkbox" value="${qEsc(value)}" ${checked?'checked':''}> ${value?qEsc(value):`<i>${qEsc(display)}</i>`}</label>`;}).join('')}</div>
      <div class="cfpApplyRow"><button type="button" class="cfpApplySelection">${qEsc(qLang('Uygula','Apply'))}</button><button type="button" class="cfpAddSelection">${qEsc(qLang('Geçerli Seçime Ekle','Add to Current'))}</button><button type="button" class="numFilterClear cfpRemoveSelection">${qEsc(qLang('Filtreyi Kaldır','Remove Filter'))}</button></div>`;
    document.body.appendChild(panel); qTableFilterPanel=panel;
    const visibleBoxes=()=>[...panel.querySelectorAll('.cfpItem')].filter(item=>item.style.display!=='none').map(item=>item.querySelector('input'));
    panel.querySelectorAll('.cfpSortBtn').forEach(btn=>btn.addEventListener('click',()=>qSortTable(req,key,Number(btn.dataset.qdir)||1)));
    panel.querySelectorAll('.cfpAll').forEach(btn=>btn.addEventListener('click',()=>visibleBoxes().forEach(box=>box.checked=btn.dataset.v==='all')));
    const search=panel.querySelector('.cfpSearch');
    search.addEventListener('input',()=>{const terms=parseTableSearchTerms(search.value);panel.querySelectorAll('.cfpItem').forEach(item=>item.style.display=tableSearchMatches(item.dataset.txt,terms,{plainMode:'contains'})?'':'none');});
    const apply=add=>{
      const chosen=visibleBoxes().filter(box=>box.checked).map(box=>box.value);
      const next=new Set(add?[...(tableState.filters[key]||[]),...chosen]:chosen);
      if(next.size===values.length&&values.every(value=>next.has(value))) delete tableState.filters[key];
      else tableState.filters[key]=next;
      qCloseTableFilter(); qRenderDetail();
    };
    panel.querySelector('.cfpApplySelection').addEventListener('click',()=>apply(false));
    panel.querySelector('.cfpAddSelection').addEventListener('click',()=>apply(true));
    panel.querySelector('.cfpRemoveSelection').addEventListener('click',()=>{delete tableState.filters[key];qCloseTableFilter();qRenderDetail();});
    search.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();apply(false);}});
    qTableFilterDocHandler=event=>{if(qTableFilterPanel&&!qTableFilterPanel.contains(event.target)&&event.target!==anchor)qCloseTableFilter();};
    setTimeout(()=>document.addEventListener('mousedown',qTableFilterDocHandler,true),0);
    setTimeout(()=>search.focus(),0);
  }

  function qDeltaClass(delta){return delta?(delta.meetsTarget?'isAtOrBelowTarget':'isAboveTarget'):'isEmpty';}
  function qPriceDeltaMarkup(req,item){
    const delta=qTargetDelta(qItemTargetPrice(req,item),item?.price);
    const title=delta?qLang(`Target Price farkı: ${delta.text}`,`Difference from Target Price: ${delta.text}`):'';
    return `<span class="quotationPriceDelta ${qDeltaClass(delta)}" title="${qEsc(title)}">${delta?qEsc(delta.text):''}</span>`;
  }
  function qBestMarkup(req,item){
    const best=qBestForModel(req,item);
    if(!best)return '<span class="quotationBestEmpty">—</span>';
    return `<span class="quotationBestPrice">$${qEsc(qMoneyDisplay(best.price))}</span><span class="quotationBestManufacturer" title="${qEsc(best.manufacturer)}">${qEsc(best.manufacturer)}</span>`;
  }
  function qUpdateModelPricingCells(req,modelKey,table){
    if(!req||!modelKey||!table||typeof table.querySelectorAll!=='function')return;
    const byId=new Map(req.items.map(item=>[item.id,item]));
    table.querySelectorAll('[data-quote-line]').forEach(row=>{
      const item=byId.get(row.dataset.quoteLine);if(!item||item.modelKey!==modelKey)return;
      const bestCell=row.querySelector('[data-quote-best]');if(bestCell)bestCell.innerHTML=qBestMarkup(req,item);
      const delta=qTargetDelta(qItemTargetPrice(req,item),item.price),deltaEl=row.querySelector('.quotationPriceDelta');
      if(deltaEl){
        deltaEl.textContent=delta?delta.text:'';
        deltaEl.classList.remove('isAtOrBelowTarget','isAboveTarget','isEmpty');
        deltaEl.classList.add(qDeltaClass(delta));
        deltaEl.title=delta?qLang(`Target Price farkı: ${delta.text}`,`Difference from Target Price: ${delta.text}`):'';
      }
    });
  }

  async function qChangeStatus(req,status){
    if(!req||!qCanEditRequest(req)){qViewOnlyNotice(req);return false;}
    const next=status==='closed'?'closed':'active';
    // Hücreden ayrılma olayı tarayıcı/odak sırasına göre gecikebilir. Durum
    // değişikliğinden önce ekrandaki aktif fiyatı açıkça commit et ve tüm fiyat/
    // onay/drop kayıtlarının sunucuya ulaşmasını bekle. Kapatma yalnız quotation
    // listesindeki takip durumunu değiştirir; Koleksiyon ve Pricing History verisini
    // silmez, sıfırlamaz veya yeniden hesaplamaz.
    qCommitActivePriceInput(req,document.getElementById('quotationModal'));
    await qFlushSaves();
    try{
      const data=await qApi(`/api/quotations/${encodeURIComponent(req.id)}/status`,{method:'PATCH',body:JSON.stringify({status:next})});
      const saved=qReplaceRequest(data.request||{...req,status:next,closedAt:next==='closed'?qNow():''});
      const search=document.getElementById('quotationSearch');
      if(qStatusFilter!=='all'&&!qRequestMatchesStatus(saved,qStatusFilter))qActiveId=qVisibleRequests(qActiveSource,search?.value||'')[0]?.id||null;
      if(qWorkspaceMounted)qRenderWorkspaceAll(search?.value||'');else{qRenderNav(search?.value||'');qRenderDetail();}
      if(typeof showToast==='function')showToast(next==='closed'?qLang('Quotation yalnız takip listesinde kapatıldı; fiyat geçmişi ve Koleksiyon verileri korunur.','Quotation was closed only in the tracking list; Pricing History and Collection data are retained.'):qLang('Quotation yeniden devam ediyor durumuna alındı.','Quotation reopened.'));
      return true;
    }catch(err){if(typeof showToast==='function')showToast(err?.message||qLang('Quotation durumu değiştirilemedi.','Quotation status could not be changed.'));return false;}
  }

  function qOpenAccessModal(req){
    if(!req||!qCanManageAccess(req)){qViewOnlyNotice(req);return;}
    document.getElementById('quotationAccessModal')?.remove();
    const candidates=qProfiles.filter(profile=>profile.id&&profile.id!==req.ownerId);
    const overlay=document.createElement('div');overlay.id='quotationAccessModal';overlay.className='warnOverlay quotationAccessOverlay';
    const rows=candidates.map(profile=>`<label class="quotationAccessUser" data-access-user-row data-search="${qEsc(`${profile.displayName||''} ${profile.username||''}`.toLocaleLowerCase('tr-TR'))}"><input type="checkbox" value="${qEsc(profile.id)}" ${req.editorIds.includes(profile.id)?'checked':''}><span class="quotationAccessAvatar">${qEsc(String(profile.displayName||profile.username||'?').trim().split(/\s+/).slice(0,2).map(v=>v[0]).join('').toLocaleUpperCase('tr-TR'))}</span><span><strong>${qEsc(profile.displayName||profile.username||profile.id)}</strong><small>${qEsc(profile.username||profile.role||'')}</small></span></label>`).join('');
    overlay.innerHTML=`<div class="modalCard quotationAccessCard" role="dialog" aria-modal="true" aria-labelledby="quotationAccessTitle">
      <div class="verHistTop"><div><h2 id="quotationAccessTitle">${qEsc(qLang('Düzenleme Yetkisi','Editing Permission'))}</h2><p class="verHistSub">${qEsc(qLang(`Kayıt sahibi: ${qOwnerLabel(req)}. Seçilen kullanıcılar bu quotation içeriğini düzenleyebilir.`,`Owner: ${qOwnerLabel(req)}. Selected users can edit this quotation.`))}</p></div><button type="button" class="verHistClose" data-access-close><svg class="ic"><use href="#i-x"/></svg></button></div>
      <div class="quotationAccessTools"><input type="search" data-access-search placeholder="${qEsc(qLang('Kullanıcı ara…','Search users…'))}" autocomplete="off"><button type="button" class="tbtn" data-access-clear>${qEsc(qLang('Tümünü kaldır','Clear all'))}</button></div>
      <div class="quotationAccessList">${rows||`<div class="verHistEmpty">${qEsc(qLang('Yetki verilebilecek başka kullanıcı yok.','No other users are available.'))}</div>`}</div>
      <div class="verHistFoot"><button type="button" class="tbtn" data-access-close>${qEsc(qLang('Vazgeç','Cancel'))}</button><span style="flex:1"></span><button type="button" class="tbtn primary" data-access-save>${qEsc(qLang('Yetkileri Kaydet','Save Permissions'))}</button></div>
    </div>`;
    document.body.appendChild(overlay);
    const close=()=>overlay.remove();
    overlay.querySelectorAll('[data-access-close]').forEach(button=>button.addEventListener('click',close));
    overlay.addEventListener('click',event=>{if(event.target===overlay)close();});
    overlay.querySelector('[data-access-clear]')?.addEventListener('click',()=>overlay.querySelectorAll('input[type="checkbox"]').forEach(input=>{input.checked=false;}));
    overlay.querySelector('[data-access-search]')?.addEventListener('input',event=>{const value=qNorm(event.target.value).toLocaleLowerCase('tr-TR');overlay.querySelectorAll('[data-access-user-row]').forEach(row=>{row.hidden=Boolean(value&&!row.dataset.search.includes(value));});});
    overlay.querySelector('[data-access-save]')?.addEventListener('click',async event=>{
      const button=event.currentTarget,editorIds=[...overlay.querySelectorAll('input[type="checkbox"]:checked')].map(input=>input.value);
      button.disabled=true;
      try{
        const data=await qApi(`/api/quotations/${encodeURIComponent(req.id)}/editors`,{method:'PATCH',body:JSON.stringify({editorIds})});
        qReplaceRequest(data.request||{...req,editorIds});close();
        const search=document.getElementById('quotationSearch');if(qWorkspaceMounted)qRenderWorkspaceAll(search?.value||'');else{qRenderNav(search?.value||'');qRenderDetail();}
        if(typeof showToast==='function')showToast(qLang('Quotation düzenleme yetkileri güncellendi.','Quotation editing permissions updated.'));
      }catch(err){button.disabled=false;if(typeof showToast==='function')showToast(err?.message||qLang('Yetkiler kaydedilemedi.','Permissions could not be saved.'));}
    });
    setTimeout(()=>overlay.querySelector('[data-access-search]')?.focus(),0);
  }

  function qOpenQuotationNote(req){
    if(!req)return;
    document.getElementById('quotationNoteModal')?.remove();
    const editable=qCanEditRequest(req);
    const overlay=document.createElement('div');
    overlay.id='quotationNoteModal';
    overlay.className='warnOverlay quotationNoteOverlay';
    overlay.innerHTML=`<div class="modalCard quotationNoteCard" role="dialog" aria-modal="true" aria-labelledby="quotationNoteTitle">
      <div class="verHistTop"><div><h2 id="quotationNoteTitle">${qEsc(qLang('Quotation Notu','Quotation Note'))}</h2><p class="verHistSub">${qEsc(qRequestTitle(req))}</p></div><button type="button" class="verHistClose" data-qnote-close aria-label="${qEsc(qLang('Kapat','Close'))}"><svg class="ic"><use href="#i-x"/></svg></button></div>
      <div class="quotationNoteBody">
        <textarea class="noteEditorArea quotationNoteArea" data-qnote-area maxlength="10000" placeholder="${qEsc(qLang('Quotation bazlı notunuzu yazın…','Write a note for this quotation…'))}" ${editable?'':'readonly'}>${qEsc(req.note||'')}</textarea>
        <div class="quotationNoteCount"><span data-qnote-count>${qNorm(req.note).length}</span> / 10000</div>
      </div>
      <div class="verHistFoot"><button type="button" class="tbtn" data-qnote-close>${qEsc(qLang('Kapat','Close'))}</button><span style="flex:1"></span>${editable?`<button type="button" class="tbtn primary" data-qnote-save>${qEsc(qLang('Notu Kaydet','Save Note'))}</button>`:''}</div>
    </div>`;
    document.body.appendChild(overlay);
    const area=overlay.querySelector('[data-qnote-area]');
    const close=()=>overlay.remove();
    overlay.querySelectorAll('[data-qnote-close]').forEach(btn=>btn.addEventListener('click',close));
    overlay.addEventListener('click',event=>{if(event.target===overlay)close();});
    area?.addEventListener('input',()=>{const count=overlay.querySelector('[data-qnote-count]');if(count)count.textContent=String(area.value.length);});
    overlay.querySelector('[data-qnote-save]')?.addEventListener('click',event=>{
      const button=event.currentTarget;
      button.disabled=true;
      req.note=qNorm(area?.value).slice(0,10000);
      req.updatedAt=qNow();
      qSave(req);
      close();if(qWorkspaceMounted)qRenderWorkspaceAll(document.getElementById('quotationSearch')?.value||'');else qRenderDetail();
      if(typeof showToast==='function')showToast(qLang('Quotation notu kaydedildi.','Quotation note saved.'));
    });
    setTimeout(()=>area?.focus(),0);
  }

  function qRenderDetail(){
    qCloseTableFilter();
    const host=document.getElementById('quotationDetail'); if(!host) return;
    const previousWrap=host.querySelector('.quotationTableWrap');
    const previousRequestId=qNorm(host.dataset.quotationRequestId);
    if(previousWrap&&previousRequestId){
      const previousReq=qLoad().requests.find(item=>item.id===previousRequestId);
      if(previousReq){
        const previousState=qTableState(previousReq);
        previousState.view={scrollTop:previousWrap.scrollTop,scrollLeft:previousWrap.scrollLeft};
      }
    }
    const req=qActiveRequest();
    if(!req){delete host.dataset.quotationRequestId;host.innerHTML=`<div class="quotationEmpty">${qEsc(qLang('Sol panelden bir fiyat çalışması seç.','Select a quotation request from the left panel.'))}</div>`;return;}
    host.dataset.quotationRequestId=req.id;
    const tableState=qTableState(req), visibleItems=qVisibleTableItems(req);
    const supplierCount=new Set(req.items.map(item=>item.manufacturer)).size;
    const approvedCount=new Set(req.items.filter(item=>item.approved).map(item=>item.modelKey)).size;
    const requestCanEdit=qCanEditRequest(req),contentCanEdit=requestCanEdit,canManageAccess=qCanManageAccess(req),canDelete=qCanDeleteRequest(req);
    const rows=visibleItems.map(item=>{
      const lineCanEdit=qCanEditLine(req,item);
      const targetValue=qItemTargetPrice(req,item),target=qValidPrice(targetValue)?`$${qMoneyDisplay(targetValue)}`:'—';
      const fabric=qItemFabric(req,item)||'—';
      const category=qItemCategory(req,item)||'—';
      const collectionRow=req.source==='collection'?qFindCollectionRow(item):null;
      const dropped=qItemDropped(req,item);
      const modelImage=qCollectionImageSrc(collectionRow,item);
      const imageHtml=req.source==='collection'?qCachedModelThumb(modelImage,{modelId:item.plmId||item.modelCode,plmId:item.plmId||collectionRow?.plmId||'',modelName:item.modelCode||collectionRow?.modelKod||'',colourCode:collectionRow?.colourCode||'',colour:collectionRow?.colour||'',classes:'quotationModelThumb'}):'';
      return `<tr data-quote-line="${qEsc(item.id)}" class="${dropped?'quotationDroppedLine ':''}${lineCanEdit?'':'rowViewOnly'}">
        <td><div class="quotationModelCell">${imageHtml}<div class="quotationModelText"><div class="quotationModelName">${qEsc(item.modelCode||item.plmId||item.orderCode||'—')}</div><div class="quotationModelMeta" title="${qEsc(fabric)}">${qEsc(fabric)}</div></div></div></td>
        <td><span class="quotationCategory" title="${qEsc(category)}">${qEsc(category)}</span></td>
        <td><span class="quotationManufacturer" title="${qEsc(item.manufacturer)}">${qEsc(item.manufacturer)}</span></td>
        <td class="quotationMoney">${qEsc(target)}</td>
        <td class="quotationBestCell" data-quote-best="${qEsc(item.modelKey)}">${qBestMarkup(req,item)}</td>
        <td class="quotationMoney${lineCanEdit?'':' viewOnlyCell'}"><div class="quotationPriceEditor">${qPriceDeltaMarkup(req,item)}<input type="text" inputmode="decimal" class="quotationPriceInput" data-quote-price="${qEsc(item.id)}" value="${qEsc(qValidPrice(item.price)?qMoneyDisplay(item.price):item.price)}" placeholder="0.00" aria-label="${qEsc(qLang('Teklif fiyatı','Quotation price'))}" ${lineCanEdit?'':'disabled title="'+qEsc(qLang('Yalnız görüntüleme','View only'))+'"'}></div></td>
        <td style="text-align:center;"><button type="button" class="quotationApproveBtn${item.approved?' isApproved':''}" data-quote-approve="${qEsc(item.id)}" aria-pressed="${item.approved?'true':'false'}" ${lineCanEdit?'':'disabled'} title="${qEsc(item.approved?qLang('Onayı kaldır','Remove approval'):qLang('Bu üreticiyi ve fiyatı onayla','Approve this manufacturer and price'))}">✓</button></td>
        <td style="text-align:center;">${req.source==='collection'?`<button type="button" class="quotationDropBtn${dropped?' isDropped':''}" data-quote-drop="${qEsc(item.id)}" aria-pressed="${dropped?'true':'false'}" ${lineCanEdit?'':'disabled'} title="${qEsc(lineCanEdit?(dropped?qLang('Drop işaretini kaldır','Remove Drop mark'):qLang('Bu quotation içindeki modeli Drop olarak işaretle','Mark the model as Drop in this quotation')):qLang('Yalnız görüntüleme','View only'))}"><span aria-hidden="true">✓</span> Drop</button>`:'<span class="quotationDropUnavailable">—</span>'}</td>
      </tr>`;
    }).join('');
    const headers=qTableCols.map(col=>{
      const filtered=!!tableState.filters[col.key], sorted=tableState.sort.key===col.key, arrow=sorted?(tableState.sort.dir===1?'▲':'▼'):'';
      return `<th data-qcol="${qEsc(col.key)}" class="${filtered?'columnFilterActive':''}" style="${col.align?`text-align:${col.align};`:''}"><div class="thInner"><button type="button" class="quotationSortLabel thLabel" data-qsort="${qEsc(col.key)}">${qEsc(qLang(col.tr,col.en))}<span class="arrow">${arrow}</span></button><button type="button" class="thFilterBtn quotationFilterBtn${filtered?' filterActive':''}" data-qfilter="${qEsc(col.key)}" title="${qEsc(qLang('Filtrele','Filter'))}">▾</button></div><span class="quotationColResize" data-qresize="${qEsc(col.key)}" role="separator" aria-orientation="vertical" title="${qEsc(qLang('Sütun genişliğini ayarla; çift tıklayarak sıfırla','Resize column; double-click to reset'))}"></span></th>`;
    }).join('');
    const columnGroup=qTableCols.map(col=>`<col data-qcol-width="${qEsc(col.key)}" style="width:${qColumnWidth(col.key)}px">`).join('');
    const tableWidth=qColumnTotalWidth();
    const activeFilterCount=Object.keys(tableState.filters).length;
    const editorNames=qEditorNames(req),permissionText=editorNames.length
      ?qLang(`Düzenleyebilir: ${editorNames.join(', ')}`,`Can edit: ${editorNames.join(', ')}`)
      :qLang('Başka kullanıcıya düzenleme yetkisi verilmedi.','No other user has editing permission.');
    const statusControl=requestCanEdit
      ?`<label class="quotationStatusControl"><span>${qEsc(qLang('Durum','Status'))}</span><select data-quotation-status><option value="active" ${req.status!=='closed'?'selected':''}>${qEsc(qLang('Devam ediyor','In progress'))}</option><option value="closed" ${req.status==='closed'?'selected':''}>${qEsc(qLang('Kapandı','Closed'))}</option></select></label>`
      :`<span class="quotationStatusBadge ${req.status==='closed'?'isClosed':'isActive'}">${qEsc(qStatusLabel(req.status))}</span>`;
    const noteValue=qNorm(req.note),notePreview=noteValue.replace(/\s+/g,' ').slice(0,180);
    const noteLabel=notePreview||qLang('Quotation notu ekle…','Add quotation note…');
    const reminderItems=qReminderItems(req),reminderManufacturers=qReminderRecipients(req,reminderItems).length;
    const reminderDisabled=!requestCanEdit||req.status==='closed'||reminderManufacturers===0;
    const reopenDraftOwner=req.origin!=='manual-collection'&&req.ownerId===qCurrentUserId();
    const reopenDraftCount=reopenDraftOwner?Number(window.BLPrepareEmail?.pricingDraftCount?.(req.id)||0):0;
    const reopenDraftAction=reopenDraftOwner?`<button type="button" class="tbtn quotationReopenDraftBtn" data-q-reopen-draft ${reopenDraftCount?'':'disabled'} title="${qEsc(reopenDraftCount?qLang('Bu fiyat talebinin e-posta taslağını yeniden aç','Re-open the e-mail draft for this pricing request'):qLang('Yeniden açılabilir taslak yok veya retry süresi doldu','No reopenable draft is available or the retry window has expired'))}"><svg class="ic"><use href="#i-mail"/></svg>${qEsc(qLang('Taslak E-Postayı Yeniden Aç','Re-open Draft E-Mail'))}${reopenDraftCount>1?` <span class="quotationActionCount">${reopenDraftCount}</span>`:''}</button>`:'';
    const plmSyncAction=req.source==='collection'&&window.BLDetailImages?.modelImagesButtonHtml?window.BLDetailImages.modelImagesButtonHtml('quotationDetailPlmSync'):'';
    const workspaceActions=qWorkspaceMounted&&req.source==='collection'?`<button type="button" class="tbtn quotationReminderBtn" data-q-send-reminder ${reminderDisabled?'disabled':''} title="${qEsc(reminderManufacturers?qLang(`${reminderManufacturers} üreticiden fiyat bekleniyor`,`${reminderManufacturers} manufacturer(s) are awaiting quotation`):qLang('Fiyatı beklenen üretici yok','No manufacturer is awaiting quotation'))}"><svg class="ic"><use href="#i-mail"/></svg>${qEsc(qLang('Hatırlatma Gönder','Send Reminder'))}${reminderManufacturers?` <span class="quotationActionCount">${reminderManufacturers}</span>`:''}</button><button type="button" class="tbtn" data-q-open-collection><svg class="ic"><use href="#i-hanger"/></svg>${qEsc(qLang('Koleksiyonda Aç','Open in Collection'))}</button><button type="button" class="tbtn" data-q-open-history><svg class="ic"><use href="#i-chart-histogram"/></svg>${qEsc(qLang('Fiyat Geçmişi','Pricing History'))}</button>`:'';
    host.innerHTML=`<div class="quotationDetailHead">
        <div class="quotationDetailIdentity"><div class="quotationTitleLine"><h3>${qEsc(qRequestTitle(req))}</h3>${statusControl}</div><p>${qEsc(qDate(req.createdAt))} · ${qEsc(req.manufacturers.map(m=>m.name).join(', '))}</p><p class="quotationOwnership"><strong>${qEsc(qLang('Kayıt sahibi','Owner'))}:</strong> ${qEsc(qOwnerLabel(req))} · ${qEsc(permissionText)}</p></div>
        <div class="quotationHeadActions"><div class="quotationSummary"><span class="quotationSummaryChip">${qEsc(qLang(`${qModelCount(req)} model`,`${qModelCount(req)} models`))}</span><span class="quotationSummaryChip">${qEsc(qLang(`${supplierCount} üretici`,`${supplierCount} manufacturers`))}</span><span class="quotationSummaryChip">${qEsc(qLang(`${approvedCount} onay`,`${approvedCount} approvals`))}</span>${visibleItems.length!==req.items.length?`<span class="quotationSummaryChip">${qEsc(qLang(`${visibleItems.length}/${req.items.length} satır`,`${visibleItems.length}/${req.items.length} rows`))}</span>`:''}</div>${reopenDraftAction}${plmSyncAction}${workspaceActions}${canManageAccess?`<button type="button" class="tbtn quotationAccessBtn" data-manage-quotation-access title="${qEsc(qLang('Bu quotation için düzenleme yetkisi ver','Grant editing permission for this quotation'))}"><svg class="ic"><use href="#i-users-group"/></svg>${qEsc(qLang('Düzenleme Yetkisi','Editing Permission'))}</button>`:''}<button type="button" class="tbtn quotationExportBtn" data-export-quotation="${qEsc(req.id)}" title="${qEsc(qLang('Bu fiyat çalışmasını Excel’e aktar','Export this quotation request to Excel'))}"><svg class="ic"><use href="#i-file-export"/></svg>${qEsc(qLang('Excel’e Aktar','Export to Excel'))}</button>${activeFilterCount?`<button type="button" class="tbtn quotationClearFilters" title="${qEsc(qLang('Tüm tablo filtrelerini kaldır','Remove all table filters'))}">${qEsc(qLang('Filtreleri Temizle','Clear Filters'))}</button>`:''}<button type="button" class="todoDeleteBtn quotationDeleteBtn" data-delete-quotation="${qEsc(req.id)}" ${canDelete?'':'disabled'} title="${qEsc(canDelete?qLang('Fiyat çalışmasını sil','Delete quotation request'):qLang('Yalnız kayıt sahibi silebilir','Only the owner can delete'))}" aria-label="${qEsc(qLang('Fiyat çalışmasını sil','Delete quotation request'))}"><svg class="ic"><use href="#i-trash"/></svg></button></div>
      </div>
      <div class="quotationMetaStrip">
        <button type="button" class="quotationNoteTrigger${noteValue?' hasValue':''}" data-quotation-note title="${qEsc(qLang('Quotation notunu aç','Open quotation note'))}">
          <svg class="ic"><use href="#i-notebook"/></svg><span>${qEsc(qLang('Not','Note'))}</span><em>${qEsc(noteLabel)}</em>
        </button>
        <label class="quotationCapacityToggle${req.capacityConfirmed?' isConfirmed':''}" title="${qEsc(qLang('Bu quotation için üretim kapasitesi teyit edildi','Production capacity is confirmed for this quotation'))}">
          <input type="checkbox" data-quotation-capacity ${req.capacityConfirmed?'checked':''} ${contentCanEdit?'':'disabled'}>
          <span aria-hidden="true">✓</span><b>Capacity Confirmed</b>
        </label>
      </div>
      <div class="quotationTableWrap"><table class="quotationTable" style="width:${tableWidth}px;min-width:${tableWidth}px"><colgroup>${columnGroup}</colgroup><thead><tr>${headers}</tr></thead><tbody>${rows||`<tr><td colspan="${qTableCols.length}"><div class="quotationFilteredEmpty">${qEsc(qLang('Seçili filtrelere uyan satır yok.','No rows match the selected filters.'))}</div></td></tr>`}</tbody></table></div>
      ${(!requestCanEdit?`<div class="quotationCpNotice">${qEsc(qLang(`Bu kayıt ${qOwnerLabel(req)} tarafından oluşturuldu. Görüntüleyebilirsiniz; düzenleme için kayıt sahibinin yetki vermesi gerekir.`,`This record was created by ${qOwnerLabel(req)}. You can view it; the owner must grant editing permission.`))}</div>`:(req.source==='cp'?`<div class="quotationCpNotice">${qEsc(qLang('CP quotation kayıtları takip amaçlıdır. Buradaki fiyat ve onay değişiklikleri CP tablosuna geri aktarılmaz.','CP quotations are for tracking. Price and approval changes here are not written back to the CP table.'))}</div>`:''))}`;
    qBindDetail(req);
    if(req.source==='collection'){
      window.BLDetailImages?.bindModelImagesButton?.('quotationDetailPlmSync');
      window.BLDetailImages?.registerScope?.(host,{contextType:'quotations-detail',label:qLang('Quotation Detayı','Quotation Detail'),identities:visibleItems.map((item,index)=>{const row=qFindCollectionRow(item);return {plmId:item.plmId||row?.plmId||'',styleName:item.modelCode||row?.modelKod||'',colourCode:row?.colourCode||'',colour:row?.colour||'',rowId:item.id||String(index),hasImage:null};}),repaint:qRenderDetail});
    }
    if(qWorkspaceMounted)qRenderWorkspaceDecision(req,visibleItems);
    const wrap=host.querySelector('.quotationTableWrap');
    if(wrap){
      const view=tableState.view||{scrollTop:0,scrollLeft:0};
      wrap.scrollTop=Number(view.scrollTop)||0;
      wrap.scrollLeft=Number(view.scrollLeft)||0;
      wrap.addEventListener('scroll',()=>{tableState.view={scrollTop:wrap.scrollTop,scrollLeft:wrap.scrollLeft};},{passive:true});
    }
  }

  function qApplyPrice(req,line,inputValue){
    let value=qNorm(inputValue);
    if(value){const n=qMoneyNumber(value);if(Number.isFinite(n)) value=qMoneyDisplay(n);}
    line.price=value;
    if(!qValidPrice(value)) line.approved=false;
    req.updatedAt=qNow();
    if(req.source==='collection') qWritePriceToCollection(req,line);
    qSave(req);qRefreshCollection();
    return value;
  }

  function qCommitPriceInput(req,input,options={}){
    if(!req||!input)return false;
    const line=req.items.find(item=>item.id===input.dataset.quotePrice);if(!line)return false;
    if(!qCanEditLine(req,line)){qViewOnlyNotice(req);return false;}
    const raw=qNorm(input.value),last=qNorm(input.dataset.lastCommitted);
    if(!options.force && raw===last){
      input.dataset.dirty='0';
      return false;
    }
    const value=qApplyPrice(req,line,input.value);
    input.value=value;
    input.dataset.lastCommitted=value;
    input.dataset.dirty='0';
    const row=input.closest('[data-quote-line]');
    const approve=row?.querySelector('[data-quote-approve]');
    if(approve){
      approve.classList.toggle('isApproved',!!line.approved);
      approve.setAttribute('aria-pressed',line.approved?'true':'false');
      approve.title=line.approved?qLang('Onayı kaldır','Remove approval'):qLang('Bu üreticiyi ve fiyatı onayla','Approve this manufacturer and price');
    }
    const table=input.closest?.('table.quotationTable');
    qUpdateModelPricingCells(req,line.modelKey,table);
    if(qWorkspaceMounted){
      const kpi=document.getElementById('quotationWorkspaceKpis');if(kpi)kpi.innerHTML=qWorkspaceKpiMarkup();qRenderStatusTabs();
      if(!['active','all'].includes(qStatusFilter)&&!qRequestMatchesStatus(req,qStatusFilter)){qActiveId=qVisibleRequests(qActiveSource,document.getElementById('quotationSearch')?.value||'')[0]?.id||null;qRenderWorkspaceAll(document.getElementById('quotationSearch')?.value||'');}
      else qRenderWorkspaceDecision(req,qVisibleTableItems(req));
    }
    return true;
  }

  function qCommitActivePriceInput(req,scope){
    const input=typeof document!=='undefined'?document.activeElement:null;
    if(!input?.classList?.contains('quotationPriceInput'))return false;
    if(scope&&typeof scope.contains==='function'&&!scope.contains(input))return false;
    return qCommitPriceInput(req,input);
  }

  function qToggleApproval(req,line){
    if(!qCanEditLine(req,line)){qViewOnlyNotice(req);return;}
    if(!qValidPrice(line.price)){if(typeof showToast==='function')showToast(qLang('Onaylamak için önce geçerli bir teklif fiyatı gir.','Enter a valid quotation price before approval.'));return;}
    const was=!!line.approved, affected=new Set();
    qLoad().requests.forEach(otherReq=>{
      if(otherReq.source!==req.source||otherReq.ownerId!==req.ownerId||!qCanEditRequest(otherReq))return;
      otherReq.items.forEach(other=>{
        if(other.modelKey===line.modelKey && other.approved){other.approved=false;otherReq.updatedAt=qNow();affected.add(otherReq);}
      });
    });
    line.approved=!was;req.updatedAt=qNow();affected.add(req);
    if(req.source==='collection'&&req.ownerId===qCurrentUserId()){
      const row=qFindCollectionRow(line);
      if(row){
        if(line.approved){if(!row.pricing)row.pricing={};row.pricing[line.manufacturer]=qMoneyDisplay(line.price);row.confirmedManufacturer=line.manufacturer;}
        else if(qNorm(row.confirmedManufacturer)===line.manufacturer)row.confirmedManufacturer='';
        if(typeof kolApplyRulePricing==='function')kolApplyRulePricing(row);
        if(typeof saveKolRows==='function')saveKolRows();
      }
    }
    qSave([...affected]);qRefreshCollection();if(qWorkspaceMounted)qRenderWorkspaceAll(document.getElementById('quotationSearch')?.value||'');else qRenderDetail();
  }

  function qToggleDrop(req,line){
    if(!req||!line||req.source!=='collection') return false;
    if(!qCanEditLine(req,line)){qViewOnlyNotice(req);return false;}
    const next=!qItemDropped(req,line);
    // Drop belongs to one manufacturer line only. Other manufacturers in the
    // same quotation and the same model in other quotations stay untouched.
    line.dropped=next;
    req.updatedAt=qNow();
    qSave(req);if(qWorkspaceMounted)qRenderWorkspaceAll(document.getElementById('quotationSearch')?.value||'');else qRenderDetail();
    // v5.99: Drop işareti Koleksiyon'a da yansıtılır — düşülen üreticinin
    // fiyatı Best Price hesabında kalmaya devam ediyordu. Drop kaldırılınca
    // fiyat aynı yoldan geri yazılır.
    qWritePriceToCollection(req,line);
    qRefreshCollection();
    if(typeof showToast==='function')showToast(next?qLang('Yalnız bu üretici satırı Drop olarak işaretlendi.','Only this manufacturer line was marked as Drop.'):qLang('Bu üretici satırındaki Drop işareti kaldırıldı.','Drop mark removed from this manufacturer line.'));
    return next;
  }

  function qBindColumnResize(host){
    const table=host.querySelector('.quotationTable'); if(!table) return;
    const applyTableWidth=()=>{
      const width=qColumnTotalWidth();
      table.style.width=width+'px';
      table.style.minWidth=width+'px';
    };
    host.querySelectorAll('[data-qresize]').forEach(handle=>{
      const key=handle.dataset.qresize;
      handle.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();});
      handle.addEventListener('dblclick',event=>{
        event.preventDefault();event.stopPropagation();
        const width=qSetColumnWidth(key,qColumnDefaults[key],true);
        const col=[...table.querySelectorAll('col[data-qcol-width]')].find(node=>node.dataset.qcolWidth===key);
        if(col)col.style.width=width+'px';
        applyTableWidth();
      });
      handle.addEventListener('pointerdown',event=>{
        if(event.button!==0)return;
        event.preventDefault();event.stopPropagation();
        const th=handle.closest('th');
        const startX=event.clientX;
        const startWidth=th?.getBoundingClientRect().width||qColumnWidth(key);
        document.body.classList.add('quotationColumnResizing');
        const move=moveEvent=>{
          const width=qSetColumnWidth(key,startWidth+(moveEvent.clientX-startX),false);
          const col=[...table.querySelectorAll('col[data-qcol-width]')].find(node=>node.dataset.qcolWidth===key);
          if(col)col.style.width=width+'px';
          applyTableWidth();
        };
        const stop=()=>{
          document.removeEventListener('pointermove',move,true);
          document.removeEventListener('pointerup',stop,true);
          document.removeEventListener('pointercancel',stop,true);
          document.body.classList.remove('quotationColumnResizing');
          qSaveColumnWidths();
        };
        document.addEventListener('pointermove',move,true);
        document.addEventListener('pointerup',stop,true);
        document.addEventListener('pointercancel',stop,true);
      });
    });
  }


  function qBindDetail(req){
    const host=document.getElementById('quotationDetail'); if(!host) return;
    const getLine=id=>req.items.find(x=>x.id===id);
    qBindColumnResize(host);
    host.querySelectorAll('[data-qsort]').forEach(btn=>btn.addEventListener('click',()=>qSortTable(req,btn.dataset.qsort)));
    host.querySelectorAll('[data-qfilter]').forEach(btn=>btn.addEventListener('click',event=>{event.stopPropagation();qOpenTableFilter(req,btn.dataset.qfilter,btn);}));
    host.querySelector('.quotationClearFilters')?.addEventListener('click',()=>{qTableState(req).filters={};qRenderDetail();});
    host.querySelector('[data-export-quotation]')?.addEventListener('click',event=>void qExportRequest(req,event.currentTarget));
    host.querySelector('[data-manage-quotation-access]')?.addEventListener('click',()=>qOpenAccessModal(req));
    host.querySelector('[data-quotation-note]')?.addEventListener('click',()=>qOpenQuotationNote(req));
    host.querySelector('[data-q-send-reminder]')?.addEventListener('click',()=>qOpenReminder(req));
    host.querySelector('[data-q-reopen-draft]')?.addEventListener('click',event=>{
      const reopen=window.BLPrepareEmail?.reopenPricingRequest;
      if(typeof reopen!=='function'){if(typeof showToast==='function')showToast(qLang('Taslak yeniden açma özelliği hazır değil.','Draft reopen is not available.'));return;}
      void Promise.resolve(reopen(req.id,event.currentTarget)).finally(()=>{if(document.getElementById('quotationDetail'))qRenderDetail();});
    });
    host.querySelector('[data-q-open-collection]')?.addEventListener('click',()=>qOpenRequestInCollection(req));
    host.querySelector('[data-q-open-history]')?.addEventListener('click',()=>openPricingHistoryWorkspace(qCollectionRowsForRequest(req),{requestId:req.id}));
    host.querySelector('[data-quotation-capacity]')?.addEventListener('change',event=>{
      if(!qCanEditLine(req,req.items[0])){event.target.checked=!!req.capacityConfirmed;qViewOnlyNotice(req);return;}
      req.capacityConfirmed=!!event.target.checked;
      req.updatedAt=qNow();
      event.target.closest('.quotationCapacityToggle')?.classList.toggle('isConfirmed',req.capacityConfirmed);
      qSave(req);
      if(typeof showToast==='function')showToast(req.capacityConfirmed?qLang('Capacity Confirmed işaretlendi.','Capacity Confirmed was checked.'):qLang('Capacity Confirmed kaldırıldı.','Capacity Confirmed was cleared.'));
    });
    host.querySelector('[data-quotation-status]')?.addEventListener('change',event=>void qChangeStatus(req,event.target.value));
    host.querySelectorAll('.quotationPriceInput').forEach(input=>{
      input.dataset.lastCommitted=input.value;
      input.dataset.dirty='0';
      input.addEventListener('input',()=>{
        input.dataset.dirty=qNorm(input.value)===qNorm(input.dataset.lastCommitted)?'0':'1';
      });
      // `change` bazı tarayıcı/odak geçişlerinde DOM yeniden çizilmeden önce
      // çalışmayabilir. `blur` ikinci güvenlik katmanıdır; lastCommitted kontrolü
      // aynı değerin iki kez kaydedilmesini önler.
      input.addEventListener('change',()=>qCommitPriceInput(req,input));
      input.addEventListener('blur',()=>qCommitPriceInput(req,input));
      input.addEventListener('keydown',e=>{
        if(e.isComposing)return;
        const inputs=[...host.querySelectorAll('.quotationPriceInput')],i=inputs.indexOf(input);
        if(e.key==='Enter'||e.key==='ArrowDown'||e.key==='ArrowUp'){
          e.preventDefault();
          qCommitPriceInput(req,input);
          const nextIndex=e.key==='ArrowUp'?Math.max(0,i-1):Math.min(inputs.length-1,i+1);
          const next=inputs[nextIndex];
          if(next){next.focus();next.select();}
        }
      });
      input.addEventListener('paste',e=>{
        const text=e.clipboardData?.getData('text/plain')||''; if(!/[\t\r\n]/.test(text)) return;
        e.preventDefault();
        const values=text.split(/\r?\n/).flatMap(row=>row.split('\t')).map(qNorm).filter((v,i,a)=>v!==''||i<a.length-1);
        const inputs=[...host.querySelectorAll('.quotationPriceInput')],start=inputs.indexOf(input);let changed=0;
        values.forEach((value,offset)=>{const target=inputs[start+offset];if(!target)return;target.value=value;if(qCommitPriceInput(req,target))changed++;});
        if(changed&&typeof showToast==='function')showToast(qLang(`${changed} teklif hücresi yapıştırıldı.`,`${changed} quotation cells pasted.`));
      });
    });
    if(req.source==='collection') host.querySelectorAll('.quotationModelThumb').forEach(img=>{
      if(img.dataset.detailPreviewBound==='1')return; // ortak katman (bindDetailModelThumbs) zaten bağladı
      window.BLImageRuntime?.observe?.(img);
      img.addEventListener('mouseenter',e=>{if(window.BLImageRuntime?.scheduleHover)window.BLImageRuntime.scheduleHover(img,e);else if(typeof kolShowImgPopup==='function')kolShowImgPopup(img.src,e);});
      img.addEventListener('mousemove',e=>{const pop=document.getElementById('kolImgPopup');if(pop&&typeof kolPositionPopup==='function')kolPositionPopup(pop,e);});
      img.addEventListener('mouseleave',()=>{if(typeof kolHideImgPopup==='function')kolHideImgPopup();});
    });
    if(qWorkspaceMounted)host.querySelector('tbody')?.addEventListener('click',event=>{
      if(event.target.closest('button,input,select,a,label'))return;
      const row=event.target.closest('[data-quote-line]');if(!row)return;
      qWorkspaceSelectedLineId=row.dataset.quoteLine||'';qRenderWorkspaceDecision(req,qVisibleTableItems(req));
      host.querySelectorAll('[data-quote-line]').forEach(tr=>tr.classList.toggle('isWorkspaceSelected',tr.dataset.quoteLine===qWorkspaceSelectedLineId));
    });
    host.querySelectorAll('[data-quote-approve]').forEach(btn=>btn.addEventListener('click',()=>{const line=getLine(btn.dataset.quoteApprove);if(line)qToggleApproval(req,line);}));
    host.querySelectorAll('[data-quote-drop]').forEach(btn=>btn.addEventListener('click',()=>{const line=getLine(btn.dataset.quoteDrop);if(line)qToggleDrop(req,line);}));
    host.querySelector('[data-delete-quotation]')?.addEventListener('click',()=>qDeleteRequest(req));
  }

  async function openModal(source='collection'){
    qWorkspaceMounted=false;qWorkspaceMode='';const pageHost=document.getElementById('quotationWorkspacePage');if(pageHost)pageHost.innerHTML='';
    await qReady;
    await qHydrateShared(true);
    qDetachLegacyCollectionDrops();
    qCloseTableFilter();qDragId=null;qDragMoved=false;
    qActiveSource=source==='cp'?'cp':'collection';qStatusFilter='active';
    const sourceRequests=qVisibleRequests(qActiveSource,'');
    if(!sourceRequests.some(r=>r.id===qActiveId))qActiveId=sourceRequests[0]?.id||null;
    document.getElementById('quotationModal')?.remove();
    const modal=document.createElement('div');modal.id='quotationModal';modal.className='warnOverlay';
    modal.innerHTML=`<div class="modalCard verHistCard todoCard quotationCard" role="dialog" aria-modal="true" aria-labelledby="quotationTitle">
      <div class="verHistTop"><div><h2 id="quotationTitle">${qEsc(qLang('Fiyat Çalışmaları','Quotations'))}</h2><p class="verHistSub">${qEsc(qActiveSource==='cp'?qLang('Tüm kullanıcıların CP quotation kayıtları','CP quotations from all users'):qLang('Tüm kullanıcıların Koleksiyon quotation kayıtları','Collection quotations from all users'))}</p></div><button type="button" class="verHistClose" data-close-quotation title="${qEsc(qLang('Kapat','Close'))}"><svg class="ic"><use href="#i-x"/></svg></button></div>
      <div class="quotationStatusTabs" id="quotationStatusTabs" role="group" aria-label="${qEsc(qLang('Quotation durumu','Quotation status'))}">
        <button type="button" data-quotation-status-filter="active" class="isActive" aria-pressed="true"><span>${qEsc(qLang('Devam ediyor','In progress'))}</span><b data-status-count>0</b></button>
        <button type="button" data-quotation-status-filter="closed" aria-pressed="false"><span>${qEsc(qLang('Kapandı','Closed'))}</span><b data-status-count>0</b></button>
        <button type="button" data-quotation-status-filter="all" aria-pressed="false"><span>${qEsc(qLang('Tümü','All'))}</span><b data-status-count>0</b></button>
      </div>
      <div class="verHistTools"><input type="search" id="quotationSearch" placeholder="${qEsc(qLang('Model, üretici veya kayıt sahibi ara…','Search model, manufacturer or owner…'))}" autocomplete="off"><span class="verHistCount" id="quotationCount"></span></div>
      <div class="verHistBody"><div class="verHistNav" id="quotationNav"></div><div class="quotationDetail" id="quotationDetail"></div></div>
      <div class="verHistFoot"><span class="verHistCount">${qEsc(qLang('Kapanan kayıtlar saklanır; düzenleme yalnız kayıt sahibi ve yetkilendirilen kullanıcılara açıktır.','Closed records are retained; editing is limited to the owner and authorized users.'))}</span><span style="flex:1"></span><button type="button" class="tbtn" data-close-quotation>${qEsc(qLang('Kapat','Close'))}</button></div>
    </div>`;
    document.body.appendChild(modal);
    const search=modal.querySelector('#quotationSearch');
    // Modal içindeki herhangi bir başka kontrole tıklama, odaktaki fiyat hücresini
    // DOM yeniden çizilmeden önce kaydeder. Böylece fareyle liste, filtre, durum,
    // onay veya kapatma düğmesine geçişte yazılan değer kaybolmaz.
    modal.addEventListener('pointerdown',event=>{
      const active=document.activeElement;
      if(active!==event.target&&active?.classList?.contains('quotationPriceInput')){
        qCommitActivePriceInput(qActiveRequest(),modal);
      }
    },true);
    let closing=false;
    const close=()=>{
      if(closing)return;
      closing=true;
      qCommitActivePriceInput(qActiveRequest(),modal);
      void qFlushSaves().finally(()=>{
        qCloseTableFilter();qDragId=null;qDragMoved=false;document.body.classList.remove('quotationColumnResizing');if(typeof kolHideImgPopup==='function')kolHideImgPopup();document.getElementById('quotationAccessModal')?.remove();modal.remove();
      });
    };
    modal.querySelectorAll('[data-close-quotation]').forEach(btn=>btn.addEventListener('click',close));
    modal.addEventListener('click',e=>{if(e.target===modal)close();});
    search.addEventListener('input',()=>qRenderNav(search.value));
    modal.querySelector('#quotationStatusTabs')?.addEventListener('click',event=>{
      const button=event.target.closest('[data-quotation-status-filter]');if(!button)return;
      qCommitActivePriceInput(qActiveRequest(),modal);
      qStatusFilter=button.dataset.quotationStatusFilter||'active';
      const current=qLoad().requests.find(req=>req.id===qActiveId);
      if(!current||current.source!==qActiveSource||(qStatusFilter!=='all'&&current.status!==qStatusFilter))qActiveId=qVisibleRequests(qActiveSource,search.value)[0]?.id||null;
      qRenderNav(search.value);qRenderDetail();
    });
    const nav=modal.querySelector('#quotationNav');
    nav.addEventListener('dragstart',e=>{
      const item=e.target.closest('[data-quotation-id]');if(!item||item.draggable!==true)return;
      qDragId=item.dataset.quotationId;qDragMoved=false;
      item.classList.add('isDragging');item.setAttribute('aria-grabbed','true');
      if(e.dataTransfer){e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',qDragId);}
    });
    nav.addEventListener('dragover',e=>{
      const item=e.target.closest('[data-quotation-id]');
      if(!item||!qDragId||item.dataset.quotationId===qDragId||item.draggable!==true)return;
      e.preventDefault();if(e.dataTransfer)e.dataTransfer.dropEffect='move';
      nav.querySelectorAll('.dropBefore,.dropAfter,.dropMerge').forEach(el=>el.classList.remove('dropBefore','dropAfter','dropMerge'));
      const rect=item.getBoundingClientRect(),ratio=(e.clientY-rect.top)/Math.max(1,rect.height);
      item.classList.add(ratio<0.22?'dropBefore':(ratio>0.78?'dropAfter':'dropMerge'));
    });
    nav.addEventListener('drop',async e=>{
      const item=e.target.closest('[data-quotation-id]');
      if(!item||!qDragId||item.dataset.quotationId===qDragId||item.draggable!==true)return;
      e.preventDefault();const dragId=qDragId,targetId=item.dataset.quotationId,merge=item.classList.contains('dropMerge'),placeAfter=item.classList.contains('dropAfter');
      qDragMoved=true;qDragId=null;qClearDragMarks(nav);
      const changed=merge?await qMergeRequest(dragId,targetId):qMoveRequest(dragId,targetId,placeAfter);
      qDragMoved=Boolean(changed);qRenderNav(search.value);qRenderDetail();setTimeout(()=>{qDragMoved=false;},0);
    });
    nav.addEventListener('dragend',()=>{qClearDragMarks(nav);qDragId=null;setTimeout(()=>{qDragMoved=false;},0);});
    nav.addEventListener('click',e=>{if(qDragMoved){e.preventDefault();return;}const btn=e.target.closest('[data-quotation-id]');if(!btn)return;qCommitActivePriceInput(qActiveRequest(),modal);qActiveId=btn.dataset.quotationId;qRenderNav(search.value);qRenderDetail();});
    qRenderNav('');qRenderDetail();setTimeout(()=>search.focus(),0);
  }

  function setPrice(requestId,lineId,value){
    const req=qLoad().requests.find(r=>r.id===requestId),line=req?.items.find(x=>x.id===lineId);
    if(!req||!line||!qCanEditLine(req,line)){if(req)qViewOnlyNotice(req);return false;}
    qApplyPrice(req,line,value);return true;
  }
  function toggleApproval(requestId,lineId){
    const req=qLoad().requests.find(r=>r.id===requestId),line=req?.items.find(x=>x.id===lineId);
    if(!req||!line) return false;
    qToggleApproval(req,line); return true;
  }
  /* v6.34 — Koleksiyon'daki "düzenle" penceresi için mevcut teklif satırını bulur.
     Eskiden o pencere HER ZAMAN recordRequest() çağırıyordu, yani fiyat zaten bir
     Quotations kaydından gelmiş olsa bile kaynağı değiştirmeyip YENİ bir kayıt
     açıyordu; ekranda iki ayrı kayıt görünüyor ve onay/kapasite izi bölünüyordu.
     En GÜNCEL, düşürülmemiş (dropped) ve düzenlenebilir satır seçilir. */
  function findCollectionLine(rowId,manufacturer){
    const id=Number(rowId), name=qNorm(manufacturer);
    if(!Number.isFinite(id)||!name) return null;
    let hit=null;
    qLoad().requests.forEach(req=>{
      // v6.51 — kapalı kayıtlar artık düzenlenebilir olduğu için arama
      // kapsamından ATLANMIYOR; atlansaydı Koleksiyon'dan "düzenle" dendiğinde
      // mevcut kapalı kaydı bulamayıp v6.34'ün çözdüğü "çift kayıt" sorunu
      // kapalı kayıtlar için yeniden ortaya çıkardı.
      req.items.forEach(line=>{
        if(line.dropped) return;
        if(Number(line.rowId)!==id) return;
        if(qNorm(line.manufacturer)!==name) return;
        if(!qCanEditLine(req,line)) return;
        const stamp=String(req.updatedAt||req.createdAt||'');
        if(!hit||stamp>hit.stamp) hit={stamp,requestId:req.id,lineId:line.id,price:line.price,approved:line.approved===true};
      });
    });
    if(!hit) return null;
    return {requestId:hit.requestId,lineId:hit.lineId,price:hit.price,approved:hit.approved};
  }
  // Var olan satırı YERİNDE günceller: fiyat ve/veya onay. Kayıt bulunamazsa false
  // döner ve çağıran yeni kayıt açmaya karar verir.
  function updateCollectionLine(rowId,manufacturer,{price,approved}={}){
    const found=findCollectionLine(rowId,manufacturer);
    if(!found) return false;
    const req=qLoad().requests.find(r=>r.id===found.requestId);
    const line=req?.items.find(x=>x.id===found.lineId);
    if(!req||!line) return false;
    if(price!==undefined) qApplyPrice(req,line,price);
    if(approved!==undefined && (line.approved===true)!==Boolean(approved)) qToggleApproval(req,line);
    return true;
  }


  function qCollectionRowsForRequest(req){
    const seen=new Set(),rows=[];
    (req?.items||[]).forEach(item=>{
      const row=qFindCollectionRow(item);if(!row)return;
      const key=String(row.id??item.rowId??item.orderCode??item.modelKey);
      if(seen.has(key))return;seen.add(key);rows.push(row);
    });
    return rows;
  }

  function qReminderItems(req){
    if(!req||req.status==='closed')return [];
    return (req.items||[]).filter(item=>item&&!qItemDropped(req,item)&&!qValidPrice(item.price));
  }

  function qReminderRecipients(req,items){
    const out=new Map();
    (items||[]).forEach(item=>{
      const name=qNorm(item?.manufacturer);if(!name)return;
      const requestContact=(req?.manufacturers||[]).find(m=>qNorm(m?.name).toLocaleLowerCase('tr-TR')===name.toLocaleLowerCase('tr-TR'));
      const email=qNorm(item?.manufacturerEmail)||qNorm(requestContact?.email);
      const key=name.toLocaleLowerCase('tr-TR');
      if(!out.has(key)||(!out.get(key).email&&email))out.set(key,{name,email});
    });
    return [...out.values()];
  }

  function qReminderRows(req,items){
    return (items||[]).map((item,index)=>{
      const collectionRow=req?.source==='collection'?qFindCollectionRow(item):null;
      return {
        ...(collectionRow||{}),
        id:collectionRow?.id??(-(index+1)),
        plmId:qNorm(collectionRow?.plmId)||qNorm(item.plmId),
        modelKod:qNorm(collectionRow?.modelKod)||qNorm(item.modelCode),
        colour:qNorm(collectionRow?.colour)||qNorm(item.colour),
        season:qNorm(collectionRow?.season)||qNorm(item.season),
        quantity:collectionRow?.quantity??item.quantity??'',
        targetPrice:qNorm(collectionRow?.targetPrice)||qNorm(item.targetPrice),
        manufacturer:qNorm(item.manufacturer),
        buyingSampleManufacturer:qNorm(item.manufacturer),
        _quotationReminderRequestId:qNorm(req?.id),
        _quotationReminderLineId:qNorm(item?.id)
      };
    });
  }

  function qOpenReminder(req){
    if(!req||req.status==='closed'){
      if(typeof showToast==='function')showToast(qLang('Kapalı quotation için hatırlatma gönderilemez.','A reminder cannot be sent for a closed quotation.'));
      return false;
    }
    if(!qCanEditRequest(req)){qViewOnlyNotice(req);return false;}
    const items=qReminderItems(req),recipients=qReminderRecipients(req,items);
    if(!items.length||!recipients.length){
      if(typeof showToast==='function')showToast(qLang('Bu quotation içinde fiyatı beklenen üretici yok.','No manufacturer is waiting to quote in this request.'));
      return false;
    }
    const bridge=window.BLPrepareEmail?.openQuotationReminder;
    if(typeof bridge!=='function'){
      if(typeof showToast==='function')showToast(qLang('E-posta hazırlama altyapısı henüz hazır değil.','The e-mail preparation service is not ready yet.'));
      return false;
    }
    return bridge({rows:qReminderRows(req,items),recipients,requestId:req.id,count:items.length});
  }

  function qOpenRequestInCollection(req,line=null){
    const target=line||req?.items?.find(item=>item.id===qWorkspaceSelectedLineId)||req?.items?.[0];
    if(typeof switchTab==='function')switchTab('koleksiyon');
    setTimeout(()=>{
      const search=document.getElementById('kolSearch');
      if(search&&target){search.value=qNorm(target.modelCode||target.plmId||target.orderCode);search.dispatchEvent(new Event('input',{bubbles:true}));}
      else if(typeof renderKol==='function')renderKol();
    },0);
  }

  function qWorkspaceKpiMarkup(){
    const engine=qPricingEngine(),k=engine?.workspaceKpis?.(qLoad().requests,'collection')||{};
    const cards=[
      [qLang('Aktif Talep','Active Requests'),k.requests??0,'i-notebook'],
      [qLang('Üretici','Manufacturers'),k.manufacturers??0,'i-users-group'],
      [qLang('Onay Bekleyen','Waiting Approval'),k.waitingApproval??0,'i-calendar'],
      [qLang('Onaylı','Approved'),k.approved??0,'i-check'],
      [qLang('Fiyat Bekleyen','Waiting Quote'),k.waitingQuote??0,'i-mail'],
    ];
    return cards.map(([label,value,icon])=>`<div class="pricingMetric"><svg class="ic"><use href="#${icon}"/></svg><span>${qEsc(label)}</span><b>${qEsc(value)}</b></div>`).join('');
  }

  function qBindWorkspaceNav(nav,search,root){
    if(!nav)return;
    nav.addEventListener('dragstart',e=>{
      const item=e.target.closest('[data-quotation-id]');if(!item||item.draggable!==true)return;
      qDragId=item.dataset.quotationId;qDragMoved=false;item.classList.add('isDragging');item.setAttribute('aria-grabbed','true');
      if(e.dataTransfer){e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',qDragId);}
    });
    nav.addEventListener('dragover',e=>{
      const item=e.target.closest('[data-quotation-id]');if(!item||!qDragId||item.dataset.quotationId===qDragId||item.draggable!==true)return;
      e.preventDefault();if(e.dataTransfer)e.dataTransfer.dropEffect='move';
      nav.querySelectorAll('.dropBefore,.dropAfter,.dropMerge').forEach(el=>el.classList.remove('dropBefore','dropAfter','dropMerge'));
      const rect=item.getBoundingClientRect(),ratio=(e.clientY-rect.top)/Math.max(1,rect.height);item.classList.add(ratio<0.22?'dropBefore':(ratio>0.78?'dropAfter':'dropMerge'));
    });
    nav.addEventListener('drop',async e=>{
      const item=e.target.closest('[data-quotation-id]');if(!item||!qDragId||item.dataset.quotationId===qDragId||item.draggable!==true)return;
      e.preventDefault();const dragId=qDragId,targetId=item.dataset.quotationId,merge=item.classList.contains('dropMerge'),placeAfter=item.classList.contains('dropAfter');
      qDragMoved=true;qDragId=null;qClearDragMarks(nav);const changed=merge?await qMergeRequest(dragId,targetId):qMoveRequest(dragId,targetId,placeAfter);
      qDragMoved=Boolean(changed);qRenderWorkspaceAll(search?.value||'');setTimeout(()=>{qDragMoved=false;},0);
    });
    nav.addEventListener('dragend',()=>{qClearDragMarks(nav);qDragId=null;setTimeout(()=>{qDragMoved=false;},0);});
    nav.addEventListener('click',e=>{
      if(qDragMoved){e.preventDefault();return;}const btn=e.target.closest('[data-quotation-id]');if(!btn)return;
      qCommitActivePriceInput(qActiveRequest(),root);qActiveId=btn.dataset.quotationId;qWorkspaceSelectedLineId='';qRenderWorkspaceAll(search?.value||'');
    });
  }

  function qRenderWorkspaceAll(query=''){
    if(!qWorkspaceMounted)return;
    const kpi=document.getElementById('quotationWorkspaceKpis');if(kpi)kpi.innerHTML=qWorkspaceKpiMarkup();
    qRenderNav(query);qRenderDetail();
  }

  async function mountWorkspace(host,{source='collection',preserveContext=true}={}){
    if(!host)return false;
    await qReady;await qHydrateShared(true);qDetachLegacyCollectionDrops();
    document.getElementById('quotationModal')?.remove();
    qWorkspaceMounted=true;qWorkspaceMode='quotations';qActiveSource=source==='cp'?'cp':'collection';
    if(!preserveContext||!['active','waiting-approval','approved','closed','all'].includes(qStatusFilter))qStatusFilter='active';
    const candidates=qVisibleRequests(qActiveSource,'');if(!candidates.some(req=>req.id===qActiveId))qActiveId=candidates[0]?.id||null;
    host.innerHTML=`<div class="pricingWorkspaceShell quotationWorkspaceShell">
      <div class="pricingWorkspaceHeader"><div><h1>${qEsc(qLang('Fiyat Teklifleri','Quotations'))}</h1><p>${qEsc(qLang('Fiyat taleplerini, üretici tekliflerini ve onay kararlarını tek yerde yönet.','Manage pricing requests, supplier quotes and approval decisions in one place.'))}</p></div><div class="pricingWorkspaceHeaderActions"><button type="button" class="tbtn primary" data-q-new-pricing><svg class="ic"><use href="#i-copy-plus"/></svg>${qEsc(qLang('Yeni Fiyat Talebi','New Quotation'))}</button><button type="button" class="tbtn" data-q-open-collection-main><svg class="ic"><use href="#i-hanger"/></svg>${qEsc(qLang('Koleksiyonu Aç','Open Collection'))}</button></div></div>
      <div class="pricingWorkspaceKpis" id="quotationWorkspaceKpis"></div>
      <div class="quotationStatusTabs pricingWorkspaceTabs" id="quotationStatusTabs" role="group">
        <button type="button" data-quotation-status-filter="active"><span>${qEsc(qLang('Devam Eden','In Progress'))}</span><b data-status-count>0</b></button>
        <button type="button" data-quotation-status-filter="waiting-approval"><span>${qEsc(qLang('Onay Bekleyen','Waiting Approval'))}</span><b data-status-count>0</b></button>
        <button type="button" data-quotation-status-filter="approved"><span>${qEsc(qLang('Onaylı','Approved'))}</span><b data-status-count>0</b></button>
        <button type="button" data-quotation-status-filter="closed"><span>${qEsc(qLang('Kapalı','Closed'))}</span><b data-status-count>0</b></button>
        <button type="button" data-quotation-status-filter="all"><span>${qEsc(qLang('Tümü','All'))}</span><b data-status-count>0</b></button>
      </div>
      <div class="pricingWorkspaceSearch"><input type="search" id="quotationSearch" placeholder="${qEsc(qLang('Model, üretici veya kayıt sahibi ara…','Search model, manufacturer or owner…'))}" autocomplete="off"><span id="quotationCount"></span></div>
      <div class="pricingWorkspaceGrid"><aside class="pricingWorkspaceNav"><div class="pricingPaneTitle">${qEsc(qLang('Fiyat Talebi Grupları','Quotation Groups'))}</div><div class="verHistNav" id="quotationNav"></div></aside><main class="quotationDetail pricingWorkspaceMain" id="quotationDetail"></main><aside class="pricingWorkspaceDecision" id="quotationWorkspaceDecision"></aside></div>
    </div>`;
    const search=host.querySelector('#quotationSearch');
    host.addEventListener('pointerdown',event=>{const active=document.activeElement;if(active!==event.target&&active?.classList?.contains('quotationPriceInput'))qCommitActivePriceInput(qActiveRequest(),host);},true);
    search?.addEventListener('input',()=>qRenderWorkspaceAll(search.value));
    host.querySelector('#quotationStatusTabs')?.addEventListener('click',event=>{
      const button=event.target.closest('[data-quotation-status-filter]');if(!button)return;qCommitActivePriceInput(qActiveRequest(),host);
      qStatusFilter=button.dataset.quotationStatusFilter||'active';const list=qVisibleRequests(qActiveSource,search?.value||'');
      if(!list.some(req=>req.id===qActiveId))qActiveId=list[0]?.id||null;qWorkspaceSelectedLineId='';qRenderWorkspaceAll(search?.value||'');
    });
    qBindWorkspaceNav(host.querySelector('#quotationNav'),search,host);
    host.querySelector('[data-q-new-pricing]')?.addEventListener('click',()=>openSendToPricing({rows:null,count:window.BLCollection?.selectedIds?.().length||0}));
    host.querySelector('[data-q-open-collection-main]')?.addEventListener('click',()=>{if(typeof switchTab==='function')switchTab('koleksiyon');});
    qRenderWorkspaceAll('');return true;
  }

  async function openWorkspaceFromCollection(rows=null){
    await qReady;await qHydrateShared(true);const selected=Array.isArray(rows)&&rows.length?rows:(window.BLCollection?.selectedRows?.()||[]),engine=qPricingEngine();
    if(selected.length&&engine?.lineMatchesRow){
      const hit=qLoad().requests.filter(req=>req.source==='collection').sort((a,b)=>String(b.updatedAt||b.createdAt).localeCompare(String(a.updatedAt||a.createdAt))).find(req=>(req.items||[]).some(item=>selected.some(row=>engine.lineMatchesRow(item,row))));
      if(hit)qActiveId=hit.id;
    }
    qStatusFilter='active';if(typeof switchTab==='function')switchTab('quotations');return true;
  }

  async function openSendToPricing(ctx={}){
    const selected=Array.isArray(ctx.rows)?ctx.rows:(window.BLCollection?.selectedRows?.()||[]);
    if(!selected.length){
      if(typeof showToast==='function')showToast(qLang('Önce Collection ekranından en az bir model seç.','Select at least one model in Collection first.'));
      if(typeof switchTab==='function')switchTab('koleksiyon');return false;
    }
    const preflight=window.BLCollection?.pricingPreflight
      ? await window.BLCollection.pricingPreflight(selected)
      : {proceed:true};
    if(!preflight?.proceed)return false;
    if(typeof renderKolMfrModal!=='function')return false;
    renderKolMfrModal({rows:Array.isArray(ctx.rows)?ctx.rows:null,count:selected.length,btnId:ctx.btnId||'kolSendPricingBtn',persist:ctx.persist!==false,defaultTopicKind:'pricing',pricingTaskV2:true,title:'Send to Pricing',subtitle:qLang('Seçili modeller için üreticilerden fiyat talebi oluştur.','Create pricing requests for the selected models and manufacturers.')});
    return true;
  }

  setTimeout(qDetachLegacyCollectionDrops,0);
  document.getElementById('kolQuotationsBtn')?.addEventListener('click',()=>openWorkspaceFromCollection());
  document.getElementById('cpQuotationsBtn')?.addEventListener('click',()=>openModal('cp'));


  /* ===================== FİYAT GEÇMİŞİ =====================
     Seçili modellerin bugüne kadar ALDIĞI fiyatları tek tabloda toplar.
     Veri zaten burada: her Send to Pricing talebi model + üretici + fiyat + o günkü
     hedef + onay durumu + tarih ile saklanıyor. Bu ekran yeni veri üretmez, yalnızca
     mevcut kayıtları okur — hiçbir satır değiştirilmez.
     Kullanıcı kararı: yalnız GEÇERLİ fiyatlar gösterilir; drop edilmiş satırlar ve
     henüz fiyat girilmemiş talep satırları listelenmez. */
  // Number(null) ve Number('') sıfır döndürür; Number.isFinite(0) da doğrudur. Bu yüzden
  // adet boş olduğunda yedek değere düşülmeden 0 yazılıyordu. Bu yardımcı boş/geçersiz
  // değeri açıkça "yok" sayar.
  function qNumOrNull(value){
    if(value==null) return null;
    if(typeof value==='string'&&!value.trim()) return null;
    const n=Number(value);
    return Number.isFinite(n)?n:null;
  }
  function qhEsc(v){ return String(v==null?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function qhSafeImageSrc(value){
    const src=String(value==null?'':value).trim();
    if(!src) return '';
    if(/^(?:data:image\/(?:png|jpe?g|gif|webp);base64,|blob:|https?:\/\/|\/)/i.test(src)) return qhEsc(src);
    return '';
  }
  function qhEn(){ return typeof appLang!=='undefined' && appLang==='en'; }
  // PRICING HISTORY MODEL KİMLİĞİ.
  //
  // Koleksiyon satırının PLM ID, Model Adı, Category, Season vb. alanları kullanıcı
  // tarafından revize edilebilir. Fiyat geçmişini bu değişken alanlarla bağlamak,
  // model kartı düzenlendiği anda geçmişin görünmez olmasına neden oluyordu.
  //
  // Yeni öncelik:
  //   1) Koleksiyon satırının değişmeyen rowId / `kol:<rowId>` modelKey kimliği,
  //   2) Eski quotation kayıtları için PLM ID + Model Adı geriye uyumluluğu.
  //
  // Böylece bir modelin bilgileri güncellense de quotation fiyatları aynı model
  // kartına bağlı kalır. Duplicate Model yeni bir rowId aldığı için eski modelin
  // fiyat geçmişini devralmaz.
  function qhModelKeys(row){
    if(!row) return [];
    const plm=qNorm(row.plmId||row['PLM ID']).toLocaleLowerCase('tr-TR');
    const model=qNorm(row.modelKod||row['Model Name']).toLocaleLowerCase('tr-TR');
    const keys=[];
    if(plm||model) keys.push(plm+'\u0000'+model);
    return keys;
  }
  function qhItemKey(item){
    return qNorm(item?.plmId).toLocaleLowerCase('tr-TR')+'\u0000'+qNorm(item?.modelCode).toLocaleLowerCase('tr-TR');
  }
  function qhStableRowKeys(row){
    const rawId=qNorm(row?.id);
    if(!rawId)return [];
    return [`row:${rawId}`,`model:kol:${rawId}`];
  }
  function qhStableItemKeys(req,item){
    if(req?.source!=='collection')return [];
    const keys=[];
    const rowId=qNorm(item?.rowId);
    const modelKey=qNorm(item?.modelKey);
    if(rowId)keys.push(`row:${rowId}`);
    if(modelKey&&modelKey.startsWith('kol:'))keys.push(`model:${modelKey}`);
    return keys;
  }
  function qhRowMeta(row){
    const rawQty=row?.quantity!=null?row.quantity:row?.['Order Quantity'];
    const quantity=qMoneyNumber(rawQty);
    const stableKeys=qhStableRowKeys(row);
    const legacyKey=qhModelKeys(row)[0]||'';
    return {
      identityKey:stableKeys[0]||(`legacy:${legacyKey}`),
      stableKeys,legacyKey,
      row,
      model:qNorm(row?.modelKod||row?.['Model Name']),
      plmId:qNorm(row?.plmId||row?.['PLM ID']),
      picture:qNorm(row?.img||row?.Picture||row?.picture)||(qNorm(row?.imgRef)?`/api/collection-images/${encodeURIComponent(qNorm(row.imgRef))}`:''),
      colourCode:qNorm(row?.colourCode||row?.['C.Code']||row?.['Colour Code']),
      season:qNorm(row?.season||row?.['Season']),
      inStoreMonth:qNorm(row?.inStoreMonth||row?.['In Store Month']||row?.['In-Store (Model Budget)']||row?.inStore),
      category:qNorm(row?.urunTipi||row?.['Category']||row?.category),
      quantity:Number.isFinite(quantity)?quantity:null,
    };
  }
  function qhSelectionIndex(rows){
    const stable=new Map(),legacy=new Map(),all=[];
    (Array.isArray(rows)?rows:[]).forEach(row=>{
      const meta=qhRowMeta(row);
      all.push(meta);
      meta.stableKeys.forEach(key=>stable.set(key,meta));
      if(meta.legacyKey){
        // Aynı PLM + Model çifti birden fazla seçili satırda varsa eski kayıt için
        // tahmini eşleştirme yapma. Stable row kimliği olan yeni kayıtlar etkilenmez.
        legacy.set(meta.legacyKey,legacy.has(meta.legacyKey)?null:meta);
      }
    });
    return {stable,legacy,all};
  }
  function qhStableMatchValid(req,item,meta){
    const rowOwner=qNorm(meta?.row?._collectionOwnerId)||qCurrentUserId();
    if(qNorm(req?.ownerId)!==qNorm(rowOwner))return false;
    return qIdentityCompatible(item,{plmId:meta?.plmId,modelCode:meta?.model});
  }
  function qhSelectedMeta(req,item,index){
    const stableKeys=qhStableItemKeys(req,item);
    for(const key of stableKeys){
      const meta=index.stable.get(key);
      // rowId kullanıcı başına ve yeniden import sonrası tekrar kullanılabilir;
      // başka sahibin ya da artık başka modele ait eski bir kalemi bu satıra bağlama.
      if(meta&&qhStableMatchValid(req,item,meta))return meta;
    }
    // Stable Koleksiyon kimliği bulunan bir quotation satırını PLM + Model
    // benzerliğiyle başka bir satıra bağlama. Bu özellikle Duplicate Model'in
    // kaynak modelin fiyat geçmişini devralmasını engeller. Legacy fallback yalnız
    // rowId/modelKey taşımayan eski kayıtlar içindir.
    if(stableKeys.length)return null;
    return index.legacy.get(qhItemKey(item))||null;
  }
  function qhCollect(rows){
    const index=qhSelectionIndex(rows),out=[];
    if(!index.all.length) return out;
    // Quotation'ın `closed` olması yalnız Quotations penceresindeki takip
    // filtresidir. Pricing History bütün aktif ve kapalı kayıtları birlikte okur.
    qLoad().requests.forEach(req=>{
      (req.items||[]).forEach(item=>{
        if(item.dropped) return;
        if(!qValidPrice(item.price)) return;
        const meta=qhSelectedMeta(req,item,index);
        if(!meta) return;
        const delta=qTargetDelta(item.targetPrice,item.price);
        out.push({
          // Ekrandaki model başlığı güncel Koleksiyon kartından gelir; fiyat,
          // üretici, hedef ve tarih quotation kaydının tarihsel değerleridir.
          identityKey:meta.identityKey||(`legacy:${qhItemKey(item)}`),
          // v5.96: Fiyat Geçmişi bir GÖRÜNÜMDÜR — her satır bir quotation
          // kaleminden türer. Kalemin kimliğini taşımak, buradaki düzenleme ve
          // silmenin doğrudan o kayda uygulanmasını sağlar; böylece Quotations
          // ekranı ayrıca güncellenmez, aynı kaydı okuduğu için kendiliğinden
          // aynı sonucu gösterir.
          requestId:req.id, itemId:item.id,
          collectionRow:meta.row,
          model:meta.model||qNorm(item.modelCode)||qNorm(item.plmId)||'—',
          plmId:meta.plmId||qNorm(item.plmId),
          picture:meta.picture||qNorm(item.picture)||'',
          colourCode:meta.colourCode||qNorm(item.colourCode)||'',
          season:meta.season||qNorm(item.season)||'',
          inStoreMonth:meta.inStoreMonth||qNorm(item.inStoreMonth)||'',
          category:qItemCategory(req,item)||meta.category||'',
          quantity:qNumOrNull(meta.quantity)??qNumOrNull(item.quantity),
          manufacturer:qNorm(item.manufacturer),
          email:qNorm(item.manufacturerEmail),
          createdAt:req.createdAt||req.updatedAt||'',
          price:qMoneyNumber(item.price),
          target:qMoneyNumber(item.targetPrice),
          deltaPct:delta?delta.percent:null,
          deltaText:delta?delta.text:'—',
          meetsTarget:delta?delta.meetsTarget:null,
          approved:!!item.approved,
          capacityConfirmed:!!req.capacityConfirmed,
          source:req.source==='cp'?'CP':(qhEn()?'Collection':'Koleksiyon'),
        });
      });
    });
    return out;
  }

  const QH_SORTS={
    model:(a,b)=>a.model.localeCompare(b.model,'tr-TR',{numeric:true,sensitivity:'base'}),
    manufacturer:(a,b)=>a.manufacturer.localeCompare(b.manufacturer,'tr-TR',{sensitivity:'base'}),
    date:(a,b)=>String(a.createdAt).localeCompare(String(b.createdAt)),
    price:(a,b)=>(a.price||0)-(b.price||0),
    target:(a,b)=>(a.target||0)-(b.target||0),
    delta:(a,b)=>((a.deltaPct==null?Infinity:a.deltaPct)-(b.deltaPct==null?Infinity:b.deltaPct)),
  };
  function qhFmtDate(iso){
    if(!iso) return '—';
    const d=new Date(iso);
    if(isNaN(d)) return '—';
    return d.toLocaleDateString(qhEn()?'en-GB':'tr-TR');
  }
  function qhMoney(n){
    return Number.isFinite(n)?n.toLocaleString(qhEn()?'en-GB':'tr-TR',{minimumFractionDigits:2,maximumFractionDigits:2}):'—';
  }
  // Model bazlı özet: HER MODEL TEK SATIR, sütunlar üreticiler.
  // Bir üretici aynı modele zaman içinde birden çok fiyat vermiş olabilir; hücrede EN SON
  // geçerli teklif gösterilir (güncel duruşu yansıtan fiyat odur), kaç teklif olduğu da
  // hücrede belirtilir. Hedef fiyat da en son talepten alınır.
  /* FİYAT GEÇMİŞİNDE DÜZENLEME / SİLME (v5.96)

     Fiyat Geçmişi ayrı bir veri kümesi değil, quotation kalemleri üzerinden
     kurulan bir görünümdür. Bu yüzden burada yapılan değişiklik doğrudan
     quotation kaydına yazılır — Quotations ekranı aynı kaydı okuduğu için
     ayrıca senkronize edilmesine gerek kalmaz, tek kaynak korunur.

     Silme, kalemi kayıttan ÇIKARMAZ; `dropped` olarak işaretler. Kalemin
     kendisini silmek, o kaleme bağlı onay/kapasite bilgisini ve teklif
     satırının varlığını da yok ederdi; `dropped` hem Fiyat Geçmişi'nden hem
     Quotations listesinden düşürür ama kaydın izini bırakır. */
  function qhFindItem(requestId,itemId){
    const request=qLoad().requests.find(item=>item.id===requestId);
    if(!request)return null;
    const item=(request.items||[]).find(entry=>entry.id===itemId);
    return item?{request,item}:null;
  }
  async function qhUpdatePrice(requestId,itemId,rawPrice){
    const found=qhFindItem(requestId,itemId);
    if(!found)return {ok:false,reason:'missing'};
    const price=qMoneyNumber(rawPrice);
    if(!qValidPrice(price))return {ok:false,reason:'invalid'};
    if(qMoneyNumber(found.item.price)===price)return {ok:false,reason:'unchanged'};
    found.item.price=price;
    found.request.updatedAt=new Date().toISOString();
    qSave(found.request);
    // Koleksiyon'daki fiyat haritası ve Best Price da güncellenmeli; aksi halde
    // revize yalnız Quotations ekranında görünürdü (v5.99).
    qWritePriceToCollection(found.request,found.item);
    qRefreshCollection();
    return {ok:true,price};
  }
  async function qhDropItem(requestId,itemId){
    const found=qhFindItem(requestId,itemId);
    if(!found)return {ok:false,reason:'missing'};
    found.item.dropped=true;
    found.request.updatedAt=new Date().toISOString();
    qSave(found.request);
    // Düşülen fiyat Koleksiyon'dan da çıkmalı (Best Price ve üretici bilgisi).
    qWritePriceToCollection(found.request,found.item);
    qRefreshCollection();
    return {ok:true};
  }

  function qhPivot(data){
    const models=new Map(); const mfrs=new Set();
    data.forEach(r=>{
      mfrs.add(r.manufacturer);
      const key=r.identityKey||r.plmId+'\u0000'+r.model;
      let m=models.get(key);
      if(!m){ m={key,model:r.model,plmId:r.plmId,picture:r.picture,colourCode:r.colourCode||'',season:r.season,inStoreMonth:r.inStoreMonth,category:r.category,quantity:r.quantity,target:r.target,targetAt:r.createdAt,cells:new Map()}; models.set(key,m); }
      if(!m.picture&&r.picture)m.picture=r.picture;
      if(!m.season&&r.season)m.season=r.season;
      if(!m.inStoreMonth&&r.inStoreMonth)m.inStoreMonth=r.inStoreMonth;
      if(!m.category&&r.category)m.category=r.category;
      if(!Number.isFinite(m.quantity)&&Number.isFinite(r.quantity))m.quantity=r.quantity;
      if(String(r.createdAt)>String(m.targetAt||'')){m.target=r.target;m.targetAt=r.createdAt;if(r.picture)m.picture=r.picture;if(r.season)m.season=r.season;if(r.inStoreMonth)m.inStoreMonth=r.inStoreMonth;if(r.category)m.category=r.category;if(Number.isFinite(r.quantity))m.quantity=r.quantity;}
      const prev=m.cells.get(r.manufacturer),count=(prev?.count||0)+1;
      if(!prev||String(r.createdAt)>=String(prev.createdAt))m.cells.set(r.manufacturer,{price:r.price,deltaPct:r.deltaPct,deltaText:r.deltaText,meetsTarget:r.meetsTarget,approved:r.approved,capacityConfirmed:r.capacityConfirmed,createdAt:r.createdAt,count,requestId:r.requestId,itemId:r.itemId,manufacturer:r.manufacturer});
      else prev.count=count;
    });
    const sorted=[...mfrs].sort((a,b)=>a.localeCompare(b,'tr-TR',{sensitivity:'base'}));
    return {models:[...models.values()],manufacturers:qhApplyMfrOrder(sorted)};
  }

  /* ===================================================================
     v6.35 — ÜRETİCİ BAZLI GÖRÜNÜMDE SÜTUN SIRASI
     Üretici sütunları alfabetik sabitti. Kullanıcı başlıkları sürükleyerek
     kendi sırasını kurabiliyor; sıra kullanıcı tercihi olarak saklanıyor.
     Saklanan liste yalnız bir SIRA İPUCUdur: kaydedilmiş sırada olmayan üretici
     (yeni gelen) alfabetik konumunu koruyarak sona eklenir, listeden düşen
     üretici sessizce yok sayılır. Böylece kayıtlı sıra veriyi asla filtrelemez.
     =================================================================== */
  const QH_MFR_ORDER_KEY='lcw.priceHistory.mfrOrder.v1';
  function qhLoadMfrOrder(){
    try{ const raw=JSON.parse(BLStorage.getItem(QH_MFR_ORDER_KEY)||'[]'); return Array.isArray(raw)?raw.map(v=>String(v)):[]; }
    catch(e){ return []; }
  }
  function qhSaveMfrOrder(list){
    try{ BLStorage.setItem(QH_MFR_ORDER_KEY,JSON.stringify((Array.isArray(list)?list:[]).map(String).slice(0,200))); }catch(e){}
  }
  function qhApplyMfrOrder(manufacturers){
    const saved=qhLoadMfrOrder();
    if(!saved.length)return [...manufacturers];
    const known=new Set(manufacturers);
    const ordered=saved.filter(name=>known.has(name));
    const seen=new Set(ordered);
    manufacturers.forEach(name=>{ if(!seen.has(name))ordered.push(name); });
    return ordered;
  }
  function qhDownload(blob,name){
    const url=URL.createObjectURL(blob),a=document.createElement('a');
    a.href=url; a.download=name; document.body.appendChild(a); a.click();
    setTimeout(()=>{ try{a.remove(); URL.revokeObjectURL(url);}catch(e){} },0);
  }
  // MODEL BAZLI FİYAT SIRALAMASI.
  //
  // Bir modelin satırındaki üretici fiyatları arasında en ucuz üç FARKLI fiyat
  // altın / gümüş / bronz olarak işaretlenir. Eşit fiyatlar aynı basamağı paylaşır
  // (iki üretici aynı en iyi fiyatı verdiyse ikisi de altındır) ve bir sonraki
  // farklı fiyat üçüncü değil, ikinci sıraya geçer — kullanıcı "en iyi ikinci
  // fiyat" derken değeri kastediyor, satır sayısını değil.
  //
  // Onaylanmış (confirmed) fiyatın yeşili bu boyamanın ÜSTÜNDEDİR: onay bir sonuç,
  // madalya ise bir kıyaslamadır ve onayın görünürlüğü kaybolmamalı.
  function qhPriceRanks(model,mfrs){
    const prices=[];
    mfrs.forEach(name=>{
      const cell=model.cells.get(name);
      if(cell&&Number.isFinite(cell.price)) prices.push(cell.price);
    });
    const distinct=[...new Set(prices)].sort((a,b)=>a-b).slice(0,3);
    const rankOf=new Map(distinct.map((price,i)=>[price,i+1]));
    return price=>(Number.isFinite(price)?(rankOf.get(price)||0):0);
  }

  function qhOrderedOffers(model,mfrs){
    return mfrs.map(manufacturer=>{
      const cell=model.cells.get(manufacturer);
      return cell&&Number.isFinite(cell.price)?{...cell,manufacturer}:null;
    }).filter(Boolean).sort((a,b)=>a.price-b.price||a.manufacturer.localeCompare(b.manufacturer,'tr-TR',{numeric:true,sensitivity:'base'}));
  }

  function qhCapacityMarkup(cell){
    if(!cell?.capacityConfirmed)return '';
    const title=qhEn()?'Capacity Confirmed':'Kapasite teyit edildi';
    return `<span class="qhCapacityTick" title="${qhEsc(title)}" aria-label="${qhEsc(title)}">✓</span>`;
  }

  function qhBindImagePreviews(modal){
    modal.querySelectorAll('.qhModelImage').forEach(img=>{
      if(img.dataset.previewBound==='1'||img.dataset.detailPreviewBound==='1')return;
      img.dataset.previewBound='1';
      window.BLImageRuntime?.observe?.(img);
      img.addEventListener('mouseenter',event=>{if(window.BLImageRuntime?.scheduleHover)window.BLImageRuntime.scheduleHover(img,event);else if(typeof kolShowImgPopup==='function')kolShowImgPopup(img.currentSrc||img.src,event);});
      img.addEventListener('mousemove',event=>{const popup=document.getElementById('kolImgPopup');if(popup&&typeof kolPositionPopup==='function')kolPositionPopup(popup,event);});
      img.addEventListener('mouseleave',()=>{if(typeof kolHideImgPopup==='function')kolHideImgPopup();});
    });
  }

  async function qhExportExcel(models,mfrs,viewMode='matrix'){
    const en=qhEn();
    if(window.BLPerf) await window.BLPerf.ensureLibrary('exceljs');
    if(typeof ExcelJS==='undefined'){if(typeof showToast==='function')showToast(en?'The Excel engine could not be loaded.':'Excel motoru yüklenemedi.');return;}
    const wb=new ExcelJS.Workbook(),ws=wb.addWorksheet(en?'Pricing History':'Fiyat Gecmisi');
    const APPROVED_FILL={type:'pattern',pattern:'solid',fgColor:{argb:'FFE7F6EC'}};
    const RANK_FILLS=[
      {type:'pattern',pattern:'solid',fgColor:{argb:'FFFBF0D0'}},
      {type:'pattern',pattern:'solid',fgColor:{argb:'FFECEEF1'}},
      {type:'pattern',pattern:'solid',fgColor:{argb:'FFF6E6D8'}},
    ];
    if(viewMode==='ranked'){
      const maxRank=Math.max(0,...models.map(m=>qhOrderedOffers(m,mfrs).length));
      const head=[en?'Picture':'Görsel',en?'Season':'Sezon','In Store Month',en?'Category':'Kategori',en?'Model Name':'Model Adı',en?'Quantity':'Adet','PLM ID',en?'Target':'Hedef',...Array.from({length:maxRank},(_,i)=>`${i+1}.`)];
      ws.addRow(head);
      models.forEach(m=>{
        const offers=qhOrderedOffers(m,mfrs);
        const row=[m.picture?(en?'Available':'Var'):'',m.season,m.inStoreMonth,m.category,m.model,Number.isFinite(m.quantity)?m.quantity:null,m.plmId,Number.isFinite(m.target)?m.target:null];
        offers.forEach(c=>row.push(`${qhMoney(c.price)} · ${c.manufacturer}`));
        while(row.length<head.length)row.push('');
        const added=ws.addRow(row);
        offers.forEach((cell,i)=>{
          const fill=cell.approved?APPROVED_FILL:(i<3?RANK_FILLS[i]:null);
          if(fill)added.getCell(9+i).fill=fill;
        });
      });
      ws.columns.forEach((col,i)=>{col.width=i===0?11:(i===4?28:(i===3?22:(i===2?18:(i>=8?24:14))));if(i===5)col.numFmt='#,##0';if(i===7)col.numFmt='"$"#,##0.00';});
    }else{
      const head=[en?'Picture':'Görsel',en?'Season':'Sezon','In Store Month',en?'Category':'Kategori',en?'Model Name':'Model Adı',en?'Quantity':'Adet','PLM ID',en?'Target':'Hedef'];
      mfrs.forEach(m=>{head.push(m,`${m} %`);});ws.addRow(head);
      const MFR_FIRST_COL=9;
      models.forEach(m=>{const row=[m.picture? (en?'Available':'Var'):'',m.season,m.inStoreMonth,m.category,m.model,Number.isFinite(m.quantity)?m.quantity:null,m.plmId,Number.isFinite(m.target)?m.target:null];mfrs.forEach(name=>{const c=m.cells.get(name);row.push(c&&Number.isFinite(c.price)?c.price:null);row.push(c&&c.deltaPct!=null?c.deltaPct/100:null);});
        const added=ws.addRow(row);
        const rankFor=qhPriceRanks(m,mfrs);
        mfrs.forEach((name,i)=>{
          const cell=m.cells.get(name);
          if(!cell)return;
          const rank=rankFor(cell.price);
          const fill=cell.approved?APPROVED_FILL:(rank?RANK_FILLS[rank-1]:null);
          if(!fill)return;
          const priceCol=MFR_FIRST_COL+i*2;
          added.getCell(priceCol).fill=fill;
          added.getCell(priceCol+1).fill=fill;
        });
      });
      ws.columns.forEach((col,i)=>{col.width=i===0?11:(i===4?28:(i===3?22:(i===2?18:14)));if(i===5)col.numFmt='#,##0';if(i===7||(i>=8&&(i-8)%2===0))col.numFmt='#,##0.00';if(i>=8&&(i-8)%2===1)col.numFmt='+0.0%;-0.0%;0%';});
    }
    ws.getRow(1).font={bold:true};ws.getRow(1).alignment={vertical:'middle',wrapText:true};
    ws.views=[{state:'frozen',xSplit:5,ySplit:1}];
    const buf=await wb.xlsx.writeBuffer(),stamp=new Date().toISOString().slice(0,10);
    qhDownload(new Blob([buf],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}),`${en?'Pricing_History':'Fiyat_Gecmisi'}_${viewMode==='ranked'?(en?'Price_Order':'Fiyat_Sirasi'):(en?'Manufacturer':'Uretici')}_${stamp}.xlsx`);
  }

  async function openPriceHistory(rows){
    await qReady;
    await qHydrateShared(true);
    const en=qhEn();
    const data=qhCollect(rows);
    const pivot0=qhPivot(data), models=pivot0.models, manufacturers=pivot0.manufacturers;
    document.getElementById('_priceHistoryModal')?.remove();
    const modal=document.createElement('div');
    modal.id='_priceHistoryModal'; modal.className='warnOverlay';
    modal.innerHTML=`<div class="modalCard qhCard" role="dialog" aria-modal="true" aria-labelledby="qhTitle">
      <div class="verHistTop">
        <div>
          <h2 id="qhTitle">${qhEsc(en?'Pricing history':'Fiyat geçmişi')}</h2>
          <p class="verHistSub">${qhEsc(en
            ? `${models.length} model · ${manufacturers.length} manufacturer. Each cell shows the most recent valid quote.`
            : `${models.length} model · ${manufacturers.length} üretici. Her hücrede o üreticinin EN SON geçerli teklifi görünür.`)}</p>
        </div>
        <div class="qhTopActions">
          <div class="qhViewSwitch" role="group" aria-label="${qhEsc(en?'Pricing history view':'Fiyat geçmişi görünümü')}">
            <button type="button" class="qhViewBtn" data-qhview="matrix">${qhEsc(en?'By manufacturer':'Üretici bazlı')}</button>
            <button type="button" class="qhViewBtn isActive" data-qhview="ranked">${qhEsc(en?'Price order':'Fiyat sırası')}</button>
          </div>
          ${window.BLDetailImages?.modelImagesButtonHtml?window.BLDetailImages.modelImagesButtonHtml('qhPlmSync'):''}
          <button type="button" class="verHistClose" data-qh="close" aria-label="${qhEsc(en?'Close':'Kapat')}"><svg class="ic"><use href="#i-x"/></svg></button>
        </div>
      </div>
      <div class="qhTools">
        <input type="search" id="qhSearch" placeholder="${qhEsc(en?'Model, category, PLM ID, season, in-store…':'Model, kategori, PLM ID, sezon, in-store…')}">
        <select id="qhSeason"><option value="">${qhEsc(en?'All seasons':'Tüm sezonlar')}</option>${[...new Set(models.map(m=>m.season).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'tr-TR',{sensitivity:'base'})).map(value=>`<option value="${qhEsc(value)}">${qhEsc(value)}</option>`).join('')}</select>
        <select id="qhMfr"><option value="">${qhEsc(en?'All manufacturers':'Tüm üreticiler')}</option>${manufacturers.map(m=>`<option value="${qhEsc(m)}">${qhEsc(m)}</option>`).join('')}</select>
        <label class="qhChk"><input type="checkbox" id="qhUnder"> ${qhEsc(en?'Only at/below target':'Yalnız hedefin altındakiler')}</label>
        <span class="qhCount" id="qhCount"></span>
        <button type="button" class="tbtn" id="qhExcel"><svg class="ic"><use href="#i-file-export"/></svg>${qhEsc(en?'Excel':'Excel')}</button>
      </div>
      <div class="qhBody">
        ${models.length?'<table class="qhTable qhPivot"><thead></thead><tbody></tbody></table>'
        :`<div class="verHistEmpty">${qhEsc(en?'No pricing has been recorded for the selected models yet.':'Seçili modeller için henüz kayıtlı bir fiyat yok.')}</div>`}
      </div>
      <div class="verHistFoot"><button type="button" class="tbtn" data-qh="close">${qhEsc(en?'Close':'Kapat')}</button></div>
    </div>`;
    document.body.appendChild(modal);

    let sortKey='model', sortDir=1, viewMode='ranked';
    // Fiyat silinince/değişince yeniden hesaplanabilmeli (v5.96).
    let orderedColumnCount=Math.max(0,...models.map(m=>qhOrderedOffers(m,manufacturers).length));
    const $=id=>modal.querySelector('#'+id);
    function visibleModels(){
      const terms=parseTableSearchTerms(($('qhSearch')?.value)||'');
      const season=($('qhSeason')?.value)||'';
      const mfr=($('qhMfr')?.value)||'';
      const under=!!$('qhUnder')?.checked;
      return models.filter(m=>{
        if(season && m.season!==season) return false;
        if(mfr && !m.cells.has(mfr)) return false;
        if(under){
          const cells=mfr?[m.cells.get(mfr)]:[...m.cells.values()];
          if(!cells.some(c=>c&&c.meetsTarget)) return false;
        }
        if(terms.length){
          const hay=`${m.model} ${m.category} ${m.plmId} ${m.season} ${m.inStoreMonth}`.toLocaleLowerCase('tr-TR');
          if(!tableSearchMatches(hay,terms,{plainMode:'contains'})) return false;
        }
        return true;
      });
    }
    function cmp(a,b){
      if(sortKey==='model') return a.model.localeCompare(b.model,'tr-TR',{numeric:true,sensitivity:'base'});
      if(sortKey==='season') return String(a.season).localeCompare(String(b.season),'tr-TR',{numeric:true,sensitivity:'base'});
      if(sortKey==='inStoreMonth') return String(a.inStoreMonth).localeCompare(String(b.inStoreMonth),'tr-TR',{numeric:true,sensitivity:'base'});
      if(sortKey==='category') return String(a.category).localeCompare(String(b.category),'tr-TR',{numeric:true,sensitivity:'base'});
      if(sortKey==='quantity') return (Number(a.quantity)||0)-(Number(b.quantity)||0);
      if(sortKey==='target') return (a.target||0)-(b.target||0);
      if(sortKey.startsWith('mfr:')){
        const name=sortKey.slice(4),pa=a.cells.get(name)?.price,pb=b.cells.get(name)?.price;
        if(!Number.isFinite(pa)&&!Number.isFinite(pb)) return 0;
        if(!Number.isFinite(pa)) return 1*sortDir;
        if(!Number.isFinite(pb)) return -1*sortDir;
        return pa-pb;
      }
      if(sortKey.startsWith('rank:')){
        const index=Number(sortKey.slice(5))||0,pa=qhOrderedOffers(a,manufacturers)[index]?.price,pb=qhOrderedOffers(b,manufacturers)[index]?.price;
        if(!Number.isFinite(pa)&&!Number.isFinite(pb)) return 0;
        if(!Number.isFinite(pa)) return 1*sortDir;
        if(!Number.isFinite(pb)) return -1*sortDir;
        return pa-pb;
      }
      return 0;
    }
    const table=modal.querySelector('.qhTable'),thead=table?.querySelector('thead'),tbody=table?.querySelector('tbody');
    let shown=[];
    function paintHead(){
      if(!thead||!table)return;
      table.classList.toggle('qhOrdered',viewMode==='ranked');
      const tail=viewMode==='ranked'
        ?Array.from({length:orderedColumnCount},(_,i)=>`<th data-qhsort="rank:${i}" class="isNum qhOrderHead"><span>${i+1}.</span><i class="qhArrow"></i></th>`).join('')
        :manufacturers.map(m=>`<th data-qhsort="mfr:${qhEsc(m)}" data-qhmfr="${qhEsc(m)}" draggable="true" class="isNum qhMfrHead" title="${qhEsc(en?'Drag to reorder':'Sırayı değiştirmek için sürükle')}"><span>${qhEsc(m)}</span><i class="qhArrow"></i></th>`).join('');
      thead.innerHTML=`<tr>
        <th class="qhPictureHead"><span>${qhEsc(en?'Picture':'Görsel')}</span></th>
        <th data-qhsort="season"><span>${qhEsc(en?'Season':'Sezon')}</span><i class="qhArrow"></i></th>
        <th data-qhsort="inStoreMonth"><span>In Store Month</span><i class="qhArrow"></i></th>
        <th data-qhsort="category"><span>${qhEsc(en?'Category':'Kategori')}</span><i class="qhArrow"></i></th>
        <th data-qhsort="model"><span>${qhEsc(en?'Model Name':'Model Adı')}</span><i class="qhArrow"></i></th>
        <th data-qhsort="quantity" class="isNum"><span>${qhEsc(en?'Quantity':'Adet')}</span><i class="qhArrow"></i></th>
        <th data-qhsort="target" class="isNum"><span>${qhEsc(en?'Target':'Hedef')}</span><i class="qhArrow"></i></th>${tail}</tr>`;
    }
    function paint(){
      if(!tbody) return;
      shown=visibleModels().sort((a,b)=>{ const c=cmp(a,b); return c!==0?c*sortDir:a.model.localeCompare(b.model,'tr-TR'); });
      tbody.innerHTML=shown.map(m=>{
        let priceCells='';
        if(viewMode==='ranked'){
          const offers=qhOrderedOffers(m,manufacturers);
          priceCells=Array.from({length:orderedColumnCount},(_,i)=>{
            const c=offers[i];if(!c)return '<td class="isNum qhEmpty">—</td>';
            const cls=c.deltaPct==null?'':(c.meetsTarget?'qhGood':'qhBad');
            return `<td class="isNum qhOrderCell qhEditable${c.approved?' qhApproved':''}" data-qh-req="${qhEsc(c.requestId||'')}" data-qh-item="${qhEsc(c.itemId||'')}" data-qh-price="${qhEsc(String(c.price))}" title="${qhEsc(en?'Double-click to edit':'Düzenlemek için çift tıklayın')}"><span class="qhOrderPrice">${qhCapacityMarkup(c)}${qhEsc(qhMoney(c.price))}</span><span class="qhOrderMfr" title="${qhEsc(c.manufacturer)}">${qhEsc(c.manufacturer)}</span><span class="qhDelta ${cls}">${qhEsc(c.deltaText)}</span><button type="button" class="qhCellDrop" data-qh-drop aria-label="${qhEsc(en?'Delete price':'Fiyatı sil')}" title="${qhEsc(en?'Delete price':'Fiyatı sil')}">×</button></td>`;
          }).join('');
        }else{
          const rankFor=qhPriceRanks(m,manufacturers);
          priceCells=manufacturers.map(name=>{
            const c=m.cells.get(name);
            if(!c) return '<td class="isNum qhEmpty">—</td>';
            const cls=c.deltaPct==null?'':(c.meetsTarget?'qhGood':'qhBad');
            const extra=c.count>1?`<span class="qhSub">${c.count} ${qhEsc(en?'quotes':'teklif')}</span>`:'';
            const rank=rankFor(c.price);
            const rankLabel=rank?(en?['Best price','2nd best price','3rd best price'][rank-1]:['En iyi fiyat','En iyi ikinci fiyat','En iyi üçüncü fiyat'][rank-1]):'';
            const medal=rank?`<i class="qhMedal qhMedal${rank}" title="${qhEsc(rankLabel)}" aria-label="${qhEsc(rankLabel)}">${rank}</i>`:'';
            return `<td class="isNum qhEditable${c.approved?' qhApproved':''}" data-qh-req="${qhEsc(c.requestId||'')}" data-qh-item="${qhEsc(c.itemId||'')}" data-qh-price="${qhEsc(String(c.price))}" title="${qhEsc(en?'Double-click to edit':'Düzenlemek için çift tıklayın')}"><span class="qhPrice">${medal}${qhCapacityMarkup(c)}${qhEsc(qhMoney(c.price))}</span><span class="qhDelta ${cls}">${qhEsc(c.deltaText)}</span>${extra}<button type="button" class="qhCellDrop" data-qh-drop aria-label="${qhEsc(en?'Delete price':'Fiyatı sil')}" title="${qhEsc(en?'Delete price':'Fiyatı sil')}">×</button></td>`;
          }).join('');
        }
        return `<tr>
          <td class="qhPictureCell">${qCachedModelThumb(qhSafeImageSrc(m.picture)?m.picture:'',{modelId:m.plmId||m.model,plmId:m.plmId||'',modelName:m.model||'',colourCode:m.colourCode||'',classes:'qhModelImage'})}</td>
          <td>${qhEsc(m.season||'—')}</td><td>${qhEsc(m.inStoreMonth||'—')}</td>
          <td>${qhEsc(m.category||'—')}</td>
          <td>${qhEsc(m.model)}<span class="qhSub">${qhEsc(m.plmId)}</span></td>
          <td class="isNum">${Number.isFinite(m.quantity)?qhEsc(Math.round(m.quantity).toLocaleString(en?'en-GB':'tr-TR')):'—'}</td>
          <td class="isNum">${qhEsc(qhMoney(m.target))}</td>${priceCells}</tr>`;
      }).join('');
      const cnt=$('qhCount');if(cnt)cnt.textContent=`${shown.length} / ${models.length} model`;
      qhBindImagePreviews(modal);
      window.BLDetailImages?.registerScope?.(modal.querySelector('.qhCard'),{contextType:'pricing-history-modal',label:qLang('Fiyat Geçmişi','Pricing History'),identities:shown.map((m,index)=>({plmId:m.plmId||'',styleName:m.model||'',colourCode:m.colourCode||'',rowId:String(index),hasImage:null})),repaint:paint});
      window.BLDetailImages?.bindModelImagesButton?.('qhPlmSync');
      modal.querySelectorAll('[data-qhsort]').forEach(th=>{const active=th.dataset.qhsort===sortKey;th.classList.toggle('isSorted',active);th.classList.toggle('isDesc',active&&sortDir===-1);});
      modal.querySelectorAll('[data-qhview]').forEach(btn=>btn.classList.toggle('isActive',btn.dataset.qhview===viewMode));
    }
    /* Hücre düzenleme ve silme (v5.96).
       Değişiklik quotation kaydına yazılır; ekranı tazelemek için veri
       yeniden toplanır. Böylece madalyalar, hedef farkı ve sıralama da
       yeni fiyata göre yeniden hesaplanır — yalnız hücre metnini
       değiştirmek tabloyu tutarsız bırakırdı. */
    async function qhRefreshFromStore(){
      const fresh=qhCollect(rows);
      const pivot=qhPivot(fresh);
      models.length=0; models.push(...pivot.models);
      manufacturers.length=0; manufacturers.push(...pivot.manufacturers);
      orderedColumnCount=Math.max(0,...models.map(m=>qhOrderedOffers(m,manufacturers).length));
      repaint();
    }
    function qhBeginEdit(cell){
      if(cell.querySelector('.qhCellInput'))return;
      const requestId=cell.dataset.qhReq, itemId=cell.dataset.qhItem;
      if(!requestId||!itemId){ if(typeof showToast==='function')showToast(en?'This price cannot be edited here.':'Bu fiyat burada düzenlenemez.'); return; }
      const current=cell.dataset.qhPrice||'';
      const input=document.createElement('input');
      input.type='text'; input.className='qhCellInput'; input.value=current; input.setAttribute('inputmode','decimal');
      cell.classList.add('qhEditing'); cell.appendChild(input);
      input.focus(); input.select();
      let done=false;
      const finish=async commit=>{
        if(done)return; done=true;
        cell.classList.remove('qhEditing');
        input.remove();
        if(!commit)return;
        const result=await qhUpdatePrice(requestId,itemId,input.value);
        if(result.ok){
          await qhRefreshFromStore();
          if(typeof showToast==='function')showToast(en?'Price updated; the quotation record changed too.':'Fiyat güncellendi; quotation kaydı da değişti.');
        }else if(result.reason==='invalid'&&typeof showToast==='function'){
          showToast(en?'Enter a valid price.':'Geçerli bir fiyat girin.');
        }else if(result.reason==='missing'&&typeof showToast==='function'){
          showToast(en?'The quotation line could not be found.':'Quotation kalemi bulunamadı.');
        }
      };
      input.addEventListener('keydown',event=>{
        if(event.key==='Enter'){ event.preventDefault(); finish(true); }
        // ESC yalnız düzenlemeyi iptal etmeli, pencereyi kapatmamalı.
        else if(event.key==='Escape'){ event.preventDefault(); event.stopPropagation(); finish(false); }
      });
      input.addEventListener('blur',()=>finish(true));
      input.addEventListener('dblclick',event=>event.stopPropagation());
    }
    tbody?.addEventListener('dblclick',event=>{
      const cell=event.target.closest('td.qhEditable');
      if(cell)qhBeginEdit(cell);
    });
    tbody?.addEventListener('click',async event=>{
      const button=event.target.closest('[data-qh-drop]');
      if(!button)return;
      event.preventDefault(); event.stopPropagation();
      const cell=button.closest('td.qhEditable'); if(!cell)return;
      const requestId=cell.dataset.qhReq, itemId=cell.dataset.qhItem;
      if(!requestId||!itemId)return;
      // Onaylı fiyatlar da silinebilir (kullanıcı kararı) ama sessizce değil:
      // silinen satır Quotations ekranından da düşeceği için teyit isteniyor.
      const label=cell.dataset.qhPrice||'';
      if(!window.confirm(en?`Delete this price (${label})? It will be removed from the quotation record too.`:`Bu fiyat (${label}) silinsin mi? Quotation kaydından da düşecek.`))return;
      const result=await qhDropItem(requestId,itemId);
      if(result.ok){
        await qhRefreshFromStore();
        if(typeof showToast==='function')showToast(en?'Price deleted; the quotation record changed too.':'Fiyat silindi; quotation kaydı da değişti.');
      }
    });
    function repaint(){paintHead();paint();}
    /* v6.35 — Üretici sütunlarının sürükle-bırak sıralaması.
       Dinleyiciler thead'e DELEGE edilir: paintHead() her çizimde başlıkları
       yeniden kurduğu için başlık elemanına doğrudan bağlanan dinleyici ilk
       yeniden çizimde kopardı. */
    let qhDragMfr='';
    function qhMoveManufacturer(from,to){
      const source=manufacturers.indexOf(from), target=manufacturers.indexOf(to);
      if(source<0||target<0||source===target)return false;
      manufacturers.splice(target,0,manufacturers.splice(source,1)[0]);
      qhSaveMfrOrder(manufacturers);
      return true;
    }
    thead?.addEventListener('dragstart',e=>{
      const th=e.target.closest('.qhMfrHead');if(!th)return;
      qhDragMfr=th.dataset.qhmfr||'';
      th.classList.add('qhDragging');
      if(e.dataTransfer){e.dataTransfer.effectAllowed='move';try{e.dataTransfer.setData('text/plain',qhDragMfr);}catch(_){}}
    });
    thead?.addEventListener('dragover',e=>{
      if(!qhDragMfr)return;
      const th=e.target.closest('.qhMfrHead');if(!th||th.dataset.qhmfr===qhDragMfr)return;
      e.preventDefault();
      if(e.dataTransfer)e.dataTransfer.dropEffect='move';
      thead.querySelectorAll('.qhDropTarget').forEach(el=>el.classList.remove('qhDropTarget'));
      th.classList.add('qhDropTarget');
    });
    thead?.addEventListener('drop',e=>{
      const th=e.target.closest('.qhMfrHead');
      if(!qhDragMfr||!th){qhDragMfr='';return;}
      e.preventDefault();
      const moved=qhMoveManufacturer(qhDragMfr,th.dataset.qhmfr||'');
      qhDragMfr='';
      if(moved)repaint();
    });
    thead?.addEventListener('dragend',()=>{
      qhDragMfr='';
      thead.querySelectorAll('.qhDragging,.qhDropTarget').forEach(el=>el.classList.remove('qhDragging','qhDropTarget'));
    });
    thead?.addEventListener('click',e=>{
      const th=e.target.closest('[data-qhsort]');if(!th)return;
      const key=th.dataset.qhsort;if(key===sortKey)sortDir=-sortDir;else{sortKey=key;sortDir=1;}paint();
    });
    modal.querySelectorAll('[data-qhview]').forEach(btn=>btn.addEventListener('click',()=>{
      viewMode=btn.dataset.qhview==='ranked'?'ranked':'matrix';
      if((viewMode==='ranked'&&!sortKey.startsWith('rank:'))||(viewMode==='matrix'&&sortKey.startsWith('rank:')))sortKey='model';
      repaint();
    }));
    ['qhSearch','qhSeason','qhMfr','qhUnder'].forEach(id=>{const el=$(id);if(!el)return;el.addEventListener(el.tagName==='INPUT'&&el.type==='search'?'input':'change',paint);});
    $('qhExcel')?.addEventListener('click',async()=>{
      const btn=$('qhExcel');if(btn)btn.disabled=true;
      try{await qhExportExcel(shown,manufacturers,viewMode);}
      catch(err){if(typeof showToast==='function')showToast((en?'Excel export failed: ':'Excel aktarımı başarısız: ')+(err?.message||err));}
      finally{if(btn)btn.disabled=false;}
    });
    repaint();
    const close=()=>{document.removeEventListener('keydown',onKey);if(typeof kolHideImgPopup==='function')kolHideImgPopup();modal.remove();};
    const onKey=e=>{if(e.key==='Escape')close();};
    document.addEventListener('keydown',onKey);
    modal.addEventListener('click',e=>{if(e.target===modal||e.target.closest('[data-qh="close"]'))close();});
    $('qhSearch')?.focus();
  }


  function qRenderWorkspaceDecision(req,items=null){
    const host=document.getElementById('quotationWorkspaceDecision');if(!host||!req)return;
    const visible=Array.isArray(items)?items:qVisibleTableItems(req),live=visible.filter(item=>!item.dropped);
    let line=req.items.find(item=>item.id===qWorkspaceSelectedLineId&&visible.includes(item));
    if(!line)line=live[0]||visible[0]||null;
    if(!line){host.innerHTML=`<div class="pricingEmptyState">${qEsc(qLang('Karar detayını görmek için bir teklif satırı seç.','Select a quotation line to see decision details.'))}</div>`;return;}
    qWorkspaceSelectedLineId=line.id;
    document.querySelectorAll('#quotationDetail [data-quote-line]').forEach(tr=>tr.classList.toggle('isWorkspaceSelected',tr.dataset.quoteLine===line.id));
    const row=qFindCollectionRow(line),history=row?qhCollect([row]):[],hs=qPricingEngine()?.historySummary?.(history)||{};
    const target=qMoneyNumber(qItemTargetPrice(req,line)),current=qMoneyNumber(line.price),best=hs.best;
    const variance=Number.isFinite(target)&&target>0&&Number.isFinite(current)?((current-target)/target)*100:null;
    const histVariance=Number.isFinite(best)&&best>0&&Number.isFinite(current)?((current-best)/best)*100:null;
    const image=qCollectionImageSrc(row,line),imageHtml=image?qCachedModelThumb(image,{modelId:line.plmId||line.modelCode,colourCode:row?.colourCode||'',classes:'pricingDecisionThumb'}):'';
    host.innerHTML=`<div class="pricingPaneTitle">${qEsc(qLang('Karar Paneli','Decision Panel'))}</div><div class="pricingDecisionModel">${imageHtml}<div><b>${qEsc(line.modelCode||line.plmId||line.orderCode||'—')}</b><span>${qEsc(qItemFabric(req,line)||qItemCategory(req,line)||'')}</span></div></div>
      <dl class="pricingDecisionStats"><div><dt>${qEsc(qLang('Hedef Fiyat','Target Price'))}</dt><dd>${Number.isFinite(target)?'$'+qMoneyDisplay(target):'—'}</dd></div><div><dt>${qEsc(qLang('Geçmiş En İyi','Historical Best'))}</dt><dd>${Number.isFinite(best)?'$'+qMoneyDisplay(best):'—'}</dd></div><div><dt>${qEsc(qLang('Teklif Fiyatı','Quotation Price'))}</dt><dd>${Number.isFinite(current)?'$'+qMoneyDisplay(current):'—'}</dd></div><div><dt>${qEsc(qLang('Hedefe Göre','vs Target'))}</dt><dd class="${variance!=null?(variance<=0?'isGood':'isBad'):''}">${variance==null?'—':`${variance>0?'+':''}${variance.toFixed(1)}%`}</dd></div><div><dt>${qEsc(qLang('Geçmiş En İyiye Göre','vs Historical Best'))}</dt><dd class="${histVariance!=null?(histVariance<=0?'isGood':'isBad'):''}">${histVariance==null?'—':`${histVariance>0?'+':''}${histVariance.toFixed(1)}%`}</dd></div><div><dt>${qEsc(qLang('Üretici','Manufacturer'))}</dt><dd>${qEsc(line.manufacturer||'—')}</dd></div></dl>
      <div class="pricingDecisionState"><span class="pricingStatusChip ${line.dropped?'isDanger':line.approved?'isSuccess':qValidPrice(line.price)?'isWarning':'isNeutral'}">${qEsc(line.dropped?qLang('Drop','Dropped'):line.approved?qLang('Onaylı','Approved'):qValidPrice(line.price)?qLang('Karar Bekliyor','Decision Pending'):qLang('Fiyat Bekliyor','Waiting Quote'))}</span></div>
      <div class="pricingDecisionActions"><button type="button" class="tbtn primary" data-q-decision-approve ${qCanEditLine(req,line)&&qValidPrice(line.price)?'':'disabled'}>${qEsc(line.approved?qLang('Onayı Kaldır','Remove Approval'):qLang('Teklifi Onayla','Approve Quote'))}</button>${req.source==='collection'?`<button type="button" class="tbtn" data-q-decision-drop ${qCanEditLine(req,line)?'':'disabled'}>${qEsc(line.dropped?qLang('Drop Kaldır','Remove Drop'):qLang('Drop','Drop'))}</button>`:''}<button type="button" class="tbtn" data-q-decision-history>${qEsc(qLang('Fiyat Geçmişi','Pricing History'))}</button><button type="button" class="tbtn" data-q-decision-collection>${qEsc(qLang('Koleksiyonda Aç','Open in Collection'))}</button></div>`;
    host.querySelector('[data-q-decision-approve]')?.addEventListener('click',()=>qToggleApproval(req,line));
    host.querySelector('[data-q-decision-drop]')?.addEventListener('click',()=>qToggleDrop(req,line));
    host.querySelector('[data-q-decision-history]')?.addEventListener('click',()=>openPricingHistoryWorkspace(row?[row]:qCollectionRowsForRequest(req),{requestId:req.id,itemId:line.id}));
    host.querySelector('[data-q-decision-collection]')?.addEventListener('click',()=>qOpenRequestInCollection(req,line));
  }

  function qHistoryRowsFromContext(rows){
    const selected=Array.isArray(rows)&&rows.length?rows:(Array.isArray(qPricingHistoryRows)&&qPricingHistoryRows.length?qPricingHistoryRows:(window.BLCollection?.rows?.()||[]));
    return selected;
  }
  const PRICING_HISTORY_COLUMNS_KEY='lcw.pricingHistory.columns.v1';
  const PRICING_HISTORY_DEFAULT_COLUMNS=['picture','inStoreMonth','modelKod','manufacturer','urunTipi','season','fob','targetPrice','delta','createdAt','status','source'];
  const PRICING_HISTORY_EXTRA_COLUMNS=[
    {key:'manufacturer',label:'Supplier',labelTr:'Üretici',group:'History',type:'text'},
    {key:'fob',label:'FOB',labelTr:'FOB',group:'History',type:'money'},
    {key:'targetPrice',label:'Target Price',labelTr:'Hedef',group:'History',type:'money'},
    {key:'delta',label:'Δ',labelTr:'Δ',group:'History',type:'percentage'},
    {key:'createdAt',label:'Date',labelTr:'Tarih',group:'History',type:'date'},
    {key:'status',label:'Status',labelTr:'Durum',group:'History',type:'text'},
    {key:'source',label:'Source',labelTr:'Kaynak',group:'History',type:'text'},
  ];
  let qPricingHistoryColumns=null;
  function qHistoryColumnDefinitions(){
    const shared=window.BLCollectionColumns?.catalog?.()||[
      {key:'picture',label:'Picture',type:'image'},
      {key:'inStoreMonth',label:'In Store Month',type:'text'},
      {key:'modelKod',label:'Model Name',type:'text'},
    ];
    const seen=new Set(),all=[];
    [...shared,...PRICING_HISTORY_EXTRA_COLUMNS].forEach(column=>{
      const key=String(column?.key||'').trim();if(!key||seen.has(key))return;
      seen.add(key);all.push({...column,key});
    });
    return all;
  }
  function qHistoryLoadColumns(){
    const valid=new Set(qHistoryColumnDefinitions().map(column=>column.key));
    let saved=null;
    try{saved=JSON.parse(BLStorage.getItem(PRICING_HISTORY_COLUMNS_KEY)||'null');}catch(_){ }
    const values=Array.isArray(saved)?saved:(Array.isArray(saved?.visible)?saved.visible:null);
    const selected=[];
    (values||PRICING_HISTORY_DEFAULT_COLUMNS).forEach(key=>{
      key=String(key||'');if(valid.has(key)&&!selected.includes(key))selected.push(key);
    });
    return selected.length?selected:PRICING_HISTORY_DEFAULT_COLUMNS.filter(key=>valid.has(key));
  }
  function qHistoryVisibleColumns(){
    if(!Array.isArray(qPricingHistoryColumns))qPricingHistoryColumns=qHistoryLoadColumns();
    const definitions=qHistoryColumnDefinitions(),byKey=new Map(definitions.map(column=>[column.key,column]));
    return qPricingHistoryColumns.map(key=>byKey.get(key)).filter(Boolean);
  }
  function qHistorySaveColumns(){
    try{BLStorage.setItem(PRICING_HISTORY_COLUMNS_KEY,JSON.stringify(qPricingHistoryColumns||[]));}catch(_){ }
  }
  function qHistoryColumnLabel(column){
    if(column?.key==='picture')return qLang('Görsel','Picture');
    if(column?.labelTr)return qLang(column.labelTr,column.label||column.key);
    return window.BLCollectionColumns?.label?.(column?.key)||column?.label||column?.key||'';
  }
  function qHistoryRawValue(record,column){
    const key=column?.key;
    if(key==='picture')return record.picture;
    if(key==='modelKod')return record.model;
    if(key==='plmId')return record.plmId;
    if(key==='manufacturer')return record.manufacturer;
    if(key==='fob')return record.price;
    if(key==='targetPrice')return record.target;
    if(key==='delta')return record.deltaPct;
    if(key==='createdAt')return record.createdAt;
    if(key==='status')return record.approved?qLang('Onaylı','Approved'):qLang('Teklif','Quote');
    if(key==='source')return record.source;
    return record.collectionRow?.[key]??record[key]??'';
  }
  function qHistoryCellHtml(column,record){
    const key=column?.key,value=qHistoryRawValue(record,column);
    if(key==='picture'){
      const imageSource=record.collectionRow?qCollectionImageSrc(record.collectionRow):record.picture;
      const image=qCachedModelThumb(imageSource,{modelId:record.plmId||record.model,plmId:record.plmId||'',modelName:record.model||'',colourCode:record.colourCode||'',classes:'pricingHistoryThumb'});
      return `<td class="pricingHistoryPictureCell">${image||'<span class="pricingHistoryImageEmpty">—</span>'}</td>`;
    }
    if(key==='modelKod')return `<td><b>${qEsc(record.model)}</b><small>${qEsc(record.plmId||'')}</small></td>`;
    if(key==='fob')return `<td class="num">$${qEsc(qhMoney(record.price))}</td>`;
    if(key==='targetPrice')return `<td class="num">${Number.isFinite(record.target)?'$'+qEsc(qhMoney(record.target)):'—'}</td>`;
    if(key==='delta')return `<td class="num ${record.deltaPct!=null?(record.deltaPct<=0?'isGood':'isBad'):''}">${record.deltaPct==null?'—':qEsc(`${record.deltaPct>0?'+':''}${record.deltaPct.toFixed(1)}%`)}</td>`;
    if(key==='createdAt')return `<td>${qEsc(qhFmtDate(record.createdAt))}</td>`;
    if(key==='status')return `<td><span class="pricingStatusChip ${record.approved?'isSuccess':'isNeutral'}">${qEsc(record.approved?qLang('Onaylı','Approved'):qLang('Teklif','Quote'))}</span></td>`;
    if(key==='source')return `<td><button type="button" class="linkBtn" data-ph-source="${qEsc(record.requestId)}">${qEsc(record.requestId.slice(-8))}</button></td>`;
    return `<td>${qEsc(value==null||value===''?'—':value)}</td>`;
  }
  function qHistoryColumnsPanelHtml(){
    const visible=new Set(qHistoryVisibleColumns()),ordered=qHistoryColumnDefinitions().slice().sort((a,b)=>{
      const ai=qPricingHistoryColumns.indexOf(a.key),bi=qPricingHistoryColumns.indexOf(b.key);
      return (ai<0?Number.MAX_SAFE_INTEGER:ai)-(bi<0?Number.MAX_SAFE_INTEGER:bi);
    });
    return `<div class="pricingHistoryColumnsHint">${qEsc(qLang('Koleksiyon başlıklarını seçin ve sıralayın.','Choose and reorder Collection headers.'))}</div>${ordered.map(column=>{const index=qPricingHistoryColumns.indexOf(column.key),active=index>=0;return `<div class="pricingHistoryColumnOption"><label><input type="checkbox" data-ph-column-visible="${qEsc(column.key)}"${active?' checked':''}> <span>${qEsc(qHistoryColumnLabel(column))}</span></label>${active?`<button type="button" class="iconBtn" data-ph-column-up="${qEsc(column.key)}"${index?'':' disabled'}>↑</button><button type="button" class="iconBtn" data-ph-column-down="${qEsc(column.key)}"${index<qPricingHistoryColumns.length-1?'':' disabled'}>↓</button>`:''}</div>`;}).join('')}`;
  }
  function qHistoryFilters(data,host){
    const value=id=>qNorm(host.querySelector(id)?.value),model=value('[data-ph-model]'),mfr=value('[data-ph-mfr]'),cat=value('[data-ph-category]'),season=value('[data-ph-season]'),inStoreMonth=value('[data-ph-in-store-month]'),query=value('[data-ph-search]').toLocaleLowerCase('tr-TR');
    return data.filter(r=>(!model||r.model===model)&&(!mfr||r.manufacturer===mfr)&&(!cat||r.category===cat)&&(!season||r.season===season)&&(!inStoreMonth||r.inStoreMonth===inStoreMonth)&&(!query||`${r.model} ${r.manufacturer} ${r.category} ${r.season} ${r.inStoreMonth} ${r.plmId}`.toLocaleLowerCase('tr-TR').includes(query)));
  }
  function qHistoryOptions(values,label){return `<option value="">${qEsc(label)}</option>${[...new Set(values.filter(Boolean))].sort((a,b)=>a.localeCompare(b,'tr-TR',{numeric:true,sensitivity:'base'})).map(v=>`<option value="${qEsc(v)}">${qEsc(v)}</option>`).join('')}`;}
  function qHistoryChart(records){
    const sorted=[...records].sort((a,b)=>String(a.createdAt).localeCompare(String(b.createdAt))).slice(-24);if(!sorted.length)return `<div class="pricingEmptyState">${qEsc(qLang('Grafik için fiyat kaydı yok.','No price records for the chart.'))}</div>`;
    const prices=sorted.map(r=>r.price).filter(Number.isFinite),min=Math.min(...prices),max=Math.max(...prices),range=Math.max(.01,max-min),w=420,h=170,pad=24;
    const pts=sorted.map((r,i)=>{const x=pad+(sorted.length===1?(w-2*pad)/2:i*(w-2*pad)/(sorted.length-1)),y=h-pad-((r.price-min)/range)*(h-2*pad);return {x,y,r};});
    const poly=pts.map(p=>`${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' '),hs=qPricingEngine()?.historySummary?.(records)||{},lineY=n=>h-pad-((n-min)/range)*(h-2*pad);
    return `<svg class="pricingHistoryChartSvg" viewBox="0 0 ${w} ${h}" role="img" aria-label="${qEsc(qLang('Fiyat trendi','Price trend'))}"><g class="grid"><line x1="${pad}" y1="${pad}" x2="${pad}" y2="${h-pad}"/><line x1="${pad}" y1="${h-pad}" x2="${w-pad}" y2="${h-pad}"/></g>${Number.isFinite(hs.average)?`<line class="avg" x1="${pad}" y1="${lineY(hs.average)}" x2="${w-pad}" y2="${lineY(hs.average)}"/>`:''}${Number.isFinite(hs.best)?`<line class="best" x1="${pad}" y1="${lineY(hs.best)}" x2="${w-pad}" y2="${lineY(hs.best)}"/>`:''}<polyline class="series" points="${poly}" fill="none"/>${pts.map(p=>`<circle cx="${p.x}" cy="${p.y}" r="3"><title>${qEsc(`${qhFmtDate(p.r.createdAt)} · ${p.r.manufacturer} · $${qhMoney(p.r.price)}`)}</title></circle>`).join('')}</svg><div class="pricingChartLegend"><span><i class="series"></i>${qEsc(qLang('Teklif','Quote'))}</span><span><i class="avg"></i>${qEsc(qLang('Ortalama','Average'))}</span><span><i class="best"></i>${qEsc(qLang('En iyi','Best'))}</span></div>`;
  }

  function qRenderPricingHistory(host){
    const all=qhCollect(qHistoryRowsFromContext(qPricingHistoryRows)),filtered=qHistoryFilters(all,host),summary=qPricingEngine()?.historySummary?.(filtered)||{};
    const modelOptionSummary=window.BLModelOptionStats?.getModelOptionStats?.(filtered,{modelKey:(row,index)=>window.BLModelOptionStats.modelKey({plmId:row?.plmId,modelKod:row?.model},index),optionMode:'unique',optionKey:row=>row?.identityKey||row?.itemId})||{modelCount:0,optionCount:filtered.length};
    const kpis=host.querySelector('[data-ph-kpis]');if(kpis)kpis.innerHTML=[
      [qLang('Model','Models'),modelOptionSummary.modelCount],[qLang('Opsiyon','Options'),modelOptionSummary.optionCount],[qLang('Geçmiş En İyi','Historical Best'),Number.isFinite(summary.best)?'$'+qhMoney(summary.best)+(summary.bestManufacturer?` · ${summary.bestManufacturer}`:''):'—'],[qLang('Ortalama Fiyat','Average Price'),Number.isFinite(summary.average)?'$'+qhMoney(summary.average):'—'],[qLang('Tedarikçi','Suppliers'),summary.suppliers||0],[qLang('Fiyat Yayılımı','Price Spread'),Number.isFinite(summary.spreadPct)?summary.spreadPct.toFixed(1)+'%':'—']
    ].map(([l,v])=>`<div class="pricingMetric isHistory"><span>${qEsc(l)}</span><b>${qEsc(v)}</b></div>`).join('');
    const columns=qHistoryVisibleColumns(),thead=host.querySelector('[data-ph-head]');if(thead)thead.innerHTML=columns.map(column=>`<th>${qEsc(qHistoryColumnLabel(column))}</th>`).join('');
    const panel=host.querySelector('[data-ph-columns-panel]');if(panel)panel.innerHTML=qHistoryColumnsPanelHtml();
    const table=host.querySelector('[data-ph-body]');if(table)table.innerHTML=filtered.length?filtered.sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))).map(r=>`<tr data-ph-record="${qEsc(r.requestId)}:${qEsc(r.itemId)}" class="${qPricingHistorySelected===`${r.requestId}:${r.itemId}`?'isSelected':''}">${columns.map(column=>qHistoryCellHtml(column,r)).join('')}</tr>`).join(''):`<tr><td colspan="${Math.max(1,columns.length)}"><div class="pricingEmptyState">${qEsc(qLang('Bu filtrelerde fiyat geçmişi bulunamadı.','No pricing history for these filters.'))}</div></td></tr>`;
    const chart=host.querySelector('[data-ph-chart]');if(chart)chart.innerHTML=qHistoryChart(filtered);
    const selected=filtered.find(r=>`${r.requestId}:${r.itemId}`===qPricingHistorySelected)||filtered[0]||null;if(selected)qPricingHistorySelected=`${selected.requestId}:${selected.itemId}`;
    const detail=host.querySelector('[data-ph-detail]');if(detail){
      if(!selected)detail.innerHTML=`<div class="pricingEmptyState">${qEsc(qLang('Bir geçmiş fiyat kaydı seç.','Select a historical price record.'))}</div>`;
      else{const modelRecords=all.filter(r=>r.identityKey===selected.identityKey),hs=qPricingEngine()?.historySummary?.(modelRecords)||{},vsAvg=Number.isFinite(hs.average)&&hs.average>0?((selected.price-hs.average)/hs.average)*100:null,vsBest=Number.isFinite(hs.best)&&hs.best>0?((selected.price-hs.best)/hs.best)*100:null;
        detail.innerHTML=`<h3>${qEsc(selected.model)}</h3><p>${qEsc(selected.manufacturer)} · ${qEsc(qhFmtDate(selected.createdAt))}</p><dl class="pricingDecisionStats"><div><dt>${qEsc(qLang('Seçili Fiyat','Selected Price'))}</dt><dd>$${qEsc(qhMoney(selected.price))}</dd></div><div><dt>${qEsc(qLang('Geçmiş Ortalama','Historical Average'))}</dt><dd>${Number.isFinite(hs.average)?'$'+qEsc(qhMoney(hs.average)):'—'}</dd></div><div><dt>${qEsc(qLang('Geçmiş En İyi','Historical Best'))}</dt><dd>${Number.isFinite(hs.best)?'$'+qEsc(qhMoney(hs.best)):'—'}</dd></div><div><dt>${qEsc(qLang('Ortalamaya Göre','vs Average'))}</dt><dd class="${vsAvg!=null?(vsAvg<=0?'isGood':'isBad'):''}">${vsAvg==null?'—':`${vsAvg>0?'+':''}${vsAvg.toFixed(1)}%`}</dd></div><div><dt>${qEsc(qLang('En İyiye Göre','vs Best'))}</dt><dd class="${vsBest!=null?(vsBest<=0?'isGood':'isBad'):''}">${vsBest==null?'—':`${vsBest>0?'+':''}${vsBest.toFixed(1)}%`}</dd></div></dl><div class="pricingDecisionActions"><button type="button" class="tbtn primary" data-ph-benchmark>${qEsc(qLang('Benchmark Olarak Uygula','Apply as Benchmark'))}</button><button type="button" class="tbtn" data-ph-open-source="${qEsc(selected.requestId)}">${qEsc(qLang('Kaynak Quotation','Source Quotation'))}</button></div>`;
        detail.querySelector('[data-ph-benchmark]')?.addEventListener('click',()=>qApplyHistoryBenchmark(selected));detail.querySelector('[data-ph-open-source]')?.addEventListener('click',()=>qOpenHistorySource(selected.requestId));
      }
    }
    window.BLDetailImages?.registerScope?.(host,{contextType:'pricing-history',label:qLang('Fiyat Geçmişi','Pricing History'),identities:filtered.map((record,index)=>({plmId:record.plmId||'',styleName:record.model||'',colourCode:record.colourCode||'',rowId:`${record.requestId||''}:${record.itemId||index}`,hasImage:null})),repaint:()=>qRenderPricingHistory(host)});
    window.BLDetailImages?.bindThumbs?.(host);
    table?.querySelectorAll('[data-ph-record]').forEach(tr=>tr.addEventListener('click',event=>{if(event.target.closest('button,a,input'))return;qPricingHistorySelected=tr.dataset.phRecord;qRenderPricingHistory(host);}));
    table?.querySelectorAll('[data-ph-source]').forEach(btn=>btn.addEventListener('click',event=>{event.stopPropagation();qOpenHistorySource(btn.dataset.phSource);}));
    panel?.querySelectorAll('[data-ph-column-visible]').forEach(input=>input.addEventListener('change',()=>{const key=input.dataset.phColumnVisible;if(input.checked){if(!qPricingHistoryColumns.includes(key))qPricingHistoryColumns.push(key);}else if(qPricingHistoryColumns.length>1)qPricingHistoryColumns=qPricingHistoryColumns.filter(item=>item!==key);qHistorySaveColumns();qRenderPricingHistory(host);}));
    panel?.querySelectorAll('[data-ph-column-up],[data-ph-column-down]').forEach(button=>button.addEventListener('click',()=>{const key=button.dataset.phColumnUp||button.dataset.phColumnDown,index=qPricingHistoryColumns.indexOf(key),step=button.dataset.phColumnUp?-1:1;if(index<0)return;const target=index+step;if(target<0||target>=qPricingHistoryColumns.length)return;[qPricingHistoryColumns[index],qPricingHistoryColumns[target]]=[qPricingHistoryColumns[target],qPricingHistoryColumns[index]];qHistorySaveColumns();qRenderPricingHistory(host);}));
  }

  function qOpenHistorySource(requestId){qActiveId=requestId;qStatusFilter='all';if(typeof switchTab==='function')switchTab('quotations');}
  function qApplyHistoryBenchmark(record){
    const found=qhFindItem(record.requestId,record.itemId),row=found?qFindCollectionRow(found.item):null;if(!row){if(typeof showToast==='function')showToast(qLang('Collection modeli bulunamadı.','Collection model was not found.'));return false;}
    if(typeof kolWorkspaceCanEdit!=='undefined'&&!kolWorkspaceCanEdit){if(typeof showToast==='function')showToast(qLang('Bu Collection üzerinde düzenleme yetkin yok.','You do not have editing permission for this Collection.'));return false;}
    if(!confirm(qLang(`${record.model} için $${qhMoney(record.price)} geçmiş fiyatı Hedef Fiyat olarak kullanılsın mı?`,`Use historical price $${qhMoney(record.price)} as Target Price for ${record.model}?`)))return false;
    row.targetPrice=qMoneyDisplay(record.price);if(typeof saveKolRows==='function')saveKolRows();if(typeof renderKol==='function')renderKol();if(typeof showToast==='function')showToast(qLang('Geçmiş fiyat Hedef Fiyat olarak uygulandı.','Historical price was applied as Target Price.'));return true;
  }

  async function mountPricingHistory(host,{preserveContext=true,rows=null}={}){
    if(!host)return false;await qReady;await qHydrateShared(true);qWorkspaceMounted=false;qWorkspaceMode='pricinghistory';if(Array.isArray(rows)&&rows.length)qPricingHistoryRows=rows;else if(!preserveContext)qPricingHistoryRows=null;
    const base=qhCollect(qHistoryRowsFromContext(qPricingHistoryRows));qPricingHistoryColumns=qHistoryLoadColumns();
    host.innerHTML=`<div class="pricingWorkspaceShell pricingHistoryShell"><div class="pricingWorkspaceHeader"><div><h1>${qEsc(qLang('Fiyat Geçmişi','Pricing History'))}</h1><p>${qEsc(qLang('Geçmiş fiyatları aktif benchmark ve karar desteği olarak kullan.','Use historical prices as active benchmarks and decision support.'))}</p></div><div class="pricingWorkspaceHeaderActions">${window.BLDetailImages?.modelImagesButtonHtml?window.BLDetailImages.modelImagesButtonHtml('pricingHistoryPlmSync'):''}<button type="button" class="tbtn" data-ph-back><svg class="ic"><use href="#i-chevron-left"/></svg>${qEsc(qLang('Koleksiyona Dön','Back to Collection'))}</button><button type="button" class="tbtn" data-ph-open-quotes>${qEsc(qLang('Quotations Aç','Open Quotations'))}</button><button type="button" class="tbtn" data-ph-export><svg class="ic"><use href="#i-file-export"/></svg>${qEsc(qLang('Excel','Export'))}</button></div></div>
      <div class="pricingHistoryFilters"><input type="search" data-ph-search placeholder="${qEsc(qLang('Model, üretici veya kategori ara…','Search model, supplier or category…'))}"><select data-ph-model>${qHistoryOptions(base.map(r=>r.model),qLang('Tüm Modeller','All Models'))}</select><select data-ph-mfr>${qHistoryOptions(base.map(r=>r.manufacturer),qLang('Tüm Üreticiler','All Suppliers'))}</select><select data-ph-category>${qHistoryOptions(base.map(r=>r.category),qLang('Tüm Kategoriler','All Categories'))}</select><select data-ph-season>${qHistoryOptions(base.map(r=>r.season),qLang('Tüm Sezonlar','All Seasons'))}</select><select data-ph-in-store-month>${qHistoryOptions(base.map(r=>r.inStoreMonth),qLang('Tüm In Store Month','All In Store Month'))}</select></div>
      <div class="pricingWorkspaceKpis" data-ph-kpis></div><div class="pricingHistoryGrid"><div class="pricingHistoryTablePane"><div class="pricingPaneTitle pricingHistoryTableTitle"><span>${qEsc(qLang('Geçmiş Fiyat Kayıtları','Historical Price Records'))}</span><button type="button" class="tbtn" data-ph-columns>${qEsc(qLang('Sütunlar','Columns'))}</button></div><div class="pricingHistoryColumnsPanel" data-ph-columns-panel hidden></div><div class="pricingHistoryTableWrap"><table class="pricingHistoryTable"><thead><tr data-ph-head></tr></thead><tbody data-ph-body></tbody></table></div></div><aside class="pricingHistoryAnalysis"><div class="pricingPaneTitle">${qEsc(qLang('Fiyat Trendi','Price Trend'))}</div><div data-ph-chart></div><div class="pricingPaneTitle">${qEsc(qLang('Seçili Fiyat Karşılaştırması','Selected Price Comparison'))}</div><div data-ph-detail></div></aside></div></div>`;
    host.querySelectorAll('[data-ph-search],[data-ph-model],[data-ph-mfr],[data-ph-category],[data-ph-season],[data-ph-in-store-month]').forEach(el=>el.addEventListener(el.tagName==='INPUT'?'input':'change',()=>qRenderPricingHistory(host)));
    window.BLDetailImages?.bindModelImagesButton?.('pricingHistoryPlmSync');
    host.querySelector('[data-ph-columns]')?.addEventListener('click',()=>{const panel=host.querySelector('[data-ph-columns-panel]');if(panel)panel.hidden=!panel.hidden;});
    host.querySelector('[data-ph-back]')?.addEventListener('click',()=>{if(typeof switchTab==='function')switchTab('koleksiyon');});host.querySelector('[data-ph-open-quotes]')?.addEventListener('click',()=>{if(typeof switchTab==='function')switchTab('quotations');});
    host.querySelector('[data-ph-export]')?.addEventListener('click',async event=>{const btn=event.currentTarget;btn.disabled=true;try{const data=qHistoryFilters(qhCollect(qHistoryRowsFromContext(qPricingHistoryRows)),host),pivot=qhPivot(data);await qhExportExcel(pivot.models,pivot.manufacturers,'ranked');}finally{btn.disabled=false;}});
    qRenderPricingHistory(host);return true;
  }
  async function openPricingHistoryWorkspace(rows=null,context={}){if(Array.isArray(rows)&&rows.length)qPricingHistoryRows=rows;qPricingHistorySelected=context.requestId&&context.itemId?`${context.requestId}:${context.itemId}`:null;if(typeof switchTab==='function')switchTab('pricinghistory');return true;}

  function syncCollectionPricingUI(){
    // Collection V3 is intentionally spreadsheet-first. Pricing Workspace V2
    // used to inject a KPI action band and a right Selection Summary panel here.
    // Keep this exported hook only for backward compatibility and to remove stale
    // nodes after hot upgrades; pricing calculations remain canonical for the
    // Quotations and Pricing History workspaces.
    const toolbar=document.getElementById('kolTableToolbar');
    const panel=toolbar?.closest('.panel');
    const layout=document.getElementById('kolPricingLayout');
    if(layout&&panel&&layout.parentNode){
      layout.parentNode.insertBefore(panel,layout);
      layout.remove();
    }else{
      document.getElementById('kolPricingSelectionSummary')?.remove();
    }
    document.getElementById('kolPricingActionBar')?.remove();
    return true;
  }

  window.BL_QUOTATIONS={openPriceHistory,openPricingHistoryWorkspace,mountPricingHistory,mountWorkspace,openWorkspaceFromCollection,openSendToPricing,syncCollectionPricingUI,recordRequest,recordManualCollectionPrice,open:openModal,save:qSave,refresh:()=>qHydrateShared(true),renameManufacturer,syncModelFields,setPrice,toggleApproval,findCollectionLine,updateCollectionLine,sendReminder(requestId){const req=qLoad().requests.find(r=>r.id===requestId);return req?qOpenReminder(req):false;},toggleDrop(requestId,lineId){const req=qLoad().requests.find(r=>r.id===requestId),line=req?.items.find(x=>x.id===lineId);return req&&line?qToggleDrop(req,line):false;},exportRequest(requestId){const req=qLoad().requests.find(r=>r.id===requestId);return req?qExportRequest(req):false;},moveRequest:qMoveRequest,deleteRequest:qDeleteRequest};
})();
