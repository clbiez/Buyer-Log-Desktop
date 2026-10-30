'use strict';
// Selectable theme transitions: settings defaults/normalisation, capture-based
// effects only with the desktop bridge, latest request wins, failures fall back
// to an immediate update, and the capture IPC stays narrow.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const read=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');
const SOURCE=read('public/motion-plus-theme.js');

function fakeContext(){return new Proxy({},{get:(t,k)=>k==='createImageData'?(w,h)=>({data:new Uint8ClampedArray(w*h*4)}):(t[k]??(()=>{})),set:(t,k,v)=>{t[k]=v;return true;}});}
function setup({stored,desktop}={}){
  const storage=new Map(stored?[['lcw.themeTransition.v1',JSON.stringify(stored)]]:[]),body=[],frames=[];
  const el=tag=>({tag,className:'',width:0,height:0,style:{},children:[],setAttribute(){},getContext:()=>fakeContext(),remove(){const i=body.indexOf(this);if(i>=0)body.splice(i,1);},addEventListener(){},replaceChildren(...c){this.children=c;}});
  const html={lang:'tr',dataset:{},style:{setProperty(){},removeProperty(){}},classList:{add(){},remove(){}}};
  const document={documentElement:html,readyState:'complete',body:{appendChild:n=>body.push(n)},createElement:el,getElementById:()=>null,addEventListener(){},elementFromPoint:()=>null};
  const window={document,innerWidth:8,innerHeight:4,localStorage:{getItem:k=>storage.has(k)?storage.get(k):null,setItem:(k,v)=>storage.set(k,v)},
    getComputedStyle:()=>({getPropertyValue:()=>'#dde',backgroundColor:'rgb(1, 2, 3)',color:'rgb(4, 5, 6)'}),
    requestAnimationFrame:cb=>{frames.push(cb);return frames.length;},cancelAnimationFrame(){},buyerLogDesktop:desktop};
  const ctx={window,ImageData:function(data,w,h){this.data=data;this.width=w;this.height=h;},performance:{now:()=>0},Promise,Math,Object,Number,String,JSON,Uint8ClampedArray,Uint32Array,Float32Array};
  vm.createContext(ctx);vm.runInContext(SOURCE,ctx);
  return{api:window.BLMotionPlusTheme,storage,body,frames,window};
}
const shot=(w,h)=>({width:w,height:h,bgra:new Uint8Array(w*h*4)});
const settle=()=>new Promise(r=>setImmediate(r));

test('defaults: triangles folding in sequence, fastest speed, medium triangle size',()=>{
  const {api}=setup();
  assert.deepEqual({...api.settings()},{effect:'chain',speed:5,size:70});
  assert.equal(api.SPEEDS[api.settings().speed-1],Math.min(...api.SPEEDS));
  assert.equal(api.EFFECTS[0].id,'chain');
  assert.deepEqual(Array.from(api.EFFECTS,e=>e.id),['chain','fold','spin','blow','wind','mask','circle']);
  for(const e of api.EFFECTS)assert.ok(e.tr&&e.en&&e.tr!==e.en,e.id+' needs TR and EN labels');
});
test('invalid stored values are normalised; saving merges and persists',()=>{
  const {api,storage}=setup({stored:{effect:'nope',speed:9,size:13}});
  assert.deepEqual({...api.settings()},{effect:'chain',speed:5,size:70});
  api.save({effect:'blow'});api.save({speed:2,size:94});
  assert.deepEqual(JSON.parse(storage.get('lcw.themeTransition.v1')),{effect:'blow',speed:2,size:90});
});
test('circle and capture effects without the desktop bridge leave the transition to Motion+',()=>{
  let updates=0;const update=()=>updates++;
  assert.equal(setup({stored:{effect:'circle'}}).api.run(update),false);
  for(const effect of ['chain','fold','spin','blow','wind'])assert.equal(setup({stored:{effect}}).api.run(update),false,effect);
  assert.equal(updates,0);
});
test('capture effect: old frame covers the screen, theme updates underneath, layer is removed when done',async()=>{
  const calls=[];let updates=0;
  const s=setup({stored:{effect:'chain',size:40},desktop:{captureView:async(w,h)=>{calls.push([w,h]);return shot(w,h);}}});
  assert.equal(s.api.run(()=>{updates++;assert.equal(s.body.length,1,'layer is on screen before the theme changes');}),true);
  assert.equal(updates,0,'update waits for the capture');
  await settle();
  assert.deepEqual(calls,[[8,4]]);assert.equal(updates,1);assert.equal(s.body[0].className,'blThemeFxLayer');
  s.api.finish();assert.equal(s.body.length,0);
});
test('failed or mismatched capture updates immediately without a layer',async()=>{
  for(const captureView of [async()=>null,async()=>shot(3,3),async()=>{throw new Error('x');}]){
    let updates=0;const s=setup({stored:{effect:'wind'},desktop:{captureView}});
    assert.equal(s.api.run(()=>updates++),true);await settle();
    assert.equal(updates,1);assert.equal(s.body.length,0);
  }
});
test('a newer request supersedes a pending capture',async()=>{
  const order=[];const s=setup({stored:{effect:'blow'},desktop:{captureView:async(w,h)=>shot(w,h)}});
  s.api.run(()=>order.push('first'));s.api.run(()=>order.push('second'));await settle();
  assert.deepEqual(order,['first','second']);assert.equal(s.body.length,1,'only the latest request animates');
});
test('Motion+ consults the selected effect after the reduced-motion/software guard and before the circle',()=>{
  const motion=read('public/motion-plus.js'),body=motion.slice(motion.indexOf('function theme(update,origin)'),motion.indexOf('function updateActivity('));
  assert.ok(body.indexOf("html.dataset.blRender==='software')return false")<body.indexOf('BLMotionPlusTheme?.run?.(update,origin)'));
  assert.ok(body.indexOf('BLMotionPlusTheme?.run?.(update,origin)')<body.indexOf('startViewTransition(update)'));
  assert.match(motion,/if\(!value\)\{cancelPending\(\);root\.BLMotionPlusTheme\?\.finish\?\.\(\);\}/);
});
test('capture IPC is narrow: trusted sender, own webContents, bounded size, bytes only to the caller',()=>{
  const main=read('electron/main.js'),h=main.slice(main.indexOf("ipcMain.handle('buyerlog:capture-view'"),main.indexOf("ipcMain.handle('buyerlog:workspace-snapshot'"));
  assert.match(h,/if \(!trustedBuyerLogIpcSender\(event\)\) return null;/);
  assert.match(h,/width <= 8192 && height <= 8192/);
  assert.match(h,/event\.sender\.capturePage\(\)/);
  assert.doesNotMatch(h,/writeFile|console\.|log\(|BrowserWindow\.getAllWindows|webContents\.getAllWebContents/);
  assert.match(read('electron/preload.js'),/captureView: \(width, height\) => ipcRenderer\.invoke\('buyerlog:capture-view', \{ width: Number\(width\) \|\| 0, height: Number\(height\) \|\| 0 \}\)/);
  assert.doesNotMatch(SOURCE,/localStorage\.setItem\([^)]*bgra|toDataURL\(\)|console\./);
});
test('Appearance menu offers effect, speed and triangle size in TR/EN with the requested defaults',()=>{
  const html=read('public/index.html'),menu=html.slice(html.indexOf('id="railAppearanceMenu"'),html.indexOf('</aside>'));
  assert.match(menu,/data-i18n-tr="Tema geçişi" data-i18n-en="Theme transition"/);
  assert.match(menu,/<select id="themeFxEffect"><\/select>/);
  assert.match(menu,/id="themeFxSpeed" min="1" max="5" step="1" value="5"/);
  assert.match(menu,/id="themeFxSize" min="40" max="100" step="10" value="70"/);
  assert.ok(html.indexOf('motion-plus-theme.js')>-1&&html.indexOf('motion-plus-theme.js')<html.indexOf('motion-plus.js?'));
  assert.match(read('public/ui-components.css'),/\.blThemeFxLayer \{position:fixed;inset:0;[^}]*pointer-events:none;z-index:var\(--ui-z-boot\)/);
});
