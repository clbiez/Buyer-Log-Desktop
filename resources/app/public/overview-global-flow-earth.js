(function(root){
'use strict';

/* Global Flow Map · Earth 3D görünüm motoru.
 *
 * Bu dosya yalnız kullanıcı "Earth 3D" moduna geçtiğinde yüklenir
 * (BLPerf feature: globalFlowEarth) ve yerel olarak dağıtılan CesiumJS'i
 * (public/vendor/cesium) kullanır. Kendi iş verisi/hesabı YOKTUR: sevkiyat,
 * filtre, rota, araç ilerlemesi ve seçim durumu overview-global-flow.js'in
 * ürettiği ortak akış modelinden (state.model) `host` köprüsüyle okunur.
 * Buyer Log haritası ile aynı modeli, aynı tooltip/detay çekmecesini ve aynı
 * seçim kimliğini paylaşır; yalnız çizim katmanı farklıdır.
 *
 * Görüntü sağlayıcıları:
 *   - nasa-blue-marble : NASA GIBS Blue Marble (anahtarsız / ücretsiz)
 *   - nasa-relief      : NASA GIBS shaded relief (anahtarsız / ücretsiz)
 *   - offline          : Cesium ile gelen NaturalEarthII dokusu (anahtarsız, her zaman)
 *   - photorealistic   : Google Photorealistic 3D Tiles (opsiyonel Map Tiles API anahtarı)
 *   - satellite        : Google 2D uydu (+ isteğe bağlı yer adı katmanı)
 *   - terrain          : Google 2D arazi/kabartma haritası
 * Harici görüntü katmanı başarısız olursa görünüm çökmeden çevrimdışı küreye düşer. */

const EARTH_RADIUS=6378137;
/* Hava rotasının kavis yüksekliği Buyer Log kürediki (yarıçap oranı) değerin
   bu katıdır; fotogerçekçi dünyada daha okunur, daha az "uçan" bir yay verir. */
const AIR_ARC_SCALE=.6;
const ROUTE_BASE_HEIGHT=Object.freeze({sea:260,air:900,'sea-air':260,road:1400,unknown:600});
/* Deniz rotası örnekleri ~3° aralıklıdır; düz kiriş küre yüzeyinin altına
   iner. 0,4° aralıkla sehim ~40 m'de kalır. */
const MAX_SAMPLE_STEP_DEG=.4;
const QUALITY=Object.freeze({
  performance:{nativeResolution:false,resolutionScale:.8,tileSse:24,globeSse:3,fxaa:false,msaa:1,fps:20,clusterPx:64,labelFar:6e6},
  balanced:{nativeResolution:false,resolutionScale:1,tileSse:16,globeSse:2,fxaa:true,msaa:1,fps:30,clusterPx:52,labelFar:1.2e7},
  high:{nativeResolution:true,resolutionScale:1,tileSse:8,globeSse:1.5,fxaa:true,msaa:4,fps:60,clusterPx:44,labelFar:2.4e7}
});
const QUALITY_ORDER=Object.freeze(['performance','balanced','high']);
/* LOD eşikleri (kamera ile hedef arası mesafe, metre). */
const LOD=Object.freeze({clusterOff:260e3,clusterSoft:1.6e6,vehicleLabels:1.4e6,shipmentPoints:2.6e6,perspectiveMax:6e6});
const PROVIDER_TIMEOUT_MS=15000;
const HIDE_ALL=Object.freeze({show:false});

const ICON={
  compass:'<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9.2" fill="none" stroke="currentColor" stroke-width="1.4"/><g class="gfEarthNeedle"><path d="M12 4.2l2.6 7.8h-5.2z" fill="var(--red,#c04455)"/><path d="M12 19.8l-2.6-7.8h5.2z" fill="currentColor" opacity=".55"/></g></svg>',
  plus:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round"/></svg>',
  minus:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round"/></svg>',
  fit:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" stroke="currentColor" stroke-width="1.7" fill="none" stroke-linecap="round" stroke-linejoin="round"/><circle cx="12" cy="12" r="2.4" fill="currentColor"/></svg>',
  view:'<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.4" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M3.8 12h16.4M12 3.6c2.6 2.4 3.9 5.2 3.9 8.4s-1.3 6-3.9 8.4c-2.6-2.4-3.9-5.2-3.9-8.4s1.3-6 3.9-8.4z" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>',
  layers:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4l8 4.2-8 4.2-8-4.2z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M4 12.2l8 4.2 8-4.2M4 16l8 4.2 8-4.2" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>',
  settings:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8.8a3.2 3.2 0 1 0 0 6.4 3.2 3.2 0 0 0 0-6.4z" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M19.4 13.4l1.4 1.1-1.8 3.1-1.7-.6a7 7 0 0 1-1.9 1.1l-.3 1.8h-3.6l-.3-1.8a7 7 0 0 1-1.9-1.1l-1.7.6-1.8-3.1 1.4-1.1a7 7 0 0 1 0-2.8L3.2 9.5 5 6.4l1.7.6a7 7 0 0 1 1.9-1.1L8.9 4h3.6l.3 1.8a7 7 0 0 1 1.9 1.1l1.7-.6 1.8 3.1-1.4 1.1a7 7 0 0 1 0 2.8z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>',
  focus:'<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="6.5" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="12" cy="12" r="2" fill="currentColor"/><path d="M12 2.8v3M12 18.2v3M2.8 12h3M18.2 12h3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
  close:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>'
};

function ensureStylesheet(href,id){
  if(document.getElementById(id))return;
  const link=document.createElement('link');link.rel='stylesheet';link.id=id;link.href=href;document.head.appendChild(link);
}
function reducedMotion(){try{return window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;}catch(_){return false;}}
function withTimeout(promise,ms,label){
  let timer=0;
  return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Object.assign(new Error(label+' zaman aşımı'),{code:'EARTH_TIMEOUT'})),ms);})]).finally(()=>clearTimeout(timer));
}
function statusCodeOf(error){
  const direct=Number(error&&(error.statusCode||error.status));if(direct)return direct;
  const nested=error&&(error.error||error.cause);return nested&&nested!==error?statusCodeOf(nested):0;
}

async function loadCesium(){
  if(root.Cesium&&root.Cesium.CesiumWidget)return root.Cesium;
  // Cesium Worker/Asset yollarını betik yüklenmeden önce okur.
  root.CESIUM_BASE_URL=new URL('vendor/cesium/',document.baseURI).href;
  ensureStylesheet('vendor/cesium/Widgets/CesiumWidget/CesiumWidget.css','blCesiumWidgetCss');
  if(root.BLPerf&&typeof root.BLPerf.ensureLibrary==='function')await root.BLPerf.ensureLibrary('cesium');
  if(!root.Cesium||!root.Cesium.CesiumWidget)throw Object.assign(new Error('CesiumJS yüklenemedi.'),{code:'EARTH_ENGINE_MISSING'});
  return root.Cesium;
}

function create(options){
  const container=options&&options.container,host=options&&options.host;
  if(!container||!host)throw new Error('Earth görünümü için kap ve host gerekir.');
  const L=host.L;
  let C=null,widget=null,scene=null,camera=null,handler=null,destroyed=false,paused=true,ready=false;
  let runtime={provider:'free',defaultMode:'nasa-relief',googleKey:''},provider={mode:'offline',status:'ok',message:''};
  let tileset=null,providerToken=0,imageryFailures=0,tileFailures=0,tileSuccesses=0;
  let routesBase=null,routesFlow=null,routesSelect=null,billboards=null,clusterBoards=null,labels=null,points=null,occluder=null;
  let flowMaterials=null,baseMaterials=null,selectMaterial=null;
  let modelRevision=-1,sceneData=null,hover=null,hoverFrame=0,pendingMove=null,animFrame=0,lastAnimTick=0,reclusterTimer=0;
  let panel='',qualityLevel='balanced',effectiveQuality='balanced',adaptiveDowngraded=false,fpsWindow=[];
  let tileProgress=0,loadingNotified=false,firstFrameResolve=null,compassHeading=NaN,status=null,statusLoading=false;
  const removers=[],iconCache=new Map();
  const firstFrame=new Promise(resolve=>{firstFrameResolve=resolve;});

  container.innerHTML=
    '<div class="gfEarthViewport" data-gf-earth-viewport></div>'+
    '<div class="gfEarthControls" data-gf-earth-controls role="toolbar" aria-label="'+host.esc(L('Earth harita kontrolleri','Earth map controls'))+'"></div>'+
    '<div class="gfEarthPanel" data-gf-earth-panel hidden></div>'+
    '<div class="gfEarthNotice" data-gf-earth-notice hidden role="status"></div>'+
    '<div class="gfEarthSelection" data-gf-earth-selection hidden></div>'+
    '<div class="gfEarthProgress" data-gf-earth-progress hidden aria-hidden="true"><i></i></div>';
  const viewportEl=container.querySelector('[data-gf-earth-viewport]'),controlsEl=container.querySelector('[data-gf-earth-controls]'),panelEl=container.querySelector('[data-gf-earth-panel]');
  const noticeEl=container.querySelector('[data-gf-earth-notice]'),selectionEl=container.querySelector('[data-gf-earth-selection]'),progressEl=container.querySelector('[data-gf-earth-progress]');

  function prefs(){return host.getEarthPrefs();}
  function layerOn(key){const layers=prefs().layers||{};return layers[key]!==false;}
  function q(){return QUALITY[effectiveQuality]||QUALITY.balanced;}

  /* ---------- Sağlayıcı / görüntü ---------- */
  const GOOGLE_MODES=Object.freeze(['photorealistic','satellite','terrain']);
  const FREE_MODES=Object.freeze(['nasa-blue-marble','nasa-relief']);
  function googleAvailable(){return runtime.provider==='google'&&Boolean(runtime.googleKey);}
  function freeAvailable(){return runtime.provider==='free'||runtime.provider==='google';}
  function resolvedMode(){
    const wanted=prefs().viewMode||runtime.defaultMode||'nasa-relief';
    if(wanted==='offline'||runtime.provider==='offline')return 'offline';
    if(typeof navigator!=='undefined'&&navigator.onLine===false)return 'offline';
    if(GOOGLE_MODES.includes(wanted))return googleAvailable()?wanted:(freeAvailable()?'nasa-relief':'offline');
    if(FREE_MODES.includes(wanted))return freeAvailable()?wanted:'offline';
    return freeAvailable()?'nasa-relief':'offline';
  }
  function providerErrorText(error){
    const code=statusCodeOf(error);
    if(code===401||code===403)return L('API anahtarı geçersiz ya da Map Tiles API yetkisi yok.','The API key is invalid or lacks Map Tiles API access.');
    if(code===429)return L('Sağlayıcı kotası doldu.','The provider quota is exhausted.');
    if(error&&error.code==='EARTH_TIMEOUT')return L('Sağlayıcı zamanında yanıt vermedi.','The provider did not respond in time.');
    if(typeof navigator!=='undefined'&&navigator.onLine===false)return L('Ağ bağlantısı yok.','No network connection.');
    if(!code)return L('Sağlayıcıya ulaşılamadı (ağ veya erişim engeli).','The provider could not be reached (network or access block).');
    return L('Sağlayıcı hatası','Provider error')+' (HTTP '+code+').';
  }
  function clearProviderLayers(){
    if(tileset){try{scene.primitives.remove(tileset);}catch(_){}tileset=null;}
    try{scene.imageryLayers.removeAll(true);}catch(_){}
  }
  async function offlineImagery(){
    const url=C.buildModuleUrl('Assets/Textures/NaturalEarthII');
    return C.TileMapServiceImageryProvider.fromUrl(url,{fileExtension:'jpg'});
  }
  function nasaImagery(mode){
    const layer=mode==='nasa-blue-marble'?'BlueMarble_NextGeneration':'BlueMarble_ShadedRelief';
    return new C.WebMapTileServiceImageryProvider({
      url:'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/'+layer+'/default/{TileMatrixSet}/{TileMatrix}/{TileRow}/{TileCol}.jpeg',
      layer,
      style:'default',
      format:'image/jpeg',
      tileMatrixSetID:'GoogleMapsCompatible_Level8',
      maximumLevel:8,
      credit:new C.Credit('NASA GIBS / EOSDIS')
    });
  }
  function watchImagery(providerInstance,token){
    if(!providerInstance||!providerInstance.errorEvent)return;
    providerInstance.errorEvent.addEventListener(error=>{
      if(token!==providerToken)return;imageryFailures++;
      // Tek tük eksik karo normaldir; üst üste başarısızlık sağlayıcı arızasıdır.
      if(imageryFailures>=6&&provider.mode!=='offline')void degrade(error&&error.error||error);
    });
  }
  async function applyViewMode(){
    if(!scene)return;
    const token=++providerToken,mode=resolvedMode();
    imageryFailures=0;tileFailures=0;tileSuccesses=0;
    clearProviderLayers();
    provider={mode,status:'loading',message:''};renderNotice();renderPanel();
    scene.globe.show=true;
    try{
      if(mode==='photorealistic'){
        scene.globe.show=false;
        const ts=await withTimeout(C.createGooglePhotorealistic3DTileset({key:runtime.googleKey,onlyUsingWithGoogleGeocoder:true},{maximumScreenSpaceError:q().tileSse,enableCollision:true,showCreditsOnScreen:true}),PROVIDER_TIMEOUT_MS,'Photorealistic 3D Tiles');
        if(token!==providerToken||destroyed){try{ts.destroy();}catch(_){}return;}
        tileset=ts;scene.primitives.add(tileset,0);
        tileset.tileFailed.addEventListener(event=>{
          if(token!==providerToken)return;tileFailures++;
          if(tileFailures>=8&&tileSuccesses===0)void degrade(event&&event.message?Object.assign(new Error(event.message),{statusCode:/\b(40[13]|429)\b/.exec(event.message)?.[1]}):event);
        });
        tileset.tileLoad.addEventListener(()=>{tileSuccesses++;});
        tileset.loadProgress.addEventListener((pending,processing)=>setTileProgress(pending+processing));
      }else if(mode==='nasa-blue-marble'||mode==='nasa-relief'){
        const base=nasaImagery(mode);
        if(token!==providerToken||destroyed)return;
        scene.imageryLayers.addImageryProvider(base);watchImagery(base,token);
      }else if(mode==='satellite'||mode==='terrain'){
        const language=host.isEn()?'en-US':'tr-TR';
        const base=await withTimeout(C.Google2DImageryProvider.fromUrl({key:runtime.googleKey,mapType:mode,language,region:'TR'}),PROVIDER_TIMEOUT_MS,'Google 2D Tiles');
        if(token!==providerToken||destroyed)return;
        scene.imageryLayers.addImageryProvider(base);watchImagery(base,token);
        if(mode==='satellite'&&prefs().providerLabels!==false){
          try{
            const overlay=await withTimeout(C.Google2DImageryProvider.fromUrl({key:runtime.googleKey,overlayLayerType:'layerRoadmap',language,region:'TR'}),PROVIDER_TIMEOUT_MS,'Google labels');
            if(token===providerToken&&!destroyed){scene.imageryLayers.addImageryProvider(overlay);watchImagery(overlay,token);}
          }catch(_){/* Yer adı katmanı opsiyoneldir; uydu görüntüsü çalışmaya devam eder. */}
        }
      }else{
        const base=await offlineImagery();if(token!==providerToken||destroyed)return;
        scene.imageryLayers.addImageryProvider(base);
      }
      provider={mode,status:'ok',message:''};
    }catch(error){
      if(token!==providerToken||destroyed)return;
      if(mode!=='offline'){await degrade(error);return;}
      provider={mode,status:'error',message:providerErrorText(error)};
    }
    renderNotice();renderPanel();requestRender();
  }
  /* Harici görüntü katmanı çalışmazsa harita kapanmaz: aynı veri çevrimdışı
     küre üzerinde kalır, kullanıcıya yeniden deneme ve Buyer Log haritasına
     geçiş sunulur. */
  async function degrade(error){
    if(destroyed||!scene)return;
    const message=providerErrorText(error),failedMode=provider.mode,token=++providerToken;
    clearProviderLayers();scene.globe.show=true;
    try{const base=await offlineImagery();if(token===providerToken&&!destroyed)scene.imageryLayers.addImageryProvider(base);}catch(_){}
    if(token!==providerToken||destroyed)return;
    provider={mode:'offline',status:'degraded',message,failedMode};
    renderNotice();renderPanel();requestRender();
  }
  function setTileProgress(count){
    tileProgress=Math.max(0,Number(count)||0);
    progressEl.hidden=tileProgress<=0||paused;
  }

  /* ---------- Kalite ---------- */
  function applyQuality(){
    if(!widget)return;const cfg=q();
    widget.useBrowserRecommendedResolution=!cfg.nativeResolution;widget.resolutionScale=cfg.resolutionScale;
    scene.globe.maximumScreenSpaceError=cfg.globeSse;
    if(tileset)tileset.maximumScreenSpaceError=cfg.tileSse;
    try{scene.postProcessStages.fxaa.enabled=cfg.fxaa;}catch(_){}
    try{scene.msaaSamples=cfg.msaa;}catch(_){}
    labels&&updateLabelFar();scheduleRecluster(0);requestRender();
  }
  function setQuality(level){
    qualityLevel=QUALITY[level]?level:'balanced';effectiveQuality=qualityLevel;adaptiveDowngraded=false;fpsWindow=[];applyQuality();
  }
  /* Düşük FPS: yalnız animasyon sürekli çizerken ölçülür; bir kademe düşürülür,
     veri görünürlüğü değişmez (etiket mesafesi, karo detayı, animasyon hızı). */
  function sampleFrame(now){
    if(!animFrame||effectiveQuality==='performance')return;
    fpsWindow.push(now);if(fpsWindow.length<45)return;
    const span=fpsWindow[fpsWindow.length-1]-fpsWindow[0],fps=(fpsWindow.length-1)/(span/1000);fpsWindow=[];
    const target=q().fps;
    if(fps<Math.min(18,target*.6)){const index=QUALITY_ORDER.indexOf(effectiveQuality);effectiveQuality=QUALITY_ORDER[Math.max(0,index-1)];adaptiveDowngraded=true;applyQuality();renderPanel();}
  }

  /* ---------- Geometri yardımcıları ---------- */
  function heightFor(mode,alt){
    const base=ROUTE_BASE_HEIGHT[mode]!=null?ROUTE_BASE_HEIGHT[mode]:ROUTE_BASE_HEIGHT.unknown;
    return base+(Number(alt)||0)*EARTH_RADIUS*AIR_ARC_SCALE;
  }
  function cartesian(point,mode){return C.Cartesian3.fromDegrees(Number(point.lon),Number(point.lat),heightFor(mode,point.alt));}
  function densify(samples){
    const out=[];
    for(let i=0;i<samples.length;i++){
      const a=samples[i];if(!i){out.push(a);continue;}
      const prev=samples[i-1],deg=host.angularDistanceDeg(prev,a),steps=Math.max(1,Math.ceil(deg/MAX_SAMPLE_STEP_DEG));
      for(let s=1;s<=steps;s++){
        const t=s/steps,geo=steps===1?a:host.geoInterpolate(prev,a,t);
        out.push({lon:geo.lon,lat:geo.lat,alt:(prev.alt||0)+((a.alt||0)-(prev.alt||0))*t});
      }
    }
    return out;
  }
  function color(css,alpha){const c=C.Color.fromCssColorString(css||'#7a7a7d');return alpha==null?c:c.withAlpha(alpha);}
  /* Rota renkleri Buyer Log paletinden gelir; uydu/fotogerçekçi zeminde okunur
     kalması için yalnız parlaklığı artırılır (yeni renk üretilmez). */
  function imageryColor(css,alpha){const c=color(css);C.Color.clone(c.brighten(.28,new C.Color()),c);return alpha==null?c:c.withAlpha(alpha);}

  /* ---------- Materyaller ---------- */
  function flowMaterial(css){
    return new C.Material({translucent:true,fabric:{
      type:'BLGlobalFlowDash',
      uniforms:{color:imageryColor(css,.95),dashLength:18,dashRatio:.42,time:0,speed:24},
      source:
        'uniform vec4 color;uniform float dashLength;uniform float dashRatio;uniform float time;uniform float speed;\n'+
        'in float v_polylineAngle;\n'+
        'mat2 blRotate(float rad){float c=cos(rad);float s=sin(rad);return mat2(c,s,-s,c);}\n'+
        'czm_material czm_getMaterial(czm_materialInput materialInput){\n'+
        '  czm_material material=czm_getDefaultMaterial(materialInput);\n'+
        // Ekran uzayında çizgi yönündeki konum nokta sırasıyla artar: kesikler
        // kenarın a→b yönüne, yani varış/aktarma noktasına doğru akar.
        '  vec2 pos=blRotate(v_polylineAngle)*gl_FragCoord.xy;\n'+
        '  float period=dashLength*czm_pixelRatio;\n'+
        '  float phase=fract((pos.x-time*speed*czm_pixelRatio)/period);\n'+
        '  if(phase>dashRatio)discard;\n'+
        '  material.diffuse=color.rgb;material.emission=color.rgb*.35;material.alpha=color.a;\n'+
        '  return material;\n'+
        '}\n'
    }});
  }
  function colorMaterial(cssColor){return C.Material.fromType('Color',{color:cssColor});}
  function destroyMaterials(){
    [...Object.values(flowMaterials||{}),...Object.values(baseMaterials||{}),selectMaterial].forEach(m=>{try{if(m&&!m.isDestroyed())m.destroy();}catch(_){}});
    flowMaterials=null;baseMaterials=null;selectMaterial=null;
  }
  function buildMaterials(){
    const modes=['sea','air','road','sea-air','unknown'];flowMaterials={};baseMaterials={};
    modes.forEach(mode=>{const css=host.modeColor(mode);flowMaterials[mode]=flowMaterial(css);baseMaterials[mode]=colorMaterial(imageryColor(css,.42));});
    selectMaterial=colorMaterial(C.Color.WHITE.withAlpha(.85));
  }

  /* ---------- İkonlar (canvas → billboard) ---------- */
  function iconCanvas(key,size,paint){
    let canvas=iconCache.get(key);if(canvas)return canvas;
    const ratio=2;canvas=document.createElement('canvas');canvas.width=size*ratio;canvas.height=size*ratio;
    const ctx=canvas.getContext('2d');ctx.scale(ratio,ratio);ctx.translate(size/2,size/2);paint(ctx);
    canvas.blSize=size;iconCache.set(key,canvas);return canvas;
  }
  /* Simgeler 2x çözünürlükte çizilir; billboard'a CSS piksel boyutu verilir. */
  function board(collection,options){const image=options.image;return collection.add({...options,width:image.blSize,height:image.blSize,disableDepthTestDistance:Number.POSITIVE_INFINITY});}
  function vehicleIcon(mode,critical,overdue,selected){
    const p=host.palette(),stroke=overdue?p.yellow:(critical?p.red:host.modeColor(mode));
    return iconCanvas('veh|'+mode+'|'+(critical?1:0)+'|'+(overdue?1:0)+'|'+(selected?1:0),28,ctx=>{
      ctx.fillStyle=p.card;ctx.strokeStyle=stroke;ctx.lineWidth=critical||overdue?2.2:1.6;
      ctx.beginPath();ctx.arc(0,0,10,0,Math.PI*2);ctx.fill();ctx.stroke();
      ctx.fillStyle=host.modeColor(mode);
      // Hava aracı yukarıyı gösterir; billboard alignedAxis ile rota yönüne döner.
      if(mode==='air')ctx.rotate(-Math.PI/2);
      host.drawModeGlyph(ctx,mode);
    });
  }
  function badgeIcon(label,css){
    return iconCanvas('badge|'+label+'|'+css,22,ctx=>{
      ctx.font='700 9px sans-serif';const width=Math.max(13,ctx.measureText(label).width+6);
      ctx.fillStyle=css;ctx.beginPath();ctx.arc(0,0,width/2,0,Math.PI*2);ctx.fill();
      ctx.fillStyle='#fff';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(label,0,.5);
    });
  }
  function clusterIcon(count,css,critical,overdue){
    const label=count>999?'999+':String(count),size=count>99?46:count>9?40:34;
    return iconCanvas('cluster|'+label+'|'+css+'|'+(critical?1:0)+'|'+(overdue?1:0),size,ctx=>{
      const p=host.palette(),r=size/2-3;
      ctx.fillStyle=css;ctx.globalAlpha=.28;ctx.beginPath();ctx.arc(0,0,r,0,Math.PI*2);ctx.fill();
      ctx.globalAlpha=1;ctx.fillStyle=p.card;ctx.strokeStyle=overdue?p.yellow:(critical?p.red:css);ctx.lineWidth=critical||overdue?2.6:2;
      ctx.beginPath();ctx.arc(0,0,r-5,0,Math.PI*2);ctx.fill();ctx.stroke();
      ctx.fillStyle=p.ink;ctx.font='800 11px sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(label,0,.5);
    });
  }
  function nodeIcon(kind,critical,radius){
    const p=host.palette(),fill=kind==='arrival'?p.green:p.acc,r=Math.round(radius),size=r*2+20;
    return iconCanvas('node|'+kind+'|'+(critical?1:0)+'|'+r,size,ctx=>{
      ctx.fillStyle=fill;ctx.globalAlpha=.22;ctx.beginPath();ctx.arc(0,0,r+7,0,Math.PI*2);ctx.fill();
      ctx.globalAlpha=1;ctx.strokeStyle='#fff';ctx.lineWidth=1.6;ctx.beginPath();ctx.arc(0,0,r,0,Math.PI*2);ctx.fill();ctx.stroke();
      if(critical){ctx.strokeStyle=p.red;ctx.lineWidth=2.2;ctx.beginPath();ctx.arc(0,0,r+3.5,0,Math.PI*2);ctx.stroke();}
    });
  }
  function hubIcon(kind){
    const p=host.palette(),css=host.modeColor(kind==='airport'?'air':'sea');
    return iconCanvas('hub|'+kind,20,ctx=>{
      ctx.fillStyle=p.card;ctx.strokeStyle=css;ctx.lineWidth=1.5;ctx.fillRect(-7.5,-7.5,15,15);ctx.strokeRect(-7.5,-7.5,15,15);
      ctx.fillStyle=css;
      if(kind==='airport'){ctx.rotate(-Math.PI/4);host.drawModeGlyph(ctx,'air');}
      else{ctx.strokeStyle=css;ctx.lineWidth=1.4;ctx.beginPath();ctx.moveTo(0,-4.5);ctx.lineTo(0,4.2);ctx.moveTo(-3.5,-2);ctx.lineTo(3.5,-2);ctx.moveTo(-4.2,1.6);ctx.quadraticCurveTo(0,6.4,4.2,1.6);ctx.stroke();}
    });
  }
  function haloIcon(){
    const p=host.palette();
    return iconCanvas('halo',56,ctx=>{
      const g=ctx.createRadialGradient(0,0,8,0,0,26);g.addColorStop(0,'rgba(0,0,0,0)');g.addColorStop(.55,p.red);g.addColorStop(1,'rgba(0,0,0,0)');
      ctx.globalAlpha=.55;ctx.fillStyle=g;ctx.beginPath();ctx.arc(0,0,26,0,Math.PI*2);ctx.fill();
    });
  }
  function selectionIcon(){
    const p=host.palette();
    return iconCanvas('selection|'+p.acc,44,ctx=>{
      ctx.strokeStyle='#fff';ctx.lineWidth=4;ctx.beginPath();ctx.arc(0,0,17,0,Math.PI*2);ctx.stroke();
      ctx.strokeStyle=p.acc;ctx.lineWidth=2.2;ctx.beginPath();ctx.arc(0,0,17,0,Math.PI*2);ctx.stroke();
    });
  }

  /* ---------- Model → sahne ---------- */
  function hubsFromModel(model){
    const hubs=new Map();
    const add=(kind,point,name,rec)=>{
      const key=kind+'|'+Number(point.lon).toFixed(2)+','+Number(point.lat).toFixed(2);
      if(!hubs.has(key))hubs.set(key,{key,kind,name,location:{lon:Number(point.lon),lat:Number(point.lat)},records:[]});
      const hub=hubs.get(key);if(!hub.records.includes(rec))hub.records.push(rec);
    };
    (model.placementById?[...model.placementById.values()]:[]).forEach(p=>(p.legs||[]).forEach(leg=>{
      const first=leg.points[0],last=leg.points[leg.points.length-1];if(!first||!last)return;
      if(leg.mode==='sea'){add('port',first,leg.from,p.rec);add('port',last,leg.to,p.rec);}
      else if(leg.mode==='air'){add('airport',first,leg.from,p.rec);add('airport',last,leg.to,p.rec);}
    }));
    return [...hubs.values()];
  }
  function clearCollections(){[routesBase,routesFlow,routesSelect,billboards,clusterBoards,labels,points].forEach(c=>{if(c)c.removeAll();});}
  function syncModel(force){
    if(!scene)return;
    const revision=host.modelRevision();if(!force&&revision===modelRevision)return;modelRevision=revision;
    const model=host.getModel()||{nodes:[],edges:[],vehicles:[],placementById:new Map()};
    clearCollections();
    const maxQty=Math.max(1,...model.edges.map(e=>e.qty||0));
    const data={routes:[],vehicles:[],nodes:[],hubs:[],shipments:[],labels:[],halos:[],bounds:[]};
    // Aynı malzemeli çizgiler art arda eklenir: PolylineCollection ardışık aynı
    // malzemeyi tek çizim komutunda birleştirir.
    const modeOrder=['sea','sea-air','air','road','unknown'];
    [...model.edges].sort((a,b)=>modeOrder.indexOf(a.mode)-modeOrder.indexOf(b.mode)).forEach(edge=>{
      const mode=flowMaterials[edge.mode]?edge.mode:'unknown',samples=densify(host.edgeSamples(edge));if(samples.length<2)return;
      const positions=samples.map(s=>cartesian(s,edge.mode)),width=1.3+Math.sqrt((edge.qty||0)/maxQty)*4.2,hit={type:'route',edge,records:edge.records};
      const base=routesBase.add({positions,width:width+1.2,material:baseMaterials[mode],id:hit});
      const flow=routesFlow.add({positions,width:Math.max(1.4,width*.6),material:flowMaterials[mode],id:hit});
      data.routes.push({hit,positions,base,flow,width});
      data.bounds.push(positions[0],positions[positions.length-1]);
    });
    model.nodes.forEach(bundle=>{
      const position=C.Cartesian3.fromDegrees(bundle.location.lon,bundle.location.lat,0),critical=bundle.records.some(r=>r.critical);
      const hit={type:'node',bundle,records:bundle.records};
      const nodeBoard=board(billboards,{position,image:nodeIcon(bundle.kind,critical,host.nodeRadius(bundle)),id:hit});
      const label=labels.add({position,text:bundle.kind==='arrival'?host.istanbulName():bundle.location.name,id:hit,font:'600 12px Barlow, "Segoe UI", sans-serif',fillColor:C.Color.WHITE,outlineColor:C.Color.BLACK.withAlpha(.85),outlineWidth:3,style:C.LabelStyle.FILL_AND_OUTLINE,pixelOffset:new C.Cartesian2(0,-(host.nodeRadius(bundle)+14)),horizontalOrigin:C.HorizontalOrigin.CENTER,verticalOrigin:C.VerticalOrigin.BOTTOM,disableDepthTestDistance:Number.POSITIVE_INFINITY});
      data.nodes.push({hit,position,board:nodeBoard,label,layer:'origins'});data.bounds.push(position);
      if(critical)data.halos.push({position,board:board(billboards,{position,image:haloIcon(),show:false})});
    });
    hubsFromModel(model).forEach(hub=>{
      const position=C.Cartesian3.fromDegrees(hub.location.lon,hub.location.lat,0),hit={type:'hub',hub,records:hub.records};
      const offset=hub.kind==='airport'?new C.Cartesian2(14,14):new C.Cartesian2(-14,14);
      const hubBoard=board(billboards,{position,image:hubIcon(hub.kind),pixelOffset:offset,id:hit});
      data.hubs.push({hit,position,board:hubBoard,layer:hub.kind==='airport'?'airports':'ports'});
    });
    // Tek parsiyelli araç zaten parsiyelin kendisidir; aynı noktaya ikinci simge konmaz.
    const soloRecords=new Set(model.vehicles.filter(v=>v.records.length===1).map(v=>v.records[0].id));
    (model.placementById?[...model.placementById.values()]:[]).forEach(p=>{
      if(soloRecords.has(p.rec.id))return;
      const geo=host.pointAlongLeg(p.leg,p.legProgress);if(!geo)return;
      const position=cartesian(geo,p.leg.mode),hit={type:'shipment',rec:p.rec,placement:p,records:[p.rec]};
      const point=points.add({position,pixelSize:6,color:imageryColor(host.modeColor(p.leg.mode)),outlineColor:C.Color.WHITE.withAlpha(.9),outlineWidth:1.2,id:hit,disableDepthTestDistance:Number.POSITIVE_INFINITY,distanceDisplayCondition:new C.DistanceDisplayCondition(0,LOD.shipmentPoints)});
      data.shipments.push({hit,position,point});
    });
    model.vehicles.forEach(vehicle=>{
      if(!vehicle.geo)return;
      const position=cartesian(vehicle.geo,vehicle.mode),hit={type:'vehicle',vehicle,records:vehicle.records};
      let alignedAxis=C.Cartesian3.ZERO;
      if(vehicle.mode==='air'){
        const ahead=vehicle.geo.ahead||vehicle.geo.behind;
        if(ahead){const dir=C.Cartesian3.subtract(cartesian(ahead,vehicle.mode),position,new C.Cartesian3());if(vehicle.geo.ahead==null)C.Cartesian3.negate(dir,dir);if(C.Cartesian3.magnitude(dir)>1)alignedAxis=C.Cartesian3.normalize(dir,dir);}
      }
      const vehicleBoard=board(billboards,{position,image:vehicleIcon(vehicle.mode,vehicle.critical,vehicle.overdue),id:hit,alignedAxis});
      const count=vehicle.records.length,badge=count>1?board(billboards,{position,image:badgeIcon(count>99?'99+':String(count),vehicle.critical?host.palette().red:host.modeColor(vehicle.mode)),pixelOffset:new C.Cartesian2(10,-10),id:hit}):null;
      const label=labels.add({position,text:host.vehicleTitle(vehicle),id:hit,font:'600 11px Barlow, "Segoe UI", sans-serif',fillColor:C.Color.WHITE,outlineColor:C.Color.BLACK.withAlpha(.85),outlineWidth:3,style:C.LabelStyle.FILL_AND_OUTLINE,pixelOffset:new C.Cartesian2(0,16),horizontalOrigin:C.HorizontalOrigin.CENTER,verticalOrigin:C.VerticalOrigin.TOP,disableDepthTestDistance:Number.POSITIVE_INFINITY,show:false});
      const halo=vehicle.critical?board(billboards,{position,image:haloIcon(),show:false}):null;
      data.vehicles.push({hit,vehicle,position,board:vehicleBoard,badge,label,halo,id:vehicle.id});data.bounds.push(position);
    });
    sceneData=data;
    if(hover&&!hitStillExists(hover))setHover(null);
    updateLabelFar();syncSelection();scheduleRecluster(0);requestRender();
  }
  function hitStillExists(hit){const id=host.hitIdentity(hit);return Boolean(id&&findById(id));}
  function findById(id){
    if(!sceneData||!id)return null;
    return sceneData.vehicles.find(v=>host.hitIdentity(v.hit)===id)||sceneData.routes.find(r=>host.hitIdentity(r.hit)===id)||
      sceneData.nodes.find(n=>host.hitIdentity(n.hit)===id)||sceneData.hubs.find(h=>host.hitIdentity(h.hit)===id)||sceneData.shipments.find(s=>host.hitIdentity(s.hit)===id)||null;
  }
  function updateLabelFar(){
    if(!sceneData)return;const far=q().labelFar;
    sceneData.nodes.forEach(n=>{n.label.distanceDisplayCondition=new C.DistanceDisplayCondition(0,far);});
  }

  /* ---------- Görünürlük + kümeleme (LOD) ---------- */
  function scheduleRecluster(delay){
    if(reclusterTimer)clearTimeout(reclusterTimer);
    reclusterTimer=setTimeout(()=>{reclusterTimer=0;recluster();},delay==null?90:delay);
  }
  function targetDistance(){
    const center=centerCartesian();
    return center?C.Cartesian3.distance(camera.positionWC,center):camera.positionCartographic.height;
  }
  function visible(position){return occluder.isPointVisible(position);}
  /* Ekran-uzayı ızgara kümelemesi. Uzakta araçlar piksel yarıçapı içinde
     birleşir; orta mesafede yarıçap küçülür; yakında kümeleme kapanır ve
     araç etiketleri görünür. Seçili araç hiçbir zaman kümeye gömülmez. */
  function recluster(){
    if(!scene||!sceneData||paused)return;
    occluder.cameraPosition=camera.positionWC;
    const distance=targetDistance(),selectedId=host.selection();
    const radius=distance<LOD.clusterOff?0:distance<LOD.clusterSoft?q().clusterPx*.55:q().clusterPx;
    const showVehicles=layerOn('vehicles'),showRisk=layerOn('risk'),showLabels=layerOn('labels');
    clusterBoards.removeAll();
    const candidates=[];
    sceneData.vehicles.forEach(item=>{
      const onScreen=showVehicles&&visible(item.position);
      item.board.show=false;if(item.badge)item.badge.show=false;item.label.show=false;if(item.halo)item.halo.show=false;
      if(!onScreen)return;
      const win=C.SceneTransforms.worldToWindowCoordinates(scene,item.position);if(!win)return;
      candidates.push({item,x:win.x,y:win.y,selected:host.hitIdentity(item.hit)===selectedId});
    });
    const singles=[],clusters=[];
    if(!radius){candidates.forEach(c=>singles.push(c.item));}
    else{
      const grid=new Map(),cell=(x,y)=>Math.floor(x/radius)+':'+Math.floor(y/radius),used=new Set();
      candidates.forEach((c,i)=>{const key=cell(c.x,c.y);if(!grid.has(key))grid.set(key,[]);grid.get(key).push(i);});
      const order=candidates.map((c,i)=>i).sort((a,b)=>(candidates[b].item.vehicle.qty||0)-(candidates[a].item.vehicle.qty||0));
      order.forEach(i=>{
        if(used.has(i))return;const c=candidates[i];used.add(i);
        if(c.selected){singles.push(c.item);return;}
        const members=[c],cx=Math.floor(c.x/radius),cy=Math.floor(c.y/radius);
        for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++)(grid.get((cx+dx)+':'+(cy+dy))||[]).forEach(j=>{
          if(used.has(j))return;const o=candidates[j];if(o.selected)return;
          if(Math.hypot(o.x-c.x,o.y-c.y)<=radius){used.add(j);members.push(o);}
        });
        if(members.length===1)singles.push(c.item);else clusters.push(members.map(m=>m.item));
      });
    }
    const near=distance<LOD.vehicleLabels;
    singles.forEach(item=>{
      item.board.show=true;if(item.badge)item.badge.show=true;
      if(item.halo)item.halo.show=showRisk;
      item.label.show=showLabels&&near;
    });
    clusters.forEach(members=>{
      const vehicles=members.map(m=>m.vehicle),records=vehicles.flatMap(v=>v.records),critical=vehicles.some(v=>v.critical),overdue=vehicles.some(v=>v.overdue);
      const byMode=new Map();vehicles.forEach(v=>byMode.set(v.mode,(byMode.get(v.mode)||0)+1));
      const dominant=[...byMode.entries()].sort((a,b)=>b[1]-a[1])[0][0];
      const sum=members.reduce((acc,m)=>C.Cartesian3.add(acc,m.position,acc),new C.Cartesian3());
      const surface=C.Ellipsoid.WGS84.scaleToGeodeticSurface(C.Cartesian3.divideByScalar(sum,members.length,sum));
      const position=surface||members[0].position;
      const hit={type:'cluster',vehicles,records,byMode,positions:members.map(m=>m.position)};
      board(clusterBoards,{position,image:clusterIcon(vehicles.length,host.modeColor(dominant),critical&&showRisk,overdue),id:hit});
    });
    // Sabit noktalar: katman + ufuk arkası kontrolü.
    sceneData.nodes.forEach(n=>{const on=layerOn('origins')&&visible(n.position);n.board.show=on;n.label.show=on&&showLabels;});
    sceneData.halos.forEach(h=>{h.board.show=showRisk&&layerOn('origins')&&visible(h.position);});
    sceneData.hubs.forEach(h=>{h.board.show=layerOn(h.layer)&&visible(h.position);});
    const showShipments=layerOn('shipments');
    sceneData.shipments.forEach(s=>{s.point.show=showShipments&&visible(s.position);});
    const showRoutes=layerOn('routes');
    sceneData.routes.forEach(r=>{r.base.show=showRoutes;r.flow.show=showRoutes&&prefs().routeAnimation!==false;});
    updateSelectionMarker();
    requestRender();
  }

  /* ---------- Seçim ---------- */
  function selectionTitle(hit){return host.hitTitle(hit);}
  function syncSelection(){
    const id=host.selection(),item=findById(id);
    routesSelect.removeAll();
    if(item&&item.hit.type==='route')routesSelect.add({positions:item.positions,width:item.width+5,material:selectMaterial,id:item.hit});
    renderSelectionChip(item);updateSelectionMarker();
  }
  function updateSelectionMarker(){
    if(!sceneData)return;
    const id=host.selection(),item=findById(id);
    // clusterBoards her kümelemede temizlenir; seçim halkası gerekirse yeniden eklenir.
    if(!sceneData.selectionBoard||!clusterBoards.contains(sceneData.selectionBoard))sceneData.selectionBoard=board(clusterBoards,{position:C.Cartesian3.ZERO,image:selectionIcon(),show:false});
    const ring=sceneData.selectionBoard;
    if(item&&item.hit.type!=='route'&&visible(item.position)){ring.position=item.position;ring.pixelOffset=item.board&&item.board.pixelOffset||C.Cartesian2.ZERO;ring.show=true;}
    else ring.show=false;
  }
  function renderSelectionChip(item){
    if(!item){selectionEl.hidden=true;selectionEl.innerHTML='';return;}
    selectionEl.innerHTML='<span class="gfEarthSelectionDot"></span><b title="'+host.esc(selectionTitle(item.hit))+'">'+host.esc(selectionTitle(item.hit))+'</b>'+
      '<button type="button" data-gf-earth-action="focus" title="'+host.esc(L('Seçime odaklan','Focus selection'))+'">'+ICON.focus+'<span>'+host.esc(L('Odakla','Focus'))+'</span></button>'+
      '<button type="button" data-gf-earth-action="clear-selection" aria-label="'+host.esc(L('Seçimi kaldır','Clear selection'))+'" title="'+host.esc(L('Seçimi kaldır','Clear selection'))+'">'+ICON.close+'</button>';
    selectionEl.hidden=false;
  }
  function focusSelection(){
    const item=findById(host.selection());if(!item)return false;
    const positions=item.hit.type==='route'?item.positions:[item.position];
    flyToPositions(positions,{minRange:item.hit.type==='route'?0:180e3});return true;
  }

  /* ---------- Kamera ---------- */
  function centerCartesian(){
    if(!scene)return null;const canvas=scene.canvas,center=new C.Cartesian2(canvas.clientWidth/2,canvas.clientHeight/2);
    let hit=null;
    if(tileset&&scene.pickPositionSupported){try{hit=scene.pickPosition(center);}catch(_){hit=null;}}
    return hit||camera.pickEllipsoid(center,C.Ellipsoid.WGS84)||null;
  }
  function currentPitchPreset(){return prefs().cameraPreset==='topdown'?-C.Math.PI_OVER_TWO:C.Math.toRadians(-48);}
  function clampRange(range){const ctrl=scene.screenSpaceCameraController;return Math.max(ctrl.minimumZoomDistance*1.5,Math.min(ctrl.maximumZoomDistance*.85,range));}
  function flyAround(center,heading,pitch,range,duration,complete){
    camera.cancelFlight();
    camera.flyToBoundingSphere(new C.BoundingSphere(center,0),{offset:new C.HeadingPitchRange(heading,pitch,clampRange(range)),duration:reducedMotion()?0:duration,easingFunction:C.EasingFunction.CUBIC_IN_OUT,complete});
  }
  /* Uzak mesafede eğik açı anlamsızdır (ufuk boşluğu): 6.000 km üstünde tepeden bakılır. */
  function safePitch(pitch,range){return range>LOD.perspectiveMax?-C.Math.PI_OVER_TWO:pitch;}
  function flyToPositions(positions,options){
    const list=(positions||[]).filter(Boolean);if(!list.length)return;
    const sphere=C.BoundingSphere.fromPoints(list),range=Math.max(options&&options.minRange||0,sphere.radius*2.6,2500);
    const pitch=safePitch(currentPitchPreset(),range);
    flyAround(sphere.center,0,pitch,range,options&&options.duration||1.3);
  }
  function home(){
    const bounds=sceneData&&sceneData.bounds.length?sceneData.bounds:[C.Cartesian3.fromDegrees(host.istanbul().lon,host.istanbul().lat,0)];
    const sphere=C.BoundingSphere.fromPoints(bounds),range=Math.min(2.2e7,Math.max(1.8e6,sphere.radius*2.8));
    flyAround(sphere.center,0,safePitch(currentPitchPreset(),range),range,1.4);
  }
  function zoomBy(factor){
    const center=centerCartesian();
    if(!center){if(factor<1)camera.zoomIn(camera.positionCartographic.height*.5);else camera.zoomOut(camera.positionCartographic.height);requestRender();return;}
    const range=C.Cartesian3.distance(camera.positionWC,center);
    flyAround(center,camera.heading,camera.pitch,range*factor,.55);
  }
  /* Google Earth pusula davranışı: önce kuzeye döndür, kuzeydeyse tepeden bakışa getir. */
  function resetOrientation(){
    const center=centerCartesian();if(!center){camera.setView({orientation:{heading:0,pitch:-C.Math.PI_OVER_TWO,roll:0}});requestRender();return;}
    const range=C.Cartesian3.distance(camera.positionWC,center),heading=C.Math.zeroToTwoPi(camera.heading),offNorth=Math.min(heading,C.Math.TWO_PI-heading)>C.Math.toRadians(1);
    flyAround(center,0,offNorth?camera.pitch:-C.Math.PI_OVER_TWO,range,.8);
  }
  function applyCameraPreset(){
    const center=centerCartesian();if(!center)return;
    const range=C.Cartesian3.distance(camera.positionWC,center);
    flyAround(center,camera.heading,safePitch(currentPitchPreset(),range),range,.9);
  }
  function getViewport(){
    if(!scene)return null;
    const center=centerCartesian(),carto=center?C.Cartographic.fromCartesian(center):camera.positionCartographic;
    const range=center?C.Cartesian3.distance(camera.positionWC,center):camera.positionCartographic.height;
    return {lon:C.Math.toDegrees(carto.longitude),lat:C.Math.toDegrees(carto.latitude),span:host.spanForHeight(range,camera.frustum.fovy||1)};
  }
  function cameraState(){
    const carto=camera.positionCartographic;
    return {lon:+C.Math.toDegrees(carto.longitude).toFixed(5),lat:+C.Math.toDegrees(carto.latitude).toFixed(5),height:Math.round(carto.height),heading:+camera.heading.toFixed(4),pitch:+camera.pitch.toFixed(4)};
  }
  /* Buyer Log haritasından gelen merkez/ölçek önce tepeden birebir kurulur,
     ardından tercih edilen eğime yumuşak geçilir: rapor yeniden açılıyor
     gibi değil, aynı harita eğiliyor gibi hissettirir. */
  function setViewport(vp,animate){
    if(!scene||!vp)return;
    const height=host.heightForSpan(vp.span,camera.frustum.fovy||1),lon=Number(vp.lon)||0,lat=Math.max(-85,Math.min(85,Number(vp.lat)||0));
    camera.cancelFlight();
    camera.setView({destination:C.Cartesian3.fromDegrees(lon,lat,height),orientation:{heading:0,pitch:-C.Math.PI_OVER_TWO,roll:0}});
    const pitch=safePitch(currentPitchPreset(),height);
    if(animate&&pitch!==-C.Math.PI_OVER_TWO){const center=C.Cartesian3.fromDegrees(lon,lat,0);flyAround(center,0,pitch,height,1.1);}
    requestRender();scheduleRecluster(0);
  }
  function restoreCamera(state){
    if(!state||!Number.isFinite(state.height))return false;
    camera.setView({destination:C.Cartesian3.fromDegrees(state.lon,state.lat,Math.max(150,state.height)),orientation:{heading:state.heading||0,pitch:Number.isFinite(state.pitch)?state.pitch:-C.Math.PI_OVER_TWO,roll:0}});
    return true;
  }

  /* ---------- Hover / tıklama ---------- */
  function pickHit(position){
    if(!scene)return null;let picked=null;
    try{picked=scene.pick(position,8,8);}catch(_){picked=null;}
    const id=picked&&picked.id;return id&&typeof id==='object'&&id.type&&id.records?id:null;
  }
  function clientPoint(position){const rect=scene.canvas.getBoundingClientRect();return {clientX:rect.left+position.x,clientY:rect.top+position.y};}
  function setHover(hit,position){
    const prev=hover?host.hitIdentity(hover):'',next=hit?host.hitIdentity(hit):'';hover=hit;
    scene&&(scene.canvas.style.cursor=hit?'pointer':'');
    if(!hit){host.tooltip(null);return;}
    if(position)host.tooltip(hit,clientPoint(position));
    if(prev!==next)requestRender();
  }
  function onMouseMove(movement){
    pendingMove=movement.endPosition;if(hoverFrame)return;
    hoverFrame=requestAnimationFrame(()=>{hoverFrame=0;if(paused||!pendingMove)return;const position=C.Cartesian2.clone(pendingMove);setHover(pickHit(position),position);});
  }
  function onClick(click){
    const hit=pickHit(click.position);
    if(!hit){host.select(null);return;}
    if(hit.type==='cluster'){setHover(null);flyToPositions(hit.positions,{minRange:120e3,duration:1.1});return;}
    host.select(hit);host.open(hit);
  }

  /* ---------- Kontroller / paneller ---------- */
  function button(action,icon,title,extra){return '<button type="button" class="gfEarthBtn'+(extra||'')+'" data-gf-earth-action="'+action+'" title="'+host.esc(title)+'" aria-label="'+host.esc(title)+'">'+icon+'</button>';}
  function renderControls(){
    controlsEl.innerHTML=
      button('compass',ICON.compass,L('Kuzeye döndür · tekrar tıklayınca tepeden bak','Reset to north · click again for top-down'),' gfEarthCompass')+
      '<div class="gfEarthGroup">'+button('zoom-in',ICON.plus,L('Yakınlaştır','Zoom in'))+button('zoom-out',ICON.minus,L('Uzaklaştır','Zoom out'))+'</div>'+
      button('home',ICON.fit,L('Aktif sevkiyatlara sığdır','Fit active shipments'))+
      '<div class="gfEarthGroup">'+
        button('panel-view',ICON.view,L('Görünüm','View'),panel==='view'?' active':'')+
        button('panel-layers',ICON.layers,L('Katmanlar','Layers'),panel==='layers'?' active':'')+
        button('panel-settings',ICON.settings,L('Ayarlar','Settings'),panel==='settings'?' active':'')+
      '</div>';
    compassHeading=NaN;updateCompass();
  }
  function qualityLabel(level){return ({performance:L('Performans','Performance'),balanced:L('Dengeli','Balanced'),high:L('Yüksek','High')})[level]||level;}
  function modeLabel(mode){return ({'nasa-blue-marble':L('NASA Dünya','NASA Blue Marble'),'nasa-relief':L('NASA Kabartmalı Dünya','NASA Shaded Relief'),photorealistic:L('Google Fotogerçekçi 3D','Google Photorealistic 3D'),satellite:L('Google Uydu','Google Satellite'),terrain:L('Google Arazi','Google Terrain'),offline:L('Çevrimdışı küre','Offline globe')})[mode]||mode;}
  function radio(name,value,current,label,disabled,hint){
    return '<label class="gfEarthOption'+(disabled?' is-disabled':'')+'"><input type="radio" name="'+name+'" value="'+value+'"'+(current===value?' checked':'')+(disabled?' disabled':'')+'><span>'+host.esc(label)+(hint?'<small>'+host.esc(hint)+'</small>':'')+'</span></label>';
  }
  function check(key,label,checked,hint){
    return '<label class="gfEarthOption"><input type="checkbox" data-gf-earth-layer="'+key+'"'+(checked?' checked':'')+'><span>'+host.esc(label)+(hint?'<small>'+host.esc(hint)+'</small>':'')+'</span></label>';
  }
  function viewPanelHtml(){
    const google=googleAvailable(),current=provider.status==='degraded'?'offline':resolvedMode(),noKey=L('Opsiyonel Google API anahtarı gerekli','Optional Google API key required');
    return '<h4>'+host.esc(L('Ücretsiz görüntü','Free imagery'))+'</h4>'+
      radio('gfEarthMode','nasa-relief',current,modeLabel('nasa-relief'),!freeAvailable(),L('Ücretsiz · API anahtarı yok · NASA GIBS','Free · no API key · NASA GIBS'))+
      radio('gfEarthMode','nasa-blue-marble',current,modeLabel('nasa-blue-marble'),!freeAvailable(),L('Ücretsiz · API anahtarı yok · NASA GIBS','Free · no API key · NASA GIBS'))+
      radio('gfEarthMode','offline',current,modeLabel('offline'),false,L('Tamamen yerel · internet gerekmez','Fully local · no internet required'))+
      '<h4>'+host.esc(L('Google (opsiyonel)','Google (optional)'))+'</h4>'+
      radio('gfEarthMode','photorealistic',current,modeLabel('photorealistic'),!google,google?L('Google 3D şehir ve arazi','Google 3D cities and terrain'):noKey)+
      radio('gfEarthMode','satellite',current,modeLabel('satellite'),!google,google?'':noKey)+
      radio('gfEarthMode','terrain',current,modeLabel('terrain'),!google,google?L('Kabartmalı 2D harita','Shaded-relief 2D map'):noKey)+
      (current==='satellite'?'<label class="gfEarthOption"><input type="checkbox" data-gf-earth-pref="providerLabels"'+(prefs().providerLabels!==false?' checked':'')+'><span>'+host.esc(L('Sağlayıcı yer adları','Provider place labels'))+'</span></label>':'')+
      '<h4>'+host.esc(L('Kamera','Camera'))+'</h4>'+
      radio('gfEarthCamera','perspective',prefs().cameraPreset==='topdown'?'topdown':'perspective',L('3D perspektif','3D perspective'))+
      radio('gfEarthCamera','topdown',prefs().cameraPreset==='topdown'?'topdown':'perspective',L('Tepeden','Top-down'))+
      '<p class="gfEarthHint">'+host.esc(L('Sürükle: kaydır · Sağ tık/tekerlek: yakınlaş · Ctrl+sürükle veya orta tuş: döndür/eğ','Drag: pan · Right-drag/wheel: zoom · Ctrl+drag or middle button: rotate/tilt'))+'</p>';
  }
  function layersPanelHtml(){
    const l=prefs().layers||{},on=key=>l[key]!==false;
    return '<h4>'+host.esc(L('Operasyon katmanları','Operational layers'))+'</h4>'+
      check('routes',L('Buyer Log rotaları','Buyer Log routes'),on('routes'))+
      check('vehicles',L('Araçlar (gemi · uçak · tır)','Vehicles (ship · air · truck)'),on('vehicles'),L('Uzakta kümelenir','Clustered when far'))+
      check('shipments',L('Sevkiyat noktaları','Shipment points'),on('shipments'),L('Yakında parsiyel konumları','Partial positions when near'))+
      check('ports',L('Limanlar','Ports'),on('ports'))+
      check('airports',L('Havalimanları','Airports'),on('airports'))+
      check('origins',L('Üretim ve varış noktaları','Origin and destination points'),on('origins'))+
      check('labels',L('Ülke / yer etiketleri','Country / place labels'),on('labels'))+
      '<h4>'+host.esc(L('Analiz','Analysis'))+'</h4>'+
      check('risk',L('Kritik vurgusu','Critical highlight'),on('risk'),L('Kritik parsiyel taşıyan araç ve noktalar','Vehicles and points with critical partials'));
  }
  function settingsPanelHtml(){
    const quality=prefs().quality||'balanced';
    const adaptive=adaptiveDowngraded?'<p class="gfEarthHint is-warn">'+host.esc(L('Düşük FPS nedeniyle kalite geçici olarak düşürüldü','Quality was temporarily reduced due to low FPS'))+' ('+host.esc(qualityLabel(effectiveQuality))+')</p>':'';
    let providerHtml='';
    if(status&&status.canConfigure){
      providerHtml='<h4>'+host.esc(L('Sağlayıcı (Moderatör)','Provider (Moderator)'))+'</h4>'+
        '<label class="gfEarthOption"><input type="checkbox" data-gf-earth-setting="enabled"'+(status.enabled?' checked':'')+'><span>'+host.esc(L('Earth 3D etkin','Earth 3D enabled'))+'</span></label>'+
        '<label class="gfEarthField"><span>'+host.esc(L('Sağlayıcı','Provider'))+'</span><select data-gf-earth-setting="provider"><option value="free"'+(status.provider==='free'?' selected':'')+'>'+host.esc(L('Ücretsiz · NASA GIBS','Free · NASA GIBS'))+'</option><option value="offline"'+(status.provider==='offline'?' selected':'')+'>'+host.esc(L('Yalnız çevrimdışı','Offline only'))+'</option><option value="google"'+(status.provider==='google'?' selected':'')+'>'+host.esc(L('Google Map Tiles · opsiyonel','Google Map Tiles · optional'))+'</option></select></label>'+
        '<label class="gfEarthField"><span>'+host.esc(L('Varsayılan görüntü','Default imagery'))+'</span><select data-gf-earth-setting="defaultMode">'+['nasa-relief','nasa-blue-marble','offline','photorealistic','satellite','terrain'].map(m=>'<option value="'+m+'"'+(status.defaultMode===m?' selected':'')+'>'+host.esc(modeLabel(m))+'</option>').join('')+'</select></label>'+
        (status.provider==='google'?'<label class="gfEarthField"><span>'+host.esc(L('Google API anahtarı (opsiyonel)','Google API key (optional)'))+(status.keySource==='env'?' · env':'')+'</span><input type="password" autocomplete="off" spellcheck="false" data-gf-earth-setting="apiKey" placeholder="'+host.esc(status.maskedKey||L('Tanımlı değil','Not set'))+'"></label>':'')+
        '<div class="gfEarthRow"><button type="button" class="tbtn" data-gf-earth-action="save-provider">'+host.esc(L('Kaydet','Save'))+'</button>'+(status.keySource==='settings'?'<button type="button" class="tbtn" data-gf-earth-action="clear-key">'+host.esc(L('Anahtarı sil','Remove key'))+'</button>':'')+'</div>'+
        '<p class="gfEarthHint">'+host.esc(status.provider==='google'?L('Google ücretli/limitli bir sağlayıcıdır ve yalnız isteğe bağlıdır. Anahtar sunucuda şifreli saklanır; Google Cloud tarafında Map Tiles API ile sınırlandırın.','Google is an optional paid/limited provider. The key is stored encrypted; restrict it to the Map Tiles API in Google Cloud.'):L('Önerilen ücretsiz mod NASA GIBS kullanır; API anahtarı veya Google faturalandırması gerekmez. Çevrimdışı küre de her zaman kullanılabilir.','The recommended free mode uses NASA GIBS; no API key or Google billing is required. The offline globe is always available.'))+'</p>'+
        '<p class="gfEarthHint" data-gf-earth-provider-msg></p>';
    }else if(status){
      providerHtml='<h4>'+host.esc(L('Sağlayıcı','Provider'))+'</h4><p class="gfEarthHint">'+host.esc(status.provider==='google'&&status.configured?'Google Map Tiles API · '+L('yapılandırılmış','configured'):status.provider==='offline'?L('Çevrimdışı küre · ücretsiz','Offline globe · free'):L('NASA GIBS · ücretsiz · API anahtarı gerekmez','NASA GIBS · free · no API key required'))+'</p>';
    }else if(statusLoading)providerHtml='<p class="gfEarthHint">'+host.esc(L('Sağlayıcı durumu okunuyor…','Reading provider status…'))+'</p>';
    return '<h4>'+host.esc(L('Kalite','Quality'))+'</h4>'+
      radio('gfEarthQuality','performance',quality,qualityLabel('performance'))+
      radio('gfEarthQuality','balanced',quality,qualityLabel('balanced'))+
      radio('gfEarthQuality','high',quality,qualityLabel('high'))+adaptive+
      '<h4>'+host.esc(L('Animasyon','Animation'))+'</h4>'+
      '<label class="gfEarthOption"><input type="checkbox" data-gf-earth-pref="routeAnimation"'+(prefs().routeAnimation!==false?' checked':'')+'><span>'+host.esc(L('Rota akış animasyonu','Route flow animation'))+(reducedMotion()?'<small>'+host.esc(L('Sistem hareket azaltma tercihi nedeniyle durdurulur','Paused by the system reduced-motion preference'))+'</small>':'')+'</span></label>'+
      providerHtml;
  }
  function renderPanel(){
    if(!panel){panelEl.hidden=true;panelEl.innerHTML='';return;}
    const title=panel==='view'?L('Görünüm','View'):panel==='layers'?L('Katmanlar','Layers'):L('Ayarlar','Settings');
    const body=panel==='view'?viewPanelHtml():panel==='layers'?layersPanelHtml():settingsPanelHtml();
    panelEl.innerHTML='<div class="gfEarthPanelHead"><b>'+host.esc(title)+'</b><button type="button" data-gf-earth-action="close-panel" aria-label="'+host.esc(L('Kapat','Close'))+'">'+ICON.close+'</button></div><div class="gfEarthPanelBody">'+body+'</div>';
    panelEl.hidden=false;
  }
  function togglePanel(name){
    panel=panel===name?'':name;renderControls();renderPanel();
    if(panel==='settings'&&!status&&!statusLoading)void loadStatus();
  }
  async function loadStatus(){
    statusLoading=true;renderPanel();
    try{status=await host.fetchStatus();}catch(_){status=null;}
    statusLoading=false;if(panel==='settings')renderPanel();
  }
  async function saveProvider(clearKey){
    const read=name=>panelEl.querySelector('[data-gf-earth-setting="'+name+'"]'),msg=panelEl.querySelector('[data-gf-earth-provider-msg]');
    const body=clearKey?{clearApiKey:true}:{enabled:Boolean(read('enabled')&&read('enabled').checked),provider:read('provider')&&read('provider').value,defaultMode:read('defaultMode')&&read('defaultMode').value};
    const key=read('apiKey')&&read('apiKey').value.trim();if(!clearKey&&key)body.apiKey=key;
    if(msg)msg.textContent=L('Kaydediliyor…','Saving…');
    try{
      status=await host.saveProviderSettings(body);
      runtime=await host.fetchRuntime();
      renderPanel();void applyViewMode();
    }catch(error){const m=panelEl.querySelector('[data-gf-earth-provider-msg]');if(m)m.textContent=String(error&&error.message||error);}
  }
  function renderNotice(){
    if(provider.status==='degraded'){
      noticeEl.innerHTML='<b>'+host.esc(L('Earth görüntüsü kullanılamıyor','Earth imagery unavailable'))+'</b><span>'+host.esc(provider.message)+' '+host.esc(L('Aynı veriler çevrimdışı küre üzerinde gösteriliyor.','The same data is shown on the offline globe.'))+'</span>'+
        '<div class="gfEarthRow"><button type="button" class="tbtn" data-gf-earth-action="retry">'+host.esc(L('Tekrar dene','Retry'))+'</button><button type="button" class="tbtn" data-gf-earth-action="to-buyerlog">'+host.esc(L('Buyer Log haritasına geç','Switch to Buyer Log Map'))+'</button><button type="button" class="gfEarthNoticeClose" data-gf-earth-action="dismiss-notice" aria-label="'+host.esc(L('Kapat','Close'))+'">'+ICON.close+'</button></div>';
      noticeEl.hidden=false;
    }else if(provider.status==='error'){
      noticeEl.innerHTML='<b>'+host.esc(L('Earth görüntüsü kullanılamıyor','Earth imagery unavailable'))+'</b><span>'+host.esc(provider.message)+'</span><div class="gfEarthRow"><button type="button" class="tbtn" data-gf-earth-action="retry">'+host.esc(L('Tekrar dene','Retry'))+'</button><button type="button" class="tbtn" data-gf-earth-action="to-buyerlog">'+host.esc(L('Buyer Log haritasına geç','Switch to Buyer Log Map'))+'</button></div>';
      noticeEl.hidden=false;
    }else{noticeEl.hidden=true;noticeEl.innerHTML='';}
  }
  function onUiClick(event){
    const actionEl=event.target.closest('[data-gf-earth-action]');if(!actionEl)return;
    const action=actionEl.dataset.gfEarthAction;
    if(action==='compass')resetOrientation();
    else if(action==='zoom-in')zoomBy(.5);
    else if(action==='zoom-out')zoomBy(2);
    else if(action==='home')home();
    else if(action==='panel-view')togglePanel('view');
    else if(action==='panel-layers')togglePanel('layers');
    else if(action==='panel-settings')togglePanel('settings');
    else if(action==='close-panel')togglePanel(panel);
    else if(action==='retry')void retryProvider();
    else if(action==='to-buyerlog')host.switchToBuyerLog();
    else if(action==='dismiss-notice'){noticeEl.hidden=true;}
    else if(action==='focus')focusSelection();
    else if(action==='clear-selection')host.select(null);
    else if(action==='save-provider')void saveProvider(false);
    else if(action==='clear-key')void saveProvider(true);
  }
  function onUiChange(event){
    const target=event.target;
    if(target.name==='gfEarthMode'){host.saveEarthPrefs({viewMode:target.value});void applyViewMode();return;}
    if(target.name==='gfEarthCamera'){host.saveEarthPrefs({cameraPreset:target.value});applyCameraPreset();return;}
    if(target.name==='gfEarthQuality'){host.saveEarthPrefs({quality:target.value});setQuality(target.value);renderPanel();return;}
    if(target.dataset.gfEarthLayer){const layers={...(prefs().layers||{})};layers[target.dataset.gfEarthLayer]=target.checked;host.saveEarthPrefs({layers});scheduleRecluster(0);return;}
    if(target.dataset.gfEarthPref==='routeAnimation'){host.saveEarthPrefs({routeAnimation:target.checked});scheduleRecluster(0);syncAnimation();return;}
    if(target.dataset.gfEarthPref==='providerLabels'){host.saveEarthPrefs({providerLabels:target.checked});void applyViewMode();}
  }
  async function retryProvider(){
    try{runtime=await host.fetchRuntime();}catch(_){}
    await applyViewMode();
  }
  function updateCompass(){
    if(!camera)return;const heading=camera.heading;
    if(Math.abs(heading-compassHeading)<.005)return;compassHeading=heading;
    const needle=controlsEl.querySelector('.gfEarthNeedle');if(needle)needle.setAttribute('transform','rotate('+(-C.Math.toDegrees(heading)).toFixed(1)+' 12 12)');
  }

  /* ---------- Döngü ---------- */
  function requestRender(){if(scene&&!paused)scene.requestRender();}
  function animationWanted(){return !paused&&!destroyed&&layerOn('routes')&&prefs().routeAnimation!==false&&!reducedMotion()&&Boolean(sceneData&&sceneData.routes.length);}
  /* Tüm rotalar tek bir "time" uniform'u ile akar: rota başına döngü yoktur. */
  function animationTick(now){
    animFrame=0;if(!animationWanted())return;
    if(now-lastAnimTick>=1000/q().fps-2){
      lastAnimTick=now;const t=now/1000;
      Object.values(flowMaterials).forEach(m=>{m.uniforms.time=t;});scene.requestRender();
    }
    animFrame=requestAnimationFrame(animationTick);
  }
  function syncAnimation(){
    if(animationWanted()){if(!animFrame)animFrame=requestAnimationFrame(animationTick);}
    else if(animFrame){cancelAnimationFrame(animFrame);animFrame=0;fpsWindow=[];}
  }

  /* ---------- Yaşam döngüsü ---------- */
  async function init(){
    C=await loadCesium();if(destroyed)return;
    try{runtime=await host.fetchRuntime();}catch(_){runtime={provider:'free',defaultMode:'nasa-relief',googleKey:''};}
    if(destroyed)return;
    qualityLevel=QUALITY[prefs().quality]?prefs().quality:'balanced';effectiveQuality=qualityLevel;
    const cfg=q();
    try{
      widget=new C.CesiumWidget(viewportEl,{
        baseLayer:false,scene3DOnly:true,useDefaultRenderLoop:false,requestRenderMode:true,maximumRenderTimeChange:Number.POSITIVE_INFINITY,
        useBrowserRecommendedResolution:!cfg.nativeResolution,msaaSamples:cfg.msaa,showRenderLoopErrors:false,orderIndependentTranslucency:false,
        contextOptions:{webgl:{alpha:false,antialias:false,powerPreference:'high-performance',preserveDrawingBuffer:false,failIfMajorPerformanceCaveat:false}}
      });
    }catch(error){throw Object.assign(new Error(L('WebGL başlatılamadı: ','WebGL could not start: ')+String(error&&error.message||error)),{code:'EARTH_WEBGL'});}
    scene=widget.scene;camera=widget.camera;
    scene.globe.baseColor=C.Color.fromCssColorString(getComputedStyle(document.documentElement).getPropertyValue('--navy-deep').trim()||'#1d2d3d');
    scene.globe.enableLighting=false;scene.globe.showGroundAtmosphere=true;scene.fog.enabled=true;scene.highDynamicRange=false;
    const ctrl=scene.screenSpaceCameraController;
    ctrl.minimumZoomDistance=150;ctrl.maximumZoomDistance=4.2e7;ctrl.enableCollisionDetection=true;
    // Kamera küre içine girmez, yüzey normaline göre ufkun altına eğilemez.
    ctrl.maximumTiltAngle=C.Math.toRadians(84);
    camera.percentageChanged=.01;
    occluder=new C.EllipsoidalOccluder(C.Ellipsoid.WGS84,camera.positionWC);
    buildMaterials();
    routesBase=scene.primitives.add(new C.PolylineCollection());
    routesFlow=scene.primitives.add(new C.PolylineCollection());
    routesSelect=scene.primitives.add(new C.PolylineCollection());
    points=scene.primitives.add(new C.PointPrimitiveCollection());
    billboards=scene.primitives.add(new C.BillboardCollection());
    clusterBoards=scene.primitives.add(new C.BillboardCollection());
    labels=scene.primitives.add(new C.LabelCollection());
    // Scene.render içinde widget yok edilmez; hata bir sonraki görevde işlenir.
    removers.push(scene.renderError.addEventListener((_scene,error)=>{setTimeout(()=>host.hardFail(Object.assign(new Error(L('Earth çizim hatası: ','Earth render error: ')+String(error&&error.message||error)),{code:'EARTH_RENDER'})));}));
    removers.push(camera.changed.addEventListener(()=>{scheduleRecluster(80);updateCompass();}));
    removers.push(camera.moveStart.addEventListener(()=>{setHover(null);}));
    removers.push(camera.moveEnd.addEventListener(()=>{scheduleRecluster(0);updateCompass();if(!paused)host.saveEarthPrefs({camera:cameraState()});}));
    removers.push(scene.postRender.addEventListener((_s,time)=>{
      if(firstFrameResolve){firstFrameResolve();firstFrameResolve=null;}
      sampleFrame(performance.now());updateCompass();
    }));
    removers.push(scene.globe.tileLoadProgressEvent.addEventListener(count=>{if(!tileset)setTileProgress(count);}));
    handler=new C.ScreenSpaceEventHandler(scene.canvas);
    handler.setInputAction(onMouseMove,C.ScreenSpaceEventType.MOUSE_MOVE);
    handler.setInputAction(onClick,C.ScreenSpaceEventType.LEFT_CLICK);
    const leave=()=>{pendingMove=null;setHover(null);};scene.canvas.addEventListener('pointerleave',leave);removers.push(()=>scene.canvas.removeEventListener('pointerleave',leave));
    container.addEventListener('click',onUiClick);container.addEventListener('change',onUiChange);
    removers.push(()=>{container.removeEventListener('click',onUiClick);container.removeEventListener('change',onUiChange);});
    renderControls();applyQuality();
    if(!restoreCamera(prefs().camera))camera.setView({destination:C.Cartesian3.fromDegrees(host.istanbul().lon+30,host.istanbul().lat-18,2.2e7)});
    syncModel(true);
    ready=true;
    void applyViewMode();
  }
  const readyPromise=init();

  function pause(){
    if(paused)return;paused=true;
    if(widget&&!widget.isDestroyed())widget.useDefaultRenderLoop=false;
    if(animFrame){cancelAnimationFrame(animFrame);animFrame=0;}
    if(hoverFrame){cancelAnimationFrame(hoverFrame);hoverFrame=0;}
    if(reclusterTimer){clearTimeout(reclusterTimer);reclusterTimer=0;}
    pendingMove=null;hover=null;host.tooltip(null);progressEl.hidden=true;
    if(camera&&ready)host.saveEarthPrefs({camera:cameraState()});
  }
  function resume(){
    if(destroyed||!widget)return;
    if(!paused){requestRender();return;}
    paused=false;widget.useDefaultRenderLoop=true;widget.resize();
    syncModel(false);syncSelection();scheduleRecluster(0);syncAnimation();requestRender();
  }
  function destroy(){
    if(destroyed)return;pause();destroyed=true;providerToken++;
    removers.splice(0).forEach(fn=>{try{fn();}catch(_){}});
    try{handler&&handler.destroy();}catch(_){}
    handler=null;
    if(widget&&!widget.isDestroyed()){
      // GPU belleği GC'yi beklemeden bırakılır.
      let gl=null;try{gl=scene.context._gl;}catch(_){}
      try{widget.destroy();}catch(_){}
      try{const ext=gl&&gl.getExtension('WEBGL_lose_context');if(ext)ext.loseContext();}catch(_){}
    }
    widget=null;scene=null;camera=null;tileset=null;sceneData=null;iconCache.clear();
    container.innerHTML='';
  }

  return {
    ready:readyPromise,
    firstFrame,
    isPaused:()=>paused,
    isDestroyed:()=>destroyed,
    pause,resume,destroy,
    update(reason){
      if(destroyed||!scene)return;
      if(reason==='theme'){iconCache.clear();buildMaterialsSafe();syncModel(true);renderControls();renderPanel();return;}
      if(reason==='language'){renderControls();renderPanel();renderNotice();syncModel(true);return;}
      if(reason==='selection'){syncSelection();scheduleRecluster(0);requestRender();return;}
      if(paused)return;
      syncModel(false);syncAnimation();
    },
    getViewport,setViewport,home,focusSelection,
    /* Escape önce açık Earth panelini kapatır. */
    handleEscape(){if(!panel)return false;togglePanel(panel);return true;},
    providerState:()=>({...provider}),
    /* Tanılama: görünür küme/araçların ekran konumları (tarayıcı doğrulaması ve destek için). */
    inspect(){
      if(!scene||!sceneData)return null;const rect=scene.canvas.getBoundingClientRect(),out={clusters:[],vehicles:[],camera:cameraState(),distance:Math.round(targetDistance())};
      const at=position=>{const win=C.SceneTransforms.worldToWindowCoordinates(scene,position);return win?{x:Math.round(rect.left+win.x),y:Math.round(rect.top+win.y)}:null;};
      for(let i=0;i<clusterBoards.length;i++){const b=clusterBoards.get(i);if(b.show&&b.id&&b.id.type==='cluster'){const p=at(b.position);if(p)out.clusters.push({...p,count:b.id.vehicles.length});}}
      sceneData.vehicles.forEach(v=>{if(v.board.show){const p=at(v.position);if(p)out.vehicles.push({...p,id:v.id,mode:v.vehicle.mode,label:v.label.show});}});
      return out;
    },
    stats:()=>({paused,destroyed,animating:Boolean(animFrame),quality:effectiveQuality,vehicles:sceneData?sceneData.vehicles.length:0,routes:sceneData?sceneData.routes.length:0,clusters:clusterBoards?clusterBoards.length:0,provider:provider.mode,providerStatus:provider.status,tileProgress})
  };
  function buildMaterialsSafe(){
    // Tema değişince malzemeler yeni paletle yeniden kurulur; eski rotalar syncModel'de silinir.
    if(!scene)return;[routesBase,routesFlow,routesSelect].forEach(c=>c&&c.removeAll());destroyMaterials();buildMaterials();
  }
}

/* Saf hesap testleri için Node'da da yüklenebilir. */
const api={create,QUALITY,QUALITY_ORDER,LOD,ROUTE_BASE_HEIGHT,AIR_ARC_SCALE,MAX_SAMPLE_STEP_DEG};
if(typeof module==='object'&&module.exports)module.exports=api;
else root.BLGlobalFlowEarth=api;
})(typeof window!=='undefined'?window:globalThis);
