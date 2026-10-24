'use strict';
// Shared model images remain a module resource. Recipient-local Collection
// replicas carry an explicit owner marker and need the same policy on every URL.
function assertAccess(userAccess,profile,found,{write=false}={}){
 const rowId=String(found?.item?.rowId||''),prefix='collection-shared:';
 if(!rowId.startsWith(prefix))return '';
 const owner=rowId.slice(prefix.length).split(':')[0],level=owner&&userAccess.collectionAccessLevel(profile,owner);
 if(!level||write&&level!=='edit')throw Object.assign(new Error('Bu paylaşılan Koleksiyon görseline erişim izniniz yok. / You do not have permission to access this shared Collection image.'),{code:'COLLECTION_ACCESS_DENIED',statusCode:403});
 return owner;
}
module.exports={assertAccess};
