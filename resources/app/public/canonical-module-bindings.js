(function(root,factory){
  'use strict';
  if(typeof module==='object'&&module.exports)module.exports=factory;
  else{
    root.BLCanonicalModuleBindings=!!factory(root.BLCanonicalFields);
  }
})(typeof window!=='undefined'?window:globalThis,function(fields){
  'use strict';
  if(!fields||typeof fields.registerModule!=='function')return false;

  // "Supplier" is a valid ASAS synonym for Manufacturer, but Collection has
  // multiple supplier/manufacturer roles. Keep it module-scoped, never global.
  var manufacturerField=fields.field&&fields.field('manufacturer');
  if(manufacturerField&&Array.isArray(manufacturerField.aliases)){
    manufacturerField.aliases=manufacturerField.aliases.filter(function(alias){return String(alias).toLowerCase()!=='supplier';});
  }
  function extendBinding(moduleId,fieldId,keys){
    var current=fields.bindingFor(moduleId,fieldId);
    if(!current)return;
    var all=(current.keys||[]).concat(keys||[]).filter(function(key,index,list){return key&&list.indexOf(key)===index;});
    var patch={};patch[fieldId]={keys:all,semantic:current.semantic};
    fields.registerModule(moduleId,patch);
  }
  /* ASAS/Horizon parser runtime rows deliberately use compact internal keys.
     Analytics/details resolve them through the canonical registry instead of
     maintaining per-screen alias lists. */
  var ASAS_RUNTIME_KEYS={
    plmId:['plm'],orderCode:['ocode'],modelName:['model'],colourCode:['ccode'],
    country:['countryRaw'],buyingGroup:['buyerGrup'],mag:['merch'],mmyg:['ageGroup'],
    orderQuantity:['qty'],inStore:['mb'],orderPlacementDate:['opd'],exFactory:['ex']
  };
  ['cp','orders','backlog','overview','lfl'].forEach(function(moduleId){
    extendBinding(moduleId,'licensor',['Lisansör','Lisans Veren','License Owner']);
    extendBinding(moduleId,'manufacturer',['Supplier','Sub-Manufacturer','Sub Manufacturer']);
    Object.keys(ASAS_RUNTIME_KEYS).forEach(function(fieldId){extendBinding(moduleId,fieldId,ASAS_RUNTIME_KEYS[fieldId]);});
  });

  // Module-specific bindings intentionally stay outside source/import parsers.
  // They describe only how cross-module consumers read existing rows.
  fields.registerModule('quotations',{
    plmId:{keys:['plmId','PLM ID'],semantic:'plmId'},
    orderCode:{keys:['_sourceOrderCode','orderCode','Order Code'],semantic:'asasOrder'},
    modelName:{keys:['modelKod','modelCode','Model Name'],semantic:'mixedModelName'},
    category:{keys:['urunTipi','category','Category'],semantic:'productClassification'},
    colour:{keys:['colour','Colour'],semantic:'colour'},
    season:{keys:['season','Season'],semantic:'season'},
    license:{keys:['lisans','license','License'],semantic:'license'},
    country:{keys:['country','Country'],semantic:'productionCountry'},
    manufacturer:{keys:['manufacturer','Manufacturer'],semantic:'manufacturer'}
  });

  fields.registerModule('oab',{
    season:{keys:['Season','Sezon','season'],semantic:'season'},
    mag:{keys:['MAG','Merch Alt Grup Kod','mag'],semantic:'mag'},
    buyingGroup:{keys:['Buyer Group','Buying Group','Buyer Grup (TR)','buyingGroup'],semantic:'buyingGroup'},
    // OAB planning classification is related to Category but is not proven to
    // be row-for-row identical to ASAS Ürün Klasman. Same canonical concept,
    // different semantic => compatibility() safely rejects direct joins.
    category:{keys:['Klasman Tanımı','Klasman','Classification','category'],semantic:'oabPlanningClassification'}
  });
  return true;
});
