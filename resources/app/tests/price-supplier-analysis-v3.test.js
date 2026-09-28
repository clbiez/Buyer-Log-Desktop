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
  const ui=read('public/price-supplier-analysis.js'),perf=read('public/perf-runtime.js'),html=read('public/index.html'),app=read('public/app-main.js');
  assert.match(perf,/collectionTools:\[[^\]]*'collection-analytics-engine\.js','price-supplier-insights-engine\.js','price-supplier-analysis\.js'\]/);
  assert.match(html,/price-supplier-analysis\.css\?v=__BL_ASSET_VERSION__&rev=\d+/);
  assert.doesNotMatch(ui,/\bfetch\s*\(|XMLHttpRequest/);
  assert.match(ui,/window\.BLPriceSupplierAnalysisBridge\.get\(state\.source,'all'/);
  assert.match(ui,/const STORAGE_KEY='lcw\.priceSupplierAnalysis\.v3'/);
  assert.doesNotMatch(ui,/<section/,'global section{display:none} tuzağına düşmemek için section üretilmez');
  const bridge=app.slice(app.indexOf('function canonicalPriceObservation'),app.indexOf('window.BLPriceSupplierAnalysisBridge='));
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
