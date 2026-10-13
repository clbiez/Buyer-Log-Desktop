/* Shared native Shipping Comparison calculation and source projections. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.BLShippingEngine=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
const SHIP_TRANSIT_FALLBACK={'Gemi':75,'Gemi+Uçak':45,'Uçak':15}; // i18n-ignore
function roundFx(value){
  const n=Number(value);if(!Number.isFinite(n))return null;
  const sign=n<0?-1:1;return sign*Math.floor(Math.abs(n)*100+0.5+1e-10)/100;
}
function transitDays(row,resolveTransitDaysForValues){
  const snap=row&&row._transitDaysSnapshot&&row._transitDaysSnapshot.version===1?row._transitDaysSnapshot:null;
  const out={},src={};
  ['Gemi','Gemi+Uçak','Uçak'].forEach(delType=>{
    let days=null, source='default';
    if(typeof resolveTransitDaysForValues==='function'){
      // forceRules: bu sayfa bir "ne olurdu" karşılaştırması; sipariş durumu
      // kural aramasını engellememeli.
      const res=resolveTransitDaysForValues(delType,row&&row.exFactory,row&&row.season,row&&row.country,row&&row.status,true);
      if(res&&res.dynamic&&Number.isFinite(Number(res.days))){ days=Number(res.days); source='rule'; }
    }
    if(days==null&&snap&&Number.isFinite(Number(snap[delType]))){ days=Number(snap[delType]); source='snapshot'; }
    if(days==null){ days=SHIP_TRANSIT_FALLBACK[delType]; source='default'; }
    out[delType]=days; src[delType]=source;
  });
  out._source=src;
  return out;
}

function landedMultipliers(raw={}){
  const pick=(value,fallback)=>{const n=Number(value);return Number.isFinite(n)&&n>0?n:fallback;};
  return {tr:pick(raw.tr,1.05), overseas:pick(raw.overseas,1.11)};
}

function compute(row,{coerceDateLoose,toNum,toISODate,days,multipliers}){
  const exf = row.exFactory ? coerceDateLoose(row.exFactory) : null;
  const opd = row.opd ? coerceDateLoose(row.opd) : null;
  row.leadTime = (exf && opd && !isNaN(exf) && !isNaN(opd)) ? Math.round((exf-opd)/86400000) : '';
  const trTl = toNum(row.trFiyatTl), kur = toNum(row.kur);
  row.trFiyatUsd = (trTl!=null && kur) ? (trTl/kur) : '';
  row.trFiyatFobUsdLanded = (row.trFiyatUsd!=='' ) ? (row.trFiyatUsd*multipliers.tr) : '';
  const fob = toNum(row.fob);
  row.ydFiyatUsd = fob!=null ? fob : '';
  row.ydFiyatUsdLandedGemi = fob!=null ? (fob*multipliers.overseas) : '';
  /* Avantajın tabanı DOMESTIC LANDED'dır (TR USD × tr çarpanı), domestic FOB
     değil. YD tarafındaki üç değerin hepsi landed olduğu için ancak böyle
     elma-elma bir oran çıkar. */
  const trLanded = row.trFiyatFobUsdLanded;
  const gemiUcak = toNum(row.ydFiyatUsdLandedGemiUcak), ucak = toNum(row.ydFiyatUsdLandedUcak);
  const advantage = landed => (trLanded!=='' && trLanded!==0 && landed!=null && landed!=='') ? (landed/trLanded - 1) : '';
  row.gemiAvantaj = advantage(row.ydFiyatUsdLandedGemi===''?null:row.ydFiyatUsdLandedGemi);
  row.gemiUcakAvantaj = advantage(gemiUcak);
  row.ucakAvantaj = advantage(ucak);
  const addDaysIso = (dateStr, n) => {
    // YYYY-MM-DD iş tarihidir, saat anı değildir. `new Date('2026-08-01')`
    // UTC olarak ayrıştırılıp yerel getDate/setDate ile işlendiğinde UTC eksi
    // saat dilimlerinde bir gün geriye kayar. Tarih-only girdiyi UTC takvim
    // aritmetiğiyle taşı; diğer desteklenen girdiler eski yerel yolu korusun.
    const match=String(dateStr==null?'':dateStr).trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if(match){const d=new Date(Date.UTC(Number(match[1]),Number(match[2])-1,Number(match[3])));d.setUTCDate(d.getUTCDate()+Number(n||0));return d.toISOString().slice(0,10);}
    const d=coerceDateLoose(dateStr);if(!d)return '';d.setDate(d.getDate()+Number(n||0));return toISODate(d);
  };
  const vesselDays=days.Gemi, seaAirDays=days['Gemi+Uçak'], airDays=days['Uçak'];
  row.retailTrWithVessel = addDaysIso(row.exFactory, vesselDays);
  row.gemiUcakAntrepoTeslim = addDaysIso(row.exFactory, seaAirDays);
  row.ucakAntrepoTeslim = addDaysIso(row.exFactory, airDays);

  // TOPLAM ETKİ (USD).
  //
  // Avantaj sütunları birim bazında yüzde veriyor; karar ise toplam paraya bakar:
  // %3 fark 500 adette başka, 50.000 adette başka bir şeydir. Burada aynı
  // karşılaştırmanın adet çarpılmış hâli hesaplanır — yani (YD landed − TR USD) × Adet.
  //
  // Karşılaştırma tabanı Avantaj formülleriyle AYNI olmalıdır; ikisi de artık
  // DOMESTIC LANDED kullanır (kullanıcı kararı — bkz. avantaj formülü).
  // Bu alanlar v9.18'den beri ekranda gösterilmez; hesap ucuz ve sınanmış
  // olduğu için, ileride yeniden istenirse diye yerinde bırakıldı.
  //
  // Alanlar alt çizgiyle başlar: SHIP_COLS ve SHIP_EXCEL_HEADERS'a girmezler,
  // dolayısıyla tabloya ve Excel şablonuna dokunmazlar. Yalnız karar kartlarında
  // gösterilirler.
  const qty = toNum(row.quantity);
  const totalDiff = landed => (trLanded!=='' && landed!=null && landed!=='' && qty!=null) ? ((landed - trLanded) * qty) : null;
  row._totalGemi = totalDiff(row.ydFiyatUsdLandedGemi==='' ? null : row.ydFiyatUsdLandedGemi);
  row._totalGemiUcak = totalDiff(gemiUcak);
  row._totalUcak = totalDiff(ucak);
  row._totalTr = (trLanded!=='' && qty!=null) ? (trLanded * qty) : null;
  return row;
}

function mapCPRow(row,{isProductionStatus,resolveTransitDaysForValues,toISODate,toNum}){
  const transitSnapshot=isProductionStatus(row['STATUS']) ? {
    version:1,
    createdAt:new Date().toISOString(),
    Gemi:resolveTransitDaysForValues('Gemi',row['Ex-factory'],row.Season,row.Country,row['STATUS'],false).days,
    'Gemi+Uçak':resolveTransitDaysForValues('Gemi+Uçak',row['Ex-factory'],row.Season,row.Country,row['STATUS'],false).days,
    Uçak:resolveTransitDaysForValues('Uçak',row['Ex-factory'],row.Season,row.Country,row['STATUS'],false).days,
    'Gemi+Tır':resolveTransitDaysForValues('Gemi+Tır',row['Ex-factory'],row.Season,row.Country,row['STATUS'],false).days,
  } : null;
  return {
    orderCode: row['Order Code'] ?? '',
    status: row['STATUS'] || '',
    buyerGroup: row['Buyer Grup (TR)'] || '',
    buyer: row['Buyer'] || '',
    category: row['Category'] || '',
    line: row['Line'] || '',
    retailDate: row['Retail Date'] instanceof Date ? toISODate(row['Retail Date']) : (row['Retail Date']||null),
    opd: row['OPD'] instanceof Date ? toISODate(row['OPD']) : (row['OPD']||null),
    exFactory: row['Ex-factory'] instanceof Date ? toISODate(row['Ex-factory']) : (row['Ex-factory']||null),
    specialCode: row['Special Code'] || '',
    // Görsel referansı satıra YAZILIR: kullanıcı CP'yi hiç açmadan Nakliye'ye
    // geçtiğinde override haritası boş olur ve canlı çözüm hiçbir şey bulamaz.
    // PLM kimliği de taşınır ki harita yüklüyken canlı çözüm çalışabilsin.
    plm: row['PLM ID'] ?? row['PLM Code'] ?? row.plmId ?? '',
    _imageRef: row._imageRef || '',
    styleName: row['Model Name'] || '',
    colour: row['Colour'] || '',
    colorCode: row['C.Code'] || '',
    quantity: toNum(row['Order Quantity']) ?? '',
    country: row['Country'] || '',
    season: row['Season'] || '',
    delType: row['Del. Type'] || '',
    _transitDaysSnapshot: transitSnapshot,
    supplier: row['Manufacturer'] || '',
    fob: toNum(row['FOB ($)']) ?? '',
    suppFob: toNum(row['Supp. FOB']) ?? '',
  };
}

function collectionShippingModelKey(row){
  const normalize=value=>String(value==null?'':value).trim().toLocaleUpperCase('tr-TR')
    .replace(/İ/g,'I').replace(/Ş/g,'S').replace(/Ç/g,'C').replace(/Ö/g,'O').replace(/Ü/g,'U').replace(/Ğ/g,'G');
  const plm=normalize(row&&row.plmId);
  if(plm)return `PLM:${plm}`;
  const model=normalize(row&&row.modelKod);
  if(model)return `MODEL:${model}\u001f${normalize(row&&row.season)}`;
  const order=normalize(row&&row._sourceOrderCode);
  return order?`ORDER:${order}`:'';
}

function mapCollectionRow(row,{toISODate,toNum,norm,normalizeTransitDelType}){
  if(!row)return null;
  const date=value=>value instanceof Date?(toISODate(value)||''):String(value||'').trim();
  const modelKey=collectionShippingModelKey(row);
  if(!modelKey)return null;
  const supplier=norm(row.confirmedManufacturer)||norm(row.buyingSampleManufacturer)||'';
  return {
    _sourceModule:'collection', _modelKey:modelKey,
    orderCode:row._sourceOrderCode||'', status:row.durum||'', buyerGroup:row.buyingGroup||'', buyer:row.buyer||'',
    category:row.urunTipi||'', line:row.line||'', retailDate:date(row.retail), opd:'', exFactory:date(row.exFactory),
    specialCode:row.specialCode||'', plm:row.plmId||'', _imageRef:row.imgRef||row.img||'', styleName:row.modelKod||'',
    colour:row.colour||'', colorCode:row.colourCode||'', quantity:toNum(row.quantity)??'', country:row.country||'', season:row.season||'',
    delType:normalizeTransitDelType(row.delType)||'Gemi', supplier, fob:toNum(row.fob)??'', suppFob:toNum(row.targetPrice)??'',
    trFiyatTl:toNum(row.trPrice)??'', kur:toNum(row.trFx)??'',
  };
}
return {compute,transitDays,landedMultipliers,roundFx,mapCPRow,mapCollectionRow,collectionShippingModelKey};
});
