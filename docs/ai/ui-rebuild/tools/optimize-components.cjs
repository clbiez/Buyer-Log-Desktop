'use strict';
// Candidate-only until computed-style and performance checks approve it.
const fs=require('node:fs'),p=require('/workspace/.buyerlog-tools/node_modules/postcss');const a=p.parse(fs.readFileSync(process.argv[2]||'resources/app/public/ui-components.css','utf8'));let removed=0,rules=0;
a.walkRules(r=>{r.selector=r.selector.replaceAll(':where([data-ui-migrated]) ','');});
a.walkDecls(d=>{if(/^border(?:-|$)/.test(d.prop)&&/(?:\b(?:table|td|th|thead|tbody|tfoot)\b|Table|table)/.test(d.parent.selector||''))return;if((/^border(?:-(?:top|right|bottom|left|inline|block))?$/.test(d.prop)&&/^(?:0|none)$/.test(d.value))||(d.prop==='border-radius'&&d.value==='var(--ui-radius)')||(['box-shadow','text-shadow','filter','backdrop-filter'].includes(d.prop)&&d.value==='none')){d.remove();removed++;}});
a.walkRules(r=>{if(!r.nodes.length){r.remove();rules++;}});
// All migrated bodies share one motion/reset contract. Earlier pilot-wide
// descendant resets are redundant after the complete migration.
a.walkRules(r=>{if(/data-ui-migrated|:is\(\.rail,\.appTop,#view-cp,#view-overview\)/.test(r.selector)&&r.selector.includes('*')&&r.nodes.every(d=>d.type==='decl'&&/^(?:animation|transition(?:-property)?|scroll-behavior|box-sizing)$/.test(d.prop)))r.remove();});
const parser=require('/workspace/.buyerlog-tools/node_modules/postcss-selector-parser');
const compare=(a,b)=>a[0]-b[0]||a[1]-b[1]||a[2]-b[2],sum=(a,b)=>a.map((v,i)=>v+b[i]);
function specificity(nodes){return nodes.reduce((n,x)=>sum(n,x.type==='id'?[1,0,0]:['class','attribute'].includes(x.type)?[0,1,0]:x.type==='tag'?[0,0,1]:x.type==='pseudo'?(x.value===':where'?[0,0,0]:/^:(?:is|not|has)$/.test(x.value)?x.nodes.map(a=>specificity(a.nodes)).sort(compare).at(-1):x.value.startsWith('::')?[0,0,1]:[0,1,0]):[0,0,0]),[0,0,0]);}
let expanded=0;
a.walkRules(r=>{r.selector=parser(root=>{let changed=true;while(changed){changed=false;for(const selector of [...root.nodes]){const target=selector.nodes.find(n=>n.type==='pseudo'&&n.value===':is'&&n.nodes.length>1&&n.nodes.every(arm=>arm.nodes.every(x=>x.type!=='combinator'))&&n.nodes.every(arm=>compare(specificity(arm.nodes),specificity(n.nodes[0].nodes))===0));if(!target)continue;const index=selector.nodes.indexOf(target);for(const arm of target.nodes){const clone=selector.clone();clone.nodes[index].replaceWith(...arm.nodes.map(n=>n.clone()));root.insertBefore(selector,clone);}selector.remove();changed=true;expanded++;}}}).processSync(r.selector);});
a.prepend(p.parse(':where(body,body *){border:0;border-radius:var(--ui-radius);box-shadow:none;text-shadow:none;}\n:where(body,body *,body *::before,body *::after){animation:none!important;transition:none!important;scroll-behavior:auto!important;}\n').nodes);
const out=process.argv[3]||'/tmp/bl-ui-components-candidate.css';fs.writeFileSync(out,a.toString());console.log({out,removed,rules,expanded,before:fs.statSync(process.argv[2]||'resources/app/public/ui-components.css').size,after:fs.statSync(out).size});
