'use strict';
// Repeat renderer boots revalidated ~190 assets (0.6-0.8 s of 304s). index.html
// now stamps each local asset with its content hash; only a request whose hash
// matches the file's current bytes may be cached immutably.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const H=require('../server/lib/static-asset-hash');
const { createStaticGzip, cacheControlFor }=require('../server/lib/static-gzip');

function root(){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bl-asset-hash-'));
  fs.writeFileSync(path.join(dir,'app.js'),'/* app */'+'a'.repeat(2048));
  fs.mkdirSync(path.join(dir,'vendor'));fs.writeFileSync(path.join(dir,'vendor','x.css'),'b{}');
  return dir;
}
const page='<script src="app.js?v=__BL_ASSET_VERSION__&rev=3"></script><link rel="stylesheet" href="vendor/x.css?v=__BL_ASSET_VERSION__">'
  +'<script src="missing.js?v=__BL_ASSET_VERSION__"></script><script src="https://cdn.example/x.js?v=__BL_ASSET_VERSION__"></script><script src="../secret.js?v=__BL_ASSET_VERSION__"></script>';

test('index stamps existing local assets only, keeping their other parameters', () => {
  const dir=root(),out=H.stampAssetHashes(page,dir,'__BL_ASSET_VERSION__');
  const hash=H.contentHash(path.join(dir,'app.js'));
  assert.match(hash,/^[a-f0-9]{16}$/);
  assert.ok(out.includes(`app.js?v=__BL_ASSET_VERSION__&h=${hash}&rev=3`));
  assert.match(out,/vendor\/x\.css\?v=__BL_ASSET_VERSION__&h=[a-f0-9]{16}"/);
  assert.ok(out.includes('missing.js?v=__BL_ASSET_VERSION__"'),'missing file stays unstamped');
  assert.ok(out.includes('https://cdn.example/x.js?v=__BL_ASSET_VERSION__"'),'remote URL untouched');
  assert.ok(out.includes('../secret.js?v=__BL_ASSET_VERSION__"'),'paths outside the public root are not read');
});

test('only a hash matching the current content is immutable; edits fall back to revalidation', () => {
  const dir=root(),file=path.join(dir,'app.js'),hash=H.contentHash(file);
  assert.equal(cacheControlFor(file,`/app.js?v=7.0.318&h=${hash}`),'public, max-age=31536000, immutable');
  assert.equal(cacheControlFor(file,'/app.js?v=7.0.318'),'no-cache');
  assert.equal(cacheControlFor(file,'/app.js?v=7.0.318&h=0000000000000000'),'no-cache');
  fs.writeFileSync(file,'/* patched, same version */'+'c'.repeat(4096));
  const future=new Date(Date.now()+5000);fs.utimesSync(file,future,future);
  assert.equal(cacheControlFor(file,`/app.js?v=7.0.318&h=${hash}`),'no-cache','old hash is never immutable after a change');
  assert.equal(cacheControlFor(path.join(dir,'index.html'),`/index.html?h=${hash}`),'no-store');
});

test('the gzip layer sends the immutable header for a stamped request', async () => {
  const dir=root(),hash=H.contentHash(path.join(dir,'app.js')),handler=createStaticGzip(dir);
  const res=await new Promise(resolve=>{const out={statusCode:200,headers:{},setHeader(k,v){this.headers[k.toLowerCase()]=v;},end(){resolve(this);}};
    handler({method:'GET',url:`/app.js?v=1&h=${hash}`,originalUrl:`/app.js?v=1&h=${hash}`,headers:{'accept-encoding':'gzip'}},out,()=>resolve({next:true}));});
  assert.equal(res.headers['cache-control'],'public, max-age=31536000, immutable');
});

test('server wiring: index stamping, express.static and pre-session routes use the same rule', () => {
  const server=fs.readFileSync(path.join(__dirname,'../server/server.js'),'utf8');
  assert.match(server,/return stampAssetHashes\(INDEX_TEMPLATE_CACHE, path\.join\(__dirname, '\.\.', 'public'\), '__BL_ASSET_VERSION__'\)/);
  assert.match(server,/const immutable = !html && immutableForRequest\(filePath, res\.req && \(res\.req\.originalUrl \|\| res\.req\.url\), stat\);/);
  assert.equal((server.match(/res\.set\('Cache-Control', publicAssetCacheControl\(req, full\)\);/g)||[]).length,2);
});

test('boot warming precomputes hashes so the first index render reads no asset synchronously', async () => {
  const dir=root(),html='<script src="app.js?v=__BL_ASSET_VERSION__"></script><link href="vendor/x.css?v=__BL_ASSET_VERSION__" rel="stylesheet">';
  assert.equal(await H.warmAssetHashes(html,dir,'__BL_ASSET_VERSION__'),2);
  assert.equal(await H.warmAssetHashes(html,dir,'__BL_ASSET_VERSION__'),0,'unchanged files are not re-read');
  const original=fs.readFileSync;let reads=0;fs.readFileSync=function(...args){reads++;return original.apply(this,args);};
  try{assert.match(H.stampAssetHashes(html,dir,'__BL_ASSET_VERSION__'),/app\.js\?v=__BL_ASSET_VERSION__&h=[a-f0-9]{16}/);}finally{fs.readFileSync=original;}
  assert.equal(reads,0);
});
