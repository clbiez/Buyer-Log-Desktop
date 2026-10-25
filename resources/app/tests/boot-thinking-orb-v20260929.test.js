'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const orb=require('./fixtures/retired-ui/thinking-orb-breathing.js');
const ROOT=path.join(__dirname,'..');
const INDEX=fs.readFileSync(path.join(ROOT,'public','index.html'),'utf8');
const EXP=fs.readFileSync(path.join(ROOT,'public','experience.css'),'utf8');
const ORB_SRC=fs.readFileSync(path.join(ROOT,'tests','fixtures','retired-ui','thinking-orb-breathing.js'),'utf8');

test('Manifest açılışı kare durum işareti ve açık Devam eylemi kullanır',()=>{
  const head=INDEX.slice(0,INDEX.indexOf('</head>'));
  const startup=fs.readFileSync(path.join(ROOT,'public','ui-startup.css'),'utf8');
  assert.match(head,/id="blBootGuardStyle"[^>]+href="ui-startup\.css/);
  assert.match(head,/<span class="blBootOrb" aria-hidden="true"><\/span>/);
  assert.doesNotMatch(head,/BLThinkingOrbBreathing\.attach/);
  assert.match(startup,/#blBootGuard\[data-ready="1"\] \.blBootOrb/);
  assert.match(startup,/background:var\(--ui-accent\)/);
  assert.match(startup,/prefers-reduced-motion:reduce/);
  assert.match(head,/function ready\(stage\)\{[\s\S]*?stopOrb\(\);var el=guard\(\);/);
  assert.match(head,/function dismiss\(\)\{[\s\S]*?var el=guard\(\);[\s\S]*?el\.dataset\.leaving='1';[\s\S]*?el\.remove\(\)/);
});

test('breathing orb geometrisi upstream golden vektörleriyle eşleşir',()=>{
  // thinking-orbs spec/orbs-golden.json → breathing-64-0.6 (ilk iki nokta)
  const dots=orb.frame(orb.SIZE,0.6,orb.OPTS);
  assert.equal(dots.length,484);
  const golden=[[41.791591,53.440594,-8.838984,0.467922,0.557908,0.593762],[9.532055,25.402816,-8.781179,0.46848,0.557398,0.594457]];
  golden.forEach((g,i)=>{const d=dots[i];[d.x,d.y,d.z,d.r,d.white,d.a].forEach((v,j)=>assert.ok(Math.abs(v-g[j])<1e-4,`nokta ${i} alan ${j}: ${v} ≠ ${g[j]}`));});
  for(let i=1;i<dots.length;i++)assert.ok(dots[i-1].z<=dots[i].z,'noktalar uzaktan yakına sıralı olmalı');
});


test('waiting notices use the shared square marker without eager canvas observers',()=>{
  const shared=fs.readFileSync(path.join(ROOT,'public','ui-components.css'),'utf8');
  assert.doesNotMatch(INDEX,/<script[^>]*thinking-orb-/);
  assert.match(shared,/\.blOrb \{[^}]*background:var\(--ui-accent\)[^}]*animation:none/);
  assert.match(shared,/\.blOrb\[data-state="warn"\]/);
  assert.match(shared,/\.blOrb\[data-state="done"\]/);
});

test('inline Thinking orb 20px upstream presetini kullanır',()=>{
  const p=orb.PRESETS[20];
  assert.equal(p.speed,3.78);
  assert.equal(p.opts.lanes,2);
  assert.equal(p.opts.segs,15);
  const dots=orb.frame(20,0.6,p.opts);
  assert.equal(dots.length,120);
  for(let i=1;i<dots.length;i++)assert.ok(dots[i-1].z<=dots[i].z,'20px noktaları uzaktan yakına sıralı olmalı');
});

