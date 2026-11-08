"""Post-ingest representative derivatives; no application/render-time path."""
import argparse
import hashlib
import io
import json
import pathlib
import time
from PIL import Image, ImageDraw
from admission import require_flock, memory_admit
from storage import atomic_json, admit, MIB

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--stage-root', required=True)
    parser.add_argument('--output-dir', required=True)
    args = parser.parse_args()
    require_flock()
    stage, output = pathlib.Path(args.stage_root), pathlib.Path(args.output_dir)
    output.mkdir(parents=True, exist_ok=False)
    admit(output, 128*MIB, 'six-representative-derivatives-and-quality-sheets')
    memory_admit(output, 'representative-quality', 1024*MIB)
    manifest = json.loads((stage/'fixture-manifest.json').read_text())
    selected, seen = [], set()
    for image in manifest['images']:
        key = image['class'], image['mime']
        if key not in seen:
            selected.append(image)
            seen.add(key)
    assert len(selected) == 6
    rows = []
    sheet = Image.new('RGB', (1280, len(selected)*440+40), 'white')
    draw = ImageDraw.Draw(sheet)
    for col, title in enumerate(['Original resized to 288x384', '96px derivative at 4x', '192px derivative at 2x', '384px derivative at 1x']):
        draw.text((col*320+8, 10), title, fill='black')
    for row, item in enumerate(selected):
        source = stage/'originals'/item['file']
        raw = source.read_bytes()
        assert hashlib.sha256(raw).hexdigest() == item['sha256']
        decode_started = time.perf_counter()
        with Image.open(source) as image:
            image.load()
            original = image.convert('RGB')
        source_decode_ms = (time.perf_counter()-decode_started)*1000
        reference = original.copy()
        reference.thumbnail((384,384),Image.Resampling.LANCZOS)
        sheet.paste(reference, (16,row*440+60))
        for col, edge in enumerate([96,192,384], 1):
            started = time.perf_counter()
            derivative = original.copy()
            derivative.thumbnail((edge,edge),Image.Resampling.LANCZOS)
            encoded = io.BytesIO()
            png = item['mime'] == 'image/png'
            derivative.save(encoded, format='PNG' if png else 'JPEG',
                **({'compress_level':6} if png else {'quality':92,'subsampling':0,'optimize':False,'progressive':False}))
            elapsed_ms = (time.perf_counter()-started)*1000
            data = encoded.getvalue()
            file = output/('%02d-%d.%s'%(item['index'],edge,'png' if png else 'jpg'))
            file.write_bytes(data)
            with Image.open(file) as verify:
                verify.verify()
            with Image.open(file) as decoded:
                decoded.load()
                assert decoded.size == derivative.size
                enlarged = decoded.resize(reference.size,Image.Resampling.NEAREST)
                sheet.paste(enlarged,(col*320+16,row*440+60))
            rows.append(dict(originalIndex=item['index'],sizeClass=item['class'],mime=item['mime'],
                originalSha256=item['sha256'],originalEncodedBytes=len(raw),edge=edge,
                width=derivative.width,height=derivative.height,encodedBytes=len(data),
                sha256=hashlib.sha256(data).hexdigest(),file=file.name,
                sourceDecodeMs=source_decode_ms,ingestResizeEncodeMs=elapsed_ms,
                timingScope='Source decode once per original; resize/encode separately per edge; excludes disk write and post-write verification.',
                rgbaSizeEstimateBytes=derivative.width*derivative.height*4))
        draw.text((16,row*440+40),'index %02d / %s / %s'%(item['index'],item['class'],item['mime']),fill='black')
    sheet.save(output/'quality-contact-sheet.png')
    atomic_json(output/'representative-derivatives.json',dict(scope='diagnostic representative derivatives only',
        originalFixtureSha256=hashlib.sha256((stage/'fixture-manifest.json').read_bytes()).hexdigest(),
        edgeSemantics='maximum width and height; preserve portrait aspect ratio',
        qualityCaveat='No single PSNR product gate. Inspect seams, contrast, fine texture, text and colour; original zoom/export remains mandatory.',
        memoryCaveat='RGBA sizes are mathematical estimates, not allocator measurements. No table speed gain is claimed.',images=rows))
    print(output)

if __name__ == '__main__':
    main()
