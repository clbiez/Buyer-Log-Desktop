const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const ROOT=path.join(__dirname,'..');
const INDEX=(fs.readFileSync(path.join(ROOT,'public', 'index.html'), 'utf8') + '\n' + fs.readFileSync(path.join(ROOT,'public', 'app-main.js'), 'utf8'));

function sliceBetween(start,end){
  const a=INDEX.indexOf(start),b=INDEX.indexOf(end,a+start.length);
  assert.ok(a>=0,`${start} bulunmalı`);
  assert.ok(b>a,`${end} bulunmalı`);
  return INDEX.slice(a,b);
}

test('Duplicate Model yeni kopyanın ticari geçmişini temizlerken kaynak modeli korur',()=>{
  const clearBlock=sliceBetween('function kolClearDuplicateCommercialHistory','function kolBuildDuplicatePlan');
  assert.match(clearBlock,/row\.pricing=\{\}/);
  assert.match(clearBlock,/row\.pricingSent=\{\}/);
  assert.match(clearBlock,/row\.confirmedManufacturer=''/);
  assert.match(clearBlock,/row\.fob=''/);
  assert.match(clearBlock,/delete row\._pricingRuleId/);
  const planBlock=sliceBetween('function kolBuildDuplicatePlan','function duplicateKolSelectedRows');
  assert.match(planBlock,/const preserved=chosen\.has\(source\.id\)\?JSON\.parse\(JSON\.stringify\(source\)\):source/);
  assert.match(planBlock,/JSON\.parse\(JSON\.stringify\(preserved\)\)/);
  assert.match(INDEX,/Kaynak model korundu; fiyatlama ve onay geçmişi yeni satıra kopyalanmadı/);
});

test('Add New Model açılır pencere olmadan tabloya boş satır ekler',()=>{
  assert.match(INDEX,/function addBlankKolRow\(\)/);
  assert.match(INDEX,/kolRows\.unshift\(row\)/);
  assert.match(INDEX,/data-k="modelKod"/);
  assert.match(INDEX,/document\.getElementById\('kolAddRowBtn'\)\?\.addEventListener\('click',addBlankKolRow\)/);
  assert.doesNotMatch(INDEX,/function openKolNewModelModal\(\)/);
  assert.match(INDEX,/function kolNewModelDefaults\(\)/);
  assert.match(INDEX,/mag:kolFirstProfileValue\(profile\.mags\)/);
  assert.match(INDEX,/mmyg:kolFirstProfileValue\(profile\.mmygs\)/);
  assert.match(INDEX,/buyer:norm\(profile\.displayName\)/);
});

/* v7.81 — Koleksiyon 'İçe / Dışa Aktar' sekmesi kullanıcı talebiyle
   kaldırıldı; kolStyleMgmtExportBtn düğmesi de onunla birlikte KALDIRILDI
   (Excel İçe Aktar ve PLM Linklerini Güncelle ile aynı kararla — bkz.
   plm-style-links-v605.test.js). Eski test üçünün göreli KONUMUNU
   kilitliyordu; artık ikisi (Excel'e Aktar, Style Management) aynı yerde
   değil, konum kilidi anlamsızlaştı. Yerine kaldırmanın kalıcı olduğunu
   kilitleyen tek test kondu. Altındaki fonksiyon (kolExportStyleManagement)
   BİLEREK dokunulmadı — düğmesiz erişilemez durumda kalır (?.addEventListener
   optional chaining ile korunuyor), kaldırma isteği yalnız düğmeyi kapsıyordu.
   kolExportImgBtn artık Recycle Bin'in hemen sağında. */
test('Style Management Excel düğmesi kalıcı olarak kaldırıldı, Export to Excel Recycle Bin\'in yanında', ()=>{
  assert.doesNotMatch(INDEX, /id="kolStyleMgmtExportBtn"/);
  assert.doesNotMatch(INDEX, /Export Excel for Style Management/);
  const recycle=INDEX.indexOf('id="kolRecycleBinBtn"');
  const exportImg=INDEX.indexOf('id="kolExportImgBtn"');
  assert.ok(recycle>=0&&exportImg>recycle,
    'Excel\'e Aktar artık Recycle Bin\'in hemen sağında olmalı');
});

test('Style Management Excel yalnız düzenlenebilir alanları kullanır ve görsel/fiyat geçmişini dışarıda bırakır',()=>{
  const schema=sliceBetween('function kolStyleManagementFields','const KOL_PRICING_EXCEL_COLS_KEY');
  assert.match(schema,/c\.exToRetail\|\|c\.ruleReadonly\|\|c\.formulaReadonly\|\|c\.ydLanded\|\|c\.trLanded/);
  const exporter=sliceBetween('async function kolExportStyleManagement','document.getElementById(\'kolExportImgBtn\')');
  assert.match(exporter,/const fields=kolStyleManagementFields\(\)/);
  assert.match(exporter,/BL_COLLECTION_ROW_ID/);
  assert.doesNotMatch(exporter,/kolPrepareExcelImage|addImage\(/);
  assert.doesNotMatch(exporter,/confirmedManufacturer|kolBestPricing|row\.pricing/);
});

test('Style Management import satır notuyla mevcut modeli bulur ve değişiklikleri onaydan sonra uygular',()=>{
  assert.match(INDEX,/function kolImportStyleRowId\(ws,rowIndex,columnCount\)/);
  assert.match(INDEX,/BL_COLLECTION_ROW_ID/);
  const plan=sliceBetween('function kolBuildImportPlan','function kolImportPlanText');
  assert.match(plan,/const byKey=new Map\(\),byId=new Map\(\)/);
  assert.match(plan,/matchedById=true/);
  assert.match(plan,/!matchedById&&\(fieldKey==='plmId'\|\|fieldKey==='modelKod'\)/);
  assert.match(INDEX,/const approved=await showKolImportPlanModal\(plan\)/);
  assert.match(INDEX,/if\(!approved\)/);
});

test('Overseas Landed ve TR Landed kaydedilmiş ve sürüklenen düzenlerde en sağda kalır',()=>{
  assert.match(INDEX,/const KOL_COL_LAYOUT_VERSION = 7/);
  assert.match(INDEX,/function kolPlaceLandedAtEnd\(order\)/);
  assert.match(INDEX,/out\.push\('ydLanded','trLanded'\)/);
  assert.match(INDEX,/kolColOrder=kolPlaceLandedAtEnd\(kolColOrder\)/);
  assert.match(INDEX,/normalizedKeys=kolPlaceLandedAtEnd\(ordered\.map\(c=>c\.k\)\)/);
});
