"""Package the actual concept screenshots into one offline review document."""
from pathlib import Path
from base64 import b64encode
from html import escape
import sys

ROOT = Path(__file__).resolve().parents[4]
GALLERY = ROOT / 'docs/ai/ui-rebuild'
FONTS = ROOT / 'resources/app/public/vendor/fonts'
EVIDENCE = GALLERY / 'evidence/palette-revision'
THEMES = [('light', 'Açık — mevcut renkler'), ('grey', 'Grey — yeni öneri'), ('dark', 'Dark — mevcut renkler'), ('graphite', 'Grafit — 4. tema adayı')]


def data_url(path, mime):
    return 'data:' + mime + ';base64,' + b64encode(path.read_bytes()).decode('ascii')


font_css = []
for family, stem, weight in [('Review Barlow', 'barlow', 400), ('Review Heading', 'barlow-condensed', 600)]:
    for subset in ['latin-ext', 'latin']:
        url = data_url(FONTS / f'{stem}-{weight}-{subset}.woff2', 'font/woff2')
        unicode = 'unicode-range:U+0000-00FF;' if subset == 'latin' else ''
        font_css.append(f'@font-face{{font-family:"{family}";font-style:normal;font-weight:{weight};src:url("{url}") format("woff2");font-display:swap;{unicode}}}')

panels = []
for view, view_label in [('cp', 'CP Tracker / tablo'), ('overview', 'Overview')]:
    for theme, theme_label in THEMES:
        cards = []
        for concept, label in [('kartela', 'A — Kartela'), ('manifest', 'B — Manifest')]:
            source = EVIDENCE / concept / f'{view}-{theme}.png'
            image = data_url(source, 'image/png')
            caption = f'{label} · {view_label} · {theme_label}'
            cards.append(f'''<article><h3>{label}</h3>
<label class="size"><input type="checkbox" aria-label="{escape(caption)}: tam boyut"> Tam boyut (1440 × 900)</label>
<div class="frame"><img src="{image}" alt="{escape(caption)}" width="1440" height="900"></div></article>''')
        reference = ''
        if view == 'cp' and theme != 'graphite':
            original = data_url(GALLERY / 'evidence/baseline' / f'cp-{theme}.png', 'image/png')
            reference = f'<details class="reference"><summary>Önceki sürümün tablosunu göster</summary><article><label class="size"><input type="checkbox" aria-label="Önceki CP tablosu: {theme_label}, tam boyut"> Tam boyut (1440 × 900)</label><div class="frame"><img src="{original}" alt="Önceki sürüm — CP Tracker, {theme_label}" width="1440" height="900"></div></article></details>'
        initial = ' open' if view == 'cp' and theme == 'light' else ''
        panels.append(f'<details class="screen" id="{view}-{theme}"{initial}><summary>{view_label} <span>{theme_label}</span></summary><div class="compare">' + ''.join(cards) + '</div>' + reference + '</details>')

license_text = (Path(__file__).parent / 'Barlow-OFL.txt').read_text()
html = '''<!doctype html>
<html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light"><title>Buyer Log — Nötr renk revizyonu</title>
<style>''' + ''.join(font_css) + '''
*{box-sizing:border-box}body{margin:0;background:#f4f1e9;color:#252b27;font:1.05rem/1.5 "Review Barlow",sans-serif}
main{max-width:1800px;margin:auto;padding:36px 28px}h1,h2,h3{font-family:"Review Heading",sans-serif;font-weight:600;line-height:1.15}h1{font-size:2.7rem;margin:12px 0}h2{font-size:1.7rem;margin:0 0 12px}h3{font-size:1.5rem;margin:12px 0}.eyebrow{text-transform:uppercase;font-size:.82rem;letter-spacing:.07em}p{max-width:90ch}.intro{display:grid;grid-template-columns:1fr 1fr;gap:28px;margin:28px 0}.intro p{margin:0}.screen{margin:12px 0;background:#e8e5db}.screen>summary{cursor:pointer;padding:18px;font-size:1.25rem;font-weight:400}.screen>summary span{margin-left:14px;color:#4b574c}.screen[open]>summary{background:#344d39;color:#fff}.screen[open]>summary span{color:#f0f1e9}.compare{display:grid;grid-template-columns:1fr 1fr;gap:22px;padding:4px 18px 20px}article{min-width:0}.size{display:flex;align-items:center;gap:8px;margin:12px 0;cursor:pointer;font-size:.94rem}input{accent-color:#344d39;border-radius:0}.frame{overflow:auto;background:#dddacf}img{display:block;width:100%;height:auto}article:has(input:checked) img{width:1440px;max-width:none}summary:focus-visible,input:focus-visible{outline:2px solid #466549;outline-offset:3px}.note{background:#e8e5db;padding:22px;margin-top:28px}.note p{margin:8px 0}.small{font-size:.9rem;color:#4b574c}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:.85rem}footer{margin:24px 0}footer summary{cursor:pointer}@media(max-width:1000px){.compare,.intro{grid-template-columns:1fr}main{padding:24px 14px}.compare{padding:4px 12px 16px}}@media print{details.screen{break-inside:avoid}details.screen>.compare{display:grid!important}.size{display:none}article:has(input:checked) img{width:100%}}
</style></head><body><main>
<div class="eyebrow">Buyer Log / Faz 0B / Renk revizyonu</div>
<h1>Tanıdık renkler, yenilenen düzen.</h1>
<p><strong>Açık ve dark:</strong> önceki nötr zeminler, çelik mavisi vurgu ve tablo başlık renkleri geri alındı. <strong>Grey:</strong> daha nötr ve açık bir gri önerisi. <strong>Grafit:</strong> isteğe bağlı, daha koyu dördüncü tema adayı.</p>
<p>Ekran ve tema başlığını açarak iki konsepti karşılaştırın. Küçük yazıları okumak için ilgili görüntünün “Tam boyut” seçimini kullanın.</p>
<div class="intro"><section><h2>A — Kartela</h2><p>Serif başlıklar, açık metrik satırı ve dikey termin grafiği. Renkleri mevcut palete dönen, editoryal ve ferah düzen.</p></section><section><h2>B — Manifest</h2><p>Dar teknik başlıklar, yatay termin grafiği ve geniş lojistik haritası. Kartela ile aynı nötr paleti kullanan, daha sıkı düzen.</p></section></div>
''' + '\n'.join(panels) + '''
<section class="note"><h2>Seçim ve doğrulama</h2><p>İki düzenin renkleri artık ortak. Önce yerleşim ve tipografiyi, ardından Grey önerisini veya dördüncü Grafit temasını değerlendirebilirsiniz. Grafit bu aşamada yalnız prototip önizlemesidir.</p><p>Renk revizyonunda her konseptin 18 ilgili testi geçti. CP Excel ve kopyalama çıktıları dört palette başlangıç referansıyla karşılaştırıldı. Önceki Kartela ölçümündeki 127 ms ilk CP geçiş artışı açık risk olarak duruyor; yalnız renk değiştiği için performans ölçümü tekrarlanmadı.</p><p>16 güncel görüntü ve 3 eski tablo referansı, gerçek uygulamadan anonim veriyle alınmış 1440 × 900 PNG’lerdir. Bu dosyaya değiştirilmeden gömüldüler.</p></section>
<footer><p>Konsept seçimi bekleniyor; Faz 1 başlamadı. PR açılmadı, CI çalışmadı, merge yapılmadı. TEST ve STABLE yayınlanmadı.</p><p class="small">Bu HTML görselleri, fontları ve stilleri kendi içinde taşır; internet veya JavaScript gerektirmez.</p><details><summary>Font lisansı — Barlow / SIL OFL</summary><pre>''' + escape(license_text) + '''</pre></details></footer>
</main></body></html>
'''
for old, new in {'#f4f1e9':'#f5f7f9','#252b27':'#16212d','#e8e5db':'#e9edf1','#344d39':'#356a96','#4b574c':'#526171','#f0f1e9':'#fff','#dddacf':'#e9edf1','#466549':'#356a96'}.items():
    html = html.replace(old, new)
html = html.replace('</style>', '.reference{padding:0 18px 20px}.reference>summary{cursor:pointer;padding:10px 0;color:#374454}</style>')
output = Path(sys.argv[1]) if len(sys.argv) > 1 else GALLERY / 'concepts.html'
output.write_text(html, encoding='utf-8')
print(f'{output}: {len(html.encode("utf-8")):,} bytes, 19 embedded PNGs, no external resources')
