'use strict';
// Refresh only screenshot evidence. Dismiss transient messages through their
// real close buttons; do not hide or modify the rendered application for capture.
const fs=require('node:fs'),path=require('node:path');
(async()=>{
 const {browser,page}=await require('./browser.cjs')(),out=path.resolve(process.argv[2]);
 await page.reload({waitUntil:'domcontentloaded'});
 await page.getByText("Buyer Log'a devam et",{exact:false}).click();
 await page.waitForFunction(()=>!document.getElementById('blBootGuard'));
 await page.locator('[data-rn-close]').first().click({timeout:3000}).catch(()=>{});
 await page.emulateMedia({reducedMotion:'reduce'});
 const captures=[];
 for(const name of fs.readdirSync(out).filter(n=>/^(overview|cp)-(?!fields|focus).*\.png$/.test(n)&&(!process.argv[3]||n.startsWith(process.argv[3]+'-')))){
  const tab=name.startsWith('overview')?'overview':'cp',theme=name.includes('grey')?'grey':name.includes('dark')?'dark':'light',width=name.includes('1280')?1280:1440,step=name.includes('compact')?3:name.includes('large')?1:name.includes('xl')?2:0,en=name.includes('-en-');
  await page.setViewportSize({width,height:width===1280?720:900});
  await page.evaluate(({theme,step})=>{applyTheme(theme);applyUiFontStep(step);},{theme,step});
  if(en!==(await page.evaluate(()=>appLang==='en')))await page.locator('#railLangBtn').click();
  await page.locator('nav.tabs button[data-tab="'+tab+'"]').click();
  await page.locator('[data-hold-continue]').click({timeout:300}).catch(()=>{});
  await page.evaluate(()=>document.fonts.ready);
  await page.waitForTimeout(200);
  let dismissed=0;
  while(await page.locator('[data-ui-feedback-close]:visible').count()){
   await page.locator('[data-ui-feedback-close]:visible').first().click();
   await page.waitForTimeout(200);dismissed++;
   if(dismissed>6)throw Error('Repeated transient feedback');
  }
  await page.mouse.move(1,1);
  await page.screenshot({path:path.join(out,name)});
  captures.push({file:name,tab,theme,width,step,dismissed});
 }
 if(await page.evaluate(()=>appLang==='en'))await page.locator('#railLangBtn').click();
 await page.setViewportSize({width:1440,height:900});
 await page.evaluate(()=>{applyTheme('light');applyUiFontStep(0);});
 const file=path.join(out,'final-captures.json'),prior=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')).captures:[];
 fs.writeFileSync(file,JSON.stringify({method:'Real Chromium screenshots after dismissing transient import feedback with its normal close control. No image editing or DOM hiding.',captures:[...prior.filter(p=>!captures.some(c=>c.file===p.file)),...captures]},null,2)+'\n');
 await browser.close();console.log({out,captures:captures.length});
})().catch(e=>{console.error(e.message);process.exit(1);});
