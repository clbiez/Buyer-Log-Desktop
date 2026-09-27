'use strict';
/* Global Flow Map · Earth 3D motoru regresyonları.
   Buyer Log haritası ile Earth aynı akış modelini paylaşır; Earth lazy
   yüklenir, görünmezken durur, sağlayıcı anahtarı kaynağa/tercihlere yazılmaz. */
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const flow=require('../public/overview-global-flow.js');
const earth=require('../public/overview-global-flow-earth.js');
const ROOT=path.join(__dirname,'..');
const read=rel=>fs.readFileSync(path.join(ROOT,rel),'utf8');
const INDEX=read('public/index.html');
const SOURCE=read('public/overview-global-flow.js');
const EARTH=read('public/overview-global-flow-earth.js');
const CSS=read('public/overview-global-flow.css');
const PERF=read('public/perf-runtime.js');
const SERVER=read('server/server.js');
const near=(a,b,eps)=>Math.abs(a-b)<=(eps||1e-6);

test('Earth tercihleri normalize edilir; bozuk kamera/katman değerleri güvenli varsayılana döner',()=>{
  const d=flow.normalizeEarthPrefs();
  assert.equal(d.viewMode,'');assert.equal(d.quality,'balanced');assert.equal(d.cameraPreset,'perspective');assert.equal(d.routeAnimation,true);assert.equal(d.camera,null);
  assert.deepEqual(Object.keys(d.layers),[...flow.EARTH_LAYER_KEYS]);assert.ok(Object.values(d.layers).every(Boolean));
  const p=flow.normalizeEarthPrefs({viewMode:'x',quality:'ultra',layers:{routes:false,bogus:false},camera:{lon:500,lat:-120,height:1,heading:.5,pitch:2},routeAnimation:false});
  assert.equal(p.viewMode,'');assert.equal(p.quality,'balanced');assert.equal(p.layers.routes,false);assert.equal('bogus' in p.layers,false);assert.equal(p.routeAnimation,false);
  assert.deepEqual([p.camera.lon,p.camera.lat,p.camera.height,p.camera.pitch],[180,-90,150,0],'kamera küre içine/ufuk üstüne kaydedilemez');
  assert.equal(flow.normalizeEarthPrefs({camera:{lon:'a',lat:1,height:2}}).camera,null);
  assert.deepEqual([...flow.MAP_ENGINES],['buyerlog','earth']);
});

test('ortak viewport: Buyer Log 2D ⇄ span ⇄ 2D merkez ve ölçeği korur',()=>{
  const w=1232,h=480;
  for(const view of [{panX:0,panY:0,zoom2d:1},{panX:-320,panY:140,zoom2d:3.5},{panX:900,panY:-250,zoom2d:8}]){
    const vp=flow.viewportFrom2d(view,w,h),back=flow.view2dFromViewport(vp,w,h);
    assert.ok(near(back.zoom2d,view.zoom2d,1e-9)&&near(back.panX,view.panX,1e-6)&&near(back.panY,view.panY,1e-6),JSON.stringify({view,vp,back}));
  }
  const world=flow.viewportFrom2d({panX:0,panY:0,zoom2d:1},w,h);assert.ok(near(world.lon,0,1e-9)&&near(world.lat,0,1e-9)&&near(world.span,180,1e-9));
  const clamped=flow.view2dFromViewport({lon:28.9,lat:41,span:.5},w,h);assert.equal(clamped.zoom2d,flow.MAX_ZOOM_2D,'2D en fazla MAX_ZOOM_2D kadar yakınlaşır');
});

test('ortak viewport: Buyer Log 3D küre ⇄ span ⇄ 3D',()=>{
  const w=1232,h=480,view={rotLon:64,rotLat:-22,zoom3d:2.4};
  const vp=flow.viewportFrom3d(view,w,h);assert.ok(near(vp.lon,64)&&near(vp.lat,22),'3D merkez rotLon/-rotLat');
  const back=flow.view3dFromViewport(vp,w,h);assert.ok(near(back.rotLon,64)&&near(back.rotLat,-22)&&near(back.zoom3d,2.4,1e-9));
});

test('Earth yüksekliği ⇄ span tersinirdir, monotondur ve tüm dünya küreyi kadraja sığdırır',()=>{
  for(const fovy of [.44,.8,1.0471975512]){
    let prev=0;
    for(const span of [.01,.5,2,10,45,90,120,160,179,180]){
      const height=flow.heightForSpan(span,fovy);assert.ok(height>prev,'monoton');prev=height;
      assert.ok(near(flow.spanForHeight(height,fovy),span,1e-6)||height===150,'ters dönüşüm '+fovy+'/'+span);
    }
    const globeFill=6378137/Math.sin(fovy/2)-6378137,world=flow.heightForSpan(180,fovy);
    assert.ok(world>=globeFill&&world<=globeFill*1.36,'tüm dünya: küre görünür ve kadraj içinde');
  }
  assert.ok(flow.heightForSpan(1e-9,.8)>=150,'kamera minimum mesafenin altına inmez');
});

test('seçim kimliği mevcut hedeflerde değişmez, Earth hedeflerini de kapsar',()=>{
  const vehicle={id:'veh:sea:a>b#3|v:msc aurora'},edge={key:'sea|1,2>3,4'},bundle={key:'origin:India'};
  assert.equal(flow.hitIdentity({type:'vehicle',vehicle}),'vehicle:veh:sea:a>b#3|v:msc aurora');
  assert.equal(flow.hitIdentity({type:'route',edge}),'route:sea|1,2>3,4');
  assert.equal(flow.hitIdentity({type:'node',bundle}),'node:origin:India');
  assert.equal(flow.hitIdentity({type:'stage',stage:'CUSTOMS',nodeKey:'arrival:istanbul'}),'stage:arrival:istanbul/CUSTOMS');
  assert.equal(flow.hitIdentity({type:'hub',hub:{key:'port|91.82,22.35'}}),'hub:port|91.82,22.35');
  assert.equal(flow.hitIdentity({type:'shipment',rec:{id:'cp|o1|ias#4'}}),'shipment:cp|o1|ias#4');
  assert.equal(flow.hitIdentity(null),'');
});

test('Earth rotası aynı kenar örneklerini kullanır: rota hesabı kopyalanmaz',()=>{
  const rec=flow.shipmentPartialsFromRows([{'Order Code':'E1','Country':'Bangladesh','STATUS':'Yol Operasyonları','Del. Type':'Gemi',_logisticSegments:[{kind:'partial',partialNo:1,quantity:10,status:'Yol Operasyonları',delType:'Gemi',handover:'2026-09-01',sourceRow:1}]}],'cp')[0];
  const model=flow.buildFlowModel([rec],{rules:[],now:Date.UTC(2026,8,20)});
  const samples=flow.edgeSamples(model.edges[0]);assert.ok(samples.length>=2&&samples.every(s=>Number.isFinite(s.lon)&&Number.isFinite(s.lat)));
  assert.match(EARTH,/host\.edgeSamples\(edge\)/);assert.match(EARTH,/host\.pointAlongLeg\(/);assert.match(EARTH,/host\.getModel\(\)/);
  assert.doesNotMatch(EARTH,/routeLegsFor|buildFlowModel|recordRouteProgress|groupTransitPlacements|seaRouteCoordinates/,'Earth iş/rota hesabı yapmaz');
  assert.ok(earth.MAX_SAMPLE_STEP_DEG<=.5,'düz kiriş deniz seviyesinin altına inmeyecek kadar sık örneklenir');
});

test('Earth lazy yüklenir: index.html Cesium veya Earth modülünü eager yüklemez',()=>{
  assert.doesNotMatch(INDEX,/vendor\/cesium|overview-global-flow-earth\.js/);
  assert.match(PERF,/cesium:\{global:'Cesium',files:\['vendor\/cesium\/Cesium\.js'\]\}/);
  assert.match(PERF,/globalFlowEarth:\['overview-global-flow-earth\.js/);
  assert.match(SOURCE,/BLPerf\.ensureFeature\('globalFlowEarth'\)/);
  assert.match(EARTH,/CESIUM_BASE_URL=new URL\('vendor\/cesium\/'/);
  assert.match(EARTH,/ensureLibrary\('cesium'\)/);
  for(const rel of ['Cesium.js','Workers/createVerticesFromHeightmap.js','ThirdParty/draco_decoder.wasm','Assets/approximateTerrainHeights.json','Assets/Textures/NaturalEarthII/tilemapresource.xml','Assets/Images/google_earth_credit.png','Widgets/CesiumWidget/CesiumWidget.css','LICENSE.md'])
    assert.ok(fs.existsSync(path.join(ROOT,'public','vendor','cesium',rel)),'vendor/cesium/'+rel);
  const ignore=fs.readFileSync(path.join(ROOT,'..','..','.gitignore'),'utf8');
  assert.match(ignore,/!\/resources\/app\/public\/vendor\/cesium\/Assets\/Images\//,'Windows (büyük/küçük harf duyarsız) checkout Cesium kredi logolarını düşürmez');
});

test('Earth görünmezken çizim, animasyon ve karo yüklemesi durur; uzun süre gizliyse WebGL bırakılır',()=>{
  assert.match(EARTH,/useDefaultRenderLoop:false,requestRenderMode:true/);
  assert.match(EARTH,/function pause\(\)\{[^]*?widget\.useDefaultRenderLoop=false[^]*?cancelAnimationFrame\(animFrame\)/);
  assert.match(EARTH,/function destroy\(\)\{[^]*?handler\.destroy\(\)[^]*?widget\.destroy\(\)[^]*?WEBGL_lose_context/);
  // Tüm rotalar tek "time" uniform'u ile akar; rota başına döngü yok.
  assert.equal((EARTH.match(/requestAnimationFrame\(animationTick\)/g)||[]).length,2);
  assert.match(EARTH,/Object\.values\(flowMaterials\)\.forEach\(m=>\{m\.uniforms\.time=t;\}\)/);
  assert.match(SOURCE,/const EARTH_COLD_DESTROY_MS=120000;/);
  assert.match(SOURCE,/function syncEarthActivity\(\)\{/);
  assert.match(SOURCE,/state\.frame=0;if\(!isLive\(\)\|\|state\.engine!=='buyerlog'\)return;/,'Earth seçiliyken Buyer Log canvas döngüsü çalışmaz');
  assert.match(SOURCE,/pagehide',\(\)=>\{destroyEarth\(\);flushPrefs\(\);\}/);
});

test('motor seçimi, Earth tercihleri ve kamera kullanıcı tercihine kaydedilir; anahtar kaydedilmez',()=>{
  assert.match(SOURCE,/engine:state\.engine,earth:state\.earth/);
  assert.match(SOURCE,/data-gf-engine="buyerlog"/);assert.match(SOURCE,/data-gf-engine="earth"/);
  assert.match(EARTH,/camera\.moveEnd\.addEventListener\([^]*?saveEarthPrefs\(\{camera:cameraState\(\)\}\)/,'kamera yalnız hareket bitince yazılır');
  assert.doesNotMatch(EARTH,/camera\.changed\.addEventListener\([^)]*saveEarthPrefs/,'her kamera karesinde yazma yok');
  const keys=Object.keys(flow.normalizeEarthPrefs({googleKey:'AIzaSyX',apiKey:'AIzaSyY'}));
  assert.ok(!keys.some(k=>/key/i.test(k)),'API anahtarı tercih nesnesine girmez');
});

test('sağlayıcı hatası çökme değil düşüştür: Retry + Buyer Log haritasına geçiş sunulur',()=>{
  assert.match(EARTH,/async function degrade\(error\)/);
  assert.match(EARTH,/data-gf-earth-action="retry"/);assert.match(EARTH,/data-gf-earth-action="to-buyerlog"/);
  assert.match(EARTH,/withTimeout\(C\.createGooglePhotorealistic3DTileset/);
  assert.match(EARTH,/code===401\|\|code===403/);assert.match(EARTH,/code===429/);assert.match(EARTH,/navigator\.onLine===false/);
  assert.match(SOURCE,/data-gf-earth-fallback="retry"/);assert.match(SOURCE,/data-gf-earth-fallback="buyerlog"/);
  assert.match(SOURCE,/code:'EARTH_DISABLED'/);
  assert.match(CSS,/\.globalFlowEarthFallback\{/);assert.match(CSS,/\.gfEarthControls\{/);
});

test('review düzeltmeleri: retry Earth kabını açar, soğuk imha sayacı ertelenmez, ekran dışı Earth yüklenmez, render hatası ertelenir',()=>{
  assert.match(SOURCE,/gfEarthFallback==='retry'\)\{state\.earthError='';earthRuntimeCache=\{at:0,promise:null\};syncEngineSurface\(\);/);
  assert.match(SOURCE,/function scheduleEarthColdDestroy\(\)\{[^}]*?if\(state\.earthIdleTimer\)return;/);
  assert.match(SOURCE,/if\(!state\.earthVisibilityKnown&&typeof IntersectionObserver==='function'\)return;/);
  assert.match(SOURCE,/if\(state\.fullscreen\)\{toggleFullscreen\(\);return;\}/,'Escape önce tam ekrandan çıkar');
  assert.match(EARTH,/renderError\.addEventListener\(\(_scene,error\)=>\{setTimeout\(/);
  assert.match(EARTH,/destroyMaterials\(\);buildMaterials\(\);/);
});

test('tam ekran, bitmiş görünüm animasyonunun oluşturduğu içeren bloğu bırakır',()=>{
  assert.match(SOURCE,/function releaseFixedContainingBlock\(widget\)/);
  assert.match(SOURCE,/if\(state\.fullscreen\)releaseFixedContainingBlock\(widget\)/);
});

test('Earth sağlayıcı ayarları: şifreli saklama, maskeli durum, yalnız Moderatör yazar',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bl-earth-settings-')),prevRoot=process.env.BUYER_LOG_SERVER_DATA_ROOT,prevKey=process.env.BUYER_LOG_GOOGLE_MAPS_API_KEY;
  process.env.BUYER_LOG_SERVER_DATA_ROOT=dir;delete process.env.BUYER_LOG_GOOGLE_MAPS_API_KEY;
  for(const mod of ['../server/user-data','../server/lib/global-flow-earth-settings'])delete require.cache[require.resolve(mod)];
  t.after(()=>{
    if(prevRoot==null)delete process.env.BUYER_LOG_SERVER_DATA_ROOT;else process.env.BUYER_LOG_SERVER_DATA_ROOT=prevRoot;
    if(prevKey==null)delete process.env.BUYER_LOG_GOOGLE_MAPS_API_KEY;else process.env.BUYER_LOG_GOOGLE_MAPS_API_KEY=prevKey;
    for(const mod of ['../server/user-data','../server/lib/global-flow-earth-settings'])delete require.cache[require.resolve(mod)];
    fs.rmSync(dir,{recursive:true,force:true});
  });
  const settings=require('../server/lib/global-flow-earth-settings');
  assert.deepEqual(settings.runtimeConfig(),{enabled:true,provider:'offline',defaultMode:'offline',googleKey:''},'anahtarsız Earth çevrimdışı küreyle çalışır');
  assert.throws(()=>settings.saveSettings({apiKey:'kısa'}),/API anahtarı/);
  assert.throws(()=>settings.saveSettings({provider:'bing'}),/sağlayıcı/i);
  const key='AIzaSyTESTKEY_1234567890abcdefXYZ';
  settings.saveSettings({apiKey:key,defaultMode:'satellite'},'moderator');
  const disk=fs.readFileSync(settings.SETTINGS_FILE,'utf8');
  assert.ok(!disk.includes(key),'anahtar diskte düz metin değildir');assert.match(disk,/aes-256-gcm/);
  const status=settings.publicStatus({canConfigure:true});assert.equal(status.configured,true);assert.equal(status.maskedKey,'••••••••fXYZ');
  assert.ok(!JSON.stringify(settings.publicStatus({canConfigure:false})).includes('XYZ'),'Moderatör olmayan maskeyi de görmez');
  assert.ok(!JSON.stringify(status).includes(key));
  assert.deepEqual(settings.runtimeConfig(),{enabled:true,provider:'google',defaultMode:'satellite',googleKey:key});
  settings.saveSettings({enabled:false});assert.equal(settings.runtimeConfig().googleKey,'','kapalıyken anahtar istemciye inmez');assert.equal(settings.runtimeConfig().enabled,false);
  settings.saveSettings({enabled:true,clearApiKey:true});assert.equal(settings.runtimeConfig().provider,'offline');
  process.env.BUYER_LOG_GOOGLE_MAPS_API_KEY='AIzaSyENVKEY_0000000000000000000';assert.equal(settings.publicStatus({canConfigure:true}).keySource,'env');
  // Route kayıt sözleşmesi: okuma Overview erişimi, yazma yalnız Moderatör.
  const routes=read('server/routes/global-flow-earth-routes.js');
  assert.match(routes,/app\.put\('\/api\/global-flow\/earth\/settings', userAccess\.requireModerator/);
  assert.match(routes,/requireAnyArea\('overview'/);assert.match(routes,/'Cache-Control', 'no-store'/);
  assert.match(SERVER,/require\('\.\/routes\/global-flow-earth-routes'\)\(app, \{ express, userAccess \}\)/);
});

test('Earth modülü Node\'da DOM olmadan yüklenebilir ve kalite profilleri tutarlıdır',()=>{
  assert.equal(typeof earth.create,'function');
  assert.deepEqual([...earth.QUALITY_ORDER],['performance','balanced','high']);
  const q=earth.QUALITY;assert.ok(q.performance.tileSse>q.balanced.tileSse&&q.balanced.tileSse>q.high.tileSse,'yüksek kalite daha detaylı karo');
  assert.ok(q.performance.fps<=q.balanced.fps&&q.balanced.fps<=q.high.fps);
  assert.ok(earth.LOD.clusterOff<earth.LOD.clusterSoft&&earth.LOD.vehicleLabels<=earth.LOD.shipmentPoints);
});
