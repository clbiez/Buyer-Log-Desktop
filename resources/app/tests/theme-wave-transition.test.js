'use strict';
// 7.0.319: two themes (Light/Dark). Animated switching is a user requirement and is
// owned by Motion+ (BLMotionPlus.theme). When motion is unavailable the immediate,
// lossless fast path is used. Grey requests resolve to Light.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const read=f=>fs.readFileSync(path.join(__dirname,'../public',f),'utf8');
const source=read('app-main.js'),fn=source.slice(source.indexOf('function applyTheme(name,options)'),source.indexOf('// Ray düğmesinin ipucu'));
function setup({motion=null}={}){
  const writes=[],desktop=[],icons=[],releases=[],morphs=[],root={dataset:{theme:'light',fontStep:'2'},style:{}};
  const BLMotionPlus=motion==null?undefined:{theme:(update,origin)=>{morphs.push(origin);if(!motion)return false;update();return true;}};
  const ctx={THEMES:{light:{icon:'light'},dark:{icon:'dark'}},systemTheme:()=> 'dark',_themeRequested:null,_themeSwitchRelease:null,
    document:{documentElement:root,querySelector:()=>({setAttribute:(k,v)=>icons.push(v)})},localStorage:{setItem:(k,v)=>writes.push([k,v])},
    BLStorage:{setItem:(k,v)=>writes.push([k,v])},window:{buyerLogDesktop:{workspace:{setTheme:v=>desktop.push(v)}},BLMotionPlus},
    syncThemeButtonTitle(){},beginFastThemeSwitch:()=>immediate=>releases.push(immediate)};
  vm.createContext(ctx);vm.runInContext(fn,ctx);return {ctx,root,writes,desktop,icons,releases,morphs};
}
test('without Motion+ both themes update immediately, persist appearance and notify desktop once',()=>{
  const s=setup();
  for(const theme of ['dark','light']){s.ctx.applyTheme(theme,{animate:true});assert.equal(s.root.dataset.theme,theme);assert.equal(s.root.style.colorScheme,theme==='dark'?'dark':'light');}
  assert.deepEqual(s.desktop,['dark','light']);assert.deepEqual(s.releases,[false,false]);
  const persisted=s.writes.filter(([k])=>k==='buyerlog.ui.appearance').map(([,v])=>JSON.parse(v));
  assert.deepEqual(persisted,[{theme:'dark',step:2},{theme:'light',step:2}]);
});
test('animated requests go through Motion+ with the click origin and skip the curtain',()=>{
  const s=setup({motion:true});
  s.ctx.applyTheme('dark',{animate:true,origin:{x:30,y:900}});
  assert.equal(s.root.dataset.theme,'dark');assert.deepEqual(s.morphs,[{x:30,y:900}]);assert.deepEqual(s.releases,[]);
});
test('Motion+ declining (reduced motion / software rendering) falls back to the fast path',()=>{
  const s=setup({motion:false});
  s.ctx.applyTheme('dark',{animate:true});
  assert.equal(s.root.dataset.theme,'dark');assert.equal(s.morphs.length,1);assert.deepEqual(s.releases,[false]);
});
test('non-animated calls (startup, sync) never start a transition',()=>{
  const s=setup({motion:true});s.ctx.applyTheme('dark');assert.equal(s.morphs.length,0);assert.equal(s.root.dataset.theme,'dark');
});
test('grey (removed) resolves to Light; rapid requests settle to the latest; invalid names use the system theme',()=>{
  const s=setup();s.ctx.applyTheme('dark');s.ctx.applyTheme('grey');assert.equal(s.root.dataset.theme,'light');
  for(const key of ['dark','grey','unknown'])s.ctx.applyTheme(key);
  assert.equal(s.root.dataset.theme,'dark');assert.equal(s.ctx._themeRequested,'dark');
});
test('same theme preserves the DOM and does not start a transition',()=>{
  const s=setup({motion:true});s.ctx.applyTheme('light',{animate:true});assert.equal(s.releases.length,0);assert.equal(s.morphs.length,0);
  assert.doesNotMatch(fn,/innerHTML|replaceChildren|startViewTransition/);
  assert.equal(fs.existsSync(path.join(__dirname,'../public/theme-transition.js')),false,'no module-specific theme engine');
});
test('Motion+ theme transition is gated, finite and token driven',()=>{
  const motion=read('motion-plus.js'),css=read('ui-motion.css'),tokens=read('ui-tokens.css');
  const body=motion.slice(motion.indexOf('function theme(update,origin)'),motion.indexOf('function setEnabled('));
  assert.match(body,/typeof doc\.startViewTransition!=='function'\|\|!enabled\(\)\|\|html\.dataset\.blRender==='software'/);
  assert.match(body,/skipTransition/);assert.match(body,/duration\('theme'\)/);assert.doesNotMatch(body,/Infinity|setInterval/);
  assert.match(motion,/BLMotionPlus=Object\.freeze\(\{[^}]*\btheme\b/);
  assert.match(tokens,/--ui-motion-theme:\d+ms/);
  assert.match(css,/prefers-reduced-motion:reduce\)\{:root\.blThemeMorph::view-transition/);
});
test('the theme cycle only contains Light and Dark; the rail label shows the active theme',()=>{
  assert.match(source,/const THEME_CYCLE = \['light','dark'\];/);
  assert.doesNotMatch(source.slice(source.indexOf('const THEMES = '),source.indexOf('const THEMES = ')+300),/grey/);
  assert.match(read('index.html'),/<span id="railThemeLabel" data-no-i18n>/);
});
