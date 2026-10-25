"""Standalone review document: embeds the actual PNGs; works offline without JS."""
from pathlib import Path
import base64
import hashlib
import html
import json

root = Path(__file__).resolve().parents[4]
evidence = root / 'docs/ai/ui-rebuild/phase-1/final'
font = root / 'resources/app/public/vendor/fonts/IBMPlexSans.woff2'
font_data = base64.b64encode(font.read_bytes()).decode()
screens = [('cp', 'CP Tracker', 'Ana sütun gruplarında 1 px ince ayırıcı; eski başlık renkleri.'),
           ('overview', 'Genel Bakış', 'Manifest başlık hiyerarşisi, köşeli grafik işaretçileri ve sakin yüzeyler.'),
           ('notes', 'Sipariş notu', 'Ortak modal, görünür odak ve Tab / Shift+Tab ile klavye dolaşımı.'),
           ('login', 'Giriş', 'Uygulamayla ortak tema, yerel fontlar ve arayüz ölçeği.'),
           ('startup', 'Açılış', 'Ortak yüzeyler, okunur aşamalar ve kısa geçişler.')]
manifest = []
parts = [f'''<!doctype html><html lang="tr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'; base-uri 'none'">
<title>Buyer Log · Manifest · Faz 1 pilotu</title><style>
@font-face{{font-family:Plex;src:url(data:font/woff2;base64,{font_data}) format('woff2');font-weight:100 900;font-display:swap}}
*{{box-sizing:border-box}}body{{margin:0;background:#f5f7f9;color:#16212d;font:400 1rem/1.65 Plex,sans-serif}}
main{{max-width:1488px;margin:auto;padding:clamp(16px,3vw,48px)}}header{{max-width:850px;margin-bottom:36px}}
.eyebrow{{font-size:.75rem;letter-spacing:.13em;text-transform:uppercase;color:#374454}}h1{{font-size:clamp(2rem,4vw,3.8rem);line-height:1.05;letter-spacing:-.035em;margin:14px 0 24px;font-weight:600}}h2{{font-size:1.4rem;margin:30px 0 12px}}p{{margin:12px 0}}a{{color:#245578}}nav{{display:flex;gap:8px;flex-wrap:wrap;margin:24px 0}}nav a{{padding:8px 16px;background:#e9edf1;text-decoration:none}}
details{{margin:10px 0;background:white}}summary{{cursor:pointer;padding:16px 20px;font-weight:600;list-style-position:inside}}summary:hover{{background:#eaf2f8}}summary:focus-visible,a:focus-visible{{outline:2px solid #356a96;outline-offset:3px}}figure{{margin:0;padding:0 8px 12px}}img{{display:block;width:100%;height:auto}}figcaption{{padding:12px;font-size:.875rem;color:#374454}}footer{{margin-top:40px;color:#374454;font-size:.875rem}}.note{{background:#e9edf1;padding:16px 20px}}
@media(prefers-reduced-motion:reduce){{*{{scroll-behavior:auto}}}}
</style></head><body><main><header><div class="eyebrow">Buyer Log / Manifest / Faz 1</div>
<h1>Veri önde.<br>Başlıklar yerli yerinde.</h1>
<p>Manifest pilotu, gerçek uygulamadan alınmış anonim ekran görüntüleriyle. Ana tablo gruplarının sınır çizgileri geri geldi; eski tablo başlık renkleri ile açık ve koyu temaların nötr yüzeyleri korundu. Gri tema yeniden dengelendi.</p>
<p class="note">Her başlığa tıklayarak ekranı açabilirsiniz. Bu dosya çevrimdışı çalışır; görseller ve font içine gömülüdür. Görüntüler canlı uygulamanın yerini tutmaz.</p>
<nav aria-label="Temalar"><a href="#light">Açık</a><a href="#grey">Gri</a><a href="#dark">Koyu</a></nav></header>''']
for theme, label in [('light', 'Açık'), ('grey', 'Gri'), ('dark', 'Koyu')]:
    parts.append(f'<section id="{theme}" aria-labelledby="title-{theme}"><h2 id="title-{theme}">{label} tema</h2>')
    for screen, title, description in screens:
        filename = f'{screen}-{theme}.png'
        data = (evidence / filename).read_bytes()
        manifest.append({'file': filename, 'sha256': hashlib.sha256(data).hexdigest(), 'bytes': len(data)})
        encoded = base64.b64encode(data).decode()
        parts.append(f'<details{(" open" if screen=="cp" else "")}><summary>{html.escape(title)}</summary><figure><img src="data:image/png;base64,{encoded}" width="1440" height="900" alt="{html.escape(title)} — {label} tema; anonim Buyer Log verisi"><figcaption>{html.escape(description)} · Gerçek PNG, 1440 × 900.</figcaption></figure></details>')
    parts.append('</section>')
parts.append('<footer>Yerel pilot · Faz 2 için onay bekliyor. PR açılmadı; CI, merge, TEST ve STABLE yayını yapılmadı. Tüm uygulama göçü tamamlanmadı.<br>25 Ekim 2026 · Buyer Log 7.0.294</footer></main></body></html>')
target = root / 'docs/ai/ui-rebuild/manifest-pilot.html'
target.write_text('\n'.join(parts), encoding='utf-8')
Path('/workspace/Buyer-Log-Manifest-Pilot.html').write_bytes(target.read_bytes())
(evidence / 'gallery-manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2)+'\n')
print(json.dumps({'file': str(target), 'bytes': target.stat().st_size, 'screens': len(manifest)}))
