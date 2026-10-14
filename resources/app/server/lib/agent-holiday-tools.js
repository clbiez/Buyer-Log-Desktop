'use strict';
/* Public holidays for Office (world clock / production-country calendar).
   Same holiday service as /api/world-clock-holidays: only an ISO country code
   and a year leave Buyer Log; no business data. Read only. */
const {object,string,array}=require('./agent-capability-contract'),{error}=require('./agent-office-store');
const row=object({date:{...string(10),pattern:'^\\d{4}-\\d{2}-\\d{2}$'},name:string(300),localName:string(300)});
const output={...object({verified:{enum:[true]},data:{...object({countryCode:string(2),year:{type:'integer'},holidays:array(row,200),source:string(80),stale:{type:'boolean'}}),required:['countryCode','year','holidays']}}),required:['verified','data']};
function registerHolidayTools(registry,deps){
  registry.registerCapability({id:'overview.holidays.read',module:'overview',operation:'READ',risk:'read',areas:['overview'],agentAreas:['overview'],
    label:{tr:'Ülke resmi tatillerini oku',en:'Read country public holidays'},
    dataScope:'public holiday calendar for one ISO country and year; no Buyer Log data is sent',
    inputSchema:{...object({countryCode:{...string(2),pattern:'^[A-Za-z]{2}$'},year:{type:'integer',minimum:2000,maximum:2100}}),required:['countryCode','year']},
    outputSchema:output,dryRunOutputSchema:output,
    read:async(args,ctx)=>{ctx.assertAuthority?.();let result;
      try{result=await deps.holidayService.getYear({countryCode:args.countryCode.toUpperCase(),year:args.year});}
      catch(err){throw error(err&&err.code==='HOLIDAY_INPUT_INVALID'?'OFFICE_TASK_INVALID':'OFFICE_HOLIDAY_UNAVAILABLE',err&&err.code==='HOLIDAY_INPUT_INVALID'?422:503);}
      ctx.assertAuthority?.();
      return {countryCode:result.countryCode,year:result.year,holidays:(result.rows||[]).slice(0,200).map(r=>({date:r.date,name:String(r.name||''),localName:String(r.localName||'')})),source:String(result.source||''),stale:result.stale===true};}});
}
module.exports={registerHolidayTools};
