'use strict';
function failure(code,statusCode,tr,en){return Object.assign(Error(`${tr} / ${en}`),{code,statusCode,errorEn:en});}
function createComputeReadGuard({sessionProfile,profileById,hasArea,contextFor,accessFor,sourceTokenFor}){
  function authorized(profile,area){
    if(!profile||profile.enabled===false||profile.status!=='ACTIVE')throw failure('SESSION_REQUIRED',401,'Oturumunuz artık geçerli değil.','Your session is no longer valid.');
    if(!hasArea(profile,area))throw failure('AREA_FORBIDDEN',403,'Bu alana erişim yetkiniz yok.','You do not have access to this area.');
  }
  function stamp(profile){const context=contextFor(profile),access=accessFor(profile);return {userId:String(profile.id),contextHash:context.contextHash,accessHash:access.accessHash,sourceToken:sourceTokenFor(profile.id)};}
  function capture(req,area){
    const profile=sessionProfile(req);authorized(profile,area);const initial=stamp(profile),key=JSON.stringify(initial);
    function unchanged(current){
      authorized(current,area);
      if(JSON.stringify(stamp(current))!==key)throw failure('COMPUTE_STALE_GENERATION',409,'Veri veya yetki sürümü değişti.','The data or permission generation changed.');
      return current;
    }
    return {profile,key,...initial,assertBuild:()=>unchanged(profileById(initial.userId)),assertResponse:()=>unchanged(sessionProfile(req))};
  }
  return {capture};
}
module.exports={createComputeReadGuard};
