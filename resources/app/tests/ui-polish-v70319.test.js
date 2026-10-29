'use strict';
// 7.0.319 sadeleştirme: tutarlı segment/sekme, düz menü satırları, tek bağlantı
// düğmesi, Görünüm menüsü, seçim çubuğu, katlanabilir Veri Yönetimi panelleri.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const read=f=>fs.readFileSync(path.join(__dirname,'../public',f),'utf8');
const HTML=read('index.html'),CSS=read('ui-components.css'),MOTION=read('motion-plus.js'),BAR=read('selection-action-bar.js');
const block=CSS.slice(CSS.indexOf('/* ===== v7.0.319'));

test('vurgu dolgusu yalnız birincil eylemde: segmentler seçim zemini, sekmeler alt çizgi kullanır',()=>{
  assert.match(block,/html:root\[data-ui-system="manifest"\] :is\(\.ovPremiumSegment,[^)]*\.bpaSeg2[^)]*,\.cpaSeg\) > button:is\(\.isActive,\.is-active,\.is-on,\.active,\[aria-pressed="true"\],\[aria-selected="true"\]\) \{background:var\(--ui-selected\) !important;color:var\(--ui-selected-ink\) !important/);
  assert.match(block,/:is\(\.ovHomePager,\.pdTabs,\.dmLabTabs,\.psaTabs\) > button:is\([^)]*\)::after \{content:"";position:absolute;left:0;right:0;bottom:0;height:2px;background:var\(--ui-accent\)/);
  assert.match(block,/:is\(\.toolbarMoreMenu,\.railAppearanceMenu,#corporateConnections\) :is\([^)]*\) \{border:0 !important;box-shadow:none !important;background:transparent !important/);
  assert.match(block,/:is\(\.dmTitle,\.autoHeader h2,\.ovInboxHead > b\) \{font:600 var\(--ui-font-xl\)\/1\.15 var\(--ui-font-heading\) !important;letter-spacing:\.6px !important;text-transform:uppercase/);
});

test('Motion+ seçim çizgisini yalnız transform/opacity ile kaydırır ve hareket kapalıyken çalışmaz',()=>{
  const fn=MOTION.slice(MOTION.indexOf('function slideSegment()'),MOTION.indexOf('function updateActivity('));
  assert.match(fn,/if\(!press\|\|!enabled\(\)\)return;/);
  assert.match(fn,/\{opacity:1,transform:'translate3d\('/);
  assert.doesNotMatch(fn,/backgroundColor|width:|left:\s*\[/);
  assert.match(MOTION,/doc\.addEventListener\('pointerdown',rememberSegment,true\);\s*doc\.addEventListener\('click',slideSegment\);/);
});

test('üst çubukta tek Bağlantılar düğmesi üç oturum düğmesini ve durum noktalarını taşır',()=>{
  assert.match(HTML,/id="corporateConnectionsBtn" aria-haspopup="true" aria-expanded="false" aria-controls="corporateConnections"[^>]*data-i18n-title-en="Corporate connections"/);
  for(const key of ['lcwai','plm','oab'])assert.match(HTML,new RegExp(`data-corporate-dot="${key}"`));
  assert.match(HTML,/class="corporateConnections" id="corporateConnections"[^>]*hidden>/);
  assert.match(read('corporate-connections-toolbar.js'),/if \(dot\) dot\.dataset\.state = state;/);
  assert.match(block,/\.accessModeBadge \{display:none !important/);
});

test('Görünüm menüsü dil, tema ve boyut düğmelerini aynı kimliklerle toplar',()=>{
  const menu=HTML.slice(HTML.indexOf('id="railAppearanceMenu"'),HTML.indexOf('</aside>'));
  for(const id of ['railLangBtn','railThemeBtn','railFontSizeBtn'])assert.match(menu,new RegExp(`id="${id}"`));
  assert.match(HTML,/id="railAppearanceBtn" aria-haspopup="true" aria-expanded="false" aria-controls="railAppearanceMenu"[^>]*data-i18n-title-en="Appearance: language, theme and interface size"/);
});

function mountBar({tab='cp',cp=0,disabled={}}={}){
  const listeners={},nodes={};
  const el=()=>({hidden:false,dataset:{},children:[],attrs:{},className:'',id:'',innerHTML:'',appendChild(c){this.children.push(c);},setAttribute(k,v){this.attrs[k]=v;},addEventListener(t,f){(this.l||(this.l={}))[t]=f;},contains:()=>false,querySelector:()=>null});
  for(const id of ['navCopy','cpExcelBtn','cpToolsBtn'])nodes[id]={id,disabled:Boolean(disabled[id]),clicks:0,click(){this.clicks++;}};
  const body=el();body.dataset.activeTab=tab;
  const document={readyState:'complete',body,createElement:el,getElementById:id=>nodes[id]||null,addEventListener:(t,f)=>{listeners[t]=f;}};
  const window={document,appLang:'tr',requestAnimationFrame:f=>{f();return 1;},setInterval:()=>1,clearInterval(){},MutationObserver:class{observe(){}}};
  const ctx={window,appLang:'tr',state:{cpSelected:new Set(Array.from({length:cp},(_,i)=>i)),ordersSelected:new Set()},kolSelected:new Set()};
  vm.runInNewContext(BAR,ctx);
  return {ctx,bar:body.children[0].children[0],nodes,fire:()=>listeners.change({target:{}})};
}

test('seçim çubuğu yalnız seçim varken görünür, gerçek düğmelerin pasif durumunu yansıtır',()=>{
  const empty=mountBar({cp:0});
  assert.equal(empty.bar.hidden,true);
  const s=mountBar({cp:3,disabled:{cpExcelBtn:false,navCopy:true}});
  assert.equal(s.bar.hidden,false);
  assert.match(s.bar.innerHTML,/<b>3<\/b> satır seçili/);
  assert.match(s.bar.innerHTML,/data-selection-target="navCopy" disabled/);
  assert.match(s.bar.innerHTML,/data-selection-target="cpExcelBtn">/);
  s.ctx.state.cpSelected.clear();s.fire();
  assert.equal(s.bar.hidden,true);
  const other=mountBar({tab:'overview',cp:5});
  assert.equal(other.bar.hidden,true);
});

test('seçim çubuğu iş mantığı içermez: yalnız sayfadaki düğmeye tıklar',()=>{
  assert.match(BAR,/const target=doc\.getElementById\(button\.dataset\.selectionTarget\|\|''\);\s*if\(target&&!target\.disabled\)target\.click\(\);/);
  assert.doesNotMatch(BAR,/fetch\(|\.delete\(|\.clear\(\)|localStorage/);
  assert.match(HTML,/<script src="motion-plus\.js\?v=__BL_ASSET_VERSION__"><\/script>\n<script src="selection-action-bar\.js\?v=__BL_ASSET_VERSION__"><\/script>/);
});

test('Veri Yönetimi panelleri başlıktan katlanır; durum kullanıcıya ayrılmış anahtarda saklanır',()=>{
  const dm=read('data-management.js');
  for(const key of ['modes','tools','refresh','modules'])assert.match(dm,new RegExp(`data-dm-panel="${key}"`));
  assert.match(dm,/const panelToggle = event\.target\.closest\('\[data-dm-panel-toggle\]'\);/);
  assert.match(dm,/decorateCollapsiblePanels\(\);\s*syncSourceModes\(\);\s*\}/);
  assert.match(read('user-storage.js'),/'bl\.dataManagement\.'/);
  assert.match(block,/\.dmPanel\.isCollapsed > :not\(\.dmPanelHead\) \{display:none !important/);
});

test('harita ülke etiketleri düğüm ve araç işaretlerinin üstüne yazılmaz',()=>{
  const flow=read('overview-global-flow.js'),fn=flow.slice(flow.indexOf('function drawCountryLabels('),flow.indexOf('function drawReferenceHubs('));
  assert.match(fn,/const rects=\(scene\.symbols\|\|\[\]\)\.filter\(/);
  assert.match(fn,/!rects\.some\(r=>/);
});

test('Fiyat Masası boş durumu ortak BLUI kart desenini TR/EN kullanır',()=>{
  const q=read('quotations.js');
  assert.match(q,/qLang\('Fiyat çalışması seçilmedi','No quotation selected'\)/);
  assert.match(q,/window\.BLUI\.stateView\(\{kind:'empty',icon:'bl-n13',title:emptyTitle,detail:emptyDetail\}\)/);
});

test('Filtreleri Temizle diğer araç düğmeleri gibi ortak çerçeveyi kullanır',()=>{
  const rule=CSS.slice(CSS.indexOf('.toolbar>.navActionBtn.toolbarFramedAction {'),CSS.indexOf('}',CSS.indexOf('.toolbar>.navActionBtn.toolbarFramedAction {')));
  assert.ok(rule.length>0);
  assert.doesNotMatch(rule,/border:0/);
});

test('kapatılan seçim çubuğu seçim boşalıp aynı sayıda yeniden seçilince tekrar görünür',()=>{
  const s=mountBar({cp:1});
  assert.equal(s.bar.hidden,false);
  s.bar.l.click({target:{closest:()=>({dataset:{selectionDismiss:''}})},stopPropagation(){}});
  assert.equal(s.bar.hidden,true);
  s.ctx.state.cpSelected.clear();s.fire();
  s.ctx.state.cpSelected.add('other');s.fire();
  assert.equal(s.bar.hidden,false);
});
