'use strict';
/* Boşta bellek bırakma (#1079 WS6c): büyük bir önbellek bırakıldıktan sonra, boştaki işçide
   V8 kendiliğinden toplamaz; çöp sonraki ayırmaya dek RSS'te kalır. Bu yardımcı yalnız o
   anda, yalnız çağıran isolate'te tek seferlik tam GC yapar. --expose-gc yoksa çalışma
   anında alınır (jest-leak-detector ile aynı yöntem); alınamazsa sessizce hiçbir şey yapmaz.
   İstek yolunda çağrılmaz: 30k veri kümesinde ~0,2 sn, yalnız bu işçinin iş parçacığında. */
let collect;
function collectGarbage(){
  try{
    if(collect===undefined){
      collect=typeof global.gc==='function'?global.gc:null;
      if(!collect){require('v8').setFlagsFromString('--expose-gc');collect=require('vm').runInNewContext('gc');}
    }
    if(collect){collect();return true;}
  }catch(_){collect=null;}
  return false;
}
module.exports={collectGarbage};
