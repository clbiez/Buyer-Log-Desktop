'use strict';
// Giriş alanları yüzey tonuyla ayırt edilemiyordu (License Royalty vb. ≈1.04:1).
// Ortak alan sınırı tokenı ≥3:1 kalmalı ve ui-components.css'te son söz olmalı.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const PUBLIC=path.join(__dirname,'../public'),read=f=>fs.readFileSync(path.join(PUBLIC,f),'utf8');
const lum=h=>{const c=h.match(/\w\w/g).map(x=>parseInt(x,16)/255).map(v=>v<=.03928?v/12.92:Math.pow((v+.055)/1.055,2.4));return .2126*c[0]+.7152*c[1]+.0722*c[2];};
const ratio=(a,b)=>{const x=lum(a),y=lum(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
function block(css,selector){const i=css.lastIndexOf(selector);assert.ok(i>=0,selector);return css.slice(i,css.indexOf('}',i));}
// T('tr','en') ve appLang==='en'?'en':'tr' ifadelerini kaynaktan çıkarır (string/template içi ${} derinliğini izler).
function readString(src,i){const q=src[i];let j=i+1,depth=0;while(j<src.length){const c=src[j];if(c==='\\'){j+=2;continue;}if(q==='`'&&c==='$'&&src[j+1]==='{'){depth++;j+=2;continue;}if(depth&&c==='}'){depth--;j++;continue;}if(!depth&&c===q)return j+1;j++;}return j;}
function stripPairs(src){let out='',i=0;while(i<src.length){if(src.startsWith('T(',i)&&/['"`]/.test(src[i+2])){const e1=readString(src,i+2);if(src[e1]===','&&/['"`]/.test(src[e1+1])){const e2=readString(src,e1+1);if(src[e2]===')'){i=e2+1;continue;}}}const m=src.slice(i).match(/^appLang==='en'\?/);if(m){let k=i+m[0].length;for(const sep of [':','']){while(src[k]==='(')k++;if(/['"`]/.test(src[k]))k=readString(src,k);while(src[k]===')')k++;if(sep&&src[k]===sep)k++;}i=k;continue;}out+=src[i++];}return out;}
const token=(b,name)=>{const m=b.match(new RegExp(name+':#([0-9a-f]{6}|[0-9a-f]{3})\\b','i'));assert.ok(m,name);return m[1].length===3?m[1].replace(/./g,'$&$&'):m[1];};

test('field border token reaches 3:1 against every field and panel surface in both themes',()=>{
  const css=read('ui-tokens.css'),dark=css.slice(css.indexOf(':root[data-theme="dark"]{')),light=css.slice(0,css.indexOf(':root[data-theme="dark"]{'));
  for(const theme of [light,dark]){const border=token(theme,'--ui-field-border');
    for(const bg of ['--ui-surface','--ui-surface-soft','--ui-canvas','--ui-header-bg','--ui-surface-strong'])assert.ok(ratio(border,token(theme,bg))>=3,`${border} vs ${bg}`);}
});

test('shared field border rule covers text fields and comes after component border resets',()=>{
  const css=read('ui-components.css'),rule='html[data-ui-system="manifest"] :is(input:not(';
  const at=css.lastIndexOf(rule);assert.ok(at>0);
  const body=css.slice(at,css.indexOf('}',at));
  assert.match(body,/select,textarea,\.pricingRuleSeasonBtn\):not\(td \*\) \{border:1px solid var\(--ui-field-border\) !important/);
  for(const t of ['checkbox','radio','hidden'])assert.match(body,new RegExp(`\\[type="${t}"\\]`));
  // Aynı veya daha düşük özgüllükteki border:0 kuralları bu ortak kuraldan önce gelmeli.
  for(const reset of ['.pricingRuleField input','.tableRangeBar input','.pdOptRow input'])assert.ok(css.indexOf(reset)<at,reset);
  assert.match(block(css,'.tableRangePager>input[data-range-page] {'),/var\(--ui-field-border\)/);
  assert.match(block(css,'.dateFieldWrap>.datePickerBtn:not(td *) {'),/var\(--ui-field-border\)/);
});

test('value-showing custom pickers share the field boundary; grid cell triggers do not',()=>{
  const css=read('ui-components.css');
  const body=block(css,':is(.psaMultiTrigger,.lflDimBtn,.lflBreakdownBtn,.oabMultiTrigger,.cpaFieldPickerBtn):not(td *) {');
  assert.match(body,/border:1px solid var\(--ui-field-border\)/);
  assert.match(block(css,'.endeksmatikMonthControl:not(td *) {'),/var\(--ui-field-border\)/);
  assert.match(block(css,'.endeksmatikMonthControl>input[type="text"] {'),/border:0 !important/);
  for(const cell of ['clStatusTrigger','delTypeTrigger','impTrigger','kolPeriodPickerBtn'])assert.doesNotMatch(body,new RegExp(cell));
});

test('License Royalty dialog renders its own TR/EN pairs instead of the dictionary fallback',()=>{
  const src=read('license-royalty-commissions.js'),a=src.indexOf("const T=(tr,en)=>appLang==='en'?en:tr;"),b=src.indexOf('function renderRules(){');
  assert.ok(a>0&&b>a);const end=src.indexOf('\n',b),modal=src.slice(a,end);
  for(const pair of ["T('Uygula','Apply')","T('TR Komisyon %','TR Commission %')","T('YD Komisyon %','Overseas Commission %')","T('Kuralları Kaydet','Save Rules')","T('Tümüne Uygula','Apply to All')"])assert.ok(modal.includes(pair),pair);
  // Görünen Türkçe metin yalnız T(...) çiftinde ya da appLang dalında kalır.
  assert.doesNotMatch(stripPairs(modal),/>[^<>{}]*[çğıöşüÇĞİÖŞÜ][^<>{}]*</);
});
