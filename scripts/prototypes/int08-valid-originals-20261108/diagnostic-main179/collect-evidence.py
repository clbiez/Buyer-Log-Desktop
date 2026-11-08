"""Copy retained diagnostic evidence; never delete or rewrite source evidence."""
import argparse
import json
import pathlib
import shutil
from admission import require_flock
from storage import admit, atomic_json, sha_file, MIB
from analyze import verify_packing

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--work-root', required=True)
    parser.add_argument('--output-dir', required=True)
    args = parser.parse_args()
    require_flock()
    work, output = pathlib.Path(args.work_root).resolve(), pathlib.Path(args.output_dir).resolve()
    assert not output.exists()
    output.mkdir(parents=True)
    admit(output, 2048*MIB, 'retain-portable-evidence-copy')
    files = []
    def copy(source, relative):
        if not source.is_file():
            return
        target = output/relative
        target.parent.mkdir(parents=True,exist_ok=True)
        shutil.copyfile(source,target)
        digest = sha_file(source)
        assert sha_file(target) == digest
        files.append(dict(path=str(relative),sourcePath=str(source),bytes=source.stat().st_size,sha256=digest))
    for source in work.iterdir():
        if source.is_file():
            copy(source,pathlib.Path('task')/source.name)
    for stage in (work/'stages').iterdir():
        for source in stage.iterdir():
            if source.is_file():
                copy(source,pathlib.Path('stage')/source.name)
        for source in (stage/'originals').iterdir():
            copy(source,pathlib.Path('originals')/source.name)
    for cohort in (work/'runs').iterdir():
        for source in cohort.iterdir():
            if source.is_file():
                copy(source,pathlib.Path('runs')/cohort.name/source.name)
        for run in cohort.iterdir():
            if not run.is_dir():
                continue
            if (run/'artifact-compression-manifest.json').exists():
                verify_packing(run)
            for source in run.iterdir():
                if source.is_file():
                    copy(source,pathlib.Path('runs')/cohort.name/run.name/source.name)
            source=run/'fixture/local/page-cache/moderator/manifest.json'
            copy(source,pathlib.Path('runs')/cohort.name/run.name/'measurement-cache-manifest.json')
    cache=next((work/'temp').glob('buyerlog-startup-*'))
    copy(cache/'server.log',pathlib.Path('phase0/server.log'))
    copy(cache/'source/benchmark-fixture.json',pathlib.Path('phase0/benchmark-fixture.json'))
    copy(cache/'local/page-cache/moderator/manifest.json',pathlib.Path('phase0/cache-manifest.json'))
    atomic_json(output/'portable-evidence-manifest.json',dict(scope='Main179 diagnostic; not post908 acceptance',
        fileCount=len(files),files=files,
        localRetention='All original work roots, partial/failed attempts, mutable fixture JSON, caches, original XLSX and source hardlinks remain in work/. Portable copies retain top-level raw evidence, source audits, full lossless traces, original rasters and exports; private mutable fixture/auth state is not republished.',
        compression='Original compression manifests are unchanged; they also describe retained local mutable fixture artifacts. Every gzip artifact was independently reverified locally before copying.'))
    print(output)

if __name__ == '__main__':
    main()
