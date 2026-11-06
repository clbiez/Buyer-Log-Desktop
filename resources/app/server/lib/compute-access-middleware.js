'use strict';
function createComputeAccessMiddleware({prepare,profileFor}){
  const targets=/^\/api\/(?:data(?:\/|$)|page-projection(?:\/|$)|backlog(?:[\/-]|$)|cp-shared-edit(?:\/|$)|model-images\/registry\/cp(?:\/|$))/i;
  return (req,_res,next)=>{
    if(!req.currentUser||!targets.test(String(req.path||req.url||'').split('?')[0]))return next();
    const id=String(req.currentUser.id);
    return Promise.resolve().then(prepare).then(()=>{
      const live=profileFor(req);
      if(!live||String(live.id)!==id||live.enabled===false||live.status!=='ACTIVE')throw Object.assign(Error('Oturumunuz artık geçerli değil. / Your session is no longer valid.'),{code:'SESSION_REQUIRED',statusCode:401});
      req.currentUser=live;return next();
    }).catch(next);
  };
}
module.exports={createComputeAccessMiddleware};
