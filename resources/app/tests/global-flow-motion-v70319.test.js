'use strict';
// Global Flow 7.0.319: taşıma tipi simgeleri, birleşik araç rozetleri, kritik
// alarm nabzı ve hover özeti.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const SOURCE=fs.readFileSync(path.join(__dirname,'../public/overview-global-flow.js'),'utf8');
const CSS=fs.readFileSync(path.join(__dirname,'../public/ui-components.css'),'utf8');

function clusterHarness({motion=true}={}){
  const calls=[];
  const ctx={save(){},restore(){},translate(){},scale(){},rotate(){},beginPath(){},fill(){},stroke(){},moveTo(){},lineTo(){},set fillStyle(v){calls.push(['fill',v]);},get fillStyle(){return '';},strokeStyle:'',lineWidth:1,globalAlpha:1};
  const context={ctx,calls,state:{hover:null,intro:null},document:{documentElement:{dataset:{}}},reducedMotion:()=>!motion,clamp:(v,a,b)=>Math.max(a,Math.min(b,v)),
    modeColor:mode=>'mode:'+mode,glyphMode:mode=>mode,drawModeGlyph:(c,mode)=>calls.push(['glyph',mode]),plotSquare:(c,x,y,r)=>calls.push(['square',r])};
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

test('birleşik simge: 2–3 araç kadar rozet, fazlası üç rozet ve + işareti',()=>{
  const two=clusterHarness();two.drawVehicleCluster(two.ctx,cluster(['sea','air']),p,0);
  assert.deepEqual(two.calls.filter(c=>c[0]==='glyph').map(c=>c[1]),['sea','air']);
  const three=clusterHarness();three.drawVehicleCluster(three.ctx,cluster(['road','air','sea']),p,0);
  assert.equal(three.calls.filter(c=>c[0]==='glyph').length,3);
  assert.equal(three.calls.filter(c=>c[0]==='square'&&c[1]===6.5).length,0,'üç araçta + yok');
  const five=clusterHarness();five.drawVehicleCluster(five.ctx,cluster(['sea','sea','air','road','air'],{overdue:true}),p,0);
  assert.equal(five.calls.filter(c=>c[0]==='glyph').length,3);
  assert.equal(five.calls.filter(c=>c[0]==='square'&&c[1]===6.5).length,1,'üçten fazla araçta + işareti');
  assert.ok(five.calls.some(c=>c[0]==='fill'&&c[1]==='yellow'),'gizli araçların gecikmesi + işaretinde görünür');
  assert.match(SOURCE,/symbol\.overdue\?p\.yellow/);
});

test('kritik alarm yalnız hareket izinliyken nabız çizer; azaltılmış harekette durağan kalır',()=>{
  const on=clusterHarness({motion:true});on.drawVehicleCluster(on.ctx,cluster(['sea','air'],{critical:true}),p,350);
  const off=clusterHarness({motion:false});off.drawVehicleCluster(off.ctx,cluster(['sea','air'],{critical:true}),p,350);
  assert.ok(on.calls.filter(c=>c[0]==='fill'&&c[1]==='red').length>=1,'nabız zemini kırmızı');
  assert.ok(on.calls.filter(c=>c[0]==='square').length>off.calls.filter(c=>c[0]==='square').length,'harekette ek alarm halkaları');
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
