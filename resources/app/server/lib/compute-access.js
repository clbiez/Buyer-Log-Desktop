'use strict';
// Worker'a IAM deposu/credential değil, yalnız çözümlenmiş karar girdileri gider.
const crypto=require('node:crypto'),iam=require('./iam-core');
const ownership=require('./cp-field-ownership');
const fields=['buyers','mags','mmygs','buyingGroups'],identityFields=['employeeId','corporateId','buyerId','sourceId','email'];
const authorityCopies=new WeakMap();
function normalize(value){return String(value==null?'':value).trim().toLocaleUpperCase('tr-TR');}
// Karar motorları bu alanları String(value) ile karşılaştırır. İç içe kullanılmayan
// metadata/credential anahtarları normalleştirilmiş bir değerin içinde taşınmaz.
const comparable=value=>value!==null&&['object','function'].includes(typeof value)?String(value):value;
function scopeAllowsEdit(order,scopes,norm=normalize){
  if(!order)return false;
  if(scopes.all)return true;
  if(scopes.buyers.some(value=>norm(value)===norm(order.buyer)))return true;
  const configured=[[scopes.mags,order.merch],[scopes.mmygs,order.ageGroup],[scopes.buyingGroups,order.buyerGrup]].filter(([list])=>list.length);
  return configured.length>0&&configured.every(([list,value])=>String(value??'').trim()&&list.some(item=>norm(item)===norm(value)));
}
function scopeCopy(scope={}){return {...(scope.mode?{mode:comparable(scope.mode)}:{}),all:Boolean(scope.all),...Object.fromEntries(fields.map(key=>[key,Array.isArray(scope[key])?scope[key].map(comparable):[]]))};}
const hash=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
function preparationError(code){
  const stale=code==='COMPUTE_STALE_GENERATION';
  return Object.assign(Error(stale?'Yetki sürümü değişti. / Authority generation changed.':'Yetki dizini hazırlanıyor. / Authority directory is being prepared.'),{code,statusCode:stale?409:503});
}
function prepareAuthority(source,{hashAuthority,batchSize=256,yieldControl=()=>new Promise(setImmediate),isCurrent=()=>true}={}){
  if(typeof hashAuthority!=='function'||!Number.isInteger(batchSize)||batchSize<1||batchSize>1024)throw TypeError('Invalid authority preparation options');
  const original=source&&typeof source==='object'?source:{},known=authorityCopies.get(original);
  if(known)return known.ready||Promise.resolve(known);
  const pending={};authorityCopies.set(original,pending);
  pending.ready=(async()=>{
    try{
      const authority={};let processed=0;
      const yieldIfNeeded=async()=>{if(++processed>=batchSize){processed=0;await yieldControl();if(!isCurrent())throw preparationError('COMPUTE_STALE_GENERATION');}};
      for(const code of Object.keys(original)){
        const sourceRows=original[code],rows=[];
        Object.defineProperty(authority,code,{value:rows,enumerable:true,writable:true,configurable:true});
        if(Array.isArray(sourceRows))for(const row of sourceRows){
          rows.push(!row||typeof row!=='object'?row:Object.fromEntries(['buyer','merch','ageGroup','buyerGrup'].map(key=>[key,comparable(row[key])])));
          await yieldIfNeeded();
        }
        await yieldIfNeeded();
      }
      await yieldControl();if(!isCurrent())throw preparationError('COMPUTE_STALE_GENERATION');
      const authorityHash=await hashAuthority(authority);
      if(!isCurrent())throw preparationError('COMPUTE_STALE_GENERATION');
      if(typeof authorityHash!=='string'||!/^[a-f0-9]{64}$/.test(authorityHash))throw Error('Invalid authority digest');
      const prepared={authority,authorityHash};authorityCopies.set(original,prepared);return prepared;
    }catch(error){if(authorityCopies.get(original)===pending)authorityCopies.delete(original);throw error;}
  })();return pending.ready;
}
function copyAuthority(source){
  const original=source&&typeof source==='object'?source:{};
  let cached=authorityCopies.get(original);if(cached){if(!cached.authorityHash)throw preparationError('COMPUTE_ACCESS_NOT_READY');return cached;}
  const authority=Object.fromEntries(Object.entries(original).map(([code,rows])=>[code,Array.isArray(rows)?rows.map(row=>{
    // Falsy bozuk satırların eski every(canEditOrder) sonucunu değiştirme.
    if(!row||typeof row!=='object')return row;
    return Object.fromEntries(['buyer','merch','ageGroup','buyerGrup'].map(key=>[key,comparable(row[key])]));
  }):[]]));
  cached={authority,authorityHash:hash(authority)};authorityCopies.set(original,cached);return cached;
}
function createAccessContext({userId,systemRole,manageAll,viewScope,editScopes,authority,profiles=[]}){
  const copied=copyAuthority(authority);
  const ownershipProfiles=profiles.filter(Boolean).map(profile=>({id:comparable(profile.id),username:comparable(profile.username),displayName:comparable(profile.displayName),
    stableIds:Object.fromEntries(identityFields.filter(key=>profile.stableIds&&Object.hasOwn(profile.stableIds,key)).map(key=>[key,comparable(profile.stableIds[key])]))}));
  const context={userId:String(userId??''),systemRole:String(systemRole??''),manageAll:Boolean(manageAll),viewScope:scopeCopy(viewScope),editScopes:scopeCopy(editScopes),
    ...copied,ownershipProfiles};
  context.accessHash=hash([context.userId,context.systemRole,context.manageAll,context.viewScope,context.editScopes,context.authorityHash,ownershipProfiles]);
  return context;
}
function filterRows(context,rows){return (Array.isArray(rows)?rows:[]).filter(row=>iam.rowInScope(row,context.viewScope));}
function canEditCode(context,orderCode){
  if(context.manageAll)return true;
  const code=Number(orderCode);if(!Number.isFinite(code))return false;
  const rows=context.authority[String(code)];
  return Array.isArray(rows)&&rows.length>0&&rows.every(row=>scopeAllowsEdit(row,context.editScopes));
}
function sharedRows(context,rows){
  const rowLineKey=require('./parse').rowLineKey,resolve=ownership.createOwnershipResolver(context.authority,context.ownershipProfiles),byCode=new Map();
  return (rows||[]).map(row=>{const code=row['Order Code'];if(!byCode.has(code))byCode.set(code,resolve({recordId:'cp-order:'+rowLineKey(row),userId:context.userId,systemRole:context.systemRole}).allowed);return {...row,_canEditShared:byCode.get(code)};});
}
module.exports={normalize,scopeAllowsEdit,createAccessContext,prepareAuthority,filterRows,canEditCode,sharedRows};
