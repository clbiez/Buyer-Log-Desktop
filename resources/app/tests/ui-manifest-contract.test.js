'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const PUBLIC=path.join(__dirname,'..','public'),read=f=>fs.readFileSync(path.join(PUBLIC,f),'utf8');
const OWNERS=['ui-tokens.css','ui-components.css','ui-startup.css','giris.css'];
// Small structural reader, independent of production dependencies. Retains at-rule ancestry.
function declarations(source){
 const result=[],stack=[];let buffer='',quote='',paren=0;
 source=source.replace(/\/\*[\s\S]*?\*\//g,'');
 for(let i=0;i<source.length;i++){
  const c=source[i];if(quote){buffer+=c;if(c===quote&&source[i-1]!=='\\')quote='';continue;}
  if(c==='"'||c==="'"){quote=c;buffer+=c;continue;}
  if(c==='(')paren++;if(c===')')paren--;
  if(!paren&&c==='{'){stack.push(buffer.trim());buffer='';continue;}
  if(!paren&&(c===';'||c==='}')){
   const m=buffer.trim().match(/^([\w-]+)\s*:\s*([\s\S]+)$/);
   if(m)result.push({prop:m[1],value:m[2].trim().replace(/\s*!important$/,''),selector:(stack.at(-1)||'').replace(/^html\[data-ui-system="manifest"\] /,'').replace(/^:where\(\[data-ui-migrated\]\) /,''),ancestors:[...stack]});
   buffer='';if(c==='}')stack.pop();continue;
  }
  buffer+=c;
 }
 return result;
}
const entries=OWNERS.flatMap(file=>declarations(read(file)).map(d=>({...d,file})));
test('Manifest has one token source; migrated owners never consume legacy appearance aliases',()=>{
 const tokens=new Set(declarations(read('ui-tokens.css')).filter(d=>d.prop.startsWith('--')).map(d=>d.prop));
 const failures=[];
 for(const d of entries)for(const m of d.value.matchAll(/var\((--[\w-]+)/g)){
  if(/^--ov-(level|risk)$/.test(m[1]))continue; // data-generated chart dimensions, not appearance
  if(!tokens.has(m[1]))failures.push(`${d.file} ${d.selector}: ${m[1]}`);
 }
 assert.deepEqual(failures,[]);
 for(const name of ['index.html','select-user.html'])assert.match(read(name),/href="\/?ui-tokens\.css/);
 assert.ok(read('index.html').indexOf('href="ui-startup.css')>read('index.html').indexOf('href="design-butunluk.css'),'startup tokens must override the legacy dark/grey boot selectors');
 assert.doesNotMatch(read('giris.css'),/--(?:login-|ui-font-add|ui-font-(?:base|body))\s*:/);
});
test('Manifest prohibits frames, rounded controls, gradients and raw overlay levels',()=>{
 const failures=[];
 for(const d of entries){
  if(d.prop.startsWith('--')||d.ancestors.some(s=>s.startsWith('@font-face')))continue;
  if(/gradient\(|blur\(/.test(d.value))failures.push(d);
  if(/radius$/.test(d.prop)&&!/^0$|^var\(--ui-radius\)$/.test(d.value))failures.push(d);
  if(/^border/.test(d.prop)&&!/radius$/.test(d.prop)&&!/^0(?:\s|$)|^none$/.test(d.value)){
   const row=d.selector==='#cpTable tbody td'&&d.prop==='border-bottom'&&d.value==='1px solid var(--ui-row-divider)';
   const group=d.selector==='#cpTable thead :is(.groupRow th.groupDivider,.colRow th.groupBoundary)'&&d.prop==='border-inline-start'&&d.value==='1px solid var(--ui-group-divider)';
   if(!row&&!group)failures.push(d); // narrow user-approved dense table exceptions
  }
  if(d.prop==='z-index'&&!/^var\(--ui-z-(sticky|popover|modal|boot)\)$/.test(d.value))failures.push(d);
  if(d.prop==='box-shadow'&&!/^(none|var\(--ui-shadow-overlay\))$/.test(d.value))failures.push(d);
 }
 assert.deepEqual(failures,[]);
 assert.match(read('ui-tokens.css'),/--ui-radius:0;/);
});
test('Manifest fonts scale and only transform/opacity may animate',()=>{
 const failures=[];
 for(const d of entries){
  if(d.prop.startsWith('--'))continue;
  if(d.prop==='font-size'&&/^[\d.]+px/.test(d.value))failures.push(d);
  if(d.prop==='font'&&/(?:^|\s)[\d.]+px(?:\/|\s)/.test(d.value))failures.push(d);
  if(d.ancestors.some(s=>s.startsWith('@keyframes'))&&!['opacity','transform'].includes(d.prop))failures.push(d);
  if(/^transition(?:-property)?$/.test(d.prop)&&!/^none/.test(d.value)){
   for(const part of d.value.split(','))if(!/^(transform|opacity)\b/.test(part.trim()))failures.push(d);
  }
 }
 assert.deepEqual(failures,[]);
 for(const file of ['ui-components.css','ui-startup.css','giris.css'])assert.match(read(file),/prefers-reduced-motion:reduce/);
});
test('Main column separators cover both header tiers and never the table body',()=>{
 const rules=entries.filter(d=>d.value==='1px solid var(--ui-group-divider)');
 assert.equal(rules.length,1);assert.equal(rules[0].selector,'#cpTable thead :is(.groupRow th.groupDivider,.colRow th.groupBoundary)');
 assert.doesNotMatch(rules[0].selector,/tbody|td\b/);
});
test('Shared button contract covers interaction states and restricts explicit variants',()=>{
 const source=read('ui-components.css');
 for(const state of [':hover',':focus-visible',':active',':disabled','[aria-pressed="true"]','[aria-busy="true"]','[aria-invalid="true"]','[data-state="loading"]','[data-state="error"]','.ovPremiumEmpty'])assert.ok(source.includes(state),state);
 const variants=new Set(['primary','quiet']);
 for(const file of ['index.html','app-main.js','ui-components.css'])for(const m of read(file).matchAll(/data-ui-variant=["']([^"']+)["']/g))assert.ok(variants.has(m[1]),`${file}: ${m[1]}`);
 assert.match(source,/\[data-ui-variant="primary"\]/);
 assert.match(source,/\[data-ui-variant="quiet"\]/);
});
test('Notes dialog keeps canonical behavior hooks, labelled field and keyboard focus containment',()=>{
 const s=read('app-main.js'),body=s.slice(s.indexOf('function openNotesEditor('),s.indexOf('// Explicit note saves'));
 for(const hook of ['_notesEditorModal','_notesEditorTitle','noteEditorArea','notesEditorClose','notesEditorCancel','notesEditorSave'])assert.ok(body.includes(hook));
 assert.match(body,/data-ui-variant="primary"/);assert.match(body,/aria-labelledby="_notesEditorTitle" spellcheck/);
 assert.match(body,/e\.key==='Tab'/);assert.match(body,/e\.shiftKey&&document\.activeElement===first/);assert.match(body,/!e\.shiftKey&&document\.activeElement===last/);
 assert.match(body,/saveNotesEditorTargets\(targets,next,Boolean\(options\.ownNotes\)\)/);
});
test('Unauthenticated asset serving is a fixed UI-only list before auth gates',()=>{
 const server=fs.readFileSync(path.join(__dirname,'..','server','server.js'),'utf8');
 const start=server.indexOf('// Fixed UI-only allowlist.'),end=server.indexOf('// Kullanıcı seçimi ekranı',start),block=server.slice(start,end);
 assert.ok(start>0&&start<server.indexOf('app.use(auth.requireAuth)'));
 assert.match(block,/\['giris\.css', 'ui-tokens\.css', 'ui-components\.css', 'ui-appearance\.js'\]/);
 assert.doesNotMatch(block,/express\.static|req\.path|\*|\.json|\.xlsx/);
 assert.match(block,/IBMPlexSans\.woff2/);
});
