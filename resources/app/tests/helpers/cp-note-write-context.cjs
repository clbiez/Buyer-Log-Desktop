'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{extractFunction}=require('./app-main-functions');
const source=fs.readFileSync(path.join(__dirname,'../../public/app-main.js'),'utf8');
// Observe the actual row normalization and serialized note PATCH. Rendering,
// author identity and transport are outside these payload-contract tests.
module.exports=function captureRowSave(row,overrides={}){
 const writes=[],norm=value=>String(value??'').trim(),context={window:{SERVER_BACKED:true},state:{overrides:{notesmap:{},submap:{},licensormap:{},suppfobmap:{},suppfobmetamap:{},delmap:{},...overrides}},CP_NOTE_COLUMN_DEFS:[],norm,turknorm:value=>norm(value).toLocaleUpperCase('tr-TR'),lineKeyOfRow:row=>[row['Order Code'],row['Model Name'],row['C.Code']].join('|'),noteAuthorIdentity:()=>({id:'fixture',name:'Fixture'}),toISODate:value=>value,normalizePricingRuleSeasons:()=>[],lineIdentity:row=>({model:row['Model Name'],ccode:row['C.Code']}),schedulePendingOverrideWrite:(_key,_delay,run)=>run(),enqueueOverrideMutation:(_area,_url,request)=>{writes.push(JSON.parse(request.body));return Promise.resolve();}};
 vm.createContext(context);
 for(const name of ['normalizeSuppFobMeta','importedSuppFob','overrideSyncKey','syncOverrideToServer','syncOverridesFromRow'])vm.runInContext(extractFunction(source,name),context);
 context.syncOverridesFromRow(row);return {writes,overrides:context.state.overrides,key:context.lineKeyOfRow(row)};
};
