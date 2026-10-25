'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const PUBLIC=path.join(__dirname,'../public');
const OVERVIEW=fs.readFileSync(path.join(PUBLIC,'backlog-overview.js'),'utf8');
const KPI=fs.readFileSync(path.join(PUBLIC,'kpi-motion.js'),'utf8');

function ringRenderer(){
  const start=OVERVIEW.indexOf('function ring(value){');
  const end=OVERVIEW.indexOf('function hero(s){',start);
  assert.ok(start>=0&&end>start);
  return new Function('esc','L',OVERVIEW.slice(start,end)+';return ring;')(s=>s,(tr,en)=>tr);
}
function motionHarness({reduced=false,visible=true}={}){
  const start=OVERVIEW.indexOf('let motionFrame=0;');
  const end=OVERVIEW.indexOf('/* --------------------------------------------------------- tooltip/panel */',start);
  assert.ok(start>=0&&end>start);
  const queue=[],arc={attrs:{},setAttribute(k,v){this.attrs[k]=v;}};
  const gauge={dataset:{blvProgress:'.218000'},querySelector:()=>arc};
  const element=()=>({style:{removeProperty(key){delete this[key];}}});
  const tile=element(),bar=element(),chart=element();
  const host={isConnected:true,querySelector:key=>key==='.blvProgressRing'?gauge:null,
    querySelectorAll:key=>key==='.blvTile'?[tile]:key==='.bpaGroups .bpaBar'?[bar]:[chart]};
  const state={open:true};
  const replay=new Function('window','visible','state','performance','requestAnimationFrame','cancelAnimationFrame',
    OVERVIEW.slice(start,end)+';return replayOverviewMotion;')(
      {matchMedia:()=>({matches:reduced})},()=>visible,state,{now:()=>0},
      cb=>(queue.push(cb),queue.length),()=>{}
    );
  return {replay,host,gauge,arc,tile,bar,chart,queue,state};
}

test('7.0.294 Backlog circular completion chart returns with exact 0..100% geometry',()=>{
  assert.doesNotThrow(()=>new Function(OVERVIEW));
  const render=ringRenderer();
  for(const value of [0,.218,1,1.5,-.5]){
    const html=render(value),match=html.match(/stroke-dasharray="([\d.]+) ([\d.]+)"/);
    assert.ok(match,'visible SVG arc required');
    const expected=Math.max(0,Math.min(1,value));
    assert.ok(Math.abs(Number(match[1])/Number(match[2])-expected)<.0002);
    assert.equal((html.match(/<circle\b/g)||[]).length,2);
    assert.match(html,/class="bpaRingTrack"/);
    assert.match(html,/class="bpaRingValue"/);
  }
});
test('Backlog charts and KPI tiles animate once and settle on unmodified final data',()=>{
  const h=motionHarness();h.replay(h.host);assert.equal(h.queue.length,1);
  h.queue.shift()(0);
  assert.equal(h.tile.style.opacity,'0.000');
  assert.equal(h.arc.attrs['stroke-dasharray'],'0.00 263.89');
  h.queue.shift()(320);
  assert.ok(Number(h.arc.attrs['stroke-dasharray'].split(' ')[0])>0);
  assert.ok(h.bar.style.transform.startsWith('scaleX('));
  assert.ok(h.chart.style.transform.startsWith('scaleY('));
  h.queue.shift()(550);
  for(const el of [h.tile,h.bar,h.chart]){
    assert.equal(el.style.transform,undefined);
    assert.equal(el.style.opacity,undefined);
  }
  assert.equal(h.arc.attrs['stroke-dasharray'],'57.53 263.89');
  assert.match(OVERVIEW,/window\.BLKpiMotion\?\.run\(host\)/);
  assert.match(KPI,/const view=scope&&typeof scope\.querySelectorAll==='function'\?scope:/);
});
test('reduced motion, hidden Backlog and closed panels do not schedule decoration',()=>{
  for(const settings of [{reduced:true},{visible:false}]){
    const h=motionHarness(settings);
    h.replay(h.host);assert.equal(h.queue.length,0);
  }
  const h=motionHarness();h.state.open=false;
  h.replay(h.host);h.queue.shift()(0);
  assert.equal(h.queue.length,0);
  assert.match(KPI,/if\(reduced\(\)\)return;/);
});
