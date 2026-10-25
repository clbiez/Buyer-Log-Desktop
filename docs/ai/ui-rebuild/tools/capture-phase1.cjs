'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const contrast=new Function('return '+fs.readFileSync(path.join(__dirname,'evidence.cjs'),'utf8').split('\nfunction contrastSample(){')[1].replace(/^/,'function contrastSample(){'))();
const out=path.resolve(process.argv[2]||'docs/ai/ui-rebuild/phase-1/final');fs.mkdirSync(out,{recursive:true});
function geometry(){
 const issues=[];const roots=[...document.querySelectorAll('[data-ui-migrated]')];
 for(const root of roots)for(const e of [root,...root.querySelectorAll('*')]){
  if(!e.checkVisibility())continue;const r=e.getBoundingClientRect();if(r.bottom<=0||r.top>=innerHeight||r.right<=0||r.left>=innerWidth)continue;
  const s=getComputedStyle(e);const id=e.id,cls=typeof e.className==='string'?e.className:e.tagName;
  if(parseFloat(s.borderTopLeftRadius)>2&&!e.matches('.userAvatar,.userAvatarBtn,.statusDot'))issues.push({id,cls,kind:'radius',value:s.borderTopLeftRadius});
  for(const side of ['Top','Right','Bottom','Left']){
   if(!parseFloat(s['border'+side+'Width'])||['none','hidden'].includes(s['border'+side+'Style']))continue;
   if(e.closest('#cpTable')&&((e.tagName==='TD'&&side==='Bottom')||(e.tagName==='TH'&&side==='Left'&&e.matches('.groupDivider,.groupBoundary'))))continue;
   issues.push({id,cls,kind:'border'+side,value:s['border'+side+'Width']});
  }
 }
 return {issues,overflow:document.documentElement.scrollWidth>innerWidth,scale:document.documentElement.dataset.uiScale};
}
(async()=>{
 const {browser,page}=await require('./browser.cjs')();const base=new URL(page.url()).origin;const demoLogin=await page.evaluate(async()=>{const j=await(await fetch('/api/current-user')).json();return j.user.username;});assert.ok(demoLogin);const report=fs.existsSync(path.join(out,'capture-partial.json'))?JSON.parse(fs.readFileSync(path.join(out,'capture-partial.json'),'utf8')):{screens:[],modalKeyboard:[],login:[],errors:[]};
 page.on('pageerror',e=>report.errors.push(e.message));await page.setViewportSize({width:1440,height:900});await page.emulateMedia({reducedMotion:'reduce'});
 const shot=async(p,name)=>{if(report.screens.some(r=>r.name===name))return;await p.evaluate(()=>document.fonts.ready);await p.mouse.move(0,0);await p.screenshot({path:path.join(out,name+'.png')});report.screens.push({name,...await p.evaluate(geometry),contrast:await p.evaluate(contrast)});fs.writeFileSync(path.join(out,'capture-partial.json'),JSON.stringify(report,null,2));};
 const closeFeedback=async()=>{for(let i=0;i<5;i++){const b=page.locator('.uiFeedback.isIn:not(.isLeaving) [data-ui-feedback-close]:visible').first();if(!await b.count())break;await b.click({timeout:800}).catch(async e=>{if(await b.count())throw e;});}};
 for(const theme of ['light','grey','dark']){
  await page.evaluate(t=>{applyTheme(t);applyUiFontStep(0);},theme);await page.reload({waitUntil:'domcontentloaded'});
  await page.getByText("Buyer Log'a devam et",{exact:false}).waitFor();
  const pause=page.locator('[data-trivia-pause]');if(await pause.count()&&await pause.getAttribute('aria-pressed')!=='true')await pause.click();
  await shot(page,'startup-'+theme);await page.getByText("Buyer Log'a devam et",{exact:false}).click();await page.waitForFunction(()=>!document.getElementById('blBootGuard'));
  await page.locator('[data-rn-close]').first().click({timeout:1500}).catch(()=>{});await page.waitForTimeout(300);await closeFeedback();
  for(const tab of ['overview','cp']){await page.locator('nav.tabs button[data-tab="'+tab+'"]').click();await page.waitForTimeout(450);await closeFeedback();await shot(page,tab+'-'+theme);}
  await page.evaluate(()=>{window.__pilotFocus=document.activeElement;openNotesEditor(state.cp.rows[0]._id,'Notes');});await page.locator('.noteEditorArea').fill('Anonim pilot notu / Anonymous pilot note');await shot(page,'notes-'+theme);
  await page.locator('.notesEditorSave').focus();await page.keyboard.press('Tab');assert.ok(await page.locator('.notesEditorClose').evaluate(e=>e===document.activeElement));
  await page.keyboard.press('Shift+Tab');assert.ok(await page.locator('.notesEditorSave').evaluate(e=>e===document.activeElement));
  await page.keyboard.press('Escape');assert.equal(await page.locator('#_notesEditorModal').count(),0);assert.ok(await page.evaluate(()=>document.activeElement===window.__pilotFocus));if(!report.modalKeyboard.some(r=>r.theme===theme))report.modalKeyboard.push({theme,forward:true,backward:true,escape:true,restoredFocus:true,noSave:true});
  const context=await browser.newContext({viewport:{width:1440,height:900},reducedMotion:'reduce'});await context.addInitScript(t=>localStorage.setItem('buyerlog.ui.appearance',JSON.stringify({theme:t,step:0})),theme);
  const login=await context.newPage();await login.goto(base+'/select-user.html');await login.locator('#loginTitle').click();await shot(login,'login-'+theme);
  if(theme==='light'&&!report.screens.some(r=>r.name==='login-error-light')){
   await login.locator('#username').fill(demoLogin.slice(0,3));await login.locator('.suggestion').first().waitFor();await login.keyboard.press('ArrowDown');await login.keyboard.press('Enter');
   await login.locator('#password').fill('synthetic-invalid-password');await login.locator('#loginBtn').click();await login.locator('#error').waitFor({state:'visible'});await shot(login,'login-error-light');
   report.login.push({autocomplete:true,keyboardSelection:true,wrongPasswordInlineError:true});
  }
  await context.close();
 }
 await page.evaluate(()=>{applyTheme('light');applyUiFontStep(0);});
 // Representative consumers of the temporary alias bridge, not the final visual matrix.
 for(const tab of ['orders','koleksiyon','source']){
  const button=page.locator('nav.tabs button[data-tab="'+tab+'"]');if(!await button.count()){report.screens.push({name:'legacy-'+tab,unavailable:true});continue;}
  await button.click();await page.waitForTimeout(500);const hold=page.locator('[data-hold-continue]:visible').first();if(await hold.count())await hold.click();await closeFeedback();await shot(page,'legacy-'+tab+'-light');
 }
 fs.writeFileSync(path.join(out,'capture.json'),JSON.stringify(report,null,2)+'\n');
 console.log({screens:report.screens.length,issues:report.screens.filter(s=>s.issues?.length||s.contrast?.failures.length||s.overflow).map(s=>({name:s.name,issues:s.issues,contrast:s.contrast.failures,overflow:s.overflow})),errors:report.errors});await browser.close();
})().catch(e=>{console.error(e.stack);process.exit(1);});
