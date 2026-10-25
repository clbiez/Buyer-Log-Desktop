'use strict';
// One-off Phase 3 consolidation. No application startup/runtime dependency.
const fs=require('node:fs'),path=require('node:path'),postcss=require('/workspace/.buyerlog-tools/node_modules/postcss');
const root=path.resolve('resources/app/public');
const source=fs.readFileSync('docs/ai/ui-rebuild/tools/migrate-module-css.cjs','utf8');
const aliases=new Function('process',source.slice(source.indexOf('const group='),source.indexOf('const appearance='))+';return alias;')({argv:['','','remaining']});
Object.assign(aliases,{'green-lite':'success','red-lite':'danger','orange-lite':'warning','blue-lite':'accent',navy:'accent',heading:'font-heading','primary-hover':'accent-hover','table-border':'row-divider','pop-blur':'no-filter','focus-ring':'no-shadow','on-solid':'on-accent','r-round':'radius-avatar','r-pill':'radius','sp-7':'space-7',
 'bl-surface-page':'canvas','bl-surface-panel':'surface','bl-surface-soft':'surface-soft','bl-surface-raised':'surface','bl-stroke-subtle':'row-divider','bl-stroke-strong':'group-divider','bl-text-primary':'text','bl-text-secondary':'text-secondary','bl-text-muted':'text-muted','bl-radius-control':'radius','bl-radius-panel':'radius','bl-radius-float':'radius','bl-motion-theme':'motion-enter','bl-ease':'ease',
 'bl-neutral-0':'surface','bl-neutral-25':'surface-soft','bl-neutral-50':'canvas','bl-neutral-100':'surface-strong','bl-neutral-200':'group-divider','bl-neutral-500':'text-muted','bl-neutral-700':'text-secondary','bl-neutral-900':'text','bl-blue-600':'accent','bl-blue-700':'accent-hover','bl-blue-50':'selected'});
for(const s of ['xs','sm','md','lg','xl','full'])aliases['r-'+s]='radius';
const geometry={'rail-w':'rail-width','rail-min-w':'rail-collapsed-width','rail-full-w':'rail-expanded-width','ctl-h-sm':'control-height-small','rail-item-h':'rail-item-height','rail-foot-h':'rail-footer-height','rail-control-size':'rail-control-size','icon-btn-size':'icon-control-size','control-sm':'control-height-small','control-md':'control-height','control-lg':'control-height-large','page-padding':'page-padding','section-gap':'section-gap','card-padding':'panel-padding','toolbar-height':'control-height','table-edit-pad-y':'table-edit-padding'};
Object.assign(aliases,geometry);
const map=value=>value.replace(/var\(--([\w-]+)/g,(m,k)=>aliases[k]?'var(--ui-'+aliases[k]:m);
const geometryBefore=JSON.parse(fs.readFileSync('docs/ai/ui-rebuild/phase-3/root-values-before.json','utf8'));
let tokens=fs.readFileSync(root+'/ui-tokens.css','utf8');
tokens+='\n/* Shared interaction geometry; four canonical presets. */\n:root{--ui-space-7:40px;--ui-no-filter:none;--ui-no-shadow:none;color-scheme:light;}\n';
for(const x of geometryBefore.filter(x=>x.theme==='light')){const values=new Map();for(const [old,name]of Object.entries(geometry)){if(['control-height','control-height-small'].includes(name))continue;values.set('--ui-'+name,map(x.vars['--'+old]));}
 values.set('--ui-control-height-small','calc(var(--ui-control-height) - 4px)');
 tokens+=':root[data-ui-scale="'+x.scale+'"]{'+[...values].map(([k,v])=>k+':'+v+';').join('')+'}\n';
}
tokens+=':root[data-theme="dark"]{color-scheme:dark;}\n';
fs.writeFileSync(root+'/ui-tokens.css',tokens);
const visual=/^(?:color|accent-color|background(?:-.*)?|border(?!-collapse|-spacing)(?:-.*)?|box-shadow|text-shadow|font(?:-.*)?|letter-spacing|line-height|text-transform|fill|stroke(?:-.*)?|outline(?:-.*)?|animation(?:-.*)?|transition(?:-.*)?|filter|backdrop-filter|z-index)$/;
const sizes=[[11,'2xs'],[12,'xs'],[13,'sm'],[14,'base'],[15,'md'],[18,'lg'],[24,'xl'],[30,'2xl'],[36,'3xl'],[44,'4xl']];
function scaledFont(v){const n=v.match(/^calc\(([\d.]+)px\s*\+\s*var\(--ui-font-add\)\)$/)||v.match(/^([\d.]+)(px|rem)$/);if(!n)return v;const px=Number(n[1])*(n[2]==='rem'?16:1);const size=sizes.reduce((a,b)=>Math.abs(b[0]-px)<Math.abs(a[0]-px)?b:a);return 'var(--ui-font-'+size[1]+')';}
function converted(d,selector){let v=map(d.value),p=d.prop;
 if(p==='font-size')v=scaledFont(v);
 if(/radius$/.test(p))v='var(--ui-radius)';
 else if(/^border/.test(p)){if(/(?:color|style|width)$/.test(p))return null;v='0';}
 else if(p==='box-shadow'||p==='text-shadow'||p==='filter'||p==='backdrop-filter'||p.startsWith('animation')||p.startsWith('transition')){if(p.includes('-')&&!['box-shadow','text-shadow','backdrop-filter'].includes(p))return null;v='none';}
 else if(p.startsWith('outline')){if(!selector.includes(':focus'))return null;if(p==='outline')v='2px solid var(--ui-accent)';}
 if(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i.test(v)){
  if(p==='color')v='var(--ui-'+(/thead|th\b/.test(selector)?'header-ink':'text')+')';
  else if(p.startsWith('background'))v='var(--ui-'+(/thead|th\b/.test(selector)?'header-bg':/Overlay|Curtain/.test(selector)?'scrim':'surface')+')';
 }
 return d.clone({value:v});
}
const additions=postcss.root(),stats=[];
for(const f of ['app.css','design.css','design-butunluk.css','experience.css']){
 const a=postcss.parse(fs.readFileSync(root+'/'+f,'utf8'));let moved=0,removed=0;
 a.walkAtRules(/keyframes|font-face/,r=>r.remove());
 a.walkRules(r=>{let parent=r.parent,inPrint=false;while(parent){if(parent.type==='atrule'&&parent.name==='media'&&parent.params.includes('print'))inPrint=true;parent=parent.parent;}if(inPrint)return;
  const newRule=postcss.rule({selector:r.selector}),isRoot=/^(?::root|html(?:\[.*?\])?|\[data-theme=.*?\])$/.test(r.selector);
  r.walkDecls(d=>{if(d.prop.startsWith('--')){if(isRoot){d.remove();removed++;}else if(aliases[d.prop.slice(2)]){d.prop='--ui-'+aliases[d.prop.slice(2)];d.value=map(d.value);}else d.value=map(d.value);return;}
   if(visual.test(d.prop)){const c=converted(d,r.selector);if(c)newRule.append(c);d.remove();moved++;}else d.value=map(d.value);
  });
  if(newRule.nodes.length){let top=newRule,p=r.parent;while(p&&p.type!=='root'){const at=postcss.atRule({name:p.name,params:p.params});at.append(top);top=at;p=p.parent;}additions.append(top);}
  if(!r.nodes.some(n=>n.type==='decl'))r.remove();
 });
 a.walkComments(c=>c.remove());a.walkAtRules(r=>{if(r.nodes&&!r.nodes.length)r.remove();});
 fs.writeFileSync(root+'/'+f,'/* Manifest shared layout. Appearance: ui-tokens.css / ui-components.css. */\n'+a.toString().trim()+'\n');stats.push({file:f,moved,removed});
}
// The old patch has only valid layout left. Preserve its cascade position in
// the preceding shared layout file, then remove the obsolete stylesheet.
fs.appendFileSync(root+'/design.css','\n'+fs.readFileSync(root+'/design-butunluk.css','utf8'));fs.unlinkSync(root+'/design-butunluk.css');fs.unlinkSync(root+'/ui-legacy-bridge.css');
for(const f of fs.readdirSync(root).filter(f=>f.endsWith('.css')&&!['ui-tokens.css','ui-components.css'].includes(f))){fs.writeFileSync(root+'/'+f,map(fs.readFileSync(root+'/'+f,'utf8')));}
const common=postcss.parse(additions.toString()+'\n'+fs.readFileSync(root+'/ui-components.css','utf8'));
common.walkDecls(d=>{d.value=map(d.value);if(d.prop==='font-size')d.value=scaledFont(d.value);});
// Exact duplicate declarations on an identical selector/condition can be
// removed without widening component variants or changing state specificity.
const last=new Map();let duplicates=0;
common.walkRules(r=>{let context='',a=r.parent;while(a&&a.type!=='root'){context=a.name+':'+a.params+'|'+context;a=a.parent;}
 for(const d of [...r.nodes].filter(n=>n.type==='decl')){const key=context+'|'+r.selector+'|'+d.prop,prior=last.get(key);if(prior){if(!prior.important||d.important){prior.remove();last.set(key,d);}else d.remove();duplicates++;}else last.set(key,d);}
});
common.walkRules(r=>{if(!r.nodes.some(n=>n.type==='decl'))r.remove();});common.walkAtRules(a=>{if(a.nodes&&!a.nodes.length)a.remove();});
fs.writeFileSync(root+'/ui-components.css',common.toString());
// Pure standalone document builders retain their frozen palettes/fonts.
const documents=new Set(['license-supplier-atlas.js','license-atlas-engine.js','backlog-presentation-report.js','table-export.js']);
for(const f of fs.readdirSync(root).filter(f=>/\.(js|html)$/.test(f)&&!documents.has(f))){let s=fs.readFileSync(root+'/'+f,'utf8');s=map(s);s=s.replace(/(['"])(--[\w-]+)\1/g,(m,q,k)=>aliases[k.slice(2)]?q+'--ui-'+aliases[k.slice(2)]+q:m);if(f==='index.html')s=s.replace(/^.*href="(?:design-butunluk|ui-legacy-bridge)\.css[^\n]*\n/gm,'');fs.writeFileSync(root+'/'+f,s);}
fs.writeFileSync('docs/ai/ui-rebuild/phase-3/consolidation.json',JSON.stringify({stats,duplicates,aliases},null,2)+'\n');console.log({stats,duplicates});
