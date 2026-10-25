"""Phase 0A source inventory. Read-only for production; lexical leads need runtime review."""
import json, re, pathlib, collections
root = pathlib.Path(__file__).resolve().parents[4]
public = root / 'resources/app/public'
out = pathlib.Path(__file__).resolve().parents[1] / 'evidence/baseline'
out.mkdir(parents=True, exist_ok=True)
files = sorted(p for p in public.rglob('*') if p.suffix in ('.css', '.html', '.js') and not any(x in p.parts for x in ('vendor', 'release-notes')))
patterns = {
    'raw-colors': r'#[0-9a-fA-F]{3,8}\b|(?:rgba?|hsla?)\([^)]*\)',
    'font-size': r'font-size\s*:\s*[^;{}"\n]+',
    'font-shorthand': r'(?<![-\w])font\s*:\s*[^;{}"\n]+',
    'radius': r'border(?:-(?:top|bottom)-(?:left|right))?-radius\s*:\s*[^;{}"\n]+',
    'border': r'(?<![-\w])border(?:-(?:top|bottom|left|right))?\s*:\s*[^;{}"\n]+',
    'z-index': r'z-index\s*:\s*[^;{}"\n]+',
    'motion': r'(?:animation|transition)(?:-[\w-]+)?\s*:\s*[^;{}"\n]+',
    'keyframes': r'@keyframes\s+[\w-]+',
    'js-hook': r'(?:getElementById|querySelector(?:All)?|closest|matches)\(\s*[\'"`]([^\'"`\n]+)',
    'data-hook': r'\bdata-[a-z][\w-]*(?:=[\'"`][^\'"`\n]*)?',
    'surface-id': r'\bid=[\'"`]([^\'"`]*(?:[Mm]odal|[Dd]ialog|[Dd]rawer|[Pp]opover|[Pp]opup|[Pp]anel|[Mm]enu|[Oo]verlay|[Gg]uard)[^\'"`]*)',
    'view-id': r'\bid=[\'"`](view-[^\'"`]+)',
    'component-class': r'(?<![\w-])\.([\w-]*(?:Btn|Button|Chip|Badge|Pill|Card|Tab|Kpi|KPI|Segment)[\w-]*)',
}
all_data = {}
for name, pattern in patterns.items():
    records = []
    for p in files:
        src = p.read_text()
        for match in re.finditer(pattern, src):
            records.append({'file': str(p.relative_to(root)), 'line': src.count('\n', 0, match.start()) + 1, 'value': match.group(1) if match.lastindex else match.group()})
    (out / (name + '.json')).write_text(json.dumps(records, ensure_ascii=False, indent=2) + '\n')
    counts = collections.Counter(r['value'] for r in records)
    all_data[name] = {'occurrences': len(records), 'unique': len(counts), 'top': counts.most_common(15)}
all_data['scope'] = {'files': len(files), 'css': sum(p.suffix == '.css' for p in files), 'html': sum(p.suffix == '.html' for p in files), 'js': sum(p.suffix == '.js' for p in files), 'method': 'Lexical discovery including inline/template styles; not a CSS parser or exhaustive reachability proof. Vendor and archived release notes excluded.'}
(out / 'inventory-summary.json').write_text(json.dumps(all_data, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({k: {x: v[x] for x in ('occurrences','unique') if x in v} for k,v in all_data.items()}, ensure_ascii=False))
