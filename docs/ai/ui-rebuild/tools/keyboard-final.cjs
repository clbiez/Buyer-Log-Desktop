'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
(async()=>{
 const out=path.resolve('docs/ai/ui-rebuild/phase-3');const {browser,context,page,tab}=await require('./matrix-commercial-fixture.cjs')();const report={checks:[],errors:[]};page.on('pageerror',e=>report.errors.push(e.message));
 const source=fs.readFileSync(path.join(__dirname,'matrix-rare.cjs'),'utf8'),cases=vm.runInNewContext(source.slice(source.indexOf('const cases='),source.indexOf('\n(async()=>'))+';cases');
 const wanted=new Set(['source-required','warning-list','refresh-error','browser-settings','sync-status','backlog-export-fields','collection-quick-filters','pricing-results','model-files']);
 for(const step of [0,1,2,3]){
  await page.setViewportSize({width:step%2?1440:1280,height:step%2?900:720});await page.evaluate(step=>{applyTheme('grey');applyUiFontStep(step);},step);
  for(const [name,id,open,key] of cases.filter(c=>wanted.has(c[0]))){
   await tab(key);const trigger=page.locator('nav.tabs [data-tab="'+key+'"]');await trigger.focus();await page.evaluate(s=>{(0,eval)(s);},open);const modal=page.locator('#'+id);await modal.waitFor();await page.waitForTimeout(80);
   const count=await modal.evaluate(e=>{const a=BLLayerSystem.focusableElements(e);a.at(-1)?.focus();return a.length;});assert.ok(count,name);
   await page.keyboard.press('Tab');const forward=await modal.evaluate(e=>document.activeElement===BLLayerSystem.focusableElements(e)[0]);assert.ok(forward,name+' forward');
   await page.keyboard.press('Shift+Tab');const backward=await modal.evaluate(e=>document.activeElement===BLLayerSystem.focusableElements(e).at(-1));assert.ok(backward,name+' backward');
   const focus=await page.evaluate(()=>{const s=getComputedStyle(document.activeElement);return {style:s.outlineStyle,width:s.outlineWidth,color:s.outlineColor};});assert.notEqual(focus.style,'none',name+' visible focus');
   await page.keyboard.press('Escape');await page.waitForTimeout(60);const closed=!(await modal.isVisible().catch(()=>false));assert.ok(closed,name+' Escape');
   const returned=await trigger.evaluate(e=>document.activeElement===e);assert.ok(returned,name+' focus return');report.checks.push({name,step,count,forward,backward,closed,returned,focus});fs.writeFileSync(path.join(out,'keyboard-final.json'),JSON.stringify(report,null,2)+'\n');console.log(name,step,'PASS');
  }
 }
 await page.emulateMedia({reducedMotion:'reduce'});report.reducedMotion=await page.evaluate(()=>({matches:matchMedia('(prefers-reduced-motion: reduce)').matches,activeAnimations:document.getAnimations().filter(a=>a.playState==='running').map(a=>({name:a.animationName,duration:a.effect.getTiming().duration}))}));assert.equal(report.reducedMotion.activeAnimations.length,0);
 fs.writeFileSync(path.join(out,'keyboard-final.json'),JSON.stringify(report,null,2)+'\n');await context.close();await browser.close();
})().catch(e=>{console.error(e.stack);process.exit(1);});
