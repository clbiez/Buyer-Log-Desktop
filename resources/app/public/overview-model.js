/* Genel Bakış saf hesapları (#1074). DOM'suz; tarayıcıda BLOverviewModel,
 * Node'da module.exports. İstemcinin eski yolu (renderOverviewNow) ve yerel arka
 * ucun Genel Bakış okuma modeli AYNI fonksiyonları kullanır; hesap iki kez
 * yazılmaz. Görünür metin üretmez: etiketleri çizen taraf seçer.
 */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.BLOverviewModel=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  // app-main.js OV_DIM_META ile aynı boyut → sütun eşlemesi.
  const DIM_COLUMNS=Object.freeze({merch:'Merch Alt Grup Kod',ageGroup:'Merch Marka Yaş Grup Kod',orderStatus:'Active/Inactive',season:'Season',
    buyerGrup:'Buyer Grup (TR)',buyer:'Buyer',country:'Country'});
  const norm=value=>String(value==null?'':value).trim();
  const toNum=value=>{const n=Number(value);return isNaN(n)?null:n;};
  const isTurkeyCountry=country=>/^t[üu]rk/i.test(norm(country));

  // {dim:[values]} veya {dim:Set} → bilinen boyutlar için {dim:Set<string>}.
  function normalizeFilters(raw){
    const out={};
    for(const [dim,values] of Object.entries(raw&&typeof raw==='object'?raw:{})){
      if(!Object.prototype.hasOwnProperty.call(DIM_COLUMNS,dim))continue;
      const list=values instanceof Set?[...values]:Array.isArray(values)?values:[];
      if(list.length)out[dim]=new Set(list.map(String));
    }
    return out;
  }
  /* app-main.js passesOvDimFilters ile aynı semantik. CP satırları yapı gereği
     aktiftir (Kalan Miktar > 0); Sipariş Durumu filtresi CP için 'Active' sayılır. */
  function passesDimFilters(row,isCpRow,filters){
    for(const dim of Object.keys(filters)){
      const set=filters[dim];
      if(!set||!set.size)continue;
      const value=dim==='orderStatus'?(isCpRow?'Active':(norm(row['Active/Inactive'])||'Active')):norm(row[DIM_COLUMNS[dim]]);
      if(!set.has(value))return false;
    }
    return true;
  }
  function groupCount(rows,key){
    const m={};for(const r of rows){const k=norm(r[key])||'—';m[k]=(m[k]||0)+1;}
    return Object.entries(m).sort((a,b)=>b[1]-a[1]).slice(0,10);
  }
  function orderKpis(orderRows){
    let active=0,fobUsd=0,fobTry=0;
    for(const r of orderRows){
      if(norm(r['Active/Inactive'])!=='Active')continue;
      active++;
      const value=(toNum(r['FOB ($)'])*toNum(r['Order Quantity'])||0);
      if(isTurkeyCountry(r.Country))fobTry+=value;else fobUsd+=value;
    }
    return {total:orderRows.length,active,fobUsd,fobTry};
  }
  /* Buying Group özeti: "Toplam" sütunları filtre kapsamındaki tüm satırları,
     "Aktif" sütunları yalnız aktif siparişleri sayar. Aktif sayısına göre azalan. */
  function buyingGroups(orderRows){
    const map={};
    for(const r of orderRows){
      const bg=norm(r['Buyer Grup (TR)'])||'—';
      const d=map[bg]||(map[bg]={total:0,active:0,remaining:0,totalQty:0,fobValueUsd:0,fobValueTry:0,totalFobValueUsd:0,totalFobValueTry:0});
      d.total++;
      d.totalQty+=(toNum(r['Order Quantity'])||0);
      const value=(toNum(r['FOB ($)'])*toNum(r['Order Quantity'])||0),turkey=isTurkeyCountry(r.Country);
      if(turkey)d.totalFobValueTry+=value;else d.totalFobValueUsd+=value;
      if(norm(r['Active/Inactive'])==='Active'){
        d.active++;d.remaining+=(toNum(r['Remaining'])||0);
        if(turkey)d.fobValueTry+=value;else d.fobValueUsd+=value;
      }
    }
    return Object.entries(map).sort((a,b)=>b[1].active-a[1].active);
  }
  /* Sezon × Aksiyon Önceliği. priorityOf(row) geçerli bir öncelik kodu ya da ''
     döndürür; codes katalog sırasıdır. compareSeason sezon sıralamasıdır. */
  function seasonBreakdown(cpRows,{codes,priorityOf,compareSeason}){
    const map={},list=Array.isArray(codes)?codes:[];
    for(const r of cpRows){
      const season=norm(r['Season'])||'—';
      const d=map[season]||(map[season]={priorities:Object.fromEntries(list.map(code=>[code,0])),qty:0,count:0});
      const code=priorityOf(r);
      if(code&&Object.prototype.hasOwnProperty.call(d.priorities,code))d.priorities[code]++;
      d.qty+=(toNum(r['Order Quantity'])||0);
      d.count++;
    }
    return Object.entries(map).sort((a,b)=>compareSeason(a[0],b[0]));
  }
  /* app-main.js actionPriorityCode'un aynası (Unified Action Priority kodu).
     Sunucu karar katmanının sonucunu istemcinin row.Priority değeriyle aynı koda
     çevirir; tests/read-model-overview-parity.test.js gerçek app-main
     fonksiyonuyla eşitliği kilitler. OD: BLOrderDecisionEngine. */
  function actionPriorityCode(value,OD){
    const text=norm(value);
    if(!text)return '';
    if(OD&&OD.ACTION_PRIORITY&&OD.ACTION_PRIORITY[text])return text;
    if(text==='ACT_TODAY')return 'ACTION_TODAY';
    if(text==='ACT_THIS_WEEK')return 'ACTION_THIS_WEEK';
    if(OD&&typeof OD.isCustomPriorityCode==='function'&&OD.isCustomPriorityCode(text))return text;
    const catalog=OD&&typeof OD.getPriorityCatalog==='function'?OD.getPriorityCatalog():null;
    if(Array.isArray(catalog)){
      const wanted=text.toLocaleLowerCase('tr-TR');
      for(const meta of catalog){
        if(meta&&meta.id===text)return meta.id;
        if(norm(meta&&meta.tr).toLocaleLowerCase('tr-TR')===wanted||norm(meta&&meta.en).toLocaleLowerCase('tr-TR')===wanted)return meta.id;
      }
    }
    if(OD&&OD.ACTION_PRIORITY){
      const wanted=text.toLocaleLowerCase('tr-TR');
      for(const [code,meta] of Object.entries(OD.ACTION_PRIORITY)){
        if(norm(meta&&meta.tr).toLocaleLowerCase('tr-TR')===wanted||norm(meta&&meta.en).toLocaleLowerCase('tr-TR')===wanted)return code;
      }
    }
    return '';
  }
  return {DIM_COLUMNS,normalizeFilters,passesDimFilters,groupCount,orderKpis,buyingGroups,seasonBreakdown,actionPriorityCode,norm,toNum,isTurkeyCountry};
});
