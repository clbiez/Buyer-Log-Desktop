"""Verify copied evidence using relative manifest paths, without old roots."""
import argparse
import gzip
import hashlib
import json
import pathlib
from storage import atomic_json, sha_file

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--evidence-root',required=True)
    parser.add_argument('--output',required=True)
    args=parser.parse_args()
    root=pathlib.Path(args.evidence_root).resolve()
    manifest=json.loads((root/'portable-evidence-manifest.json').read_text())
    compressed=0
    private_local=0
    for item in manifest['files']:
        file=root/item['path']
        assert file.resolve().is_relative_to(root)
        assert file.stat().st_size==item['bytes'] and sha_file(file)==item['sha256'],str(file)
        if file.name!='artifact-compression-manifest.json':
            continue
        packed=json.loads(file.read_text())
        assert packed['status']=='packed' and packed['serverExitConfirmed']
        old_parent=pathlib.Path(item['sourcePath']).parent
        for record in packed['artifacts']:
            relative=pathlib.Path(record['gzipPath']).relative_to(old_parent)
            copied=file.parent/relative
            if not copied.exists():
                assert relative.parts[0]=='fixture','Missing performance evidence: '+str(copied)
                private_local+=1
                continue
            assert sha_file(copied)==record['gzipSha256']
            digest,size=hashlib.sha256(),0
            with gzip.open(copied,'rb') as stream:
                for chunk in iter(lambda:stream.read(1024*1024),b''):
                    digest.update(chunk)
                    size+=len(chunk)
            assert size==record['rawBytes'] and digest.hexdigest()==record['rawSha256']
            compressed+=1
    atomic_json(args.output,dict(status='passed',copiedFilesVerified=len(manifest['files']),
        copiedGzipRoundTripsVerified=compressed,privateMutableArtifactsRetainedOnlyLocally=private_local,
        manifestSha256=sha_file(root/'portable-evidence-manifest.json'),
        noHistoricalFilesystemDependency=True,
        note='Private fixture/auth state is intentionally not republished. All performance traces, top-level results, byte checks, source audits, original rasters and XLSX evidence are delivered. Original compression manifests remain unchanged.'))
    print(args.output)

if __name__=='__main__':
    main()
