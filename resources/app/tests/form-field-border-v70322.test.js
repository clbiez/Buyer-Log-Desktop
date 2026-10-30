'use strict';
// Giriş alanları yüzey tonuyla ayırt edilemiyordu (License Royalty vb. ≈1.04:1).
// Ortak alan sınırı tokenı ≥3:1 kalmalı ve ui-components.css'te son söz olmalı.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const PUBLIC=path.join(__dirname,'../public'),read=f=>fs.readFileSync(path.join(PUBLIC,f),'utf8');
const lum=h=>{const c=h.match(/\w\w/g).map(x=>parseInt(x,16)/255).map(v=>v<=.03928?v/12.92:Math.pow((v+.055)/1.055,2.4));return .2126*c[0]+.7152*c[1]+.0722*c[2];};
const ratio=(a,b)=>{const x=lum(a),y=lum(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
function block(css,selector){const i=css.indexOf(selector);assert.ok(i>=0,selector);return css.slice(i,css.indexOf('}',i));}
const token=(b,name)=>{const m=b.match(new RegExp(name+':#([0-9a-f]{6}|[0-9a-f]{3})\\b','i'));assert.ok(m,name);return m[1].length===3?m[1].replace(/./g,'$&$&'):m[1];};

test('field border token reaches 3:1 against field and panel surfaces in both themes',()=>{
  const css=read('ui-tokens.css'),dark=css.slice(css.indexOf(':root[data-theme="dark"]{')),light=css.slice(0,css.indexOf(':root[data-theme="dark"]{'));
  for(const theme of [light,dark]){const border=token(theme,'--ui-field-border');
    for(const bg of ['--ui-surface','--ui-surface-soft'])assert.ok(ratio(border,token(theme,bg))>=3,`${border} vs ${bg}`);}
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
