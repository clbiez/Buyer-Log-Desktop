'use strict';
/* Test Raporu Aktarımı (sürükle-bırak).
   GET  /api/test-reports          → depolanan raporlar, bağlantılar, tip eşlemesi
   POST /api/test-reports/parse    → dosyaları okur, önizleme için rapor döner
                                     (hiçbir şey kalıcı yazılmaz)
   POST /api/test-reports/commit   → kullanıcının onayladığı kalemleri yazar,
                                     ekleri checklist ek deposuna koyar
   Yetki: ek yükleme ile aynı alanlar (cp, orders); satır düzenleme yetkisi
   hem sunucuda gerçek sipariş kimliğiyle hem istemcide uygulanır. */

const {createService}=require('../lib/test-reports/service');
const store = require('../lib/test-reports/store');
const staging = require('../lib/test-reports/staging');


function imageType(buffer) {
  if (buffer[0] === 0x89) return 'image/png';
  if (buffer[0] === 0xFF) return 'image/jpeg';
  return 'image/webp';
}

module.exports = function registerTestReportRoutes(app, deps) {
  const {
    automationError,
    express,
    userAccess,
  } = deps;
  const service=deps.service || createService({authorizedOrders:deps.authorizedOrders,authorizedOrdersNow:deps.authorizedOrdersNow || (()=>{
    throw Object.assign(new Error('Test raporu yetkisi doğrulanamıyor. / Test report permission cannot be verified.'),{code:'TEST_REPORT_AUTH_UNAVAILABLE',statusCode:503});
  }),audit:userAccess.appendAudit});
  const userId = req => String(req.currentUser && req.currentUser.id || '');
  const authorizedOrders = async (req,write=false) => {
    if (typeof deps.authorizedOrders !== 'function') throw Object.assign(new Error('Order authorization is unavailable.'), { code:'TEST_REPORT_AUTH_UNAVAILABLE', statusCode:503 });
    return deps.authorizedOrders(req.currentUser,{write});
  };

app.get('/api/test-reports', userAccess.requireAnyArea('cp', 'orders', 'overview'), async (req, res) => {
    try {
      const allowed=await authorizedOrders(req),payload=store.publicPayload(new Set(allowed.keys()));
      res.set('Cache-Control', 'no-store').json(payload);
    }
    catch (err) { automationError(res, err, 'Test raporları okunamadı.'); }
  });

app.get('/api/test-reports/tasks', userAccess.requireAnyArea('cp', 'orders', 'overview'), async (req, res) => {
    try {
      const tasks=store.tasks();
      // An empty task store has no order data to disclose. The area middleware
      // still runs; avoid rebuilding the entire Orders model just to return [].
      if(!tasks.length)return res.set('Cache-Control','no-store').json({tasks:[]});
      const allowed=await authorizedOrders(req);
      res.set('Cache-Control', 'no-store').json({ tasks: tasks.filter(task=>allowed.has(task.orderKey)) });
    }
    catch (err) { automationError(res, err, 'Test raporu görevleri okunamadı.'); }
  });

app.post('/api/test-reports/parse', userAccess.requireAnyArea('cp', 'orders'), express.json({ limit: '160mb' }), async (req, res) => {
  try {res.set('Cache-Control','no-store').json(await service.parse(req.currentUser,req.body?.files));}
  catch(err){automationError(res,err,'Test raporları okunamadı.');}
});

/* LCW AI'a yüklenecek geçici dosya (yalnız oturumu açan kullanıcı). */
app.get('/api/test-reports/staged/:sessionId/:fileId', userAccess.requireAnyArea('cp', 'orders'), (req, res) => {
    const session = staging.getSession(req.params.sessionId, userId(req));
    const file = session && session.files.get(String(req.params.fileId || ''));
    if (!file) return res.status(404).json({ error: 'Dosya bulunamadı.', code: 'TEST_REPORT_STAGED_NOT_FOUND' });
    const type = file.kind === 'pdf' ? 'application/pdf' : file.kind === 'image' ? imageType(file.buffer) : 'application/octet-stream';
    res.set('Cache-Control', 'private, no-store').type(type).send(file.buffer);
  });

/* LCW AI okuma sonucu: AI cevabı motorun doğrulayıcısından (aynı rapor
   şeması) geçer ve önizleme oturumuna eklenir. Yazma yine /commit ile ve
   yalnız kullanıcı onayıyla olur. */
app.post('/api/test-reports/ai-report', userAccess.requireAnyArea('cp', 'orders'), express.json({ limit: '512kb' }), (req, res) => {
  try {res.set('Cache-Control','no-store').json(service.acceptAi(req.currentUser,req.body||{}));}
  catch(err){automationError(res,err,'LCW AI okuması doğrulanamadı.');}
});

app.post('/api/test-reports/prepare-review', userAccess.requireAnyArea('cp', 'orders'), express.json({ limit: '24mb' }), async (req, res) => {
  try {res.set('Cache-Control','no-store').json(await service.prepareAssessment(req.currentUser,req.body||{}));}
  catch(err){automationError(res,err,'İnceleme bağlamı hazırlanamadı.');}
});
app.post('/api/test-reports/ai-assessment', userAccess.requireAnyArea('cp', 'orders'), express.json({ limit: '4mb' }), async (req, res) => {
  try {res.set('Cache-Control','no-store').json(await service.acceptAssessment(req.currentUser,req.body||{}));}
  catch(err){automationError(res,err,'LCW AI incelemesi doğrulanamadı.');}
});

app.post('/api/test-reports/commit', userAccess.requireAnyArea('cp', 'orders'), express.json({ limit: '2mb' }), async (req, res) => {
  try {res.json(await service.commit(req.currentUser,req.body||{}));}
  catch(err){automationError(res,err,'Test raporları kaydedilemedi.');}
});
};
