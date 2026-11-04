/* Buyer Log — License Royalty v2
   Tek sözleşme kaydı: Royalty + TR Komisyon + YD Komisyon + Hologram Cost.
   Eski TR / Non-TR satırları BLBusinessRules.migrateLicenseRoyaltyRules ile
   efektif fiyatları kaybetmeden birleştirilir. */
(function installLicenseRoyaltyCommissionModel(){
  const api=window.BLBusinessRules;
  if(!api||typeof api.migrateLicenseRoyaltyRules!=='function')return;

  function optionalPercent(value){
    if(value==null||String(value).trim()==='')return null;
    const n=Number(String(value).replace(',','.'));return Number.isFinite(n)?n:null;
  }
  function optionalMoney(value){
    if(value==null||String(value).trim()==='')return null;
    const n=Number(String(value).replace(',','.'));return Number.isFinite(n)?n:null;
  }
  function commission(rule,country){return api.pricingRuleCommissionForCountry(rule,country);}
  function effectiveRoyalty(rule,country){return api.pricingRuleEffectiveRoyalty(rule,country);}
  function hologramFor(rule,country){return api.pricingRuleHologramForCountry(rule,country);}
  function hasSide(rule,country){return commission(rule,country)!=null;}
  function pct(value){return value==null?'—':Number(value).toLocaleString('tr-TR',{maximumFractionDigits:3})+'%';}
  function money(value){return value==null?'—':Number(value).toLocaleString('tr-TR',{minimumFractionDigits:0,maximumFractionDigits:3});}

  normalizePricingRules=function(rules){
    const migrated=api.migrateLicenseRoyaltyRules(Array.isArray(rules)?rules:[]);
    const out=[],seen=new Set();
    migrated.forEach((r,i)=>{
      const opdStart=normalizePricingRuleDate(r&&r.opdStart),opdEnd=normalizePricingRuleDate(r&&r.opdEnd);
      const seasons=normalizePricingRuleSeasons((r&&r.seasons)!=null?r.seasons:(r&&r.season));
      const licensor=norm(r&&r.licensor)||norm(r&&r.manufacturer),license=norm(r&&r.license);
      const royalty=Number(r&&r.royalty),trCommission=optionalPercent(r&&r.trCommission),ydCommission=optionalPercent(r&&r.ydCommission),hologramCost=Number(r&&r.hologramCost);
      if(opdStart&&opdEnd&&dateOrdinal(opdStart)>dateOrdinal(opdEnd))return;
      if(!licensor||!license||!Number.isFinite(royalty)||royalty<0||royalty>100||!Number.isFinite(hologramCost)||hologramCost<0)return;
      if(trCommission==null&&ydCommission==null)return;
      if((trCommission!=null&&(trCommission<0||trCommission>100||royalty+trCommission>100))||(ydCommission!=null&&(ydCommission<0||ydCommission>100||royalty+ydCommission>100)))return;
      const categories=api.pricingRuleCategories(r);
      const key=[categories.map(turknorm).join('~'),opdStart,opdEnd,seasons.map(turknorm).join('~'),turknorm(licensor),turknorm(license),trCommission==null?'':'TR',ydCommission==null?'':'YD'].join('|');
      if(seen.has(key))return;seen.add(key);
      const item={id:String((r&&r.id)||('rule-'+Date.now()+'-'+i)),opdStart,opdEnd,seasons,categories,licensor,license,royalty,trCommission,ydCommission,hologramCost};
      const legacyTr=optionalMoney(r&&r.legacyTrHologramCost),legacyYd=optionalMoney(r&&r.legacyYdHologramCost);
      if(legacyTr!=null)item.legacyTrHologramCost=legacyTr;
      if(legacyYd!=null)item.legacyYdHologramCost=legacyYd;
      if(Array.isArray(r&&r.legacyRuleIds)&&r.legacyRuleIds.length)item.legacyRuleIds=r.legacyRuleIds.map(String).filter(Boolean);
      if(r&&r.migratedFromCountrySplit===true)item.migratedFromCountrySplit=true;
      out.push(item);
    });
    out.sort((a,b)=>{
      const a1=dateOrdinal(a.opdStart),b1=dateOrdinal(b.opdStart),a2=dateOrdinal(a.opdEnd),b2=dateOrdinal(b.opdEnd);
      return (a1==null?-Infinity:a1)-(b1==null?-Infinity:b1)||(a2==null?Infinity:a2)-(b2==null?Infinity:b2)||pricingRuleSeasonLabel(a).localeCompare(pricingRuleSeasonLabel(b),'tr')||a.licensor.localeCompare(b.licensor,'tr')||a.license.localeCompare(b.license,'tr');
    });
    return out;
  };

  pricingRuleMatchesValues=function(rule,opd,country,season,licensor,license,category){
    const day=dateOrdinal(opd),start=dateOrdinal(rule&&rule.opdStart),end=dateOrdinal(rule&&rule.opdEnd);
    const dateMatches=(start==null&&end==null)||(day!=null&&(start==null||day>=start)&&(end==null||day<=end));
    return dateMatches&&api.pricingRuleCategoryMatches(rule,category)&&pricingRuleSeasonMatches(rule,season)&&hasSide(rule,country)&&turknorm(licensor)===turknorm(rule&&rule.licensor)&&turknorm(license)===turknorm(rule&&rule.license);
  };
  pricingRuleMatchesRow=function(rule,row){return !!row&&pricingRuleMatchesValues(rule,row.OPD,row.Country,row.Season,row.Licensor,row.License,window.BLCanonicalFields.canonicalValue(row,'cp','category'));};
  // Exact licensor first; a merged licensor name (ERMODA UK LTD → ERMODA) is the fallback.
  const merges=()=>state.licensorMerges||{split:[]};
  const findByLicensor=(rules,licensor,matches,license)=>api.findRuleByLicensor(api.prioritizeCategoryRules(rules),licensor,matches,merges(),undefined,license);
  findSuppFobRule=function(opd,country,season,licensor,license,category){return findByLicensor(state.overrides.pricingRules||[],licensor,r=>pricingRuleMatchesValues(r,opd,country,season,r&&r.licensor,license,category),license);};
  pricingRulesOverlap=function(a,b){
    if(turknorm(a&&a.licensor)!==turknorm(b&&b.licensor)||turknorm(a&&a.license)!==turknorm(b&&b.license)||!pricingRuleSeasonSetsOverlap(a,b)||!api.pricingRuleCategoryScopesOverlap(a,b))return false;
    if(!((hasSide(a,'TR')&&hasSide(b,'TR'))||(hasSide(a,'YD')&&hasSide(b,'YD'))))return false;
    const a1=dateOrdinal(a.opdStart),a2=dateOrdinal(a.opdEnd),b1=dateOrdinal(b.opdStart),b2=dateOrdinal(b.opdEnd);
    return (a1==null?-Infinity:a1)<=(b2==null?Infinity:b2)&&(b1==null?-Infinity:b1)<=(a2==null?Infinity:a2);
  };
  pricingRulesSameCondition=function(a,b){
    const aa=normalizePricingRuleSeasons((a&&a.seasons)!=null?a.seasons:(a&&a.season)).map(turknorm).join('|');
    const bb=normalizePricingRuleSeasons((b&&b.seasons)!=null?b.seasons:(b&&b.season)).map(turknorm).join('|');
    return normalizePricingRuleDate(a&&a.opdStart)===normalizePricingRuleDate(b&&b.opdStart)&&normalizePricingRuleDate(a&&a.opdEnd)===normalizePricingRuleDate(b&&b.opdEnd)&&aa===bb&&JSON.stringify(api.pricingRuleCategories(a).map(turknorm))===JSON.stringify(api.pricingRuleCategories(b).map(turknorm))&&turknorm(a&&a.licensor)===turknorm(b&&b.licensor)&&turknorm(a&&a.license)===turknorm(b&&b.license)&&((hasSide(a,'TR')&&hasSide(b,'TR'))||(hasSide(a,'YD')&&hasSide(b,'YD')));
  };

  normalizeSuppFobMeta=function(meta){
    if(!meta||typeof meta!=='object')return null;
    const out={source:meta.source==='rule'?'rule':'manual'};
    if(meta.ruleId!=null)out.ruleId=String(meta.ruleId);
    if(meta.origin)out.origin=String(meta.origin).slice(0,40);
    ['opdStart','opdEnd','licensor','license','commissionGroup'].forEach(k=>{if(meta[k]!=null&&norm(meta[k]))out[k]=norm(meta[k]);});
    if(!out.licensor&&meta.manufacturer!=null&&norm(meta.manufacturer))out.licensor=norm(meta.manufacturer);
    const seasons=normalizePricingRuleSeasons(meta.seasons!=null?meta.seasons:meta.season);if(seasons.length)out.seasons=seasons;
    ['royalty','trCommission','ydCommission','commission','effectiveRoyalty','hologramCost'].forEach(k=>{if(meta[k]!=null&&String(meta[k]).trim()!==''){const n=Number(meta[k]);if(Number.isFinite(n))out[k]=n;}});
    if(meta.applied===true)out.applied=true;
    return out;
  };
  automaticSuppFobRuleMeta=function(rule,applied,country){
    if(!rule)return null;
    const group=api.pricingRuleCountryGroup(country),countryCommission=commission(rule,group),total=effectiveRoyalty(rule,group),hologram=hologramFor(rule,group);
    return {source:'rule',ruleId:String(rule.id||''),opdStart:rule.opdStart||'',opdEnd:rule.opdEnd||'',seasons:normalizePricingRuleSeasons(rule.seasons!=null?rule.seasons:rule.season),licensor:rule.licensor,license:rule.license,royalty:Number(rule.royalty),trCommission:rule.trCommission,ydCommission:rule.ydCommission,commissionGroup:group,commission:countryCommission,effectiveRoyalty:total,hologramCost:hologram,applied:applied===true};
  };
  calculateSuppFobWithRule=function(fob,rule,country){return api.calculateSuppFobWithRule(fob,rule,country);};
  calculateSuppFobFromRule=function(fob,opd,country,season,licensor,license,category){
    const rule=findSuppFobRule(opd,country,season,licensor,license,category);if(!rule)return {value:null,rule:null};
    return {value:calculateSuppFobWithRule(fob,rule,country),rule};
  };
  recalcSuppFobForRow=function(row){
    if(!row||hasManualSuppFob(row))return false;
    const prev=row['Supp. FOB'],priced=calculateSuppFobFromRule(row['FOB ($)'],row.OPD,row.Country,row.Season,row.Licensor,row.License,window.BLCanonicalFields.canonicalValue(row,'cp','category'));
    const next=priced.value!=null?priced.value:(turknorm(row.Licensor)==='DTR'?(toNum(row['FOB ($)'])??null):null);
    row['Supp. FOB']=next;row._suppFobRule=priced.rule?(priced.rule.id||true):null;row._suppFobMeta=automaticSuppFobRuleMeta(priced.rule,false,row.Country);row._suppFobOverride=false;row._suppFobManual=false;
    return !editableValuesEqual(prev,next);
  };
  suppFobHoverText=function(row){
    if(!row||turknorm(row.Licensor)==='DTR'||row['Supp. FOB']==null||row['Supp. FOB']==='')return '';
    const meta=suppFobMetaForRow(row),currentRule=findSuppFobRule(row.OPD,row.Country,row.Season,row.Licensor,row.License,window.BLCanonicalFields.canonicalValue(row,'cp','category')),rule=currentRule||(meta&&meta.source==='rule'?meta:null);
    const automatic=isSuppFobAutoCalculated(row),group=api.pricingRuleCountryGroup(row.Country),countryCommission=rule?commission(rule,group):null,total=rule?effectiveRoyalty(rule,group):null,hologram=rule?hologramFor(rule,group):null;
    const lines=[automatic?(meta&&meta.applied?'Otomatik hesaplandı (Apply)':'Otomatik hesaplandı'):'Elle girildi'];
    if(rule)lines.push('OPD: '+pricingRuleDateRangeLabel(rule),'Sezon: '+pricingRuleSeasonLabel(rule));
    if(rule&&Number.isFinite(Number(rule.royalty)))lines.push('Royalty: %'+Number(rule.royalty).toLocaleString('tr-TR',{maximumFractionDigits:3}));
    if(countryCommission!=null)lines.push((group==='TR'?'TR':'YD')+' komisyon: %'+Number(countryCommission).toLocaleString('tr-TR',{maximumFractionDigits:3}));
    if(total!=null)lines.push('Toplam: %'+Number(total).toLocaleString('tr-TR',{maximumFractionDigits:3}));
    if(hologram!=null&&Number(hologram)!==0)lines.push('Hologram maliyeti: '+money(hologram));
    return lines.join(' • ');
  };

  applySuppFobRuleToMatchingOrders=async function(rule){
    commitActiveTableEditor({refresh:false});
    const matches=(state.cp&&state.cp.rows||[]).filter(r=>pricingRuleMatchesRow(rule,r)&&findSuppFobRule(r.OPD,r.Country,r.Season,r.Licensor,r.License,window.BLCanonicalFields.canonicalValue(r,'cp','category'))?.id===rule.id),updates=[],seen=new Set();
    matches.forEach(r=>{
      const oc=r['Order Code'],lineKey=lineKeyOfRow(r)||String(oc);
      if(oc==null||seen.has(lineKey))return;
      const value=calculateSuppFobWithRule(r['FOB ($)'],rule,r.Country);
      if(value==null||!Number.isFinite(value))return;
      seen.add(lineKey);updates.push({orderCode:oc,...lineIdentity(r),lineKey,suppFob:value,suppFobMeta:automaticSuppFobRuleMeta(rule,true,r.Country)});
    });
    if(!updates.length){showToast('Bu kuralla eşleşen ve geçerli FOB değeri bulunan sipariş yok.');return 0;}
    if(window.SERVER_BACKED)await enqueueOverrideMutation('suppFob','/api/overrides/batch-suppfob',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({items:updates})});
    updates.forEach(({orderCode,lineKey,suppFob,suppFobMeta})=>{
      const meta=normalizeSuppFobMeta(suppFobMeta)||{source:'rule',applied:true},key=lineKey||orderCode;
      state.overrides.suppfobmap[key]=suppFob;state.overrides.suppfobmetamap=state.overrides.suppfobmetamap||{};state.overrides.suppfobmetamap[key]=meta;
      [state.cp&&state.cp.rows,state.orderSummary&&state.orderSummary.rows].forEach(rows=>(rows||[]).forEach(r=>{if((lineKeyOfRow(r)||String(r['Order Code']))===key){r['Supp. FOB']=suppFob;r._suppFobMeta=meta;r._suppFobOverride=true;r._suppFobManual=false;r._suppFobRule=meta.ruleId||true;}}));
    });
    if(!window.SERVER_BACKED)matches.forEach(r=>markDirty(r._id));
    if(state.cp)renderCP();if(state.orderSummary)renderOverview();return updates.length;
  };
  applyAllSuppFobRules=async function(rules){
    commitActiveTableEditor({refresh:false});
    const clean=normalizePricingRules(rules),updates=[],seen=new Set();
    (state.cp&&state.cp.rows||[]).forEach(r=>{
      const oc=r['Order Code'],lineKey=lineKeyOfRow(r)||String(oc);if(oc==null||seen.has(lineKey))return;
      const rule=findByLicensor(clean,r.Licensor,x=>pricingRuleMatchesValues(x,r.OPD,r.Country,r.Season,x&&x.licensor,r.License,window.BLCanonicalFields.canonicalValue(r,'cp','category')),r.License);if(!rule)return;
      const value=calculateSuppFobWithRule(r['FOB ($)'],rule,r.Country);if(value==null||!Number.isFinite(value))return;
      seen.add(lineKey);updates.push({orderCode:oc,...lineIdentity(r),lineKey,suppFob:value,suppFobMeta:automaticSuppFobRuleMeta(rule,true,r.Country)});
    });
    if(!updates.length){showToast('Kurallarla eşleşen ve geçerli FOB değeri bulunan sipariş yok.');return 0;}
    if(window.SERVER_BACKED)await enqueueOverrideMutation('suppFob','/api/overrides/batch-suppfob',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({items:updates})});
    updates.forEach(({orderCode,lineKey,suppFob,suppFobMeta})=>{
      const meta=normalizeSuppFobMeta(suppFobMeta)||{source:'rule',applied:true},key=lineKey||orderCode;
      state.overrides.suppfobmap[key]=suppFob;state.overrides.suppfobmetamap=state.overrides.suppfobmetamap||{};state.overrides.suppfobmetamap[key]=meta;
      [state.cp&&state.cp.rows,state.orderSummary&&state.orderSummary.rows].forEach(rows=>(rows||[]).forEach(r=>{if((lineKeyOfRow(r)||String(r['Order Code']))===key){r['Supp. FOB']=suppFob;r._suppFobMeta=meta;r._suppFobOverride=true;r._suppFobManual=false;r._suppFobRule=meta.ruleId||true;}}));
    });
    if(!window.SERVER_BACKED)(state.cp&&state.cp.rows||[]).forEach(r=>{if(seen.has(lineKeyOfRow(r)||String(r['Order Code'])))markDirty(r._id);});
    if(state.cp)renderCP();if(state.orderSummary)renderOverview();return updates.length;
  };

  kolPricingRuleDimensionMatches=function(rule,ctx){
    return api.pricingRuleCategoryMatches(rule,ctx.category)&&pricingRuleSeasonMatches(rule,ctx.season)&&turknorm(ctx.licensor)===turknorm(rule&&rule.licensor)&&turknorm(ctx.license)===turknorm(rule&&rule.license);
  };
  kolFindPricingRuleForCountryGroup=function(row,countryGroup){
    const ctx=kolPricingRuleContext(row),engine=window.BLCollectionPricingEngine,rules=state.overrides.pricingRules||[],user=state.currentUser||window.BL_USER_CONTEXT||{};
    const merged=(rule,c)=>api.pricingRuleCategoryMatches(rule,c.category)&&pricingRuleSeasonMatches(rule,c.season)&&api.licensorsMerged(c.licensor,rule&&rule.licensor,state.licensorMerges||{split:[]})&&turknorm(c.license)===turknorm(rule&&rule.license);
    if(!engine.createRuleResolver){const find=matches=>engine.findRule(ctx,countryGroup,{api,rules,matches,freshness:kolPricingRuleFreshness});return find(kolPricingRuleDimensionMatches)||(api.licensorHasOwnRules(rules,ctx.licensor,ctx.license)?null:find(merged));}
    const revision=JSON.stringify([String(user.id??''),state.storeRevisions?.pricingRules??0,state.licensorMerges??null,user.dataScope??null,user.permissions??null,user.accessAreas??null]);
    const self=kolFindPricingRuleForCountryGroup;
    const exact=self.exactResolver||(self.exactResolver=engine.createRuleResolver({api,matches:(rule,c)=>kolPricingRuleDimensionMatches(rule,c),freshness:kolPricingRuleFreshness}));
    const value=exact.find(ctx,countryGroup,rules,revision);
    if(value||api.licensorHasOwnRules(rules,ctx.licensor,ctx.license))return value;
    const fallback=self.mergedResolver||(self.mergedResolver=engine.createRuleResolver({api,matches:merged,freshness:kolPricingRuleFreshness}));
    return fallback.find(ctx,countryGroup,rules,revision);
  };
  kolFindPricingRule=function(row){
    const ctx=kolPricingRuleContext(row);if(!ctx.country||!ctx.licensor||!ctx.license)return null;
    return kolFindPricingRuleForCountryGroup(row,ctx.country);
  };
  kolTrLicenseRuleMissingText=function(row){
    const unresolved=kolLicensorUnresolvedState(row);if(unresolved)return licenseLicensorWarningText(unresolved);
    const ctx=kolPricingRuleContext(row),missing=[];if(!ctx.license)missing.push('License');if(!ctx.licensor)missing.push('Licensor');
    if(missing.length)return appLang==='en'?('TR royalty cannot be resolved: '+missing.join(', ')+' is empty. TR Landed is not calculated.'):('TR Royalty çözülemiyor: bu satırda '+missing.join(', ')+' boş. TR Landed hesaplanmadı.');
    return appLang==='en'?'The matching License Royalty contract has no TR commission. TR Landed is not calculated — define TR Commission in License Cards.':'Eşleşen License Royalty sözleşmesinde TR Komisyon tanımlı değil. TR Landed hesaplanmadı — Lisans Kartları içinde TR Komisyon değerini tanımlayın.';
  };
  kolPricingRuleTitle=function(row){
    const rule=kolFindPricingRule(row);if(!rule)return L('Eşleşen CP fiyat kuralı bulunamadı');
    const ctx=kolPricingRuleContext(row),group=api.pricingRuleCountryGroup(ctx.country),countryCommission=commission(rule,group),total=effectiveRoyalty(rule,group);
    return `${L('License Royalty hesabından')} (${L('Koleksiyon için OPD dikkate alınmaz')}): ${pricingRuleDateRangeLabel(rule)} · ${pricingRuleSeasonLabel(rule)} · ${rule.licensor} · ${rule.license} · Royalty %${rule.royalty} + ${group==='TR'?'TR':'YD'} Kom. %${countryCommission??'—'} = %${total??'—'}`;
  };
  kolComputeFobFromConfirmed=function(confFob,royaltyPct,hologram){
    return window.BLCollectionPricingEngine.computeFobFromConfirmed(confFob,royaltyPct,hologram,{kolParseMoneyNum,kolFormatMoneyDisplay});
  };
  kolApplyRulePricing=function(row){
    if(!row)return false;
    const rule=kolFindPricingRule(row),country=kolPricingRuleContext(row).country,total=rule?effectiveRoyalty(rule,country):null,hologram=rule?hologramFor(rule,country):null;
    const royalty=total!=null?window.BLCollectionPricingEngine.formatRatePercent(total):'',hologramDisplay=hologram!=null?kolFormatHologramDisplay(String(hologram)):'',fobSource=kolSuppFob(row);
    const ruleMissing=kolLicensorUnresolvedState(row)!=null||(kolLandedIsNonDtr(row)&&!rule),ruleInvalid=!!rule&&(total==null||total<0||total>=100||hologram==null||hologram<0),fob=(fobSource&&!ruleMissing&&!ruleInvalid)?kolComputeFobFromConfirmed(fobSource.price,royalty,hologramDisplay):'';
    let changed=false;
    if(!editableValuesEqual(row.royalty,royalty)){row.royalty=royalty;changed=true;}
    if(!editableValuesEqual(row.hologramCost,hologramDisplay)){row.hologramCost=hologramDisplay;changed=true;}
    if(!editableValuesEqual(row.fob,fob)){row.fob=fob;changed=true;}
    const ruleId=rule?String(rule.id||''):'';if(row._pricingRuleId!==ruleId){row._pricingRuleId=ruleId;changed=true;}
    if(Object.prototype.hasOwnProperty.call(row,'suppFob')){delete row.suppFob;changed=true;}
    return changed;
  };
  kolLandedPriceWithRule=function(basePrice,row,rule,countryGroup='TR'){
    const base=Number(basePrice);if(!Number.isFinite(base)||base<=0)return null;if(!kolLandedIsNonDtr(row))return base;if(!rule)return null;
    return api.calculateFinalFobWithRule(base,rule,countryGroup);
  };
  kolLandedPriceWithCosts=function(basePrice,row){
    return window.BLCollectionPricingEngine.priceWithCosts(basePrice,row,{kolLicenseRuleMissing,kolLandedIsNonDtr,kolParseMoneyNum});
  };
  kolLandedCalc=function(row){
    return window.BLCollectionPricingEngine.calculateLanded(row,{kolParseMoneyNum,kolDefaultLandedMultipliers,kolAutoFx,kolFindPricingRuleForCountryGroup,kolTrLicenseRuleMissing,kolLandedPriceWithRule,kolSuppFob,kolLandedPriceWithCosts,kolLandedIsNonDtr,kolLicenseRuleMissing,effectiveRoyalty,hologramFor});
  };
  endeksmatikRoyaltyRule=function(mode,row){
    try{
      const direct=mode==='orders'||mode==='cp',rule=direct?findSuppFobRule(...['orderPlacementDate','country','season','licensor','license','category'].map(id=>window.BLCanonicalFields.canonicalValue(row,mode,id))):kolFindPricingRule(row);
      if(!rule)return null;
      const country=direct?window.BLCanonicalFields.canonicalValue(row,mode,'country'):kolPricingRuleContext(row).country,total=effectiveRoyalty(rule,country),hologram=hologramFor(rule,country);
      if(!Number.isFinite(total)||total<0||total>=100||!Number.isFinite(hologram)||hologram<0)return null;
      return {license:rule.license||'',licensor:rule.licensor||'',royalty:total,hologramCost:hologram,baseRoyalty:Number(rule.royalty),commission:commission(rule,country)};
    }catch(_){return null;}
  };

  function parseSuppFobPreviewValue(value){
    const text=String(value??'').trim();
    if(!/^\d+(?:[.,]\d+)?$/.test(text))return null;
    const number=Number(text.replace(',','.'));
    return Number.isFinite(number)&&number>=0?number:null;
  }
  function suppFobPricePreview(row,value){
    const group=api.pricingRuleCountryGroup(row?.Country);
    const result={group,rule:null,suppFob:parseSuppFobPreviewValue(value),finalFob:null,delta:null,error:''};
    if(!row){result.error='row';return result;}
    const dtr=turknorm(row.Licensor)==='DTR';
    if(!dtr&&!norm(row.Country)){result.error='country';return result;}
    result.rule=findSuppFobRule(row.OPD,row.Country,row.Season,row.Licensor,row.License,window.BLCanonicalFields.canonicalValue(row,'cp','category'));
    if(!result.rule&&!dtr){result.error='rule';return result;}
    if(result.suppFob==null){result.error='value';return result;}
    if(result.rule){
      const total=api.pricingRuleEffectiveRoyalty(result.rule,row.Country),hologram=api.pricingRuleHologramForCountry(result.rule,row.Country);
      if(total==null||total<0||total>=100||hologram==null||hologram<0){result.error='invalid';return result;}
      result.finalFob=api.calculateFinalFobWithRule(result.suppFob,result.rule,row.Country);
    }else result.finalFob=result.suppFob;
    if(result.finalFob==null||!Number.isFinite(result.finalFob)){result.finalFob=null;result.error='invalid';return result;}
    const current=parseSuppFobPreviewValue(row['FOB ($)']);
    if(current!=null)result.delta=Math.round((result.finalFob-current)*100)/100;
    return result;
  }
  let openingPricePreview=false,closePricePreview=null;
  async function openSuppFobPricePreview(row,module,trigger){
    if(openingPricePreview||!row)return;
    openingPricePreview=true;
    try{await refreshPricingRulesFromServer();}
    catch(_){showToast(appLang==='en'?'Current royalty rules could not be loaded. Check your connection and try again.':'Güncel royalty kuralları yüklenemedi. Bağlantınızı kontrol edip yeniden deneyin.');return;}
    finally{openingPricePreview=false;}
    closePricePreview?.();
    const currentRow=()=>window.BLGetContextRow?.(module,row._id)??row;
    const T=(tr,en)=>appLang==='en'?en:tr,locale=appLang==='en'?'en-US':'tr-TR';
    const format=value=>value==null?'—':Number(value).toLocaleString(locale,{minimumFractionDigits:2,maximumFractionDigits:2});
    const rate=value=>value==null?'—':Number(value).toLocaleString(locale,{maximumFractionDigits:3})+'%';
    const cost=value=>value==null?'—':Number(value).toLocaleString(locale,{maximumFractionDigits:3});
    const overlay=document.createElement('div');overlay.id='_suppFobPricePreview';overlay.className='warnOverlay blMotionOverlay';overlay.dataset.uiMigrated='dialog';
    overlay.innerHTML=`<div class="modalCard suppFobPreviewCard" role="dialog" aria-modal="true" aria-labelledby="_suppFobPreviewTitle" aria-describedby="_suppFobPreviewHelp">
      <div class="suppFobPreviewHead"><div><div class="modalTitle" id="_suppFobPreviewTitle">${T('FOB Hesapla','FOB Calculator')}</div><div class="suppFobPreviewContext" data-preview-context></div></div><button type="button" class="pricingRuleBtn ghost iconOnly" data-preview-close aria-label="${T('Kapat','Close')}">×</button></div>
      <div class="suppFobPreviewBody">
        <div class="suppFobPreviewGrid"><div class="pricingRuleField"><label for="_suppFobPreviewInput">Supp. FOB (USD)</label><input id="_suppFobPreviewInput" inputmode="decimal" autocomplete="off" aria-describedby="_suppFobPreviewStatus"></div><div class="pricingRuleField"><label for="_suppFobPreviewFinal">Final FOB (USD)</label><div class="suppFobPreviewResult"><output id="_suppFobPreviewFinal" for="_suppFobPreviewInput" aria-live="polite">—</output><button type="button" class="pricingRuleBtn ghost iconOnly" data-preview-copy title="${T('Final FOB’u Kopyala','Copy Final FOB')}" aria-label="${T('Final FOB’u Kopyala','Copy Final FOB')}"><svg class="ic" aria-hidden="true"><use href="#i-copy"/></svg></button></div></div></div>
        <div class="suppFobPreviewComparison" data-preview-comparison></div><div class="suppFobPreviewStatus" id="_suppFobPreviewStatus" role="status"></div>
        <details class="suppFobPreviewDetails"><summary tabindex="0">${T('Hesap detayı','Calculation details')}</summary><div class="suppFobPreviewContract" data-preview-contract></div><p class="suppFobPreviewHelp" id="_suppFobPreviewHelp">${T('Fiyat denemesi siparişi değiştirmez. Hesap, siparişin OPD, sezon, ülke ve lisansına uyan sözleşmeyi kullanır.','Price trials do not change the order. The calculation uses the contract matching the order’s OPD, season, country and license.')}</p></details>
      </div>
    </div>`;
    const input=overlay.querySelector('#_suppFobPreviewInput'),output=overlay.querySelector('#_suppFobPreviewFinal'),status=overlay.querySelector('#_suppFobPreviewStatus'),copy=overlay.querySelector('[data-preview-copy]');
    const initial=parseSuppFobPreviewValue(currentRow()['Supp. FOB']);input.value=initial==null?'':String(initial).replace('.',appLang==='en'?'.':',');
    let finalFob=null,releaseKeyboard=()=>{};
    const close=()=>{window.BLLayerSystem?.closeDialog(overlay);releaseKeyboard();overlay.remove();if(closePricePreview===close)closePricePreview=null;};
    closePricePreview=close;
    function renderPreview(){
      const current=currentRow(),preview=suppFobPricePreview(current,input.value),rule=preview.rule;
      finalFob=preview.finalFob;output.textContent=format(finalFob);copy.disabled=finalFob==null;
      input.setAttribute('aria-invalid',preview.error==='value'?'true':'false');
      const context=overlay.querySelector('[data-preview-context]');
      context.textContent=[current.License,current['Order Code']].filter(Boolean).join(' · ');
      context.title=[current['Order Code'],current['Model Name'],current['C.Code'],current.Licensor,current.License,current.Country,current.Season].filter(Boolean).join(' · ');
      overlay.querySelector('[data-preview-contract]').textContent=rule
        ?`${T('Sözleşme','Contract')}: ${rule.licensor} · ${rule.license} · OPD ${pricingRuleDateRangeLabel(rule)} · ${normalizePricingRuleSeasons(rule.seasons).length?pricingRuleSeasonLabel(rule):T('Tüm Sezonlar','All Seasons')}\nRoyalty ${rate(rule.royalty)} + ${preview.group==='TR'?'TR':T('YD','Overseas')} ${T('komisyon','commission')} ${rate(commission(rule,current.Country))} = ${rate(effectiveRoyalty(rule,current.Country))} · Hologram ${cost(hologramFor(rule,current.Country))} USD`
        :turknorm(current.Licensor)==='DTR'?T('DTR: Royalty sözleşmesi yok; Final FOB = Supp. FOB.','DTR: No royalty contract; Final FOB = Supp. FOB.'):'';
      const delta=preview.delta==null?'—':`${preview.delta>0?'+':''}${format(preview.delta)}`;
      overlay.querySelector('[data-preview-comparison]').textContent=`${T('Mevcut FOB','Current FOB')}: ${format(parseSuppFobPreviewValue(current['FOB ($)']))} · ${T('Fark','Difference')}: ${delta} USD`;
      const errors={row:T('Sipariş bulunamadı.','Order not found.'),country:T('Siparişin üretim ülkesi eksik; hesap yapılamıyor.','The order’s production country is missing; calculation is unavailable.'),rule:T('Bu siparişle eşleşen lisans sözleşmesi yok. License Royalty Hesapları altında kontrol edin.','No license contract matches this order. Check License Royalty Calculations.'),value:T('Sıfır veya pozitif bir fiyat girin (örn. 1,85).','Enter a zero or positive price (e.g. 1.85).'),invalid:T('Ülke komisyonu tanımsız veya sözleşme değerleri geçersiz. Toplam oran %100’den küçük olmalı.','The country commission is undefined or contract values are invalid. The total rate must be below 100%.')};
      status.textContent=errors[preview.error]||'';
      status.hidden=!preview.error;
    }
    input.addEventListener('input',renderPreview);
    overlay.querySelectorAll('[data-preview-close]').forEach(button=>button.addEventListener('click',close));
    overlay.addEventListener('click',event=>{if(event.target===overlay)close();});
    copy.addEventListener('click',async()=>{if(finalFob==null)return;const text=format(finalFob),ok=await copyRichToClipboard(`<span>${escapeHtml(text)}</span>`,text);showToast(ok?T('Final FOB kopyalandı.','Final FOB copied.'):T('Kopyalama başarısız.','Copy failed.'));});
    document.body.appendChild(overlay);renderPreview();
    if(window.BLLayerSystem)window.BLLayerSystem.openDialog(overlay,{trigger:trigger?.isConnected?trigger:document.getElementById(module==='orders'?'ordersTable':'cpTable'),initialFocus:'#_suppFobPreviewInput',onClose:close});
    else releaseKeyboard=window.BLUI?.bindDialogKeyboard(overlay,{onEscape:close})||(()=>{});
    input.focus();input.select();window.BLMotionPlus?.play('overlay',overlay);
  }
  window.BLSuppFobCalculator={openForRow:openSuppFobPricePreview};

  openSuppFobRulesModal=async function(ruleId){
    commitActiveTableEditor({refresh:false});
    switchTab('licensecards');
    await window.BLPerf.ensureFeature('licensecards');
    await window.initLicenseCardsPage?.();
    if(typeof ruleId==='string')window.BLLicenseCardsPage?.openRule?.(ruleId);
  };

  // app-main eski localStorage kopyasını bu script yüklenmeden önce okuduğu için
  // bir kez yeni şemaya geçir. Sunucu hidrasyonu geldiğinde aynı normalizer
  // tekrar güvenle çalışır.
  try{
    const migrated=normalizePricingRules(state.overrides&&state.overrides.pricingRules||[]);
    state.overrides.pricingRules=migrated;saveLocalPricingRules(migrated);
    syncPricingRulesToAllLoadedViews({saveCollection:false,renderCollection:false});
  }catch(error){console.warn('License Royalty v2 migration failed',error);}
})();
