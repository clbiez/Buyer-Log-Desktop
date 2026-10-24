'use strict';
// Manual real-browser regression: PLAYWRIGHT_MODULE=<module> CHROMIUM_PATH=<exe>
// node --test tests/helpers/dialog-focus.browser.cjs. Missing browsers fail, not skip.
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
test('shared dialog focus in real Chromium',async t=>{
 const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),args:['--no-sandbox']});
 try{
  const page=await browser.newPage();
  async function setup(body){await page.setContent('<button id="trigger">Trigger</button>'+body+'<button id="outside">Outside</button>');await page.addScriptTag({path:process.env.LAYER_FILE||path.resolve(__dirname,'../../public/layer-system.js')});await page.locator('#trigger').focus();}
  const active=()=>page.evaluate(()=>document.activeElement.id);
  await t.test('CSS-hidden edges, hidden ancestors, inert and disabled fieldset never enter Tab order',async()=>{
   await setup('<div id="overlay"><div role="dialog"><input autofocus style="display:none"><div style="display:none"><input></div><div inert><button>Inert</button></div><fieldset disabled><input></fieldset><button id="first">First</button><button id="last">Last</button><button style="visibility:hidden">Hidden end</button></div></div>');
   await page.evaluate(()=>BLLayerSystem.openDialog(document.querySelector('#overlay')));assert.equal(await active(),'first');
   await page.locator('#last').focus();await page.keyboard.press('Tab');assert.equal(await active(),'first');await page.keyboard.press('Shift+Tab');assert.equal(await active(),'last');
   assert.deepEqual(await page.evaluate(()=>BLLayerSystem.focusableElements(document.querySelector('[role=dialog]')).map(e=>e.id)),['first','last']);
  });
  await t.test('hidden requested focus falls back to a rendered field',async()=>{
   await setup('<div id="overlay"><div role="dialog"><input id="hidden" style="display:none"><input id="visible"></div></div>');await page.evaluate(()=>BLLayerSystem.openDialog(document.querySelector('#overlay'),{initialFocus:'#hidden'}));assert.equal(await active(),'visible');
  });
  await t.test('aria-hidden and aria-disabled middle controls are skipped in both directions',async()=>{
   await setup('<div id="overlay"><div role="dialog"><button id="first">First</button><button aria-hidden="true">Hidden</button><button aria-disabled="true">Unavailable</button><button id="last">Last</button></div></div>');await page.evaluate(()=>BLLayerSystem.openDialog(document.querySelector('#overlay')));await page.keyboard.press('Tab');assert.equal(await active(),'last');await page.keyboard.press('Shift+Tab');assert.equal(await active(),'first');
  });
  await t.test('only nested top dialog handles Escape and return focus',async()=>{
   await setup('<div id="parent"><div role="dialog"><button id="parentButton">Parent</button><div id="child"><div role="dialog"><button id="childButton">Child</button></div></div></div></div>');
   await page.evaluate(()=>{const parent=document.querySelector('#parent'),child=document.querySelector('#child');child.hidden=true;window.focusClosed=[];BLLayerSystem.openDialog(parent,{onClose:()=>focusClosed.push('parent')});});
   await page.evaluate(()=>{const child=document.querySelector('#child');child.hidden=false;BLLayerSystem.openDialog(child,{onClose:()=>{focusClosed.push('child');BLLayerSystem.closeDialog(child);child.hidden=true;}});});
   assert.equal(await active(),'childButton');await page.keyboard.press('Escape');assert.deepEqual(await page.evaluate(()=>focusClosed),['child']);assert.equal(await active(),'parentButton');
  });
  await t.test('empty dialog traps both directions and removed/hidden triggers are not restored',async()=>{
   await setup('<div id="overlay"><div role="dialog" id="empty"><span>Content</span></div></div>');await page.evaluate(()=>BLLayerSystem.openDialog(document.querySelector('#overlay')));assert.equal(await active(),'empty');await page.keyboard.press('Tab');assert.equal(await active(),'empty');await page.keyboard.press('Shift+Tab');assert.equal(await active(),'empty');
   await page.evaluate(()=>{document.querySelector('#trigger').remove();BLLayerSystem.closeDialog(document.querySelector('#overlay'));});assert.notEqual(await active(),'trigger');
  });
  await t.test('disabled and CSS-hidden triggers do not receive restored focus',async()=>{
   for(const mode of ['disabled','hidden']){
    await setup('<div id="overlay"><div role="dialog"><button id="inside">Inside</button></div></div>');await page.evaluate(()=>BLLayerSystem.openDialog(document.querySelector('#overlay')));
    await page.evaluate(mode=>{const trigger=document.querySelector('#trigger');if(mode==='disabled')trigger.disabled=true;else trigger.style.display='none';BLLayerSystem.closeDialog(document.querySelector('#overlay'));},mode);assert.equal(await active(),'inside');
   }
  });
  await t.test('late initial-focus tasks cannot steal focus after close or newer dialog open',async()=>{
   await setup('<div id="one"><div role="dialog"><button id="oneButton">One</button></div></div><div id="two"><div role="dialog"><button id="twoButton">Two</button></div></div>');await page.evaluate(()=>{BLLayerSystem.openDialog(document.querySelector('#one'));BLLayerSystem.openDialog(document.querySelector('#two'));BLLayerSystem.closeDialog(document.querySelector('#one'));});assert.equal(await active(),'twoButton');
  });
  await t.test('native dialog is supported without stealing focus from another native top layer',async()=>{
   await setup('<dialog id="native"><button id="nativeFirst">First</button><button id="nativeLast">Last</button><button hidden>Hidden</button></dialog>');await page.evaluate(()=>{const d=document.querySelector('#native');d.showModal();BLLayerSystem.openDialog(d);});await page.locator('#nativeLast').focus();await page.keyboard.press('Tab');assert.equal(await active(),'nativeFirst');
  });
  await t.test('unregistered native child keeps its browser Escape behavior',async()=>{
   await setup('<dialog id="parentNative"><button>Parent</button><dialog id="childNative"><button>Child</button></dialog></dialog>');await page.evaluate(()=>{window.parentClosed=false;const parent=document.querySelector('#parentNative');parent.showModal();BLLayerSystem.openDialog(parent,{onClose:()=>{parentClosed=true;}});document.querySelector('#childNative').showModal();});await page.keyboard.press('Escape');assert.equal(await page.evaluate(()=>parentClosed),false);assert.equal(await page.locator('#childNative').evaluate(e=>e.open),false);assert.equal(await page.locator('#parentNative').evaluate(e=>e.open),true);
  });
 }finally{await browser.close();}
});
