'use strict';
// Teklif & Onay (priceStrip) alt satırı: gösterilen fiyatın ortalamaları ve Target'a göre ağırlıklı % fark.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const app=fs.readFileSync(path.join(__dirname,'../public/app-main.js'),'utf8');
function nativeFunction(name){const start=app.indexOf('function '+name+'(');assert.ok(start>=0,name);const end=app.indexOf('\n}',start);return app.slice(start,end+2);}
function load(lang='tr'){
 const parse=value=>value===''||value==null?NaN:Number(String(value).replace(',','.'));
 const context={appLang:lang,kolParseMoneyNum:parse,tableNumericValue:value=>{const n=parse(value);return Number.isFinite(n)?n:0;},escapeHtml:value=>String(value),
  kolFormatMoneyDisplay:value=>parse(value).toFixed(2).replace('.',','),kolEffectiveValue:(row,key)=>row[key],
  kolConfirmedDisplay:row=>row.confirmed!=null?{price:row.confirmed,isFallback:false}:row.best!=null?{price:row.best,isFallback:true}:null};
 vm.createContext(context);
 for(const name of ['kolWeightedAverage','kolArithmeticAverage','kolPriceStripFooter'])vm.runInContext(nativeFunction(name),context);
 return context;
}

test('Quotes & Approval footer shows weighted/arithmetic averages and weighted % vs Target',()=>{
 const ui=load();
 const rows=[{quantity:100,confirmed:2,targetPrice:'1,60'},{quantity:300,best:1,targetPrice:'1,00'},{quantity:0,confirmed:9,targetPrice:'1'},{quantity:50,confirmed:3}];
 const html=ui.kolPriceStripFooter(rows);
 // W.Avg = (2×100 + 1×300 + 3×50) / 450 = 1,444…; Avg = (2+1+9+3)/4 = 3,75.
 assert.match(html,/Ağ\.Ort\.<\/span><strong>\$1,44/);assert.match(html,/Ort\.<\/span><strong>\$3,75/);
 // % = (2×100 + 1×300) / (1,6×100 + 1×300) − 1 = +8,7% (rows without Target or quantity are excluded).
 assert.match(html,/Ağ\.% Δ Target<\/span><strong><span class="kolBestDelta isAboveTarget">\+8,7%/);
 assert.match(html,/2 satır/);
 // Shared per-row pricing from the summary row gives the same result.
 const shared=new Map(rows.map(row=>[row,{confirmed:row.confirmed!=null?{price:row.confirmed}:null,best:row.best!=null?{price:row.best}:null}]));
 assert.equal(ui.kolPriceStripFooter(rows,shared),html);
 assert.doesNotMatch(load().kolPriceStripFooter([{quantity:10,confirmed:2}]),/% Δ/,'no Target → no percentage');
 assert.match(load('en').kolPriceStripFooter([{quantity:10,best:0.9,targetPrice:1}]),/W\.% Δ Target<\/span><strong><span class="kolBestDelta isAtOrBelowTarget">-10%/);
});

test('summary row renders the Quotes & Approval footer instead of the model-count cell',()=>{
 const render=nativeFunction('renderKolSummaryFooter');
 assert.match(render,/if\(d\.kind==='priceStrip'\)\{cells\.push\(kolPriceStripFooter\(rows,pricingByRow\)\);return;\}/);
 assert.equal((render.match(/kolBestPricing\(row\)/g)||[]).length,1,'best price is resolved once per row');
 assert.match(render,/const metricDescriptor=d=>d\.kind==='priceStrip'\|\|/);
});
