'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const app=fs.readFileSync(path.join(__dirname,'../public/app-main.js'),'utf8');
const css=fs.readFileSync(path.join(__dirname,'../public/app.css'),'utf8');

test('email field sections override the app-wide hidden section rule',()=>{
  assert.match(css,/\.mailTopicEditorCard \.mailTopicFieldGroup\{display:block;/);
  assert.match(css,/\.mailTopicEditorCard \.mailTopicSubjectGrid\{flex-shrink:0;/);
  assert.match(css,/\.mailTopicEditorCard \.mailTopicFieldGroup\[hidden\][\s\S]*?display:none!important/);
});

test('table preview uses export cell formatting, selected order and escaped values',()=>{
  const start=app.indexOf('function mailTopicTablePreviewHtml(');
  assert.ok(start>=0,'table preview renderer exists');
  const end=app.indexOf('\nfunction openMailTopicEditor(',start);
  const ctx={appLang:'en',escapeHtml:v=>String(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;'),tableColumnLabel:(_,c)=>c.label,L:v=>v,prepareEmailColumnIsPicture:c=>c.k==='pic',prepareEmailImageSource:()=>'',prepareEmailTopicCell:(r,c)=>({display:r[c.k]??'',numeric:c.k==='qty'})};
  vm.createContext(ctx);vm.runInContext(app.slice(start,end),ctx);
  const columns=[{k:'qty',label:'Quantity',sourceKind:'cp'},{k:'name',label:'Model <name>',sourceKind:'cp'}];
  const html=ctx.mailTopicTablePreviewHtml([{qty:'1,200',name:'<script>bad</script>'}],columns);
  assert.ok(html.indexOf('Quantity')<html.indexOf('Model &lt;name>'));
  assert.match(html,/1,200/);assert.match(html,/&lt;script>bad&lt;\/script>/);assert.doesNotMatch(html,/<script>/);
  assert.match(ctx.mailTopicTablePreviewHtml([],columns),/Select orders/);
  assert.match(ctx.mailTopicTablePreviewHtml([],[]),/Select at least one column/);
  const many=Array.from({length:8},(_,i)=>({qty:String(i),name:'row'+i}));
  const limited=ctx.mailTopicTablePreviewHtml(many,columns);
  assert.equal((limited.match(/<tr>/g)||[]).length,6,'header plus first five rows');
  assert.match(limited,/5.*8/);
});
