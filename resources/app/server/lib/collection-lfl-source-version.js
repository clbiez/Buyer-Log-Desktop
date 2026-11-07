'use strict';
// Mevcut kural: LFL zamanı yoksa model snapshot'ının zamanı kullanılır.
// Satır varlığı ayrı bir koşuldur; boş LFL bu sürüm sözleşmesini değiştirmez.
function collectionLflSourceVersion(source){
 return source&&(source.lflLoadedAt||source.loadedAt||source.savedAt)||null;
}
module.exports={collectionLflSourceVersion};
