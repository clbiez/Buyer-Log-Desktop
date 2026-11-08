"""The unchanged v1 seed7 size/codec/garment recipe, with pre-write disk admission."""
import hashlib, io, random
from PIL import Image, ImageDraw

def generate(originals, admit_image, raw_limit):
    records = []
    # The size and codec strata are deliberate stress samples, not a claim about
    # the unmeasured distribution of production originals. Each identity is unique.
    sizes = [(768, 1024, 'small'), (1536, 2048, 'medium'), (3072, 4096, 'large')]
    for index in range(32):
        width, height, size_class = sizes[index % len(sizes)]
        rng = random.Random(7000 + index)
        palette = [(54, 79, 108), (153, 91, 84), (95, 124, 93), (185, 158, 115)]
        image = Image.new('RGB', (width, height), (239, 237, 231))
        draw = ImageDraw.Draw(image)
        unit = min(width, height) / 768
        points = [(width*.34, height*.12), (width*.66, height*.12),
                  (width*.91, height*.34), (width*.77, height*.46),
                  (width*.69, height*.35), (width*.69, height*.90),
                  (width*.31, height*.90), (width*.31, height*.35),
                  (width*.23, height*.46), (width*.09, height*.34)]
        draw.polygon(points, fill=palette[index % len(palette)], outline=(28, 28, 28))
        for y in range(int(height*.18), int(height*.89), max(2, int(unit*4))):
            draw.line((width*.32, y, width*.68, y), fill=(109, 109, 104), width=max(1, int(unit)))
        for x in range(int(width*.33), int(width*.68), max(4, int(unit*12))):
            draw.line((x, height*.19, x, height*.88), fill=(67, 67, 64), width=max(1, int(unit)))
        draw.line((width*.5, height*.18, width*.5, height*.88), fill=(235, 229, 209), width=max(1, int(unit*2)))
        draw.rectangle((width*.40, height*.34, width*.59, height*.39), outline='white', width=max(1, int(unit)))
        draw.text((int(width*.12), int(height*.94)), 'SYNTHETIC INT08 SEED7 %02d' % index, fill=(12, 12, 12))
        # Deterministic fine texture avoids an all-solid, tiny compressed fixture.
        noise = Image.frombytes('L', (width, height), rng.randbytes(width*height)).convert('RGB')
        image = Image.blend(image, noise, .07)
        codec = 'png' if index % 4 == 0 else 'jpeg'
        filename = 'seed7-%02d-%s.%s' % (index, size_class, 'png' if codec == 'png' else 'jpg')
        destination = originals / filename
        buffer = io.BytesIO()
        image.save(buffer, format='PNG' if codec == 'png' else 'JPEG',
                   **({'compress_level': 6} if codec == 'png' else {'quality': 92, 'subsampling': 0, 'optimize': False, 'progressive': False}))
        raw = buffer.getvalue()
        assert 1024 < len(raw) < raw_limit
        admit_image(len(raw), filename)
        destination.write_bytes(raw)
        with Image.open(destination) as verified:
            verified.verify()
        with Image.open(destination) as decoded:
            decoded.load()
            assert decoded.size == (width, height)
        raw = destination.read_bytes()
        assert 1024 < len(raw) < raw_limit
        records.append({'index': index, 'file': filename, 'mime': 'image/png' if codec == 'png' else 'image/jpeg',
                        'class': size_class, 'width': width, 'height': height, 'encodedBytes': len(raw),
                        'rgbaPixelEstimateBytes': width*height*4, 'sha256': hashlib.sha256(raw).hexdigest()})
    return records
