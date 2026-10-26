(function(root,factory){
  'use strict';
  if(typeof module==='object'&&module.exports)module.exports={createModelImageCache:factory};
  else root.BLModelImageCache=factory(root);
})(typeof window!=='undefined'?window:globalThis,function createModelImageCache(env,options){
  'use strict';

  options=options||{};

  const CACHE_NAME='buyer-log-model-thumbnails-v1';
  const THUMB_MAX_DIMENSION=Math.max(32,Number(options.thumbnailMaxDimension)||96);
  const THUMB_MEMORY_LIMIT=Math.max(1,Number(options.thumbnailMemoryLimit)||256);
  const ORIGINAL_MEMORY_LIMIT=Math.max(1,Number(options.originalMemoryLimit)||24);
  const DISK_LIMIT=Math.max(20,Number(options.diskLimit)||600);
  const thumbnailMemory=new Map(),originalMemory=new Map(),thumbnailInFlight=new Map(),originalInFlight=new Map();
  const RequestCtor=env.Request||globalThis.Request,ResponseCtor=env.Response||globalThis.Response;

  const clean=value=>String(value==null?'':value).trim();
  // Registry anahtarları server/lib/parse.js içindeki turknorm ile üretilir.
  // Locale upper-case (özellikle i/İ) kullanmak istemci ile sunucunun farklı
  // anahtar üretmesine yol açar; model görseli diskte olduğu halde görünmez.
  const upper=value=>{
    let text=clean(value).toUpperCase();
    const pairs=[['İ','I'],['I','I'],['Ş','S'],['Ç','C'],['Ö','O'],['Ü','U'],['Ğ','G']];
    pairs.forEach(([a,b])=>{text=text.split(a).join(b);});
    return text.replace(/\s+/g,' ').trim();
  };
  const normalizeModelId=value=>{
    let text=clean(value);
    if(/^\d+(?:\.0+)?$/.test(text))text=text.replace(/\.0+$/,'').replace(/^0+(?=\d)/,'');
    return upper(text);
  };
  const normalizeColourCode=value=>upper(value);
  const identity=(modelId,colourCode)=>`${normalizeModelId(modelId)}|${normalizeColourCode(colourCode)}`;
  const canonicalImageKey=(modelId,colourCode,colourName='')=>{
    const plm=normalizeModelId(modelId),colour=normalizeColourCode(colourCode),name=normalizeColourCode(colourName);
    const base=plm&&colour?`plm:${plm}|colour:${colour}`:'';
    return base&&name?`${base}|name:${name}`:base;
  };
  // Bazı view'lar renk adını taşımaz; PLM ingest ise varsa name-specific key
  // yazar. Kod anahtarı yoksa aynı PLM+Renk Kodu altındaki named kayıt TEK
  // bir ref'e çözülüyorsa güvenle kullanılır. Birden çok farklı ref varsa
  // yanlış modele/renge görsel bağlamamak için çözüm yapılmaz.
  const namedColourEntries=(map,modelId,colourCode,index)=>{
    const base=canonicalImageKey(modelId,colourCode);
    if(!base||!map||typeof map!=='object')return [];
    const prefix=`${base}|name:`;
    const keys=index?(index.get(base)||[]):Object.keys(map).filter(key=>key.startsWith(prefix));
    return keys.filter(key=>Object.prototype.hasOwnProperty.call(map,key)).map(key=>({key,ref:clean(map[key])}));
  };
  const resolveImageRef=(map,modelId,colourCode,colourName='',index)=>{
    const key=canonicalImageKey(modelId,colourCode,colourName);
    if(key&&map&&Object.prototype.hasOwnProperty.call(map,key))return clean(map[key]);
    const fallback=canonicalImageKey(modelId,colourCode);
    if(fallback&&map&&Object.prototype.hasOwnProperty.call(map,fallback))return clean(map[fallback]);
    const entries=namedColourEntries(map,modelId,colourCode,index);
    if(entries.length){
      const refs=[...new Set(entries.map(item=>item.ref))];
      return refs.length===1?refs[0]:'';
    }
    // PLM ingest explicitly stores code-less models under plm:<id>.
    // Never borrow this key for a row with a colour code.
    const legacy=!normalizeColourCode(colourCode)&&normalizeModelId(modelId)?`plm:${normalizeModelId(modelId)}`:'';
    return legacy&&map&&Object.prototype.hasOwnProperty.call(map,legacy)?clean(map[legacy]):'';
  };
  const hasImageKey=(map,modelId,colourCode,colourName='',index)=>{
    const key=canonicalImageKey(modelId,colourCode,colourName),fallback=canonicalImageKey(modelId,colourCode);
    if(map&&((key&&Object.prototype.hasOwnProperty.call(map,key))||(fallback&&Object.prototype.hasOwnProperty.call(map,fallback))))return true;
    if(namedColourEntries(map,modelId,colourCode,index).length)return true;
    const legacy=!normalizeColourCode(colourCode)&&normalizeModelId(modelId)?`plm:${normalizeModelId(modelId)}`:'';
    return Boolean(legacy&&map&&Object.prototype.hasOwnProperty.call(map,legacy));
  };
  let registryMap={},registryNamed=new Map();
  // Rebuild on every registry publication, including mutations of the same map.
  // Stateless map helpers remain fresh; only this explicitly published registry is indexed.
  const setRegistryMap=map=>{
    registryMap=map&&typeof map==='object'?map:{};registryNamed=new Map();
    for(const key of Object.keys(registryMap)){
      const split=key.indexOf('|name:');if(split<0)continue;
      const base=key.slice(0,split),keys=registryNamed.get(base);
      if(keys)keys.push(key);else registryNamed.set(base,[key]);
    }
    return registryMap;
  };
  /* TEK GÖRSEL = TEK URL. /api/cp-images/:id ve /api/collection-images/:id
     aynı dosyayı sunar; Koleksiyon satırları ayrıca ?v=<updatedAt> taşıyordu.
     Aynı görsel CP, Orders, Koleksiyon ve Quotations'ta farklı URL'lerle
     istendiği için tarayıcı önbelleğinde ayrı girdiler oluşuyor; kayıt
     yayımlanınca CP hücreleri URL değiştirip görselleri ağdan yeniden
     indiriyordu. Görsel içeriği değişen her yazım yeni bir ref (ci_…) üretir,
     aynı bayt aynı ref'i korur: ref'in kendisi sürümdür, ek etiket gerekmez. */
  const MODEL_IMAGE_API='/api/collection-images';
  const MODEL_IMAGE_URL_RE=/^(?:https?:\/\/[^/]+)?\/api\/(?:cp|collection)-images\/([^/?#]+)(?:[?#].*)?$/i;
  const imageUrlForRef=ref=>{const value=clean(ref);return value?`${MODEL_IMAGE_API}/${encodeURIComponent(value)}`:'';};
  // Bilinen görsel API adresini (/api/cp-images, /api/collection-images, ?v=)
  // tek biçime indirir; başka her değer (data:, paylaşılan depo, dış adres)
  // olduğu gibi döner.
  const imageUrl=value=>{
    const text=clean(value);if(!text)return '';
    const match=text.match(MODEL_IMAGE_URL_RE);if(!match)return text;
    let ref=match[1];try{ref=decodeURIComponent(ref);}catch(_){}
    return imageUrlForRef(ref);
  };
  const resolveRegistrySource=(modelId,colourCode,base=MODEL_IMAGE_API,colourName='')=>{
    const ref=resolveImageRef(registryMap,modelId,colourCode,colourName,registryNamed);
    if(!ref)return '';
    return /^\/api\/(?:cp|collection)-images$/i.test(clean(base))?imageUrlForRef(ref):`${base}/${encodeURIComponent(ref)}`;
  };
  const hasRegistryKey=(modelId,colourCode,colourName='')=>hasImageKey(registryMap,modelId,colourCode,colourName,registryNamed);
  const sourceHash=value=>{
    const input=clean(value);let hash=2166136261;
    for(let i=0;i<input.length;i++){hash^=input.charCodeAt(i);hash=Math.imul(hash,16777619);}
    return (hash>>>0).toString(36);
  };
  const isSource=value=>Boolean(clean(value))&&!/^data:image\/svg\+xml/i.test(clean(value));
  const touch=(map,key)=>{if(!map.has(key))return undefined;const value=map.get(key);map.delete(key);map.set(key,value);return value;};
  const remember=(map,key,value,limit,onEvict)=>{
    if(map.has(key)){const previous=map.get(key);map.delete(key);if(previous!==value)onEvict?.(previous);}
    map.set(key,value);
    while(map.size>limit){const first=map.keys().next().value,old=map.get(first);map.delete(first);onEvict?.(old);}
    return value;
  };
  const revoke=entry=>{if(entry&&entry.url)try{env.URL?.revokeObjectURL?.(entry.url);}catch(_){}}
  const descriptor=input=>{
    const source=clean(input&&input.source),modelId=clean(input&&input.modelId),colourCode=clean(input&&input.colourCode);
    const modelIdentity=identity(modelId||source,colourCode),version=sourceHash(source);
    return {source,modelId,colourCode,identity:modelIdentity,version,key:`${modelIdentity}\u0000${version}`};
  };
  const cacheRequest=desc=>{
    if(!RequestCtor)return null;
    const origin=clean(env.location&&env.location.origin)||'http://localhost';
    return new RequestCtor(`${origin}/.buyer-log-cache/model-thumb/${encodeURIComponent(desc.identity)}/${desc.version}.webp`,{credentials:'same-origin'});
  };
  const openDisk=async()=>env.caches&&typeof env.caches.open==='function'?env.caches.open(CACHE_NAME):null;

  async function browserThumbnailer(blob){
    if(typeof env.createImageBitmap==='function'&&typeof env.OffscreenCanvas==='function'){
      const bitmap=await env.createImageBitmap(blob);
      try{
        const scale=Math.min(1,THUMB_MAX_DIMENSION/Math.max(1,bitmap.width,bitmap.height));
        const width=Math.max(1,Math.round(bitmap.width*scale)),height=Math.max(1,Math.round(bitmap.height*scale));
        const canvas=new env.OffscreenCanvas(width,height),ctx=canvas.getContext('2d',{alpha:false});
        if(!ctx)throw new Error('Thumbnail canvas is unavailable.');
        ctx.fillStyle='#fff';ctx.fillRect(0,0,width,height);ctx.drawImage(bitmap,0,0,width,height);
        return canvas.convertToBlob({type:'image/webp',quality:.72});
      }finally{try{bitmap.close?.();}catch(_){}}
    }
    if(!env.document||!env.Image||!env.URL?.createObjectURL)throw new Error('WEBP thumbnail conversion is unavailable.');
    const inputUrl=env.URL.createObjectURL(blob),image=new env.Image();
    try{
      await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=()=>reject(new Error('Image could not be decoded.'));image.src=inputUrl;});
      const scale=Math.min(1,THUMB_MAX_DIMENSION/Math.max(1,image.naturalWidth||image.width,image.naturalHeight||image.height));
      const width=Math.max(1,Math.round((image.naturalWidth||image.width)*scale)),height=Math.max(1,Math.round((image.naturalHeight||image.height)*scale));
      const canvas=env.document.createElement('canvas');canvas.width=width;canvas.height=height;
      const ctx=canvas.getContext('2d',{alpha:false});if(!ctx)throw new Error('Thumbnail canvas is unavailable.');
      ctx.fillStyle='#fff';ctx.fillRect(0,0,width,height);ctx.drawImage(image,0,0,width,height);
      return new Promise((resolve,reject)=>canvas.toBlob(out=>out?resolve(out):reject(new Error('WEBP thumbnail encoding failed.')),'image/webp',.72));
    }finally{try{env.URL.revokeObjectURL(inputUrl);}catch(_){}}
  }
  const thumbnailer=typeof options.thumbnailer==='function'?options.thumbnailer:browserThumbnailer;

  async function trimDisk(cache){
    if(!cache||typeof cache.keys!=='function')return;
    const keys=await cache.keys();
    for(let i=0;i<Math.max(0,keys.length-DISK_LIMIT);i++)await cache.delete(keys[i]);
  }
  async function getThumbnail(input){
    const desc=descriptor(input);if(!isSource(desc.source))return '';
    // Table cells intentionally use the stored source as-is. Creating a canvas
    // thumbnail here delayed every import and silently degraded the artwork.
    return desc.source;
  }
  async function preloadOriginal(input){
    const desc=descriptor(input);if(!isSource(desc.source))return '';
    if(touch(originalMemory,desc.key))return desc.source;
    if(originalInFlight.has(desc.key))return originalInFlight.get(desc.key);
    const pending=new Promise((resolve,reject)=>{
      const image=new env.Image();image.decoding='async';
      image.onload=()=>{Promise.resolve(image.decode?.()).catch(()=>{}).finally(()=>{remember(originalMemory,desc.key,{image,source:desc.source,identity:desc.identity},ORIGINAL_MEMORY_LIMIT);resolve(desc.source);});};
      image.onerror=()=>reject(new Error('Image could not be loaded.'));
      image.src=desc.source;
    }).finally(()=>originalInFlight.delete(desc.key));
    originalInFlight.set(desc.key,pending);return pending;
  }
  const blobDataUrl=blob=>new Promise((resolve,reject)=>{
    const Reader=env.FileReader||globalThis.FileReader;
    if(typeof Reader!=='function')return reject(new Error('Image reader is unavailable.'));
    const reader=new Reader();
    reader.onload=()=>resolve(clean(reader.result));
    reader.onerror=()=>reject(reader.error||new Error('Image could not be read.'));
    reader.readAsDataURL(blob);
  });
  async function officeCompatibleBlob(blob){
    const mime=clean(blob&&blob.type).split(';')[0].toLowerCase();
    if(mime==='image/jpeg'||mime==='image/png')return blob;
    if(typeof env.createImageBitmap==='function'&&typeof env.OffscreenCanvas==='function'){
      const bitmap=await env.createImageBitmap(blob);
      try{
        const canvas=new env.OffscreenCanvas(Math.max(1,bitmap.width),Math.max(1,bitmap.height)),ctx=canvas.getContext('2d',{alpha:false});
        if(!ctx)throw new Error('Clipboard image canvas is unavailable.');
        ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(bitmap,0,0);
        return canvas.convertToBlob({type:'image/png'});
      }finally{try{bitmap.close?.();}catch(_){}}
    }
    if(!env.document||!env.Image||!env.URL?.createObjectURL)throw new Error('Office-compatible image conversion is unavailable.');
    const inputUrl=env.URL.createObjectURL(blob),image=new env.Image();
    try{
      await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=()=>reject(new Error('Image could not be decoded.'));image.src=inputUrl;});
      const canvas=env.document.createElement('canvas');canvas.width=Math.max(1,image.naturalWidth||image.width);canvas.height=Math.max(1,image.naturalHeight||image.height);
      const ctx=canvas.getContext('2d',{alpha:false});if(!ctx)throw new Error('Clipboard image canvas is unavailable.');
      ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(image,0,0);
      return new Promise((resolve,reject)=>canvas.toBlob(out=>out?resolve(out):reject(new Error('PNG clipboard encoding failed.')),'image/png'));
    }finally{try{env.URL.revokeObjectURL(inputUrl);}catch(_){}}
  }
  async function getClipboardDataUrl(input){
    const desc=descriptor(input),fallbackSource=clean(input&&input.fallbackSource);
    const sources=[desc.source,fallbackSource].filter((value,index,list)=>isSource(value)&&list.indexOf(value)===index);
    let lastError=null;
    for(const source of sources){
      try{
        if(/^data:image\/(?:jpeg|png);base64,/i.test(source))return source;
        const response=await env.fetch(source,{cache:'force-cache',credentials:'same-origin'});
        if(!response||!response.ok)throw new Error(`Image request failed${response?`: ${response.status}`:''}.`);
        const compatible=await officeCompatibleBlob(await response.blob());
        return await blobDataUrl(compatible);
      }catch(error){lastError=error;}
    }
    if(lastError)throw lastError;
    return '';
  }
  function fromImage(img){return {modelId:img?.dataset?.modelId||img?.dataset?.imageKey||'',colourCode:img?.dataset?.colourCode||'',source:img?.dataset?.src||img?.currentSrc||img?.src||''};}
  async function bind(img){
    if(!img)return '';
    const input=fromImage(img),source=clean(input.source);if(!isSource(source))return '';
    const url=await getThumbnail(input);
    if(img.isConnected!==false&&clean(img.dataset&&img.dataset.src)===source){img.src=url;img.dataset.blImageLoaded='1';img.dataset.blImageFailed='0';}
    return url;
  }
  async function invalidate(input){
    const list=Array.isArray(input)?input:[input],sources=new Set(),identities=new Set();
    for(const item of list){
      if(typeof item==='string')sources.add(clean(item));
      else if(item){const desc=descriptor(item);sources.add(desc.source);identities.add(desc.identity);}
    }
    for(const [key,entry] of [...thumbnailMemory])if(sources.has(entry.source)||identities.has(entry.identity)){thumbnailMemory.delete(key);revoke(entry);}
    for(const [key,entry] of [...originalMemory])if(sources.has(entry.source)||identities.has(entry.identity))originalMemory.delete(key);
    const cache=await openDisk();if(!cache||typeof cache.keys!=='function')return;
    for(const request of await cache.keys()){
      const url=clean(request&&request.url);
      if([...identities].some(value=>url.includes(`/model-thumb/${encodeURIComponent(value)}/`))||[...sources].some(value=>value&&url.endsWith(`/${sourceHash(value)}.webp`)))await cache.delete(request);
    }
  }
  /* v10.90 — TAM SIFIRLAMA. invalidate() belirli kaynak/kimlikleri düşürür;
     "Tüm Görselleri Sil" ise hangi kimliklerin var olduğunu artık bilmediğimiz
     bir durumdur (kayıt zaten boşaltıldı). Bu yüzden bellek haritaları, object
     URL'leri ve Buyer Log'a AİT disk önbelleği (CacheStorage) bütünüyle
     bırakılır. Aksi hâlde silinen bir görsel önbellekten geri gelebilir ya da
     aynı model/renk kimliğine yeni yüklenen görsel eski kopyanın altında
     kalabilirdi. */
  async function clearAll(){
    for(const [,entry] of thumbnailMemory)revoke(entry);
    thumbnailMemory.clear();originalMemory.clear();thumbnailInFlight.clear();originalInFlight.clear();
    registryMap={};registryNamed.clear();
    try{
      if(env.caches&&typeof env.caches.delete==='function')await env.caches.delete(CACHE_NAME);
      else{const cache=await openDisk();if(cache&&typeof cache.keys==='function')for(const request of await cache.keys())await cache.delete(request);}
    }catch(_){}
    return true;
  }
  const stats=()=>({thumbnailMemoryEntries:thumbnailMemory.size,originalMemoryEntries:originalMemory.size,thumbnailInFlight:thumbnailInFlight.size,originalInFlight:originalInFlight.size});
  return {identity,normalizeModelId,normalizeColourCode,canonicalImageKey,hasImageKey,resolveImageRef,setRegistryMap,hasRegistryKey,resolveRegistrySource,imageUrl,imageUrlForRef,getThumbnail,preloadOriginal,getClipboardDataUrl,bind,fromImage,invalidate,clearAll,stats,CACHE_NAME};
});
