'use strict';
const fs=require('node:fs'),path=require('node:path');
const contrast=new Function('return '+fs.readFileSync(path.join(__dirname,'evidence.cjs'),'utf8').split('\nfunction contrastSample(){')[1].replace(/^/,'function contrastSample(){'))();
function inspect(){const failures=[],seen=new Set();for(const root of document.querySelectorAll('[data-ui-migrated]'))for(const e of [root,...root.querySelectorAll('*')]){if(!e.checkVisibility())continue;const r=e.getBoundingClientRect();if(r.top>=innerHeight||r.bottom<=0||r.left>=innerWidth||r.right<=0)continue;const s=getComputedStyle(e),id=e.id,cls=typeof e.className==='string'?e.className:e.tagName;const add=(kind,value)=>{const k=cls+'|'+kind+'|'+value;if(!seen.has(k)){seen.add(k);failures.push({id,cls,kind,value});}};
 if(parseFloat(s.borderTopLeftRadius)>2&&!e.matches('.userAvatar,.userAvatarBtn,.statusDot'))add('radius',s.borderTopLeftRadius);
 for(const side of ['Top','Right','Bottom','Left'])if(parseFloat(s['border'+side+'Width'])&&!['none','hidden'].includes(s['border'+side+'Style'])){if(e.tagName==='TD'&&side==='Bottom'||e.tagName==='TH'&&side==='Left'&&e.matches('.groupDivider,.groupBoundary'))continue;add('border'+side,s['border'+side+'Width']);}
 }return {failures,overflow:document.documentElement.scrollWidth>innerWidth};}
module.exports={inspect,contrast};
