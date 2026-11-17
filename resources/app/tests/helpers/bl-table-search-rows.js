'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../../public/app-main.js'),'utf8');
function fn(name){const match=source.match(new RegExp('\\nfunction '+name+'\\([^]*?\\n\\}'));if(!match)throw Error(name);return match[0];}
function decl(name){const match=source.match(new RegExp('const '+name+'\\s*=[^]*?;\\n'));if(!match)throw Error(name);return match[0];}
function createRows(){
 const search=require('./bl-table-search').createTableSearch(),fields=require('../../public/canonical-fields'),dates=require('../../public/date-dimension');
 const context={window:{BLTableSearch:search,BLCanonicalFields:fields,BLDateDimension:dates},norm:v=>String(v??'').trim(),turknorm:v=>search.fold(v).toUpperCase(),kolEffectiveValue:(row,key)=>row[key]};
 vm.createContext(context);
 const code=['STATUS_EN','STATUS_TR','TR_EN_DICT','KOL_DURUM_EN','KOL_EN_TR_DICT','KOL_MONTHS_TR','KOL_MONTHS_EN','CP_BASE_SEARCH_KEYS','CP_CANONICAL_SEARCH_FIELDS'].map(decl).join('\n')+
 ['cpCanonicalSearchKeys','kolMonthCode','kolWeekCode','kolWeekCodeForDate','tableSearchDisplayValues','cpSearchHaystack','kolSearchHaystack','tableSearchPeriods','tableSearchOptions','tableSearchOrderOptions'].map(fn).join('\n')+
 "\nconst CP_SEARCH_KEYS=Array.from(new Set([...CP_BASE_SEARCH_KEYS,...cpCanonicalSearchKeys(window.BLCanonicalFields,CP_CANONICAL_SEARCH_FIELDS)]));const _cpSearchCache=new WeakMap(),_kolSearchCache=new WeakMap(),_tableSearchPeriodCache=new WeakMap();\n"+decl('KOL_SEARCH_KEYS');
 vm.runInContext(code,context);return {...context,search,fields,dates};
}
module.exports={createRows};
