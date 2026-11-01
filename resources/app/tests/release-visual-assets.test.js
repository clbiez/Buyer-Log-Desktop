'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {planVisualAssets,visualAssets,assertMirrorable,MAX_RAW_MIRROR_BYTES}=require('../scripts/release-visual-assets');
function fixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'bl-release-assets-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  for(let i=1;i<=5;i++){
    const dir=path.join(root,'public/release-notes','7.0.'+i);fs.mkdirSync(dir,{recursive:true});
    fs.writeFileSync(path.join(dir,'screen.png'),'immutable screen '+i);
    fs.writeFileSync(path.join(dir,'release.json'),JSON.stringify({changes:[{visual:{src:'screen.png'}}]}));
  }
  return root;
}
test('GitHub package keeps recent screenshots offline and externalizes only historical image bytes',t=>{
  const root=fixture(t),before=visualAssets(root),plan=planVisualAssets(root,'github:buyer/releases');
  assert.deepEqual([...plan.external],['public/release-notes/7.0.1/screen.png','public/release-notes/7.0.2/screen.png']);
  assert.equal(plan.map.baseUrl,'https://raw.githubusercontent.com/buyer/releases/release-visuals/');
  for(const a of before.slice(0,2))assert.deepEqual(plan.map.files[a.key],{sha256:a.sha256,size:a.size});
  assert.deepEqual(visualAssets(root),before,'archived source bytes must stay immutable');
  assert.equal(planVisualAssets(root,'').external.size,0,'folder/offline builds keep all images');
});
test('publication rejects an oversized package instead of silently removing the usable transport',()=>{
  assert.doesNotThrow(()=>assertMirrorable({size:MAX_RAW_MIRROR_BYTES}));
  for(const size of [MAX_RAW_MIRROR_BYTES+1,0,-1,Infinity,NaN])assert.throws(()=>assertMirrorable({size}),{code:'RELEASE_RAW_MIRROR_REQUIRED'});
});
test('archive inventory rejects missing files, traversal and symbolic links',t=>{
  const root=fixture(t),dir=path.join(root,'public/release-notes/7.0.1'),release=path.join(dir,'release.json');
  fs.writeFileSync(release,JSON.stringify({changes:[{visual:{src:'../screen.png'}}]}));
  assert.throws(()=>visualAssets(root),{code:'RELEASE_VISUAL_ASSET_INVALID'});
  fs.writeFileSync(release,JSON.stringify({changes:[{visual:{src:'missing.png'}}]}));assert.throws(()=>visualAssets(root),{code:'ENOENT'});
  if(process.platform!=='win32'){
    fs.symlinkSync(path.join(dir,'screen.png'),path.join(dir,'link.png'));
    fs.writeFileSync(release,JSON.stringify({changes:[{visual:{src:'link.png'}}]}));assert.throws(()=>visualAssets(root),{code:'RELEASE_VISUAL_ASSET_INVALID'});
  }
});
