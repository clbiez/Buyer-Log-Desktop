'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const PUBLIC=path.join(__dirname,'..','public'),read=f=>fs.readFileSync(path.join(PUBLIC,f),'utf8');
const OWNERS=fs.readdirSync(PUBLIC).filter(f=>f.endsWith('.css'));
const PRINT_SELECTORS=new Set(['.shipCompare','.shipCompare thead th','.shipCompare tbody td','.shipCardPrice','.shipCardMetrics,.shipProductSub,.shipProductMeta,.shipProductQty,.shipDateRow']);
const isPrint=d=>d.file==='ui-components.css'&&d.ancestors.includes('@media print')&&PRINT_SELECTORS.has(d.selector);
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
   if(m)result.push({prop:m[1],value:m[2].trim().replace(/\s*!important$/,''),selector:(stack.at(-1)||'').replace(/html\[data-ui-system="manifest"\] /g,'').replace(/^:where\(\[data-ui-migrated\]\) /,''),ancestors:[...stack]});
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
  if(/^--ov-(level|risk)$/.test(m[1])||m[1]==='--check-progress')continue; // data-generated chart dimensions, not appearance
  // User-authored status colors are data (also used by unchanged export); swatches
  // stay narrow. Text height/rate are measured data geometry, not theme aliases.
  if(d.file==='ui-components.css'&&(
   m[1]==='--kol-text-lh'&&d.selector==='#view-koleksiyon.kolSpreadsheetWorkspace #kolTable tbody textarea.editCell'||
   m[1]==='--pd-rate'&&d.selector==='.pdRing::after'||
   m[1]==='--kol-status-color'&&/^#kolTable (?:select|td)/.test(d.selector)||
   m[1]==='--status-color'&&d.selector==='.kolStatusManagerDot'||
   m[1]==='--swatch'&&d.selector==='.kolStatusSwatch'))continue;
  // Module-local values may describe measured geometry, never appearance.
  // Undefined geometry is independently rejected by design-token-guard.
  if(!m[1].startsWith('--ui-')&&/^(?:--[\w-]+|(?:min-|max-)?(?:width|height)|padding(?:-.*)?|margin(?:-.*)?|gap|row-gap|column-gap|grid(?:-.*)?|flex(?:-.*)?|inset(?:-.*)?|top|right|bottom|left|transform|contain-intrinsic-size)$/.test(d.prop)&&!/^--(?:acc|card|ink|line|muted|fs-|sans|head|mono|r-)/.test(m[1]))continue;
  if(!tokens.has(m[1]))failures.push(`${d.file} ${d.selector}: ${m[1]}`);
 }
 assert.deepEqual(failures,[]);
 for(const name of ['index.html','select-user.html'])assert.match(read(name),/href="\/?ui-tokens\.css/);
 assert.doesNotMatch(read('index.html'),/design-butunluk|ui-legacy-bridge|theme-transition/);
 for(const f of ['design-butunluk.css','ui-legacy-bridge.css'])assert.equal(fs.existsSync(path.join(PUBLIC,f)),false);
 assert.ok(read('index.html').indexOf('href="ui-startup.css')>read('index.html').indexOf('href="ui-components.css'));
 assert.doesNotMatch(read('giris.css'),/--(?:login-|ui-font-add|ui-font-(?:base|body))\s*:/);
});
// Exact semantically identical prefiltered header selectors; no broader border exception.
const groupSeparator=id=>['.groupDivider','.groupBoundary'].map(key=>id+' thead :is(.groupRow th.groupDivider,.colRow th.groupBoundary):where('+key+')').join(',');
test('Manifest prohibits frames, rounded controls, gradients and raw overlay levels',()=>{
 const failures=[];
 for(const d of entries){
  if(d.prop.startsWith('--')||d.ancestors.some(s=>s.startsWith('@font-face')))continue;
  if(/gradient\(|blur\(/.test(d.value))failures.push(d);
  if(/radius$/.test(d.prop)&&!/^0$|^var\(--ui-radius\)$/.test(d.value))failures.push(d);
  if(/^border(?!-collapse|-spacing)/.test(d.prop)&&!/radius$/.test(d.prop)&&!/^0(?:\s|$)|^none$/.test(d.value)){
   const row=['#cpTable tbody td','[data-ui-migrated] table tbody td'].includes(d.selector)&&d.prop==='border-bottom'&&d.value==='1px solid var(--ui-row-divider)';
   const group=['#cpTable','#ordersTable','#kolTable'].some(id=>d.selector===groupSeparator(id))&&d.prop==='border-inline-start'&&d.value==='1px solid var(--ui-group-divider)';
   const headerColumns=d.selector===':is(#cpTable,#ordersTable,#kolTable) thead tr.colRow th:not(:last-child)'&&d.prop==='border-inline-end'&&d.value==='1px solid var(--ui-row-divider)';
   const printRule=isPrint(d)&&d.selector==='.shipCompare tbody td'&&d.prop==='border-bottom'&&d.value==='1px solid var(--ui-print-rule)';
   if(!row&&!group&&!headerColumns&&!printRule)failures.push(d); // narrow user-approved dense table exceptions
  }
  if(d.prop==='outline'&&!/^(?:none|0)$/.test(d.value)){
   const cursor=['.blDetailDrawer .blDetailTable td.blGridActiveCell','#cpTable td.blGridActiveCell,#ordersTable td.blGridActiveCell','[data-ui-migrated] .blDetailTable .blGridActiveCell','#view-koleksiyon.kolSpreadsheetWorkspace #kolTable tbody .kolActiveGridCell,#view-koleksiyon.kolSpreadsheetWorkspace #kolTable tbody .kolSpreadsheetActiveCell'].includes(d.selector);
   if(!/:focus/.test(d.selector)&&!cursor)failures.push(d);
  }
  if(d.prop==='z-index'&&!/^var\(--ui-z-(below|base|data|raised|sticky|sticky-column|chrome|popover|modal|modal-menu|tooltip|boot)\)$/.test(d.value))failures.push(d);
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
 for(const file of ['overview-global-flow.js','overview-global-flow-earth.js'])assert.match(read(file),/function (?:wantsAnimation|animationWanted)\(\)\{return document.documentElement.dataset.uiSystem!=='manifest'/);
});
test('Main column separators cover both header tiers and never the table body',()=>{
 const rules=entries.filter(d=>d.value==='1px solid var(--ui-group-divider)');
 assert.equal(rules.length,3);
 for(const [i,id] of ['#cpTable','#ordersTable','#kolTable'].entries()){assert.equal(rules[i].selector,groupSeparator(id));assert.doesNotMatch(rules[i].selector,/tbody|td\b/);}
});
test('Shared button contract covers interaction states and restricts explicit variants',()=>{
 const source=read('ui-components.css');
 for(const state of [':hover',':focus-visible',':active',':disabled','[aria-pressed="true"]','[aria-busy="true"]','[aria-invalid="true"]','[data-state="loading"]','[data-state="error"]','.ovPremiumEmpty'])assert.ok(source.includes(state),state);
 const variants=new Set(['primary','quiet']);
 for(const file of fs.readdirSync(PUBLIC).filter(f=>/\.(?:js|html|css)$/.test(f)))for(const m of read(file).matchAll(/data-ui-variant=["']([^"']+)["']/g))assert.ok(variants.has(m[1]),`${file}: ${m[1]}`);
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
test('Migrated Plan and Execute module styles contain only layout and data geometry',()=>{
 const modules=['backlog-date-range.css','backlog-overview.css','backlog-plan-actual.css','backlog-delivery-analysis.css','backlog-presentation.css','detail-drawer.css','cp-overview-assistant.css'];
 const failures=[];
 for(const file of modules)for(const d of declarations(read(file))){
  if(/^(?:color|accent-color|background(?:-.*)?|border(?!-collapse|-spacing)(?:-.*)?|box-shadow|text-shadow|font(?:-.*)?|letter-spacing|line-height|text-transform|fill|stroke(?:-.*)?|outline(?:-.*)?|animation(?:-.*)?|transition(?:-.*)?|filter|backdrop-filter|z-index)$/.test(d.prop))failures.push({file,...d});
  if(/var\(--(?:acc|card|ink|line|muted|fs-|sans|head|mono|r-)/.test(d.value))failures.push({file,...d});
 }
 assert.deepEqual(failures,[]);
 for(const file of ['backlog-overview.js','backlog-plan-actual.js','backlog-radar-layout.js'])assert.doesNotMatch(read(file),/<circle\b|stroke-dasharray=/);
 assert.match(read('backlog-chart.js'),/<rect x="'\+\(x-2\.6\)/);
 assert.match(read('backlog-chart.js'),/c:symbol val="circle"/,'native Excel chart geometry remains an export-only exception');
});

test('Commercial module CSS owns layout only; charts use square marks',()=>{
 const modules=['collection-spreadsheet.css','collection-analytics.css','pricing-desk.css','pricing-workspace.css','price-supplier-analysis.css','manufacturers.css','license-cards.css','lfl.css','open-costing.css'];
 const failures=[];
 for(const file of modules)for(const d of declarations(read(file))){
  if(/^(?:color|accent-color|background(?:-.*)?|border(?!-collapse|-spacing)(?:-.*)?|box-shadow|text-shadow|font(?:-.*)?|letter-spacing|line-height|text-transform|fill|stroke(?:-.*)?|outline(?:-.*)?|animation(?:-.*)?|transition(?:-.*)?|filter|backdrop-filter|(?:-webkit-)?mask(?:-.*)?|z-index)$/.test(d.prop))failures.push({file,...d});
  if(/var\(--(?:acc|card|ink|line|muted|fs-|sans|head|mono|r-)/.test(d.value))failures.push({file,...d});
 }
 assert.deepEqual(failures,[]);
 for(const name of ['pricing-desk.js','price-supplier-analysis.js'])assert.doesNotMatch(read(name),/<circle\b|stroke-dasharray=/);
});

test('Operations module CSS owns layout only; loading avoids decorative canvas',()=>{
 const modules=['automations-fields.css','data-maintenance.css','user-management.css','lcwai-assistant.css','plm-sync-guide.css','buyerlog-guide.css','data-management.css','release-notes.css'];
 const failures=[];
 for(const file of modules)for(const d of declarations(read(file))){
  if(/^(?:color|accent-color|background(?:-.*)?|border(?!-collapse|-spacing)(?:-.*)?|box-shadow|text-shadow|font(?:-.*)?|letter-spacing|line-height|text-transform|fill|stroke(?:-.*)?|outline(?:-.*)?|animation(?:-.*)?|transition(?:-.*)?|filter|backdrop-filter|(?:-webkit-)?mask(?:-.*)?|z-index)$/.test(d.prop))failures.push({file,...d});
  if(/var\(--(?:acc|card|ink|line|muted|fs-|sans|head|mono|r-)/.test(d.value))failures.push({file,...d});
 }
 assert.deepEqual(failures,[]);
 assert.doesNotMatch(read('index.html'),/<script[^>]*thinking-orb-/);
 for(const file of ['automations.js','lcwai-assistant.js','user-management.js','plm-sync-guide.js'])assert.match(read(file),/BLLayerSystem\?\.openDialog/);
 assert.match(read('lcwai-chat.js'),/lcwaiMsg is-user[^]*?lcwaiMsgWho/);
});

test('Remaining module CSS owns layout only; nested output forms use the shared dialog stack',()=>{
 const modules=['command-palette.css','dual-week-datepicker.css','excel-import.css','excel-templates.css','layout-control.css','overview-global-flow.css','overview-home.css','table-search-help.css'];
 const failures=[];
 for(const file of modules)for(const d of declarations(read(file))){
  if(/^(?:color|accent-color|background(?:-.*)?|border(?!-collapse|-spacing)(?:-.*)?|box-shadow|text-shadow|font(?:-.*)?|letter-spacing|line-height|text-transform|fill|stroke(?:-.*)?|outline(?:-.*)?|animation(?:-.*)?|transition(?:-.*)?|filter|backdrop-filter|(?:-webkit-)?mask(?:-.*)?|z-index)$/.test(d.prop))failures.push({file,...d});
  if(/var\(--(?:acc|card|ink|line|muted|fs-|sans|head|mono|r-)/.test(d.value))failures.push({file,...d});
 }
 assert.deepEqual(failures,[]);
 assert.match(read('index.html'),/<body[^>]*data-ui-migrated="manifest"/);
 for(const file of ['excel-templates.js','layout-control.js','overview-home.js'])assert.match(read(file),/BLLayerSystem\?\.openDialog/);
 const editor=read('lcwai-output-editor.js');
 assert.match(editor,/host\.setAttribute\('role','dialog'\)/);
 assert.match(editor,/BLLayerSystem\?\.openDialog\(host,\{onClose:closeDialog\}\)/);
 assert.match(editor,/function closeDialog\(\)[^\n]*BLLayerSystem\?\.closeDialog\(el\)/);
 assert.match(editor,/host\.setAttribute\('aria-label',title\)/);
 assert.doesNotMatch(editor,/dialog\.releaseKeyboard/);
});

test('every module and shell layout file is free of private appearance definitions',()=>{
 const owners=new Set(['ui-tokens.css','ui-components.css','ui-startup.css','giris.css']);const failures=[];
 for(const file of OWNERS.filter(f=>!owners.has(f)))for(const d of declarations(read(file))){
  if(d.prop.startsWith('--')&&/var\(--ui-(?:text|accent|danger|surface|warning|success|chart|font-(?:body|mono|heading))/.test(d.value))failures.push({file,...d});
  if(/^(?:color|accent-color|color-scheme|background(?:-.*)?|border(?!-collapse|-spacing)(?:-.*)?|box-shadow|text-shadow|font(?:-.*)?|letter-spacing|line-height|text-transform|fill|stroke(?:-.*)?|outline(?:-.*)?|animation(?:-.*)?|transition(?:-.*)?|filter|(?:-webkit-)?backdrop-filter|z-index)$/.test(d.prop))failures.push({file,...d});
 }
 assert.deepEqual(failures,[]);
});

test('Earth markers share square geometry, local scaled fonts and static route emphasis',()=>{
 const earth=read('overview-global-flow-earth.js');
 assert.doesNotMatch(earth,/ctx\.arc\(|createRadialGradient|PointPrimitiveCollection/);
 assert.match(earth,/getPropertyValue\('--ui-font-add'\)/);
 assert.match(earth,/getPropertyValue\('--ui-font-mono'\)/);
 assert.doesNotMatch(earth,/font:'[^']*\d+px/);
 assert.match(earth,/Rota yönü sabit işaretlerle gösterilir/);
});
