'use strict';

/* Fiyat & Üretici Analizi v3 — ekran sade buyer asistanı olarak yeniden yazıldı
   ve LFL'deki "Üretici & Ülke Sipariş Analizi" bu modüle taşındı.
   Motor testleri gerçek hesapları, görünüm testleri kaynak sözleşmesini ve
   her sekmenin hatasız çizildiğini (vm + sahte kök) doğrular. */
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const ROOT=path.join(__dirname,'..');
const read=file=>fs.readFileSync(path.join(ROOT,file),'utf8');
const E=require('../public/price-supplier-insights-engine.js');

let seq=0;
const obs=(season,manufacturer,classification,price,quantity,extra={})=>({season,manufacturer,classification,price,quantity,currency:'USD',modelKey:`${manufacturer}-${classification}-${season}-${seq++}`,country:'Türkiye',buyingGroup:'Erkek',buyer:'Ayşe',mag:'M1',mmyg:'Y1',productGroup:'Triko',...extra});

test('aynı üreticinin farklı yazımları tek anahtarda birleşir; adetli veri ağırlıklı analiz edilir',()=>{
  const data=E.prepare([obs('26Y','Akın Tekstil','Kazak',10,100),obs('26Y','AKIN TEKSTİL','Kazak',12,300)]);
  assert.equal(data.weighted,true);
  const model=E.analyze(data,{currentSeason:'26Y'});
  assert.equal(model.manufacturers.length,1);
  assert.equal(model.manufacturers[0].name,'Akın Tekstil');
  assert.equal(model.totals.volume,400);
  assert.equal(model.totals.price,11.5,'adet ağırlıklı ortalama');
  const quotes=E.prepare([{...obs('26Y','A','Kazak',10,0),quantity:null},{...obs('26Y','B','Kazak',14,0),quantity:null}]);
  assert.equal(quotes.weighted,false,'adetsiz teklif listesinde her kayıt bir sayılır');
  assert.equal(E.analyze(quotes,{currentSeason:'26Y'}).totals.volume,2);
});

test('sezonlar sıralanır, varsayılan kıyas önceki sezondur; yeni ve ayrılan üreticiler bulunur',()=>{
  const data=E.prepare([obs('25Y','A','Kazak',10,100),obs('25Y','GONE','Kazak',10,40),obs('26Y','A','Kazak',10,120),obs('26Y','NEW','Kazak',9,50)]);
  const seasons=E.seasons(data);
  assert.deepEqual(seasons,['25Y','26Y']);
  assert.deepEqual(E.defaultPeriods(seasons),{currentSeason:'26Y',previousSeason:'25Y'});
  const model=E.analyze(data,E.defaultPeriods(seasons));
  const status=Object.fromEntries(model.manufacturers.map(m=>[m.name,m.status]));
  assert.equal(status.NEW,'new');assert.equal(status.GONE,'exit');assert.equal(status.A,'growing');
  assert.equal(model.totals.newManufacturers,1);assert.equal(model.totals.exitManufacturers,1);
  assert.deepEqual(E.newcomers(model).map(m=>m.name),['NEW']);
  assert.deepEqual(E.leavers(model).map(m=>m.name),['GONE']);
  const allSeasons=E.analyze(data,{currentSeason:'',previousSeason:'25Y'});
  assert.equal(allSeasons.hasComparison,false,'tüm sezonlar seçiliyken kıyas yapılmaz');
  assert.equal(allSeasons.totals.volume,310);
  const shares=model.manufacturers.reduce((sum,m)=>sum+m.share,0);
  assert.ok(Math.abs(shares-100)<1e-9,'güncel paylar %100 eder');
});

test('klasmanda en avantajlı üretici yalnız yeterli örneği olanlar arasından seçilir',()=>{
  const data=E.prepare([
    obs('26Y','CHEAP','Kazak',8,10),obs('26Y','CHEAP','Kazak',8,10),
    obs('26Y','MID','Kazak',10,100),obs('26Y','MID','Kazak',10,100),
    obs('26Y','ONEOFF','Kazak',5,10),
    obs('26Y','SOLO','Hırka',20,50),obs('26Y','SOLO','Hırka',20,50),
  ]);
  const model=E.analyze(data,{currentSeason:'26Y',minSample:2});
  const kazak=model.groups.find(g=>g.name==='Kazak'),hirka=model.groups.find(g=>g.name==='Hırka');
  assert.equal(kazak.best.name,'CHEAP','tek modellik ONEOFF kıyasa girmez');
  assert.ok(kazak.best.index<0);
  assert.equal(kazak.leader.name,'MID','en çok çalışılan hacim lideridir');
  assert.equal(kazak.suppliers.find(s=>s.name==='ONEOFF').eligible,false);
  assert.equal(hirka.best,null);assert.equal(hirka.comparable,false,'tek üreticili grupta kazanan ilan edilmez');
  const cheap=model.manufacturers.find(m=>m.name==='CHEAP');
  assert.ok(cheap.priceLevel<0);assert.equal(cheap.strengths[0].name,'Kazak');
});

test('fiyat değişimi aynı klasman içinde ölçülür; ürün karması kayması zam gibi görünmez',()=>{
  const data=E.prepare([
    obs('25Y','A','Tişört',5,100),obs('25Y','A','Tişört',5,100),obs('25Y','A','Mont',50,10),obs('25Y','A','Mont',50,10),
    obs('26Y','A','Tişört',5,10),obs('26Y','A','Tişört',5,10),obs('26Y','A','Mont',50,100),obs('26Y','A','Mont',50,100),
    obs('25Y','B','Tişört',5,100),obs('25Y','B','Tişört',5,100),obs('26Y','B','Tişört',5.5,100),obs('26Y','B','Tişört',5.5,100),
  ]);
  const model=E.analyze(data,{currentSeason:'26Y',previousSeason:'25Y'});
  const a=model.manufacturers.find(m=>m.name==='A'),b=model.manufacturers.find(m=>m.name==='B');
  assert.ok(a.price>a.previousPrice*3,'ham ortalama karmadan dolayı sıçrar');
  assert.equal(E.round(a.priceChange,6),0,'like-for-like değişim sıfırdır');
  assert.equal(E.round(b.priceChange,6),10);
  const movers=E.priceMovers(model);
  assert.deepEqual(movers.up.map(m=>m.name),['B']);
  assert.equal(movers.down.length,0);
});

test('karışık para biriminde fiyat yalnız seçilen para biriminden, hacim tüm kayıtlardan hesaplanır',()=>{
  const data=E.prepare([obs('26Y','A','Kazak',10,100),obs('26Y','A','Kazak',10,100),obs('26Y','T','Kazak',300,50,{currency:'TRY',country:'Türkiye'}),obs('26Y','T','Kazak',300,50,{currency:'TRY'})]);
  assert.deepEqual(data.currencies,['USD','TRY']);
  const usd=E.analyze(data,{currentSeason:'26Y'});
  assert.equal(usd.currency,'USD');assert.equal(usd.totals.price,10);assert.equal(usd.totals.volume,300);
  assert.equal(usd.manufacturers.find(m=>m.name==='T').price,null);
  const tr=E.analyze(data,{currentSeason:'26Y',currency:'TRY'});
  assert.equal(tr.totals.price,300);
});

test('filtreler büyük/küçük harf ve Türkçe karakterden bağımsız uygulanır',()=>{
  const data=E.prepare([obs('26Y','A','Kazak',10,100,{buyingGroup:'Kız Çocuk'}),obs('26Y','B','Kazak',10,100,{buyingGroup:'Erkek'})]);
  const model=E.analyze(data,{currentSeason:'26Y',filters:{buyingGroup:'KIZ ÇOCUK'}});
  assert.deepEqual(model.manufacturers.map(m=>m.name),['A']);
  assert.deepEqual(E.dimensionValues(data,'buyingGroup'),['Erkek','Kız Çocuk']);
});

test('çoklu filtreler aynı alan içinde OR, farklı alanlar arasında AND çalışır',()=>{
  const data=E.prepare([
    obs('26Y','A','Kazak',10,100,{country:'Türkiye',buyingGroup:'Erkek'}),
    obs('26Y','B','Kazak',10,100,{country:'Mısır',buyingGroup:'Erkek'}),
    obs('26Y','C','Kazak',10,100,{country:'China',buyingGroup:'Erkek'}),
    obs('26Y','D','Kazak',10,100,{country:'Türkiye',buyingGroup:'Kadın'}),
  ]);
  const model=E.analyze(data,{currentSeason:'26Y',filters:{country:['Türkiye','Mısır'],buyingGroup:['Erkek']}});
  assert.deepEqual(model.manufacturers.map(m=>m.name).sort(),['A','B']);
});

test('kim kiminle: her grup için ilk üç üretici + diğer payı %100 eder ve detay kayıtlarını taşır',()=>{
  const rows=['A','B','C','D','E'].map((m,i)=>obs('26Y',m,'Kazak',10,10*(5-i),{buyingGroup:'Kadın'}));
  const model=E.analyze(E.prepare(rows),{currentSeason:'26Y'});
  const [row]=E.relations(model,'buyingGroup');
  assert.equal(row.name,'Kadın');
  assert.deepEqual(row.segments.map(s=>s.name),['A','B','C']);
  assert.equal(row.other.count,2);
  const total=row.segments.reduce((sum,s)=>sum+s.share,0)+row.other.share;
  assert.ok(Math.abs(total-100)<1e-9);
  assert.equal(row.other.items.length,2);
});

test('asistan önerileri TR/EN düz dilde üretilir ve ilgili sekmeye yönlendirir',()=>{
  const data=E.prepare([
    obs('25Y','A','Kazak',10,100),obs('25Y','A','Kazak',10,100),obs('26Y','A','Kazak',11,100),obs('26Y','A','Kazak',11,100),
    obs('26Y','CHEAP','Kazak',8,20),obs('26Y','CHEAP','Kazak',8,20),
  ]);
  const model=E.analyze(data,{currentSeason:'26Y',previousSeason:'25Y'});
  const tr=E.insights(model,'tr'),en=E.insights(model,'en');
  assert.ok(tr.length>=3&&tr.length<=6);assert.equal(tr.length,en.length);
  assert.ok(tr.some(item=>item.tab==='advantage'&&/CHEAP/.test(item.text)&&/avantajlı/.test(item.text)));
  assert.ok(tr.some(item=>item.tab==='movement'&&/Fiyatı en çok artan üretici A/.test(item.text)));
  assert.ok(tr.some(item=>item.tab==='movement'&&/yeni üretici/.test(item.text)));
  assert.ok(en.some(item=>/Best value in Kazak: CHEAP/.test(item.text)));
  assert.deepEqual(E.insights(E.analyze(E.prepare([]),{}),'tr'),[]);
});

test('LFL görünümünden Üretici & Ülke Sipariş Analizi paneli ve dosyaları kaldırıldı',()=>{
  const html=read('public/index.html'),lfl=read('public/lfl.js'),perf=read('public/perf-runtime.js'),css=read('public/lfl.css');
  assert.doesNotMatch(html,/lflOrderAnalytics/);
  assert.doesNotMatch(lfl,/BLLFLOrderAnalytics/);
  assert.doesNotMatch(perf,/lfl-order-analytics/);
  assert.doesNotMatch(css,/\.lflOrder/);
  for(const file of ['lfl-order-analytics.js','lfl-order-analytics-engine.js','collection-analytics.js'])assert.equal(fs.existsSync(path.join(ROOT,'public',file)),false,file);
  /* Fiyat analizi LFL kaynağını kullanırken lfl.js'teki köprüyü önce yükler. */
  assert.match(lfl,/window\.BLPriceSupplierLFLBridge=\{/);
  assert.match(read('public/price-supplier-analysis.js'),/state\.source==='lfl'&&window\.BLPerf\?\.ensureFeature\)await window\.BLPerf\.ensureFeature\('lfl'\)/);
});

test('yeni ekran lazy yüklenir, köprü dışında veri sorgusu yapmaz ve kanonik MAG/MMYG alanlarını alır',()=>{
  const ui=read('public/price-supplier-analysis.js'),perf=read('public/perf-runtime.js'),html=read('public/index.html'),app=read('public/app-main.js')+read('public/price-supplier-insights-engine.js');
  assert.match(perf,/collectionTools:\[[^\]]*'collection-analytics-engine\.js','price-supplier-insights-engine\.js','price-supplier-analysis\.js'\]/);
  assert.match(html,/price-supplier-analysis\.css\?v=__BL_ASSET_VERSION__&rev=\d+/);
  assert.doesNotMatch(ui,/\bfetch\s*\(|XMLHttpRequest/);
  assert.match(ui,/window\.BLPriceSupplierAnalysisBridge\.get\(state\.source,'all'/);
  assert.match(ui,/const STORAGE_KEY='lcw\.priceSupplierAnalysis\.v3'/);
  assert.doesNotMatch(ui,/<section/,'global section{display:none} tuzağına düşmemek için section üretilmez');
  // The observation builder lives in the shared engine (browser + server Agent Office).
  const engine=read('public/price-supplier-insights-engine.js'),bridge=engine.slice(engine.indexOf('function canonicalObservation'),engine.indexOf('function orderPriceObservation'));
  assert.match(app,/function canonicalPriceObservation\(row,moduleId,base=\{\}\)\{\n  return window\.BLPriceSupplierInsights\.canonicalObservation\(/);
  assert.match(bridge,/mag:norm\(read\('mag'\)\)/);
  assert.match(bridge,/mmyg:norm\(read\('mmyg'\)\)/);
});

test('ekran CSS’i yalnız tema tokenlarını kullanır ve sekme sistemine bağlıdır',()=>{
  const css=read('public/price-supplier-analysis.css'),ui=read('public/price-supplier-analysis.js');
  assert.doesNotMatch(css.replace(/\/\*[\s\S]*?\*\//g,''),/#(?:[0-9a-fA-F]{3}){1,2}\b|rgba?\(/);
  assert.match(ui,/data-bl-tabs="line" role="tablist" aria-label=/);
  assert.match(ui,/role="tab"[^`]*aria-selected=/);
  assert.match(ui,/data-bl-choicebar/);
});

function fakeRoot(){
  const listeners={};
  return {dataset:{},innerHTML:'',listeners,addEventListener(type,fn){listeners[type]=fn;},querySelector(){return null;},contains(){return true;}};
}
async function mountScreen(observations,lang='tr',saved='{}'){
  const root=fakeRoot(),drills=[];
  const context={
    appLang:lang,console,structuredClone,requestAnimationFrame:fn=>fn(),
    BLStorage:{getItem:()=>saved,setItem:()=>{}},
    BLPriceSupplierInsights:E,
    BLPriceSupplierAnalysisBridge:{async get(source){return {source,priceType:'fob',priceTypes:[{key:'fob',label:'FOB'}],observations,version:'t1'};},openDrilldown(source,items,title){drills.push({source,items,title});}},
    document:{getElementById:id=>id==='priceSupplierAnalysis'?root:null},
  };
  context.window=context;context.globalThis=context;
  vm.runInNewContext(read('public/price-supplier-analysis.js'),context,{filename:'price-supplier-analysis.js'});
  await context.initPriceSupplierAnalysis();
  return {root,context,drills};
}

test('ekran TR/EN çeviri anahtarlarını eksiksiz karşılar',async()=>{
  const {context}=await mountScreen([]);
  const api=context.BLPriceSupplierAnalysis;
  assert.deepEqual(Object.keys(api._i18n.tr).sort(),Object.keys(api._i18n.en).sort());
  assert.equal(api._translate('tab_advantage'),'Nerede avantajlı?');
  context.appLang='en';
  assert.equal(api._translate('tab_advantage'),'Who wins where?');
});

test('filtre menüsü arama ve çoklu seçim sunar; eski tekli kayıtlar diziye taşınır',async()=>{
  const rows=[
    obs('26Y','A','Kazak',10,100,{country:'Mısır'}),
    obs('26Y','B','Kazak',10,100,{country:'Türkiye'}),
    obs('26Y','C','Kazak',10,100,{country:'China'}),
  ];
  const saved=JSON.stringify({filterLayout:['country'],filters:{country:'Mısır'}});
  const {root,context}=await mountScreen(rows,'tr',saved);
  const api=context.BLPriceSupplierAnalysis;
  assert.equal(JSON.stringify(api.state.filters.country),JSON.stringify(['Mısır']));
  assert.match(root.innerHTML,/data-ps-filter-search="country"/);
  assert.match(root.innerHTML,/data-ps-filter-value="country"/);
  assert.match(root.innerHTML,/Filtrede ara/);
  root.listeners.change({target:{dataset:{psFilterValue:'country'},value:'Türkiye',checked:true}});
  assert.equal(JSON.stringify(api.state.filters.country),JSON.stringify(['Mısır','Türkiye']));
  assert.equal(api.model.totals.records,2);
  assert.match(root.innerHTML,/2 seçim/);
});

test('kumaş/klasman filtre araması sadece eşleşen seçenekleri gösterir; gizlenen satırlar CSS ile geri açılmaz',async()=>{
  const rows=[
    obs('26Y','A','Örme Basic',10,100),
    obs('26Y','B','Dokuma',12,100),
  ];
  const {root,context}=await mountScreen(rows,'tr',JSON.stringify({filterLayout:['classification']}));
  const items=[
    {dataset:{search:E.keyOf('Örme Basic')},hidden:false},
    {dataset:{search:E.keyOf('Dokuma')},hidden:false},
  ];
  const empty={hidden:true};
  const panel={
    querySelectorAll(selector){assert.equal(selector,'[data-ps-filter-option]');return items;},
    querySelector(selector){assert.equal(selector,'[data-ps-filter-empty]');return empty;},
  };
  const search=value=>root.listeners.input({target:{
    dataset:{psFilterSearch:'classification'},value,
    closest(selector){assert.equal(selector,'.psaMultiPanel');return panel;},
  }});

  search('örme');
  assert.deepEqual(items.map(item=>item.hidden),[false,true]);
  assert.equal(empty.hidden,true);
  context.renderPriceSupplierAnalysisLanguage();
  assert.ok(root.innerHTML.includes('data-search="DOKUMA" hidden'),'yeniden çizimde filtre korunur');

  search('eşleşmeyen');
  assert.deepEqual(items.map(item=>item.hidden),[true,true]);
  assert.equal(empty.hidden,false,'eşleşmeyen aramada boş mesajı gösterilir');

  search('');
  assert.deepEqual(items.map(item=>item.hidden),[false,false]);
  assert.equal(empty.hidden,true,'arama temizlenince bütün seçenekler görünür');
  assert.match(read('public/price-supplier-analysis.css'),/\.psaMultiOption\[hidden\]\s*\{\s*display\s*:\s*none\b/,'flex görünümü hidden özniteliğini ezmemeli');
});

test('beş sekmenin tamamı gerçek veriyle hatasız çizilir ve tıklama detay açar',async()=>{
  const rows=[
    obs('25Y','A','Kazak',10,100),obs('25Y','A','Kazak',10,100),obs('25Y','GONE','Hırka',9,40),obs('25Y','GONE','Hırka',9,40),
    obs('26Y','A','Kazak',11,100),obs('26Y','A','Kazak',11,100),obs('26Y','CHEAP','Kazak',8,60,{country:'Mısır'}),obs('26Y','CHEAP','Kazak',8,60),
    obs('26Y','NEW','Hırka',12,30,{buyingGroup:'Kadın'}),obs('26Y','NEW','Hırka',12,30),
  ];
  const {root,context,drills}=await mountScreen(rows);
  const api=context.BLPriceSupplierAnalysis;
  assert.equal(api.state.currentSeason,'26Y');assert.equal(api.state.previousSeason,'25Y');
  assert.doesNotMatch(root.innerHTML,/status_/,'boş durum rozeti anahtar adı sızdırmaz');
  assert.match(root.innerHTML,/psaKpis/);assert.match(root.innerHTML,/Sizin için öne çıkanlar/);assert.match(root.innerHTML,/psaDonut/);
  const expectations={advantage:/psaGroupRow[\s\S]*En avantajlı[\s\S]*CHEAP/,scorecard:/psaTable[\s\S]*psaDetail/,movement:/Fiyatı artanlar[\s\S]*Yeni üreticiler[\s\S]*NEW[\s\S]*GONE/,relations:/psaStack[\s\S]*psaSeg0/};
  for(const [tab,pattern] of Object.entries(expectations)){
    root.listeners.click({target:{closest:()=>({dataset:{psTab:tab}})}});
    assert.match(root.innerHTML,pattern,tab);
    assert.doesNotMatch(root.innerHTML,/undefined|NaN|status_/,`${tab} ham değer sızdırmaz`);
  }
  root.listeners.click({target:{closest:selector=>selector==='[data-ps-drill]'?null:{dataset:{psDrill:'m:'+E.keyOf('CHEAP')}}}});
  assert.equal(drills.length,1);assert.equal(drills[0].items.length,2);assert.match(drills[0].title,/CHEAP/);
  context.appLang='en';context.renderPriceSupplierAnalysisLanguage();
  assert.match(root.innerHTML,/Who works with whom\?/);
});

test('kayıt yoksa ortak boş durum gösterilir; kıyas sezonu yoksa fiyat hareketi yönlendirir',async()=>{
  const empty=await mountScreen([]);
  assert.match(empty.root.innerHTML,/Bu seçimde analiz edilecek kayıt yok/);
  const single=await mountScreen([obs('26Y','A','Kazak',10,100)],'tr',JSON.stringify({tab:'movement'}));
  assert.match(single.root.innerHTML,/kıyas sezonu seçin/);
});

test('örnek eşiği yalnız seçili para biriminde fiyatı olan modelleri sayar',()=>{
  const data=E.prepare([obs('26Y','A','Kazak',10,100),{...obs('26Y','A','Kazak',0,100),price:null},obs('26Y','A','Kazak',9,100,{currency:'EUR'}),obs('26Y','B','Kazak',12,100),obs('26Y','B','Kazak',12,100)]);
  const model=E.analyze(data,{currentSeason:'26Y',currency:'USD',minSample:2});
  const kazak=model.groups[0];
  assert.equal(kazak.suppliers.find(s=>s.name==='A').eligible,false,'tek USD fiyatlı üretici kazanan olamaz');
  assert.equal(kazak.best,null);
});

test('adedi boş sipariş satırı üreticiyi yanlışlıkla ayrılan/yeni göstermez',()=>{
  const data=E.prepare([{...obs('26Y','A','Kazak',10,0),quantity:null},obs('25Y','A','Kazak',10,100),obs('26Y','B','Kazak',12,100),obs('25Y','B','Kazak',12,100),obs('26Y','C','Kazak',11,100)]);
  assert.equal(data.weighted,true);
  const model=E.analyze(data,{currentSeason:'26Y',previousSeason:'25Y'});
  const a=model.manufacturers.find(m=>m.name==='A');
  assert.notEqual(a.status,'exit');assert.equal(a.records,1);
  assert.deepEqual(E.leavers(model).map(m=>m.name),[]);
  assert.ok(model.groups[0].suppliers.some(s=>s.name==='A'),'klasman listesinde görünür');
});

test('boş anahtarlı grup kendiliğinden açılmaz; ":" içeren anahtarlar detay açar; "Tüm sezonlar" korunur',async()=>{
  const rows=[obs('26Y','ABC: LTD','',10,100),obs('26Y','ABC: LTD','',10,100),obs('26Y','B','',12,100),obs('26Y','B','',12,100),obs('25Y','B','',12,100)];
  const {root,context,drills}=await mountScreen(rows,'tr',JSON.stringify({tab:'advantage'}));
  assert.doesNotMatch(root.innerHTML,/psaGroup isOpen/,'hiçbir grup varsayılan olarak açık değildir');
  root.listeners.click({target:{closest:selector=>selector==='[data-ps-drill]'?null:{dataset:{psDrill:'m:'+encodeURIComponent(E.keyOf('ABC: LTD'))}}}});
  assert.equal(drills.length,1);assert.match(drills[0].title,/ABC: LTD/);
  root.listeners.click({target:{closest:()=>({dataset:{psTab:'scorecard'}})}});
  root.listeners.click({target:{closest:selector=>selector==='[data-ps-drill]'?null:{dataset:{psSelect:E.keyOf('ABC: LTD')}}}});
  context.renderPriceSupplierAnalysisLanguage();
  assert.match(root.innerHTML,/data-ps-drill="m:ABC%3A%20LTD"/);
  root.listeners.change({target:{dataset:{ps:'currentSeason'},value:'*'}});
  const api=context.BLPriceSupplierAnalysis;
  assert.equal(api.state.currentSeason,'*');assert.equal(api.model.hasComparison,false);assert.equal(api.model.totals.records,5);
  await api.prepare();
  assert.equal(api.state.currentSeason,'*','yeniden yüklemede tüm sezonlar seçimi korunur');
});

test('LFL köprüsü süren yüklemeyi bekler, hatayı yüzeye çıkarır ve gizli LFL ekranını çizmez',()=>{
  const lfl=read('public/lfl.js');
  const bridge=lfl.slice(lfl.indexOf('window.BLPriceSupplierLFLBridge={'),lfl.indexOf('window.BLLFLCatalog='));
  assert.match(bridge,/while\(state\.loading\)await new Promise/);
  assert.match(bridge,/load\(false,\{silent:true\}\)/);
  assert.match(bridge,/throw new Error/);
  assert.match(bridge,/const analysis=scope==='filtered'\?\(state\.analysis\|\|compute\(\)\):null;/);
  assert.match(lfl,/if\(state\.initialized\)\{fillControls\(\);render\(\);\}else state\.controlsPending=true;/);
  assert.match(lfl,/if\(state\.controlsPending\)\{state\.controlsPending=false;fillControls\(\);\}render\(\);/);
});

test('herhangi bir ham sütun ve Ürün Ana Tanım filtre olarak eklenebilir; veri olmayan kanonik alanlar gizlenmez',async()=>{
  const rows=[
    obs('26Y','A','Kazak',10,100,{buyingGroup:'',productMainDefinition:'Örme Kazak',row:{'Product Main Definition':'Örme Kazak','Sezon Kodu':'S7',_id:1}}),
    obs('26Y','B','Kazak',12,100,{buyingGroup:'',productMainDefinition:'Hırka',row:{'Product Main Definition':'Hırka','Sezon Kodu':'S7',_id:2}}),
    obs('26Y','C','Kazak',14,100,{buyingGroup:'',productMainDefinition:'Hırka',row:{'Product Main Definition':'Hırka','Sezon Kodu':'',_id:3}}),
  ];
  const data=E.prepare(rows);
  assert.deepEqual(E.columnKeys(data),['Product Main Definition','Sezon Kodu'],'iç alanlar ve tamamen boş sütunlar listelenmez');
  assert.deepEqual(E.dimensionValues(data,'col:Product Main Definition'),['Hırka','Örme Kazak']);
  assert.deepEqual(E.dimensionValues(data,'productMainDefinition'),['Hırka','Örme Kazak']);
  assert.equal(E.analyze(data,{currentSeason:'26Y',filters:{'col:Product Main Definition':['HIRKA']}}).totals.records,2);
  assert.equal(E.analyze(data,{currentSeason:'26Y',filters:{productMainDefinition:['Örme Kazak']}}).totals.records,1);

  const saved=JSON.stringify({filterLayout:['buyingGroup','col:Product Main Definition','bogus'],filters:{'col:Product Main Definition':['Hırka'],bogus:['x']}});
  const {root,context}=await mountScreen(rows,'tr',saved);
  const api=context.BLPriceSupplierAnalysis;
  assert.deepEqual([...api.state.filterLayout],['buyingGroup','col:Product Main Definition'],'geçersiz anahtarlar atılır');
  assert.equal(api.model.totals.records,2,'kayıtlı sütun filtresi uygulanır');
  assert.match(root.innerHTML,/data-ps-filter-menu="col:Product Main Definition"/);
  assert.match(root.innerHTML,/psaField isEmpty[\s\S]*Bu kaynakta veri yok/,'verisi olmayan seçili alan gizlenmez');
  assert.match(root.innerHTML,/data-ps-filter-toggle="col:Sezon Kodu"/,'ham sütunlar filtre ekle listesinde');
  assert.match(root.innerHTML,/data-ps-filter-toggle="manufacturer"/);
  root.listeners.change({target:{dataset:{psFilterToggle:'col:Sezon Kodu'},checked:true}});
  assert.ok(api.state.filterLayout.includes('col:Sezon Kodu'));
  assert.match(root.innerHTML,/data-ps-filter-config open/,'panel ekleme sonrası açık kalır');
  root.listeners.click({target:{closest:()=>({dataset:{ps:'clear'}})}});
  assert.equal(JSON.stringify(api.state.filters['col:Product Main Definition']),'[]','temizle sütun filtrelerini de boşaltır');
  assert.equal(api.model.totals.records,3);
});

test('filter drawers share one multiselect shell and close outside / on Escape',async()=>{
  const rows=[obs('26Y','A','Kazak',10,100,{country:'Türkiye',buyingGroup:''})];
  const saved=JSON.stringify({filterLayout:['country','buyingGroup'],filters:{}});
  const {root}=await mountScreen(rows,'tr',saved);
  assert.match(root.innerHTML,/data-ps-filter-menu="country"[\s\S]*aria-multiselectable="true"/);
  assert.match(root.innerHTML,/psaMultiFilter psaField isEmpty[\s\S]*psaMultiTrigger[\s\S]*Bu kaynakta veri yok/);
  assert.doesNotMatch(root.innerHTML,/psaField isEmpty[^>]*>[\s\S]{0,180}<select disabled/);
  assert.match(root.innerHTML,/psaMultiTrigger psaFilterConfigTrigger/);
  const ui=read('public/price-supplier-analysis.js');
  assert.match(ui,/function closeFilterDrawers\(except=null\)/);
  assert.match(ui,/document\.addEventListener\?\.\('pointerdown'/);
  assert.match(ui,/event\.key==='Escape'.*closeFilterDrawers\(\)/);
});
