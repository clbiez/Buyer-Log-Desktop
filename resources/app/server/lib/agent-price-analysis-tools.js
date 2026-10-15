'use strict';
/* Price & Supplier Analysis (Horizon source) for Office. Same rows as
   /api/data/price-analysis (current IAM scope, effective Horizon, date
   overrides), the same canonical observation builder and the same insights
   engine as the screen (public/price-supplier-insights-engine.js). Read only. */
const {object,string,array}=require('./agent-capability-contract'),{error}=require('./agent-office-store');
const Prices=require('../../public/price-supplier-insights-engine'),fields=require('./canonical-fields'),{aggregateSupplier}=require('./agent-office-decision-support');
const count={type:'integer',minimum:0},num={type:['number','null']},label=string(300);
const filters=object(Object.fromEntries(Prices.FILTER_DIMENSIONS.map(dim=>[dim,{...array({...string(300),minLength:1},100),minItems:1}])));
const place=object({key:label,name:label,volume:num,previousVolume:num,share:num,previousShare:num,shareChange:num,records:count,previousRecords:count,price:num,priceChange:num});
const supplierGroup=object({key:label,name:label,volume:num,previousVolume:num,records:count,price:num,models:count,index:num,groupShare:num,priceChange:num});
const supplier=object({key:label,name:label,volume:num,previousVolume:num,share:num,previousShare:num,volumeChange:num,price:num,previousPrice:num,models:count,priceLevel:num,priceChange:num,priceChangeCoverage:num,records:count,previousRecords:count,status:string(20),volumeDelta:num,groups:array(supplierGroup,8),omittedGroups:count});
const group=object({key:label,name:label,volume:num,share:num,price:num,models:count,suppliers:array(object({key:label,name:label,price:num,index:num,volume:num,share:num,models:count,eligible:{type:'boolean'}}),10)});
const output={...object({verified:{enum:[true]},data:{...object({priceType:{enum:['finalFob','supplierFob']},currency:string(8),currencies:array(string(8),50),seasons:array(string(80),200),currentSeason:string(80),previousSeason:string(80),hasComparison:{type:'boolean'},
  groupBy:string(40),totals:object({volume:num,previousVolume:num,volumeChange:num,price:num,previousPrice:num,marketPriceChange:num,models:count,records:count,manufacturers:count,newManufacturers:count,exitManufacturers:count,countries:count,top3Share:num}),
  manufacturers:array(supplier,100),omittedManufacturers:count,countries:array(place,30),groups:array(group,30),records:count,loadedAt:{type:['string','null'],maxLength:60}}),required:['priceType','currency','totals','manufacturers','records']}}),required:['verified','data']};
const project=(value,keys)=>Object.fromEntries(keys.filter(k=>value[k]!==undefined).map(k=>[k,value[k]]));
function registerPriceAnalysisTools(registry,deps){
  registry.registerCapability({id:'priceanalysis.insights.read',module:'priceanalysis',operation:'READ',risk:'read',areas:['priceanalysis'],agentAreas:['priceanalysis'],
    label:{tr:'Fiyat ve üretici analizini oku',en:'Read price and supplier analysis'},
    dataScope:'current IAM scope and effective Horizon of the Price & Supplier Analysis source; aggregates only',
    inputSchema:object({priceType:{enum:['finalFob','supplierFob']},currency:string(8),currentSeason:string(80),previousSeason:string(80),groupBy:{enum:Prices.GROUP_DIMENSIONS},filters,limit:{type:'integer',minimum:1,maximum:100}}),
    outputSchema:output,dryRunOutputSchema:output,
    read:async(args,ctx)=>{
      ctx.assertAuthority?.();
      const source=await deps.rows(ctx.profile);ctx.assertAuthority?.();
      if(source.sourceFilterRequired)throw error('OFFICE_SOURCE_FILTER_REQUIRED',409);
      const priceType=args.priceType||'finalFob';
      const dataset=Prices.prepare(source.rows.map((row,index)=>Prices.orderPriceObservation(row,'orders',priceType,index,fields)));
      const seasons=Prices.seasons(dataset),periods=Prices.defaultPeriods(seasons);
      // A filter value that normalizes to empty would silently drop the filter.
      for(const values of Object.values(args.filters||{}))if(values.some(value=>!Prices.keyOf(value)))throw error('OFFICE_TASK_INVALID',422);
      // Same comparison season as the screen: the season before the chosen one.
      const currentSeason=args.currentSeason??periods.currentSeason,previousSeason=args.previousSeason??(args.currentSeason?Prices.previousSeason(args.currentSeason,seasons):periods.previousSeason);
      const model=Prices.analyze(dataset,{currency:args.currency,currentSeason,previousSeason,groupBy:args.groupBy,filters:args.filters,minSample:2});
      const limit=args.limit||25,list=model.manufacturers.filter(m=>m.records>0||m.previousRecords>0);
      return {priceType,currency:model.currency,currencies:model.currencies,seasons,currentSeason:model.currentSeason,previousSeason:model.previousSeason,hasComparison:model.hasComparison,groupBy:model.groupBy,totals:model.totals,
        manufacturers:list.slice(0,limit).map(aggregateSupplier),omittedManufacturers:Math.max(0,list.length-limit),
        countries:model.countries.slice(0,30).map(c=>project(c,['key','name','volume','previousVolume','share','previousShare','shareChange','records','previousRecords','price','priceChange'])),
        groups:model.groups.slice(0,30).map(g=>({...project(g,['key','name','volume','share','price','models']),suppliers:(g.suppliers||[]).slice(0,10).map(s=>project(s,['key','name','price','index','volume','share','models','eligible']))})),
        records:dataset.records.length,loadedAt:source.loadedAt||null};
    }});
  /* Fiyata gönderme önerisi: seçilen koleksiyon modelleri, klasmanında ortalamanın altında
     fiyat veren üreticilerle eşlenir. Okuma; e-posta ve teklif kaydı Send to Pricing'de sahibin onayıyla oluşur. */
  if(typeof deps.collectionRows!=='function')return;
  const {SUPPORTED_OPERATORS,applyResolvedFilters}=require('./agent-tool-registry'),{suggestSuppliers}=require('./pricing-supplier-match');
  const id=string(160),model=object({rowId:id,plmId:string(40),model:string(160),colourCode:string(40),classification:string(120)});
  const bucket=object({count,models:array(model,40)});
  const suggestOutput={...object({verified:{enum:[true]},data:{...object({priceType:{enum:['finalFob','supplierFob']},currency:string(8),currentSeason:string(80),maxIndex:{type:'number'},perGroup:count,collectionModels:count,assignedModels:count,
    suppliers:array(object({key:label,name:label,classifications:array(object({name:label,index:num,price:num,groupPrice:num,pricedModels:count}),30),modelCount:count,models:array(model,200),modelsTruncated:{type:'boolean'}}),30),omittedSuppliers:count,
    unmatched:object({'no-classification':bucket,'no-price-data':bucket,'not-comparable':bucket,'none-below-threshold':bucket})}),required:['currentSeason','suppliers','unmatched','assignedModels']}}),required:['verified','data']};
  registry.registerCapability({id:'pricing.suppliers.suggest',module:'priceanalysis',operation:'READ',risk:'read',areas:['koleksiyon','priceanalysis'],agentAreas:['collection','priceanalysis'],
    label:{tr:'Fiyata gönderilecek modeller için avantajlı üreticileri öner',en:'Suggest advantageous suppliers for models to send to pricing'},
    description:'Matches the filtered Collection models to suppliers whose average price in the same product classification is below the classification average (index = % difference, negative is cheaper; only suppliers with at least 2 priced models). Same engine as the Price & Supplier Analysis screen. Use it before preparing pricing requests.',
    dataScope:'owner Collection rows and the Price & Supplier Analysis source in the current IAM scope',
    inputSchema:object({filters:array({...object({field:string(160),operator:{enum:SUPPORTED_OPERATORS},value:{}}),required:['field','operator']},50),priceType:{enum:['finalFob','supplierFob']},currency:string(8),currentSeason:string(80),
      maxIndex:{type:'number',minimum:-100,maximum:100},perGroup:{type:'integer',minimum:1,maximum:5}}),
    outputSchema:suggestOutput,dryRunOutputSchema:suggestOutput,
    read:async(args,ctx)=>{
      ctx.assertAuthority?.();
      const [source,rows]=await Promise.all([deps.rows(ctx.profile),deps.collectionRows(ctx.ownerId,ctx.profile)]);ctx.assertAuthority?.();
      if(source.sourceFilterRequired)throw error('OFFICE_SOURCE_FILTER_REQUIRED',409);
      const collectionRows=applyResolvedFilters('collection',rows,args.filters,ctx.now);
      return suggestSuppliers({collectionRows,priceRows:source.rows,fields,priceType:args.priceType||'finalFob',currency:args.currency,currentSeason:args.currentSeason,maxIndex:args.maxIndex??0,perGroup:args.perGroup||3});
    }});
}
module.exports={registerPriceAnalysisTools};
