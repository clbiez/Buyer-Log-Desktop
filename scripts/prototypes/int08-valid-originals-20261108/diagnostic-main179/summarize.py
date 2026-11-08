"""Paired summaries from the complete recomputed trace analysis (N=3)."""
import argparse
import json
import pathlib
import statistics

def phase(run,name):
    return next(p for p in run['memory'] if p['phase']==name)

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--analysis',required=True)
    parser.add_argument('--output',required=True)
    args=parser.parse_args()
    data=json.loads(pathlib.Path(args.analysis).read_text())
    metrics={
        'tableDecodeCpuMs':lambda r:next(x['threadCpuMs'] for x in r['decodeWindows'] if x['label']=='table-through-two-scrolls'),
        'decodedImageMiB':lambda r:sum(a['sizeBytes'] for a in phase(r,'after-repeat-scroll')['allocatorEvidence'] if a['name']=='cc/image_memory')/1048576,
        'rendererRssMiB':lambda r:phase(r,'after-repeat-scroll')['rendererRssSumBytes']/1048576,
        'firstScrollP95Ms':lambda r:r['scroll'][0]['p95Ms'],
        'repeatScrollP95Ms':lambda r:r['scroll'][1]['p95Ms'],
        'firstScrollLongTaskPercent':lambda r:r['scroll'][0]['longTaskWallShare']*100,
        'repeatScrollLongTaskPercent':lambda r:r['scroll'][1]['longTaskWallShare']*100,
        'backingStorageMiB':lambda r:phase(r,'after-repeat-scroll')['heapUsage']['backingStorageSize']/1048576,
    }
    output=[]
    for module in ['cp','orders']:
        runs=[r for r in data['runs'] if r['module']==module]
        controls=sorted((r for r in runs if r['scenario']=='control'),key=lambda r:r['run'])
        originals=sorted((r for r in runs if r['scenario']=='originals'),key=lambda r:r['run'])
        assert len(controls)==len(originals)==3
        for name,read in metrics.items():
            c,o=[read(r) for r in controls],[read(r) for r in originals]
            delta=[y-x for x,y in zip(c,o)]
            output.append(dict(module=module,metric=name,control=c,originals=o,pairedDelta=delta,
                controlMedian=statistics.median(c),originalMedian=statistics.median(o),
                pairedDeltaMedian=statistics.median(delta),pairedDeltaRange=[min(delta),max(delta)]))
    pathlib.Path(args.output).write_text(json.dumps(dict(scope='Main179 diagnostic; paired original minus control; N=3 per module',rows=output),indent=2)+'\n')

if __name__=='__main__':
    main()
