'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ROOT=path.join(__dirname,'..');
const UI=fs.readFileSync(path.join(ROOT,'public','automations.js'),'utf8');
const SERVER=fs.readFileSync(path.join(ROOT,'server','server.js'),'utf8');
const store=require('../server/lib/automation-recipe-store');
const mail=require('../server/lib/automation-email');

test('v5.57 new automation starts by asking the job purpose and supports five no-code job types',()=>{
  assert.match(UI,/Bu otomasyonun temel işi nedir\?/);
  for(const value of ['browser','email','analysis','app','mixed']) assert.match(UI,new RegExp(`${value}:\\{`));
  assert.match(UI,/E-posta \/ periyodik rapor/);
  assert.match(UI,/Buyer Log içi işlem/);
});

test('v5.57 recorded browser values bind through field dropdowns instead of requiring template syntax',()=>{
  assert.match(UI,/Buyer Log alanından al/);
  assert.match(UI,/data-step-field/);
  assert.match(SERVER,/step\.binding\.mode==='field'/);
  assert.match(SERVER,/`\{\{item\.\$\{step\.binding\.field\}\}\}`/);
});

test('v5.57 recipe schema persists email, schedule, analysis, app actions and safe 200-row limit',()=>{
  const r=store.normalizeRecipe({purpose:'email',source:'orders',limit:999,email:{subject:'Weekly',deliveryMode:'draft'},schedule:{enabled:true,mode:'weekly',weekdays:[1,3],time:'09:30'},analysis:{groupBy:'Buyer',operation:'count'},appActions:[{action:'open_page',page:'orders'}]},'u1');
  assert.equal(r.purpose,'email');assert.equal(r.limit,200);assert.equal(r.email.subject,'Weekly');assert.equal(r.schedule.mode,'weekly');assert.deepEqual(r.schedule.weekdays,[1,3]);assert.equal(r.analysis.groupBy,'Buyer');assert.equal(r.appActions[0].action,'open_page');
});

test('v5.57 email groups are validated and generic reports can be built without external services',()=>{
  const g=store.normalizeEmailGroup({name:'Team',to:['a@example.com','bad','A@example.com'],cc:'b@example.com'});
  assert.deepEqual(g.to,['a@example.com']);assert.deepEqual(g.cc,['b@example.com']);
  const html=mail.tableHtml([{Order:'100',Status:'OK'}],['Order','Status']);
  assert.match(html,/100/);assert.match(html,/Status/);
  assert.match(SERVER,/\/api\/automations\/email-groups/);
  assert.match(fs.readFileSync(path.join(ROOT,'server/lib/automation-execution-service.js'),'utf8'),/automationEmail\.createDraft/);
});

test('v5.57 ordinary schedules remain email-only after retirement of agent grants',()=>{
  const schedule=require('../server/lib/automation-schedule-service'),now=new Date(2026,9,11,9,30),recipe={enabled:true,purpose:'analysis',schedule:{enabled:true,mode:'daily',time:'09:00'}};
  assert.equal(schedule.automationScheduleKey(recipe,now),'');
  assert.equal(schedule.automationScheduleKey(recipe,now,{scope:'analysis-or-owner-draft'}),'');
  assert.equal(schedule.automationScheduleKey({...recipe,purpose:'mixed',steps:[{action:'script'}]},now,{}),'');
  assert.equal(schedule.automationScheduleKey({...recipe,appActions:[{action:'refresh_source'}]},now,{}),'');
  assert.match(SERVER,/automationScheduleService\.automationScheduleKey/);
  assert.match(SERVER,/setInterval\(\(\)=>runScheduledAutomations/);
  assert.match(UI,/Planlı çalışma yalnız E-posta otomasyonlarında/);
});
