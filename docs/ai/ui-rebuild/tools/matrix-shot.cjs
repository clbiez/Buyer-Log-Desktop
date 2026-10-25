'use strict';
const fs=require('node:fs'),path=require('node:path'),{inspect,contrast}=require('./runtime-probe.cjs');
module.exports=({page,out,report})=>async raw=>{
 const family=raw.replace(/-(?:light|grey|dark)$/,'');if(/-size-|1280-step|collection-size/.test(family))return;
 const matrixRoot=path.dirname(out);
 for(const dir of process.env.BL_MATRIX_RECHECK?[]:fs.readdirSync(matrixRoot)){const f=path.join(matrixRoot,dir,'capture.json');if(path.dirname(f)===out||!fs.existsSync(f))continue;const prior=JSON.parse(fs.readFileSync(f));const matches=prior.screens?.filter(s=>s.family===family)||[];if(matches.length===24){report.represented??={};report.represented[family]=path.relative(out,f);fs.writeFileSync(path.join(out,'capture.json'),JSON.stringify(report,null,2)+'\n');return;}}
 const only=process.env.BL_MATRIX_ONLY;if(only&&!new RegExp(only).test(family))return;
 const crypto=require('node:crypto'),styleHash=crypto.createHash('sha256').update(fs.readFileSync('resources/app/public/ui-tokens.css')).update(fs.readFileSync('resources/app/public/ui-components.css')).digest('hex');
 if(page.__matrixStyleHash!==styleHash){await page.evaluate(async hash=>{await Promise.all([...document.querySelectorAll('link[rel="stylesheet"]')].filter(e=>/\/(?:ui-tokens|ui-components)\.css/.test(new URL(e.href).pathname)).map(e=>new Promise((resolve,reject)=>{e.onload=resolve;e.onerror=reject;const url=new URL(e.href);url.searchParams.set('audit',hash.slice(0,12));e.href=url.href;})));},styleHash);page.__matrixStyleHash=styleHash;}
 const before=await page.evaluate(()=>({theme:document.documentElement.dataset.theme,step:Number(document.documentElement.dataset.fontStep)||0})),viewport=page.viewportSize();
 const save=()=>fs.writeFileSync(path.join(out,'capture.json'),JSON.stringify(report,null,2)+'\n');
 for(const theme of ['light','grey','dark'])for(const step of [0,1,2,3])for(const width of [1440,1280]){
  const name=family+'-'+theme+'-'+['standard','large','xl','compact'][step]+'-'+width;
  if(report.screens.some(s=>s.name===name))continue;
  await page.setViewportSize({width,height:width===1440?900:720});
  await page.evaluate(({theme,step})=>{applyTheme(theme);applyUiFontStep(step);},{theme,step});
  await page.evaluate(()=>document.fonts.ready);await page.waitForTimeout(130);await page.mouse.move(family==='rail-collapsed'?width-5:0,family==='rail-collapsed'?(width===1440?895:715):0);
  for(const b of await page.locator('[data-ui-feedback-close]:visible').all())await b.click({timeout:400}).catch(()=>{});
  await page.screenshot({path:path.join(out,name+'.png')});
  const appearance=await page.evaluate(()=>({theme:document.documentElement.dataset.theme,scale:document.documentElement.dataset.uiScale,fontAdd:getComputedStyle(document.documentElement).getPropertyValue('--ui-font-add'),width:innerWidth,height:innerHeight,lang:document.documentElement.lang}));
  if(appearance.scale!==['standard','large','xl','compact'][step])throw Error('Scale mismatch: '+name);
  report.screens.push({name,family,appearance,styleHash,...await page.evaluate(inspect),contrast:await page.evaluate(contrast)});save();console.log(name);
 }
 await page.setViewportSize(viewport);await page.evaluate(({theme,step})=>{applyTheme(theme);applyUiFontStep(step);},before);await page.waitForTimeout(150);
};
