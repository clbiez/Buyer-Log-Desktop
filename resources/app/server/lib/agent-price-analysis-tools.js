'use strict';
/* Price & Supplier Analysis (Horizon source) for Office. Same rows as
   /api/data/price-analysis (current IAM scope, effective Horizon, date
   overrides), the same canonical observation builder and the same insights
   engine as the screen (public/price-supplier-insights-engine.js). Read only. */
const {object,string,array}=require('./agent-capability-contract'),{error}=require('./agent-office-store');
const Prices=require('../../public/price-supplier-insights-engine'),fields=require('./canonical-fields'),{aggregateSupplier}=require('./agent-office-decision-support');
const count={type:'integer',minimum:0},num={type:['number','null']},label=string(300);
const filters=object(Object.fromEntries(Prices.FILTER_DIMENSIONS.map(dim=>[dim,{...array(string(300),100),minItems:1}])));
const place=object({key:label,name:label,volume:num,previousVolume:num,share:num,previousShare:num,shareChange:num,records:count,previousRecords:count,price:num,priceChange:num});
const output={...object({verified:{enum:[true]},data:{...object({priceType:{enum:['finalFob','supplierFob']},currency:string(8),currencies:array(string(8),50),seasons:array(string(80),200),currentSeason:string(80),previousSeason:string(80),hasComparison:{type:'boolean'},
  groupBy:string(40),totals:{type:'object'},manufacturers:array({type:'object'},100),omittedManufacturers:count,countries:array(place,30),groups:array({type:'object'},30),records:count,loadedAt:{type:['string','null'],maxLength:60}}),required:['priceType','currency','totals','manufacturers','records']}}),required:['verified','data']};
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
      const model=Prices.analyze(dataset,{currency:args.currency,currentSeason:args.currentSeason??periods.currentSeason,previousSeason:args.previousSeason??periods.previousSeason,groupBy:args.groupBy,filters:args.filters,minSample:2});
      const limit=args.limit||25,list=model.manufacturers.filter(m=>m.records>0||m.previousRecords>0);
      return {priceType,currency:model.currency,currencies:model.currencies,seasons,currentSeason:model.currentSeason,previousSeason:model.previousSeason,hasComparison:model.hasComparison,groupBy:model.groupBy,totals:model.totals,
        manufacturers:list.slice(0,limit).map(aggregateSupplier),omittedManufacturers:Math.max(0,list.length-limit),
        countries:model.countries.slice(0,30).map(c=>project(c,['key','name','volume','previousVolume','share','previousShare','shareChange','records','previousRecords','price','priceChange'])),
        groups:model.groups.slice(0,30).map(g=>({...project(g,['key','name','volume','share','price','models']),suppliers:(g.suppliers||[]).slice(0,10).map(s=>project(s,['key','name','price','index','volume','share','models','eligible']))})),
        records:dataset.records.length,loadedAt:source.loadedAt||null};
    }});
}
module.exports={registerPriceAnalysisTools};
