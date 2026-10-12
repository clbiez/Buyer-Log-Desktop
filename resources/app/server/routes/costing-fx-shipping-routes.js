'use strict';

/* Ön Maliyet, Aylık Döviz Kurları ve Nakliye Kıyaslaması route'ları
   server.js'ten birebir taşındı (davranış değişikliği yok). Kayıt, server.js'te
   blokların eskiden durduğu satırda yapılır; Express route SIRASI korunur.
   Bağımlılıklar kayıt anında enjekte edilir; çalışma sırasında yeniden atanan
   değerler (yok) canlı okuyucu fonksiyonla okunur. */
module.exports = function registerCostingFxShippingRoutes(app, deps) {
  const {
    addShippingRows,
    apiError,
    createOpenCosting,
    currentUserIsModerator,
    deleteOpenCosting,
    deleteShippingRows,
    fxMonthResolved,
    loadFx,
    loadOpenCostings,
    openCostingService,
    shippingWorkflowService,
    loadShipping,
    patchShippingRow,
    publishSharedMasterChange,
    recordOrderCode,
    rejectUnauthorizedOrders,
    requestRevision,
    saveFx,
    sourceUserId,
    updateOpenCosting,
    userAccess,
    withOrderAccess,
  } = deps;


// ---- Open Costing ----
const costingGuard=req=>({assertAuthority:()=>{const current=userAccess.profileById(req.currentUser.id);if(!current||current.enabled===false||!userAccess.hasArea(current,'opencosting'))throw Object.assign(new Error('PERMISSION_REQUIRED'),{code:'PERMISSION_REQUIRED',statusCode:403});return current;}});
const costingExpected=req=>{const revision=requestRevision(req);return revision==null?null:{revision};};
app.get('/api/open-costing', userAccess.requireArea('opencosting'), async(req,res)=>{try{res.json((await openCostingService.snapshot(costingGuard(req))).store);}catch(err){apiError(res,err,'Ön maliyet okunamadı.');}});
app.post('/api/open-costing', userAccess.requireArea('opencosting'), async(req,res)=>{try{const saved=await openCostingService.execute('create',{record:req.body||{}},costingExpected(req),costingGuard(req),{native:true});res.json({items:saved.store.items,item:saved.item,_revision:saved.revision});}catch(err){apiError(res,err,'Ön maliyet kaydedilemedi.');}});
app.put('/api/open-costing/:id', userAccess.requireArea('opencosting'), async(req,res)=>{try{const saved=await openCostingService.execute('update',{id:req.params.id,record:req.body||{}},costingExpected(req),costingGuard(req),{native:true});res.json({items:saved.store.items,item:saved.item,_revision:saved.revision});}catch(err){apiError(res,err,'Ön maliyet güncellenemedi.');}});
app.delete('/api/open-costing/:id', userAccess.requireArea('opencosting'), async(req,res)=>{try{const saved=await openCostingService.execute('delete',{id:req.params.id},costingExpected(req),costingGuard(req),{native:true});res.json({items:saved.store.items,_revision:saved.revision});}catch(err){apiError(res,err,'Ön maliyet silinemedi.');}});

// ---- Aylık Döviz Kurları (FX) ----
app.get('/api/fx',userAccess.requireAnyArea('source','opencosting','koleksiyon'),(_req,res)=>{res.set('Cache-Control','no-store, no-cache, must-revalidate');res.json(loadFx());});
app.put('/api/fx', userAccess.requireAnyArea('source','opencosting','koleksiyon'), userAccess.requirePermission('manageBusinessRules'), (req, res) => { try { const saved=saveFx(req.body || {}, requestRevision(req)); publishSharedMasterChange('fx', req); userAccess.appendAudit(req.currentUser,'FX_UPDATE','rates',{revision:saved._revision}); res.json(saved); } catch (err) { apiError(res, err, 'Döviz kurları kaydedilemedi.'); } });
app.get('/api/fx/resolve/:month', userAccess.requireAnyArea('source','opencosting','koleksiyon'), (req, res) => { const store = loadFx(); const r = fxMonthResolved(store, req.params.month); res.json({ base: store.base, month: r.month, requestedMonth: req.params.month, exact: r.exact, rates: r.rates, _revision: store._revision }); });

// ---- Nakliye Tipine Göre Maliyet Kıyaslaması ----
const shippingGuard=req=>({ownerId:sourceUserId(req),profile:req.currentUser,assertAuthority:()=>{const current=userAccess.profileById(req.currentUser.id);if(!current||current.enabled===false||!userAccess.hasArea(current,'shipping'))throw Object.assign(new Error('AREA_FORBIDDEN'),{code:'AREA_FORBIDDEN',statusCode:403});req.currentUser=current;return current;}});
const shippingExpected=req=>({revision:requestRevision(req)});
const shippingResponse=(req,res,saved)=>res.json({...saved.store,...saved.ingestion,rows:saved.store.rows.map(row=>withOrderAccess(req,row))});
app.get('/api/shipping-comparison',userAccess.requireArea('shipping'),async(req,res)=>{try{const state=await shippingWorkflowService.snapshot(shippingGuard(req));res.json({...state.store,rows:state.store.rows.map(row=>withOrderAccess(req,row))});}catch(err){apiError(res,err,'Nakliye satırları okunamadı.');}});
app.post('/api/shipping-comparison',userAccess.requireArea('shipping'),async(req,res)=>{
 const rows=req.body?.rows;if(!Array.isArray(rows)||!rows.length)return res.status(400).json({error:'rows (dizi) zorunlu.'});
 try{const saved=await shippingWorkflowService.execute('add',{rows:rows.map(({_canEdit,_inherited,...row})=>row)},shippingExpected(req),shippingGuard(req),{native:true});userAccess.appendAudit(req.currentUser,'SHIPPING_ADD','orders',{count:rows.length,orderCodes:saved.affectedOrderCodes});shippingResponse(req,res,saved);}catch(err){apiError(res,err,'Nakliye satırları eklenemedi.');}
});
app.patch('/api/shipping-comparison/:shipId',userAccess.requireArea('shipping'),async(req,res)=>{
 try{const saved=await shippingWorkflowService.execute('update',{id:req.params.shipId,patch:(({_canEdit,_inherited,...patch})=>patch)(req.body||{})},shippingExpected(req),shippingGuard(req),{native:true});userAccess.appendAudit(req.currentUser,'SHIPPING_UPDATE','order',{shipId:req.params.shipId,orderCode:saved.affectedOrderCodes[0]??null});shippingResponse(req,res,saved);}catch(err){apiError(res,err,'Nakliye satırı güncellenemedi.');}
});
app.post('/api/shipping-comparison/delete',userAccess.requireArea('shipping'),async(req,res)=>{
 const ids=req.body?.ids;if(!Array.isArray(ids)||!ids.length)return res.status(400).json({error:'ids (dizi) zorunlu.'});
 try{const saved=await shippingWorkflowService.execute('delete',{ids},shippingExpected(req),shippingGuard(req),{native:true});userAccess.appendAudit(req.currentUser,'SHIPPING_DELETE','orders',{count:saved.count,orderCodes:saved.affectedOrderCodes});shippingResponse(req,res,saved);}catch(err){apiError(res,err,'Nakliye satırları silinemedi.');}
});

};
