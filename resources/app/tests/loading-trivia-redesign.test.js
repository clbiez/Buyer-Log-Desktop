'use strict';
// CP/Siparişler bekleme ekranı: büyük gösterge, "gerektiğinde" ibaresi yok, tek satır başlıklı kompakt kart.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const pub=f=>fs.readFileSync(path.join(__dirname,'..','public',f),'utf8');

test('core page loading uses the large orb and plain "Loading" titles',()=>{
  const src=pub('app-main.js'),start=src.indexOf('function renderCorePageLoadingState'),body=src.slice(start,src.indexOf('\n}',start));
  assert.ok(start>0);
  assert.doesNotMatch(body,/on demand|gerektiğinde/,'no "on demand" wording');
  assert.match(body,/'Loading Orders…':'Siparişler yükleniyor…'/);assert.match(body,/'Loading CP…':'CP yükleniyor…'/);
  assert.match(body,/renderState\(empty,\{kind:'loading',title,size:'lg'\}\)/);
  assert.match(body,/uiStateOrb blOrb--lg/,'fallback markup uses the large orb too');
});

test('BLUI state view adds blOrb--lg only when size is lg',()=>{
  const BLUI=require('../public/ui-primitives.js');
  assert.match(BLUI.stateView({kind:'loading',title:'x',size:'lg'}),/class="uiStateSpinner blOrb uiStateOrb blOrb--lg"/);
  assert.doesNotMatch(BLUI.stateView({kind:'loading',title:'x'}),/blOrb--lg/);
});

test('large loading orb escapes the theme .55 scale and the compact card has no duplicate labels',()=>{
  const css=pub('buyerlog-guide.css');
  assert.match(css,/\.uiState--loading \.uiStateOrb\.blOrb--lg\{[^}]*--orb-size:44px[^}]*transform:none!important/);
  assert.match(css,/\.blTriviaCard--compact \.blTriviaVisual figcaption\{display:none\}/);
  assert.match(css,/\.blTriviaCard--compact \.blTriviaCopy \.blGuideEyebrow\{display:none\}/);
  assert.match(css,/\.blTriviaCard--compact \.blTriviaCopy p\{[^}]*padding-left:0/);
  const js=pub('buyerlog-trivia.js');
  assert.match(js,/blTriviaKicker"><span class="blTriviaHeading" data-trivia-heading><\/span><span class="blTriviaKickerCat" data-trivia-cat>/);
  assert.doesNotMatch(js,/BEKLERKEN · BİLİYOR MUYDUNUZ\?','WHILE YOU WAIT · DID YOU KNOW\?'\)\}\)/,'page loading heading is a single short kicker');
});
