'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const orb=require('../public/thinking-orb-breathing.js');
const ROOT=path.join(__dirname,'..');
const INDEX=fs.readFileSync(path.join(ROOT,'public','index.html'),'utf8');

test('Açılış perdesi thinking-orbs "breathing" (Thinking…) orb kullanır',()=>{
  const head=INDEX.slice(0,INDEX.indexOf('</head>'));
  const orbAt=head.indexOf('thinking-orb-breathing.js'),guardAt=head.indexOf('<style id="blBootGuardStyle">');
  assert.ok(orbAt>0&&orbAt<guardAt,'orb betiği açılış perdesinden önce yüklenmeli');
  assert.match(head,/<canvas class="blBootOrb" width="64" height="64" aria-hidden="true"><\/canvas>/);
  assert.match(head,/BLThinkingOrbBreathing\.attach\(el\.querySelector\('\.blBootOrb'\)\)/);
  assert.match(head,/#blBootGuard\[data-failed="1"\] \.blBootOrb\{display:none\}/);
  assert.doesNotMatch(INDEX,/blBootDot/);
  assert.match(head,/function ready\(\)\{[\s\S]*?stopOrb\(\);var el=guard\(\);if\(el\)el\.remove\(\);/);
});

test('breathing orb geometrisi upstream golden vektörleriyle eşleşir',()=>{
  // thinking-orbs spec/orbs-golden.json → breathing-64-0.6 (ilk iki nokta)
  const dots=orb.frame(orb.SIZE,0.6,orb.OPTS);
  assert.equal(dots.length,484);
  const golden=[[41.791591,53.440594,-8.838984,0.467922,0.557908,0.593762],[9.532055,25.402816,-8.781179,0.46848,0.557398,0.594457]];
  golden.forEach((g,i)=>{const d=dots[i];[d.x,d.y,d.z,d.r,d.white,d.a].forEach((v,j)=>assert.ok(Math.abs(v-g[j])<1e-4,`nokta ${i} alan ${j}: ${v} ≠ ${g[j]}`));});
  for(let i=1;i<dots.length;i++)assert.ok(dots[i-1].z<=dots[i].z,'noktalar uzaktan yakına sıralı olmalı');
});
