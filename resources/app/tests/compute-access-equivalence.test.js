'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const access=require('../server/lib/user-access'),iam=require('../server/lib/iam-core');
const ownership=require('../server/lib/cp-field-ownership'),parse=require('../server/lib/parse');
const compute=require('../server/lib/compute-access');
const profiles=[
  {id:'a',role:'buyer',systemRole:'buyer',username:'Buyer A',displayName:'Buyer A',enabled:true,status:'ACTIVE',mags:['M1'],mmygs:['A1'],buyingGroups:['G1'],stableIds:{employeeId:'A',password:'SYNTHETIC_SECRET'},passwordHash:'SYNTHETIC_SECRET',dataScope:{mode:'SELF'}},
  {id:'b',role:'buyer',systemRole:'buyer',username:'Buyer B',displayName:'Buyer B',enabled:true,status:'ACTIVE',mags:['M2'],mmygs:['A2'],buyingGroups:['G2'],supervisorId:'a',managerId:'a',dataScope:{mode:'SELF'}},
];
const orders=Array.from({length:64},(_,i)=>({ocode:100+i,buyer:i%2?'Buyer A':'Buyer B',merch:i%3?'M1':'M2',ageGroup:i%5?'A1':'A2',buyerGrup:i%7?'G1':'G2'}));
const store={moderator:{id:'moderator',role:'moderator',systemRole:'moderator',enabled:true,status:'ACTIVE'},users:profiles,orderAccess:{123:[orders[1],orders[0]],124:[orders[1]]}};
function context(profile,authority=store.orderAccess){return compute.createAccessContext({userId:profile.id,systemRole:profile.systemRole,
  manageAll:access.hasPermission(profile,'manageAllOrders',store),viewScope:iam.effectiveDataScope(profile,store),editScopes:access.effectiveScopes(profile,store),authority,profiles:[store.moderator,...profiles]});}
// Bağımsız oracle: worker'a taşınmadan önceki canEditOrder dalı.
function oldScopeAllowed(order,scopes){
  if(scopes.all)return true;
  if(scopes.buyers.some(value=>access.norm(value)===access.norm(order.buyer)))return true;
  const configured=[[scopes.mags,order.merch],[scopes.mmygs,order.ageGroup],[scopes.buyingGroups,order.buyerGrup]].filter(([list])=>list.length);
  return configured.length>0&&configured.every(([list,value])=>String(value??'').trim()&&list.some(item=>access.norm(item)===access.norm(value)));
}
test('view filtering and edit scope preserve all IAM modes and legacy empty/custom scopes',()=>{
  const variants=['ALL','CUSTOM','SELF','TEAM','MMYG','MAG'].map(mode=>({...profiles[0],dataScope:{mode,buyers:['Buyer B'],mags:['M2'],mmygs:[],buyingGroups:[]}}));
  variants.push({...profiles[0],dataScope:undefined,scopeMode:'custom',customScopes:{buyers:[],mags:[],mmygs:[],buyingGroups:[]}});
  variants.push({...profiles[0],dataScope:undefined,scopeMode:'auto',autoScopes:{buyers:['Buyer A'],mags:['M2'],mmygs:['A2'],buyingGroups:['G2']}});
  variants.push(store.moderator);
  for(const profile of variants){
    const ctx=context(profile);assert.deepEqual(compute.filterRows(ctx,orders),iam.filterRows(profile,orders,store));
    for(const row of orders){
      const expected=access.hasPermission(profile,'manageAllOrders',store)||oldScopeAllowed(row,access.effectiveScopes(profile,store));
      assert.equal(compute.scopeAllowsEdit(row,ctx.editScopes),oldScopeAllowed(row,ctx.editScopes));
      assert.equal(ctx.manageAll||compute.scopeAllowsEdit(row,ctx.editScopes),expected);
      assert.equal(access.canEditOrder(profile,row,store),expected);
    }
  }
});
test('worker normalization is identical to the existing Turkish scope normalizer',()=>{
  for(const value of [null,undefined,0,false,'  i I İ ı ş Ş ç Ç  ',...Array.from({length:1024},(_,i)=>String.fromCodePoint(i)+'  x')])assert.equal(compute.normalize(value),access.norm(value));
});
test('order-code editing uses every Moderator authority line and cannot trust a buyer source row',()=>{
  const profile={...profiles[0],mags:[],mmygs:[],buyingGroups:[]},ctx=context(profile);
  assert.equal(compute.canEditCode(ctx,123),false);assert.equal(compute.canEditCode(ctx,124),true);
  assert.equal(compute.canEditCode(ctx,'00124'),true);assert.equal(compute.canEditCode(ctx,125),false);assert.equal(compute.canEditCode(ctx,'invalid'),false);
  assert.equal(compute.scopeAllowsEdit({buyer:'Buyer A'},ctx.editScopes),true,'a forged local Buyer row is insufficient for the mixed-owner code');
  assert.equal(compute.canEditCode(context(store.moderator),123),true);
});
test('legacy shared edit flags retain exact line-key and first-code semantics',()=>{
  const rows=[{'Order Code':123,Model:'X','Color Code':'R'},{'Order Code':124,Model:'Y','Color Code':'B'},{'Order Code':123,Model:'Other','Color Code':'Y'}];
  for(const profile of [...profiles,store.moderator]){
    const resolve=ownership.createOwnershipResolver(store.orderAccess,[store.moderator,...profiles]),byCode=new Map();
    const expected=rows.map(row=>{const code=row['Order Code'];if(!byCode.has(code))byCode.set(code,resolve({recordId:'cp-order:'+parse.rowLineKey(row),userId:profile.id,systemRole:profile.systemRole}).allowed);return {...row,_canEditShared:byCode.get(code)};});
    assert.deepEqual(compute.sharedRows(context(profile),rows),expected);
  }
});
test('compute access context excludes credentials and has a stable, changing authority hash',()=>{
  const authority={124:[{buyer:'Buyer A',merch:'M1',ageGroup:'A1',buyerGrup:'G1',password:'SYNTHETIC_SECRET'}]};
  const ctx=context(profiles[0],authority);assert.doesNotMatch(JSON.stringify(ctx),/SYNTHETIC_SECRET|passwordHash|credentialRevision/);
  assert.match(ctx.authorityHash,/^[a-f0-9]{64}$/);assert.equal(context(profiles[0],JSON.parse(JSON.stringify(authority))).authorityHash,ctx.authorityHash);
  assert.notEqual(context(profiles[0],{124:[{buyer:'Buyer B'}]}).authorityHash,ctx.authorityHash);
});
test('server edit-scope branch uses the same pure helper as workers',()=>{
  const source=fs.readFileSync(path.join(__dirname,'../server/lib/user-access.js'),'utf8');
  const start=source.indexOf('function canEditOrder('),end=source.indexOf('function catalogsFromStore',start);
  assert.match(source.slice(start,end),/scopeAllowsEdit/);
});
test('nested unused metadata cannot ride inside normalized identity or scope values',()=>{
  const nested={token:'SYNTHETIC_NESTED_SECRET'},scopes={buyers:[nested],mags:[],mmygs:[],buyingGroups:[]};
  const ctx=compute.createAccessContext({userId:'a',systemRole:'buyer',manageAll:false,viewScope:scopes,editScopes:scopes,
    authority:{99:[{buyer:nested}]},profiles:[{id:'a',username:nested,stableIds:{employeeId:nested}}]});
  assert.doesNotMatch(JSON.stringify(ctx),/SYNTHETIC_NESTED_SECRET/);
  assert.equal(compute.scopeAllowsEdit(ctx.authority['99'][0],ctx.editScopes),oldScopeAllowed({buyer:nested},scopes));
  assert.deepEqual(compute.filterRows(ctx,[{buyer:nested}]),iam.filterRows({dataScope:{mode:'CUSTOM',...scopes}},[{buyer:nested}],store));
});
