'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');

const root=fs.mkdtempSync(path.join(os.tmpdir(),'buyerlog-merch-calendar-'));
process.env.BUYER_LOG_SERVER_DATA_ROOT=path.join(root,'server-data');
process.env.BUYER_LOG_DATA_ROOT=path.join(root,'app-data');
process.env.BUYER_LOG_LOCAL_DATA_ROOT=path.join(root,'local-data');
process.env.BUYER_LOG_CONFIG_PATH=path.join(root,'config.json');

const store=require('../server/lib/merch-calendar-store');
const dateDimension=require('../public/date-dimension');
const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');

test.after(()=>fs.rmSync(root,{recursive:true,force:true}));

function dayCells(days){
  return days.map(day=>`<td><span class="noselect">${day}</span></td>`).join('');
}
function row(week,days,month=''){
  return `<tr class="nopadding noselect">${month?`<th id="${month}" rowspan="2">${month}</th>`:''}<td class="week-cell">${week}</td>${dayCells(days)}</tr>`;
}
function html(rows){
  return `<!doctype html><html><body><app-lcw-calendar id="app-lcw-calendar-2026"><table><tbody>${rows.join('')}</tbody></table></app-lcw-calendar></body></html>`;
}

test('HTML olarak export edilmiş .xls Merch Calendar hafta satırlarına dönüştürülür',()=>{
  const source=html([
    row(1,[29,30,31,1,2,3,4],'January'),
    row(2,[5,6,7,8,9,10,11]),
  ]);
  const parsed=store.parseBuffer(Buffer.from(source),'MerchCalendar.xls');
  assert.equal(parsed.weeks.length,2);
  assert.deepEqual(parsed.weeks[0],{
    year:2026,week:1,month:1,monthWeek:1,start:'2025-12-29',end:'2026-01-04',
  });
  assert.deepEqual(parsed.weeks[1],{
    year:2026,week:2,month:1,monthWeek:2,start:'2026-01-05',end:'2026-01-11',
  });
  assert.equal(parsed.meta.yearFrom,2026);
  assert.equal(parsed.meta.yearTo,2026);
  assert.equal(parsed.sourceName,'MerchCalendar.xls');
});

test('LCW 53. hafta kabul edilir ve tarih motorunda iş haftası olarak çözülür',()=>{
  const source=html([row(53,[28,29,30,31,1,2,3],'December')]);
  const parsed=store.parseBuffer(Buffer.from(source),'week53.xls');
  assert.equal(parsed.weeks[0].week,53);
  assert.equal(parsed.weeks[0].start,'2026-12-28');
  assert.equal(parsed.weeks[0].end,'2027-01-03');
  assert.equal(dateDimension.setMerchCalendar(parsed),true);
  assert.equal(dateDimension.describe('2027-01-01').lcwWeek,53);
  dateDimension.clearMerchCalendar();
});

test('53 üzerindeki LCW hafta numaraları reddedilir',()=>{
  const source=html([row(54,[4,5,6,7,8,9,10],'December')]);
  assert.throws(()=>store.parseBuffer(Buffer.from(source),'bad.xls'),error=>{
    assert.equal(error.code,'MERCH_WEEK_OUT_OF_RANGE');
    assert.match(error.message,/1–53/);
    return true;
  });
});

test('yükleme kaydı kalıcı olur ve merkezi tarih motorunu aynı anda günceller',()=>{
  const source=html([
    row(1,[29,30,31,1,2,3,4],'January'),
    row(2,[5,6,7,8,9,10,11]),
  ]);
  const saved=store.save(Buffer.from(source),'calendar.xls');
  assert.ok(fs.existsSync(store.FILE));
  assert.equal(store.publicProjection(saved).configured,true);
  const period=dateDimension.describe('2026-01-05');
  assert.equal(period.businessValid,true);
  assert.equal(period.lcwWeek,2);
  store.remove();
  assert.equal(store.publicProjection().configured,false);
});

test('Veri Yönetimi Merch Calendar upload/değiştir/kaldır akışını taşır ve köşeler kare kalır',()=>{
  const ui=read('public/data-management.js');
  const css=read('public/data-management.css');
  const picker=read('public/dual-week-datepicker.js');
  const pickerCss=read('public/dual-week-datepicker.css');
  const server=read('server/server.js');
  assert.match(ui,/Merch Calendar Yükle/);
  assert.match(ui,/data-merch-file/);
  assert.match(ui,/data-merch-delete/);
  assert.match(ui,/LCW \/ GLB/);
  assert.match(ui,/id: 'merch', icon: 'i-calculator', inline: true/);
  assert.match(ui,/openTool === 'merch'/);
  assert.doesNotMatch(ui,/dmSectionLabel[^\n]*İş takvimi/);
  assert.match(css,/\.dmMerchPanel[^{]*\{[^}]*border-radius:0!important/);
  assert.match(picker,/LCW \/ GLB/);
  assert.match(picker,/weekPair/);
  assert.match(pickerCss,/border-radius:0!important/);
  assert.match(server,/routes\/merch-calendar-routes/);
});

test('Merch Calendar API yazmaları Veri Yönetimi yetkisi ister',()=>{
  const route=read('server/routes/merch-calendar-routes.js');
  assert.match(route,/userAccess\.requireArea\('source'\)/);
  assert.match(route,/userAccess\.requirePermission\('manageModelConnections'\)/);
  assert.match(route,/MERCH_CALENDAR_UPLOAD/);
  assert.match(route,/MERCH_CALENDAR_DELETE/);
});
