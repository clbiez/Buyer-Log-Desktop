'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const APP=fs.readFileSync(path.join(__dirname,'..','public','app-main.js'),'utf8');
const HTML=fs.readFileSync(path.join(__dirname,'..','public','index.html'),'utf8');
const CSS=fs.readFileSync(path.join(__dirname,'..','public','app.css'),'utf8');
const DB=fs.readFileSync(path.join(__dirname,'..','server','db.js'),'utf8');
const SERVER=fs.readFileSync(path.join(__dirname,'..','server','server.js'),'utf8');
function between(source,start,end){const a=source.indexOf(start),b=source.indexOf(end,a+start.length);assert.ok(a>=0,start+' missing');assert.ok(b>a,end+' missing');return source.slice(a,b);}
function fn(name){const start=APP.indexOf(`function ${name}(`);assert.ok(start>=0,`${name} missing`);const next=APP.indexOf('\nfunction ',start+10);return next>start?APP.slice(start,next):APP.slice(start);}
function calcWithDefaults(defaults,row){
  const parse=v=>{if(v==null||v==='')return NaN;const n=Number(String(v).replace(',','.').replace('%',''));return Number.isFinite(n)?n:NaN;};
  const confirmed=r=>null;
  const best=r=>{const p=parse(r.price);return Number.isFinite(p)&&p>0?{price:p,source:'best',name:'A'}:null;};
  const src=[fn('kolSuppFob'),fn('kolLandedIsNonDtr'),fn('kolLandedPriceWithCosts'),fn('kolLandedCalc')].join('\n')+'\nreturn kolLandedCalc(row);';
  return new Function('row','kolParseMoneyNum','kolConfirmedPricing','kolBestPricing','kolAutoFx','turknorm','KOL_TR_LANDED_MULT','KOL_YD_LANDED_MULT','kolDefaultLandedMultipliers','kolLicenseRuleMissing',src)(row,parse,confirmed,best,()=>40,v=>String(v||'').trim().toUpperCase(),1.05,1.11,()=>defaults,()=>false);
}

test('v5.49 Source Ayarları içinde Landed Çarpanları bulunur ve ortak kaydetme API kullanılır',()=>{
  /* v7.81: "Kaynak Veri" ayarlar menüsü kaldırıldı; bu iş Veri Yönetimi
     ekranındaki Araçlar bölümünde ve artık ne yaptığını da yazıyor. */
  const DM_UI = fs.readFileSync(path.join(__dirname, '..', 'public', 'data-management.js'), 'utf8');
  assert.match(DM_UI, /id: 'landed'/);
  assert.match(DM_UI, /openLandedMultipliersModal\(\)/);
  assert.match(APP,/function openLandedMultipliersModal\(/);
  assert.match(APP,/fetch\('\/api\/landed-multipliers',\{method:'PUT'/);
  assert.match(SERVER,/app\.put\('\/api\/landed-multipliers', userAccess\.requireArea\('source'\), userAccess\.requirePermission\('manageBusinessRules'\)/);
});

test('v5.49 boş satır çarpanı Source varsayılanını kullanır',()=>{
  const k=calcWithDefaults({tr:1.2,overseas:1.3},{trPrice:'400',trFx:'40',trLandedMult:'',ydLandedMult:'',price:'10'});
  assert.equal(k.trMult,1.2);assert.equal(k.ydMult,1.3);
  assert.equal(Number(k.trLanded.toFixed(2)),12);assert.equal(Number(k.ydLanded.toFixed(2)),13);
  assert.equal(k.trMultIsManual,false);assert.equal(k.ydMultIsManual,false);
});

test('v5.49 model içindeki manuel çarpan ortak varsayılanı ezer',()=>{
  const k=calcWithDefaults({tr:1.2,overseas:1.3},{trPrice:'400',trFx:'40',trLandedMult:'1,5',ydLandedMult:'1,6',price:'10'});
  assert.equal(k.trMult,1.5);assert.equal(k.ydMult,1.6);
  assert.equal(Number(k.trLanded.toFixed(2)),15);assert.equal(Number(k.ydLanded.toFixed(2)),16);
  assert.equal(k.trMultIsManual,true);assert.equal(k.ydMultIsManual,true);
});

test('v5.49 server store Landed çarpanlarını revision ile kalıcı tutar',()=>{
  assert.match(DB,/landedMultipliers:\s*\{\s*tr:\s*1\.05,\s*overseas:\s*1\.11\s*\}/);
  assert.match(DB,/function replaceLandedMultipliers\(/);
  assert.match(DB,/ov\._revisions\.landedMultipliers = current \+ 1/);
  assert.match(SERVER,/landedMultipliers: overrides\.landedMultipliers \|\| \{ tr: 1\.05, overseas: 1\.11 \}/);
  assert.match(SERVER,/landedMultipliers: Number\(overrides\._revisions&&overrides\._revisions\.landedMultipliers\)\|\|0/);
});

test('v5.51 Landed hücreleri kompakt tek satır düzeninde gereksiz rozetleri kaldırır',()=>{
  const landed=between(CSS,'.kolLandedCard{','.kolLandedTd:hover');
  for(const token of ['min-height:38px','border:1px solid var(--line)','border-radius:9px','background:var(--card2)','display:flex','padding:5px 7px']){
    assert.ok(landed.includes(token),`Landed ${token}`);
  }
  assert.match(APP,/class="kolLandedMeta"/);
  assert.doesNotMatch(APP,/class="kolLandedMiniMult/);
  assert.match(APP,/class="kolProfit/);
  assert.doesNotMatch(APP,/class="kolLandedBadge/);
});
