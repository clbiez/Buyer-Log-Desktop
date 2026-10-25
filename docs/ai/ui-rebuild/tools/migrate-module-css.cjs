'use strict';
// One-off migration tool, not shipped/executed by the app. Layout stays in the
// module; reviewed appearance adapters move into the canonical component file.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const postcss=require('/workspace/.buyerlog-tools/node_modules/postcss');
const root=path.resolve('resources/app/public');
const group=process.argv[2]||'plan-execute',base=process.argv[3]||'2324ba7c';
let modules=['backlog-date-range.css','backlog-overview.css','backlog-plan-actual.css','backlog-delivery-analysis.css','backlog-presentation.css','detail-drawer.css','cp-overview-assistant.css'];
let owned=/(?:[.#](?:ship\w*|backlog\w*|blv\w*|bpa\w*|bda\w*|cp\w*|ordersTable|view-orders|view-backlog|view-shipping|blDetail\w*|tableFields\w*|tableColumn\w*|colPanel\w*|colFilter\w*|thFilter\w*|vfPanel\w*|kolSpreadsheetContextMenu|autoModal\w*|oabSettings\w*|oabConfig\w*|oabPivot\w*|oabCheck\w*|freight\w*))\b/;
const alias={paper:'canvas','rail-bg':'rail',card:'surface',card2:'surface-soft','card2-strong':'surface-strong',ink:'text',ink2:'text-secondary',muted:'text-muted',acc:'accent','acc-hover':'accent-hover','acc-bg':'selected','acc-ink':'selected-ink','on-acc':'on-accent','on-solid':'on-accent',green:'success','green-bg':'success-bg','green-lite':'success-bg',red:'danger',danger:'danger','red-bg':'danger-bg','red-lite':'danger-bg',orange:'warning','orange-bg':'warning-bg',yellow:'warning','yellow-bg':'warning-bg','bl-surface-raised':'surface',purple:'chart-4',teal:'chart-3','gray-bg':'surface-strong',sans:'font-body',head:'font-heading',mono:'font-mono',line:'row-divider',line2:'group-divider',scrim:'scrim',pop:'surface','shadow-2':'shadow-overlay','shadow-3':'shadow-overlay','table-bg':'surface','table-ink':'text','table-hover':'row-hover','thead-bg':'header-bg','thead-ink':'header-ink',ease:'ease','bl-ease':'ease','bl-motion-fast':'motion-fast','bl-motion-enter':'motion-enter','ctl-h':'control-height','ctl-h-sm':'control-height','sp-2':'space-2','sp-3':'space-3','sp-4':'space-4','sp-5':'space-5'};
Object.assign(alias,{seg:'series-color',tile:'metric-color','series-color':'series-color',hover:'row-hover','table-row-h':'table-row-height','table-group-head-h':'table-group-height','table-head-pad-y':'table-head-padding','table-cell-pad-y':'table-cell-padding'});
for(const size of ['2xs','xs','sm','base','md','lg','xl','2xl','3xl','4xl'])alias['fs-'+size]='font-'+size;
for(const [old,token] of Object.entries({'blv-SHORTAGE':'danger','blv-PRODUCTION':'accent','blv-LOADING':'warning','blv-IN_TRANSIT':'chart-4','blv-CUSTOMS':'chart-5','blv-AWAITING_RETAIL_TRANSFER':'chart-3','blv-IN_WAREHOUSE':'success','blv-UNKNOWN':'text-muted','bpa-overdue':'danger','bpa-late':'warning','bpa-undated':'chart-5','bpa-pending':'accent','bpa-onTime':'success','bpa-removed':'text-muted'}))alias[old]=token;
if(group!=='plan-execute'){
 modules=['collection-spreadsheet.css','collection-analytics.css','pricing-desk.css','pricing-workspace.css','price-supplier-analysis.css','manufacturers.css','license-cards.css','lfl.css','open-costing.css'];
 owned=/(?:[.#](?:kol\w*|collection\w*|pricing\w*|quotation\w*|qh\w*|pd[A-Z]\w*|psa\w*|mfp\w*|lc[A-Z]\w*|lfl\w*|oc[A-Z]\w*|view-koleksiyon|view-quotations|view-pricinghistory|view-priceanalysis|view-manufacturers|view-licensecards|view-lfl|view-opencosting))\b/;
 Object.assign(alias,{'acc-lite':'accent','control-sm':'control-height','sp-1':'space-1','sp-6':'space-6',hair:'row-divider','bl-motion-standard':'motion-enter','navy-deep':'text','shadow-1':'shadow-overlay','thead-line':'group-divider',blue:'accent',error:'danger',info:'accent',primary:'accent','on-primary':'on-accent','row-hover':'row-hover',success:'success',warning:'warning',line3:'group-divider','table-editBg':'selected','kol-cell-fs':'font-xs',ap:'series-color','topbar-h':'topbar-height','bl-surface-panel':'surface','bl-surface-soft':'surface-soft'});
 for(let i=1;i<=8;i++)alias['chart-'+i]='chart-'+i;
}
if(group==='operations'){
 modules=['automations-fields.css','data-maintenance.css','user-management.css','lcwai-assistant.css','plm-sync-guide.css','buyerlog-guide.css','data-management.css','release-notes.css'];
 owned=/(?:[.#](?:auto\w*|automation\w*|ao[A-Z]\w*|dm[A-Z]\w*|dataMgmt\w*|blDataMaint\w*|source[A-Z]\w*|sourceTables|sourceTable|um[A-Z]\w*|lcwai\w*|blGuide\w*|blTrivia\w*|blRn\w*|plmGuide\w*|plmSyncGuide\w*|verHist\w*|versionHistory\w*|notification\w*|syncStatus\w*|uiState\w*|uiFeedback\w*|blOrb\w*|toast\w*|view-source|view-automations|view-lcwai))\b/;
 Object.assign(alias,{'shadow-lg':'shadow-overlay',tone:'series-color'});
}
if(group==='remaining'){
 modules=['command-palette.css','dual-week-datepicker.css','excel-import.css','excel-templates.css','layout-control.css','overview-global-flow.css','overview-home.css','table-search-help.css'];
 // Finish every class/id-owned UI rule. Root palette definitions and plain
 // HTML defaults are consolidated in Phase 3; printed exports remain frozen.
 owned=/[.#]/;
 Object.assign(alias,{'shadow-lg':'shadow-overlay',tone:'series-color','table-link':'accent','table-editHover':'row-hover','hair-2':'group-divider',imp:'series-color','ov-category':'series-color','status-color':'series-color'});
}
const appearance=/^(?:color|accent-color|background(?:-.*)?|border(?!-collapse|-spacing)(?:-.*)?|box-shadow|text-shadow|font(?:-.*)?|letter-spacing|line-height|text-transform|text-decoration|fill|stroke(?:-.*)?|outline(?:-.*)?|animation(?:-.*)?|transition(?:-.*)?|filter|backdrop-filter|(?:-webkit-)?mask(?:-.*)?|z-index)$/;
const source=f=>cp.execFileSync('git',['show',base+':resources/app/public/'+f],{encoding:'utf8'});
const components=postcss.root(),stats=[];
function mapValue(value){return value.replace(/var\(--([\w-]+)/g,(m,k)=>alias[k]?'var(--ui-'+alias[k]:m);}
function convert(d,selector){
 const p=d.prop;let v=mapValue(d.value);
 if(p==='background-size'&&selector==='.ovHome.isEditing')return null;
 if(p==='background-image'&&/gradient\(/.test(v))return {prop:p,value:'none'};
 if(p.startsWith('--')){if(['--seg','--tile','--series-color','--ap','--tone','--imp','--ov-category','--status-color'].includes(p))return {prop:'--ui-'+alias[p.slice(2)],value:v};if(alias[p.slice(2)])return null;return {prop:p,value:v};}
 if(/radius$/.test(p))v='var(--ui-radius)';
 else if(/^border/.test(p)){
  // Borders are supplied once by the common dense-table/focus contracts.
  if(/(?:color|style|width)$/.test(p))return null;
  v='0';
 }
 else if(p==='box-shadow')v=/:focus|blGrid(?:RangeEdge|ActiveCell)/.test(selector)?'none':/(?:Panel|Drawer|Dialog|Menu|Popover|Tip)(?:\b|[.#:\s>])/.test(selector)?'var(--ui-shadow-overlay)':'none';
 else if(/mask/.test(p)||p==='text-shadow'||p==='filter'||p==='backdrop-filter'||p.startsWith('animation'))v='none';
 else if(p.startsWith('transition')){if(p!=='transition')return null;v='transform var(--ui-motion-fast),opacity var(--ui-motion-fast)';}
 else if(p==='z-index'){const n=v==='auto'?0:Number(v);if(Number.isFinite(n))v='var(--ui-z-'+(n<0?'below':n===0?'base':n<=10?'data':n<=100?'sticky':n<10000?'popover':n<60000?'modal':'tooltip')+')';}
 else if(p==='background'||p==='background-image'){
  if(/gradient\(/.test(v))v=/Track|Grid/.test(selector)?'var(--ui-surface-soft)':'var(--ui-surface)';
  if(/^rgba?\(/.test(v))v=/Backdrop|Scrim|Overlay/.test(selector)?'var(--ui-scrim)':'var(--ui-surface-soft)';
 }
 if(p==='z-index'&&selector==='.blDetailDrawerSubbar')v='var(--ui-z-raised)';
 if(p==='z-index'&&selector==='.cpaModalOverlay')v='var(--ui-z-modal)';
 if(p==='z-index'&&selector==='.cpaValueMenu')v='var(--ui-z-modal-menu)';
 if(group==='operations'&&selector.includes('.umAvatar')&&['background','color'].includes(p))v=p==='color'?'var(--ui-text-secondary)':'var(--ui-surface-strong)';
 if(p.startsWith('animation')&&p!=='animation')return null;
 if(p==='font-size'&&/^\d+(?:\.\d+)?px$/.test(v))v='calc('+v+' + var(--ui-font-add))';
 v=v.replace(/var\(--r-[\w-]+\)/g,'var(--ui-radius)').replace(/var\(--pop-blur\)/g,'none').replace(/var\(--focus-ring\)/g,'none');
 if(/#[0-9a-f]{3,8}\b/i.test(v)){
  v=v.replace(/#[0-9a-f]{3,8}\b/gi,hex=>/^(#fff|#ffffff)$/i.test(hex)?'var(--ui-surface)':/^(#000|#000000)$/i.test(hex)?'var(--ui-text)':'var(--ui-accent)');
 }
 v=v.replace(/rgba\(0,0,0,\.45\)/g,'var(--ui-scrim)');
 if(p==='color')v=v.replace(/var\(--ui-(danger|success|warning)-bg\)/g,'var(--ui-$1)');
 if(p==='outline'&&v==='none')return null; // native/shared visible focus remains
 return {prop:p,value:v};
}
function migrate(file,all){
 const ast=postcss.parse(source(file)),count={file,rules:0,declarations:0},rules=[];ast.walkRules(r=>rules.push(r));
 for(const rule of rules){
  if(rule.parent.type==='atrule'&&/keyframes/.test(rule.parent.name))continue;
  let parent=rule.parent,inPrint=false;while(parent){if(parent.type==='atrule'&&parent.name==='media'&&parent.params==='print')inPrint=true;parent=parent.parent;}if(inPrint)continue; // Printed export has a fixed palette/point sizes; UI migration must not recolor it.
  const selectors=postcss.list.comma(rule.selector),selected=all?selectors:selectors.filter(s=>owned.test(s)&&!s.includes(':not(#shipTable)'));if(!selected.length)continue;
  const other=selectors.filter(s=>!selected.includes(s));
  const layout=rule.clone({selector:selected.join(',')}),visual=postcss.rule({selector:selected.map(s=>/^html\b/.test(s)?s.replace(/^html\b/,'html[data-ui-system="manifest"]'):s.startsWith(':root')?s.replace(':root',':root[data-ui-system="manifest"]'):'html[data-ui-system="manifest"] '+s).join(',')});layout.removeAll();
  for(const d of rule.nodes){if(d.type!=='decl'){layout.append(d.clone());continue;}
   const move=appearance.test(d.prop)||group==='operations'&&d.prop.startsWith('--ui-feedback-')||d.prop.startsWith('--')&&(/(?:blv-|bpa-)/.test(d.prop)||/color|var\(--(?:seg|tile|blv-|bpa-)/.test(d.value)||['--seg','--tile','--ap','--tone','--imp','--ov-category','--status-color'].includes(d.prop));
   if(move){const next=convert(d,rule.selector);if(next){const n=d.clone(next);n.important=/^(?:border|background|color|font|box-shadow|animation|filter)/.test(n.prop);visual.append(n);}count.declarations++;}
   else {const n=d.clone();n.value=mapValue(n.value);layout.append(n);}
  }
  if(visual.nodes.length){let top=visual,parent=rule.parent;while(parent&&parent.type!=='root'){if(parent.type==='atrule'){const wrap=postcss.atRule({name:parent.name,params:parent.params});wrap.append(top);top=wrap;}parent=parent.parent;}components.append(top);count.rules++;}
  if(other.length){rule.selector=other.join(',');if(layout.nodes.some(n=>n.type==='decl'))rule.after(layout);}else if(layout.nodes.some(n=>n.type==='decl'))rule.replaceWith(layout);else rule.remove();
 }
 if(all)ast.walkAtRules(/keyframes/,a=>a.remove());
 ast.walkAtRules(a=>{if(a.nodes&&!a.nodes.length)a.remove();});
 fs.writeFileSync(path.join(root,file),ast.toString());stats.push(count);
}
for(const file of modules)migrate(file,true);migrate('app.css',false);migrate('design.css',false);migrate('experience.css',false);migrate('design-butunluk.css',false);
// Collapse equal appearance declarations while preserving order/state specificity.
const current=fs.readFileSync(path.join(root,'ui-components.css'),'utf8'),tailAt=current.indexOf('/* Shared controls, tables');const tail=group!=='plan-execute'||tailAt<0?'':current.slice(tailAt);const baseline=source('ui-components.css');fs.writeFileSync(path.join(root,'ui-components.css'),'/* Manifest shared appearance adapters: '+group+'. Module files contain layout only. */\n'+components.toString()+'\n\n'+baseline+'\n'+tail);
const dest=path.resolve('docs/ai/ui-rebuild/phase-2-'+group);fs.mkdirSync(dest,{recursive:true});fs.writeFileSync(path.join(dest,'css-migration.json'),JSON.stringify({base,group,modules,stats},null,2)+'\n');console.log(stats);
