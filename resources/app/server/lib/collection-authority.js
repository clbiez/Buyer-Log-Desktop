'use strict';
// Both preview and the persistent save worker use the application's current IAM API.
function assertCollectionAccess(access,profile,ownerId,write=false) {
  const level=profile&&access.collectionAccessLevel(profile,ownerId);
  if(!profile||profile.enabled===false||!access.hasArea(profile,'koleksiyon')||!level||write&&(level!=='edit'||String(profile.id)!==String(ownerId)&&!access.hasCapability(profile,'COLLECTIONS.EDIT')))
    throw Object.assign(new Error('Collection access denied.'),{code:'OFFICE_TOOL_FORBIDDEN',statusCode:403});
  return level;
}
module.exports={assertCollectionAccess};
