'use strict';
/* Public holidays for Office (world clock / production-country calendar).
   Same holiday service as /api/world-clock-holidays: only an ISO country code
   and a year leave Buyer Log; no business data. Read only. */
const {object,string,array}=require('./agent-capability-contract'),{error}=require('./agent-office-store');
// The screen decides "public holiday here" from these flags (overview-launchpad
// holidayIsPublic / holidayApplies); they are passed on, not dropped.
const row=object({date:{...string(10),pattern:'^\\d{4}-\\d{2}-\\d{2}$'},name:string(300),localName:string(300),nationalHoliday:{type:'boolean'},global:{type:'boolean'},
  subdivisionCodes:{type:['array','null'],items:string(20),maxItems:100},holidayTypes:array(string(40),10),estimated:{type:'boolean'}});
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
      // The service does not throw on a provider outage: it returns source
      // 'unavailable' (plus estimated Islamic dates). That is not a calendar.
      if(!result||result.source==='unavailable'||result.ok===false)throw error('OFFICE_HOLIDAY_UNAVAILABLE',503);
      return {countryCode:result.countryCode,year:result.year,holidays:(result.rows||[]).slice(0,200).map(r=>({date:r.date,name:String(r.name||''),localName:String(r.localName||''),
        nationalHoliday:r.nationalHoliday!==false,global:r.global!==false,subdivisionCodes:Array.isArray(r.subdivisionCodes)?r.subdivisionCodes.slice(0,100).map(v=>String(v).slice(0,20)):null,
        holidayTypes:(Array.isArray(r.holidayTypes)?r.holidayTypes:['Public']).slice(0,10).map(v=>String(v).slice(0,40)),estimated:r.estimated===true})),source:String(result.source||''),stale:result.stale===true};}});
}
module.exports={registerHolidayTools};
