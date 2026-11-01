'use strict';
// Global Flow 7.0.319: taşıma tipi simgeleri, birleşik araç rozetleri, kritik
// alarm nabzı ve hover özeti.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const SOURCE=fs.readFileSync(path.join(__dirname,'../public/overview-global-flow.js'),'utf8');
const CSS=fs.readFileSync(path.join(__dirname,'../public/ui-components.css'),'utf8');

function clusterHarness({motion=true}={}){
  const calls=[];
  const ctx={save(){},restore(){},translate(){},scale(){},rotate(){},beginPath(){},fill(){},stroke(){},moveTo(){},lineTo(){},arc(x,y,r){calls.push(['dot',x,y,r]);},set fillStyle(v){calls.push(['fill',v]);},get fillStyle(){return '';},set strokeStyle(v){calls.push(['stroke',v]);},lineWidth:1,globalAlpha:1};
  const context={ctx,calls,state:{hover:null,intro:null},document:{documentElement:{dataset:{}}},reducedMotion:()=>!motion,clamp:(v,a,b)=>Math.max(a,Math.min(b,v)),
    modeColor:mode=>'mode:'+mode,glyphMode:mode=>mode,drawModeGlyph:(c,mode,size)=>calls.push(['glyph',mode,size]),plotSquare:(c,x,y,r)=>calls.push(['square',r])};
  vm.createContext(context);
  vm.runInContext(SOURCE.slice(SOURCE.indexOf('const ALARM_PERIOD'),SOURCE.indexOf('const STAGE_META')),context);
  return context;
}
const p={red:'red',yellow:'yellow',acc:'acc',card:'card',muted:'muted'};
const cluster=(modes,extra={})=>({kind:'vehicleCluster',x:0,y:0,vehicles:modes.map(mode=>({mode})),...extra});

test('gemi, uçak ve tır tanınabilir tek kaynaklı simgelerle çizilir; gösterge ve Earth aynı simgeyi kullanır',()=>{
  for(const mode of ['sea','air','road'])assert.match(SOURCE,new RegExp(`\\n  ${mode}:'M[^']+'`));
  assert.match(SOURCE,/new Path2D\(MODE_GLYPH_PATHS\[key\]\)/);
  assert.match(SOURCE,/function glyphMode\(mode\)\{return mode==='sea-air'\?'sea':/);
  assert.match(SOURCE,/dot\.outerHTML=modeGlyphSvg\(mode,'gfLegendIcon'\)/);
  assert.match(SOURCE,/referenceHubs,L,esc,isEn,palette,drawModeGlyph,modeGlyphSvg,/);
  assert.match(SOURCE,/purple:css\('--ui-chart-3','#376f73'\)/,'uçak, tırdan ayrı kanonik renk kullanır');
});

test('araç kümesi, sayısı ve taşıma tipi ne olursa olsun tek küçük filo rozeti kullanır',()=>{
  for(const modes of [['sea','air'],['road','air','sea'],['sea','sea','air','road','air']]){
    const h=clusterHarness();h.drawVehicleCluster(h.ctx,cluster(modes,{overdue:true}),p,0);
    assert.deepEqual(h.calls.filter(c=>c[0]==='glyph').map(c=>c[1]),['fleet']);
    assert.equal(h.calls.filter(c=>c[0]==='square').length,2,'yalnız tek rozetin çerçevesi ve zemini');
    assert.ok(h.calls.filter(c=>c[0]==='square').every(c=>c[1]<=11),'tek araç boyutunu aşmaz');
    assert.ok(h.calls.some(c=>c[0]==='stroke'&&c[1]==='yellow'),'kümenin gecikmesi çerçevede görünür');
  }
  const h=clusterHarness({motion:false});h.drawVehicleCluster(h.ctx,cluster(['sea','air'],{critical:true}),p,0);
  assert.ok(h.calls.some(c=>c[0]==='stroke'&&c[1]==='red'),'kritik küme durağan kırmızı çerçeveyi korur');
});

test('kritik alarm, büyüyen halkalar yerine hareket kapalıyken de görünen küçük bir noktadır',()=>{
  for(const motion of [true,false]){
    const h=clusterHarness({motion});h.drawAlarm(h.ctx,10,20,11,p,350);
    assert.equal(h.calls.filter(c=>c[0]==='square').length,0,'haritaya yayılan halka yok');
    const dots=h.calls.filter(c=>c[0]==='dot');assert.equal(dots.length,1);
    assert.ok(dots[0][3]<=2.5,'uyarı noktası en çok 5 px çapında');
  }
  const fn=SOURCE.slice(SOURCE.indexOf('function flowMotionAllowed()'),SOURCE.indexOf('function symbolCritical('));
  assert.match(fn,/!reducedMotion\(\)&&root\.dataset\.blMotion!=='off'&&root\.dataset\.blRender!=='software'/);
});

test('harita yalnız canlıyken ve gerekirken yeniden çizilir; yalnız alarm ~12 fps ile sınırlı',()=>{
  assert.match(SOURCE,/const motion=flowMotionAllowed\(\)&&\(transient\|\|alarm\);/);
  assert.match(SOURCE,/state\.alarmOnly=motion&&!transient&&!animate;/);
  assert.match(SOURCE,/const minGap=state\.globeInertia\?16:\(state\.alarmOnly\?80:50\);/);
  assert.match(SOURCE,/function draw\(now\)\{\n  state\.frame=0;if\(!isLive\(\)\|\|state\.engine!=='buyerlog'\)return;/);
  assert.match(SOURCE,/function wantsAnimation\(\)\{return document\.documentElement\.dataset\.uiSystem!=='manifest'/,'genel rota akışı manifestte kapalı kalır');
});

test('hover özeti: taşıma simgesi, parsiyel/sipariş/adet, ilerleme ve hatta yük akışı',()=>{
  assert.match(SOURCE,/lines\.push\(routeTransportLabel\(edge\)/);
  assert.match(SOURCE,/'<div class="gfTipStats">'/);
  assert.match(SOURCE,/'<div class="gfTipProgress" role="presentation"><i style="--gf-progress:'/);
  assert.match(SOURCE,/L\('parsiyel','partials'\)\],\[new Set\(summaryRecords\.map\(r=>r\.orderKey\|\|r\.id\)\)\.size,L\('sipariş','orders'\)\],\[totalOf\(summaryRecords\),L\('adet','units'\)\]/);
  assert.match(SOURCE,/if\(flowMotionAllowed\(\)\)items\.forEach\(item=>\{if\(item\.edge&&item\.color\)drawRouteParticles\(ctx,item,now\);\}\);/);
  assert.match(CSS,/\.globalFlowTooltip \.gfTipStats \{display:grid;grid-template-columns:repeat\(3,1fr\)/);
});
