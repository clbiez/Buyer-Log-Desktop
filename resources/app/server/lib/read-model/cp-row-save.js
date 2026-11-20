'use strict';
/* POST /api/overrides/rows — CP satır kaydı (#1078 WS5 alt PR 3).
 *
 * Gövde: { items:[{ orderCode, patch:{ model, ccode, notes?, delType?, subManufacturer?, licensor?,
 *   noteColumns?, dates? }, base:{ aynı alanların düzenleme öncesi KAYITLI değeri } }] }  (≤ 500)
 * Yanıt (200, kısmi başarı mümkün):
 *   { ok:true, applied:[{orderCode,key,noop,current}], conflicts:[{orderCode,model,ccode,key,fields,current}],
 *     revision, revisions:{orders,suppFob} }
 *   Tam belge (overrides) DÖNMEZ; istemci yalnız kendi satırlarının güncel kayıtlı değerini alır.
 * Karşılaştırma ve yazma: db.patchOrderOverrideRows (alan bazlı; global If-Match KULLANILMAZ).
 * Yetki ve kurallar mevcut PATCH /api/overrides ile aynıdır: oturum, sipariş düzenleme kapsamı
 * (rejectUnauthorizedOrders), ortak sahip alanları (rejectSharedOwnerWrites), otomatik tarih
 * koruması. Yan etkiler aynıdır ve YALNIZ gerçekten yazılan satırlar için çalışır: ortak revizyon
 * bildirimi (cpOverrides), projeksiyon önbelleği satır yaması, denetim kaydı, canlı olay
 * (rowPatches — diğer sekme/kullanıcılara yalnız değişen satırlar).
 * Hatalar: 400 VALIDATION_ERROR / CP_ROW_SAVE_FIELD_UNSUPPORTED · 403 ORDER_VIEW_ONLY /
 *   ORDER_SHARED_OWNER_ONLY · 409 AUTOMATIC_DATE_READ_ONLY. Çakışma 409 değildir: satır bazında döner. */
const MAX_ITEMS=500;
const PATCH_KEYS=new Set(['model','ccode','notes','delType','subManufacturer','licensor','noteColumns','dates']);
const DATE_KEYS=new Set(['exFactory','retailDate','inStoreDate']);

function invalid(message,detail,code='VALIDATION_ERROR'){
  return Object.assign(new Error(message),{code,statusCode:400,detail});
}
const isObject=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const textOrNull=value=>value==null||typeof value==='string'||typeof value==='number';
function validateItems(raw){
  if(!isObject(raw)||!Array.isArray(raw.items)||!raw.items.length||raw.items.length>MAX_ITEMS)throw invalid('items (1–500) zorunlu. / items (1–500) required.','items');
  return raw.items.map((item,i)=>{
    const where=`items[${i}]`;
    if(!isObject(item)||!isObject(item.patch)||!isObject(item.base))throw invalid('Geçersiz satır kaydı. / Invalid row save.',where);
    const orderCode=Number(item.orderCode);
    if(!Number.isSafeInteger(orderCode)||orderCode<=0)throw invalid('Geçerli sipariş kodu zorunlu. / A valid order code is required.',`${where}.orderCode`);
    const patch=item.patch;
    for(const key of Object.keys(patch))if(!PATCH_KEYS.has(key))throw invalid('Bu alan satır kaydıyla gönderilemez. / This field cannot be sent with a row save.',`${where}.patch.${key}`,'CP_ROW_SAVE_FIELD_UNSUPPORTED');
    // Satır kimliği zorunlu: sipariş düzeyi (tüm renkleri kapsayan) yazma bu yolla yapılmaz.
    if(typeof patch.model!=='string'||!patch.model.trim()||typeof patch.ccode!=='string'||!patch.ccode.trim())throw invalid('Model ve renk kodu zorunlu. / Model and colour code are required.',`${where}.patch.model`);
    for(const field of ['delType','subManufacturer','licensor'])if(Object.hasOwn(patch,field)&&!textOrNull(patch[field]))throw invalid('Geçersiz alan. / Invalid field.',`${where}.patch.${field}`);
    for(const group of ['notes','noteColumns','dates']){
      if(!Object.hasOwn(patch,group))continue;
      if(!isObject(patch[group]))throw invalid('Geçersiz alan. / Invalid field.',`${where}.patch.${group}`);
      for(const [key,value]of Object.entries(patch[group])){
        if(group==='dates'&&!DATE_KEYS.has(key))throw invalid('Geçersiz tarih alanı. / Invalid date field.',`${where}.patch.dates.${key}`);
        if(group==='dates'&&value!=null&&value!==''&&!/^\d{4}-\d{2}-\d{2}$/.test(String(value)))throw invalid('Geçersiz tarih. / Invalid date.',`${where}.patch.dates.${key}`);
        if(!textOrNull(value))throw invalid('Geçersiz alan. / Invalid field.',`${where}.patch.${group}.${key}`);
      }
    }
    return {orderCode,patch,base:item.base};
  });
}

/* deps: { patchRows(items,{actor}), rejectUnauthorizedOrders(req,res,codes), rejectSharedOwnerWrites(req,res,items),
     ensureAutomaticDateSource(req,items), assertAutomaticDatesReadOnly(user,items), pageProjectionContext(user),
     queueProjectionCacheRowPatches(user,before,items,label,rowPatch), notifyShared(user),
     readContextHashOf(projectionContext)?, recordRowPatches({user,before,items})? (okuma modeli satır yaması günlüğü), appendAudit(user,action,target,detail),
     notifyLive(req,rowPatches), liveRowPatchesFor(items), noteActorOf(user), apiError(res,err,fallback) } */
function registerCpRowSaveRoute(app,deps){
  app.post('/api/overrides/rows',async(req,res)=>{
    const started=process.hrtime.bigint();
    try{
      const items=validateItems(req.body);
      if(deps.rejectUnauthorizedOrders(req,res,items.map(item=>item.orderCode)))return;
      if(deps.rejectSharedOwnerWrites(req,res,items))return;
      await deps.ensureAutomaticDateSource(req,items);
      deps.assertAutomaticDatesReadOnly(req.currentUser,items);
      const before=deps.pageProjectionContext(req.currentUser);
      const readBefore=typeof deps.readContextHashOf==='function'?deps.readContextHashOf(before):null;
      const saved=deps.patchRows(items,{actor:deps.noteActorOf(req.currentUser)});
      const written=saved.applied.filter(item=>!item.noop).map(item=>({orderCode:item.orderCode,patch:item.patch}));
      // Okuma modeli satır yaması (cp-row-patch-log): yazımın hemen ardından, bağlam başka bir yazımla kaymadan.
      const rowPatch=written.length&&readBefore&&typeof deps.recordRowPatches==='function'?deps.recordRowPatches({user:req.currentUser,before:readBefore,items:written}):null;
      let pageCachePatchQueued=false;
      if(written.length){
        deps.notifyShared(req.currentUser);
        pageCachePatchQueued=deps.queueProjectionCacheRowPatches(req.currentUser,before,written,'cpRowSaveProjectionCachePatch',rowPatch);
        deps.appendAudit(req.currentUser,'ORDER_ROW_UPDATE','orders',{orderCodes:[...new Set(written.map(item=>item.orderCode))].slice(0,200),count:written.length,conflicts:saved.conflicts.length});
        deps.notifyLive(req,deps.liveRowPatchesFor(written));
      }else if(saved.conflicts.length){
        deps.appendAudit(req.currentUser,'ORDER_ROW_CONFLICT','orders',{orderCodes:[...new Set(saved.conflicts.map(item=>item.orderCode))].slice(0,200),count:saved.conflicts.length});
      }
      res.set('Cache-Control','no-store');
      // Kayıt süresi sunucu tarafında (tarayıcıdaki toplamla karşılaştırılır: bağlantı/kuyruk beklemesi ayrışır).
      res.set('Server-Timing',`rowsave;dur=${(Number(process.hrtime.bigint()-started)/1e6).toFixed(1)}`);
      res.json({ok:true,applied:saved.applied.map(({orderCode,key,noop,current})=>({orderCode,key,noop,current})),conflicts:saved.conflicts,
        revision:saved.revision,revisions:saved.revisions,pageCachePatchQueued});
    }catch(err){
      if(err&&err.statusCode===400)return res.status(400).json({ok:false,code:err.code,error:String(err.message).split(' / ')[0],errorEn:String(err.message).split(' / ')[1]||err.message,detail:err.detail});
      deps.apiError(res,err,'CP satır kaydı yapılamadı.');
    }
  });
}
module.exports={registerCpRowSaveRoute,validateItems,MAX_ITEMS};
