'use strict';
// Card images live in a content-addressed file store; overrides keep only short URLs.
// Regression: base64 covers/guides inside overrides.json made every read deep-copy and
// every write rewrite tens of MB (GET 8–12 s, one rate save 51 s with 120 cards).
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const assets=require('../server/lib/license-card-assets'),cards=require('../server/lib/license-cards'),sync=require('../server/lib/license-card-sync'),A=require('../public/license-atlas-engine'),E=require('../public/license-cards-engine');
const PNG='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg==';
const tmp=()=>fs.mkdtempSync(path.join(os.tmpdir(),'bl-license-assets-'));
const atlasWith=(cover,guide)=>({version:1,license:{id:'c',name:'L',cover,stages:[{id:'s',title:'S',visualGuideId:'g',submissions:[]}],addresses:[],portal:{url:'',notes:''}},sharedAddresses:[],visualLibrary:[{id:'g',name:'g',data:guide}]});

test('unconfigured (tests/tools): data URLs pass through unchanged', () => {
  assets.configure({});
  assert.equal(assets.externalizeImage(PNG),PNG);
  assert.equal(cards.normalizeProfile({processAtlas:atlasWith(PNG,PNG)}).processAtlas.license.cover,PNG);
});

test('images become content-addressed files; the same bytes always get the same URL', async () => {
  const dir=tmp(),shared=tmp();assets.configure({dir,getSharedSyncRoot:async()=>shared});
  try{
    const url=assets.externalizeImage(PNG);
    assert.match(url,assets.URL_RE);assert.equal(assets.externalizeImage(PNG),url,'idempotent');
    assert.equal(fs.readdirSync(dir).length,1);
    const got=await assets.read(assets.nameOf(url));assert.equal(got.type,'image/png');assert.equal(got.bytes.toString('base64'),PNG.split(',')[1]);
    assert.equal(await assets.read('../../etc/passwd'),null,'only hashed names are served');
    const profile=cards.normalizeProfile({processAtlas:atlasWith(PNG,PNG),symbolDataUrl:PNG});
    assert.equal(profile.processAtlas.license.cover,url);assert.equal(profile.processAtlas.visualLibrary[0].data,url);assert.equal(profile.symbolDataUrl,url);
    assert.equal(cards.normalizeProfile(profile).processAtlas.license.cover,url,'stored URLs validate again');
    await new Promise(r=>setTimeout(r,50));
    assert.ok(fs.existsSync(path.join(shared,'BUYER_LOG_SYNC','license-card-assets',assets.nameOf(url))),'distributed to the shared folder');
  }finally{assets.configure({});}
});

test('another user’s image is fetched once from the shared folder and verified', async () => {
  const mine=tmp(),theirs=tmp(),shared=tmp();
  assets.configure({dir:theirs,getSharedSyncRoot:async()=>shared});const url=assets.externalizeImage(PNG);await new Promise(r=>setTimeout(r,50));
  assets.configure({dir:mine,getSharedSyncRoot:async()=>shared});
  try{
    const got=await assets.read(assets.nameOf(url));assert.ok(got);assert.ok(fs.existsSync(path.join(mine,assets.nameOf(url))),'cached locally');
    const forged=path.join(shared,'BUYER_LOG_SYNC','license-card-assets','0'.repeat(64)+'.png');fs.writeFileSync(forged,'not the hash');
    assert.equal(await assets.read('0'.repeat(64)+'.png'),null,'content must match its hash');
  }finally{assets.configure({});}
});

test('migration moves every stored image out of overrides; peers’ inline images are externalized on arrival', () => {
  const dir=tmp();assets.configure({dir});
  try{
    const ov=cards.appendDiscovered({_revision:0,_revisions:{pricingRules:1},pricingRules:[]},[{license:'A',licensor:'X'},{license:'B',licensor:'Y'}]).overrides;
    ov.licenseCards.items[0].processAtlas=atlasWith(PNG,PNG);
    ov.licenseStageTemplates={items:[{id:'t',name:'T',stage:{title:'S',submissions:[]},addresses:[],visual:{name:'v',data:PNG},updatedAt:'x'}],updatedAt:'x'};
    const before=JSON.stringify(ov).length,r=assets.externalizeOverrides(ov);
    assert.equal(r.changed,true);assert.equal(r.cards.length,1);assert.ok(!JSON.stringify(r.overrides).includes('data:image'));
    assert.ok(JSON.stringify(r.overrides).length<before);
    assert.equal(assets.externalizeOverrides(r.overrides).changed,false,'second pass is a no-op');
    const card={...ov.licenseCards.items[0]};
    const snap=sync.profileSnapshot(card);assert.match(snap.processAtlas.license.cover,assets.URL_RE);
  }finally{assets.configure({});}
});

test('engines accept stored asset URLs (map validation, list image)', () => {
  const url='/api/license-cards/assets/'+'a'.repeat(64)+'.webp';
  assert.equal(A.normalize(atlasWith(url,url)).license.cover,url);
  assert.throws(()=>A.normalize(atlasWith('/api/license-cards/assets/../x.png','')));
  assert.equal(E.cardImage({processAtlas:{license:{cover:url}}}),url);
});

test('wiring: served with immutable caching, migrated at startup, inlined into the supplier file', () => {
  const read=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');
  const routes=read('server/routes/license-card-routes.js'),server=read('server/server.js'),client=read('public/license-cards.js');
  assert.match(routes,/app\.get\('\/api\/license-cards\/assets\/:name', area,/);assert.match(routes,/immutable/);
  assert.match(server,/require\('\.\/lib\/license-card-assets'\)\.configure\(/);assert.match(server,/licenseCardService\.migrateAssets\(/);
  assert.match(client,/await inlineAssets\(licenses\);\n\s*const result=await A\.buildEmailSafeHTML/);
});
